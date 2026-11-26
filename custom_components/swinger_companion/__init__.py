"""Swinger Companion: receives the data of the userscripts (Fickliste, meetings) for one person."""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

from aiohttp import web

from homeassistant.components import webhook
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_KEY,
    CONF_NICK,
    CONF_PLATFORM,
    CONF_SIGN,
    CONF_UID,
    CONF_WEBHOOK_ID,
    DOMAIN,
    MAX_BODY,
    PAYLOAD_FORMAT,
    PLATFORM_NAMES,
    SIGNAL_UPDATE,
    SUBENTRY_ACCOUNT,
    THUMB_URL,
)
from .data import PersonData, decrypt, encrypt, sign

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR]
STORE_VERSION = 1


@dataclass
class Runtime:
    store: Store
    data: PersonData


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


def thumb_url(entry: ConfigEntry, data: PersonData, pid: str) -> str | None:
    t = data.thumbs.get(pid)
    if not t:
        return None
    path = THUMB_URL.format(entry_id=entry.entry_id, pid=pid)
    return f"{path}?k={t['key']}&s={sign(entry.data[CONF_SIGN], entry.entry_id, pid, t['key'])}"


async def async_setup_entry(hass: HomeAssistant, entry: SCConfigEntry) -> bool:
    store: Store = Store(hass, STORE_VERSION, f"{DOMAIN}.{entry.entry_id}")
    entry.runtime_data = Runtime(store, PersonData.from_dict(await store.async_load()))
    if not hass.data.get(f"{DOMAIN}_view"):
        hass.http.register_view(ThumbView())
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
    platform = str(payload.get("platform") or "")
    acc = payload.get("account") if isinstance(payload.get("account"), dict) else {}
    uid, nick = str(acc.get(CONF_UID) or ""), str(acc.get(CONF_NICK) or "").strip()
    if platform not in PLATFORM_NAMES or not (uid or nick):
        return web.json_response({"error": "account"}, status=HTTPStatus.BAD_REQUEST)
    sub = subentry_for(entry, platform, uid, nick)
    akey = sub.unique_id if sub is not None and sub.unique_id else account_key(platform, uid, nick)
    rt = entry.runtime_data
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
    return web.json_response(encrypt(key, {"ok": True, "count": len(rt.data.persons), "need": need}))


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


@callback
def person_view(entry: SCConfigEntry, p: dict[str, Any]) -> dict[str, Any]:
    """A person summary with its signed picture address."""
    return dict(p, thumb=thumb_url(entry, entry.runtime_data.data, p["id"]))
