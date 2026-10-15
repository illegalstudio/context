#!/usr/bin/env python3
"""Validate final packages, collect checksums and render the Homebrew formula."""

import argparse
import hashlib
from pathlib import Path
import re
import sys
import tarfile
import zipfile

from package import TARGETS
from release import version_tuple

REPOSITORY = "illegalstudio/context"


def asset_names(version):
    version_tuple(version)
    return [f"context_{version}_{system}_{arch}{extension}"
            for system, arch, extension in TARGETS.values()]


def check_binary(data, filename):
    if "_darwin_" in filename:
        if data[:4] != bytes.fromhex("cffaedfe") or data[4:8] != bytes.fromhex("0c000001"):
            raise ValueError(f"Package does not contain a macOS ARM64 executable: {filename}")
    else:
        machine = 183 if "_arm64" in filename else 62
        if (data[:6] != b"\x7fELF\x02\x01" or len(data) < 20
                or int.from_bytes(data[18:20], "little") != machine):
            raise ValueError(f"Package does not contain the expected Linux executable: {filename}")


def check_package(path):
    name = path.name.removesuffix(".tar.gz").removesuffix(".zip")
    required = {"context", "LICENSE", "COMMANDS.md", "Cargo.lock", "THIRD_PARTY_NOTICES.md",
                "licenses/sqlite/NOTICE.txt", "licenses/rust/COPYRIGHT-library.html"}
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if any(entry.external_attr >> 16 & 0o170000 != 0o100000 for entry in archive.infolist()):
                raise ValueError("Packages may contain only regular files")
            binary = archive.read(f"{name}/context")
            if archive.getinfo(f"{name}/context").external_attr >> 16 & 0o111 != 0o111:
                raise ValueError("The packaged executable has lost its execute permissions")
            if archive.testzip() is not None:
                raise ValueError("Package ZIP CRC check failed")
    else:
        with tarfile.open(path, "r:gz") as archive:
            members = archive.getmembers()
            if any(not member.isfile() for member in members):
                raise ValueError("Packages may contain only regular files")
            names = [member.name for member in members]
            member = archive.getmember(f"{name}/context")
            if member.mode & 0o111 != 0o111:
                raise ValueError("The packaged executable has lost its execute permissions")
            binary = archive.extractfile(member).read()
    if len(names) != len(set(names)):
        raise ValueError("Duplicate package member")
    for entry in names:
        if not entry.startswith(name + "/") or any(part in ("", ".", "..") for part in entry.split("/")) or "\\" in entry:
            raise ValueError(f"Unsafe package member: {entry}")
    if not {f"{name}/{entry}" for entry in required}.issubset(names):
        raise ValueError(f"Missing required binary documentation or notices: {path.name}")
    check_binary(binary, path.name)


def checksums(directory, version):
    expected = asset_names(version)
    actual = {path.name for path in directory.iterdir() if path.name.endswith((".tar.gz", ".zip"))}
    if actual != set(expected):
        raise ValueError(f"Expected exactly these three packages: {', '.join(expected)}")
    results = {}
    for name in sorted(expected):
        path = directory / name
        check_package(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        line = f"{digest}  {name}\n"
        if path.with_name(name + ".sha256").read_text() != line:
            raise ValueError(f"Checksum mismatch: {name}")
        results[name] = digest
    return results


def pacman_checksums(directory, version):
    from pacman_package import ARCHES, check, names
    expected = {names(version, arch)[1] for arch in ARCHES}
    actual = {path.name for path in directory.glob("*.pkg.tar.*") if not path.name.endswith(".sha256")}
    if actual != expected:
        raise ValueError("Expected exactly the x86_64 and aarch64 pacman packages")
    results = {}
    for arch in ARCHES:
        name, digest = check(directory, version, arch)
        if (directory / (name + ".sha256")).read_text() != f"{digest}  {name}\n":
            raise ValueError(f"Pacman package checksum mismatch: {name}")
        results[name] = digest
    return dict(sorted(results.items()))


def formula(version, digests):
    if set(digests) != set(asset_names(version)) or any(not re.fullmatch(r"[a-f0-9]{64}", value) for value in digests.values()):
        raise ValueError("Formula requires all three SHA-256 package digests")
    base = f"https://github.com/{REPOSITORY}/releases/download/v{version}/context_{version}"
    return f'''class Context < Formula
  desc "Deterministic, explainable context packs for coding tasks"
  homepage "https://github.com/illegalstudio/context"
  version "{version}"
  license "MIT"

  on_macos do
    depends_on arch: :arm64
    depends_on macos: :big_sur
    url "{base}_darwin_arm64.zip"
    sha256 "{digests[f'context_{version}_darwin_arm64.zip']}"
  end

  on_linux do
    on_arm do
      url "{base}_linux_arm64.tar.gz"
      sha256 "{digests[f'context_{version}_linux_arm64.tar.gz']}"
    end
    on_intel do
      url "{base}_linux_amd64.tar.gz"
      sha256 "{digests[f'context_{version}_linux_amd64.tar.gz']}"
    end
  end

  def install
    bin.install "context"
    pkgshare.install "LICENSE", "COMMANDS.md", "Cargo.lock", "THIRD_PARTY_NOTICES.md", "licenses"
  end

  test do
    assert_match "{version}", shell_output("#{{bin}}/context --version")
    assert_match "pack", shell_output("#{{bin}}/context --help")
    system "#{{bin}}/context", "index", "--json"
    system "#{{bin}}/context", "pack", "--task", "Test installation", "--json"
  end
end
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--formula", type=Path)
    parser.add_argument("--pacman", action="store_true", help="Also require both native Arch packages")
    args = parser.parse_args()
    digests = checksums(args.directory, args.version)
    combined = args.directory / f"context_{args.version}_checksums.txt"
    content = "".join(f"{digest}  {name}\n" for name, digest in digests.items())
    if combined.exists() and combined.read_text() != content:
        raise ValueError("The existing combined checksums do not match the final packages")
    combined.write_text(content)
    if args.pacman:
        arch = pacman_checksums(args.directory, args.version)
        combined = args.directory / f"context_{args.version}_pacman_checksums.txt"
        content = "".join(f"{digest}  {name}\n" for name, digest in arch.items())
        if combined.exists() and combined.read_text() != content:
            raise ValueError("The existing pacman checksums do not match the final packages")
        combined.write_text(content)
    if args.formula:
        args.formula.parent.mkdir(parents=True, exist_ok=True)
        args.formula.write_text(formula(args.version, digests))
    print(f"Validated {'five' if args.pacman else 'three'} packages for {args.version}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, tarfile.TarError, zipfile.BadZipFile) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
