import concurrent.futures
import copy
import hashlib
import io
import json
import os
import subprocess
from pathlib import Path
import sys
import tarfile
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import corpus
import corpus_io
import corpus_report


class CorpusTests(unittest.TestCase):
    def manifest(self):
        return json.loads((Path(__file__).resolve().parents[1] / "benchmarks/corpus.json").read_text())

    def test_corpus_has_disjoint_project_pairs_and_real_history(self):
        manifest = self.manifest()
        corpus_io.validate(manifest)
        self.assertEqual(len(manifest["projects"]), 16)
        self.assertEqual(len(manifest["cases"]), 80)
        languages = {project["language"] for project in manifest["projects"]}
        self.assertEqual(len(languages), 8)
        for language in languages:
            projects = [project for project in manifest["projects"] if project["language"] == language]
            self.assertEqual({project["split"] for project in projects}, {"train", "eval"})
            for project in projects:
                self.assertEqual(sum(case["project"] == project["id"] for case in manifest["cases"]), 5)
        for case in manifest["cases"]:
            self.assertNotEqual(case["revision"], case["fixCommit"])
            self.assertTrue(case["review"]["evidenceUrl"].endswith(case["fixCommit"]))
            self.assertTrue(case["forbiddenFiles"])

    def test_validation_rejects_aliases_cross_split_and_invalid_labels(self):
        original = self.manifest()
        for change in [
            lambda manifest: manifest["projects"].append({**manifest["projects"][0], "id": "alias"}),
            lambda manifest: manifest["cases"][0].update(split="eval"),
            lambda manifest: manifest["cases"][0].update(archiveSha256="latest"),
            lambda manifest: manifest["cases"][0].update(forbiddenFiles=manifest["cases"][0]["expectedFiles"]),
            lambda manifest: manifest["cases"][0].update(expectedRanges=[{"path": "../escape", "start": 1, "end": 2, "sha256": "0"*64}]),
            lambda manifest: manifest["cases"][0].update(review={"status": "draft"}),
        ]:
            manifest = copy.deepcopy(original)
            change(manifest)
            with self.assertRaises(ValueError):
                corpus_io.validate(manifest)

    def test_domain_probes_use_new_evaluation_repositories(self):
        target = Path(__file__).resolve().parents[1] / "benchmarks/corpus-domains.json"
        domains = json.loads(target.read_text())
        corpus_io.validate(domains)
        self.assertEqual(len(domains["cases"]), 4)
        self.assertEqual({case["category"] for case in domains["cases"]}, {"billing", "notifications"})
        primary = {project["repository"].lower() for project in self.manifest()["projects"]}
        self.assertTrue(primary.isdisjoint(project["repository"].lower() for project in domains["projects"]))
        self.assertEqual({case["split"] for case in domains["cases"]}, {"eval"})

    def test_source_annotations_are_checked_for_content_and_bounds(self):
        with tempfile.TemporaryDirectory(prefix="context-corpus-test-") as temporary:
            root = Path(temporary)
            (root / "app.ts").write_text("first\ncritical\nlast\n")
            span = {"path": "app.ts", "start": 2, "end": 2, "sha256": hashlib.sha256(b"critical").hexdigest()}
            case = {"expectedFiles": ["app.ts"], "expectedRanges": [span]}
            corpus_io.check_labels(case, root)
            (root / "app.ts").write_text("first\nwrong\nlast\n")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                corpus_io.check_labels(case, root)
            span["end"] = 99
            with self.assertRaisesRegex(ValueError, "length"):
                corpus_io.check_labels(case, root)

    def test_validation_repositories_are_disjoint_from_both_previous_suites(self):
        root = Path(__file__).resolve().parents[1]
        fresh = json.loads((root / "benchmarks/corpus-validation.json").read_text())
        corpus_io.validate(fresh)
        previous = self.manifest()["projects"] + json.loads((root / "benchmarks/corpus-domains.json").read_text())["projects"]
        self.assertTrue({p["repository"].lower() for p in previous}.isdisjoint(p["repository"].lower() for p in fresh["projects"]))
        self.assertEqual({case["split"] for case in fresh["cases"]}, {"eval"})

    def test_supporting_file_recall_counts_failed_annotated_cases_as_zero(self):
        rows = [{"status": "ok", "wallMs": 1, "hasSupportingFiles": True, "metrics": {"supportingRecall": 1, "tokens": 1}},
                {"status": "timeout", "wallMs": 1, "hasSupportingFiles": True},
                {"status": "ok", "wallMs": 1, "metrics": {"tokens": 1}}]
        summary = corpus_report.summarize(rows)
        self.assertEqual(summary["supportingFileCases"], 2)
        self.assertEqual(summary["supportingRecall"], 0.5)
        self.assertIsNone(summary["supportingRangeCoverage"])

    def test_callback_validation_preserves_repository_isolation(self):
        root = Path(__file__).resolve().parents[1]
        reserved = json.loads((root / "benchmarks/corpus-callback-validation.json").read_text())
        corpus_io.validate(reserved)
        previous = set()
        for name in ["corpus.json", "corpus-domains.json", "corpus-validation.json"]:
            previous.update(p["repository"].lower() for p in json.loads((root / "benchmarks" / name).read_text())["projects"])
        self.assertTrue(previous.isdisjoint(p["repository"].lower() for p in reserved["projects"]))
        self.assertTrue(all(c["review"]["status"] == "source-reviewed" for c in reserved["cases"]))

    def archive(self, root, entries):
        path = root / "archive.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for name, content, kind in entries:
                info = tarfile.TarInfo(name)
                info.type = kind
                info.size = len(content) if kind == tarfile.REGTYPE else 0
                info.linkname = "../../escape" if kind == tarfile.SYMTYPE else ""
                archive.addfile(info, io.BytesIO(content) if info.size else None)
        return path

    def test_archives_cannot_escape_or_leave_partial_snapshots(self):
        with tempfile.TemporaryDirectory(prefix="context-corpus-test-") as temporary:
            root = Path(temporary)
            archive = self.archive(root, [("source/app.ts", b"code", tarfile.REGTYPE), ("source/../../escape", b"bad", tarfile.REGTYPE)])
            with self.assertRaises(ValueError):
                corpus_io.extract(archive, root / "snapshot")
            self.assertFalse((root / "snapshot").exists())
            self.assertFalse((root / "escape").exists())
            archive = self.archive(root, [("source/link", b"", tarfile.SYMTYPE), ("source/app.ts", b"code", tarfile.REGTYPE)])
            corpus_io.extract(archive, root / "snapshot")
            self.assertFalse((root / "snapshot/link").exists())
            self.assertEqual((root / "snapshot/app.ts").read_bytes(), b"code")
            with self.assertRaises(ValueError):
                corpus_io.extract(archive, root / "snapshot")
            self.assertTrue((root / "snapshot/app.ts").exists())

    def test_concurrent_downloads_of_a_shared_parent_do_not_share_partial_files(self):
        content = b"verified corpus source" * 100
        expected = hashlib.sha256(content).hexdigest()
        barrier = threading.Barrier(2)
        def open_response(*args, **kwargs):
            barrier.wait(timeout=5)
            return io.BytesIO(content)
        with tempfile.TemporaryDirectory(prefix="context-corpus-test-") as temporary:
            path = Path(temporary) / "source.tar.gz"
            with patch("corpus_io.urllib.request.urlopen", side_effect=open_response):
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    jobs = [pool.submit(corpus_io.download, "owner/repo", "1"*40, path, expected) for _ in range(2)]
                    self.assertEqual([job.result() for job in jobs], [expected, expected])
            self.assertEqual(path.read_bytes(), content)
            self.assertEqual(list(Path(temporary).iterdir()), [path])
            with self.assertRaises(ValueError):
                corpus_io.download("owner/repo", "1"*40, path, "0"*64)

    def test_failures_remain_in_quality_denominators(self):
        rows = [{"status": "ok", "wallMs": 20, "peakRssBytes": 100, "metrics": {"recall": 1, "excerptRecall": 1, "rangeCoverage": 1, "completeContext": 1, "tokens": 50}},
            {"status": "evaluation_failed", "wallMs": 10, "peakRssBytes": 80}]
        summary = corpus_report.summarize(rows)
        self.assertEqual(summary["recall"], 0.5)
        self.assertEqual(summary["completeContextRate"], 0.5)
        self.assertEqual(summary["errors"], 1)
        self.assertIsNone(summary["judgedPrecision"])
        self.assertEqual(summary["meanTokensPerSuccessfulCase"], 50)

    def test_measurement_reports_output_memory_and_reaps_timeouts(self):
        with tempfile.TemporaryDirectory(prefix="context-corpus-test-") as temporary:
            root = Path(temporary)
            result = corpus.measure([sys.executable, "-c", "print('done')"], root, os.environ.copy(), 5)
            self.assertEqual(result["returncode"], 0)
            self.assertEqual((root / "stdout").read_text().strip(), "done")
            if hasattr(os, "wait4"):
                self.assertGreater(result["peakRssBytes"], 0)
            result = corpus.measure([sys.executable, "-c", "import time;time.sleep(30)"], root, os.environ.copy(), 0.05)
            self.assertTrue(result["timeout"])
            self.assertNotEqual(result["returncode"], 0)
            self.assertLess(result["wallMs"], 5000)

    def test_snapshots_do_not_inherit_parent_git_history_or_location_overrides(self):
        with tempfile.TemporaryDirectory(prefix="context-corpus-test-") as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            work = root / "owned"
            work.mkdir()
            snapshot = work / "snapshot"
            snapshot.mkdir()
            with patch.dict(os.environ, {"GIT_DIR": str(root / ".git"), "GIT_WORK_TREE": str(root)}):
                environment = corpus.environment_for(work, 2)
            self.assertNotIn("GIT_DIR", environment)
            self.assertNotIn("GIT_WORK_TREE", environment)
            result = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=snapshot, env=environment, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((work / "process-temp").is_dir())

    @unittest.skipUnless(hasattr(os, "killpg"), "Matrix uses Unix process groups")
    def test_matrix_retains_native_failures_and_cleans_owned_scratch(self):
        with tempfile.TemporaryDirectory(prefix="context-corpus-test-") as temporary:
            root = Path(temporary)
            cache, work = root / "cache", root / "work"
            cache.mkdir()
            work.mkdir()
            (work / "preserve").write_text("existing content")
            archive = self.archive(root, [("source/app.ts", b"code\n", tarfile.REGTYPE)])
            manifest = {"version": 1, "protocol": self.manifest()["protocol"], "projects": [], "cases": []}
            for index, language in enumerate(["typescript", "javascript"], 1):
                revision = str(index) * 40
                (cache / f"{revision}.tar.gz").write_bytes(archive.read_bytes())
                project = f"owner/repo{index}"
                manifest["projects"].append({"id": project, "repository": project, "split": "eval", "language": language, "framework": "plain", "kind": "library"})
                manifest["cases"].append({"id": f"case{index}", "project": project, "split": "eval", "category": "api", "task": "code", "revision": revision, "fixCommit": "3"*40,
                    "archiveSha256": corpus_io.digest(archive), "expectedFiles": ["app.ts"],
                    "expectedRanges": [{"path": "app.ts", "start": 1, "end": 1, "sha256": hashlib.sha256(b"code").hexdigest()}], "review": {"status": "source-reviewed"}})
            path, output = root / "manifest.json", root / "report.json"
            path.write_text(json.dumps(manifest))
            command = [sys.executable, str(Path(corpus.__file__)), "run", "--manifest", str(path),
                "--binary", sys.executable, "--archive-cache", str(cache), "--work-dir", str(work),
                "--jobs", "2", "--budgets", "8000", "--output", str(output)]
            result = subprocess.run(command, capture_output=True, text=True, timeout=20,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            data = json.loads(output.read_text())
            self.assertEqual([row["id"] for row in data["cases"]], ["case1", "case1", "case2", "case2"])
            self.assertTrue(all(row["status"] == "evaluation_failed" for row in data["cases"]))
            self.assertEqual(data["runs"]["context:8000"]["summary"]["errors"], 2)
            self.assertEqual(data["runs"]["lexical:8000"]["summary"]["completeContextRate"], 0)
            self.assertIsNone(data["settings"]["case"])
            self.assertEqual(list(work.iterdir()), [work / "preserve"])
            self.assertEqual((work / "preserve").read_text(), "existing content")
            self.assertEqual(len(list(cache.iterdir())), 2)
            result = subprocess.run(command + ["--partition", "case", "--language", "javascript", "--case", "case2"],
                capture_output=True, text=True, timeout=20, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            data = json.loads(output.read_text())
            self.assertEqual([row["id"] for row in data["cases"]], ["case2", "case2"])
            self.assertEqual(data["settings"]["partition"], "case")
            self.assertEqual(list(work.iterdir()), [work / "preserve"])


if __name__ == "__main__":
    unittest.main()
