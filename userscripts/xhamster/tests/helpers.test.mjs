// node --test: reine Hilfen des xHamster-Skripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../swinger-companion-xhamster.user.js', import.meta.url), 'utf8');
const a = src.indexOf('  const SECRET_K'), b = src.indexOf('  // =====================================================================\n  // Rekorder');
const o0 = src.indexOf('  function opNames('), o1 = src.indexOf('  function hookNetwork(');
const H = new Function('location', 'now', src.slice(a, b) + src.slice(o0, o1) + '; return { shrink, maskStr, maskUrl, pathPattern, ageOf, personOf, censorDiff, retryDelay, opNames };')({ origin: 'https://xhamster.com' }, () => Date.UTC(2026, 10, 27));

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
test('opNames: x-api operation names and batch urls', () => {
  assert.equal(H.opNames('https://xhamster.com/x-api', JSON.stringify([{ name: 'userBlock', requestData: {} }])), ' userBlock');
  assert.equal(H.opNames('/x-api?r=' + encodeURIComponent(JSON.stringify([{ name: 'conversationCollectionFetch' }])), undefined), ' conversationCollectionFetch');
  const b = Buffer.from(JSON.stringify([{ id: 'a', url: '/api/front/user/authorized/160640851' }])).toString('base64');
  assert.equal(H.opNames('/api/front/batch/' + b, undefined), ' → /api/front/user/authorized/{n}');
  assert.equal(H.pathPattern('/api/front/batch/' + b), '/api/front/batch/{b64}');
  assert.equal(H.opNames('/api/front/messages/collection', undefined), '');
  // GET mit Text-Rumpf ohne Vorgang (so schickt es xHamster): Name aus r
  assert.equal(H.opNames('/x-api?r=' + encodeURIComponent(JSON.stringify([{ name: 'friendsUsersCollectionFetch' }])), '{}'), ' friendsUsersCollectionFetch');
  assert.equal(H.opNames('/x-api?r=' + encodeURIComponent(JSON.stringify([{ name: 'a' }])), 'null'), ' a');
  assert.equal(H.opNames('/api/front/friends/friendship', JSON.stringify({ userId: 1, action: 'remove' })), ' action=remove');
  assert.equal(H.opNames('/api/front/messages/model', JSON.stringify({ items: [{ state: 'deleted', id: 'x' }] })), ' state=deleted');
});

// 0.2.0: Regeln von poppen.de, Seitenwechsel im Opa-Scan, Brücke
const s0 = src.indexOf('  const stable = '), s1 = src.indexOf('  function xhBkServer(');
const r0 = src.indexOf('  const POP_SRC = '), r1 = src.indexOf('  // Ruhrgebiet:');
const n0 = src.indexOf('  // Anfangszustand einer anderen Seite holen'), n1 = src.indexOf('  const GENDER_OF = ');
const R = new Function(src.slice(s0, s1) + src.slice(r0, r1) + src.slice(n0, n1) + '; return { stable, bridgePick, popRules, initialsOf, nextPageUrl };')();
test('popRules: stored poppen values win only while the source default is unchanged', () => {
  const s = R.popRules({
    'groups.m.src.interaktionen': { v: [30, 45, 55], src: [29, 48, 50] },   // wird auch zu „global“
    'groups.w.ignore': { v: true, src: false },
    'groups.p.src.global': { v: [20, 30, 40], src: [1, 2, 3] },             // Quelltext seitdem geändert → Vorgabe gilt
    'whitelist.names': { v: [{ n: 'A' }], src: [{ n: 'B' }] },               // eigene Namen bleiben immer
    'expert.debug': { v: true, src: false },                                // nicht übernommen
  });
  assert.deepEqual(s.groups.m.src.global, [30, 45, 55]);
  assert.equal(s.groups.w.ignore, true);
  assert.deepEqual(s.groups.p.src.global, [29, 48, 50]);
  assert.deepEqual(s.whitelist.names, [{ n: 'A' }]);
  assert.equal('debug' in s.expert, false);
  assert.deepEqual(R.popRules(null).groups.m.src.suche, [29, 48, 50]);
});
test('initialsOf and nextPageUrl', () => {
  const html = '<script>window.initials={"datingListComponent":{"users":[{"id":1}]}};</script><a href="https://xhamster.com/dating/de/2?gender=male&amp;minAge=50#result-block">2</a><a href="https://xhamster.com/dating/3?x=1">3</a>';
  assert.equal(R.initialsOf(html).datingListComponent.users[0].id, 1);
  assert.equal(R.nextPageUrl(html, 1), 'https://xhamster.com/dating/de/2?gender=male&minAge=50');
  assert.equal(R.nextPageUrl(html, 2), 'https://xhamster.com/dating/3?x=1');
  assert.equal(R.nextPageUrl(html, 3), '');
  assert.equal(R.initialsOf('<p>kaputt</p>'), null);
});
test('bridgePick: newer wins, ties decided by content', () => {
  const a = { id: 'x', updatedAt: 2, v: 1 }, b = { id: 'x', updatedAt: 3, v: 2 };
  assert.equal(R.bridgePick('fick', a, b), b);
  assert.equal(R.bridgePick('fick', b, a), b);
  assert.equal(R.bridgePick('fick', null, a), a);
  const c = { id: 'x', updatedAt: 3, v: 3 };
  assert.equal(R.bridgePick('fick', b, c), R.bridgePick('fick', c, b));
  assert.equal(R.bridgePick('meta', { k: 'schema', schema: 1 }, { k: 'schema', schema: 2 }).schema, 2);
});
