# Supplemental upstream notices

`provenance.json` records the crate version, Cargo upstream commit, source URL and SHA-256 of each notice missing from a published dependency crate. These files cover grammar, MCP SDK and tokenizer crates and were retrieved from the exact upstream commits recorded in the crates' `.cargo_vcs_info.json` files. Preserve the original notices when updating them.

`scripts/package.py` collects notices directly from resolved Cargo dependencies whenever available. It uses these supplemental files only when a crate has no bundled notice, and checks provenance before packaging. SQLite's public-domain notice is kept separately under `sqlite/`.
