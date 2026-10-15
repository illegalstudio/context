#!/usr/bin/env python3
"""Package a built binary with documentation, license notices and a checksum."""

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "x86_64-unknown-linux-gnu": ("linux", "amd64", ".tar.gz"),
    "aarch64-unknown-linux-gnu": ("linux", "arm64", ".tar.gz"),
    "aarch64-apple-darwin": ("darwin", "arm64", ".zip"),
}


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True)


def license_files(package):
    base = Path(package["manifest_path"]).parent
    paths = []
    for child in sorted(base.iterdir()):
        if child.name.lower().startswith(("license", "copying", "notice")):
            paths.extend(sorted(child.rglob("*")) if child.is_dir() else [child])
    if package.get("license_file"):
        paths.append(base / package["license_file"])
    return [(path.relative_to(base).as_posix(), path.read_bytes()) for path in paths if path.is_file()]


def notices(metadata, members):
    lines = ["# Third-party notices", "", "This package preserves notices for the resolved Rust dependencies, including build-time components. Their licenses remain separate from Context's MIT License.", ""]
    packages = sorted(metadata["packages"], key=lambda p: (p["name"], p["version"]))
    for package in packages:
        if package["id"] in metadata["workspace_members"]:
            continue
        files = license_files(package)
        source_note = ""
        if not files and package.get("repository"):
            peer = next((p for p in packages if p["repository"] == package["repository"] and p["license"] == package["license"] and license_files(p)), None)
            if peer:
                files = license_files(peer)
                source_note = f" (shared repository notice from {peer['name']})"
        if not files:
            provenance = json.loads((ROOT / "licenses/provenance.json").read_bytes())
            if package["name"] in provenance:
                origin = provenance[package["name"]]
                base = Path(package["manifest_path"]).parent
                commit = json.loads((base / ".cargo_vcs_info.json").read_bytes())["git"]["sha1"]
                content = (ROOT / "licenses" / package["name"] / "LICENSE").read_bytes()
                if (origin["version"] != package["version"] or origin["commit"] != commit
                        or origin["sha256"] != hashlib.sha256(content).hexdigest()):
                    raise ValueError(f"Refresh the upstream license provenance for {package['name']}")
                files = [("LICENSE", content)]
                source_note = f" (upstream notice: {origin['url']})"
        if not files:
            raise ValueError(f"Missing license notices for {package['name']} {package['version']}")
        destination = f"licenses/{package['name']}-{package['version']}"
        links = []
        for name, content in files:
            path = f"{destination}/{name}"
            members[path] = content
            links.append(f"[{name}]({path})")
        lines.append(f"- `{package['name']} {package['version']}`: {package['license']}; {', '.join(links)}{source_note}")
    sysroot = Path(run("rustc", "--print", "sysroot").strip())
    copyright_path = sysroot / "share/doc/rust/COPYRIGHT-library.html"
    if not copyright_path.is_file():
        raise ValueError("Rust standard-library notices are missing; install the rust-docs component before packaging")
    members["licenses/rust/COPYRIGHT-library.html"] = copyright_path.read_bytes()
    lines.extend(["", "The Rust standard library's upstream notices are included in [COPYRIGHT-library.html](licenses/rust/COPYRIGHT-library.html).", "SQLite is public domain; its included [copyright notice](licenses/sqlite/NOTICE.txt) applies separately.", ""])
    members["THIRD_PARTY_NOTICES.md"] = "\n".join(lines).encode()


def archive_bytes(name, members, use_zip):
    buffer = io.BytesIO()
    if use_zip:
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, content in sorted(members.items()):
                info = zipfile.ZipInfo(f"{name}/{path}")
                info.create_system = 3
                info.external_attr = (0o100755 if path == "context" else 0o100644) << 16
                archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED)
    else:
        with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for path, content in sorted(members.items()):
                    info = tarfile.TarInfo(f"{name}/{path}")
                    info.size = len(content)
                    info.mode = 0o755 if path == "context" else 0o644
                    archive.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=TARGETS, required=True)
    parser.add_argument("--binary", type=Path)
    args = parser.parse_args()
    host = next(line.removeprefix("host: ") for line in run("rustc", "-vV").splitlines() if line.startswith("host: "))
    if args.binary is None and host != args.target:
        raise ValueError("A non-host target requires an explicit --binary path")
    system, arch, extension = TARGETS[args.target]
    executable = "context"
    binary = args.binary or ROOT / "target/release" / executable
    metadata = json.loads(run("cargo", "metadata", "--locked", "--filter-platform", args.target, "--format-version", "1"))
    package = next(p for p in metadata["packages"] if p["id"] == metadata["resolve"]["root"])
    name = f"context_{package['version']}_{system}_{arch}"
    members = {executable: binary.read_bytes(), "LICENSE": (ROOT / "LICENSE").read_bytes(), "COMMANDS.md": (ROOT / "docs/commands.md").read_bytes(), "Cargo.lock": (ROOT / "Cargo.lock").read_bytes(), "licenses/sqlite/NOTICE.txt": (ROOT / "licenses/sqlite/NOTICE.txt").read_bytes()}
    notices(metadata, members)
    content = archive_bytes(name, members, extension == ".zip")
    destination = ROOT / "dist" / (name + extension)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    destination.with_name(destination.name + ".sha256").write_text(f"{hashlib.sha256(content).hexdigest()}  {destination.name}\n")
    print(destination.relative_to(ROOT))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
