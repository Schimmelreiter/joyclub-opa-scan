"""Payload handling for Swinger Companion: encryption, person summaries, the stored state of one person."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .const import MAX_THUMB, STATUS_DONE, STATUS_NEVER, STATUS_NO, STATUS_WANT

STATUSES = (STATUS_WANT, STATUS_DONE, STATUS_NO, STATUS_NEVER)
NOTES_MAX = 300


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
    name = str(main.get("nick") or main.get("name") or ext.get("name") or p["id"])
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
        "type": str(joy.get("type") or ext.get("typ") or ""),
        "status": status,
        "status_at": p.get("statusAt") or None,
        "profiles": profiles,
        "meets": len(meets),
        "last_meet": ({"at": _meet_dt(last), "where": last.get("where") or "", "club": last.get("club") or "",
                       "link": last.get("link") or ""} if last else None),
        "notes": notes[:NOTES_MAX] + ("…" if len(notes) > NOTES_MAX else ""),
        "thumb": None,
    }


@dataclass
class PersonData:
    """Everything stored for one person (config entry)."""

    persons: list[dict[str, Any]] = field(default_factory=list)
    accounts: dict[str, dict[str, Any]] = field(default_factory=dict)  # "<pf>:<uid|nick>" → {at, script, count}
    thumbs: dict[str, dict[str, str]] = field(default_factory=dict)  # person id → {key, type, data (base64)}

    def as_dict(self) -> dict[str, Any]:
        return {"persons": self.persons, "accounts": self.accounts, "thumbs": self.thumbs}

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> PersonData:
        d = d or {}
        return cls(list(d.get("persons") or []), dict(d.get("accounts") or {}), dict(d.get("thumbs") or {}))

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
        return [p for p in self.persons if p.get("status") == status]
