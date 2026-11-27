"""Config flow, webhook, sensors, account subentries, signed pictures."""

import base64

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from custom_components.swinger_companion.const import CONF_KEY, CONF_WEBHOOK_ID, DOMAIN, SUBENTRY_ACCOUNT
from custom_components.swinger_companion.data import decrypt, encrypt

JPG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff fake jpeg").decode()


async def _entry(hass: HomeAssistant, name="Alex"):
    res = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    res = await hass.config_entries.flow.async_configure(res["flow_id"], {"person": name})
    assert res["type"] == "create_entry"
    await hass.async_block_till_done()
    return hass.config_entries.async_entries(DOMAIN)[-1]


def _payload(**kw):
    p = {"format": "swinger-companion", "v": 1, "platform": "joyclub", "script": "2.10",
         "account": {"uid": "123", "nick": "TestNick"},
         "persons": [
             {"id": "j:1", "status": "want", "main": {"pf": "joyclub", "nick": "Lisa", "url": "https://www.joyclub.de/profile/1.html"}},
             {"id": "p:7", "status": "done", "main": {"pf": "poppen", "nick": "Mia"}, "meets": [{"date": "2026-10-03", "time": "22:00", "club": "Club X"}]},
             {"id": "j:3", "status": "no", "main": {"pf": "joyclub", "nick": "Nein"}},
         ],
         "thumbKeys": {"j:1": "img1"}}
    p.update(kw)
    return p


async def test_flow_webhook_sensors(hass: HomeAssistant, hass_client_no_auth) -> None:
    entry = await _entry(hass)
    client = await hass_client_no_auth()
    url = f"/api/webhook/{entry.data[CONF_WEBHOOK_ID]}"
    key = entry.data[CONF_KEY]

    # wrong key → 403, nothing stored
    r = await client.post(url, json=encrypt(base64.urlsafe_b64encode(b"x" * 32).decode(), _payload()))
    assert r.status == 403
    # first data: account becomes a subentry, picture asked for
    r = await client.post(url, json=encrypt(key, _payload()))
    assert r.status == 200
    ans = decrypt(key, await r.json())
    assert ans == {"ok": True, "count": 3, "need": ["j:1"], "needPics": []}
    await hass.async_block_till_done()
    entry = hass.config_entries.async_get_entry(entry.entry_id)
    subs = [s for s in entry.subentries.values() if s.subentry_type == SUBENTRY_ACCOUNT]
    assert [s.title for s in subs] == ["TestNick@JOYclub"]

    want = hass.states.get("sensor.swinger_companion_alex_zu_ficken") or hass.states.get("sensor.swinger_companion_alex_want_to_fuck")
    done = hass.states.get("sensor.swinger_companion_alex_gefickt") or hass.states.get("sensor.swinger_companion_alex_fucked")
    assert want and want.state == "1" and want.attributes["persons"][0]["name"] == "Lisa"
    assert done and done.state == "1"
    last = [s for s in hass.states.async_all("sensor") if s.entity_id.endswith(("letztes_treffen", "last_meeting"))][0]
    assert last.attributes["name"] == "Mia" and last.attributes["club"] == "Club X"

    # devices: person + account below it
    devs = dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
    names = {d.name: d for d in devs}
    assert set(names) == {"Swinger Companion Alex", "TestNick@JOYclub"}
    assert names["TestNick@JOYclub"].via_device_id == names["Swinger Companion Alex"].id

    # picture sent → served only with the signed address
    r = await client.post(url, json=encrypt(key, _payload(thumbs={"j:1": JPG})))
    assert decrypt(key, await r.json())["need"] == []
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons") and s.attributes["persons"][0]["name"] == "Lisa"][0]
    thumb = want.attributes["persons"][0]["thumb"]
    r = await client.get(thumb)
    assert r.status == 200 and (await r.read()).startswith(b"\xff\xd8")
    r = await client.get(thumb.replace("&s=", "&s=0"))
    assert r.status == 404

    # second account of the same person (poppen) → second device; no new subentry for the first one
    r = await client.post(url, json=encrypt(key, _payload(platform="poppen", account={"uid": "55", "nick": "PNick"})))
    assert r.status == 200
    await hass.async_block_till_done()
    entry = hass.config_entries.async_get_entry(entry.entry_id)
    assert sorted(s.title for s in entry.subentries.values()) == ["PNick@Poppen", "TestNick@JOYclub"]

    # data survives a reload
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons")]
    assert want and want[0].attributes["persons"][0]["name"] in ("Lisa", "Mia")


async def test_options_show_address_and_renew(hass: HomeAssistant) -> None:
    entry = await _entry(hass, "Sam")
    old = dict(entry.data)
    res = await hass.config_entries.options.async_init(entry.entry_id)
    assert "/api/webhook/" in res["description_placeholders"]["address"] and "#" in res["description_placeholders"]["address"]
    await hass.config_entries.options.async_configure(res["flow_id"], {"renew": True})
    await hass.async_block_till_done()
    entry = hass.config_entries.async_get_entry(entry.entry_id)
    assert entry.data[CONF_KEY] != old[CONF_KEY] and entry.data[CONF_WEBHOOK_ID] != old[CONF_WEBHOOK_ID]


async def test_manual_account_matches_later_data(hass: HomeAssistant, hass_client_no_auth) -> None:
    entry = await _entry(hass)
    res = await hass.config_entries.subentries.async_init((entry.entry_id, SUBENTRY_ACCOUNT), context={"source": "user"})
    res = await hass.config_entries.subentries.async_configure(res["flow_id"], {"platform": "joyclub", "nick": "testnick", "uid": ""})
    assert res["type"] == "create_entry"
    await hass.async_block_till_done()
    client = await hass_client_no_auth()
    entry = hass.config_entries.async_get_entry(entry.entry_id)
    r = await client.post(f"/api/webhook/{entry.data[CONF_WEBHOOK_ID]}", json=encrypt(entry.data[CONF_KEY], _payload()))
    assert r.status == 200
    await hass.async_block_till_done()
    entry = hass.config_entries.async_get_entry(entry.entry_id)
    assert len(entry.subentries) == 1  # the hand-made one, found by nick
    st = [s for s in hass.states.async_all("sensor") if s.entity_id.endswith(("letzte_ubertragung", "last_transfer"))]
    assert st and st[0].state not in ("unknown", "unavailable")


async def test_full_pictures(hass: HomeAssistant, hass_client_no_auth, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _entry(hass)
    client = await hass_client_no_auth()
    url = f"/api/webhook/{entry.data[CONF_WEBHOOK_ID]}"
    key = entry.data[CONF_KEY]
    persons = _payload()["persons"]
    persons[0]["pics"] = [{"k": "a1"}, {"k": "a2"}, {"k": "a1"}, {"k": "../bad"}]
    r = await client.post(url, json=encrypt(key, _payload(persons=persons)))
    ans = decrypt(key, await r.json())
    assert ans["needPics"] == [["j:1", "a1"], ["j:1", "a2"]]
    await hass.async_block_till_done()

    def pic(k, data=b"\xff\xd8\xff full", pid="j:1"):
        return encrypt(key, {"format": "swinger-companion", "v": 1, "kind": "pic", "pid": pid, "k": k, "mime": "image/jpeg",
                             "data": base64.b64encode(data).decode()})

    assert decrypt(key, await (await client.post(url, json=pic("zz"))).json())["ok"] is False  # not reported
    assert decrypt(key, await (await client.post(url, json=pic("a1", pid="p:7"))).json())["ok"] is False
    ans = decrypt(key, await (await client.post(url, json=pic("a2"))).json())
    assert ans["ok"] and ans["needPics"] == [["j:1", "a1"]]
    assert (tmp_path / "swinger_companion" / entry.entry_id / "j_1" / "a2.jpg").read_bytes().startswith(b"\xff\xd8")
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons") and s.attributes["persons"][0]["name"] == "Lisa"][0]
    pics = want.attributes["persons"][0]["pics"]
    assert len(pics) == 1 and "pic_keys" not in want.attributes["persons"][0]
    r = await client.get(pics[0])
    assert r.status == 200 and (await r.read()).startswith(b"\xff\xd8")
    assert (await client.get(pics[0].replace("?s=", "?s=0"))).status == 404
    # list without pictures later: stored pictures stay
    r = await client.post(url, json=encrypt(key, _payload()))
    assert decrypt(key, await r.json())["needPics"] == []
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons") and s.attributes["persons"][0]["name"] == "Lisa"][0]
    assert len(want.attributes["persons"][0]["pics"]) == 1
