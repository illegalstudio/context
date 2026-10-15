PYTHON ?= python3

.PHONY: build test check package release

build:
	cargo build --release --locked

test:
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py'
	cargo test --all-targets --locked

check:
	cargo fmt --all -- --check
	cargo clippy --all-targets --locked -- -D warnings
	$(MAKE) test

package: build
	$(PYTHON) scripts/package.py --target "$$(rustc -vV | sed -n 's/^host: //p')"

release:
	$(PYTHON) scripts/release.py $(ARGS)
