"""Exercise unsafe archives and native package integrity with real archive tools."""

import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import package
import pacman_package
import release_assets


class PackageIntegrity(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="context-package-integrity-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.name = "context_1.0.0_linux_amd64"
        binary = bytearray(32)
        binary[:6] = b"\x7fELF\x02\x01"
        binary[18:20] = (62).to_bytes(2, "little")
        self.members = {"context": bytes(binary), "LICENSE": b"MIT\n",
                        "COMMANDS.md": b"Commands\n", "Cargo.lock": b"Lock\n",
                        "THIRD_PARTY_NOTICES.md": b"Notices\n",
                        "licenses/sqlite/NOTICE.txt": b"Public domain\n",
                        "licenses/rust/COPYRIGHT-library.html": b"Rust notices\n",
                        "licenses/dependency/LICENSE": b"Dependency copyright\n"}

    def archive(self, members=None, name=None, use_zip=False):
        name = name or self.name
        path = self.root / (name + (".zip" if use_zip else ".tar.gz"))
        path.write_bytes(package.archive_bytes(name, members or self.members, use_zip))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        path.with_name(path.name + ".sha256").write_text(f"{digest}  {path.name}\n")
        return path

    def test_portable_archives_have_stable_bytes_and_executable_mode(self):
        first = self.archive().read_bytes()
        self.assertEqual(first, self.archive().read_bytes())
        release_assets.check_package(self.archive())
        members = self.members | {"context": bytes.fromhex("cffaedfe0c000001") + b"\0" * 24}
        path = self.archive(members, "context_1.0.0_darwin_arm64", True)
        release_assets.check_package(path)
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(archive.getinfo("context_1.0.0_darwin_arm64/context").external_attr >> 16, 0o100755)

    def test_path_traversal_and_absolute_names_are_rejected(self):
        for name in ("../escape", "docs/../../escape", "/absolute", "docs\\escape"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "Unsafe"):
                release_assets.check_package(self.archive(self.members | {name: b"unsafe"}))

    def test_missing_notices_are_rejected(self):
        members = dict(self.members)
        del members["licenses/sqlite/NOTICE.txt"]
        with self.assertRaisesRegex(ValueError, "Missing required"):
            release_assets.check_package(self.archive(members))

    def test_supplemental_license_provenance_rejects_dependency_updates(self):
        crate = self.root / "crate"
        crate.mkdir()
        (crate / "Cargo.toml").write_text("[package]\n")
        (crate / ".cargo_vcs_info.json").write_text(json.dumps({"git": {"sha1": "a" * 40}}))
        license_dir = self.root / "licenses"
        (license_dir / "grammar").mkdir(parents=True)
        content = b"Upstream copyright\n"
        (license_dir / "grammar/LICENSE").write_bytes(content)
        origin = {"version": "1.0.0", "commit": "b" * 40,
                  "sha256": hashlib.sha256(content).hexdigest(), "url": "https://example.invalid/LICENSE"}
        (license_dir / "provenance.json").write_text(json.dumps({"grammar": origin}))
        metadata = {"workspace_members": [], "packages": [
            {"id": "grammar", "name": "grammar", "version": "1.0.0", "license": "MIT",
             "manifest_path": str(crate / "Cargo.toml")}]}
        with patch.object(package, "ROOT", self.root), self.assertRaisesRegex(ValueError, "Refresh.*provenance"):
            package.notices(metadata, {})

    def test_symlinks_duplicate_members_and_lost_permissions_are_rejected(self):
        for mutation in ("symlink", "duplicate", "mode"):
            path = self.root / (self.name + ".tar.gz")
            with tarfile.open(path, "w:gz") as archive:
                for name, content in self.members.items():
                    info = tarfile.TarInfo(self.name + "/" + name)
                    info.size = len(content)
                    info.mode = 0o755 if name == "context" else 0o644
                    if name == "context" and mutation == "mode":
                        info.mode = 0o644
                    archive.addfile(info, io.BytesIO(content))
                info = tarfile.TarInfo(self.name + "/" + ("LICENSE" if mutation == "duplicate" else "link"))
                if mutation == "symlink":
                    info.type = tarfile.SYMTYPE
                    info.linkname = "../../escape"
                archive.addfile(info)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                release_assets.check_package(path)

    @unittest.skipUnless(shutil.which("bsdtar"), "Native package inspection requires bsdtar")
    def test_native_package_preserves_every_upstream_file(self):
        self.archive()
        tree = self.root / "installed"
        tree.mkdir()
        (tree / ".PKGINFO").write_text(
            "pkgname = context\npkgver = 1.0.0-1\narch = x86_64\n"
            "url = https://github.com/illegalstudio/context\nlicense = MIT\n"
            "depend = glibc>=2.35\ndepend = gcc-libs\n")
        for name, content in self.members.items():
            destination = ("usr/bin/context" if name == "context" else
                           "usr/share/licenses/context/LICENSE" if name == "LICENSE" else
                           "usr/share/doc/context/" + name)
            path = tree / destination
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            path.chmod(0o755 if name == "context" else 0o644)
        native = self.root / "context-1.0.0-1-x86_64.pkg.tar.zst"

        def compress():
            subprocess.run(["bsdtar", "--zstd", "-cf", str(native), "-C", str(tree), ".PKGINFO", "usr"],
                           check=True, capture_output=True)

        compress()
        name, digest = pacman_package.check(self.root, "1.0.0", "x86_64")
        self.assertEqual(name, native.name)
        self.assertEqual(digest, hashlib.sha256(native.read_bytes()).hexdigest())
        notice = tree / "usr/share/doc/context/licenses/dependency/LICENSE"
        notice.write_bytes(b"Changed copyright\n")
        compress()
        with self.assertRaisesRegex(ValueError, "changed upstream bytes"):
            pacman_package.check(self.root, "1.0.0", "x86_64")
        notice.write_bytes(self.members["licenses/dependency/LICENSE"])
        (tree / "usr/bin/context").chmod(0o644)
        compress()
        with self.assertRaisesRegex(ValueError, "mode 0755"):
            pacman_package.check(self.root, "1.0.0", "x86_64")


if __name__ == "__main__":
    unittest.main()
