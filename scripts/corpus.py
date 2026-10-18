#!/usr/bin/env python3
"""Validate, fetch and measure the public multi-language retrieval corpus."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import tarfile
import time
import platform
import signal

from corpus_io import check_labels, digest, download, extract, validate
from corpus_report import markdown, report


def environment_for(work, index_threads):
    environment = os.environ.copy()
    for name in ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE"]:
        environment.pop(name, None)
    child_temp = work / "process-temp"
    child_temp.mkdir()
    environment.update({"RAYON_NUM_THREADS": str(index_threads), "GIT_CEILING_DIRECTORIES": str(work.resolve()),
        "TMPDIR": str(child_temp.resolve()), "TMP": str(child_temp.resolve()), "TEMP": str(child_temp.resolve())})
    return environment


def measure(command, directory, environment, timeout):
    stdout, stderr = directory / "stdout", directory / "stderr"
    started = time.monotonic()
    usage = None
    expired = False
    with stdout.open("wb") as output, stderr.open("wb") as errors:
        process = subprocess.Popen(command, stdout=output, stderr=errors, env=environment)
        try:
            if hasattr(os, "wait4"):
                while True:
                    pid, status, resource = os.wait4(process.pid, os.WNOHANG)
                    if pid:
                        process.returncode = os.waitstatus_to_exitcode(status)
                        usage = resource.ru_maxrss * (1 if sys.platform == "darwin" else 1024)
                        break
                    if time.monotonic() - started > timeout:
                        expired = True
                        process.kill()
                        process.wait()
                        break
                    time.sleep(0.02)
            else:
                try:
                    process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    expired = True
                    process.kill()
                    process.wait()
        finally:
            if process.returncode is None:
                process.kill()
                process.wait()
    return {"returncode": process.returncode, "wallMs": (time.monotonic() - started) * 1000,
        "peakRssBytes": usage, "timeout": expired, "stderr": stderr.read_text(errors="replace").strip()[-2000:]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["validate", "fetch", "run"])
    parser.add_argument("--manifest", type=Path, default=Path("benchmarks/corpus.json"))
    parser.add_argument("--binary", type=Path, default=Path("target/release/context"))
    parser.add_argument("--split", choices=["train", "eval", "all"], default="eval")
    parser.add_argument("--language")
    parser.add_argument("--case", dest="case_id", help="Measure one pinned case by id")
    parser.add_argument("--budgets", type=int, nargs="+", default=[8000, 16000, 32000])
    parser.add_argument("--methods", nargs="+", choices=["context", "lexical"], default=["context", "lexical"])
    parser.add_argument("--output", type=Path, default=Path("docs/corpus-results.json"))
    parser.add_argument("--work-dir", type=Path, help="Owned scratch directory; its existing content is preserved")
    parser.add_argument("--archive-cache", type=Path, help="Previously downloaded verified archives, treated as read-only")
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--jobs", type=int, default=1, help="Concurrent partitions; Unix only")
    parser.add_argument("--partition", choices=["language", "case"], default="language", help="Concurrency unit for --jobs")
    parser.add_argument("--index-threads", type=int, default=2)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    validate(manifest)
    if args.action == "validate":
        print(f"Valid corpus: {len(manifest['projects'])} projects, {len(manifest['cases'])} tasks; repository splits are isolated.")
        return 0
    if args.timeout <= 0 or args.jobs <= 0 or args.index_threads <= 0 or any(budget <= 0 for budget in args.budgets):
        parser.error("Timeout and budgets must be positive")
    projects = {project["id"]: project for project in manifest["projects"]}
    cases = [case for case in manifest["cases"] if (args.split == "all" or case["split"] == args.split)
        and (args.language is None or projects[case["project"]]["language"] == args.language)
        and (args.case_id is None or case["id"] == args.case_id)]
    if not cases:
        parser.error("No corpus cases match the filters")
    identity = {"corpusHash": digest(args.manifest), "binarySha256": digest(args.binary)} if args.action == "run" else None
    if args.jobs > 1 and args.action == "run" and (args.language is None or args.partition == "case"):
        if not hasattr(os, "killpg"):
            parser.error("Use --jobs 1 on platforms without Unix process groups")
        from corpus_matrix import run_matrix
        return run_matrix(args, manifest)
    if args.work_dir:
        args.work_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="context-corpus-", dir=args.work_dir) as temporary:
        work = Path(temporary)
        snapshots = work / "snapshots"
        snapshots.mkdir()
        control = work / "control"
        (control / ".context").mkdir(parents=True)
        settings = manifest["protocol"]
        config = {key: settings[key] for key in ["maxFiles", "maxLinesPerFile", "maxFileSize", "graphDepth", "tokenizer"]}
        config.update({"version": "0.3.1", "budgetTokens": 32000, "includeLanguages": []})
        (control / ".context/config.json").write_text(json.dumps(config))
        environment = environment_for(work, args.index_threads)
        rows = []
        for index, case in enumerate(cases):
            project = projects[case["project"]]
            metadata = {key: project[key] for key in ["language", "framework", "kind"]}
            metadata.update({"project": project["id"], "split": case["split"], "category": case["category"]})
            source = snapshots / case["id"]
            preparation = None
            try:
                if args.archive_cache:
                    archive = args.archive_cache / f"{case['revision']}.tar.gz"
                    if digest(archive) != case["archiveSha256"]:
                        raise ValueError("Cached source archive checksum mismatch")
                else:
                    archive = work / "archives" / f"{case['revision']}.tar.gz"
                    download(project["repository"], case["revision"], archive, case["archiveSha256"])
                extract(archive, source)
                check_labels(case, source)
            except (OSError, ValueError, RuntimeError, tarfile.TarError) as error:
                preparation = str(error)
            if args.action == "fetch":
                if preparation:
                    raise ValueError(preparation)
                print(f"Verified {case['id']}", flush=True)
                shutil.rmtree(source)
                if not args.archive_cache: archive.unlink()
                continue
            binary = args.binary.resolve()
            for budget in args.budgets:
                for method in args.methods:
                    row = {"id": case["id"], "metadata": metadata, "revision": case["revision"],
                        "archiveSha256": case["archiveSha256"], "method": method, "budgetTokens": budget,
                        "timeoutSeconds": args.timeout,
                        "hasSupportingRanges": bool(case.get("supportingRanges")),
                        "hasSupportingFiles": bool(case.get("supportingFiles"))}
                    if preparation:
                        row.update({"status": "preparation_failed", "error": preparation, "wallMs": 0, "peakRssBytes": None})
                    else:
                        dataset = {"projectIsolation": True, "cases": [{
                            "name": case["id"], "root": case["id"], "task": case["task"], "split": case["split"],
                            "metadata": {key: value for key, value in metadata.items() if key != "split"},
                            **{key: [{k: v for k, v in span.items() if k != "sha256"} for span in case.get(key, [])]
                                for key in ["expectedRanges", "supportingRanges"]},
                            **{key: case.get(key, []) for key in ["expectedFiles", "supportingFiles", "forbiddenFiles"]}}]}
                        dataset_path, output = work / "case.json", work / "result.json"
                        dataset_path.write_text(json.dumps(dataset))
                        output.unlink(missing_ok=True)
                        roots = snapshots.resolve()
                        command = [str(binary), "--root", str(control.resolve()), "evaluate", str(dataset_path.resolve()),
                            "--projects", str(roots), "--split", "all", "--method", method, "--budget-tokens", str(budget),
                            "--max-files", str(settings["maxFiles"]), "--tokenizer", settings["tokenizer"], "--output", str(output.resolve())]
                        measurement = measure(command, work, environment, args.timeout)
                        row.update({key: measurement[key] for key in ["wallMs", "peakRssBytes"]})
                        if measurement["returncode"] == 0 and output.exists():
                            result = json.loads(output.read_text())["cases"][0]
                            row.update(result)
                            row["metadata"] = metadata
                            count = result["indexedFiles"]
                            row["sizeClass"] = "small" if count <= 100 else "medium" if count <= 1000 else "large" if count <= 10000 else "very_large"
                            row["status"] = "ok"
                        else:
                            diagnostic = f"Evaluation exceeded {args.timeout:g} seconds" if measurement["timeout"] else measurement["stderr"] or "Evaluation produced no report"
                            row.update({"status": "timeout" if measurement["timeout"] else "evaluation_failed", "error": diagnostic.replace(str(work.resolve()), "[scratch]")})
                    rows.append(row)
            print(f"{index + 1}/{len(cases)} {case['id']}: " + ", ".join(f"{row['method']}:{row['budgetTokens']}={row['status']}" for row in rows[-len(args.methods)*len(args.budgets):]), flush=True)
            if source.exists(): shutil.rmtree(source)
            if not args.archive_cache and "archive" in locals(): archive.unlink(missing_ok=True)
        if args.action == "run":
            if identity != {"corpusHash": digest(args.manifest), "binarySha256": digest(args.binary)}:
                raise ValueError("Corpus or evaluator binary changed during measurement")
            data = report(manifest, rows, identity, {"methods": args.methods, "budgets": args.budgets,
                "split": args.split, "language": args.language, "case": args.case_id, "jobs": 1, "partition": args.partition,
                "timeoutSeconds": args.timeout, "indexThreads": args.index_threads, **config,
                "memoryMeasurement": "Per-child wait4 peak resident set in bytes on Unix; null on platforms without wait4 or for aborted processes."})
            data["host"] = {"platform": platform.platform(), "python": platform.python_version()}
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(data, indent=2) + "\n")
            args.output.with_suffix(".md").write_text(markdown(data))
            print(f"Saved {args.output}")
    return 0


if __name__ == "__main__":
    def terminate(signum, frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, terminate)
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, RuntimeError) as error:
        print(f"Corpus error: {error}", file=sys.stderr)
        raise SystemExit(2)
