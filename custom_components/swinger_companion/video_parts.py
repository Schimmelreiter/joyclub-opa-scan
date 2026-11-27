"""Videos sent in parts: the parts are appended to one file; a manifest next to it keeps offset, length and MD5 of every
complete part, so an interrupted transfer can continue (also after a restart of Home Assistant)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

OVERLAP = 2  # a resumed transfer starts this many parts before the last complete one


def _manifest(part: Path) -> Path:
    return part.with_name(part.name + ".json")


def _load(part: Path) -> list[dict[str, Any]]:
    try:
        parts = json.loads(_manifest(part).read_text())["parts"]
        return parts if isinstance(parts, list) else []
    except (OSError, ValueError, KeyError, TypeError):
        return []


def _save(part: Path, parts: list[dict[str, Any]]) -> None:
    tmp = _manifest(part).with_suffix(".tmp")
    tmp.write_text(json.dumps({"parts": parts}))
    tmp.replace(_manifest(part))


def _complete(part: Path) -> list[dict[str, Any]]:
    """Parts that are completely in the file, in order without gaps (a half written last part is dropped)."""
    size = part.stat().st_size if part.is_file() else 0
    out, off = [], 0
    for p in _load(part):
        if p.get("off") != off or off + int(p.get("len", 0)) > size:
            break
        out.append(p)
        off += int(p["len"])
    return out


def resume_index(part: Path) -> int:
    """Index of the part a resumed transfer starts with."""
    parts = _complete(part)
    if not parts:
        return 0
    _save(part, parts)
    return max(0, len(parts) - OVERLAP)


def put_part(part: Path, index: int, raw: bytes) -> str:
    """Store part `index`. Returns "ok", "mismatch" (a part sent again differs: start over) or "order"."""
    part.parent.mkdir(parents=True, exist_ok=True)
    md5 = hashlib.md5(raw).hexdigest()
    parts = _complete(part)
    if index < len(parts):
        old = parts[index]
        if old["md5"] != md5 or old["len"] != len(raw):
            if index == 0:
                parts = []  # the video starts over
            else:
                return "mismatch"
        else:
            # same as before: keep it, everything after it comes again
            with part.open("r+b") as f:
                f.truncate(old["off"] + old["len"])
            _save(part, parts[: index + 1])
            return "ok"
    if index != len(parts):
        return "order"
    off = parts[-1]["off"] + parts[-1]["len"] if parts else 0
    with part.open("r+b" if part.is_file() and off else "wb") as f:
        f.truncate(off)
        f.seek(off)
        f.write(raw)
    _save(part, [*parts, {"off": off, "len": len(raw), "md5": md5}])
    return "ok"


def size(part: Path) -> int:
    parts = _complete(part)
    return parts[-1]["off"] + parts[-1]["len"] if parts else 0


def drop(part: Path) -> None:
    part.unlink(missing_ok=True)
    _manifest(part).unlink(missing_ok=True)
