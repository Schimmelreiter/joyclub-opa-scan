"""Payload handling for Swinger Companion: encryption, person summaries, the stored state of one person."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .const import MAX_PART, MAX_PIC, MAX_THUMB, NEED_PICS_MAX, STATUS_DONE, STATUS_NEVER, STATUS_NO, STATUS_WANT

STATUSES = (STATUS_WANT, STATUS_DONE, STATUS_NO, STATUS_NEVER)
NOTES_MAX = 300
PIC_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
             "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"}
UPLOAD_TYPES = {k for k in PIC_TYPES if k.startswith("image/")}  # the scripts send pictures only
_SAFE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


def safe_name(text: str) -> str:
    """A file or directory name for a person id or picture key (ids that do not fit are hashed)."""
    text = str(text)
    if _SAFE.match(text) and text not in (".", ".."):
        return text.replace(":", "_")
    return "h_" + hashlib.sha256(text.encode()).hexdigest()[:32]


def pic_rel(pid: str, key: str, ctype: str) -> str:
    return f"{safe_name(pid)}/{safe_name(key)}.{PIC_TYPES[ctype]}"


def pic_keys(p: dict[str, Any]) -> list[str]:
    """Keys of the pictures a script reports for a person (order kept, duplicates removed)."""
    out: list[str] = []
    for x in p.get("pics") or []:
        k = x.get("k") if isinstance(x, dict) else x
        if isinstance(k, str) and _SAFE.match(k) and k not in out:
            out.append(k)
    return out


def parse_pic(mime: Any, data: Any) -> tuple[str, bytes] | None:
    """A full picture sent on its own: content type and base64 → (content type, bytes)."""
    if mime not in UPLOAD_TYPES or not isinstance(data, str):
        return None
    try:
        raw = base64.b64decode(data, validate=False)
    except ValueError:
        return None
    return (mime, raw) if 0 < len(raw) <= MAX_PIC else None


def parse_part(mime: Any, data: Any) -> bytes | None:
    """One part of a video sent in pieces (MPEG-TS from an HLS stream)."""
    if mime != "video/mp2t" or not isinstance(data, str):
        return None
    try:
        raw = base64.b64decode(data, validate=False)
    except ValueError:
        return None
    return raw if 0 < len(raw) <= MAX_PART else None


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def unb64(text: str) -> bytes:
    text = str(text).strip().replace("-", "+").replace("_", "/")
    return base64.b64decode(text + "=" * (-len(text) % 4))


def new_key() -> str:
    return b64u(os.urandom(32))


def decrypt(key: str, body: dict[str, Any]) -> dict[str, Any]:
    """Body {v, iv, data} (base64) → JSON object. Raises ValueError on any problem."""
    if not isinstance(body, dict) or body.get("v") != 1:
        raise ValueError("unknown envelope")
    try:
        plain = AESGCM(unb64(key)).decrypt(unb64(body["iv"]), unb64(body["data"]), None)
        out = json.loads(plain.decode())
    except Exception as err:  # noqa: BLE001 - every failure means: not for us
        raise ValueError("cannot decrypt") from err
    if not isinstance(out, dict):
        raise ValueError("not an object")
    return out


def encrypt(key: str, obj: Any) -> dict[str, Any]:
    iv = os.urandom(12)
    data = AESGCM(unb64(key)).encrypt(iv, json.dumps(obj, separators=(",", ":")).encode(), None)
    return {"v": 1, "iv": base64.b64encode(iv).decode(), "data": base64.b64encode(data).decode()}


def sign(secret: str, *parts: str) -> str:
    return hmac.new(secret.encode(), "/".join(parts).encode(), hashlib.sha256).hexdigest()[:20]


def parse_thumb(data_url: Any) -> tuple[str, bytes] | None:
    """data:image/...;base64,... → (content type, bytes), only small images."""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None
    head, _, b64 = data_url.partition(",")
    ctype = head[5:].split(";")[0]
    if ctype not in ("image/jpeg", "image/png", "image/webp", "image/gif") or ";base64" not in head:
        return None
    try:
        raw = base64.b64decode(b64, validate=False)
    except ValueError:
        return None
    return (ctype, raw) if 0 < len(raw) <= MAX_THUMB else None


def thumb_key(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()[:16]


def _meet_dt(m: dict[str, Any]) -> str:
    d = str(m.get("date") or "")
    if len(d) != 10:
        return ""
    t = str(m.get("time") or "")
    return f"{d}T{t if len(t) == 5 else '00:00'}"


def summarize(p: dict[str, Any]) -> dict[str, Any] | None:
    """One person of the Fickliste (shared format, docs/FORMAT.md) → what Home Assistant shows."""
    if not isinstance(p, dict) or p.get("deleted") or not p.get("id"):
        return None
    main = p.get("main") if isinstance(p.get("main"), dict) else {}
    ext = p.get("ext") if isinstance(p.get("ext"), dict) else {}
    nick = str(main.get("nick") or main.get("name") or ext.get("name") or p["id"])
    alias = str(p.get("alias") or "").strip()[:60]
    name = f"{alias} ({nick})" if alias else nick
    profiles = []
    if main.get("url") or main.get("nick"):
        profiles.append({"pf": main.get("pf") or "other", "name": main.get("nick") or "", "url": main.get("url") or "",
                         "dead": bool(main.get("dead"))})
    for pr in p.get("profiles") or []:
        if isinstance(pr, dict) and (pr.get("url") or pr.get("name") or pr.get("text")):
            profiles.append({"pf": pr.get("pf") or "other", "name": pr.get("name") or pr.get("text") or "",
                             "url": pr.get("url") or "", "dead": bool(pr.get("dead") or pr.get("deleted") or pr.get("gone"))})
    meets = sorted((m for m in p.get("meets") or [] if isinstance(m, dict) and _meet_dt(m)), key=_meet_dt)
    last = meets[-1] if meets else None
    status = p.get("status") if p.get("status") in STATUSES else None
    joy = p.get("joy") if isinstance(p.get("joy"), dict) else {}
    notes = str(p.get("notes") or joy.get("notes") or "").strip()
    return {
        "id": str(p["id"]),
        "name": name,
        "nick": nick,
        "alias": alias,
        "type": str(joy.get("type") or ext.get("typ") or ""),
        "status": status,
        "status_at": p.get("statusAt") or None,
        "profiles": profiles,
        "meets": len(meets),
        "last_meet": ({"at": _meet_dt(last), "where": last.get("where") or "", "club": last.get("club") or "",
                       "link": last.get("link") or ""} if last else None),
        "notes": notes[:NOTES_MAX] + ("…" if len(notes) > NOTES_MAX else ""),
        "notes_full": notes,
        "thumb": None,
        "pic_keys": pic_keys(p),
    }


@dataclass
class PersonData:
    """Everything stored for one person (config entry)."""

    persons: list[dict[str, Any]] = field(default_factory=list)
    accounts: dict[str, dict[str, Any]] = field(default_factory=dict)  # "<pf>:<uid|nick>" → {at, script, count}
    thumbs: dict[str, dict[str, str]] = field(default_factory=dict)  # person id → {key, type, data (base64)}
    # person id → picture key → {file (relative to the picture folder), type, at, size}; never removed automatically
    pics: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    # changes made in Home Assistant, waiting for the script: person id → {rev, status?, statusAt?, notes?, notesAt?, meets[]}
    changes: dict[str, dict[str, Any]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"persons": self.persons, "accounts": self.accounts, "thumbs": self.thumbs, "pics": self.pics, "changes": self.changes}

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> PersonData:
        d = d or {}
        return cls(list(d.get("persons") or []), dict(d.get("accounts") or {}), dict(d.get("thumbs") or {}),
                   dict(d.get("pics") or {}), dict(d.get("changes") or {}))

    def person(self, pid: str) -> dict[str, Any] | None:
        return next((p for p in self.persons if p["id"] == pid), None)

    def change(self, pid: str, now_ms: int, **kw: Any) -> None:
        """Remember a change made in Home Assistant (status, notes or a new meeting) for the scripts."""
        c = self.changes.setdefault(pid, {})
        c["rev"] = max(int(c.get("rev") or 0) + 1, now_ms)
        if "status" in kw:
            c["status"], c["statusAt"] = kw["status"], now_ms
        if "notes" in kw:
            c["notes"], c["notesAt"] = kw["notes"], now_ms
        if "alias" in kw:
            c["alias"], c["aliasAt"] = kw["alias"], now_ms
        if "meet" in kw:
            c.setdefault("meets", []).append(kw["meet"])

    def ack(self, acks: Any) -> None:
        """The script applied these changes: [{id, rev}]. Later changes of the same person stay."""
        for a in acks if isinstance(acks, list) else []:
            if isinstance(a, dict) and (c := self.changes.get(str(a.get("id")))) and int(a.get("rev") or 0) >= int(c.get("rev") or 0):
                del self.changes[str(a["id"])]

    def pending(self) -> list[dict[str, Any]]:
        ids = {p["id"] for p in self.persons}
        return [dict(c, id=pid) for pid, c in self.changes.items() if pid in ids]

    def view(self, p: dict[str, Any]) -> dict[str, Any]:
        """A person as Home Assistant shows it: with its changes that the script has not taken over yet."""
        c = self.changes.get(p["id"])
        if not c:
            return p
        out = dict(p)
        if "status" in c:
            out["status"], out["status_at"] = c["status"], c["statusAt"]
        if "notes" in c:
            n = str(c["notes"])
            out["notes_full"], out["notes"] = n, n[:NOTES_MAX] + ("…" if len(n) > NOTES_MAX else "")
        if "alias" in c:
            out["alias"] = str(c["alias"] or "").strip()[:60]
            nick = out.get("nick") or out["name"]
            out["name"] = f"{out['alias']} ({nick})" if out["alias"] else nick
        if c.get("meets"):
            out["meets"] = int(out.get("meets") or 0) + len(c["meets"])
            last = max(c["meets"], key=_meet_dt)
            if not out.get("last_meet") or _meet_dt(last) > (out["last_meet"] or {}).get("at", ""):
                out["last_meet"] = {"at": _meet_dt(last), "where": last.get("where") or "", "club": last.get("club") or "", "link": last.get("link") or ""}
        out["pending"] = True
        return out

    def need_pics(self) -> list[list[str]]:
        """[person id, key] of reported pictures that are not stored yet (at most NEED_PICS_MAX)."""
        out: list[list[str]] = []
        for p in self.persons:
            have = self.pics.get(p["id"]) or {}
            for k in p.get("pic_keys") or []:
                if k not in have:
                    out.append([p["id"], k])
                    if len(out) >= NEED_PICS_MAX:
                        return out
        return out

    def wants_pic(self, pid: str, key: str) -> bool:
        return any(p["id"] == pid and key in (p.get("pic_keys") or []) for p in self.persons)

    def add_pic(self, pid: str, key: str, ctype: str, size: int, now: datetime, **extra: Any) -> str:
        """Register a stored picture or video, returns its file name relative to the picture folder."""
        rel = pic_rel(pid, key, ctype)
        self.pics.setdefault(pid, {})[key] = {"file": rel, "type": ctype, "at": now.isoformat(), "size": size, **extra}
        return rel

    def drop_pics(self, drops: Any) -> list[str]:
        """Pictures the script removed ([person id, key]): forget them, returns their files (to delete)."""
        files = []
        for d in drops if isinstance(drops, list) else []:
            if isinstance(d, list) and len(d) == 2 and (info := (self.pics.get(str(d[0])) or {}).pop(str(d[1]), None)):
                files.append(info["file"])
                if not self.pics[str(d[0])]:
                    del self.pics[str(d[0])]
        return files

    def pic_list(self, pid: str) -> list[str]:
        """Stored picture keys of a person: in the script's order, then older ones it no longer reports."""
        have = self.pics.get(pid) or {}
        p = next((x for x in self.persons if x["id"] == pid), None)
        order = [k for k in (p.get("pic_keys") if p else None) or [] if k in have]
        return order + [k for k in have if k not in order]

    def apply(self, payload: dict[str, Any], account_key: str, now: datetime) -> list[str]:
        """Take over a complete list from one script. Returns the person ids whose picture is still missing."""
        raw = payload.get("persons")
        if not isinstance(raw, list):
            raise ValueError("persons missing")
        persons = [s for s in (summarize(p) for p in raw) if s]
        ids = {s["id"] for s in persons}
        # thumbKeys: person id → the script's key of its current picture; thumbs: person id → data URL (only those asked for)
        tk = payload.get("thumbKeys")
        wanted = {str(k): str(v) for k, v in tk.items() if str(k) in ids} if isinstance(tk, dict) else {}
        sent = payload.get("thumbs") if isinstance(payload.get("thumbs"), dict) else {}
        for pid, url in sent.items():
            t = parse_thumb(url)
            if t and str(pid) in wanted:
                self.thumbs[str(pid)] = {"key": thumb_key(t[1]), "type": t[0], "data": base64.b64encode(t[1]).decode(),
                                         "src": wanted[str(pid)]}
        for pid in list(self.thumbs):  # person gone, picture gone or replaced
            if pid not in wanted or self.thumbs[pid].get("src") != wanted[pid]:
                del self.thumbs[pid]
        self.persons = persons
        self.accounts[account_key] = {"at": now.isoformat(), "script": str(payload.get("script") or ""), "count": len(persons)}
        return [pid for pid in wanted if pid not in self.thumbs]

    def by_status(self, status: str) -> list[dict[str, Any]]:
        return [p for p in self.persons if self.view(p).get("status") == status]
