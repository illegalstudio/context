#!/usr/bin/env python3
"""Benchmark full indexing, unchanged indexing and pack creation in isolated projects."""
import argparse
import json
import platform
import shutil
import statistics
import subprocess
import tempfile
import time
from pathlib import Path


def generate(root, count):
    root.mkdir()
    (root / "package.json").write_text('{"name":"context-benchmark"}\n')
    (root / ".ctxignore").write_text(".context/\nnode_modules/\n")
    shared = root / "src/shared"
    shared.mkdir(parents=True)
    (shared / "utils.ts").write_text("export function helper(value: string): string { return value.trim(); }\n")
    for index in range(count):
        directory = root / "src/modules" / f"group-{index // 100:04}"
        directory.mkdir(parents=True, exist_ok=True)
        entity = "Payment" if index % 10 == 0 else "User"
        methods = "\n".join(
            f"  method{method}(value: string): string {{ return helper(value); }}"
            for method in range(12)
        )
        (directory / f"{entity}Service{index:05}.ts").write_text(
            "import { helper } from '../../shared/utils.js';\n"
            f"export class {entity}Service{index:05} {{\n{methods}\n}}\n"
        )


def measured(command, root):
    start = time.perf_counter()
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f"{command}: {result.stderr}\n{result.stdout}")
    return (time.perf_counter() - start) * 1000


def benchmark(command, root, repetitions):
    cold = measured([*command, "index"], root)
    warm = [measured([*command, "index"], root) for _ in range(repetitions)]
    packs = [
        measured([*command, "pack", "--task", "Fix Payment webhook processing", "--max-files", "25"], root)
        for _ in range(repetitions)
    ]
    return {
        "initialIndexMs": round(cold, 1),
        "unchangedIndexMedianMs": round(statistics.median(warm), 1),
        "packMedianMs": round(statistics.median(packs), 1),
        "repetitions": repetitions,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=Path("target/release/context"))
    parser.add_argument("--baseline", type=Path, help="Optional compiled legacy Node CLI")
    parser.add_argument("--files", type=int, nargs="+", default=[1000, 10000])
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--output", type=Path, help="Save the report as JSON")
    args = parser.parse_args()
    if any(count < 1 for count in args.files) or args.repetitions < 1:
        parser.error("File counts and repetitions must be positive")
    binary = args.binary.resolve(strict=True)
    baseline = args.baseline.resolve(strict=True) if args.baseline else None
    report = {"platform": platform.platform(), "date": time.strftime("%Y-%m-%d"), "results": []}
    with tempfile.TemporaryDirectory(prefix="context-benchmark-") as temporary:
        directory = Path(temporary)
        for count in args.files:
            source = directory / f"source-{count}"
            generate(source, count)
            for name, command in [
                ("rust", [str(binary)]),
                *([("typescript", ["node", str(baseline)])] if baseline else []),
            ]:
                root = directory / f"{name}-{count}"
                shutil.copytree(source, root)
                print(f"Benchmarking {name}, {count} source files...", flush=True)
                result = {"implementation": name, "sourceFiles": count, **benchmark(command, root, args.repetitions)}
                report["results"].append(result)
                print(json.dumps(result), flush=True)
    text = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    else:
        print(text)


if __name__ == "__main__":
    main()
