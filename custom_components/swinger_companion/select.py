"""Status of each person, changeable in Home Assistant (the scripts take it over)."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import SCConfigEntry, async_changed
from .const import STATUS_DONE, STATUS_NEVER, STATUS_NO, STATUS_WANT
from .entity import FickEntity, async_track_persons

NONE = "none"
OPTIONS = [NONE, STATUS_WANT, STATUS_DONE, STATUS_NO, STATUS_NEVER]


async def async_setup_entry(hass: HomeAssistant, entry: SCConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    async_track_persons(hass, entry, lambda pid: [StatusSelect(entry, pid, "status")], async_add_entities)


class StatusSelect(FickEntity, SelectEntity):
    _attr_options = OPTIONS
    _attr_icon = "mdi:heart-cog"

    @property
    def current_option(self) -> str | None:
        p = self.p
        return (p.get("status") or NONE) if p else None

    async def async_select_option(self, option: str) -> None:
        await async_changed(self.hass, self.entry, self.pid, status=None if option == NONE else option)
