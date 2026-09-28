#!/usr/bin/env python3
"""Sync Maid release version across package.json, tauri.conf.json, and Cargo.toml.

package.json is the source of truth unless --version writes a new one back.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
PACKAGE_LOCK = ROOT / "package-lock.json"
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def read_package_version() -> str:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = data.get("version")
    if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
        raise SystemExit(f"ERROR: package.json version is not x.y.z: {version!r}")
    return version


def replace_json_version(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'"version"\s*:\s*"[^"]*"',
        f'"version": "{version}"',
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit(f"ERROR: could not find version field in {path}")
    if updated != text:
        path.write_text(updated, encoding="utf-8")


def replace_cargo_version(version: str) -> None:
    text = CARGO_TOML.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(?m)^version\s*=\s*"[^"]*"',
        f'version = "{version}"',
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit(f"ERROR: could not find package version in {CARGO_TOML}")
    if updated != text:
        CARGO_TOML.write_text(updated, encoding="utf-8")


def sync(version: str) -> None:
    if not VERSION_RE.fullmatch(version):
        raise SystemExit(f"ERROR: version must be x.y.z, got {version!r}")
    replace_json_version(PACKAGE_JSON, version)
    if PACKAGE_LOCK.is_file():
        replace_json_version(PACKAGE_LOCK, version)
    replace_json_version(TAURI_CONF, version)
    replace_cargo_version(version)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", help="Write this version back to the identity files")
    parser.add_argument("--print-version", action="store_true")
    args = parser.parse_args()

    if args.version:
        sync(args.version)
    else:
        sync(read_package_version())

    if args.print_version or not args.version:
        if args.print_version:
            print(read_package_version())
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0)
