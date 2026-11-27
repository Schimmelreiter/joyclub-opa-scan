"""Payload handling without Home Assistant."""

import base64
from datetime import UTC, datetime

import pytest

from custom_components.swinger_companion.data import PersonData, decrypt, encrypt, new_key, summarize

PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()


def test_roundtrip_and_wrong_key():
    k = new_key()
    assert decrypt(k, encrypt(k, {"a": 1})) == {"a": 1}
    with pytest.raises(ValueError):
        decrypt(new_key(), encrypt(k, {"a": 1}))
    with pytest.raises(ValueError):
        decrypt(k, {"v": 2})


def test_summary():
    p = {"id": "j:1", "status": "done", "statusAt": 5, "main": {"pf": "joyclub", "uid": "1", "nick": "Anna", "url": "https://x/1"},
         "profiles": [{"pf": "poppen", "name": "anna_p", "url": "https://p/1"}, {"pf": "signal", "text": "anna.01"}],
         "meets": [{"date": "2026-07-01", "where": "Party A", "club": "Club X"}, {"date": "2026-09-12", "time": "21:00", "club": "Club Y"}, {"date": "bad"}],
         "notes": "x" * 400, "joy": {"type": "Frau"}}
    s = summarize(p)
    assert s["name"] == "Anna" and s["type"] == "Frau" and s["status"] == "done"
    assert [x["pf"] for x in s["profiles"]] == ["joyclub", "poppen", "signal"]
    assert s["meets"] == 2 and s["last_meet"]["at"] == "2026-09-12T21:00" and s["last_meet"]["club"] == "Club Y"
    assert len(s["notes"]) == 301
    assert summarize({"id": "x", "deleted": True}) is None
    assert summarize({"id": "x:2", "status": "weird", "ext": {"name": "Ohne Profil"}})["status"] is None


def test_thumbs_asked_kept_and_dropped():
    d = PersonData()
    now = datetime(2026, 11, 26, tzinfo=UTC)
    persons = [{"id": "j:1", "status": "want"}, {"id": "j:2", "status": "done"}]
    need = d.apply({"persons": persons, "thumbKeys": {"j:1": "a", "j:2": "b"}}, "joyclub:9", now)
    assert sorted(need) == ["j:1", "j:2"]
    need = d.apply({"persons": persons, "thumbKeys": {"j:1": "a", "j:2": "b"}, "thumbs": {"j:1": PNG, "j:2": "data:text/html,<x>"}}, "joyclub:9", now)
    assert need == ["j:2"] and set(d.thumbs) == {"j:1"}
    # picture changed → asked again; person gone → picture dropped
    need = d.apply({"persons": persons[:1], "thumbKeys": {"j:1": "a2"}}, "joyclub:9", now)
    assert need == ["j:1"] and d.thumbs == {}
    assert d.accounts["joyclub:9"]["count"] == 1


def test_video_parts_resume(tmp_path):
    from custom_components.swinger_companion import video_parts as vp
    part = tmp_path / ".parts" / "p" / "v.mp4"
    chunks = [bytes([n]) * (100 + n) for n in range(6)]
    assert vp.resume_index(part) == 0
    for n in range(5):
        assert vp.put_part(part, n, chunks[n]) == "ok"
    assert vp.size(part) == sum(len(c) for c in chunks[:5])
    # half written 6th part: dropped, resume 2 before the last complete one
    with part.open("ab") as f:
        f.write(b"\x09" * 50)
    assert vp.resume_index(part) == 3
    assert vp.put_part(part, 3, chunks[3]) == "ok"        # same as before → kept, file cut after it
    assert vp.size(part) == sum(len(c) for c in chunks[:4]) == part.stat().st_size
    assert vp.put_part(part, 4, chunks[4]) == "ok" and vp.put_part(part, 5, chunks[5]) == "ok"
    assert part.read_bytes() == b"".join(chunks)
    assert vp.put_part(part, 8, b"x") == "order"
    assert vp.put_part(part, 2, b"other") == "mismatch"    # the stream changed
    assert vp.put_part(part, 0, b"new start") == "ok"      # first part differs → starts over
    assert part.read_bytes() == b"new start" and vp.resume_index(part) == 0
    vp.drop(part)
    assert not part.exists() and vp.resume_index(part) == 0
