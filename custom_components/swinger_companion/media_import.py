"""Import pictures and videos from a folder for one person (action swinger_companion.import_files), without duplicates."""

from __future__ import annotations

import hashlib
from pathlib import Path
import shutil
import subprocess
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


def _remux_ts(path: Path) -> None:
    """Videos saved from HLS streams are MPEG-TS files with .mp4 name – browsers cannot play them: remux to real MP4."""
    ff, fp = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ff or not fp:
        return
    try:
        fmt = subprocess.run([fp, "-v", "error", "-show_entries", "format=format_name", "-of", "default=nw=1:nk=1", str(path)],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        if "mpegts" not in fmt:
            return
        tmp = path.with_suffix(".remux.mp4")
        r = subprocess.run([ff, "-v", "error", "-y", "-i", str(path), "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", str(tmp)],
                           capture_output=True, timeout=600)
        if r.returncode == 0 and tmp.stat().st_size > 0:
            tmp.replace(path)
        else:
            tmp.unlink(missing_ok=True)
    except (OSError, subprocess.SubprocessError):
        return


def import_dir(src: Path, dest: Path, pid: str, stored: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Copy new files; stored = the person's pictures so far ({key: info}).

    Returns {"added": [...], "upgraded": [...], "duplicates": n, "skipped": n}. A picture that is already there in a smaller
    size or much stronger compressed is replaced by the better one under its old key (so the scripts do not send it again).
    """
    known_sha: set[str] = set()
    known: list[list[Any]] = []  # [hash, pixels, key, bytes]
    for key, info in stored.items():
        f = dest / info["file"]
        if not f.is_file():
            continue
        known_sha.add(info.get("sha") or _sha(f))
        if info.get("type", "").startswith("image/") and (d := _dhash(f)):
            known.append([d[0], d[1], key, f.stat().st_size])
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
    added, upgraded, dup = [], [], 0
    for f, ctype, d in cands:
        sha = _sha(f)
        if sha in known_sha:
            dup += 1
            continue
        same = next((k for k in known if d and bin(d[0] ^ k[0]).count("1") <= SIMILAR), None) if d else None
        if same is not None:
            size = f.stat().st_size
            # stored before in a smaller size, or same size but much stronger compressed → replace
            better = d[1] > same[1] * 1.1 or (d[1] >= same[1] * 0.95 and size > same[3] * 1.5)
            if same[2] in stored and better:
                old = stored[same[2]]
                target = dest / pic_rel(pid, same[2], ctype)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, target)
                if (dest / old["file"]) != target:
                    (dest / old["file"]).unlink(missing_ok=True)
                upgraded.append({"key": same[2], "type": ctype, "size": target.stat().st_size, "sha": sha, "name": f.name})
                same[1], same[3] = d[1], size
                known_sha.add(sha)
            else:
                dup += 1
            continue
        known_sha.add(sha)
        key = "local-" + sha[:16]
        if d:
            known.append([d[0], d[1], key, f.stat().st_size])
        target = dest / pic_rel(pid, key, ctype)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, target)
        if ctype.startswith("video/"):
            _remux_ts(target)
        added.append({"key": key, "type": ctype, "size": target.stat().st_size, "sha": sha, "name": f.name})
    return {"added": added, "upgraded": upgraded, "duplicates": dup, "skipped": skipped}
