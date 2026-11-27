"""Swinger Companion: receives the data of the userscripts (Fickliste, meetings) for one person."""

from __future__ import annotations

import base64
import logging
import secrets
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import quote

import voluptuous as vol
from aiohttp import web
from homeassistant.components import webhook
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry, ConfigEntryState, ConfigSubentry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .const import (
    MAX_VIDEO,
    CONF_KEY,
    CONF_NICK,
    CONF_PLATFORM,
    CONF_SIGN,
    CONF_UID,
    CONF_WEBHOOK_ID,
    DOMAIN,
    MAX_BODY,
    PAYLOAD_FORMAT,
    PIC_DIR,
    PIC_URL,
    PLATFORM_NAMES,
    SIGNAL_UPDATE,
    SUBENTRY_ACCOUNT,
    THUMB_URL,
)
from .data import PersonData, decrypt, encrypt, parse_part, parse_pic, pic_rel, sign
from .entity import async_remove_stale_devices
from .media_import import _remux_ts, import_dir

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SELECT, Platform.SENSOR, Platform.TEXT]
STORE_VERSION = 1


@dataclass
class Runtime:
    store: Store
    data: PersonData
    parts: dict[tuple[str, str], int] = field(default_factory=dict)  # video being received: (pid, key) → next part


type SCConfigEntry = ConfigEntry[Runtime]


def account_key(platform: str, uid: str, nick: str) -> str:
    return f"{platform}:{uid or nick.lower()}"


def subentry_for(entry: ConfigEntry, platform: str, uid: str, nick: str) -> ConfigSubentry | None:
    """The account's subentry: by its key, or (added by hand without ID) by platform and nick."""
    key = account_key(platform, uid, nick)
    subs = [s for s in entry.subentries.values() if s.subentry_type == SUBENTRY_ACCOUNT]
    for sub in subs:
        if sub.unique_id == key:
            return sub
    for sub in subs:
        if sub.data.get(CONF_PLATFORM) == platform and nick and str(sub.data.get(CONF_NICK) or "").lower() == nick.lower():
            return sub
    return None


def pic_dir(hass: HomeAssistant, entry: ConfigEntry) -> Path:
    return Path(hass.config.path(PIC_DIR, entry.entry_id))


def pic_url(entry: ConfigEntry, pid: str, key: str) -> str:
    path = PIC_URL.format(entry_id=entry.entry_id, pid=quote(pid, safe=""), key=quote(key, safe=""))
    return f"{path}?s={sign(entry.data[CONF_SIGN], entry.entry_id, 'pic', pid, key)}"


def _write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(raw)
    tmp.replace(path)


def _append(path: Path, raw: bytes, first: bool) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb" if first else "ab") as f:
        f.write(raw)
    return path.stat().st_size


def _finish_video(part: Path, target: Path) -> int:
    """Received MPEG-TS → MP4 under its final name; returns its size (0 when it failed)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    part.replace(target)
    _remux_ts(target)
    return target.stat().st_size if target.is_file() else 0


def _unlink(base: Path, files: list[str]) -> None:
    for rel in files:
        path = (base / rel).resolve()
        if base.resolve() in path.parents:
            path.unlink(missing_ok=True)


def thumb_url(entry: ConfigEntry, data: PersonData, pid: str) -> str | None:
    t = data.thumbs.get(pid)
    if not t:
        return None
    path = THUMB_URL.format(entry_id=entry.entry_id, pid=pid)
    return f"{path}?k={t['key']}&s={sign(entry.data[CONF_SIGN], entry.entry_id, pid, t['key'])}"


CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
STATUS_OPTIONS = ["none", "want", "done", "no", "never"]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async def _target(call: ServiceCall) -> tuple[SCConfigEntry, str]:
        dev = dr.async_get(hass).async_get(call.data["device_id"])
        for ident in (i for d, i in (dev.identifiers if dev else set()) if d == DOMAIN):
            if "_p_" in ident:
                eid, pid = ident.split("_p_", 1)
                entry = hass.config_entries.async_get_entry(eid)
                if entry and entry.state is ConfigEntryState.LOADED and entry.runtime_data.data.person(pid):
                    return entry, pid
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="not_a_person")

    async def set_status(call: ServiceCall) -> None:
        entry, pid = await _target(call)
        st = call.data["status"]
        await async_changed(hass, entry, pid, status=None if st == "none" else st)

    async def set_notes(call: ServiceCall) -> None:
        entry, pid = await _target(call)
        await async_changed(hass, entry, pid, notes=call.data.get("notes") or "")

    async def add_meet(call: ServiceCall) -> None:
        entry, pid = await _target(call)
        d = call.data
        meet = {"id": "m" + secrets.token_hex(5), "date": d["date"].isoformat(), "where": d.get("where") or "", "club": d.get("club") or "",
                "note": d.get("note") or "", "link": d.get("link") or "", "at": int(time.time() * 1000)}
        if d.get("time"):
            meet["time"] = d["time"].strftime("%H:%M")
        await async_changed(hass, entry, pid, meet=meet)

    async def import_files(call: ServiceCall) -> ServiceResponse:
        entry, pid = await _target(call)
        src = Path(call.data["path"])
        cfg = Path(hass.config.config_dir).resolve()
        ok = await hass.async_add_executor_job(lambda: src.is_dir() and (hass.config.is_allowed_path(str(src)) or src.resolve().is_relative_to(cfg)))
        if not ok:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="bad_folder")
        rt = entry.runtime_data
        res = await hass.async_add_executor_job(import_dir, src, pic_dir(hass, entry), pid, dict(rt.data.pics.get(pid) or {}))
        now = dt_util.utcnow()
        for a in res["added"]:
            rt.data.add_pic(pid, a["key"], a["type"], a["size"], now, sha=a["sha"], source="local")
        for a in res["upgraded"]:
            old = (rt.data.pics.get(pid) or {}).get(a["key"]) or {}
            rt.data.add_pic(pid, a["key"], a["type"], a["size"], now, sha=a["sha"], source=old.get("source") or "script", upgraded=True)
        rt.store.async_delay_save(rt.data.as_dict, 1)
        async_dispatcher_send(hass, SIGNAL_UPDATE.format(entry.entry_id))
        return {"added": len(res["added"]), "upgraded": len(res["upgraded"]), "videos": sum(a["type"].startswith("video/") for a in res["added"]),
                "duplicates": res["duplicates"], "skipped": res["skipped"]}

    dev = {vol.Required("device_id"): cv.string}
    hass.services.async_register(DOMAIN, "import_files", import_files, schema=vol.Schema({**dev, vol.Required("path"): cv.string}),
                                 supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "set_status", set_status, schema=vol.Schema({**dev, vol.Required("status"): vol.In(STATUS_OPTIONS)}))
    hass.services.async_register(DOMAIN, "set_notes", set_notes, schema=vol.Schema({**dev, vol.Optional("notes", default=""):
                                                                               vol.All(cv.string, vol.Length(max=8000))}))
    hass.services.async_register(DOMAIN, "add_meet", add_meet, schema=vol.Schema({
        **dev, vol.Required("date"): cv.date, vol.Optional("time"): cv.time, vol.Optional("where"): cv.string,
        vol.Optional("club"): cv.string, vol.Optional("link"): cv.url, vol.Optional("note"): cv.string}))
    return True


async def async_changed(hass: HomeAssistant, entry: SCConfigEntry, pid: str, **kw: Any) -> None:
    """A change made in Home Assistant: kept until the script confirms it (answer of its next transfer)."""
    rt = entry.runtime_data
    rt.data.change(pid, int(time.time() * 1000), **kw)
    rt.store.async_delay_save(rt.data.as_dict, 1)
    async_dispatcher_send(hass, SIGNAL_UPDATE.format(entry.entry_id))
    if "alias" in kw:
        async_remove_stale_devices(hass, entry)


async def async_remove_config_entry_device(hass: HomeAssistant, entry: SCConfigEntry, device: dr.DeviceEntry) -> bool:
    """Devices of persons that are no longer in the list may be removed by hand."""
    ids = {i for d, i in device.identifiers if d == DOMAIN}
    return not any(i == f"{entry.entry_id}_p_{p['id']}" for i in ids for p in entry.runtime_data.data.persons) and entry.entry_id not in ids


async def async_setup_entry(hass: HomeAssistant, entry: SCConfigEntry) -> bool:
    store: Store = Store(hass, STORE_VERSION, f"{DOMAIN}.{entry.entry_id}")
    entry.runtime_data = Runtime(store, PersonData.from_dict(await store.async_load()))
    if not hass.data.get(f"{DOMAIN}_view"):
        hass.http.register_view(ThumbView())
        hass.http.register_view(PicView())
        hass.data[f"{DOMAIN}_view"] = True
    webhook.async_register(hass, DOMAIN, f"Swinger Companion {entry.title}", entry.data[CONF_WEBHOOK_ID],
                           _handle_webhook, allowed_methods=["POST"], local_only=False)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_reload))
    return True


async def _reload(hass: HomeAssistant, entry: SCConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: SCConfigEntry) -> bool:
    webhook.async_unregister(hass, entry.data[CONF_WEBHOOK_ID])
    await entry.runtime_data.store.async_save(entry.runtime_data.data.as_dict())
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: SCConfigEntry) -> None:
    await Store(hass, STORE_VERSION, f"{DOMAIN}.{entry.entry_id}").async_remove()


def _entry_for_webhook(hass: HomeAssistant, webhook_id: str) -> SCConfigEntry | None:
    for entry in hass.config_entries.async_loaded_entries(DOMAIN):
        if entry.data.get(CONF_WEBHOOK_ID) == webhook_id:
            return entry
    return None


async def _handle_webhook(hass: HomeAssistant, webhook_id: str, request: web.Request) -> web.Response:
    entry = _entry_for_webhook(hass, webhook_id)
    if entry is None:
        return web.json_response({"error": "unknown"}, status=HTTPStatus.NOT_FOUND)
    if (request.content_length or 0) > MAX_BODY:
        return web.json_response({"error": "too large"}, status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"error": "no json"}, status=HTTPStatus.BAD_REQUEST)
    key = entry.data[CONF_KEY]
    try:
        payload = decrypt(key, body)
    except ValueError:
        _LOGGER.warning("Swinger Companion %s: data with a wrong key – is the address in the script up to date?", entry.title)
        return web.json_response({"error": "key"}, status=HTTPStatus.FORBIDDEN)
    if payload.get("format") != PAYLOAD_FORMAT or payload.get("v") != 1:
        return web.json_response({"error": "format"}, status=HTTPStatus.BAD_REQUEST)
    if payload.get("kind") == "pic":
        return await _handle_pic(hass, entry, payload)
    if payload.get("kind") == "vidpart":
        return await _handle_vidpart(hass, entry, payload)
    platform = str(payload.get("platform") or "")
    acc = payload.get("account") if isinstance(payload.get("account"), dict) else {}
    uid, nick = str(acc.get(CONF_UID) or ""), str(acc.get(CONF_NICK) or "").strip()
    if platform not in PLATFORM_NAMES or not (uid or nick):
        return web.json_response({"error": "account"}, status=HTTPStatus.BAD_REQUEST)
    sub = subentry_for(entry, platform, uid, nick)
    akey = sub.unique_id if sub is not None and sub.unique_id else account_key(platform, uid, nick)
    rt = entry.runtime_data
    rt.data.ack(payload.get("ack"))
    if files := rt.data.drop_pics(payload.get("dropPics")):
        await hass.async_add_executor_job(_unlink, pic_dir(hass, entry), files)
    try:
        need = rt.data.apply(payload, akey, dt_util.utcnow())
    except ValueError:
        return web.json_response({"error": "persons"}, status=HTTPStatus.BAD_REQUEST)
    if sub is None:
        # first data of this account: it becomes a device of this person (the entry reloads, so save now)
        await rt.store.async_save(rt.data.as_dict())
        hass.config_entries.async_add_subentry(entry, ConfigSubentry(
            data={CONF_PLATFORM: platform, CONF_UID: uid, CONF_NICK: nick}, subentry_type=SUBENTRY_ACCOUNT,
            title=f"{nick or uid}@{PLATFORM_NAMES[platform]}", unique_id=akey))
    else:
        rt.store.async_delay_save(rt.data.as_dict, 2)
        async_dispatcher_send(hass, SIGNAL_UPDATE.format(entry.entry_id))
        async_remove_stale_devices(hass, entry)
    return web.json_response(encrypt(key, {"ok": True, "count": len(rt.data.persons), "need": need, "needPics": rt.data.need_pics(),
                                            "changes": rt.data.pending()}))


async def _handle_pic(hass: HomeAssistant, entry: SCConfigEntry, payload: dict[str, Any]) -> web.Response:
    """One full picture of a person (sent one by one after the list, when Home Assistant asked for it)."""
    key = entry.data[CONF_KEY]
    pid, pkey = str(payload.get("pid") or ""), str(payload.get("k") or "")
    rt = entry.runtime_data
    if not rt.data.wants_pic(pid, pkey):
        return web.json_response(encrypt(key, {"ok": False, "error": "unknown picture"}))
    pic = parse_pic(payload.get("mime"), payload.get("data"))
    if pic is None:
        return web.json_response(encrypt(key, {"ok": False, "error": "bad picture"}))
    rel = rt.data.add_pic(pid, pkey, pic[0], len(pic[1]), dt_util.utcnow())
    await hass.async_add_executor_job(_write, pic_dir(hass, entry) / rel, pic[1])
    rt.store.async_delay_save(rt.data.as_dict, 5)
    async_dispatcher_send(hass, SIGNAL_UPDATE.format(entry.entry_id))
    return web.json_response(encrypt(key, {"ok": True, "stored": pkey, "needPics": rt.data.need_pics()}))


async def _handle_vidpart(hass: HomeAssistant, entry: SCConfigEntry, payload: dict[str, Any]) -> web.Response:
    """One part of a video (HLS pieces in order, i = 0, 1, …; last = True ends it), stored as MP4 at the end."""
    key = entry.data[CONF_KEY]
    pid, pkey = str(payload.get("pid") or ""), str(payload.get("k") or "")
    rt = entry.runtime_data
    if not rt.data.wants_pic(pid, pkey):
        return web.json_response(encrypt(key, {"ok": False, "error": "unknown picture"}))
    raw = parse_part(payload.get("mime"), payload.get("data"))
    i = payload.get("i")
    if raw is None or not isinstance(i, int) or i < 0:
        return web.json_response(encrypt(key, {"ok": False, "error": "bad part"}))
    if i != rt.parts.get((pid, pkey), 0):
        rt.parts.pop((pid, pkey), None)
        return web.json_response(encrypt(key, {"ok": False, "error": "order"}))
    base = pic_dir(hass, entry)
    part = base / ".parts" / pic_rel(pid, pkey, "video/mp4")
    size = await hass.async_add_executor_job(_append, part, raw, i == 0)
    if size > MAX_VIDEO:
        rt.parts.pop((pid, pkey), None)
        await hass.async_add_executor_job(part.unlink, True)
        return web.json_response(encrypt(key, {"ok": False, "error": "too large"}))
    if not payload.get("last"):
        rt.parts[(pid, pkey)] = i + 1
        return web.json_response(encrypt(key, {"ok": True, "next": i + 1}))
    rt.parts.pop((pid, pkey), None)
    rel = pic_rel(pid, pkey, "video/mp4")
    size = await hass.async_add_executor_job(_finish_video, part, base / rel)
    if not size:
        return web.json_response(encrypt(key, {"ok": False, "error": "bad video"}))
    rt.data.add_pic(pid, pkey, "video/mp4", size, dt_util.utcnow())
    rt.store.async_delay_save(rt.data.as_dict, 5)
    async_dispatcher_send(hass, SIGNAL_UPDATE.format(entry.entry_id))
    return web.json_response(encrypt(key, {"ok": True, "stored": pkey, "needPics": rt.data.need_pics()}))


class ThumbView(HomeAssistantView):
    """Small profile pictures, reachable only with a signed address (the frontend cannot send tokens for <img>)."""

    url = "/api/swinger_companion/thumb/{entry_id}/{pid}"
    name = "api:swinger_companion:thumb"
    requires_auth = False

    async def get(self, request: web.Request, entry_id: str, pid: str) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is None or entry.domain != DOMAIN or not hasattr(entry, "runtime_data"):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        t = entry.runtime_data.data.thumbs.get(pid)
        if not t or request.query.get("k") != t["key"] or request.query.get("s") != sign(entry.data[CONF_SIGN], entry_id, pid, t["key"]):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        return web.Response(body=base64.b64decode(t["data"]), content_type=t["type"],
                            headers={"Cache-Control": "private, max-age=31536000, immutable"})


class PicView(HomeAssistantView):
    """Full pictures of the Fickliste, reachable only with a signed address."""

    url = "/api/swinger_companion/pic/{entry_id}/{pid}/{key}"
    name = "api:swinger_companion:pic"
    requires_auth = False

    async def get(self, request: web.Request, entry_id: str, pid: str, key: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app["hass"]
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is None or entry.domain != DOMAIN or not hasattr(entry, "runtime_data"):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        if request.query.get("s") != sign(entry.data[CONF_SIGN], entry_id, "pic", pid, key):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        info = (entry.runtime_data.data.pics.get(pid) or {}).get(key)
        if not info:
            return web.Response(status=HTTPStatus.NOT_FOUND)
        path = pic_dir(hass, entry) / info["file"]
        if not await hass.async_add_executor_job(path.is_file):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        return web.FileResponse(path, headers={"Cache-Control": "private, max-age=31536000, immutable", "Content-Type": info["type"]})


@callback
def person_view(entry: SCConfigEntry, p: dict[str, Any]) -> dict[str, Any]:
    """A person summary with its signed picture addresses (small picture and all full pictures)."""
    out = {k: v for k, v in entry.runtime_data.data.view(p).items() if k not in ("pic_keys", "notes_full")}
    out["thumb"] = thumb_url(entry, entry.runtime_data.data, p["id"])
    d = entry.runtime_data.data
    keys = d.pic_list(p["id"])
    info = d.pics.get(p["id"]) or {}
    out["pics"] = [pic_url(entry, p["id"], k) for k in keys if not info[k]["type"].startswith("video/")]
    out["videos"] = [pic_url(entry, p["id"], k) for k in keys if info[k]["type"].startswith("video/")]
    return out
