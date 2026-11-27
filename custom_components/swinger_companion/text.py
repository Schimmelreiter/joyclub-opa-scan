"""Note of each person (up to 255 characters here; longer notes with the action swinger_companion.set_notes)."""

from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import SCConfigEntry, async_changed
from .const import DOMAIN
from .entity import FickEntity, async_track_persons

MAX = 255


async def async_setup_entry(hass: HomeAssistant, entry: SCConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    async_track_persons(hass, entry, lambda pid: [NoteText(entry, pid, "notes")], async_add_entities)


class NoteText(FickEntity, TextEntity):
    _attr_native_max = MAX
    _attr_icon = "mdi:note-text"

    @property
    def native_value(self) -> str | None:
        p = self.p
        if not p:
            return None
        n = p.get("notes_full") or ""
        return n if len(n) <= MAX else n[: MAX - 1] + "…"

    async def async_set_value(self, value: str) -> None:
        p = self.p
        if p and len(p.get("notes_full") or "") > MAX:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="notes_too_long")
        await async_changed(self.hass, self.entry, self.pid, notes=value)
