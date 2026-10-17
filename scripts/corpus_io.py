"""Pinned public-source inputs for the retrieval corpus. No project code is executed."""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import time
import urllib.error
import urllib.request


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def relative(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or "\\" in value or ":" in value:
        raise ValueError(f"Unsafe corpus path: {value!r}")
    return path


def validate(manifest: dict) -> None:
    if manifest.get("version") != 1:
        raise ValueError("Unsupported corpus version")
    projects = {project["id"]: project for project in manifest["projects"]}
    if len(projects) != len(manifest["projects"]):
        raise ValueError("Duplicate project id")
    repositories = set()
    for project in projects.values():
        repo = project["repository"]
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
            raise ValueError(f"Invalid GitHub repository: {repo}")
        canonical = repo.lower()
        if canonical in repositories:
            raise ValueError("A repository may belong to only one project/split")
        repositories.add(canonical)
        if project["split"] not in {"train", "eval"}:
            raise ValueError("Invalid project split")
    names = set()
    for case in manifest["cases"]:
        if case["id"] in names:
            raise ValueError("Duplicate corpus case")
        names.add(case["id"])
        relative(case["id"])
        project = projects[case["project"]]
        if case["split"] != project["split"]:
            raise ValueError("Repository-level split isolation violated")
        for field, pattern in [("revision", r"[a-f0-9]{40}"), ("fixCommit", r"[a-f0-9]{40}"), ("archiveSha256", r"[a-f0-9]{64}")]:
            if not re.fullmatch(pattern, case[field]):
                raise ValueError(f"Invalid {field} for {case['id']}")
        if not case["task"].strip() or not case["expectedFiles"] or not case["expectedRanges"]:
            raise ValueError("Each historical task needs essential files and source ranges")
        positive = set(case["expectedFiles"]) | set(case.get("supportingFiles", []))
        if positive & set(case.get("forbiddenFiles", [])):
            raise ValueError("Positive and forbidden labels overlap")
        for path in positive | set(case.get("forbiddenFiles", [])):
            relative(path)
        for span in case["expectedRanges"] + case.get("supportingRanges", []):
            relative(span["path"])
            if span["path"] not in positive or not 0 < span["start"] <= span["end"]:
                raise ValueError("Invalid essential source range")
            if not re.fullmatch(r"[a-f0-9]{64}", span["sha256"]):
                raise ValueError("Source ranges must have content fingerprints")
        if case.get("review", {}).get("status") != "source-reviewed":
            raise ValueError("Unreviewed case")


def download(repository: str, revision: str, target: Path, expected: str | None) -> str:
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Download requires a public GitHub repository and a full commit")
    if target.exists():
        actual = digest(target)
        if expected is None or actual == expected:
            return actual
        raise ValueError(f"Cached archive checksum mismatch: {target}")
    url = f"https://codeload.github.com/{repository}/tar.gz/{revision}"
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=target.name+".", suffix=".partial", dir=target.parent)
    os.close(descriptor)
    partial = Path(name)
    try:
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "Context-retrieval-benchmark/1"})
                with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
                    total = 0
                    while block := response.read(1024 * 1024):
                        total += len(block)
                        if total > 128 * 1024 * 1024:
                            raise ValueError("Corpus archive exceeds 128 MiB")
                        output.write(block)
                break
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        actual = digest(partial)
        if expected is not None and actual != expected:
            raise ValueError(f"Archive checksum mismatch for {repository}@{revision}")
        partial.replace(target)
        return actual
    finally:
        partial.unlink(missing_ok=True)


def extract(archive: Path, target: Path) -> None:
    if target.exists():
        raise ValueError("Snapshot destination already exists")
    target.mkdir(parents=True)
    try:
        _extract(archive, target)
    except BaseException:
        shutil.rmtree(target)
        raise


def _extract(archive: Path, target: Path) -> None:
    total = 0
    seen = set()
    prefixes = set()
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            path = relative(member.name)
            prefixes.add(path.parts[0])
            if len(prefixes) > 1:
                raise ValueError("Archive contains multiple repository roots")
            if not member.isfile():
                continue
            if len(path.parts) < 2:
                raise ValueError("Archive file has no repository root")
            name = Path(*path.parts[1:])
            if name in seen:
                raise ValueError("Archive contains duplicate file paths")
            seen.add(name)
            total += member.size
            if total > 2 * 1024**3:
                raise ValueError("Expanded corpus snapshot exceeds 2 GiB")
            output = target / name
            output.parent.mkdir(parents=True, exist_ok=True)
            stream = source.extractfile(member)
            if stream is None:
                raise ValueError("Cannot read archive file")
            with stream, output.open("wb") as destination:
                shutil.copyfileobj(stream, destination)


def check_labels(case: dict, root: Path) -> None:
    for path in case["expectedFiles"] + case.get("supportingFiles", []) + case.get("forbiddenFiles", []):
        source = root / relative(path)
        if not source.is_file():
            raise ValueError(f"Annotation source is missing: {path}")
    for span in case["expectedRanges"] + case.get("supportingRanges", []):
        lines = (root / span["path"]).read_text(encoding="utf-8").splitlines()
        if span["end"] > len(lines):
            raise ValueError("Annotation exceeds source length")
        content = "\n".join(lines[span["start"] - 1:span["end"]]).encode()
        if hashlib.sha256(content).hexdigest() != span["sha256"]:
            raise ValueError("Essential source range fingerprint mismatch")
