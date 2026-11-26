"""Config flow: one entry per person; its accounts are subentries (they also add themselves when a script sends)."""

from __future__ import annotations

import secrets
from typing import Any

import voluptuous as vol

from homeassistant.components import webhook
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryFlow,
    OptionsFlow,
    SubentryFlowResult,
)
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.network import NoURLAvailableError, get_url

from .const import CONF_KEY, CONF_NICK, CONF_PERSON, CONF_PLATFORM, CONF_SIGN, CONF_UID, CONF_WEBHOOK_ID, DOMAIN, PLATFORM_NAMES, SUBENTRY_ACCOUNT
from .data import new_key


def script_address(hass, entry: ConfigEntry) -> str:
    """What goes into the userscript: webhook address, key after '#' (the fragment never leaves the browser)."""
    try:
        base = get_url(hass, prefer_external=True, allow_cloud=True)
    except NoURLAvailableError:
        base = "https://<home-assistant>"
    return f"{base}{webhook.async_generate_path(entry.data[CONF_WEBHOOK_ID])}#{entry.data[CONF_KEY]}"


class SwingerCompanionConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            name = str(user_input[CONF_PERSON]).strip()
            if not name:
                errors[CONF_PERSON] = "empty"
            else:
                await self.async_set_unique_id(name.lower())
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=name, data={
                    CONF_PERSON: name, CONF_WEBHOOK_ID: webhook.async_generate_id(),
                    CONF_KEY: new_key(), CONF_SIGN: secrets.token_hex(16)})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({vol.Required(CONF_PERSON): str}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return AddressFlow()

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        return {SUBENTRY_ACCOUNT: AccountFlow}


class AddressFlow(OptionsFlow):
    """Shows the address for the userscripts; can also issue a new one (old scripts then stop sending)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            if user_input.get("renew"):
                self.hass.config_entries.async_update_entry(self.config_entry, data={
                    **self.config_entry.data, CONF_WEBHOOK_ID: webhook.async_generate_id(), CONF_KEY: new_key()})
            return self.async_create_entry(data={})
        return self.async_show_form(
            step_id="init", data_schema=vol.Schema({vol.Optional("renew", default=False): bool}),
            description_placeholders={"address": script_address(self.hass, self.config_entry)})


class AccountFlow(ConfigSubentryFlow):
    """Add an account by hand (normally it appears by itself when its script sends for the first time)."""

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if user_input is not None:
            pf, nick, uid = user_input[CONF_PLATFORM], str(user_input[CONF_NICK]).strip(), str(user_input.get(CONF_UID) or "").strip()
            key = f"{pf}:{uid or nick.lower()}"
            entry = self._get_entry()
            if any(s.unique_id == key for s in entry.subentries.values()):
                return self.async_abort(reason="already_configured")
            return self.async_create_entry(title=f"{nick or uid}@{PLATFORM_NAMES[pf]}", unique_id=key,
                                           data={CONF_PLATFORM: pf, CONF_NICK: nick, CONF_UID: uid})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({
            vol.Required(CONF_PLATFORM, default="joyclub"): selector.SelectSelector(selector.SelectSelectorConfig(
                options=list(PLATFORM_NAMES), translation_key="platform", mode=selector.SelectSelectorMode.DROPDOWN)),
            vol.Required(CONF_NICK): str,
            vol.Optional(CONF_UID, default=""): str,
        }))
