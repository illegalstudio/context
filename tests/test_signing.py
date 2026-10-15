"""Exercise signing failure boundaries and cleanup without Apple credentials."""

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
FINGERPRINT = "A" * 40
IDENTITY = "Developer ID Application: Example (EXAMPLE123)"
MOCK_COMMAND = r'''
import json, os, sys
from pathlib import Path

root = Path(os.environ["MOCK_ROOT"])
command = Path(sys.argv[0]).name
args = sys.argv[1:]
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps({"command": command, "args": args}) + "\n")
state = json.loads((root / "state.json").read_text())
if command == "security":
    operation = args[0]
    if os.environ.get("MOCK_FAIL") == operation:
        print("The specified item could not be found in the keychain.", file=sys.stderr)
        sys.exit(1)
    if operation == "list-keychains":
        if "-s" in args:
            state["search"] = args[args.index("-s") + 1:]
        else:
            for path in state["search"]:
                print('    "' + path + '"')
    elif operation == "create-keychain":
        state["keychain"] = args[-1]
        Path(args[-1]).touch()
    elif operation == "import":
        print("1 identity imported.")
    elif operation == "find-identity":
        if state["keychain"] not in state["search"]:
            sys.exit("Imported keychain is not searchable")
        print(os.environ["MOCK_IDENTITIES"])
    elif operation == "delete-keychain":
        Path(args[-1]).unlink(missing_ok=True)
elif command == "codesign":
    operation = "verify" if "--verify" in args else "sign"
    if os.environ.get("MOCK_FAIL") == "codesign-" + operation:
        sys.exit("Mock signature " + operation + " failed")
    if operation == "sign":
        if state["keychain"] not in state["search"]:
            sys.exit("Signing keychain is not searchable")
        if args[args.index("--sign") + 1] != "A" * 40:
            sys.exit("Expected the validated certificate fingerprint")
(root / "state.json").write_text(json.dumps(state))
'''


class MacSigning(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="context-signing-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.commands = self.root / "bin"
        self.commands.mkdir()
        for name in ("security", "codesign"):
            executable = self.commands / name
            executable.write_text(f"#!{sys.executable}\n" + MOCK_COMMAND)
            executable.chmod(0o755)
        self.original_search = [str(self.root / "Login Keychain.keychain-db"), "/Library/Keychains/System.keychain"]
        (self.root / "state.json").write_text(json.dumps({"search": self.original_search}))
        self.runner_temp = self.root / "runner-temp"
        self.runner_temp.mkdir()
        self.env = dict(os.environ, PATH=str(self.commands) + os.pathsep + os.environ["PATH"],
                        MOCK_ROOT=str(self.root), RUNNER_TEMP=str(self.runner_temp),
                        APPLE_CERTIFICATE_P12=base64.b64encode(b"fake certificate").decode(),
                        APPLE_CERTIFICATE_PASSWORD="fake-private-password",
                        APPLE_SIGNING_IDENTITY=IDENTITY,
                        MOCK_IDENTITIES=f'  1) {FINGERPRINT} "{IDENTITY}"\n     1 valid identities found')

    def sign(self):
        result = subprocess.run(["bash", str(ROOT / "scripts/notarize.sh"), "sign"],
                                cwd=self.root, env=self.env, text=True, capture_output=True)
        calls = [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]
        state = json.loads((self.root / "state.json").read_text())
        self.assertEqual(state["search"], self.original_search)
        self.assertFalse(list(self.runner_temp.iterdir()), "Temporary signing files must be removed")
        self.assertTrue(any(row["args"][0] == "delete-keychain" for row in calls if row["command"] == "security"))
        output = result.stdout + result.stderr
        for value in (self.env["APPLE_CERTIFICATE_P12"], self.env["APPLE_CERTIFICATE_PASSWORD"], IDENTITY):
            self.assertNotIn(value, output)
        return result, calls

    def test_valid_identity_signs_and_restores_search_list(self):
        result, calls = self.sign()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Validated the imported Developer ID Application identity", result.stdout)
        signing = [row for row in calls if row["command"] == "codesign"]
        self.assertEqual(len(signing), 2)
        self.assertIn("--timestamp", signing[0]["args"])
        self.assertIn("--verify", signing[1]["args"])

    def test_sha1_identity_is_supported_without_printing_credentials(self):
        self.env["APPLE_SIGNING_IDENTITY"] = FINGERPRINT.lower()
        result, _ = self.sign()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_empty_original_search_list_is_restored(self):
        self.original_search = []
        (self.root / "state.json").write_text(json.dumps({"search": []}))
        result, _ = self.sign()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_valid_identity_fails_before_signing(self):
        self.env["MOCK_IDENTITIES"] = "     0 valid identities found"
        result, calls = self.sign()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No valid code-signing identity", result.stderr)
        self.assertIn("validating the configured signing identity", result.stderr)
        self.assertFalse(any(row["command"] == "codesign" for row in calls))

    def test_mismatched_identity_fails_before_signing(self):
        self.env["APPLE_SIGNING_IDENTITY"] = "Developer ID Application: Different certificate"
        result, calls = self.sign()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must match exactly one", result.stderr)
        self.assertFalse(any(row["command"] == "codesign" for row in calls))

    def test_ambiguous_identity_does_not_select_an_arbitrary_key(self):
        self.env["APPLE_SIGNING_IDENTITY"] = "Developer ID Application:"
        self.env["MOCK_IDENTITIES"] += '\n  2) ' + "B" * 40 + ' "Developer ID Application: Other (OTHER12345)"'
        result, calls = self.sign()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must match exactly one", result.stderr)
        self.assertFalse(any(row["command"] == "codesign" for row in calls))

    def test_development_certificate_is_rejected_before_signing(self):
        self.env["APPLE_SIGNING_IDENTITY"] = "Apple Development: Example"
        self.env["MOCK_IDENTITIES"] = f'  1) {FINGERPRINT} "Apple Development: Example"'
        result, calls = self.sign()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("require a Developer ID Application identity", result.stderr)
        self.assertFalse(any(row["command"] == "codesign" for row in calls))

    def test_key_access_failure_reports_its_stage_and_cleans_up(self):
        self.env["MOCK_FAIL"] = "set-key-partition-list"
        result, calls = self.sign()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("configuring private-key access", result.stderr)
        self.assertFalse(any(row["command"] == "codesign" for row in calls))

    def test_signature_verification_failure_is_not_accepted(self):
        self.env["MOCK_FAIL"] = "codesign-verify"
        result, _ = self.sign()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("verifying the executable signature", result.stderr)

    def test_codesign_failure_is_distinguished_from_keychain_setup(self):
        self.env["MOCK_FAIL"] = "codesign-sign"
        result, _ = self.sign()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("signing the executable and requesting its timestamp", result.stderr)


class MacNotarization(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="context-notarization-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.runner_temp = self.root / "runner-temp"
        self.runner_temp.mkdir()
        (self.root / "Cargo.toml").write_text('[package]\nversion = "1.0.0"\n')
        executable = self.root / "xcrun"
        executable.write_text(f"#!{sys.executable}\n" + r'''
import json, os, sys
assert sys.argv[1:3] == ["notarytool", "submit"]
assert sys.argv[3] == "dist/context_1.0.0_darwin_arm64.zip"
assert "--wait" in sys.argv and "--output-format" in sys.argv
print(json.dumps({"status": os.environ["MOCK_STATUS"], "id": "mock-submission"}))
sys.exit(int(os.environ.get("MOCK_EXIT", "0")))
''')
        executable.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ["PATH"],
                        RUNNER_TEMP=str(self.runner_temp), APPLE_ID="test@example.invalid",
                        APPLE_TEAM_ID="EXAMPLE123", APPLE_APP_PASSWORD="fake-notary-password")

    def test_only_accepted_notarization_succeeds_and_cleans_up(self):
        for status, exit_code in (("Accepted", "0"), ("Invalid", "0"), ("In Progress", "0"), ("Accepted", "1")):
            with self.subTest(status=status, exit_code=exit_code):
                result = subprocess.run(["bash", str(ROOT / "scripts/notarize.sh"), "submit"],
                                        cwd=self.root, env=self.env | {"MOCK_STATUS": status, "MOCK_EXIT": exit_code},
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, status == "Accepted" and exit_code == "0")
                self.assertEqual(list(self.runner_temp.iterdir()), [])
                self.assertNotIn(self.env["APPLE_APP_PASSWORD"], result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
