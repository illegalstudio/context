#!/usr/bin/env python3
"""Prepare an interactive software release and publish its commit and tag."""

import argparse
from pathlib import Path
import re
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
VERSION = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
OWNED = ("Cargo.toml", "Cargo.lock")


def version_tuple(value):
    if not re.fullmatch(VERSION, value):
        raise ValueError(f"Expected a stable MAJOR.MINOR.PATCH version: {value}")
    return tuple(map(int, value.split(".")))


def run(*args, capture=False):
    result = subprocess.run(args, cwd=ROOT, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def software_version():
    return tomllib.loads((ROOT / "Cargo.toml").read_text())["package"]["version"]


def tags():
    return [tag for tag in run("git", "tag", "--list", capture=True).splitlines()
            if re.fullmatch("v" + VERSION, tag)]


def latest_tag(exclude=None):
    return max((tag for tag in tags() if tag != exclude),
               key=lambda tag: version_tuple(tag[1:]), default=None)


def propose(current, latest):
    current_numbers = version_tuple(current)
    if latest is None or current_numbers > version_tuple(latest[1:]):
        return current
    major, minor, patch = version_tuple(latest[1:])
    return f"{major}.{minor}.{patch + 1}"


def prepare(version):
    version_tuple(version)
    manifest = ROOT / "Cargo.toml"
    text = manifest.read_text()
    pattern = r'(?ms)(^\[package\]\n(?:(?!^\[).)*?^version = ")[^"]+("[ \t]*$)'
    text, count = re.subn(pattern, lambda m: m[1] + version + m[2], text)
    if count != 1:
        raise ValueError("Cannot locate the package version in Cargo.toml")
    lock = ROOT / "Cargo.lock"
    lock_text, count = re.subn(r'(?m)(^name = "context-cli"\nversion = ")[^"]+("$)',
                              lambda m: m[1] + version + m[2], lock.read_text())
    if count != 1:
        raise ValueError("Cannot locate the Context package in Cargo.lock")
    manifest.write_text(text)
    lock.write_text(lock_text)


def check_tag(tag):
    if not re.fullmatch("v" + VERSION, tag):
        raise ValueError("Release tags must be vMAJOR.MINOR.PATCH without prerelease labels")
    if tag[1:] != software_version():
        raise ValueError("The release tag differs from the Cargo software version")
    lock = tomllib.loads((ROOT / "Cargo.lock").read_text())
    if next(p["version"] for p in lock["package"] if p["name"] == "context-cli") != tag[1:]:
        raise ValueError("Cargo.lock differs from the release tag")
    if run("git", "cat-file", "-t", tag, capture=True) != "tag":
        raise ValueError("Release tags must be annotated")
    if run("git", "rev-parse", f"{tag}^{{commit}}", capture=True) != run("git", "rev-parse", "HEAD", capture=True):
        raise ValueError("The checkout does not match the exact release tag")
    previous = latest_tag(exclude=tag)
    if previous and version_tuple(previous[1:]) >= version_tuple(tag[1:]):
        raise ValueError("Cannot publish an older version than an existing release tag")
    print(tag[1:])


def release(args):
    if run("git", "status", "--porcelain", capture=True):
        raise ValueError("Working tree is dirty. Commit or stash changes before make release.")
    if run("git", "branch", "--show-current", capture=True) != "main":
        raise ValueError("Run make release from the main branch")
    if not args.dry_run:
        run("git", "fetch", "origin", "main", "--tags")
    remote = run("git", "ls-remote", "origin", "refs/heads/main", "refs/tags/v*", capture=True)
    remote_refs = dict(line.split()[::-1] for line in remote.splitlines())
    if "refs/heads/main" not in remote_refs:
        raise ValueError("origin must have a main branch")
    run("git", "merge-base", "--is-ancestor", remote_refs["refs/heads/main"], "HEAD")
    all_tags = set(tags()) | {ref.removeprefix("refs/tags/") for ref in remote_refs
                            if re.fullmatch("refs/tags/v" + VERSION, ref)}
    previous = max(all_tags, key=lambda tag: version_tuple(tag[1:]), default=None)
    proposed = propose(software_version(), previous)
    version = args.version or (proposed if args.dry_run else input(f"Software version [{proposed}]: ").strip().removeprefix("v") or proposed)
    version_tuple(version)
    tag = f"v{version}"
    if tag in all_tags:
        raise ValueError(f"Tag already exists: {tag}")
    if previous and version_tuple(version) <= version_tuple(previous[1:]):
        raise ValueError(f"The software version must be greater than {previous}")
    if version_tuple(version) < version_tuple(software_version()):
        raise ValueError("The software version cannot decrease")
    print(f"Software release: {tag}")
    print("Preparation files: Cargo.toml, Cargo.lock")
    print("Publish: release commit and annotated tag to origin/main (one atomic push)")
    if args.dry_run:
        return
    # All preparation files were clean on entry. Restore them if checks fail or the user cancels.
    original = {name: (ROOT / name).read_bytes() for name in OWNED}
    committed = False
    try:
        prepare(version)
        run("make", "check")
        changed = run("git", "diff", "--name-only", capture=True).splitlines()
        if not set(changed).issubset(OWNED) or run("git", "ls-files", "--others", "--exclude-standard", capture=True):
            raise ValueError("Checks changed files outside release preparation; review them before releasing")
        run("git", "diff", "--stat")
        if input(f"Commit, tag and publish {tag}? [y/N]: ").strip().lower() not in ("y", "yes"):
            print("Release cancelled; preparation files restored.")
            return
        if changed:
            run("git", "add", "--", *changed)
            run("git", "commit", "-m", f"Prepare release {tag}")
            committed = True
        run("git", "tag", "-a", tag, "-m", f"Release {tag}")
        committed = True
        try:
            run("git", "push", "--atomic", "origin", "HEAD:refs/heads/main", f"refs/tags/{tag}")
        except subprocess.CalledProcessError:
            print(f"Push failed. The local release commit/tag are retained. Resolve the cause, then retry:\n"
                  f"git push --atomic origin HEAD:refs/heads/main refs/tags/{tag}", file=sys.stderr)
            raise
        print(f"Release builds started: https://github.com/illegalstudio/context/actions")
    finally:
        if not committed:
            for name, content in original.items():
                (ROOT / name).write_bytes(content)
            # Unstage only the owned files if preparation failed before a successful commit.
            run("git", "reset", "--quiet", "HEAD", "--", *OWNED)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Software version; still requires final confirmation")
    parser.add_argument("--dry-run", action="store_true", help="Show the proposed release without modifying files, refs or the remote")
    parser.add_argument("--check-tag", help="CI: validate the checked-out release tag only")
    args = parser.parse_args()
    if args.check_tag:
        check_tag(args.check_tag)
    elif not sys.stdin.isatty() and not args.dry_run:
        raise ValueError("make release is interactive; use --dry-run to preview it")
    else:
        release(args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print("Release cancelled.", file=sys.stderr)
        sys.exit(1)
