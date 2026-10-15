#!/usr/bin/env python3
"""Prepare pinned Arch recipes and verify their relationship to upstream binaries."""

import argparse
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

from release import ROOT, version_tuple
from release_assets import check_package

ARCHES = {"x86_64": "amd64", "aarch64": "arm64"}


def names(version, arch):
    version_tuple(version)
    label = ARCHES[arch]
    return f"context_{version}_linux_{label}.tar.gz", f"context-{version}-1-{arch}.pkg.tar.zst"


def source_digest(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.with_name(path.name + ".sha256").read_text() != f"{digest}  {path.name}\n":
        raise ValueError(f"Upstream package SHA-256 mismatch: {path.name}")
    return digest


def prepare(directory, destination, version, arch):
    source, _ = names(version, arch)
    path = directory / source
    check_package(path)
    digest = source_digest(path)
    template = (ROOT / "packaging/arch/PKGBUILD.in").read_text()
    replacements = {"VERSION": version, "ARCH": arch, "SOURCE": source,
                    "DIRECTORY": source.removesuffix(".tar.gz"), "SHA256": digest}
    for key, value in replacements.items():
        template = template.replace(f"@{key}@", value)
    if re.search(r"@[A-Z]+@", template):
        raise ValueError("Unresolved Arch recipe template value")
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "PKGBUILD").write_text(template)
    # makepkg uses this checked cache instead of downloading a not-yet-public asset.
    if path.resolve() != (destination / source).resolve():
        shutil.copyfile(path, destination / source)
        shutil.copyfile(path.with_name(source + ".sha256"), destination / (source + ".sha256"))
    return destination / "PKGBUILD"


def pkginfo(text):
    fields = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        if " = " not in line:
            raise ValueError("Malformed .PKGINFO line")
        key, value = line.split(" = ", 1)
        fields.setdefault(key, []).append(value)
    return fields


def validate_metadata(fields, version, arch):
    for key, value in {"pkgname": "context", "pkgver": f"{version}-1", "arch": arch,
                       "url": "https://github.com/illegalstudio/context"}.items():
        if fields.get(key) != [value]:
            raise ValueError(f"Unexpected Arch package {key}")
    if "MIT" not in fields.get("license", []) or not {"glibc>=2.35", "gcc-libs"}.issubset(fields.get("depend", [])):
        raise ValueError("Missing Arch package licensing or runtime dependencies")


def archive_output(path, *args):
    return subprocess.check_output(["bsdtar", args[0], "-f", str(path), *args[1:]])


def check(directory, version, arch):
    source_name, package_name = names(version, arch)
    source = directory / source_name
    path = directory / package_name
    check_package(source)
    source_digest(source)
    if path.read_bytes()[:4] != bytes.fromhex("28b52ffd"):
        raise ValueError("Arch packages must use Zstandard compression")
    validate_metadata(pkginfo(archive_output(path, "-xO", ".PKGINFO").decode()), version, arch)
    members = archive_output(path, "-t").decode().splitlines()
    if any(line[:1] not in ("-", "d") for line in archive_output(path, "-tv").decode().splitlines()):
        raise ValueError("Arch packages may contain only regular files and directories")
    if len(members) != len(set(members)):
        raise ValueError("Duplicate Arch package member")
    for name in members:
        if name.startswith("/") or "\\" in name or any(part in ("", ".", "..") for part in name.removesuffix("/").split("/")):
            raise ValueError(f"Unsafe Arch package path: {name}")
    upstream = source_name.removesuffix(".tar.gz")
    installed = {}
    with tarfile.open(source, "r:gz") as archive:
        for member in archive.getmembers():
            relative = member.name.removeprefix(upstream + "/")
            destination = ("usr/bin/context" if relative == "context" else
                           "usr/share/licenses/context/LICENSE" if relative == "LICENSE" else
                           "usr/share/doc/context/" + relative)
            installed[destination] = relative
            if destination not in members:
                raise ValueError(f"Missing Arch package resource: {relative}")
            if archive_output(path, "-xO", destination) != archive.extractfile(member).read():
                raise ValueError(f"Arch package changed upstream bytes: {relative}")
    directories = {name.rstrip("/") for name in members if name.endswith("/")}
    expected_directories = {"/".join(name.split("/")[:i]) for name in installed for i in range(1, len(name.split("/")))}
    allowed = set(installed) | {".PKGINFO", ".BUILDINFO", ".MTREE"} | {name + "/" for name in expected_directories}
    if not set(members).issubset(allowed) or not directories.issubset(expected_directories):
        raise ValueError("Unexpected Arch package resources")
    mode = archive_output(path, "-tv", "usr/bin/context").decode().split()[0]
    if mode != "-rwxr-xr-x":
        raise ValueError("The Arch executable must be a regular file with mode 0755")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return package_name, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "check"))
    parser.add_argument("--version", required=True)
    parser.add_argument("--arch", choices=ARCHES, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args()
    if args.mode == "prepare":
        if args.destination is None:
            raise ValueError("prepare requires --destination")
        print(prepare(args.directory, args.destination, args.version, args.arch))
    else:
        name, digest = check(args.directory, args.version, args.arch)
        (args.directory / (name + ".sha256")).write_text(f"{digest}  {name}\n")
        print(f"Validated {name}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
