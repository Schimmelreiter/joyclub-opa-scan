"""Sensors: per person the Fickliste by status and the last meeting; per account when its script last sent."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import SCConfigEntry, person_view, thumb_url
from .const import CONF_NICK, CONF_PLATFORM, DOMAIN, PLATFORM_NAMES, SIGNAL_UPDATE, STATUS_DONE, STATUS_WANT, SUBENTRY_ACCOUNT
from .entity import FickEntity, async_track_persons, person_device


async def async_setup_entry(hass: HomeAssistant, entry: SCConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    async_add_entities([ListSensor(entry, STATUS_WANT, "want"), ListSensor(entry, STATUS_DONE, "done"), LastMeetSensor(entry)])
    for sub in entry.subentries.values():
        if sub.subentry_type == SUBENTRY_ACCOUNT:
            async_add_entities([AccountSensor(entry, sub.subentry_id)], config_subentry_id=sub.subentry_id)
    async_track_persons(hass, entry, lambda pid: [FickLastMeet(entry, pid, "fick_last_meet")], async_add_entities)


class _Base(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: SCConfigEntry) -> None:
        self.entry = entry

    @property
    def data(self):
        return self.entry.runtime_data.data

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE.format(self.entry.entry_id), self._update))

    @callback
    def _update(self) -> None:
        self.async_write_ha_state()


class ListSensor(_Base):
    """Number of persons with one status; the persons themselves as attribute (not recorded)."""

    _attr_icon = "mdi:account-heart"
    _unrecorded_attributes = frozenset({"persons"})

    def __init__(self, entry: SCConfigEntry, status: str, key: str) -> None:
        super().__init__(entry)
        self.status = status
        self._attr_translation_key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = person_device(entry)
        self._attr_native_unit_of_measurement = None

    @property
    def native_value(self) -> int:
        return len(self.data.by_status(self.status))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        persons = [person_view(self.entry, p) for p in self.data.by_status(self.status)]
        persons.sort(key=lambda p: ((p["last_meet"] or {}).get("at") or "", p.get("status_at") or 0), reverse=True)
        return {"persons": persons}


class LastMeetSensor(_Base):
    _attr_translation_key = "last_meet"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:calendar-heart"

    def __init__(self, entry: SCConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_last_meet"
        self._attr_device_info = person_device(entry)

    def _last(self) -> tuple[dict[str, Any], dict[str, Any]] | None:
        best = None
        for p in self.data.persons:
            m = p.get("last_meet")
            if m and m.get("at") and (best is None or m["at"] > best[1]["at"]):
                best = (p, m)
        return best

    @property
    def native_value(self) -> datetime | None:
        b = self._last()
        if not b:
            return None
        dt = dt_util.parse_datetime(b[1]["at"])
        return dt_util.as_utc(dt.replace(tzinfo=dt_util.get_default_time_zone())) if dt else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        b = self._last()
        if not b:
            return {}
        p, m = b
        return {"name": p["name"], "where": m.get("where") or "", "club": m.get("club") or "", "link": m.get("link") or "",
                "meets": p.get("meets") or 0, "thumb": person_view(self.entry, p)["thumb"]}


class AccountSensor(_Base):
    """When the script of this account last sent its list."""

    _attr_translation_key = "last_sent"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:cloud-upload"

    def __init__(self, entry: SCConfigEntry, subentry_id: str) -> None:
        super().__init__(entry)
        sub = entry.subentries[subentry_id]
        self.key = sub.unique_id or ""
        pf = sub.data.get(CONF_PLATFORM) or ""
        self._attr_unique_id = f"{entry.entry_id}_{subentry_id}_last_sent"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{entry.entry_id}_{subentry_id}")}, name=sub.title, manufacturer=PLATFORM_NAMES.get(pf, pf),
            model=f"Konto {sub.data.get(CONF_NICK) or ''}".strip(), via_device=(DOMAIN, entry.entry_id), entry_type=DeviceEntryType.SERVICE)

    @property
    def native_value(self) -> datetime | None:
        a = self.data.accounts.get(self.key)
        return dt_util.parse_datetime(a["at"]) if a and a.get("at") else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        a = self.data.accounts.get(self.key) or {}
        return {"script_version": a.get("script") or None, "entries": a.get("count")}


class FickLastMeet(FickEntity, SensorEntity):
    """Last meeting with one person; picture, profiles and status as attributes."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:calendar-heart"

    @property
    def native_value(self) -> datetime | None:
        p = self.p
        at = ((p or {}).get("last_meet") or {}).get("at")
        dt = dt_util.parse_datetime(at) if at else None
        return dt_util.as_utc(dt.replace(tzinfo=dt_util.get_default_time_zone())) if dt else None

    @property
    def entity_picture(self) -> str | None:
        return thumb_url(self.entry, self.entry.runtime_data.data, self.pid)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        p = self.entry.runtime_data.data.person(self.pid)
        if not p:
            return {}
        v = person_view(self.entry, p)
        m = v.get("last_meet") or {}
        return {"status": v.get("status"), "meets": v.get("meets") or 0, "where": m.get("where") or "", "club": m.get("club") or "",
                "profiles": v.get("profiles") or [], "pics": v.get("pics") or [], "videos": v.get("videos") or [], "pending": bool(v.get("pending"))}
