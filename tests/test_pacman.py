"""Check Arch recipes, package identity and complete release publication."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / "scripts"))
import package
import pacman_package
import publish_release
import release_assets


class ArchPackaging(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="context-pacman-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in release_assets.asset_names("1.0.0"):
            binary = bytearray(32)
            if "_darwin_" in name:
                binary[:8] = bytes.fromhex("cffaedfe0c000001")
            else:
                binary[:6] = b"\x7fELF\x02\x01"
                binary[18:20] = (183 if "_arm64" in name else 62).to_bytes(2, "little")
            members = {"context": bytes(binary), "LICENSE": b"MIT\n", "COMMANDS.md": b"Commands\n",
                       "Cargo.lock": b"Locked\n", "THIRD_PARTY_NOTICES.md": b"Notices\n",
                       "licenses/sqlite/NOTICE.txt": b"Public domain\n",
                       "licenses/rust/COPYRIGHT-library.html": b"Rust notices\n"}
            content = package.archive_bytes(name.removesuffix(".tar.gz").removesuffix(".zip"), members, name.endswith(".zip"))
            (self.root / name).write_bytes(content)
            (self.root / (name + ".sha256")).write_text(f"{hashlib.sha256(content).hexdigest()}  {name}\n")

    def test_recipe_pins_each_architecture_and_source_digest(self):
        for arch in pacman_package.ARCHES:
            destination = self.root / arch
            recipe = pacman_package.prepare(self.root, destination, "1.0.0", arch).read_text()
            source, native = pacman_package.names("1.0.0", arch)
            self.assertIn(f"arch=('{arch}')", recipe)
            self.assertIn("pkgver=1.0.0", recipe)
            self.assertIn("pkgrel=1", recipe)
            self.assertIn(f"sha256sums=('{hashlib.sha256((self.root / source).read_bytes()).hexdigest()}')", recipe)
            self.assertIn("options=('!strip' '!debug')", recipe)
            self.assertNotIn("SKIP", recipe)
            self.assertNotIn("@VERSION@", recipe)
            self.assertEqual((destination / source).read_bytes(), (self.root / source).read_bytes())
            self.assertEqual(native, f"context-1.0.0-1-{arch}.pkg.tar.zst")

    def test_bad_upstream_digest_does_not_generate_a_recipe(self):
        source, _ = pacman_package.names("1.0.0", "x86_64")
        (self.root / (source + ".sha256")).write_text("Corrupt\n")
        destination = self.root / "recipe"
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            pacman_package.prepare(self.root, destination, "1.0.0", "x86_64")
        self.assertFalse(destination.exists())

    def metadata(self):
        return pacman_package.pkginfo("# generated\npkgname = context\npkgver = 1.0.0-1\n"
                                     "arch = aarch64\nurl = https://github.com/illegalstudio/context\n"
                                     "license = MIT\ndepend = glibc>=2.35\ndepend = gcc-libs\n")

    def test_package_identity_comes_from_metadata(self):
        fields = self.metadata()
        pacman_package.validate_metadata(fields, "1.0.0", "aarch64")
        for key, value in (("pkgname", "other"), ("pkgver", "1.0.1-1"), ("arch", "x86_64")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                pacman_package.validate_metadata(fields | {key: [value]}, "1.0.0", "aarch64")

    def test_duplicate_identity_or_missing_runtime_dependency_fails(self):
        fields = self.metadata()
        with self.assertRaises(ValueError):
            pacman_package.validate_metadata(fields | {"pkgname": ["context", "context"]}, "1.0.0", "aarch64")
        with self.assertRaises(ValueError):
            pacman_package.validate_metadata(fields | {"depend": ["glibc>=2.35"]}, "1.0.0", "aarch64")
        with self.assertRaises(ValueError):
            pacman_package.pkginfo("arch=aarch64\n")

    def arch_files(self):
        digests = {}
        for arch in pacman_package.ARCHES:
            _, name = pacman_package.names("1.0.0", arch)
            data = f"Checked Arch fixture {arch}\n".encode()
            (self.root / name).write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            (self.root / (name + ".sha256")).write_text(f"{digest}  {name}\n")
            digests[name] = digest
        return dict(sorted(digests.items()))

    def test_missing_architecture_is_not_accepted(self):
        self.arch_files()
        (self.root / "context-1.0.0-1-aarch64.pkg.tar.zst").unlink()
        with self.assertRaisesRegex(ValueError, "exactly"):
            release_assets.pacman_checksums(self.root, "1.0.0")

    def test_pacman_sidecars_must_match_checked_native_bytes(self):
        digests = self.arch_files()
        (self.root / "context-1.0.0-1-aarch64.pkg.tar.zst.sha256").write_text("Corrupt\n")
        def checked(directory, version, arch):
            name = pacman_package.names(version, arch)[1]
            return name, digests[name]
        with patch.object(pacman_package, "check", side_effect=checked), self.assertRaisesRegex(ValueError, "checksum mismatch"):
            release_assets.pacman_checksums(self.root, "1.0.0")

    def test_complete_publication_handles_draft_tag_endpoint_404(self):
        native = self.arch_files()
        portable = release_assets.checksums(self.root, "1.0.0")
        for suffix, digests in (("checksums", portable), ("pacman_checksums", native)):
            (self.root / f"context_1.0.0_{suffix}.txt").write_text("".join(f"{digest}  {name}\n" for name, digest in digests.items()))
        files = [*portable, *native, *(name + ".sha256" for name in [*portable, *native]),
                 "context_1.0.0_checksums.txt", "context_1.0.0_pacman_checksums.txt"]
        draft = None
        commands = []

        def github(command, **kwargs):
            nonlocal draft
            self.assertEqual(command[0], "gh")
            args = tuple(command[1:])
            commands.append(args)
            response = ""
            if args == ("api", "repos/illegalstudio/context/git/ref/tags/v1.0.0"):
                response = json.dumps({"object": {"type": "tag", "sha": "b" * 40}})
            elif args == ("api", "repos/illegalstudio/context/git/tags/" + "b" * 40):
                response = json.dumps({"object": {"type": "commit", "sha": "a" * 40}})
            elif args == ("api", "repos/illegalstudio/context/releases/tags/v1.0.0"):
                return subprocess.CompletedProcess(command, 1, "", "gh: Not Found (HTTP 404)")
            elif args == ("api", "repos/illegalstudio/context/releases?per_page=100", "--paginate", "--slurp"):
                response = json.dumps([[draft] if draft else []])
            elif args[:2] == ("release", "create"):
                self.assertIsNone(draft)
                self.assertIn("--draft", args)
                draft = {"draft": True, "prerelease": False, "tag_name": "v1.0.0",
                         "target_commitish": "a" * 40, "assets": []}
            elif args[:2] == ("release", "upload"):
                self.assertTrue(draft["draft"])
                self.assertEqual(set(args[6:]), {str(self.root / name) for name in files})
                draft["assets"] = [{"name": name, "size": (self.root / name).stat().st_size,
                                    "digest": "sha256:" + hashlib.sha256((self.root / name).read_bytes()).hexdigest()}
                                   for name in files]
            elif args[:2] == ("release", "edit"):
                self.assertEqual(len(draft["assets"]), 12)
                self.assertIn("--draft=false", args)
                draft["draft"] = False
            else:
                self.fail(f"Unexpected GitHub command: {args}")
            return subprocess.CompletedProcess(command, 0, response, "")

        with patch.object(publish_release.subprocess, "run", side_effect=github), \
                patch.object(publish_release, "pacman_checksums", return_value=native):
            publish_release.publish("v1.0.0", "a" * 40, self.root, pacman=True)
        upload = next(args for args in commands if args[:2] == ("release", "upload"))
        self.assertEqual(len(upload) - 6, 12)
        for name in native:
            self.assertIn(str(self.root / name), upload)
        self.assertFalse(draft["draft"])
        self.assertEqual(commands[-1][:2], ("release", "edit"))
        self.assertEqual(sum(args[:2] == ("api", "repos/illegalstudio/context/releases/tags/v1.0.0")
                             for args in commands), 2)


if __name__ == "__main__":
    unittest.main()
