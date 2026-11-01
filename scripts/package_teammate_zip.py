from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT.parent / "弈信-五子棋课程设计-队友交接-20261029.zip"
PREFIX = "Gomoku/"
EXCLUDED_DIRS = {".git", "node_modules", ".tmp", ".cache", ".vendor", "__pycache__"}
EXCLUDED_PATHS = {
    "artifacts/runtime", "artifacts/contracts", "artifacts/playwright",
    "web/dist", "docs/reference-extracts",
}
EXCLUDED_FILES = {".npmrc", "pdf-opening-lines.txt"}
EXCLUDED_SUFFIXES = {".pyc"}


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if path.name in EXCLUDED_FILES or path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if any(part in EXCLUDED_DIRS for part in rel.parts):
        return False
    if any(rel.as_posix() == prefix or rel.as_posix().startswith(prefix + "/") for prefix in EXCLUDED_PATHS):
        return False
    if any(part.startswith(".dsh-office-") for part in rel.parts):
        return False
    return path.is_file()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


files = sorted(p for p in ROOT.rglob("*") if included(p))
records = []
for path in files:
    rel = path.relative_to(ROOT).as_posix()
    data = path.read_bytes()
    if rel.startswith("artifacts/test-results/") and re.search(
        rb'"(?:privateKey|mnemonic|secretKey)"\s*:', data, re.IGNORECASE
    ):
        raise RuntimeError(f"Sensitive key field found in test artifact: {rel}")
    records.append({"path": rel, "bytes": len(data), "sha256": digest(data)})

manifest = {
    "format": "gomoku-teammate-handoff/v1",
    "createdFrom": str(ROOT),
    "files": records,
    "excluded": sorted(EXCLUDED_DIRS | EXCLUDED_PATHS | EXCLUDED_FILES),
    "notes": [
        "Includes bug retrospective, work log, iteration review, source, reports, screenshots, and test evidence.",
        "Excludes local chain database, dependencies, caches, Git internals, and extracted course reference materials.",
        "Reports under reports/ are the prior course-report version; see docs/iteration-2-review.md for iteration 2 results.",
    ],
}
manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
DEST.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(DEST, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=7) as archive:
    for path in files:
        archive.write(path, PREFIX + path.relative_to(ROOT).as_posix())
    archive.writestr(PREFIX + "HANDOFF-MANIFEST.json", manifest_bytes)

with zipfile.ZipFile(DEST, "r") as archive:
    bad = archive.testzip()
    if bad:
        raise RuntimeError(f"ZIP CRC validation failed at {bad}")
    names = set(archive.namelist())
    required = {
        PREFIX + "docs/worklog.md",
        PREFIX + "docs/bug-retrospective.md",
        PREFIX + "docs/iteration-2-review.md",
        PREFIX + "artifacts/test-results/verify-final-iter2.log",
    }
    missing = required - names
    if missing:
        raise RuntimeError(f"Required handoff records missing: {sorted(missing)}")
    if any("/artifacts/runtime/" in name or "/node_modules/" in name for name in names):
        raise RuntimeError("Excluded local state/dependency unexpectedly included")

result = {
    "archive": str(DEST),
    "fileCount": len(files) + 1,
    "bytes": DEST.stat().st_size,
    "sha256": digest(DEST.read_bytes()),
    "integrity": "passed",
    "requiredRecords": "passed",
}
print(json.dumps(result, ensure_ascii=False, indent=2))
