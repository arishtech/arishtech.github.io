#!/usr/bin/env python3
"""Concatenate modular receiver into one classic receiver.js (no ES modules)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    "receiver/constants.js",
    "receiver/util.js",
    "receiver/state.js",
    "receiver/logger.js",
    "receiver/dom.js",
    "receiver/contract.js",
    "receiver/url.js",
    "receiver/network.js",
    "receiver/players.js",
    "receiver/pipeline.js",
    "receiver/app.js",
]


def strip_imports(src: str) -> str:
    return re.sub(r"^import\b[\s\S]*?;\s*\n", "", src, flags=re.MULTILINE)


def transform(src: str) -> str:
    src = strip_imports(src)
    src = re.sub(r"^export\s+async\s+function\s+", "async function ", src, flags=re.MULTILINE)
    src = re.sub(r"^export\s+function\s+", "function ", src, flags=re.MULTILINE)
    src = re.sub(r"^export\s+const\s+", "const ", src, flags=re.MULTILINE)
    return src


def main() -> None:
    parts = [
        "/* PreetTV Cast receiver — bundled (no ES modules). Built by tools/bundle_receiver.py */\n",
        '/* global cast, Hls, dashjs, mpegts */\n',
        '(function () {\n"use strict";\n',
    ]
    for rel in FILES:
        p = ROOT / rel
        text = p.read_text(encoding="utf-8")
        parts.append(f"\n/* --- {rel} --- */\n")
        parts.append(transform(text))
        if not parts[-1].endswith("\n"):
            parts.append("\n")
    parts.append("\n})();\n")
    out = ROOT / "receiver.js"
    out.write_text("".join(parts), encoding="utf-8")
    print(f"Wrote {out} ({len(''.join(parts))} bytes)")


if __name__ == "__main__":
    main()
