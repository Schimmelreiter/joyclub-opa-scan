"""Import pictures and videos from a folder for one person (action swinger_companion.import_files), without duplicates."""

from __future__ import annotations

import hashlib
from pathlib import Path
import shutil
from typing import Any

from .data import PIC_TYPES, pic_rel

EXT_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif",
             "avif": "image/avif", "mp4": "video/mp4", "m4v": "video/mp4", "mov": "video/quicktime", "webm": "video/webm"}
SIMILAR = 6  # pictures whose difference hash differs in at most this many of 64 bits count as the same picture


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _dhash(path: Path) -> tuple[int, int] | None:
    """64-bit difference hash and pixel count of a picture (None for videos or unreadable files)."""
    try:
        from PIL import Image, ImageOps  # noqa: PLC0415 - Pillow ships with Home Assistant

        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            pixels = im.width * im.height
            g = im.convert("L").resize((9, 8))
            px = list(g.getdata())
    except Exception:  # noqa: BLE001
        return None
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (px[row * 9 + col] > px[row * 9 + col + 1])
    return bits, pixels


def import_dir(src: Path, dest: Path, pid: str, stored: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Copy new files; stored = the person's pictures so far ({key: info}). Returns {"added": [...], "duplicates": n, "skipped": n}."""
    known_sha: set[str] = set()
    known_hash: list[int] = []
    for info in stored.values():
        f = dest / info["file"]
        if not f.is_file():
            continue
        known_sha.add(info.get("sha") or _sha(f))
        if info.get("type", "").startswith("image/") and (d := _dhash(f)):
            known_hash.append(d[0])
    cands = []
    skipped = 0
    for f in sorted(p for p in src.rglob("*") if p.is_file()):
        ctype = EXT_TYPES.get(f.suffix.lower().lstrip("."))
        if not ctype or ctype not in PIC_TYPES:
            skipped += 1
            continue
        d = _dhash(f) if ctype.startswith("image/") else None
        cands.append((f, ctype, d))
    # largest pictures first, so the best copy of a picture is the one that stays
    cands.sort(key=lambda c: -(c[2][1] if c[2] else 0))
    added, dup = [], 0
    for f, ctype, d in cands:
        sha = _sha(f)
        if sha in known_sha or (d and any(bin(d[0] ^ k).count("1") <= SIMILAR for k in known_hash)):
            dup += 1
            continue
        known_sha.add(sha)
        if d:
            known_hash.append(d[0])
        key = "local-" + sha[:16]
        target = dest / pic_rel(pid, key, ctype)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, target)
        added.append({"key": key, "type": ctype, "size": target.stat().st_size, "sha": sha, "name": f.name})
    return {"added": added, "duplicates": dup, "skipped": skipped}
