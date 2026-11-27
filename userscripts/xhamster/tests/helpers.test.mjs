// node --test: reine Hilfen des xHamster-Skripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../swinger-companion-xhamster.user.js', import.meta.url), 'utf8');
const a = src.indexOf('  const SECRET_K'), b = src.indexOf('  // =====================================================================\n  // Rekorder');
const H = new Function('location', 'now', src.slice(a, b) + '; return { shrink, maskStr, maskUrl, pathPattern, ageOf, personOf, censorDiff, retryDelay };')({ origin: 'https://xhamster.com' }, () => Date.UTC(2026, 10, 27));

test('shrink: lists cut to 3, secrets and message texts masked, own test text kept', () => {
  const v = H.shrink({ list: [1, 2, 3, 4, 5], stats_tkn: 'abc', body: 'geheim', text: 'TEST', mail: 'a.b@example.org', ip: '88.1.2.3', layout: { big: 1 } }, (x) => x === 'TEST');
  assert.deepEqual(v.list, [1, 2, 3, '[… 5 Einträge]']);
  assert.equal(v.stats_tkn, '[x]');
  assert.equal(v.body, '(Text, 6 Zeichen)');
  assert.equal(v.text, 'TEST');
  assert.equal(v.mail, '[mail]');
  assert.equal(v.ip, '[ip]');
  assert.equal('layout' in v, false);
});
test('pathPattern and maskUrl', () => {
  assert.equal(H.pathPattern('https://xhamster.com/my/messages/6b0943db7b1d0e6d110cf2c3/Lennart'), '/my/messages/{id}/Lennart');
  assert.equal(H.pathPattern('/my/blocked-users/2'), '/my/blocked-users/{n}');
  assert.equal(H.maskUrl('https://xhamster.com/api/x?token=1&page=2'), '/api/x?token=x&page=2');
});
test('ageOf: unix seconds, date text, hidden', () => {
  assert.equal(H.ageOf(266716800), 48); // 14.06.1978
  assert.equal(H.ageOf('1975-11-26'), 51);
  assert.equal(H.ageOf('0000-00-00'), null);
  assert.equal(H.ageOf(undefined), null);
  assert.equal(H.ageOf(-277948800), 65); // 12.03.1961
});
test('personOf: dead account without page and info', () => {
  const p = H.personOf({ id: 5, name: 'MMalik', retired: true, pageURL: null, personalInfo: null });
  assert.equal(p.retired, true); assert.equal(p.age, null); assert.equal(p.url, ''); assert.equal(p.city, '');
  const q = H.personOf({ id: 7, name: 'x', personalInfo: { gender: { name: 'male' }, geo: { city: 'Berlin' }, birthday: -277948800 }, isOnline: true });
  assert.equal(q.gender, 'male'); assert.equal(q.city, 'Berlin'); assert.equal(q.age, 65); assert.equal(q.online, true);
});
test('censorDiff', () => {
  assert.equal(H.censorDiff('a  b', 'a b'), '');
  assert.equal(H.censorDiff('17.07.2026 - x', '1********6 - x'), 'Sternchen');
  assert.match(H.censorDiff('https://joyclub.de/e', 'https://xhamster.com/exit.php?url=x'), /Link umgeleitet/);
});
test('retryDelay: doubling, capped at 5 minutes', () => {
  assert.equal(H.retryDelay(1, 0.5), 5000);
  assert.equal(H.retryDelay(3, 0.5), 20000);
  assert.equal(H.retryDelay(20, 0.5), 300000);
  assert.ok(H.retryDelay(2, 0) >= 9000 && H.retryDelay(2, 1) <= 11000);
});
