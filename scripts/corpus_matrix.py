"""Run isolated language partitions with bounded concurrency and deterministic merging."""
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time

from corpus_io import digest
from corpus_report import report, markdown


def run_matrix(args, manifest):
    identity = {"corpusHash": digest(args.manifest), "binarySha256": digest(args.binary)}
    if args.work_dir:
        args.work_dir.mkdir(parents=True, exist_ok=True)
    projects = {project["id"]: project for project in manifest["projects"]}
    cases = [case for case in manifest["cases"] if (args.split == "all" or case["split"] == args.split)
        and (args.language is None or projects[case["project"]]["language"] == args.language)
        and (args.case_id is None or case["id"] == args.case_id)]
    if args.partition == "case":
        units = {f"case-{index:03}": ["--case", case["id"]] for index, case in enumerate(cases)}
    else:
        units = {language: ["--language", language] for language in sorted({projects[case["project"]]["language"] for case in cases})}
    with tempfile.TemporaryDirectory(prefix="context-corpus-matrix-", dir=args.work_dir) as temporary:
        root = Path(temporary)
        active = {}
        completed = {}
        pending = list(units)
        try:
            while pending or active:
                while pending and len(active) < args.jobs:
                    language = pending.pop(0)
                    output = root / f"{language}.json"
                    command = [sys.executable, str(Path(__file__).with_name("corpus.py").resolve()), "run",
                        "--manifest", str(args.manifest.resolve()), "--binary", str(args.binary.resolve()),
                        "--split", args.split, *units[language], "--budgets", *map(str,args.budgets),
                        "--methods", *args.methods, "--output", str(output.resolve()),
                        "--work-dir", str((root / language).resolve()), "--timeout", str(args.timeout),
                        "--index-threads", str(args.index_threads)]
                    if args.archive_cache:
                        command += ["--archive-cache", str(args.archive_cache.resolve())]
                    log = (root / f"{language}.log").open("wb")
                    process = subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True)
                    active[language] = (process, log, output)
                    print(f"Started {language}", flush=True)
                for language, (process, log, output) in list(active.items()):
                    if process.poll() is None:
                        continue
                    log.close()
                    if process.returncode != 0 or not output.is_file():
                        raise RuntimeError(f"Partition {language} failed: {(root / (language+'.log')).read_text()[-2000:]}")
                    completed[language] = json.loads(output.read_text())
                    del active[language]
                    print(f"Completed {language}: {len(completed[language]['cases'])} measurements", flush=True)
                time.sleep(0.1)
        finally:
            for process, log, output in active.values():
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                log.close()
        rows = [row for language in units for row in completed[language]["cases"]]
        order = {case["id"]: index for index, case in enumerate(manifest["cases"])}
        rows.sort(key=lambda row:(order[row["id"]],args.budgets.index(row["budgetTokens"]),args.methods.index(row["method"])))
        first = completed[next(iter(units))]
        for part in completed.values():
            if part["corpusHash"] != identity["corpusHash"] or part["binarySha256"] != identity["binarySha256"]:
                raise ValueError("Partitions used different corpus or evaluator binaries")
        settings = {**first["settings"], "jobs": args.jobs, "partition": args.partition, "language": args.language,
            "case": args.case_id, "timeoutSeconds": args.timeout}
        if identity != {"corpusHash": digest(args.manifest), "binarySha256": digest(args.binary)}:
            raise ValueError("Corpus or evaluator binary changed during measurement")
        data = report(manifest, rows, identity, settings)
        data["host"] = {"platform": platform.platform(), "python": platform.python_version()}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(data, indent=2)+"\n")
        args.output.with_suffix(".md").write_text(markdown(data))
        print(f"Saved {args.output}: {len(rows)} measurements", flush=True)
    return 0
