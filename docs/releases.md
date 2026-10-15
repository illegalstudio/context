# Releases and package distribution

Context releases use the same organization credentials and publication flow as Illegal Studio's Darkbox CLI. A single annotated `vMAJOR.MINOR.PATCH` tag builds all packages, signs and notarizes macOS, publishes a complete GitHub release, updates `illegalstudio/homebrew-tap`, and notifies `illegalstudio/pacman`.

## Create a release

Requirements: Python 3.11 or newer, Make, Git, a C/C++ compiler, and Rust 1.90 or newer with rustfmt, clippy and rust-docs. Start from a clean `main` checkout with the implementation and workflow changes committed.

~~~bash
make check
make release ARGS="--dry-run"
make release
# Or select the version explicitly:
make release ARGS="--version 0.3.0"
~~~

The helper proposes the current Cargo version when it has not been released, or the next patch version. It checks remote tags and `main`, updates only Context's version in `Cargo.toml` and `Cargo.lock`, and runs the checks. Its final confirmation creates the release commit when necessary, creates an annotated tag, and pushes `main` and the tag atomically. A failed push retains the local commit and tag and prints the retry command. A cancellation or failed check before committing restores the preparation files.

The equivalent manual flow is to update `Cargo.toml` and Context's entry in `Cargo.lock`, commit all changes to `main`, run `make check`, create an annotated tag with `git tag -a v0.3.0 -m 'Release v0.3.0'`, then push the branch and tag atomically. Never move a public release tag.

The Release workflow also accepts an existing tag through `workflow_dispatch`, so a failed build or partial draft upload can be retried. It requires a stable version matching Cargo, an annotated tag pointing to the checked-out commit, a version greater than other release tags, and ancestry on `origin/main`. Every build checks out that exact commit. No package is public until all native builds, tests, signing, notarization and package validation pass.

## Artifacts

| Platform | Runner | Rust target | Portable package |
| --- | --- | --- | --- |
| Linux x86_64 | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `context_<version>_linux_amd64.tar.gz` |
| Linux ARM64 | `ubuntu-22.04-arm` | `aarch64-unknown-linux-gnu` | `context_<version>_linux_arm64.tar.gz` |
| macOS ARM64 | `macos-15` | `aarch64-apple-darwin` | `context_<version>_darwin_arm64.zip` |

Linux uses glibc 2.35 or newer. macOS builds set `MACOSX_DEPLOYMENT_TARGET=11.0`. Both Linux targets also produce native Arch packages, `context-<version>-1-x86_64.pkg.tar.zst` and `context-<version>-1-aarch64.pkg.tar.zst`, using native Arch Linux and Arch Linux ARM containers. Windows remains covered by CI, with source installation available.

Each portable archive contains the executable, `LICENSE`, `COMMANDS.md`, `Cargo.lock`, `THIRD_PARTY_NOTICES.md`, dependency license files, the Rust standard library copyright inventory and SQLite's public-domain notice. Files have deterministic ordering and timestamps; the executable retains mode 0755. The macOS signature contains an Apple timestamp, so separate signed builds are not byte-identical.

Some grammar crates omit the upstream license file from their published Cargo archive. Their notices are preserved in `licenses/`, with the exact upstream commit, crate version and file digest in `licenses/provenance.json`. Packaging fails if an update invalidates that provenance or a dependency has no notice. Install `rust-docs` before local packaging:

~~~bash
rustup component add rust-docs
make package
~~~

Arch recipes pin the SHA-256 of the already-validated portable archive and use a local cache until it is public. `makepkg` runs as an unprivileged builder. `!strip` and `!debug` preserve the executable bytes. Before publication, validation checks the architecture, archive paths, executable permissions, package metadata and every installed file against the upstream archive. Only the ARM container bootstrap disables the unavailable pacman download sandbox, following the hosted runner convention used by Darkbox.

The release contains five packages, five individual `.sha256` sidecars, `context_<version>_checksums.txt` for portable archives, and `context_<version>_pacman_checksums.txt` for Arch packages. All digests come from the final signed package bytes.

## Organization secrets

The workflow uses these existing Illegal Studio organization secrets:

| Secrets | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD` | Import the Developer ID certificate and private key |
| `APPLE_SIGNING_IDENTITY` | Select the imported Developer ID Application identity by name or SHA-1 |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | Submit the macOS ZIP to Apple's notarization service |
| `ILLEGAL_BOT_APP_ID`, `ILLEGAL_BOT_PRIVATE_KEY` | Mint separate short-lived tokens for the tap and pacman repositories |

The initial release job fails before expensive builds if any required secret is unavailable to this repository. Organization secret policies must include `illegalstudio/context`; the Illegal Bot installation must have access to both destination repositories. There is no per-project PAT to create.

macOS signing uses a temporary keychain, validates that the certificate resolves to exactly one valid Developer ID Application identity, signs with hardened runtime and a trusted timestamp, and verifies the resulting signature. It restores the original keychain search list and removes the temporary certificate and keychain on success or failure. The final ZIP is submitted to `notarytool`; only status `Accepted` permits publication. Standalone executable ZIPs do not support ticket stapling.

## Publication and retries

The publisher checks the remote annotated tag again before uploading. It creates or resumes a draft tied to the exact commit, uploads all twelve assets, verifies the final asset names, sizes and GitHub digests when present, and only then makes the release public and marks it latest. Draft discovery uses authenticated paginated release listings when GitHub's tag endpoint returns 404. Unexpected assets, mismatched commits and already-public releases stop publication.

Homebrew publication downloads the final public archives, validates their checksums, generates `Formula/context.rb`, checks its Ruby syntax, and commits only that formula to `illegalstudio/homebrew-tap` using Illegal Bot. The formula supports both Linux architectures and macOS ARM64 and exercises indexing and pack creation in its installation test.

Pacman publication checks that both native packages exist on the latest public release and sends `repository_dispatch` with `event_type=publish` and `client_payload.repo=illegalstudio/context` to `illegalstudio/pacman`. That repository downloads the packages, validates metadata, updates its databases and GitHub Pages, and automatically registers Context in `sources.json`. Do not edit generated package indexes or add a source entry by hand. The repository intentionally uses `SigLevel = Optional TrustAll`.

The Release workflow calls both publishers explicitly after GitHub publication. A release created with `GITHUB_TOKEN` does not start a second release-event workflow. The downstream jobs are independent, so one channel can complete while the other is retried.

If the public release exists and only distribution failed, rerun the corresponding workflow with its exact latest tag:

~~~bash
gh workflow run homebrew.yml -f tag=v0.3.0
gh workflow run pacman.yml -f tag=v0.3.0
~~~

These workflows accept only the latest public release, so older releases cannot overwrite the current tap formula or request an outdated synchronization. Follow the [pacman repository Actions](https://github.com/illegalstudio/pacman/actions) to verify completion of the asynchronous repository refresh. Avoid rebuilding or overwriting public assets to repair distribution.

## Validation

`make check` includes release script regressions as well as the Rust checks. CI builds portable and native Arch packages on both Linux architectures, packages macOS, runs tests on all three release targets, checks Rust 1.90, and retains Windows compatibility checks. Pull requests do not receive signing or publication credentials. Release builds add real Apple signing and notarization before upload.

The release tests cover archive safety, architecture validation, permissions, checksum failures, formula generation, checksum-pinned Arch recipes, installed file integrity, version preparation, annotated tags and draft publication failures. Local Linux checks cannot validate Apple credentials, notarization acceptance or the organization's repository access policies; those are exercised by the release jobs.
