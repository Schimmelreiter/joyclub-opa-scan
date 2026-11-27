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
    assert ans == {"ok": True, "count": 3, "need": ["j:1"], "needPics": [], "changes": []}
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
    assert set(names) == {"Swinger Companion Alex", "TestNick@JOYclub", "Lisa", "Mia", "Nein"}
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
    # the script removes a picture → file and entry gone
    r = await client.post(url, json=encrypt(key, _payload(persons=persons, dropPics=[["j:1", "a2"], ["j:1", "nope"]])))
    assert r.status == 200
    assert not (tmp_path / "swinger_companion" / entry.entry_id / "j_1" / "a2.jpg").exists()
    assert (await client.get(pics[0])).status == 404
    ans = decrypt(key, await (await client.post(url, json=pic("a2"))).json())
    assert ans["ok"]
    # list without pictures later: stored pictures stay
    r = await client.post(url, json=encrypt(key, _payload()))
    assert decrypt(key, await r.json())["needPics"] == []
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons") and s.attributes["persons"][0]["name"] == "Lisa"][0]
    assert len(want.attributes["persons"][0]["pics"]) == 1


async def test_person_devices_and_return_path(hass: HomeAssistant, hass_client_no_auth) -> None:
    entry = await _entry(hass)
    client = await hass_client_no_auth()
    url = f"/api/webhook/{entry.data[CONF_WEBHOOK_ID]}"
    key = entry.data[CONF_KEY]
    persons = _payload()["persons"]
    persons[0]["notes"] = "kurz"
    await client.post(url, json=encrypt(key, _payload(persons=persons)))
    await hass.async_block_till_done()
    entry = hass.config_entries.async_get_entry(entry.entry_id)
    reg = dr.async_get(hass)
    devs = {d.name: d for d in dr.async_entries_for_config_entry(reg, entry.entry_id)}
    assert {"Lisa", "Mia", "Nein"} <= set(devs)
    assert devs["Lisa"].via_device_id == devs["Swinger Companion Alex"].id
    sel = [s for s in hass.states.async_all("select")]
    lisa_sel = next(s for s in sel if s.state == "want")
    lisa_text = next(s for s in hass.states.async_all("text") if s.state == "kurz")

    # change status and note in Home Assistant → shown at once, sent to the script
    await hass.services.async_call("select", "select_option", {"entity_id": lisa_sel.entity_id, "option": "done"}, blocking=True)
    await hass.services.async_call("text", "set_value", {"entity_id": lisa_text.entity_id, "value": "neu"}, blocking=True)
    await hass.services.async_call(DOMAIN, "add_meet", {"device_id": devs["Lisa"].id, "date": "2026-11-20", "time": "21:30", "club": "Club Y"}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get(lisa_sel.entity_id).state == "done"
    done = [s for s in hass.states.async_all("sensor") if s.entity_id.endswith(("_gefickt", "_fucked"))][0]
    lisa = next(p for p in done.attributes["persons"] if p["name"] == "Lisa")
    assert lisa["pending"] and lisa["notes"] == "neu" and lisa["meets"] == 1 and lisa["last_meet"]["club"] == "Club Y"
    ans = decrypt(key, await (await client.post(url, json=encrypt(key, _payload(persons=persons)))).json())
    ch = ans["changes"]
    assert len(ch) == 1 and ch[0]["id"] == "j:1" and ch[0]["status"] == "done" and ch[0]["notes"] == "neu"
    assert ch[0]["meets"][0]["date"] == "2026-11-20" and ch[0]["meets"][0]["time"] == "21:30"
    # an older acknowledgement does not remove a newer change
    ans = decrypt(key, await (await client.post(url, json=encrypt(key, _payload(persons=persons, ack=[{"id": "j:1", "rev": ch[0]["rev"] - 1}])))).json())
    assert ans["changes"]
    persons[0].update(status="done", notes="neu", meets=[{"date": "2026-11-20", "time": "21:30", "club": "Club Y"}])
    ans = decrypt(key, await (await client.post(url, json=encrypt(key, _payload(persons=persons, ack=[{"id": "j:1", "rev": ch[0]["rev"]}])))).json())
    assert ans["changes"] == []
    await hass.async_block_till_done()
    assert hass.states.get(lisa_sel.entity_id).state == "done"

    # person gone → its device is removed
    await client.post(url, json=encrypt(key, _payload(persons=persons[:2])))
    await hass.async_block_till_done()
    names = {d.name for d in dr.async_entries_for_config_entry(reg, entry.entry_id)}
    assert "Nein" not in names and "Lisa" in names


async def test_import_files(hass: HomeAssistant, hass_client_no_auth, tmp_path) -> None:
    from PIL import Image

    hass.config.config_dir = str(tmp_path)
    entry = await _entry(hass)
    client = await hass_client_no_auth()
    await client.post(f"/api/webhook/{entry.data[CONF_WEBHOOK_ID]}", json=encrypt(entry.data[CONF_KEY], _payload()))
    await hass.async_block_till_done()
    src = tmp_path / "import" / "lisa"
    (src / "a").mkdir(parents=True)
    big = Image.new("RGB", (400, 300))
    for x in range(400):
        for y in range(0, 300, 10):
            big.putpixel((x, y), (x % 256, 0, 0))
    big.save(src / "a" / "big.jpg")
    big.resize((200, 150)).save(src / "small.jpg")          # same picture, smaller → duplicate
    (src / "a" / "copy.jpg").write_bytes((src / "a" / "big.jpg").read_bytes())  # exact copy
    Image.new("RGB", (50, 50), (0, 200, 0)).save(src / "other.png")
    (src / "clip.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42 fake video")
    (src / "notes.txt").write_text("x")
    dev = next(d for d in dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id) if d.name == "Lisa")
    res = await hass.services.async_call(DOMAIN, "import_files", {"device_id": dev.id, "path": str(src)}, blocking=True, return_response=True)
    assert res == {"added": 3, "upgraded": 0, "videos": 1, "duplicates": 2, "skipped": 1}
    res = await hass.services.async_call(DOMAIN, "import_files", {"device_id": dev.id, "path": str(src)}, blocking=True, return_response=True)
    assert res["added"] == 0 and res["duplicates"] == 5
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons") and s.attributes["persons"][0]["name"] == "Lisa"][0]
    p = want.attributes["persons"][0]
    assert len(p["pics"]) == 2 and len(p["videos"]) == 1
    r = await client.get(p["videos"][0])
    assert r.status == 200 and r.headers["Content-Type"] == "video/mp4"
    # the same picture larger → replaces the stored one under its key
    up = tmp_path / "import" / "better"
    up.mkdir()
    big.resize((800, 600)).save(up / "huge.jpg")
    res = await hass.services.async_call(DOMAIN, "import_files", {"device_id": dev.id, "path": str(up)}, blocking=True, return_response=True)
    assert res["added"] == 0 and res["upgraded"] == 1
    # same size, much less compressed → also better
    q = tmp_path / "import" / "quality"
    q.mkdir()
    Image.open(up / "huge.jpg").save(q / "low.jpg", quality=10)
    Image.open(up / "huge.jpg").save(q / "low2.jpg", quality=10)
    res = await hass.services.async_call(DOMAIN, "import_files", {"device_id": dev.id, "path": str(q)}, blocking=True, return_response=True)
    assert res["added"] == 0 and res["upgraded"] == 0
    import random

    rnd = random.Random(7)
    grid = Image.new("L", (9, 8))
    grid.putdata([rnd.randrange(0, 256, 40) for _ in range(72)])
    noisy = Image.blend(grid.resize((600, 400)).convert("RGB"), Image.effect_noise((600, 400), 80).convert("RGB"), 0.25)
    lo, hi = tmp_path / "import" / "lo", tmp_path / "import" / "hi"
    lo.mkdir(); hi.mkdir()
    noisy.save(lo / "n.jpg", quality=15)
    noisy.save(hi / "n.jpg", quality=95)
    res = await hass.services.async_call(DOMAIN, "import_files", {"device_id": dev.id, "path": str(lo)}, blocking=True, return_response=True)
    assert res["added"] == 1
    res = await hass.services.async_call(DOMAIN, "import_files", {"device_id": dev.id, "path": str(hi)}, blocking=True, return_response=True)
    assert res["added"] == 0 and res["upgraded"] == 1
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons") and s.attributes["persons"][0]["name"] == "Lisa"][0]
    assert len(want.attributes["persons"][0]["pics"]) == 3
    with __import__("pytest").raises(Exception):
        await hass.services.async_call(DOMAIN, "import_files", {"device_id": dev.id, "path": "/etc"}, blocking=True, return_response=True)



async def test_own_name(hass: HomeAssistant, hass_client_no_auth) -> None:
    entry = await _entry(hass)
    client = await hass_client_no_auth()
    url = f"/api/webhook/{entry.data[CONF_WEBHOOK_ID]}"
    key = entry.data[CONF_KEY]
    persons = _payload()["persons"]
    persons[1]["alias"] = "Kim"
    await client.post(url, json=encrypt(key, _payload(persons=persons)))
    await hass.async_block_till_done()
    reg = dr.async_get(hass)
    names = {d.name for d in dr.async_entries_for_config_entry(reg, entry.entry_id)}
    assert "Kim (Mia)" in names
    done = [s for s in hass.states.async_all("sensor") if s.entity_id.endswith(("_gefickt", "_fucked"))][0]
    assert done.attributes["persons"][0]["name"] == "Kim (Mia)" and done.attributes["persons"][0]["nick"] == "Mia"
    # set in Home Assistant → device and lists follow at once, the script gets the change
    lisa_alias = next(s for s in hass.states.async_all("text") if s.entity_id.endswith(("lisa_eigener_name", "lisa_own_name")))
    await hass.services.async_call("text", "set_value", {"entity_id": lisa_alias.entity_id, "value": "Alexa"}, blocking=True)
    await hass.async_block_till_done()
    names = {d.name for d in dr.async_entries_for_config_entry(reg, entry.entry_id)}
    assert "Alexa (Lisa)" in names
    ans = decrypt(key, await (await client.post(url, json=encrypt(key, _payload(persons=persons)))).json())
    assert ans["changes"][0]["alias"] == "Alexa"


async def test_video_parts(hass: HomeAssistant, hass_client_no_auth, tmp_path) -> None:
    import shutil
    import subprocess
    hass.config.config_dir = str(tmp_path)
    entry = await _entry(hass)
    client = await hass_client_no_auth()
    url = f"/api/webhook/{entry.data[CONF_WEBHOOK_ID]}"
    key = entry.data[CONF_KEY]
    persons = _payload()["persons"]
    persons[0]["pics"] = [{"k": "joyclub-v5", "v": 1, "vid": "5", "vuid": "1"}]
    ans = decrypt(key, await (await client.post(url, json=encrypt(key, _payload(persons=persons)))).json())
    assert ans["needPics"] == [["j:1", "joyclub-v5"]]
    ts = tmp_path / "in.ts"
    if shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=d=1:s=64x48:r=10", "-f", "lavfi", "-i", "sine=d=1",
                        "-c:v", "libx264", "-c:a", "aac", "-f", "mpegts", str(ts)], check=True)
        raw = ts.read_bytes()
    else:
        raw = b"\x47" + b"\x00" * 2000

    def part(i, data, last=False, k="joyclub-v5", mime="video/mp2t"):
        return encrypt(key, {"format": "swinger-companion", "v": 1, "kind": "vidpart", "pid": "j:1", "k": k, "i": i, "last": last,
                             "mime": mime, "data": base64.b64encode(data).decode()})

    async def send(*a, **kw):
        return decrypt(key, await (await client.post(url, json=part(*a, **kw))).json())

    assert (await send(0, raw, k="nope"))["ok"] is False
    assert (await send(0, raw, mime="image/jpeg"))["ok"] is False
    assert (await send(0, b"\x00\x00\x00\x18ftypiso5", mime="video/mp4", k="joyclub-v5"))["ok"]  # fMP4 accepted (then restarted below)
    assert (await send(2, raw))["error"] == "order"  # out of order → starts over
    half = len(raw) // 2
    assert (await send(0, raw[:half])) == {"ok": True, "next": 1}
    assert (await send(2, raw[half:]))["error"] == "order"  # gap → starts over
    assert (await send(0, raw[:half]))["ok"]
    ans = await send(1, raw[half:], last=True)
    assert ans["ok"] and ans["stored"] == "joyclub-v5" and ans["needPics"] == []
    f = tmp_path / "swinger_companion" / entry.entry_id / "j_1" / "joyclub-v5.mp4"
    data = f.read_bytes()
    if shutil.which("ffmpeg"):
        assert data[4:8] == b"ftyp"  # remuxed to MP4
    else:
        assert data == raw
    await hass.async_block_till_done()
    want = [s for s in hass.states.async_all("sensor") if s.attributes.get("persons") and s.attributes["persons"][0]["name"] == "Lisa"][0]
    p = want.attributes["persons"][0]
    assert p["pics"] == [] and len(p["videos"]) == 1
    r = await client.get(p["videos"][0])
    assert r.status == 200 and r.headers["Content-Type"] == "video/mp4"
