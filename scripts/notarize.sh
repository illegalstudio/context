#!/usr/bin/env bash
# Sign the executable before packaging; notarize the final ZIP before publication.
set -euo pipefail

case "${1:-}" in
  sign)
    : "${APPLE_CERTIFICATE_P12:?Missing Apple certificate}"
    : "${APPLE_CERTIFICATE_PASSWORD:?Missing certificate password}"
    : "${APPLE_SIGNING_IDENTITY:?Missing signing identity}"
    : "${RUNNER_TEMP:?This script is intended for a GitHub macOS runner}"
    signing_dir=$(mktemp -d "$RUNNER_TEMP/context-signing.XXXXXX")
    keychain="$signing_dir/signing.keychain-db"
    original_keychains=()
    restore_search_list=false
    cleanup_signing() {
      if "$restore_search_list"; then
        security list-keychains -d user -s ${original_keychains[@]+"${original_keychains[@]}"} >/dev/null 2>&1 || true
      fi
      security delete-keychain "$keychain" >/dev/null 2>&1 || true
      rm -rf "$signing_dir"
    }
    trap cleanup_signing EXIT
    signing_stage='reading the original keychain search list'
    report_signing_error() {
      local signing_status=$?
      printf '::error::macOS signing failed during %s (exit %s)\n' "$signing_stage" "$signing_status" >&2
      exit "$signing_status"
    }
    trap report_signing_error ERR
    keychain_list=$(security list-keychains -d user)
    keychain_line='^[[:space:]]*"(.*)"[[:space:]]*$'
    while IFS= read -r existing_keychain; do
      [[ -z "$existing_keychain" ]] && continue
      if [[ "$existing_keychain" =~ $keychain_line ]]; then
        original_keychains+=("${BASH_REMATCH[1]}")
      else
        printf '::error::Cannot parse the original keychain search list\n' >&2
        exit 1
      fi
    done <<< "$keychain_list"
    restore_search_list=true
    signing_stage='decoding the certificate'
    printf '%s' "$APPLE_CERTIFICATE_P12" | base64 --decode > "$signing_dir/certificate.p12"
    password=$(openssl rand -hex 32)
    signing_stage='creating and unlocking the temporary keychain'
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    security unlock-keychain -p "$password" "$keychain"
    signing_stage='importing the PKCS#12 identity'
    security import "$signing_dir/certificate.p12" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$keychain"
    signing_stage='configuring private-key access'
    security set-key-partition-list -S apple-tool:,apple: -k "$password" "$keychain" >/dev/null
    signing_stage='registering the temporary keychain search list'
    security list-keychains -d user -s "$keychain" ${original_keychains[@]+"${original_keychains[@]}"}
    signing_stage='validating the configured signing identity'
    security find-identity -v -p codesigning "$keychain" > "$signing_dir/identities.txt"
    signing_identity=$(python3 - "$signing_dir/identities.txt" <<'PY'
import os, re, sys
from pathlib import Path

identities = []
for line in Path(sys.argv[1]).read_text().splitlines():
    match = re.fullmatch(r'\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"\s*', line)
    if match:
        identities.append((match[1].upper(), match[2]))
if not identities:
    raise SystemExit('No valid code-signing identity in the imported keychain. Check the certificate, private key, validity dates and trust chain.')
requested = os.environ['APPLE_SIGNING_IDENTITY']
if re.fullmatch(r'[0-9A-Fa-f]{40}', requested):
    matches = [row for row in identities if row[0] == requested.upper()]
else:
    matches = [row for row in identities if row[1] == requested]
    if not matches:
        matches = [row for row in identities if requested in row[1]]
if len(matches) != 1:
    raise SystemExit('APPLE_SIGNING_IDENTITY must match exactly one valid imported identity. Check the certificate name or its SHA-1 fingerprint.')
if not matches[0][1].startswith('Developer ID Application: '):
    raise SystemExit('Public macOS releases require a Developer ID Application identity.')
print(matches[0][0])
PY
    )
    printf 'Validated the imported Developer ID Application identity.\n'
    signing_stage='signing the executable and requesting its timestamp'
    codesign --force --options runtime --sign "$signing_identity" --keychain "$keychain" --timestamp target/release/context
    signing_stage='verifying the executable signature'
    codesign --verify --strict --verbose=2 target/release/context
    ;;
  submit)
    : "${APPLE_ID:?Missing Apple ID}"
    : "${APPLE_TEAM_ID:?Missing Apple team ID}"
    : "${APPLE_APP_PASSWORD:?Missing notarization password}"
    : "${RUNNER_TEMP:?This script is intended for a GitHub macOS runner}"
    submit_dir=$(mktemp -d "$RUNNER_TEMP/context-notarization.XXXXXX")
    trap 'rm -rf "$submit_dir"' EXIT
    version=$(python3 -c 'import tomllib; print(tomllib.load(open("Cargo.toml", "rb"))["package"]["version"])')
    xcrun notarytool submit "dist/context_${version}_darwin_arm64.zip" \
      --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" \
      --wait --timeout 30m --output-format json > "$submit_dir/result.json"
    python3 - "$submit_dir/result.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
if result.get('status') != 'Accepted':
    raise SystemExit('Notarization was not accepted: ' + str(result.get('status')))
print('Apple notarization accepted: ' + result['id'])
PY
    ;;
  *) printf 'Usage: %s sign|submit\n' "$0" >&2; exit 2 ;;
esac
