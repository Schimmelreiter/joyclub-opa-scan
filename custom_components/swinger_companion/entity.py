"""Devices and the base of per-person entities (each person of the Fickliste is a device below the person entry)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, SIGNAL_UPDATE


def person_device(entry) -> DeviceInfo:
    return DeviceInfo(identifiers={(DOMAIN, entry.entry_id)}, name=f"Swinger Companion {entry.title}",
                      manufacturer="Swinger Companion", model="Person", entry_type=DeviceEntryType.SERVICE)


def fick_ident(entry, pid: str) -> tuple[str, str]:
    return (DOMAIN, f"{entry.entry_id}_p_{pid}")


def fick_device(entry, p: dict[str, Any]) -> DeviceInfo:
    pfs = sorted({x.get("pf") for x in p.get("profiles") or [] if x.get("pf")})
    url = next((x.get("url") for x in p.get("profiles") or [] if x.get("url") and not x.get("dead")), None)
    return DeviceInfo(identifiers={fick_ident(entry, p["id"])}, name=p["name"], manufacturer="Swinger Companion",
                      model="Fickliste", model_id=", ".join(pfs) or None, configuration_url=url,
                      via_device=(DOMAIN, entry.entry_id), entry_type=DeviceEntryType.SERVICE)


@callback
def async_remove_stale_devices(hass: HomeAssistant, entry) -> None:
    """Persons no longer in the list: remove their devices (with their entities)."""
    reg = dr.async_get(hass)
    keep = {fick_ident(entry, p["id"])[1] for p in entry.runtime_data.data.persons}
    for dev in dr.async_entries_for_config_entry(reg, entry.entry_id):
        idents = {i for d, i in dev.identifiers if d == DOMAIN}
        if any(i.startswith(f"{entry.entry_id}_p_") for i in idents) and not idents & keep:
            reg.async_update_device(dev.id, remove_config_entry_id=entry.entry_id)


@callback
def async_track_persons(hass: HomeAssistant, entry, make: Callable[[str], list[Entity]], add: Callable[[list[Entity]], None]) -> None:
    """Add entities for every person now and whenever new persons arrive."""
    known: set[str] = set()

    @callback
    def _new() -> None:
        ents: list[Entity] = []
        for p in entry.runtime_data.data.persons:
            if p["id"] not in known:
                known.add(p["id"])
                ents.extend(make(p["id"]))
        if ents:
            add(ents)

    _new()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_UPDATE.format(entry.entry_id), _new))


class FickEntity(Entity):
    """An entity of one person of the Fickliste."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry, pid: str, key: str) -> None:
        self.entry = entry
        self.pid = pid
        self._attr_translation_key = key
        self._attr_unique_id = f"{entry.entry_id}_p_{pid}_{key}"
        p = entry.runtime_data.data.person(pid) or {"id": pid, "name": pid}
        self._attr_device_info = fick_device(entry, p)

    @property
    def p(self) -> dict[str, Any] | None:
        d = self.entry.runtime_data.data
        p = d.person(self.pid)
        return d.view(p) if p else None

    @property
    def available(self) -> bool:
        return self.p is not None

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE.format(self.entry.entry_id), self.async_write_ha_state))
