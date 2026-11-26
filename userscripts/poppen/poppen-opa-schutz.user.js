// ==UserScript==
// @name         Poppen.de – Besucher nach Alter ignorieren
// @namespace    local.visitor-age-filter
// @version      2.43
// @description  Opa-Schutz für poppen.de: erkennt Mitglieder über einer Altersgrenze (Besucher, Likes, Sticker, Nachrichten, Gruppen, Mitgliedersuche) und blockiert sie in Etappen. Dazu Fickliste, Figur-Badges, Gruppen-Whitelist und mehr.
// @homepageURL  https://github.com/Schimmelreiter/poppen-opa-scan
// @supportURL   https://github.com/Schimmelreiter/poppen-opa-scan/issues
// @updateURL    https://raw.githubusercontent.com/Schimmelreiter/poppen-opa-scan/main/poppen-opa-schutz.user.js
// @downloadURL  https://raw.githubusercontent.com/Schimmelreiter/poppen-opa-scan/main/poppen-opa-schutz.user.js
// @match        https://www.poppen.de/*
// @match        https://schimmelreiter.github.io/joyclub-opa-scan/briefkasten.html*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzAiIGZpbGw9IiMyYjJiMmIiIHN0cm9rZT0iI2U1MzkzNSIgc3Ryb2tlLXdpZHRoPSI1Ii8+PHRleHQgeD0iMzIiIHk9IjQxIiBmb250LWZhbWlseT0iQXJpYWwsSGVsdmV0aWNhLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjUiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj41MCs8L3RleHQ+PGxpbmUgeDE9IjEyIiB5MT0iNTIiIHgyPSI1MiIgeTI9IjEyIiBzdHJva2U9IiNlNTM5MzUiIHN0cm9rZS13aWR0aD0iNiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9zdmc+
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @connect      poppen.de
// @connect      img-z.poppen.de
// @connect      schimmelreiter.github.io
// @sandbox      raw
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';
  const VERSION = '2.43';
  const REPO_URL = 'https://github.com/Schimmelreiter/poppen-opa-scan';
  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  // Eingebaute Funktionen gleich beim Start festhalten (das Skript läuft in der Seitenwelt; spätere Veränderungen
  // durch Seitenskripte an crypto/indexedDB wirken so nicht mehr auf Verschlüsselung und Datenbank)
  const SUB = (() => { const c = window.crypto, s = c && c.subtle; const b = (f) => (s && s[f] ? s[f].bind(s) : null); return { importKey: b('importKey'), deriveKey: b('deriveKey'), encrypt: b('encrypt'), decrypt: b('decrypt'), sign: b('sign'), digest: b('digest'), rnd: c && c.getRandomValues ? c.getRandomValues.bind(c) : null }; })();
  const IDB = (() => { const i = window.indexedDB; return i ? { open: i.open.bind(i), deleteDatabase: i.deleteDatabase.bind(i), databases: i.databases ? i.databases.bind(i) : null } : null; })();
  const IN_FRAME = W.top !== W;
  const HOST = location.hostname;
  const ON_POPPEN = /(^|\.)poppen\.de$/.test(HOST) && !IN_FRAME;    // volle Funktion nur auf poppen.de (kein iframe)

  // =====================================================================================
  // Hilfsfunktionen
  // =====================================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
  async function sha256hex(str) { const b = await SUB.digest('SHA-256', new TextEncoder().encode(String(str))); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const deDate = (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  const deTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const deDateTime = (ts) => { const d = new Date(ts); return `${deDate(d)} ${deTime(d)}`; };
  const DAY = 86400000;
  const now = () => Date.now();
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const uniq = (a) => [...new Set(a)];
  const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
  const fmtN = (n) => Number(n || 0).toLocaleString('de-DE');
  const log = (...a) => console.log('[Opa-Schutz]', ...a);
  const warn = (...a) => console.warn('[Opa-Schutz]', ...a);

  async function waitFor(fn, timeout = 10000, step = 250) {
    const t0 = now();
    while (now() - t0 < timeout) {
      let r = null;
      try { r = fn(); } catch { r = null; }
      if (r) return r;
      await sleep(step);
    }
    return null;
  }
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  const isVisible = (e) => !!e && e.isConnected && e.getClientRects().length > 0;

  // Profilpfad <-> Benutzername: /p/<name in Kleinbuchstaben, URL-kodiert>
  const slugOf = (path) => { try { return decodeURIComponent(String(path).replace(/^\/p\//, '').replace(/\/.*$/, '')).toLowerCase(); } catch { return String(path).toLowerCase(); } };
  const pathOfName = (name) => '/p/' + encodeURIComponent(String(name).trim().toLowerCase());
  const profileUrl = (name) => location.origin + pathOfName(name);

  // Benutzer-ID aus einer Profilbild-Adresse: …/fsk16/B/D/4/8194027-BD4B…_350_sq.jpg
  function uidFromAvatar(src) {
    const m = /\/(\d{3,10})-[0-9A-F]{16,}/i.exec(String(src || ''));
    return m ? m[1] : '';
  }
  const isPlaceholderAvatar = (src) => !src || /image_null_|random_avatar_|avatar-[\w-]+\.[\w]+\.svg|avatar-(man|woman|couple|female|male)|plc-images|plcblur|\/v2-static\//i.test(src);

  // Alter aus "Mann · 48 Jahre · 15 km" (Paare: "45/42 Jahre", "45 & 42 Jahre" …)
  function agesFromText(text) {
    const re = /\b(1[89]|[2-9]\d)\b(?=(?:\s*(?:\/|&|\+|und|,|\||·)\s*(?:1[89]|[2-9]\d)\b)*\s*Jahre)/gi;
    const out = [];
    let m;
    while ((m = re.exec(text || '')) && out.length < 2) out.push(Number(m[1]));
    return out;
  }
  const TYPE_WORDS = { mann: 'm', frau: 'w', paar: 'p', trans: 'ts', 'nicht-binär': 'tv', 'nicht binär': 'tv', 'non-binary': 'tv', transvestit: 'tv' };
  function genderFromText(text) {
    const t = norm(String(text || '').split('·')[0]);
    if (TYPE_WORDS[t]) return t === 'paar' ? ['w', 'm'] : [TYPE_WORDS[t]];
    if (/paar/.test(t)) return ['w', 'm'];
    return [];
  }

  // Datei herunterladen
  function download(name, text, type = 'application/json') {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function pickFile(accept = '.json,application/json') {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept;
      inp.onchange = async () => { const f = inp.files && inp.files[0]; resolve(f ? await f.text() : null); };
      inp.click();
    });
  }
  const stamp = () => { const d = new Date(); return `${isoDay(d)}_${pad2(d.getHours())}${pad2(d.getMinutes())}`; };

  // Schlanker Ereignis-Bus innerhalb des Tabs
  const Bus = (() => {
    const map = new Map();
    return {
      on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); },
      emit(ev, data) { (map.get(ev) || []).forEach((fn) => { try { fn(data); } catch (e) { warn(ev, e); } }); },
    };
  })();

  // Tab-Kennung (bleibt beim Seitenwechsel im selben Tab erhalten) – im sessionStorage, NICHT im Fensternamen:
  // window.name gehört der Seite und fremden Frames (z. B. „jaf-…“ des JOYclub-Skripts). Bis 2.42 hing hier „;vaf:<id>“ am
  // Namen jedes Fensters; dieser Rest wird einmalig nur im obersten Fenster entfernt. In Frames: nichts am Namen tun.
  const TAB_ID = (() => {
    const rnd = () => Math.random().toString(36).slice(2, 10);
    if (W.top !== W) return rnd();
    let id = '';
    try { id = sessionStorage.getItem('vaf_tab') || ''; } catch {}
    try {
      const nm = W.name || '';
      const m = /(?:^|;)vaf:([a-z0-9]+)/.exec(nm);
      if (m) { if (!id) id = m[1]; W.name = nm.replace(/;?vaf:[a-z0-9]+/g, '').replace(/^;/, ''); }
    } catch {}
    if (!id) id = rnd();
    try { sessionStorage.setItem('vaf_tab', id); } catch {}
    return id;
  })();

  // SVG-Symbol aus Pfaddaten
  const svgIcon = (inner, vb = '0 0 24 24', extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="${vb}" fill="currentColor" ${extra}>${inner}</svg>`;

  // =====================================================================================
  // Einstellungen (Quelltext-Werte). Auf der Seite „Opa-Schutz“ änderbar; dort geänderte Werte
  // gelten, solange der Quelltext-Wert unverändert bleibt.
  // =====================================================================================
  const SRC_KEYS = ['interaktionen', 'besucher', 'party', 'gruppen', 'suche'];
  // „Global“: gemeinsame Grenzen für alle Quellen (Experten-Schalter „Gemeinsame Grenzen für alle Quellen“)
  const LIM_KEYS = ['global', ...SRC_KEYS];
  const AGE_MAX = 99;           // Schieberegler 18–99; 99 = offenes Ende (schließt auch Ältere ein)
  const SOURCES = {
    interaktionen: { label: 'Interaktionen', avail: true, tip: 'Mitglieder, die dir ein Like, einen Sticker oder eine Nachricht geschickt haben' },
    besucher: { label: 'Profilbesucher', avail: true, tip: 'Mitglieder, die dein Profil besucht haben' },
    party: { label: 'Partygäste', avail: true, tip: 'Mitglieder, die bei Events auf „Gehe“ oder „Vielleicht“ stehen' },
    gruppen: { label: 'Gruppen', avail: true, tip: 'Mitglieder deiner Gruppen' },
    suche: { label: 'Mitgliedersuche', avail: true, tip: 'Alle poppen.de-Mitglieder, die auf die Einstellungen passen' },
  };
  // Quelle in der Notiz → Spalte der Altersgrenzen
  const NOTE_SOURCES = {
    Likes: 'interaktionen', Sticker: 'interaktionen', Nachrichten: 'interaktionen', Benachrichtigungen: 'interaktionen', Interaktionen: 'interaktionen',
    Besucher: 'besucher', Profilbesucher: 'besucher', Gruppen: 'gruppen', Suche: 'suche', Mitgliedersuche: 'suche',
    Vorgemerkt: 'suche', Sync: 'sync', Events: 'party', Partygäste: 'party', Profil: 'besucher', Warteliste: 'suche',
  };
  const ages3 = (a, b, c) => ({ global: [a, b, c], interaktionen: [a, b, c], besucher: [a, b, c], party: [a, b, c], gruppen: [a, b, c], suche: [a, b, c] });

  const DEFAULTS = {
    groups: {
      m: { visual: true, ignore: true, ageVisual: false, ageIgnore: false, types: ['m'], src: ages3(29, 48, 50),
        labels: ['Jungspund', 'Jungspunde', 'Mann', 'Männer', 'Opa', 'Opas'] },
      w: { visual: false, ignore: false, ageVisual: false, ageIgnore: false, types: ['w'], src: ages3(29, 48, 50),
        labels: ['junge Frau', 'junge Frauen', 'Frau', 'Frauen', 'Oma', 'Omas'] },
      p: { visual: false, ignore: false, ageVisual: false, ageIgnore: false, types: ['p'], separate: false, coupleMode: 'any',
        src: ages3(29, 48, 50), srcW: ages3(29, 48, 50), srcM: ages3(29, 48, 50),
        sugarDaddy: { on: false, gap: 15 }, sugarMom: { on: false, gap: 15 },
        labels: ['junges Paar', 'junge Paare', 'Paar', 'Paare', 'Geronto-Paar', 'Geronto-Paare'] },
    },
    // Moppel-Liebhaber: Figur-Stufen nach BMI (Griffe = Beginn Stufe 1/2/3; darunter Stufe 0 „Plus-Size“)
    // AWO-Faktor der Events (gemeinsame Formel mit dem JOYclub-Skript): Anwesenheitsquote je Gruppe und Stufe, Gewichtung m/w/p
    awo: { quota: { m: [33, 66, 95], w: [95, 95, 95], p: [90, 90, 90] }, weight: [67, 0, 33] },
    moppel: { on: false, bmi: [25, 40, 45], labels: ['Kurvig', 'Kurvige', 'Üppig', 'Üppige', 'XXL', 'XXL'], radius: 100, types: ['m', 'w'] },
    warnYears: 1,                 // so viele Jahre vor „Ignorieren ab“: dunkelorange + vormerken
    watch: true,
    whitelist: {
      names: [{ n: 'Wildschwein_AC', g: '' }],
      groups: [],
      prefixes: ['Pop-MOD-'],
    },
    auto: { besucher: true, suche: true, interaktionen: true },   // auf der Seite automatisch auf die Warteliste
    autoLogin: true,
    autoLoginPauseMin: 30,
    maintenanceMin: 15,
    groupScan: {},                // cms_id → false = beim Gruppen-Scan auslassen (Standard: alle)
    managedWhitelist: {},         // cms_id → false = Mitglieder NICHT whitelisten (Standard: whitelisten)
    expert: {
      sharedLimits: true,           // „Gemeinsame Grenzen für alle Quellen“: nur die Zeile „Global“ gilt
      debug: false,
      dryRun: false,
      firstScanMax: 1000,
      limit: 10000000,
      rank: ['interaktionen', 'besucher', 'party', 'gruppen', 'suche', 'sync'],
      writeNote: true,              // fest (nicht mehr einstellbar)
      noteRequired: true,           // fest: ohne Notiz keine Sperre (nicht mehr einstellbar)
      noteText: '{bezeichnung} ({quelle}) geblockt am {datum} um {uhrzeit}',
      pauseMin: 1,
      pauseMax: 3,
      bodyValidDays: 90,
      bodyUnknownDays: 30,
      groupGraceDays: 30,
      recorder: false,
      evil: [],                     // „Besonders böse Popsters“: User-IDs oder Nicknames, je Zeile einer
    },
  };

  // ---------- flach ↔ verschachtelt ----------
  function flatten(o, pre = '', out = {}) {
    for (const [k, v] of Object.entries(o)) {
      const p = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, p, out);
      else out[p] = v;
    }
    return out;
  }
  function getPath(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }
  function setPath(o, p, v) {
    const ks = p.split('.'); let x = o;
    for (let i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null || typeof x[ks[i]] !== 'object') x[ks[i]] = {}; x = x[ks[i]]; }
    x[ks[ks.length - 1]] = v;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const K_SETTINGS = 'vaf2_settings';      // { path: { v, src } }  nur Abweichungen vom Quelltext
  let SETTINGS = null;

  function loadSettings() {
    const stored = GM_getValue(K_SETTINGS, {}) || {};
    const s = clone(DEFAULTS);
    const flatDef = flatten(DEFAULTS);
    // 2.29: neue Quelle „Global“ übernimmt anfangs die Werte von „Interaktionen“
    for (const gk of Object.keys(DEFAULTS.groups)) for (const key of ['src', 'srcW', 'srcM']) {
      const pre = `groups.${gk}.${key}`;
      if (!(pre + '.global' in stored) && stored[pre + '.interaktionen']) stored[pre + '.global'] = { ...stored[pre + '.interaktionen'] };
    }
    for (const [p, e] of Object.entries(stored)) {
      if (!e || typeof e !== 'object' || !('v' in e)) continue;
      if (p.startsWith('groupReq.')) continue;   // 2.29: Einstellung „Gruppenanfragen: Gruppen“ entfernt
      const def = p in flatDef ? flatDef[p] : getPath(DEFAULTS, p);
      // Quelltext geändert → der neue Quelltext-Wert gilt
      // 2.1: Pop-MOD-Klarsinn aus dem Quelltext entfernt (über das Präfix „Pop-MOD-“ abgedeckt) – eigene Namen bleiben
      if (p === 'whitelist.names' && Array.isArray(e.v) && Array.isArray(e.src)) {
        const drop = (a) => a.filter((x) => (x && x.n) !== 'Pop-MOD-Klarsinn');
        if (same(def, drop(e.src))) { setPath(s, p, clone(drop(e.v))); continue; }
      }
      if (def !== undefined && !same(def, e.src)) continue;
      setPath(s, p, clone(e.v));
    }
    normalizeSettings(s);
    // 2.38: nur noch im Quelltext (in der Oberfläche nicht mehr änderbar) – gespeicherte Werte gelten nicht mehr
    for (const k of ['pauseMin', 'pauseMax', 'bodyValidDays', 'bodyUnknownDays', 'groupGraceDays']) s.expert[k] = DEFAULTS.expert[k];
    SETTINGS = s;
    return s;
  }
  // Feste Werte und Kopplungen, die auf der Seite nicht (mehr) einstellbar sind
  function normalizeSettings(s) {
    // Notiz: immer schreiben, Pflicht, fester Text
    s.expert.writeNote = true;
    s.expert.noteRequired = true;
    s.expert.noteText = DEFAULTS.expert.noteText;
    // Partygäste (gibt es auf poppen.de nicht, ausgeblendet) = Profilbesucher
    for (const k of Object.keys(s.groups || {})) {
      const g = s.groups[k];
      for (const key of ['src', 'srcW', 'srcM']) {
        if (!g[key]) continue;
        if (g[key].besucher) g[key].party = [...g[key].besucher];
        for (const k of LIM_KEYS) if (Array.isArray(g[key][k])) g[key][k] = g[key][k].map((x) => Math.max(18, Math.min(AGE_MAX, Number(x) || 18)));
      }
    }
    return s;
  }
  // Ganze Einstellungen speichern: nur Abweichungen vom Quelltext werden abgelegt
  function saveSettings(s) {
    s = normalizeSettings(clone(s));
    const flat = flatten(s);
    const flatDef = flatten(DEFAULTS);
    const out = {};
    const paths = new Set([...Object.keys(flat), ...Object.keys(flatDef)]);
    // Container ohne Unterschlüssel (z. B. groupScan = {}) als Ganzes vergleichen
    for (const p of paths) {
      const v = p in flat ? flat[p] : getPath(s, p);
      const def = p in flatDef ? flatDef[p] : getPath(DEFAULTS, p);
      if (!same(v, def)) out[p] = { v: clone(v), src: clone(def) };
    }
    GM_setValue(K_SETTINGS, out);
    SETTINGS = clone(s);
    Bus.emit('settings', SETTINGS);
  }
  const S = () => SETTINGS || loadSettings();
  // Weicht ein Wert vom Quelltext ab?
  const deviates = (path, s = S()) => !same(getPath(s, path), getPath(DEFAULTS, path));

  // Schalter „Opa-Schutz“ im Profil-Menü (Automatik an/aus)
  const K_ON = 'vaf2_on';
  const isOn = () => GM_getValue(K_ON, true) !== false;
  const setOn = (v) => { GM_setValue(K_ON, !!v); Bus.emit('on', !!v); };
  const dry = () => !!S().expert.dryRun;

  // =====================================================================================
  // Speicher
  //  - Kleine Daten (Einstellungen, Zustände, Sperren der Tabs): Tampermonkey-Speicher
  //  - Gesamtliste aller Mitglieder, Bilder, Profil-Archiv, Warteliste, Fickliste, Rekorder:
  //    Datenbank des Browsers (IndexedDB) – jeder Eintrag wird einzeln gelesen/geschrieben.
  // =====================================================================================
  // ---------- Altbestand (bis 2.31): unverschlüsselte Datenbank „opa-schutz“ – nur noch zum Umzug gelesen ----------
  const OLD_DB_NAME = 'opa-schutz';
  const OLD_STORES = ['members', 'images', 'archive', 'queue', 'fick', 'kv'];
  function openOldDb() {
    return new Promise((resolve) => {
      let created = false;
      const rq = IDB.open(OLD_DB_NAME);
      rq.onupgradeneeded = () => { created = true; };            // gab es nicht → leer
      rq.onsuccess = () => { const d = rq.result; if (created || !d.objectStoreNames.length) { d.close(); if (created) IDB.deleteDatabase(OLD_DB_NAME); resolve(null); } else resolve(d); };
      rq.onerror = () => resolve(null);
    });
  }

  // ---------- Lokale Datenbank auf poppen.de: verschlüsselt, mit unauffälligem Namen ----------
  //  Schlüssel (AES-GCM + HMAC) im Tampermonkey-Speicher und als Kopie im Briefkasten (für eine Neuinstallation).
  //  Datensatz: { i: HMAC(Schlüssel), n?: HMAC(Nick-Index), d: IV + Chiffrat }. poppen.de sieht nur unlesbare Bytes.
  const DB_NAME = 'keyval-cache';
  const DB_VER = 1;
  const PHYS = { members: 'a', images: 'b', queue: 'c', kv: 'd', archive: 'e' };
  const KEYPATH = { members: 'uid', images: 'uid', queue: 'uid', kv: 'k', archive: 'id' };
  const IDXF = { members: 'nl', archive: 'uid' };   // je Ablage ein (gehashter) Suchindex
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((resolve, reject) => {
      const rq = IDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        for (const ps of Object.values(PHYS)) {
          if (d.objectStoreNames.contains(ps)) continue;
          const st = d.createObjectStore(ps, { keyPath: 'i' });
          st.createIndex('n', 'n', { unique: false });
        }
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    return dbP;
  }
  const reqP = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const B64 = { enc: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
    dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
  const Crypt = (() => {
    let ready = null, aes = null, mac = null, locked = '';
    const hcache = new Map();
    const te = new TextEncoder(), td = new TextDecoder();
    async function importRaw(raw) {
      const u = B64.dec(raw);
      aes = await SUB.importKey('raw', u.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
      mac = await SUB.importKey('raw', u.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }
    async function load() {
      let raw = GM_getValue('vaf2_dbk', null);
      if (!raw) {
        // Neuinstallation? Schlüssel aus dem Briefkasten holen (dort liegt eine Kopie)
        try { const r = await BkRpc.call('get', { s: 'meta', k: 'poppen_dbk' }, 20000); if (r && r.v) { raw = r.v; GM_setValue('vaf2_dbk', raw); log('Datenbank-Schlüssel aus dem Briefkasten wiederhergestellt'); } } catch {}
      }
      if (!raw) {
        const d = await db();
        const n = await reqP(d.transaction(PHYS.members).objectStore(PHYS.members).count()).catch(() => 0);
        if (n > 0) { locked = 'Schlüssel fehlt – Briefkasten nicht erreichbar'; throw new Error(locked); }
        const u = SUB.rnd(new Uint8Array(64));
        raw = B64.enc(u);
        GM_setValue('vaf2_dbk', raw);
        GM_setValue('vaf2_dbk_bk', 0);
      }
      await importRaw(raw);
      return true;
    }
    return {
      init() { if (!ready) ready = load().catch((e) => { ready = null; throw e; }); return ready; },
      get locked() { return locked; },
      async hk(s) {
        s = String(s);
        const c = hcache.get(s); if (c) return c;
        await this.init();
        const sig = new Uint8Array(await SUB.sign('HMAC', mac, te.encode(s)));
        const out = B64.enc(sig.subarray(0, 18)).replace(/\+/g, '-').replace(/\//g, '_');
        if (hcache.size > 60000) hcache.clear();
        hcache.set(s, out);
        return out;
      },
      async enc(obj) {
        await this.init();
        const iv = SUB.rnd(new Uint8Array(12));
        const ct = new Uint8Array(await SUB.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(JSON.stringify(obj))));
        const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
        return out;
      },
      async dec(u8) {
        await this.init();
        const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
        const pt = await SUB.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, aes, b.subarray(12));
        return JSON.parse(td.decode(pt));
      },
      raw: () => GM_getValue('vaf2_dbk', null),
    };
  })();
  async function encRec(store, val) {
    if (store === 'archive' && (val.id === undefined || val.id === null)) val.id = `${val.uid}:${val.at || now()}:${Math.random().toString(36).slice(2, 7)}`;
    const rec = { i: await Crypt.hk(store + ':' + val[KEYPATH[store]]), d: await Crypt.enc(val) };
    const f = IDXF[store];
    if (f && val[f] != null && val[f] !== '') rec.n = await Crypt.hk(f + ':' + val[f]);
    return rec;
  }
  const decRec = (r) => (r ? Crypt.dec(r.d) : null);
  async function tx(store, mode = 'readonly') { await Crypt.init(); return (await db()).transaction(PHYS[store], mode).objectStore(PHYS[store]); }
  const DB = {
    async get(store, key) { const k = await Crypt.hk(store + ':' + key); const r = await reqP((await tx(store)).get(k)); return r ? decRec(r) : undefined; },
    async put(store, val) { const rec = await encRec(store, val); return reqP((await tx(store, 'readwrite')).put(rec)); },
    async del(store, key) { const k = await Crypt.hk(store + ':' + key); return reqP((await tx(store, 'readwrite')).delete(k)); },
    async clear(store) { return reqP((await tx(store, 'readwrite')).clear()); },
    async all(store) { const l = await reqP((await tx(store)).getAll()); const out = []; for (let i = 0; i < l.length; i += 500) out.push(...await Promise.all(l.slice(i, i + 500).map(decRec))); return out; },
    async count(store) { return reqP((await tx(store)).count()); },
    async byIndex(store, index, key) { const l = await reqP((await tx(store)).index('n').getAll(await Crypt.hk(index + ':' + key))); return Promise.all(l.map(decRec)); },
    async putMany(store, vals) {
      if (!vals.length) return;
      const recs = [];
      for (let i = 0; i < vals.length; i += 500) recs.push(...await Promise.all(vals.slice(i, i + 500).map((v) => encRec(store, v))));
      const d = await db();
      await new Promise((res, rej) => {
        const t = d.transaction(PHYS[store], 'readwrite');
        const st = t.objectStore(PHYS[store]);
        for (const r of recs) st.put(r);
        t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    },
    async delMany(store, keys) {
      if (!keys.length) return;
      const ks = await Promise.all(keys.map((k) => Crypt.hk(store + ':' + k)));
      const d = await db();
      await new Promise((res, rej) => {
        const t = d.transaction(PHYS[store], 'readwrite');
        const st = t.objectStore(PHYS[store]);
        for (const k of ks) st.delete(k);
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    },
    // Alle Einträge durchgehen, ohne alles auf einmal zu entschlüsseln (Blöcke zu 2000)
    async each(store, fn) {
      await Crypt.init();
      const d = await db();
      let last = null;
      for (;;) {
        const batch = await new Promise((res, rej) => {
          const out = [];
          const range = last == null ? null : IDBKeyRange.lowerBound(last, true);
          const rq = d.transaction(PHYS[store]).objectStore(PHYS[store]).openCursor(range);
          rq.onsuccess = () => { const c = rq.result; if (!c || out.length >= 2000) return res(out); out.push(c.value); c.continue(); };
          rq.onerror = () => rej(rq.error);
        });
        if (!batch.length) break;
        last = batch[batch.length - 1].i;
        const vals = await Promise.all(batch.map(decRec));
        for (const v of vals) { try { fn(v); } catch (e) { warn(e); } }
        if (batch.length < 2000) break;
      }
    },
  };
  // Datei-Griffe (FileSystemFileHandle) lassen sich nicht als JSON verschlüsseln → eigene kleine Datenbank,
  // in der nur der Griff selbst liegt (kein Inhalt; lesen kann man die Datei nur mit der Browser-Erlaubnis).
  const HandleStore = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => { const rq = IDB.open('keyval-cache-h', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('h'); rq.onsuccess = () => res(rq.result); rq.onerror = () => { p = null; rej(rq.error); }; }));
    const run = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('h', mode); const r = fn(t.objectStore('h')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
    return { get: (k) => run('readonly', (s) => s.get(k)), set: (k, v) => run('readwrite', (s) => s.put(v, k)) };
  })();
  const KV = {
    async get(k, def = null) { const r = await DB.get('kv', k); return r ? r.v : def; },
    async set(k, v) { await DB.put('kv', { k, v }); chan.post({ t: 'kv', k }); },
  };

  // ---------- Tab-übergreifende Benachrichtigung ----------
  const chan = (() => {
    let bc = null;
    try { bc = new BroadcastChannel('opa-schutz'); } catch {}
    const h = new Set();
    if (bc) bc.onmessage = (e) => h.forEach((f) => { try { f(e.data); } catch {} });
    return { post(m) { try { bc && bc.postMessage(m); } catch {} }, on(f) { h.add(f); } };
  })();

  // ---------- Mitglieder-Gesamtliste mit Zwischenspeicher ----------
  // Ein Eintrag je Mitglied (Schlüssel: Benutzer-ID). Änderungen werden gesammelt und etwa
  // alle 2 Sekunden auf einmal geschrieben, beim Verlassen der Seite sofort.
  //   { uid, nick, nl, nicks[], g[], ages[], ageAt, birth[{lo,hi}], by[], zod[], pay, avatar, img,
  //     first, last, seen{Quelle: ts}, body[{h,wlo,whi,at}], bodyUnk, blk{at,src,note,opa}, unblk,
  //     auto{admin, friend, grp{cms:ts}, gone}, friend, friendAt, del, city }
  const Members = (() => {
    const cache = new Map();
    const dirty = new Set();
    let timer = null;
    chan.on((m) => { if (m && m.t === 'm') for (const u of m.u) cache.delete(u); });
    async function flush() {
      timer = null;
      if (!dirty.size) return;
      const ids = [...dirty]; dirty.clear();
      const vals = ids.map((u) => cache.get(u)).filter(Boolean);
      try { await DB.putMany('members', vals); chan.post({ t: 'm', u: ids }); }
      catch (e) { warn('Speichern fehlgeschlagen', e); ids.forEach((u) => dirty.add(u)); }
    }
    W.addEventListener('pagehide', () => { flush(); });
    const sched = () => { if (!timer) timer = setTimeout(flush, 2000); };
    return {
      async get(uid) {
        uid = String(uid);
        if (cache.has(uid)) return cache.get(uid);
        const m = await DB.get('members', uid);
        if (m) cache.set(uid, m);
        return m || null;
      },
      async byNick(nick) {
        const l = norm(nick);
        for (const m of cache.values()) if (m.nl === l) return m;
        const r = await DB.byIndex('members', 'nl', l);
        if (!r.length) return null;
        r.sort((a, b) => (b.last || 0) - (a.last || 0));
        cache.set(r[0].uid, r[0]);
        return r[0];
      },
      // Eintrag ändern: fn(m) bekommt den (ggf. neuen) Eintrag und ändert ihn
      async update(uid, fn) {
        uid = String(uid);
        if (!uid || uid === 'undefined') return null;
        const m = (await this.get(uid)) || { uid, first: now() };
        fn(m);
        if (m.nick) m.nl = norm(m.nick);
        cache.set(uid, m);
        if (typeof mirMark === 'function') mirMark(uid);
        dirty.add(uid); sched();
        return m;
      },
      put(m) { cache.set(m.uid, m); dirty.add(m.uid); sched(); },
      flush,
      cached: () => cache,
      async all() { await flush(); return DB.all('members'); },
      async each(fn) { await flush(); return DB.each('members', fn); },
      async count() { await flush(); return DB.count('members'); },
    };
  })();

  // ---------- Tab-Sperre: nur ein Tab arbeitet an einer Aufgabe ----------
  const Lock = (() => {
    const STALE = 30000;
    const key = (what) => 'vaf2_lock_' + what;
    const held = new Set();
    setInterval(() => {
      for (const w of held) {
        const l = GM_getValue(key(w), null);
        if (l && l.tab === TAB_ID) GM_setValue(key(w), { ...l, ts: now() });
        else held.delete(w);
      }
    }, 5000);
    return {
      async take(what, info = '') {
        const l = GM_getValue(key(what), null);
        if (l && l.tab !== TAB_ID && now() - l.ts < STALE) return false;
        GM_setValue(key(what), { tab: TAB_ID, ts: now(), info, page: location.pathname });
        await sleep(200 + Math.random() * 300);
        const l2 = GM_getValue(key(what), null);
        if (l2 && l2.tab === TAB_ID) { held.add(what); return true; }
        return false;
      },
      release(what) { const l = GM_getValue(key(what), null); if (l && l.tab === TAB_ID) GM_deleteValue(key(what)); held.delete(what); },
      other(what) { const l = GM_getValue(key(what), null); return l && l.tab !== TAB_ID && now() - l.ts < STALE ? l : null; },
    };
  })();
  W.addEventListener('pagehide', () => { try { for (const k of GM_listValues()) if (k.startsWith('vaf2_lock_')) { const l = GM_getValue(k, null); if (l && l.tab === TAB_ID) GM_deleteValue(k); } } catch {} });

  // ---------- kleine Zustände ----------
  const G = {
    get: (k, d) => GM_getValue('vaf2_' + k, d),
    set: (k, v) => GM_setValue('vaf2_' + k, v),
    del: (k) => GM_deleteValue('vaf2_' + k),
  };

  // ---------- Briefkasten-Aufrufe (Seite → unsichtbarer Rahmen auf github.io) ----------
  //  Weg über den Tampermonkey-Speicher (nur die Skript-Instanzen sehen ihn, poppen.de nicht):
  //  Anfragen in vaf2_rpcq_<Tab>, Antworten in vaf2_rpcr_<Tab>; der Rahmen dieses Tabs bearbeitet sie.
  const BkRpc = (() => {
    const qk = 'rpcq_' + TAB_ID, rk = 'rpcr_' + TAB_ID, ak = 'rpca_' + TAB_ID;
    const pend = new Map();
    let seq = 0, listening = false;
    function listen() {
      if (listening) return; listening = true;
      try {
        GM_addValueChangeListener('vaf2_' + rk, (n, o, v) => {
          const done = [];
          for (const r of v || []) { const p = pend.get(r.id); if (!p) continue; pend.delete(r.id); done.push(r.id); if (r.err) p.rej(Object.assign(new Error(r.err), { code: r.code })); else p.res(r.v); }
          if (done.length) { const q = (G.get(qk, []) || []).filter((x) => !done.includes(x.id) && pend.has(x.id)); G.set(qk, q); }
        });
      } catch (e) { warn('Briefkasten-Aufrufe', e); }
      W.addEventListener('pagehide', () => { try { G.del(qk); G.del(rk); G.del(ak); } catch {} });
    }
    const alive = () => now() - (G.get(ak, 0) || 0) < 15000;
    async function waitAlive(ms) { const t0 = now(); while (!alive()) { if (now() - t0 > ms) return false; await sleep(250); } return true; }
    async function call(op, args, timeout = 15000) {
      listen();
      if (typeof bkEmbed === 'function') bkEmbed(true);
      if (!(await waitAlive(timeout))) throw Object.assign(new Error('Briefkasten nicht erreichbar'), { code: 'offline' });
      return new Promise((res, rej) => {
        const id = (++seq) + '.' + now().toString(36);
        pend.set(id, { res, rej });
        const q = G.get(qk, []) || []; q.push({ id, op, args }); G.set(qk, q);
        setTimeout(() => { if (pend.has(id)) { pend.delete(id); const q2 = (G.get(qk, []) || []).filter((x) => x.id !== id); G.set(qk, q2); rej(Object.assign(new Error('Briefkasten antwortet nicht'), { code: 'timeout' })); } }, timeout);
      });
    }
    return { call, alive, waitAlive, tab: TAB_ID };
  })();

  // =====================================================================================
  // Schnittstellen (v2-api)
  //  - eigene Abfragen laufen über das Original-fetch (ohne Umweg über die Mitschnitte)
  //  - Abfragen der Seite selbst werden beobachtet: Mitglieder-Infos nebenbei merken,
  //    API-Rekorder, Antworten der Suche umsortieren (Figur-Badges)
  //  - Kopfzeilen, die die Seite selbst mitschickt, werden für eigene Abfragen übernommen
  //    (nur im Arbeitsspeicher, nie gespeichert oder exportiert)
  // =====================================================================================
  const origFetch = W.fetch.bind(W);
  const XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
  const xOpen = XO && XO.open, xSend = XO && XO.send, xSet = XO && XO.setRequestHeader;
  const descRT = XO && Object.getOwnPropertyDescriptor(XO, 'responseText');
  const descR = XO && Object.getOwnPropertyDescriptor(XO, 'response');
  let mirror = null;              // Kopfzeilen der Seite (ohne Cookie/Länge)
  const SKIP_HEADERS = /^(content-length|cookie|host|content-type)$/i;

  function captureHeaders(h) {
    if (!h) return;
    const out = {};
    try {
      if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { out[k] = v; });
      else if (Array.isArray(h)) h.forEach(([k, v]) => { out[k] = v; });
      else Object.assign(out, h);
    } catch { return; }
    const m = {};
    for (const [k, v] of Object.entries(out)) if (!SKIP_HEADERS.test(k)) m[k] = String(v);
    if (Object.keys(m).length || !mirror) mirror = m;
  }

  // ---------- Beobachter für Antworten der Seite ----------
  const RespHooks = [];   // { re, onData(data, info), rewrite(data, info) → neue Daten oder null }
  function onApi(re, onData, rewrite) { RespHooks.push({ re, onData, rewrite }); }
  // Antworten mit Fehlercode (code ≠ 0) beobachten, z. B. „Nachrichtenfilter“ (20903)
  const ErrHooks = [];
  function onApiErr(re, fn) { ErrHooks.push({ re, fn }); }

  function parseBody(b) {
    if (b == null) return null;
    if (typeof b === 'string') { try { return JSON.parse(b); } catch { try { return Object.fromEntries(new URLSearchParams(b)); } catch { return b; } } }
    if (b instanceof W.URLSearchParams) return Object.fromEntries(b);
    if (b instanceof W.FormData) { const o = {}; b.forEach((v, k) => { o[k] = typeof v === 'string' ? v : '[Datei]'; }); return o; }
    return null;
  }
  function handleResponse(method, url, reqBody, text) {
    let u;
    try { u = new URL(url, location.origin); } catch { return null; }
    const path = u.pathname.replace(/^\/v2-api\//, '');
    const info = { method: String(method || 'GET').toUpperCase(), path, query: Object.fromEntries(u.searchParams), body: parseBody(reqBody), page: location.pathname };
    let json;
    try { json = JSON.parse(text); } catch { return null; }
    if (!Owner.mayWrite()) return null;            // fremdes Konto angemeldet: nichts mitschreiben
    try { Recorder.add(info, json); } catch (e) { warn('Rekorder', e); }
    if (json && json.code !== 0) { for (const h of ErrHooks) if (h.re.test(path)) { try { h.fn(json, info); } catch (e) { warn('Fehler-Hook', path, e); } } }
    if (!json || json.code !== 0) return null;
    let data = json.data, changed = false;
    for (const h of RespHooks) {
      if (!h.re.test(path)) continue;
      if (h.onData) { try { const r = h.onData(data, info); if (r && r.catch) r.catch((e) => warn('Hook', path, e)); } catch (e) { warn('Hook', path, e); } }
      if (h.rewrite) { try { const nd = h.rewrite(data, info); if (nd) { data = nd; changed = true; } } catch (e) { warn('Umschreiben', path, e); } }
    }
    return changed ? JSON.stringify({ ...json, data }) : null;
  }

  // ---------- Abfragen der Seite unterdrücken (z. B. poppens eigene Suche auf der XXL-Seite) ----------
  //  fn(method, path) → Ersatz-Antwort ({ code, data }) oder null. Die Abfrage geht dann gar nicht erst raus.
  // Anfragen der Seite vor dem Absenden umschreiben (JSON-Body): fn(method, path, body) → neuer Body oder null
  const ReqRewrites = [];
  function rewritePageRequest(fn) { ReqRewrites.push(fn); }
  function reqRewritten(method, url, bodyText) {
    if (!ReqRewrites.length || typeof bodyText !== 'string') return null;
    let path = '';
    try { path = new URL(url, location.origin).pathname.replace(/^\/v2-api\//, ''); } catch { return null; }
    let b; try { b = JSON.parse(bodyText); } catch { return null; }
    let changed = false;
    for (const fn of ReqRewrites) { try { const nb = fn(String(method || 'GET').toUpperCase(), path, b); if (nb) { b = nb; changed = true; } } catch {} }
    return changed ? JSON.stringify(b) : null;
  }
  const PageBlocks = [];
  function blockPageApi(fn) { PageBlocks.push(fn); }
  function pageBlocked(method, url) {
    if (!PageBlocks.length) return null;
    let path = '';
    try { path = new URL(url, location.origin).pathname.replace(/^\/v2-api\//, ''); } catch { return null; }
    for (const fn of PageBlocks) { try { const r = fn(String(method || 'GET').toUpperCase(), path); if (r) return r; } catch {} }
    return null;
  }

  // fetch der Seite
  if (ON_POPPEN) {
  W.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!/\/v2-api\//.test(url)) return origFetch(input, init);
    let method = (init && init.method) || (input && input.method) || 'GET';
    const fake = pageBlocked(method, url);
    if (fake) return new Response(JSON.stringify(fake), { status: 200, headers: { 'content-type': 'application/json' } });
    if (init && typeof init.body === 'string') { const nb = reqRewritten(method, url, init.body); if (nb != null) { init = { ...init, body: nb }; } }
    let body = init && init.body;
    try { captureHeaders((init && init.headers) || (input && input.headers)); } catch {}
    if (body == null && input && typeof input.clone === 'function' && method !== 'GET') { try { body = await input.clone().text(); } catch {} }
    const res = await origFetch(input, init);
    try {
      const ct = res.headers.get('content-type') || '';
      if (!/json/i.test(ct)) return res;
      const text = await res.clone().text();
      const nt = handleResponse(method, url, body, text);
      if (nt != null) return new Response(nt, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) { warn('fetch-Beobachter', e); }
    return res;
  };

  // XMLHttpRequest der Seite
  if (XO) {
    XO.open = function (m, u) { this.__vaf = { m, u: String(u), h: {} }; return xOpen.apply(this, arguments); };
    XO.setRequestHeader = function (k, v) { if (this.__vaf) this.__vaf.h[k] = v; return xSet.apply(this, arguments); };
    XO.send = function (body) {
      const inf = this.__vaf;
      if (inf && /\/v2-api\//.test(inf.u)) {
        if (typeof body === 'string') { const nb = reqRewritten(inf.m, inf.u, body); if (nb != null) { body = nb; } }
        const fake = pageBlocked(inf.m, inf.u);
        if (fake) {   // Ersatz-Antwort: gleiche XHR auf eine data:-Adresse umlenken (kein Netzverkehr)
          try { xOpen.call(this, 'GET', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(fake)), true); return xSend.call(this, null); } catch {}
        }
        captureHeaders(inf.h);
        const xhr = this;
        let done = false, rewritten = null;
        const ensure = () => {
          if (done || xhr.readyState !== 4) return;
          done = true;
          try {
            const rt = descRT.get.call(xhr);
            rewritten = handleResponse(inf.m, inf.u, body, rt);
          } catch { rewritten = null; }
        };
        try {
          Object.defineProperty(xhr, 'responseText', { configurable: true, get() { ensure(); return rewritten != null ? rewritten : descRT.get.call(xhr); } });
          Object.defineProperty(xhr, 'response', { configurable: true, get() {
            ensure();
            if (rewritten == null) return descR.get.call(xhr);
            return xhr.responseType === 'json' ? JSON.parse(rewritten) : rewritten;
          } });
        } catch {}
        xhr.addEventListener('readystatechange', ensure);
      }
      return xSend.call(this, body);
    };
  }
  }   // Ende if (ON_POPPEN): Seiten-Hooks nur auf poppen.de

  // ---------- eigene Abfragen ----------
  class ApiError extends Error { constructor(msg, code, status) { super(msg); this.code = code; this.status = status; } }
  let apiCount = 0;
  async function api(path, { method = 'GET', query = null, body = null } = {}) {
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString() : '';
    const url = location.origin + '/v2-api/' + path + qs;
    const attempt = async () => {
      const headers = { Accept: 'application/json, text/plain, */*', ...(mirror || {}) };
      if (body != null) headers['Content-Type'] = 'application/json';
      const res = await origFetch(url, { method, credentials: 'include', headers, body: body != null ? JSON.stringify(body) : undefined });
      apiCount++;
      let j = null;
      try { j = await res.json(); } catch { throw new ApiError(`Antwort ist kein JSON (HTTP ${res.status})`, -1, res.status); }
      if (!res.ok && (!j || j.code === undefined)) throw new ApiError(`HTTP ${res.status}`, -1, res.status);
      if (!j || j.code !== 0) throw new ApiError((j && (j.msg || j.message || j.error)) || `Fehlercode ${j && j.code}`, j && j.code, res.status);
      return j.data;
    };
    try { return await attempt(); }
    catch (e) {
      // Noch keine Kopfzeilen der Seite gesehen? Kurz warten und einmal wiederholen
      if (!mirror && (e.status === 401 || e.status === 403 || e.code === -1)) {
        await waitFor(() => mirror, 8000);
        return attempt();
      }
      throw e;
    }
  }
  const apiGet = (path, query) => api(path, { method: 'GET', query });
  const apiPost = (path, body, query) => api(path, { method: 'POST', body, query });

  // ---------- API-Rekorder ----------
  // Schneidet Abfragen der Seite mit (nur neue Muster, je 2 Beispiele, Listen gekürzt, Sensibles geschwärzt).
  const KNOWN_API = ['v2/ignore/list', 'ignore/uid/list', 'ignore/add', 'ignore/delete', 'ignore/comment/add', 'user/search', 'rates',
    'my/received/gift', 'group/my', 'group/attendee/list', 'messenger/group/list', 'messenger/p2p/profile/display', 'user/session/info',
    'wio/state', 'messenger/message/list', 'messenger/backend/settings', 'v2/comment/list', 'friends/list', 'favourite/list', 'group/moderator/list',
    'group/profile', 'group/attendee/manage/list', 'group/attendee/kick', 'group/attendee/note', 'profile/visitors', 'group/attendee/specific/pending/list', 'group/attendee/deny', 'v3/profile/gallery', 'ignore/be-ignored/uid/list', 'global/emojis', 'i18n/pull', 'notification/msg/list', 'user/list/relationship'];
  const API_HINTS = [
    [/^\/connection\/visitors/, '#1 Profilbesucher'], [/^\/groups\/\d+\/requests/, '#2/#3 Gruppenanfragen'],
    [/^\/p\//, '#4/#8/#11 Profil'], [/^\/search\/member/, '#10 Suchseite'],
  ];
  const REDACT_KEYS = /(e-?mail|pass(word|wd)?|token|secret|session_?id|auth|dino_client|cookie|phone|telefon|mobile)/i;
  const TEXT_KEYS = /^(content|description|private_description|text|message|body_text|about|desc|private_comment|public_comment|friendComment|note|media_note|wishes|profileNote|notes|metrics|status_text)$/i;
  function redact(v, key = '', depth = 0) {
    if (depth > 12) return '…';
    if (key && REDACT_KEYS.test(key)) return '«entfernt»';
    if (key && TEXT_KEYS.test(key) && typeof v === 'string') return v ? '«entfernt»' : '';
    if (key && /^(answers)$/i.test(key) && v && typeof v === 'object') return '«entfernt»';             // Interview-Antworten
    if (key && /^birthday$/i.test(key)) return Array.isArray(v) ? v.map((b) => (typeof b === 'string' ? b.slice(0, 4) + '-…' : b)) : v;   // nur das Jahr
    // Text, der selbst JSON enthält (z. B. data beim Senden): auspacken und mitschwärzen
    if (typeof v === 'string' && /^\s*[{[]/.test(v)) { try { const j = JSON.parse(v); return JSON.stringify(redact(j, key, depth + 1)); } catch {} }
    if (key && /^(geo_location|location)$/i.test(key) && v && typeof v === 'object' && !Array.isArray(v)) return { city: v.city || '' };
    if (key && /^(lat|lon|latitude|longitude|zipcode)$/i.test(key)) return '«entfernt»';
    if (Array.isArray(v)) {
      const cap = 50;   // volle (kurze) Arrays behalten – nötig fürs Wert-Mapping (searching, genders …)
      const head = v.slice(0, cap).map((x) => redact(x, '', depth + 1));
      if (v.length > cap) head.push(`… ${v.length - cap} weitere`);
      return head;
    }
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = redact(x, k, depth + 1); return o; }
    if (key && /^(msg_id|id|uid|item_id|refer_id|comment_id|cms_id|group_id)$/i.test(key) && (typeof v === 'string' || typeof v === 'number')) return v;   // Kennungen sind keine Telefonnummern
    if (typeof v === 'string') {
      const t = v.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '«E-Mail»');
      if (/^https?:\/\//i.test(t) || /^\/\w/.test(t)) return t;
      return t.replace(/(?<![\w-])(\+?\d[\d\s/()-]{7,}\d)(?![\w-])/g, '«Telefon»');
    }
    return v;
  }
  const shapeOf = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort().join(',') : typeof o);
  // Für Pfade, bei denen sich die Antwort je Parameterwert unterscheidet, den Wert in den
  // Schlüssel aufnehmen (sonst würde z. B. i18n/pull über alle Module zu einem Eintrag verschmelzen).
  function recVariant(info) {
    const b = info.body || {};
    if (/i18n\/pull/.test(info.path)) return ' module=' + (b.module || '');
    if (/^feed\//.test(info.path)) return ' ' + Object.keys(b).sort().join(',');
    return '';
  }
  const EX_CAP = 12;
  const exSig = (q, b) => JSON.stringify([q, b]);
  // Zwei Recorder-Stände mischen (mehrtab-sicher): Einträge vereinen, Beispiele pro Body behalten.
  function mergeRec(dst, src) {
    dst = dst || {};
    for (const [k, se] of Object.entries(src || {})) {
      const de = dst[k];
      if (!de) { dst[k] = se; continue; }
      de.n = Math.max(de.n || 0, se.n || 0);
      de.first = Math.min(de.first || se.first || 0, se.first || de.first || 0) || de.first;
      de.last = Math.max(de.last || 0, se.last || 0);
      de.known = de.known || se.known;
      if (se.hint && !de.hint) de.hint = se.hint;
      de.pages = de.pages || []; de.examples = de.examples || [];
      for (const p of (se.pages || [])) if (!de.pages.includes(p) && de.pages.length < 10) de.pages.push(p);
      for (const ex of (se.examples || [])) {
        const sig = exSig(ex.query, ex.body);
        if (de.examples.length < EX_CAP && !de.examples.some((x) => exSig(x.query, x.body) === sig)) de.examples.push(ex);
      }
    }
    return dst;
  }
  const Recorder = (() => {
    let data = null, saveT = null, loading = null;
    const load = async () => { if (data) return data; if (!loading) loading = KV.get('recorder', {}).then((d) => (data = d || {})); return loading; };
    return {
      add(info, json) {
        if (!S().expert.recorder) return;
        load().then(() => {
          const key = `${info.method} ${info.path} ?${shapeOf(info.query)} ${shapeOf(info.body)}${recVariant(info)}`;
          const e = data[key] || (data[key] = { method: info.method, path: info.path, known: KNOWN_API.includes(info.path), first: now(), n: 0, examples: [], pages: [] });
          e.n++; e.last = now();
          if (!e.pages.includes(info.page) && e.pages.length < 10) e.pages.push(info.page);
          // pro unterschiedlichem Body/Query ein Beispiel (nicht nur die ersten zwei)
          const rq = redact(info.query), rb = redact(info.body), sig = exSig(rq, rb);
          if (e.examples.length < EX_CAP && !e.examples.some((x) => exSig(x.query, x.body) === sig)) e.examples.push({ page: info.page, query: rq, body: rb, response: redact(json) });
          // Hinweis nur für seitenbezogene Abfragen, nicht für allgemeine (Smileys, Übersetzungen, Zähler …)
          const general = /^(i18n|global|dino|egg-hunt|feedback|fakecheck|fsk18|wio|user\/gaclient|messenger\/(status|irc|backend)|browser-notification|tooltip|points)\b/.test(info.path);
          const hint = !general && API_HINTS.find(([re]) => re.test(info.page));
          if (hint && !e.known) e.hint = 'Kandidat für ' + hint[1];
          // vor dem Speichern mit dem aktuellen GM-Stand mischen, damit parallele Tabs
          // sich nicht gegenseitig überschreiben
          clearTimeout(saveT);
          saveT = setTimeout(() => { KV.get('recorder', {}).then((cur) => { data = mergeRec(cur, data); return KV.set('recorder', data); }).catch(() => {}); }, 1500);
          Bus.emit('recorder');
        });
      },
      async stats() { await load(); const v = Object.values(data); return { total: v.length, fresh: v.filter((x) => !x.known).length }; },
      async export() { await load(); const cur = await KV.get('recorder', {}); data = mergeRec(cur, data); let valuemap; try { valuemap = grValueTableSnapshot(); } catch {} const idres = G.get('idres_test', null); const searchDistances = G.get('search_distances', null); let idresFailed = null; try { idresFailed = idresFails(); } catch {} return { version: VERSION, at: new Date().toISOString(), valuemap, idres, idresFailed, searchDistances, entries: Object.values(data).sort((a, b) => (a.known - b.known) || a.path.localeCompare(b.path)) }; },
      async clear() { data = {}; await KV.set('recorder', {}); Bus.emit('recorder'); },
    };
  })();

  // =====================================================================================
  // Regelwerk: Gruppen, Altersgrenzen je Quelle, Paare, Whitelist, Bezeichnungen, Notizen
  // =====================================================================================
  const GROUP_KEYS = ['m', 'w', 'p'];
  const GROUP_NAMES = { m: 'Männer', w: 'Frauen', p: 'Paare' };
  const TYPE_NAMES = { m: 'Mann', w: 'Frau', p: 'Paar', ts: 'Trans', tv: 'Nicht-binär' };

  // poppen-Typcode eines Mitglieds: m, w, p (zwei Personen), ts, tv
  function typeCode(g) {
    if (!g || !g.length) return '';
    if (g.length > 1 || g[0] === 'p') return 'p';
    return g[0];
  }
  function groupOf(g, s = S()) {
    const t = typeCode(g);
    if (!t) return null;
    return GROUP_KEYS.find((k) => (s.groups[k].types || []).includes(t)) || null;
  }

  // ---------- eigenes Profil, Region ----------
  // Ruhrgebiet (Regionalverband Ruhr): kreisfreie Städte und Kreise
  const RUHR = ['bochum', 'bottrop', 'dortmund', 'duisburg', 'essen', 'gelsenkirchen', 'hagen', 'hamm', 'herne', 'mülheim an der ruhr', 'mülheim',
    'oberhausen', 'castrop-rauxel', 'datteln', 'dorsten', 'gladbeck', 'haltern am see', 'herten', 'marl', 'oer-erkenschwick', 'recklinghausen', 'waltrop',
    'bergkamen', 'bönen', 'fröndenberg', 'holzwickede', 'kamen', 'lünen', 'schwerte', 'selm', 'unna', 'werne', 'breckerfeld', 'ennepetal', 'gevelsberg',
    'hattingen', 'herdecke', 'schwelm', 'sprockhövel', 'wetter', 'witten', 'alpen', 'dinslaken', 'hamminkeln', 'hünxe', 'kamp-lintfort', 'moers',
    'neukirchen-vluyn', 'rheinberg', 'schermbeck', 'sonsbeck', 'voerde', 'wesel', 'xanten'];
  const RHEINLAND = ['aachen', 'herzogenrath', 'alsdorf', 'würselen', 'stolberg', 'eschweiler', 'baesweiler', 'monschau', 'roetgen', 'simmerath',
    'köln', 'bonn', 'düsseldorf', 'neuss', 'mönchengladbach', 'krefeld', 'leverkusen', 'solingen', 'remscheid', 'wuppertal', 'düren', 'euskirchen',
    'heinsberg', 'viersen', 'kleve', 'bergheim', 'frechen', 'hürth', 'kerpen', 'pulheim', 'siegburg', 'troisdorf', 'jülich', 'geilenkirchen', 'erkelenz',
    'hückelhoven', 'übach-palenberg', 'grevenbroich', 'ratingen', 'mettmann', 'langenfeld (rheinland)', 'langenfeld', 'hilden', 'velbert'];
  // Gebiete mit Sonderregeln (das Rheinland ist angelegt, hat aber noch keine Sonderregeln)
  const REGIONS = { ruhr: { cities: RUHR, special: true }, rheinland: { cities: RHEINLAND, special: false } };
  function regionOf(city) {
    const c = norm(city).replace(/\s*\(.*\)$/, '');
    for (const [k, r] of Object.entries(REGIONS)) if (r.cities.includes(c) || r.cities.includes(norm(city))) return k;
    return '';
  }
  // eigenes Profil: { uid, nick, g, cities: [Hauptwohnsitz, Zweitwohnsitz] }
  const Me = {
    get: () => G.get('me', null),
    set: (m) => { G.set('me', m); Bus.emit('me', m); },
    uid: () => (G.get('me', null) || {}).uid || '',
    region() {
      const me = Me.get();
      const special = ((me && me.cities) || []).map(regionOf).filter((r) => r && REGIONS[r].special);
      return special[0] || '';      // genau eines oder mehrere → das zuerst genannte
    },
    male() { const me = Me.get(); return !!me && typeCode(me.g) === 'm'; },
  };
  // „Opa“ / „Oma“ / „Oppa“ / „Omma“
  function word() {
    const ruhr = Me.region() === 'ruhr';
    if (Me.male()) return ruhr ? 'Omma' : 'Oma';
    return ruhr ? 'Oppa' : 'Opa';
  }
  const wordPl = () => word() + 's';
  const REGIONAL = { Opa: 'Oppa', Opas: 'Oppas', Oma: 'Omma', Omas: 'Ommas' };
  function labelsOf(gk, s = S()) {
    const l = [...(s.groups[gk].labels || DEFAULTS.groups[gk].labels)];
    if (Me.region() === 'ruhr') for (const i of [4, 5]) if (REGIONAL[l[i]]) l[i] = REGIONAL[l[i]];
    return l;
  }

  // ---------- Altersgrenzen ----------
  // je Quelle [Stufe 1 bis, Stufe 2 bis, Ignorieren ab]
  const openTop = (x) => (x >= AGE_MAX ? Infinity : x);   // Obergrenze 99 = offenes Ende (auch 100-Jährige)
  function limitsOf(gk, src, person = -1, s = S()) {
    const grp = s.groups[gk];
    const key = s.expert && s.expert.sharedLimits ? 'global' : SRC_KEYS.includes(src) ? src : 'suche';
    const set = gk === 'p' && grp.separate && person >= 0 ? (person === 0 ? grp.srcW : grp.srcM) : grp.src;
    return set[key] || set.interaktionen;
  }
  const srcKeyOf = (src) => (SRC_KEYS.includes(src) ? src : (NOTE_SOURCES[src] || 'suche'));

  // ---------- Whitelist ----------
  function manualWhite(nick, s = S()) {
    const n = norm(nick);
    if (!n) return '';
    if ((s.whitelist.names || []).some((x) => norm(x.n) === n)) return 'Whitelist';
    if ((s.whitelist.prefixes || []).some((p) => p && n.startsWith(norm(p)))) return 'Whitelist (Präfix)';
    return '';
  }
  // automatische Whitelist: Mitarbeiter, Freunde, Favoriten, Gruppen-Leitungen, verwaltete Gruppen (mit Schonfrist)
  function autoWhite(m, s = S()) {
    if (!m) return '';
    if (m.pay === 'site_admin') return 'poppen-Mitarbeiter';
    const a = m.auto || {};
    if (a.friend) return 'Freund';
    if (a.fav) return 'Favorit';
    if (a.lead && Object.keys(a.lead).length) return 'Gruppen-Leitung';
    { const ev = evtWhite(m); if (ev) return ev; }
    const grp = Object.entries(a.grp || {}).filter(([cms]) => s.managedWhitelist[cms] !== false);
    if (grp.length) {
      const grace = s.expert.groupGraceDays * DAY;
      const live = grp.filter(([, ts]) => now() - ts < grace);
      if (live.length) {
        const names = G.get('groupnames', {});
        return 'Mitglied in ' + live.map(([c]) => names[c] || ('Gruppe ' + c)).join(', ');
      }
    }
    return '';
  }
  const whiteReason = (m, nick) => manualWhite(nick || (m && m.nick)) || autoWhite(m);

  // ---------- Einstufung ----------
  // x = { uid, nick, g, ages, pay, auto } (Mitglied oder Treffer), src = Quelle
  // Ergebnis: { gk, stage 0–3, ignore, near, white, unclear, sugar, label }
  function classify(x, src, s = S()) {
    const r = { gk: null, stage: 0, ignore: false, near: false, white: '', unclear: false, sugar: '', label: '', reason: '' };
    const ages = (x.ages || []).filter((a) => a > 0);
    r.gk = groupOf(x.g, s);
    r.white = whiteReason(x, x.nick);
    if (!ages.length || !r.gk) return r;
    const grp = s.groups[r.gk];
    const sk = srcKeyOf(src);
    const mode = r.gk === 'p' ? grp.coupleMode : 'any';
    const per = ages.map((a, i) => {
      const lim = limitsOf(r.gk, sk, ages.length > 1 ? i : -1, s);
      const stage = a <= openTop(lim[0]) ? 1 : a <= openTop(lim[1]) ? 2 : 3;
      return { a, lim, stage, over: a >= lim[2], near: a < lim[2] && a + (s.warnYears || 0) >= lim[2] };
    });
    const pick = (f) => (mode === 'all' ? per.every(f) : per.some(f));
    r.stage = mode === 'all' ? Math.min(...per.map((p) => p.stage)) : Math.max(...per.map((p) => p.stage));
    const over = pick((p) => p.over);
    r.near = !over && pick((p) => p.over || p.near) && s.watch;
    // Sugar Daddy / Sugar Mom (nur Paare: [Frau, Mann])
    if (r.gk === 'p' && ages.length === 2 && x.g && x.g.length === 2) {
      const iw = x.g.indexOf('w'), im = x.g.indexOf('m');
      if (iw >= 0 && im >= 0) {
        const gap = ages[im] - ages[iw];
        if (grp.sugarDaddy.on && gap >= grp.sugarDaddy.gap) r.sugar = 'Sugar Daddy';
        else if (grp.sugarMom.on && -gap >= grp.sugarMom.gap) r.sugar = 'Sugar Mom';
      }
    }
    const lbl = labelsOf(r.gk, s);
    r.label = r.sugar || lbl[(Math.max(1, r.stage) - 1) * 2];
    r.ignore = !!grp.ignore && (over || !!r.sugar) && !r.white;
    if (r.ignore) r.reason = r.sugar ? r.sugar : `über der Grenze (${per.map((p) => p.a).join('/')} ≥ ${per.map((p) => p.lim[2]).join('/')})`;
    if (r.white) { r.near = false; r.reason = r.white; }
    return r;
  }
  // Bezeichnung für Notizen: Stufe-3-Bezeichnung der Gruppe (bzw. Sugar Daddy/Mom)
  function noteWord(x, s = S()) {
    const gk = groupOf(x.g, s) || 'm';
    const c = classify(x, 'suche', s);
    return c.sugar || labelsOf(gk, s)[4];
  }

  // ---------- Notizen ----------
  function makeNote(x, src, when = new Date(), s = S()) {
    const pad = (n) => String(n).padStart(2, '0');
    let t = s.expert.noteText;
    t = src ? t.replace('{quelle}', src) : t.replace(/\s*\(\{quelle\}\)|\s*\{quelle\}/, '');
    return t.replace('{bezeichnung}', noteWord(x, s)).replace('{datum}', `${pad(when.getDate())}.${pad(when.getMonth() + 1)}.${when.getFullYear()}`)
      .replace('{uhrzeit}', `${pad(when.getHours())}:${pad(when.getMinutes())}`);
  }
  // Erkennt Opa-Schutz-Notizen (auch ältere: „Alter Sack (Suche) geblockt am …“)
  const NOTE_RE = /^(.{1,40}?)(?:\s+\(([^)]{1,30})\))?\s+geblockt am\s+(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+um\s+(\d{1,2}):(\d{2}))?/i;
  function parseNote(note) {
    const m = NOTE_RE.exec(String(note || '').trim());
    if (!m) return null;
    const at = new Date(+m[5], +m[4] - 1, +m[3], +(m[6] || 0), +(m[7] || 0)).getTime();
    return { word: m[1], src: m[2] || '', at };
  }
  const isOpaNote = (note) => !!parseNote(note);

  // ---------- Geburtszeiträume ----------
  function birthRange(age, when = new Date()) {
    const hi = new Date(when.getFullYear() - age, when.getMonth(), when.getDate());
    const lo = new Date(when.getFullYear() - age - 1, when.getMonth(), when.getDate() + 1);
    return { lo: isoDay(lo), hi: isoDay(hi) };
  }
  const intersect = (a, b) => { if (!a) return b; if (!b) return a; const lo = a.lo > b.lo ? a.lo : b.lo; const hi = a.hi < b.hi ? a.hi : b.hi; return lo <= hi ? { lo, hi } : null; };
  const yearRange = (y) => ({ lo: `${y}-01-01`, hi: `${y}-12-31` });
  // Sternzeichen (Beginn MM-DD)
  const ZODIAC = [['Steinbock', '12-22'], ['Wassermann', '01-20'], ['Fische', '02-19'], ['Widder', '03-21'], ['Stier', '04-20'], ['Zwillinge', '05-21'],
    ['Krebs', '06-21'], ['Löwe', '07-23'], ['Jungfrau', '08-23'], ['Waage', '09-23'], ['Skorpion', '10-23'], ['Schütze', '11-22']];
  function zodiacRanges(sign, y1, y2) {
    const i = ZODIAC.findIndex(([n]) => norm(n) === norm(sign));
    if (i < 0) return [];
    const start = ZODIAC[i][1], end = ZODIAC[(i + 1) % 12][1];
    const out = [];
    for (let y = y1 - 1; y <= y2; y++) {
      const s0 = `${y}-${start}`;
      const ey = end < start ? y + 1 : y;
      const e = new Date(`${ey}-${end}T00:00:00`); e.setDate(e.getDate() - 1);
      out.push({ lo: s0, hi: isoDay(e) });
    }
    return out;
  }
  function applyZodiac(range, sign) {
    if (!range) return range;
    const hits = zodiacRanges(sign, +range.lo.slice(0, 4), +range.hi.slice(0, 4)).map((z) => intersect(range, z)).filter(Boolean);
    return hits.length === 1 ? hits[0] : hits.length ? { lo: hits[0].lo, hi: hits[hits.length - 1].hi } : range;
  }
  function yearText(p) { if (!p) return ''; const y1 = +p.lo.slice(0, 4), y2 = +p.hi.slice(0, 4); return y1 === y2 ? String(y1) : `${y1}/${String(y2).slice(-2)}`; }
  function ageToday(p, today = new Date()) {
    if (!p) return null;
    const [y, m, d] = p.hi.split('-').map(Number);
    let a = today.getFullYear() - y; if (today < new Date(today.getFullYear(), m - 1, d)) a--;
    return a;
  }

  // =====================================================================================
  // Mitglieder-Wissen: aus jeder Quelle nebenbei merken
  // =====================================================================================
  const IMG_SOURCES = new Set(['Likes', 'Sticker', 'Nachrichten', 'Benachrichtigungen', 'Besucher', 'Profil', 'Gruppenanfrage']);

  // Ein Benutzerobjekt der Schnittstelle vereinheitlichen
  function normUser(u) {
    if (!u) return null;
    const uid = String(u.uid || u.user_id || u.id || '');
    if (!uid || uid === '0') return null;
    // verschleierte Mitglieder (Prüfsumme statt Nummer, Sternchen-Name, is_blurry): nicht verwertbar
    if (!/^\d+$/.test(uid) || u.is_blurry === true || /^\S\*{3,}$/.test(u.nickname || '')) return null;
    const g = Array.isArray(u.gender) ? u.gender.filter(Boolean) : u.gender_string ? (u.gender_string === 'p' ? ['w', 'm'] : [u.gender_string]) : [];
    return {
      uid, nick: u.nickname || u.name || '', g,
      ages: Array.isArray(u.age) ? u.age.map(Number).filter((a) => a > 0) : u.age ? [Number(u.age)] : [],
      by: Array.isArray(u.birthday) ? u.birthday.map((b) => (b && /^\d{4}/.test(b) ? +b.slice(0, 4) : 0)) : [],
      avatar: u.avatar || '', pay: u.payclass || u.membership || '',
      city: (u.geo_location && u.geo_location.city) || (u.location && u.location.city) || '',
      note: typeof u.note === 'string' ? u.note : undefined,
      active: u.is_active, lastLogin: u.last_visible_login || 0, fake: u.fakecheck,
      single: u.single_status === undefined || u.single_status === null ? undefined : !!u.single_status,
      signup: u.signup_date || 0, dist: typeof u.distance === 'number' ? u.distance : null,
    };
  }

  // Signierte Bildadressen von poppen enthalten ihr Ablaufdatum („…==,<Sekunden>/…“); abgelaufen = nicht mehr ladbar
  const avatarExpiry = (u) => { const x = String(u || '').match(/,(\d{9,11})\//); return x ? +x[1] * 1000 : 0; };
  const avatarExpired = (u) => { const t = avatarExpiry(u); return !!t && t < now() + 3600000; };
  // Gesehenes Mitglied verbuchen. src = „Likes“, „Sticker“, „Nachrichten“, „Besucher“, „Gruppen“, „Suche“, „Profil“, „Blockierliste“ …
  async function seen(u, src, { images = true } = {}) {
    const x = u && u.uid && u.g ? u : normUser(u);
    if (!x) return null;
    const today = new Date();
    const m = await Members.update(x.uid, (m) => {
      if (x.nick && m.nick && m.nick !== x.nick) { m.nicks = uniq([...(m.nicks || []), m.nick]).slice(-10); }
      if (x.nick) m.nick = x.nick;
      if (x.g && x.g.length) m.g = x.g;
      if (x.ages && x.ages.length) {
        // Geburtszeiträume eingrenzen (Paare: gleiche Reihenfolge, sonst neu)
        const fresh = x.ages.map((a) => birthRange(a, today));
        const old = m.birth || [];
        let birth = fresh.map((f, i) => (old.length === fresh.length ? intersect(old[i], f) : f) || f);
        (x.by || []).forEach((y, i) => { if (y > 1900 && birth[i]) birth[i] = intersect(birth[i], yearRange(y)) || birth[i]; });
        m.birth = birth;
        m.ages = x.ages; m.ageAt = isoDay(today);
        if (x.by && x.by.some(Boolean)) m.by = x.by;
      }
      if (x.avatar && /\/image_null_\w+\.jpe?g/i.test(x.avatar)) m.avatarPh = x.avatar;   // poppens Platzhalter (wie im Profil)
      if (x.avatar && !isPlaceholderAvatar(x.avatar)) { if (m.avatar !== x.avatar) m.avatarNew = true; m.avatar = x.avatar; }
      if (x.pay) {
        m.pay = x.pay;
        m.auto = m.auto || {};
        if (x.pay === 'site_admin') m.auto.admin = now(); else delete m.auto.admin;
      }
      if (x.city) m.city = x.city;
      if (x.note !== undefined) {
        const pn = parseNote(x.note);
        if (pn && (!m.blk || !m.blk.opa)) m.blk = { at: pn.at, src: pn.src, note: x.note, opa: true };
      }
      if (x.lastLogin) m.lastLogin = x.lastLogin;
      if (x.signup) m.signup = x.signup;
      if (x.fake) m.fake = x.fake;                                                   // Fakecheck-Stand (done/open/denied …)
      if (x.single !== undefined) {                                                   // single_status aus Vorschauen (Feed, Kommentare, Likes)
        const cats = m.rel && Array.isArray(m.rel.cats) && (!m.rel.cats.length) === x.single ? m.rel.cats : undefined;   // nur passende Kategorien behalten
        m.rel = cats ? { cats, single: x.single, at: now() } : { single: x.single, at: now() };
      }
      if (x.dist != null && isFinite(x.dist)) m.dist = { km: x.dist, at: now() };   // Entfernung, wie poppen sie bei der Sichtung angezeigt hat
      if (m.del && src !== 'Blockierliste') delete m.del;
      m.last = now();
      m.seen = m.seen || {};
      if (src) m.seen[src] = now();
    });
    if (legacy && !m.legacyDone) { await legacyApply(m); m.legacyDone = 1; Members.put(m); }
    if (images && IMG_SOURCES.has(src) && m.avatar && (m.avatarNew || !m.img)) Images.want(m.uid, m.avatar);
    return m;
  }
  async function seenMany(list, src, opts) { const out = []; for (const u of list || []) { const m = await seen(u, src, opts); if (m) out.push(m); } return out; }

  // ---------- Profilbilder als kleine Kopie ----------
  // Die Bildadressen von poppen.de sind nur begrenzt gültig – deshalb eine eigene, kleine Kopie (~150 px).
  const Images = (() => {
    const want = new Map();
    let busy = false;
    async function load(url) {
      const u300 = url.replace(/_(\d+)(_sq)?(\.jpe?g)/i, '_300_sq$3');
      let blob = await new Promise((resolve) => {
        try {
          GM_xmlhttpRequest({ method: 'GET', url: u300, responseType: 'blob', timeout: 20000,
            onload: (r) => resolve(r.status === 200 && r.response ? r.response : null), onerror: () => resolve(null), ontimeout: () => resolve(null) });
        } catch { resolve(null); }
      });
      if (!blob) {
        // Rückfall: Bild über ein <img>-Element (klappt nur, wenn der Bildserver es erlaubt)
        blob = await new Promise((resolve) => {
          const im = new Image(); im.crossOrigin = 'anonymous';
          im.onload = () => { try { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); c.toBlob(resolve, 'image/jpeg', 0.8); } catch { resolve(null); } };
          im.onerror = () => resolve(null);
          im.src = url;
        });
      }
      if (!blob) return null;
      const bmp = await createImageBitmap(blob);
      const size = 150, c = document.createElement('canvas');
      const sc = Math.max(size / bmp.width, size / bmp.height);
      c.width = size; c.height = size;
      c.getContext('2d').drawImage(bmp, (size - bmp.width * sc) / 2, (size - bmp.height * sc) / 2, bmp.width * sc, bmp.height * sc);
      return c.toDataURL('image/jpeg', 0.72);
    }
    async function pump() {
      if (busy) return;
      busy = true;
      try {
        while (want.size) {
          const [uid, url] = want.entries().next().value;
          want.delete(uid);
          try {
            const data = await load(url);
            if (data) {
              await DB.put('images', { uid, data, src: url, at: now() });
              await Members.update(uid, (m) => { m.img = now(); delete m.avatarNew; });
              Bus.emit('img', uid);
            }
          } catch (e) { /* Bild nicht ladbar – beim nächsten Mal erneut */ }
          await sleep(300);
        }
      } finally { busy = false; }
    }
    return {
      want(uid, url) { want.set(String(uid), url); setTimeout(pump, 1500); },
      async get(uid) { const r = await DB.get('images', String(uid)); return r ? r.data : ''; },
    };
  })();

  // ---------- eigenes Profil ----------
  // Aus session/info werden NUR uid, Nickname, Geschlecht, Alter und Wohnort gelesen.
  async function loadMe(force = false) {
    const me = Me.get();
    if (me && !force && now() - (me.at || 0) < 6 * 3600000) return me;
    try {
      const d = await apiGet('user/session/info', { _version: 2 });
      const a = d && d.account;
      if (!a) return me;
      const nm = { uid: String(a.uid), nick: a.nickname, g: a.gender || [], age: Array.isArray(a.age) ? a.age.map(Number) : [], cities: [(a.geo_location && a.geo_location.city) || ''], second: !!a.secondary_location_status, at: now() };
      if (me && me.cities && me.cities[1]) nm.cities[1] = me.cities[1];
      if (a.geo_location && a.geo_location.geo_id) { const { distance, distance_unit, ...geo } = a.geo_location; G.set('mygeo', geo); }
      Me.set(nm);
      return nm;
    } catch (e) { warn('Eigenes Profil nicht lesbar', e); return me; }
  }
  // ---------- Bindung an EIN poppen-Konto (gemeinsames Regelwerk 3.4) ----------
  //  Die Daten im Tampermonkey-Speicher/Gedächtnis gehören einem Konto (vaf2_owner { uid, nick, seit }).
  //  Ist ein anderes Konto (oder keins) angemeldet, bleibt das Skript komplett aus: keine Scans, kein Schreiben,
  //  kein Briefkasten, keine Hintergrund-Rahmen – nur ein roter Hinweis. Wechsel nur bewusst über die Übergabe.
  const Owner = {
    state: 'unknown',        // 'unknown' | 'ok' | 'off'
    get() { return G.get('owner', null); },
    // vorläufig (vor der Prüfung): Gedächtnis nur, wenn der zuletzt bekannte Nutzer der Eigentümer ist
    mayWrite() { if (this.state !== 'unknown') return this.state === 'ok'; const o = this.get(), me = Me.get(); return !o || !me || String(o.uid) === String(me.uid); },
    mayWriteShared() { return this.state === 'ok' && this.sharedOk !== false; },
    sharedOk: null,
    hasData() { try { return !!(GM_getValue('vaf2_settings', null) || GM_getValue('vaf2_me', null) || (GM_listValues() || []).filter((k) => k.startsWith('vaf2_')).length > 8); } catch { return false; } },
    bind(me) { G.set('owner', { uid: String(me.uid), nick: me.nick, seit: now() }); this.state = 'ok'; },
    async check() {
      const me = await loadMe(true);
      if (!me || !me.uid) { this.state = 'off'; this.why = 'nologin'; return false; }
      let o = this.get();
      if (o && o.handover && String(o.uid) !== String(me.uid)) {
        if (now() - (o.handover || 0) < 7 * DAY) {
          const v = await ask('Opa-Schutz: Daten übernehmen?', `<p>Die Opa-Schutz-Daten von <b>${esc(o.nick)}</b> wurden zur Übergabe freigegeben.</p><p>Sollen sie ab jetzt zu <b>${esc(me.nick)}</b> gehören?</p>`,
            [{ label: `Für ${me.nick} übernehmen`, value: 'yes', primary: true }, { label: 'Nein', value: null, cancel: true }]);
          if (v === 'yes') { this.bind(me); log(`Daten von ${o.nick} an ${me.nick} übergeben`); return true; }
        }
        this.state = 'off'; this.why = 'other'; return false;
      }
      if (!o) {
        if (this.hasData()) {
          const v = await ask('Opa-Schutz', `<p>Gehören die vorhandenen Opa-Schutz-Daten in diesem Browser-Profil zu <b>${esc(me.nick)}</b>?</p><p class="vaf-mini">Die Daten werden an genau ein Konto gebunden. Bei einem anderen angemeldeten Konto bleibt der Opa-Schutz danach aus.</p>`,
            [{ label: `Ja, zu ${me.nick}`, value: 'yes', primary: true }, { label: 'Nein', value: 'no', cancel: true }]);
          if (v !== 'yes') { G.set('owner_refused', { uid: String(me.uid), nick: me.nick, at: now() }); this.state = 'off'; this.why = 'refused'; return false; }
        }
        this.bind(me); return true;
      }
      if (String(o.uid) !== String(me.uid)) { this.state = 'off'; this.why = 'other'; return false; }
      if (o.nick !== me.nick) G.set('owner', { ...o, nick: me.nick });
      this.state = 'ok';
      return true;
    },
    // bewusst freigeben (vom bisherigen Konto aus): das nächste angemeldete andere Konto darf übernehmen
    handover() { const o = this.get(); if (!o) return; G.set('owner', { ...o, handover: now() }); },
    cancelHandover() { const o = this.get(); if (o && o.handover) { const { handover, ...rest } = o; G.set('owner', rest); } },
    showOff() {
      if (this.why === 'nologin') return;
      const o = this.get(), me = Me.get();
      const show = () => {
        if (!document.body || document.getElementById('vaf-owner-off')) return;
        const d = document.createElement('div'); d.id = 'vaf-owner-off';
        d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;background:#b71c1c;color:#fff;border-radius:14px;padding:12px 18px;font:600 15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);max-width:92vw;display:flex;gap:14px;align-items:center';
        const who = o ? o.nick : '';
        d.innerHTML = this.why === 'refused' ? `<span>Opa-Schutz aus – die Daten in diesem Browser-Profil gehören nicht zu ${esc((me && me.nick) || 'diesem Konto')}.</span>`
          : `<span>Opa-Schutz aus – die Daten in diesem Browser-Profil gehören zu <b>${esc(who)}</b>. Falsches Konto angemeldet?</span>`;
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Hinweis ausblenden (bis zum nächsten Seitenaufruf)';
        x.style.cssText = 'background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1';
        x.addEventListener('click', () => d.remove());
        d.appendChild(x); document.body.appendChild(d);
      };
      if (document.body) show(); else W.addEventListener('DOMContentLoaded', show);
    },
  };

  // ---------- „Grenzen altern mit mir“ ----------
  // Eigenes Alter möglichst genau am Geburtstag (Geburtsdatum aus user/info des eigenen Profils);
  // ist das Datum nicht lesbar, gilt das Alter aus session/info (dann ab dem Tag, an dem das Skript es merkt).
  async function myAgeNow() {
    const me = Me.get();
    if (!me) return null;
    let bd = G.get('my_bday', null);
    if ((!bd || now() - bd.at > 30 * DAY) && me.nick) {
      try {
        const d = await apiGet('user/info/' + encodeURIComponent(me.nick), { _version: 2 });
        const st = d && d.user_trait && d.user_trait.sex_type;   // eigene Orientierung (für die Moppel-Regeln bei Paaren)
        if (st != null) G.set('my_sextype', (Array.isArray(st) ? st : [st]).map(Number));
        const b = d && d.userInfo && d.userInfo.birthday;
        const first = String((Array.isArray(b) ? b[0] : b) || '');
        bd = { d: /^\d{4}-\d{2}-\d{2}/.test(first) ? first.slice(0, 10) : '', at: now() };
        G.set('my_bday', bd);
      } catch (e) { /* später erneut */ }
    }
    if (bd && bd.d) return ageToday({ hi: bd.d });
    return me.age && me.age[0] > 0 ? me.age[0] : null;
  }
  // Hebt bei jedem neuen eigenen Lebensjahr die Grenzen der Gruppen mit Schalter „… altern mit mir“ um die Differenz an.
  // Entsperrt wird dadurch niemand (siehe projection: nur aktiv verschobene Grenzen geben frei).
  function shiftLimits(s, diff) {
    const out = [];
    for (const gk of GROUP_KEYS) {
      const g = s.groups[gk];
      if (!g || (!g.ageVisual && !g.ageIgnore)) continue;
      for (const key of ['src', 'srcW', 'srcM']) for (const k of LIM_KEYS) {
        const v = g[key] && g[key][k];
        if (!Array.isArray(v)) continue;
        if (g.ageVisual) { v[0] = Math.min(AGE_MAX, v[0] + diff); v[1] = Math.min(AGE_MAX, v[1] + diff); }
        if (g.ageIgnore) v[2] = Math.min(AGE_MAX, v[2] + diff);
      }
      out.push(GROUP_NAMES[gk] || gk);
    }
    return out;
  }
  async function ageWithMe() {
    const a = await myAgeNow();
    if (!a) return;
    if (!(await Lock.take('agewithme', 'Grenzen altern'))) return;
    try {
      const last = G.get('my_age_last', 0);
      if (!last || a < last) { G.set('my_age_last', a); return; }
      if (a === last) return;
      G.set('my_age_last', a);
      const s = clone(S());
      const names = shiftLimits(s, a - last);
      if (!names.length) return;
      saveSettings(s);
      log(`Grenzen altern mit: ${a - last} Jahr(e) älter → ${names.join(', ')}`);
      toast(`Alles Gute! Die Altersgrenzen (${names.join(', ')}) sind mit dir um ${a - last === 1 ? 'ein Jahr' : (a - last) + ' Jahre'} gealtert.`);
    } finally { Lock.release('agewithme'); }
  }
  // Zweitwohnsitz: aus der Einstellungsseite (Zeile „Zweitwohnsitz“), höchstens einmal täglich
  async function loadSecondHome() {
    const me = Me.get();
    if (!me || !me.second) return;
    if (now() - (G.get('second_at', 0)) < DAY) return;
    G.set('second_at', now());
    const doc = await Frame.load('/setting/profile', (d) => d.querySelector('a[href="/setting/profile/second-home"]'), 20000);
    if (!doc) return;
    const a = doc.querySelector('a[href="/setting/profile/second-home"] .ant-list-item-meta-description');
    const city = a ? a.textContent.split(',')[0].trim() : '';
    const m2 = Me.get();
    m2.cities = [m2.cities[0] || '', city];
    Me.set(m2);
  }
  // Eigenes Profil auf der Einstellungsseite direkt mitlesen (wenn der Nutzer sie öffnet)
  function readSecondHomeFromPage() {
    const a = document.querySelector('a[href="/setting/profile/second-home"] .ant-list-item-meta-description');
    const me = Me.get();
    if (!a || !me) return;
    const city = a.textContent.split(',')[0].trim();
    if (city && city !== me.cities[1]) { me.cities = [me.cities[0] || '', city]; Me.set(me); }
  }

  // ---------- unsichtbarer Rahmen zum Laden von poppen-Seiten ----------
  const Frame = (() => {
    let f = null;
    function el() {
      if (f && f.isConnected) return f;
      f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:1000px;border:0;visibility:hidden;pointer-events:none';
      document.body.appendChild(f);
      return f;
    }
    return {
      async load(url, ready, timeout = 25000) {
        const fr = el();
        await new Promise((res) => { const h = () => { fr.removeEventListener('load', h); res(); }; fr.addEventListener('load', h); fr.src = url; setTimeout(res, timeout); });
        const doc = () => { try { return fr.contentDocument; } catch { return null; } };
        return waitFor(() => { const d = doc(); return d && (!ready || ready(d)) ? d : null; }, timeout);
      },
      doc() { try { return f && f.contentDocument; } catch { return null; } },
      remove() { if (f) { f.remove(); f = null; } },
    };
  })();

  // =====================================================================================
  // Blocken: Warteliste, Etappen, Vorprüfungen
  // =====================================================================================
  const RANK = () => S().expert.rank;
  const rankOf = (src) => { const i = RANK().indexOf(srcKeyOf(src)); return i < 0 ? 9 : i; };

  const Queue = {
    async add(x, src) {
      const m = x.uid ? await Members.get(x.uid) : null;
      if (m && m.blk && m.blk.at && !m.unblk) return false;
      const old = x.uid ? await DB.get('queue', String(x.uid)) : null;
      const oldest = Math.max(...(x.ages || [0]));
      const item = {
        uid: String(x.uid || ('nick:' + norm(x.nick))), nick: x.nick || (m && m.nick) || '', g: x.g || (m && m.g) || [], ages: x.ages || (m && m.ages) || [],
        src: old && rankOf(old.src) <= rankOf(src) ? old.src : src, added: (old && old.added) || now(), tries: (old && old.tries) || 0,
      };
      item.prio = rankOf(item.src) * 1000 + (200 - oldest);
      // von poppen gesperrt / in Echtheitsprüfung: neu Eingereihte ans Ende; schon Eingereihte bleiben, wo sie sind
      if (old && old.prio >= 100000) item.prio += 100000;
      else if (!old && m && m.pstate) item.prio += 100000;
      await DB.put('queue', item);
      Queue.changed();
      return !old;
    },
    async remove(uid) { await DB.del('queue', String(uid)); Queue.changed(); },
    async list() { const l = await DB.all('queue'); l.sort((a, b) => a.prio - b.prio || a.added - b.added); return l; },
    async count() { return DB.count('queue'); },
    async clear() { await DB.clear('queue'); Queue.changed(); },
    changed: (() => { let t; return () => { clearTimeout(t); t = setTimeout(async () => { G.set('qcount', await DB.count('queue')); Bus.emit('queue'); }, 300); }; })(),
  };

  // ---------- Vormerken: knapp unter der Grenze ----------
  async function watchMark(m, on) {
    const w = await KV.get('watch', {});
    if (on && !w[m.uid]) { w[m.uid] = now(); await KV.set('watch', w); }
    if (!on && w[m.uid]) { delete w[m.uid]; await KV.set('watch', w); }
  }
  // Vorgemerkte, die laut Geburtszeitraum inzwischen sicher über der Grenze sind → Warteliste
  async function watchDue() {
    const w = await KV.get('watch', {});
    let n = 0;
    for (const uid of Object.keys(w)) {
      const m = await Members.get(uid);
      if (!m || !m.birth || !m.birth.length) continue;
      if (m.blk && !m.unblk) { delete w[uid]; continue; }
      const ages = m.birth.map((b) => ageToday(b));
      const c = classify({ ...m, ages }, 'Vorgemerkt');
      if (c.white || c.unclear) { delete w[uid]; continue; }
      if (c.ignore) { await Queue.add({ ...m, ages }, 'Vorgemerkt'); delete w[uid]; n++; }
    }
    await KV.set('watch', w);
    return n;
  }

  // Treffer einer Quelle verarbeiten: einstufen, vormerken, ggf. auf die Warteliste
  // Ergebnis: { hits, white, near, unclear, queued }
  async function judge(list, src, { enqueue = true } = {}) {
    const res = { total: 0, hits: 0, white: 0, near: 0, unclear: 0, queued: 0, known: 0, inQueue: 0, notQueued: 0 };
    for (const x of list) {
      res.total++;
      const m = x.uid ? await Members.get(x.uid) : null;
      const c = classify({ ...(m || {}), ...x }, src);
      if (c.unclear) { res.unclear++; continue; }
      if (c.white) { res.white++; continue; }
      if (c.near && m) { res.near++; await watchMark(m, true); }
      if (!c.ignore) continue;
      res.hits++;
      if (m && m.blk && !m.unblk) { res.known++; continue; }
      if (!enqueue) { res.notQueued++; continue; }                 // z. B. Events: nur einfärben
      if (await Queue.add(x, src)) res.queued++; else res.inQueue++;   // stand schon auf der Warteliste
    }
    scanLiveAdd(res);
    return res;
  }

  // ---------- Schnittstellen der Blockierliste ----------
  const BL = {
    async page(page, nickname = '') { return apiPost('v2/ignore/list', { page, nickname, sort: 'recently_added' }); },
    async uids() {
      let d;
      try { d = await apiGet('ignore/uid/list'); } catch { d = await apiPost('ignore/uid/list', {}); }
      return ((d && d.list) || []).map(String);
    },
    // ganze Liste lesen (30 je Seite)
    async all(onPage) {
      const out = [];
      let page = 1;
      for (let guard = 0; guard < 100000; guard++) {
        const d = await BL.page(page);
        const l = (d && d.list) || [];
        out.push(...l);
        if (onPage && onPage(out.length, page, l) === false) break;
        if (!l.length || !d.next_page || d.next_page === page) break;
        page = d.next_page;
      }
      return out;
    },
    async find(nick) {
      const d = await BL.page(1, nick);
      return ((d && d.list) || []).find((e) => e.user && norm(e.user.nickname) === norm(nick)) || null;
    },
    add: (uid, nickname) => apiPost('ignore/add', { uid: String(uid), nickname }),
    del: (uid, nickname) => apiPost('ignore/delete', { uid: String(uid), nickname }),
    note: (uid, comment) => apiPost('ignore/comment/add', { igrid: String(uid), comment }),
  };

  // Profil-Kurzinfo (Alter, Notiz, Freundschaft) – ohne Profilaufruf
  async function profileShort(nick) {
    try { return await apiPost('messenger/p2p/profile/display', { nickname: nick }); } catch { return null; }
  }

  // Ein Mitglied blockieren (mit Notiz). Gibt 'ok' | 'bereits' | Fehlertext zurück
  async function blockOne(m, src, { note = true } = {}) {
    const s = S();
    const when = new Date();
    const text = makeNote(m, src, when);
    if (dry()) { log('Testlauf – würde blockieren:', m.nick, src, text); return 'Test'; }
    try { await BL.add(m.uid, m.nick); }
    catch (e) {
      const there = /already|bereits|schon/i.test(e.message) || await BL.find(m.nick).then(Boolean).catch(() => false);
      if (!there) return 'Fehler: ' + e.message;
    }
    let noted = false;
    if (note && s.expert.writeNote) {
      try { await BL.note(m.uid, text); noted = true; }
      catch (e) {
        warn('Notiz fehlgeschlagen', m.nick, e);
        if (s.expert.noteRequired) { try { await BL.del(m.uid, m.nick); } catch {} return 'Fehler: Notiz ließ sich nicht schreiben'; }
      }
    }
    await Members.update(m.uid, (x) => { x.blk = { at: when.getTime(), src, note: noted ? text : '', opa: true }; delete x.unblk; });
    G.set('blocked_count', (G.get('blocked_count', 0) || 0) + 1);
    return 'ok';
  }
  async function unblockOne(m, { keepMemory = false } = {}) {
    if (dry()) { log('Testlauf – würde entsperren:', m.nick); return 'Test'; }
    try { await BL.del(m.uid, m.nick); } catch (e) { return 'Fehler: ' + e.message; }
    if (!keepMemory) await Members.update(m.uid, (x) => { x.unblk = now(); x.blk = null; });
    G.set('blocked_count', Math.max(0, (G.get('blocked_count', 0) || 0) - 1));
    return 'ok';
  }

  // Ohne bekannte Benutzer-ID: über „Benutzer hinzufügen“ auf der Blockierliste (im unsichtbaren Rahmen)
  async function blockByNickDom(nick) {
    const doc = await Frame.load('/setting/privacy/ignore-list', (d) => d.querySelector('main input#nickname'), 25000);
    if (!doc) return 'Fehler: Blockierliste nicht ladbar';
    const w = doc.defaultView;
    const inp = () => doc.querySelector('main input#nickname');
    const setVal = (el, v) => {
      el.focus();
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    };
    const l = norm(nick);
    const opts = () => [...doc.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')];
    const match = (o) => norm(o.getAttribute('title')) === l || norm(o.textContent) === l || norm(o.textContent).startsWith(l + ' ') ||
      [...o.querySelectorAll('*')].some((e) => !e.children.length && norm(e.textContent) === l);
    inp().dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    setVal(inp(), '');
    for (let i = 1; i <= nick.length; i++) { setVal(inp(), nick.slice(0, i)); await sleep(60); }
    const opt = await waitFor(() => opts().find(match), 6000);
    if (!opt) { setVal(inp(), ''); return 'Fehler: Name nicht in der Vorschlagsliste'; }
    opt.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    opt.click();
    const addBtn = () => { const f = inp() && inp().closest('form'); const b = f && [...f.querySelectorAll('button')].find((x) => norm(x.textContent) === 'hinzufügen'); return b && !b.disabled ? b : null; };
    if (!(await waitFor(addBtn, 3000))) return 'Fehler: „Hinzufügen“ bleibt gesperrt';
    if (dry()) { setVal(inp(), ''); return 'Test'; }
    addBtn().click();
    await sleep(1500);
    const e = await BL.find(nick).catch(() => null);
    return e && e.user ? { uid: String(e.user.uid), user: e.user } : 'Fehler: Name erscheint nicht in der Liste';
  }

  // ---------- eine Etappe ----------
  // ---------- Vorrang: andere Vorgänge pausieren das Hintergrundblockieren ----------
  // Prio.run('name', fn) markiert einen Vorgang (für alle Tabs sichtbar); das Blockieren wartet, bis er fertig ist.
  const Prio = (() => {
    const pre = 'vaf2_prio_';
    const mine = new Map();
    setInterval(() => { for (const [k, v] of mine) GM_setValue(k, { ...v, ts: now() }); }, 5000);
    W.addEventListener('pagehide', () => { for (const k of mine.keys()) try { GM_deleteValue(k); } catch {} });
    const LOCKS = ['scan', 'blocklist', 'grpreq', 'grpwl'];
    return {
      enter(what) { const k = pre + what + '_' + TAB_ID + '_' + Math.random().toString(36).slice(2, 6); const v = { what, ts: now() }; mine.set(k, v); GM_setValue(k, v); return k; },
      leave(k) { mine.delete(k); try { GM_deleteValue(k); } catch {} },
      async run(what, fn) { const k = this.enter(what); try { return await fn(); } finally { this.leave(k); } },
      // läuft gerade etwas mit Vorrang (in irgendeinem Tab)?
      busy() {
        for (const k of GM_listValues()) {
          if (!k.startsWith(pre) && !LOCKS.some((l) => k === 'vaf2_lock_' + l)) continue;
          const v = GM_getValue(k, null);
          if (v && now() - (v.ts || 0) < 30000) return (v.what || v.info || k.replace('vaf2_lock_', ''));
        }
        return '';
      },
    };
  })();

  // ---------- Hintergrundblockieren (ersetzt die Etappen) ----------
  // Solange Kandidaten auf der Warteliste stehen und der Schalter an ist, blockiert ein Tab einen nach dem anderen.
  const TAB_SINCE = (() => { try { const v = +sessionStorage.getItem('vaf_tab_since'); if (v) return v; const t = now(); sessionStorage.setItem('vaf_tab_since', String(t)); return t; } catch { return now(); } })();
  const Etappe = {
    running: false, stopFlag: false, manual: false, listeners: new Set(), state: 'idle',
    status() { return { running: this.running, state: this.state, last: G.get('etappe_last', null) }; },
    setState(st) { this.state = st; G.set('blk_state', { st, at: now(), tab: TAB_ID }); Bus.emit('etappe', { running: this.running, state: st }); },
    // Prüft und blockiert einen Kandidaten. Ergebnis wird in st gezählt.
    async one(q, s, st) {
      let m = q.uid.startsWith('nick:') ? await Members.byNick(q.nick) : await Members.get(q.uid);
      if (!m && !q.uid.startsWith('nick:')) m = { uid: q.uid, nick: q.nick, g: q.g, ages: q.ages };
      // Vorprüfung 1: Profil-Kurzinfo (Freund? schon geblockt? aktuelles Alter)
      const ps = await profileShort(q.nick);
      if (ps) {
        if (ps.friend_status && ps.friend_status !== 'none') {
          if (m && m.uid && !String(m.uid).startsWith('nick:')) await Members.update(m.uid, (x) => { x.auto = x.auto || {}; x.auto.friend = now(); x.friend = ps.friend_status; });
          await Queue.remove(q.uid); st.dropped++; st.items.push({ nick: q.nick, res: 'Freund – nicht blockiert' }); return 'skip';
        }
        if (Array.isArray(ps.age) && ps.age.length && m) m = { ...m, ages: ps.age };
        if (ps.note && isOpaNote(ps.note) && m && m.uid) {
          const pn = parseNote(ps.note);
          await Members.update(m.uid, (x) => { x.blk = { at: pn.at, src: pn.src, note: ps.note, opa: true }; });
          await Queue.remove(q.uid); st.dropped++; return 'skip';
        }
      }
      // Vorprüfung 2: Regeln (Whitelist, Favoriten, Mitarbeiter, verwaltete Gruppen, Grenzen)
      const c = classify({ ...(m || q), nick: q.nick }, q.src);
      if (!c.ignore) { await Queue.remove(q.uid); st.dropped++; st.items.push({ nick: q.nick, res: c.white ? 'Whitelist: ' + c.white : 'nicht mehr über der Grenze' }); return 'skip'; }
      if (!m || !m.uid || String(m.uid).startsWith('nick:')) {
        const r = await blockByNickDom(q.nick);
        if (typeof r === 'string') { if (r === 'Test') { st.test++; return 'test'; } await this.fail(q, r, st); return 'fail'; }
        m = await seen(r.user, 'Blockierliste', { images: false });
        if (!dry()) {
          try { await BL.note(m.uid, makeNote(m, q.src)); }
          catch (e) { warn('Notiz fehlgeschlagen', q.nick, e); try { await BL.del(m.uid, m.nick); } catch {} await this.fail(q, 'Fehler: Notiz ließ sich nicht schreiben', st); return 'fail'; }
        }
        await Members.update(m.uid, (x) => { x.blk = { at: now(), src: q.src, note: makeNote(m, q.src), opa: true }; delete x.unblk; });
        await Queue.remove(q.uid); st.ok++; st.items.push({ nick: q.nick, res: 'blockiert' });
        return 'ok';
      }
      const r = await blockOne(m, q.src);
      if (r === 'ok') { await Queue.remove(q.uid); await watchMark(m, false); st.ok++; st.items.push({ nick: q.nick, res: 'blockiert' }); return 'ok'; }
      if (r === 'Test') { st.test++; st.items.push({ nick: q.nick, res: 'Testlauf' }); return 'test'; }
      await this.fail(q, r, st);
      return 'fail';
    },
    // Arbeitet die Warteliste ab, solange erlaubt. manual=true: auch bei ausgeschaltetem Schalter, bis die Liste leer ist.
    async run(reason = 'automatisch', onProgress, opts = {}) {
      if (this.running) return null;
      if (!(await Lock.take('etappe', reason))) return null;
      this.running = true; this.stopFlag = false; this.manual = !!opts.manual;
      const st = { ok: 0, fail: 0, dropped: 0, test: 0, items: [], started: now(), reason };
      let fails = 0, i = 0;
      const done = new Set();                       // im Testlauf bleiben Einträge stehen: jeden nur einmal je Lauf
      try {
        const total0 = await Queue.count();
        for (;;) {
          if (this.stopFlag) break;
          if (!this.manual && !isOn()) break;
          const ho = G.get('blk_handover', null);
          if (ho && ho.tab !== TAB_ID && now() - ho.at < 60000) break;          // ein anderer Tab übernimmt („Jetzt abarbeiten“)
          const pauseUntil = G.get('blk_pause_until', 0);
          if (pauseUntil > now()) { this.setState('pause-fehler'); await sleep(Math.min(5000, pauseUntil - now())); continue; }
          const busy = Prio.busy();
          if (busy) { this.setState('pause'); await sleep(2000); continue; }
          const s = S();
          if ((G.get('blocked_count', 0) || 0) >= s.expert.limit) { st.limit = true; break; }
          const q = (await Queue.list()).find((x) => !done.has(x.uid));
          if (!q) break;
          done.add(q.uid);
          this.setState('blockiert');
          i++;
          const left = await Queue.count();
          if (onProgress) onProgress(i, Math.max(total0, i + left - 1), q);
          Bus.emit('etappe', { running: true, st, i, cur: q });
          let r;
          try { r = await this.one(q, s, st); } catch (e) { warn('Blockieren', e); r = 'fail'; await this.fail(q, 'Fehler: ' + (e.message || e), st); }
          if (r === 'fail') { if (++fails >= 5) { G.set('blk_pause_until', now() + 5 * 60000); fails = 0; } } else if (r === 'ok') fails = 0;
          if (r === 'ok' || r === 'fail') await sleep(rand(s.expert.pauseMin * 1000, s.expert.pauseMax * 1000));
        }
        return st;
      } finally {
        this.running = false; this.manual = false;
        st.ended = now();
        G.set('etappe_last', { at: now(), ok: st.ok, fail: st.fail, dropped: st.dropped, reason });
        Lock.release('etappe');
        this.setState('idle');
        Bus.emit('etappe', { running: false, st });
        Queue.changed();
      }
    },
    async fail(q, msg, st) {
      st.fail++; st.items.push({ nick: q.nick, res: msg });
      q.tries = (q.tries || 0) + 1;
      if (q.tries >= 3) { await Queue.remove(q.uid); await KV.set('failed', { ...(await KV.get('failed', {})), [q.uid]: { nick: q.nick, msg, at: now() } }); }
      else { q.prio = (q.prio || 0) + 100000; await DB.put('queue', q); }           // ans Ende, nächster Versuch später
    },
    stop() { this.stopFlag = true; },
    // Zeitgeber: alle 10 s prüfen, ob blockiert werden soll; Vorgemerkte alle 5 Minuten
    start() {
      setInterval(async () => {
        if (!isOn() || this.running) return;
        if (now() - TAB_SINCE < 60000) return;          // frischer Tab: erst nach einer Minute übernehmen
        if (Lock.other('etappe')) return;
        if (!(await Queue.count())) return;
        this.run('automatisch').catch((e) => warn('Blockieren', e));
      }, 10000);
      setInterval(async () => {
        if (!isOn() || Lock.other('watch')) return;
        if (now() - G.get('watch_at', 0) < 5 * 60000) return;
        G.set('watch_at', now());
        try { const n = await watchDue(); if (n) log(`${n} Vorgemerkte auf die Warteliste.`); } catch (e) { warn('Vormerken', e); }
      }, 60000);
    },
  };

  // =====================================================================================
  // Quellen (Scans). Jede liefert Mitglieder an judge(); Fortschritt über ctx.
  //   ctx = { stop: () => bool, step(i, n, text), add(res) }
  // =====================================================================================
  const newRes = () => ({ total: 0, hits: 0, white: 0, near: 0, unclear: 0, queued: 0, known: 0, inQueue: 0, notQueued: 0, unblocked: 0, whitelisted: 0, kicked: 0 });
  const addRes = (a, b) => { for (const k of Object.keys(b)) a[k] = (a[k] || 0) + (b[k] || 0); return a; };

  // ---------- Interaktionen: Likes ----------
  async function scanLikes(ctx) {
    const res = newRes();
    const st = G.get('scan_rates', { newest: 0, complete: false });
    const firstMax = S().expert.firstScanMax;
    const seenU = new Set();
    let page = null, read = 0, newest = st.newest, stopOld = false;
    for (let guard = 0; guard < 5000 && !ctx.stop(); guard++) {
      const d = await apiGet('rates', page ? { _version: 2, page } : { _version: 2 });
      const l = (d && d.rates) || [];
      const users = [];
      for (const r of l) {
        read++;
        const ts = r.timestemp || 0;
        if (ts > newest) newest = ts;
        if (st.complete && ts && ts <= st.newest) { stopOld = true; break; }
        const u = r.user && normUser(r.user);
        if (u && !seenU.has(u.uid)) { seenU.add(u.uid); users.push(u); }
      }
      await seenMany(users, 'Likes');
      addRes(res, await judge(users, 'Likes'));
      ctx.step(read, null, `Likes: ${fmtN(read)} gelesen, ${fmtN(seenU.size)} Mitglieder`);
      if (stopOld || !l.length || !d.next_page) break;
      if (!st.complete && read >= firstMax) break;
      page = d.next_page;
    }
    if (!ctx.stop()) G.set('scan_rates', { newest, complete: true, at: now() });
    return res;
  }

  // ---------- Interaktionen: Sticker ----------
  async function scanStickers(ctx) {
    const res = newRes();
    const me = Me.get() || await loadMe();
    if (!me || !me.uid) throw new Error('Eigene Benutzer-ID unbekannt');
    const st = G.get('scan_gift', { newest: 0, complete: false });
    const firstMax = S().expert.firstScanMax;
    const seenU = new Set();
    let page = null, read = 0, newest = st.newest, stopOld = false;
    for (let guard = 0; guard < 5000 && !ctx.stop(); guard++) {
      const q = { uid: me.uid, limit: 30 };
      if (page) q.page = page;
      const d = await apiGet('my/received/gift', q);
      const l = (d && d.list) || [];
      const users = [];
      for (const g of l) {
        read++;
        const id = +g.id || 0;
        if (id > newest) newest = id;
        if (st.complete && id && id <= st.newest) { stopOld = true; break; }
        const u = normUser(g.user || g);
        if (u && !seenU.has(u.uid)) { seenU.add(u.uid); users.push(u); }
      }
      await seenMany(users, 'Sticker');
      addRes(res, await judge(users, 'Sticker'));
      ctx.step(read, null, `Sticker: ${fmtN(read)} gelesen, ${fmtN(seenU.size)} Mitglieder`);
      if (stopOld || !l.length || !d.next_page) break;
      if (!st.complete && read >= firstMax) break;
      page = d.next_page;
    }
    if (!ctx.stop()) G.set('scan_gift', { newest, complete: true, at: now() });
    return res;
  }

  // ---------- Interaktionen: Nachrichten (Unterhaltungsliste, ohne Nachrichtentexte) ----------
  const DELETED_NICK = /^gelöschter popster$/i;
  async function scanMessages(ctx) {
    const res = newRes();
    const st = G.get('scan_msg', { newest: 0, complete: false });
    const firstMax = S().expert.firstScanMax;
    const seenU = new Set();
    let offset = 0, read = 0, newest = st.newest, stopOld = false;
    for (let guard = 0; guard < 5000 && !ctx.stop(); guard++) {
      const d = await apiPost('messenger/group/list', { offset, filter: 0 });
      const l = (d && d.list) || [];
      const users = [];
      for (const c of l) {
        read++;
        const ts = c.last_updated || 0;
        if (ts > newest) newest = ts;
        if (st.complete && ts && ts <= st.newest) { stopOld = true; break; }
        if (c.group_type !== 1 || !c.group_data) continue;
        const gd = c.group_data;
        if (DELETED_NICK.test(gd.nickname || '')) { await Members.update(gd.uid, (m) => { m.del = m.del || now(); }); continue; }
        const u = normUser(gd);
        if (u && !seenU.has(u.uid)) { seenU.add(u.uid); users.push(u); }
      }
      await seenMany(users, 'Nachrichten');
      addRes(res, await judge(users, 'Nachrichten'));
      ctx.step(read, null, `Nachrichten: ${fmtN(read)} Unterhaltungen`);
      if (stopOld || !l.length || !d.next || d.next === offset) break;
      if (!st.complete && read >= firstMax) break;
      offset = d.next;
    }
    if (!ctx.stop()) G.set('scan_msg', { newest, complete: true, at: now() });
    return res;
  }

  // ---------- Interaktionen: Benachrichtigungs-Feed (alle actor-Typen außer Gruppen-Beitrittsanfragen) ----------
  async function scanNotifications(ctx) {
    const res = newRes();
    const st = G.get('scan_notif', { newest: 0, complete: false });
    const firstMax = S().expert.firstScanMax;
    const seenU = new Set();
    let body = null, read = 0, newest = st.newest, stopOld = false;
    for (let guard = 0; guard < 5000 && !ctx.stop(); guard++) {
      const d = await apiPost('notification/msg/list', body);
      const l = (d && d.msg_list) || [];
      const users = [];
      for (const it of l) {
        read++;
        const ts = +it.msg_time || 0;
        if (ts > newest) newest = ts;
        if (st.complete && ts && ts <= st.newest) { stopOld = true; break; }
        if (it.msg_type === 'cms_private_request_group') continue;   // Gruppen-Beitrittsanfragen auslassen
        const a = it.actor;
        if (!a || typeof a !== 'object' || !a.uid) continue;
        const u = normUser(a);
        if (u && !seenU.has(u.uid)) { seenU.add(u.uid); users.push(u); }
      }
      await seenMany(users, 'Benachrichtigungen');
      addRes(res, await judge(users, 'Benachrichtigungen'));
      ctx.step(read, null, `Benachrichtigungen: ${fmtN(read)} gelesen, ${fmtN(seenU.size)} Mitglieder`);
      if (stopOld || !l.length || !d.next) break;
      if (!st.complete && read >= firstMax) break;
      body = { next: d.next, exid: d.exid };
    }
    if (!ctx.stop()) G.set('scan_notif', { newest, complete: true, at: now() });
    return res;
  }

  async function scanInteractions(ctx) {
    const res = newRes();
    for (const [name, fn] of [['Likes', scanLikes], ['Sticker', scanStickers], ['Nachrichten', scanMessages], ['Benachrichtigungen', scanNotifications]]) {
      if (ctx.stop()) break;
      ctx.phase && ctx.phase(name);
      try { addRes(res, await fn(ctx)); } catch (e) { ctx.error && ctx.error(name, e); }
    }
    return res;
  }

  // ---------- Profilbesucher (Seite, unsichtbar geladen) ----------
  function visitorItems(doc) {
    return [...doc.querySelectorAll('main .ant-list-items .ant-list-item, main .ant-list-item')].map((item) => {
      const a = item.querySelector('.ant-card-meta-title a[href^="/p/"]') || item.querySelector('a[href^="/p/"]');
      if (!a) return null;
      const desc = (item.querySelector('.ant-card-meta-description') || item).textContent || '';
      const img = item.querySelector('img');
      const src = img ? img.getAttribute('src') : '';
      const nick = a.getAttribute('title') || a.textContent.trim();
      return { item, nick, uid: uidFromAvatar(src), ages: agesFromText(desc), g: genderFromText(desc), avatar: isPlaceholderAvatar(src) ? '' : src };
    }).filter(Boolean);
  }
  function scroller(el, doc = document) {
    const w = doc.defaultView;
    for (let e = el; e && e !== doc.body; e = e.parentElement) {
      const oy = w.getComputedStyle(e).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 10) return e;
    }
    return doc.scrollingElement || doc.documentElement;
  }
  // Liste durchscrollen und alle Einträge einsammeln
  async function collectList(doc, itemsFn, ctx, { max = 100000, label = 'Einträge', stopWhen } = {}) {
    const all = new Map();
    const first = await waitFor(() => itemsFn(doc)[0], 15000);
    if (!first) return all;
    const sc = scroller(first.item, doc);
    sc.scrollTop = 0;
    await sleep(500);
    let idle = 0;
    for (let i = 0; i < 20000 && idle < 5 && !ctx.stop(); i++) {
      const before = all.size;
      for (const x of itemsFn(doc)) if (!all.has(x.nick)) all.set(x.nick, x);
      ctx.step(all.size, null, `${label}: ${fmtN(all.size)} gelesen`);
      if (all.size >= max) break;
      if (stopWhen && stopWhen(all)) break;
      const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5;
      idle = all.size === before && atBottom ? idle + 1 : 0;
      sc.scrollTop += Math.max(300, sc.clientHeight * 0.8);
      await sleep(atBottom ? 1000 : 350);
    }
    return all;
  }
  // Profilbesucher über die Schnittstelle profile/visitors (kein Durchscrollen einer Seite mehr → hintergrundtauglich)
  async function scanVisitors(ctx) {
    const res = newRes();
    const st = G.get('scan_vis', { newest: 0, complete: false });
    const firstMax = S().expert.firstScanMax;
    const seenU = new Set();
    let page = 1, read = 0, newest = st.newest, stopOld = false;
    for (let guard = 0; guard < 5000 && !ctx.stop(); guard++) {
      const d = await apiGet('profile/visitors', { _version: 2, sort_by: 0, page, limit: 20 });
      const l = (d && d.users) || [];
      const users = [];
      for (const r of l) {
        read++;
        const ts = r.timestamp || (r.histories && r.histories[0]) || 0;
        if (ts > newest) newest = ts;
        if (st.complete && ts && ts <= st.newest) { stopOld = true; break; }
        const u = normUser(r);
        if (u && !seenU.has(u.uid)) { seenU.add(u.uid); users.push(u); }
      }
      for (const u of users) await seen(u, 'Besucher', { images: false });
      addRes(res, await judge(users, 'Besucher'));
      ctx.step(read, d.total || null, `Profilbesucher: ${fmtN(read)} gelesen, ${fmtN(seenU.size)} Mitglieder`);
      if (stopOld || !l.length || !d.next_page || d.next_page === page) break;
      if (!st.complete && read >= firstMax) break;
      page = d.next_page;
    }
    if (!ctx.stop()) G.set('scan_vis', { newest, complete: true, at: now() });
    return res;
  }

  // ---------- Freunde und Favoriten (friends/list, favourite/list) ----------
  // Beide Listen haben denselben Aufbau: { users, next_page, total_count }. Alle Einträge → automatische Whitelist.
  const FF = { friend: { path: 'friends/list', label: 'Freund' }, fav: { path: 'favourite/list', label: 'Favorit' } };
  const validUid = (u) => u && /^\d+$/.test(String(u.uid || '')) && !u.is_blurry && !/^\S\*{3,}$/.test(u.nickname || '');
  async function readFF(kind, ctx) {
    const out = [];
    let page = 1;
    for (let guard = 0; guard < 1000 && !(ctx && ctx.stop && ctx.stop()); guard++) {
      const d = await apiPost(FF[kind].path, { sort: 'online', page });
      const l = (d && d.users) || [];
      for (const u of l) { if (validUid(u)) out.push(u); else warn(`${FF[kind].label}: Eintrag ohne gültige uid übersprungen`, u && Object.keys(u)); }
      if (!l.length || !d.next_page || d.next_page === page) break;
      page = d.next_page;
    }
    return out;
  }
  async function markFF(kind, users, { complete = false, ctx = null } = {}) {
    const res = { whitelisted: 0, unblocked: 0 };
    const ids = new Set();
    for (const u of users) {
      const m = await seen(u, FF[kind].label === 'Freund' ? 'Freunde' : 'Favoriten', { images: false });
      if (!m) continue;
      ids.add(m.uid);
      const was = !!(m.auto && m.auto[kind]);
      await Members.update(m.uid, (x) => { x.auto = x.auto || {}; x.auto[kind] = now(); });
      if (!was) res.whitelisted++;
      if (m.blk && m.blk.opa && !m.unblk) {
        const r = await unblockOne(m);
        if (r === 'ok' || r === 'Test') { res.unblocked++; if (ctx && ctx.notes) ctx.notes.push(`${m.nick}: entsperrt (${FF[kind].label})`); else log(`${m.nick}: entsperrt (${FF[kind].label})`); }
      }
    }
    if (complete) {
      const gone = [];
      await Members.each((m) => { if (m.auto && m.auto[kind] && !ids.has(m.uid)) gone.push(m.uid); });
      for (const uid of gone) await Members.update(uid, (x) => { delete x.auto[kind]; if (kind === 'friend') delete x.friend; });
    }
    return res;
  }
  async function refreshFriendsFavs(ctx) {
    const res = newRes();
    for (const kind of ['friend', 'fav']) {
      try { const l = await readFF(kind, ctx); if (ctx && ctx.stop && ctx.stop()) break; addRes(res, await markFF(kind, l, { complete: true, ctx })); }
      catch (e) { warn(FF[kind].label, e); }
    }
    G.set('ff_at', now());
    return res;
  }

  // ---------- user/info: Angaben eines Profils ----------
  async function ingestUserInfo(d) {
    const ui = d && d.userInfo, tr = d && d.user_trait;
    if (!ui || !/^\d+$/.test(String(ui.uid || ''))) return null;
    const m = await seen({ uid: ui.uid, nickname: ui.nickname, gender: Array.isArray(tr && tr.gender) ? tr.gender : [ui.gender], age: ui.age, avatar: ui.avatar, payclass: ui.userClass }, 'Profil', { images: false });
    if (!m || !tr) return m;
    try { grNoteUnknownCodes(tr); } catch {}   // neue/unbekannte Profil-Codes nebenbei erfassen (Punkt 18)
    const g = Array.isArray(tr.gender) ? tr.gender : [];
    const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const sizes = arr(tr.size), weights = arr(tr.weight), figs = arr(tr.figure_name);
    // je Person (Einzelprofil: eine, Paar: in der Reihenfolge von gender) Größe/Gewicht/BMI; fehlende Angaben → null
    const n = Math.max(1, g.length);
    const body = [];
    for (let i = 0; i < n; i++) {
      const h = +(sizes[i] || 0), w = +(weights[i] || 0);
      body.push(h >= 120 && h <= 230 && w >= 30 && w <= 350 ? { h, wlo: w, whi: w, bmi: Math.round(w / ((h / 100) ** 2) * 10) / 10, at: now(), src: 'Profil', fig: +figs[i] || 0 } : null);
    }
    const am = d.aboutMe || {};
    await Members.update(m.uid, (x) => {
      x.figc = figs.map((f) => +f || 0);                                   // Figur-Angabe je Person (6 = Plus-size)
      if (body.some(Boolean)) { x.body = body; delete x.bodyUnk; }
      // Profil-Angaben für die Filter der XXL-Seite
      x.tr = { smoker: arr(tr.smoker), sex: arr(tr.sex_type), zodiac: arr(tr.zodiac), eth: arr(tr.ethnicity) };
      if (Array.isArray(am.lookingFor)) x.lf = am.lookingFor.map((y) => (Array.isArray(y) ? String(y[1]) : String(y))).filter(Boolean);
      if (Array.isArray(am.interested)) x.interested = am.interested.map(String);
      if (ui.fakecheck != null) x.fake = String(ui.fakecheck);
      if (d.relationship !== undefined) { try { x.rel = { cats: grRelCats(d.relationship), at: now() }; } catch {} }   // Beziehungsstatus (XXL-Filter)
    });
    return m;
  }

  // ---------- Gruppen ----------
  async function myGroups(subset) {
    const out = [];
    let page = 1;
    for (let guard = 0; guard < 200; guard++) {
      const d = await apiGet('group/my', { _version: 2, page, subset, limit: 25, ...(subset === 'managed' ? { sort: 'pending_count' } : {}) });
      const l = (d && d.cms_list) || [];
      out.push(...l.map((g) => ({ cms: String(g.cms_id), name: g.name, url: g.profile_url, count: g.attendee_count || 0, pending: g.pending_count || 0, role: g.creator_status || '', subset })));
      if (!l.length || !d.next_page || d.next_page === page) break;
      page = d.next_page;
    }
    return out;
  }
  async function loadGroups() {
    const [managed, attended] = await Promise.all([myGroups('managed'), myGroups('attended')]);
    const names = { ...G.get('groupnames', {}) };
    for (const g of [...managed, ...attended]) names[g.cms] = g.name;
    G.set('groupnames', names);
    G.set('groups', { managed, attended: attended.filter((a) => !managed.some((m) => m.cms === a.cms)), at: now() });
    G.set('pending', { n: managed.reduce((s, g) => s + g.pending, 0), groups: managed.filter((g) => g.pending).map((g) => ({ cms: g.cms, name: g.name, n: g.pending })), at: now() });
    Bus.emit('pending');
    return G.get('groups');
  }
  async function groupMembers(cms, ctx, onPage) {
    let page = 1, n = 0, meta = null;
    ctx = ctx || { stop: () => false };
    for (let guard = 0; guard < 100000 && !ctx.stop(); guard++) {
      const d = await apiGet('group/attendee/list', { _version: 2, page, cms_id: cms, limit: 30 });
      const l = (d && d.users) || [];
      if (!meta) meta = { total: d.total || 0, invisible: d.invisible_count || 0, masked: 0 };
      n += l.length;
      const valid = l.map(normUser).filter(Boolean);
      meta.masked += l.length - valid.length;
      // nur verschleierte Mitglieder: Gruppe nicht einsehbar, nicht weiter blättern
      if (page === 1 && l.length && !valid.length) { meta.hidden = true; break; }
      await onPage(valid, page, meta);
      if (!l.length || !d.next_page || d.next_page === page) break;
      page = d.next_page;
    }
    return { n, meta };
  }
  // Verwaltungsliste einer eigenen Gruppe (unverschleiert). Mit keyword = Namenssuche.
  async function manageMembers(cms, ctx, onPage, { keyword = '', sort = 'last_joined' } = {}) {
    let page = 1, n = 0, meta = null;
    ctx = ctx || { stop: () => false };
    for (let guard = 0; guard < 100000 && !ctx.stop(); guard++) {
      const d = await apiPost('group/attendee/manage/list', { cms_id: cms, page, limit: 30, keyword, sort }, { _version: 2 });
      const l = (d && d.users) || [];
      if (!meta) meta = { total: d.total || 0 };
      n += l.length;
      await onPage(l.map(normUser).filter(Boolean), page, meta);
      if (!l.length || !d.next_page || d.next_page === page) break;
      page = d.next_page;
    }
    return { n, meta };
  }
  // „Besonders böse Popsters“ aus den Einstellungen: User-IDs und Nicknames getrennt
  function evilTargets(s = S()) {
    const list = (s.expert.evil || []).map((t) => String(t).trim()).filter(Boolean);
    const uids = new Set(list.filter((t) => /^\d+$/.test(t)));
    for (const u of G.get('evil_ids', [])) uids.add(String(u));     // dauerhafte ID-Liste aus dem Tampermonkey-Speicher
    const nicks = new Set(list.filter((t) => !/^\d+$/.test(t)).map((t) => t.toLowerCase()));
    return { size: uids.size + nicks.size, uids, nicks };
  }
  const isEvil = (u, evil) => evil.size && (evil.uids.has(String(u.uid)) || evil.nicks.has((u.nick || '').toLowerCase()));
  // Ein Mitglied aus einer verwalteten Gruppe entfernen (mit Vermerk). Braucht den Nickname.
  async function kickEvil(g, u, res, ctx) {
    const when = new Date();
    const note = `Ignorant (${g.name}) blockiert am ${deDate(when)} um ${deTime(when)}`;
    if (dry()) { log('Testlauf – würde entfernen:', u.nick, 'aus', g.name); (ctx.notes || []).push(`${u.nick}: würde aus ${g.name} entfernt (Testlauf)`); res.kicked++; return; }
    try { await apiPost('group/attendee/note', { cms_id: g.cms, nickname: u.nick, note }, { _version: 2 }); }
    catch (e) { warn('Gruppennotiz', u.nick, e); }
    try {
      await apiPost('group/attendee/kick', { cms_id: g.cms, nickname: u.nick }, { _version: 2 });
      res.kicked++; (ctx.notes || []).push(`${u.nick}: aus ${g.name} entfernt (besonders böse)`);
      await Members.update(u.uid, (x) => { x.kicked = x.kicked || {}; x.kicked[g.cms] = now(); });
    } catch (e) { warn('Entfernen', u.nick, e); (ctx.notes || []).push(`${u.nick}: Entfernen aus ${g.name} fehlgeschlagen (${e.message})`); }
  }
  // Zuordnung ID → Nickname für die bösen Popsters liegt dauerhaft im Tampermonkey-Speicher (überlebt das Löschen der poppen.de-Browserdaten).
  const evilNames = () => G.get('evil_names', {});
  // Anzeigeliste (Nicknames, alphabetisch) aus den gemerkten IDs aufbauen und in die Einstellungen schreiben
  function buildEvilList() {
    const names = evilNames();
    const seenE = new Set();
    const list = G.get('evil_ids', [])
      .map((uid) => names[uid] || String(uid))
      .filter((e) => { const k = e.toLowerCase(); if (seenE.has(k)) return false; seenE.add(k); return true; })
      .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
    const s = clone(S());
    if (same(s.expert.evil || [], list)) return;
    s.expert.evil = list;
    saveSettings(s);
  }
  // „Besonders böse Popsters“ aus der Liste der mich blockierenden Popsters füllen (ersetzt den bisherigen Inhalt).
  // Nick-Auflösung: zuerst der Tampermonkey-Speicher; nur wenn dort noch keine Zuordnung steht, das Profilgedächtnis (und von dort in den TM-Speicher kopieren).
  async function refreshEvilFromBlockers() {
    let d;
    try { d = await apiGet('ignore/be-ignored/uid/list', { _version: 2 }); }
    catch (e) { warn('Blockierer-Liste', e); return; }
    const uids = [...new Set(((d && d.list) || []).map(String).filter((u) => /^\d+$/.test(u)))];
    G.set('evil_at', now());
    G.set('evil_ids', uids);
    const names = evilNames();
    let changed = false;
    for (const uid of uids) {
      if (names[uid]) continue;                          // TM-Speicher hat bereits eine Zuordnung → Gedächtnis nicht nötig
      const m = Members.cached().get(uid) || await Members.get(uid).catch(() => null);
      if (m && m.nick) { names[uid] = m.nick; changed = true; }
    }
    if (changed) G.set('evil_names', names);
    buildEvilList();
    log(`Besonders böse Popsters aus Blockierer-Liste ersetzt: ${uids.length} Einträge.`);
  }
  // Umgekehrt: TM-Speicher aus dem Profilgedächtnis nachführen, falls sich ein Nick geändert hat, die ID aber gleich blieb.
  async function syncEvilNames() {
    const names = evilNames();
    let changed = false;
    for (const uid of G.get('evil_ids', [])) {
      const m = Members.cached().get(uid) || await Members.get(uid).catch(() => null);
      if (m && m.nick && m.nick !== names[uid]) { names[uid] = m.nick; changed = true; }
    }
    if (changed) { G.set('evil_names', names); buildEvilList(); log('Besonders böse Popsters: Nicknames aus dem Gedächtnis nachgeführt.'); }
  }

  // ---------- Gruppen-Leitung (Besitzer + Moderatoren) ----------
  // Antwortformate sind nicht fest dokumentiert: Mitglieder-Objekte (uid + nickname) werden gesucht.
  function findUsers(d, keyRe, depth = 0, under = false) {
    const out = [];
    if (!d || typeof d !== 'object' || depth > 6) return out;
    if (Array.isArray(d)) { for (const x of d) out.push(...findUsers(x, keyRe, depth + 1, under)); return out; }
    if (under && (d.uid || d.user_id) && (d.nickname || d.name)) { const u = normUser(d); if (u) out.push(u); return out; }
    for (const [k, v] of Object.entries(d)) if (v && typeof v === 'object') out.push(...findUsers(v, keyRe, depth + 1, under || !keyRe || keyRe.test(k)));
    return out;
  }
  async function groupLead(cms) {
    const lead = new Map();
    try {
      const d = await apiGet('group/profile', { _version: 2, cms_id: cms });
      for (const u of findUsers(d, /creator|owner|besitzer/i)) lead.set(u.uid, { ...u, role: 'owner' });
    } catch (e) { warn('Gruppen-Besitzer ' + cms, e); }
    let mods = [];
    try {
      const d = await apiPost('group/moderator/list', { cms_id: cms });
      mods = findUsers(d, null).filter((u, i, l) => l.findIndex((x) => x.uid === u.uid) === i);
      for (const u of mods) if (!lead.has(u.uid)) lead.set(u.uid, { ...u, role: 'moderator' });
    } catch (e) { warn('Gruppen-Moderatoren ' + cms, e); mods = null; }
    return { lead: [...lead.values()], mods };
  }
  // Allein in der Leitung: als Moderator nie (es gibt den Besitzer); als Besitzer, wenn außer mir niemand moderiert.
  // Eigene weitere Profile zählen nicht als „ich“.
  function aloneIn(g, info) {
    if (g.role !== 'owner') return false;
    if (!info || info.mods == null) return false;            // Liste nicht lesbar → vorsichtshalber nicht allein
    const me = String(Me.uid());
    return !info.mods.some((u) => u.uid !== me);
  }

  // ---------- Gruppen (Whitelist) ----------
  // Leitung aller Gruppen → Whitelist (Geblockte entsperren); verwaltete Gruppen, die ich allein leite → alle Mitglieder Whitelist;
  // leite ich nicht allein → Whitelist-Einträge dieser Gruppe sofort entfernen, Mitglieder nach den Regeln behandeln (nur im Scan).
  async function refreshManagedWhitelist(ctx, groups) {
    const res = newRes();
    const s = S();
    groups = groups || (await loadGroups());
    const me = String(Me.uid());
    const all = [...groups.managed, ...groups.attended];
    const t0 = now();
    const alone = {};
    const unblock = async (m, why) => {
      if (m && m.blk && m.blk.opa && !m.unblk) {
        const r = await unblockOne(m);
        if (r === 'ok' || r === 'Test') { res.unblocked++; (ctx.notes || []).push(`${m.nick}: entsperrt, ${why}`); }
      }
    };
    // 1) Leitung aller Gruppen
    let gi = 0;
    for (const g of all) {
      if (ctx.stop()) return res;
      gi++;
      ctx.phase && ctx.phase(`Leitung ${gi}/${all.length}: ${g.name}`);
      ctx.outer && ctx.outer(gi - 1, all.length * 2);
      const info = await groupLead(g.cms);
      if (g.subset === 'managed') alone[g.cms] = aloneIn(g, info);
      for (const u of info.lead) {
        if (u.uid === me) continue;
        const m = await seen(u, 'Gruppen', { images: false });
        if (!m) continue;
        const was = !!(m.auto && m.auto.lead && m.auto.lead[g.cms]);
        await Members.update(u.uid, (x) => { x.auto = x.auto || {}; x.auto.lead = x.auto.lead || {}; x.auto.lead[g.cms] = now(); });
        if (!was) res.whitelisted++;
        await unblock(m, `weil ${u.role === 'owner' ? 'Besitzer' : 'Moderator'} von ${g.name}`);
      }
      ctx.step(gi, all.length, `${g.name}: ${info.lead.length} in der Leitung`);
    }
    // nicht mehr in der Leitung → Eintrag weg
    const ids = new Set(all.map((g) => g.cms));
    const stale = [];
    await Members.each((m) => { const l = m.auto && m.auto.lead; if (l && Object.entries(l).some(([c, ts]) => ts < t0 && ids.has(c))) stale.push(m.uid); });
    for (const uid of stale) await Members.update(uid, (x) => { for (const [c, ts] of Object.entries(x.auto.lead)) if (ts < t0 && ids.has(c)) delete x.auto.lead[c]; });
    // 2) verwaltete Gruppen: Whitelist + besonders böse Popsters entfernen (über die Verwaltungsliste, unverschleiert)
    const managed = groups.managed;   // in allen verwalteten Gruppen kann entfernt werden
    const evil = evilTargets(s);
    gi = 0;
    for (const g of managed) {
      if (ctx.stop()) break;
      gi++;
      ctx.outer && ctx.outer(all.length + gi - 1, all.length * 2);
      const wlOn = s.managedWhitelist[g.cms] !== false;
      const doWhite = wlOn && alone[g.cms];
      if (wlOn && !alone[g.cms]) {
        // nicht allein in der Leitung: Gruppen-Whitelist dieser Gruppe sofort entfernen
        const drop = [];
        await Members.each((m) => { if (m.auto && m.auto.grp && m.auto.grp[g.cms]) drop.push(m.uid); });
        for (const uid of drop) await Members.update(uid, (x) => { delete x.auto.grp[g.cms]; });
        if (drop.length) log(`${g.name}: nicht allein in der Leitung – ${drop.length} Whitelist-Einträge entfernt.`);
      }
      const judgeHere = ctx.full && wlOn && !alone[g.cms];   // nicht allein → Mitglieder nach den Regeln prüfen
      if (!(doWhite || judgeHere || evil.size)) continue;
      ctx.phase && ctx.phase(`${doWhite ? 'Whitelist' : 'Prüfen'}: ${g.name}`);
      const seenIds = new Set();
      const toKick = [];
      const { meta } = await manageMembers(g.cms, ctx, async (users, page, meta) => {
        for (const u of users) {
          if (String(u.uid) === me) continue;
          seenIds.add(u.uid);
          if (isEvil(u, evil)) toKick.push(u);
          if (doWhite) {
            const m = await seen(u, 'Gruppen', { images: false });
            const was = !!(m.auto && m.auto.grp && m.auto.grp[g.cms]);
            await Members.update(u.uid, (x) => { x.auto = x.auto || {}; x.auto.grp = x.auto.grp || {}; x.auto.grp[g.cms] = now(); });
            if (!was) res.whitelisted++;
            await unblock(m, `weil Mitglied in ${g.name}`);
          } else if (judgeHere) {
            await seen(u, 'Gruppen', { images: false });
          }
        }
        if (judgeHere) addRes(res, await judge(users, 'Gruppen'));
        ctx.step(page * 30, Math.max(1, meta.total), `${g.name}: ${fmtN(seenIds.size)} Mitglieder`);
      });
      // besonders böse Popsters entfernen, nachdem die Liste geladen ist
      for (const u of toKick) { if (ctx.stop()) break; await kickEvil(g, u, res, ctx); }
      if (ctx.stop() || !meta) break;
    }
    G.set('grp_alone', alone);
    if (!ctx.stop()) G.set('grp_wl_at', now());
    ctx.outer && ctx.outer(1, 1);
    return res;
  }
  const scanGroupsWhite = async (ctx) => { const r = await refreshManagedWhitelist({ ...ctx, full: true }); await syncEvilNames().catch((e) => warn('Nick-Abgleich', e)); return r; };

  // ---------- Gruppen (Blacklist) ----------
  // Mitglieder der Gruppen, in denen ich Mitglied bin, nach den Regeln prüfen (Whitelist wird in judge berücksichtigt)
  async function scanGroupsBlack(ctx) {
    const res = newRes();
    const groups = await loadGroups();
    const s = S();
    const list = groups.attended.filter((g) => s.groupScan[g.cms] !== false);
    let gi = 0;
    for (const g of list) {
      if (ctx.stop()) break;
      gi++;
      ctx.phase && ctx.phase(`Gruppe ${gi}/${list.length}: ${g.name}`);
      ctx.outer && ctx.outer(gi - 1, list.length);
      await groupMembers(g.cms, ctx, async (users, page, meta) => {
        for (const u of users) await seen(u, 'Gruppen', { images: false });
        addRes(res, await judge(users, 'Gruppen'));
        ctx.step(page * 30, Math.max(1, meta.total - meta.invisible), `${g.name}: Seite ${page}`);
      });
    }
    ctx.outer && ctx.outer(list.length, list.length);
    return res;
  }
  async function scanGroups(ctx) { const r = await scanGroupsWhite(ctx); return addRes(r, await scanGroupsBlack(ctx)); }

  // ---------- Mitgliedersuche, systematisch (Alter für Alter, ganz Deutschland) ----------
  // ---------- Suchseite schützen ----------
  // poppen merkt sich die zuletzt abgeschickte Suche (user/search) auf dem Server und lädt sie auf /search
  // über user/search/detailed/arguments. Hintergrund-Suchen würden sie überschreiben. Deshalb:
  //  - die Suche des Nutzers auf /search wird gemerkt (LastUserState),
  //  - beim Laden der Suchseite wird die Antwort von detailed/arguments auf diesen Stand umgeschrieben,
  //  - Hintergrund-Suchen pausieren, solange /search in irgendeinem Tab offen ist, und laufen erst
  //    5 Minuten nach dem Verlassen weiter (erneuter Besuch setzt die Frist zurück; der Fortschritt bleibt),
  //  - nach jedem Hintergrundlauf (und vor jeder Pause) wird der Server-Stand mit der Nutzer-Suche zurückgesetzt.
  const SEARCH_COOL = 5 * 60000;
  const SEARCH_FIELDS = ['genders', 'location', 'distance', 'age_min', 'age_max', 'has_image', 'sort', 'order', 'online',
    'enable_search_gender', 'enable_fakecheck_status', 'preference_conjunction', 'second_preference_conjunction',
    'size_min', 'size_max', 'weight_min', 'weight_max', 'figure', 'zodiac', 'smoker', 'searching', 'sexual_orientation'];
  const SearchGuard = (() => {
    const onSearch = () => location.pathname.startsWith('/search') && !xxlPageOn();   // XXL-Seite sucht nicht selbst
    let was = false;
    function beat() {
      const open = { ...(G.get('search_open', {}) || {}) };
      const t = now();
      for (const [k, ts] of Object.entries(open)) if (t - ts > 25000) delete open[k];
      const on = onSearch();
      if (on) open[TAB_ID] = t; else delete open[TAB_ID];
      if (was && !on) G.set('search_left', t);
      was = on;
      G.set('search_open', open);
    }
    function remaining() {
      const open = G.get('search_open', {}) || {};
      if (Object.values(open).some((ts) => now() - ts < 25000)) return Infinity;
      return Math.max(0, SEARCH_COOL - (now() - G.get('search_left', 0)));
    }
    const busy = () => remaining() > 0;
    function cleanState(b) {
      const o = {};
      for (const k of SEARCH_FIELDS) if (b && b[k] !== undefined) o[k] = clone(b[k]);
      return o;
    }
    // Nutzer-Suche auf der Suchseite mitschneiden (eigene Abfragen laufen am Beobachter vorbei)
    function record(body) {
      if (!onSearch() || !body || typeof body !== 'object') return;
      // alle vorkommenden Entfernungen merken (Stufen des Radius-Reglers; „Weltweit“ = ohne/ höchster Wert)
      const dv = body.distance === undefined ? 'ohne' : String(body.distance);
      const ds = { ...(G.get('search_distances', {}) || {}) }; ds[dv] = (ds[dv] || 0) + 1; G.set('search_distances', ds);
      G.set('search_user_state', { ...cleanState(body), at: now() });
    }
    async function ensureState() {
      if (G.get('search_user_state', null)) return;
      try {
        const d = await apiGet('user/search/detailed/arguments');
        if (d && typeof d === 'object') {
          const st = cleanState(d);
          if (st.location && d.lat != null && st.location.lat == null) st.location = { ...st.location, lat: d.lat, lon: d.lon };
          G.set('search_user_state', { ...st, at: now() });
        }
      } catch (e) { warn('Suchstand lesen', e); }
    }
    async function restore() {
      if (!G.get('search_dirty', false)) return;
      const st = G.get('search_user_state', null);
      if (!st) return;
      const { at, ...body } = st;
      try { await apiPost('user/search', { ...body, page: 1, limit: 1 }); G.set('search_dirty', false); log('Suchstand des Nutzers wiederhergestellt'); }
      catch (e) { warn('Suchstand zurückschreiben', e); }
    }
    // Antwort der Suchseite auf den Nutzer-Stand umschreiben
    function rewriteArgs(data) {
      const st = G.get('search_user_state', null);
      // nur wenn eine eigene Hintergrund-Suche den Server-Stand verändert hat (sonst gilt, was poppen liefert – auch von anderen Geräten)
      if (!st || !G.get('search_dirty', false) || !data || typeof data !== 'object') return null;
      const { at, ...body } = st;
      const out = { ...data };
      for (const k of SEARCH_FIELDS) delete out[k];
      Object.assign(out, clone(body));
      if (body.location && body.location.lat != null) { out.lat = body.location.lat; out.lon = body.location.lon; }
      return out;
    }
    // vor jeder Hintergrund-Suche: warten, solange die Suchseite offen ist (bzw. bis 5 Minuten danach)
    async function wait(ctx) {
      let paused = false;
      while (busy() && !(ctx && ctx.stop && ctx.stop())) {
        if (!paused) { paused = true; await restore(); }
        const r = remaining();
        const msg = r === Infinity ? 'Pause: Suchseite ist geöffnet' : `Pause: Suchseite war offen – weiter in ${Math.max(1, Math.ceil(r / 60000))} Min.`;
        if (ctx && ctx.phase) ctx.phase(msg);
        await sleep(5000);
      }
    }
    function start() {
      if (!ON_POPPEN) return;
      beat(); setInterval(beat, 5000);
      W.addEventListener('pagehide', () => { if (onSearch()) { const o = { ...(G.get('search_open', {}) || {}) }; delete o[TAB_ID]; G.set('search_open', o); G.set('search_left', now()); } });
      onApi(/^user\/search$/, (d, info) => { if (info.method === 'POST') record(info.body); });
      onApi(/^user\/search\/detailed\/arguments$/, null, (data) => rewriteArgs(data));
    }
    return { start, busy, remaining, wait, ensureState, restore, record, rewriteArgs };
  })();

  function searchBase() {
    const loc = G.get('mygeo', null) || { country_iso: 'DE', country_name: 'Germany' };
    return {
      location: { ...loc, distance: 0, distance_unit: 'km' }, has_image: 0, online: false, enable_search_gender: false,
      sort: ['last_riseup'], order: ['desc'], preference_conjunction: 'or', second_preference_conjunction: 'or',
      size_min: 130, size_max: 220, weight_min: 0, weight_max: 300, enable_fakecheck_status: false,
    };
  }
  async function searchAll(payload, ctx, onUsers, label) {
    let page = 1, n = 0, total = 0;
    await SearchGuard.ensureState();
    for (let guard = 0; guard < 100000 && !ctx.stop(); guard++) {
      await SearchGuard.wait(ctx);
      if (ctx.stop()) break;
      G.set('search_dirty', true);
      const d = await apiPost('user/search', { ...payload, page, limit: 20 });
      const l = (d && d.users) || [];
      total = d.total || total;
      n += l.length;
      await onUsers(l.map(normUser).filter(Boolean), page, total);
      if (label) ctx.step(n, total, `${label}: ${fmtN(n)} von ${fmtN(total)}`);
      if (!l.length || !d.next_page || d.next_page === page) break;
      page = d.next_page;
    }
    return { n, total };
  }
  async function scanSearch(ctx) {
    const res = newRes();
    const s = S();
    const base = searchBase();
    const plan = [];
    for (const gk of GROUP_KEYS) {
      const grp = s.groups[gk];
      if (!grp.ignore) continue;
      const lims = gk === 'p' && grp.separate ? [limitsOf(gk, 'suche', 0, s)[2], limitsOf(gk, 'suche', 1, s)[2]] : [limitsOf(gk, 'suche', -1, s)[2]];
      let from = Math.min(...lims);
      if (gk === 'p' && (grp.sugarDaddy.on || grp.sugarMom.on)) from = 18;
      for (const t of grp.types) plan.push({ gk, t, from });
    }
    const steps = plan.reduce((a, p) => a + (99 - p.from + 1), 0);
    let done = 0;
    try {
    for (const p of plan) {
      for (let age = AGE_MAX; age >= p.from && !ctx.stop(); age--) {
        ctx.outer && ctx.outer(done++, steps);
        ctx.phase && ctx.phase(`${TYPE_NAMES[p.t]} · ${age} Jahre`);
        await searchAll({ ...base, genders: [p.t], age_min: age, age_max: age }, ctx, async (users) => {
          for (const u of users) await seen(u, 'Suche', { images: false });
          addRes(res, await judge(users, 'Suche'));
        }, `${TYPE_NAMES[p.t]}, ${age} Jahre`);
      }
    }
    } finally { await SearchGuard.restore(); }
    ctx.outer && ctx.outer(steps, steps);
    return res;
  }

  // Treffer der Seite (Hooks): Antworten, die die Seite selbst lädt, nebenbei verbuchen
  function installPassiveHooks() {
    onApi(/^rates$/, (d) => seenMany(((d && d.rates) || []).map((r) => r.user).filter(Boolean), 'Likes'));
    onApi(/^my\/received\/gift$/, (d) => seenMany(((d && d.list) || []).map((g) => g.user).filter(Boolean), 'Sticker'));
    onApi(/^messenger\/group\/list$/, (d) => seenMany(((d && d.list) || []).filter((c) => c.group_type === 1 && c.group_data && !DELETED_NICK.test(c.group_data.nickname || '')).map((c) => c.group_data), 'Nachrichten'));
    onApi(/^group\/attendee\/list$/, (d) => seenMany((d && d.users) || [], 'Gruppen', { images: false }));
    onApi(/^user\/search$/, (d, info) => {
      if (info.body && info.body.location && info.body.location.geo_id && !G.get('mygeo', null)) {
        const { distance, distance_unit, ...geo } = info.body.location; G.set('mygeo', geo);
      }
      return seenMany((d && d.users) || [], 'Suche', { images: false });
    });
    onApi(/^v2\/ignore\/list$/, (d) => {
      const l = (d && d.list) || [];
      return Promise.all(l.map(async (e) => {
        const m = await seen(e.user, 'Blockierliste', { images: false });
        if (m) await Members.update(m.uid, (x) => { const pn = parseNote(e.note); x.blk = { at: pn ? pn.at : (x.blk && x.blk.at) || now(), src: pn ? pn.src : '', note: e.note || '', opa: !!pn }; delete x.unblk; });
      }));
    });
    onApi(/^messenger\/p2p\/profile\/display$/, () => {});
    // Profil-Angaben (user/info/<nick>): genaue Größe und Gewicht ins Gedächtnis (Figur-Badges)
    onApi(/^user\/info\/[^/]+$/, async (d) => { try { await ingestUserInfo(d); } catch (e) { warn('user/info', e); } });
    // eigene Freunde/Favoriten (ohne uid im Body; mit uid sind es die Freunde eines anderen Mitglieds)
    onApi(/^friends\/list$/, (d, info) => { if (info.body && info.body.uid) return; return markFF('friend', ((d && d.users) || []).filter(validUid)); });
    onApi(/^favourite\/list$/, (d, info) => { if (info.body && info.body.uid) return; return markFF('fav', ((d && d.users) || []).filter(validUid)); });
  }

  // =====================================================================================
  // Oberfläche: Stile, Popups im poppen-Stil, Markierungen
  // =====================================================================================
  const OLD_MAN_PATH = 'M3408 12790 c-235 -43 -487 -227 -651 -477 -33 -50 -47 -63 -67 -63 -37 0 -119 -24 -168 -49 -102 -52 -148 -120 -201 -298 -48 -164 -73 -337 -69 -483 3 -112 6 -131 30 -180 15 -30 41 -64 58 -75 29 -19 30 -23 30 -92 0 -39 -3 -74 -8 -77 -4 -2 -86 -1 -182 4 -273 12 -411 -7 -566 -80 -227 -105 -387 -276 -518 -551 -127 -266 -203 -574 -253 -1019 -22 -199 -25 -1016 -5 -1265 20 -240 60 -603 82 -750 12 -82 15 -131 9 -133 -6 -3 -6 -8 0 -16 7 -8 -3 -51 -30 -136 -109 -339 -191 -737 -235 -1140 -22 -191 -25 -693 -6 -845 33 -258 72 -434 158 -699 234 -721 431 -1986 554 -3566 12 -145 22 -265 23 -266 1 -1 52 -16 114 -34 98 -29 113 -36 121 -59 45 -127 347 -276 743 -366 622 -140 1209 -69 1131 137 l-10 28 168 0 c273 0 423 30 492 100 62 62 50 120 -43 204 -59 53 -250 150 -377 191 l-84 27 6 77 c35 439 116 2702 166 4611 15 587 12 548 44 595 65 94 130 255 161 400 9 44 19 87 21 97 4 13 23 4 102 -49 201 -134 411 -220 617 -252 109 -16 209 -22 222 -14 18 13 32 57 39 126 l6 64 69 -35 69 -36 0 -156 c0 -170 4 -186 60 -215 37 -19 64 -19 104 0 55 26 61 45 66 214 l5 155 28 7 27 7 0 -2924 c0 -3216 -5 -2965 60 -2999 62 -32 136 -10 164 49 15 31 16 279 16 3052 l0 3017 25 64 c99 246 -33 525 -286 604 -33 10 -83 19 -110 19 -27 0 -60 6 -72 14 -37 24 -132 36 -367 46 -124 6 -272 15 -330 20 -98 9 -467 74 -476 83 -3 2 -9 91 -14 198 -27 543 -53 829 -125 1389 l-6 45 53 35 c141 94 296 282 422 513 20 37 42 67 49 67 7 0 46 -17 87 -38 59 -29 78 -45 93 -74 30 -59 36 -140 25 -308 -13 -195 -6 -359 17 -424 26 -71 104 -148 178 -175 200 -73 369 48 421 302 9 42 16 81 16 86 0 17 -87 71 -148 92 -72 26 -220 28 -308 5 -34 -9 -66 -16 -72 -16 -5 0 -11 71 -15 173 -4 137 -9 186 -26 239 -28 89 -88 155 -173 193 -35 15 -65 29 -66 31 -2 1 10 39 27 83 40 105 106 337 122 433 11 69 16 78 40 88 77 32 105 336 42 457 -16 31 -21 68 -27 190 -4 84 -14 199 -21 255 -14 100 -13 104 6 120 23 19 35 74 25 113 -6 24 -10 26 -39 21 l-32 -6 -19 82 c-10 46 -35 137 -57 203 -171 527 -466 883 -824 994 -79 25 -249 36 -327 21z';
  // Oma-Symbol (Fassung A1 aus dem JOYclub-Skript, 32×64, ×20 auf das 640×1280-Raster skaliert)
  const OMA_PARTS = '<circle cx="9.6" cy="9.2" r="3.3"/><circle cx="15.2" cy="12.4" r="5"/><path d="M8.4 16.2 C5.6 19.6 5.8 26 8.2 32 L4.6 53 L22.8 53 L19 33 C20.6 29 21 24.6 19.2 20.4 C16.6 17.2 12.2 15.4 8.4 16.2Z"/><path d="M17.4 21.6 C20.6 23.4 23.2 26 25.4 29.2 L23.8 30.4 C21.4 28 19 26 16.4 24.6Z"/><path d="M24.8 29.6 L24.8 62" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M24.8 29.6 C24.8 26.4 28.8 26.4 28.8 29.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><rect x="9.6" y="52" width="3.2" height="9" rx="1"/><rect x="14.6" y="52" width="3.2" height="9" rx="1"/><path d="M8.2 60 h5.6 v2.6 h-6.6 z"/><path d="M13.6 60 h6 v2.6 h-6 z"/>';
  // Opa bzw. Oma (eigenes Männer-Profil → „Oma“) als <g> im 640×1280-Raster
  const figG = () => (typeof Me !== 'undefined' && Me.male() ? `<g transform="scale(20)">${OMA_PARTS}</g>` : `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OLD_MAN_PATH}"></path></g>`);
  const oldManSvg = (scale = 1.25) => `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 640 1280" preserveAspectRatio="xMidYMid meet" fill="currentColor" style="transform:scale(${scale})">${figG()}</svg>`;
  // Schalter-Symbol „Opa-/Oma-Schutz“: aus = Umriss im Kreis, an = gefüllt im Kreis mit Schrägstrich
  let protSvgN = 0;
  function protectSvg(on) {
    const id = 'vaf-sil' + (protSvgN++);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1600" width="1em" height="1em" fill="currentColor" stroke="currentColor" aria-hidden="true">` +
      `<defs><filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="erode" radius="55" result="e"/><feComposite in="SourceGraphic" in2="e" operator="out"/></filter></defs>` +
      `<circle cx="800" cy="800" r="735" stroke-width="120" fill="none"/>` +
      `<g${on ? '' : ` filter="url(#${id})"`}><g transform="translate(506,226) scale(0.9)">${figG()}</g></g>` +
      (on ? '<line x1="280" y1="1320" x2="1320" y2="280" stroke-width="120" stroke-linecap="round"/>' : '') + '</svg>';
  }

  // Opa mit Stift (Menüeintrag „Opa-Schutz“): Stift von „Profil bearbeiten“ verkleinert unten rechts, mit Rand in Hintergrundfarbe
  const PEN_PATH = 'M21.988 2.514C21.14 1.698 19.395.258 18.273.057c-1.873-.328-3.069.826-4.222 1.938-1.82 1.758-3.62 3.6-5.365 5.38-2.19 2.244-4.455 4.553-6.794 6.734-.836.922-.846 1.673-.857 2.626 0 .202 0 .403-.01.625-.053 1.165-.085 2.542 0 3.908.116 1.99.687 2.541 2.74 2.658A42 42 0 0 0 6.326 24c.836 0 1.661-.021 2.392-.074.952-.064 1.534-.307 2.158-.868 2.074-1.885 4.085-3.993 6.032-6.026 2.064-2.16 4.19-4.395 6.413-6.375 1.069-.964 1.63-2.001 1.65-3.092.032-1.906-1.565-3.707-2.973-5.051zm-1.778 8.672-9.789 9.732-.127-.052c-1.598-2.097-3.576-4.078-6.2-6.238l9.745-9.838c.37.138 2.074 1.494 2.54 1.896 1.249 1.112 2.35 2.33 3.196 3.516l.137.2s.085.107.138.17c.106.127.423.52.37.604zM15.194 3.52a7 7 0 0 1 .444-.52c1.037-1.111 1.937-1.408 2.847-.931.444.233 1.185.826 1.735 1.302l.477.435c.846.815 2.18 2.53 2.338 3.61.127.9-.624 1.578-1.29 2.182-.075.064-.149.138-.223.201l-1.714-2.181c-1.45-1.567-2.91-2.88-4.487-4.024a.6.6 0 0 0-.138-.074zM8.982 22.062h-.37c-1.418.074-2.89.127-4.318.064-.074 0-.137-.021-.211-.032-.074-.021-.149-.032-.223-.043h-.306c-.35.022-.604.022-.635-.137-.106-2.298-.117-4.183-.011-5.93.064.042.148.106.275.211 1.905 1.515 3.556 3.145 5.185 5.126l.096.116s.042.053.084.096c.212.243.36.413.445.53h-.01Z';
  const oldManPenSvg = () => `<span style="position:relative;display:inline-flex;width:1em;height:1em">${oldManSvg(1)}<svg viewBox="0 0 25 24" width="0.62em" height="0.62em" style="position:absolute;right:-0.28em;bottom:-0.12em;overflow:visible" aria-hidden="true"><path d="${PEN_PATH}" fill="none" stroke="var(--vaf-menu-bg,#1f1f1f)" stroke-width="5" stroke-linejoin="round"/><path d="${PEN_PATH}" fill="currentColor"/></svg></span>`;

  const UI_CSS = `
  .vaf-ov{position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1.45;color:#e8e8e8}
  .vaf-ov, .vaf-ov button, .vaf-ov input, .vaf-ov select, .vaf-ov textarea{font-family:inherit}
  .vaf-md{width:min(640px,94vw);max-height:92vh;overflow:auto;background:#1f1f1f;border-radius:18px;padding:24px 24px 20px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
  .vaf-md.vaf-wide{width:min(900px,96vw)}
  .vaf-md h2{margin:0;font-size:22px;font-weight:700;color:#fff}
  .vaf-md h3{margin:14px 0 6px;font-size:15px;color:#fff}
  .vaf-sub{color:#a6a6a6;margin:4px 0 16px}
  .vaf-warn{background:rgba(255,194,26,.14);color:#ffd35c;border-radius:10px;padding:8px 12px;margin-bottom:14px}
  .vaf-err{background:rgba(229,57,53,.15);color:#ff8a80;border-radius:10px;padding:8px 12px;margin-bottom:14px}
  .vaf-bar{height:10px;background:#333;border-radius:6px;overflow:hidden;margin:6px 0 4px}
  .vaf-bar>div{height:100%;background:#ffc21a;width:0;transition:width .3s}
  .vaf-cur{color:#a6a6a6;font-size:13px;margin-bottom:10px;min-height:19px}
  .vaf-stats{display:grid;grid-template-columns:1fr auto;gap:4px 16px;background:#2a2a2a;border-radius:12px;padding:12px 14px;margin-bottom:16px}
  .vaf-stats b{color:#fff;text-align:right}
  .vaf-btns{display:flex;flex-direction:column;gap:10px}
  .vaf-btns.vaf-row{flex-direction:row;flex-wrap:wrap}
  .vaf-big{width:100%;border:0;border-radius:12px;padding:12px;font-weight:700;font-size:15px;cursor:pointer;background:#3a3a3a;color:#fff}
  .vaf-row .vaf-big{width:auto;flex:1 1 auto}
  .vaf-big.vaf-pri{background:#ffc21a;color:#141414}
  .vaf-big:disabled{opacity:.45;cursor:default}
  .vaf-big.vaf-focus{outline:2px solid #fff;outline-offset:-2px}
  .vaf-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px}
  .vaf-tilew{display:flex;flex-direction:column;gap:4px}.vaf-tilew .vaf-tile{flex:1;width:100%}
  .vaf-tsel{font-size:12px;color:#a6a6a6;display:flex;gap:6px;align-items:center;padding-left:4px;cursor:pointer}
  .vaf-tile{background:#2a2a2a;border:0;border-radius:12px;padding:12px;text-align:left;color:#e8e8e8;cursor:pointer}
  .vaf-tile b{display:block;color:#fff;font-size:15px}
  .vaf-tile span{color:#a6a6a6;font-size:12.5px}
  .vaf-tile:disabled{opacity:.4;cursor:default}
  .vaf-tile.vaf-on{outline:2px solid #ffc21a}
  .vaf-list{max-height:40vh;overflow:auto;background:#2a2a2a;border-radius:12px;padding:8px 12px;margin-bottom:12px;font-size:13px}
  .vaf-list div{padding:2px 0;border-bottom:1px solid #333}
  .vaf-in{width:100%;background:#141414;border:1px solid #3a3a3a;border-radius:10px;padding:8px 12px;color:#e8e8e8;font-size:14px;box-sizing:border-box}
  .vaf-chk{display:flex;align-items:center;gap:8px;margin:6px 0;cursor:pointer}
  .vaf-mark{font:600 11px/1.3 system-ui,sans-serif;padding:2px 6px;border-radius:4px;display:inline-block;margin:2px 4px 2px 0;white-space:nowrap}
  .vaf-prev{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 10px 50px rgba(0,0,0,.8);z-index:2147483646;pointer-events:none;display:none}
  .vaf-toast{position:fixed;right:16px;bottom:16px;z-index:2147483645;background:#1f1f1f;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:12px;padding:10px 14px;max-width:340px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)}
  .vaf-toast b{color:#ffc21a}
  .vaf-hdr-dot{position:absolute;top:-4px;left:-6px;background:#ffc21a;color:#141414;border-radius:10px;font:700 11px/16px system-ui;min-width:16px;padding:0 4px;text-align:center;cursor:pointer;z-index:2}
  .vaf-strike{text-decoration:line-through}
  .vaf-also{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
  .vaf-also-i{display:inline-flex;align-items:center;white-space:nowrap}
  .vaf-plus{min-width:44px;height:24px;padding:0 14px;border-radius:12px;border:1px solid #6b6f76;background:transparent;color:inherit;font:bold 16px/1 system-ui,sans-serif;cursor:pointer}
  .vaf-plus:hover{border-color:#ffc21a;color:#ffc21a}
  .vaf-scanlist{display:flex;flex-direction:column;gap:8px;margin:6px 0 4px}
  .vaf-scanrow{display:flex;align-items:flex-start;gap:12px;background:#2a2a2a;border-radius:12px;padding:12px 14px;cursor:pointer}
  .vaf-scanrow input{margin-top:3px;width:18px;height:18px;flex:none;accent-color:#e53935}
  .vaf-scanrow-tx{display:flex;flex-direction:column}
  .vaf-scanrow-tx b{color:#fff;font-size:15px}
  .vaf-scanrow-tx span{color:#a6a6a6;font-size:12.5px}
  .vaf-scanrow-off{opacity:.5;cursor:default}
  .vaf-hdr-act{position:absolute;right:-3px;bottom:-2px;width:15px;height:15px;border-radius:50%;background:#e53935;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 0 0 2px #1f1f1f}
  .vaf-hdr-act svg{width:10px;height:10px}
  .vaf-blk-head h2{margin:0 0 4px}
  .vaf-blk-sub{color:#a6a6a6;font-size:13px;margin-bottom:16px}
  .vaf-blk-empty{color:#a6a6a6;padding:16px 0}
  .vaf-blk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
  .vaf-blk-item{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,.07)}
  .vaf-blk-ava{width:48px;height:48px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:#2a2a2a}
  .vaf-blk-ph{display:flex;align-items:center;justify-content:center;color:#cfcfcf;font-weight:600;font-size:18px}
  .vaf-blk-txt{display:flex;flex-direction:column;min-width:0}
  .vaf-blk-name{font-weight:600;color:#fff;text-decoration:none}
  a.vaf-blk-name:hover{text-decoration:underline}
  .vaf-blk-meta{color:#a6a6a6;font-size:13px}
  `;
  function ensureStyle() {
    if (document.getElementById('vaf-style')) return;
    const st = document.createElement('style');
    st.id = 'vaf-style';
    st.textContent = UI_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // Popup-Gerüst; buttons = [{ label, fn, primary, focus, disabled }]
  function modal({ title = '', sub = '', html = '', wide = false, closable = true, onClose = null } = {}) {
    ensureStyle();
    const ov = document.createElement('div');
    ov.className = 'vaf-ov';
    const md = document.createElement('div');
    md.className = 'vaf-md' + (wide ? ' vaf-wide' : '');
    md.innerHTML = (title ? `<h2>${esc(title)}</h2>` : '') + (sub ? `<div class="vaf-sub">${sub}</div>` : '') + `<div class="vaf-body">${html}</div><div class="vaf-btns"></div>`;
    ov.appendChild(md);
    document.body.appendChild(ov);
    const m = {
      ov, md, closable, body: md.querySelector('.vaf-body'),
      close() { if (!ov.isConnected) return; ov.remove(); document.removeEventListener('keydown', onKey, true); if (onClose) onClose(); },
      buttons(list, row = false) {
        const box = md.querySelector('.vaf-btns');
        box.className = 'vaf-btns' + (row ? ' vaf-row' : '');
        box.innerHTML = '';
        m.focusBtn = null;
        for (const b of list) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'vaf-big' + (b.primary ? ' vaf-pri' : '') + (b.focus ? ' vaf-focus' : '');
          el.textContent = b.label;
          el.disabled = !!b.disabled;
          if (b.title) el.title = b.title;
          el.addEventListener('click', () => b.fn(el));
          if (b.focus) m.focusBtn = el;
          box.appendChild(el);
        }
      },
    };
    const onKey = (e) => {
      if (!ov.isConnected) return;
      if (e.key === 'Escape' && m.closable) { e.preventDefault(); e.stopPropagation(); m.close(); }
      if (e.key === 'Enter' && m.focusBtn && !m.focusBtn.disabled && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); m.focusBtn.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && m.closable) m.close(); });
    return m;
  }
  // Rückfrage mit mehreren Antworten; liefert den Wert der gewählten Antwort (Esc = Wert der focus-Antwort mit cancel)
  function ask(title, html, answers) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
      const cancel = answers.find((a) => a.cancel);
      const m = modal({ title, html, onClose: () => { if (!done) { done = true; resolve(cancel ? cancel.value : null); } } });
      m.buttons(answers.map((a) => ({ label: a.label, primary: a.primary, focus: a.focus, fn: () => fin(a.value) })));
    });
  }
  function toast(html, ms = 6000) {
    ensureStyle();
    let t = document.getElementById('vaf-toast');
    if (!t) { t = document.createElement('div'); t.id = 'vaf-toast'; t.className = 'vaf-toast'; document.body.appendChild(t); }
    t.innerHTML = html;
    clearTimeout(t._t);
    if (ms) t._t = setTimeout(() => t.remove(), ms);
    return t;
  }

  // ---------- Markierung eines Mitglieds auf Listen ----------
  const COLORS = { 1: '#43a047', 2: '#ffb74d', near: '#e65100', 3: '#e53935', white: '#ffffff', unclear: '#8c8c8c', blocked: '#7b1fa2' };
  function markInfo(x, src, m) {
    const s = S();
    const c = classify({ ...(m || {}), ...x }, src, s);
    const gk = c.gk;
    const visual = gk ? s.groups[gk].visual : false;
    const blocked = m && m.blk && !m.unblk;
    const jg = m && m.birth && m.birth.length ? m.birth.map(yearText).join('/') : '';
    let color = '', text = '';
    const ages = (x.ages && x.ages.length ? x.ages : (m && m.ages) || []).join('/');
    if (c.unclear) { color = COLORS.unclear; text = `${ages}? unklar`; }
    else if (c.white) { color = COLORS.white; text = `${ages} · ${c.white}`; }
    else if (blocked) { color = COLORS[3]; text = `${c.label || word()} · ${ages} · blockiert`; }
    else if (c.ignore) { color = COLORS[3]; text = `${c.label} · ${ages} → Warteliste`; }
    else if (c.near && visual) { color = COLORS.near; text = `${c.label} · ${ages} · vorgemerkt`; }
    else if (visual && c.stage) { color = COLORS[c.stage]; text = `${c.label} · ${ages}`; }
    if (!text) return null;
    if (jg && (blocked || c.white || c.near)) text += ` (Jg. ${jg})`;
    return { color, text, dark: color === COLORS.white || color === COLORS[2], c };
  }
  function putMark(host, info, cls = 'vaf-mark') {
    if (!host) return;
    let b = host.querySelector(':scope > .' + cls);
    if (!info) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.className = cls; host.prepend(b); }
    if (b.textContent !== info.text) b.textContent = info.text;
    b.style.cssText = `background:${info.color};color:${info.dark ? '#111' : '#fff'}`;
  }
  // =====================================================================================
  // Bausteine im poppen-Design (Suchfilter-Optik): Klappliste, Schieberegler (1–2 Griffe,
  // auch mit festen Stufen), Kästchen, Kästchen-Gruppe, Formularzeile, Trennlinie.
  // Eigene Klassen (vaf-pk-*), nachgebaut nach poppens Suchfiltern (Farben/Rundungen/Größen).
  // =====================================================================================
  const PK_CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a1 1 0 0 1-.71-.29l-4-4a1.003 1.003 0 1 1 1.42-1.42L12 13.1l3.3-3.18a1 1 0 1 1 1.38 1.44l-4 3.86a1 1 0 0 1-.68.28"/></svg>';
  const PK_CSS = `
.vaf-pk{--pk-y:#f5b800;--pk-yd:#3a2c00;--pk-f:#2b2b2b;--pk-f2:#363636;--pk-b:#3d3d3d;--pk-t:#f2f2f2;--pk-m:#9a9a9a;color:var(--pk-t);font-family:inherit}
.vaf-pk h2.vaf-pk-h{font-size:24px;font-weight:700;margin:4px 0 18px;color:#fff}
.vaf-pk-item{margin:0 0 20px}
.vaf-pk-lab{display:block;font-weight:700;font-size:17px;color:#fff;margin:0 0 9px}
.vaf-pk-div{height:1px;background:#2e2e2e;margin:4px 0 22px}
.vaf-pk-sel{position:relative;display:flex;align-items:center;gap:8px;min-height:50px;padding:0 14px 0 16px;border-radius:14px;background:var(--pk-f);border:2px solid transparent;cursor:pointer;font-size:17px;color:var(--pk-t);user-select:none;box-sizing:border-box;transition:border-color .15s}
.vaf-pk-sel:hover{border-color:#4a4a4a}
.vaf-pk-sel.open,.vaf-pk-sel:focus-visible{border-color:var(--pk-y);outline:none}
.vaf-pk-sel .v{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vaf-pk-sel.open .v{color:var(--pk-m)}
.vaf-pk-sel .c{font-size:20px;color:var(--pk-m);display:flex;transition:transform .15s}
.vaf-pk-sel.open .c{transform:rotate(180deg)}
.vaf-pk-dd{position:fixed;z-index:2147483000;background:#2b2b2b;border-radius:16px;padding:8px;box-shadow:0 8px 28px rgba(0,0,0,.55);overflow-y:auto;box-sizing:border-box;font-family:inherit}
.vaf-pk-dd .o{padding:13px 14px;margin:2px 0;border-radius:14px;font-size:17px;font-weight:700;color:#f2f2f2;cursor:pointer;background:#353535}
.vaf-pk-dd .o:hover,.vaf-pk-dd .o.act{background:#404040}
.vaf-pk-dd .o.sel{background:var(--pk-yd,#3a2c00);color:#f5b800}
.vaf-pk-sl{position:relative;height:44px;margin:0 10px;touch-action:none;cursor:pointer}
.vaf-pk-sl .r{position:absolute;left:0;right:0;top:13px;height:4px;border-radius:2px;background:#4a4a4a}
.vaf-pk-sl .k{position:absolute;top:13px;height:4px;border-radius:2px;background:#f5b800}
.vaf-pk-sl .d{position:absolute;top:11px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:#2b2b2b;border:2px solid #4a4a4a;box-sizing:border-box}
.vaf-pk-sl .d.on{border-color:#f5b800}
.vaf-pk-sl .h{position:absolute;top:5px;width:20px;height:20px;margin-left:-10px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px #f5b800;cursor:grab;outline:none}
.vaf-pk-sl .h:focus-visible{box-shadow:0 0 0 4px rgba(245,184,0,.5)}
.vaf-pk-sl .h .tip{position:absolute;bottom:26px;left:50%;transform:translateX(-50%);background:#111;color:#fff;border-radius:6px;padding:3px 7px;font-size:12.5px;white-space:nowrap;display:none}
.vaf-pk-sl .h:hover .tip,.vaf-pk-sl.drag .h .tip{display:block}
.vaf-pk-sl .m{position:absolute;top:26px;font-size:14px;color:var(--pk-m,#9a9a9a);transform:translateX(-50%);white-space:nowrap}
.vaf-pk-sl .m.first{transform:none;margin-left:-10px}.vaf-pk-sl .m.last{transform:translateX(-100%);margin-left:10px}
.vaf-pk-val{font-size:14px;color:var(--pk-m,#9a9a9a);margin:-2px 0 0;text-align:right}
.vaf-pk-cb{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:17px;color:var(--pk-t,#f2f2f2);user-select:none;margin:0 16px 10px 0}
.vaf-pk-cb .bx{width:20px;height:20px;border-radius:5px;border:2px solid #5a5a5a;background:#1b1b1b;box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 auto;transition:all .12s}
.vaf-pk-cb.on .bx{background:#f5b800;border-color:#f5b800}
.vaf-pk-cb.on .bx::after{content:"";width:5px;height:10px;border:solid #141414;border-width:0 2.5px 2.5px 0;transform:rotate(45deg) translate(-1px,-1px)}
.vaf-pk-cbg{display:flex;flex-wrap:wrap}
`;
  function pkStyle() {
    if (document.getElementById('vaf-pk-style')) return;
    const st = document.createElement('style'); st.id = 'vaf-pk-style'; st.textContent = PK_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  // Formularzeile mit Überschrift
  function pkItem(label, ctrl) {
    const d = document.createElement('div'); d.className = 'vaf-pk-item';
    if (label) { const l = document.createElement('div'); l.className = 'vaf-pk-lab'; l.textContent = label; d.appendChild(l); }
    if (ctrl) d.appendChild(ctrl);
    return d;
  }
  const pkDivider = () => { const d = document.createElement('div'); d.className = 'vaf-pk-div'; return d; };

  // Klappliste: opts = [[wert, text], …]
  let pkOpenDd = null;
  function pkCloseDd() { if (pkOpenDd) { const x = pkOpenDd; pkOpenDd = null; x.close(); } }
  function pkSelect(opts, value, onChange) {
    pkStyle();
    const el = document.createElement('div'); el.className = 'vaf-pk-sel'; el.tabIndex = 0; el.setAttribute('role', 'combobox');
    el.innerHTML = `<span class="v"></span><span class="c">${PK_CHEVRON}</span>`;
    let cur = value;
    const label = () => { const o = opts.find(([v]) => String(v) === String(cur)); return o ? o[1] : (opts[0] ? opts[0][1] : ''); };
    const paint = () => { el.querySelector('.v').textContent = label(); el.title = label(); };
    let dd = null, act = -1;
    const close = () => { if (dd) { dd.remove(); dd = null; } el.classList.remove('open'); document.removeEventListener('pointerdown', outside, true); W.removeEventListener('scroll', place, true); W.removeEventListener('resize', place); };
    const outside = (e) => { if (dd && !dd.contains(e.target) && !el.contains(e.target)) pkCloseDd(); };
    const place = () => {
      if (!dd) return;
      const r = el.getBoundingClientRect(), vh = W.innerHeight || 800;
      const want = Math.min(opts.length * 52 + 16, Math.round(vh * 0.6));
      const below = vh - r.bottom - 8, above = r.top - 8;
      const h = Math.min(want, Math.max(below, above));
      dd.style.left = r.left + 'px'; dd.style.width = r.width + 'px'; dd.style.maxHeight = h + 'px';
      dd.style.top = (below >= want || below >= above ? r.bottom + 6 : r.top - 6 - Math.min(want, h)) + 'px';
    };
    const pick = (v) => { cur = v; paint(); pkCloseDd(); try { onChange && onChange(v); } catch (e) { warn('Klappliste', e); } };
    const open = () => {
      pkCloseDd();
      dd = document.createElement('div'); dd.className = 'vaf-pk-dd vaf-pk'; dd.setAttribute('role', 'listbox');
      dd.innerHTML = opts.map(([v, n], i) => `<div class="o${String(v) === String(cur) ? ' sel' : ''}" data-i="${i}" role="option">${esc(n)}</div>`).join('');
      dd.addEventListener('click', (e) => { const o = e.target.closest('.o'); if (o) pick(opts[+o.dataset.i][0]); });
      document.body.appendChild(dd);
      el.classList.add('open');
      place();
      const s = dd.querySelector('.o.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
      act = opts.findIndex(([v]) => String(v) === String(cur));
      document.addEventListener('pointerdown', outside, true); W.addEventListener('scroll', place, true); W.addEventListener('resize', place);
      pkOpenDd = { close };
    };
    el.addEventListener('click', () => (dd ? pkCloseDd() : open()));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { pkCloseDd(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!dd) open(); else if (act >= 0) pick(opts[act][0]); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!dd) open();
        act = Math.max(0, Math.min(opts.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1)));
        dd.querySelectorAll('.o').forEach((o, i) => o.classList.toggle('act', i === act));
        const a = dd.querySelector('.o.act'); if (a) a.scrollIntoView({ block: 'nearest' });
      }
    });
    paint();
    el.vafSet = (v) => { cur = v; paint(); };
    el.vafGet = () => cur;
    return el;
  }

  // Schieberegler. o = { min, max, values:[a] | [a,b], steps?:[werte…] (feste Stufen, Index-basiert),
  //   fmt(v), marks?: [[wert, text]] (Beschriftung unter dem Regler), onChange([…]), live([…]) }
  function pkSlider(o) {
    pkStyle();
    const steps = Array.isArray(o.steps) && o.steps.length ? o.steps : null;
    const min = steps ? 0 : o.min, max = steps ? steps.length - 1 : o.max;
    const toIdx = (v) => { if (!steps) return v; const i = steps.indexOf(v); return i >= 0 ? i : steps.reduce((b, s, j) => (Math.abs(s - v) < Math.abs(steps[b] - v) ? j : b), 0); };
    const fromIdx = (i) => (steps ? steps[i] : i);
    const fmt = o.fmt || String;
    const cur = (o.values || [min]).map(toIdx);
    const el = document.createElement('div'); el.className = 'vaf-pk-sl';
    el.innerHTML = '<div class="r"></div><div class="k"></div>' + (steps ? steps.map(() => '<span class="d"></span>').join('') : '') + cur.map(() => '<span class="h" tabindex="0" role="slider"><span class="tip"></span></span>').join('');
    const marks = o.marks || [[fromIdx(min), fmt(fromIdx(min))], [fromIdx(max), fmt(fromIdx(max))]];
    marks.forEach(([v, t], i) => { const m = document.createElement('span'); m.className = 'm' + (i === 0 ? ' first' : i === marks.length - 1 ? ' last' : ''); m.dataset.v = String(toIdx(v)); m.textContent = t; el.appendChild(m); });
    const hs = [...el.querySelectorAll('.h')], k = el.querySelector('.k'), dots = [...el.querySelectorAll('.d')];
    const pct = (i) => ((i - min) / ((max - min) || 1)) * 100;
    const draw = () => {
      hs.forEach((h, i) => { h.style.left = pct(cur[i]) + '%'; h.querySelector('.tip').textContent = fmt(fromIdx(cur[i])); h.setAttribute('aria-valuenow', String(fromIdx(cur[i]))); h.setAttribute('aria-valuetext', fmt(fromIdx(cur[i]))); });
      const a = cur.length === 2 ? cur[0] : min, b = cur.length === 2 ? cur[1] : cur[0];
      k.style.left = pct(a) + '%'; k.style.width = (pct(b) - pct(a)) + '%';
      dots.forEach((d, i) => { d.style.left = pct(i) + '%'; d.classList.toggle('on', i >= a && i <= b); });
      el.querySelectorAll('.m').forEach((m) => { m.style.left = pct(+m.dataset.v) + '%'; });
      if (o.live) try { o.live(cur.map(fromIdx)); } catch {}
    };
    const valAt = (x) => { const r = el.getBoundingClientRect(); const t = Math.max(0, Math.min(1, (x - r.left) / (r.width || 1))); return Math.round(min + t * (max - min)); };
    const clampI = (i, v) => Math.max(i && cur.length === 2 ? cur[0] : min, Math.min(i === 0 && cur.length === 2 ? cur[1] : max, v));
    const fire = () => { try { o.onChange && o.onChange(cur.map(fromIdx)); } catch (e) { warn('Regler', e); } };
    let dragI = -1;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const v = valAt(e.clientX);
      dragI = cur.length === 2 ? (Math.abs(v - cur[0]) <= Math.abs(v - cur[1]) ? (v > cur[1] ? 1 : 0) : 1) : 0;
      if (cur.length === 2 && cur[0] === cur[1]) dragI = v < cur[0] ? 0 : 1;
      cur[dragI] = clampI(dragI, v); draw();
      el.classList.add('drag');
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => { if (dragI < 0) return; const v = clampI(dragI, valAt(e.clientX)); if (v !== cur[dragI]) { cur[dragI] = v; draw(); } });
    const end = () => { if (dragI < 0) return; dragI = -1; el.classList.remove('drag'); fire(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    hs.forEach((h, i) => h.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!d) return; e.preventDefault(); cur[i] = clampI(i, cur[i] + d); draw(); fire();
    }));
    draw();
    el.vafSet = (vals) => { vals.forEach((v, i) => { cur[i] = toIdx(v); }); draw(); };
    return el;
  }
  // Kästchen
  function pkCheck(label, on, onChange) {
    pkStyle();
    const el = document.createElement('span'); el.className = 'vaf-pk-cb' + (on ? ' on' : ''); el.tabIndex = 0; el.setAttribute('role', 'checkbox');
    el.innerHTML = `<span class="bx"></span><span class="t">${esc(label)}</span>`;
    el.setAttribute('aria-checked', String(!!on));
    const tog = () => { on = !on; el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); try { onChange && onChange(on); } catch (e) { warn('Kästchen', e); } };
    el.addEventListener('click', tog);
    el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tog(); } });
    return el;
  }
  // Kästchen-Gruppe (Mehrfachauswahl): opts = [[wert, text]], vals = [werte]
  function pkCheckGroup(opts, vals, onChange) {
    const g = document.createElement('div'); g.className = 'vaf-pk-cbg';
    let cur = [...vals];
    for (const [v, n] of opts) g.appendChild(pkCheck(n, cur.includes(v), (on) => { cur = on ? [...cur, v] : cur.filter((x) => x !== v); onChange && onChange([...cur]); }));
    return g;
  }

  // =====================================================================================
  // Listen-Seiten markieren (Besucher, Likes, Sticker, Posteingang, Suche, Gruppen-Mitglieder)
  // und – wenn der Schalter „Opa-Schutz“ und die Automatik an sind – Treffer auf die Warteliste setzen.
  // =====================================================================================
  const PAGE_SOURCES = [
    { re: /^\/connection\/visitors/, src: 'Besucher', auto: 'besucher' },
    { re: /^\/connection\/image\/rating/, src: 'Likes', auto: 'interaktionen' },
    { re: /^\/connection\/gift\/received/, src: 'Sticker', auto: 'interaktionen' },
    { re: /^\/inbox/, src: 'Nachrichten', auto: 'interaktionen' },
    { re: /^\/search\/member/, src: 'Suche', auto: 'suche' },
    { re: /^\/groups\//, src: 'Gruppen', auto: null },
    { re: /(^|\/)events\/[^/]+\/[^/]+\/\d+/, src: 'Events', auto: null },
  ];
  const pageSource = () => PAGE_SOURCES.find((p) => p.re.test(location.pathname)) || null;
  const autoDone = new Set();

  // Karten mit Profil-Link einsammeln
  function cardsOn(root = document) {
    const out = new Map();
    for (const a of root.querySelectorAll('a[href^="/p/"]')) {
      if (a.closest('header, .vaf-ov, #vaf-fick-sec, [data-vaf-skip]')) continue;
      const card = a.closest('.ant-list-item, [data-item-id], .ant-card, [data-index]');
      if (!card || out.has(card)) continue;
      const nick = (a.getAttribute('title') || a.textContent || '').trim() || slugOf(a.getAttribute('href'));
      const descEl = [...card.querySelectorAll('span, div')].find((e) => e.children.length === 0 && /\d+\s*Jahre/.test(e.textContent || ''));
      const desc = descEl ? descEl.textContent : '';
      const img = card.querySelector('img');
      const src = img ? img.getAttribute('src') : '';
      out.set(card, { card, nick, uid: card.getAttribute('data-item-id') || uidFromAvatar(src), ages: agesFromText(desc), g: genderFromText(desc), host: descEl ? descEl.parentElement : card });
    }
    // Posteingang: Einträge ohne Profil-Link
    for (const it of root.querySelectorAll('[data-item-id]')) {
      if (out.has(it) || it.closest('.vaf-ov')) continue;
      const nameEl = it.querySelector('span[title]');
      if (!nameEl) continue;
      out.set(it, { card: it, nick: nameEl.getAttribute('title'), uid: it.getAttribute('data-item-id'), ages: [], g: [], host: nameEl.closest('div') || it, inbox: true });
    }
    return [...out.values()];
  }

  let markBusy = false, markAgain = false;
  async function markPage() {
    if (markBusy) { markAgain = true; return; }
    markBusy = true;
    try {
      const ps = pageSource();
      if (!ps) return;
      const s = S();
      const auto = isOn() && ps.auto && s.auto[ps.auto];
      for (const x of cardsOn(document)) {
        if (DELETED_NICK.test(x.nick)) { await showDeleted(x); continue; }
        let m = x.uid ? await Members.get(x.uid) : await Members.byNick(x.nick);
        if (m && !x.uid) x.uid = m.uid;
        if (!x.ages.length && m) { x.ages = m.ages || []; x.g = m.g || []; }
        if (m && (!x.g || !x.g.length)) x.g = m.g || [];
        if (x.uid && x.ages.length && !x.inbox && (!m || !m.ageAt || m.ageAt !== isoDay(new Date()))) m = await seen(x, ps.src);
        const info = markInfo(x, ps.src, m);
        putMark(x.inbox ? x.card : x.host, info);
        if (auto && info && info.c.ignore && !(m && m.blk && !m.unblk) && !autoDone.has(x.nick)) {
          autoDone.add(x.nick);
          await Queue.add(x, ps.src);
        }
      }
    } catch (e) { warn('Markieren', e); }
    finally { markBusy = false; if (markAgain) { markAgain = false; setTimeout(markPage, 300); } }
  }

  // ---------- Gelöschte Konten im Posteingang ----------
  async function showDeleted(x) {
    if (!x.uid) return;
    const m = await Members.get(x.uid);
    if (!m || !m.nick || DELETED_NICK.test(m.nick)) return;
    if (!m.del) await Members.update(x.uid, (y) => { y.del = now(); });
    const nameEl = x.card.querySelector('span[title]');
    if (nameEl && !nameEl.dataset.vafDel) {
      nameEl.dataset.vafDel = '1';
      nameEl.style.display = 'none';
      const s = document.createElement('span');
      s.className = (nameEl.className || '') + ' vaf-strike';
      s.textContent = m.nick;
      s.title = `Gelöschter Popster – früher: ${m.nick}`;
      nameEl.after(s);
    }
    const img = x.card.querySelector('img');
    if (img && !img.dataset.vafDel) {
      const data = await Images.get(x.uid);
      if (data) { img.dataset.vafDel = '1'; img.src = data; }
    }
    x.card.addEventListener('click', () => { try { sessionStorage.setItem('vaf_inbox_uid', x.uid); } catch {} }, { once: true });
  }
  // Kopf des geöffneten Chats mit einem gelöschten Konto
  async function fixDeletedChatHeader() {
    const a = document.querySelector('a[href="/p/gel%C3%B6schter-popster"], a[href="/p/gelöschter-popster"]');
    if (!a || a.dataset.vafDel) return;
    let uid = '';
    try { uid = sessionStorage.getItem('vaf_inbox_uid') || ''; } catch {}
    if (!uid) {
      const dels = cardsOn(document).filter((c) => DELETED_NICK.test(c.nick));
      if (dels.length === 1) uid = dels[0].uid;
    }
    const m = uid ? await Members.get(uid) : null;
    if (!m || !m.nick || DELETED_NICK.test(m.nick)) return;
    a.dataset.vafDel = '1';
    a.textContent = m.nick;
    a.title = `Gelöschter Popster – früher: ${m.nick}. Klick öffnet das Profil-Archiv.`;
    a.href = '/setting/profile#archiv=' + encodeURIComponent(uid);
    a.target = '_blank';
    a.style.textDecorationLine = 'line-through';
    a.addEventListener('click', (e) => { e.stopPropagation(); }, true);
  }

  // ---------- Benachrichtigungen & Likes-/Kommentar-Popups einfärben ----------
  // Übersetzter Profiltyp + Alter (+ Entfernung, falls bekannt) farbig neben jeden Actor-Nick.
  const GENDER_TXT = { 'Mann': 'm', 'Frau': 'w', 'Paar': 'p', 'Trans': 'ts', 'Transsexuell': 'ts', 'Nicht-binär': 'tv' };
  function notifTag(nick, m, a) {
    const s = S();
    let gk = null, ages = [];
    if (m && (m.ages || []).length) { ages = m.ages; gk = classify({ ...m, nick }, 'Benachrichtigungen', s).gk; }
    // Zeilen-Container hochklettern, bis die poppen-Meta (Alter/Entfernung) im Text steht
    let row = a;
    for (let k = 0; k < 6 && row.parentElement; k++) { row = row.parentElement; if (/\d+\s*Jahre|·\s*[\d.,]+\s*km/.test(row.textContent || '')) break; }
    const rtxt = row ? (row.textContent || '') : '';
    let dist = ''; const dm = rtxt.match(/·\s*([\d.,]+)\s*km/); if (dm) dist = ` · ${dm[1]} km`;
    if (!gk || !ages.length) {                       // Fallback: poppens eigene Meta-Zeile parsen
      const pm = rtxt.match(/(Mann|Frau|Paar|Trans|Transsexuell|Nicht[- ]binär)\s*·\s*(\d+)\s*Jahre/);
      if (pm) { gk = GENDER_TXT[pm[1].replace('Nicht binär', 'Nicht-binär')] || null; ages = [Number(pm[2])]; }
    }
    if (!gk || !ages.length) return null;
    const labels = labelsOf(gk, s);
    const typ = ages.map((aa, i) => { const lim = limitsOf(gk, 'interaktionen', ages.length > 1 ? i : -1, s); return labels[aa <= openTop(lim[0]) ? 0 : aa <= openTop(lim[1]) ? 2 : 4]; });
    const label = uniq(typ).join(' & ');
    const maxA = Math.max(...ages); const lim = limitsOf(gk, 'interaktionen', -1, s);
    const stage = maxA <= openTop(lim[0]) ? 1 : maxA <= openTop(lim[1]) ? 2 : 3;
    const color = COLORS[stage];
    // Zeigt poppen schon Alter/Entfernung (Listenseite), fehlt nur der übersetzte Typ → nur den anzeigen.
    // Bei Kommentaren fehlt alles → Typ + Alter (Entfernung ist dort nicht bekannt).
    const poppenMeta = /\d+\s*Jahre/.test(rtxt);
    const text = poppenMeta ? label : `${label} ${ages.join('/')}`;
    return { text, color, dark: color === COLORS[2] };
  }
  function notifScopes() {
    if (/^\/notifications/.test(location.pathname)) return [document.body];
    return [...document.querySelectorAll('.ant-modal-content, .ant-drawer-content, .ant-popover-inner')].filter((x) => x.offsetParent !== null);
  }
  async function decorateNotifications() {
    const scopes = notifScopes();
    if (!scopes.length) return;
    const meL = norm((Me.get() || {}).nick || '');
    for (const root of scopes) {
      for (const a of root.querySelectorAll('a.ant-typography-link[href^="/p/"]')) {
        if (a.dataset.vafNotif) continue;
        if (a.closest('.vaf-ov, #vaf-fick-sec, .vaf-gr-editor, [data-vaf-skip]')) continue;   // eigene UI nicht dekorieren
        // sauberer Nick: Titel bevorzugt, sonst Text ohne angehängte Meta (Geschlecht · NN Jahre …)
        let nick = (a.getAttribute('title') || '').trim();
        if (!nick) nick = (a.textContent || '').trim().replace(/\s*(Mann|Frau|Paar|Trans|Transsexuell|Nicht[- ]binär)\s*·.*$/, '').trim();
        if (!nick) continue;
        a.dataset.vafNotif = '1';
        if (norm(nick) === meL) continue;
        try {
          const m = await Members.byNick(nick);
          const tag = notifTag(nick, m, a);
          if (!tag) continue;
          const span = document.createElement('span');
          span.className = 'vaf-mark vaf-notif-mark';
          span.textContent = tag.text;
          span.style.cssText = `background:${tag.color};color:${tag.dark ? '#111' : '#fff'};margin-left:6px;vertical-align:middle`;
          a.after(span);
        } catch {}
      }
    }
  }

  function initListPages() {
    let t = null;
    const run = () => { clearTimeout(t); t = setTimeout(() => { markPage(); decorateNotifications(); if (location.pathname.startsWith('/inbox')) fixDeletedChatHeader(); }, 250); };
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    Bus.on('settings', run);
    run();
  }

  // =====================================================================================
  // Sichtbarkeit (wio/state)
  // =====================================================================================
  const Vis = {
    userChanged: 0,
    async state() {
      try { const d = await apiGet('wio/state'); const v = d && (d.value || d.state || d); if (v === 'visible' || v === 'invisible') return v; } catch {}
      const sw = [...document.querySelectorAll('button[role=switch]')].find((b) => /unsichtbar/i.test((b.closest('li,div') || {}).textContent || ''));
      if (sw) return sw.getAttribute('aria-checked') === 'true' ? 'invisible' : 'visible';
      return G.get('vis_state', null);
    },
    async set(v) { await apiPost('wio/state', { value: v }); G.set('vis_state', v); },
    // Vor einer Funktion mit Profilaufruf: warnen und ggf. unsichtbar schalten
    // Ergebnis: null = abgebrochen, { restore: bool }
    async guard(what) {
      const st = await this.state();
      if (st === 'invisible') return { restore: false };
      const v = await ask('Sichtbarkeit', `<p>${esc(what)} ruft ein Profil auf. Dein Besuch erscheint dann beim Mitglied in der Besucherliste.</p>` +
        (st ? '' : '<p style="color:#a6a6a6">Ob du gerade sichtbar bist, ließ sich nicht feststellen.</p>'), [
        { label: 'Unsichtbar schalten und fortfahren', value: 'inv', primary: true, focus: true },
        { label: 'Sichtbar fortfahren', value: 'vis' },
        { label: 'Abbrechen', value: null, cancel: true },
      ]);
      if (!v) return null;
      if (v === 'vis') return { restore: false };
      await this.set('invisible');
      const t0 = now();
      this.userChanged = 0;
      const tt = toast('Unsichtbar geschaltet – warte 15 Sekunden …', 0);
      while (now() - t0 < 15000) { tt.innerHTML = `Unsichtbar geschaltet – noch <b>${Math.ceil((15000 - (now() - t0)) / 1000)}</b> s …`; await sleep(500); }
      tt.remove();
      return { restore: true, at: now() };
    },
    async restore(tok) {
      if (!tok || !tok.restore) return;
      if (this.userChanged > (tok.at || 0)) return;     // selbst umgeschaltet → nichts zurückstellen
      try { await this.set('visible'); } catch {}
    },
  };
  // Automatische Profilabfragen (z. B. Gruppenregeln) nur unsichtbar: vorher still unsichtbar schalten,
  // 90 s nach der letzten Abfrage wieder sichtbar – außer der Nutzer hat inzwischen selbst umgeschaltet.
  const VisAuto = (() => {
    let active = 0, switchedAt = 0, timer = null, prep = null;
    async function enter() {
      active++; clearTimeout(timer);
      if (switchedAt) return;
      if (!prep) prep = (async () => {
        const st = await Vis.state();
        if (st === 'invisible') return;
        await Vis.set('invisible'); switchedAt = now();
        try { toast('Für Profilabfragen unsichtbar geschaltet – kurz warten …', 5000); } catch {}
        await sleep(15000);
      })().finally(() => { prep = null; });
      await prep;
    }
    function leave() {
      active = Math.max(0, active - 1);
      if (active || !switchedAt) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (active || !switchedAt) return;
        const at = switchedAt; switchedAt = 0;
        if (Vis.userChanged > at) return;
        try { await Vis.set('visible'); } catch {}
      }, 90000);
    }
    return { async use(fn) { await enter(); try { return await fn(); } finally { leave(); } } };
  })();
  onApi(/^wio\/state$/, (d, info) => { if (info.method === 'POST' && info.body && info.body.value) { G.set('vis_state', info.body.value); Vis.userChanged = now(); } });

  // =====================================================================================
  // Blockierliste (/setting/privacy/ignore-list): Reparieren, Synchronisieren, Mülleimer
  // =====================================================================================
  const IGNORE_LIST_PATH = '/setting/privacy/ignore-list';

  function ignoreListUi() {
    if (!location.pathname.startsWith(IGNORE_LIST_PATH)) return;
    const inp = document.querySelector('main input#nickname');
    const form = inp && inp.closest('form');
    if (!form || document.getElementById('vaf-il-box')) return;
    const box = document.createElement('div');
    box.id = 'vaf-il-box';
    box.style.cssText = 'margin:12px 0 16px';
    box.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="ant-btn ant-theme ant-btn-default ant-btn-color-default ant-btn-variant-outlined" data-a="repair"><span>Reparieren</span></button>
        <button type="button" class="ant-btn ant-theme ant-btn-default ant-btn-color-default ant-btn-variant-outlined" data-a="sync"><span>Synchronisieren</span></button>
        <button type="button" class="ant-btn ant-theme ant-btn-text" data-a="stop" style="display:none"><span>Abbrechen</span></button>
      </div>
      <div id="vaf-il-status" class="ant-typography ant-typography-secondary" style="margin-top:8px;font-size:13px"></div>`;
    form.after(box);
    box.querySelector('[data-a=repair]').addEventListener('click', () => runIgnoreJob('repair'));
    box.querySelector('[data-a=sync]').addEventListener('click', () => syncDialog());
    box.querySelector('[data-a=stop]').addEventListener('click', () => { ilJob.stop = true; });
    const last = G.get('il_last', null);
    if (last) ilStatus(`Zuletzt: ${last.text} (${deDateTime(last.at)})`);
  }
  const ilStatus = (t) => { const s = document.getElementById('vaf-il-status'); if (s) s.textContent = t; };
  const ilJob = { running: false, stop: false };

  // Liest die komplette Blockierliste über die Schnittstelle
  async function readWholeBlocklist() {
    let n = 0;
    const list = await BL.all((count, page) => { n = count; ilStatus(`Lese Blockierliste … ${fmtN(count)} Einträge (Seite ${page})`); return !ilJob.stop; });
    if (ilJob.stop) throw new Error('abgebrochen');
    G.set('blocked_count', list.length);
    return list;
  }
  // Script-Gedächtnis: alle vom Opa-Schutz Geblockten
  async function memoryBlocked() {
    const out = [];
    await Members.each((m) => { if (m.blk && m.blk.opa && !m.unblk) out.push(m); });
    return out;
  }

  // Blockierliste still ins Gedächtnis einlesen (ändert nichts auf poppen.de).
  //  - Vollständig: beim ersten Mal, nach einer Formatänderung (INGEST_FMT) und monatlich.
  //  - Sonst schrittweise (täglich bzw. nach einem Update): neueste Einträge lesen, bis nur noch Bekannte kommen;
  //    Entfernte über die Nummernliste (ignore/uid/list) erkennen. Von Hand geänderte Notizen gleicht „Reparieren“ ab.
  //  Fortschritt in G „ingest_prog“ (für die Einstellungen, auch aus anderen Tabs sichtbar).
  const INGEST_KEY = 'bl_ingest', INGEST_FMT = 2;
  const ingestDue = () => { const g = G.get(INGEST_KEY, null); return !g || g.v !== VERSION || now() - g.at > DAY; };
  const ingestFullDue = () => { const g = G.get(INGEST_KEY, null); return !g || g.fmt !== INGEST_FMT || !g.full || now() - g.full > 30 * DAY; };
  const ingestProg = (phase, n, total) => G.set('ingest_prog', { phase, n, total, at: now() });
  async function ingestEntry(e) {
    const uid = String(e.user.uid);
    await seen(e.user, 'Blockierliste', { images: false });
    const pn = parseNote(e.note);
    if (pn) {
      await Members.update(uid, (x) => { if (!x.blk || !x.blk.opa || x.unblk) x.blk = { at: pn.at, src: pn.src || 'Sync', note: e.note, opa: true }; else if (!x.blk.note) x.blk.note = e.note; delete x.unblk; });
      return 'opa';
    }
    await Members.update(uid, (x) => { if (!x.blk || x.unblk) { x.blk = { at: now(), note: e.note || '', opa: false }; delete x.unblk; } });
    return 'manual';
  }
  async function ingestBlocklist(onStep, { full = false } = {}) {
    full = full || ingestFullDue();
    let uids = null;
    try { uids = await BL.uids(); } catch {}
    const total = uids ? uids.length : G.get('blocked_count', 0) || 0;
    const onList = uids ? new Set(uids) : new Set();
    let opa = 0, manual = 0, read = 0;
    ingestProg('lesen', 0, total);
    let list = [];
    if (full) {
      list = await BL.all((count, page) => { read = count; ingestProg('lesen', count, total); if (onStep) onStep(count, page); return true; });
      if (!uids) for (const e of list) if (e && e.user && e.user.uid) onList.add(String(e.user.uid));
    } else {
      // schrittweise: neueste zuerst, bis eine ganze Seite nur Bekanntes enthält
      let page = 1;
      for (let guard = 0; guard < 100000; guard++) {
        const d = await BL.page(page);
        const l = (d && d.list) || [];
        read += l.length; ingestProg('lesen', read, total);
        let fresh = 0;
        for (const e of l) {
          if (!e || !e.user || !e.user.uid) continue;
          const uid = String(e.user.uid);
          const m = Members.cached().get(uid) || await Members.get(uid).catch(() => null);
          if (!m || !m.blk || m.unblk) { list.push(e); fresh++; }
        }
        if (!fresh || !l.length || !d.next_page || d.next_page === page) break;
        page = d.next_page;
      }
    }
    const tot2 = list.length;
    let k = 0;
    for (const e of list) {
      if (++k % 100 === 0) ingestProg('verarbeiten', k, tot2);
      if (!e || !e.user || !e.user.uid) continue;
      onList.add(String(e.user.uid));
      if ((await ingestEntry(e)) === 'opa') opa++; else manual++;
    }
    // nicht mehr auf der Liste: von Hand Blockierte verlieren den Vermerk (Opa-Sperren bleiben „Reparieren“ überlassen)
    if (uids || full) {
      const stale = [];
      await Members.each((m) => { if (m.blk && !m.blk.opa && !m.unblk && !onList.has(m.uid)) stale.push(m.uid); });
      for (const uid of stale) await Members.update(uid, (x) => { x.blk = null; });
    }
    const n = uids ? uids.length : full ? list.length : total;
    G.set('blocked_count', n); G.set('blocked_count_at', now());
    const prev = G.get(INGEST_KEY, null) || {};
    G.set(INGEST_KEY, { v: VERSION, fmt: INGEST_FMT, at: now(), full: full ? now() : prev.full || 0, n, read, opa, manual });
    G.del('ingest_prog');
    Bus.emit('ingested', { n, opa, manual, full });
    log(`Blockierliste ${full ? 'vollständig' : 'schrittweise'} eingelesen: ${fmtN(read)} Einträge gelesen, ${opa + manual} neu verbucht (${opa} mit ${word()}-Notiz).`);
    return { n, opa, manual, full, read };
  }

  async function runIgnoreJob(kind, opts = {}) {
    if (ilJob.running) return;
    if (!(await Lock.take('blocklist', kind))) { toast('Ein anderer Tab arbeitet gerade an der Blockierliste.'); return; }
    ilJob.running = true; ilJob.stop = false;
    const stopBtn = document.querySelector('#vaf-il-box [data-a=stop]');
    if (stopBtn) stopBtn.style.display = '';
    try {
      const list = await readWholeBlocklist();
      const onList = new Map(list.filter((e) => e.user).map((e) => [String(e.user.uid), e]));
      const mem = await memoryBlocked();
      let text = '';
      if (kind === 'repair') {
        let gone = 0, notes = 0, adopted = 0, synced = 0;
        // 1. nicht mehr blockiert → aus dem Gedächtnis
        for (const m of mem) if (!onList.has(m.uid)) { await Members.update(m.uid, (x) => { x.unblk = now(); x.blk = null; }); gone++; }
        // 2. Einträge mit Opa-Notiz ins Gedächtnis, fehlende Notizen ergänzen
        let i = 0;
        for (const [uid, e] of onList) {
          if (ilJob.stop) break;
          if (++i % 200 === 0) ilStatus(`Prüfe Einträge … ${fmtN(i)} / ${fmtN(onList.size)}`);
          let m = await Members.get(uid);
          const pn = parseNote(e.note);
          if (!pn && !e.note && legacy && legacy.done[norm(e.user.nickname)] && !(m && m.legacyDone)) m = await seen(e.user, 'Blockierliste', { images: false });
          if (pn) {
            if (!m || !m.blk || !m.blk.opa) { await seen(e.user, 'Blockierliste', { images: false }); await Members.update(uid, (x) => { x.blk = { at: pn.at, src: pn.src, note: e.note, opa: true }; delete x.unblk; }); adopted++; }
            else if (m.blk.note !== e.note) { await Members.update(uid, (x) => { x.blk = { ...x.blk, at: pn.at || x.blk.at, src: pn.src || x.blk.src, note: e.note }; }); synced++; }   // Notiz von Hand geändert
            continue;
          }
          if (!m || !m.blk || m.unblk || (!m.blk.opa && (m.blk.note || '') !== (e.note || ''))) {   // von Hand Blockierte samt Notiz
            if (!m || !m.blk || m.unblk || !m.blk.opa) { await seen(e.user, 'Blockierliste', { images: false }); await Members.update(uid, (x) => { if (!x.blk || x.unblk || !x.blk.opa) { x.blk = { at: (x.blk && x.blk.at) || now(), note: e.note || '', opa: false }; delete x.unblk; } }); synced++; continue; }
          }
          if (m && m.blk && m.blk.opa && !e.note && S().expert.writeNote) {
            const t = makeNote(m, m.blk.src, new Date(m.blk.at || now()));
            if (!dry()) { try { await BL.note(uid, t); notes++; } catch {} }
            await Members.update(uid, (x) => { x.blk.note = t; });
          }
        }
        text = `Reparieren: ${fmtN(list.length)} Einträge, ${gone} nicht mehr blockiert, ${adopted} übernommen, ${synced} abgeglichen, ${notes} Notizen ergänzt`;
        // Reparieren ersetzt das vollständige Einlesen
        G.set('blocked_count', list.length); G.set('blocked_count_at', now());
        { const prev = G.get(INGEST_KEY, null) || {}; G.set(INGEST_KEY, { ...prev, v: VERSION, fmt: INGEST_FMT, at: now(), full: now(), n: list.length }); }
      } else if (kind === 'sync-poppen') {
        let adopted = 0, dropped = 0, notes = 0;
        for (const [uid, e] of onList) {
          const pn = parseNote(e.note);
          if (!pn) continue;                                   // von Hand Blockierte: nichts tun
          await seen(e.user, 'Blockierliste', { images: false });
          await Members.update(uid, (x) => { if (!x.blk || !x.blk.opa) adopted++; x.blk = { at: pn.at, src: pn.src || 'Sync', note: e.note, opa: true }; delete x.unblk; });
          if (opts.notes) notes += await alignNote(uid, e, pn);
        }
        for (const m of mem) if (!onList.has(m.uid)) { await Members.update(m.uid, (x) => { x.unblk = now(); x.blk = null; }); await Queue.remove(m.uid); dropped++; }
        text = `Sync (poppen.de hat Vorrang): ${adopted} übernommen, ${dropped} als entsperrt vermerkt${opts.notes ? `, ${notes} Notizen angepasst` : ''}`;
      } else if (kind === 'sync-script') {
        const reblock = mem.filter((m) => !onList.has(m.uid));
        const unblock = [];
        for (const [uid, e] of onList) {
          const pn = parseNote(e.note);
          if (!pn) continue;
          const m = await Members.get(uid);
          const x = m || normUser(e.user);
          const white = whiteReason(m || {}, e.user.nickname);
          if ((m && m.unblk) || white) unblock.push({ uid, nick: e.user.nickname, why: white || 'im Skript entsperrt' });
        }
        const ok = await ask('Synchronisieren – Script hat Vorrang',
          `<div class="vaf-stats"><span>Neu blockieren (im Skript blockiert, auf poppen.de nicht)</span><b>${fmtN(reblock.length)}</b>` +
          `<span>Entsperren (Opa-Notiz, im Skript entsperrt oder auf der Whitelist)</span><b>${fmtN(unblock.length)}</b>` +
          `<span>Von Hand Blockierte (ohne Opa-Notiz)</span><b>bleiben unberührt</b></div>`,
          [{ label: 'Jetzt ausführen', value: true, primary: true }, { label: 'Abbrechen', value: false, focus: true, cancel: true }]);
        if (!ok) { text = 'Synchronisieren abgebrochen'; }
        else {
          let a = 0, b = 0, notes = 0;
          for (const m of reblock) { if (ilJob.stop) break; await Queue.add(m, (m.blk && m.blk.src) || 'Sync'); a++; }
          for (const u of unblock) {
            if (ilJob.stop) break;
            const r = await unblockOne({ uid: u.uid, nick: u.nick });
            if (r === 'ok' || r === 'Test') b++;
            ilStatus(`Entsperre … ${b} / ${unblock.length}`);
            await sleep(rand(S().expert.pauseMin * 1000, S().expert.pauseMax * 1000));
          }
          if (opts.notes) for (const [uid, e] of onList) { const pn = parseNote(e.note); if (pn) notes += await alignNote(uid, e, pn); }
          text = `Sync (Script hat Vorrang): ${a} auf die Warteliste zum Neu-Blockieren, ${b} entsperrt${opts.notes ? `, ${notes} Notizen angepasst` : ''}`;
          if (a) Etappe.run('Synchronisieren', null, { manual: true }).catch(() => {});
        }
      }
      G.set('il_last', { text, at: now() });
      ilStatus(text);
    } catch (e) { ilStatus(e.message === 'abgebrochen' ? 'Abgebrochen.' : 'Fehler: ' + e.message); }
    finally {
      ilJob.running = false;
      Lock.release('blocklist');
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }
  // Notiz an die aktuelle Vorlage angleichen (gleiche Quelle, gleicher Zeitpunkt)
  async function alignNote(uid, e, pn) {
    const m = await Members.get(uid) || normUser(e.user);
    const want = makeNote(m, pn.src, new Date(pn.at));
    if (want === e.note) return 0;
    if (dry()) return 1;
    try { await BL.note(uid, want); await Members.update(uid, (x) => { if (x.blk) x.blk.note = want; }); return 1; } catch { return 0; }
  }
  async function syncDialog() {
    const m = modal({ title: 'Synchronisieren', sub: 'Gleicht die Blockierliste von poppen.de mit dem Gedächtnis des Opa-Schutzes ab. Von Hand Blockierte (ohne Opa-Notiz) bleiben immer unberührt.',
      html: `<label class="vaf-chk"><input type="checkbox" id="vaf-sync-notes"> Notizen abgleichen (an die aktuelle Vorlage anpassen)</label>` });
    const notes = () => m.md.querySelector('#vaf-sync-notes').checked;
    m.buttons([
      { label: 'poppen.de hat Vorrang', primary: true, fn: () => { const n = notes(); m.close(); runIgnoreJob('sync-poppen', { notes: n }); } },
      { label: 'Script hat Vorrang', fn: () => { const n = notes(); m.close(); runIgnoreJob('sync-script', { notes: n }); } },
      { label: 'Abbrechen', focus: true, fn: () => m.close() },
    ]);
  }

  // ---------- Mülleimer: Rückfrage bei vom Opa-Schutz Blockierten ----------
  let trashBypass = false;
  function hookTrash() {
    document.addEventListener('click', async (e) => {
      if (trashBypass || !location.pathname.startsWith(IGNORE_LIST_PATH)) return;
      const btn = e.target.closest && e.target.closest('main .ant-list-item button');
      if (!btn || btn.closest('#vaf-il-box')) return;
      const item = btn.closest('.ant-list-item');
      const isTrash = btn.querySelector('svg') && !norm(btn.textContent) && !btn.closest('form');
      if (!isTrash) return;
      const nameEl = item.querySelector('span.df-text-weight-semi-bold') || item.querySelector('a[href^="/p/"]');
      const nick = nameEl ? nameEl.textContent.trim() : '';
      const note = (item.querySelector('input') || {}).value || '';
      const m = nick ? await Members.byNick(nick) : null;
      const byOpa = isOpaNote(note) || (m && m.blk && m.blk.opa && !m.unblk);
      if (!byOpa) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const v = await confirmUnblock(nick);
      if (!v) return;
      if (v === 'white') addToWhitelist(nick);
      if (m) await Members.update(m.uid, (x) => { x.unblk = now(); x.blk = null; });
      trashBypass = true;
      try { btn.click(); } finally { setTimeout(() => { trashBypass = false; }, 500); }
    }, true);
  }
  function confirmUnblock(nick) {
    return ask(`${nick} entsperren`, `<p>${esc(nick)} wurde durch den ${esc(word())}-Schutz ignoriert.</p>`, [
      { label: 'Trotzdem entsperren', value: 'yes' },
      { label: 'Trotzdem entsperren & Whitelist', value: 'white' },
      { label: 'Abbrechen', value: null, focus: true, primary: true, cancel: true },
    ]);
  }
  function addToWhitelist(nick, group = '') {
    const s = clone(S());
    if (!s.whitelist.names.some((x) => norm(x.n) === norm(nick))) s.whitelist.names.push({ n: nick, g: group });
    saveSettings(s);
  }

  // =====================================================================================
  // Profil eines Geblockten: „Du hast diesen Popster blockiert“
  // =====================================================================================
  const isBlockedProfilePage = () => /^\/p\/[^/]+\/?$/.test(location.pathname) && /Du hast diesen Popster blockiert/.test((document.querySelector('main') || {}).textContent || '');
  async function blockedProfileUi() {
    if (!isBlockedProfilePage() || document.getElementById('vaf-bp')) return;
    const unb = [...document.querySelectorAll('main button')].find((b) => norm(b.textContent) === 'diesen benutzer entblockieren');
    if (!unb) return;
    const nick = slugOf(location.pathname);
    let m = await Members.byNick(nick);
    if (!m) { const e = await BL.find(nick).catch(() => null); if (e && e.user) m = await seen(e.user, 'Blockierliste', { images: false }); }
    const realNick = (m && m.nick) || nick;
    const bar = unb.parentElement;
    const wrap = document.createElement('div');
    wrap.id = 'vaf-bp';
    wrap.style.cssText = 'display:contents';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = unb.className; b.innerHTML = `<span>${esc(label)}</span>`; b.addEventListener('click', fn); return b; };
    wrap.append(mk('Trotzdem öffnen', () => openBlockedOnce(m, realNick)), mk('Nicht mehr ignorieren', () => unblockForGood(m, realNick)));
    bar.appendChild(wrap);
    const note = m && m.blk && m.blk.note;
    if (note) { const p = document.createElement('div'); p.className = 'ant-typography ant-typography-secondary'; p.style.marginTop = '10px'; p.textContent = 'Grund: ' + note; bar.after(p); }
    // poppen-Knopf „Diesen Benutzer entblockieren“: gleiche Rückfrage wie der Mülleimer
    unb.addEventListener('click', async (e) => {
      if (trashBypass) return;
      if (!(m && m.blk && m.blk.opa)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const v = await confirmUnblock(realNick);
      if (!v) return;
      if (v === 'white') addToWhitelist(realNick);
      await Members.update(m.uid, (x) => { x.unblk = now(); x.blk = null; });
      trashBypass = true; unb.click(); setTimeout(() => { trashBypass = false; }, 500);
    }, true);
  }
  async function openBlockedOnce(...a) { return Prio.run('Trotzdem öffnen', () => openBlockedOnce_(...a)); }
  async function openBlockedOnce_(m, nick) {
    if (!m || !m.uid) { toast('Benutzer-ID unbekannt – „Trotzdem öffnen“ geht hier nicht.'); return; }
    const vis = await Vis.guard('„Trotzdem öffnen“');
    if (!vis) return;
    const note = (m.blk && m.blk.note) || '';
    const r = await unblockOne(m, { keepMemory: true });
    if (r !== 'ok' && r !== 'Test') { toast('Entsperren fehlgeschlagen: ' + esc(r)); return; }
    G.set('reblock', { uid: m.uid, nick, note, path: location.pathname, tab: TAB_ID, at: now(), vis });
    location.reload();
  }
  async function unblockForGood(m, nick) {
    const v = await ask(`${nick} nicht mehr ignorieren`, `<p>${esc(nick)} wird dauerhaft entsperrt.</p>`, [
      { label: 'Entsperren', value: 'yes' }, { label: 'Entsperren & Whitelist', value: 'white' }, { label: 'Abbrechen', value: null, focus: true, primary: true, cancel: true }]);
    if (!v) return;
    if (v === 'white') addToWhitelist(nick);
    if (m && m.uid) { const r = await unblockOne(m); if (r !== 'ok' && r !== 'Test') { toast('Fehler: ' + esc(r)); return; } }
    location.reload();
  }
  // Nach „Trotzdem öffnen“: beim Verlassen des Profils wieder sperren (spätestens beim nächsten Seitenaufruf)
  async function checkReblock() {
    const rb = G.get('reblock', null);
    if (!rb) return;
    const here = location.pathname.replace(/\/+$/, '');
    const stillThere = rb.tab === TAB_ID && here === rb.path.replace(/\/+$/, '');
    if (stillThere && now() - rb.at < 6 * 3600000) {
      if (!rb.armed) G.set('reblock', { ...rb, armed: true });
      if (!document.getElementById('vaf-rb')) toast(`<b>${esc(rb.nick)}</b> ist vorübergehend entsperrt und wird beim Verlassen des Profils wieder gesperrt.`, 8000);
      return;
    }
    if (rb.tab !== TAB_ID && now() - rb.at < 10 * 60000) return;   // anderer Tab schaut noch
    G.del('reblock');
    if (!dry()) {
      try { await BL.add(rb.uid, rb.nick); if (rb.note) await BL.note(rb.uid, rb.note); }
      catch (e) {
        const there = await BL.find(rb.nick).catch(() => null);      // durch keepalive schon gesperrt?
        if (there) { if (rb.note && !there.note) { try { await BL.note(rb.uid, rb.note); } catch {} } }
        else { warn('Wiedersperren fehlgeschlagen', e); G.set('reblock', rb); return; }
      }
    }
    await Members.update(rb.uid, (x) => { if (!x.blk) x.blk = { at: now(), src: 'Profil', note: rb.note, opa: !!rb.note }; delete x.unblk; });
    if (rb.vis) await Vis.restore(rb.vis);
  }
  W.addEventListener('pagehide', () => {
    let rb = null;
    try { rb = G.get('reblock', null); } catch { return; }
    if (!rb || rb.tab !== TAB_ID || !rb.armed || dry()) return;
    // Seite wird verlassen: sofort wieder sperren (keepalive, damit die Abfrage den Seitenwechsel überlebt)
    try {
      const h = { 'Content-Type': 'application/json', ...(mirror || {}) };
      origFetch(location.origin + '/v2-api/ignore/add', { method: 'POST', credentials: 'include', keepalive: true, headers: h, body: JSON.stringify({ uid: String(rb.uid), nickname: rb.nick }) });
    } catch {}
  });

  // =====================================================================================
  // Opa-/Oma-Scan: Auswahl-Popup, Hintergrundlauf und Fortschrittsanzeige
  // =====================================================================================
  const SCANS = [
    { k: 'interaktionen', title: 'Interaktionen', sub: 'Likes, Sticker, Nachrichten und Benachrichtigungen', fn: scanInteractions },
    { k: 'besucher', title: 'Profilbesucher', sub: 'Wer dein Profil besucht hat', fn: scanVisitors },
    { k: 'party', title: 'Partygäste (Events)', sub: '„Gehe“ und „Vielleicht“ aller Events einlesen und einfärben, AWO-Faktor berechnen (keine Warteliste)', fn: scanEvents },
    { k: 'gruppen_wl', src: 'gruppen', title: 'Gruppen (Whitelist)', sub: 'Leitung aller Gruppen; Mitglieder verwalteter Gruppen, wenn du sie allein leitest', fn: scanGroupsWhite, def: true },
    { k: 'gruppen_bl', src: 'gruppen', title: 'Gruppen (Blacklist)', sub: 'Mitglieder deiner Gruppen nach den Regeln prüfen', fn: scanGroupsBlack, def: false },
    { k: 'suche', title: 'Mitgliedersuche', sub: 'Ganz Deutschland, Alter für Alter', fn: scanSearch },
    { k: 'xxl', title: 'XXL-Suche', sub: 'Figur ab „Plus-Size“ im eingestellten Radius, über die Suchfilter vermessen (ohne Profilbesuch)', fn: scanXxl, def: () => mopOn(), avail: () => mopOn() },   // nur für Moppel-Liebhaber; Auswahl bleibt gespeichert
  ];
  const scanSel = () => { const st = G.get('scan_sel', {}); const o = {}; for (const sc of SCANS) if (sc.fn) o[sc.k] = sc.k in st ? !!st[sc.k] : typeof sc.def === 'function' ? !!sc.def() : sc.def !== false; return o; };
  const scanAvail = (sc) => !!sc && !!sc.fn && (!sc.avail || sc.avail());
  // Zwischenstand der gerade laufenden Quelle (judge und XXL zählen hier mit; am Ende der Quelle zählt deren Ergebnis)
  var scanLive = null;   // var: judge kann theoretisch vor dieser Zeile laufen
  function scanLiveAdd(r) { if (scanLive && r) addRes(scanLive, r); }
  const scanActive = () => { const s = G.get('scan_state', null); return !!(s && s.running); };

  function statsHtml(total) {
    return `<span>Mitglieder gelesen</span><b>${fmtN(total.total)}</b><span>Über der Grenze</span><b>${fmtN(total.hits)}</b>` +
      `<span>Neu auf der Warteliste</span><b>${fmtN(total.queued)}</b><span>Schon auf der Warteliste</span><b>${fmtN(total.inQueue || 0)}</b><span>Schon blockiert</span><b>${fmtN(total.known)}</b>` +
      (total.notQueued ? `<span>Nicht eingereiht (nur einfärben)</span><b>${fmtN(total.notQueued)}</b>` : '') +
      (total.unclear ? `<span>Unklar (Alter unbekannt)</span><b>${fmtN(total.unclear)}</b>` : '') +
      `<span>Whitelist</span><b>${fmtN(total.white)}</b><span>Vorgemerkt (knapp unter der Grenze)</span><b>${fmtN(total.near)}</b>` +
      (total.whitelisted || total.unblocked ? `<span>Gruppen-Whitelist neu / entsperrt</span><b>${fmtN(total.whitelisted)} / ${fmtN(total.unblocked)}</b>` : '') +
      (total.kicked ? `<span>Besonders böse entfernt</span><b>${fmtN(total.kicked)}</b>` : '') +
      // XXL-Zeilen nur bei „Benutzer ist Moppel-Liebhaber“ (beim Anzeigen geprüft)
      (mopOn() && (total.xxlFound || total.xxlKnown || total.xxlNew) ?
        `<span>Plus-Size gefunden</span><b>${fmtN(total.xxlFound || 0)}</b>` +
        `<span>Bereits vermessen</span><b>${fmtN(total.xxlKnown || 0)}</b>` +
        `<span>Neu vermessen</span><b>${fmtN(total.xxlNew || 0)}</b>` +
        [1, 2, 3].map((k) => `<span>Neue ${esc(mopLabel(k, true))}</span><b>${fmtN(total['xxlNew' + k] || 0)}</b>`).join('') +
        (total.xxlQueries ? `<span>${esc(xxlName())}-Suche: Suchabfragen</span><b>${fmtN(total.xxlQueries)}</b>` : '') : '');
  }

  async function statusLine() {
    const q = await Queue.count().catch(() => 0);
    const w = Object.keys(await KV.get('watch', {})).length;
    const b = G.get('blocked_count', null);
    return `Blockiert: <b style="color:#fff">${b == null ? '?' : fmtN(b)}</b> · Warteliste: <b style="color:#fff">${fmtN(q)}</b> · Vorgemerkt: <b style="color:#fff">${fmtN(w)}</b>` +
      (dry() ? ' · <span style="color:#ffb300">Testlauf</span>' : '') + (isOn() ? '' : ' · <span style="color:#ff8a80">Automatik aus</span>');
  }

  // ---------- Hintergrund-Scan (ein Tab führt, andere zeigen nur an; Übernahme bei Tab-Schließung) ----------
  const Scan = {
    running: false, stopFlag: false,
    live() { return G.get('scan_state', null); },
    patch(p) { const s = { ...(this.live() || {}), ...p, ts: now(), tab: TAB_ID }; G.set('scan_state', s); Bus.emit('scan', s); return s; },
    async start(keys) {
      if (this.running || scanActive()) { toast('Es läuft bereits ein Scan.'); return; }
      G.set('scan_state', { running: true, tab: TAB_ID, at: now(), ts: now(), keys, si: 0, phase: '', b1: 0, b2: 0, cur: '', stats: newRes(), notes: [], errors: [], stopped: false, done: false });
      Bus.emit('scan', this.live());
      this.run().catch((e) => warn('Scan', e));
    },
    stop() { this.stopFlag = true; const s = this.live(); if (s) { s.stopped = true; G.set('scan_state', s); Bus.emit('scan', s); } },
    async run() {
      if (this.running) return;
      if (!(await Lock.take('scan', 'bg'))) return;
      this.running = true; this.stopFlag = false;
      let s = this.live();
      if (!s || !s.running) { Lock.release('scan'); this.running = false; return; }
      const total = { ...newRes(), ...(s.stats || {}) };
      const keys = s.keys || [];
      const notes = s.notes || [], errors = s.errors || [];
      const beat = setInterval(() => { const x = this.live(); if (x && x.running) { x.ts = now(); x.tab = TAB_ID; G.set('scan_state', x); } }, 5000);
      let liveSig = '';
      const liveBeat = setInterval(() => {               // Zahlen laufen mit (etwa jede Sekunde)
        if (!scanLive) return;
        const st = addRes({ ...total }, scanLive), sig = JSON.stringify(st);
        if (sig !== liveSig) { liveSig = sig; this.patch({ stats: st }); }
      }, 1000);
      const handingOver = () => { const ho = G.get('scan_handover', null); return ho && ho.tab !== TAB_ID && now() - ho.at < 60000; };
      try {
        for (let si = s.si || 0; si < keys.length; si++) {
          if (this.stopFlag || (this.live() || {}).stopped || handingOver()) break;
          const sc = SCANS.find((x) => x.k === keys[si]); if (!scanAvail(sc)) continue;
          this.patch({ si, title: sc.title, phase: sc.title, b2: 0, cur: '', b1: Math.round(si / keys.length * 100) });
          const ctx = {
            stop: () => this.stopFlag || !!(this.live() || {}).stopped || handingOver(),
            phase: (t) => this.patch({ phase: `${sc.title} – ${t}` }),
            step: (i, n, t) => this.patch({ cur: t || '', b2: n ? Math.min(100, Math.round(i / n * 100)) : (i % 50) * 2 }),
            outer: (i, n) => this.patch({ b1: Math.round(((si + (n ? i / n : 0)) / keys.length) * 100) }),
            error: (what, e) => { errors.push(`${what}: ${e.message}`); this.patch({ errors }); },
            notes,
          };
          scanLive = newRes();
          try { const r = await sc.fn(ctx); addRes(total, r); } catch (e) { addRes(total, scanLive); errors.push(`${sc.title}: ${e.message}`); warn(sc.title, e); }
          scanLive = null;
          this.patch({ stats: total, notes, errors });
          G.set('scan_last_' + keys[si], now());
        }
      } finally {
        clearInterval(beat); clearInterval(liveBeat); scanLive = null;
        this.running = false;
        if (handingOver()) { Lock.release('scan'); return; }   // anderer Tab übernimmt → Zustand bleibt „running“
        const stopped = this.stopFlag || !!(this.live() || {}).stopped;
        this.patch({ running: false, done: true, stopped, b1: stopped ? (this.live() || {}).b1 : 100 });
        Lock.release('scan');
        Queue.changed();
      }
    },
    // Zeitgeber: einen vom geschlossenen Tab hinterlassenen Scan übernehmen
    startTimer() {
      setInterval(() => {
        if (this.running) return;
        const s = this.live();
        if (!s || !s.running || s.done) return;
        if (now() - TAB_SINCE < 60000) return;      // frischer Tab wartet eine Minute
        if (Lock.other('scan')) return;             // ein Tab arbeitet noch
        if (now() - (s.ts || 0) < 90000) return;    // Heartbeat noch frisch
        this.run().catch((e) => warn('Scan-Übernahme', e));
      }, 15000);
    },
  };

  // ---------- Auswahl-Popup ----------
  async function openScanPopup() {
    if (scanActive()) { openScanProgress(); return; }
    const W1 = word();
    const m = modal({ title: `${W1}-Scan`, sub: '' });
    const groups = G.get('groups', null);
    const sel = scanSel();
    const rows = SCANS.filter((sc) => !sc.avail || sc.avail()).map((sc) => {
      let sub = sc.sub;
      if (sc.k === 'gruppen_wl' && groups) sub = `${groups.attended.length + groups.managed.length} Gruppen, ${groups.managed.length} verwaltet`;
      if (sc.k === 'gruppen_bl' && groups) sub = groups.attended.length === 1 ? '1 Gruppe, in der du Mitglied bist' : `${groups.attended.length} Gruppen, in denen du Mitglied bist`;
      const on = sc.fn && sel[sc.k];
      return `<label class="vaf-scanrow${sc.fn ? '' : ' vaf-scanrow-off'}">
        <input type="checkbox" data-sel="${sc.k}" ${on ? 'checked' : ''} ${sc.fn ? '' : 'disabled'}>
        <span class="vaf-scanrow-tx"><b>${esc(sc.k === 'xxl' ? xxlName() + '-Suche' : sc.title)}</b><span>${esc(sub)}</span></span></label>`;
    }).join('');
    m.body.innerHTML = `<p class="vaf-sub">${await statusLine()}</p><div class="vaf-scanlist">${rows}</div>`;
    m.body.querySelectorAll('[data-sel]').forEach((c) => c.addEventListener('change', () => { const st = { ...G.get('scan_sel', {}) }; st[c.dataset.sel] = c.checked; G.set('scan_sel', st); }));
    const start = () => {
      const sl = scanSel();
      const ks = SCANS.filter((x) => scanAvail(x) && sl[x.k]).map((x) => x.k);
      if (!ks.length) { toast('Kein Scan ausgewählt.'); return; }
      Scan.start(ks);
      openScanProgress(m);
    };
    const q = await Queue.count().catch(() => 0);
    m.buttons([
      { label: `${W1}-Scan starten`, primary: true, focus: true, fn: start },
      ...(q ? [{ label: `Warteliste abarbeiten (${fmtN(q)})`, fn: () => openBlockProgress(m) }] : []),
      { label: 'Abbrechen', fn: () => m.close() },
    ]);
  }

  // ---------- Fortschrittsanzeige Scan (liest den gemeinsamen Zustand, läuft im Hintergrund weiter) ----------
  function openScanProgress(m) {
    m = m || modal({ title: `${word()}-Scan läuft`, sub: '' });
    m.body.innerHTML = `<div class="vaf-cur" data-r="phase"></div>
      <div class="vaf-bar"><div data-r="b1"></div></div><div class="vaf-bar"><div data-r="b2"></div></div>
      <div class="vaf-cur" data-r="cur"></div><div class="vaf-stats" data-r="stats"></div><div data-r="extra"></div>`;
    const $ = (r) => m.body.querySelector(`[data-r=${r}]`);
    let timer = null, lastDone = false;
    const render = () => {
      const s = Scan.live(); if (!s) { m.close(); return; }
      $('phase').textContent = s.done ? (s.stopped ? 'Abgebrochen.' : 'Fertig.') : (s.phase || s.title || 'Scan …');
      $('b1').style.width = (s.b1 || 0) + '%';
      $('b2').style.width = (s.b2 || 0) + '%';
      $('cur').textContent = s.cur || '';
      $('stats').innerHTML = statsHtml({ ...newRes(), ...(s.stats || {}) });
      if (s.done && !lastDone) {
        lastDone = true;
        clearInterval(timer);
        const ex = $('extra');
        ex.innerHTML = (s.errors && s.errors.length ? `<div class="vaf-err">${s.errors.map(esc).join('<br>')}</div>` : '') +
          (s.notes && s.notes.length ? `<h3>Gruppen-Whitelist</h3><div class="vaf-list">${s.notes.map((n) => `<div>${esc(n)}</div>`).join('')}</div>` : '');
        Queue.count().then((q) => m.buttons([
          ...(q ? [{ label: `Warteliste abarbeiten (${fmtN(q)})`, primary: true, fn: () => openBlockProgress(m) }] : []),
          { label: 'Schließen', focus: true, fn: () => m.close() },
        ]));
      }
    };
    m.buttons([{ label: 'Im Hintergrund weiterlaufen', fn: () => m.close() }, { label: 'Scan abbrechen', fn: () => { Scan.stop(); } }]);
    render();
    timer = setInterval(render, 600);
    const off = Bus.on('scan', render);
    const origClose = m.close;
    m.close = () => { clearInterval(timer); if (off) off(); origClose.call(m); };
  }

  // ---------- Fortschrittsanzeige Warteliste (Blockieren) ----------
  async function openBlockProgress(m) {
    m = m || modal({ title: 'Warteliste', sub: '' });
    m.body.innerHTML = `<div class="vaf-cur" data-r="cur">Starte …</div><div class="vaf-bar"><div data-r="b"></div></div><div class="vaf-list" data-r="list"></div>`;
    const $ = (r) => m.body.querySelector(`[data-r=${r}]`);
    m.buttons([{ label: 'Im Hintergrund weiterlaufen', focus: true, fn: () => m.close() }]);
    G.set('blk_handover', { tab: TAB_ID, at: now() });
    if (Etappe.running) Etappe.stop();
    for (let t = 0; (Etappe.running || Lock.other('etappe')) && t < 120; t++) await sleep(500);
    const st = await Etappe.run('Opa-Scan', (i, n, q) => {
      $('cur').textContent = `${i}/${n}: ${q.nick} (${(q.ages || []).join('/')}) – ${q.src}`;
      $('b').style.width = `${Math.round(i / n * 100)}%`;
    }, { manual: true });
    G.del('blk_handover');
    if (!st) { $('cur').textContent = 'Das Blockieren läuft gerade in einem anderen Tab.'; }
    else {
      $('cur').innerHTML = `Fertig: ${st.ok} blockiert, ${st.fail} Fehler, ${st.dropped} übersprungen${st.test ? `, ${st.test} Testlauf` : ''}${st.limit ? ' – Höchstzahl erreicht' : ''}.<br>` + await statusLine();
      $('b').style.width = '100%';
      $('list').innerHTML = st.items.map((x) => `<div>${esc(x.nick)}: ${esc(x.res)}</div>`).join('') || '<div>Nichts zu tun.</div>';
    }
    m.buttons([{ label: 'Schließen', focus: true, primary: true, fn: () => m.close() }]);
  }

  // Dynamischer Einstieg über den Kopf-Badge
  function openScanOrProgress() {
    if (scanActive()) { openScanProgress(); return; }
    const q = G.get('qcount', 0) || 0;
    const bs = (G.get('blk_state', null) || {}).st;
    if (q > 0 || Etappe.running || bs === 'blockiert') { openBlockProgress(); return; }
    openScanPopup();
  }

  // =====================================================================================
  // Einstellungsseite „Opa-Schutz“ (/setting/profile#opa-schutz) und Menüpunkte der Einstellungen
  // =====================================================================================
  const SETTINGS_CSS = `
  #vaf-set{color:#e8e8e8;font-size:14px;line-height:1.45;padding-bottom:40px}
  #vaf-set h2{font-size:18px;margin:22px 0 10px;display:flex;align-items:center;gap:12px;color:#fff}
  #vaf-set h2 small, #vaf-set .vaf-src{font-size:12px;font-weight:400;color:#ffc21a;cursor:pointer}
  #vaf-set .vaf-card{background:#1f1f1f;border-radius:10px;padding:4px 16px;margin-bottom:6px}
  #vaf-set .vaf-r{display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1px solid #2c2c2c}
  #vaf-set .vaf-r:last-child{border-bottom:0}
  #vaf-set .vaf-lab{flex:0 0 230px}
  #vaf-set .vaf-lab .vaf-d{color:#8c8c8c;font-size:12px}
  #vaf-set .vaf-ctl{flex:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  #vaf-set .vaf-num{width:70px;background:#141414;border:1px solid #444;border-radius:6px;color:#fff;padding:4px 8px}
  #vaf-set .vaf-txt{flex:1;min-width:240px;background:#141414;border:1px solid #444;border-radius:6px;color:#fff;padding:5px 8px}
  #vaf-set select{background:#141414;border:1px solid #444;border-radius:6px;padding:4px 10px;color:#fff}
  #vaf-set .vaf-btn{background:#3a3a3a;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer;font:inherit}
  #vaf-set .vaf-btn.vaf-y{background:#ffc21a;color:#111;font-weight:600}
  #vaf-set .vaf-btn:disabled{opacity:.4;cursor:default}
  #vaf-set .vaf-sw{width:40px;height:22px;border-radius:11px;background:#555;position:relative;display:inline-block;flex:none;cursor:pointer;border:0;padding:0}
  #vaf-set .vaf-sw::after{content:"";position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
  #vaf-set .vaf-sw.on{background:#ffc21a}
  #vaf-set .vaf-sw.on::after{left:20px}
  #vaf-set .vaf-rank{display:flex;flex-direction:column;gap:4px}
  #vaf-set .vaf-rank > div{display:flex;align-items:center;gap:8px;background:#2b2b2b;border-radius:8px;padding:4px 10px;width:260px}
  #vaf-set .vaf-rank i{font-style:normal;color:#8c8c8c;width:18px}
  #vaf-set .vaf-rank span{flex:1}
  #vaf-set .vaf-rank b{cursor:pointer;color:#a6a6a6;font-weight:400;padding:0 3px}
  #vaf-set .vaf-rank b.off{opacity:.25;cursor:default}
  #vaf-set .vaf-red{color:#ff7875}
  #vaf-set .vaf-chip{background:#2b2b2b;border-radius:12px;padding:2px 10px;font-size:12px;display:inline-flex;gap:6px;align-items:center}
  #vaf-set .vaf-chip b{cursor:pointer;color:#a6a6a6;font-weight:400}
  #vaf-set .vaf-info{background:#1f1f1f;border-radius:10px;padding:12px 16px;display:flex;gap:40px;flex-wrap:wrap}
  #vaf-set .vaf-info b{color:#ffc21a}
  #vaf-set .vaf-srcgrid{display:grid;grid-template-columns:150px 1fr 1fr;gap:6px 18px;align-items:center;padding:10px 0;border-bottom:1px solid #2c2c2c}
  #vaf-set .vaf-srcgrid .vaf-h{color:#8c8c8c;font-size:12px}
  #vaf-set .vaf-srcgrid.shared{grid-template-columns:1fr 1fr}
  #vaf-set .vaf-card > .vaf-srcgrid:last-child{border-bottom:0}
  #vaf-set .vaf-grow .vaf-glab .vaf-d{color:#8c8c8c;font-size:12px}
  #vaf-set .vaf-grow .vaf-gctl{grid-column:2 / span 2;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  #vaf-set .vaf-grow.shared .vaf-glab, #vaf-set .vaf-grow.shared .vaf-gctl{grid-column:1 / -1}
  #vaf-set .vaf-grow.shared .vaf-glab{display:flex;gap:10px;align-items:baseline}
  #vaf-set .vaf-mop-leg{display:flex;gap:22px;font-size:13px;font-weight:600}
  #vaf-set .vaf-lbls{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;width:100%}
  #vaf-set .vaf-lbls .vaf-txt{min-width:0;width:100%;box-sizing:border-box}
  #vaf-set .vaf-ver{font-size:13px;font-weight:400;color:#8c8c8c;text-decoration:none}
  #vaf-set .vaf-ver:hover{text-decoration:underline}
  #vaf-set .vaf-hlink{font-size:13px;font-weight:400;color:#4096ff;text-decoration:none;margin-left:10px}
  #vaf-set .vaf-hlink:hover{text-decoration:underline}
  #vaf-set .vaf-sl{position:relative;height:36px;min-width:180px;user-select:none;touch-action:none}
  #vaf-set .vaf-sl .t{position:absolute;top:22px;left:8px;right:8px;height:4px;background:#444;border-radius:2px}
  #vaf-set .vaf-sl .f{position:absolute;top:22px;height:4px;background:#ffc21a;border-radius:2px}
  #vaf-set .vaf-sl .h{position:absolute;top:16px;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #ffc21a;margin-left:-8px;cursor:grab;box-sizing:border-box}
  #vaf-set .vaf-sl .v{position:absolute;left:50%;bottom:100%;margin-bottom:3px;font-size:11px;line-height:12px;color:#ddd;transform:translateX(-50%);white-space:nowrap;pointer-events:none}
  #vaf-set .vaf-exp{margin:24px 0 8px;font-size:16px;font-weight:600;cursor:pointer;color:#fff}
  #vaf-set .vaf-foot{display:flex;gap:10px;margin:26px 0 40px}
  #vaf-set .vaf-grp{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;width:100%}
  #vaf-set .vaf-grp label{display:flex;gap:8px;align-items:center}
  #vaf-set .vaf-mini{font-size:12px;color:#8c8c8c}
  `;

  // ---------- Menüpunkte in der linken Spalte der Einstellungen ----------
  function settingsMenu() {
    const nav = document.querySelector('[data-type="secondary-navigation"]');
    if (!nav || !location.pathname.startsWith('/setting') && !location.pathname.startsWith('/dating/my-dates')) return;
    const links = [...nav.querySelectorAll('a[href]')];
    if (!links.length) return;
    // aktive Klasse = Klasse, die nur ein Link hat
    const counts = {};
    links.forEach((a) => a.classList.forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));
    const activeCls = Object.keys(counts).find((c) => counts[c] === 1 && links.length > 2) || '';
    const base = links.find((a) => !a.classList.contains(activeCls)) || links[0];
    const mk = (id, label, hash, icon) => {
      let a = document.getElementById(id);
      if (a) { const l = a.querySelector('[data-type="label"]'); if (l && l.textContent !== label) l.textContent = label; return a; }
      a = base.cloneNode(true);
      a.id = id;
      if (activeCls) a.classList.remove(activeCls);
      a.setAttribute('href', '/setting/profile#' + hash);
      const lab = a.querySelector('[data-type="label"]'); if (lab) lab.textContent = label;
      const ic = a.querySelector('[data-type="icon"]'); if (ic) ic.innerHTML = icon;
      a.addEventListener('click', (e) => { e.preventDefault(); goHash(hash); });
      return a;
    };
    const fick = mk('vaf-nav-fick', 'Meine Fickliste', 'fickliste', fickIcon(2, 18));
    const opa = mk('vaf-nav-opa', `${word()}-Schutz`, 'opa-schutz', oldManSvg(1.1));
    const after = nav.querySelector('a[href="/dating/my-dates"]');
    const before = nav.querySelector('a[href="/setting/privacy/home"]');
    if (after && fick.previousElementSibling !== after) after.after(fick);
    if (before && opa.nextElementSibling !== before) before.before(opa);
    const h = location.hash.replace('#', '').split('=')[0];
    const ours = location.pathname === '/setting/profile' && ['opa-schutz', 'fickliste', 'archiv', 'extern'].includes(h);
    if (activeCls) {
      for (const a of nav.querySelectorAll('a[href]')) {
        const want = ours ? ((a.id === 'vaf-nav-opa' && h === 'opa-schutz') || (a.id === 'vaf-nav-fick' && h !== 'opa-schutz'))
          : !a.id.startsWith('vaf-nav') && location.pathname.startsWith(a.getAttribute('href'));
        if (a.classList.contains(activeCls) !== want) a.classList.toggle(activeCls, want);
      }
    }
  }
  // nach dem Klick aufs Kopf-Symbol während eines Scans: in den Einstellungen das „Scan läuft“-Fenster öffnen
  function openPendingScanProgress() {
    if (ssGet('vaf_open_scanprog') !== '1') return;
    ssSet('vaf_open_scanprog', null);
    try { if (scanActive()) openScanProgress(); } catch (e) { warn('Scan-Fenster', e); }
  }
  function goHash(hash) {
    if (location.pathname === '/setting/profile') { if (location.hash !== '#' + hash) { location.hash = hash; } else routeSettings(); }
    else location.href = '/setting/profile#' + hash;
  }

  // ---------- eigener Inhalt im Hauptbereich ----------
  let ownView = null;   // { kind, el }
  function mainArea() { return document.querySelector('main.ant-layout-content .Hg9Kid') || document.querySelector('main.ant-layout-content') || document.querySelector('main'); }
  function showOwn(kind, render) {
    const main = mainArea();
    if (!main) return false;
    if (ownView && ownView.kind === kind && ownView.el.isConnected) return true;
    hideOwn(true);
    for (const c of main.children) if (!c.dataset.vafOwn) { c.dataset.vafHidden = '1'; c.style.display = 'none'; }
    const el = document.createElement('div');
    el.dataset.vafOwn = '1';
    main.appendChild(el);
    ownView = { kind, el };
    render(el);
    return true;
  }
  function hideOwn(quiet = false) {
    if (ownView && ownView.el) ownView.el.remove();
    ownView = null;
    for (const c of document.querySelectorAll('[data-vaf-hidden]')) { c.style.display = ''; delete c.dataset.vafHidden; }
  }
  function routeSettings() {
    if (location.pathname !== '/setting/profile') { if (ownView) hideOwn(); return; }
    const [h, arg] = location.hash.replace('#', '').split('=');
    if (ownView && ownView.kind === 'opa' && h !== 'opa-schutz' && settingsDirty) {
      if (!confirmLeaveSync()) { history.replaceState(null, '', '#opa-schutz'); return; }
      settingsDirty = false;
    }
    if (h === 'opa-schutz') { showOwn('opa', renderSettings); setTimeout(openPendingScanProgress, 600); }
    else if (h === 'fickliste') showOwn('fick', renderFickList);
    else if (h === 'archiv') showOwn('archiv:' + arg, (el) => renderArchive(el, decodeURIComponent(arg || '')));
    else if (h === 'extern') showOwn('extern:' + arg, (el) => renderExternal(el, decodeURIComponent(arg || '')));
    else if (ownView) { if (!settingsDirty || confirmLeaveSync()) hideOwn(); }
    settingsMenu();
  }
  let settingsDirty = false;
  const confirmLeaveSync = () => W.confirm('Ungespeicherte Änderungen verwerfen?');

  // ---------- Bausteine ----------
  function sw(on, fn, title = '') {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vaf-sw' + (on ? ' on' : ''); b.title = title;
    b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', v ? 'true' : 'false'); fn(v); });
    return b;
  }
  function numIn(v, fn, min = 0, max = 100000, step = 1) {
    const i = document.createElement('input');
    i.type = 'number'; i.className = 'vaf-num'; i.value = v; i.min = min; i.max = max; i.step = step;
    i.addEventListener('change', () => { let x = Number(i.value); if (!isFinite(x)) x = min; x = Math.max(min, Math.min(max, x)); i.value = x; fn(x); });
    return i;
  }
  function txtIn(v, fn, ph = '') {
    const i = document.createElement('input'); i.type = 'text'; i.className = 'vaf-txt'; i.value = v || ''; i.placeholder = ph;
    i.addEventListener('change', () => fn(i.value)); return i;
  }
  // Schieberegler mit mehreren Griffen und farbigen Abschnitten (Moppel-Stufen)
  const MOP_RADII = [5, 10, 25, 50, 75, 100, 250, 450, 0];   // 0 = Weltweit; 75 = sucht 100 km und filtert über 75 km
  function multiSlider(min, max, vals, colors, fn) {
    const el = document.createElement('div');
    el.className = 'vaf-sl';
    el.innerHTML = '<div class="t"></div>' + colors.map(() => '<div class="seg"></div>').join('') + vals.map(() => '<div class="h"><span class="v"></span></div>').join('');
    const segs = [...el.querySelectorAll('.seg')], hs = [...el.querySelectorAll('.h')];
    const cur = [...vals];
    const pos = (v) => `calc(8px + (100% - 16px) * ${(v - min) / (max - min)})`;
    const draw = () => {
      const b = [min, ...cur, max];
      segs.forEach((sg, i) => { sg.style.cssText = `position:absolute;top:22px;height:4px;border-radius:2px;background:${colors[i]};left:${pos(b[i])};width:calc((100% - 16px) * ${(b[i + 1] - b[i]) / (max - min)})`; });
      hs.forEach((h, i) => { h.style.left = pos(cur[i]); h.style.borderColor = '#fff'; h.querySelector('.v').textContent = cur[i]; });
    };
    hs.forEach((h, i) => h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const r = el.getBoundingClientRect();
        let v = Math.round(min + (ev.clientX - r.left - 8) / (r.width - 16) * (max - min));
        v = Math.max(i ? cur[i - 1] : min, Math.min(i < cur.length - 1 ? cur[i + 1] : max, v));
        if (v !== cur[i]) { cur[i] = v; draw(); }
      };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); fn([...cur]); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    }));
    draw();
    return el;
  }
  // Schieberegler mit 1–2 Griffen
  function slider(min, max, vals, fn) {
    const el = document.createElement('div');
    el.className = 'vaf-sl';
    el.innerHTML = '<div class="t"></div><div class="f"></div>' + vals.map(() => '<div class="h"><span class="v"></span></div>').join('');
    const hs = [...el.querySelectorAll('.h')], f = el.querySelector('.f');
    const cur = [...vals];
    const pos = (v) => `calc(8px + (100% - 16px) * ${(v - min) / (max - min)})`;
    const draw = () => {
      hs.forEach((h, i) => { h.style.left = pos(cur[i]); h.querySelector('.v').textContent = cur[i]; });
      if (cur.length === 2) { f.style.left = pos(cur[0]); f.style.width = `calc((100% - 16px) * ${(cur[1] - cur[0]) / (max - min)})`; }
      else { f.style.left = pos(cur[0]); f.style.width = `calc((100% - 16px) * ${(max - cur[0]) / (max - min)})`; }
    };
    hs.forEach((h, i) => h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const r = el.getBoundingClientRect();
        let v = Math.round(min + (ev.clientX - r.left - 8) / (r.width - 16) * (max - min));
        v = Math.max(min, Math.min(max, v));
        if (cur.length === 2) { if (i === 0) v = Math.min(v, cur[1]); else v = Math.max(v, cur[0]); }
        if (v !== cur[i]) { cur[i] = v; draw(); }
      };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); fn([...cur]); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    }));
    draw();
    el.set = (v) => { v.forEach((x, i) => { cur[i] = x; }); draw(); };
    return el;
  }
  function row(card, label, desc, ...ctl) {
    const r = document.createElement('div');
    r.className = 'vaf-r';
    r.innerHTML = `<div class="vaf-lab"><span class="vaf-l">${label}</span>${desc ? `<div class="vaf-d">${desc}</div>` : ''}</div><div class="vaf-ctl"></div>`;
    ctl.flat().filter(Boolean).forEach((c) => r.querySelector('.vaf-ctl').append(typeof c === 'string' ? document.createRange().createContextualFragment(c) : c));
    card.appendChild(r);
    return r;
  }
  function card(root, title, extra = '') {
    const h = document.createElement('h2'); h.innerHTML = title + extra; root.appendChild(h);
    const c = document.createElement('div'); c.className = 'vaf-card'; root.appendChild(c);
    return c;
  }

  // ---------- Seite rendern ----------
  let draft = null;
  function renderSettings(el) {
    if (!document.getElementById('vaf-set-style')) { const st = document.createElement('style'); st.id = 'vaf-set-style'; st.textContent = SETTINGS_CSS; document.head.appendChild(st); }
    ensureStyle();
    draft = clone(S());
    settingsDirty = false;
    el.id = 'vaf-set';
    const W1 = word();
    el.innerHTML = `<h2 style="margin-top:4px">${esc(W1)}-Schutz <a class="vaf-ver" href="${REPO_URL}/blob/main/changelog.txt" target="_blank" rel="noopener" title="Was ist neu? (Changelog)">${esc(VERSION)}</a><a class="vaf-hlink" href="${REPO_URL}#readme" target="_blank" rel="noopener">Anleitung</a><a class="vaf-hlink" href="${REPO_URL}/issues" target="_blank" rel="noopener">Fehler melden</a></h2><div class="vaf-info"><div>Derzeit blockiert: <span id="vaf-cur-n">…</span></div><div>Mit neuen Einstellungen: <b id="vaf-after-n">…</b></div></div><div id="vaf-set-body"></div>`;
    const body = el.querySelector('#vaf-set-body');
    const touch = () => { settingsDirty = true; projectLater(); };
    const lab = (text, path) => `<span data-path="${path}">${text}</span>`;
    const rerender = () => { const y = W.scrollY; body.innerHTML = ''; build(); W.scrollTo(0, y); };

    function build() {
      // ---- Gruppen ----
      // Gemeinsame Grenzen (Experten-Schalter): nur die Zeile „Global“, volle Breite; Quellen-Spalte entfällt.
      const shared = !!draft.expert.sharedLimits;
      // Zeile im Raster der Schieberegler: Beschriftung links (bzw. bei gemeinsamen Grenzen darüber),
      // Bedienelement beginnt genau unter dem Visuell-Regler / dem Schalter „Visuelle Einstufung“.
      const gRow = (c, labHtml, desc, ...ctl) => {
        const r = document.createElement('div'); r.className = 'vaf-srcgrid vaf-grow' + (shared ? ' shared' : '');
        const l = document.createElement('div'); l.className = 'vaf-glab';
        l.innerHTML = `<span class="vaf-l">${labHtml}</span>${desc ? `<div class="vaf-d">${desc}</div>` : ''}`;
        const k = document.createElement('div'); k.className = 'vaf-gctl';
        ctl.flat().filter(Boolean).forEach((x) => k.append(typeof x === 'string' ? document.createRange().createContextualFragment(x) : x));
        r.append(l, k); c.appendChild(r); return r;
      };
      // zwei Zellen unter „Visuell“ und „Ignorieren“ (bei getrennten Quellen mit leerer Quellen-Spalte davor)
      const pairRow = (c, a, b) => {
        const r = document.createElement('div'); r.className = 'vaf-srcgrid' + (shared ? ' shared' : '');
        if (!shared) r.appendChild(document.createElement('div'));
        r.append(a, b); c.appendChild(r); return r;
      };
      const swCell = (el, labHtml) => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:10px'; d.append(el); d.append(document.createRange().createContextualFragment(labHtml)); return d; };
      for (const gk of GROUP_KEYS) {
        const g = draft.groups[gk];
        const c = card(body, GROUP_NAMES[gk]);
        // Abhängige Einstellungen ausblenden: data-dep = v (Visuelle Einstufung), i (Ignorieren), vi (eines von beiden).
        // Ganze Zeilen fallen weg (Höhe sparen); Zellen in einer Zeile mit beiden Spalten werden nur unsichtbar
        // (data-keep), damit die andere Spalte Platz und Größe behält.
        const dep = (el, d, keep = false) => { el.dataset.dep = d; if (keep) el.dataset.keep = '1'; return el; };
        const depUpd = () => {
          for (const el of c.querySelectorAll('[data-dep]')) {
            const d = el.dataset.dep, on = d === 'v' ? g.visual : d === 'i' ? g.ignore : (g.visual || g.ignore);
            if (el.dataset.keep) el.style.visibility = on ? '' : 'hidden'; else el.style.display = on ? '' : 'none';
          }
        };
        // Schalter über ihrer Spalte
        pairRow(c,
          swCell(sw(g.visual, (v) => { g.visual = v; depUpd(); touch(); }), lab('Visuelle Einstufung', `groups.${gk}.visual`)),
          swCell(sw(g.ignore, (v) => { g.ignore = v; depUpd(); touch(); }), lab('Ignorieren aktiv', `groups.${gk}.ignore`)));
        const ageRow = pairRow(c,
          swCell(sw(g.ageVisual, (v) => { g.ageVisual = v; touch(); }, 'Hebt die Grenzen der visuellen Einstufung an deinem Geburtstag um ein Jahr an'), lab('Grenzen altern mit mir', `groups.${gk}.ageVisual`)),
          swCell(sw(g.ageIgnore, (v) => { g.ageIgnore = v; touch(); }, 'Hebt die Grenze „Ignorieren ab“ an deinem Geburtstag um ein Jahr an. Wer schon blockiert ist, wird dadurch nicht entsperrt.'), lab('Grenze altert mit mir', `groups.${gk}.ageIgnore`)));
        dep(ageRow, 'vi'); { const cells = [...ageRow.children].slice(-2); dep(cells[0], 'v', true); dep(cells[1], 'i', true); }
        if (gk === 'p') {
          const sel = document.createElement('select');
          sel.innerHTML = '<option value="any">einer über der Grenze</option><option value="all">beide über der Grenze</option>';
          sel.value = g.coupleMode; sel.addEventListener('change', () => { g.coupleMode = sel.value; touch(); });
          dep(gRow(c, lab('Paar-Regel', 'groups.p.coupleMode'), '', sel), 'vi');
          const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!g.separate;
          chk.addEventListener('change', () => { g.separate = chk.checked; rerender(); touch(); });
          dep(gRow(c, lab('Getrenntes Alter', 'groups.p.separate'), '', chk), 'vi');
        }
        const rowsFor = (key, who) => {
          const grid = document.createElement('div');
          grid.className = 'vaf-srcgrid' + (shared ? ' shared' : '');
          const w = who ? who + ' · ' : '';
          grid.innerHTML = `${shared ? '' : '<div></div>'}<div class="vaf-h" data-dep="v" data-keep="1">${w}Visuell: Stufe 1 bis · Stufe 2 bis</div><div class="vaf-h" data-dep="i" data-keep="1">${w}Ignorieren ab</div>`;
          dep(grid, 'vi');
          const keys = shared ? ['global'] : SRC_KEYS.filter((sk) => SOURCES[sk].avail);   // Partygäste: ausgeblendet, intern = Profilbesucher
          for (const sk of keys) {
            if (!g[key][sk]) g[key][sk] = [...g[key].interaktionen];
            const v = g[key][sk];
            const s1 = slider(18, AGE_MAX, [v[0], v[1]], (x) => { v[0] = x[0]; v[1] = x[1]; touch(); });
            const s2 = slider(18, AGE_MAX, [v[2]], (x) => { v[2] = x[0]; touch(); });
            dep(s1, 'v', true); dep(s2, 'i', true);
            if (shared) { s1.title = s2.title = 'Gilt für alle Quellen · 99 = offenes Ende'; grid.append(s1, s2); continue; }
            const name = document.createElement('div');
            name.innerHTML = lab(esc(SOURCES[sk].label), `groups.${gk}.${key}.${sk}`); name.title = SOURCES[sk].tip;
            grid.append(name, s1, s2);
          }
          c.appendChild(grid);
          if (shared) return;
          const b = document.createElement('button'); b.type = 'button'; b.className = 'vaf-btn'; b.textContent = 'Werte der ersten Zeile für alle Quellen übernehmen';
          b.style.whiteSpace = 'nowrap';   // einzeilig; wächst nach links
          b.addEventListener('click', () => { const f = g[key][SRC_KEYS[0]]; for (const sk of SRC_KEYS) g[key][sk] = [...f]; rerender(); touch(); });
          const brow = document.createElement('div'); brow.style.cssText = 'display:flex;justify-content:flex-end;padding:11px 0;border-bottom:1px solid #2c2c2c';
          brow.appendChild(b); c.appendChild(dep(brow, 'vi'));
        };
        if (gk === 'p' && g.separate) { rowsFor('srcW', 'Frau'); rowsFor('srcM', 'Mann'); } else rowsFor('src', '');
        if (gk === 'p') {
          dep(gRow(c, lab('Sugar Daddy', 'groups.p.sugarDaddy'), 'Mann deutlich älter als die Frau', sw(g.sugarDaddy.on, (v) => { g.sugarDaddy.on = v; touch(); }), 'Altersabstand ab', numIn(g.sugarDaddy.gap, (x) => { g.sugarDaddy.gap = x; touch(); }, 1, 60), 'Jahren'), 'vi');
          dep(gRow(c, lab('Sugar Mom', 'groups.p.sugarMom'), 'Frau deutlich älter als der Mann', sw(g.sugarMom.on, (v) => { g.sugarMom.on = v; touch(); }), 'Altersabstand ab', numIn(g.sugarMom.gap, (x) => { g.sugarMom.gap = x; touch(); }, 1, 60), 'Jahren'), 'vi');
        }
        const lbl = document.createElement('div'); lbl.className = 'vaf-lbls';
        [0, 2, 4, 1, 3, 5].forEach((i) => { const t = g.labels[i]; const inp = txtIn(t, (v) => { g.labels[i] = v.trim() || DEFAULTS.groups[gk].labels[i]; touch(); }, i % 2 ? 'Mehrzahl' : 'Einzahl'); inp.style.minWidth = '0'; lbl.appendChild(inp); });
        dep(gRow(c, lab('Bezeichnungen', `groups.${gk}.labels`), 'Oben Einzahl, unten Mehrzahl', lbl), 'v');
        const types = document.createElement('div'); types.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap';
        for (const t of ['m', 'w', 'p', 'ts', 'tv']) {
          const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:6px;align-items:center';
          const ch = document.createElement('input'); ch.type = 'checkbox'; ch.checked = g.types.includes(t);
          ch.addEventListener('change', () => {
            if (ch.checked) { for (const k of GROUP_KEYS) draft.groups[k].types = draft.groups[k].types.filter((x) => x !== t); g.types.push(t); }
            else g.types = g.types.filter((x) => x !== t);
            rerender(); touch();
          });
          l.append(ch, TYPE_NAMES[t]); types.appendChild(l);
        }
        dep(gRow(c, lab('Profiltypen', `groups.${gk}.types`), '', types), 'vi').classList.add('vaf-last');
        depUpd();
      }

      // ---- Allgemein ----
      const ca = card(body, 'Allgemein');
      row(ca, lab('Warnalter', 'warnYears'), 'so viele Jahre vor „Ignorieren ab“: dunkelorange und vormerken', numIn(draft.warnYears, (x) => { draft.warnYears = x; touch(); }, 0, 10), 'Jahr(e)',
        sw(draft.watch, (v) => { draft.watch = v; touch(); }), lab('vormerken', 'watch'));
      const wl = draft.whitelist;
      const wlSum = `${wl.names.slice(0, 6).map((x) => esc(x.n)).join(', ')}${wl.names.length > 6 ? ' …' : ''}${wl.prefixes.length ? ` · Präfix ${wl.prefixes.map((p) => '„' + esc(p) + '“').join(', ')}` : ''} · ${wl.names.length} Einträge${wl.groups.length ? `, ${wl.groups.length} Gruppen` : ''}`;
      const wb = document.createElement('button'); wb.type = 'button'; wb.className = 'vaf-btn'; wb.textContent = 'Whitelist bearbeiten';
      wb.addEventListener('click', () => editWhitelist(() => { rerender(); touch(); }));
      row(ca, lab('Whitelist', 'whitelist'), '', `<span>${wlSum}</span>`, wb);
      const ab = document.createElement('button'); ab.type = 'button'; ab.className = 'vaf-btn'; ab.textContent = 'Anzeigen';
      ab.addEventListener('click', showAutoWhitelist);
      row(ca, 'Automatische Whitelist', 'poppen-Mitarbeiter, Freunde, Mitglieder verwalteter Gruppen', '<span id="vaf-autowl">…</span>', ab);
      // Party-Termine (Messenger, Abschnitt „Termine“)
      const tSt = document.createElement('span'); tSt.className = 'vaf-mini';
      termHandle().then((h) => { tSt.textContent = !termSupported() ? 'nur in Chrome/Edge' : h ? `Datei: ${h.name}` : 'keine Datei gewählt'; });
      const tB = document.createElement('button'); tB.type = 'button'; tB.className = 'vaf-btn'; tB.textContent = 'Datei wählen …';
      tB.addEventListener('click', async () => { const h = await pickTermFile(); if (h) tSt.textContent = `Datei: ${h.name}`; });
      row(ca, 'Party-Termine', 'Textdatei „wann - wo - was - Link“; die nächsten 5 Termine stehen im Messenger unter „Termine“', tB, tSt);
      autoWhitelistCount().then((n) => { const e = el.querySelector('#vaf-autowl'); if (e) e.textContent = `${fmtN(n)} Mitglieder`; });

      // ---- Gruppen ----
      const cg = card(body, 'Gruppen', ' <small data-reload="1">neu laden</small>');
      body.lastElementChild.previousElementSibling.querySelector('[data-reload]').addEventListener('click', async () => { await loadGroups().catch(() => {}); rerender(); });
      const gr = G.get('groups', null);
      if (!gr) { row(cg, 'Noch nicht geladen', '', '<span class="vaf-mini">„neu laden“ klicken</span>'); loadGroups().then(() => rerender()).catch(() => {}); }
      else {
        const mbox = document.createElement('div'); mbox.className = 'vaf-grp';
        for (const g of gr.managed) {
          const l = document.createElement('label');
          const s2 = sw(draft.managedWhitelist[g.cms] !== false, (v) => { if (v) delete draft.managedWhitelist[g.cms]; else draft.managedWhitelist[g.cms] = false; touch(); });
          l.append(s2, `${g.name} · ${g.role === 'moderator' ? 'Moderatorin' : 'Eigentümerin'} · ${fmtN(g.count)} Mitglieder`);
          mbox.appendChild(l);
        }
        row(cg, lab('Verwaltete Gruppen', 'managedWhitelist'), `Schalter = Mitglieder whitelisten, wenn du die Gruppe allein leitest (Schonfrist ${draft.expert.groupGraceDays} Tage)`, gr.managed.length ? mbox : '<span class="vaf-mini">keine</span>');
        const abox = document.createElement('div'); abox.className = 'vaf-grp';
        for (const g of gr.attended) {
          const l = document.createElement('label');
          const ch = document.createElement('input'); ch.type = 'checkbox'; ch.checked = draft.groupScan[g.cms] !== false;
          ch.addEventListener('change', () => { if (ch.checked) delete draft.groupScan[g.cms]; else draft.groupScan[g.cms] = false; touch(); });
          l.append(ch, `${g.name} · ${fmtN(g.count)}`);
          abox.appendChild(l);
        }
        row(cg, lab('Beim Gruppen-Scan prüfen', 'groupScan'), 'Gruppen, in denen du Mitglied bist', abox);
      }

      // ---- Automatik ----
      const cu = card(body, 'Automatik');
      row(cu, lab('Besucherliste', 'auto.besucher'), '', sw(draft.auto.besucher, (v) => { draft.auto.besucher = v; touch(); }), 'beim Öffnen automatisch prüfen');
      row(cu, lab('Mitgliedersuche (Seite)', 'auto.suche'), '', sw(draft.auto.suche, (v) => { draft.auto.suche = v; touch(); }), 'beim Öffnen automatisch prüfen');
      row(cu, lab('Interaktionen (Seiten)', 'auto.interaktionen'), 'Likes, Sticker, Posteingang', sw(draft.auto.interaktionen, (v) => { draft.auto.interaktionen = v; touch(); }), 'beim Öffnen automatisch prüfen');
      row(cu, lab('Automatisch anmelden', 'autoLogin'), 'nur mit vom Browser ausgefüllten Daten', sw(draft.autoLogin, (v) => { draft.autoLogin = v; touch(); }), 'Pause zwischen Versuchen', numIn(draft.autoLoginPauseMin, (x) => { draft.autoLoginPauseMin = x; touch(); }, 1, 1440), 'Min.');
      row(cu, lab('Wartungsseite', 'maintenanceMin'), '', 'neuer Versuch nach', numIn(draft.maintenanceMin, (x) => { draft.maintenanceMin = x; touch(); }, 1, 1440), 'Min.');

      // ---- Moppel-Liebhaber ----
      {
        const mp = draft.moppel;
        const cm = card(body, 'Moppel-Liebhaber');
        const r0 = document.createElement('div'); r0.className = 'vaf-srcgrid shared';
        // alles unter dem Schalter nur bei „Benutzer ist Moppel-Liebhaber“
        const mopVis = () => { [...cm.children].slice(1).forEach((e) => { e.style.display = mp.on ? '' : 'none'; }); r0.classList.toggle('vaf-last', !mp.on); };
        r0.append(swCell(sw(mp.on, (v) => { mp.on = v; mopVis(); touch(); }), lab('Benutzer ist Moppel-Liebhaber', 'moppel.on')), document.createElement('div'));
        cm.appendChild(r0);
        // Legende (Bezeichnungen in Segmentfarbe) + Regler 25–60 mit drei Griffen
        const r1 = document.createElement('div'); r1.className = 'vaf-srcgrid shared';
        const leg = document.createElement('div'); leg.className = 'vaf-mop-leg'; leg.style.gridColumn = '1/-1';
        const paintLeg = () => { leg.innerHTML = ['Plus-Size', mp.labels[0], mp.labels[2], mp.labels[4]].map((t, i) => `<span style="color:${MOP_COLORS[i]}">${esc(t)}</span>`).join(''); };
        paintLeg();
        const ms = multiSlider(25, 60, mp.bmi, MOP_COLORS, (x) => { mp.bmi = x; touch(); });
        ms.style.gridColumn = '1/-1';
        r1.append(leg, ms); cm.appendChild(r1);
        const mlbl = document.createElement('div'); mlbl.className = 'vaf-lbls';
        [0, 2, 4, 1, 3, 5].forEach((i) => { const inp = txtIn(mp.labels[i], (v) => { mp.labels[i] = v.trim() || DEFAULTS.moppel.labels[i]; paintLeg(); touch(); }, i % 2 ? 'Mehrzahl' : 'Einzahl'); inp.style.minWidth = '0'; mlbl.appendChild(inp); });
        const gm = (labHtml, desc, ...ctl) => { const r = document.createElement('div'); r.className = 'vaf-srcgrid vaf-grow shared'; const l = document.createElement('div'); l.className = 'vaf-glab'; l.innerHTML = `<span class="vaf-l">${labHtml}</span>${desc ? `<div class="vaf-d">${desc}</div>` : ''}`; const k = document.createElement('div'); k.className = 'vaf-gctl'; ctl.forEach((x) => k.append(x)); r.append(l, k); cm.appendChild(r); return r; };
        gm(lab('Bezeichnungen', 'moppel.labels'), 'Oben Einzahl, unten Mehrzahl', mlbl);
        // Suchradius als Schieberegler im poppen-Design (Stufen wie poppens Radius-Regler, 75 km zusätzlich)
        const rfmt = (r) => (r ? r + ' km' : 'Weltweit');
        const radBox = document.createElement('div'); radBox.className = 'vaf-pk'; radBox.style.cssText = 'width:100%;min-width:220px;padding-top:6px';
        const radVal = document.createElement('div'); radVal.className = 'vaf-pk-val'; radVal.textContent = rfmt(mp.radius);
        const rad = pkSlider({ steps: MOP_RADII, values: [mp.radius], fmt: rfmt, marks: [[MOP_RADII[0], rfmt(MOP_RADII[0])], [0, 'Weltweit']], live: ([v]) => { radVal.textContent = rfmt(v); }, onChange: ([v]) => { mp.radius = v; touch(); } });
        radBox.append(radVal, rad);
        gm(lab('Suchradius', 'moppel.radius'), '', radBox);
        const mt = document.createElement('div'); mt.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap';
        for (const [t, name] of [['m', 'Mann'], ['w', 'Frau'], ['pw', 'Paar (Frau)'], ['pm', 'Paar (Mann)'], ['ts', 'Trans'], ['tv', 'Nicht-binär']]) {
          const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:6px;align-items:center';
          const ch = document.createElement('input'); ch.type = 'checkbox'; ch.checked = mp.types.includes(t);
          ch.addEventListener('change', () => { mp.types = ch.checked ? [...new Set([...mp.types, t])] : mp.types.filter((x) => x !== t); touch(); });
          l.append(ch, name); mt.appendChild(l);
        }
        gm(lab('Profiltypen', 'moppel.types'), '', mt).classList.add('vaf-last');
        mopVis();
      }

      // ---- AWO-Faktor (Events) ----
      {
        const aw = draft.awo;
        const ca = card(body, 'AWO-Faktor');
        const names = { m: 'Männer', w: 'Frauen', p: 'Paare' };
        for (const gk of ['m', 'w', 'p']) {
          const lim = limitsOf(gk, 'party', -1, draft);
          const box = document.createElement('div'); box.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
          [0, 1, 2].forEach((i) => { box.append(numIn(aw.quota[gk][i], (x) => { aw.quota[gk] = [...aw.quota[gk]]; aw.quota[gk][i] = x; touch(); }, 0, 100), document.createTextNode('%')); });
          row(ca, `Anwesenheitsquote der ${names[gk]} bis ${lim[0]} / ${lim[1]} / ab ${lim[1] + 1}`, '', box);
        }
        const AWC = ['#5c8dd6', '#b06ad6', '#e0a33c'];
        const wrap = document.createElement('div'); wrap.style.cssText = 'width:100%;min-width:260px';
        const legend = document.createElement('div'); legend.style.cssText = 'display:flex;justify-content:space-around;font-weight:600;margin-bottom:2px';
        const paint = () => { legend.innerHTML = ['Männer', 'Frauen', 'Paare'].map((n, i) => `<span style="color:${AWC[i]}">${n} ${aw.weight[i]} %</span>`).join(''); };
        paint();
        const cuts = [aw.weight[0], aw.weight[0] + aw.weight[1]];
        const ms = multiSlider(0, 100, cuts, AWC, (x) => { aw.weight = [x[0], x[1] - x[0], 100 - x[1]]; paint(); touch(); });
        ms.querySelectorAll('.v').forEach((v) => { v.style.display = 'none'; });   // Griffe ohne Zahl (Anteile stehen darüber)
        wrap.append(legend, ms);
        row(ca, 'Gewichtung Männer / Frauen / Paare', '', wrap);
      }

      // ---- Sicherung (immer offen) ----
      const btnS = (t, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vaf-btn'; b.textContent = t; b.addEventListener('click', fn); return b; };
      const cs = card(body, 'Sicherung');
      row(cs, 'Alle Daten', 'Einstellungen, Gedächtnis, Warteliste, Fickliste (verschlüsselt) …', btnS('Alle Daten sichern', () => backupAll()), btnS('Alle Daten wiederherstellen', () => restoreAll()));
      {
        const mst = document.createElement('span'); mst.className = 'vaf-mini';
        const mi = () => { const mm = G.get('mir_meta', null); mst.textContent = mm && mm.at ? `Stand ${deDateTime(mm.at)} · ${fmtN(mm.n || 0)} Mitglieder · Fickliste ${fmtN(mm.fick || 0)} · ${(Math.round((mm.size || 0) / 1024 / 102.4) / 10).toLocaleString('de-DE')} MB` : 'noch nicht angelegt'; };
        mi();
        row(cs, 'Rettungsanker', 'gepackte Kopie im Tampermonkey-Speicher – übersteht das Löschen von Website-Daten',
          mst, btnS('Jetzt aktualisieren', async () => { mst.textContent = 'aktualisiere …'; await mirrorRun(true).catch((e) => toast(esc(e.message))); mi(); }),
          btnS('Aus Rettungsanker wiederherstellen', async () => { if (W.confirm('Daten aus dem Rettungsanker wiederherstellen? Neuere vorhandene Einträge bleiben erhalten.')) await mirrorRestore(false); }));
      }
      row(cs, 'Gedächtnis', 'Wissen über andere Mitglieder, Fickliste & Textvorlagen', btnS('Exportieren ohne Bilder', () => exportMemory(false)), btnS('mit Bildern', () => exportMemory(true)), btnS('Importieren (mischen)', () => importMemory()));

      // ---- Experten ----
      const exp = document.createElement('div'); exp.className = 'vaf-exp'; exp.textContent = '▸ Experten-Einstellungen';
      body.appendChild(exp);
      const ce = document.createElement('div'); ce.className = 'vaf-card'; ce.style.display = 'none'; body.appendChild(ce);
      exp.addEventListener('click', () => { const open = ce.style.display === 'none'; ce.style.display = open ? '' : 'none'; exp.textContent = (open ? '▾' : '▸') + ' Experten-Einstellungen'; });
      const x = draft.expert;
      row(ce, lab('Gemeinsame Grenzen für alle Quellen', 'expert.sharedLimits'), 'an: eine Zeile „Global“ für alle Quellen · aus: Grenzen je Quelle', sw(x.sharedLimits, (v) => { x.sharedLimits = v; rerender(); touch(); }));
      const rank = document.createElement('div'); rank.className = 'vaf-rank';
      rank.title = 'Bestimmt, welche Quelle in der Notiz steht und wer auf der Warteliste zuerst drankommt';
      const drawRank = () => {
        rank.innerHTML = '';
        // Partygäste ausgeblendet; ihr Platz in x.rank bleibt erhalten
        const vis = x.rank.filter((k) => !(SOURCES[k] && !SOURCES[k].avail));
        const swap = (a, b) => { const ia = x.rank.indexOf(a), ib = x.rank.indexOf(b); [x.rank[ia], x.rank[ib]] = [x.rank[ib], x.rank[ia]]; drawRank(); touch(); };
        vis.forEach((k, i) => {
          const r = document.createElement('div');
          r.innerHTML = `<i>${i + 1}.</i><span>${esc((SOURCES[k] || { label: 'Synchronisation' }).label)}</span><b data-u class="${i ? '' : 'off'}">▲</b><b data-d class="${i < vis.length - 1 ? '' : 'off'}">▼</b>`;
          r.querySelector('[data-u]').addEventListener('click', () => { if (i) swap(vis[i - 1], k); });
          r.querySelector('[data-d]').addEventListener('click', () => { if (i < vis.length - 1) swap(k, vis[i + 1]); });
          rank.appendChild(r);
        });
      };
      drawRank();
      row(ce, lab('Rangfolge der Quellen', 'expert.rank'), 'oben = wichtigste', rank);

      const recSt = document.createElement('span'); recSt.className = 'vaf-mini';
      Recorder.stats().then((r) => { recSt.textContent = `${r.total} Schnittstellen erfasst, davon ${r.fresh} neu`; });
      const recEx = document.createElement('button'); recEx.type = 'button'; recEx.className = 'vaf-btn'; recEx.textContent = 'Exportieren';
      recEx.addEventListener('click', async () => download(`poppen-api-rekorder-${stamp()}.json`, JSON.stringify(await Recorder.export(), null, 2)));
      const recCl = document.createElement('button'); recCl.type = 'button'; recCl.className = 'vaf-btn'; recCl.textContent = 'Leeren';
      recCl.addEventListener('click', async () => { if (W.confirm('Rekorder leeren?')) { await Recorder.clear(); recSt.textContent = '0 Schnittstellen erfasst'; } });
      row(ce, lab('API-Rekorder', 'expert.recorder'), 'schneidet Abfragen der Seite mit (Sensibles geschwärzt)', sw(x.recorder, (v) => { x.recorder = v; touch(); }), recSt, recEx, recCl);
      // Daten
      const btn = (t, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vaf-btn'; b.textContent = t; b.addEventListener('click', fn); return b; };
      // Kontobindung: Daten bewusst an ein anderes Konto übergeben
      const owSt = document.createElement('span'); owSt.className = 'vaf-mini';
      const owInfo = () => { const o = Owner.get(); owSt.textContent = o ? `gehören zu ${o.nick}${o.handover ? ` · zur Übergabe freigegeben seit ${deDateTime(o.handover)} (7 Tage)` : ''}` : 'noch nicht gebunden'; };
      owInfo();
      const owBtn = btn('Daten an anderes Konto übergeben …', async () => {
        const o = Owner.get(); if (!o) return;
        if (o.handover) { Owner.cancelHandover(); owInfo(); owBtn.textContent = 'Daten an anderes Konto übergeben …'; return; }
        const v = await ask('Daten übergeben', `<p>Die Opa-Schutz-Daten gehören zu <b>${esc(o.nick)}</b>.</p><p>Nach dem Freigeben fragt das Skript beim nächsten Anmelden mit einem <b>anderen</b> Konto (innerhalb von 7 Tagen), ob es die Daten übernehmen soll. Bis dahin bleibt alles wie es ist.</p>`,
          [{ label: 'Zur Übergabe freigeben', value: 'yes', primary: true }, { label: 'Abbrechen', value: null, cancel: true }]);
        if (v === 'yes') { Owner.handover(); owInfo(); owBtn.textContent = 'Übergabe zurücknehmen'; }
      });
      if ((Owner.get() || {}).handover) owBtn.textContent = 'Übergabe zurücknehmen';
      row(ce, 'Kontobindung', 'Die Daten in diesem Browser-Profil gehören genau einem poppen-Konto; bei einem anderen bleibt der Opa-Schutz aus', owSt, owBtn);

      const work = btn('Jetzt abarbeiten', () => workQueue(work));
      if (Etappe.running && Etappe.manual) work.textContent = 'Anhalten';
      row(ce, 'Warteliste', 'Blockiert wird im Hintergrund; „Jetzt abarbeiten“ arbeitet die Warteliste auch bei ausgeschaltetem Schalter einmal ganz ab', btn('Anzeigen', showQueue), work, btn('Leeren', async () => { if (W.confirm('Warteliste leeren?')) { await Queue.clear(); updateCounts(); } }));

      row(ce, lab('Debug-Ausgaben', 'expert.debug'), 'zusätzliche Ausgaben in der Konsole (F12)', sw(x.debug, (v) => { x.debug = v; touch(); }));
      row(ce, lab('Testlauf', 'expert.dryRun'), 'nichts wird verändert, nur protokolliert', sw(x.dryRun, (v) => { x.dryRun = v; touch(); }));
      row(ce, lab('Obergrenze erster Scan', 'expert.firstScanMax'), 'Profilbesucher / Interaktionen', numIn(x.firstScanMax, (v) => { x.firstScanMax = v; touch(); }, 10, 1000000));
      const lim = row(ce, lab('Höchstzahl der Einträge auf der Blockierliste', 'expert.limit'), '', numIn(x.limit, (v) => { x.limit = v; touch(); }, 1, 1e9));
      lim.querySelector('.vaf-num').style.width = '120px';

      // ---- Fuß ----
      const foot = document.createElement('div'); foot.className = 'vaf-foot';
      const save = btn('Speichern', () => saveFromPage()); save.classList.add('vaf-y');
      const cancel = btn('Abbrechen', () => { draft = clone(S()); settingsDirty = false; rerender(); projectLater(); });
      foot.append(save, cancel);
      body.appendChild(foot);
    }
    build();
    updateCounts();
    projectLater();
    const iv = setInterval(() => { if (!el.isConnected) clearInterval(iv); else updateCounts(); }, 5000);
  }
  async function updateCounts() {
    // „Derzeit blockiert: Summe (blockiert + Warteliste) / Höchstzahl“
    const e1 = document.getElementById('vaf-cur-n');
    const b = G.get('blocked_count', null), lim = S().expert.limit;
    const q = await Queue.count();
    if (e1) e1.innerHTML = b == null ? `<b>?</b> (${fmtN(q)} auf der Warteliste) / ${fmtN(lim)}` : `<b>${fmtN(b + q)}</b> (${fmtN(b)} + ${fmtN(q)} auf der Warteliste) / ${fmtN(lim)}`;
  }
  // „Nach Anwenden der neuen Einstellungen“: aus dem Gedächtnis aller bekannten Mitglieder
  let projT = null;
  function projectLater() { clearTimeout(projT); projT = setTimeout(async () => {
    const e = document.getElementById('vaf-after-n');
    if (!e || !draft) return;
    e.textContent = 'rechne …';
    if (ingestDue()) {
      const pg = G.get('ingest_prog', null);
      if (pg && now() - pg.at < 120000 && pg.total) {
        const pct = Math.min(100, Math.floor(pg.n * 100 / pg.total));
        e.textContent = pg.phase === 'verarbeiten' ? `Blockierliste wird verarbeitet: ${fmtN(pg.n)} von ${fmtN(pg.total)} (${pct} %)` : `Blockierliste wird eingelesen: ${fmtN(pg.n)} von ${fmtN(pg.total)} (${pct} %)`;
      } else e.textContent = 'Blockierliste wird eingelesen …';
      e.title = 'Das Skript gleicht die Blockierliste mit seinem Gedächtnis ab (nach Updates und täglich nur die neuesten Einträge, monatlich alle). Erst danach lässt sich die Zahl berechnen.';
      setTimeout(projectLater, 2500);   // das Einlesen kann auch in einem anderen Tab laufen
      return;
    }
    const p = await projection(S(), draft);
    const lim = draft.expert.limit;
    // Basis ist die ganze Blockierliste (auch von Hand Blockierte); verändert wird nur, was die neuen Regeln wegnehmen oder hinzufügen
    const cur = G.get('blocked_count', null);
    const after = cur == null ? p.keep + p.add : Math.max(0, cur - p.drop + p.add);
    e.textContent = `${fmtN(after)} / ${fmtN(lim)}`;
    e.style.color = after > lim ? '#ff7875' : lim - after < 50 ? '#ffa940' : '';
    e.title = `bleiben ${fmtN(p.keep)}, fallen weg ${fmtN(p.drop)}, kommen dazu ${fmtN(p.add)}`;
  }, 600); }

  // Auswirkungen einer Regeländerung
  const srcOfMember = (m) => {
    const keys = Object.keys(m.seen || {});
    const ranked = keys.map((k) => srcKeyOf(k)).filter((k) => SRC_KEYS.includes(k));
    return ranked.sort((a, b) => S().expert.rank.indexOf(a) - S().expert.rank.indexOf(b))[0] || 'suche';
  };
  async function projection(oldS, newS) {
    const res = { keep: 0, drop: 0, add: 0, notes: 0, unclear: 0, dropList: [], addList: [], noteList: [] };
    await Members.each((m) => {
      const blocked = m.blk && m.blk.opa && !m.unblk;
      if (!m.ages || !m.ages.length) { if (blocked) res.keep++; return; }
      const src = blocked && m.blk.src ? m.blk.src : srcOfMember(m);
      const ages = m.birth && m.birth.length ? m.birth.map((b) => ageToday(b)) : m.ages;
      const cn = classify({ ...m, ages }, src, newS);
      if (blocked) {
        // Entsperrt wird nur, wen DIESE Änderung (aktiv verschobene Grenze) freigibt – nicht, wer schon vorher
        // unter der Grenze lag (z. B. weil die Grenzen automatisch „mit mir gealtert“ sind). Alte Säcke werden nicht jünger.
        if (cn.ignore || !classify({ ...m, ages }, src, oldS).ignore) { res.keep++; if (cn.ignore && m.blk.note && noteWord(m, newS) !== noteWord(m, oldS)) { res.notes++; res.noteList.push(m); } }
        else { res.drop++; res.dropList.push(m); }
      } else if (cn.ignore && !(m.blk && !m.unblk)) { res.add++; res.addList.push({ ...m, ages, _src: src }); }
    });
    return res;
  }
  const RULE_PATHS = (s) => JSON.stringify([GROUP_KEYS.map((k) => { const g = s.groups[k]; return [g.ignore, g.types, g.src, g.srcW, g.srcM, g.separate, g.coupleMode, g.sugarDaddy, g.sugarMom, g.labels[4]]; }), s.whitelist, s.expert.limit, !!s.expert.sharedLimits]);

  async function saveFromPage(...a) { return Prio.run('Einstellungen speichern', () => saveFromPage_(...a)); }
  async function saveFromPage_() {
    const old = S();
    if (RULE_PATHS(old) === RULE_PATHS(draft)) { saveSettings(draft); settingsDirty = false; toast('Gespeichert.'); return; }
    const p = await projection(old, draft);
    const cur = G.get('blocked_count', null);
    const html = `<div class="vaf-stats"><span>Derzeit blockiert</span><b>${fmtN(cur == null ? p.keep + p.drop : cur)}</b>` +
      `<span>Nach Anwenden</span><b>${fmtN(cur == null ? p.keep + p.add : Math.max(0, cur - p.drop + p.add))}</b><span>Fallen weg</span><b>${fmtN(p.drop)}</b><span>Kommen dazu</span><b>${fmtN(p.add)}</b>` +
      `<span>Notizen weichen ab</span><b>${fmtN(p.notes)}</b></div>`;
    const v = await ask('Regeln geändert', html, [
      { label: 'Änderungen speichern und anwenden', value: 'all', primary: true },
      ...(p.drop ? [{ label: '… und Mitglieder entsperren', value: 'drop' }] : []),
      ...(p.add ? [{ label: '… und Mitglieder sperren', value: 'add' }] : []),
      { label: 'Änderungen nur speichern', value: 'save' },
      { label: 'Änderungen verwerfen', value: 'discard', focus: true, cancel: true },
    ]);
    if (!v || v === 'discard') { draft = clone(S()); settingsDirty = false; routeSettingsRerender(); return; }
    saveSettings(draft); settingsDirty = false;
    if (v === 'all' || v === 'add') { for (const m of p.addList) await Queue.add(m, m._src); }
    if (v === 'all' || v === 'drop') applyDrops(p.dropList, v === 'all' ? p.noteList : []);
    else if (v === 'all') applyDrops([], p.noteList);
    toast(`Gespeichert.${p.add && (v === 'all' || v === 'add') ? ` ${fmtN(p.add)} auf die Warteliste.` : ''}`);
    updateCounts(); projectLater();
  }
  function routeSettingsRerender() { hideOwn(); routeSettings(); }
  async function applyDrops(drops, notes) {
    let i = 0;
    for (const m of drops) {
      i++;
      toast(`Entsperre ${i} / ${drops.length}: ${esc(m.nick)}`, 0);
      await unblockOne(m);
      await sleep(rand(S().expert.pauseMin * 1000, S().expert.pauseMax * 1000));
    }
    for (const m of notes) {
      const t = makeNote(m, m.blk.src, new Date(m.blk.at || now()));
      if (!dry()) { try { await BL.note(m.uid, t); await Members.update(m.uid, (x) => { x.blk.note = t; }); } catch {} }
    }
    if (drops.length || notes.length) toast(`Fertig: ${drops.length} entsperrt, ${notes.length} Notizen angepasst.`);
  }

  // ---------- Whitelist bearbeiten (mit Gruppen) ----------
  function editWhitelist(done) {
    const wl = draft.whitelist;
    const m = modal({ title: 'Whitelist bearbeiten', wide: false });
    const draw = () => {
      const groups = [...wl.groups].sort((a, b) => a.localeCompare(b, 'de'));
      const byG = (g) => wl.names.filter((x) => (x.g || '') === g).sort((a, b) => a.n.localeCompare(b.n, 'de'));
      m.body.innerHTML = `<h3>Eigene Whitelist-Gruppen</h3><div class="vaf-list">${groups.map((g) => `<div>${esc(g)} <a href="#" data-ren="${esc(g)}">✎</a> <a href="#" data-delg="${esc(g)}">✕</a></div>`).join('') || '<div>keine</div>'}</div>
        <div style="display:flex;gap:8px;margin-bottom:12px"><input class="vaf-in" id="vaf-ng" placeholder="Neue Gruppe"><button type="button" class="vaf-big" style="width:auto" id="vaf-ngb">Speichern</button></div>
        <h3>Präfixe</h3><input class="vaf-in" id="vaf-pre" value="${esc(wl.prefixes.join(', '))}" placeholder="z. B. Pop-MOD-">
        ${['', ...groups].map((g) => `<h3>${g ? esc(g) : 'Ohne Gruppe'}</h3><div class="vaf-list">${byG(g).map((x) => `<div>${esc(x.n)} <a href="#" data-deln="${esc(x.n)}">✕</a></div>`).join('') || '<div>leer</div>'}</div>
          <div style="display:flex;gap:8px;margin-bottom:6px"><input class="vaf-in" data-addin="${esc(g)}" placeholder="Name"><button type="button" class="vaf-big" style="width:auto" data-addbtn="${esc(g)}">Speichern</button></div>`).join('')}`;
      m.body.querySelector('#vaf-ngb').addEventListener('click', () => { const v = m.body.querySelector('#vaf-ng').value.trim(); if (!v) return; if (wl.groups.includes(v)) { W.alert('Diese Gruppe gibt es schon.'); return; } wl.groups.push(v); draw(); });
      m.body.querySelector('#vaf-pre').addEventListener('change', (e) => { wl.prefixes = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); });
      m.body.querySelectorAll('[data-ren]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const o = a.dataset.ren; const n = (W.prompt('Neuer Name:', o) || '').trim(); if (!n || n === o) return; if (wl.groups.includes(n)) { W.alert('Diese Gruppe gibt es schon.'); return; } wl.groups = wl.groups.map((g) => (g === o ? n : g)); wl.names.forEach((x) => { if (x.g === o) x.g = n; }); draw(); }));
      m.body.querySelectorAll('[data-delg]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const o = a.dataset.delg; wl.groups = wl.groups.filter((g) => g !== o); wl.names.forEach((x) => { if (x.g === o) x.g = ''; }); draw(); }));
      m.body.querySelectorAll('[data-deln]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); wl.names = wl.names.filter((x) => x.n !== a.dataset.deln); draw(); }));
      m.body.querySelectorAll('[data-addbtn]').forEach((b) => b.addEventListener('click', () => {
        const g = b.dataset.addbtn; const inp = m.body.querySelector(`[data-addin="${W.CSS.escape(g)}"]`); const v = inp.value.trim(); if (!v) return;
        const ex = wl.names.find((x) => norm(x.n) === norm(v));
        if (ex) { W.alert(`Steht schon in ${ex.g || '„Ohne Gruppe“'}.`); return; }
        wl.names.push({ n: v, g }); draw();
      }));
    };
    draw();
    m.buttons([{ label: 'Fertig', primary: true, focus: true, fn: () => { m.close(); done(); } }]);
  }
  async function autoWhitelistCount() { let n = 0; await Members.each((m) => { if (autoWhite(m)) n++; }); return n; }
  async function showAutoWhitelist() {
    const rows = [];
    await Members.each((m) => { const r = autoWhite(m); if (r) rows.push(`<div>${esc(m.nick || m.uid)} – ${esc(r)}</div>`); });
    const m = modal({ title: 'Automatische Whitelist', sub: 'Wird automatisch gepflegt; Einträge lassen sich hier nicht entfernen.', html: `<div class="vaf-list">${rows.join('') || '<div>leer</div>'}</div>` });
    m.buttons([{ label: 'Schließen', focus: true, fn: () => m.close() }]);
  }
  async function showQueue() {
    const l = await Queue.list();
    const mc = Members.cached();
    const m = modal({ title: 'Warteliste', sub: `${fmtN(l.length)} Mitglieder, in dieser Reihenfolge`, html: `<div class="vaf-list">${l.slice(0, 2000).map((q) => `<div>${q.nick ? `<a href="${esc(pathOfName(q.nick))}" target="_blank" rel="noopener" style="color:inherit">${esc(q.nick)}</a>` : esc(idresLabel(q.uid))} · ${(q.ages || []).join('/')} · ${esc(q.src)}${esc(pstateNote(mc.get(String(q.uid))))}</div>`).join('') || '<div>leer</div>'}${l.length > 2000 ? '<div>…</div>' : ''}</div>` });
    m.buttons([{ label: 'Schließen', focus: true, fn: () => m.close() }]);
  }

  // Button „Jetzt abarbeiten“: Warteliste in diesem Tab bis zum Ende abarbeiten (auch bei ausgeschaltetem Schalter)
  let workCancel = false;
  async function workQueue(b) {
    if (Etappe.manual) { workCancel = true; Etappe.stop(); b.textContent = 'Halte an …'; b.disabled = true; return; }
    const n = await Queue.count();
    if (!n) { toast('Die Warteliste ist leer.'); return; }
    if (dry()) toast('Testlauf ist an: es wird nichts blockiert, nur protokolliert.', 5000);
    workCancel = false;
    b.textContent = 'Übernehme …';
    try {
      // läuft das Blockieren schon (hier oder in einem anderen Tab): übernehmen
      G.set('blk_handover', { tab: TAB_ID, at: now() });
      if (Etappe.running) Etappe.stop();
      for (let t = 0; (Etappe.running || Lock.other('etappe')) && t < 120; t++) { if (workCancel) return; await sleep(500); }
      if (workCancel) return;
      b.textContent = 'Anhalten';
      const st = await Etappe.run('Jetzt abarbeiten', (i, total) => { if (b.isConnected && !b.disabled) b.textContent = `Anhalten (${fmtN(i)} / ${fmtN(total)})`; updateCounts(); }, { manual: true });
      if (!st) { toast('Konnte nicht starten – ein anderer Tab arbeitet gerade.'); return; }
      const rows = st.items.map((it) => `<div>${esc(it.nick)} · ${esc(it.res)}</div>`).join('');
      const m = modal({ title: 'Warteliste abgearbeitet', sub: workCancel ? 'angehalten' : '',
        html: `<div class="vaf-stats"><span>Blockiert</span><b>${fmtN(st.ok)}</b><span>Fallen weg</span><b>${fmtN(st.dropped)}</b><span>Fehlgeschlagen</span><b>${fmtN(st.fail)}</b>${st.test ? `<span>Testlauf</span><b>${fmtN(st.test)}</b>` : ''}${st.limit ? '<span>Höchstzahl erreicht</span><b>ja</b>' : ''}</div>` +
          (rows ? `<div class="vaf-list" style="margin-top:10px">${rows}</div>` : '') +
          (st.fail ? '<p class="vaf-mini">Fehlgeschlagene bleiben auf der Warteliste und werden bis zu dreimal versucht.</p>' : '') });
      m.buttons([{ label: 'Schließen', focus: true, fn: () => m.close() }]);
    } finally {
      G.del('blk_handover');
      if (b.isConnected) { b.disabled = false; b.textContent = 'Jetzt abarbeiten'; }
      updateCounts();
    }
  }

  // Seite mit ungespeicherten Änderungen verlassen
  function leaveGuard() {
    W.addEventListener('beforeunload', (e) => { if (settingsDirty && ownView && ownView.kind === 'opa') { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('click', async (e) => {
      if (!settingsDirty || !ownView || ownView.kind !== 'opa') return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.closest('#vaf-set') || a.target === '_blank') return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const v = await ask('Ungespeicherte Änderungen', '<p>Du hast Änderungen auf dieser Seite noch nicht gespeichert.</p>', [
        { label: 'Speichern und verlassen', value: 'save', primary: true }, { label: 'Verwerfen und verlassen', value: 'drop' }, { label: 'Abbrechen', value: null, focus: true, cancel: true }]);
      if (!v) return;
      if (v === 'save') await saveFromPage();
      settingsDirty = false;
      a.click();
    }, true);
  }

  // =====================================================================================
  // Profil-Menü (Klick auf das eigene Profilbild): „Opa-Scan“, „Opa-Schutz“ (Einstellungen), Schalter „Opa-Schutz aktiv“
  // =====================================================================================
  function leafWithText(root, text) {
    const t = norm(text);
    return [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && norm(e.textContent) === t) || null;
  }
  function rowOf(leaf, root) {
    let item = leaf;
    while (item.parentElement && item.parentElement !== root && item.parentElement.children.length < 3) item = item.parentElement;
    return item;
  }
  function profileMenu() {
    for (const pop of document.querySelectorAll('.ant-popover:not(.ant-popover-hidden) .ant-popover-content, .ant-dropdown:not(.ant-dropdown-hidden)')) {
      const edit = leafWithText(pop, 'Profil bearbeiten');
      if (!edit || pop.querySelector('#vaf-pm-scan')) continue;
      const W1 = word();
      const item = rowOf(edit, pop);
      const mk = (id, label, fn, icon) => {
        const c = item.cloneNode(true);
        c.id = id;
        c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
        const lf = leafWithText(c, 'Profil bearbeiten');
        if (lf) lf.textContent = label;
        const svg = c.querySelector('svg');
        if (svg && icon) { const s = document.createElement('span'); s.innerHTML = icon; s.style.cssText = 'display:inline-flex;font-size:1em'; svg.replaceWith(s); }
        for (const a of [c, ...c.querySelectorAll('a')]) if (a.tagName === 'A') a.setAttribute('href', '#');
        c.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); document.body.click(); fn(); }, true);
        return c;
      };
      // „Fickliste“ vor dem Scan (wie im JOYclub-Skript)
      item.before(mk('vaf-pm-fick', 'Fickliste', () => goHash('fickliste'), fickIcon(1, 18)));
      item.before(mk('vaf-pm-scan', `${W1}-Scan`, () => openScanPopup(), oldManSvg(1)));
      item.after(mk('vaf-pm-conf', `${W1}-Schutz`, () => goHash('opa-schutz'), oldManPenSvg()));
      // Schalter vor „Unsichtbar“
      const inv = leafWithText(pop, 'Unsichtbar');
      if (inv) {
        const r = rowOf(inv, pop);
        const c = r.cloneNode(true);
        c.id = 'vaf-pm-toggle';
        const lf = leafWithText(c, 'Unsichtbar'); if (lf) lf.textContent = `${W1}-Schutz`;
        const swb = c.querySelector('button[role=switch]') || c.querySelector('.ant-switch');
        // Symbol: Opa/Oma im Kreis – aus als Umriss, an gefüllt mit Schrägstrich (statt des Augen-Symbols von „Unsichtbar“)
        const oldIcon = [...c.querySelectorAll('svg')].find((x) => !swb || !swb.contains(x));
        const ico = document.createElement('span'); ico.className = 'vaf-prot-ico'; ico.style.cssText = 'display:inline-flex;font-size:1.15em';
        if (oldIcon) oldIcon.replaceWith(ico);
        const paint = () => {
          const on = isOn();
          if (ico.dataset.on !== String(on)) { ico.innerHTML = protectSvg(on); ico.dataset.on = String(on); }
          if (swb) { swb.classList.toggle('ant-switch-checked', on); swb.setAttribute('aria-checked', on ? 'true' : 'false'); }
          c.title = on ? 'Automatik an: Seiten prüfen, Etappen blockieren' : 'Automatik aus';
        };
        paint();
        c.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setOn(!isOn()); paint(); }, true);
        r.before(c);
      }
    }
  }

  // =====================================================================================
  // Opa-Symbol in der Kopfleiste (→ Einstellungen) mit Zähler und gelbem Punkt für Gruppenanfragen
  // =====================================================================================
  const MAGNIFIER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="10" cy="10" r="6"/><line x1="15" y1="15" x2="21" y2="21" stroke-linecap="round"/></svg>';
  const ERASER_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.4 3.6a2 2 0 0 0-2.8 0L3.6 12.6a2 2 0 0 0 0 2.8l3 3a2 2 0 0 0 1.4.6H21v-2h-7l6.4-6.4a2 2 0 0 0 0-2.8zm-6.5 13-3-3L10 9.1l3 3z"/></svg>';
  function headerButton() {
    try {
      const inbox = document.querySelector('header a[href="/inbox"]');
      if (!inbox) return;
      const anchor = inbox.closest('.ant-badge') || inbox;
      let wrap = document.getElementById('vaf-header-btn');
      if (!wrap || !wrap.isConnected || wrap.nextElementSibling !== anchor || !wrap.querySelector('.vaf-hdr-dot') || !wrap.querySelector('.vaf-hdr-act') || wrap.dataset.oma !== String(Me.male())) {
        if (wrap) wrap.remove();
        wrap = document.createElement('span');
        wrap.id = 'vaf-header-btn'; wrap.dataset.oma = String(Me.male());
        wrap.className = 'ant-badge ant-theme';
        wrap.style.position = 'relative';
        wrap.innerHTML = `<a href="#" class="ant-btn ant-theme ant-btn-circle ant-btn-text ant-btn-color-default ant-btn-variant-text ant-btn-icon-only" tabindex="0"><span class="ant-btn-icon">${oldManSvg()}</span></a>` +
          '<sup data-show="true" class="ant-scroll-number ant-badge-count"><bdi></bdi></sup><span class="vaf-hdr-dot" style="display:none"></span><span class="vaf-hdr-act" style="display:none"></span>';
        anchor.parentElement.insertBefore(wrap, anchor);
        wrap.querySelector('a').addEventListener('click', (e) => {
          // Klick: immer zu den Einstellungen; läuft ein Scan, dort danach das „Scan läuft“-Fenster
          e.preventDefault();
          try { if (scanActive()) ssSet('vaf_open_scanprog', '1'); goHash('opa-schutz'); if (location.pathname === '/setting/profile') setTimeout(openPendingScanProgress, 600); } catch (err) { warn('Kopf-Symbol', err); }
        });
        wrap.querySelector('.vaf-hdr-dot').addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const p = G.get('pending', null);
          const g = p && p.groups && [...p.groups].sort((a, b) => b.n - a.n)[0];
          if (g) location.href = `/groups/${g.cms}/requests`;
        });
      }
      const n = G.get('blocked_count', null);
      const q = G.get('qcount', 0) || 0;
      const txt = n == null ? '' : n >= 100000 ? Math.round(n / 1000) + 'k' : n >= 10000 ? (n / 1000).toFixed(1).replace('.', ',') + 'k' : String(n);
      const sup = wrap.querySelector('sup');
      sup.style.display = txt ? '' : 'none';
      if (sup.querySelector('bdi').textContent !== txt) { sup.querySelector('bdi').textContent = txt; sup.classList.toggle('ant-badge-multiple-words', txt.length > 1); }
      const bs = (G.get('blk_state', null) || {}).st; const et = Etappe.running || bs === 'blockiert' ? ' · blockiert gerade' : bs === 'pause' ? ' · Blockieren pausiert' : bs === 'pause-fehler' ? ' · Blockieren pausiert (Fehler)' : '';
      // Aktivitäts-Badge: Lupe (Scan, Vorrang) oder Radierer (Warteliste wird abgearbeitet)
      const ss = G.get('scan_state', null);
      const scanning = !!(ss && ss.running && !ss.done);
      const blocking = Etappe.running || bs === 'blockiert';
      const act = wrap.querySelector('.vaf-hdr-act');
      let actTip = '';
      if (scanning) {
        act.style.display = ''; act.innerHTML = MAGNIFIER_SVG;
        actTip = `Scan läuft${ss.phase ? ': ' + ss.phase : ''}${ss.cur ? ' – ' + ss.cur : ''}`;
      } else if (blocking) {
        act.style.display = ''; act.innerHTML = ERASER_SVG;
        actTip = `Warteliste wird abgearbeitet${bs === 'blockiert' ? '' : bs === 'pause' ? ' (pausiert)' : ''} – ${fmtN(q)} offen`;
      } else act.style.display = 'none';
      const tip = actTip ? `${actTip} · Klick öffnet die Einstellungen`
        : `${word()}-Schutz${isOn() ? '' : ' (Automatik aus)'}${dry() ? ' – Testlauf' : ''}: ${n == null ? '?' : fmtN(n)} geblockt, ${fmtN(q)} in der Warteschlange${et} – Einstellungen öffnen`;
      const a = wrap.querySelector('a');
      if (a.title !== tip) { a.title = tip; a.setAttribute('aria-label', tip); }
      a.style.opacity = isOn() ? '' : '.5';
      const p = G.get('pending', null);
      const dot = wrap.querySelector('.vaf-hdr-dot');
      if (p && p.n > 0) {
        dot.style.display = '';
        dot.textContent = String(p.n);
        dot.title = p.groups.map((g) => `${g.name}: ${g.n} offene Anfrage${g.n === 1 ? '' : 'n'}`).join('\n');
      } else dot.style.display = 'none';
    } catch (e) { warn('Kopfleiste', e); }
  }
  // Offene Gruppenanfragen: höchstens alle 5 Minuten abfragen
  async function refreshPending(force = false) {
    const p = G.get('pending', null);
    if (!force && p && now() - p.at < 5 * 60000) return;
    if (!(await Lock.take('pending'))) return;
    try {
      const managed = await myGroups('managed');
      G.set('pending', { n: managed.reduce((s, g) => s + g.pending, 0), groups: managed.filter((g) => g.pending).map((g) => ({ cms: g.cms, name: g.name, n: g.pending })), at: now() });
      const names = { ...G.get('groupnames', {}) }; managed.forEach((g) => { names[g.cms] = g.name; }); G.set('groupnames', names);
      Bus.emit('pending');
    } catch (e) { warn('Gruppenanfragen', e); }
    finally { Lock.release('pending'); }
  }

  // =====================================================================================
  // Tampermonkey-Menü: Rekorder Export/Leeren – nur wenn der Rekorder läuft.
  // Ein-/Ausschalten bleibt auf der Einstellungsseite.
  // =====================================================================================
  let recMenuIds = [];
  function updateRecorderMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (typeof GM_unregisterMenuCommand === 'function') { for (const id of recMenuIds) { try { GM_unregisterMenuCommand(id); } catch {} } }
    recMenuIds = [];
    let on = false; try { on = !!S().expert.recorder; } catch {}
    if (!on) return;
    try {
      recMenuIds.push(GM_registerMenuCommand('API-Rekorder: Exportieren', async () => {
        try { download(`poppen-api-rekorder-${stamp()}.json`, JSON.stringify(await Recorder.export(), null, 2)); } catch (e) { warn('Rekorder-Export', e); }
      }));
      recMenuIds.push(GM_registerMenuCommand('API-Rekorder: Leeren', async () => {
        try { if (W.confirm('API-Rekorder wirklich leeren?')) await Recorder.clear(); } catch (e) { warn('Rekorder-Leeren', e); }
      }));
    } catch (e) { warn('Rekorder-Menü', e); }
  }

  // =====================================================================================
  // Gruppen-Beitrittsanfragen (/groups/<Nummer>/requests): prüfen, annehmen/ablehnen,
  // Aufgenommene sofort auf die Gruppen-Whitelist
  // =====================================================================================
  const reqCms = () => (/^\/groups\/(\d+)\/requests/.exec(location.pathname) || [])[1] || '';
  async function show(target, label, action = (x) => x.click()) {
    const el = typeof target === 'function' ? target() : target;
    if (!el) throw new Error(`„${label}“ nicht mehr auf der Seite`);
    action(el);
  }
  async function writeNote(item, text, overwrite = false) {
    const inp = item.querySelector('input.ant-input') || item.querySelector('input');
    if (!inp || (inp.value.trim() && !overwrite)) return false;
    inp.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, text);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    for (const type of ['keydown', 'keypress', 'keyup']) inp.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(200);
    inp.blur();
    await sleep(500);
    return true;
  }
  // Popup im alten Stil (Inhalte setzen md.innerHTML direkt)
  function openModal({ closable = true } = {}) {
    ensureStyle(); ensureGrpStyle();
    const ov = document.createElement('div');
    ov.className = 'vaf-ov';
    const md = document.createElement('div');
    md.className = 'vaf-md';
    ov.appendChild(md);
    document.body.appendChild(ov);
    const m = {
      ov, md, closable,
      close() { ov.remove(); document.removeEventListener('keydown', onKey, true); },
      buttons(list) {
        let box = md.querySelector('.vaf-btns');
        if (!box) { box = document.createElement('div'); box.className = 'vaf-btns'; md.appendChild(box); }
        box.innerHTML = '';
        for (const b of list) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'vaf-big' + (b.primary ? ' vaf-pri' : '') + (b.focus ? ' vaf-focus' : '');
          el.textContent = b.label;
          el.disabled = !!b.disabled;
          el.addEventListener('click', b.fn);
          if (b.focus) m.focusBtn = el;
          box.appendChild(el);
        }
      },
    };
    const onKey = (e) => {
      if (!ov.isConnected) return;
      if (e.key === 'Escape' && m.closable) { e.preventDefault(); m.close(); }
      if (e.key === 'Enter' && m.focusBtn && !m.focusBtn.disabled && document.activeElement && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); m.focusBtn.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && m.closable) m.close(); });
    return m;
  }
  function ensureGrpStyle() {
    if (document.getElementById('vaf-grp-style')) return;
    const st = document.createElement('style');
    st.id = 'vaf-grp-style';
    st.textContent = `
      .vaf-item{background:#2a2a2a;border-radius:14px;padding:14px;margin-bottom:12px}
      .vaf-top{display:flex;align-items:center;gap:12px}
      .vaf-av{width:52px;height:52px;border-radius:50%;object-fit:cover;flex:none;background:#3a3a3a}
      .vaf-who{flex:1;min-width:0}
      .vaf-who a{font-weight:600;color:#fff;text-decoration:none}
      .vaf-who a:hover{text-decoration:underline}
      .vaf-meta{color:#a6a6a6;font-size:13px}
      .vaf-sb{border:0;border-radius:8px;font-weight:600;font-size:13px;padding:5px 12px;cursor:pointer}
      .vaf-acc{background:#ffc21a;color:#141414}
      .vaf-rej{background:transparent;color:#e8e8e8;border:1px solid #4a4a4a;margin-left:6px}
      .vaf-reason{margin:10px 0 8px;padding:6px 10px;border-radius:8px;background:rgba(255,194,26,.12);color:#ffd35c;font-size:13px}
      .vaf-reason.vaf-fail{background:rgba(229,57,53,.15);color:#ff8a80}
      .vaf-det{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
      .vaf-ov .vaf-chip{background:#1f1f1f;border:1px solid #3a3a3a;border-radius:6px;padding:2px 8px;font-size:12.5px}
      .vaf-chip i{color:#a6a6a6;font-style:normal}
      .vaf-chip .vaf-na{color:#666}
      .vaf-th{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
      .vaf-th img{width:64px;height:64px;border-radius:8px;object-fit:cover;cursor:zoom-in;background:#3a3a3a}
      .vaf-th img:hover{outline:2px solid #ffc21a}
      .vaf-note{width:100%;background:#141414;border:1px solid #3a3a3a;border-radius:10px;padding:9px 12px;color:#e8e8e8;font-size:14px;box-sizing:border-box}`;
    document.head.appendChild(st);
  }
  const GROUP_REQ_RE = /^\/groups\/\d+\/requests\/?$/;
  const isGroupRequestsPage = () => GROUP_REQ_RE.test(location.pathname);
    const groupName = () => { const h = document.querySelector('main h1') || document.querySelector('h1'); return h ? h.textContent.trim() : ''; };

  // Einträge der Anfragenliste: jeder hat die Knöpfe "Akzeptieren" und "Ablehnen"
  function findRequestItems() {
    const out = [];
    for (const b of document.querySelectorAll('main button')) {
      if (norm(b.textContent) !== 'akzeptieren') continue;
      let root = b;
      for (let i = 0; i < 8 && root && root.tagName !== 'MAIN'; i++, root = root.parentElement) {
        if (root.querySelector('span.df-text-weight-semi-bold') && root.querySelector('input')) break;
      }
      if (!root || root.tagName === 'MAIN') continue;
      const nameEl = root.querySelector('span.df-text-weight-semi-bold');
      if (!nameEl) continue;
      const name = nameEl.textContent.trim();
      const descEl = root.querySelector('.ant-typography-secondary');
      const img = root.querySelector('img');
      const btns = [...root.querySelectorAll('button')];
      out.push({
        root, name, nameEl, descEl,
        desc: descEl ? descEl.textContent.trim() : '',
        avatar: img ? img.getAttribute('src') : '',
        online: (root.querySelector('.ant-badge-status-dot') || {}).className || '',
        accept: btns.find((x) => norm(x.textContent) === 'akzeptieren'),
        reject: btns.find((x) => norm(x.textContent) === 'ablehnen'),
        note: root.querySelector('input'),
      });
    }
    return out;
  }

  // Namen in der Anfragenliste zu Links machen (neuer Tab). Der ursprüngliche Text bleibt unangetastet
  // (React verwaltet ihn) und wird nur ausgeblendet; der Link daneben folgt ihm, wenn die Liste Einträge neu belegt.
  function linkifyRequestNames() {
    for (const it of findRequestItems()) {
      const span = it.nameEl;
      let a = span.nextElementSibling && span.nextElementSibling.classList.contains('vaf-name-link') ? span.nextElementSibling : null;
      if (!a) {
        a = document.createElement('a');
        a.className = span.className + ' vaf-name-link';
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.cssText = 'color:inherit;cursor:pointer';
        a.addEventListener('mouseenter', () => { a.style.textDecoration = 'underline'; });
        a.addEventListener('mouseleave', () => { a.style.textDecoration = 'none'; });
        span.after(a);
        span.style.display = 'none';
      }
      if (a.textContent !== it.name) { a.textContent = it.name; a.href = profileUrl(it.name); a.title = `Profil von ${it.name} in neuem Tab öffnen`; }
    }
  }

  // Alle Anfragen einsammeln (die Liste lädt beim Scrollen nach)
  async function collectRequests() {
    const all = new Map();
    const first = findRequestItems()[0];
    if (!first) return all;
    const sc = scroller(first.root);
    const startTop = sc.scrollTop;
    sc.scrollTop = 0;
    await sleep(400);
    let idle = 0;
    for (let i = 0; i < 500 && idle < 3; i++) {
      const before = all.size;
      for (const it of findRequestItems()) if (!all.has(it.name)) all.set(it.name, { name: it.name, desc: it.desc, avatar: it.avatar, online: it.online });
      const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5;
      idle = (all.size === before && atBottom) ? idle + 1 : 0;
      sc.scrollTop += Math.max(300, sc.clientHeight * 0.8);
      await sleep(atBottom ? 700 : 300);
    }
    sc.scrollTop = startTop;
    return all;
  }

  // Eintrag eines Namens finden – notfalls durch die Liste scrollen
  async function findRequestByName(name) {
    const hit = () => findRequestItems().find((x) => x.name === name);
    if (hit()) return hit();
    const first = findRequestItems()[0];
    if (!first) return null;
    const sc = scroller(first.root);
    sc.scrollTop = 0;
    await sleep(300);
    for (let i = 0; i < 200; i++) {
      if (hit()) return hit();
      const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5;
      if (atBottom) break;
      sc.scrollTop += Math.max(300, sc.clientHeight * 0.8);
      await sleep(250);
    }
    return hit() || null;
  }

  // Annehmen / Ablehnen auf der Originalseite; Erfolg = der Eintrag verschwindet
  async function decideRequest(name, accept) {
    const it = await findRequestByName(name);
    if (!it) return 'Fehlschlag: Anfrage nicht mehr in der Liste';
    if (dry()) return 'Test';
    await show(() => { const x = findRequestItems().find((y) => y.name === name); return x && (accept ? x.accept : x.reject); },
      `${accept ? 'Akzeptieren' : 'Ablehnen'} (${name})`, (x) => { x.__vafPass = true; x.click(); });   // am Knopf-Haken vorbei (Notiz schreibt der Aufrufer)
    // ggf. Rückfrage "Bist du sicher?" bestätigen
    await sleep(700);
    const ok = [...document.querySelectorAll('button')].find((b) => isVisible(b) && norm(b.textContent) === 'ok' && b.closest('.ant-modal, [role=dialog]'));
    if (ok) { ok.click(); await sleep(500); }
    const gone = await waitFor(() => !findRequestItems().some((x) => x.name === name), 6000);
    if (gone && accept) await whitelistAccepted(name, it.avatar, it.desc);
    return gone ? 'ok' : 'Fehlschlag: Eintrag blieb nach dem Klick in der Liste';
  }
  // Aufgenommene sofort auf die Gruppen-Whitelist (auch unsichtbare Mitglieder)
  async function whitelistAccepted(name, avatar, desc) {
    const cms = reqCms();
    if (!cms || S().managedWhitelist[cms] === false) return;
    let uid = uidFromAvatar(avatar);
    if (!uid) { const m = await Members.byNick(name); uid = m && m.uid; }
    if (!uid) return;
    await seen({ uid, nick: name, g: genderFromText(desc), ages: agesFromText(desc), avatar }, 'Gruppenanfrage');
    await Members.update(uid, (x) => { x.auto = x.auto || {}; x.auto.grp = x.auto.grp || {}; x.auto.grp[cms] = now(); });
  }

  const bigPhotoUrl = (src) => String(src).replace(/_\d+(?:_sq)?(?=\.jpe?g(?:$|\?))/i, '');
  const thumbUrl = (src) => bigPhotoUrl(src).replace(/(\.jpe?g)(?=$|\?)/i, '_350_sq$1');
  const realPhoto = (src) => !!src && /img-[a-z]\.poppen\.de\//i.test(src) && !/plcblur/i.test(src);

  // Sprachnamen für Anzeige/Regel-Editor
  const LANG_DE = { de: 'Deutsch', en: 'Englisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch', nl: 'Niederländisch', pl: 'Polnisch', tr: 'Türkisch', ru: 'Russisch', pt: 'Portugiesisch', ar: 'Arabisch', hu: 'Ungarisch', hr: 'Kroatisch', cs: 'Tschechisch', ro: 'Rumänisch', el: 'Griechisch' };

  // ---------- Popup "Beitrittsanfragen prüfen" ----------
  let groupRun = null;
  async function openGroupCheck(...a) { return Prio.run('Gruppenanfragen', () => openGroupCheck_(...a)); }
  async function openGroupCheck_() {
    if (groupRun) { if (groupRun.modal && !groupRun.modal.ov.isConnected) document.body.appendChild(groupRun.modal.ov); return; }
    const m = openModal();
    m.md.innerHTML = `<h2>Beitrittsanfragen prüfen</h2><div class="vaf-sub">Lese die offenen Anfragen …</div>`;
    m.buttons([{ label: 'Jetzt prüfen …', primary: true, focus: true, disabled: true, fn: () => {} }, { label: 'Schließen', fn: () => m.close() }]);
    const reqs = [...(await collectRequests()).values()];
    if (!m.ov.isConnected) return;
    m.md.querySelector('.vaf-sub').innerHTML =
      `<b style="color:#fff">${reqs.length}</b> offene Anfrage${reqs.length === 1 ? '' : 'n'} in „${esc(groupName())}“.<br>` +
      `Jede Anfrage wird über die gespeicherten Regeln dieser Gruppe geprüft (ohne Profilbesuch). ` +
      `Treffer werden angenommen oder abgelehnt, alles andere bleibt zur manuellen Prüfung.` +
      (dry() ? '<br><span style="color:#ffb300">Testmodus: Es wird nichts angeklickt.</span>' : '');
    m.buttons([
      { label: 'Jetzt prüfen …', primary: true, focus: true, disabled: !reqs.length, fn: async () => { const vis = await Vis.guard('Die Prüfung der Beitrittsanfragen'); if (vis) runGroupCheck(m, reqs, vis); } },
      { label: 'Schließen', fn: () => m.close() },
    ]);
  }

  async function runGroupCheck(m, reqs, vis) {
    const run = groupRun = { modal: m, stop: false, results: [] };
    m.closable = false;
    const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    const cnt = { accept: 0, reject: 0, manual: 0, fail: 0 };
    m.md.innerHTML = `<h2>Beitrittsanfragen prüfen</h2>
      <div class="vaf-warn">Bitte diese Seite nicht verlassen, solange die Prüfung läuft.</div>
      <div class="vaf-bar"><div></div></div><div class="vaf-cur"></div>
      <div class="vaf-stats"></div>`;
    const bar = m.md.querySelector('.vaf-bar>div'), cur = m.md.querySelector('.vaf-cur'), stats = m.md.querySelector('.vaf-stats');
    const showStats = () => {
      stats.innerHTML = `<span>Automatisch angenommen</span><b>${cnt.accept}</b><span>Automatisch abgelehnt</span><b>${cnt.reject}</b>` +
        `<span>Manuelle Prüfung nötig</span><b>${cnt.manual}</b><span>Fehlschlag</span><b>${cnt.fail}</b>`;
    };
    showStats();
    m.buttons([{ label: 'Abbrechen', focus: true, fn: () => { run.stop = true; cur.textContent = 'Breche nach dieser Anfrage ab …'; } }]);

    let i = 0;
    for (const r of reqs) {
      if (run.stop) break;
      i++;
      bar.style.width = `${Math.round((i - 1) / reqs.length * 100)}%`;
      cur.textContent = `${i}/${reqs.length}: ${r.name} – Profil wird geprüft …`;
      const res = { ...r, meta: '', photos: [], verdict: 'manual', reason: '' };
      try {
        const cms = reqCms();
        const pr = await grProbe(r.name, { photos: grUsesField(cms, 'photos') ? 50 : GR_MANUAL_PHOTOS }).catch(() => ({ error: 'nicht lesbar' }));
        res.photos = (pr.photos || []).slice(0, GR_MANUAL_PHOTOS); if (pr.avatar) res.avatar = pr.avatar;   // Anzeige: Avatar + bis zu 5 weitere
        if (!pr.trait) { res.reason = pr.error || 'keine Angaben'; }
        else {
          await grEnrich(cms, pr).catch(() => {});
          const ctx = pr;
          res.meta = await grMetaLine(cms, ctx).catch(() => '');
          const prev = GrDone.find(cms, uidFromAvatar(r.avatar), r.name);   // schon bearbeitet → wie in der Liste
          const d = prev ? { verdict: prev.verdict, reason: prev.reason || '' } : grDecide(cms, ctx);
          res.verdict = d.verdict; res.reason = d.reason;
          if (d.verdict === 'accept' || d.verdict === 'reject') {
            cur.textContent = `${i}/${reqs.length}: ${r.name} – ${d.verdict === 'accept' ? 'annehmen' : 'ablehnen'} …`;
            const pageIt = findRequestItems().find((y) => y.name === r.name);
            await grWriteDecisionNote(cms, r.name, d.verdict, d.reason, pageIt && pageIt.note ? pageIt.note.value : (r.note || '')).catch(() => {});   // Notiz VOR der Entscheidung
            const out = await decideRequest(r.name, d.verdict === 'accept');
            if (out === 'ok') GrDone.put(cms, { uid: pr.uid || uidFromAvatar(r.avatar), nick: r.name, avatar: r.avatar, verdict: d.verdict, reason: d.reason, by: 'auto' });
            if (out !== 'ok' && out !== 'Test') { res.verdict = 'fail'; res.reason = out.replace(/^Fehlschlag: /, ''); }
          }
        }
      } catch (e) { res.verdict = 'fail'; res.reason = e.message || String(e); }
      cnt[res.verdict]++;
      run.results.push(res);
      showStats();
      console.log('[Beitrittsanfragen]', res.name, res.verdict, res.reason, res.fields);
      if (i < reqs.length && !run.stop) await sleep(rand(1500, 3000));
    }
    bar.style.width = '100%';
    window.removeEventListener('beforeunload', guard);
    Vis.restore(vis);
    groupRun = null;
    m.closable = true;
    m.md.querySelector('.vaf-warn').remove();
    cur.textContent = run.stop ? 'Abgebrochen.' : (dry() ? 'Fertig (Testmodus – nichts angeklickt).' : 'Fertig.');
    const open = run.results.filter((x) => x.verdict === 'manual' || x.verdict === 'fail');
    m.buttons([
      ...(open.length ? [{ label: 'Manuell prüfen', primary: true, focus: true, fn: () => { m.close(); openManualReview(open); } }] : []),
      { label: 'Schließen', focus: !open.length, fn: () => m.close() },
    ]);
  }


  // ---------- Popup "Manuell prüfen" ----------
  function openManualReview(list) {
    const m = openModal();
    const prev = document.createElement('img');
    prev.className = 'vaf-prev';
    m.ov.appendChild(prev);
    m.md.innerHTML = `<h2>Beitrittsanfragen prüfen – manuell</h2><div class="vaf-sub"></div><div class="vaf-list"></div>`;
    const sub = m.md.querySelector('.vaf-sub'), box = m.md.querySelector('.vaf-list');
    const refresh = () => {
      const n = box.children.length;
      sub.textContent = n ? `${n} Anfrage${n === 1 ? '' : 'n'} konnte${n === 1 ? '' : 'n'} nicht automatisch entschieden werden.` : 'Alles erledigt.';
      if (!n) setTimeout(() => m.close(), 800);
    };
    for (const r of list) {
      const el = document.createElement('div');
      el.className = 'vaf-item';
      const dot = /success/.test(r.online) ? '#52c41a' : /error/.test(r.online) ? '#e53935' : '';
      const chips = r.meta ? `<span class="vaf-chip">${esc(r.meta)}</span>` : '';
      el.innerHTML = `
        <div class="vaf-top">
          <img class="vaf-av" alt="" src="${esc(r.avatar || '')}">
          <div class="vaf-who"><a href="${esc(profileUrl(r.name))}" target="_blank" rel="noopener">${esc(r.name)}</a>${dot ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dot};margin-left:4px;vertical-align:middle"></span>` : ''}
            <div class="vaf-meta">${esc(r.desc)}</div></div>
          <div><button type="button" class="vaf-sb vaf-acc">Akzeptieren</button><button type="button" class="vaf-sb vaf-rej">Ablehnen</button></div>
        </div>
        <div class="vaf-reason${r.verdict === 'fail' ? ' vaf-fail' : ''}">${r.verdict === 'fail' ? 'Fehlschlag' : 'Manuelle Prüfung'}: ${esc(r.reason || '')}</div>
        ${r.meta ? `<div class="vaf-det">${chips}</div>` : ''}
        ${r.photos.length ? `<div class="vaf-th">${r.photos.map((p) => `<img alt="" src="${esc(thumbUrl(p))}" data-big="${esc(p)}">`).join('')}</div>` : ''}
        <input class="vaf-note" type="text" placeholder="Notiz für dich hinzufügen (optional)">`;
      // Profilbild-Klick öffnet ebenfalls das Profil
      el.querySelector('.vaf-av').addEventListener('click', () => window.open(profileUrl(r.name), '_blank', 'noopener'));
      el.querySelector('.vaf-av').style.cursor = 'pointer';
      // Großansicht beim Darüberfahren
      for (const im of el.querySelectorAll('.vaf-th img')) {
        im.addEventListener('mouseenter', () => { prev.src = im.dataset.big; prev.style.display = 'block'; });
        im.addEventListener('mouseleave', () => { prev.style.display = 'none'; });
        im.addEventListener('error', () => { im.src = im.dataset.big; });
      }
      // Notiz in das Notizfeld der Originalseite übernehmen
      const note = el.querySelector('.vaf-note');
      note.addEventListener('change', async () => {
        const it = await findRequestByName(r.name);
        if (it && it.note) await writeNote(it.root, note.value, true);
      });
      const act = async (accept) => {
        for (const b of el.querySelectorAll('button')) b.disabled = true;
        const it = await findRequestByName(r.name);
        if (it) await gaManualDecision(reqCms(), it, accept).catch((e) => warn('Notiz vor Entscheidung', e));   // Notiz zuerst, dann merken
        const out = await decideRequest(r.name, accept);
        if (out === 'ok' || out === 'Test') { el.remove(); refresh(); }
        else {
          el.querySelector('.vaf-reason').className = 'vaf-reason vaf-fail';
          el.querySelector('.vaf-reason').textContent = out;
          for (const b of el.querySelectorAll('button')) b.disabled = false;
        }
      };
      el.querySelector('.vaf-acc').addEventListener('click', () => act(true));
      el.querySelector('.vaf-rej').addEventListener('click', () => act(false));
      box.appendChild(el);
    }
    refresh();
    m.buttons([{ label: 'Schließen', focus: true, fn: () => m.close() }]);
  }

  // ---------- Knopf im Kasten "Mehrere Anfragen verwalten" ----------
  function ensureGroupButton() {
    if (!isGroupRequestsPage() || !grRules()[reqCms()]) return;
    if (document.getElementById('vaf-group-btn')) return;
    const h = [...document.querySelectorAll('main h3, main h2')].find((x) => /Mehrere Anfragen verwalten/i.test(x.textContent));
    if (!h) return;
    // Kasten = nächster Vorfahr, der auch das Formular enthält
    let boxEl = h.parentElement;
    for (let i = 0; i < 5 && boxEl && !boxEl.querySelector('form'); i++) boxEl = boxEl.parentElement;
    if (!boxEl) return;
    const wrap = document.createElement('div');
    wrap.id = 'vaf-group-btn';
    wrap.className = 'ant-form-item-control-input';
    wrap.style.marginBottom = '12px';
    wrap.innerHTML = '<div class="ant-form-item-control-input-content"><button type="button" class="ant-btn ant-theme ant-btn-primary ant-btn-color-primary ant-btn-variant-solid" style="width:100%"><span>Automatische Annahme/Ablehnung</span></button></div>';
    wrap.querySelector('button').addEventListener('click', () => openGroupCheck().catch((e) => console.error('[Beitrittsanfragen]', e)));
    boxEl.insertBefore(wrap, boxEl.firstChild);
  }

  function initGroupRequests() {
    const tick = () => { if (isGroupRequestsPage()) { try { linkifyRequestNames(); ensureGroupButton(); } catch (e) { console.log('[Beitrittsanfragen]', e); } } };
    tick();
    if (!window.__vafGroupTimer) window.__vafGroupTimer = setInterval(tick, 1000);
  }

  // =====================================================================================
  // Favicons der Plattformen (einmalig über den Google-Favicon-Dienst bezogen, fest eingebaut).
  // Die Symbole gehören den jeweiligen Markeninhabern. Eronity: kein Favicon verfügbar → Kürzel.
  // =====================================================================================
  const PF_FAVICONS = {
    joyclub: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABEUlEQVQ4jZWOv2rCYBRHzw0h6FARCkK/IVRcxc3FZ/AdnMzg4OLb6OQ7+AxZBAdxFSuCBaEgdkj9EnM7hJZatPS78OPA/ccRjSIljnGuTgcZj8UnjqHfd38wmQDgYS2cz0WGw2v+1bcWAMnrdZVez1lAp1O8zUZIw1BVVXU0cmIahgogiTFa6nadDT5mM8r7vZAYU3yOIicmxhQG77WaBkHgbGCt5eFwEO9yuXw3g93uXwT4upO3alUrlYqzwel04vF4FC/LMnzfv852e5s/kmVZYbAvl/Wp0XA2eF2vMUkifp7nUCrd3prPod2+OcrzHAA/TdO7SwwGd2fpYgGAaKulL6uVmz/w3Gwiy6U4H/6uTxDi2OxBMhgHAAAAAElFTkSuQmCC',
    poppen: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEd0lEQVRYhb2Xa2xUZRCGnzlnW7rUphcK2ysqCCgRCXc1GIRYQmJMJbElRqJBSimXxPBHiQEpGKMkAmJSoKVIQmIIbQyGajCAFrkEFGiMCLUEbcRettCyvQC9bPeMP4Cy2+3ZHgg4/843M+/7zjnfzPk+4UGssNDweD3JURoTD9Abra3eLxc1I6L3CyVOAzOW7h7jJ7BAIEvRSUBcv5A2kCpED9HLvqbSJbUPRUDqsp1T1GKDCvNQDId6AyAVqPlRU8mi8w8kIGPVZre/M+4zlBWA6ZC4P3qvoJuTUhLWXizM7XEsIDm/ONUlxgGFqQ9EHEYiJwwNzG8oWdo8qIDk/OJUU+RnkDEPgzzIzptqzekvIuSbZqwqc7swKh4BOcAES8z943PKom0F+G+1bVRhyiMgB0DRmS1J7YXBa32fIGVJyTQ15HR/UY/A/GLpJO/O/AuEkLmMDf8DOUAUhhTefRCAtGW7xgUsq5oIbTnaE8/cCSOJHeLiXO01jlbXoUFzLy0xljdmPIU72kVV7VV+/KMOS20HY8A0zScbtr37rwvAUuvNSOQr5j7Hh69PxTTuvaDKi3UsLj7Cre5enhgex8HV2STGxvT5T11q5O3th+noHLD9TcsK5AKbDACFLDvyWc+ks2b+9BBygNnjM/g453kAMofFhZADvDA2tc9vY1kABjllJspEu6iFM59GbN7NghfHMiLezYmaBuqu3wjzz58+mqHRrgFzVW93m5Hp6fAAsXYCRiY/ZluCyzCYkJmMKtRebQ/zD3GZpCQMtUsfNiq/ON7w+yXBlgG4fqPb1qcKDb7blacnhtegqvhu2uZLV0xM/KBtd7ymwda38cBZqut9zJv4OKM88WH+C3XXIwkAwIiK0tZIAftOXbLbybR39vD+a5PZkTd7QH/pTxciQetQNVuFnDLTk9TWRoR98NbMcWxa+FIksDA7/mc9C7b+YD8LRK417cgbYVCeG0D4LRLY1ydq2FUZsZoQu+xtpaC0MtIgQtAquDN6xeLwYKBry06z51i1I/LcrQdpudEVMU7UONQnwIzSvUDEA6Wlygd7T7L5+yrsCjv791WyN31Hg+9mZJVCr5hd5XDnqNVxpqIlblr2DGDQc8DJS41caW5nzrOZuMx7TbT/zF/klRyhvdM/GAQifNO4vWAXBP39RHQtEBg0Gyj/5TLZn1dwpbkDf8CisPw0y7+qpLPHUbpfDNb18QZ7PAWlX6D6nhMUgDh3NGkJsdQ0+pymgPBJ044la+4+hgwid4q5WoQzTrE6Onvui1yQYxmWtT50rZ8NX747xbR6j6oyzjGyI3b53WV2zakvWtkSvBw2iq9tW+QNGD0vI/z68LjlmMuMCiMfUMBtESu87i7XLES24HBj2pgf9NN0K/BKfdE7YeTg4GqWVlA6KaCsB33VTvAAFhCRbzGtdd6i/Igj1PHldER+8WgRMxfIAmsySNDvT1REWxXOiXBIDClrLMr7xwmuYwEhpirpK/ck+Q1NoLub6FjTV7dlsQ/u/3r+HzWCm+ylyNaoAAAAAElFTkSuQmCC',
    xhamster: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAflBMVEVHcEz////////////////////////9/f3///////////////////////////////8BAQEwMDAaGhoSEhIjIyPs7OwtLS1KSkq/v7/19fWMjIzh4eGCgoIpKSnIyMikpKRzc3PX19esrKxdXV03NzeZmZnQ0NC3t7cA2DtHcEwRgJGfAAAAKnRSTlMAzyizYnve/DoRgKfBib7//////////////////////////////////wBsgjnhAAACEElEQVQ4jY1TiY6jMAylZzqdw84FJOQAEpj//8O1aTutVrPSWlVN7Bcfz07T/JfsD+f3t1fD2+F8uDyPR/j2CV4MF0j+G44/cAhocIG35nI8XY8XMixkCPAIehrQmBaTADGs00AqYWsMDqc74DCjdTXWueAmZZZROovz4Q74yAiQVKs6369r7zv6TACYP+6A928cwGppZthkNlJbGLB/fzRB0SAbKfXE/klLaTJQ3uNPF3XMFEAZZQEsKQqRx/rTRQOdIVNIXncAnfYpENx08GBFDEpK1dtZBEwJg5htz5ZJXG6sZZSy7RwqGVTOKlSFrmulxLyxS6xpRYCV/qLqexVbqVYCKE3sbjQWmJSMhe60LUDLukTKAIXJ3Hl0MFBnUVJQ6nOihJJAegCHfteIQpVzTSQmMA/BbAfVU0dFNFDKHdDG6BngI1VxA5Cv2S2UwnEfxvpbimAN98DmZcdFLgCj4Ruiw45+giPGEag/njiMaHlUmsP33vesNY/L4shkXh0TnHWFOTkxTMKlGarOTLq7MpXnREiKAz0qXatW2MPNks73YWY+Bwd1gWmCpYIL7M+Pce6pmsKZLfJGUUkkhWrfP7d8xsrLYmkrC/unSjv08g72YopIOe5iA8bpeX+TnfCIYyKMSyOiF7u/X9+R7unb2mtvn6/qRa4C1ux9XkGcfnFvxX5+nc9fn5d/uH+XP5IMOpRrzmiWAAAAAElFTkSuQmCC',
    spicymatch: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAPFBMVEWNKJpxGnxgEGt4HYRpFXT///+FJJNMBldWCWGLJ5h/IYxpAXawlLZ5CoeHT5DGssrv6vDWyNl0PH2Zcp8S7yOlAAAAAXRSTlPk54H+BwAAAUlJREFUOI2FkoGSgyAMRFHA5AgB1P//10sCotPp1GUE2X3GNuLc30+5l1yIV2B70QBS+QwuZwCl8bYxs0XMaeOzcQeSinPMxLlm9olLroVTi2zRBGJrUVSo6rLLnh5A8urGJn62WVSvCt5U1GPS7LAiO5mfXM89kxb1SRM+Z+79BXgyUx5Oy3LImyawDEkkZvCV5D5Gf/kTWBYBcglElSgq9glQPinvRCUi7TMXIFwifU2BFjHc5uJ0CsPpTRIg3K6bbFgD5Qcw5MS3gUdBROlAW9dwj+DWLtAeVsQjg3DrrQFgiXuWr6XxGTN+AzKAthhx2WPBB4A25N8dpUDVInI4EIe/OhzS/u8AxU5FuFxUYLU7OCTS9ay5R/2aFUB7UOU3AgA+JIDtQQI5jGA7m6GvDiyzC2zFx2RAtycx4PmAewRf5V5yeKuA/ymzHEVOrf18AAAAAElFTkSuQmCC',
    kaufmich: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACwElEQVRYhbWXQW7bMBBFH4PunW6yIuDkBM2ieycHKOoCXRaIeYKqJ3BygiQnkLztJgp6gMonqHOC2oAOYO+6YxccWQxFKXJif8CwSY40n8PPmbGy1nJolMocA9fAd5ky2qYZwLuI8SlwCqy1TRd7cl4AH7zpBGgSEOcLYCDjFTDRNi08m3PgGDiXqQWAbxMgC5zjj8MIjCvngiHwu1TmRhx+bnFCqQzAHMiBTNt0XSozaXlmXv04ChaOW94/7XLuYQTcAstSmWtc6J8idss2AvvCAEe6AO6ATbCeHZpAhaEQWHpzc18vIYGC/WNALboNMPEXVZgHSmUOmRi+aJvm/sT2FpTKjHEifKSf4F6DBHdLtvCPYELzvPaNUanMRRuBc9x5jQ9IAAIN+ASGwfchMMPVhCiBQ8PId+ZPNopRT2xwV3aBK1wXdEdujtPWFXDjLxwFRn0x1jattFIIAUMz41XI5HMPZKUySYzAegcCuXdtE1zxyYRIjMRa2/SUOmq3MQLFDgQGwAPwDyeqMYD0D9cR+7FcvweeV9s6E0ov8HcHEhU2uF0V1AKLvecT8KsaaJsq8CKgbbokXjpfwgBXhqe4o1i22H2k1tnWT3gN715BwMdSOqYYEuBnZRclIEJavYFAgRNiDAPgRN5fRAkIkshcHzzJBrqenwLf6GpIpFzOXkFgIm3YS6n8q7bp9sq3peKE3QRpcHlkKuMVrqyHmFF30+0EhOFFTxIzCb1fRYdC6BKXen8AZ7jQj3yhthajniRW1GcedtRXuKSUa5ve4cpwHtp2VkOPxH2LSeadZ+xf1Aj4I1lwimTBrqY0SkLbNMGFM7yihWeXE1Q6wUwcVsJ+tpne/YC2aSEF5RInsA3N9i0H3mubKkm1Z7jkVEXpTDazRaMrfgtKZXK6G9pGV7zXjkh6hBuaR/UIXIbOAf4DpT32sZ3VgREAAAAASUVORK5CYII=',
    fetish: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFuElEQVRYhcWXbYxcZRXHf+feO/fu3Zkt2y6lS7vFpiWbIltTWlllqVjaoKnFjKwyUaMomvAFTQ3V2MQ1Qi2mJtKokPjFCPEDLRNZmJT9UNuuWFsbAvR1I1C32haXUsrotjM79965L48fZnY6b+wsDYTz6d7nOef8/+c8L+c8wiwlTfoa27Q3RhKtE5GVKlJLEDoBUEyKJmeUUsc0pY06RWckRerSbPxKK4Vha7jXUMYWJeqrgD1Lvo4o2RVIsH3QGzx1VQTSpG3LsrYB3wdiswSuFx943PO8oRQpZ9YEMlbmRkGeU6i+qwSuA5Exhbon6SXHWxLIxDK3iCZ7FGr+BwFeReKiitTnk37y6HsSKEf+9w8avIYEaqA6E9r0R5q0XU77hwIOoFDzBXkuTbqymY3pD8uytjVbc+nw0fuzaNe5qEmT4OUu1LtWU4DYhreIDZ5DdAjHE/i7ewhPdtaT6LMsaxsem6G8BMPWcK+OPkbVbpfOIvbWE5j3/RtpC694CIXi8z0UNq9CvV0KRFuaw37kJOZXztUuqoLi8GIK37sV9T+zmocfEvYNeoOnDIDyOa+Aaz0FEntG0Zflm+WxJPkY6Ar7l0exHhhHzKhRV8D88ptovTny69ejLlcgYoYytgDfkTTpayzLOs/0JaMrOg7sxVj930bsvEFuw52EL3dBW0jbQ69h/3Ss6WFWWZNipgf/L92o821oiwsUdy6pVnE8z7vesE17Y0RU2RTmvWcbwSMhODif/NduR2UtjDveof23r6Avv9wIPGky9eAnCfZ3oyZN0BVtQyext/yD8FQH4atd06q2bdobjUiiddUOzHvPNTgtpm9g6tu3lay2HqftR681RF3cvQj34RWoyzGiN+MAaEvyxP94GKM/C0Bs/YVqAkQSrTNEZKVSqjKoVUcVCO6vl+NsXYHWe5n2XxwndvdEbcSehveHZTibV0FUZmWFxNZdIP77l5Au74rvRYUaWxFZaZSrWtVohR75L30Wf183Mt8l8cxB9JtqU+4+thz30T5UoXKaMe8/TfzxV8BQ1IuaMmr/I7XEqJTUadzX56AvzeM+0Yu/rxujP0si81dkbrHG2HtqKc7QytKpEEXbpjewfvA62gL3PUtceGRe7YDQadQrFZ9dTHShDednnyiBv/AiMsevzAeHrsXZ1kdwYAGoUlrjTx/C+FS2MeKcgT+yiOLOjxH+s4PobKJBRzJm5l2ErvoJvW+Sjr2jNZGH/0qQ/8JaojMlR8ZtF4nvPITW7dbYRhM2zsMrCPZdT3R+hhZCkTXKnUwtASMi/szBK+AKnJ+vwN2xHFwd43PniX3mHaxNb9ReQIHg/q4Xd2sfKte6hRBNzhhKqWPA6pqZQGPqmwMknv0bMsdn6lufxn+hB+ks0v7kYcx7/lMfCcGReRQevJXw2NyWwBUzpY4ZmtJGI4m+Wz8ZHplHbs1dSE+B8KVrwYzoOLAXvTdXoxdN2OQH7yAc64SwtPu0hQViX5yg+KcbUNnmhQtAU9qo4RSdEcuyHJr0e9FEO0y0Q3tA4ulDteBRqSi52z9OeGIussDF/skYEg8w1lwkn1ozIzjgOEVnREuRuiRKds2Yq4JBcPA6KC939JZNbsNapr5+O9qNOTr276fzdAbrgXH0my+Ru3M94fGZl0KU7EqRumQABBJs19G/wQzNp/urm4jOxrEfOUHxz91oiwskdr9I7K63Kzr+yEKm7htouHCaiB9IsB2qroyMlXkMeKiVpXn/adp/82pD+XWf6MX58S2VfdBCdiS95Gaoask8zxsSZKyVZfHJZeQ3riXKlhuMQChsWo3zw1WzAhdkzPO8oSv/VfJ+mlJtaZ74U4dxH70Zf8/ClsBl8Iam9CNvy7V6xaSfPKpQA7NZjvcBPqZQA/XgTQkAJL3kuOu5/cAOSs+rqxUf2OF6bn+zV1GJXAv5yB6n9fJhPc//D03FgIqlrjuNAAAAAElFTkSuQmCC',
    gays: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACWUlEQVRYhdWXS2tTQRSAv7lJNY9atUlq2hqFLgQfVaIUKjXW+kBB7cLHSnClRTeuXfkT1JWP6MpVVhpQUUqDSMGNohVBEWNDHq2hbTRNE03TJteF9TYlEe692lxzVmdm7jnnmzkzc+YKk//akZKMH1n2UEsRIi4JBiRDggPIsqck45cMCV4GIRkWfEHMeoxMQuBrbWd7s4uiXGIkNcmL5DhyLQD2uNu56dvP1mbnkv6XE0kuDod4PTWhyZ+mFGxZ62Dw6ImK4ABdLW6Gjp3E07hq+QDu9R3GYl5ctFcTSUbKZrxmpYW7vYc0AahOgctiZadrndI+NfiQ+5EwAOc3d3J770EA+to8rJBMFEpFVX5Vr4DX2aLo8eyMEhzgzod35ObmADBLEp2OyhT9NUCrza7oU/kfFeNfZ/OK7rbaVAPoOobVpCcYwCz9mk/ye672AIlcVpddfd6Ev8VhsbChsami/3MmTaZQWH6A0x2buOE7UNF//EmQx7GIKh/1nYJP02kC4Y8A9G/swNbQUFuA0FiM0FgMgOiZc7oADE9BfQIIIwBi2RlFd5fVBQBJCFwWa9Vv/xnAm7K677bZubTNq7Sv7OpW3gmzxXnef0upBlB9CtKFWZ6PJ+htWw/A9Z59XPZ2YRYSTuvi7B9FIxRl9a9DTXvg7LOnpMvLrs2+JPiXXJYLw0NaXGoDiGdn6H4QYCgRrRgLRsLsDgZI5fNVLP8sQty6quc1TUfTanY4XMyXSrxNTWraeOWi+yYczUwzmpnWa67If3ARCRE3LLoQcUkSDBgCsfB7/hOW1bjQgjQfQgAAAABJRU5ErkJggg==',
    telegram: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEj0lEQVRYhbWXT0xUVxTGf/e9N8MMU8A//HdsQUHEqpuqwaaaYGtq0xqTJmrcWOyicdGoiUlXjV26auLCtK6UuhFt0qQ7TaukxkRFNy0qAQcadITCiBRmGIbhvXe6eDMD6ryZociX3M28eef7zn3n3Hs+RQHY8PMLA2gEPgRagU1ADVCc+kscGAa6gU7gOvD40f4VZr7YKjfxmA5sAY4AHwNBwMgT0wTCwDXgAnD/0f6V1oIFNF95XqvgBKg2oCIPqRsiIO0CZ3oOlA8VLKD5yvOtwPfAB7lEFggBbgEnew6U38sroPlypBXFOWDdIolfRR/C0Z6DFZ2uApovj24DdRFoesPkafSCHO45WNn1moDmy6O1wCVg5xKRp3ETONRzsHIIQANY3zGiichxEdkpIizx2ikix9d3jGgZAcA2oO1NpCeAJYJpO4QuaEtxotZfGtZBnQWOLobYBkQg4FE0lhkEAzr3Ikki07ZbG50D+doAmkD2/B9SAWwBTUEwoLOjpojdQR+bVhiUeDVOdU3SEYpjaFlf3wM0GQK7cE64wolFsAWKDcWGFR72rPbRuspHMKCjqTlxs7YAgmTfgyCwy0CklfzHK6SyBVjp09heXcRn7/jYUuGl1Kthy8s9nbSE0WkrrThbOANoNUA25sw2RawrqC81+Cjo45O3/TQtM/Ck0h2MmvwWTrC3zk+VXwdgykwLcC1EgI0GQk12YsES8BuKd5d7+bTOz65VPmoDeibTpCVcezpNRyjO5/XFVPj0zPvjMzbjCQuFgLie5jWGIIFsT0o8zjbvrfPTUlVEqfflSnoSMzn3IMrtkRmOby5lX10xah7PSNwiOut0gLjvQsB49fsITtbfbiljb10x+ivik7bw+9NpznZHmUzanNq6jN2r/a+VWThmMmPabsQZGMAUUJL+QQGzlkPiUbC53EuVX8ejKZ7ETM73RPllYIpyn87p7cvZUePLGngwamKKYKicl+mUATI8XwCAacPVwTjXw3Gq/DpryzyUeDQevkgyMGmy+i2d0y3LaanOTm4JDEZnnerPfZkPGyLygCxXr6bAsuFZzORpzMzsDsCmlV7eqyxyjRqbtQnHTOf7ux/HAA80nBnOdXZTymlBXTmiNIRbQ9Oc/WuCsUT2SWssYRGJm04HuMMEOjVEbiASRoRClkpl+GP3BMduRrg7ksgcUGk8i5lMJFMF6B4rjMgNDUUvyFWn/gtbCkEQ7vyT4NgfEX7o/pfxmbmKD03MkjDtfHGuouhVAA0X/25B+BWozLVn2SAISiner/bx1cYyqosNvrs7xu3haTT3DhhFsS90uP6OAaCgS5B24JuFClAA4tTFn89nCBiKSMJKXUquNdCuUF2Z9wEafhqoBVnUSCbiUGq5W+8mqEOhL9YMvSQAoKG9fxuwxEMph0Nta18fStNY2x5qhSUay+Fof1uD+1g+T8RWRN6sMVHqZH9bQ35jkhFx4XEtcAJngFyENaMdONN/pLFwazYnom/OnMoCzalKm1N1v/9I48LN6XysOd83z55LHnuuOoHrCh73f7kurz3/D7m0PchUhAS/AAAAAElFTkSuQmCC',
    whatsapp: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABcAAAAXCAMAAADX9CSSAAAAYFBMVEX///8l02b8//0713U21nKE5qm+8tJV3Yj4/vri+eov1W1D2Xvw/PXo++9q4ZZ35KDY9+TS9uCu78Z/5aWz8MpL2oFj35Hr+/HE89WN6K/L9dun7cKS6bOZ6rdz45248c6vq6y0AAABAElEQVQokWVSWZbEIAik1Lhmt7N1pyf3v+WgWecNHwkWUAUi0W7tYqSXZmnpaW+D08buQm0EZKGddbqQQCEOeIDvD5/Ex8Pshxrqydp5xPR/AUxp75AG3lwYsHKSkuIKRJgUlZYEy/UXXnq0HFy4e24w3BINvjQkMsf4z41vGEnBsRcQbn4uDwSU7K3I4cMmePI7YBCqR75k/jm5TkF2og4fmycwez8ph1sdWF5NlDENtStOdb5PPpWKe+R5vwftzBGliQoMlL7xnrTj2hlZcoD+syPt0aQUeOu211XRAMbmmb1iObNVJJyO6txXTFfWjP/2OzZ9GrT61oHfw3qu5xftDQn2WS5NigAAAABJRU5ErkJggg==',
    threema: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADAklEQVRYhZ1X7ZHjIAx98m0flxRyY7yVpJI1bCPpJMJbyW0j1v0Ag/hysseMEyMEekjiCQMARMSKCMuLbX+tcz5PxIIA7MH4j9q5mSczy8mWREQQmwAgAUBa0LzCswcAuE8HYwwAYJ7n9D5qeo1jKdSo9t72oswYIwCEwlr5oSyz1lZu2qv/suEFpwkzlwbPnggmARngOLoox/diwi4i1trhbsNDQzDWlSAap2QAGl4eDcbHBmpgPVn2xN4NQpGEdcJMRL0hAARjdNIRnF0heTgsEF+YeZyg3aCLiLO2vytAXNzVg1mYWWRvQ6XDZIxpwxB7DYAjF3qGj0VzeEKfmas5VACgpNOimFrnAuy3vrfUu/c+HWrnXAyLSZptXCVLVWQbAADwtSkARA17yEEp3ewpbVD82bavJC2m9fzSHD11EoYtTkcndACJWUxPPYRANGYBvN+qXQcNsxjdVTsRSMz8RWU76T1X3jqWn6CVIAAhxFIaz+dFqFwEoORqqdSPvjGmG7EpK+fl5vlPkGkENZqT+GtdTSU9VpnKQSpVDzKJ7tVF8thtl8a0bhxf148u/syERa0UvC/v4M1neZxhrcU8z8VCpF6WZWnwGLOA+dFBipDWPY7WFZAocv2A7xtZxYQFCVVtwIShhfpPT409r4jjO1QBYK8Q1Aabi8iTZ1wDsnDILC0ZPX8InZtR325qb03+FcljAADrumKL9GytLZJSv0ucs65rVX4zdQuV9863NA4UKOZ5xse6JpGpGE4QC1IUrB9ro5d3lplLd4HjGFYuGHlkJB+1oH8+ayoPcgLaWepF41LrtxSquWtK/C3j5b3f8OlcA8h7H+8CqlHQd841deFQKIryOEfDPzMnEgrHas+35XhD1qVWX2T1MRzZae4D9Z0tMyIJKKs/qm+FozE/uvLRMfxlrTUALv2IES6XC4gI3ntYa1OWX6McAG63Wyq333+/cb1eAQLu9zt+Xy5NFpRXDRG7V+h+8ME7UDqZVH2cBn74jy/k58ZOkXMwDvwDUCDuAtixfl0AAAAASUVORK5CYII=',
    signal: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEIklEQVRYhbWXQW7bRhSGvzckjQDqgj5B2BNU2blmgzJoKQjdRD1BlBPEOYHlE1g9gZQbyDsHMhAFiJLurJzA7AmiRe2FqJnXBUmFlpXaSeR/RbzhzPvnzXvz/hG+EnFqByBN0AgIS/N8OvZ2AfbTZXen4Y0mI5nfZT1z2w97bY0et+xxzdQFbdacU/8WZJBfuk9xagdJW6NvJpB0NIxbeuxZd+GUg9WA8lKxj4KG2Z2OPZmOPQkaZrdGYFIRza27iFt6nHQ05AuQTca9tkaedW+AagfD6dh7ftturs+3PZBnpSkLGubRpmO5QSBJNMwDdw5ECJmq/fP9eGcGRVQWV7wQ1QTRCF0RnIPMUD0JfDOanEq2IuLcG3Hu1buzoHfnCPzye95TkShoeAeTkcyLHekANLljEIaBZ44qItc22NGwHgn50kCFn1N9YXA9rifdXTB3hqMPr71+Zdhv6aGo69aPY5WE+RWH+y09rK+w39JDg+t/g3OA0DiOqzWTREPBdYEov2LlR2CVdBcAQcPsTkYyL3fe37Ty18IZXn547fX300VT8M4BAs/8ODmVzAB41lWMhtWZl2HfCozjMGlrVCSzvgJYWncAYJJEQ6BbsjqqEfqWsH8JYW51AGA9rweg8CzpaGgWge1AcYFMTiXbK26v7hadl9Ak6Wj496lkFJdVaC9txxfkVwA1egLgLV1nc3F+P5ZX7gDoTcfmSWUzAk0AsW4GgMjT+3EPqsVm6/Dfjb1Ha78174tA2UGr2/YTMN/UjLaZfOuIACaT1YUXmji1GqdW79Hp/8IAcyiuYgCE7B79Fb6SVXueG6FwuFiUnU1vNpBtQZAZwPJBkfiIZEZFPwKIdUlh07f3RaAqdV26goDqzKgyAcAV5bc0ZnhfBAIxI4Dpmdcv1dRzs5N7I2AOmiRtjYzN76sKhpv0gV+WxErTPf5t2XG3StWvxrzqM4Wqpksp8264ciLR1t2rPVrvMxUhE7eWwzi1+jhddgFEVjpvKxB1R9OznX7S0bAUugjur+o4bgZb9eGWfM9R+7ISo4t/dUApdP2G36t+8lHzEBRVzQrKEn2vZ0EmvifPJ6deVtkM9qOKaQbGPKlrT399sgqhqMxQMsT+o2oyo5pZ4zIAUS8Rkadafx0JmahkqH3r/+D3KwdJW6Mq1O/Ogt5eW4fT9UqIW/YiTq3e9oy6yzOrwl5bozi1gzi1ui5017GKwBKipK0sy47lsBHA+1N/CJBbdxGnboLqifhm5j9gVg/l/h/alIVLEHlKeasCGF2uSnwjAVFOFF6odW/y2oB8lkXDz1ZNEBK1jvwS4tQyHXsCILk7L6YowFxwr3zP79fzYCMBPze9PLAhUqgVKZuRotcmBg2zu7i0HYFEMD/p9ec5gswUnSn6tniee3d6nv8HxAEAdLK9GeYAAAAASUVORK5CYII=',
  };

  // =====================================================================================
  // Fickliste
  // =====================================================================================
  const FSTATES = {
    want: { label: 'Will ich', i: 1 },
    done: { label: 'Gefickt', i: 2 },
    no: { label: 'Nein, danke!', i: 3 },
    never: { label: 'Nie wieder!', i: 4 },
  };
  // Symbole wie beim JOYclub-Skript (Ficken-Icon; Quelle: SVG Repo „sex-doggy“)
  const FL_D = 'M65.9,26.7c0-13.6,11-24.6,24.6-24.6s24.6,11,24.6,24.6s-11,24.6-24.6,24.6S65.9,40.3,65.9,26.7z M254,191.2c0,8.7-7.1,15.8-15.8,15.8h-78.8c-8.7,0-15.8-7.1-15.8-15.8v-27.5H74.8v30.4c0,7.1-5.7,12.8-12.8,12.8H14.8c-7.1,0-12.8-5.7-12.8-12.8s5.7-12.8,12.8-12.8h34.5c0,0,0.1-36.7,0.1-37.3c-0.4-7.9,5.2-14.9,13.1-16.3l45.9-7.7c0,0,0-59.2,0-59.2c0-11.7,9.5-21.3,21.3-21.3c3.7,0,7.2,0.9,10.2,2.6c8.4,4.5,41.9,29.7,61.1,44c8.8,6.6,13.9,16.9,13.9,27.8l0.1,61.4h23.3C246.9,175.4,254,182.5,254,191.2z M183.5,175.4l-0.2-36c0-10.4-4.8-20.1-13-26.5L134,84.7v31.1l10.9-1.8c0,0,0.1,0,0.1,0c7.5-1.2,15.2,0.9,21,5.8c5.8,4.9,9.2,12.1,9.3,19.7c0,0.1,0,0.1,0,0.2v35.7h7.9H183.5z M16.5,140.3c12.4,5.6,26.3-0.3,32.6-12.3c8-15.5,4.5-33.1-2.4-42.9c0,0,0,0,0,0c-4.8,5.8-12.2,7.6-19.6,8.1C15.3,94,8.4,98.4,4.2,107.7C-1.4,120.1,4.1,134.7,16.5,140.3z';
  const FL_RED = '#e01b1b';
  const FL_KIND = ['', 'will', 'gef', 'nein', 'nie'];
  // kind: '' (Umriss dünn = inaktiv) | will | gef | nein | nie | trash; opt: { size, color, shadow, redGef }
  function flIcon(kind, opt = {}) {
    const size = opt.size || 20;
    const sh = opt.shadow === false ? '' : 'filter:drop-shadow(1px 2px 1.5px rgba(0,0,0,.7));';
    const st = `width:${size}px;height:${size}px;flex:none;vertical-align:middle;${sh}`;
    if (kind === 'trash') {
      return `<svg class="vaf-fl-svg" viewBox="0 0 24 24" style="${st}color:${opt.color || 'currentColor'}" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9zm4 2v9h1.6v-9H10zm3.4 0v9H15v-9h-1.6z"/></svg>`;
    }
    const fill = `<path fill="currentColor" d="${FL_D}"/>`;
    const line = `<path fill="none" stroke="currentColor" stroke-width="${kind === 'nein' ? 12 : 9}" stroke-linejoin="round" d="${FL_D}"/>`;
    const col = opt.color || (kind === 'gef' && opt.redGef ? FL_RED : 'currentColor');
    if (kind === 'nein' || kind === 'nie') {
      return `<svg class="vaf-fl-svg" viewBox="-48 -71.5 352 352" style="${st}color:${col}" aria-hidden="true">` +
        `<g transform="translate(128 104.5) scale(.78) translate(-128 -104.5)">${kind === 'nein' ? line : fill}</g>` +
        `<circle cx="128" cy="104.5" r="158" fill="none" stroke="${FL_RED}" stroke-width="22"/>` +
        `<line x1="16.3" y1="216.2" x2="239.7" y2="-7.2" stroke="${FL_RED}" stroke-width="22" stroke-linecap="round"/></svg>`;
    }
    return `<svg class="vaf-fl-svg" viewBox="${kind ? '-4 -4 264 217' : '-8 -8 272 225'}" style="${st}color:${col}" aria-hidden="true">${kind ? fill : line}</svg>`;
  }
  // 0 inaktiv · 1 will ich · 2 gefickt · 3 nein danke · 4 nie wieder; red = „Gefickt“ rot (Listen, Karten)
  const fickIcon = (i, size = 18, red = false) => flIcon(FL_KIND[i] || '', { size, redGef: red });
  const TRASH = flIcon('trash', { size: 16, shadow: false });

  // ---------- Plattformen und Links ----------
  // Kürzel und Farben wie im JOYclub-Skript
  const PLATFORMS = {
    joyclub: { name: 'JOYclub', icon: 'J', color: '#c71b1b' },
    poppen: { name: 'poppen.de', icon: 'P', color: '#d6246e' },
    xhamster: { name: 'xHamster', icon: 'xH', color: '#d9700b' },
    eronity: { name: 'Eronity', icon: 'Er', color: '#7b3fb5' },
    spicymatch: { name: 'SpicyMatch', icon: 'SM', color: '#b4440f' },
    kaufmich: { name: 'Kaufmich', icon: 'KM', color: '#a3164f' },
    fetish: { name: 'Fetish.com', icon: 'Fe', color: '#3f3f46' },
    gays: { name: 'Gays.com', icon: 'G', color: '#2563eb' },
    telegram: { name: 'Telegram', icon: 'TG', color: '#1f8bc4' },
    whatsapp: { name: 'WhatsApp', icon: 'WA', color: '#1f8a3a' },
    threema: { name: 'Threema', icon: 'Th', color: '#3c3c3c' },
    signal: { name: 'Signal', icon: 'Si', color: '#3a6fd8' },
    other: { name: 'Andere …', icon: '?', color: '#5c6470' },
  };
  const OWN_PF = 'poppen';
  const PF_HINT = {
    telegram: '@Name oder t.me/Name', whatsapp: 'Telefonnummer oder wa.me-Link', threema: 'Threema-ID (8 Zeichen)',
    signal: 'Telefonnummer, signal.me-Link oder Benutzername', other: 'Link oder Name',
  };
  const pfHint = (pf) => PF_HINT[pf] || `Profil-Link oder Name auf ${(PLATFORMS[pf] || PLATFORMS.other).name}`;
  const pfLabel = (pf, pfName) => (pf === 'other' && pfName ? pfName : (PLATFORMS[pf] || PLATFORMS.other).name.replace(' …', ''));
  const pfBadge = (pf, title = '', pfName = '', size = 16) => {
    const p = PLATFORMS[pf] || PLATFORMS.other;
    const fav = pf !== 'other' && PF_FAVICONS[pf];
    if (fav) return `<img class="vaf-pf" data-pf="${esc(pf)}" src="${fav}" alt="${esc(p.icon)}" title="${esc(title || pfLabel(pf, pfName))}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;margin-right:3px;vertical-align:-3px;border-radius:3px;flex:none;object-fit:contain">`;
    const ab = pf === 'other' && pfName ? pfName.slice(0, 2) : p.icon;
    return `<span class="vaf-pf" data-pf="${esc(pf || 'other')}" title="${esc(title || pfLabel(pf, pfName))}" style="display:inline-flex;align-items:center;justify-content:center;min-width:${size}px;height:${size}px;padding:0 3px;margin-right:3px;` +
      `border-radius:4px;background:${p.color};color:#fff;font:bold ${Math.round(size * 0.58)}px system-ui,sans-serif;line-height:1;vertical-align:-3px;box-sizing:border-box;flex:none">${esc(ab)}</span>`;
  };
  // „Profil gelöscht“: Austauschfeld dead (ältere Stände: deleted / gone)
  const isDead = (x) => !!(x && (x.dead || x.deleted || x.gone));
  const copyBtn = (t) => `<a href="#" data-copy="${esc(t)}" title="kopieren" style="margin-left:3px">⧉</a>`;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-copy]');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(a.dataset.copy); toast('Kopiert.'); } catch {}
  }, true);
  const digits = (s) => String(s || '').replace(/\D/g, '');
  function phoneIntl(s) {
    let d = String(s || '').trim();
    if (/^\+/.test(d)) return digits(d);
    d = digits(d);
    if (d.startsWith('00')) return d.slice(2);
    if (d.startsWith('0')) return '49' + d.slice(1);
    return d.length >= 10 && !d.startsWith('49') && d.length <= 11 ? '49' + d : d;
  }
  const phonePretty = (intl) => { const d = digits(intl); return d.startsWith('49') ? `+49 ${d.slice(2, 5)} ${d.slice(5)}` : '+' + d; };
  // Eingabe → { pf, url, name, text }  (url = gespeicherte Schreibweise)
  function normalizeProfile(pf, input) {
    const v = String(input || '').trim();
    if (!v) return null;
    if (pf === 'telegram') {
      const m = /^(?:@|(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/)([A-Za-z0-9_]{3,})/i.exec(v) || /^([A-Za-z0-9_]{3,})$/.exec(v);
      return m ? { pf, url: 'https://t.me/' + m[1], name: '@' + m[1] } : null;
    }
    if (pf === 'whatsapp') {
      const m = /wa\.me\/\+?(\d+)/i.exec(v);
      const intl = m ? m[1] : phoneIntl(v);
      return intl.length >= 8 ? { pf, url: 'https://wa.me/' + intl, name: phonePretty(intl) } : null;
    }
    if (pf === 'threema') {
      const m = /threema\.id\/([A-Za-z0-9*]{8})/i.exec(v) || /^([A-Za-z0-9*]{8})$/.exec(v);
      return m ? { pf, url: 'https://threema.id/' + m[1].toUpperCase(), name: m[1].toUpperCase() } : null;
    }
    if (pf === 'signal') {
      if (/signal\.me\//i.test(v)) return { pf, url: v.replace(/^http:/i, 'https:'), name: 'Signal-Link' };
      if (/^\+?[\d\s/()-]{8,}$/.test(v)) { const intl = phoneIntl(v); return { pf, url: 'https://signal.me/#p/+' + intl, name: phonePretty(intl) }; }
      return { pf, url: '', name: v, text: v };                     // Benutzername: kein Link möglich
    }
    if (/^https?:\/\//i.test(v) || /^[\w.-]+\.[a-z]{2,}\//i.test(v)) {
      const url = /^https?:/i.test(v) ? v : 'https://' + v;
      return { pf, url, name: decodeURIComponent((url.split('/').filter(Boolean).pop() || url)) };
    }
    if (pf === 'poppen') return { pf, url: 'https://www.poppen.de' + pathOfName(v), name: v };
    return { pf, url: '', name: v, text: v };
  }
  // Vereinheitlichter Link zum Vergleichen
  function linkKey(p) {
    if (!p) return '';
    if (!p.url) return p.text ? `${p.pf}:${norm(p.text)}` : '';
    let u = String(p.url).trim();
    try { u = decodeURIComponent(u); } catch {}
    u = u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, (x) => (/signal\.me/.test(u) ? x : '')).replace(/\/+$/, '');
    u = u.replace(/^telegram\.me\//, 't.me/');
    return u;
  }
  function platformOfUrl(url) {
    const u = String(url || '').toLowerCase();
    if (/poppen\.de/.test(u)) return 'poppen';
    if (/joyclub\.(de|com)/.test(u)) return 'joyclub';
    if (/xhamster/.test(u)) return 'xhamster';
    if (/eronity/.test(u)) return 'eronity';
    if (/spicymatch/.test(u)) return 'spicymatch';
    if (/kaufmich/.test(u)) return 'kaufmich';
    if (/fetish\.com/.test(u)) return 'fetish';
    if (/gays\.com/.test(u)) return 'gays';
    if (/t\.me|telegram\.me/.test(u)) return 'telegram';
    if (/wa\.me|whatsapp/.test(u)) return 'whatsapp';
    if (/threema\.id/.test(u)) return 'threema';
    if (/signal\.me/.test(u)) return 'signal';
    return 'other';
  }

  // ---------- Datenhaltung ----------
  const Fick = {
    // gemeinsame Fickliste im Briefkasten (siehe FickStore); der Abgleich per Nachricht läuft für ältere JOYclub-Skripte weiter
    async get(id) { return FickStore.get(id); },
    async all() { return FickStore.all(); },
    async put(p) {
      p.updated = now();
      const fromBk = p.__fromBk;
      try { await FickStore.put(p); } catch (e) { toast(esc(e.message || String(e))); throw e; }
      chan.post({ t: 'fick' }); Bus.emit('fick');
      try { if (typeof bkSendPerson === 'function' && !fromBk) bkSendPerson(p); } catch {}
      return p;
    },
    async del(id) { await FickStore.del(id); Bus.emit('fick'); },
    idOf: (uid) => 'p:' + uid,
    async forMember(uid, nick) {
      let p = await Fick.byUid(uid);
      if (!p) p = { id: Fick.idOf(uid), status: null, statusAt: 0, profiles: [], meets: [], history: [], created: now(), main: { pf: 'poppen', uid: String(uid), nick } };
      const mainPop = p.main && (!p.main.pf || p.main.pf === 'poppen');
      if (nick && mainPop) p.main.nick = nick;
      const url = 'https://www.poppen.de' + pathOfName(nick || (pm(p) && pm(p).nick) || '');
      if (nick && !p.profiles.some((x) => x.pf === 'poppen' && x.uid === String(uid))) p.profiles.unshift({ pf: 'poppen', url, name: nick, uid: String(uid) });
      else for (const x of p.profiles) if (x.pf === 'poppen' && x.uid === String(uid) && nick) { x.url = url; x.name = nick; }
      return p;
    },
    // Person zu einer poppen-uid finden – egal, ob das poppen-Profil Hauptprofil ist oder (z. B. nach dem
    // Zurückschreiben durch das JOYclub-Skript, das sein Profil zum Hauptprofil macht) unter `profiles` steht.
    async byUid(uid) {
      uid = String(uid);
      const p = await Fick.get(Fick.idOf(uid));
      if (p && !p.deleted) return p;
      return (await Fick.all()).find((q) => !q.deleted && pmUid(q) === uid) || null;
    },
    // Einträge, die ein poppen-Profil dieses Mitglieds nur per Link (ohne uid) enthalten: uid nachtragen.
    // Hauptprofil und Kennung bleiben unverändert (seit 2.38 – vorher wurde zur p:-Person umgebaut, was mit dem
    // JOYclub-Skript hin und her ginge).
    async adopt(uid, nick) {
      uid = String(uid);
      const have = await Fick.byUid(uid);
      if (have) return have;
      const key = nick ? linkKey({ url: 'https://www.poppen.de' + pathOfName(nick) }) : '';
      if (!key) return null;
      const t = (await Fick.all()).find((q) => !q.deleted && (q.profiles || []).some((x) => x.pf === 'poppen' && !x.uid && linkKey(x) === key));
      if (!t) return null;
      for (const x of t.profiles) if (x.pf === 'poppen' && !x.uid && linkKey(x) === key) { x.uid = uid; if (nick) x.name = nick; }
      t.history = [...(t.history || []), { at: now(), what: 'Mit poppen-Profil verbunden' }];
      await Fick.put(t);
      return t;
    },
    async setStatus(p, st) {
      const old = p.status;
      p.status = st || null; p.statusAt = now();
      for (const x of p.profiles || []) if (x.sync === true) { x.status = p.status; x.statusAt = p.statusAt; }
      p.history = [...(p.history || []), { at: now(), what: `Fickstatus: ${old ? FSTATES[old].label : 'Ficken?'} → ${st ? FSTATES[st].label : 'zurückgesetzt'}` }];
      if (!p.status && !(p.meets || []).length && !p.ext) { await Fick.del(p.id); return null; }
      return Fick.put(p);
    },
  };
  const isFickDone = (p) => p.status === 'done' || p.status === 'never';
  // Hauptprofil auf poppen.de? (Personen aus dem JOYclub-Import behalten ihr fremdes Hauptprofil)
  // poppen-Profil der Person: Hauptprofil oder (seit JOYclub 1.96 möglich) ein Eintrag in `profiles`
  const pm = (p) => {
    if (!p) return null;
    if (p.main && (!p.main.pf || p.main.pf === 'poppen') && p.main.uid) return p.main;
    const x = (p.profiles || []).find((y) => y && y.pf === 'poppen' && y.uid && !y.dead && !y.deleted && !y.gone);
    return x ? { pf: 'poppen', uid: String(x.uid), nick: x.name || x.nick || '', url: x.url } : null;
  };
  const pmUid = (p) => { const m = pm(p); return m ? String(m.uid) : ''; };
  const foreignUrl = (p) => (p && p.main && p.main.pf && p.main.pf !== 'poppen' && p.main.url) || '';

  // ---------- Profil-Fakten (Persönliche Details) ----------
  function detailsFrom(doc = document) {
    const h = [...doc.querySelectorAll('main h2, h2')].find((x) => x.textContent.trim().startsWith('Persönliche Details'));
    if (!h) return {};
    let sec = h; for (let i = 0; i < 6 && sec; i++, sec = sec.parentElement) if (sec.querySelector('label')) break;
    const out = {};
    for (const lab of (sec || h.parentElement).querySelectorAll('label')) {
      const v = lab.nextElementSibling; const k = lab.textContent.trim();
      if (!k || !v) continue;
      const vals = [...v.children].map((c) => c.textContent.trim()).filter(Boolean);
      out[k] = (vals.length ? vals : [v.textContent.trim()]).join(', ');
    }
    return out;
  }
  async function applyFacts(x, fields) {
    let uid = x.uid || uidFromAvatar(x.avatar);
    if (!uid && x.nick) { const m = await Members.byNick(x.nick); uid = m && m.uid; }
    if (!uid) return;
    const num = (s) => { const m = /(\d{2,3})/.exec(String(s || '')); return m ? +m[1] : 0; };
    await Members.update(uid, (m) => {
      if (x.nick) m.nick = m.nick || x.nick;
      const z = fields['Sternzeichen'];
      if (z) m.zod = z.split(',').map((t) => t.trim());   // nur als Angabe: das Sternzeichen ist auf poppen frei wählbar und engt den Geburtszeitraum NICHT ein
      const h = num(fields['Größe']), w = num(fields['Gewicht']);
      if (h && w) m.body = [{ h, wlo: w, whi: w, at: now(), src: 'Profil' }];
      if (fields['Figur']) m.fig = fields['Figur'];
    });
  }

  // ---------- Profilseite: Button, Abschnitt, Archiv, eigenes Profil ----------
  const profileNick = () => (/^\/p\/([^/]+)\/?$/.exec(location.pathname) || [])[1];
  function profileHeaderInfo() {
    const send = [...document.querySelectorAll('main button')].find((b) => norm(b.textContent) === 'nachricht senden');
    const box = send && send.closest('main > *, main');
    const nameEl = box && box.querySelector('[class*="ellipsis"]');
    const desc = box && [...box.querySelectorAll('div,span')].find((e) => e.children.length === 0 && /\d+\s*Jahre/.test(e.textContent));
    const img = document.querySelector('main img[alt]');
    return { send, nick: nameEl ? nameEl.textContent.trim() : slugOf(location.pathname), desc: desc ? desc.textContent : '', avatar: img ? img.getAttribute('src') : '' };
  }
  let profBusy = false;
  async function profilePage() {
    const slug = profileNick();
    if (!slug || isBlockedProfilePage() || profBusy) return;
    const pi = profileHeaderInfo();
    const me = Me.get();
    const own = me && norm(me.nick) === norm(slugOf(location.pathname));
    if (own) { ownProfileBox(); return; }
    if (!pi.send) return;
    profBusy = true;
    try {
      let uid = uidFromAvatar(pi.avatar);
      let m = uid ? await Members.get(uid) : await Members.byNick(pi.nick);
      if (m && !uid) uid = m.uid;
      if (!uid) return;
      if (!document.body.dataset.vafProfileSeen || document.body.dataset.vafProfileSeen !== uid) {
        document.body.dataset.vafProfileSeen = uid;
        m = await seen({ uid, nick: pi.nick, ages: agesFromText(pi.desc), g: genderFromText(pi.desc), avatar: pi.avatar }, 'Profil');
        setTimeout(async () => { await applyFacts({ uid, nick: pi.nick }, detailsFrom()); await snapshot(uid, pi.nick, 'Profilaufruf'); }, 2500);
      }
      await Fick.adopt(uid, pi.nick).catch((e) => warn('Fickliste verbinden', e));
      await fickButton(uid, pi);
      await fickSection(uid, pi.nick);
    } finally { profBusy = false; }
  }

  // Button nach „Nachricht senden“
  async function fickButton(uid, pi) {
    const bar = pi.send.parentElement;
    let b = bar.querySelector('#vaf-fick-btn');
    const p = await Fick.byUid(uid);
    const st = p && p.status;
    const i = st ? FSTATES[st].i : 0;
    const label = st ? FSTATES[st].label : 'Ficken?';
    if (b && b.dataset.st === (st || '') ) return;
    if (!b) {
      const tpl = [...bar.querySelectorAll('button')].find((x) => norm(x.textContent) === 'sticker') || pi.send;
      b = tpl.cloneNode(false);
      b.id = 'vaf-fick-btn';
      b.className = tpl.className.replace(/ant-btn-primary|ant-btn-color-primary|ant-btn-variant-solid/g, '') + ' ant-btn-default ant-btn-variant-outlined';
      b.type = 'button';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fickMenu(b, uid, pi.nick); });
      pi.send.after(b);
    }
    b.dataset.st = st || '';
    // wie auf JOYclub: „Gefickt“ als roter (primärer) Button mit weißem Symbol
    const prim = ['ant-btn-primary', 'ant-btn-color-primary', 'ant-btn-variant-solid'], dflt = ['ant-btn-default', 'ant-btn-color-default', 'ant-btn-variant-outlined'];
    b.classList.remove(...prim, ...dflt); b.classList.add(...(st === 'done' ? prim : dflt));
    b.innerHTML = `<span class="ant-btn-icon" style="display:inline-flex">${fickIcon(i, 18)}</span><span>${esc(label)}</span>`;
    b.title = 'Fickliste – nur für dich sichtbar';
  }
  // Menü wie „Speichern“: alle anderen Zustände + zurücksetzen
  async function fickMenu(anchor, uid, nick) {
    const old = document.getElementById('vaf-fick-menu'); if (old) { old.remove(); return; }
    const p = await Fick.forMember(uid, nick);
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'vaf-fick-menu';
    menu.className = 'ant-dropdown ant-theme';
    menu.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 6}px;z-index:2147483600`;
    const items = Object.entries(FSTATES).filter(([k]) => k !== p.status).map(([k, v]) => `<li class="ant-dropdown-menu-item" role="menuitem" data-k="${k}" style="display:flex;gap:8px;align-items:center">${fickIcon(v.i, 16)}<span>${esc(v.label)}</span></li>`);
    if (p.status) items.push(`<li class="ant-dropdown-menu-item" role="menuitem" data-k="reset" style="display:flex;gap:8px;align-items:center">${TRASH}<span>Fickstatus zurücksetzen</span></li>`);
    items.push(`<li class="ant-dropdown-menu-item" role="menuitem" data-k="meet" style="display:flex;gap:8px;align-items:center">＋<span>Treffen eintragen …</span></li>`);
    items.push(`<li class="ant-dropdown-menu-item" role="menuitem" data-k="also" style="display:flex;gap:8px;align-items:center">${pfBadge('joyclub', 'andere Plattformen')}<span>Auch auf …</span></li>`);
    menu.innerHTML = `<ul class="ant-dropdown-menu ant-dropdown-menu-root ant-dropdown-menu-vertical ant-dropdown-menu-light" role="menu">${items.join('')}</ul>`;
    document.body.appendChild(menu);
    const close = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
    document.addEventListener('mousedown', close, true);
    menu.querySelectorAll('[data-k]').forEach((li) => li.addEventListener('click', async () => {
      menu.remove(); document.removeEventListener('mousedown', close, true);
      const k = li.dataset.k;
      if (k === 'meet') { editMeet(p, null); return; }
      if (k === 'also') {
        const fresh = !(await Fick.get(p.id));
        if (fresh) await Fick.put(p);
        // neu angelegt und nichts eingetragen → wieder entfernen
        addProfileDialog(p, async () => { const q = await Fick.get(p.id); if (fresh && q && !q.status && !(q.meets || []).length && !otherProfiles(q).length) await Fick.del(p.id); refreshProfileFick(); });
        return;
      }
      await Fick.setStatus(p, k === 'reset' ? null : k);
      await snapshot(uid, nick, 'Fickstatus geändert', true);
      refreshProfileFick();
    }));
  }
  function refreshProfileFick() {
    const b = document.getElementById('vaf-fick-btn'); if (b) b.dataset.st = '#';
    const s = document.getElementById('vaf-fick-sec'); if (s) s.remove();
    profilePage();
  }

  // ---------- Anmerkungen einer Person (persons[].notes, höchstens 8000 Zeichen) ----------
  const NOTES_MAX = 8000;
  const notesOf = (p) => String((p && (p.notes != null ? p.notes : (p.joy && p.joy.notes != null ? p.joy.notes : p.note))) || '');
  async function setNotes(p, text) {
    const t = String(text || '').slice(0, NOTES_MAX);
    if (t === notesOf(p)) return p;
    const me = Me.get() || {};
    p.notes = t; p.notesAt = now(); p.notesBy = { platform: 'poppen', account: me.nick || '' };
    delete p.note;
    p.history = [...(p.history || []), { at: now(), what: t ? 'Anmerkungen geändert' : 'Anmerkungen gelöscht' }];
    return Fick.put(p);
  }
  function editNotes(p, done) {
    const m = modal({ title: 'Anmerkungen', sub: esc((pm(p) && pm(p).nick) || (p.ext && p.ext.name) || (p.main && p.main.nick) || ''),
      html: `<textarea class="vaf-in" data-f="n" rows="8" maxlength="${NOTES_MAX}" style="resize:vertical">${esc(notesOf(p))}</textarea><div class="vaf-mini" data-f="c" style="text-align:right"></div>` });
    const ta = m.body.querySelector('[data-f=n]'), c = m.body.querySelector('[data-f=c]');
    const upd = () => { c.textContent = `Noch ${fmtN(NOTES_MAX - ta.value.length)} Zeichen möglich`; };
    ta.addEventListener('input', upd); upd();
    m.buttons([
      { label: 'Speichern', primary: true, fn: async () => { if (!(await Fick.get(p.id))) await Fick.put(p); await setNotes(p, ta.value.trim()); m.close(); if (done) done(); else refreshProfileFick(); } },
      { label: 'Abbrechen', focus: true, fn: () => m.close() },
    ]);
    setTimeout(() => ta.focus(), 50);
  }
  const notesBlock = (p) => `<div style="margin-bottom:8px"><span style="color:#8c8c8c">Anmerkungen</span> <a href="#" data-a="notes" title="Anmerkungen bearbeiten">✎</a>${notesOf(p) ? `<div style="white-space:pre-wrap;margin-top:2px">${esc(notesOf(p))}</div>` : ''}</div>`;

  // Abschnitt „Fickliste“ unter „Fotos“ und „Videos“
  async function fickSection(uid, nick) {
    const p = await Fick.byUid(uid);
    let sec = document.getElementById('vaf-fick-sec');
    if (!p) { if (sec) sec.remove(); return; }
    if (sec && sec.dataset.u === String(p.updated)) return;
    const h2s = [...document.querySelectorAll('main h2')];
    const blockOf = (h) => { let b = h; while (b.parentElement && b.parentElement.tagName !== 'MAIN' && b.parentElement.children.length < 3) b = b.parentElement; return b; };
    const vid = h2s.find((h) => /^Videos/.test(h.textContent.trim()));
    const fot = h2s.find((h) => /^Fotos/.test(h.textContent.trim()));
    const stat = h2s.find((h) => /^Statistiken/.test(h.textContent.trim()));
    const ref = vid || fot;
    const host = ref ? blockOf(ref) : stat ? blockOf(stat) : null;
    if (!host) return;
    if (!sec) { sec = document.createElement('div'); sec.id = 'vaf-fick-sec'; sec.dataset.vafSkip = '1'; }
    sec.className = host.className;
    sec.dataset.u = String(p.updated);
    const st = p.status ? FSTATES[p.status] : null;
    const meets = [...(p.meets || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    sec.innerHTML = `<div class="${(host.firstElementChild && host.firstElementChild.className) || ''}"><h2>Fickliste <span style="font-size:12px;font-weight:400;color:#8c8c8c">· Nur für dich sichtbar</span></h2></div>
      <div style="padding:4px 0 12px;font-size:14px;color:#e8e8e8">
        <div style="margin-bottom:8px">${fickIcon(st ? st.i : 0, 18, true)} <b>${esc(st ? st.label : 'kein Fickstatus')}</b></div>
        ${meets.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">${meets.map((t) => meetLine(t)).join('')}</div>` : '<div style="color:#8c8c8c;margin-bottom:8px">Noch keine Treffen eingetragen.</div>'}
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px"><a href="#" data-a="add">+ Treffen eintragen</a></div>
        ${notesBlock(p)}
        <div class="vaf-also" style="margin-bottom:6px"><span style="color:#8c8c8c">Auch auf:</span>${(p.profiles || []).filter((x) => !(x.pf === 'poppen' && x.uid === String(uid))).map(profLink).map((h) => `<span class="vaf-also-i">${h}</span>`).join('')}<button type="button" class="vaf-plus" data-a="prof" title="Profil auf einer anderen Plattform zufügen">+</button></div>
        <div style="display:flex;gap:16px"><a href="/setting/profile#archiv=${encodeURIComponent(uid)}" target="_blank">Profil-Archiv</a><a href="/setting/profile#fickliste" target="_blank">Zu meiner Fickliste</a></div>
      </div>`;
    if (!sec.isConnected || sec.previousElementSibling !== (ref ? host : null)) { if (ref) host.after(sec); else host.before(sec); }
    sec.querySelector('[data-a=add]').addEventListener('click', (e) => { e.preventDefault(); editMeet(p, null); });
    sec.querySelector('[data-a=prof]').addEventListener('click', (e) => { e.preventDefault(); addProfileDialog(p); });
    sec.querySelector('[data-a=notes]').addEventListener('click', (e) => { e.preventDefault(); editNotes(p); });
    sec.querySelectorAll('[data-meet]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); editMeet(p, p.meets.find((t) => t.id === a.dataset.meet)); }));
  }
  function meetLine(t) {
    const d = t.date ? deDate(new Date(t.date + 'T12:00')) : 'ohne Datum';
    const where = [t.where, t.club].filter(Boolean).map(esc).join(' · ');
    const link = t.link ? ` <a href="${esc(t.link)}" target="_blank" rel="noopener">${pfBadge(t.pf || platformOfUrl(t.link))}Link</a>` : '';
    return `<div><a href="#" data-meet="${esc(t.id)}" title="Treffen bearbeiten">${esc(d)}${t.time ? ' ' + esc(t.time) : ''}</a>${where ? ' · ' + where : ''}${link}${t.note ? ` <span style="color:#a6a6a6">– ${esc(t.note)}</span>` : ''}</div>`;
  }
  function profLink(x) {
    const strike = isDead(x) ? 'vaf-strike' : '';
    const title = pfLabel(x.pf, x.pfName) + (isDead(x) ? ' · Profil gelöscht' : '');
    if (!x.url) return `<span class="${strike}">${pfBadge(x.pf, title, x.pfName)}${esc(x.name || x.text)}</span>${copyBtn(x.text || x.name || '')}`;
    const own = 'status' in x && x.sync !== true ? ` <span title="eigener Status dieses Profils: ${esc(x.status ? FSTATES[x.status].label : 'kein')}">${fickIcon(x.status ? FSTATES[x.status].i : 0, 14, true)}</span>` : '';
    return `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="${strike}">${pfBadge(x.pf, title, x.pfName)}${esc(x.name || x.url)}</a>${own}`;
  }
  // Treffen eintragen / bearbeiten
  function editMeet(p, t) {
    const isNew = !t;
    t = t ? { ...t } : { id: 'm' + now().toString(36), date: isoDay(new Date()), time: '', where: '', club: '', link: '', note: '', pf: 'poppen' };
    const m = modal({ title: isNew ? 'Treffen eintragen' : 'Treffen bearbeiten', sub: esc((p.main && p.main.nick) || (p.ext && p.ext.name) || ''),
      html: `<div class="vaf-grid"><label>Datum<input class="vaf-in" type="date" data-f="date" value="${esc(t.date)}"></label><label>Uhrzeit<input class="vaf-in" type="time" data-f="time" value="${esc(t.time)}"></label>
        <label>Was (Party, Anlass)<input class="vaf-in" data-f="where" value="${esc(t.where)}"></label><label>Wo (Club, Ort)<input class="vaf-in" data-f="club" value="${esc(t.club)}"></label></div>
        <label>Link (Party, Club, poppen-Ort …)<input class="vaf-in" data-f="link" value="${esc(t.link)}" placeholder="https://…"></label>
        <label style="display:block;margin-top:10px">Notiz<textarea class="vaf-in" data-f="note" rows="3">${esc(t.note)}</textarea></label>` });
    const read = () => { m.body.querySelectorAll('[data-f]').forEach((i) => { t[i.dataset.f] = i.value.trim(); }); if (t.link && !/^https?:/i.test(t.link)) t.link = 'https://' + t.link; t.pf = t.link ? platformOfUrl(t.link) : 'poppen'; };
    m.buttons([
      { label: 'Speichern', primary: true, focus: true, fn: async () => {
        read();
        p.meets = (p.meets || []).filter((x) => x.id !== t.id).concat([{ ...t, at: now() }]);
        p.history = [...(p.history || []), { at: now(), what: `${isNew ? 'Treffen eingetragen' : 'Treffen geändert'}: ${t.date}` }];
        if (!p.status) { p.status = 'done'; p.statusAt = now(); }
        await Fick.put(p); m.close(); refreshProfileFick(); Bus.emit('fick');
      } },
      ...(isNew ? [] : [{ label: 'Treffen löschen', fn: async () => { if (!W.confirm('Treffen löschen?')) return; p.meets = p.meets.filter((x) => x.id !== t.id); await Fick.put(p); m.close(); refreshProfileFick(); } }]),
      { label: 'Abbrechen', fn: () => m.close() },
    ]);
  }
  // Profile, die im Popup „Auch auf …“ erscheinen (nicht das eigene poppen-Hauptprofil)
  const otherProfiles = (p) => (p.profiles || []).filter((x) => !(x.pf === OWN_PF && pm(p) && x.uid === String(pm(p).uid)));
  // Importierte Einträge einer Plattform ohne eigenes Profil hier (Vorschläge zum Zusammenführen)
  async function importSuggestions(p, pf) {
    const all = await Fick.all();
    return all.filter((q) => q.id !== p.id && !pm(q) && (q.imported || String(q.id).startsWith('i:')) &&
      ((q.main && q.main.pf === pf) || (q.profiles || []).some((x) => x.pf === pf)));
  }
  // Importierten Eintrag q mit Person p zusammenführen: neuerer Status, Treffen/Profile/Verlauf übernehmen, Anmerkungen anhängen
  async function mergeImported(p, q) {
    mergeFick(p, q);
    const note = [q.ext && q.ext.short, q.ext && q.ext.texts, q.note].filter(Boolean).join('\n').trim();
    if (note) {
      const k = q.main && q.main.url ? linkKey(q.main) : '';
      const x = (k && p.profiles.find((y) => linkKey(y) === k)) || null;
      if (x) x.text = [x.text, note].filter(Boolean).join('\n');
      else p.notes = [notesOf(p), note].filter(Boolean).join('\n').slice(0, NOTES_MAX);
    }
    p.history = [...(p.history || []), { at: now(), what: `Zusammengeführt mit importiertem Eintrag ${(q.main && q.main.nick) || (q.ext && q.ext.name) || ''}` }];
    await Fick.put(p);
    await Fick.del(q.id);
  }
  function addProfileDialog(p, done) {
    const pfOpts = Object.entries(PLATFORMS).filter(([k]) => k !== OWN_PF).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    const nick = (pm(p) && pm(p).nick) || (p.ext && p.ext.name) || (p.main && p.main.nick) || '';
    const m = modal({ title: 'Auch auf …', sub: esc(nick), html: `<div data-f="list"></div>
      <h3 style="margin:14px 0 6px;font-size:15px">+ Profil zufügen</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="vaf-in" data-f="pf" style="width:auto">${pfOpts}</select>
        <input class="vaf-in" data-f="pfName" placeholder="Name der Plattform" style="width:180px;display:none">
        <input class="vaf-in" data-f="v" style="flex:1;min-width:200px">
        <button type="button" class="vaf-big vaf-pri" data-a="add" style="width:auto">Zufügen</button></div>
      <div class="vaf-cur" data-f="hint"></div><div data-f="sugg"></div>`, onClose: () => { if (done) done(); else refreshProfileFick(); } });
    const $ = (f) => m.body.querySelector(`[data-f=${f}]`);
    const pfSel = $('pf'), inp = $('v'), hint = $('hint'), pfName = $('pfName');
    pfSel.value = 'joyclub';
    const drawList = () => {
      const l = otherProfiles(p);
      $('list').innerHTML = l.length ? l.map((x, i) => `<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid #2c2c2c">
          <span style="flex:1;min-width:0">${profLink(x)}</span>
          <label style="display:flex;gap:5px;align-items:center;font-size:12px;color:#a6a6a6;white-space:nowrap"><input type="checkbox" data-dead="${i}" ${isDead(x) ? 'checked' : ''}> Profil gelöscht</label>
          <a href="#" data-rm="${i}" title="entfernen" style="color:#ff7875;text-decoration:none">✕</a></div>`).join('')
        : '<div style="color:#8c8c8c">Noch keine Profile auf anderen Plattformen.</div>';
      $('list').querySelectorAll('[data-dead]').forEach((c) => c.addEventListener('change', async () => {
        const x = l[+c.dataset.dead];
        delete x.deleted; delete x.gone;
        if (c.checked) x.dead = true; else delete x.dead;
        p.history = [...(p.history || []), { at: now(), what: `${pfLabel(x.pf, x.pfName)} ${x.name || ''}: ${c.checked ? 'Profil gelöscht' : 'Profil wieder da'}` }];
        await Fick.put(p); drawList();
      }));
      $('list').querySelectorAll('[data-rm]').forEach((a) => a.addEventListener('click', async (e) => {
        e.preventDefault();
        const x = l[+a.dataset.rm];
        if (!W.confirm(`${pfLabel(x.pf, x.pfName)}-Profil „${x.name || x.url}“ entfernen?`)) return;
        p.profiles = p.profiles.filter((y) => y !== x);
        p.history = [...(p.history || []), { at: now(), what: `Profil entfernt: ${pfLabel(x.pf, x.pfName)} ${x.name || ''}` }];
        await Fick.put(p); drawList();
      }));
    };
    const drawSugg = async () => {
      const pf = pfSel.value;
      const l = await importSuggestions(p, pf);
      $('sugg').innerHTML = l.length ? `<div class="vaf-mini" style="margin:8px 0 4px">Importierte Einträge von ${esc(pfLabel(pf))} – Klick führt sie mit dieser Person zusammen</div>` +
        l.map((q) => { const n = (q.main && q.main.nick) || (q.ext && q.ext.name) || '?'; const st = q.status ? FSTATES[q.status] : null;
          return `<div data-q="${esc(q.id)}" style="display:flex;gap:8px;align-items:center;padding:5px 8px;border-radius:6px;cursor:pointer;background:#2a2a2a;margin-bottom:4px">${pfBadge(pf)}<span>${esc(n)}</span>${st ? fickIcon(st.i, 15, true) : ''}<span class="vaf-mini">${(q.meets || []).length} Treffen</span></div>`; }).join('') : '';
      $('sugg').querySelectorAll('[data-q]').forEach((d) => d.addEventListener('click', async () => {
        const q = l.find((x) => x.id === d.dataset.q);
        const n = (q.main && q.main.nick) || (q.ext && q.ext.name) || '?';
        if (!W.confirm(`„${n}“ mit dieser Person zusammenführen? Der importierte Eintrag verschwindet danach.`)) return;
        await mergeImported(p, q);
        hint.textContent = `„${n}“ zusammengeführt.`;
        drawList(); drawSugg();
      }));
    };
    const upd = () => {
      pfName.style.display = pfSel.value === 'other' ? '' : 'none';
      inp.placeholder = pfHint(pfSel.value);
      const r = normalizeProfile(pfSel.value, inp.value);
      hint.textContent = !inp.value.trim() ? '' : r ? (r.url ? 'Gespeichert als: ' + r.url : 'Ohne Link (nur Text): ' + r.name) : 'Das passt nicht zu ' + pfLabel(pfSel.value, pfName.value) + '.';
    };
    pfSel.addEventListener('change', () => { upd(); drawSugg(); }); inp.addEventListener('input', upd);
    const add = async () => {
      const r = normalizeProfile(pfSel.value, inp.value);
      if (!r) { hint.textContent = `Das passt nicht zu ${pfLabel(pfSel.value, pfName.value)} (${pfHint(pfSel.value)}).`; return; }
      if (r.pf === 'other') { const n = pfName.value.trim(); if (!n) { hint.textContent = 'Bitte den Namen der Plattform eingeben.'; pfName.focus(); return; } r.pfName = n; }
      if ((p.profiles || []).some((x) => linkKey(x) === linkKey(r)) || (p.main && p.main.url && linkKey(p.main) === linkKey(r))) { hint.textContent = 'Dieses Profil ist schon eingetragen.'; return; }
      p.profiles = [...(p.profiles || []), r];
      p.history = [...(p.history || []), { at: now(), what: `Profil zugefügt: ${pfLabel(r.pf, r.pfName)} ${r.name}` }];
      await Fick.put(p);
      inp.value = ''; upd(); hint.textContent = 'Zugefügt.'; drawList();
    };
    m.body.querySelector('[data-a=add]').addEventListener('click', add);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    m.buttons([{ label: 'Schließen', focus: true, fn: () => m.close() }]);
    drawList(); upd(); drawSugg();
  }

  // ---------- Profil-Archiv ----------
  async function hashText(s) { const b = await SUB.digest('SHA-1', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  async function snapshot(uid, nick, reason, force = false) {
    const main = document.querySelector('main');
    if (!main || !uid) return;
    const c = main.cloneNode(true);
    c.querySelectorAll('script, style, iframe, #vaf-fick-sec, #vaf-fick-btn, .vaf-mark, [data-vaf-own]').forEach((e) => e.remove());
    c.querySelectorAll('input, textarea').forEach((e) => e.setAttribute('disabled', ''));
    const html = c.innerHTML;
    if (html.length < 500) return;
    const h = await hashText(html.replace(/==,\d+\//g, '/'));
    const prev = await DB.byIndex('archive', 'uid', String(uid));
    prev.sort((a, b) => a.at - b.at);
    const last = prev[prev.length - 1];
    if (last && last.hash === h && !force) return;
    const p = await Fick.byUid(uid);
    const img = await Images.get(uid);
    await DB.put('archive', { uid: String(uid), nick, at: now(), reason: last && last.nick !== nick ? `Nick geändert (${last.nick} → ${nick})` : reason, html, hash: h, img });
    // ohne Fickliste-Eintrag nur den letzten Stand behalten
    if (!p) for (const old of prev) await DB.del('archive', old.id);
    else if (prev.length > 60) for (const old of prev.slice(0, prev.length - 60)) await DB.del('archive', old.id);
  }
  async function renderArchive(el, uid) {
    ensureStyle();
    const list = (await DB.byIndex('archive', 'uid', String(uid))).sort((a, b) => a.at - b.at);
    const m = await Members.get(uid);
    const p = await Fick.byUid(uid);
    if (!list.length) { el.innerHTML = `<div style="padding:24px;color:#e8e8e8"><h2>Profil-Archiv</h2><p>Für ${esc((m && m.nick) || (p && p.main && p.main.nick) || (p && p.ext && p.ext.name) || uid)} gibt es noch keinen gespeicherten Stand. Er entsteht, sobald du das Profil öffnest.</p></div>`; return; }
    let idx = list.length - 1;
    try { const k = sessionStorage.getItem('vaf_arch_' + uid); if (k != null && list[+k]) idx = +k; } catch {}
    const meetDates = ((p && p.meets) || []).map((t) => t.date).filter(Boolean).sort();
    const draw = () => {
      const a = list[idx];
      try { sessionStorage.setItem('vaf_arch_' + uid, String(idx)); } catch {}
      const opts = list.map((x, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${deDateTime(x.at)} – ${esc(x.reason || '')}</option>`).join('') + '<option value="live">aktuell (echtes Profil)</option>';
      el.innerHTML = `<div style="position:sticky;top:0;z-index:5;background:#141414;padding:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:#e8e8e8">
          <b>Profil-Archiv: ${esc(a.nick || '')}</b>
          <button type="button" class="vaf-big" style="width:auto;padding:4px 10px" data-n="ff" title="Stand direkt vor dem vorigen Treffen">«</button>
          <button type="button" class="vaf-big" style="width:auto;padding:4px 10px" data-n="p">‹</button>
          <select class="vaf-in" style="width:auto" data-n="sel">${opts}</select>
          <button type="button" class="vaf-big" style="width:auto;padding:4px 10px" data-n="n">›</button>
          <button type="button" class="vaf-big" style="width:auto;padding:4px 10px" data-n="fn" title="Stand direkt nach dem nächsten Treffen">»</button></div>
        <div data-n="body" style="pointer-events:auto"></div>`;
      el.querySelector('[data-n=body]').innerHTML = a.html;
      el.querySelectorAll('[data-n=body] a[href^="/"]').forEach((x) => { x.target = '_blank'; });
      const at = (i) => { if (i >= 0 && i < list.length) { idx = i; draw(); } };
      el.querySelector('[data-n=p]').onclick = () => at(idx - 1);
      el.querySelector('[data-n=n]').onclick = () => at(idx + 1);
      el.querySelector('[data-n=sel]').onchange = (e) => { if (e.target.value === 'live') W.open(profileUrl(a.nick), '_blank'); else at(+e.target.value); };
      const day = (x) => isoDay(new Date(x.at));
      el.querySelector('[data-n=ff]').onclick = () => { const cur = day(list[idx]); const md = [...meetDates].reverse().find((d) => d < cur); if (!md) return; let j = -1; list.forEach((x, i) => { if (day(x) <= md) j = i; }); at(Math.max(0, j)); };
      el.querySelector('[data-n=fn]').onclick = () => { const cur = day(list[idx]); const md = meetDates.find((d) => d > cur); if (!md) return; const j = list.findIndex((x) => day(x) >= md); at(j < 0 ? list.length - 1 : j); };
    };
    draw();
    if (m && m.del) toast(`<b>Dieser Benutzer ist nicht mehr auf poppen.de</b><br>Du betrachtest eine statische Kopie seines alten Profils.`, 10000);
  }

  // ---------- Externe Ficks ----------
  async function renderExternal(el, id) {
    ensureStyle();
    let p = id ? await Fick.get(id) : null;
    if (!p) { el.innerHTML = '<div style="padding:24px;color:#e8e8e8">Eintrag nicht gefunden.</div>'; return; }
    const x = p.ext || (p.ext = {});
    const draw = () => {
      el.innerHTML = `<div style="padding:16px 0;color:#e8e8e8;max-width:760px">
        <div style="display:flex;gap:16px;align-items:center">
          <label style="cursor:pointer" title="Bild ändern"><img src="${esc(x.img || '')}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;background:#2a2a2a"><input type="file" accept="image/*" data-f="img" style="display:none"></label>
          <div style="flex:1"><input class="vaf-in" data-f="name" value="${esc(x.name || '')}" placeholder="Name" style="font-size:20px;font-weight:700">
          <div class="vaf-grid" style="margin-top:6px"><input class="vaf-in" data-f="typ" value="${esc(x.typ || '')}" placeholder="Typ (Mann, Frau, Paar …)"><input class="vaf-in" data-f="city" value="${esc(x.city || '')}" placeholder="Ort"></div></div></div>
        <textarea class="vaf-in" data-f="short" rows="2" placeholder="Kurztext" style="margin-top:10px">${esc(x.short || '')}</textarea>
        <textarea class="vaf-in" data-f="texts" rows="6" placeholder="Steckbrief, Beschreibung, Notizen …" style="margin-top:10px">${esc(x.texts || '')}</textarea>
        <label class="vaf-chk"><input type="checkbox" data-f="gone" ${x.gone ? 'checked' : ''}> Profil gelöscht (war auf einer Plattform)</label>
        <div style="margin:10px 0">${fickIcon(p.status ? FSTATES[p.status].i : 0, 18, true)} <select class="vaf-in" data-f="status" style="width:auto">${['', ...Object.keys(FSTATES)].map((k) => `<option value="${k}" ${k === (p.status || '') ? 'selected' : ''}>${k ? FSTATES[k].label : 'Ficken?'}</option>`).join('')}</select></div>
        <div class="vaf-also"><b>Auch auf:</b> ${[...(foreignUrl(p) ? [{ pf: p.main.pf, url: p.main.url, name: p.main.nick }] : []), ...(p.profiles || [])].map(profLink).map((h) => `<span class="vaf-also-i">${h}</span>`).join('')}<button type="button" class="vaf-plus" data-a="prof" title="Profil auf einer anderen Plattform zufügen">+</button></div>
        <h3>Treffen</h3><div>${[...(p.meets || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(meetLine).join('') || '–'}</div>
        <div style="margin-top:10px">${notesBlock(p)}</div>
        <div style="margin-top:8px"><a href="#" data-a="add">+ Treffen eintragen</a> · <a href="/setting/profile#archiv=${encodeURIComponent(p.id)}">Profil-Archiv</a> · <a href="#" data-a="del">Eintrag löschen</a></div></div>`;
      const save = async (what) => { await Fick.put(p); await DB.put('archive', { uid: p.id, nick: x.name, at: now(), reason: what, html: el.innerHTML, hash: '' }); };
      el.querySelectorAll('input[data-f]:not([type=file]):not([type=checkbox]), textarea[data-f]').forEach((i) => i.addEventListener('change', () => { x[i.dataset.f] = i.value.trim(); save(`${i.dataset.f} geändert`); }));
      el.querySelector('[data-f=gone]').addEventListener('change', (e) => { x.gone = e.target.checked ? now() : 0; save('Profil gelöscht'); });
      el.querySelector('[data-f=status]').addEventListener('change', async (e) => { p = await Fick.setStatus(p, e.target.value || null) || p; draw(); });
      el.querySelector('[data-f=img]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const bmp = await createImageBitmap(f); const c = document.createElement('canvas'); const s = 200 / Math.max(bmp.width, bmp.height);
        c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        x.img = c.toDataURL('image/jpeg', 0.8); await save('Profilbild geändert'); draw();
      });
      el.querySelector('[data-a=prof]').onclick = (e) => { e.preventDefault(); addProfileDialog(p, draw); };
      el.querySelector('[data-a=add]').onclick = (e) => { e.preventDefault(); editMeet(p, null); };
      el.querySelector('[data-a=notes]').onclick = (e) => { e.preventDefault(); editNotes(p, draw); };
      el.querySelectorAll('[data-meet]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); editMeet(p, p.meets.find((t) => t.id === a.dataset.meet)); }; });
      el.querySelector('[data-a=del]').onclick = async (e) => { e.preventDefault(); if (W.confirm('Diesen externen Eintrag löschen?')) { await Fick.del(p.id); goHash('fickliste'); } };
    };
    draw();
    Bus.on('fick', async () => { const n = await Fick.get(p.id); if (n && ownView && ownView.kind === 'extern:' + id) { p = n; draw(); } });
  }
  async function newExternal() {
    const p = { id: 'x:' + now().toString(36) + Math.random().toString(36).slice(2, 6), status: null, statusAt: 0, profiles: [], meets: [], history: [{ at: now(), what: 'angelegt' }], created: now(), ext: { name: 'Neuer Eintrag' } };
    await Fick.put(p);
    goHash('extern=' + encodeURIComponent(p.id));
  }

  // ---------- Meine Fickliste ----------
  async function renderFickList(el) {
    ensureStyle();
    const persons = await Fick.all();
    const st = { sort: 'date', dir: -1, member: '', where: '', club: '', from: '', to: '', pfs: [], status: '' };
    try { Object.assign(st, JSON.parse(sessionStorage.getItem('vaf_fl') || '{}')); } catch {}
    if (!Array.isArray(st.pfs)) st.pfs = [];
    delete st.pf;
    const memberOf = async (p) => (pm(p) ? await Members.get(pm(p).uid) : null);
    const rows = [];
    for (const p of persons) {
      const m = await memberOf(p);
      const name = (m && m.nick) || (pm(p) && pm(p).nick) || (p.main && p.main.nick) || (p.ext && p.ext.name) || '?';
      const base = { p, name, del: !!(m && m.del) || !!(p.ext && p.ext.gone), inactive: m && m.active === false, url: pm(p) ? profileUrl(name) : ((p.profiles || []).find((x) => x.pf === OWN_PF && x.url) || {}).url || foreignUrl(p) || '/setting/profile#extern=' + encodeURIComponent(p.id), arch: '/setting/profile#archiv=' + encodeURIComponent(pm(p) ? pm(p).uid : p.id), pfs: uniq([...(p.main && p.main.pf && p.main.pf !== 'poppen' ? [p.main.pf] : []), ...(p.profiles || []).map((x) => x.pf)]),
        badges: uniq([...(foreignUrl(p) ? [p.main.pf + '|'] : []), ...otherProfiles(p).map((x) => `${x.pf}|${x.pf === 'other' ? (x.pfName || '') : ''}`)]) };
      if (!(p.meets || []).length) rows.push({ ...base, t: null });
      for (const t of p.meets || []) rows.push({ ...base, t });
    }
    const clubs = uniq(rows.map((r) => (r.t && r.t.club) || '')).sort();
    const pfOrder = Object.keys(PLATFORMS);
    const pfAll = uniq(rows.flatMap((r) => [...r.pfs, ...(r.t && r.t.link ? [r.t.pf || platformOfUrl(r.t.link)] : [])])).sort((a, b) => pfOrder.indexOf(a) - pfOrder.indexOf(b));
    const counts = Object.fromEntries(Object.keys(FSTATES).map((k) => [k, persons.filter((p) => p.status === k).length]));
    const draw = () => {
      try { sessionStorage.setItem('vaf_fl', JSON.stringify(st)); } catch {}
      let list = rows.filter((r) => {
        if (st.status && r.p.status !== st.status) return false;
        if (st.member && !norm(r.name).includes(norm(st.member))) return false;
        if (st.where && !norm(r.t && r.t.where).includes(norm(st.where))) return false;
        if (st.club) { const c = (r.t && r.t.club) || ''; if (st.club === '(unbekannt)' ? c : c !== st.club) return false; }
        if (st.from && (!r.t || (r.t.date || '') < st.from)) return false;
        if (st.to && (!r.t || (r.t.date || '') > st.to)) return false;
        if (st.pfs.length) {
          const foreign = r.pfs.filter((x) => x !== OWN_PF && x !== 'other');
          const ok = st.pfs.some((f) => f === 'none' ? !foreign.length : r.pfs.includes(f) || (r.t && r.t.pf === f));
          if (!ok) return false;
        }
        return true;
      });
      list.sort((a, b) => st.sort === 'name' ? st.dir * a.name.localeCompare(b.name, 'de') : st.dir * (((a.t && a.t.date) || '').localeCompare((b.t && b.t.date) || '') || a.name.localeCompare(b.name, 'de')));
      el.innerHTML = `<div style="padding:8px 0 40px;color:#e8e8e8">
        <h2 style="color:#fff;margin:4px 0 12px">Meine Fickliste <span style="font-size:12px;font-weight:400;color:#8c8c8c">· Nur für dich sichtbar</span></h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${Object.entries(FSTATES).map(([k, v]) => `<button type="button" class="vaf-tile ${st.status === k ? 'vaf-on' : ''}" data-st="${k}" title="${esc(v.label)}" style="padding:6px 12px">${fickIcon(v.i, 18, true)} <b style="display:inline">${counts[k]}</b></button>`).join('')}</div>
        <div class="vaf-grid" style="grid-template-columns:repeat(6,1fr)">
          <input class="vaf-in" data-f="member" list="vaf-fl-names" placeholder="Mitglied" value="${esc(st.member)}"><datalist id="vaf-fl-names">${uniq(rows.map((r) => r.name)).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          <input class="vaf-in" data-f="where" placeholder="Was (Party, Anlass)" value="${esc(st.where)}">
          <select class="vaf-in" data-f="club"><option value="">Wo: alle Clubs/Orte</option><option value="(unbekannt)" ${st.club === '(unbekannt)' ? 'selected' : ''}>(unbekannt)</option>${clubs.filter(Boolean).map((c) => `<option ${c === st.club ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <input class="vaf-in" type="date" data-f="from" value="${esc(st.from)}" title="von"><input class="vaf-in" type="date" data-f="to" value="${esc(st.to)}" title="bis">
          <div style="position:relative"><button type="button" class="vaf-in" data-a="pfdd" style="text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Plattform: ${st.pfs.length ? st.pfs.map((f) => (f === 'none' ? 'Andere / ohne' : pfLabel(f))).map(esc).join(', ') : 'alle'}</button>
            <div data-a="pfmenu" style="display:none;position:absolute;z-index:50;top:100%;right:0;background:#1f1f1f;border:1px solid #444;border-radius:8px;padding:6px 10px;min-width:190px">
              ${[...pfAll.filter((k) => k !== 'other'), 'none'].map((k) => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0;cursor:pointer"><input type="checkbox" data-pfc="${k}" ${st.pfs.includes(k) ? 'checked' : ''}>${k === 'none' ? 'Andere / ohne' : pfBadge(k) + esc(pfLabel(k))}</label>`).join('')}
              <a href="#" data-a="pfall" style="font-size:12px">alle</a></div></div></div>
        <table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#a6a6a6">
          <th style="cursor:pointer;padding:6px" data-sort="date">Datum ${st.sort === 'date' ? (st.dir < 0 ? '▼' : '▲') : ''}</th><th style="cursor:pointer;padding:6px" data-sort="name">Mitglied ${st.sort === 'name' ? (st.dir < 0 ? '▼' : '▲') : ''}</th><th></th><th>Was</th><th>Wo</th><th>Notiz</th></tr></thead>
          <tbody>${list.map((r, i) => `<tr data-i="${i}" style="border-top:1px solid #2c2c2c;cursor:pointer">
            <td style="padding:6px;white-space:nowrap">${r.t && r.t.date ? deDate(new Date(r.t.date + 'T12:00')) : '–'}</td>
            <td style="padding:6px"><a href="${esc(r.url)}" target="_blank" rel="noopener" class="${r.del ? 'vaf-strike' : ''}" style="${r.inactive ? 'color:#ff7875' : ''}">${esc(r.name)}</a><br><a href="${esc(r.arch)}" style="font-size:12px;color:#a6a6a6">Profil-Archiv</a> · <a href="#" data-also="${i}" style="font-size:12px;color:#a6a6a6">Auch auf …</a>${notesOf(r.p) ? `<div title="${esc(notesOf(r.p))}" style="font-size:12px;color:#8c8c8c;max-width:360px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap">${esc(notesOf(r.p))}</div>` : ''}</td>
            <td style="white-space:nowrap">${fickIcon(r.p.status ? FSTATES[r.p.status].i : 0, 18, true)} ${r.badges.map((b) => { const [pf, n] = b.split('|'); return pfBadge(pf, '', n); }).join('')}</td>
            <td>${esc((r.t && r.t.where) || '')}</td><td>${esc((r.t && r.t.club) || '')}${r.t && r.t.link ? ` <a href="${esc(r.t.link)}" target="_blank" rel="noopener">${pfBadge(r.t.pf || platformOfUrl(r.t.link))}</a>` : ''}</td>
            <td style="color:#a6a6a6">${esc((r.t && r.t.note) || '')}</td></tr>`).join('') || '<tr><td colspan="6" style="padding:12px;color:#8c8c8c">Keine Einträge.</td></tr>'}</tbody></table>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"><button type="button" class="vaf-big" style="width:auto" data-a="ext">+ Externen Fick zufügen</button>
          <button type="button" class="vaf-big" style="width:auto" data-a="exp">Exportieren</button><button type="button" class="vaf-big" style="width:auto" data-a="imp">Importieren</button></div></div>`;
      el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => { st.status = st.status === b.dataset.st ? '' : b.dataset.st; draw(); }));
      el.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('change', () => { st[i.dataset.f] = i.value; draw(); }));
      el.querySelectorAll('[data-sort]').forEach((h) => h.addEventListener('click', () => { if (st.sort === h.dataset.sort) st.dir = -st.dir; else { st.sort = h.dataset.sort; st.dir = h.dataset.sort === 'date' ? -1 : 1; } draw(); }));
      el.querySelectorAll('tr[data-i]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('a')) return; const r = list[+tr.dataset.i]; if (r.t) editMeet(r.p, r.t); else if (!pm(r.p)) goHash('extern=' + encodeURIComponent(r.p.id)); else editMeet(r.p, null); }));
      const dd = el.querySelector('[data-a=pfmenu]');
      el.querySelector('[data-a=pfdd]').onclick = (e) => { e.stopPropagation(); dd.style.display = dd.style.display === 'none' ? '' : 'none'; };
      dd.querySelectorAll('[data-pfc]').forEach((c) => c.addEventListener('change', () => { const k = c.dataset.pfc; st.pfs = c.checked ? uniq([...st.pfs, k]) : st.pfs.filter((x) => x !== k); draw(); el.querySelector('[data-a=pfmenu]').style.display = ''; }));
      dd.querySelector('[data-a=pfall]').onclick = (e) => { e.preventDefault(); st.pfs = []; draw(); };
      el.querySelectorAll('[data-also]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addProfileDialog(list[+a.dataset.also].p, () => renderFickList(el)); }));
      el.querySelector('[data-a=ext]').onclick = () => newExternal();
      el.querySelector('[data-a=exp]').onclick = () => exportFick();
      el.querySelector('[data-a=imp]').onclick = () => importFick().then(() => { hideOwn(); routeSettings(); });
    };
    draw();
  }

  // ---------- Kasten im eigenen Profil ----------
  async function ownProfileBox() {
    if (document.getElementById('vaf-own-fick')) return;
    const stat = [...document.querySelectorAll('main h2')].find((h) => /^Statistiken/.test(h.textContent.trim()));
    if (!stat) return;
    let host = stat; while (host.parentElement && host.parentElement.tagName !== 'MAIN' && host.parentElement.children.length < 3) host = host.parentElement;
    const persons = await Fick.all();
    const counts = Object.fromEntries(Object.keys(FSTATES).map((k) => [k, persons.filter((p) => p.status === k).length]));
    const last = persons.filter(isFickDone).map((p) => ({ p, t: [...(p.meets || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] })).filter((x) => x.t)
      .sort((a, b) => (b.t.date || '').localeCompare(a.t.date || '')).slice(0, 3);
    const box = document.createElement('div');
    box.id = 'vaf-own-fick'; box.className = host.className; box.dataset.vafSkip = '1';
    const rowsH = await Promise.all(last.map(async ({ p, t }) => {
      const img = pm(p) ? await Images.get(pm(p).uid) : (p.ext && p.ext.img) || '';
      const name = (p.main && p.main.nick) || (p.ext && p.ext.name);
      return `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><img src="${esc(img)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;background:#3a3a3a"><a href="${pm(p) ? esc(profileUrl(name)) : esc(foreignUrl(p) || '/setting/profile#extern=' + encodeURIComponent(p.id))}" target="_blank">${esc(name)}</a><span style="color:#a6a6a6">${esc([t.where, t.club].filter(Boolean).join(' · '))} · ${t.date ? deDate(new Date(t.date + 'T12:00')) : ''}</span></div>`;
    }));
    box.innerHTML = `<div><h2>Fickliste <span style="font-size:12px;font-weight:400;color:#8c8c8c">· Nur für dich sichtbar</span></h2></div>
      <div style="display:flex;gap:14px;margin:6px 0 10px">${Object.entries(FSTATES).map(([k, v]) => `<a href="/setting/profile#fickliste" data-st="${k}" title="${esc(v.label)}" style="color:#e8e8e8">${fickIcon(v.i, 18, true)} ${counts[k]}</a>`).join('')}</div>
      <div style="color:#a6a6a6;font-size:12px">Letzte Ficks</div>${rowsH.join('') || '<div style="color:#8c8c8c">–</div>'}
      <a href="/setting/profile#fickliste" style="display:inline-block;margin-top:8px">Zu meiner Fickliste</a>`;
    box.querySelectorAll('[data-st]').forEach((a) => a.addEventListener('click', () => { try { sessionStorage.setItem('vaf_fl', JSON.stringify({ status: a.dataset.st })); } catch {} }));
    host.before(box);
  }

  // ---------- Export / Import mit automatischem Verknüpfen ----------
  async function cryptKey(pass, salt) {
    const base = await SUB.importKey('raw', new TextEncoder().encode(norm(pass)), 'PBKDF2', false, ['deriveKey']);
    return SUB.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function encryptJSON(obj, pass) {
    const salt = SUB.rnd(new Uint8Array(16)), iv = SUB.rnd(new Uint8Array(12));
    const key = await cryptKey(pass, salt);
    const data = new Uint8Array(await SUB.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
    let bin = ''; for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { alg: 'AES-GCM/PBKDF2', salt: b64(salt), iv: b64(iv), data: btoa(bin) };
  }
  async function decryptJSON(enc, pass) {
    const key = await cryptKey(pass, unb64(enc.salt));
    const plain = await SUB.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv) }, key, unb64(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function exportFick() {
    const me = Me.get() || await loadMe();
    const persons = await Fick.all();
    for (const p of persons) for (const x of p.profiles || []) { if (isDead(x)) x.dead = true; delete x.deleted; delete x.gone; }
    for (const p of persons) if (pm(p)) {
      const m = await Members.get(pm(p).uid);
      if (!(m && m.nick)) continue;
      if (p.main && (!p.main.pf || p.main.pf === 'poppen')) p.main.nick = m.nick;           // poppen ist Hauptprofil
      else for (const x of p.profiles || []) if (x.pf === 'poppen' && String(x.uid) === String(m.uid)) x.name = m.nick;   // JOYclub-Hauptprofil bleibt
    }
    const payload = { format: 'fickliste', version: 1, platform: 'poppen', exported: new Date().toISOString(), persons };
    const enc = await encryptJSON(payload, me.nick);
    download(`fickliste-poppen-${stamp()}.json`, JSON.stringify({ format: 'fickliste-enc', platform: 'poppen', account: me.nick, ...enc }));
    toast(`${persons.length} Einträge exportiert (verschlüsselt mit deinem Nick).`);
  }
  async function readFickFile(text) {
    let j = JSON.parse(text);
    if (j.format === 'fickliste-enc' || j.alg) {
      let pass = (Me.get() || {}).nick || '';
      for (let i = 0; i < 3; i++) {
        try { return await decryptJSON(j, pass); }
        catch { pass = W.prompt(`Entschlüsseln fehlgeschlagen. Mit welchem Nick wurde die Datei erstellt?${j.account ? ` (Datei von: ${j.account})` : ''}`, j.account || ''); if (!pass) return null; }
      }
      return null;
    }
    return j;
  }
  async function importFick(...a) { return Prio.run('Fickliste-Import', () => importFick_(...a)); }
  async function importFick_() {
    const text = await pickFile();
    if (!text) return;
    let data;
    try { data = await readFickFile(text); } catch (e) { toast('Datei nicht lesbar: ' + esc(e.message)); return; }
    if (!data || !Array.isArray(data.persons)) { toast(Array.isArray(data && data.templates) ? 'Das ist eine Textvorlagen-Datei (Fickliste → Meine Fickliste, Textvorlagen → Messenger).' : 'Keine Fickliste in der Datei.'); return; }
    const from = data.platform || 'joyclub';
    const local = await Fick.all();
    const mainLink = (p) => (!p.main ? null : pm(p) ? { pf: 'poppen', url: 'https://www.poppen.de' + pathOfName(pm(p).nick || '') } : p.main.url ? { pf: p.main.pf, url: p.main.url } : null);
    const keysOf = (p) => uniq([...(p.profiles || []), mainLink(p)].map(linkKey).filter(Boolean));
    const index = new Map();
    for (const p of local) for (const k of keysOf(p)) { if (!index.has(k)) index.set(k, new Set()); index.get(k).add(p.id); }
    const sum = { neu: 0, verknuepft: 0, konflikt: 0, gleich: 0 };
    for (const ip0 of data.persons) {
      const ip = clone(ip0);
      ip.origin = ip.origin || from;
      // Herkunfts-Profil als Link aufnehmen
      const hits = new Set();
      for (const k of keysOf(ip)) for (const id of index.get(k) || []) hits.add(id);
      let target = null;
      if (hits.size === 1) target = local.find((p) => p.id === [...hits][0]);
      else if (hits.size > 1) {
        sum.konflikt++;
        const names = [...hits].map((id) => { const p = local.find((x) => x.id === id); return (p.main && p.main.nick) || (p.ext && p.ext.name) || id; });
        const v = await ask('Import – Konflikt', `<p>Der Eintrag <b>${esc((ip.main && ip.main.nick) || (ip.ext && ip.ext.name) || '?')}</b> passt zu mehreren Personen: ${names.map(esc).join(', ')}.</p>`, [
          { label: 'Zusammenführen', value: 'merge', primary: true }, { label: 'Getrennt lassen', value: 'sep', focus: true, cancel: true }]);
        if (v === 'merge') { target = local.find((p) => p.id === [...hits][0]); for (const id of [...hits].slice(1)) { const o = local.find((p) => p.id === id); mergeFick(target, o); await Fick.del(id); } }
      }
      if (target) {
        const before = JSON.stringify([target.status, target.meets, target.profiles]);
        mergeFick(target, ip);
        if (JSON.stringify([target.status, target.meets, target.profiles]) === before) sum.gleich++; else { sum.verknuepft++; await Fick.put(target); }
      } else if (!hits.size || hits.size > 1) {
        const np = { ...ip, id: from === 'poppen' && ip.id ? ip.id : `i:${from}:${(ip.id || Math.random().toString(36).slice(2))}`, imported: from };
        if (!pm(np)) np.ext = np.ext || { name: (np.main && np.main.nick) || '?' };
        await Fick.put(np); local.push(np); sum.neu++;
        for (const k of keysOf(np)) { if (!index.has(k)) index.set(k, new Set()); index.get(k).add(np.id); }
      }
    }
    // Importierte Einträge mit poppen-Profil gleich verbinden, wenn das Mitglied bekannt ist (sonst beim nächsten Profilaufruf)
    let adopted = 0;
    for (const q of await Fick.all()) {
      if (pm(q)) continue;
      for (const x of (q.profiles || []).filter((y) => y.pf === 'poppen' && y.url)) {
        const mm = /poppen\.de\/p\/([^/?#]+)/i.exec(x.url);
        const nick = mm ? decodeURIComponent(mm[1]) : '';
        const mem = x.uid ? await Members.get(x.uid) : nick ? await Members.byNick(nick) : null;
        if (mem && await Fick.adopt(mem.uid, mem.nick || nick)) { adopted++; break; }
      }
    }
    if (adopted) sum.verknuepft += adopted;
    await ask('Import fertig', `<div class="vaf-stats"><span>Neu</span><b>${sum.neu}</b><span>Automatisch verknüpft</span><b>${sum.verknuepft}</b><span>Konflikte</span><b>${sum.konflikt}</b><span>Unverändert</span><b>${sum.gleich}</b></div>`, [{ label: 'OK', value: 1, primary: true, focus: true }]);
  }
  // b in a zusammenführen: Status = zuletzt geändert, Treffen und Profile vereinigen
  function mergeFick(a, b) {
    // Anmerkungen: notes (sonst joy.notes); neuerer Stand gewinnt, leere Seite übernimmt
    {
      const bn = b.notes != null ? b.notes : (b.joy && b.joy.notes != null ? b.joy.notes : null);
      if (bn != null) {
        const an = notesOf(a);
        if (!an || ((b.notesAt || 0) > (a.notesAt || 0) && bn !== an)) {
          if (String(bn).length > NOTES_MAX) log(`Anmerkungen gekürzt (${String(bn).length} → ${NOTES_MAX} Zeichen)`);
          a.notes = String(bn).slice(0, NOTES_MAX); a.notesAt = b.notesAt || a.notesAt || now(); if (b.notesBy) a.notesBy = b.notesBy; delete a.note;
        }
      }
    }
    if ((b.statusAt || 0) > (a.statusAt || 0)) { a.status = b.status; a.statusAt = b.statusAt; }
    const mk = (t) => `${t.pf || ''}|${t.uid || ''}|${t.date || ''}|${norm(t.where)}|${norm(t.club)}|${linkKey({ url: t.link })}`;
    const seenM = new Set((a.meets || []).map(mk));
    a.meets = [...(a.meets || [])];
    for (const t of b.meets || []) if (!seenM.has(mk(t))) { a.meets.push({ ...t, id: t.id || 'm' + Math.random().toString(36).slice(2) }); seenM.add(mk(t)); }
    const seenP = new Set((a.profiles || []).map(linkKey));
    a.profiles = [...(a.profiles || [])];
    for (const p of b.profiles || []) {
      const k = linkKey(p);
      if (!k) continue;
      if (!seenP.has(k)) { a.profiles.push({ ...p }); seenP.add(k); continue; }
      const x = a.profiles.find((y) => linkKey(y) === k);
      if ('status' in p && (p.statusAt || 0) > (x.statusAt || 0)) { x.status = p.status; x.statusAt = p.statusAt; }
      if ('sync' in p && !('sync' in x)) x.sync = p.sync;
      for (const f of Object.keys(p)) if (!(f in x)) x[f] = p[f];          // unbekannte Felder durchreichen
    }
    if (b.main && !a.main) a.main = { ...b.main };
    else if (b.main && b.main.url && a.main && (b.main.pf || 'poppen') !== (a.main.pf || 'poppen')) {
      // fremdes Hauptprofil der anderen Seite als Profil behalten
      const k = linkKey(b.main);
      if (k && !seenP.has(k)) { a.profiles.push({ pf: b.main.pf, url: b.main.url, name: b.main.nick || '', uid: b.main.uid, main: true }); seenP.add(k); }
    }
    for (const f of Object.keys(b)) if (!(f in a)) a[f] = clone(b[f]);      // unbekannte Felder durchreichen
    a.history = [...(a.history || []), ...(b.history || []).map((h) => ({ ...h, what: h.what + ' (importiert)' }))].sort((x, y) => x.at - y.at).slice(-200);
    if (b.ext && !a.main) a.ext = { ...(b.ext || {}), ...(a.ext || {}) };
    return a;
  }
  // =====================================================================================
  // Figur („Moppel-Liebhaber“) – alles hier greift nur, wenn in den Einstellungen
  // „Benutzer ist Moppel-Liebhaber“ an ist; sonst entfällt es ersatzlos.
  //  - poppens „Kurvig“ heißt „Mollig“ (damit es nicht mit der eigenen Stufe „Kurvig“ verwechselt wird)
  //  - Stufen nach BMI (drei Grenzen, einstellbar): 0 = „Plus-Size“ (poppens Bezeichnung), 1–3 = eigene Bezeichnungen
  //  - Mitgliedersuche: zusätzliche Figur-Optionen für die Stufen 1–3 (sucht „Plus-size“ und filtert nach berechnetem BMI),
  //    Badges in Stufenfarbe, Sortierung „BMI“ (nur dann wird umsortiert)
  //  - Vermessung über die Profilangaben jeder sichtbaren Trefferkarte (gedrosselt)
  // =====================================================================================
  const MOP_COLORS = ['#e0473a', '#e8a23a', '#a9c93a', '#3fbf5f'];   // Stufe 0 rot → Stufe 3 grün
  const MOP_STAGE0 = 'Plus-Size';
  const mop = (s = S()) => s.moppel || DEFAULTS.moppel;
  const mopOn = (s = S()) => !!mop(s).on;
  const mopLabel = (st, plural = false, s = S()) => (st <= 0 ? MOP_STAGE0 : (mop(s).labels[(st - 1) * 2 + (plural ? 1 : 0)] || ''));
  // Stufe 0–3 nach BMI; −1 = unter „Plus-Size“ (keine Einstufung)
  function mopStage(bmi, s = S()) {
    if (!(bmi > 0)) return -1;
    const b = mop(s).bmi;
    if (bmi >= b[2]) return 3;
    if (bmi >= b[1]) return 2;
    if (bmi >= b[0]) return 1;
    return 0;
  }
  const FIG_RENAME = { Kurvig: 'Mollig' };

  function renameTextNodes(root) {
    if (!mopOn() || !root || (root.closest && root.closest('#vaf-set, .vaf-ov, .vaf-xxl'))) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue.trim();
      if (!FIG_RENAME[t]) continue;
      const pe = n.parentElement;
      if (pe && pe.closest('input, textarea, [contenteditable], #vaf-set, .vaf-ov, .vaf-xxl, .vaf-mopopt')) continue;
      n.nodeValue = n.nodeValue.replace(t, FIG_RENAME[t]);
    }
    if (root.querySelectorAll) for (const e of root.querySelectorAll('[title="Kurvig"]')) if (!e.closest('#vaf-set, .vaf-mopopt')) e.setAttribute('title', FIG_RENAME.Kurvig);
  }

  // ---------- Zusatzoptionen in der Figur-Klappliste der Suche ----------
  // G.figstage: 0 = keine eigene Stufe gewählt, 1–3 = eigene Stufe (Suche selbst läuft mit „Plus-size“)
  const figStage = () => (location.pathname.startsWith('/search') && mopOn() ? (G.get('figstage', 0) || 0) : 0);
  function mopOptions() {
    if (!mopOn() || !location.pathname.startsWith('/search')) return;
    for (const dd of document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')) {
      const opts = [...dd.querySelectorAll('.ant-select-item-option')];
      const plus = opts.find((o) => !o.classList.contains('vaf-mopopt') && /^plus-?size$/i.test(o.textContent.trim()));
      if (!plus || !opts.some((o) => /^Schlank$/.test(o.textContent.trim()))) continue;
      if (!dd.querySelector('.vaf-mopopt')) {
        let after = plus;
        for (let st = 1; st <= 3; st++) {
          const q = plus.cloneNode(true);
          q.classList.add('vaf-mopopt'); q.dataset.st = String(st);
          q.classList.remove('ant-select-item-option-selected', 'ant-select-item-option-active');
          q.setAttribute('title', mopLabel(st));
          const c = q.querySelector('.ant-select-item-option-content'); if (c) c.textContent = mopLabel(st);
          q.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
          q.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            G.set('figstage', st);
            const p2 = [...dd.querySelectorAll('.ant-select-item-option:not(.vaf-mopopt)')].find((o) => /^plus-?size$/i.test(o.textContent.trim()));
            if (p2) { p2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); p2.click(); }
            setTimeout(mopDisplay, 100);
          }, true);
          after.after(q); after = q;
        }
        for (const o of opts) if (!o.classList.contains('vaf-mopopt')) o.addEventListener('click', () => G.set('figstage', 0), true);
      }
      mopFitList(dd, plus);
      const st = figStage();
      for (const q of dd.querySelectorAll('.vaf-mopopt')) q.classList.toggle('ant-select-item-option-selected', +q.dataset.st === st);
      if (st) plus.classList.remove('ant-select-item-option-selected');
    }
    mopDisplay();
  }
  // Klappliste so hoch machen, dass alle Einträge samt Zusatzstufen erreichbar sind.
  // poppens virtuelle Liste setzt ihre Höhe beim Neuzeichnen zurück → bei JEDEM Durchlauf per Klasse + CSS !important,
  // Höhe aus der aktuellen Zeilenzahl (höchstens 60 % des Fensters, darüber scrollbar).
  function mopFitList(dd, plus) {
    try {
      if (!document.getElementById('vaf-mopdd-style')) {
        const st = document.createElement('style'); st.id = 'vaf-mopdd-style';
        st.textContent = `.vaf-mopdd .rc-virtual-list-holder{max-height:var(--vaf-mopdd-h)!important;height:auto!important;overflow-y:auto!important;overflow-anchor:none}
.vaf-mopdd .rc-virtual-list-holder-inner{height:auto!important;transform:none!important;position:static!important}
.vaf-mopdd .rc-virtual-list-holder>div{height:auto!important}
.vaf-mopdd .rc-virtual-list-scrollbar{display:none!important}`;
        document.head.appendChild(st);
      }
      const rows = dd.querySelectorAll('.ant-select-item-option').length;
      const ih = (plus && plus.offsetHeight) || 32;
      const want = Math.min(Math.round((W.innerHeight || 800) * 0.6), rows * ih + 8);
      dd.classList.add('vaf-mopdd');
      if (dd.style.getPropertyValue('--vaf-mopdd-h') !== want + 'px') dd.style.setProperty('--vaf-mopdd-h', want + 'px');
    } catch {}
  }
  function mopDisplay() {
    const st = figStage(); if (!st) return;
    for (const it of document.querySelectorAll('.ant-select-selection-item')) {
      if (/^plus-?size$/i.test(it.textContent.trim())) { it.textContent = mopLabel(st); it.title = `${mopLabel(st)} (sucht „Plus-size“ und blendet aus, wer nach BMI darunter liegt)`; }
    }
  }

  // ---------- Sortierung „BMI“ in der Suche (zwischen „Entfernung“ und „Alter“) ----------
  const figSortOn = () => location.pathname.startsWith('/search') && mopOn() && !!G.get('figsort', false);
  function mopSortRadio() {
    if (!mopOn() || !location.pathname.startsWith('/search')) return;
    const labels = [...document.querySelectorAll('main label.ant-radio-button-wrapper')];
    const dist = labels.find((l) => norm(l.textContent) === 'entfernung');
    if (!dist) return;
    let mine = dist.parentElement.querySelector('.vaf-bmisort');
    if (!mine) {
      mine = dist.cloneNode(true);
      mine.classList.add('vaf-bmisort');
      mine.classList.remove('ant-radio-button-wrapper-checked');
      const inp = mine.querySelector('input'); if (inp) { inp.removeAttribute('name'); inp.value = 'vaf-bmi'; inp.checked = false; }
      const lb = mine.querySelector('.ant-radio-button-label'); if (lb) lb.textContent = 'BMI';
      mine.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (G.get('figsort', false)) return;
        G.set('figsort', true);
        // poppen neu suchen lassen (beliebige andere Sortierung) – die Antwort sortiert das Skript nach BMI um
        const others = [...dist.parentElement.querySelectorAll('label.ant-radio-button-wrapper:not(.vaf-bmisort)')];
        const target = others.find((l) => !l.classList.contains('ant-radio-button-wrapper-checked')) || others[0];
        if (target) target.click();
        setTimeout(mopSortPaint, 50);
      }, true);
      dist.after(mine);
      for (const l of dist.parentElement.querySelectorAll('label.ant-radio-button-wrapper:not(.vaf-bmisort)')) l.addEventListener('click', (e) => { if (e.isTrusted) G.set('figsort', false); setTimeout(mopSortPaint, 50); }, true);
    }
    mopSortPaint();
  }
  function mopSortPaint() {
    const mine = document.querySelector('.vaf-bmisort'); if (!mine) return;
    const on = figSortOn();
    mine.classList.toggle('ant-radio-button-wrapper-checked', on);
    const sp = mine.querySelector('.ant-radio-button'); if (sp) sp.classList.toggle('ant-radio-button-checked', on);
    for (const l of mine.parentElement.querySelectorAll('label.ant-radio-button-wrapper:not(.vaf-bmisort)')) {
      l.style.opacity = '';
      if (on) { l.classList.remove('ant-radio-button-wrapper-checked'); const s2 = l.querySelector('.ant-radio-button'); if (s2) s2.classList.remove('ant-radio-button-checked'); }
    }
  }

  // ---------- Körpermaße im Gedächtnis ----------
  const bmiOf = (h, w) => w / ((h / 100) ** 2);
  const bodyOne = (b, s) => {
    if (!b || !(b.h > 0) || now() - b.at > s.expert.bodyValidDays * DAY) return null;
    const lo = bmiOf(b.h, b.wlo), hi = bmiOf(b.h, b.whi);
    return { h: b.h, wlo: b.wlo, whi: b.whi, bmi: lo, exact: b.wlo === b.whi, lo, hi };
  };
  // Wen sucht das eigene Profil bei einem gemischten Paar (bzw. als Symbol)? → 'w' | 'm'
  //  Mann/Trans: Hetero/Bi/keine Angabe → Frau, Gay → Mann · Frau: Hetero/Bi/keine Angabe → Mann, Gay → Frau
  //  Paar (Frau+Mann / Frau+Frau) → Frau · Männer-Paar → Mann · Nicht-binär → Frau, wenn „Paar (Frau)“ angehakt, sonst Mann
  function mopSeek(s = S()) {
    const me = Me.get(); const g = (me && me.g) || [];
    if (g.length >= 2) return g.every((x) => x === 'm') ? 'm' : 'w';
    const st = (G.get('my_sextype', []) || [])[0];
    const gay = st === 1;
    const t = g[0];
    if (t === 'w') return gay ? 'w' : 'm';
    if (t === 'tv') return mop(s).types.includes('pw') ? 'w' : 'm';
    return gay ? 'm' : 'w';                       // Mann, Trans, unbekannt
  }
  // Welche Person(en) eines Mitglieds werden eingestuft? → { idx: [..], show: Index | 'max' } oder null
  function mopPick(m, s = S()) {
    const g = (m && m.g) || [];
    const ty = mop(s).types;
    if (g.length <= 1) return g.length && ty.includes(g[0]) ? { idx: [0], show: 0 } : (g.length ? null : { idx: [0], show: 0 });
    const iw = g.indexOf('w'), im = g.indexOf('m');
    if (iw >= 0 && im >= 0) {                     // gemischtes Paar
      const idx = []; if (ty.includes('pw')) idx.push(iw); if (ty.includes('pm')) idx.push(im);
      if (!idx.length) return null;
      const want = mopSeek(s) === 'w' ? iw : im;
      return { idx, show: idx.includes(want) ? want : idx[0] };
    }
    // gleichgeschlechtliches Paar: Haken des Geschlechts entscheidet, angezeigt wird der höhere Wert
    return ty.includes(g[0]) ? { idx: g.map((_, i) => i), show: 'max' } : null;
  }
  function bodyInfo(m, s = S()) {
    if (!m || (!m.body && !m.bodyS)) return null;
    const pk = mopPick(m, s);
    if (!pk) return null;
    if (!m.body) { const b = bodyOne(m.bodyS, s); return b ? { ...b, pair: true } : null; }   // Paar über Suchfilter vermessen: einer von beiden
    if (pk.show === 'max') { const all = pk.idx.map((i) => bodyOne(m.body[i], s)).filter(Boolean); return all.sort((a, b) => b.lo - a.lo)[0] || null; }
    return bodyOne(m.body[pk.show], s);
  }
  // Profiltyp eines Mitglieds für die Moppel-Regeln
  const mopTypeOk = (m, s = S()) => !!mopPick(m, s);
  // hat sich (eine eingestufte Person) selbst als „Plus-size“ eingetragen?
  const mopPlusDeclared = (m, s = S()) => { const pk = mopPick(m, s); return !!(pk && m.figc && pk.idx.some((i) => m.figc[i] === 6)); };

  // ---------- Suchantworten filtern / umsortieren ----------
  let lastFig = null;   // { stage }
  const figPlus = (body) => !!(body && Array.isArray(body.figure) && body.figure.includes(6));
  onApi(/^user\/search$/, null, (data, info) => {
    if (!mopOn() || !location.pathname.startsWith('/search')) { lastFig = null; return null; }
    const users = (data && data.users) || [];
    const st = figPlus(info.body) ? figStage() : 0;
    lastFig = { stage: st };
    Measure.want(users);
    const sortBmi = figSortOn();
    if (!st && !sortBmi) return null;
    const cache = Members.cached();
    const b = mop().bmi;
    const rows = users.map((u, i) => { const bi = bodyInfo(cache.get(String(u.uid))); return { u, i, bmi: bi ? bi.lo : null, w: bi ? bi.wlo : 0 }; });
    // nur herausfiltern, wer nach Berechnung NICHT mindestens die gewählte Stufe erreicht (unbekannt bleibt drin)
    const kept = st ? rows.filter((x) => x.bmi == null || x.bmi >= b[st - 1]) : rows;
    if (sortBmi) kept.sort((x, y) => (x.bmi == null) - (y.bmi == null) || (y.bmi || 0) - (x.bmi || 0) || y.w - x.w || x.i - y.i);
    return { ...data, users: kept.map((x) => x.u) };
  });

  // ---------- Vermessung OHNE Profilbesuch: über die Suchfilter Größe/Gewicht ----------
  // Profilabfragen (user/info) zählen bei poppen als Besuch. Deshalb wird nur noch über die Suche eingegrenzt:
  //  1) Größe: Bereich 130–220 halbieren, leere Bereiche überspringen, bis zu einer genauen Größe h (Zähl-Abfragen, 1 Treffer je Seite).
  //  2) Gewicht je Größe: Bereich in Bänder an den BMI-Stufengrenzen teilen, Bänder mit Treffern weiter halbieren,
  //     bis die Breite höchstens 1 BMI-Punkt ist. Wer in einem Blatt auftaucht, bekommt h und [wlo, whi].
  //  Taucht jemand in zwei getrennten Gewichtsbändern auf (Angabe fehlt → Filter greift nicht), gilt das Gewicht als unbekannt.
  //  Ist eine Zelle schon vollständig vermessen (alle Treffer mit gültiger, genauerer Messung), wird nicht weiter geteilt.
  const Measure = { want() {} };     // früher: Vermessung sichtbarer Trefferkarten über user/info (Profilbesuch!) – entfällt
  const MEAS_W0 = 30, MEAS_W1 = 300, MEAS_H0 = 130, MEAS_H1 = 220;
  const wAt = (bmi, h) => Math.ceil(bmi * (h / 100) ** 2);
  async function searchCount(payload, ctx) {
    await SearchGuard.ensureState();
    await SearchGuard.wait(ctx);
    if (ctx.stop()) return 0;
    G.set('search_dirty', true);
    const d = await apiPost('user/search', { ...payload, page: 1, limit: 1 });
    return (d && d.total) || 0;
  }
  async function searchList(payload, ctx) {
    const out = [];
    await searchAll(payload, ctx, async (users) => { out.push(...users); });
    return out;
  }
  // base: Suchanfrage (genders, Alter, Ort …). opts: { couple: bool, src, onPerson(m) }
  async function measureGrid(base, ctx, opts = {}) {
    const s = S(), cuts = [...mop(s).bmi].sort((x, y) => x - y);
    const stat = { queries: 0, heights: 0, measured: 0, unknownW: 0, skipped: 0 };
    // gedrosselt: zwischen zwei Suchabfragen 0,5–1 s (viele kleine Abfragen sollen poppen nicht auffallen)
    const q = async (p) => { stat.queries++; const r = await p; await sleep(500 + Math.random() * 500); return r; };
    // 1) Größen mit Treffern finden
    const heights = [];
    const hRec = async (lo, hi) => {
      if (ctx.stop()) return;
      const n = await q(searchCount({ ...base, size_min: lo, size_max: hi, weight_min: 0, weight_max: 300 }, ctx));
      if (!n) return;
      if (lo === hi) { heights.push(lo); return; }
      const mid = (lo + hi) >> 1;
      await hRec(lo, mid); await hRec(mid + 1, hi);
    };
    ctx.phase && ctx.phase('Vermessung: Größen eingrenzen …');
    await hRec(MEAS_H0, MEAS_H1);
    stat.heights = heights.length;
    // 2) je Größe Gewichtsbänder
    for (let hi = 0; hi < heights.length && !ctx.stop(); hi++) {
      const h = heights[hi];
      ctx.outer && ctx.outer(hi, heights.length);
      ctx.phase && ctx.phase(`Vermessung: ${h} cm`);
      const bmiW = (h / 100) ** 2;                 // 1 BMI-Punkt in kg bei dieser Größe
      const bounds = cuts.map((c) => wAt(c, h)).filter((w) => w > MEAS_W0 && w <= MEAS_W1);
      const seenIn = new Map();                    // uid → [{wlo, whi}] (Blätter)
      const users = new Map();
      const leafW = Math.max(1, Math.ceil(bmiW));    // Zielbreite ≈ 1 BMI-Punkt
      const w25 = bounds.length ? bounds[0] : MEAS_W1 + 1;
      const leaf = (l, w0, w1) => { for (const u of l) { const k = String(u.uid); if (!seenIn.has(k)) seenIn.set(k, []); seenIn.get(k).push({ wlo: w0, whi: w1 }); } };
      const wRec = async (w0, w1, list) => {
        if (ctx.stop() || w0 > w1) return;
        const l = list || await q(searchList({ ...base, size_min: h, size_max: h, weight_min: w0, weight_max: w1 }, ctx));
        if (!l.length) return;
        for (const u of l) users.set(String(u.uid), u);
        const inner = bounds.find((b) => b > w0 && b <= w1);
        if (!inner && w1 < w25) { leaf(l, w0, w1); return; }          // unter der ersten Stufe: Genauigkeit egal
        const narrow = w1 - w0 + 1 <= leafW;
        // schon bekannt und genauer als dieses Band? → nicht weiter teilen
        if (!inner && !narrow) {
          const cache = Members.cached();
          const allKnown = l.every((u) => { const m = cache.get(String(u.uid)); const b0 = m && m.body && m.body.find((x) => x && x.h === h); return b0 && b0.wlo >= w0 && b0.whi <= w1 && b0.whi - b0.wlo + 1 <= leafW && now() - b0.at < s.expert.bodyValidDays * DAY; });
          if (allKnown) { stat.skipped += l.length; return; }
        }
        if (!inner && (narrow || w0 === w1)) { leaf(l, w0, w1); return; }
        if (!inner) {
          // viele Treffer in einem breiten Band: alle Blätter direkt abfragen ist günstiger als Halbieren
          const nLeaves = Math.ceil((w1 - w0 + 1) / leafW);
          if (nLeaves <= 2 * l.length * Math.log2(nLeaves)) {
            for (let a = w0; a <= w1 && !ctx.stop(); a += leafW) { const b = Math.min(w1, a + leafW - 1); const ll = await q(searchList({ ...base, size_min: h, size_max: h, weight_min: a, weight_max: b }, ctx)); if (ll.length) leaf(ll, a, b); }
            return;
          }
        }
        const mid = inner ? inner - 1 : (w0 + w1) >> 1;
        await wRec(w0, mid); await wRec(mid + 1, w1);
      };
      await wRec(MEAS_W0, MEAS_W1);
      for (const [uid, u] of users) {
        if (ctx.stop()) break;
        if (opts.keep && !opts.keep(u)) continue;
        const leaves = seenIn.get(uid) || [];
        let prevBi = null;
        try { const mp0 = Members.cached().get(uid) || await Members.get(uid).catch(() => null); prevBi = mp0 ? bodyInfo(mp0) : null; } catch {}
        const m0 = await seen(u, opts.src || 'Vermessung', { images: false });
        if (!m0) continue;
        if (leaves.length === 1) {
          const { wlo, whi } = leaves[0];
          const rec = { h, wlo, whi, bmi: Math.round(wlo / bmiW * 10) / 10, at: now(), src: 'Suche' };
          await Members.update(uid, (x) => {
            const g = x.g || [];
            if (opts.couple || g.length >= 2) { x.bodyS = rec; }                   // Paar: wem die Werte gehören, ist unklar
            else {
              const old = Array.isArray(x.body) ? x.body[0] : null;
              const oldOk = old && old.src === 'Profil' && old.h === h && old.wlo >= wlo && old.whi <= whi && now() - old.at < s.expert.bodyValidDays * DAY;
              if (!oldOk) x.body = [rec];
            }
            if (opts.figc && !(g.length >= 2)) x.figc = [opts.figc];
            delete x.bodyUnk;
          });
          stat.measured++;
        } else if (!leaves.length || leaves.length > 1) {
          stat.unknownW++;
          await Members.update(uid, (x) => { if (!x.body && !x.bodyS) x.bodyUnk = now(); if (opts.figc && !((x.g || []).length >= 2)) x.figc = [opts.figc]; });
        }
        if (opts.onPerson) { try { await opts.onPerson(await Members.get(uid), { known: !!prevBi, fresh: leaves.length === 1 && !prevBi }); } catch {} }
      }
      try { G.set('xxl_rev', now()); } catch {}
    }
    ctx.outer && ctx.outer(heights.length, heights.length);
    return stat;
  }

  // ---------- Badges auf der Suchseite ----------
  async function markSearchFig() {
    const on = mopOn() && location.pathname.startsWith('/search');
    if (!on) { for (const b of document.querySelectorAll('.vaf-fig')) b.remove(); return; }
    const st = (lastFig && lastFig.stage) || 0;
    const lim = st ? mop().bmi[st - 1] : 0;
    for (const x of cardsOn(document)) {
      const m = x.uid ? await Members.get(x.uid) : await Members.byNick(x.nick);
      const bi = bodyInfo(m);
      let b = x.card.querySelector('.vaf-fig');
      // ausgefilterte Treffer komplett entfernen (kein leerer Platzhalter im Raster)
      if (st && bi && bi.lo < lim) { try { (x.card.closest('[data-index]') || x.card).remove(); } catch {} continue; }
      const stage = bi ? mopStage(bi.lo) : -1;
      if (!bi || stage < 0 || !mopTypeOk(m) || (stage === 0 && !mopPlusDeclared(m))) { if (b) b.remove(); continue; }   // Stufe 0 nur bei „Plus-size“-Angabe
      if (!b) { b = document.createElement('div'); b.className = 'vaf-fig vaf-mark'; (x.host || x.card).prepend(b); }
      // nur bei Änderung schreiben – sonst löst jedes Neuschreiben den Seitenbeobachter erneut aus (Endlosschleife)
      const txt = `${mopLabel(stage)} · BMI ${Math.floor(bi.lo)}${bi.exact ? '' : '+'}`;
      if (b.textContent !== txt) b.textContent = txt;
      const ttl = `${bi.h} cm · ${bi.exact ? bi.wlo : `${bi.wlo}–${bi.whi}`} kg`;
      if (b.title !== ttl) b.title = ttl;
      const css = `background:${MOP_COLORS[stage]};color:#fff`;
      if (b.dataset.css !== css) { b.style.cssText = css; b.dataset.css = css; }
    }
  }

  function initFigur() {
    renameTextNodes(document.body);
    let t = null;
    new MutationObserver((muts) => {
      if (mopOn()) for (const mu of muts) for (const n of mu.addedNodes) { if (n.nodeType === 1) renameTextNodes(n); else if (n.nodeType === 3 && n.parentElement) renameTextNodes(n.parentElement); }
      clearTimeout(t); t = setTimeout(() => { mopOptions(); mopSortRadio(); markSearchFig(); }, 200);
    }).observe(document.body, { childList: true, subtree: true, characterData: false });
  }
  // =====================================================================================
  // „Anschreibbar“: Darf das eigene Profil diesem Mitglied eine Nachricht schicken?
  //  poppen prüft beim Öffnen des Messengers POST messenger/p2p/permission { group_id: uid, nickname }:
  //  code 0 = ja, code 20903 = Nachrichtenfilter („Du kannst nur einen Sticker senden“).
  //  Gespeichert je EIGENEM Profil (m.msg[eigeneUid] = { ok, code, at }), weil die Antwort vom Absender abhängt.
  //  Passiv: jede Prüfung der Seite wird mitgeschrieben. Aktiv: gedrosselt für Mitglieder ab „Plus-Size“, die keine
  //  Ignorier-Kriterien erfüllen (Figur-Messung, XXL-Suche) und bei Bedarf für den Regel-Editor; nach 30 Tagen erneut.
  // =====================================================================================
  const MSG_FILTER_CODE = 20903;
  const MSG_TTL = 30 * DAY;
  function msgOf(m) { const me = Me.uid(); return (m && m.msg && me && m.msg[me]) || null; }
  async function msgRecord(uid, ok, code) {
    const me = Me.uid(); uid = String(uid || '');
    if (!me || !/^\d+$/.test(uid)) return;
    await Members.update(uid, (x) => { x.msg = x.msg || {}; x.msg[me] = { ok: !!ok, code: code || 0, at: now() }; });
  }
  function installMsgHooks() {
    onApi(/^messenger\/p2p\/permission$/, (d, info) => { const b = info.body || {}; if (b.group_id) msgRecord(b.group_id, true, 0); });
    onApiErr(/^messenger\/p2p\/permission$/, (j, info) => { const b = info.body || {}; if (b.group_id && j.code === MSG_FILTER_CODE) msgRecord(b.group_id, false, j.code); });
  }
  // eine Prüfung (Ergebnis true/false, null = unbekannt)
  async function msgCheck(uid, nick) {
    try { await apiPost('messenger/p2p/permission', { group_id: String(uid), nickname: nick || '' }); await msgRecord(uid, true, 0); return true; }
    catch (e) { if (e && e.code === MSG_FILTER_CODE) { await msgRecord(uid, false, e.code); return false; } return null; }
  }
  const msgFresh = (m) => { const r = msgOf(m); return !!(r && now() - r.at < MSG_TTL); };
  // Hintergrund-Warteschlange (gedrosselt, je Tab)
  const MsgQ = {
    q: new Map(), running: false,
    want(uid, nick) { uid = String(uid || ''); if (!/^\d+$/.test(uid) || !nick) return; this.q.set(uid, nick); setTimeout(() => this.pump(), 500); },
    async pump() {
      if (this.running) return;
      this.running = true;
      try {
        while (this.q.size) {
          const [uid, nick] = this.q.entries().next().value; this.q.delete(uid);
          const m = await Members.get(uid);
          if (msgFresh(m)) continue;
          await msgCheck(uid, nick);
          await sleep(2500 + Math.random() * 2000);
        }
      } finally { this.running = false; }
    },
  };
  // Mitglied ab „Plus-Size“ und ohne Ignorier-Kriterien? → im Hintergrund prüfen
  function msgMaybeQueue(m) {
    if (!m || !m.nick || msgFresh(m) || !mopOn()) return;
    const bi = bodyInfo(m);
    const plus = (bi && mopStage(bi.lo) >= 1) || mopPlusDeclared(m);
    if (!plus) return;
    try { if (classify(m, 'suche').ignore) return; } catch { return; }
    MsgQ.want(m.uid, m.nick);
  }
  // für den Regel-Editor: Wert besorgen (prüft, wenn unbekannt oder veraltet)
  async function msgOkFor(uid, nick) {
    const m = await Members.get(uid);
    if (msgFresh(m)) return msgOf(m).ok;
    const r = await msgCheck(uid, nick);
    return r === true;
  }

  // =====================================================================================
  // ---------- Sonderseiten: Wartung, abgemeldet, Login, Werbung, nicht gefunden ----------
  // =====================================================================================
  const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const ssSet = (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch {} };

  // Welche Art Seite ist gerade zu sehen?
  //   'wartung' | 'login' | 'werbung' | 'notfound' | 'abgemeldet' | 'normal' | 'loading'
  function pageKind(doc = document) {
    const title = doc.title || '';
    const body = doc.body ? (doc.body.textContent || '') : '';
    if (/Wartungszustand/i.test(title) || /routinemäßige Wartungsarbeiten/i.test(body)) return 'wartung';
    const path = (doc.location && doc.location.pathname) || '';
    if (doc.querySelector('input#username') && doc.querySelector('input#password')) return 'login';
    if (path.startsWith('/login')) return 'loading';                       // Login-Formular lädt noch
    if (path.startsWith('/view/announcement/')) return 'werbung';
    const skip = [...doc.querySelectorAll('main a[href="/home"]')].find((a) => norm(a.textContent) === 'skip');
    if (skip) return 'werbung';
    const err = doc.querySelector('main .ant-result-error');
    if (err && /spurlos verschwunden|nicht gefunden/i.test(err.textContent || '')) return 'notfound';
    const header = doc.querySelector('header');
    if (!header) {
      // Kein SPA-Rahmen: evtl. Server-Totalausfall (502/503/504, Bad Gateway …) → wie Wartung behandeln
      if (/\b(bad gateway|gateway time-?out|service (temporarily )?unavailable|temporarily unavailable|internal server error|error 50[234]\b|\b50[234] (bad|service|gateway|internal)|momentan nicht erreichbar|vorübergehend nicht erreichbar|server (ist )?überlast)/i.test((title + ' ' + body).slice(0, 1500))) return 'wartung';
      return 'loading';
    }
    if (header.querySelector('a[href="/inbox"]')) return 'normal';
    if (doc.querySelector('a[href="/login"]') || /Neues Konto erstellen/.test(body)) return 'abgemeldet';
    return 'loading';
  }

  const runTarget = () => null;

  // ---------- „Du hast die Regie!“ (/view/announcement/page/1236): immer überspringen ----------
  const isRegie = (path = location.pathname, doc = document) => /^\/view\/announcement\/page\/1236\b/.test(path) ||
    (/^\/view\/announcement\//.test(path) && /Du hast die Regie/i.test((doc.querySelector('main') || {}).textContent || ''));
  function skipRegie() {
    const last = +(ssGet('vaf_regie_at') || 0);
    ssSet('vaf_regie_at', String(now()));
    const ref = document.referrer && document.referrer.startsWith(location.origin) ? document.referrer : '';
    const prev = ssGet('vaf_prev_url') || ssGet('vaf_last_url') || ref;
    // zweiter Treffer innerhalb weniger Sekunden: nicht zurück, sondern auf /home (keine Endlosschleife)
    if (now() - last < 8000 || !prev || /\/view\/announcement\//.test(prev)) { location.replace(location.origin + '/home'); return; }
    if (history.length > 1) history.back(); else location.replace(prev);
  }
  // Seitenwechsel ohne Neuladen beobachten (pushState/replaceState/popstate)
  (() => {
    let cur = location.href;
    const check = () => {
      if (location.href === cur) return;
      if (!/\/view\/announcement\//.test(cur)) ssSet('vaf_prev_url', cur);
      cur = location.href;
      if (isRegie()) skipRegie();
      else setTimeout(() => { if (isRegie()) skipRegie(); }, 1200);    // Überschrift erst nach dem Laden sichtbar
    };
    for (const fn of ['pushState', 'replaceState']) {
      const orig = W.history[fn];
      W.history[fn] = function (...a) { const r = orig.apply(this, a); setTimeout(check, 0); return r; };
    }
    W.addEventListener('popstate', () => setTimeout(check, 0));
  })();

  function specialPanel(title, html) { return toast(`<b>${esc(word())}-Schutz – ${title}</b><br>${html}`, 0); }

  // Wiederaufnahme nach einem Login: wohin wollte dieser Tab?
  function rememberResume() {
    if (G.get('resume', null)) return;
    const url = runTarget() || ssGet('vaf_last_url');
    if (url) G.set('resume', { tab: TAB_ID, url, ts: Date.now() });
  }

  // Gibt true zurück, wenn die Seite eine Sonderseite war und init() nicht weitermachen soll
  async function handleSpecialPage() {
    const kind = await waitFor(() => { const k = pageKind(); return k === 'loading' ? null : k; }, 8000) || 'normal';

    if (kind !== 'werbung') ssSet('vaf_ad_count', null);

    if (kind === 'normal') {
      ssSet('vaf_last_url', location.href);
      ssSet('vaf_notfound_reload', null);
      // Nach erfolgreichem Login dort weitermachen, wo der Tab unterbrochen wurde
      const r = G.get('resume', null);
      if (r && r.tab === TAB_ID) {
        G.del('resume');
        if (Date.now() - r.ts < 60 * 60000 && r.url && r.url !== location.href) {
          specialPanel('wieder eingeloggt', 'Mache weiter, wo ich unterbrochen wurde …');
          await sleep(1500);
          location.href = r.url;
          return true;
        }
      }
      return false;
    }

    if (kind === 'wartung') {
      const min = S().maintenanceMin;
      const at = new Date(Date.now() + min * 60000);
      const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      specialPanel('Wartung', `poppen.de wird gerade gewartet – alles angehalten.<br>Neuer Versuch um ${hhmm} Uhr.`);
            setTimeout(() => location.reload(), min * 60000);
      return true;
    }

    if (kind === 'abgemeldet' || kind === 'login') watchRelogin();
    if (kind === 'abgemeldet') {
      rememberResume();
            specialPanel('Nicht eingeloggt', 'Nicht eingeloggt – bitte <a href="/login" style="color:#ffc21a">anmelden</a>.<br>Danach geht es automatisch weiter.');
      return true;
    }

    if (kind === 'login') {
      rememberResume();
            await handleLoginPage();
      return true;
    }

    if (isRegie() || (kind === 'werbung' && isRegie(location.pathname))) { skipRegie(); return true; }
    if (kind === 'werbung') {
      const n = (+ssGet('vaf_ad_count') || 0) + 1;
      ssSet('vaf_ad_count', String(n));
      if (n >= 3) {
        specialPanel('Werbeseite', 'Die Werbe-Zwischenseite kommt immer wieder – angehalten.<br>Bitte einmal selbst auf „SKIP“ klicken.');
        return true;
      }
      const target = runTarget();
      specialPanel('Werbeseite', 'Werbe-Zwischenseite – wird übersprungen …');
      await sleep(800);
      if (target) { location.href = target; return true; }
      const skip = [...document.querySelectorAll('main a[href="/home"]')].find((a) => norm(a.textContent) === 'skip');
      if (skip) skip.click(); else location.href = location.origin + '/home';
      return true;
    }

    if (kind === 'notfound') {
      // Profilseiten behandelt der jeweilige Lauf selbst (Konto gilt als nicht vorhanden)
      if (/^\/p\/[^/]+$/.test(location.pathname.replace(/\/+$/, ''))) return false;
      const key = location.pathname;
      if (ssGet('vaf_notfound_reload') !== key) {
        ssSet('vaf_notfound_reload', key);
        specialPanel('Seite nicht gefunden', 'Seite nicht gefunden – lade einmal neu …');
        await sleep(1500);
        location.reload();
        return true;
      }
      specialPanel('Seite nicht gefunden', 'Diese Seite gibt es nicht (auch nach dem Neuladen) – angehalten.');
      return true;
    }
    return false;
  }

  // Nach dem Anmelden lädt poppen die Seite nicht neu (SPA) → beobachten; sobald wieder angemeldet:
  // Hinweis weg und einmal neu laden, damit das Skript voll startet (Wiederaufnahme über G.resume)
  let reloginWatch = null;
  function watchRelogin() {
    if (reloginWatch) return;
    reloginWatch = setInterval(() => {
      if (pageKind() !== 'normal') return;
      clearInterval(reloginWatch); reloginWatch = null;
      const t = document.getElementById('vaf-toast'); if (t) t.remove();
      setTimeout(() => location.reload(), 300);
    }, 1000);
  }
  // Login-Seite: "Angemeldet bleiben" einschalten, bei ausgefüllten Feldern einmal "Anmelden" klicken
  async function handleLoginPage() {
    await sleep(1500);                                   // dem Browser Zeit für das automatische Ausfüllen geben
    const sw = (() => {
      const lab = [...document.querySelectorAll('span, label, div')].find((e) => e.children.length === 0 && norm(e.textContent) === 'angemeldet bleiben');
      let box = lab;
      for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
        const b = box.querySelector('button[role=switch]');
        if (b) return b;
      }
      return null;
    })();
    if (sw && sw.getAttribute('aria-checked') !== 'true') { sw.click(); await sleep(400); }

    const user = document.querySelector('input#username');
    const pass = document.querySelector('input#password');
    const autofilled = (el) => { try { return el.matches(':autofill') || el.matches(':-webkit-autofill'); } catch { return false; } };
    const filled = (el) => !!el && (el.value.trim() !== '' || autofilled(el));
    const submit = () => {
      const f = (pass && pass.closest('form')) || document.querySelector('main form');
      return f && [...f.querySelectorAll('button')].find((b) => norm(b.textContent) === 'anmelden');
    };
    const mark = () => {
      const b = submit();
      if (b) { b.style.boxShadow = '0 0 0 4px #ffc21a'; b.scrollIntoView({ block: 'center' }); }
    };

    // der Browser füllt die Felder manchmal erst später aus → bis zu 20 s warten
    if (!filled(user) || !filled(pass)) {
      specialPanel('Login', 'Warte auf die gespeicherten Anmeldedaten des Browsers …');
      await waitFor(() => filled(document.querySelector('input#username')) && filled(document.querySelector('input#password')), 20000);
    }
    if (!filled(document.querySelector('input#username')) || !filled(document.querySelector('input#password'))) {
      if (!document.querySelector('input#password')) return;            // inzwischen angemeldet
      specialPanel('Nicht eingeloggt', 'Nicht eingeloggt – bitte anmelden.<br>Danach geht es automatisch weiter.');
      mark();
      return;
    }
    const lastTry = G.get('login_try', 0);
    if (S().autoLogin && Date.now() - lastTry > S().autoLoginPauseMin * 60000) {
      G.set('login_try', Date.now());
      specialPanel('Login', 'Melde mich an …');
      const b = submit();
      if (b) b.click();
      // Hat es geklappt, verlässt die Seite das Login-Formular (dann übernimmt init() auf der neuen Seite)
      if (await waitFor(() => !document.querySelector('input#password'), 8000)) return;
    }
    specialPanel('Login', 'Bitte einmal auf <b>Anmelden</b> klicken – danach geht es automatisch weiter.');
    mark();
  }

  // =====================================================================================
  // Sichern / Wiederherstellen, Gedächtnis exportieren / importieren, 99-Jährige, Umstellung von 1.x
  // =====================================================================================
  async function backupAll() {
    const me = Me.get() || await loadMe();
    if (!me || !me.nick) { toast('Eigenes Profil unbekannt – bitte einmal neu laden.'); return; }
    const tt = toast('Sichere alle Daten …', 0);
    await Members.flush();
    const gm = {};
    for (const k of GM_listValues()) if (k.startsWith('vaf2_') && !k.startsWith('vaf2_lock_')) gm[k] = GM_getValue(k);
    const out = { format: 'opa-schutz-backup', version: VERSION, at: new Date().toISOString(), account: me.nick, gm, stores: {} };
    for (const st of ['members', 'queue', 'kv', 'images', 'archive']) out.stores[st] = await DB.all(st);
    out.fick = await encryptJSON(await Fick.all(), me.nick);
    download(`opa-schutz-sicherung-${stamp()}.json`, JSON.stringify(out));
    tt.innerHTML = `Gesichert: ${fmtN(out.stores.members.length)} Mitglieder, ${fmtN(out.stores.queue.length)} auf der Warteliste.`;
    setTimeout(() => tt.remove(), 6000);
  }
  async function restoreAll() {
    const text = await pickFile();
    if (!text) return;
    let d;
    try { d = JSON.parse(text); } catch { toast('Datei nicht lesbar.'); return; }
    if (d.format !== 'opa-schutz-backup') { toast('Das ist keine Sicherung des Opa-Schutzes.'); return; }
    // Kontobindung: nur Sicherungen DIESES Kontos wiederherstellen
    const bu = (d.gm && ((d.gm.vaf2_owner && d.gm.vaf2_owner.uid) || (d.gm.vaf2_me && d.gm.vaf2_me.uid))) || '';
    const curMe = Me.get() || await loadMe();
    if (bu && curMe && String(bu) !== String(curMe.uid)) {
      await ask('Andere Sicherung', `<p>Diese Sicherung gehört zu <b>${esc(d.account || '?')}</b>, angemeldet ist <b>${esc(curMe.nick)}</b>.</p><p>„Wiederherstellen“ geht nur mit einer eigenen Sicherung. Für das Gedächtnis eines anderen Kontos gibt es „Gedächtnis importieren“ (fremde Datensicherung).</p>`, [{ label: 'OK', value: true, primary: true }]);
      return;
    }
    const ok = await ask('Alle Daten wiederherstellen', `<p>Alle Daten werden durch die Sicherung vom ${esc(deDateTime(d.at))} (${esc(d.account || '?')}) ersetzt.</p>`, [
      { label: 'Wiederherstellen', value: true, primary: true }, { label: 'Abbrechen', value: false, focus: true, cancel: true }]);
    if (!ok) return;
    let fick = null;
    let pass = (Me.get() || {}).nick || d.account || '';
    for (let i = 0; i < 3 && d.fick; i++) {
      try { fick = await decryptJSON(d.fick, pass); break; }
      catch { pass = W.prompt('Die Fickliste ist mit dem Nick verschlüsselt, der beim Sichern galt. Welcher war es? (leer = ohne Fickliste wiederherstellen)', d.account || ''); if (!pass) break; }
    }
    for (const k of GM_listValues()) if (k.startsWith('vaf2_') && !k.startsWith('vaf2_lock_')) GM_deleteValue(k);
    for (const [k, v] of Object.entries(d.gm || {})) GM_setValue(k, v);
    // kleine Stores sofort, große gechunkt mit Yield (kein Einfrieren bei vielen Mitgliedern)
    const tt2 = toast('Stelle Daten wieder her …', 0);
    for (const st of ['kv', 'queue']) { await DB.clear(st); await DB.putMany(st, d.stores[st] || []); }
    if (fick) { try { await assertSharedWrite(); await BkRpc.call('putMany', { s: 'fick', list: fick.map((p) => ({ ...p, updatedAt: p.updatedAt || p.updated || now() })) }, 60000); FickStore.invalidate(); } catch (e) { toast('Fickliste konnte nicht in den Briefkasten geschrieben werden: ' + esc(e.message)); } }
    for (const st of ['members', 'images', 'archive']) {
      await DB.clear(st);
      const arr = d.stores[st] || [];
      for (let i = 0; i < arr.length; i += 2000) { await DB.putMany(st, arr.slice(i, i + 2000)); tt2.textContent = `Stelle wieder her: ${st} ${fmtN(Math.min(i + 2000, arr.length))}/${fmtN(arr.length)}`; await new Promise((r) => setTimeout(r, 0)); }
    }
    tt2.remove();
    Members.cached().clear();
    loadSettings();
    toast(`Wiederhergestellt${fick ? '' : ' (ohne Fickliste)'}. Seite wird neu geladen …`);
    setTimeout(() => location.reload(), 1500);
  }

  // Nur das Wissen über andere Mitglieder (für ein zweites Konto) – samt Fickliste (verschlüsselt) und Textvorlagen.
  //  „Anschreibbar“ (m.msg, je eigenem Profil) wird mit exportiert, aber nur beim Import ins SELBE Profil übernommen.
  const MEM_FIELDS = ['uid', 'nick', 'nl', 'nicks', 'g', 'ages', 'ageAt', 'birth', 'by', 'zod', 'pay', 'city', 'first', 'last', 'lastLogin', 'signup', 'dist', 'body', 'bodyS', 'bodyUnk', 'fig', 'figc', 'tr', 'lf', 'interested', 'fake', 'rel', 'del', 'active', 'avatar', 'seen'];
  async function exportMemory(withImages) {
    const me = Me.get() || await loadMe();
    const tt = toast('Exportiere Gedächtnis …', 0);
    const list = [];
    await Members.each((m) => { const o = {}; for (const f of MEM_FIELDS) if (m[f] !== undefined) o[f] = m[f]; if (m.msg) o.msg = m.msg; list.push(o); });
    const out = { format: 'opa-schutz-gedaechtnis', version: VERSION, at: new Date().toISOString(), account: me ? { uid: me.uid, nick: me.nick } : null, members: list };
    if (withImages) out.images = await DB.all('images');
    // Fickliste (verschlüsselt mit dem eigenen Nick) und Textvorlagen
    try { if (me && me.nick) out.fick = await encryptJSON(await Fick.all(), me.nick); } catch (e) { warn('Export Fickliste', e); }
    try { const te = await tplExportForFile(); out.templates = te.list; out.templatesDeleted = te.deleted; out.templatesFmt = 'joyclub'; } catch {}
    download(`opa-schutz-gedaechtnis-${stamp()}.json`, JSON.stringify(out));
    tt.innerHTML = `${fmtN(list.length)} Mitglieder exportiert${withImages ? ` (${fmtN(out.images.length)} Bilder)` : ''}${out.fick ? ', Fickliste' : ''}${out.templates ? ', Textvorlagen' : ''}.`;
    setTimeout(() => tt.remove(), 6000);
  }
  // Mischregel je Mitglied (wie im JOYclub-Skript):
  //  1. Gewinner ist, wer das Profil zuletzt aufgerufen hat (seen.Profil), bei Gleichstand der vollständigere
  //     Eintrag, dann der eigene.
  //  2. Geburtszeiträume werden immer geschnitten (leere Schnittmenge → die des Gewinners).
  //  3. Sternzeichen sowie Größe/Gewicht werden aus dem anderen Datensatz ergänzt, wenn sie fehlen.
  //  Lokale Felder (Blockstatus, eigene Markierungen …) bleiben immer erhalten; „Anschreibbar“ nur aus dem eigenen Profil.
  const pickMem = (x) => { const o = {}; for (const f of MEM_FIELDS) if (x[f] !== undefined) o[f] = x[f]; return o; };
  const memFill = (x) => MEM_FIELDS.filter((f) => x[f] !== undefined && x[f] !== null && x[f] !== '' && !(Array.isArray(x[f]) && !x[f].length)).length;
  function memMerge(own, imp) {
    const pv = (x) => (x && x.seen && x.seen.Profil) || 0;
    let win, lose;
    if (pv(imp) !== pv(own)) [win, lose] = pv(imp) > pv(own) ? [imp, own] : [own, imp];
    else if (memFill(imp) !== memFill(own)) [win, lose] = memFill(imp) > memFill(own) ? [imp, own] : [own, imp];
    else [win, lose] = [own, imp];
    const out = pickMem(win);
    if (win.birth && lose.birth && win.birth.length === lose.birth.length) out.birth = win.birth.map((b, i) => intersect(b, lose.birth[i]) || b);
    else if (!out.birth && lose.birth) out.birth = lose.birth;
    for (const f of ['zod', 'body', 'by', 'signup']) if ((out[f] == null || (Array.isArray(out[f]) && !out[f].length)) && lose[f] != null) out[f] = lose[f];
    out.seen = { ...(lose.seen || {}), ...(win.seen || {}) };
    return out;
  }
  async function importMemory() {
    const text = await pickFile();
    if (!text) return;
    let d;
    try { d = JSON.parse(text); } catch { toast('Datei nicht lesbar.'); return; }
    if (d.format !== 'opa-schutz-gedaechtnis') { toast('Das ist kein Gedächtnis-Export.'); return; }
    const me = Me.get() || await loadMe();
    const sameProfile = !!(me && d.account && String(d.account.uid) === String(me.uid));
    // Textvorlagen: Fall A (eigenes Konto, auch über „Ich“-Profile erkannt) ohne Rückfrage; fremd: Schalter (aus = Fall C)
    let ownAcc = sameProfile;
    if (!ownAcc && d.account) { try { const ich = await ichList(); ownAcc = ich.some((i) => (i.pf === 'poppen' || !i.pf) && String(i.uid) === String(d.account.uid)); } catch {} }
    const fileTpls = Array.isArray(d.templates) ? d.templates.map((t) => (d.templatesFmt === 'joyclub' ? t : { ...t, text: toJoy(t.text) })) : null;
    let tplMode = ownAcc ? 'A' : 'C';
    if (!ownAcc && fileTpls && fileTpls.length) {
      let mig = false;
      const pr = ask('Fremde Datensicherung importieren', `<p>Gedächtnis von <b>${esc((d.account && d.account.nick) || '?')}</b> importieren.</p>
        <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="vaf-tpl-mig"> Auch Textvorlagen migrieren (${fmtN(fileTpls.length)})</label>
        <p class="vaf-mini">Nur für Konten, die ihre Textvorlagen bewusst teilen. Gelöschte Vorlagen der Datei werden hier nicht gelöscht, „Termine“ wird nie übernommen.</p>`,
        [{ label: 'Importieren', value: true, primary: true, focus: true }, { label: 'Abbrechen', value: false, cancel: true }]);
      const cb = document.getElementById('vaf-tpl-mig'); if (cb) cb.addEventListener('change', () => { mig = cb.checked; });
      if (!(await pr)) return;
      tplMode = mig ? 'B' : 'C';
    }
    const members = (d.members || []).filter((x) => x && x.uid);
    const total = members.length;
    const tt = toast('Lese vorhandenes Gedächtnis …', 0);
    await Members.flush();
    let neu = 0, erg = 0, eig = 0, done = 0;
    const batch = [];
    const flush = async () => { if (batch.length) await DB.putMany('members', batch.splice(0)); };
    for (const x of members) {
      done++;
      const uid = String(x.uid);
      const own = await DB.get('members', uid);
      let merged;
      if (!own) { merged = pickMem(x); neu++; }
      else {
        merged = memMerge(own, x);
        for (const k of Object.keys(own)) if (k !== 'uid' && !MEM_FIELDS.includes(k)) merged[k] = own[k];   // lokale Felder behalten
        if (same(pickMem(own), pickMem(merged))) eig++; else erg++;
      }
      // „Anschreibbar“: nur aus dem eigenen Profil, die neuere Prüfung gewinnt; fremde Ergebnisse nie übernehmen
      if (sameProfile && x.msg) {
        const mm = { ...((own && own.msg) || {}) };
        for (const [k, v] of Object.entries(x.msg)) if (!mm[k] || (v && v.at > mm[k].at)) mm[k] = v;
        merged.msg = mm;
      } else if (own && own.msg) merged.msg = own.msg;
      merged.uid = uid; merged.nl = norm(merged.nick || x.nick || '');
      batch.push(merged);
      if (batch.length >= 1000) { tt.textContent = `Mische Gedächtnis … ${fmtN(done)}/${fmtN(total)}`; await flush(); await new Promise((r) => setTimeout(r, 0)); }
    }
    await flush();
    // Bilder gechunkt, neuer gewinnt
    if (d.images && d.images.length) {
      const imgAt = new Map();
      await DB.each('images', (im) => imgAt.set(String(im.uid), im.at || 0));
      const ibatch = [];
      for (const im of d.images) {
        if (!im || !im.uid) continue;
        const p = imgAt.get(String(im.uid));
        if (p === undefined || (im.at || 0) > p) ibatch.push(im);
        if (ibatch.length >= 200) { await DB.putMany('images', ibatch.splice(0)); await new Promise((r) => setTimeout(r, 0)); }
      }
      if (ibatch.length) await DB.putMany('images', ibatch.splice(0));
    }
    Members.cached().clear();
    let fickNote = '';
    if (d.fick && d.account && d.account.nick) {
      let persons = null;
      try { persons = await decryptJSON(d.fick, d.account.nick); } catch (e) { warn('Fickliste der Datei nicht lesbar', e); }
      if (persons && sameProfile) {
        // eigene Sicherung: neuere Einträge gewinnen
        try { await assertSharedWrite(); await BkRpc.call('putMany', { s: 'fick', list: persons.map((p) => ({ ...p, updatedAt: p.updatedAt || p.updated || 0 })) }, 60000); FickStore.invalidate(); fickNote = `<br>Fickliste: ${fmtN(persons.length)} Einträge abgeglichen.`; } catch (e) { fickNote = `<br>Fickliste: ${esc(e.message || 'Briefkasten nicht erreichbar.')}`; }
      } else if (persons) {
        tt.innerHTML = `Gedächtnis gemischt: <b>${fmtN(neu)}</b> neu, <b>${fmtN(erg)}</b> ergänzt, <b>${fmtN(eig)}</b> unverändert.`;
        const n = await fickImportForeign(persons, d.account, d.templates).catch((e) => { warn('Fickliste-Import', e); return 0; });
        fickNote = n ? `<br>Fickliste von ${esc(d.account.nick)}: übernommen.` : '';
      }
    }
    tt.innerHTML = `Gedächtnis gemischt: <b>${fmtN(neu)}</b> neu, <b>${fmtN(erg)}</b> ergänzt, <b>${fmtN(eig)}</b> unverändert.` + fickNote;
    setTimeout(() => tt.remove(), 10000);
    if (fileTpls && tplMode !== 'C') {
      const rep = await tplImportFile(fileTpls, d.templatesDeleted || [], tplMode).catch((e) => { warn('Textvorlagen-Import', e); return [['Textvorlagen', 'Fehler: ' + e.message]]; });
      tplReport(rep, `Textvorlagen aus der Datei von ${(d.account && d.account.nick) || '?'}`);
    }
  }
  // ---------- Umstellung von Version 1.x ----------
  // Die alten Listen kannten keine Benutzer-IDs. Sie werden ins neue Gedächtnis übernommen, sobald
  // ein Mitglied mit ID auftaucht (Blockierliste, Listen); die alten Daten bleiben erhalten.
  let legacy = null;
  async function migrateV1() {
    if (G.get('migrated_v1', false)) { legacy = await KV.get('legacy', null); return; }
    const done = GM_getValue('vaf_done', null);
    if (!Array.isArray(done)) { G.set('migrated_v1', true); return; }
    const src = GM_getValue('vaf_done_src', {}) || {}, time = GM_getValue('vaf_done_time', {}) || {}, birth = GM_getValue('vaf_birth', {}) || {};
    const L = { done: {}, birth: {} };
    for (const p of done) L.done[slugOf(p)] = { src: src[p] || '', at: time[p] ? Date.parse(time[p]) : 0 };
    for (const [p, b] of Object.entries(birth)) L.birth[slugOf(p)] = b.persons || [];
    await KV.set('legacy', L);
    legacy = L;
    // alte Whitelist-Einträge aus dem Quelltext stehen bereits in den Standardwerten
    G.set('migrated_v1', true);
    log(`Umstellung von 1.x: ${done.length} Erledigte, ${Object.keys(L.birth).length} Geburtszeiträume übernommen.`);
  }
  // beim ersten Sehen eines Mitglieds: alte Daten einfließen lassen
  Bus.on('legacy-check', () => {});
  async function legacyApply(m) {
    if (!legacy || !m || !m.nl) return;
    const b = legacy.birth[m.nl];
    if (b && b.length && m.birth && m.birth.length === b.length) m.birth = m.birth.map((x, i) => intersect(x, b[i]) || x);
    const d = legacy.done[m.nl];
    if (d && !m.blk && !m.unblk) m.blk = { at: d.at || now(), src: d.src || 'Sync', note: '', opa: true, legacy: true };
  }

  // =====================================================================================
  // Messenger: Abschnitt „Termine“ (zwischen „Aktionen“ und „Anhänge“ in der rechten Spalte).
  // Quelle: lokale Textdatei (File System Access API, nur Chrome/Edge), Zeilen „wann - wo - was - Link“.
  // Gelesen wird von oben, vergangene Termine werden übersprungen, Schluss nach 5 kommenden.
  // =====================================================================================
  const TERM_KEY = 'termine_file';
  const TERM_MAX = 5;
  const termSupported = () => typeof W.showOpenFilePicker === 'function';

  // „wann“ am Zeilenanfang: Datum oder Zeitraum (14.09.2026 · 14.09.-23.09.2026 · 14.-23.09.2026 · 28.12.2026 - 02.01.2027)
  const TERM_D = '(\\d{1,2})\\.(?:(\\d{1,2})\\.)?(\\d{4})?';
  const TERM_RE = new RegExp(`^\\s*${TERM_D}(?:\\s*[-–]\\s*${TERM_D})?(?=\\s*(?:[-–]\\s|$))`);
  function parseTermLine(line) {
    const m = TERM_RE.exec(line);
    if (!m) return null;
    const [, d1, m1, y1, d2, m2, y2] = m;
    const year = +(y2 || y1 || new Date().getFullYear());
    const end = d2 ? { d: +d2, m: +(m2 || m1), y: +(y2 || y1 || year) } : { d: +d1, m: +m1, y: +(y1 || year) };
    if (!end.m) return null;
    const endDate = new Date(end.y, end.m - 1, end.d);
    if (endDate.getMonth() !== end.m - 1) return null;                // ungültiges Datum
    const st = { d: +d1, m: +(m1 || end.m), y: +(y1 || (d2 && +(m1 || end.m) > end.m ? end.y - 1 : end.y)) };
    const startDate = new Date(st.y, st.m - 1, st.d);
    const wann = m[0].trim();
    const rest = line.slice(m[0].length).replace(/^\s*[-–]\s*/, '');
    const parts = rest.split(/\s+[-–]\s+/).map((x) => x.trim()).filter(Boolean);
    let link = '';
    if (parts.length > 1 && /^(https?:\/\/|www\.)\S+$/i.test(parts[parts.length - 1])) link = parts.pop();
    const wo = parts.shift() || '';
    const was = parts.join(' - ');
    return { line: line.trim(), wann, wo, was, link, start: startDate, end: endDate, label: [wann, wo, was].filter(Boolean).join(' - ') };
  }
  function upcomingTerms(text) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out = [];
    let bad = 0;
    for (const raw of String(text).split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const t = parseTermLine(raw);
      if (!t) { bad++; continue; }
      if (t.end < today) continue;                                       // vergangen: überspringen
      out.push(t);
      if (out.length >= TERM_MAX) break;
    }
    // chronologisch; gleiches Datum: Reihenfolge der Datei (stabile Sortierung)
    out.sort((a, b) => a.start - b.start);
    return { list: out, bad };
  }
  // alle gültigen Zeilen (auch vergangene) – zum Ausschreiben verkürzter Termin-Zeilen
  function allTerms(text) { return String(text).split(/\r?\n/).map((l) => (l.trim() ? parseTermLine(l) : null)).filter(Boolean); }
  // JOYclub-Links vereinheitlichen: https://www.joyclub.de/…
  const normJoyLink = (u) => String(u || '').replace(/^(?:https?:\/\/)?(?:www\.)?joyclub\.(de|com)\//i, 'https://www.joyclub.de/');
  const linkCmp = (u) => normJoyLink(u).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

  let termMem = null;                       // zuletzt gewählte Datei (auch falls das Speichern scheitert)
  async function termHandle() {
    if (termMem) return termMem;
    let h = null;
    try { h = await HandleStore.get(TERM_KEY); } catch {}
    if (!(h && typeof h.getFile === 'function')) {
      // vor 2.35 lag der Griff in der verschlüsselten Datenbank und ging dort verloren (nicht als JSON speicherbar);
      // Rettungsversuch aus dem alten, unverschlüsselten Bestand (bleibt nach dem Umzug noch 14 Tage)
      try {
        const od = await openOldDb();
        if (od && od.objectStoreNames.contains('kv')) {
          const r = await new Promise((res) => { const q = od.transaction('kv').objectStore('kv').get(TERM_KEY); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
          od.close();
          const oh = r && (r.v || r);
          if (oh && typeof oh.getFile === 'function') { h = oh; try { await HandleStore.set(TERM_KEY, h); } catch {} log('Termine: Datei aus dem alten Bestand wiederhergestellt'); }
        } else if (od) od.close();
      } catch {}
    }
    return h && typeof h.getFile === 'function' ? (termMem = h) : null;
  }
  // Datei wählen (braucht einen Klick)
  async function pickTermFile() {
    if (!termSupported()) { toast('Das geht nur in Chrome oder Edge.'); return null; }
    try {
      const [h] = await W.showOpenFilePicker({ multiple: false, types: [{ description: 'Textdatei', accept: { 'text/plain': ['.txt', '.text', '.md'] } }] });
      // eine Datei für alle Skripte: anderer Name als im Briefkasten → nur nach Rückfrage wechseln
      const sh = await termShared(true);
      let force = false;
      if (sh && sh.name && sh.name !== h.name) {
        const v = await ask('Termin-Datei wechseln?', `<p>Für alle Opa-Scan-Skripte ist <b>${esc(sh.name)}</b> eingetragen${sh.by && sh.by.pf ? ` (zuletzt gelesen von ${sh.by.pf === 'joyclub' ? 'JOYclub' : esc(sh.by.pf)})` : ''}.</p><p>Termin-Datei für alle Skripte auf <b>${esc(h.name)}</b> wechseln?</p>`,
          [{ label: 'Für alle wechseln', value: true, primary: true }, { label: 'Abbrechen', value: false, cancel: true, focus: true }]);
        if (!v) return null;
        force = true;
      }
      termMem = h;
      if (force) { try { const f = await h.getFile(); await termShare({ name: h.name, text: await f.text(), lastModified: f.lastModified || 0, size: f.size || 0 }, true); } catch {} }
      try { await HandleStore.set(TERM_KEY, h); } catch (e) { warn('Termine: Datei merken', e); }
      return h;
    } catch (e) { if (e && e.name !== 'AbortError') warn('Termine', e); return null; }
  }
  // ---------- Termin-Datei im Briefkasten (für alle Skripte dieselbe) ----------
  //  Den Datei-Griff selbst kann der Browser nicht zwischen Websites teilen (jede Seite muss die Datei einmal
  //  selbst wählen). Geteilt wird deshalb der zuletzt gelesene Inhalt: meta-Eintrag „termine_file“
  //  { k, name, text, at, by:{pf,ver,acc} }. Wer die Datei lesen darf, schreibt den Stand dorthin; wer sie nicht
  //  (oder noch nicht) lesen darf, nimmt den Stand aus dem Briefkasten.
  let termSh = null;      // { at: Abrufzeit, v }
  async function termShared(force) {
    if (!force && termSh && now() - termSh.at < 60000) return termSh.v;
    let v = null;
    try { v = await BkRpc.call('get', { s: 'meta', k: 'termine_file' }, 2500); } catch { const old = termSh ? termSh.v : null; termSh = { at: now(), v: old }; return old; }   // Briefkasten nicht erreichbar: nicht warten, 60 s merken
    termSh = { at: now(), v: v || null };
    return termSh.v;
  }
  // Regeln (gemeinsam mit dem JOYclub-Skript): eine Datei für alle (Name im Briefkasten), nur eine NEUERE Datei
  // (lastModified) überschreibt den Stand, Text immer roh mit allen vier Angaben „wann - wo - was - Link“.
  async function termShare(r, force = false) {
    try {
      const cur = await termShared();
      if (cur && !force) {
        if (cur.name && cur.name !== r.name) return;                                          // andere Datei → nicht überschreiben
        if ((cur.lastModified || 0) >= (r.lastModified || 0) && cur.text === r.text) return;   // nichts Neues
        if ((cur.lastModified || 0) > (r.lastModified || 0)) return;                          // Briefkasten neuer
      }
      const v = { k: 'termine_file', name: r.name, size: r.size || 0, lastModified: r.lastModified || 0, text: String(r.text).slice(0, 200000), at: now(), by: { pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' } };
      await BkRpc.call('put', { s: 'meta', v }, 8000);
      termSh = { at: now(), v };
    } catch {}
  }
  // Inhalt lesen; ask=true darf nach der Erlaubnis fragen (nur aus einem Klick heraus).
  // Eigene Datei (falls gewählt und lesbar) → Stand in den Briefkasten; sonst der Stand aus dem Briefkasten.
  async function readTermFile(ask) {
    const h = await termHandle();
    let local = null;
    if (h) {
      let perm = 'granted';
      try { perm = await h.queryPermission({ mode: 'read' }); } catch {}
      if (perm !== 'granted' && ask) { try { perm = await h.requestPermission({ mode: 'read' }); } catch {} }
      if (perm !== 'granted') local = { state: 'perm', name: h.name };
      else {
        try {
          const f = await h.getFile();
          const r = { state: 'ok', name: h.name, text: await f.text(), lastModified: f.lastModified || 0, size: f.size || 0 };
          const sh0 = await termShared();
          if (sh0 && sh0.name && sh0.name !== r.name) local = { state: 'switched', name: h.name, to: sh0.name };     // anderswo gewechselt
          else if (sh0 && (sh0.lastModified || 0) > r.lastModified && typeof sh0.text === 'string') return { state: 'ok', name: sh0.name, text: sh0.text, shared: true, at: sh0.at, by: sh0.by || null, newer: true };
          else { termShare(r); return r; }
        } catch (e) { local = { state: 'error', name: h.name, error: e.message || String(e) }; }
      }
    }
    const sh = await termShared();
    if (sh && typeof sh.text === 'string') return { state: 'ok', name: sh.name || 'Termine', text: sh.text, shared: true, at: sh.at, by: sh.by || null, local: local && local.state, switchedFrom: local && local.state === 'switched' ? local.name : '' };
    return local || { state: 'none' };
  }
  const termSrcNote = (r) => (r && r.shared ? ` · Stand aus dem Briefkasten${r.by && r.by.pf && r.by.pf !== 'poppen' ? ` (gelesen von ${r.by.pf === 'joyclub' ? 'JOYclub' : r.by.pf})` : ''}${r.at ? `, ${deDateTime(r.at)}` : ''}` : '');

  // Zeile in das Eingabefeld des Chats einfügen (nicht senden)
  function insertIntoChat(text, { send = false } = {}) {
    const ta = document.querySelector('main textarea.rc-textarea, main .ant-mentions textarea');
    if (!ta) { toast('Eingabefeld nicht gefunden.'); return; }
    if (send) {   // Termin ans Ende anhängen (eigene Zeile, ohne Return) und alles zusammen senden
      const v0 = ta.value || '';
      const nv0 = v0 + (v0 && !/\n$/.test(v0) ? '\n' : '') + text;
      Object.getOwnPropertyDescriptor(W.HTMLTextAreaElement.prototype, 'value').set.call(ta, nv0);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      setTimeout(() => chatSend(ta), 120);
      return;
    }
    const v = ta.value || '';
    const pos = typeof ta.selectionStart === 'number' && document.activeElement === ta ? ta.selectionStart : v.length;
    const before = v.slice(0, pos), after = v.slice(pos);
    const ins = (before && !/\n$/.test(before) ? '\n' : '') + text + (after && !/^\n/.test(after) ? '\n' : '');
    const nv = before + ins + after;
    const setter = Object.getOwnPropertyDescriptor(W.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, nv);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    const c = (before + ins).length;
    try { ta.setSelectionRange(c, c); } catch {}
  }

  // Nachricht im Eingabefeld senden: Return im Feld auslösen (so sendet poppen), notfalls den Senden-Knopf;
  // danach prüfen, ob das Feld leer ist – sonst Hinweis.
  async function chatSend(ta) {
    const fire = (type) => ta.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    fire('keydown'); fire('keypress'); fire('keyup');
    await sleep(800);
    if (!(ta.value || '').trim() || !ta.isConnected) return true;
    const form = ta.closest('form') || ta.closest('main');
    const btn = form && [...form.querySelectorAll('button')].find((b) => !b.disabled && (b.type === 'submit' || /senden|send/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + b.textContent)));
    if (btn) { btn.click(); await sleep(800); if (!(ta.value || '').trim() || !ta.isConnected) return true; }
    toast('Nicht gesendet – bitte selbst absenden.');
    return false;
  }

  // Abschnitt in der rechten Spalte
  function messengerTerms() {
    const titles = [...document.querySelectorAll('aside .ant-collapse-item .ant-collapse-title')];
    const act = titles.find((t) => t.textContent.trim() === 'Aktionen');
    const att = titles.find((t) => t.textContent.trim() === 'Anhänge');
    if (!act || !att) return;
    const attItem = att.closest('.ant-collapse-item');
    const actItem = act.closest('.ant-collapse-item');
    let item = document.getElementById('vaf-terms');
    if (item && item.nextElementSibling === attItem) return;
    if (item) item.remove();
    // Aufbau wie die vorhandenen Abschnitte
    item = attItem.cloneNode(false);
    item.id = 'vaf-terms';
    item.className = attItem.className.replace(/\bant-collapse-item-active\b/g, '').trim();
    const head = attItem.querySelector('.ant-collapse-header').cloneNode(true);
    head.querySelector('.ant-collapse-title').textContent = 'Termine';
    const panel = document.createElement('div');
    panel.className = 'ant-collapse-panel';
    const body = document.createElement('div');
    body.className = 'ant-collapse-body';
    panel.appendChild(body);
    item.append(head, panel);
    actItem.after(item);
    const menuCls = (actItem.querySelector('ul.ant-menu') || {}).className || 'ant-menu ant-menu-root ant-menu-vertical ant-menu-light ant-theme';
    const icon = actItem.querySelector('.ant-collapse-expand-icon');
    const setOpen = (open) => {
      item.classList.toggle('ant-collapse-item-active', open);
      head.setAttribute('aria-expanded', String(open));
      panel.className = 'ant-collapse-panel ' + (open ? 'ant-collapse-panel-active' : 'ant-collapse-panel-inactive ant-collapse-panel-hidden');
      panel.style.display = open ? '' : 'none';
      const svg = head.querySelector('.ant-collapse-expand-icon svg');
      if (svg) svg.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';      // wie bei „Aktionen“/„Anhänge“
    };
    const li = (html, title, fn, extraCss = '') => {
      const e = document.createElement('li');
      e.className = 'ant-menu-item';
      e.setAttribute('role', 'menuitem');
      e.tabIndex = -1;
      e.title = title || '';
      e.innerHTML = `<span class="ant-menu-title-content" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${extraCss}">${html}</span>`;
      if (fn) e.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); });
      else e.style.cursor = 'default';
      return e;
    };
    const render = async (ask) => {
      const ul = document.createElement('ul');
      ul.className = menuCls;
      ul.setAttribute('role', 'menu');
      body.innerHTML = '';
      body.appendChild(ul);
      if (!termSupported()) { ul.appendChild(li('Nur in Chrome oder Edge verfügbar', '', null, 'opacity:.6')); return; }
      const r = await readTermFile(ask);
      if (r.state === 'none') { ul.appendChild(li('Datei mit Terminen wählen …', 'Textdatei mit Zeilen „wann - wo - was - Link“', async () => { if (await pickTermFile()) render(false); })); return; }
      if (r.state === 'perm') { ul.appendChild(li('Zugriff auf die Datei erlauben', r.name, () => render(true))); ul.appendChild(li('Datei ändern …', '', async () => { if (await pickTermFile()) render(false); }, 'opacity:.7')); return; }
      if (r.state === 'error') { ul.appendChild(li(`Datei nicht lesbar: ${esc(r.name)}`, r.error, null, 'color:#ff7875')); ul.appendChild(li('Datei ändern …', '', async () => { if (await pickTermFile()) render(false); }, 'opacity:.7')); return; }
      const { list } = upcomingTerms(r.text);
      if (!list.length) ul.appendChild(li('Keine kommenden Termine', r.name, null, 'opacity:.6'));
      for (const t of list) ul.appendChild(li(esc(t.label), t.line, () => insertIntoChat(t.line, { send: true })));
      if (r.switchedFrom) ul.appendChild(li(`Die Termin-Datei wurde auf ${esc(r.name)} gewechselt – hier neu wählen`, `bisher hier: ${r.switchedFrom}`, async () => { if (await pickTermFile()) render(false); }, 'color:#ffb74d;font-size:12px'));
      ul.appendChild(li(r.shared && r.local !== 'perm' ? 'Datei hier wählen …' : 'Datei ändern …', `Derzeit: ${r.name}${termSrcNote(r)}`, async () => { if (await pickTermFile()) render(false); }, 'opacity:.7;font-size:12px'));
      if (r.shared && r.local === 'perm') ul.appendChild(li('Zugriff auf die eigene Datei erlauben', 'liest die Datei direkt statt des Stands aus dem Briefkasten', () => render(true), 'opacity:.7;font-size:12px'));
    };
    head.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const open = !item.classList.contains('ant-collapse-item-active');
      G.set('terms_open', open);
      setOpen(open);
      if (open) render(true);                 // Klick: darf nach der Datei-Erlaubnis fragen
    });
    const open = !!G.get('terms_open', false);
    setOpen(open);
    if (open) render(false);
    void icon;
  }

  // =====================================================================================
  // Smiley-Übersetzung JOYclub <-> poppen <-> Unicode (Tabelle aus smiley-map.json, fest eingebaut)
  // =====================================================================================
  const SMILEY_MAP = {"joyToPoppen": {"*danke*": ":pray:", "*thankyou*": ":pray:", "*g*": ":)", ":)": ":)", ":-)": ":)", "*kuss*": ":kiss:", "*schleck4*": ":kiss:", "*top*": ":thumbsup:", "*ggg*": ":D", ":D": ":D", ":-D": ":D", "*lol*": ":joy:", ":lol:": ":joy:", "*smile*": ":relaxed:", "*gg*": ":smiley:", "*zwinker*": ";)", ";)": ";)", ";-)": ";)", "*zwinker2*": ";)", ":wink:": ";)", "*xd*": "xD", "*achtung*": ":exclamation:", ":!:": ":exclamation:", "*exclaim*": ":exclamation:", "*alarm*": ":rotating_light:", "*freu2*": ":jumping:", "*knuddel*": "🤗", "*wink*": ":wave:", "*grins*": ":grin:", "*mrgreen*": ":grin:", ":mrgreen:": ":grin:", "*fiesgrins*": ":smiling_imp:", ":twisted:": ":smiling_imp:", "*twisted*": ":smiling_imp:", "*lach*": "xD", "*haha*": "xD", "*rotfl*": "🤣", "*rofl*": "🤣", "*haumichwech*": "🤣", "*freu*": ":smiley:", "*juhu*": "🥳", "*juchu*": "🥳", "*happy*": ":relaxed:", "*witz*": "xD", "*traenenlach*": ":joy:", "*aetsch*": ":stuck_out_tongue:", "*baeh*": ":P", ":P": ":P", ":-P": ":P", ":razz:": ":P", "*razz*": ":P", "*selbstgefall*": ":smirk:", "*goofy*": "🤪", "*oh*": ":o", ":o": ":o", ":-o": ":o", ":surprised:": ":o", "*surprised*": ":o", "*oh2*": ":hushed:", "*schock*": ":scream:", ":shock:": ":scream:", "*shock*": ":scream:", "*panik*": ":fearful:", "*umfall*": ":dizzy_face:", "*gr*": ">:(", ":x": ">:(", "*gr2*": ":imp:", ":evil:": ":imp:", "*evil*": ":imp:", "*gr3*": ":rage:", "*gleichplatz*": "🤬", "*uah*": ":confounded:", "*motz*": ":triumph:", "*fluch*": "🤬", "*basta*": ":triumph:", "*freundchen*": ">:(", "*kommmalherfreundchen*": ">:(", "*blauesauge*": "🤕", "*headcrash*": "🤕", "*grimasse*": ":grimacing:", "*snief*": ":(", ":(": ":(", ":-(": ":(", ":sad:": ":(", "*sad*": ":(", "*snief2*": ":cry:", ":cry:": ":cry:", "*cry*": ":cry:", "*heul*": ":sob:", "*heul2*": ":sob:", "*snief3*": ":sob:", "*flenn*": ":sob:", "*traurig*": ":pensive:", "*liebeskummer*": ":broken_heart:", "*troest*": "🤗", "*keks*": "🤗", "*muede*": ":|", ":|": ":|", ":-|": ":|", ":neutral:": ":|", "*neutral*": ":|", "*morgen*": ":|", "*gaehn*": "🥱", "*gaehn2*": "🥱", "*zzz*": ":zzz:", "*heia*": ":sleeping:", "*heia2*": ":sleeping:", "*baby2*": ":baby:", "*tel*": ":telephone_receiver:", "*blabla*": ":speech_balloon:", "*bla*": ":speech_balloon:", "*bla2*": ":speech_balloon:", "*lalala*": ":notes:", "*schweig*": "🤐", "*fluester*": "🤫", "*dafuer*": ":thumbsup:", "*dagegen*": ":thumbsdown:", "*flop*": ":thumbsdown:", "*top2*": ":thumbsup:", "*bravo*": ":clap:", "*zugabe*": ":clap:", "*spitze*": ":ok_hand:", "*tomaten*": ":tomato:", "*wow*": ":astonished:", "*sabber*": "🤤", "*umpf*": "🤢", "*arg*": "🤢", "*pfui*": "🤢", "*victory*": ":v:", "*hi5*": ":raised_hands:", "*hutab*": ":tophat:", "*100*": ":100:", "*wuerg*": "🤮", "*wuerg2*": "🤮", "*ko*": ":dizzy_face:", "*crazy2*": ":dizzy_face:", "*aspirin*": ":pill:", "*sternchen*": ":dizzy:", "*3tagewach*": ":weary:", "*schnupfen*": "🤧", "*hatschi*": "🤧", "*gehirnschnecke*": ":snail:", "*schwester*": ":dr_love:", "*mundschutz*": ":mask:", "*essen*": ":fork_and_knife:", "*grill*": ":meat_on_bone:", "*bier*": ":beer:", "*eis*": ":icecream:", "*lolli*": ":lollipop:", "*torte*": ":birthday:", "*muffin*": "🧁", "*kaffee*": ":coffee_morning:", "*tee*": ":tea:", "*wein*": ":wine_glass:", "*cocktail*": ":cocktail:", "*fliege2*": "🦟", "*whiskey*": "🥃", "*prost*": ":beers:", "*party*": ":beers:", "*cheers*": "🥂", "*stoesschen*": "🥂", "*sekt*": "🍾", "*party2*": "🍾", "*zig*": ":smoking:", "*troet*": ":tada:", "*twist*": ":dancer:", "*yo*": ":dancer:", "*walk*": ":dancer:", "*dance*": ":dancer:", "*boogie*": ":dancer:", "*hicks*": "🥴", "*headbang*": ":urock:", "*hochleb*": ":raised_hands:", "*stammtisch*": ":beers:", "*feuerwerk*": ":fireworks:", "*knuddel2*": ":kissing_closed_eyes:", "*knutsch*": ":kissing_closed_eyes:", "*knutsch2*": ":kissing_closed_eyes:", "*liebhab*": ":hearts_around:", "*imogdi*": ":hearts_around:", "*iloveyou*": ":hearts_around:", "*friends*": ":couple:", "*bussi*": ":kissing_smiling_eyes:", "*kuss2*": ":kiss:", "*herz*": ":heart:", "*herz2*": ":two_hearts:", "*herz3*": ":heartpulse:", "*herz4*": ":sparkling_heart:", "*love*": ":heart:", "*love2*": ":heart:", "*love3*": ":heart:", "*love4*": ":heart:", "*love5*": ":heart_eyes:", "*blume*": ":rose:", "*blumezupf*": ":blossom:", "*blumenschenk*": ":bouquet:", "*roseschenk*": ":rose:", "*geschenk*": ":gift:", "*osolemio*": ":microphone:", "*hochzeit*": ":wedding:", "*kuss3*": ":kissing_heart:", "*bussi2*": ":kissing_heart:", "*knutsch3*": ":kissing_heart:", "*knutsch4*": ":kissing_heart:", "*blume2*": ":tulip:", "*sweetkiss*": ":kissing_heart:", "*liebguck*": "🥰", "*anbet*": ":bow:", "*floet*": ":kissing:", "*skeptisch*": "🤨", "*pueh*": "¬¬", "*schmoll*": "¬¬", "*stolzbin*": ":relieved:", "*autsch*": "🤕", "*cool*": "B|", "8)": "B|", "8-)": "B|", "*cool2*": "B|", "*crazy*": ":crazy:", "*crazy4*": ":crazy:", "*aua*": "🤕", "*huch*": ":astonished:", "*oh3*": ":astonished:", "*oh4*": ":astonished:", "*hae*": "O.o", ":?": "O.o", "*nixweiss*": "🤷", "*naund*": "🤷", "*schiefguck*": ":confused:", ":/": ":confused:", ":-/": ":confused:", ":confused:": ":confused:", "*confused*": ":confused:", "*roll*": "🙄", ":roll:": "🙄", "*sarkasmus*": "🙄", "*gruebel*": "🤔", "*nachdenk*": "🤔", "*kopfklatsch*": "🤦", "*rotwerd*": ":flushed:", ":oops:": ":flushed:", ":redface:": ":flushed:", "*redface*": ":flushed:", "*schaem*": ":flushed:", "*angsthab*": ":cold_sweat:", "*ballaballa*": "🤪", "*blumenwiese*": ":blossom:", "*vielglueck*": ":four_leaf_clover:", "*augenzu*": ":see_no_evil:", "*tanz*": ":dancer:", "*tanz2*": ":dancer:", "*tipp*": ":computer:", "*les*": ":newspaper:", "*mail*": ":envelope:", "*duschen*": ":shower:", "*wc*": ":toilet:", "*omm*": "(A)", "*huhu*": ":wave:", "*bye*": ":wave:", "*fahr*": ":red_car:", "*knips*": ":camera:", "*film*": ":movie_camera:", "*meld*": ":raising_hand:", "*knicks*": ":bow:", "*popcorn*": "🍿", "*popcorn2*": "🍿", "*puh*": ":sweat_smile:", "*clown*": "🤡", "*sing*": ":guitar:", "*strick*": "🧶", "*putz*": "🧹", "*tauch*": ":swimmer:", "*fussball*": ":soccer:", "*spanner*": ":eyes:", "*zocker*": ":video_game:", "*megaphon*": ":loudspeaker:", "*pumpi*": ":muscle:", "*pumpi2*": ":muscle:", "*fernglas*": ":telescope:", "*pimper*": ":poppen:", "*popp*": ":poppen-1:", "*bananen*": ":bananarama:", "*kondom*": ":safesex:", "*peitsche*": ":whipping:", "*schleck*": ":lick:", "*schleck2*": ":lick:", "*schleck3*": ":lick:", "*arsch*": ":ass:", "*hotass*": ":ass:", "*hothips*": ":stocking:", "*hotbum*": ":ass:", "*titten*": ":tits:", "*knackarsch*": ":ass:", "*blowjob*": ":suckmy:", "*leck*": ":lick:", "*ffm*": ":threesome:", "*mmf*": ":threesome:", "*fessel*": ":handcuffs:", "*sextoy*": ":vibrator:", "*engel*": "(A)", "*engel2*": ":angel:", "*oma*": ":older_woman:", "*opa*": ":older_man:", "*baby*": ":baby:", "*bauarbeiter*": ":construction_worker:", "*polizei*": ":cop:", "*maler*": ":art:", "*koenig*": ":crown:", "*koenigin*": ":princess:", "*dj*": ":headphones:", "*rock*": ":guitar:", "*gitarre*": ":guitar:", "*drummer*": "🥁", "*piano*": ":musical_keyboard:", "*nikolaus*": ":santa:", "*teufel*": ":smiling_imp:", "*angel*": ":angel:", "*wahrsager*": ":crystal_ball:", "*katze*": ":cat:", "*kuh*": ":cow:", "*huhn*": ":chicken:", "*dance2*": ":chicken:", "*schwein*": ":pig:", "*hund*": ":dog:", "*schmetterling*": "🦋", "*bug*": ":bug:", "*einhorn*": "🦄", "*fuchs*": "🦊", "*schnecke*": ":snail:", "*wolf*": ":wolf:", "*hamster*": ":hamster:", "*sonne*": ":sunny:", "*regen*": ":umbrella:", "*frier*": "🥶", "*schwitz*": ":sweat:", "*regenbogen*": ":rainbow:", "*pfeil*": ":arrow_right:", ":arrow:": ":arrow_right:", "*arrow*": ":arrow_right:", "*frage*": ":question:", ":?:": ":question:", "*question*": ":question:", "*idee*": ":bulb:", ":idea:": ":bulb:", "*idea*": ":bulb:", "*foto*": ":camera:", "*beep*": ":rotating_light:", "*hilfe*": ":sos:", "*help*": ":sos:", "*happybirthday*": ":birthday:", "*deutschland*": ":de:", "*bayern*": "Bayern", "*bw*": "Baden-Württemberg", "*berlin*": "Berlin", "*brandenburg*": "Brandenburg", "*bremen*": "Bremen", "*hamburg*": "Hamburg", "*hessen*": "Hessen", "*mv*": "Mecklenburg-Vorpommern", "*niedersachsen*": "Niedersachsen", "*nrw*": "Nordrhein-Westfalen", "*rheinland*": "Rheinland-Pfalz", "*saarland*": "Saarland", "*sachsen*": "Sachsen", "*anhalt*": "Sachsen-Anhalt", "*schleswig*": "Schleswig-Holstein", "*thueringen*": "Thüringen", "*oesterreich*": "🇦🇹", "*schweiz*": "🇨🇭", "*niederlande*": "🇳🇱", "*brueste*": ":tits:", "*brueste2*": ":tits:"}, "poppenToJoy": {":jumping:": "*freu2*", ":hearts_around:": "*liebhab*", ":heart_eyes:": "*love5*", ":coffee_morning:": "*kaffee*", ":coffee_happy:": "*kaffee*", ":dr_love:": "*schwester*", ":confused:": ":/", ":D": ":D", ":smiley:": "*gg*", ":)": ":)", ":relaxed:": "*smile*", "9_9": "☺", ";)": ";)", ":x": "*love5*", ":kissing_heart:": "*kuss3*", ":kissing_closed_eyes:": "*knutsch*", ":kissing:": "*floet*", ":kissing_smiling_eyes:": "*bussi*", ":P": ":P", ":stuck_out_tongue_closed_eyes:": "😝", ":stuck_out_tongue:": "*aetsch*", ":flushed:": ":oops:", ":grin:": "*grins*", ":pensive:": "*traurig*", ":relieved:": "*stolzbin*", "¬¬": "*pueh*", ":(": ":(", ":persevere:": "😣", ":cry:": ":cry:", ":joy:": "*traenenlach*", ":sob:": "*heul*", ":sleepy:": "😪", ":disappointed_relieved:": "😥", ":cold_sweat:": "*angsthab*", ":sweat_smile:": "*puh*", ":sweat:": "*schwitz*", ":weary:": "*3tagewach*", ":tired_face:": "😫", ":fearful:": "*panik*", ":scream:": ":shock:", ">:(": ":x", ":rage:": "*gr3*", ":triumph:": "*motz*", ":confounded:": "*uah*", "xD": "*xd*", ":yum:": "😋", ":mask:": "*mundschutz*", "B|": "8)", ":sleeping:": "*heia*", ":dizzy_face:": "*umfall*", ":astonished:": "*wow*", ":worried:": "😟", "o.O": "😦", "-_-": "😧", ":smiling_imp:": ":twisted:", ":imp:": ":evil:", ":o": ":o", ":grimacing:": "*grimasse*", ":-/": ":/", "O.o": ":?", ":hushed:": "*oh2*", ":no_mouth:": "😶", "(A)": "*engel*", ":smirk:": "*selbstgefall*", ":|": ":|", ":man_with_gua_pi_mao:": "👲", ":man_with_turban:": "👳", ":cop:": "*polizei*", ":construction_worker:": "*bauarbeiter*", ":guardsman:": "💂", ":baby:": "*baby*", ":boy:": "👦", ":girl:": "👧", ":man:": "👨", ":woman:": "👩", ":older_man:": "*opa*", ":older_woman:": "*oma*", ":person_with_blond_hair:": "👱", ":angel:": "*engel2*", ":princess:": "*koenigin*", ":smiley_cat:": "😺", ":smile_cat:": "😸", ":heart_eyes_cat:": "😻", ":kissing_cat:": "😽", ":smirk_cat:": "😼", ":scream_cat:": "🙀", ":crying_cat_face:": "😿", ":joy_cat:": "😹", ":pouting_cat:": "😾", ":japanese_ogre:": "👹", ":japanese_goblin:": "👺", ":see_no_evil:": "*augenzu*", ":hear_no_evil:": "🙉", ":speak_no_evil:": "🙊", ":skull:": "💀", ":alien:": "👽", ":poop:": "💩", ":fire:": "🔥", ":sparkles:": "✨", ":star2:": "🌟", ":dizzy:": "*sternchen*", ":boom:": "💥", ":anger:": "💢", ":sweat_drops:": "💦", ":droplet:": "💧", ":zzz:": "*zzz*", ":dash:": "💨", ":ear:": "👂", ":eyes:": "*spanner*", ":nose:": "👃", ":tongue:": "*schleck*", ":lips:": "👄", ":thumbsup:": "*top*", ":thumbsdown:": "*flop*", ":ok_hand:": "*spitze*", ":punch:": "👊", ":fist:": "✊", ":v:": "*victory*", ":wave:": "*wink*", ":raised_hand:": "✋", ":open_hands:": "👐", ":point_up_2:": "👆", ":point_down:": "👇", ":point_right:": "👉", ":point_left:": "👈", ":raised_hands:": "*hi5*", ":pray:": "*danke*", ":point_up:": "☝", ":clap:": "*bravo*", ":muscle:": "*pumpi*", ":walking:": "🚶", ":runner:": "🏃", ":dancer:": "*dance*", ":couple:": "*friends*", ":family:": "👪", ":two_men_holding_hands:": "👬", ":two_women_holding_hands:": "👭", ":couplekiss:": "💏", ":couple_with_heart:": "💑", ":dancers:": "👯", ":ok_woman:": "🙆", ":no_good:": "🙅", ":information_desk_person:": "💁", ":raising_hand:": "*meld*", ":massage:": "💆", ":haircut:": "💇", ":nail_care:": "💅", ":bride_with_veil:": "👰", ":person_with_pouting_face:": "🙎", ":person_frowning:": "🙍", ":bow:": "*anbet*", ":tophat:": "*hutab*", ":crown:": "*koenig*", ":womans_hat:": "👒", ":athletic_shoe:": "👟", ":mans_shoe:": "👞", ":sandal:": "👡", ":high_heel:": "👠", ":boot:": "👢", ":shirt:": "👕", ":necktie:": "👔", ":womans_clothes:": "👚", ":dress:": "👗", ":running_shirt_with_sash:": "🎽", ":jeans:": "👖", ":kimono:": "👘", ":bikini:": "👙", ":briefcase:": "💼", ":handbag:": "👜", ":pouch:": "👝", ":purse:": "👛", ":eyeglasses:": "👓", ":ribbon:": "🎀", ":closed_umbrella:": "🌂", ":lipstick:": "💄", ":yellow_heart:": "💛", ":blue_heart:": "💙", ":purple_heart:": "💜", ":green_heart:": "💚", ":heart:": "*herz*", ":broken_heart:": "*liebeskummer*", ":heartpulse:": "*herz3*", ":heartbeat:": "💓", ":two_hearts:": "*herz2*", ":sparkling_heart:": "*herz4*", ":revolving_hearts:": "💞", ":cupid:": "💘", ":love_letter:": "💌", ":kiss:": "*kuss2*", ":ring:": "💍", ":gem:": "💎", ":bust_in_silhouette:": "👤", ":busts_in_silhouette:": "👥", ":speech_balloon:": "*blabla*", ":footprints:": "👣", ":thought_balloon:": "💭", ":poppen:": "*pimper*", ":poppen-1:": "*popp*", ":suckmy:": "*blowjob*", ":lick:": "*schleck*", ":handcuffs:": "*fessel*", ":vibrator:": "*sextoy*", ":whipping:": "*peitsche*", ":crazy:": "*crazy*", ":cum:": "💦", ":bed:": "*popp*", ":ass:": "*arsch*", ":pussy:": "🍯", ":stocking:": "*hothips*", ":safesex:": "*kondom*", ":cock:": "🍆", ":tits:": "*titten*", ":banana:": "🍌", ":bananarama:": "*bananen*", ":spermatozoon:": "💦", ":threesome:": "*ffm*", ":fucku:": "🖕", ":urock:": "*headbang*", ":wdrop:": "💧", ":ydrop:": "💧", ":wdrops:": "💦", ":ydrops:": "💦", ":bdrops:": "💦", ":dog:": "*hund*", ":wolf:": "*wolf*", ":cat:": "*katze*", ":mouse:": "🐭", ":hamster:": "*hamster*", ":rabbit:": "🐰", ":frog:": "🐸", ":tiger:": "🐯", ":koala:": "🐨", ":bear:": "🐻", ":pig:": "*schwein*", ":pig_nose:": "🐽", ":cow:": "*kuh*", ":boar:": "🐗", ":monkey_face:": "🐵", ":monkey:": "🐒", ":horse:": "🐴", ":sheep:": "🐑", ":elephant:": "🐘", ":panda_face:": "🐼", ":penguin:": "🐧", ":bird:": "🐦", ":baby_chick:": "🐤", ":hatched_chick:": "🐥", ":hatching_chick:": "🐣", ":chicken:": "*huhn*", ":snake:": "🐍", ":turtle:": "🐢", ":bug:": "*bug*", ":bee:": "🐝", ":ant:": "🐜", ":beetle:": "🐞", ":snail:": "*schnecke*", ":octopus:": "🐙", ":shell:": "🐚", ":tropical_fish:": "🐠", ":fish:": "🐟", ":dolphin:": "🐬", ":whale:": "🐳", ":whale2:": "🐋", ":cow2:": "🐄", ":ram:": "🐏", ":rat:": "🐀", ":water_buffalo:": "🐃", ":tiger2:": "🐅", ":rabbit2:": "🐇", ":dragon:": "🐉", ":racehorse:": "🐎", ":goat:": "🐐", ":rooster:": "🐓", ":dog2:": "🐕", ":pig2:": "🐖", ":mouse2:": "🐁", ":ox:": "🐂", ":dragon_face:": "🐲", ":blowfish:": "🐡", ":crocodile:": "🐊", ":camel:": "🐫", ":dromedary_camel:": "🐪", ":leopard:": "🐆", ":cat2:": "🐈", ":poodle:": "🐩", ":feet:": "🐾", ":bouquet:": "*blumenschenk*", ":cherry_blossom:": "🌸", ":tulip:": "*blume2*", ":four_leaf_clover:": "*vielglueck*", ":rose:": "*blume*", ":sunflower:": "🌻", ":hibiscus:": "🌺", ":maple_leaf:": "🍁", ":leaves:": "🍃", ":fallen_leaf:": "🍂", ":herb:": "🌿", ":ear_of_rice:": "🌾", ":mushroom:": "🍄", ":cactus:": "🌵", ":palm_tree:": "🌴", ":evergreen_tree:": "🌲", ":deciduous_tree:": "🌳", ":chestnut:": "🌰", ":seedling:": "🌱", ":blossom:": "*blumezupf*", ":globe_with_meridians:": "🌐", ":sun_with_face:": "🌞", ":full_moon_with_face:": "🌝", ":new_moon_with_face:": "🌚", ":new_moon:": "🌑", ":waxing_crescent_moon:": "🌒", ":first_quarter_moon:": "🌓", ":waxing_gibbous_moon:": "🌔", ":full_moon:": "🌕", ":waning_gibbous_moon:": "🌖", ":last_quarter_moon:": "🌗", ":waning_crescent_moon:": "🌘", ":last_quarter_moon_with_face:": "🌜", ":first_quarter_moon_with_face:": "🌛", ":crescent_moon:": "🌙", ":earth_africa:": "🌍", ":earth_americas:": "🌎", ":earth_asia:": "🌏", ":volcano:": "🌋", ":milky_way:": "🌌", ":stars:": "🌠", ":star:": "⭐", ":sunny:": "*sonne*", ":partly_sunny:": "⛅", ":cloud:": "☁", ":zap:": "⚡", ":umbrella:": "*regen*", ":snowflake:": "❄", ":snowman:": "⛄", ":cyclone:": "🌀", ":foggy:": "🌁", ":rainbow:": "*regenbogen*", ":ocean:": "🌊", ":bamboo:": "🎍", ":gift_heart:": "💝", ":dolls:": "🎎", ":school_satchel:": "🎒", ":mortar_board:": "🎓", ":flags:": "🎏", ":fireworks:": "*feuerwerk*", ":sparkler:": "🎇", ":wind_chime:": "🎐", ":rice_scene:": "🎑", ":jack_o_lantern:": "🎃", ":ghost:": "👻", ":santa:": "*nikolaus*", ":christmas_tree:": "🎄", ":gift:": "*geschenk*", ":tanabata_tree:": "🎋", ":tada:": "*troet*", ":confetti_ball:": "🎊", ":balloon:": "🎈", ":crossed_flags:": "🎌", ":crystal_ball:": "*wahrsager*", ":movie_camera:": "*film*", ":camera:": "*knips*", ":video_camera:": "📹", ":vhs:": "📼", ":cd:": "💿", ":dvd:": "📀", ":minidisc:": "💽", ":floppy_disk:": "💾", ":computer:": "*tipp*", ":iphone:": "📱", ":telephone:": "☎", ":telephone_receiver:": "*tel*", ":pager:": "📟", ":fax:": "📠", ":satellite:": "📡", ":tv:": "📺", ":radio:": "📻", ":loud_sound:": "🔊", ":sound:": "🔉", ":speaker:": "🔈", ":mute:": "🔇", ":bell:": "🔔", ":no_bell:": "🔕", ":loudspeaker:": "*megaphon*", ":mega:": "📣", ":hourglass_flowing_sand:": "⏳", ":hourglass:": "⌛", ":alarm_clock:": "⏰", ":watch:": "⌚", ":unlock:": "🔓", ":lock:": "🔒", ":lock_with_ink_pen:": "🔏", ":closed_lock_with_key:": "🔐", ":key:": "🔑", ":mag_right:": "🔎", ":bulb:": ":idea:", ":flashlight:": "🔦", ":high_brightness:": "🔆", ":low_brightness:": "🔅", ":electric_plug:": "🔌", ":battery:": "🔋", ":mag:": "🔍", ":bathtub:": "🛁", ":bath:": "🛀", ":shower:": "*duschen*", ":toilet:": "*wc*", ":wrench:": "🔧", ":nut_and_bolt:": "🔩", ":hammer:": "🔨", ":door:": "🚪", ":smoking:": "*zig*", ":bomb:": "💣", ":gun:": "🔫", ":knife:": "🔪", ":pill:": "*aspirin*", ":syringe:": "💉", ":moneybag:": "💰", ":yen:": "💴", ":dollar:": "💵", ":pound:": "💷", ":euro:": "💶", ":credit_card:": "💳", ":money_with_wings:": "💸", ":calling:": "📲", ":e-mail:": "📧", ":inbox_tray:": "📥", ":outbox_tray:": "📤", ":envelope:": "*mail*", ":envelope_with_arrow:": "📩", ":incoming_envelope:": "📨", ":postal_horn:": "📯", ":mailbox:": "📫", ":mailbox_closed:": "📪", ":mailbox_with_mail:": "📬", ":mailbox_with_no_mail:": "📭", ":postbox:": "📮", ":package:": "📦", ":pencil:": "📝", ":page_facing_up:": "📄", ":page_with_curl:": "📃", ":bookmark_tabs:": "📑", ":bar_chart:": "📊", ":chart_with_upwards_trend:": "📈", ":chart_with_downwards_trend:": "📉", ":scroll:": "📜", ":clipboard:": "📋", ":date:": "📅", ":calendar:": "📆", ":card_index:": "📇", ":file_folder:": "📁", ":open_file_folder:": "📂", ":scissors:": "✂", ":pushpin:": "📌", ":paperclip:": "📎", ":black_nib:": "✒", ":pencil2:": "✏", ":straight_ruler:": "📏", ":triangular_ruler:": "📐", ":closed_book:": "📕", ":green_book:": "📗", ":blue_book:": "📘", ":orange_book:": "📙", ":notebook:": "📓", ":notebook_with_decorative_cover:": "📔", ":ledger:": "📒", ":books:": "📚", ":book:": "📖", ":bookmark:": "🔖", ":name_badge:": "📛", ":microscope:": "🔬", ":telescope:": "*fernglas*", ":newspaper:": "*les*", ":art:": "*maler*", ":clapper:": "🎬", ":microphone:": "*osolemio*", ":headphones:": "*dj*", ":musical_score:": "🎼", ":musical_note:": "🎵", ":notes:": "*lalala*", ":musical_keyboard:": "*piano*", ":violin:": "🎻", ":trumpet:": "🎺", ":saxophone:": "🎷", ":guitar:": "*rock*", ":space_invader:": "👾", ":video_game:": "*zocker*", ":black_joker:": "🃏", ":flower_playing_cards:": "🎴", ":mahjong:": "🀄", ":game_die:": "🎲", ":dart:": "🎯", ":football:": "🏈", ":basketball:": "🏀", ":soccer:": "*fussball*", ":baseball:": "⚾", ":tennis:": "🎾", ":8ball:": "🎱", ":rugby_football:": "🏉", ":bowling:": "🎳", ":golf:": "⛳", ":mountain_bicyclist:": "🚵", ":bicyclist:": "🚴", ":checkered_flag:": "🏁", ":horse_racing:": "🏇", ":trophy:": "🏆", ":ski:": "🎿", ":snowboarder:": "🏂", ":swimmer:": "*tauch*", ":surfer:": "🏄", ":fishing_pole_and_fish:": "🎣", ":coffee:": "*kaffee*", ":tea:": "*tee*", ":sake:": "🍶", ":baby_bottle:": "🍼", ":beer:": "*bier*", ":beers:": "*prost*", ":cocktail:": "*cocktail*", ":tropical_drink:": "🍹", ":wine_glass:": "*wein*", ":fork_and_knife:": "*essen*", ":pizza:": "🍕", ":hamburger:": "🍔", ":fries:": "🍟", ":poultry_leg:": "🍗", ":meat_on_bone:": "*grill*", ":spaghetti:": "🍝", ":curry:": "🍛", ":fried_shrimp:": "🍤", ":bento:": "🍱", ":sushi:": "🍣", ":fish_cake:": "🍥", ":rice_ball:": "🍙", ":rice_cracker:": "🍘", ":rice:": "🍚", ":ramen:": "🍜", ":stew:": "🍲", ":oden:": "🍢", ":dango:": "🍡", ":egg:": "🍳", ":bread:": "🍞", ":doughnut:": "🍩", ":custard:": "🍮", ":icecream:": "*eis*", ":ice_cream:": "🍨", ":shaved_ice:": "🍧", ":birthday:": "*torte*", ":cake:": "🍰", ":cookie:": "🍪", ":chocolate_bar:": "🍫", ":candy:": "🍬", ":lollipop:": "*lolli*", ":honey_pot:": "🍯", ":apple:": "🍎", ":green_apple:": "🍏", ":tangerine:": "🍊", ":lemon:": "🍋", ":cherries:": "🍒", ":grapes:": "🍇", ":watermelon:": "🍉", ":strawberry:": "🍓", ":peach:": "*arsch*", ":melon:": "🍈", ":pear:": "🍐", ":pineapple:": "🍍", ":sweet_potato:": "🍠", ":eggplant:": "🍆", ":tomato:": "*tomaten*", ":corn:": "🌽", ":house:": "🏠", ":house_with_garden:": "🏡", ":school:": "🏫", ":office:": "🏢", ":post_office:": "🏣", ":hospital:": "🏥", ":bank:": "🏦", ":convenience_store:": "🏪", ":love_hotel:": "🏩", ":hotel:": "🏨", ":wedding:": "*hochzeit*", ":church:": "⛪", ":department_store:": "🏬", ":european_post_office:": "🏤", ":city_sunset:": "🌇", ":city_dusk:": "🌆", ":japanese_castle:": "🏯", ":european_castle:": "🏰", ":tent:": "⛺", ":factory:": "🏭", ":tokyo_tower:": "🗼", ":japan:": "🗾", ":mount_fuji:": "🗻", ":sunrise_over_mountains:": "🌄", ":sunrise:": "🌅", ":night_with_stars:": "🌃", ":statue_of_liberty:": "🗽", ":bridge_at_night:": "🌉", ":carousel_horse:": "🎠", ":ferris_wheel:": "🎡", ":fountain:": "⛲", ":roller_coaster:": "🎢", ":ship:": "🚢", ":sailboat:": "⛵", ":speedboat:": "🚤", ":rowboat:": "🚣", ":anchor:": "⚓", ":rocket:": "🚀", ":airplane:": "✈", ":seat:": "💺", ":helicopter:": "🚁", ":steam_locomotive:": "🚂", ":tram:": "🚊", ":station:": "🚉", ":mountain_railway:": "🚞", ":train2:": "🚆", ":bullettrain_side:": "🚄", ":bullettrain_front:": "🚅", ":light_rail:": "🚈", ":metro:": "🚇", ":monorail:": "🚝", ":train:": "🚋", ":railway_car:": "🚃", ":trolleybus:": "🚎", ":bus:": "🚌", ":oncoming_bus:": "🚍", ":blue_car:": "🚙", ":oncoming_automobile:": "🚘", ":red_car:": "*fahr*", ":taxi:": "🚕", ":oncoming_taxi:": "🚖", ":articulated_lorry:": "🚛", ":truck:": "🚚", ":rotating_light:": "*alarm*", ":police_car:": "🚓", ":oncoming_police_car:": "🚔", ":fire_engine:": "🚒", ":ambulance:": "🚑", ":minibus:": "🚐", ":bike:": "🚲", ":aerial_tramway:": "🚡", ":suspension_railway:": "🚟", ":mountain_cableway:": "🚠", ":tractor:": "🚜", ":barber:": "💈", ":busstop:": "🚏", ":ticket:": "🎫", ":vertical_traffic_light:": "🚦", ":traffic_light:": "🚥", ":warning:": "⚠", ":construction:": "🚧", ":beginner:": "🔰", ":fuelpump:": "⛽", ":izakaya_lantern:": "🏮", ":slot_machine:": "🎰", ":hotsprings:": "♨", ":moyai:": "🗿", ":circus_tent:": "🎪", ":performing_arts:": "🎭", ":round_pushpin:": "📍", ":triangular_flag_on_post:": "🚩", ":cn:": "🇨🇳", ":us:": "🇺🇸", ":jp:": "🇯🇵", ":ru:": "🇷🇺", ":de:": "*deutschland*", ":gb:": "🇬🇧", ":fr:": "🇫🇷", ":kr:": "🇰🇷", ":it:": "🇮🇹", ":es:": "🇪🇸", ":no_smoking:": "🚭", ":over18:": "🔞", ":copyright:": "©", ":parking:": "🅿", ":wc:": "🚾", ":hash:": "#⃣", ":one:": "1⃣", ":two:": "2⃣", ":three:": "3⃣", ":four:": "4⃣", ":five:": "5⃣", ":six:": "6⃣", ":seven:": "7⃣", ":eight:": "8⃣", ":nine:": "9⃣", ":zero:": "0⃣", ":keycap_ten:": "🔟", ":1234:": "🔢", ":symbols:": "🔣", ":arrow_up:": "⬆", ":arrow_down:": "⬇", ":arrow_left:": "⬅", ":arrow_right:": ":arrow:", ":capital_abcd:": "🔠", ":abcd:": "🔡", ":abc:": "🔤", ":arrow_upper_right:": "↗", ":arrow_upper_left:": "↖", ":arrow_lower_right:": "↘", ":arrow_lower_left:": "↙", ":left_right_arrow:": "↔", ":arrow_up_down:": "↕", ":arrows_counterclockwise:": "🔄", ":arrow_backward:": "◀", ":arrow_forward:": "▶", ":arrow_up_small:": "🔼", ":arrow_down_small:": "🔽", ":leftwards_arrow_with_hook:": "↩", ":arrow_right_hook:": "↪", ":information_source:": "ℹ", ":rewind:": "⏪", ":fast_forward:": "⏩", ":arrow_double_up:": "⏫", ":arrow_double_down:": "⏬", ":arrow_heading_down:": "⤵", ":arrow_heading_up:": "⤴", ":ok:": "🆗", ":twisted_rightwards_arrows:": "🔀", ":repeat:": "🔁", ":repeat_one:": "🔂", ":new:": "🆕", ":up:": "🆙", ":cool:": "🆒", ":free:": "🆓", ":ng:": "🆖", ":signal_strength:": "📶", ":cinema:": "🎦", ":koko:": "🈁", ":u6307:": "🈯", ":u7a7a:": "🈳", ":u6e80:": "🈵", ":u5408:": "🈴", ":u7981:": "🈲", ":ideograph_advantage:": "🉐", ":u5272:": "🈹", ":u55b6:": "🈺", ":u6709:": "🈶", ":u7121:": "🈚", ":restroom:": "🚻", ":mens:": "🚹", ":womens:": "🚺", ":baby_symbol:": "🚼", ":potable_water:": "🚰", ":put_litter_in_its_place:": "🚮", ":wheelchair:": "♿", ":u6708:": "🈷", ":u7533:": "🈸", ":sa:": "🈂", ":m:": "Ⓜ", ":passport_control:": "🛂", ":baggage_claim:": "🛄", ":left_luggage:": "🛅", ":customs:": "🛃", ":accept:": "🉑", ":secret:": "㊙", ":congratulations:": "㊗", ":cl:": "🆑", ":sos:": "*hilfe*", ":id:": "🆔", ":no_entry_sign:": "🚫", ":no_mobile_phones:": "📵", ":do_not_litter:": "🚯", ":non-potable_water:": "🚱", ":no_bicycles:": "🚳", ":no_pedestrians:": "🚷", ":children_crossing:": "🚸", ":no_entry:": "⛔", ":eight_spoked_asterisk:": "✳", ":sparkle:": "❇", ":negative_squared_cross_mark:": "❎", ":white_check_mark:": "✅", ":eight_pointed_black_star:": "✴", ":heart_decoration:": "💟", ":vs:": "🆚", ":vibration_mode:": "📳", ":mobile_phone_off:": "📴", ":a:": "🅰", ":b:": "🅱", ":ab:": "🆎", ":o2:": "🅾", ":diamond_shape_with_a_dot_inside:": "💠", ":loop:": "➿", ":recycle:": "♻", ":aries:": "♈", ":taurus:": "♉", ":gemini:": "♊", ":cancer:": "♋", ":leo:": "♌", ":virgo:": "♍", ":libra:": "♎", ":scorpius:": "♏", ":sagittarius:": "♐", ":capricorn:": "♑", ":aquarius:": "♒", ":pisces:": "♓", ":ophiuchus:": "⛎", ":six_pointed_star:": "🔯", ":atm:": "🏧", ":chart:": "💹", ":heavy_dollar_sign:": "💲", ":currency_exchange:": "💱", ":registered:": "®", ":tm:": "™", ":part_alternation_mark:": "〽", ":wavy_dash:": "〰", ":top:": "🔝", ":end:": "🔚", ":back:": "🔙", ":on:": "🔛", ":soon:": "🔜", ":x:": "❌", ":o:": "⭕", ":exclamation:": ":!:", ":question:": ":?:", ":grey_exclamation:": "❕", ":grey_question:": "❔", ":bangbang:": "‼", ":interrobang:": "⁉", ":arrows_clockwise:": "🔃", ":clock12:": "🕛", ":clock1230:": "🕧", ":clock1:": "🕐", ":clock130:": "🕜", ":clock2:": "🕑", ":clock230:": "🕝", ":clock3:": "🕒", ":clock330:": "🕞", ":clock4:": "🕓", ":clock430:": "🕟", ":clock5:": "🕔", ":clock530:": "🕠", ":clock6:": "🕕", ":clock7:": "🕖", ":clock8:": "🕗", ":clock9:": "🕘", ":clock10:": "🕙", ":clock11:": "🕚", ":clock630:": "🕡", ":clock730:": "🕢", ":clock830:": "🕣", ":clock930:": "🕤", ":clock1030:": "🕥", ":clock1130:": "🕦", ":heavy_multiplication_x:": "✖", ":heavy_plus_sign:": "➕", ":heavy_minus_sign:": "➖", ":heavy_division_sign:": "➗", ":spades:": "♠", ":hearts:": "♥", ":clubs:": "♣", ":diamonds:": "♦", ":white_flower:": "💮", ":100:": "*100*", ":heavy_check_mark:": "✔", ":ballot_box_with_check:": "☑", ":radio_button:": "🔘", ":link:": "🔗", ":curly_loop:": "➰", ":trident:": "🔱", ":black_square_button:": "🔲", ":white_square_button:": "🔳", ":black_medium_square:": "◼", ":white_medium_square:": "◻", ":black_medium_small_square:": "◾", ":white_medium_small_square:": "◽", ":black_small_square:": "▪", ":white_small_square:": "▫", ":small_red_triangle:": "🔺", ":white_large_square:": "⬜", ":black_large_square:": "⬛", ":black_circle:": "⚫", ":white_circle:": "⚪", ":red_circle:": "🔴", ":large_blue_circle:": "🔵", ":small_red_triangle_down:": "🔻", ":large_orange_diamond:": "🔶", ":large_blue_diamond:": "🔷", ":small_orange_diamond:": "🔸", ":small_blue_diamond:": "🔹"}, "unicodeToPoppen": {"😃": ":D", "😄": ":smiley:", "😀": ":)", "😊": ":relaxed:", "☺": "9_9", "😉": ";)", "😍": ":x", "😘": ":kissing_heart:", "😚": ":kissing_closed_eyes:", "😗": ":kissing:", "😙": ":kissing_smiling_eyes:", "😜": ":P", "😝": ":stuck_out_tongue_closed_eyes:", "😛": ":stuck_out_tongue:", "😳": ":flushed:", "😁": ":grin:", "😔": ":pensive:", "😌": ":relieved:", "😒": "¬¬", "😞": ":(", "😣": ":persevere:", "😢": ":cry:", "😂": ":joy:", "😭": ":sob:", "😪": ":sleepy:", "😥": ":disappointed_relieved:", "😰": ":cold_sweat:", "😅": ":sweat_smile:", "😓": ":sweat:", "😩": ":weary:", "😫": ":tired_face:", "😨": ":fearful:", "😱": ":scream:", "😠": ">:(", "😡": ":rage:", "😤": ":triumph:", "😖": ":confounded:", "😆": "xD", "😋": ":yum:", "😷": ":mask:", "😎": "B|", "😴": ":sleeping:", "😵": ":dizzy_face:", "😲": ":astonished:", "😟": ":worried:", "😦": "o.O", "😧": "-_-", "😈": ":smiling_imp:", "👿": ":imp:", "😮": ":o", "😬": ":grimacing:", "😐": ":-/", "😕": "O.o", "😯": ":hushed:", "😶": ":no_mouth:", "😇": "(A)", "😏": ":smirk:", "😑": ":|", "👲": ":man_with_gua_pi_mao:", "👳": ":man_with_turban:", "👮": ":cop:", "👷": ":construction_worker:", "💂": ":guardsman:", "👶": ":baby:", "👦": ":boy:", "👧": ":girl:", "👨": ":man:", "👩": ":woman:", "👴": ":older_man:", "👵": ":older_woman:", "👱": ":person_with_blond_hair:", "👼": ":angel:", "👸": ":princess:", "😺": ":smiley_cat:", "😸": ":smile_cat:", "😻": ":heart_eyes_cat:", "😽": ":kissing_cat:", "😼": ":smirk_cat:", "🙀": ":scream_cat:", "😿": ":crying_cat_face:", "😹": ":joy_cat:", "😾": ":pouting_cat:", "👹": ":japanese_ogre:", "👺": ":japanese_goblin:", "🙈": ":see_no_evil:", "🙉": ":hear_no_evil:", "🙊": ":speak_no_evil:", "💀": ":skull:", "👽": ":alien:", "💩": ":poop:", "🔥": ":fire:", "✨": ":sparkles:", "🌟": ":star2:", "💫": ":dizzy:", "💥": ":boom:", "💢": ":anger:", "💦": ":wdrops:", "💧": ":wdrop:", "💤": ":zzz:", "💨": ":dash:", "👂": ":ear:", "👀": ":eyes:", "👃": ":nose:", "👅": ":tongue:", "👄": ":lips:", "👍": ":thumbsup:", "👎": ":thumbsdown:", "👌": ":ok_hand:", "👊": ":punch:", "✊": ":fist:", "✌": ":v:", "👋": ":wave:", "✋": ":raised_hand:", "👐": ":open_hands:", "👆": ":point_up_2:", "👇": ":point_down:", "👉": ":point_right:", "👈": ":point_left:", "🙌": ":raised_hands:", "🙏": ":pray:", "☝": ":point_up:", "👏": ":clap:", "💪": ":muscle:", "🚶": ":walking:", "🏃": ":runner:", "💃": ":dancer:", "👫": ":couple:", "👪": ":family:", "👬": ":two_men_holding_hands:", "👭": ":two_women_holding_hands:", "💏": ":couplekiss:", "💑": ":couple_with_heart:", "👯": ":dancers:", "🙆": ":ok_woman:", "🙅": ":no_good:", "💁": ":information_desk_person:", "🙋": ":raising_hand:", "💆": ":massage:", "💇": ":haircut:", "💅": ":nail_care:", "👰": ":bride_with_veil:", "🙎": ":person_with_pouting_face:", "🙍": ":person_frowning:", "🙇": ":bow:", "🎩": ":tophat:", "👑": ":crown:", "👒": ":womans_hat:", "👟": ":athletic_shoe:", "👞": ":mans_shoe:", "👡": ":sandal:", "👠": ":high_heel:", "👢": ":boot:", "👕": ":shirt:", "👔": ":necktie:", "👚": ":womans_clothes:", "👗": ":dress:", "🎽": ":running_shirt_with_sash:", "👖": ":jeans:", "👘": ":kimono:", "👙": ":bikini:", "💼": ":briefcase:", "👜": ":handbag:", "👝": ":pouch:", "👛": ":purse:", "👓": ":eyeglasses:", "🎀": ":ribbon:", "🌂": ":closed_umbrella:", "💄": ":lipstick:", "💛": ":yellow_heart:", "💙": ":blue_heart:", "💜": ":purple_heart:", "💚": ":green_heart:", "❤": ":heart:", "💔": ":broken_heart:", "💗": ":heartpulse:", "💓": ":heartbeat:", "💕": ":two_hearts:", "💖": ":sparkling_heart:", "💞": ":revolving_hearts:", "💘": ":cupid:", "💌": ":love_letter:", "💋": ":kiss:", "💍": ":ring:", "💎": ":gem:", "👤": ":bust_in_silhouette:", "👥": ":busts_in_silhouette:", "💬": ":speech_balloon:", "👣": ":footprints:", "💭": ":thought_balloon:", "🐶": ":dog:", "🐺": ":wolf:", "🐱": ":cat:", "🐭": ":mouse:", "🐹": ":hamster:", "🐰": ":rabbit:", "🐸": ":frog:", "🐯": ":tiger:", "🐨": ":koala:", "🐻": ":bear:", "🐷": ":pig:", "🐽": ":pig_nose:", "🐮": ":cow:", "🐗": ":boar:", "🐵": ":monkey_face:", "🐒": ":monkey:", "🐴": ":horse:", "🐑": ":sheep:", "🐘": ":elephant:", "🐼": ":panda_face:", "🐧": ":penguin:", "🐦": ":bird:", "🐤": ":baby_chick:", "🐥": ":hatched_chick:", "🐣": ":hatching_chick:", "🐔": ":chicken:", "🐍": ":snake:", "🐢": ":turtle:", "🐛": ":bug:", "🐝": ":bee:", "🐜": ":ant:", "🐞": ":beetle:", "🐌": ":snail:", "🐙": ":octopus:", "🐚": ":shell:", "🐠": ":tropical_fish:", "🐟": ":fish:", "🐬": ":dolphin:", "🐳": ":whale:", "🐋": ":whale2:", "🐄": ":cow2:", "🐏": ":ram:", "🐀": ":rat:", "🐃": ":water_buffalo:", "🐅": ":tiger2:", "🐇": ":rabbit2:", "🐉": ":dragon:", "🐎": ":racehorse:", "🐐": ":goat:", "🐓": ":rooster:", "🐕": ":dog2:", "🐖": ":pig2:", "🐁": ":mouse2:", "🐂": ":ox:", "🐲": ":dragon_face:", "🐡": ":blowfish:", "🐊": ":crocodile:", "🐫": ":camel:", "🐪": ":dromedary_camel:", "🐆": ":leopard:", "🐈": ":cat2:", "🐩": ":poodle:", "🐾": ":feet:", "💐": ":bouquet:", "🌸": ":cherry_blossom:", "🌷": ":tulip:", "🍀": ":four_leaf_clover:", "🌹": ":rose:", "🌻": ":sunflower:", "🌺": ":hibiscus:", "🍁": ":maple_leaf:", "🍃": ":leaves:", "🍂": ":fallen_leaf:", "🌿": ":herb:", "🌾": ":ear_of_rice:", "🍄": ":mushroom:", "🌵": ":cactus:", "🌴": ":palm_tree:", "🌲": ":evergreen_tree:", "🌳": ":deciduous_tree:", "🌰": ":chestnut:", "🌱": ":seedling:", "🌼": ":blossom:", "🌐": ":globe_with_meridians:", "🌞": ":sun_with_face:", "🌝": ":full_moon_with_face:", "🌚": ":new_moon_with_face:", "🌑": ":new_moon:", "🌒": ":waxing_crescent_moon:", "🌓": ":first_quarter_moon:", "🌔": ":waxing_gibbous_moon:", "🌕": ":full_moon:", "🌖": ":waning_gibbous_moon:", "🌗": ":last_quarter_moon:", "🌘": ":waning_crescent_moon:", "🌜": ":last_quarter_moon_with_face:", "🌛": ":first_quarter_moon_with_face:", "🌙": ":crescent_moon:", "🌍": ":earth_africa:", "🌎": ":earth_americas:", "🌏": ":earth_asia:", "🌋": ":volcano:", "🌌": ":milky_way:", "🌠": ":stars:", "⭐": ":star:", "☀": ":sunny:", "⛅": ":partly_sunny:", "☁": ":cloud:", "⚡": ":zap:", "☔": ":umbrella:", "❄": ":snowflake:", "⛄": ":snowman:", "🌀": ":cyclone:", "🌁": ":foggy:", "🌈": ":rainbow:", "🌊": ":ocean:", "🎍": ":bamboo:", "💝": ":gift_heart:", "🎎": ":dolls:", "🎒": ":school_satchel:", "🎓": ":mortar_board:", "🎏": ":flags:", "🎆": ":fireworks:", "🎇": ":sparkler:", "🎐": ":wind_chime:", "🎑": ":rice_scene:", "🎃": ":jack_o_lantern:", "👻": ":ghost:", "🎅": ":santa:", "🎄": ":christmas_tree:", "🎁": ":gift:", "🎋": ":tanabata_tree:", "🎉": ":tada:", "🎊": ":confetti_ball:", "🎈": ":balloon:", "🎌": ":crossed_flags:", "🔮": ":crystal_ball:", "🎥": ":movie_camera:", "📷": ":camera:", "📹": ":video_camera:", "📼": ":vhs:", "💿": ":cd:", "📀": ":dvd:", "💽": ":minidisc:", "💾": ":floppy_disk:", "💻": ":computer:", "📱": ":iphone:", "☎": ":telephone:", "📞": ":telephone_receiver:", "📟": ":pager:", "📠": ":fax:", "📡": ":satellite:", "📺": ":tv:", "📻": ":radio:", "🔊": ":loud_sound:", "🔉": ":sound:", "🔈": ":speaker:", "🔇": ":mute:", "🔔": ":bell:", "🔕": ":no_bell:", "📢": ":loudspeaker:", "📣": ":mega:", "⏳": ":hourglass_flowing_sand:", "⌛": ":hourglass:", "⏰": ":alarm_clock:", "⌚": ":watch:", "🔓": ":unlock:", "🔒": ":lock:", "🔏": ":lock_with_ink_pen:", "🔐": ":closed_lock_with_key:", "🔑": ":key:", "🔎": ":mag_right:", "💡": ":bulb:", "🔦": ":flashlight:", "🔆": ":high_brightness:", "🔅": ":low_brightness:", "🔌": ":electric_plug:", "🔋": ":battery:", "🔍": ":mag:", "🛁": ":bathtub:", "🛀": ":bath:", "🚿": ":shower:", "🚽": ":toilet:", "🔧": ":wrench:", "🔩": ":nut_and_bolt:", "🔨": ":hammer:", "🚪": ":door:", "🚬": ":smoking:", "💣": ":bomb:", "🔫": ":gun:", "🔪": ":knife:", "💊": ":pill:", "💉": ":syringe:", "💰": ":moneybag:", "💴": ":yen:", "💵": ":dollar:", "💷": ":pound:", "💶": ":euro:", "💳": ":credit_card:", "💸": ":money_with_wings:", "📲": ":calling:", "📧": ":e-mail:", "📥": ":inbox_tray:", "📤": ":outbox_tray:", "✉": ":envelope:", "📩": ":envelope_with_arrow:", "📨": ":incoming_envelope:", "📯": ":postal_horn:", "📫": ":mailbox:", "📪": ":mailbox_closed:", "📬": ":mailbox_with_mail:", "📭": ":mailbox_with_no_mail:", "📮": ":postbox:", "📦": ":package:", "📝": ":pencil:", "📄": ":page_facing_up:", "📃": ":page_with_curl:", "📑": ":bookmark_tabs:", "📊": ":bar_chart:", "📈": ":chart_with_upwards_trend:", "📉": ":chart_with_downwards_trend:", "📜": ":scroll:", "📋": ":clipboard:", "📅": ":date:", "📆": ":calendar:", "📇": ":card_index:", "📁": ":file_folder:", "📂": ":open_file_folder:", "✂": ":scissors:", "📌": ":pushpin:", "📎": ":paperclip:", "✒": ":black_nib:", "✏": ":pencil2:", "📏": ":straight_ruler:", "📐": ":triangular_ruler:", "📕": ":closed_book:", "📗": ":green_book:", "📘": ":blue_book:", "📙": ":orange_book:", "📓": ":notebook:", "📔": ":notebook_with_decorative_cover:", "📒": ":ledger:", "📚": ":books:", "📖": ":book:", "🔖": ":bookmark:", "📛": ":name_badge:", "🔬": ":microscope:", "🔭": ":telescope:", "📰": ":newspaper:", "🎨": ":art:", "🎬": ":clapper:", "🎤": ":microphone:", "🎧": ":headphones:", "🎼": ":musical_score:", "🎵": ":musical_note:", "🎶": ":notes:", "🎹": ":musical_keyboard:", "🎻": ":violin:", "🎺": ":trumpet:", "🎷": ":saxophone:", "🎸": ":guitar:", "👾": ":space_invader:", "🎮": ":video_game:", "🃏": ":black_joker:", "🎴": ":flower_playing_cards:", "🀄": ":mahjong:", "🎲": ":game_die:", "🎯": ":dart:", "🏈": ":football:", "🏀": ":basketball:", "⚽": ":soccer:", "⚾": ":baseball:", "🎾": ":tennis:", "🎱": ":8ball:", "🏉": ":rugby_football:", "🎳": ":bowling:", "⛳": ":golf:", "🚵": ":mountain_bicyclist:", "🚴": ":bicyclist:", "🏁": ":checkered_flag:", "🏇": ":horse_racing:", "🏆": ":trophy:", "🎿": ":ski:", "🏂": ":snowboarder:", "🏊": ":swimmer:", "🏄": ":surfer:", "🎣": ":fishing_pole_and_fish:", "☕": ":coffee:", "🍵": ":tea:", "🍶": ":sake:", "🍼": ":baby_bottle:", "🍺": ":beer:", "🍻": ":beers:", "🍸": ":cocktail:", "🍹": ":tropical_drink:", "🍷": ":wine_glass:", "🍴": ":fork_and_knife:", "🍕": ":pizza:", "🍔": ":hamburger:", "🍟": ":fries:", "🍗": ":poultry_leg:", "🍖": ":meat_on_bone:", "🍝": ":spaghetti:", "🍛": ":curry:", "🍤": ":fried_shrimp:", "🍱": ":bento:", "🍣": ":sushi:", "🍥": ":fish_cake:", "🍙": ":rice_ball:", "🍘": ":rice_cracker:", "🍚": ":rice:", "🍜": ":ramen:", "🍲": ":stew:", "🍢": ":oden:", "🍡": ":dango:", "🍳": ":egg:", "🍞": ":bread:", "🍩": ":doughnut:", "🍮": ":custard:", "🍦": ":icecream:", "🍨": ":ice_cream:", "🍧": ":shaved_ice:", "🎂": ":birthday:", "🍰": ":cake:", "🍪": ":cookie:", "🍫": ":chocolate_bar:", "🍬": ":candy:", "🍭": ":lollipop:", "🍯": ":pussy:", "🍎": ":apple:", "🍏": ":green_apple:", "🍊": ":tangerine:", "🍋": ":lemon:", "🍒": ":cherries:", "🍇": ":grapes:", "🍉": ":watermelon:", "🍓": ":strawberry:", "🍑": ":peach:", "🍈": ":melon:", "🍐": ":pear:", "🍍": ":pineapple:", "🍠": ":sweet_potato:", "🍆": ":cock:", "🍅": ":tomato:", "🌽": ":corn:", "🏠": ":house:", "🏡": ":house_with_garden:", "🏫": ":school:", "🏢": ":office:", "🏣": ":post_office:", "🏥": ":hospital:", "🏦": ":bank:", "🏪": ":convenience_store:", "🏩": ":love_hotel:", "🏨": ":hotel:", "💒": ":wedding:", "⛪": ":church:", "🏬": ":department_store:", "🏤": ":european_post_office:", "🌇": ":city_sunset:", "🌆": ":city_dusk:", "🏯": ":japanese_castle:", "🏰": ":european_castle:", "⛺": ":tent:", "🏭": ":factory:", "🗼": ":tokyo_tower:", "🗾": ":japan:", "🗻": ":mount_fuji:", "🌄": ":sunrise_over_mountains:", "🌅": ":sunrise:", "🌃": ":night_with_stars:", "🗽": ":statue_of_liberty:", "🌉": ":bridge_at_night:", "🎠": ":carousel_horse:", "🎡": ":ferris_wheel:", "⛲": ":fountain:", "🎢": ":roller_coaster:", "🚢": ":ship:", "⛵": ":sailboat:", "🚤": ":speedboat:", "🚣": ":rowboat:", "⚓": ":anchor:", "🚀": ":rocket:", "✈": ":airplane:", "💺": ":seat:", "🚁": ":helicopter:", "🚂": ":steam_locomotive:", "🚊": ":tram:", "🚉": ":station:", "🚞": ":mountain_railway:", "🚆": ":train2:", "🚄": ":bullettrain_side:", "🚅": ":bullettrain_front:", "🚈": ":light_rail:", "🚇": ":metro:", "🚝": ":monorail:", "🚋": ":train:", "🚃": ":railway_car:", "🚎": ":trolleybus:", "🚌": ":bus:", "🚍": ":oncoming_bus:", "🚙": ":blue_car:", "🚘": ":oncoming_automobile:", "🚗": ":red_car:", "🚕": ":taxi:", "🚖": ":oncoming_taxi:", "🚛": ":articulated_lorry:", "🚚": ":truck:", "🚨": ":rotating_light:", "🚓": ":police_car:", "🚔": ":oncoming_police_car:", "🚒": ":fire_engine:", "🚑": ":ambulance:", "🚐": ":minibus:", "🚲": ":bike:", "🚡": ":aerial_tramway:", "🚟": ":suspension_railway:", "🚠": ":mountain_cableway:", "🚜": ":tractor:", "💈": ":barber:", "🚏": ":busstop:", "🎫": ":ticket:", "🚦": ":vertical_traffic_light:", "🚥": ":traffic_light:", "⚠": ":warning:", "🚧": ":construction:", "🔰": ":beginner:", "⛽": ":fuelpump:", "🏮": ":izakaya_lantern:", "🎰": ":slot_machine:", "♨": ":hotsprings:", "🗿": ":moyai:", "🎪": ":circus_tent:", "🎭": ":performing_arts:", "📍": ":round_pushpin:", "🚩": ":triangular_flag_on_post:", "🇨🇳": ":cn:", "🇺🇸": ":us:", "🇯🇵": ":jp:", "🇷🇺": ":ru:", "🇩🇪": ":de:", "🇬🇧": ":gb:", "🇫🇷": ":fr:", "🇰🇷": ":kr:", "🇮🇹": ":it:", "🇪🇸": ":es:", "🚭": ":no_smoking:", "🔞": ":over18:", "©": ":copyright:", "🅿": ":parking:", "🚾": ":wc:", "#⃣": ":hash:", "1⃣": ":one:", "2⃣": ":two:", "3⃣": ":three:", "4⃣": ":four:", "5⃣": ":five:", "6⃣": ":six:", "7⃣": ":seven:", "8⃣": ":eight:", "9⃣": ":nine:", "0⃣": ":zero:", "🔟": ":keycap_ten:", "🔢": ":1234:", "🔣": ":symbols:", "⬆": ":arrow_up:", "⬇": ":arrow_down:", "⬅": ":arrow_left:", "➡": ":arrow_right:", "🔠": ":capital_abcd:", "🔡": ":abcd:", "🔤": ":abc:", "↗": ":arrow_upper_right:", "↖": ":arrow_upper_left:", "↘": ":arrow_lower_right:", "↙": ":arrow_lower_left:", "↔": ":left_right_arrow:", "↕": ":arrow_up_down:", "🔄": ":arrows_counterclockwise:", "◀": ":arrow_backward:", "▶": ":arrow_forward:", "🔼": ":arrow_up_small:", "🔽": ":arrow_down_small:", "↩": ":leftwards_arrow_with_hook:", "↪": ":arrow_right_hook:", "ℹ": ":information_source:", "⏪": ":rewind:", "⏩": ":fast_forward:", "⏫": ":arrow_double_up:", "⏬": ":arrow_double_down:", "⤵": ":arrow_heading_down:", "⤴": ":arrow_heading_up:", "🆗": ":ok:", "🔀": ":twisted_rightwards_arrows:", "🔁": ":repeat:", "🔂": ":repeat_one:", "🆕": ":new:", "🆙": ":up:", "🆒": ":cool:", "🆓": ":free:", "🆖": ":ng:", "📶": ":signal_strength:", "🎦": ":cinema:", "🈁": ":koko:", "🈯": ":u6307:", "🈳": ":u7a7a:", "🈵": ":u6e80:", "🈴": ":u5408:", "🈲": ":u7981:", "🉐": ":ideograph_advantage:", "🈹": ":u5272:", "🈺": ":u55b6:", "🈶": ":u6709:", "🈚": ":u7121:", "🚻": ":restroom:", "🚹": ":mens:", "🚺": ":womens:", "🚼": ":baby_symbol:", "🚰": ":potable_water:", "🚮": ":put_litter_in_its_place:", "♿": ":wheelchair:", "🈷": ":u6708:", "🈸": ":u7533:", "🈂": ":sa:", "Ⓜ": ":m:", "🛂": ":passport_control:", "🛄": ":baggage_claim:", "🛅": ":left_luggage:", "🛃": ":customs:", "🉑": ":accept:", "㊙": ":secret:", "㊗": ":congratulations:", "🆑": ":cl:", "🆘": ":sos:", "🆔": ":id:", "🚫": ":no_entry_sign:", "📵": ":no_mobile_phones:", "🚯": ":do_not_litter:", "🚱": ":non-potable_water:", "🚳": ":no_bicycles:", "🚷": ":no_pedestrians:", "🚸": ":children_crossing:", "⛔": ":no_entry:", "✳": ":eight_spoked_asterisk:", "❇": ":sparkle:", "❎": ":negative_squared_cross_mark:", "✅": ":white_check_mark:", "✴": ":eight_pointed_black_star:", "💟": ":heart_decoration:", "🆚": ":vs:", "📳": ":vibration_mode:", "📴": ":mobile_phone_off:", "🅰": ":a:", "🅱": ":b:", "🆎": ":ab:", "🅾": ":o2:", "💠": ":diamond_shape_with_a_dot_inside:", "➿": ":loop:", "♻": ":recycle:", "♈": ":aries:", "♉": ":taurus:", "♊": ":gemini:", "♋": ":cancer:", "♌": ":leo:", "♍": ":virgo:", "♎": ":libra:", "♏": ":scorpius:", "♐": ":sagittarius:", "♑": ":capricorn:", "♒": ":aquarius:", "♓": ":pisces:", "⛎": ":ophiuchus:", "🔯": ":six_pointed_star:", "🏧": ":atm:", "💹": ":chart:", "💲": ":heavy_dollar_sign:", "💱": ":currency_exchange:", "®": ":registered:", "™": ":tm:", "〽": ":part_alternation_mark:", "〰": ":wavy_dash:", "🔝": ":top:", "🔚": ":end:", "🔙": ":back:", "🔛": ":on:", "🔜": ":soon:", "❌": ":x:", "⭕": ":o:", "❗": ":exclamation:", "❓": ":question:", "❕": ":grey_exclamation:", "❔": ":grey_question:", "‼": ":bangbang:", "⁉": ":interrobang:", "🔃": ":arrows_clockwise:", "🕛": ":clock12:", "🕧": ":clock1230:", "🕐": ":clock1:", "🕜": ":clock130:", "🕑": ":clock2:", "🕝": ":clock230:", "🕒": ":clock3:", "🕞": ":clock330:", "🕓": ":clock4:", "🕟": ":clock430:", "🕔": ":clock5:", "🕠": ":clock530:", "🕕": ":clock6:", "🕖": ":clock7:", "🕗": ":clock8:", "🕘": ":clock9:", "🕙": ":clock10:", "🕚": ":clock11:", "🕡": ":clock630:", "🕢": ":clock730:", "🕣": ":clock830:", "🕤": ":clock930:", "🕥": ":clock1030:", "🕦": ":clock1130:", "✖": ":heavy_multiplication_x:", "➕": ":heavy_plus_sign:", "➖": ":heavy_minus_sign:", "➗": ":heavy_division_sign:", "♠": ":spades:", "♥": ":hearts:", "♣": ":clubs:", "♦": ":diamonds:", "💮": ":white_flower:", "💯": ":100:", "✔": ":heavy_check_mark:", "☑": ":ballot_box_with_check:", "🔘": ":radio_button:", "🔗": ":link:", "➰": ":curly_loop:", "🔱": ":trident:", "🔲": ":black_square_button:", "🔳": ":white_square_button:", "◼": ":black_medium_square:", "◻": ":white_medium_square:", "◾": ":black_medium_small_square:", "◽": ":white_medium_small_square:", "▪": ":black_small_square:", "▫": ":white_small_square:", "🔺": ":small_red_triangle:", "⬜": ":white_large_square:", "⬛": ":black_large_square:", "⚫": ":black_circle:", "⚪": ":white_circle:", "🔴": ":red_circle:", "🔵": ":large_blue_circle:", "🔻": ":small_red_triangle_down:", "🔶": ":large_orange_diamond:", "🔷": ":large_blue_diamond:", "🔸": ":small_orange_diamond:", "🔹": ":small_blue_diamond:", "🖕": ":fucku:", "🧑‍⚕": ":dr_love:", "🍌": ":banana:", "👨‍⚕": ":dr_love:", "👩‍⚕": ":dr_love:"}, "poppenToUnicode": {":D": "😃", ":smiley:": "😄", ":)": "😀", ":relaxed:": "😊", "9_9": "☺", ";)": "😉", ":x": "😍", ":kissing_heart:": "😘", ":kissing_closed_eyes:": "😚", ":kissing:": "😗", ":kissing_smiling_eyes:": "😙", ":P": "😜", ":stuck_out_tongue_closed_eyes:": "😝", ":stuck_out_tongue:": "😛", ":flushed:": "😳", ":grin:": "😁", ":pensive:": "😔", ":relieved:": "😌", "¬¬": "😒", ":(": "😞", ":persevere:": "😣", ":cry:": "😢", ":joy:": "😂", ":sob:": "😭", ":sleepy:": "😪", ":disappointed_relieved:": "😥", ":cold_sweat:": "😰", ":sweat_smile:": "😅", ":sweat:": "😓", ":weary:": "😩", ":tired_face:": "😫", ":fearful:": "😨", ":scream:": "😱", ">:(": "😠", ":rage:": "😡", ":triumph:": "😤", ":confounded:": "😖", "xD": "😆", ":yum:": "😋", ":mask:": "😷", "B|": "😎", ":sleeping:": "😴", ":dizzy_face:": "😵", ":astonished:": "😲", ":worried:": "😟", "o.O": "😦", "-_-": "😧", ":smiling_imp:": "😈", ":imp:": "👿", ":o": "😮", ":grimacing:": "😬", ":-/": "😐", "O.o": "😕", ":hushed:": "😯", ":no_mouth:": "😶", "(A)": "😇", ":smirk:": "😏", ":|": "😑", ":man_with_gua_pi_mao:": "👲", ":man_with_turban:": "👳", ":cop:": "👮", ":construction_worker:": "👷", ":guardsman:": "💂", ":baby:": "👶", ":boy:": "👦", ":girl:": "👧", ":man:": "👨", ":woman:": "👩", ":older_man:": "👴", ":older_woman:": "👵", ":person_with_blond_hair:": "👱", ":angel:": "👼", ":princess:": "👸", ":smiley_cat:": "😺", ":smile_cat:": "😸", ":heart_eyes_cat:": "😻", ":kissing_cat:": "😽", ":smirk_cat:": "😼", ":scream_cat:": "🙀", ":crying_cat_face:": "😿", ":joy_cat:": "😹", ":pouting_cat:": "😾", ":japanese_ogre:": "👹", ":japanese_goblin:": "👺", ":see_no_evil:": "🙈", ":hear_no_evil:": "🙉", ":speak_no_evil:": "🙊", ":skull:": "💀", ":alien:": "👽", ":poop:": "💩", ":fire:": "🔥", ":sparkles:": "✨", ":star2:": "🌟", ":dizzy:": "💫", ":boom:": "💥", ":anger:": "💢", ":sweat_drops:": "💦", ":droplet:": "💧", ":zzz:": "💤", ":dash:": "💨", ":ear:": "👂", ":eyes:": "👀", ":nose:": "👃", ":tongue:": "👅", ":lips:": "👄", ":thumbsup:": "👍", ":thumbsdown:": "👎", ":ok_hand:": "👌", ":punch:": "👊", ":fist:": "✊", ":v:": "✌", ":wave:": "👋", ":raised_hand:": "✋", ":open_hands:": "👐", ":point_up_2:": "👆", ":point_down:": "👇", ":point_right:": "👉", ":point_left:": "👈", ":raised_hands:": "🙌", ":pray:": "🙏", ":point_up:": "☝", ":clap:": "👏", ":muscle:": "💪", ":walking:": "🚶", ":runner:": "🏃", ":dancer:": "💃", ":couple:": "👫", ":family:": "👪", ":two_men_holding_hands:": "👬", ":two_women_holding_hands:": "👭", ":couplekiss:": "💏", ":couple_with_heart:": "💑", ":dancers:": "👯", ":ok_woman:": "🙆", ":no_good:": "🙅", ":information_desk_person:": "💁", ":raising_hand:": "🙋", ":massage:": "💆", ":haircut:": "💇", ":nail_care:": "💅", ":bride_with_veil:": "👰", ":person_with_pouting_face:": "🙎", ":person_frowning:": "🙍", ":bow:": "🙇", ":tophat:": "🎩", ":crown:": "👑", ":womans_hat:": "👒", ":athletic_shoe:": "👟", ":mans_shoe:": "👞", ":sandal:": "👡", ":high_heel:": "👠", ":boot:": "👢", ":shirt:": "👕", ":necktie:": "👔", ":womans_clothes:": "👚", ":dress:": "👗", ":running_shirt_with_sash:": "🎽", ":jeans:": "👖", ":kimono:": "👘", ":bikini:": "👙", ":briefcase:": "💼", ":handbag:": "👜", ":pouch:": "👝", ":purse:": "👛", ":eyeglasses:": "👓", ":ribbon:": "🎀", ":closed_umbrella:": "🌂", ":lipstick:": "💄", ":yellow_heart:": "💛", ":blue_heart:": "💙", ":purple_heart:": "💜", ":green_heart:": "💚", ":heart:": "❤", ":broken_heart:": "💔", ":heartpulse:": "💗", ":heartbeat:": "💓", ":two_hearts:": "💕", ":sparkling_heart:": "💖", ":revolving_hearts:": "💞", ":cupid:": "💘", ":love_letter:": "💌", ":kiss:": "💋", ":ring:": "💍", ":gem:": "💎", ":bust_in_silhouette:": "👤", ":busts_in_silhouette:": "👥", ":speech_balloon:": "💬", ":footprints:": "👣", ":thought_balloon:": "💭", ":dog:": "🐶", ":wolf:": "🐺", ":cat:": "🐱", ":mouse:": "🐭", ":hamster:": "🐹", ":rabbit:": "🐰", ":frog:": "🐸", ":tiger:": "🐯", ":koala:": "🐨", ":bear:": "🐻", ":pig:": "🐷", ":pig_nose:": "🐽", ":cow:": "🐮", ":boar:": "🐗", ":monkey_face:": "🐵", ":monkey:": "🐒", ":horse:": "🐴", ":sheep:": "🐑", ":elephant:": "🐘", ":panda_face:": "🐼", ":penguin:": "🐧", ":bird:": "🐦", ":baby_chick:": "🐤", ":hatched_chick:": "🐥", ":hatching_chick:": "🐣", ":chicken:": "🐔", ":snake:": "🐍", ":turtle:": "🐢", ":bug:": "🐛", ":bee:": "🐝", ":ant:": "🐜", ":beetle:": "🐞", ":snail:": "🐌", ":octopus:": "🐙", ":shell:": "🐚", ":tropical_fish:": "🐠", ":fish:": "🐟", ":dolphin:": "🐬", ":whale:": "🐳", ":whale2:": "🐋", ":cow2:": "🐄", ":ram:": "🐏", ":rat:": "🐀", ":water_buffalo:": "🐃", ":tiger2:": "🐅", ":rabbit2:": "🐇", ":dragon:": "🐉", ":racehorse:": "🐎", ":goat:": "🐐", ":rooster:": "🐓", ":dog2:": "🐕", ":pig2:": "🐖", ":mouse2:": "🐁", ":ox:": "🐂", ":dragon_face:": "🐲", ":blowfish:": "🐡", ":crocodile:": "🐊", ":camel:": "🐫", ":dromedary_camel:": "🐪", ":leopard:": "🐆", ":cat2:": "🐈", ":poodle:": "🐩", ":feet:": "🐾", ":bouquet:": "💐", ":cherry_blossom:": "🌸", ":tulip:": "🌷", ":four_leaf_clover:": "🍀", ":rose:": "🌹", ":sunflower:": "🌻", ":hibiscus:": "🌺", ":maple_leaf:": "🍁", ":leaves:": "🍃", ":fallen_leaf:": "🍂", ":herb:": "🌿", ":ear_of_rice:": "🌾", ":mushroom:": "🍄", ":cactus:": "🌵", ":palm_tree:": "🌴", ":evergreen_tree:": "🌲", ":deciduous_tree:": "🌳", ":chestnut:": "🌰", ":seedling:": "🌱", ":blossom:": "🌼", ":globe_with_meridians:": "🌐", ":sun_with_face:": "🌞", ":full_moon_with_face:": "🌝", ":new_moon_with_face:": "🌚", ":new_moon:": "🌑", ":waxing_crescent_moon:": "🌒", ":first_quarter_moon:": "🌓", ":waxing_gibbous_moon:": "🌔", ":full_moon:": "🌕", ":waning_gibbous_moon:": "🌖", ":last_quarter_moon:": "🌗", ":waning_crescent_moon:": "🌘", ":last_quarter_moon_with_face:": "🌜", ":first_quarter_moon_with_face:": "🌛", ":crescent_moon:": "🌙", ":earth_africa:": "🌍", ":earth_americas:": "🌎", ":earth_asia:": "🌏", ":volcano:": "🌋", ":milky_way:": "🌌", ":stars:": "🌠", ":star:": "⭐", ":sunny:": "☀", ":partly_sunny:": "⛅", ":cloud:": "☁", ":zap:": "⚡", ":umbrella:": "☔", ":snowflake:": "❄", ":snowman:": "⛄", ":cyclone:": "🌀", ":foggy:": "🌁", ":rainbow:": "🌈", ":ocean:": "🌊", ":bamboo:": "🎍", ":gift_heart:": "💝", ":dolls:": "🎎", ":school_satchel:": "🎒", ":mortar_board:": "🎓", ":flags:": "🎏", ":fireworks:": "🎆", ":sparkler:": "🎇", ":wind_chime:": "🎐", ":rice_scene:": "🎑", ":jack_o_lantern:": "🎃", ":ghost:": "👻", ":santa:": "🎅", ":christmas_tree:": "🎄", ":gift:": "🎁", ":tanabata_tree:": "🎋", ":tada:": "🎉", ":confetti_ball:": "🎊", ":balloon:": "🎈", ":crossed_flags:": "🎌", ":crystal_ball:": "🔮", ":movie_camera:": "🎥", ":camera:": "📷", ":video_camera:": "📹", ":vhs:": "📼", ":cd:": "💿", ":dvd:": "📀", ":minidisc:": "💽", ":floppy_disk:": "💾", ":computer:": "💻", ":iphone:": "📱", ":telephone:": "☎", ":telephone_receiver:": "📞", ":pager:": "📟", ":fax:": "📠", ":satellite:": "📡", ":tv:": "📺", ":radio:": "📻", ":loud_sound:": "🔊", ":sound:": "🔉", ":speaker:": "🔈", ":mute:": "🔇", ":bell:": "🔔", ":no_bell:": "🔕", ":loudspeaker:": "📢", ":mega:": "📣", ":hourglass_flowing_sand:": "⏳", ":hourglass:": "⌛", ":alarm_clock:": "⏰", ":watch:": "⌚", ":unlock:": "🔓", ":lock:": "🔒", ":lock_with_ink_pen:": "🔏", ":closed_lock_with_key:": "🔐", ":key:": "🔑", ":mag_right:": "🔎", ":bulb:": "💡", ":flashlight:": "🔦", ":high_brightness:": "🔆", ":low_brightness:": "🔅", ":electric_plug:": "🔌", ":battery:": "🔋", ":mag:": "🔍", ":bathtub:": "🛁", ":bath:": "🛀", ":shower:": "🚿", ":toilet:": "🚽", ":wrench:": "🔧", ":nut_and_bolt:": "🔩", ":hammer:": "🔨", ":door:": "🚪", ":smoking:": "🚬", ":bomb:": "💣", ":gun:": "🔫", ":knife:": "🔪", ":pill:": "💊", ":syringe:": "💉", ":moneybag:": "💰", ":yen:": "💴", ":dollar:": "💵", ":pound:": "💷", ":euro:": "💶", ":credit_card:": "💳", ":money_with_wings:": "💸", ":calling:": "📲", ":e-mail:": "📧", ":inbox_tray:": "📥", ":outbox_tray:": "📤", ":envelope:": "✉", ":envelope_with_arrow:": "📩", ":incoming_envelope:": "📨", ":postal_horn:": "📯", ":mailbox:": "📫", ":mailbox_closed:": "📪", ":mailbox_with_mail:": "📬", ":mailbox_with_no_mail:": "📭", ":postbox:": "📮", ":package:": "📦", ":pencil:": "📝", ":page_facing_up:": "📄", ":page_with_curl:": "📃", ":bookmark_tabs:": "📑", ":bar_chart:": "📊", ":chart_with_upwards_trend:": "📈", ":chart_with_downwards_trend:": "📉", ":scroll:": "📜", ":clipboard:": "📋", ":date:": "📅", ":calendar:": "📆", ":card_index:": "📇", ":file_folder:": "📁", ":open_file_folder:": "📂", ":scissors:": "✂", ":pushpin:": "📌", ":paperclip:": "📎", ":black_nib:": "✒", ":pencil2:": "✏", ":straight_ruler:": "📏", ":triangular_ruler:": "📐", ":closed_book:": "📕", ":green_book:": "📗", ":blue_book:": "📘", ":orange_book:": "📙", ":notebook:": "📓", ":notebook_with_decorative_cover:": "📔", ":ledger:": "📒", ":books:": "📚", ":book:": "📖", ":bookmark:": "🔖", ":name_badge:": "📛", ":microscope:": "🔬", ":telescope:": "🔭", ":newspaper:": "📰", ":art:": "🎨", ":clapper:": "🎬", ":microphone:": "🎤", ":headphones:": "🎧", ":musical_score:": "🎼", ":musical_note:": "🎵", ":notes:": "🎶", ":musical_keyboard:": "🎹", ":violin:": "🎻", ":trumpet:": "🎺", ":saxophone:": "🎷", ":guitar:": "🎸", ":space_invader:": "👾", ":video_game:": "🎮", ":black_joker:": "🃏", ":flower_playing_cards:": "🎴", ":mahjong:": "🀄", ":game_die:": "🎲", ":dart:": "🎯", ":football:": "🏈", ":basketball:": "🏀", ":soccer:": "⚽", ":baseball:": "⚾", ":tennis:": "🎾", ":8ball:": "🎱", ":rugby_football:": "🏉", ":bowling:": "🎳", ":golf:": "⛳", ":mountain_bicyclist:": "🚵", ":bicyclist:": "🚴", ":checkered_flag:": "🏁", ":horse_racing:": "🏇", ":trophy:": "🏆", ":ski:": "🎿", ":snowboarder:": "🏂", ":swimmer:": "🏊", ":surfer:": "🏄", ":fishing_pole_and_fish:": "🎣", ":coffee:": "☕", ":tea:": "🍵", ":sake:": "🍶", ":baby_bottle:": "🍼", ":beer:": "🍺", ":beers:": "🍻", ":cocktail:": "🍸", ":tropical_drink:": "🍹", ":wine_glass:": "🍷", ":fork_and_knife:": "🍴", ":pizza:": "🍕", ":hamburger:": "🍔", ":fries:": "🍟", ":poultry_leg:": "🍗", ":meat_on_bone:": "🍖", ":spaghetti:": "🍝", ":curry:": "🍛", ":fried_shrimp:": "🍤", ":bento:": "🍱", ":sushi:": "🍣", ":fish_cake:": "🍥", ":rice_ball:": "🍙", ":rice_cracker:": "🍘", ":rice:": "🍚", ":ramen:": "🍜", ":stew:": "🍲", ":oden:": "🍢", ":dango:": "🍡", ":egg:": "🍳", ":bread:": "🍞", ":doughnut:": "🍩", ":custard:": "🍮", ":icecream:": "🍦", ":ice_cream:": "🍨", ":shaved_ice:": "🍧", ":birthday:": "🎂", ":cake:": "🍰", ":cookie:": "🍪", ":chocolate_bar:": "🍫", ":candy:": "🍬", ":lollipop:": "🍭", ":honey_pot:": "🍯", ":apple:": "🍎", ":green_apple:": "🍏", ":tangerine:": "🍊", ":lemon:": "🍋", ":cherries:": "🍒", ":grapes:": "🍇", ":watermelon:": "🍉", ":strawberry:": "🍓", ":peach:": "🍑", ":melon:": "🍈", ":pear:": "🍐", ":pineapple:": "🍍", ":sweet_potato:": "🍠", ":eggplant:": "🍆", ":tomato:": "🍅", ":corn:": "🌽", ":house:": "🏠", ":house_with_garden:": "🏡", ":school:": "🏫", ":office:": "🏢", ":post_office:": "🏣", ":hospital:": "🏥", ":bank:": "🏦", ":convenience_store:": "🏪", ":love_hotel:": "🏩", ":hotel:": "🏨", ":wedding:": "💒", ":church:": "⛪", ":department_store:": "🏬", ":european_post_office:": "🏤", ":city_sunset:": "🌇", ":city_dusk:": "🌆", ":japanese_castle:": "🏯", ":european_castle:": "🏰", ":tent:": "⛺", ":factory:": "🏭", ":tokyo_tower:": "🗼", ":japan:": "🗾", ":mount_fuji:": "🗻", ":sunrise_over_mountains:": "🌄", ":sunrise:": "🌅", ":night_with_stars:": "🌃", ":statue_of_liberty:": "🗽", ":bridge_at_night:": "🌉", ":carousel_horse:": "🎠", ":ferris_wheel:": "🎡", ":fountain:": "⛲", ":roller_coaster:": "🎢", ":ship:": "🚢", ":sailboat:": "⛵", ":speedboat:": "🚤", ":rowboat:": "🚣", ":anchor:": "⚓", ":rocket:": "🚀", ":airplane:": "✈", ":seat:": "💺", ":helicopter:": "🚁", ":steam_locomotive:": "🚂", ":tram:": "🚊", ":station:": "🚉", ":mountain_railway:": "🚞", ":train2:": "🚆", ":bullettrain_side:": "🚄", ":bullettrain_front:": "🚅", ":light_rail:": "🚈", ":metro:": "🚇", ":monorail:": "🚝", ":train:": "🚋", ":railway_car:": "🚃", ":trolleybus:": "🚎", ":bus:": "🚌", ":oncoming_bus:": "🚍", ":blue_car:": "🚙", ":oncoming_automobile:": "🚘", ":red_car:": "🚗", ":taxi:": "🚕", ":oncoming_taxi:": "🚖", ":articulated_lorry:": "🚛", ":truck:": "🚚", ":rotating_light:": "🚨", ":police_car:": "🚓", ":oncoming_police_car:": "🚔", ":fire_engine:": "🚒", ":ambulance:": "🚑", ":minibus:": "🚐", ":bike:": "🚲", ":aerial_tramway:": "🚡", ":suspension_railway:": "🚟", ":mountain_cableway:": "🚠", ":tractor:": "🚜", ":barber:": "💈", ":busstop:": "🚏", ":ticket:": "🎫", ":vertical_traffic_light:": "🚦", ":traffic_light:": "🚥", ":warning:": "⚠", ":construction:": "🚧", ":beginner:": "🔰", ":fuelpump:": "⛽", ":izakaya_lantern:": "🏮", ":slot_machine:": "🎰", ":hotsprings:": "♨", ":moyai:": "🗿", ":circus_tent:": "🎪", ":performing_arts:": "🎭", ":round_pushpin:": "📍", ":triangular_flag_on_post:": "🚩", ":cn:": "🇨🇳", ":us:": "🇺🇸", ":jp:": "🇯🇵", ":ru:": "🇷🇺", ":de:": "🇩🇪", ":gb:": "🇬🇧", ":fr:": "🇫🇷", ":kr:": "🇰🇷", ":it:": "🇮🇹", ":es:": "🇪🇸", ":no_smoking:": "🚭", ":over18:": "🔞", ":copyright:": "©", ":parking:": "🅿", ":wc:": "🚾", ":hash:": "#⃣", ":one:": "1⃣", ":two:": "2⃣", ":three:": "3⃣", ":four:": "4⃣", ":five:": "5⃣", ":six:": "6⃣", ":seven:": "7⃣", ":eight:": "8⃣", ":nine:": "9⃣", ":zero:": "0⃣", ":keycap_ten:": "🔟", ":1234:": "🔢", ":symbols:": "🔣", ":arrow_up:": "⬆", ":arrow_down:": "⬇", ":arrow_left:": "⬅", ":arrow_right:": "➡", ":capital_abcd:": "🔠", ":abcd:": "🔡", ":abc:": "🔤", ":arrow_upper_right:": "↗", ":arrow_upper_left:": "↖", ":arrow_lower_right:": "↘", ":arrow_lower_left:": "↙", ":left_right_arrow:": "↔", ":arrow_up_down:": "↕", ":arrows_counterclockwise:": "🔄", ":arrow_backward:": "◀", ":arrow_forward:": "▶", ":arrow_up_small:": "🔼", ":arrow_down_small:": "🔽", ":leftwards_arrow_with_hook:": "↩", ":arrow_right_hook:": "↪", ":information_source:": "ℹ", ":rewind:": "⏪", ":fast_forward:": "⏩", ":arrow_double_up:": "⏫", ":arrow_double_down:": "⏬", ":arrow_heading_down:": "⤵", ":arrow_heading_up:": "⤴", ":ok:": "🆗", ":twisted_rightwards_arrows:": "🔀", ":repeat:": "🔁", ":repeat_one:": "🔂", ":new:": "🆕", ":up:": "🆙", ":cool:": "🆒", ":free:": "🆓", ":ng:": "🆖", ":signal_strength:": "📶", ":cinema:": "🎦", ":koko:": "🈁", ":u6307:": "🈯", ":u7a7a:": "🈳", ":u6e80:": "🈵", ":u5408:": "🈴", ":u7981:": "🈲", ":ideograph_advantage:": "🉐", ":u5272:": "🈹", ":u55b6:": "🈺", ":u6709:": "🈶", ":u7121:": "🈚", ":restroom:": "🚻", ":mens:": "🚹", ":womens:": "🚺", ":baby_symbol:": "🚼", ":potable_water:": "🚰", ":put_litter_in_its_place:": "🚮", ":wheelchair:": "♿", ":u6708:": "🈷", ":u7533:": "🈸", ":sa:": "🈂", ":m:": "Ⓜ", ":passport_control:": "🛂", ":baggage_claim:": "🛄", ":left_luggage:": "🛅", ":customs:": "🛃", ":accept:": "🉑", ":secret:": "㊙", ":congratulations:": "㊗", ":cl:": "🆑", ":sos:": "🆘", ":id:": "🆔", ":no_entry_sign:": "🚫", ":no_mobile_phones:": "📵", ":do_not_litter:": "🚯", ":non-potable_water:": "🚱", ":no_bicycles:": "🚳", ":no_pedestrians:": "🚷", ":children_crossing:": "🚸", ":no_entry:": "⛔", ":eight_spoked_asterisk:": "✳", ":sparkle:": "❇", ":negative_squared_cross_mark:": "❎", ":white_check_mark:": "✅", ":eight_pointed_black_star:": "✴", ":heart_decoration:": "💟", ":vs:": "🆚", ":vibration_mode:": "📳", ":mobile_phone_off:": "📴", ":a:": "🅰", ":b:": "🅱", ":ab:": "🆎", ":o2:": "🅾", ":diamond_shape_with_a_dot_inside:": "💠", ":loop:": "➿", ":recycle:": "♻", ":aries:": "♈", ":taurus:": "♉", ":gemini:": "♊", ":cancer:": "♋", ":leo:": "♌", ":virgo:": "♍", ":libra:": "♎", ":scorpius:": "♏", ":sagittarius:": "♐", ":capricorn:": "♑", ":aquarius:": "♒", ":pisces:": "♓", ":ophiuchus:": "⛎", ":six_pointed_star:": "🔯", ":atm:": "🏧", ":chart:": "💹", ":heavy_dollar_sign:": "💲", ":currency_exchange:": "💱", ":registered:": "®", ":tm:": "™", ":part_alternation_mark:": "〽", ":wavy_dash:": "〰", ":top:": "🔝", ":end:": "🔚", ":back:": "🔙", ":on:": "🔛", ":soon:": "🔜", ":x:": "❌", ":o:": "⭕", ":exclamation:": "❗", ":question:": "❓", ":grey_exclamation:": "❕", ":grey_question:": "❔", ":bangbang:": "‼", ":interrobang:": "⁉", ":arrows_clockwise:": "🔃", ":clock12:": "🕛", ":clock1230:": "🕧", ":clock1:": "🕐", ":clock130:": "🕜", ":clock2:": "🕑", ":clock230:": "🕝", ":clock3:": "🕒", ":clock330:": "🕞", ":clock4:": "🕓", ":clock430:": "🕟", ":clock5:": "🕔", ":clock530:": "🕠", ":clock6:": "🕕", ":clock7:": "🕖", ":clock8:": "🕗", ":clock9:": "🕘", ":clock10:": "🕙", ":clock11:": "🕚", ":clock630:": "🕡", ":clock730:": "🕢", ":clock830:": "🕣", ":clock930:": "🕤", ":clock1030:": "🕥", ":clock1130:": "🕦", ":heavy_multiplication_x:": "✖", ":heavy_plus_sign:": "➕", ":heavy_minus_sign:": "➖", ":heavy_division_sign:": "➗", ":spades:": "♠", ":hearts:": "♥", ":clubs:": "♣", ":diamonds:": "♦", ":white_flower:": "💮", ":100:": "💯", ":heavy_check_mark:": "✔", ":ballot_box_with_check:": "☑", ":radio_button:": "🔘", ":link:": "🔗", ":curly_loop:": "➰", ":trident:": "🔱", ":black_square_button:": "🔲", ":white_square_button:": "🔳", ":black_medium_square:": "◼", ":white_medium_square:": "◻", ":black_medium_small_square:": "◾", ":white_medium_small_square:": "◽", ":black_small_square:": "▪", ":white_small_square:": "▫", ":small_red_triangle:": "🔺", ":white_large_square:": "⬜", ":black_large_square:": "⬛", ":black_circle:": "⚫", ":white_circle:": "⚪", ":red_circle:": "🔴", ":large_blue_circle:": "🔵", ":small_red_triangle_down:": "🔻", ":large_orange_diamond:": "🔶", ":large_blue_diamond:": "🔷", ":small_orange_diamond:": "🔸", ":small_blue_diamond:": "🔹", ":spermatozoon:": "💦", ":cum:": "💦", ":wdrops:": "💦", ":ydrops:": "💦", ":bdrops:": "💦", ":wdrop:": "💧", ":ydrop:": "💧", ":fucku:": "🖕", ":dr_love:": "🧑‍⚕️", ":pussy:": "🍯", ":cock:": "🍆", ":banana:": "🍌"}, "unicodeToJoy": {"🙏": "*danke*", "😀": ":)", "👍": "*top*", "😃": ":D", "😊": "*smile*", "😄": "*gg*", "😉": ";)", "😆": "*xd*", "❗": ":!:", "🚨": "*alarm*", "🤗": "*knuddel*", "👋": "*wink*", "😁": "*grins*", "😈": ":twisted:", "🤣": "*rotfl*", "🥳": "*juhu*", "😂": "*traenenlach*", "😛": "*aetsch*", "😜": ":P", "😏": "*selbstgefall*", "🤪": "*goofy*", "😮": ":o", "😯": "*oh2*", "😱": ":shock:", "😨": "*panik*", "😵": "*umfall*", "😠": ":x", "👿": ":evil:", "😡": "*gr3*", "🤬": "*gleichplatz*", "😖": "*uah*", "😤": "*motz*", "🤕": "*blauesauge*", "😬": "*grimasse*", "😞": ":(", "😢": ":cry:", "😭": "*heul*", "😔": "*traurig*", "💔": "*liebeskummer*", "😑": ":|", "🥱": "*gaehn*", "💤": "*zzz*", "😴": "*heia*", "📞": "*tel*", "💬": "*blabla*", "🎶": "*lalala*", "🤐": "*schweig*", "🤫": "*fluester*", "👎": "*flop*", "👏": "*bravo*", "👌": "*spitze*", "🍅": "*tomaten*", "😲": "*wow*", "🤤": "*sabber*", "🤢": "*umpf*", "✌": "*victory*", "🙌": "*hi5*", "🎩": "*hutab*", "💯": "*100*", "🤮": "*wuerg*", "💊": "*aspirin*", "💫": "*sternchen*", "😩": "*3tagewach*", "🤧": "*schnupfen*", "😷": "*mundschutz*", "🍴": "*essen*", "🍖": "*grill*", "🍺": "*bier*", "🍦": "*eis*", "🍭": "*lolli*", "🎂": "*torte*", "🧁": "*muffin*", "☕": "*kaffee*", "🍵": "*tee*", "🍷": "*wein*", "🍸": "*cocktail*", "🦟": "*fliege2*", "🥃": "*whiskey*", "🍻": "*prost*", "🥂": "*cheers*", "🍾": "*sekt*", "🚬": "*zig*", "🎉": "*troet*", "💃": "*dance*", "🥴": "*hicks*", "🤘": "*headbang*", "🎆": "*feuerwerk*", "😚": "*knutsch*", "🥰": "*liebhab*", "👫": "*friends*", "😙": "*bussi*", "💋": "*kuss2*", "❤": "*herz*", "💕": "*herz2*", "💗": "*herz3*", "💖": "*herz4*", "😍": "*love5*", "🌹": "*blume*", "🌼": "*blumezupf*", "💐": "*blumenschenk*", "🌷": "*blume2*", "🎁": "*geschenk*", "🎤": "*osolemio*", "💒": "*hochzeit*", "🙇": "*anbet*", "😗": "*floet*", "🤨": "*skeptisch*", "😒": "*pueh*", "😌": "*stolzbin*", "😎": "8)", "😕": ":?", "🤷": "*nixweiss*", "😐": ":/", "🙄": ":roll:", "🤔": "*gruebel*", "🤦": "*kopfklatsch*", "😳": ":oops:", "😰": "*angsthab*", "🙈": "*augenzu*", "🍀": "*vielglueck*", "💻": "*tipp*", "📰": "*les*", "✉": "*mail*", "🚿": "*duschen*", "🚽": "*wc*", "😇": "*engel*", "👼": "*engel2*", "🚗": "*fahr*", "📷": "*knips*", "🎥": "*film*", "🙋": "*meld*", "🍿": "*popcorn*", "😅": "*puh*", "🤡": "*clown*", "🎸": "*rock*", "🧶": "*strick*", "🧹": "*putz*", "🏊": "*tauch*", "⚽": "*fussball*", "👀": "*spanner*", "🎮": "*zocker*", "📢": "*megaphon*", "💪": "*pumpi*", "🔭": "*fernglas*", "👅": "*schleck*", "🍑": "*arsch*", "👵": "*oma*", "👴": "*opa*", "👶": "*baby*", "👷": "*bauarbeiter*", "👮": "*polizei*", "🎨": "*maler*", "👑": "*koenig*", "👸": "*koenigin*", "🎧": "*dj*", "🥁": "*drummer*", "🎹": "*piano*", "🎅": "*nikolaus*", "🔮": "*wahrsager*", "🐱": "*katze*", "🐮": "*kuh*", "🐔": "*huhn*", "🐷": "*schwein*", "🐶": "*hund*", "🦋": "*schmetterling*", "🐛": "*bug*", "🦄": "*einhorn*", "🦊": "*fuchs*", "🐌": "*schnecke*", "🐺": "*wolf*", "🐹": "*hamster*", "☀": "*sonne*", "☔": "*regen*", "🥶": "*frier*", "😓": "*schwitz*", "🌈": "*regenbogen*", "➡": ":arrow:", "❓": ":?:", "💡": ":idea:", "🆘": "*hilfe*", "🇩🇪": "*deutschland*", "🇦🇹": "*oesterreich*", "🇨🇭": "*schweiz*", "🇳🇱": "*niederlande*", "🧑‍⚕": "*schwester*", "😘": "*kuss3*"}, "joyTokens": ["*kommmalherfreundchen*", "*ihrseiddiegroessten*", "*kissenschlacht*", "*gehirnschnecke*", "*featuremonster*", "*happybirthday*", "*kopfschuettel*", "*baerenaufbind*", "*experimentier*", "*partnertausch*", "*computercrash*", "*schmetterling*", "*niedersachsen*", "*klugscheisser*", "*gutebesserung*", "*werderwachsen*", "*winterdienst*", "*selbstgefall*", "*diegroessten*", "*guckstduhier*", "*liebeskummer*", "*kindergarten*", "*kammerjaeger*", "*guterbeitrag*", "*cheerleading*", "*blumenschenk*", "*haumichwech*", "*deutschland*", "*traenenlach*", "*letzteswort*", "*zaubertrank*", "*willkommen2*", "*feinschleif*", "*gleichplatz*", "*geschlossen*", "*spassbremse*", "*verdaechtig*", "*niederlande*", "*huebschmach*", "*oesterreich*", "*blumenwiese*", "*brandenburg*", "*keinproblem*", "*bitteschoen*", "*kopfklatsch*", "*bauarbeiter*", "*ungeduldig*", "*gehbuegeln*", "*hotupshirt*", "*arschkneif*", "*geheimtipp*", "*gelbekarte*", "*vielglueck*", "*stoesschen*", "*musketiere*", "*schneeball*", "*willkommen*", "*mundschutz*", "*regenbogen*", "*freundchen*", "*ventilator*", "*schiefguck*", "*knackarsch*", "*thueringen*", "*verfuehren*", "*liegestuhl*", "*hotsqueeze*", "*blauesauge*", "*waschbrett*", "*ninjaclown*", "*ballaballa*", "*hackfresse*", "*roseschenk*", "*stammtisch*", "*steinwerf*", "*skeptisch*", "*feuerwehr*", "*poledance*", "*surprised*", "*schleswig*", "*schleimer*", "*3tagewach*", "*feuerwerk*", "*gutenacht*", "*headcrash*", "*slipstrip*", "*schwester*", "*rotekarte*", "*sarkasmus*", "*wahrsager*", "*zufaechel*", "*abgedreht*", "*taetschel*", "*sternchen*", "*fiesgrins*", "*schnupfen*", "*hotbanana*", "*sweetkiss*", "*zaunpfahl*", ":surprised:", "*blumezupf*", "*rheinland*", "*nikolaus*", "*meinheld*", "*iloveyou*", "*osolemio*", "*schleck4*", "*fancycat*", "*nixweiss*", "*schleck3*", "*hotboobs*", "*geschenk*", "*hochzeit*", "*offtopic*", "*saarland*", "*question*", "*schleck2*", "*stolzbin*", "*zeigpics*", "*my2cents*", "*peitsche*", "*zwinker2*", "*zumthema*", "*superman*", "*knutsch2*", "*hotkiss2*", "*knutsch4*", "*headbang*", "*nachdenk*", "*koenigin*", "*schnecke*", "*cocktail*", "*hotlady3*", "*grimasse*", "*confused*", "*angsthab*", "*fussball*", "*guerilla*", "*brueste2*", "*fernglas*", "*fluester*", "*duschen2*", "*hotlady2*", "*handkuss*", "*liebguck*", "*megaphon*", "*kopfkino*", "*raeusper*", "*knuddel2*", "*popcorn2*", "*thankyou*", "*guckguck*", "*schlumpf*", "*knutsch3*", ":confused:", "*fliege2*", "*neutral*", "*welcome*", "*redface*", "*blowjob*", ":twisted:", "*schimpf*", "*bananen*", "*knuddel*", "*fisting*", "*duschen*", "*hamburg*", "*traurig*", "*exclaim*", "*hothips*", "*hamster*", "*sixpack*", "*dagegen*", "*achtung*", "*tomaten*", "*aspirin*", ":neutral:", "*faechel*", "*whiskey*", "*frieden*", "*rotwerd*", "*schweig*", "*drummer*", "*twisted*", "*augenzu*", "*zwinker*", "*wiegeil*", ":redface:", "*gitarre*", "*schweiz*", "*hatschi*", "*brueste*", "*schleck*", "*knutsch*", "*schmoll*", "*hotkiss*", "*hochleb*", "*popcorn*", "*joyclub*", "*victory*", "*schwitz*", "*polizei*", "*hotlady*", "*gruebel*", ":mrgreen:", "*einhorn*", "*friends*", "*mrgreen*", "*sachsen*", "*undwech*", "*spanner*", "*kuschel*", "*liebhab*", "*schwein*", "*party2*", "*knicks*", "*hexhex*", "*bandit*", "*titten*", "*berlin*", "*troest*", "*crazy2*", "*pumpi2*", "*koenig*", "*lalala*", "*strick*", "*schock*", "*snief3*", "*boogie*", "*bayern*", "*janein*", "*stupid*", "*imogdi*", "*matrix*", "*voting*", "*blabla*", "*teufel*", "*cheers*", "*kaffee*", "*paddle*", "*kondom*", "*sabber*", "*wuerg2*", "*dafuer*", "*bremen*", "*gaehn2*", "*pimper*", "*autsch*", "*crazy4*", "*streit*", "*umfall*", "*snief2*", "*ironie*", "*holmes*", "*sextoy*", "*crazy5*", "*arbeit*", "*engel2*", "*hotass*", "*hotbum*", "*morgen*", "*fessel*", "*zugabe*", "*blume2*", "*dance2*", "*neinja*", "*muffin*", "*wolke7*", "*zocker*", "*sexypo*", "*hotman*", "*anmach*", "*crazy3*", "*3affen*", "*barbar*", "*fliege*", "*bussi2*", "*spitze*", "*schaem*", "*aetsch*", "*anhalt*", "*hessen*", "*katze*", "*prost*", "*jedi2*", "*smile*", "*twist*", "*bravo*", "*bussi*", "*sauna*", "*hand4*", "*frage*", "*hutab*", "*love5*", "*troet*", "*basta*", "*tuete*", "*arrow*", "*doggy*", "*pirat*", "*panik*", "*flenn*", "*blume*", "*tauch*", "*regen*", "*goofy*", "*clown*", "*kuss2*", "*sorry*", "*maler*", "*fluch*", "*hypno*", "*modda*", "*pfeil*", "*naund*", "*cool2*", "*love4*", "*love3*", "*alarm*", "*tanz2*", "*neid2*", "*happy*", "*genau*", "*lolli*", "*floet*", "*vogel*", "*hand2*", "*gaehn*", "*heia2*", "*party*", "*heul2*", "*hand3*", "*snief*", "*wuerg*", "*biker*", "*herz3*", "*spank*", ":arrow:", "*hand5*", "*hilfe*", "*herz2*", "*grins*", "*strip*", "*love2*", "*hicks*", "*piano*", "*angel*", "*bunny*", "*baby2*", "*anbet*", ":shock:", "*pumpi*", "*tonne*", "*elvis*", "*ninja*", "*kuss3*", "*juchu*", "*sonne*", "*pieks*", "*grill*", "*crazy*", "*fuchs*", "*dance*", "*troll*", "*arsch*", "*freu2*", "*shock*", "*torte*", "*essen*", "*danke*", "*muede*", "*frier*", "*knips*", "*rotfl*", "*engel*", "*herz4*", "*hexe*", "*walk*", "*senf*", "*umpf*", "*nono*", "*heia*", "*rofl*", "*nick*", ":roll:", "*fahr*", "*huch*", "*hot3*", "*witz*", "*fans*", "*nase*", "*kuss*", "*beep*", "*next*", "*heul*", ":evil:", "*tipp*", "*guru*", "*evil*", "*help*", "*baeh*", "*sekt*", "*jedi*", "*film*", "*date*", "*wolf*", "*neck*", "*idee*", "*hot2*", "*flop*", "*hand*", "*bla2*", "*love*", "*wein*", "*top2*", "*pfui*", "*mail*", "*huhn*", "*pueh*", "*bier*", "*spam*", "*nein*", "*snob*", "*wuah*", ":idea:", "*neid*", "*freu*", "*lach*", "*huhu*", "*juhu*", ":razz:", "*nene*", ":oops:", "*idea*", "*tanz*", "*motz*", "*herz*", "*oede*", "*meld*", "*keks*", "*popp*", ":wink:", "*haha*", "*oops*", "*razz*", "*dito*", "*wink*", "*hund*", "*roll*", "*sing*", "*cool*", "*yoda*", "*koch*", "*rock*", "*foto*", "*leck*", "*baby*", "*putz*", "*oh3*", "*oh4*", "*hae*", "*bla*", "*gr2*", "*hi5*", "*zig*", "*mmf*", "*eis*", "*sad*", "*wua*", "*arg*", "*ggg*", "*100*", "*lol*", "*puh*", "*tee*", ":sad:", "*cry*", "*oh2*", "*oma*", "*nrw*", "*aua*", "*omm*", "*les*", "*bug*", "*kuh*", "*uah*", "*zzz*", ":lol:", "*top*", "*gr3*", "*opa*", "*bye*", "*tel*", "*wow*", "*oha*", "*ffm*", ":cry:", "*hot*", "*ko*", "*yo*", "*gr*", "*ja*", "*mv*", "*oh*", "*wc*", "*bw*", "*dd*", "*dj*", "*xd*", "*hm*", "*gg*", ":!:", ":-|", ":-D", ":-/", ":?:", ":-(", "*g*", ";-)", "8-)", ":-o", ":-)", ":-P", ":o", ":P", ":/", "8)", ":|", ";)", ":)", ":?", ":x", ":(", ":D"], "poppenTokens": [":diamond_shape_with_a_dot_inside:", ":notebook_with_decorative_cover:", ":stuck_out_tongue_closed_eyes:", ":first_quarter_moon_with_face:", ":last_quarter_moon_with_face:", ":negative_squared_cross_mark:", ":chart_with_downwards_trend:", ":leftwards_arrow_with_hook:", ":twisted_rightwards_arrows:", ":black_medium_small_square:", ":white_medium_small_square:", ":person_with_pouting_face:", ":chart_with_upwards_trend:", ":eight_pointed_black_star:", ":two_women_holding_hands:", ":information_desk_person:", ":running_shirt_with_sash:", ":triangular_flag_on_post:", ":arrows_counterclockwise:", ":put_litter_in_its_place:", ":small_red_triangle_down:", ":person_with_blond_hair:", ":hourglass_flowing_sand:", ":sunrise_over_mountains:", ":vertical_traffic_light:", ":heavy_multiplication_x:", ":disappointed_relieved:", ":two_men_holding_hands:", ":fishing_pole_and_fish:", ":eight_spoked_asterisk:", ":part_alternation_mark:", ":ballot_box_with_check:", ":kissing_smiling_eyes:", ":globe_with_meridians:", ":waxing_crescent_moon:", ":waning_crescent_moon:", ":closed_lock_with_key:", ":mailbox_with_no_mail:", ":flower_playing_cards:", ":european_post_office:", ":large_orange_diamond:", ":small_orange_diamond:", ":kissing_closed_eyes:", ":man_with_gua_pi_mao:", ":construction_worker:", ":busts_in_silhouette:", ":full_moon_with_face:", ":waxing_gibbous_moon:", ":waning_gibbous_moon:", ":envelope_with_arrow:", ":oncoming_automobile:", ":oncoming_police_car:", ":ideograph_advantage:", ":heavy_division_sign:", ":black_square_button:", ":white_square_button:", ":black_medium_square:", ":white_medium_square:", ":bust_in_silhouette:", ":new_moon_with_face:", ":first_quarter_moon:", ":telephone_receiver:", ":mountain_bicyclist:", ":suspension_railway:", ":information_source:", ":arrow_heading_down:", ":black_small_square:", ":white_small_square:", ":small_red_triangle:", ":white_large_square:", ":black_large_square:", ":large_blue_diamond:", ":small_blue_diamond:", ":couple_with_heart:", ":last_quarter_moon:", ":lock_with_ink_pen:", ":incoming_envelope:", ":mailbox_with_mail:", ":house_with_garden:", ":convenience_store:", ":statue_of_liberty:", ":bullettrain_front:", ":articulated_lorry:", ":mountain_cableway:", ":arrow_upper_right:", ":arrow_lower_right:", ":arrow_double_down:", ":non-potable_water:", ":children_crossing:", ":heavy_dollar_sign:", ":currency_exchange:", ":large_blue_circle:", ":stuck_out_tongue:", ":revolving_hearts:", ":four_leaf_clover:", ":money_with_wings:", ":open_file_folder:", ":triangular_ruler:", ":musical_keyboard:", ":department_store:", ":night_with_stars:", ":steam_locomotive:", ":mountain_railway:", ":bullettrain_side:", ":arrow_upper_left:", ":arrow_lower_left:", ":left_right_arrow:", ":arrow_down_small:", ":arrow_right_hook:", ":arrow_heading_up:", ":passport_control:", ":no_mobile_phones:", ":white_check_mark:", ":heart_decoration:", ":mobile_phone_off:", ":six_pointed_star:", ":grey_exclamation:", ":arrows_clockwise:", ":heavy_minus_sign:", ":heavy_check_mark:", ":man_with_turban:", ":crying_cat_face:", ":japanese_goblin:", ":bride_with_veil:", ":person_frowning:", ":closed_umbrella:", ":sparkling_heart:", ":thought_balloon:", ":dromedary_camel:", ":high_brightness:", ":japanese_castle:", ":european_castle:", ":bridge_at_night:", ":izakaya_lantern:", ":performing_arts:", ":arrow_double_up:", ":signal_strength:", ":congratulations:", ":heavy_plus_sign:", ":coffee_morning:", ":heart_eyes_cat:", ":womans_clothes:", ":speech_balloon:", ":hatching_chick:", ":cherry_blossom:", ":evergreen_tree:", ":deciduous_tree:", ":earth_americas:", ":school_satchel:", ":jack_o_lantern:", ":christmas_tree:", ":low_brightness:", ":mailbox_closed:", ":page_facing_up:", ":page_with_curl:", ":straight_ruler:", ":rugby_football:", ":checkered_flag:", ":tropical_drink:", ":fork_and_knife:", ":carousel_horse:", ":roller_coaster:", ":rotating_light:", ":aerial_tramway:", ":arrow_backward:", ":arrow_up_small:", ":no_pedestrians:", ":vibration_mode:", ":hearts_around:", ":kissing_heart:", ":japanese_ogre:", ":speak_no_evil:", ":athletic_shoe:", ":hatched_chick:", ":tropical_fish:", ":water_buffalo:", ":sun_with_face:", ":crescent_moon:", ":tanabata_tree:", ":confetti_ball:", ":crossed_flags:", ":electric_plug:", ":bookmark_tabs:", ":musical_score:", ":space_invader:", ":chocolate_bar:", ":oncoming_taxi:", ":traffic_light:", ":round_pushpin:", ":arrow_up_down:", ":arrow_forward:", ":potable_water:", ":baggage_claim:", ":no_entry_sign:", ":do_not_litter:", ":grey_question:", ":coffee_happy:", ":hear_no_evil:", ":raised_hands:", ":raising_hand:", ":yellow_heart:", ":purple_heart:", ":broken_heart:", ":spermatozoon:", ":threefingers:", ":earth_africa:", ":partly_sunny:", ":mortar_board:", ":crystal_ball:", ":movie_camera:", ":video_camera:", ":nut_and_bolt:", ":musical_note:", ":horse_racing:", ":meat_on_bone:", ":fried_shrimp:", ":rice_cracker:", ":sweet_potato:", ":ferris_wheel:", ":oncoming_bus:", ":construction:", ":slot_machine:", ":capital_abcd:", ":fast_forward:", ":left_luggage:", ":white_flower:", ":radio_button:", ":black_circle:", ":white_circle:", ":sweat_smile:", ":smiling_imp:", ":older_woman:", ":kissing_cat:", ":pouting_cat:", ":see_no_evil:", ":sweat_drops:", ":raised_hand:", ":point_right:", ":green_heart:", ":love_letter:", ":monkey_face:", ":dragon_face:", ":fallen_leaf:", ":ear_of_rice:", ":floppy_disk:", ":loudspeaker:", ":alarm_clock:", ":credit_card:", ":outbox_tray:", ":postal_horn:", ":file_folder:", ":closed_book:", ":orange_book:", ":black_joker:", ":snowboarder:", ":baby_bottle:", ":poultry_leg:", ":green_apple:", ":post_office:", ":city_sunset:", ":tokyo_tower:", ":railway_car:", ":fire_engine:", ":circus_tent:", ":arrow_right:", ":baby_symbol:", ":no_bicycles:", ":sagittarius:", ":exclamation:", ":interrobang:", ":heart_eyes:", ":cold_sweat:", ":tired_face:", ":confounded:", ":dizzy_face:", ":astonished:", ":smiley_cat:", ":scream_cat:", ":thumbsdown:", ":open_hands:", ":point_up_2:", ":point_down:", ":point_left:", ":couplekiss:", ":womans_hat:", ":eyeglasses:", ":blue_heart:", ":heartpulse:", ":two_hearts:", ":footprints:", ":rubberdoll:", ":safebanana:", ":bananarama:", ":twofingers:", ":panda_face:", ":baby_chick:", ":maple_leaf:", ":earth_asia:", ":gift_heart:", ":wind_chime:", ":rice_scene:", ":loud_sound:", ":flashlight:", ":inbox_tray:", ":card_index:", ":green_book:", ":name_badge:", ":microscope:", ":microphone:", ":headphones:", ":video_game:", ":basketball:", ":wine_glass:", ":shaved_ice:", ":watermelon:", ":strawberry:", ":love_hotel:", ":mount_fuji:", ":helicopter:", ":light_rail:", ":trolleybus:", ":police_car:", ":hotsprings:", ":no_smoking:", ":keycap_ten:", ":arrow_down:", ":arrow_left:", ":repeat_one:", ":wheelchair:", ":registered:", ":curly_loop:", ":red_circle:", ":persevere:", ":grimacing:", ":guardsman:", ":older_man:", ":smile_cat:", ":smirk_cat:", ":nail_care:", ":mans_shoe:", ":high_heel:", ":briefcase:", ":heartbeat:", ":handcuffs:", ":highheels:", ":threesome:", ":racehorse:", ":crocodile:", ":sunflower:", ":palm_tree:", ":full_moon:", ":milky_way:", ":snowflake:", ":fireworks:", ":telephone:", ":satellite:", ":hourglass:", ":mag_right:", ":bar_chart:", ":clipboard:", ":paperclip:", ":black_nib:", ":blue_book:", ":telescope:", ":newspaper:", ":saxophone:", ":bicyclist:", ":hamburger:", ":spaghetti:", ":fish_cake:", ":rice_ball:", ":ice_cream:", ":honey_pot:", ":tangerine:", ":pineapple:", ":city_dusk:", ":speedboat:", ":ambulance:", ":copyright:", ":capricorn:", ":ophiuchus:", ":wavy_dash:", ":clock1230:", ":clock1030:", ":clock1130:", ":clapping:", ":confused:", ":relieved:", ":sleeping:", ":no_mouth:", ":princess:", ":sparkles:", ":thumbsup:", ":point_up:", ":ok_woman:", ":lipstick:", ":poppen-1:", ":dickface:", ":vibrator:", ":whipping:", ":stocking:", ":pig_nose:", ":elephant:", ":blowfish:", ":hibiscus:", ":mushroom:", ":chestnut:", ":seedling:", ":new_moon:", ":umbrella:", ":sparkler:", ":minidisc:", ":computer:", ":moneybag:", ":envelope:", ":calendar:", ":scissors:", ":notebook:", ":bookmark:", ":game_die:", ":football:", ":baseball:", ":cocktail:", ":doughnut:", ":icecream:", ":birthday:", ":lollipop:", ":cherries:", ":eggplant:", ":hospital:", ":fountain:", ":sailboat:", ":airplane:", ":monorail:", ":blue_car:", ":beginner:", ":fuelpump:", ":arrow_up:", ":restroom:", ":no_entry:", ":scorpius:", ":aquarius:", ":question:", ":bangbang:", ":clock130:", ":clock230:", ":clock330:", ":clock430:", ":clock530:", ":clock630:", ":clock730:", ":clock830:", ":clock930:", ":diamonds:", ":jumping:", ":dr_love:", ":relaxed:", ":kissing:", ":flushed:", ":pensive:", ":fearful:", ":triumph:", ":worried:", ":joy_cat:", ":droplet:", ":ok_hand:", ":walking:", ":dancers:", ":no_good:", ":massage:", ":haircut:", ":necktie:", ":handbag:", ":strapon:", ":safesex:", ":hamster:", ":penguin:", ":chicken:", ":octopus:", ":dolphin:", ":rabbit2:", ":rooster:", ":leopard:", ":bouquet:", ":blossom:", ":volcano:", ":snowman:", ":cyclone:", ":rainbow:", ":balloon:", ":speaker:", ":no_bell:", ":battery:", ":bathtub:", ":smoking:", ":syringe:", ":calling:", ":mailbox:", ":postbox:", ":package:", ":pushpin:", ":pencil2:", ":clapper:", ":trumpet:", ":mahjong:", ":bowling:", ":swimmer:", ":custard:", ":wedding:", ":factory:", ":sunrise:", ":rowboat:", ":station:", ":red_car:", ":minibus:", ":tractor:", ":busstop:", ":warning:", ":parking:", ":symbols:", ":customs:", ":sparkle:", ":recycle:", ":clock12:", ":clock10:", ":clock11:", ":trident:", ":praise:", ":smiley:", ":sleepy:", ":scream:", ":hushed:", ":tongue:", ":muscle:", ":runner:", ":dancer:", ":couple:", ":family:", ":tophat:", ":sandal:", ":kimono:", ":bikini:", ":ribbon:", ":poppen:", ":suckmy:", ":collar:", ":banana:", ":hottub:", ":wdrops:", ":ydrops:", ":bdrops:", ":rabbit:", ":monkey:", ":turtle:", ":beetle:", ":whale2:", ":tiger2:", ":dragon:", ":mouse2:", ":poodle:", ":leaves:", ":cactus:", ":bamboo:", ":camera:", ":iphone:", ":unlock:", ":shower:", ":toilet:", ":wrench:", ":hammer:", ":dollar:", ":e-mail:", ":pencil:", ":scroll:", ":ledger:", ":violin:", ":guitar:", ":soccer:", ":tennis:", ":trophy:", ":surfer:", ":coffee:", ":cookie:", ":grapes:", ":tomato:", ":school:", ":office:", ":church:", ":anchor:", ":rocket:", ":train2:", ":barber:", ":ticket:", ":over18:", ":rewind:", ":repeat:", ":cinema:", ":womens:", ":accept:", ":secret:", ":taurus:", ":gemini:", ":cancer:", ":pisces:", ":clock1:", ":clock2:", ":clock3:", ":clock4:", ":clock5:", ":clock6:", ":clock7:", ":clock8:", ":clock9:", ":spades:", ":hearts:", ":sweat:", ":weary:", ":smirk:", ":woman:", ":angel:", ":skull:", ":alien:", ":star2:", ":dizzy:", ":anger:", ":punch:", ":crown:", ":shirt:", ":dress:", ":jeans:", ":pouch:", ":purse:", ":heart:", ":cupid:", ":crazy:", ":pussy:", ":fucku:", ":urock:", ":wdrop:", ":ydrop:", ":mouse:", ":tiger:", ":koala:", ":horse:", ":sheep:", ":snake:", ":snail:", ":shell:", ":whale:", ":camel:", ":tulip:", ":stars:", ":sunny:", ":cloud:", ":foggy:", ":ocean:", ":dolls:", ":flags:", ":ghost:", ":santa:", ":pager:", ":radio:", ":sound:", ":watch:", ":knife:", ":pound:", ":books:", ":notes:", ":8ball:", ":beers:", ":pizza:", ":fries:", ":curry:", ":bento:", ":sushi:", ":ramen:", ":dango:", ":bread:", ":candy:", ":apple:", ":lemon:", ":peach:", ":melon:", ":house:", ":hotel:", ":japan:", ":metro:", ":train:", ":truck:", ":moyai:", ":three:", ":seven:", ":eight:", ":u6307:", ":u7a7a:", ":u6e80:", ":u5408:", ":u7981:", ":u5272:", ":u55b6:", ":u6709:", ":u7121:", ":u6708:", ":u7533:", ":aries:", ":virgo:", ":libra:", ":chart:", ":clubs:", ":grin:", ":rage:", ":mask:", ":baby:", ":girl:", ":poop:", ":fire:", ":boom:", ":dash:", ":eyes:", ":nose:", ":lips:", ":fist:", ":wave:", ":pray:", ":clap:", ":boot:", ":kiss:", ":ring:", ":lick:", ":bite:", ":gimp:", ":cock:", ":tits:", ":lgbt:", ":wolf:", ":frog:", ":bear:", ":boar:", ":bird:", ":fish:", ":cow2:", ":goat:", ":dog2:", ":pig2:", ":cat2:", ":feet:", ":rose:", ":herb:", ":star:", ":gift:", ":tada:", ":mute:", ":bell:", ":mega:", ":lock:", ":bulb:", ":bath:", ":door:", ":bomb:", ":pill:", ":euro:", ":date:", ":book:", ":dart:", ":golf:", ":sake:", ":beer:", ":rice:", ":stew:", ":oden:", ":cake:", ":pear:", ":corn:", ":bank:", ":tent:", ":ship:", ":seat:", ":tram:", ":taxi:", ":bike:", ":hash:", ":four:", ":five:", ":nine:", ":zero:", ":1234:", ":abcd:", ":cool:", ":free:", ":koko:", ":mens:", ":loop:", ":back:", ":soon:", ":link:", ":cry:", ":joy:", ":sob:", ":yum:", ":imp:", ":cop:", ":boy:", ":man:", ":zzz:", ":ear:", ":bow:", ":gem:", ":wax:", ":cum:", ":bed:", ":ass:", ":car:", ":dog:", ":cat:", ":pig:", ":cow:", ":bug:", ":bee:", ":ant:", ":ram:", ":rat:", ":zap:", ":vhs:", ":dvd:", ":fax:", ":key:", ":mag:", ":gun:", ":yen:", ":art:", ":ski:", ":tea:", ":egg:", ":bus:", ":one:", ":two:", ":six:", ":abc:", ":new:", ":sos:", ":leo:", ":atm:", ":top:", ":end:", ":100:", ":ox:", ":cd:", ":tv:", ":cn:", ":us:", ":jp:", ":ru:", ":de:", ":gb:", ":fr:", ":kr:", ":it:", ":es:", ":wc:", ":ok:", ":up:", ":ng:", ":sa:", ":cl:", ":id:", ":vs:", ":ab:", ":o2:", ":tm:", ":on:", "9_9", ">:(", "o.O", "-_-", ":-/", "O.o", "(A)", ":v:", ":m:", ":a:", ":b:", ":x:", ":o:", ":D", ":)", ";)", ":x", ":P", "¬¬", ":(", "xD", "B|", ":o", ":|"]};
  const SM = SMILEY_MAP;
  // Graphem-/Token-weises Zerlegen: an jeder Stelle den längsten passenden Code; Links bleiben unangetastet.
  const emojiRe = /^(?:\p{RI}\p{RI}|(?:\p{Extended_Pictographic})(?:️|⃣)?(?:‍(?:\p{Extended_Pictographic})(?:️|⃣)?)*|[0-9#*]️?⃣)/u;
  function translateSmileys(text, from, to) {
    if (from === to || !text) return { text, missing: [] };
    const tokens = from === 'joyclub' ? SM.joyTokens : from === 'poppen' ? SM.poppenTokens : [];
    const table = from === 'joyclub' ? (to === 'poppen' ? SM.joyToPoppen : null)
      : from === 'poppen' ? (to === 'joyclub' ? SM.poppenToJoy : SM.poppenToUnicode)
      : /* unicode */ (to === 'poppen' ? SM.unicodeToPoppen : SM.unicodeToJoy);
    const out = []; const missing = [];
    let i = 0;
    const s = String(text);
    while (i < s.length) {
      // Links unangetastet lassen
      if (/^(https?:\/\/|www\.)/i.test(s.slice(i))) { const m = s.slice(i).match(/^\S+/); out.push(m[0]); i += m[0].length; continue; }
      // 1) plattformeigene Codes (längste zuerst)
      let hit = '';
      if (tokens.length) { for (const tk of tokens) { if (tk && s.startsWith(tk, i)) { hit = tk; break; } } }
      if (hit) {
        const rep = table && table[hit];
        if (rep != null) out.push(rep); else { out.push(hit); missing.push(hit); }
        i += hit.length; continue;
      }
      // 2) Unicode-Emoji als Graphem-Cluster
      const em = s.slice(i).match(emojiRe);
      if (em) {
        const e = em[0];
        const rep = to === 'poppen' ? (SM.unicodeToPoppen[e] || SM.unicodeToPoppen[e.replace(/️/g, '')]) : to === 'joyclub' ? (SM.unicodeToJoy[e] || SM.unicodeToJoy[e.replace(/️/g, '')]) : null;
        if (to === 'unicode' || from === 'unicode') {
          // nach Unicode: Code→Emoji bereits in table abgedeckt; from=unicode: table liefert Ziel
          if (from === 'unicode') { const r = table[e] || table[e.replace(/️/g, '')]; if (r != null) { out.push(r); } else { out.push(e); missing.push(e); } i += e.length; continue; }
        }
        out.push(rep != null ? rep : e);
        if (rep == null && to !== 'unicode') missing.push(e);
        i += e.length; continue;
      }
      out.push(s[i]); i++;
    }
    return { text: out.join(''), missing: uniq(missing) };
  }
  // Kürzel (poppen und JOYclub) → Unicode-Smileys, für Kommentare und Beiträge (dort zeigt poppen Kürzel nur als Text).
  // Nur ganze Kürzel: Kürzel mit Buchstabe/Ziffer am Rand dürfen nicht an Buchstaben/Ziffern hängen; „12:30“ bleibt;
  // Links bleiben unangetastet.
  let smUniToks = null;
  function smileysToUnicode(text) {
    const s = String(text || '');
    if (!s) return s;
    const toks = smUniToks || (smUniToks = [...new Set([...SM.joyTokens, ...SM.poppenTokens])].filter(Boolean).sort((a, b) => b.length - a.length));
    const an = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
    const uni = (tk) => {
      let p = SM.poppenToUnicode[tk] != null ? tk : SM.joyToPoppen[tk];
      if (p == null) return null;
      const u = SM.poppenToUnicode[p];
      return u != null ? u : (emojiRe.test(p) ? p : null);
    };
    const out = [];
    let i = 0;
    while (i < s.length) {
      if (/^(https?:\/\/|www\.)/i.test(s.slice(i))) { const m = s.slice(i).match(/^\S+/); out.push(m[0]); i += m[0].length; continue; }
      let done = false;
      for (const tk of toks) {
        if (!s.startsWith(tk, i)) continue;
        const prev = i ? s[i - 1] : '', next = s[i + tk.length] || '';
        if (an(tk[0]) && an(prev)) continue;
        if (an(tk[tk.length - 1]) && an(next)) continue;
        if (tk[0] === ':' && /\d/.test(prev) && /\d/.test(tk[1] || '')) continue;      // Uhrzeit
        const u = uni(tk); if (u == null) continue;
        out.push(u); i += tk.length; done = true; break;
      }
      if (!done) { out.push(s[i]); i++; }
    }
    return out.join('');
  }
  // Kommentare und Gruppen-Beiträge: Kürzel vor dem Absenden in Unicode umwandeln
  rewritePageRequest((method, path, b) => {
    if (method !== 'POST' || !b || typeof b.content !== 'string') return null;
    if (!/^(v2\/comment\/add|group-feed\/status-update\/add)$/.test(path)) return null;
    const c = smileysToUnicode(b.content);
    return c !== b.content ? { ...b, content: c } : null;
  });
  // Codes/Emojis entfernen → Vergleichstext (Abschnitt 4.3)
  function stripSmileys(text) {
    let s = String(text || '');
    const r = translateSmileys(s, 'joyclub', 'poppen').text;     // JOY-Codes vereinheitlichen (zur Erkennung)
    s = s;
    // alle poppen- und joy-Codes entfernen
    for (const tk of [...SM.poppenTokens, ...SM.joyTokens]) { if (tk) s = s.split(tk).join(' '); }
    // Unicode-Emojis und Modifikatoren entfernen
    s = s.replace(/\p{RI}\p{RI}|\p{Extended_Pictographic}(?:️|⃣)?(?:‍\p{Extended_Pictographic}(?:️|⃣)?)*|[️‍⃣\u{1F3FB}-\u{1F3FF}]/gu, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }
  void stripSmileys;

  // =====================================================================================
  // Textvorlagen (bis 100 Stück, je bis 8000 Zeichen) – GM-Speicher, Export/Import,
  // Termine-Bereich, Smiley-Übersetzung. Knopf + Menü im Messenger.
  // =====================================================================================
  const TPL_MAX = 100, TPL_LEN = 8000;
  const K_TPL = 'vaf2_templates';
  const getTpls = () => { const l = GM_getValue(K_TPL, []); return Array.isArray(l) ? l : []; };
  const setTpls = (l) => { GM_setValue(K_TPL, l); Bus.emit('tpl'); try { if (typeof TplSync !== 'undefined' && !TplSync.pulling) TplSync.push(l).catch(() => {}); } catch {} };
  // Beim Speichern einer Vorlage: Metadaten setzen und über den Briefkasten senden (falls aktiv)
  function saveTemplate(list, t, isNew) {
    if (typeof tplEnsureMeta === 'function') tplEnsureMeta(t);
    t.updatedAt = now(); t.updatedBy = { pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' };
    setTpls(list);
    try { if (typeof bkSendTemplate === 'function') bkSendTemplate({ id: t.id, name: t.name, text: t.text, updatedAt: t.updatedAt, updatedBy: t.updatedBy, deletedAt: null }); } catch {}
  }
  const tplNameKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const tplIcon = (sz = 22) => `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/><path d="M8.5 15.5l5.4-5.4a1.2 1.2 0 0 1 1.7 1.7L10.2 17.2l-2.4.6.7-2.3z"/></svg>`;
  // Symbol des Benutzers für den Messenger-Knopf
  const TPL_BTN_ICON = `<svg viewBox="0 0 22 22" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M20.167,0H1.833A1.833,1.833,0,0,0,0,1.833V20.167A1.833,1.833,0,0,0,1.833,22H14.667a.914.914,0,0,0,.648-.269l6.417-6.417A.916.916,0,0,0,22,14.667V1.833A1.833,1.833,0,0,0,20.167,0M14.428,7.563H12.171v7.75a1.162,1.162,0,1,1-2.324,0V7.566H7.581a1.02,1.02,0,0,1-1-1.039,1.008,1.008,0,0,1,1.008-.991h6.84a1.014,1.014,0,0,1,0,2.028"></path></svg>`;

  // ---------- Termine (gemeinsame Datei mit dem Messenger-Abschnitt; Format wann - wo - was - Link) ----------
  // Kurzform (wann - wo - Link, ohne was) beim Einfügen über die Datei wieder ausschreiben.
  async function expandMeetLines(text) {
    let r = await readTermFile(false).catch(() => ({ state: 'none' }));
    if (r.state !== 'ok') return text;
    const all = allTerms(r.text);
    const byLink = new Map(), byDW = new Map();
    for (const t of all) { if (t.link) byLink.set(linkCmp(t.link), t); byDW.set(t.wann + '|' + norm(t.wo), t); }
    return String(text).split(/\r?\n/).map((line) => {
      const t = parseTermLine(line);
      if (!t || t.was) return line;
      const hit = (t.link && byLink.get(linkCmp(t.link))) || byDW.get(t.wann + '|' + norm(t.wo));
      return hit && hit.was ? hit.line : line;
    }).join('\n');
  }

  // ---------- Overlay „Textvorlagen“ ----------
  function tplOverlay() {
    const ov = document.createElement('div'); ov.className = 'vaf-ov'; ov.id = 'vaf-tpl-ov';
    const box = document.createElement('div'); box.className = 'vaf-md'; box.style.cssText = 'display:flex;flex-direction:column;max-height:92vh;padding:0;overflow:hidden';
    box.innerHTML = `<div class="vaf-tpl-head" style="display:flex;align-items:center;gap:10px;padding:16px 20px 10px">
        <button type="button" class="vaf-tpl-back" title="Zurück" style="border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:0 4px">‹</button>
        <h2 style="margin:0;font-size:20px;font-weight:700;color:#fff" data-r="title">Textvorlagen</h2></div>
      <div class="vaf-cur" data-r="toast" style="min-height:0;margin:0 20px"></div>
      <div class="vaf-tpl-body" data-r="body" style="flex:1;overflow:auto;padding:4px 20px"></div>
      <div class="vaf-tpl-foot" data-r="foot" style="display:flex;flex-direction:column;gap:10px;padding:12px 20px 16px;border-top:1px solid #2c2c2c"></div>`;
    ov.appendChild(box); document.body.appendChild(ov);
    const $ = (r) => box.querySelector(`[data-r=${r}]`);
    const m = {
      ov, box, backFn: null,
      close() { if (ov.isConnected) ov.remove(); document.removeEventListener('keydown', onKey, true); },
      title: (t) => { $('title').textContent = t; },
      setBody: (html) => { $('body').innerHTML = html; return $('body'); },
      setFoot: (btns) => { const f = $('foot'); f.innerHTML = ''; for (const b of btns) { const e = document.createElement('button'); e.type = 'button'; e.className = 'vaf-big' + (b.primary ? ' vaf-pri' : ''); e.textContent = b.label; e.disabled = !!b.disabled; if (b.title) e.title = b.title; e.style.width = b.half ? '' : '100%'; if (b.half) e.style.flex = '1'; e.addEventListener('click', () => b.fn(e)); f.appendChild(e); } f.style.flexDirection = btns.some((b) => b.half) ? 'row' : 'column'; },
      toast: (t) => { $('toast').textContent = t; if (t) setTimeout(() => { if ($('toast').textContent === t) $('toast').textContent = ''; }, 3000); },
    };
    box.querySelector('.vaf-tpl-back').addEventListener('click', () => (m.backFn ? m.backFn() : m.close()));
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) m.close(); });
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); m.backFn ? m.backFn() : m.close(); } };
    document.addEventListener('keydown', onKey, true);
    return m;
  }
  function openTemplates() {
    const m = tplOverlay();
    const trashCount = () => { try { return (G.get('tpl_trash', []) || []).length; } catch { return 0; } };
    const counter = () => `<div style="display:flex;justify-content:space-between;align-items:baseline;margin:2px 0 10px"><b style="color:#fff">Textvorlagen</b><span class="vaf-mini">${getTpls().length} von ${TPL_MAX}${trashCount() ? ` · <a href="#" data-a="trash">Papierkorb (${trashCount()})</a>` : ''}</span></div>`;
    const showList = () => {
      m.backFn = null; m.title('Textvorlagen');
      const tpls = getTpls();
      const body = m.setBody(counter() + (tpls.length ? tpls.map((t, i) => `<div class="vaf-tpl-item" data-i="${i}" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #2c2c2c;cursor:pointer">
          <span style="color:#ffc21a;flex:none;margin-top:2px">${tplIcon(22)}</span>
          <div style="min-width:0"><div style="font-weight:600;color:#fff">${esc(t.name)}</div><div class="vaf-mini" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap">${esc(t.text)}</div></div></div>`).join('')
        : '<div class="vaf-mini" style="padding:12px 0">Noch keine Textvorlagen.</div>'));
      body.querySelectorAll('.vaf-tpl-item').forEach((el) => el.addEventListener('click', () => showEdit(+el.dataset.i)));
      const tl = body.querySelector('[data-a=trash]'); if (tl) tl.addEventListener('click', (e) => { e.preventDefault(); showTrash(); });
      m.setFoot([
        { label: 'Textvorlage hinzufügen', primary: true, disabled: tpls.length >= TPL_MAX, title: tpls.length >= TPL_MAX ? `Höchstens ${TPL_MAX} Textvorlagen` : '', fn: () => showEdit(-1) },
        { label: 'Textvorlagen exportieren/importieren', fn: () => exportImportDialog(showList) },
      ]);
    };
    const showEdit = (idx) => {
      m.backFn = showList; m.title(idx < 0 ? 'Textvorlage hinzufügen' : 'Textvorlage bearbeiten');
      const tpls = getTpls();
      const t = idx < 0 ? { name: '', text: '' } : { ...tpls[idx] };
      const isTermin = () => /termin/i.test(nameEl.value);
      const body = m.setBody(counter() +
        `<label class="vaf-fl" style="display:block;margin-bottom:10px"><span class="vaf-mini">Name der Textvorlage</span><input class="vaf-in" data-f="name" value="${esc(t.name)}"></label>
         <label class="vaf-fl" style="display:block"><span class="vaf-mini">Nachricht</span><textarea class="vaf-in" data-f="text" rows="6" maxlength="${TPL_LEN}" style="resize:none;height:9em">${esc(t.text)}</textarea></label>
         <div class="vaf-mini" data-f="cnt" style="text-align:right;margin-top:2px"></div>
         <div data-f="termine"></div>`);
      const nameEl = body.querySelector('[data-f=name]'), textEl = body.querySelector('[data-f=text]'), cnt = body.querySelector('[data-f=cnt]');
      const upd = () => { cnt.textContent = `Noch ${fmtN(TPL_LEN - textEl.value.length)} Zeichen möglich`; };
      textEl.addEventListener('input', upd); upd();
      nameEl.addEventListener('input', () => drawTermine());
      const drawTermine = async () => {
        const box = body.querySelector('[data-f=termine]');
        if (!isTermin()) { box.innerHTML = ''; return; }
        box.innerHTML = '<div style="margin-top:14px;border-top:1px solid #2c2c2c;padding-top:10px"><div class="vaf-mini">Termine</div><div data-f="tl">…</div></div>';
        const tl = box.querySelector('[data-f=tl]');
        const render = async (ask) => {
          if (!termSupported()) { tl.innerHTML = '<div class="vaf-mini">Nur in Chrome/Edge.</div>'; return; }
          const r = await readTermFile(ask);
          if (r.state === 'none') { tl.innerHTML = '<a href="#" data-a="pick">Datei mit Terminen wählen …</a>'; }
          else if (r.state === 'perm') { tl.innerHTML = '<a href="#" data-a="perm">Zugriff auf die Datei erlauben</a> · <a href="#" data-a="pick">Datei ändern …</a>'; }
          else if (r.state === 'error') { tl.innerHTML = `<div class="vaf-mini" style="color:#ff7875">Datei nicht lesbar: ${esc(r.name)}</div><a href="#" data-a="pick">Datei ändern …</a>`; }
          else {
            const { list } = upcomingTerms(r.text);
            tl.innerHTML = (list.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">${list.map((t, i) => `<button type="button" class="vaf-btn" data-t="${i}" title="${esc(t.line)}" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.label)}</button>`).join('')}</div>
              <div style="display:flex;gap:12px;flex-wrap:wrap"><a href="#" data-a="all">Alle übernehmen</a><a href="#" data-a="pick">Datei ändern …</a>${r.shared && r.local === 'perm' ? '<a href="#" data-a="perm">Zugriff auf die eigene Datei erlauben</a>' : ''}</div>${r.shared ? `<div class="vaf-mini">${esc(r.name + termSrcNote(r))}</div>` : ''}`
              : '<div class="vaf-mini">Keine kommenden Termine.</div><a href="#" data-a="pick">Datei ändern …</a>');
            const fmt = (t) => [t.wann, t.wo, (t.link ? normJoyLink(t.link) : t.was)].filter(Boolean).join(' - ');
            tl.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => insertAtCursor(textEl, fmt(list[+b.dataset.t]))));
            const allBtn = tl.querySelector('[data-a=all]'); if (allBtn) allBtn.addEventListener('click', (e) => { e.preventDefault(); textEl.value = list.map(fmt).join('\n\n').slice(0, TPL_LEN); upd(); });
          }
          const pk = tl.querySelector('[data-a=pick]'); if (pk) pk.addEventListener('click', async (e) => { e.preventDefault(); if (await pickTermFile()) render(false); });
          const pm2 = tl.querySelector('[data-a=perm]'); if (pm2) pm2.addEventListener('click', (e) => { e.preventDefault(); render(true); });
        };
        render(false);
      };
      drawTermine();
      const save = () => {
        const name = nameEl.value.trim(), text = textEl.value;
        if (!name) { m.toast('Bitte einen Namen eingeben.'); return; }
        if (!text.trim()) { m.toast('Bitte einen Text eingeben.'); return; }
        const list = getTpls();
        if (list.some((x, i) => i !== idx && tplNameKey(x.name) === tplNameKey(name))) { m.toast('Name schon vergeben.'); return; }
        let t;
        if (idx < 0) { t = { name, text }; list.push(t); } else { t = { ...list[idx], name, text }; list[idx] = t; }
        saveTemplate(list, t, idx < 0); showList();
      };
      m.setFoot([
        ...(idx < 0 ? [] : [{ label: 'Textvorlage löschen', half: true, fn: () => { if (W.confirm('Diese Textvorlage löschen?')) { const l = getTpls(); const cur = l[idx]; if (cur && cur.id && typeof tplTrash === 'function') tplTrash(cur.id); else { l.splice(idx, 1); setTpls(l); } showList(); } } }]),
        { label: 'Textvorlage speichern', primary: true, half: idx >= 0, fn: save },
      ]);
    };
    const showTrash = () => {
      m.backFn = showList; m.title('Papierkorb');
      const tr = (G.get('tpl_trash', []) || []);
      const body = m.setBody(tr.length ? tr.map((t, i) => `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #2c2c2c"><div><div style="font-weight:600;color:#fff">${esc(t.name)}</div><div class="vaf-mini">gelöscht am ${deDateTime(t.deletedAt || 0)}</div></div><button type="button" class="vaf-btn" data-i="${i}">Wiederherstellen</button></div>`).join('') : '<div class="vaf-mini" style="padding:12px 0">Papierkorb ist leer.</div>');
      body.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { if (typeof tplRestore === 'function') tplRestore(tr[+b.dataset.i].id); showTrash(); }));
      m.setFoot([{ label: 'Zurück', fn: showList }]);
    };
    showList();
    return m;
  }

  // ---------- Export / Import ----------
  async function tplExportPayload() {
    const me = Me.get() || await loadMe();
    return { payload: { format: 'fickliste', version: 1, platform: 'poppen', exported: Date.now(), templates: getTpls().map((t) => ({ name: t.name, text: t.text })) }, nick: me.nick };
  }
  function exportImportDialog(done) {
    const m = modal({ title: 'Textvorlagen', html: '<p>Was möchtest du tun?</p>' });
    m.buttons([
      { label: 'Exportieren', primary: true, fn: () => { m.close(); wayDialog('export', done); } },
      { label: 'Importieren', fn: () => { m.close(); wayDialog('import', done); } },
      { label: 'Abbrechen', focus: true, fn: () => m.close() },
    ]);
  }
  function wayDialog(mode, done) {
    const m = modal({ title: mode === 'export' ? 'Exportieren' : 'Importieren', html: '' });
    m.buttons([
      { label: 'per Datei', primary: true, fn: async () => { m.close(); mode === 'export' ? await tplExportFile() : await tplImport(await pickFile(), done); } },
      { label: 'per Zwischenablage', fn: async () => { m.close(); mode === 'export' ? await tplExportClip() : tplImportClip(done); } },
      { label: 'Abbrechen', focus: true, fn: () => m.close() },
    ]);
  }
  async function tplExportText() {
    const { payload, nick } = await tplExportPayload();
    const enc = await encryptJSON(payload, nick);
    return JSON.stringify({ format: 'fickliste-enc', platform: 'poppen', account: nick, ...enc });
  }
  async function tplExportFile() { download(`textvorlagen-poppen-${stamp()}.json`, await tplExportText()); toast('Exportiert.'); }
  async function tplExportClip() { try { await navigator.clipboard.writeText(await tplExportText()); toast('In die Zwischenablage kopiert.'); } catch { toast('Zwischenablage nicht verfügbar.'); } }
  function tplImportClip(done) {
    navigator.clipboard.readText().then((t) => tplImport(t, done)).catch(() => {
      const m = modal({ title: 'Importieren', html: '<p>Füge den Inhalt mit Strg+V ein:</p><textarea class="vaf-in" data-f="t" rows="6" style="resize:vertical"></textarea>' });
      m.buttons([{ label: 'Importieren', primary: true, fn: () => { const v = m.body.querySelector('[data-f=t]').value; m.close(); tplImport(v, done); } }, { label: 'Abbrechen', focus: true, fn: () => m.close() }]);
    });
  }
  async function tplImport(text, done) {
    if (!text) return;
    let data;
    try { data = await readFickFile(text); } catch (e) { toast('Datei nicht lesbar: ' + esc(e.message)); return; }
    if (!data || !Array.isArray(data.templates)) { toast('Keine Textvorlagen in der Datei.'); return; }
    const from = data.platform || 'joyclub';
    const list = getTpls();
    const sum = { neu: 0, unveraendert: 0, ergaenzt: 0, ersetzt: 0, beide: 0, uebersprungen: 0 };
    const missing = [];
    for (const imp of data.templates) {
      if (!imp || !imp.name) continue;
      const tr = translateSmileys(String(imp.text || ''), from === 'poppen' ? 'poppen' : from === 'joyclub' ? 'joyclub' : 'unicode', 'poppen');
      if (tr.missing.length) missing.push(`${imp.name}: ${tr.missing.join(' ')}`);
      let newText = tr.text.slice(0, TPL_LEN);
      const idx = list.findIndex((x) => tplNameKey(x.name) === tplNameKey(imp.name));
      if (idx < 0) {
        if (list.length >= TPL_MAX) { sum.uebersprungen++; continue; }
        list.push({ name: imp.name.trim(), text: newText }); sum.neu++; continue;
      }
      const mine = list[idx];
      const a = stripSmileys(mine.text), b = stripSmileys(imp.text);
      if (a === b) { sum.unveraendert++; continue; }
      if ((b.startsWith(a) || b.endsWith(a)) && a) {
        // ergänzen: nur das neue Rohstück übersetzen und an die eigene Vorlage anfügen; der Rest bleibt
        const rawCut = fragmentCut(imp.text, a, b.startsWith(a) ? 'start' : 'end');
        const frag = b.startsWith(a) ? imp.text.slice(rawCut) : imp.text.slice(0, rawCut);
        const fragT = translateSmileys(frag, from === 'poppen' ? 'poppen' : from === 'joyclub' ? 'joyclub' : 'unicode', 'poppen').text;
        const merged = b.startsWith(a) ? mine.text + fragT : fragT + mine.text;
        if (merged.length <= TPL_LEN) { list[idx] = { ...mine, text: merged }; sum.ergaenzt++; continue; }
      }
      const v = W.confirm(`Textvorlage „${imp.name}“ wurde auf beiden Seiten geändert.\n\nOK = importierte übernehmen, Abbrechen = eigene behalten.`);
      if (v) { list[idx] = { ...mine, text: newText }; sum.ersetzt++; } else sum.uebersprungen++;
    }
    setTpls(list);
    await ask('Import fertig', `<div class="vaf-stats"><span>Neu</span><b>${sum.neu}</b><span>Unverändert</span><b>${sum.unveraendert}</b><span>Ergänzt</span><b>${sum.ergaenzt}</b><span>Ersetzt</span><b>${sum.ersetzt}</b><span>Übersprungen</span><b>${sum.uebersprungen}</b></div>${missing.length ? `<h3>Nicht übersetzte Smileys</h3><div class="vaf-list">${missing.map(esc).map((x) => `<div>${x}</div>`).join('')}</div>` : ''}`, [{ label: 'OK', primary: true, focus: true }]);
    if (done) done();
  }
  // Rohtext-Position, ab der (start) bzw. bis zu der (end) der gemeinsame Vergleichstext reicht
  function fragmentCut(raw, common, side) {
    const s = String(raw);
    const target = common.length;
    if (side === 'start') { let i = 0; while (i < s.length && stripSmileys(s.slice(0, i)).length < target) i++; return i; }
    let i = s.length; while (i > 0 && stripSmileys(s.slice(i)).length < target) i--; return i;
  }

  // ---------- Einfügen ins Chat-Eingabefeld ----------
  function insertAtCursor(ta, text) {
    const v = ta.value || '';
    const pos = typeof ta.selectionStart === 'number' ? ta.selectionStart : v.length;
    const before = v.slice(0, pos), after = v.slice(pos);
    const ins = (before && !/\n$/.test(before) ? '\n' : '') + text + (after && !/^\n/.test(after) ? '\n' : '');
    try { const setter = Object.getOwnPropertyDescriptor(W.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, before + ins + after); } catch { ta.value = before + ins + after; }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    const c = (before + ins).length; try { ta.setSelectionRange(c, c); } catch {}
  }
  // Vorlage in die Chat-Eingabezeile einfügen (Termin-Kurzform ausschreiben)
  async function insertTemplate(tpl) {
    const ta = document.querySelector('main textarea.rc-textarea, main .ant-mentions textarea');
    if (!ta) { toast('Eingabefeld nicht gefunden.'); return; }
    let text = tpl.text;
    try { text = await expandMeetLines(text); } catch {}
    insertAtCursor(ta, text);
  }

  // ---------- Knopf neben der Eingabezeile (nur /inbox/p/<nick>) ----------
  function templateButton() {
    if (!/^\/inbox\/p\//.test(location.pathname)) return;
    const bar = document.querySelector('main .sNIvTu');
    if (!bar || bar.querySelector('#vaf-tpl-btn')) return;
    const gif = [...bar.querySelectorAll('button')].pop();
    const b = (gif || bar.lastElementChild).cloneNode(false);
    b.id = 'vaf-tpl-btn'; b.type = 'button'; b.title = 'Textvorlagen'; b.removeAttribute('aria-hidden');
    b.innerHTML = `<span class="ant-btn-icon">${TPL_BTN_ICON}</span>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); templatePopup(b); });
    bar.appendChild(b);
  }
  function templatePopup(anchor) {
    const old = document.getElementById('vaf-tpl-pop'); if (old) { old.remove(); return; }
    const tpls = getTpls();
    const r = anchor.getBoundingClientRect();
    const pop = document.createElement('div'); pop.id = 'vaf-tpl-pop';
    pop.style.cssText = `position:fixed;left:${Math.round(r.left)}px;bottom:${Math.round(innerHeight - r.top + 8)}px;z-index:2147483600;background:#1f1f1f;border:1px solid #333;border-radius:14px;padding:8px 0;min-width:220px;max-height:60vh;overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,.6);font:600 15px system-ui,sans-serif;color:#fff`;
    pop.innerHTML = tpls.length ? tpls.map((t, i) => `<div class="vaf-tpl-pi" data-i="${i}" style="padding:9px 18px;cursor:pointer;white-space:nowrap">${esc(t.name)}</div>`).join('')
      : '<div style="padding:9px 18px;color:#8c8c8c;font-weight:400">Noch keine Textvorlagen – über ⋮ → Textvorlagen anlegen</div>';
    document.body.appendChild(pop);
    pop.querySelectorAll('.vaf-tpl-pi').forEach((el) => { el.addEventListener('mouseenter', () => (el.style.background = '#2c2c2c')); el.addEventListener('mouseleave', () => (el.style.background = '')); el.addEventListener('click', () => { pop.remove(); insertTemplate(tpls[+el.dataset.i]); }); });
    const close = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  }
  // Eintrag „Textvorlagen“ im Drei-Punkte-Menü (nach „Nachrichtenfilter“)
  function templateMenuEntry() {
    for (const ul of document.querySelectorAll('ul.ant-dropdown-menu')) {
      const items = [...ul.querySelectorAll(':scope > li')];
      const filter = items.find((li) => /Nachrichtenfilter/.test(li.textContent));
      if (!filter || ul.querySelector('#vaf-tpl-menu')) continue;
      const li = filter.cloneNode(true);
      li.id = 'vaf-tpl-menu'; li.removeAttribute('data-menu-id');
      const c = li.querySelector('.ant-dropdown-menu-title-content') || li;
      c.textContent = 'Textvorlagen';
      li.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); document.body.click(); openTemplates(); }, true);
      filter.after(li);
    }
  }
  function templateUi() { try { templateButton(); templateMenuEntry(); } catch (e) { warn('Textvorlagen', e); } }

  // =====================================================================================
  // Briefkasten: automatischer Abgleich von Fickliste und Textvorlagen mit dem JOYclub-Skript
  // über eine leere, neutrale Seite (GitHub Pages). Siehe Nachtrag „Abgleich über den Briefkasten“.
  // =====================================================================================
  const BK_URL = 'https://schimmelreiter.github.io/joyclub-opa-scan/briefkasten.html';
  const BK_HOST = 'schimmelreiter.github.io';
  const PLAT = (() => { const h = location.hostname; return /joyclub\.de$/.test(h) ? 'joyclub' : /poppen\.de$/.test(h) ? 'poppen' : h === BK_HOST ? 'bk' : 'other'; })();
  // Betriebsart: 'poppen' (eigene Seite) | 'joyclub' (passiv) | 'briefkasten' (iframe) | 'inert' (nichts tun)
  const BK_MODE = (() => {
    const inFrame = W.top !== W;
    if (PLAT === 'bk') return inFrame ? 'briefkasten' : 'inert';
    if (inFrame) return 'inert';                       // in fremden iframes (auch poppen eigene) nichts tun
    if (PLAT === 'poppen') return 'poppen';
    if (PLAT === 'joyclub') return 'joyclub';
    return 'inert';
  })();

  // ---------- Postausgang/-eingang im GM-Speicher (die Seiten-Instanz füllt, die iframe-Instanz leert) ----------
  let bkApplying = false;              // während des Anwendens eingegangener Daten nicht zurücksenden
  const bkOut = () => G.get('bk_out', { nextSeq: 1, items: [] });
  function bkSend(kind, data) {
    return;                                            // 2.38: alter Postfach-Abgleich abgeschaltet
    // eslint-disable-next-line no-unreachable
    if (BK_MODE !== 'poppen' || bkApplying) return;
    const o = bkOut();
    o.items.push({ seq: o.nextSeq, ts: now(), kind, data });
    o.nextSeq++;
    // Grenze 1 MB: bei Überlauf Vollabgleich vormerken
    try { if (JSON.stringify(o).length > 1024 * 1024) { o.items = [{ seq: o.nextSeq, ts: now(), kind: 'full', data: null }]; o.nextSeq++; } } catch {}
    G.set('bk_out', o);
  }
  function bkSendTemplate(t) { bkSend('template', t); }
  function bkSendPerson(p) { bkSend('person', p); }
  async function bkFullData() {
    const persons = await Fick.all().catch(() => []);
    return { templates: getTpls(), persons };
  }

  // ---------- Seiten-Instanz (poppen.de): Eingänge anwenden, Postausgang kürzen ----------
  async function bkApplyInbox() {
    if (BK_MODE !== 'poppen') return;
    if (!(await Lock.take('bk_page', 'inbox'))) return;
    try {
      const inb = G.get('bk_in', { items: [] });
      if (!inb.items.length) return;
      const items = inb.items.slice();
      bkApplying = true;
      try {
      for (const it of items) {
        try {
          if (it.kind === 'template') await bkMergeTemplate(it.data);
          else if (it.kind === 'person') await bkMergePerson(it.data);
          else if (it.kind === 'full') await bkMergeFull(it.data);
        } catch (e) { warn('Briefkasten anwenden', e); }
      }
      } finally { bkApplying = false; }
      // verarbeitete entfernen (nur die, die wir gesehen haben; neue bleiben)
      const rest = (G.get('bk_in', { items: [] }).items || []).filter((x) => !items.some((y) => y.seq === x.seq && y.ts === x.ts));
      G.set('bk_in', { items: rest });
      Bus.emit('tpl'); Bus.emit('fick');
    } finally { Lock.release('bk_page'); }
  }
  function bkTrimOut() {
    if (BK_MODE !== 'poppen') return;
    const acked = G.get('bk_out_acked', 0) || 0;
    const o = bkOut();
    const before = o.items.length;
    o.items = o.items.filter((x) => x.seq > acked);
    if (o.items.length !== before) G.set('bk_out', o);
  }

  // ---------- Textvorlagen: Felder für den Abgleich + Drei-Wege-Merge ----------
  function tplEnsureMeta(t) {
    if (!t.id) t.id = 'x:' + uuid();
    if (!t.updatedAt) t.updatedAt = now();
    if (!t.updatedBy) t.updatedBy = { pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' };
    return t;
  }
  async function tplHash(text) { return (await sha256hex(stripSmileys(text || ''))).slice(0, 16); }
  const bkBase = () => G.get('bk_base', {});          // { 'tpl:'+id : {hash,name,at} }
  const bkSetBase = (b) => G.set('bk_base', b);
  // einen eingegangenen Vorlagen-Stand R anwenden
  async function bkMergeTemplate(R) {
    if (!R || !R.name) return;
    const list = getTpls().map(tplEnsureMeta);
    const base = bkBase();
    const bk = 'tpl:' + (R.id || '');
    let idx = R.id ? list.findIndex((x) => x.id === R.id) : -1;
    if (idx < 0) idx = list.findIndex((x) => tplNameKey(x.name) === tplNameKey(R.name));
    const Rtext = translateSmileys(String(R.text || ''), 'joyclub', 'poppen').text.slice(0, TPL_LEN);
    const Rhash = await tplHash(R.text);
    if (idx < 0) {
      // Grabstein ohne eigene Vorlage → ignorieren
      if (R.deletedAt) return;
      if (list.length >= TPL_MAX) { log('Briefkasten: Textvorlage übersprungen (Limit)'); return; }
      const nt = tplEnsureMeta({ id: R.id || uuid(), name: R.name, text: Rtext, updatedAt: R.updatedAt || now(), updatedBy: R.updatedBy });
      list.push(nt); setTpls(list);
      base[bk] = { hash: Rhash, name: R.name, at: now() }; bkSetBase(base);
      return;
    }
    const L = list[idx];
    L.id = L.id || R.id || uuid();
    const b = base['tpl:' + L.id] || base[bk];
    const B = b ? b.hash : null;
    const Lhash = await tplHash(L.text);
    if (R.deletedAt) {
      if (Lhash === B || !B) { tplTrash(L.id); }                 // unverändert → Papierkorb
      else if (W.confirm(`„${L.name}“ wurde auf der anderen Seite gelöscht, hier aber geändert. OK = löschen, Abbrechen = behalten.`)) tplTrash(L.id);
      base['tpl:' + L.id] = { hash: Rhash, name: R.name, at: now() }; bkSetBase(base);
      return;
    }
    if (Lhash === Rhash) { base['tpl:' + L.id] = { hash: Rhash, name: R.name, at: Math.max(L.updatedAt || 0, R.updatedAt || 0) }; bkSetBase(base); applyName(L, R); setTpls(list); return; }
    if (B && Lhash === B && Rhash !== B) { L.text = Rtext; L.updatedAt = R.updatedAt || now(); L.updatedBy = R.updatedBy; applyName(L, R); }
    else if (B && Rhash === B && Lhash !== B) { /* eigenes behalten */ }
    else {
      // Notfall bzw. kein base: Mischregeln, sonst Rückfrage
      const a = stripSmileys(L.text), rr = stripSmileys(R.text);
      if (B == null && (rr.startsWith(a) || rr.endsWith(a)) && a) {
        const cut = fragmentCut(R.text, a, rr.startsWith(a) ? 'start' : 'end');
        const frag = rr.startsWith(a) ? R.text.slice(cut) : R.text.slice(0, cut);
        const fragT = translateSmileys(frag, 'joyclub', 'poppen').text;
        L.text = (rr.startsWith(a) ? L.text + fragT : fragT + L.text).slice(0, TPL_LEN);
      } else {
        const keep = W.confirm(`„${L.name}“ wurde auf beiden Seiten geändert.\nZuletzt: ${deDateTime(R.updatedAt || now())} auf ${R.updatedBy && (R.updatedBy.pf || R.updatedBy.platform) === 'joyclub' ? 'JOYclub' : 'der anderen Seite'}.\n\nOK = andere übernehmen, Abbrechen = eigene behalten.`);
        if (keep) { L.text = Rtext; L.updatedAt = R.updatedAt || now(); L.updatedBy = R.updatedBy; applyName(L, R); }
      }
    }
    base['tpl:' + L.id] = { hash: await tplHash(L.text), name: L.name, at: L.updatedAt || now() }; bkSetBase(base);
    setTpls(list);
    function applyName(L2, R2) { if (R2.name && (R2.updatedAt || 0) >= (L2.updatedAt || 0) && tplNameKey(R2.name) !== tplNameKey(L2.name) && !list.some((x) => x !== L2 && tplNameKey(x.name) === tplNameKey(R2.name))) L2.name = R2.name; }
  }
  async function bkMergePerson(R) { if (R) { const local = await Fick.all(); const t = local.find((p) => p.id === R.id) || null; if (t) { mergeFick(t, R); await Fick.put(t); } else { await Fick.put({ ...R }); } } }
  async function bkMergeFull(d) {
    if (!d) return;
    for (const t of d.templates || []) await bkMergeTemplate({ ...t });
    for (const p of d.persons || []) await bkMergePerson(p);
  }

  // ---------- Papierkorb (Grabsteine, 30 Tage) ----------
  const bkTrashStore = () => G.get('tpl_trash', []);
  function tplTrash(id) {
    const list = getTpls();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [t] = list.splice(i, 1);
    const tr = bkTrashStore(); tr.push({ ...t, deletedAt: now() }); G.set('tpl_trash', tr);
    setTpls(list);
    bkSend('template', { ...t, deletedAt: now() });
  }
  function tplRestore(id) {
    const tr = bkTrashStore(); const i = tr.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [t] = tr.splice(i, 1); delete t.deletedAt; G.set('tpl_trash', tr);
    const list = getTpls(); list.push(tplEnsureMeta({ ...t, updatedAt: now() })); setTpls(list);
    bkSendTemplate(list[list.length - 1]);
  }
  function tplPurgeTrash() { const tr = bkTrashStore().filter((x) => now() - (x.deletedAt || 0) < 30 * DAY); G.set('tpl_trash', tr); }

  // ---------- iframe einbetten (poppen.de und joyclub.de) ----------
  let bkEmbedded = false;
  function bkEmbed(now0) {
    if (bkEmbedded) return;
    bkEmbedded = true;
    const go = () => {
      try {
        if (document.getElementById('opa-briefkasten')) return;
        const f = document.createElement('iframe');
        f.id = 'opa-briefkasten';
        f.src = BK_URL + '#host=' + location.hostname + '&tab=' + encodeURIComponent(TAB_ID);
        f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
        f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;visibility:hidden';
        (document.documentElement || document.body).appendChild(f);
      } catch (e) { warn('Briefkasten einbetten', e); bkEmbedded = false; }
    };
    if (now0 || !document.documentElement) setTimeout(go, now0 ? 0 : 500); else setTimeout(go, Math.random() * 1500);
  }

  // ---------- Gemeinsame Ablage im Briefkasten (IndexedDB auf github.io, für alle Skripte) ----------
  //  Datenbank „opa-gemeinsam“, Formatdefinition: FORMAT.md im Repo. Ablagen:
  //   meta  { k, … }                      Formatversion (schema/minRead), Schlüssel-/Einstellungs-Kopien je Skript
  //   fick  { id, rev, updatedAt, updatedBy, deleted?, … }   gemeinsame Fickliste
  //   tpl   { id, rev, updatedAt, updatedBy, deleted?, name, text }   gemeinsame Textvorlagen
  //   ich   { id: '<plattform>:<uid>', pf, uid, nick, url, at }  eigene Profile („Ich“)
  //   arch  { id (auto), uid, … }         Profil-Archiv (poppen)
  const SHARED_DB = 'opa-gemeinsam';
  const SHARED_SCHEMA = 1;
  const SHARED_STORES = { meta: { keyPath: 'k' }, fick: { keyPath: 'id' }, tpl: { keyPath: 'id' }, ich: { keyPath: 'id' }, arch: { keyPath: 'id', autoIncrement: true, index: 'uid' } };
  function bkServer(parentTab) {
    let dbp = null;
    const sdb = () => dbp || (dbp = new Promise((resolve, reject) => {
      const rq = IDB.open(SHARED_DB, 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        for (const [n, def] of Object.entries(SHARED_STORES)) {
          if (d.objectStoreNames.contains(n)) continue;
          const st = d.createObjectStore(n, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
          if (def.index) st.createIndex(def.index, def.index, { unique: false });
        }
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    }));
    const rp = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    let bc = null; try { bc = new BroadcastChannel('opa-gemeinsam'); bc.onmessage = (e) => { const m = e.data || {}; if (m.store) G.set('bkv_' + m.store, now()); }; } catch {}
    const notify = (store) => { G.set('bkv_' + store, now()); try { bc && bc.postMessage({ store, at: now(), by: 'poppen' }); } catch {} };
    const VERSIONED = new Set(['fick', 'tpl']);
    async function op(o, a) {
      const d = await sdb();
      const store = a && a.s;
      if (store && !SHARED_STORES[store]) throw new Error('unbekannte Ablage ' + store);
      if (o === 'get') return rp(d.transaction(store).objectStore(store).get(a.k));
      if (o === 'all') return rp(d.transaction(store).objectStore(store).getAll());
      if (o === 'byIndex') return rp(d.transaction(store).objectStore(store).index(a.i).getAll(a.k));
      if (o === 'put' || o === 'del') {
        // Lesen und Schreiben in EINER Transaktion; versionierte Ablagen mit Versionszähler (rev) gegen gleichzeitiges Schreiben
        return new Promise((res, rej) => {
          const t = d.transaction(store, 'readwrite'); const st = t.objectStore(store);
          let out = null;
          const key = o === 'del' ? a.k : a.v[SHARED_STORES[store].keyPath];
          const doWrite = (cur) => {
            if (VERSIONED.has(store)) {
              const curRev = (cur && cur.rev) || 0;
              if ('expect' in a && a.expect !== null && a.expect !== curRev) { out = { conflict: cur }; return; }
              if ('expect' in a && a.expect === null && cur && !cur.deleted) { out = { conflict: cur }; return; }
              const v = o === 'del' ? { ...(cur || { [SHARED_STORES[store].keyPath]: key }), deleted: true } : { ...a.v };
              if (o !== 'del') delete v.deleted;
              v.rev = curRev + 1; v.updatedAt = now(); v.updatedBy = a.by || { pf: 'poppen', ver: VERSION };
              st.put(v); out = { ok: true, rev: v.rev, v };
            } else if (o === 'del') { st.delete(key); out = { ok: true }; }
            else { st.put(a.v); out = { ok: true }; }
          };
          if (key === undefined || key === null) { const r = st.put(a.v); r.onsuccess = () => { out = { ok: true, id: r.result }; }; }
          else { const g = st.get(key); g.onsuccess = () => doWrite(g.result); }
          t.oncomplete = () => { if (out && out.ok && store !== 'meta') notify(store); res(out); };
          t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
        });
      }
      if (o === 'putMany') {
        // Umzug/Wiederherstellung: neuere Stände gewinnen (updatedAt), Versionszähler wird fortgeschrieben
        return new Promise((res, rej) => {
          const t = d.transaction(store, 'readwrite'); const st = t.objectStore(store);
          let n = 0;
          for (const v of a.list || []) {
            if (!VERSIONED.has(store)) { st.put(v); n++; continue; }
            const g = st.get(v[SHARED_STORES[store].keyPath]);
            g.onsuccess = () => { const cur = g.result; if (cur && (cur.updatedAt || 0) >= (v.updatedAt || v.updated || 0)) return; st.put({ ...v, rev: ((cur && cur.rev) || 0) + 1, updatedAt: v.updatedAt || v.updated || now(), updatedBy: v.updatedBy || { pf: 'poppen', ver: VERSION } }); n++; };
          }
          t.oncomplete = () => { if (store !== 'meta') notify(store); res({ ok: true, n }); };
          t.onerror = () => rej(t.error);
        });
      }
      if (o === 'count') return rp(d.transaction(store).objectStore(store).count());
      if (o === 'clear') { await rp(d.transaction(store, 'readwrite').objectStore(store).clear()); notify(store); return { ok: true }; }
      throw new Error('unbekannter Aufruf ' + o);
    }
    (async () => {   // Formatversion festhalten (nur erhöhen, nie senken)
      try { const d = await sdb(); const cur = await rp(d.transaction('meta').objectStore('meta').get('schema')); if (!cur || cur.schema < SHARED_SCHEMA) await rp(d.transaction('meta', 'readwrite').objectStore('meta').put({ k: 'schema', schema: SHARED_SCHEMA, minRead: Math.max(1, (cur && cur.minRead) || 1) })); } catch (e) { warn('Briefkasten-Format', e); }
    })();
    if (!parentTab) return;
    const qk = 'rpcq_' + parentTab, rk = 'rpcr_' + parentTab, ak = 'rpca_' + parentTab;
    const doneIds = new Set();
    let busy = false, again = false;
    async function pump() {
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          const q = G.get(qk, []) || [];
          for (const r of q) {
            if (doneIds.has(r.id)) continue;
            doneIds.add(r.id);
            let ans;
            try { ans = { id: r.id, v: await op(r.op, r.args) }; } catch (e) { ans = { id: r.id, err: (e && e.message) || String(e) }; }
            const out = (G.get(rk, []) || []).slice(-40); out.push(ans); G.set(rk, out);
          }
        } while (again);
      } finally { busy = false; }
    }
    try { GM_addValueChangeListener('vaf2_' + qk, () => pump()); } catch {}
    const beat = () => G.set(ak, now());
    beat(); setInterval(beat, 5000);
    setInterval(pump, 3000);
    pump();
  }

  // ---------- Briefkasten-Instanz (läuft im iframe auf github.io) ----------
  function bkIframeMain() {
    try { const mt = /tab=([^&]+)/.exec(location.hash || ''); bkServer(mt ? decodeURIComponent(mt[1]) : ''); } catch (e) { warn('Briefkasten-Ablage', e); }
    const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } } };
    const mine = PLAT === 'bk' ? bkIframeHost() : 'poppen';
    function bkIframeHost() { const m = /host=([^&]+)/.exec(location.hash || ''); const h = m ? decodeURIComponent(m[1]) : ''; return /joyclub/.test(h) ? 'joyclub' : 'poppen'; }
    const other = mine === 'poppen' ? 'joyclub' : 'poppen';
    const K = { outMine: 'opa-bk:out:' + mine, outOther: 'opa-bk:out:' + other, ackMine: 'opa-bk:ack:' + mine, ackOther: 'opa-bk:ack:' + other, helloMine: 'opa-bk:hello:' + mine, helloOther: 'opa-bk:hello:' + other };
    // Lebenszeichen + Hallo
    const beat = () => { G.set('bk_alive', now()); LS.set(K.helloMine, JSON.stringify({ v: 1, ts: now(), script: 'poppen', version: VERSION })); G.set('bk_store_ok', LS.set('opa-bk:selftest:' + mine, String(now())) ? now() : 0); const ho = LS.get(K.helloOther); if (ho) { try { G.set('bk_hello_joy', JSON.parse(ho)); } catch {} } };
    beat(); setInterval(beat, 15000);
    // GM-Postausgang → localStorage
    const pushOut = () => { const o = G.get('bk_out', { nextSeq: 1, items: [] }); LS.set(K.outMine, JSON.stringify({ v: 1, platform: mine, account: (G.get('me', {}) || {}).nick || '', ts: now(), items: o.items })); W.dispatchEvent(new CustomEvent('opa-bk')); };
    try { GM_addValueChangeListener('vaf2_bk_out', pushOut); } catch {}
    pushOut();
    // localStorage des anderen → GM-Posteingang
    const pullIn = () => {
      const raw = LS.get(K.outOther); if (!raw) return;
      let box; try { box = JSON.parse(raw); } catch { return; }
      const items = (box && box.items) || [];
      if (!items.length) return;
      const lastIn = G.get('bk_in_last', 0) || 0;
      const fresh = items.filter((x) => x.seq > lastIn);
      if (fresh.length) {
        const inb = G.get('bk_in', { items: [] }); inb.items.push(...fresh); G.set('bk_in', inb);
        G.set('bk_in_last', Math.max(...items.map((x) => x.seq)));
      }
      LS.set(K.ackOther, String(Math.max(lastIn, ...items.map((x) => x.seq))));
      // Ack des anderen für unseren Postausgang
      const a = +(LS.get(K.ackMine) || 0); if (a) G.set('bk_out_acked', a);
    };
    pullIn();
    W.addEventListener('opa-bk', pullIn);
    W.addEventListener('storage', (e) => { if (e.key === K.outOther || e.key === K.ackMine) pullIn(); });
    setInterval(pullIn, 5000);
  }

  // ---------- Funktionstest ----------
  async function bkTest() {
    if (BK_MODE !== 'poppen') return;
    const r = { at: now(), alive: false, store: false, joy: false };
    const t0 = now();
    while (now() - t0 < 10000) { if (now() - (G.get('bk_alive', 0) || 0) < 12000) { r.alive = true; break; } await sleep(500); }
    r.store = !!G.get('bk_store_ok', 0);
    r.joy = !!G.get('bk_hello_joy', null);
    r.msg = !r.alive ? 'Briefkasten blockiert' : !r.store ? 'Speicher gesperrt' : !r.joy ? 'JOYclub-Skript nicht gefunden' : 'bereit';
    G.set('bk_test', r);
    return r;
  }

  // ---------- Verdrahtung ----------
  // 2.38: Der alte Postfach-Abgleich mit dem JOYclub-Skript entfällt (JOYclub 1.96 nutzt die gemeinsame Ablage
  // „opa-gemeinsam“ und füllt das Postfach nicht mehr). Es bleiben nur der Rahmen und der Papierkorb.
  function bkStartPoppen() {
    bkEmbed();
    tplPurgeTrash();
    for (const k of ['bk_out', 'bk_in', 'bk_out_acked', 'bk_full_sent', 'bk_test', 'bk_test_at']) { try { G.del(k); } catch {} }
  }

  // =====================================================================================
  // „Blockierende Popsters“ – eigene, nicht änderbare Ansicht unter /setting/privacy/home
  //  Quelle: evil_ids / evil_names (Tampermonkey-Speicher) + Profilgedächtnis.
  //  Aufruf über einen Anker (…/setting/privacy/home#blockierer), damit nie eine 404-Seite entsteht.
  // =====================================================================================
  const BLK_HASH = 'blockierer';
  const PRIVACY_HOME = '/setting/privacy/home';

  // Menüeintrag „Blockierende Popsters“ vor „Wer kann was sehen“ einhängen
  function privacyHomeLink() {
    const vis = document.querySelector(`a[href="${PRIVACY_HOME.replace('/home', '/visible')}"]`);
    const li = vis && vis.closest('li');
    if (!li || document.getElementById('vaf-blk-link')) return;
    const mine = li.cloneNode(true);
    mine.id = 'vaf-blk-link';
    const a = mine.querySelector('a') || mine;
    a.setAttribute('href', PRIVACY_HOME + '#' + BLK_HASH);
    const t = mine.querySelector('.ant-list-item-meta-title'); if (t) t.textContent = 'Blockierende Popsters';
    const d = mine.querySelector('.ant-list-item-meta-description'); if (d) d.textContent = 'Popsters, die mich ignorieren';
    a.addEventListener('click', (e) => { e.preventDefault(); if (location.hash !== '#' + BLK_HASH) location.hash = BLK_HASH; else blkShow(); });
    li.before(mine);
  }

  // eigener Bereich im Hauptinhalt (unabhängig von der Opa-Schutz-Ansicht)
  let blkView = null;
  function blkMain() { return document.querySelector('main.ant-layout-content') || document.querySelector('main'); }
  function blkShow() {
    const main = blkMain();
    if (!main) return;
    if (blkView && blkView.isConnected) return;
    for (const c of main.children) if (!c.dataset.vafOwn && !c.dataset.vafBlk) { c.dataset.vafBlkHidden = '1'; c.style.display = 'none'; }
    const el = document.createElement('div');
    el.dataset.vafBlk = '1';
    main.appendChild(el);
    blkView = el;
    fillBlockers(el).catch((e) => warn('Blockierende Popsters', e));
  }
  function blkHide() {
    if (blkView) blkView.remove();
    blkView = null;
    for (const c of document.querySelectorAll('[data-vaf-blk-hidden]')) { c.style.display = ''; delete c.dataset.vafBlkHidden; }
  }

  const blkMeta = (m) => {
    if (!m) return '';
    const parts = [];
    const g = (m.g || []).map((c) => TYPE_NAMES[c] || c).filter(Boolean).join(' & ');
    if (g) parts.push(g);
    const ages = (m.ages || []).filter((a) => a > 0);
    if (ages.length) parts.push(ages.join('/') + ' Jahre');
    if (m.city) parts.push(m.city);
    return parts.join(' · ');
  };
  const blkInitial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();

  async function fillBlockers(el) {
    const ids = (G.get('evil_ids', []) || []).map(String);
    const names = G.get('evil_names', {});
    const rows = [];
    for (const uid of ids) {
      const m = Members.cached().get(uid) || await Members.get(uid).catch(() => null);
      rows.push({ uid, nick: (m && m.nick) || names[uid] || '', m: m || null });
    }
    rows.sort((a, b) => (a.nick || a.uid).localeCompare(b.nick || b.uid, 'de', { sensitivity: 'base' }));
    // Platzhalter ohne Nickname: im Hintergrund über die ID auflösen, danach neu zeichnen
    const missing = rows.filter((r) => !r.nick).map((r) => r.uid);
    if (missing.length && !fillBlockers.busy) {
      fillBlockers.busy = true;
      (async () => { let n = 0; for (const uid of missing.slice(0, 60)) { const r = await Resolver.resolve(uid).catch(() => null); if (r && r.nick) n++; } return n; })()
        .then((n) => { if (n) { syncEvilNames().catch(() => {}); if (el.isConnected) fillBlockers(el); } })
        .finally(() => { fillBlockers.busy = false; });
    }
    const at = G.get('evil_at', 0);
    const head = `<div class="vaf-blk-head"><h2>Blockierende Popsters</h2>
      <div class="vaf-blk-sub">Popsters, die mich ignorieren.${at ? ` Zuletzt aktualisiert: ${esc(deDateTime(at))}.` : ''}</div></div>`;
    if (!rows.length) { el.innerHTML = head + `<div class="vaf-blk-empty">Zurzeit blockiert dich niemand – oder die Liste wurde noch nicht eingelesen.</div>`; return; }
    const items = rows.map((r) => {
      const nick = r.nick;
      const name = nick || idresLabel(r.uid);
      const avatar = r.m && r.m.avatar && !isPlaceholderAvatar(r.m.avatar) ? r.m.avatar : '';
      const pic = avatar
        ? `<img class="vaf-blk-ava" src="${esc(avatar)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'vaf-blk-ava vaf-blk-ph',textContent:'${esc(blkInitial(name))}'}))">`
        : `<div class="vaf-blk-ava vaf-blk-ph">${esc(blkInitial(name))}</div>`;
      const meta = r.m ? blkMeta(r.m) : (idresGone(r.uid) ? 'vermutlich von poppen gesperrt' : `ID ${r.uid}`);
      const title = nick
        ? `<a class="vaf-blk-name" href="${esc(pathOfName(nick))}">${esc(name)}</a>`
        : `<span class="vaf-blk-name">${esc(name)}</span>`;
      return `<li class="vaf-blk-item">${pic}<div class="vaf-blk-txt">${title}<span class="vaf-blk-meta">${esc(meta + pstateNote(r.m))}</span></div></li>`;
    }).join('');
    el.innerHTML = head + `<ul class="vaf-blk-list">${items}</ul>`;
  }

  function privacyBlockersUi() {
    if (location.pathname !== PRIVACY_HOME) { if (blkView) blkHide(); return; }
    privacyHomeLink();
    if (location.hash.replace('#', '') === BLK_HASH) blkShow();
    else if (blkView) blkHide();
  }

  // =====================================================================================
  // „Meine Freunde“ – Abschnitt auf /my/profile (über „Popsters in der Nähe“) und Menüeintrag „Entdecken“
  //  Die Freundesliste von poppen.de ist gut versteckt; Quelle ist friends/list.
  // =====================================================================================
  const FRIENDS_URL = '/friends/1';
  const FRIENDS_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 24 24"><path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m0 2c-3 0-7 1.5-7 4.5V20h14v-2.5c0-3-4-4.5-7-4.5m8.5-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6m0 2c-.6 0-1.2.07-1.74.2 1.3.9 2.24 2.1 2.24 3.8V20h6v-2.5c0-2.6-3.3-3.5-6.5-3.5"/></svg>';

  // oberste Section (Container) zu einer Überschrift im Hauptbereich finden
  function sectionOf(h) {
    const main = document.querySelector('main');
    let s = h;
    while (s.parentElement && s.parentElement !== main && !s.parentElement.matches('.Hg9Kid, main')) s = s.parentElement;
    return s;
  }

  async function friendsProfileSection() {
    if (location.pathname !== '/my/profile') return;
    if (document.getElementById('vaf-friends-sec')) return;
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /Popsters in der N/i.test(h.textContent));
    if (!h2) return;
    const near = sectionOf(h2);
    const anchor0 = near.querySelector('a[href^="/p/"]');
    if (!anchor0) return;                      // Raster-Vorlage noch nicht da
    const itemTpl = anchor0.parentElement;     // .xJwT0p
    const container = itemTpl.parentElement;   // .VBQs6B

    let friends = [];
    try { const d = await apiPost('friends/list', { sort: 'online', page: 1 }); friends = ((d && d.users) || []).map(normUser).filter(Boolean).slice(0, 8); }
    catch (e) { warn('Freunde', e); return; }

    const sec = near.cloneNode(true);
    sec.id = 'vaf-friends-sec';
    const secH2 = sec.querySelector('h2');
    if (secH2) secH2.innerHTML = `<a href="${FRIENDS_URL}" class="df-link-inherit" style="color:inherit">Meine Freunde</a>`;
    const secAnchor0 = sec.querySelector('a[href^="/p/"]');
    const secItemTpl = secAnchor0.parentElement;
    const secContainer = secItemTpl.parentElement;
    const blank = secItemTpl.cloneNode(true);
    secContainer.innerHTML = '';
    if (!friends.length) {
      const note = document.createElement('div');
      note.style.cssText = 'color:#a6a6a6;padding:4px 0';
      note.textContent = 'Noch keine Freunde.';
      secContainer.appendChild(note);
    }
    for (const u of friends) {
      const it = blank.cloneNode(true);
      const a = it.querySelector('a'); const img = it.querySelector('img');
      if (a) a.setAttribute('href', pathOfName(u.nick));
      if (img) { img.setAttribute('src', u.avatar || ''); img.setAttribute('alt', u.nick || ''); }
      secContainer.appendChild(it);
    }
    near.before(sec);
  }

  // Link „Freunde“ vor „Sparks“ in jedem Menü (Entdecken-Dropdown, Nav, mobil), auf jeder Seite.
  function discoverMenuLink() {
    const here = location.pathname;
    const onFriends = here.startsWith('/friends');
    const sparksList = [];
    for (const el of document.querySelectorAll('a')) {
      const lab = el.querySelector('[data-type="label"]');
      if (lab && norm(lab.textContent) === 'sparks') sparksList.push(el);
    }
    for (const sparks of sparksList) {
      const parent = sparks.parentElement; if (!parent) continue;
      // Stil-Referenz: ein inaktiver Nachbar-Link (href ≠ aktuelle Seite). Dessen Klassen
      // übertragen wir, um jedes gehashte Aktiv-Highlight zu neutralisieren (poppen benennt
      // den Aktiv-Zustand mit zufälligen Klassennamen, daher reicht Namens-Matching nicht).
      const ref = [...parent.querySelectorAll('a')].find((el) => el !== sparks && el.querySelector('[data-type="label"]') && (el.getAttribute('href') || '') !== here) || null;
      const neutralize = (a) => {
        if (onFriends) return;                               // auf der echten Freunde-Seite darf es aktiv sein
        if (ref) {
          a.className = ref.className;
          for (const sel of ['[data-type="label"]', '[data-type="icon"]']) { const r = ref.querySelector(sel), x = a.querySelector(sel); if (r && x) x.className = r.className; }
        }
        for (const n of [a, ...a.querySelectorAll('*')]) {
          if (n.removeAttribute) { n.removeAttribute('aria-current'); n.removeAttribute('data-active'); }
          if (n.classList) for (const c of [...n.classList]) if (/active|selected|current/i.test(c)) n.classList.remove(c);
        }
        a.classList.add('vaf-discover-friends');
      };
      const prev = sparks.previousElementSibling;
      if (prev && prev.classList && prev.classList.contains('vaf-discover-friends')) { neutralize(prev); continue; }
      const a = sparks.cloneNode(true);
      a.removeAttribute('id');
      a.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
      a.setAttribute('href', FRIENDS_URL);
      const lab = a.querySelector('[data-type="label"]'); if (lab) lab.textContent = 'Freunde';
      const ic = a.querySelector('[data-type="icon"]'); if (ic) ic.innerHTML = FRIENDS_ICON;
      const badge = a.querySelector('[data-type="badge"]'); if (badge) badge.remove();
      neutralize(a);
      sparks.before(a);
    }
  }

  function friendsUi() {
    try { discoverMenuLink(); } catch (e) { warn('Entdecken-Menü', e); }
    friendsProfileSection().catch((e) => warn('Meine Freunde', e));
  }

  // =====================================================================================
  // Gruppenanfrage-Regeln je Gruppe (Regel-Baukasten)
  //  Datenmodell:  grRules = { [cms]: { [gender]: { accept: <baum>, reject: <baum> } } }
  //  Baum:  { op:'and'|'or', kids:[baum|blatt] }   Blatt: { field, op, value }
  //  Ausgewertet wird gegen user_trait (aus user/info) + abgeleitete Werte (verifiziert, Fotos).
  // =====================================================================================
  const GR_GENDERS = [['m', 'Mann'], ['w', 'Frau'], ['p', 'Paar'], ['ts', 'Trans'], ['tv', 'Nicht-binär']];
  const grGenderName = (g) => (GR_GENDERS.find((x) => x[0] === g) || [, g])[1];

  const SEARCHING_VALS = [['1', 'One night stand'], ['2', 'Freundschaft'], ['3', 'Partnertausch'], ['4', 'Fototausch'], ['5', 'Freundschaft +'], ['6', 'Partnerschaft'], ['7', 'Affäre'], ['8', 'Clubbesuche'], ['9', 'Cybersex'], ['10', 'Dom/Sub']];
  // Reihenfolge der Herkunfts-Blöcke im Feld-Dropdown (optgroup-Trenner, nicht anklickbar).
  const GR_GROUP_ORDER = ['Über mich', 'Steht auf', 'Sucht nach', 'Status & Listen'];

  // Feldkatalog. sex: Feld gilt nur für diese Person im Paar (m=Mann, w=Frau). type: num|enum|country|lang|bool.
  // group: Herkunfts-Block. Innerhalb eines Blocks wird im Dropdown alphabetisch sortiert.
  const GR_FIELDS = [
    { key: 'age', label: 'Alter', type: 'num', trait: 'age', min: 18, max: 99, group: 'Über mich' },
    { key: 'size', label: 'Größe', type: 'num', trait: 'size', min: 130, max: 220, unit: 'cm', group: 'Über mich' },
    { key: 'weight', label: 'Gewicht', type: 'num', trait: 'weight', min: 0, max: 300, unit: 'kg', group: 'Über mich' },
    { key: 'dick_length', label: 'Penislänge', type: 'num', trait: 'dick_length', min: 0, max: 40, unit: 'cm', sex: 'm', group: 'Über mich' },
    { key: 'dick_width', label: 'Penisdicke', type: 'num', trait: 'dick_width', min: 0, max: 20, unit: 'cm', sex: 'm', group: 'Über mich' },
    { key: 'ethnicity', label: 'Ethnische Zugehörigkeit', type: 'enum', trait: 'ethnicity', group: 'Über mich' },
    { key: 'figure_name', label: 'Figur', type: 'enum', trait: 'figure_name', group: 'Über mich' },
    { key: 'sex_type', label: 'Sexualität', type: 'enum', trait: 'sex_type', group: 'Über mich' },
    { key: 'hair', label: 'Haarfarbe', type: 'enum', trait: 'hair', group: 'Über mich' },
    { key: 'hair_length', label: 'Haarlänge', type: 'enum', trait: 'hair_length', group: 'Über mich' },
    { key: 'eyes_name', label: 'Augenfarbe', type: 'enum', trait: 'eyes_name', group: 'Über mich' },
    { key: 'beard', label: 'Bart', type: 'enum', trait: 'beard', sex: 'm', group: 'Über mich' },
    { key: 'body_hair', label: 'Körperbehaarung', type: 'enum', trait: 'body_hair', group: 'Über mich' },
    { key: 'intimately_hair', label: 'Intimbehaarung', type: 'enum', trait: 'intimately_hair', group: 'Über mich' },
    { key: 'tits', label: 'Körbchengröße', type: 'enum', trait: 'tits', sex: 'w', group: 'Über mich' },
    { key: 'circumcised', label: 'Beschnitten', type: 'enum', trait: 'circumcised', sex: 'm', group: 'Über mich' },
    { key: 'glass', label: 'Brille', type: 'enum', trait: 'glass', group: 'Über mich' },
    { key: 'smoker', label: 'Raucher', type: 'enum', trait: 'smoker', group: 'Über mich' },
    { key: 'tattoo', label: 'Tätowierungen', type: 'enum', trait: 'tattoo', group: 'Über mich' },
    { key: 'piercing', label: 'Piercings', type: 'enum', trait: 'piercing', group: 'Über mich' },
    { key: 'zodiac', label: 'Sternzeichen', type: 'enum', trait: 'zodiac', group: 'Über mich' },
    { key: 'origin', label: 'Herkunft', type: 'country', trait: 'origin', group: 'Über mich' },
    { key: 'spoken_language', label: 'Sprachen', type: 'lang', trait: 'spoken_language', group: 'Über mich' },
    // „Steht auf" – aboutMe.interested (Geschlechter, auf die der Kandidat steht)
    { key: 'interested', label: 'Steht auf', type: 'enum', ctxKey: 'interested', group: 'Steht auf', vals: [['m', 'Männer'], ['w', 'Frauen'], ['p', 'Paare'], ['ts', 'Trans'], ['tv', 'Nicht-binär']] },
    // „Sucht nach" – aboutMe.lookingFor (Suchinteressen)
    { key: 'lookingfor', label: 'Sucht nach', type: 'enum', ctxKey: 'lookingForCodes', group: 'Sucht nach', vals: SEARCHING_VALS },
    // Status / eigene Listen – alle auf den Kandidaten bezogen
    { key: 'verified', label: 'Verifiziert', type: 'bool', derived: 'verified', group: 'Status & Listen' },
    { key: 'hasphoto', label: 'Hat Fotos', type: 'bool', derived: 'hasphoto', group: 'Status & Listen' },
    { key: 'photos', label: 'Fotos (Anzahl)', type: 'num', derived: 'photos', min: 0, max: 50, group: 'Status & Listen' },
    { key: 'relationship', label: 'Beziehungsstatus', type: 'enum', ctxKey: 'relCats', relDyn: true, group: 'Status & Listen' },
    { key: 'single', label: 'Single', type: 'bool', derived: 'single', group: 'Status & Listen' },
    { key: 'fickliste', label: 'Fickliste-Status', type: 'enum', ctxKey: 'fickArr', group: 'Status & Listen', vals: [['1', 'Will ich'], ['2', 'Gefickt'], ['3', 'Nein, danke!'], ['4', 'Nie wieder!']] },
    { key: 'ignoriert', label: 'Von mir ignoriert', type: 'bool', derived: 'ign', group: 'Status & Listen' },
    { key: 'ignoriert_mich', label: 'Ignoriert mich', type: 'bool', derived: 'ignByHim', group: 'Status & Listen' },
    { key: 'whitelist', label: 'Auf meiner Whitelist', type: 'bool', derived: 'white', group: 'Status & Listen' },
    { key: 'anschreibbar', label: 'Anschreibbar', type: 'bool', derived: 'msgok', group: 'Status & Listen' },
  ];
  // Feld-Dropdown nach Herkunfts-Blöcken, innerhalb alphabetisch, mit optgroup-Trennern.
  function grFieldOptionsHtml(fields, selected) {
    const byG = {};
    for (const f of fields) { const g = f.group || 'Weitere'; (byG[g] = byG[g] || []).push(f); }
    const order = [...GR_GROUP_ORDER.filter((g) => byG[g]), ...Object.keys(byG).filter((g) => !GR_GROUP_ORDER.includes(g))];
    return order.map((g) => {
      const opts = byG[g].slice().sort((a, b) => a.label.localeCompare(b.label, 'de'))
        .map((f) => `<option value="${f.key}"${f.key === selected ? ' selected' : ''}>${esc(f.label)}</option>`).join('');
      return `<optgroup label="${esc(g)}">${opts}</optgroup>`;
    }).join('');
  }
  const grField = (k) => GR_FIELDS.find((f) => f.key === k);
  // in einem Block für Geschlecht g verfügbare Felder
  function grFieldsFor(g) {
    const has = (sex) => !sex || g === 'p' || g === sex || (g !== 'm' && g !== 'w');   // ts/tv: alles anbieten
    return GR_FIELDS.filter((f) => has(f.sex));
  }
  // Operatoren je Feldtyp. „keine Angabe“ (none) braucht keinen Wert.
  //  Verneinte Operatoren („ist nicht“, „enthält keine von“, „enthält nicht“, „ist ungleich“, „hat Angabe“) gibt es nicht
  //  mehr: das erledigt die Verknüpfung „… NICHT“ (sonst doppelte Verneinung). Alte Regeln werden beim Öffnen umgestellt.
  const GR_NA = [['none', 'keine Angabe']];
  const GR_OPS = {
    num: [['eq', 'ist gleich'], ['lt', 'ist kleiner als'], ['gt', 'ist größer als'], ['between', 'zwischen'], ...GR_NA],
    enum: [['is', 'ist'], ['isoneof', 'enthält eine von'], ...GR_NA],
    enumchip: [['is', 'ist'], ['isoneof', 'enthält eine von']],   // „keine Angabe“ als eigener Wert-Chip (Ethnische Zugehörigkeit)
    jn: [['is', 'ist'], ...GR_NA],                         // Ja/Nein-Felder: Negation = anderen Wert wählen
    country: [['is', 'ist'], ['isoneof', 'enthält eine von'], ...GR_NA],
    lang: [['contains', 'enthält'], ['only', 'nur'], ...GR_NA],
    bool: [['is', 'ist'], ['isnot', 'ist nicht']],
  };
  // Felder, bei denen „keine Angabe“ ein Chip neben den echten Werten ist (statt Operator)
  const GR_NONE_CHIP = '__none';
  const GR_CHIP_NA = new Set(['ethnicity']);
  const GR_JN = new Set(['glass', 'smoker', 'tattoo', 'piercing', 'handicap', 'circumcised']);
  const grOpType = (f) => (f.derived === 'photos' ? 'num' : GR_JN.has(f.key) ? 'jn' : GR_CHIP_NA.has(f.key) ? 'enumchip' : f.type);
  const grOpsFor = (f) => GR_OPS[grOpType(f)] || [];
  const grOpName = (type, op) => ((GR_OPS[type] || []).find((x) => x[0] === op) || [, op])[1];
  const grNoValue = (op) => op === 'none' || op === 'some';
  // Mehrfachauswahl je Operator
  const grIsMulti = (f, op) => (grOpType(f) === 'lang' ? (op === 'contains' || op === 'notcontains') : (op === 'isoneof' || op === 'noneof'));

  const grRules = () => G.get('grRules', {});
  const grSetRules = (r) => { G.set('grRules', r); Bus.emit('grRules', r); };
  const grBlock = (cms, g, rules) => (((rules || grRules())[cms] || {})[g]) || null;
  const grHasRules = (t) => !!(t && ((t.kids && t.kids.length) || t.field));

  // ---------- Wertelisten (Codes → Klartext) über i18n ----------
  const GR_OPTS_CACHE = {};
  async function grOptions(field) {
    if (field.type === 'bool') return [[true, 'Ja'], [false, 'Nein']];
    if (field.type === 'num') return null;
    if (field.vals) return field.vals;   // statische Liste (z. B. Fickliste-Status)
    if (field.relDyn) {                   // Beziehungsstatus-Kategorien aus user/list/relationship
      if (GR_OPTS_CACHE.rel) return GR_OPTS_CACHE.rel;
      try { const d = await apiPost('user/list/relationship', null); const list = ((d && d.category) || []).map((c) => [String(c.title), c.title]).filter((x) => x[0]); if (list.length) return (GR_OPTS_CACHE.rel = list); } catch {}
      return null;
    }
    if (field.type === 'lang') return Object.entries(LANG_DE).map(([c, n]) => [c, n]);
    if (field.type === 'country') {
      if (GR_OPTS_CACHE.country) return GR_OPTS_CACHE.country;
      try { const d = await apiGet('geo/country/all', { _version: 2 }); const list = ((d && (d.list || d.countries || d)) || []).map((c) => [String(c.iso || c.code || c.country_iso || c.id), c.name || c.country_name || c.iso]).filter((x) => x[0]); if (list.length) return (GR_OPTS_CACHE.country = list); } catch {}
      return [['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz']];
    }
    // Enum: deutsche Labels zur Laufzeit aus poppens i18n (gecacht), Basis sind TRAIT_I18N/SEED/GM.
    await ensureTraitI18n().catch(() => {});
    const seeded = grSeededList(field.trait);
    if (seeded.length) return GR_CHIP_NA.has(field.key) ? [...seeded, [GR_NONE_CHIP, 'keine Angabe']] : seeded;
    return null;   // kein bekannter Wertebereich → Freitextfeld
  }
  async function grValueName(field, code) {
    const opts = await grOptions(field).catch(() => null);
    if (!opts) return String(code);
    const hit = opts.find((o) => String(o[0]) === String(code));
    return hit ? hit[1] : String(code);
  }

  // ---------- Auswertung ----------
  const genderCode = (g) => { const a = Array.isArray(g) ? g.filter(Boolean) : [g]; if (a.length >= 2) return 'p'; return a[0] || ''; };
  function grTraitVals(field, trait) {
    let v = trait ? trait[field.trait] : null;
    if (v == null) return [];
    if (!Array.isArray(v)) v = [v];
    return v.filter((x) => x !== null && x !== undefined && x !== '');
  }
  function numMatch(op, value, nums) {
    const v = Array.isArray(value) ? value.map(Number) : [Number(value)];
    return nums.some((n) => {
      n = Number(n); if (!isFinite(n)) return false;
      switch (op) { case 'eq': return n === v[0]; case 'ne': return n !== v[0]; case 'lt': return n < v[0]; case 'gt': return n > v[0]; case 'between': return n >= Math.min(v[0], v[1]) && n <= Math.max(v[0], v[1]); }
      return false;
    });
  }
  function enumMatch(op, value, codes) {
    const want = (Array.isArray(value) ? value : [value]).map(String);
    const has = codes.map(String);
    if (op === 'is') return has.includes(want[0]);
    if (op === 'isnot') return has.length ? !has.includes(want[0]) : false;
    if (op === 'isoneof') return has.some((c) => want.includes(c));
    if (op === 'noneof') return !has.some((c) => want.includes(c));
    return false;
  }
  function langMatch(op, value, personsLangs) {
    const want = (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
    return personsLangs.some((langs) => {
      const have = (langs || []).map(String);
      if (op === 'contains') return want.every((w) => have.includes(w));
      if (op === 'only') return have.length > 0 && have.every((h) => want.includes(h));   // Einfachauswahl: spricht nur diese eine
      if (op === 'notcontains') return !want.some((w) => have.includes(w));               // spricht keine der gewählten
      return false;
    });
  }
  // Hat der Kandidat für dieses Feld einen echten Wert? (Grundlage für „keine Angabe“/„hat Angabe“)
  //  Leer = Feld fehlt/null oder trägt nur den echten Leer-Code (0 bzw. Feld-Sentinel). Der Such-Wert „egal“ zählt nie als Angabe.
  function grHasValue(f, ctx) {
    if (f.type === 'lang') return ((ctx.trait && ctx.trait.spoken_language) || []).some((a) => (a || []).filter(Boolean).length > 0);
    if (f.derived === 'photos') return (ctx.photos || []).length > 0;
    const vals = (f.ctxKey ? (ctx[f.ctxKey] || []) : grTraitVals(f, ctx.trait)).map((v) => String(v)).filter((s) => s !== '' && s !== 'null' && s !== 'undefined');
    if (GR_JN.has(f.key)) return vals.some((s) => s === '0' || s === '1');           // nur echte Ja/Nein-Antwort
    if (f.type === 'num') return vals.some((s) => Number(s) > 0);
    const skip = new Set(['0', ...((GR_SENTINEL && GR_SENTINEL[f.trait]) || [])]);
    return vals.some((s) => !skip.has(s));
  }
  function grLeaf(leaf, ctx) {
    const f = grField(leaf.field); if (!f) return false;
    if (grNoValue(leaf.op)) { const h = grHasValue(f, ctx); return leaf.op === 'some' ? h : !h; }
    if (f.type === 'bool') {
      const d = f.derived;
      const actual = d === 'verified' ? !!ctx.verified
        : d === 'hasphoto' ? (ctx.hasphoto != null ? !!ctx.hasphoto : (ctx.photos || []).length > 0)
        : !!ctx[d];   // single, ign, ignByHim, white
      const want = leaf.value === true || leaf.value === 'true' || leaf.value === 1 || leaf.value === '1';
      return leaf.op === 'isnot' ? actual !== want : actual === want;
    }
    if (f.derived === 'photos') return numMatch(leaf.op, leaf.value, [(ctx.photos || []).length]);
    if (f.type === 'num') return numMatch(leaf.op, leaf.value, grTraitVals(f, ctx.trait).map(Number));
    if (f.type === 'lang') return langMatch(leaf.op, leaf.value, (ctx.trait && ctx.trait.spoken_language) || []);
    // Beziehungsstatus: toleranter Textvergleich (Kategorie-Namen weichen leicht ab)
    if (f.key === 'relationship') {
      const have = (ctx.relCats || []).map((x) => norm(String(x)));
      const want = (Array.isArray(leaf.value) ? leaf.value : [leaf.value]).map((x) => norm(String(x))).filter(Boolean);
      const hit = want.some((w) => have.some((h) => h.includes(w) || w.includes(h)));
      if (leaf.op === 'noneof') return !hit;
      return leaf.op === 'isnot' ? (have.length ? !hit : false) : hit;
    }
    const vals = Array.isArray(leaf.value) ? leaf.value.map(String) : [String(leaf.value)];
    if (vals.includes(GR_NONE_CHIP)) {                     // Chip „keine Angabe“ (ODER mit den übrigen gewählten Werten)
      if (!grHasValue(f, ctx)) return true;
      const rest = vals.filter((v) => v !== GR_NONE_CHIP);
      if (!rest.length) return false;
      return enumMatch(leaf.op === 'is' ? 'isoneof' : leaf.op, rest, f.ctxKey ? (ctx[f.ctxKey] || []) : grTraitVals(f, ctx.trait));
    }
    if (f.ctxKey) return enumMatch(leaf.op, leaf.value, ctx[f.ctxKey] || []);
    return enumMatch(leaf.op, leaf.value, grTraitVals(f, ctx.trait));
  }
  // Gruppen-Knoten: { kids: [...], neg?, reason? }. Jedes Kind ab dem zweiten trägt seine eigene Verknüpfung
  //  davor (kid.conj = 'and' | 'or', kid.neg = NICHT). Es gilt UND vor ODER: eine Gruppe ist ein ODER ihrer
  //  UND-Strecken („Läufe“). Ältere Bäume (node.op für die ganze Ebene) werden weiter verstanden.
  const grIsGroup = (n) => !!(n && !n.field && Array.isArray(n.kids));
  const grConjOf = (node, i) => (i === 0 ? '' : (node.kids[i] && node.kids[i].conj) || (node.op === 'or' ? 'or' : 'and'));
  function grRuns(node) {
    const runs = [];
    (node && node.kids || []).forEach((k, i) => { if (i === 0 || grConjOf(node, i) === 'or') runs.push([i]); else runs[runs.length - 1].push(i); });
    return runs;
  }
  // Kind auswerten, ggf. negiert („UND NICHT“ / „ODER NICHT“ bzw. NICHT am ersten Operanden)
  const grEvalKid = (k, ctx) => { const r = grEval(k, ctx); return k && k.neg ? !r : r; };
  function grEval(node, ctx) {
    if (!node) return false;
    if (node.field) return grLeaf(node, ctx);
    const kids = node.kids || [];
    return grRuns(node).some((run) => run.every((i) => grEvalKid(kids[i], ctx)));
  }
  // Hauptgruppen eines Baums = ODER-Abschnitte der obersten Ebene. Die Begründung steht am ersten Glied des Abschnitts.
  function grMainGroups(tree) {
    if (!tree) return [];
    if (tree.field) return [tree];
    const kids = tree.kids || [];
    const runs = grRuns(tree);
    return runs.map((run) => ({ kids: run.map((i, j) => (j === 0 ? { ...kids[i], conj: undefined } : kids[i])), reason: (kids[run[0]] && kids[run[0]].reason) || (runs.length === 1 ? tree.reason || '' : '') }));
  }
  // Entscheidung für einen Bewerber (ctx: { trait, verified, photos }). Liefert verdict + Begründung der treffenden Hauptgruppe.
  function grDecide(cms, ctx, rules) {
    const g = genderCode(ctx.trait && ctx.trait.gender);
    const block = grBlock(cms, g, rules);
    if (!block) return { verdict: 'manual', reason: '', note: `keine Regel für ${grGenderName(g) || 'dieses Geschlecht'}` };
    if (grHasRules(block.reject)) for (const mg of grMainGroups(block.reject)) if (grHasRules(mg) && grEvalKid(mg, ctx)) return { verdict: 'reject', reason: (mg.reason || '').trim() };
    if (grHasRules(block.accept)) for (const mg of grMainGroups(block.accept)) if (grHasRules(mg) && grEvalKid(mg, ctx)) return { verdict: 'accept', reason: (mg.reason || '').trim() };
    return { verdict: 'manual', reason: '' };
  }
  // ---------- Entscheidungs-Notiz (Punkt 17) ----------
  //  Format:  Angenommen|Abgelehnt in "<Gruppe>" [wegen <Begründung>] am TT.MM.JJJJ
  //  Vorhandene Ignorier-/Whitelist-Notiz bleibt per " / " erhalten; ein altes Entscheidungs-Segment wird ersetzt.
  const GR_DECISION_RE = /^(Angenommen|Abgelehnt) in "[^"]*"(?: wegen .+?)? am \d{1,2}\.\d{1,2}\.\d{4}$/;
  function grDecisionNoteText(cms, verdict, reason, existingNote) {
    const gname = (G.get('groupnames', {}) || {})[cms] || ('Gruppe ' + cms);
    let note = `${verdict === 'accept' ? 'Angenommen' : 'Abgelehnt'} in "${gname}"`;
    if (reason) note += ` wegen ${reason}`;
    note += ` am ${deDate(new Date())}`;
    const keep = String(existingNote || '').split(' / ').map((s) => s.trim()).filter((s) => s && !GR_DECISION_RE.test(s));
    return [note, ...keep].join(' / ');
  }
  async function grWriteDecisionNote(cms, nick, verdict, reason, existingNote) {
    if (!cms || !nick || (verdict !== 'accept' && verdict !== 'reject') || (typeof dry === 'function' && dry())) return;
    try { await apiPost('group/attendee/note', { cms_id: cms, nickname: nick, note: grDecisionNoteText(cms, verdict, reason, existingNote) }, { _version: 2 }); }
    catch (e) { warn('Gruppennotiz', nick, e); }
  }

  // welche Felder kommen in den Regeln eines Geschlechts vor (für die Zusatzzeile)
  function grUsedFields(cms, g, rules) {
    const block = grBlock(cms, g, rules); if (!block) return [];
    const out = new Set();
    const walk = (n) => { if (!n) return; if (n.field) out.add(n.field); (n.kids || []).forEach(walk); };
    walk(block.accept); walk(block.reject);
    return [...out];
  }

  // ---------- Konfliktprüfung (DNF + Feld-Machbarkeit) ----------
  function grDNF(node) {
    if (!node) return [[]];
    if (node.field) return [[node]];
    const kids = node.kids || [];
    let out = [];
    for (const run of grRuns(node)) {
      let acc = [[]];
      for (const i of run) { const k = kids[i]; const d = k && k.neg ? [[]] : grDNF(k); const nx = []; for (const a of acc) for (const b of d) nx.push(a.concat(b)); acc = nx; }
      out = out.concat(acc);
    }
    return out.length ? out : [[]];
  }
  // Machbarkeit einer Konjunktion je Feld; gibt pro Feld ein Beispiel-Wert zurück oder null (unmöglich)
  function grFeasible(leaves, optsByField) {
    leaves = leaves.filter((l) => !grNoValue(l.op) && l.op !== 'notcontains');
    const byField = {};
    for (const l of leaves) (byField[l.field] = byField[l.field] || []).push(l);
    const example = {};
    for (const [fk, ls] of Object.entries(byField)) {
      const f = grField(fk); if (!f) continue;
      if (f.type === 'num' || f.derived === 'photos') {
        let lo = f.min != null ? f.min : -1e9, hi = f.max != null ? f.max : 1e9; const ne = new Set();
        for (const l of ls) { const v = Array.isArray(l.value) ? l.value.map(Number) : [Number(l.value)];
          if (l.op === 'eq') { lo = Math.max(lo, v[0]); hi = Math.min(hi, v[0]); }
          else if (l.op === 'lt') hi = Math.min(hi, v[0] - 1);
          else if (l.op === 'gt') lo = Math.max(lo, v[0] + 1);
          else if (l.op === 'between') { lo = Math.max(lo, Math.min(v[0], v[1])); hi = Math.min(hi, Math.max(v[0], v[1])); }
          else if (l.op === 'ne') ne.add(v[0]); }
        let pick = null; for (let x = lo; x <= hi; x++) if (!ne.has(x)) { pick = x; break; }
        if (pick == null) return null; example[fk] = pick;
      } else if (f.type === 'bool') {
        let want = null;
        for (const l of ls) { const w = l.value === true || l.value === 'true' || l.value === 1 || l.value === '1'; const eff = l.op === 'isnot' ? !w : w; if (want === null) want = eff; else if (want !== eff) return null; }
        example[fk] = want;
      } else if (f.type === 'lang') {
        // vereinfachte Prüfung: contains fügt hinzu, only beschränkt
        let must = new Set(), restrict = null;
        for (const l of ls) { const vs = (Array.isArray(l.value) ? l.value : [l.value]).map(String);
          if (l.op === 'contains') vs.forEach((v) => must.add(v));
          else { const s = new Set(vs); restrict = restrict ? new Set([...restrict].filter((x) => s.has(x))) : s; } }
        if (restrict) { for (const m of must) if (!restrict.has(m)) return null; if (![...(must.size ? must : restrict)].length) return null; }
        example[fk] = [...(must.size ? must : (restrict || new Set()))];
      } else {
        // enum/country: Universe = bekannte Optionen ∪ genannte Werte
        const uni = new Set((optsByField[fk] || []).map(String));
        for (const l of ls) (Array.isArray(l.value) ? l.value : [l.value]).forEach((v) => uni.add(String(v)));
        let allowed = new Set(uni);
        for (const l of ls) { const vs = (Array.isArray(l.value) ? l.value : [l.value]).map(String);
          if (l.op === 'is') allowed = new Set([...allowed].filter((c) => c === vs[0]));
          else if (l.op === 'isoneof') allowed = new Set([...allowed].filter((c) => vs.includes(c)));
          else if (l.op === 'isnot') allowed = new Set([...allowed].filter((c) => c !== vs[0]));
          else if (l.op === 'noneof') allowed = new Set([...allowed].filter((c) => !vs.includes(c))); }
        if (!allowed.size) return null; example[fk] = [...allowed][0];
      }
    }
    return example;
  }
  // Prüft, ob accept und reject gleichzeitig erfüllbar sind. Gibt Konfliktinfo oder null zurück.
  function grConflict(block, optsByField) {
    if (!grHasRules(block.accept) || !grHasRules(block.reject)) return null;
    const A = grDNF(block.accept), R = grDNF(block.reject);
    for (const a of A) for (const r of R) {
      const ex = grFeasible(a.concat(r), optsByField || {});
      if (ex) {
        const fa = new Set(a.map((l) => l.field)), fr = new Set(r.map((l) => l.field));
        const overlap = [...fa].filter((x) => fr.has(x));
        return { example: ex, overlap, aLeaves: a, rLeaves: r };
      }
    }
    return null;
  }

  // =====================================================================================
  // Regel-Editor auf /groups/<cms>/requests  (Abschnitt „Nach Regeln akzeptierte Geschlechter“)
  // =====================================================================================
  const grReqCms = () => (/^\/groups\/(\d+)\/requests/.exec(location.pathname) || [])[1] || '';
  const grEditCms = () => (/^\/groups\/(\d+)\/edit/.exec(location.pathname) || [])[1] || '';
  // Oberste Ebene: neue Glieder per Default ODER-verknüpft (je Hauptgruppe eine Begründung); verschachtelt: UND.
  const newTree = () => ({ kids: [] });
  // Alte Bäume auf das neue Format bringen: Verknüpfung je Glied, keine verneinten Operatoren mehr,
  //  „keine Angabe“ der Ethnie als Chip. Logik bleibt gleich (bis auf Personen ganz ohne Angabe bei „ist nicht“).
  function grNormLeaf(l) {
    const f = grField(l.field); if (!f) return l;
    const flip = () => { l.neg = !l.neg; };
    if (l.op === 'some') { l.op = 'none'; l.value = ''; flip(); }
    if (l.op === 'ne') { l.op = 'eq'; flip(); }
    if (l.op === 'isnot' && f.type !== 'bool') { l.op = 'is'; flip(); }
    if (l.op === 'noneof') { l.op = 'isoneof'; flip(); }
    if (l.op === 'notcontains') { l.op = Array.isArray(l.value) && l.value.length > 1 ? 'isoneof_lang' : 'contains'; flip(); }
    if (l.op === 'isoneof_lang') { l.op = 'contains'; }   // mehrere Sprachen: „enthält“ verlangt alle – nächstbeste Entsprechung
    if (GR_CHIP_NA.has(f.key) && l.op === 'none') { l.op = 'is'; l.value = GR_NONE_CHIP; }
    return l;
  }
  function grNormTree(node, top = true) {
    if (!node) return newTree();
    if (node.field) return grNormLeaf(node);
    const kids = node.kids || [];
    kids.forEach((k, i) => {
      if (i > 0 && !k.conj) k.conj = node.op === 'or' ? 'or' : 'and';
      if (i === 0) delete k.conj;
      grNormTree(k, false);
    });
    // frühere gemeinsame Begründung einer UND-Hauptgruppe → ans erste Glied
    if (top && node.reason && kids[0] && !kids[0].reason && grRuns(node).length === 1) kids[0].reason = node.reason;
    if (top) delete node.reason;
    delete node.op;
    return node;
  }
  function grNormRules(r) {
    for (const g of Object.keys(r || {})) { const b = r[g]; if (!b) continue; b.accept = grNormTree(b.accept); b.reject = grNormTree(b.reject); }
    return r;
  }
  function grDefaultValue(f, op) {
    if (grNoValue(op)) return '';
    if (f.type === 'num' || f.derived === 'photos') return op === 'between' ? [f.min || 0, f.max || 0] : (f.min || 0);
    if (f.type === 'bool') return true;
    return grIsMulti(f, op) ? [] : '';
  }
  // Wert beim Operatorwechsel passend umformen (Einfach ↔ Mehrfach, Bereich, ohne Wert)
  function grCoerceValue(f, op, v) {
    if (grNoValue(op)) return '';
    if (f.type === 'num' || f.derived === 'photos') {
      const first = Array.isArray(v) ? v[0] : v;
      const n = first === '' || first == null ? (f.min || 0) : Number(first);
      return op === 'between' ? (Array.isArray(v) && v.length === 2 ? v : [n, f.max || 0]) : n;
    }
    if (f.type === 'bool') return typeof v === 'boolean' ? v : true;
    if (grIsMulti(f, op)) return Array.isArray(v) ? v : (v === '' || v == null ? [] : [v]);
    return Array.isArray(v) ? (v[0] != null ? v[0] : '') : (v == null ? '' : v);
  }
  const newLeaf = (g) => { const f = grFieldsFor(g)[0]; const op = grOpsFor(f)[0][0]; return { field: f.key, op, value: grDefaultValue(f, op) }; };

  // Buttons immer type=button: auf /groups/<id>/edit steckt der Editor in poppens Formular (sonst Submit!)
  function grEl(tag, cls, html) { const e = document.createElement(tag); if (tag === 'button') e.type = 'button'; if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  // Begründungs-Zeile (optional). Wird in die Gruppen-Notiz übernommen: … [wegen <Begründung>] …
  // Kein onChange beim Tippen (würde den Editor neu rendern und den Fokus verlieren) – node.reason wird direkt gesetzt.
  function grReasonRow(node) {
    const row = grEl('div', 'vaf-gr-reason');
    row.appendChild(grEl('span', 'vaf-gr-rlbl', 'Begründung'));
    const i = grEl('input', 'vaf-gr-rin'); i.type = 'text'; i.placeholder = 'optional, z. B. Weißbrot';
    i.value = node.reason || '';
    i.addEventListener('input', () => { node.reason = i.value; });
    row.appendChild(i);
    return row;
  }

  // Verknüpfung vor einem Operanden: UND / ODER / UND NICHT / ODER NICHT – gilt nur für dieses eine Glied
  //  (kid.conj), NICHT verneint das folgende Glied (kid.neg). UND bindet stärker als ODER.
  function grConjSel(node, kid, onChange, depth) {
    const conj = grEl('div', 'vaf-gr-conj' + (kid.neg ? ' neg' : ''));
    const sel = grEl('select', 'vaf-gr-op');
    sel.innerHTML = '<option value="and">UND</option><option value="or">ODER</option><option value="andnot">UND NICHT</option><option value="ornot">ODER NICHT</option>';
    const i = node.kids.indexOf(kid);
    sel.value = grConjOf(node, i) + (kid.neg ? 'not' : '');
    sel.addEventListener('change', () => {
      const v = sel.value; const c = v.startsWith('or') ? 'or' : 'and';
      // oberste Ebene: aus einem neuen ODER-Abschnitt wird eine eigene Hauptgruppe – Begründung des Abschnitts davor mitgeben
      if (depth === 0 && c === 'or' && grConjOf(node, i) !== 'or' && !kid.reason) {
        const runs = grRuns(node); const prev = runs.find((r) => r.includes(i));
        const r0 = node.kids[prev[0]]; if (r0 && r0.reason) kid.reason = r0.reason;
      }
      if (depth === 0 && c === 'and' && grConjOf(node, i) === 'or') delete kid.reason;   // verschmilzt mit dem Abschnitt davor
      kid.conj = c; kid.neg = v.endsWith('not'); onChange();
    });
    conj.appendChild(sel);
    return conj;
  }
  // NICHT-Schalter für den ersten Operanden einer Ebene (er hat keine Verknüpfung davor)
  function grNegChip(kid, onChange) {
    const b = grEl('button', 'vaf-gr-neg' + (kid.neg ? ' on' : ''), kid.neg ? 'NICHT' : 'nicht');
    b.type = 'button'; b.title = kid.neg ? 'Verneinung aufheben' : 'Diesen Ausdruck verneinen';
    b.addEventListener('click', () => { kid.neg = !kid.neg; onChange(); });
    return b;
  }

  // ---------- Verschiebe-Pfeile je Glied: ⇐ ⇑ ⇓ ⇒  ↑ ↓ ----------
  //  ↑/↓  Glied mit seiner Verknüpfung eine Stelle nach oben/unten
  //  ⇒    Bedingung in eine neue Gruppe nur mit ihr (Logik unverändert)
  //  ⇐    Glied aus seiner Gruppe heraus in die Eltern-Gruppe, direkt unter die bisherige Gruppe
  //  ⇑/⇓  Glied in die Gruppe direkt darüber/darunter (nur wenn dort eine Gruppe steht; nie von Gruppe zu Gruppe)
  function grMoveKid(parentOf, node, i, how) {
    const kids = node.kids; const kid = kids[i];
    const carryReason = (from, to) => { if (from && from.reason && to && !to.reason) { to.reason = from.reason; } if (from) delete from.reason; };
    if (how === 'up' || how === 'down') {
      const j = how === 'up' ? i - 1 : i + 1; if (j < 0 || j >= kids.length) return false;
      const a = Math.min(i, j), b = Math.max(i, j);
      if (a === 0) { const ca = kids[a].conj, cb = kids[b].conj; kids[a].conj = cb; kids[b].conj = ca; }
      [kids[i], kids[j]] = [kids[j], kids[i]];
      delete kids[0].conj; return true;
    }
    if (how === 'wrap') {
      if (!kid.field) return false;
      const ng = { kids: [kid] };
      if (kid.conj) { ng.conj = kid.conj; delete kid.conj; }
      carryReason(kid, ng);
      kids[i] = ng; return true;
    }
    if (how === 'into-up' || how === 'into-down') {
      const j = how === 'into-up' ? i - 1 : i + 1;
      const tg = kids[j]; if (!grIsGroup(tg)) return false;
      kids.splice(i, 1);
      if (how === 'into-up') {
        if (!tg.kids.length) delete kid.conj; else if (!kid.conj) kid.conj = 'and';
        tg.kids.push(kid);
      } else {
        // Gruppe übernimmt die Verknüpfung des Glieds nach vorn; das bisher erste Glied der Gruppe die der Gruppe
        const gConj = tg.conj, kConj = kid.conj;
        if (tg.kids[0]) tg.kids[0].conj = gConj || 'and';
        if (kConj) tg.conj = kConj; else delete tg.conj;
        delete kid.conj; carryReason(kid, tg);
        tg.kids.unshift(kid);
      }
      delete (node.kids[0] || {}).conj;
      return true;
    }
    if (how === 'out') {
      const par = parentOf.get(node); if (!par) return false;
      let conj = kid.conj || (kids[1] && kids[1].conj) || 'and';
      if (i === 0 && kids[1]) delete kids[1].conj;
      kids.splice(i, 1); delete kid.conj;
      const gi = par.kids.indexOf(node);
      kid.conj = conj;
      par.kids.splice(gi + 1, 0, kid);
      if (!node.kids.length) {                          // leere Gruppe entfällt, ihr Platz (und ihre Verknüpfung) geht an das Glied
        par.kids.splice(gi, 1);
        if (node.conj) kid.conj = node.conj; else delete kid.conj;
        carryReason(node, kid);
      }
      delete par.kids[0].conj;
      return true;
    }
    return false;
  }
  function grArrows(parentOf, node, i, depth, onChange) {
    const kids = node.kids; const kid = kids[i];
    const box = grEl('span', 'vaf-gr-arrows');
    const mk = (sym, how, ok, title) => {
      const b = grEl('b', ok ? '' : 'off', sym); b.title = title;
      if (ok) b.addEventListener('click', () => { if (grMoveKid(parentOf, node, i, how)) onChange(); });
      box.appendChild(b);
    };
    mk('⇐', 'out', depth > 0, 'aus der Gruppe heraus (unter die Gruppe)');
    mk('⇑', 'into-up', i > 0 && grIsGroup(kids[i - 1]), 'in die Gruppe darüber');
    mk('⇓', 'into-down', i < kids.length - 1 && grIsGroup(kids[i + 1]), 'in die Gruppe darunter');
    mk('⇒', 'wrap', !!kid.field, 'in eine neue Gruppe');
    box.appendChild(grEl('i', 'gap'));
    mk('↑', 'up', i > 0, 'nach oben');
    mk('↓', 'down', i < kids.length - 1, 'nach unten');
    return box;
  }

  // einen Baum (node) rekursiv rendern; onChange nach jeder Änderung; g = Geschlecht des Blocks.
  //  Kästen (oben/links/unten, rechts offen): je UND-Strecke einer Ebene ein Kasten, ein ODER beginnt einen neuen.
  //  Besteht eine Strecke nur aus einer Gruppe, zeichnet die Gruppe ihre Kästen selbst (kein Doppelkasten).
  //  Oberste Ebene: jede ODER-Strecke ist eine Hauptgruppe mit eigener Begründung (am ersten Glied gespeichert).
  function grRenderNode(node, g, onChange, depth, parentOf) {
    parentOf = parentOf || new Map();
    const wrap = grEl('div', 'vaf-gr-group' + (depth === 0 ? ' root' : ''));
    const kids = node.kids || (node.kids = []);
    grRuns(node).forEach((run, r) => {
      if (r > 0) wrap.appendChild(grConjSel(node, kids[run[0]], onChange, depth));
      const single = run.length === 1 && grIsGroup(kids[run[0]]) && !kids[run[0]].neg;
      const box = single ? wrap : wrap.appendChild(grEl('div', 'vaf-gr-box'));
      run.forEach((i, j) => {
        const kid = kids[i];
        if (j > 0) box.appendChild(grConjSel(node, kid, onChange, depth));
        let el;
        if (kid.field) el = grRenderLeaf(kid, node, g, onChange);
        else { parentOf.set(kid, node); el = grRenderNode(kid, g, onChange, depth + 1, parentOf); }
        const arrows = grArrows(parentOf, node, i, depth, onChange);
        if (kid.field) { const rm = el.querySelector(':scope > .vaf-gr-rm'); el.insertBefore(arrows, rm); }
        else { const addRow = el.querySelector(':scope > .vaf-gr-add'); (addRow || el).appendChild(arrows); }
        if (i === 0) {
          const chip = grNegChip(kid, onChange);
          if (kid.field) el.insertBefore(chip, el.firstChild);
          else {                                        // ganze Gruppe verneinen: Schalter in deren Aktionszeile
            chip.textContent = kid.neg ? 'Gruppe verneint' : 'Gruppe verneinen';
            const addRow = el.querySelector(':scope > .vaf-gr-add'); (addRow || el).insertBefore(chip, arrows);
          }
        }
        box.appendChild(el);
      });
      if (depth === 0) box.appendChild(grReasonRow(kids[run[0]]));
    });
    const add = grEl('div', 'vaf-gr-add');
    const lastReason = () => { const runs = grRuns(node); const l = runs[runs.length - 1]; return l && kids[l[0]] ? kids[l[0]].reason : ''; };
    const push = (k) => {
      if (kids.length) k.conj = depth === 0 ? 'or' : 'and';
      if (depth === 0 && kids.length && lastReason()) k.reason = lastReason();   // neue Hauptgruppe erbt einmalig die Begründung davor
      kids.push(k); onChange();
    };
    const bCond = grEl('button', 'vaf-gr-addbtn', '+ Bedingung');
    bCond.addEventListener('click', () => push(newLeaf(g)));
    const bGrp = grEl('button', 'vaf-gr-addbtn', '+ Gruppe');
    bGrp.addEventListener('click', () => push({ kids: [newLeaf(g)] }));
    add.appendChild(bCond); add.appendChild(bGrp);
    if (depth > 0) { const rm = grEl('button', 'vaf-gr-rm', '✕ Gruppe'); rm.addEventListener('click', () => { node.__remove = true; onChange(); }); add.appendChild(rm); }
    wrap.appendChild(add);
    return wrap;
  }

  function grRenderLeaf(leaf, parent, g, onChange) {
    const row = grEl('div', 'vaf-gr-cond');
    const fields = grFieldsFor(g);
    const fs = grEl('select', 'vaf-gr-field');
    fs.innerHTML = grFieldOptionsHtml(fields, leaf.field);
    fs.value = leaf.field;
    fs.addEventListener('change', () => { leaf.field = fs.value; const f2 = grField(leaf.field); leaf.op = grOpsFor(f2)[0][0]; leaf.value = grDefaultValue(f2, leaf.op); onChange(); });
    row.appendChild(fs);
    const f = grField(leaf.field);
    const ops = grOpsFor(f);
    if (!ops.some((o) => o[0] === leaf.op)) { leaf.op = ops[0][0]; leaf.value = grCoerceValue(f, leaf.op, leaf.value); }   // alte Operatoren (z. B. „ist genau“) umstellen
    const os = grEl('select', 'vaf-gr-op');
    os.innerHTML = ops.map(([o, n]) => `<option value="${o}">${esc(n)}</option>`).join('');
    os.value = leaf.op;
    os.addEventListener('change', () => { leaf.op = os.value; leaf.value = grCoerceValue(f, leaf.op, leaf.value); onChange(); });
    row.appendChild(os);
    row.appendChild(grRenderValue(leaf, f, onChange));
    const rm = grEl('button', 'vaf-gr-rm', '✕');
    rm.addEventListener('click', () => { leaf.__remove = true; onChange(); });
    row.appendChild(rm);
    return row;
  }

  function grRenderValue(leaf, f, onChange) {
    const wrap = grEl('span', 'vaf-gr-val');
    if (grNoValue(leaf.op)) return wrap;                 // „keine Angabe“ / „hat Angabe“ brauchen keinen Wert
    if (f.type === 'num' || f.derived === 'photos') {
      const mk = (val, set) => { const i = grEl('input', 'vaf-gr-num'); i.type = 'number'; if (f.min != null) i.min = f.min; if (f.max != null) i.max = f.max; i.value = val; i.addEventListener('change', () => { set(Number(i.value)); onChange(); }); return i; };
      if (leaf.op === 'between') {
        if (!Array.isArray(leaf.value)) leaf.value = [Number(leaf.value) || f.min || 0, f.max || 0];
        wrap.appendChild(mk(leaf.value[0], (v) => leaf.value[0] = v)); wrap.appendChild(grEl('span', '', ' – ')); wrap.appendChild(mk(leaf.value[1], (v) => leaf.value[1] = v));
      } else { if (Array.isArray(leaf.value)) leaf.value = leaf.value[0]; wrap.appendChild(mk(leaf.value, (v) => leaf.value = v)); }
      if (f.unit) wrap.appendChild(grEl('span', 'vaf-gr-unit', ' ' + f.unit));
      return wrap;
    }
    // Pills im poppen-Stil statt Dropdown. Mehrfachauswahl (ODER-verknüpft) bei „enthält (eine/keine) von“ bzw. Sprachen „enthält (nicht)“.
    const multi = grIsMulti(f, leaf.op);
    const box = grEl('div', 'vaf-gr-pills' + (multi ? ' multi' : ''));
    const load = grEl('span', 'vaf-gr-pload', '…'); box.appendChild(load);
    wrap.appendChild(box);
    const curSet = () => new Set(Array.isArray(leaf.value) ? leaf.value.map(String) : (leaf.value === '' || leaf.value == null ? [] : [String(leaf.value)]));
    grOptions(f).then((opts) => {
      box.innerHTML = '';
      if (!opts || !opts.length) {   // keine bekannten Werte → freies Eingabefeld
        const i = grEl('input', 'vaf-gr-num'); i.type = 'text'; i.style.width = '120px';
        i.value = Array.isArray(leaf.value) ? leaf.value.join(',') : (leaf.value || '');
        i.addEventListener('change', () => { leaf.value = multi ? i.value.split(',').map((s) => s.trim()).filter(Boolean) : i.value.trim(); onChange(); });
        wrap.replaceChild(i, box); return;
      }
      const sel = curSet();
      const paint = () => { for (const p of box.children) p.classList.toggle('on', sel.has(p.dataset.v)); };
      for (const [c, n, guess] of opts) {
        const code = String(c);
        const p = grEl('button', 'vaf-gr-pill' + (guess ? ' guess' : '')); p.type = 'button'; p.dataset.v = code;
        p.innerHTML = esc(n) + (guess ? ' <span class="vaf-gr-warn">⚠</span>' : '');
        if (guess) p.title = 'noch nicht gesichert';
        p.addEventListener('click', () => {
          if (multi) { if (sel.has(code)) sel.delete(code); else sel.add(code); leaf.value = [...sel]; }
          else { sel.clear(); sel.add(code); leaf.value = typeof c === 'boolean' ? c : code; }
          paint(); onChange();
        });
        box.appendChild(p);
      }
      paint();
    }).catch(() => { box.innerHTML = ''; });
    return wrap;
  }

  // Block (ein Geschlecht) rendern
  function grRenderBlock(cms, g, draft, renderAll) {
    const block = draft[g];
    const el = grEl('div', 'vaf-gr-block');
    const head = grEl('div', 'vaf-gr-bhead');
    head.appendChild(grEl('span', 'vaf-gr-chip on', esc(grGenderName(g))));
    const x = grEl('button', 'vaf-gr-x', '✕'); x.title = 'Regelblock entfernen';
    x.addEventListener('click', () => { delete draft[g]; renderAll(); });
    head.appendChild(x);
    el.appendChild(head);
    const prune = (n) => {
      if (!n || !n.kids) return;
      const was0 = n.kids[0];
      n.kids = n.kids.filter((k) => !k.__remove);
      if (n.kids[0] && n.kids[0] !== was0) { if (was0 && was0.reason && !n.kids[0].reason && n.kids[0].conj !== 'or') n.kids[0].reason = was0.reason; delete n.kids[0].conj; }
      n.kids.forEach(prune);
    };
    // Begründung gehört ans erste Glied jeder Hauptgruppe (ODER-Abschnitt der obersten Ebene)
    const fixReasons = (n) => {
      for (const run of grRuns(n)) {
        const first = n.kids[run[0]];
        if (!first.reason) { const w = run.map((i) => n.kids[i]).find((k) => k.reason); if (w) first.reason = w.reason; }
        for (const i of run.slice(1)) delete n.kids[i].reason;
      }
    };
    for (const [key, title, cls] of [['accept', 'Automatisch annehmen, wenn', 'acc'], ['reject', 'Automatisch ablehnen, wenn', 'rej']]) {
      el.appendChild(grEl('div', 'vaf-gr-tt ' + cls, esc(title)));
      block[key] = block[key] || newTree();
      const onChange = () => { prune(block[key]); fixReasons(block[key]); renderAll(); };
      el.appendChild(grRenderNode(block[key], g, onChange, 0));
    }
    return el;
  }

  // optsByField für die Konfliktprüfung sammeln (bekannte Codes je enum-Feld)
  async function grOptsByField() {
    const out = {};
    for (const f of GR_FIELDS) if (f.type === 'enum' || f.type === 'country') { const o = await grOptions(f).catch(() => null); if (o) out[f.key] = o.map((x) => String(x[0])); }
    return out;
  }
  async function grExample(ex, g) {
    const parts = [grGenderName(g)];
    for (const [fk, v] of Object.entries(ex)) {
      const f = grField(fk); if (!f) continue;
      if (f.type === 'num' || f.derived === 'photos') parts.push(`${f.label} ${v}${f.unit ? f.unit : ''}`);
      else if (f.type === 'bool') parts.push(f.label + ': ' + (v ? 'ja' : 'nein'));
      else if (f.type === 'lang') parts.push(`${f.label}: ${(Array.isArray(v) ? v : [v]).map((c) => LANG_DE[c] || c).join(', ')}`);
      else parts.push(`${f.label}: ${await grValueName(f, Array.isArray(v) ? v[0] : v)}`);
    }
    return parts.join(', ');
  }

  let grEditorDraft = null;
  // Einfügeposition auf /groups/<id>/edit: direkt über „Lokale Gruppe“ (nach „Diese Geschlechter Automatisch Genehmigen“)
  function grEditAnchor() {
    const main = document.querySelector('main'); if (!main) return null;
    const lok = [...main.querySelectorAll('span')].find((s) => s.children.length === 0 && norm(s.textContent) === 'lokale gruppe');
    if (!lok) return null;
    const lab = main.querySelector('label[for="auto_approve_genders"]');
    const item = lab && lab.closest('.ant-form-item');
    if (item) {                                          // gemeinsamer Vorfahr → dessen Kind, das „Lokale Gruppe“ enthält
      let anc = item.parentElement; while (anc && !anc.contains(lok)) anc = anc.parentElement;
      if (anc) { let c = lok; while (c.parentElement && c.parentElement !== anc) c = c.parentElement; if (c.parentElement === anc) return { before: c }; }
    }
    const blk = lok.closest('.ant-form-item') || lok.closest('.IZaklP') || lok.parentElement;
    return blk ? { before: blk } : null;
  }
  function grEditorUi() {
    const reqCms = grReqCms(), editCms = grEditCms();
    const cms = reqCms || editCms;
    if (!cms) { grEditorDraft = null; return; }
    if (document.getElementById('vaf-gr-editor')) return;
    let place = null;
    if (reqCms) {
      // Anker: nach der poppen-eigenen „Automatische Genehmigungsregeln festlegen“
      const h = [...document.querySelectorAll('main h2, main h3')].find((x) => /Automatische Genehmigungsregeln/i.test(x.textContent));
      if (!h) return;
      let sec = h; const main = document.querySelector('main');
      while (sec.parentElement && sec.parentElement !== main && !sec.parentElement.matches('.Hg9Kid, main')) sec = sec.parentElement;
      place = { after: sec };
    } else {
      place = grEditAnchor(); if (!place) return;
    }
    ensureGrStyle();
    const wrap = grEl('div', 'vaf-gr-editor'); wrap.id = 'vaf-gr-editor';
    // im poppen-Formular: Enter in unseren Feldern darf nichts abschicken
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' && /^(INPUT|SELECT)$/.test(e.target.tagName)) e.preventDefault(); });
    if (place.after) place.after.after(wrap); else place.before.before(wrap);
    grEditorDraft = grNormRules(clone(grRules()[cms] || {}));
    renderGrEditor(wrap, cms);
  }

  function renderGrEditor(wrap, cms) {
    const draft = grEditorDraft;
    wrap.innerHTML = '<h3 class="vaf-gr-h">Nach Regeln akzeptierte Geschlechter</h3><div class="vaf-gr-note">Eigene Annahme-/Ablehnregeln, je Geschlecht ein Block.</div>';
    const body = grEl('div'); wrap.appendChild(body);
    const renderAll = () => renderGrEditor(wrap, cms);
    const configured = Object.keys(draft).filter((g) => draft[g]);
    for (const g of GR_GENDERS.map((x) => x[0])) if (draft[g]) body.appendChild(grRenderBlock(cms, g, draft, renderAll));
    // kaskadierende Chips: noch nicht belegte Geschlechter
    const avail = GR_GENDERS.filter(([g]) => !draft[g]);
    if (avail.length) {
      const chips = grEl('div', 'vaf-gr-chips');
      chips.appendChild(grEl('span', 'vaf-gr-lbl', 'Geschlecht hinzufügen:'));
      for (const [g, name] of avail) { const c = grEl('span', 'vaf-gr-chip', esc(name)); c.addEventListener('click', () => { draft[g] = { accept: newTree(), reject: newTree() }; renderAll(); }); chips.appendChild(c); }
      body.appendChild(chips);
    }
    // Fußzeile: übernehmen aus Gruppe + Übernehmen + Status
    const foot = grEl('div', 'vaf-gr-foot');
    const other = Object.keys(grRules()).filter((c) => c !== cms && Object.keys(grRules()[c] || {}).length);
    if (other.length) {
      const names = G.get('groupnames', {});
      const sel = grEl('select', 'vaf-gr-vsel'); sel.innerHTML = '<option value="">Regeln übernehmen aus …</option>' + other.map((c) => `<option value="${c}">${esc(names[c] || 'Gruppe ' + c)}</option>`).join('');
      const bCopy = grEl('button', 'vaf-gr-btn', 'Übernehmen');
      bCopy.addEventListener('click', () => { if (sel.value) { grEditorDraft = grNormRules(clone(grRules()[sel.value] || {})); renderAll(); toast('Regeln übernommen – noch nicht gespeichert.'); } });
      foot.appendChild(sel); foot.appendChild(bCopy);
    }
    const status = grEl('span', 'vaf-gr-status');
    const bSave = grEl('button', 'vaf-gr-btn vaf-gr-pri', 'Übernehmen');
    bSave.addEventListener('click', () => grApply(cms, wrap));
    foot.appendChild(bSave); foot.appendChild(status);
    wrap.appendChild(foot);
    // Konflikt-Status live
    grCheckAll(cms, draft).then((confs) => {
      if (!confs.length) { status.textContent = 'Konfliktfrei'; status.className = 'vaf-gr-status ok'; }
      else { status.textContent = `${confs.length} möglicher Konflikt`; status.className = 'vaf-gr-status bad'; bSave.disabled = true;
        const box = grEl('div', 'vaf-gr-confbox');
        Promise.all(confs.map(async (c) => `<div class="vaf-gr-conf"><b>${esc(c.overlap.map((k) => grField(k).label).join(', ') || 'Bedingungen')} in beiden Bäumen möglich</b><br><span>${esc(await grExample(c.example, c.g))} würde zugleich angenommen und abgelehnt.</span></div>`)).then((h) => { box.innerHTML = h.join(''); wrap.appendChild(box); });
      }
    });
  }

  async function grCheckAll(cms, draft) {
    const opts = await grOptsByField();
    const out = [];
    for (const g of Object.keys(draft)) { if (!draft[g]) continue; const c = grConflict(draft[g], opts); if (c) out.push({ ...c, g }); }
    return out;
  }

  async function grApply(cms, wrap) {
    const draft = grEditorDraft;
    const confs = await grCheckAll(cms, draft);
    if (confs.length) { toast('Es gibt mögliche Konflikte – bitte erst auflösen.'); return; }
    // offene Anfragen?
    let pending = [];
    try { const d = await apiGet('group/attendee/specific/pending/list', { _version: 2, cms_id: cms, page: 1, limit: 100, sort: 'last_joined' }); pending = (d && d.users) || []; } catch (e) { warn('Offene Anfragen', e); }
    const save = () => { const r = grRules(); if (Object.keys(draft).length) r[cms] = clone(draft); else delete r[cms]; grSetRules(r); toast('Regeln gespeichert.'); };
    if (!pending.length) { save(); return; }
    grApplyPreview(cms, pending, save, draft);
  }

  // Profil-Fakten für die Regeln (roh, ohne Profilbesuch)
  // Beziehungsstatus-Kategorien (Textnamen) aus dem user/info-relationship-Objekt
  function grRelCats(rel) {
    if (!rel || typeof rel !== 'object') return [];
    const out = [];
    for (const arr of [rel.list, rel.unjoined_list]) for (const e of (arr || [])) { const t = e && (e.category_name || e.title); if (t) out.push(String(t)); }
    return [...new Set(out)];
  }
  // Partner (nicks/uids) aus dem relationship-Objekt – fürs Gedächtnis
  function grRelPartners(rel) {
    const out = [];
    if (rel && typeof rel === 'object') for (const arr of [rel.list, rel.unjoined_list]) for (const e of (arr || [])) for (const u of (e && e.users) || []) { if (u && u.uid) out.push({ uid: String(u.uid), nick: u.nickname || '' }); }
    return out;
  }
  // Lazy-Cache für listenbasierte Kriterien (nur laden, wenn eine Regel sie nutzt)
  const grLists = { ign: null, ignT: 0, byHim: null, byHimT: 0 };
  const GR_LIST_TTL = 5 * 60000;
  async function grMyIgnore() {
    if (grLists.ign && now() - grLists.ignT < GR_LIST_TTL) return grLists.ign;
    const s = new Set();
    try { for (const u of await BL.uids()) s.add(String(u)); } catch {}
    try { for (const it of await Queue.list()) if (/^\d+$/.test(String(it.uid))) s.add(String(it.uid)); } catch {}   // Block-/Radierer-Warteliste zählt als ignoriert
    grLists.ign = s; grLists.ignT = now(); return s;
  }
  async function grByHim() {
    if (grLists.byHim && now() - grLists.byHimT < GR_LIST_TTL) return grLists.byHim;
    const s = new Set();
    try { const d = await apiGet('ignore/be-ignored/uid/list', { _version: 2 }); for (const u of (d && d.list) || []) if (/^\d+$/.test(String(u))) s.add(String(u)); } catch {}
    grLists.byHim = s; grLists.byHimT = now(); return s;
  }
  // ctx um die listenbasierten Felder ergänzen – nur die, die eine Regel tatsächlich verwendet
  async function grEnrich(cms, pr, rules) {
    if (!pr || !pr.trait) return pr;
    const g = genderCode(pr.trait.gender);
    const used = new Set(grUsedFields(cms, g, rules));
    const uid = String(pr.uid || '');
    if (used.has('single')) pr.single = (pr.relCats || []).length === 0;
    if (used.has('fickliste') && uid) { const p = await Fick.byUid(uid).catch(() => null); pr.fickArr = [p && p.status != null ? String(p.status) : '0']; }
    if (used.has('whitelist')) { const m = uid ? await Members.get(uid) : null; pr.white = !!whiteReason(m, pr.nick); }
    if (used.has('ignoriert') && uid) pr.ign = (await grMyIgnore()).has(uid);
    if (used.has('ignoriert_mich') && uid) pr.ignByHim = (await grByHim()).has(uid);
    if (used.has('anschreibbar') && uid) pr.msgok = await msgOkFor(uid, pr.nick).catch(() => false);
    return pr;
  }

  // Nutzt eine Regel dieser Gruppe ein bestimmtes Feld (egal bei welchem Geschlecht)?
  function grUsesField(cms, key, rules) { const r = ((rules || grRules())[cms]) || {}; return Object.keys(r).some((g) => grUsedFields(cms, g, rules).includes(key)); }
  // Fotos aus der Galerie: opts.photos = wie viele weitere Bilder (ohne Avatar) gebraucht werden.
  //  Manuelle Prüfung: Avatar + bis zu 5 weitere (fest). Reine Regelprüfung: 1 Bild reicht für „hat Fotos“
  //  (bei echtem Avatar gar keins); nur wenn eine Regel „Fotos (Anzahl)“ nutzt, wird mehr geladen.
  const GR_MANUAL_PHOTOS = 5;
  const grPhotoKey = (src) => { const m = /(\d+-[0-9a-f]{16,})/i.exec(String(src || '')); return m ? m[1].toLowerCase() : String(src || ''); };
  async function grProbe(name, opts = {}) {
    const out = { trait: null, verified: false, photos: [], hasphoto: false, avatar: '', error: '', nick: String(name), uid: '', rel: null, relCats: [], interested: [], lookingForCodes: [] };
    let d;
    // user/info zählt als Profilbesuch → nur unsichtbar abfragen
    try { d = await VisAuto.use(() => apiGet('user/info/' + encodeURIComponent(String(name).toLowerCase()), { _version: 2 })); } catch (e) { out.error = e.message; return out; }
    if (!d || !d.userInfo) { out.error = 'keine Angaben'; return out; }
    const ui = d.userInfo; out.trait = d.user_trait || {};
    out.uid = String(ui.uid || (d.user_trait && d.user_trait.uid) || '');
    out.rel = d.relationship || null; out.relCats = grRelCats(out.rel);
    const am = d.aboutMe || {};
    out.interested = Array.isArray(am.interested) ? am.interested.map(String).filter(Boolean) : [];
    out.lookingForCodes = Array.isArray(am.lookingFor) ? am.lookingFor.map((x) => Array.isArray(x) ? String(x[1]) : String(x)).filter(Boolean) : [];
    out.verified = /done|verifi|ok|true/i.test(String(ui.fakecheck || '')) || ui.fakecheck === true;
    out.avatar = ui.avatar || '';
    let want = opts.photos != null ? opts.photos : GR_MANUAL_PHOTOS;
    if (opts.decideOnly && realPhoto(out.avatar) && want <= 1) want = 0;     // Avatar ist schon ein echtes Bild
    if (want > 0) try {
      const g = await apiGet('v3/profile/gallery', { _version: 2, nickname: String(name).toLowerCase(), page: 1, limit: Math.min(50, want + 1) });
      const seen = new Set([grPhotoKey(out.avatar)]);
      for (const it of (g && g.items) || []) {
        if (out.photos.length >= want) break;
        const md = it.media_data || {}; const src = md.source_url || md.preview_url || '';
        if (it.media_type !== 'image' || it.is_private || !realPhoto(src)) continue;
        const k = grPhotoKey(src); if (seen.has(k)) continue; seen.add(k); out.photos.push(src);
      }
    } catch {}
    out.hasphoto = out.photos.length > 0 || realPhoto(out.avatar);
    ingestUserInfo(d).catch(() => {});
    return out;
  }

  // Anwenden-Vorschau: zeigt, was die Regeln mit den offenen Anfragen täten
  async function grApplyPreview(cms, pending, save, draft) {
    const rules = { [cms]: draft };
    const m = modal({ title: 'Regeln auf offene Anfragen anwenden?', sub: `${pending.length} offene Anfrage${pending.length === 1 ? '' : 'n'} – so würden die neuen Regeln entscheiden:` });
    m.body.innerHTML = '<div class="vaf-gr-prev">Prüfe …</div>';
    const list = [];
    for (const u of pending) {
      const nick = u.nickname || u.name; if (!nick) continue;
      const pr = await grProbe(nick, { decideOnly: true, photos: grUsesField(cms, 'photos', rules) ? 50 : 1 }).catch(() => null);
      if (pr && pr.trait) await grEnrich(cms, pr, rules).catch(() => {});
      const ctx = pr && pr.trait ? pr : null;
      const d = ctx ? grDecide(cms, ctx, rules) : { verdict: 'manual', reason: 'keine Angaben' };
      list.push({ nick, uid: String(u.uid || ''), avatar: u.avatar || '', verdict: d.verdict, reason: d.reason || '', note: (u && typeof u.note === 'string') ? u.note : '', meta: ctx ? await grMetaLine(cms, ctx, rules) : (pr && pr.error) || '' });
    }
    const vn = { accept: ['annehmen', 'v-acc'], reject: ['ablehnen', 'v-rej'], manual: ['liegen lassen', 'v-man'] };
    m.body.querySelector('.vaf-gr-prev').innerHTML = list.map((r) => `<div class="vaf-gr-req"><div class="vaf-gr-reqtx"><b>${esc(r.nick)}</b><span>${esc(r.meta)}</span></div><span class="vaf-gr-verdict ${vn[r.verdict][1]}">${vn[r.verdict][0]}</span></div>`).join('') || '<div>Keine prüfbaren Anfragen.</div>';
    m.buttons([
      { label: 'Übernehmen und anwenden', primary: true, focus: true, fn: async () => {
        save();
        m.closable = false;
        const cur = grEl('div', 'vaf-cur', 'Wende an …'); m.body.appendChild(cur);
        const vis = await Vis.guard('Das Anwenden der Regeln'); if (!vis) { m.closable = true; return; }
        let done = 0;
        for (const r of list) { if (r.verdict === 'accept' || r.verdict === 'reject') { cur.textContent = `${r.nick}: ${r.verdict === 'accept' ? 'annehmen' : 'ablehnen'} …`; try { await grWriteDecisionNote(cms, r.nick, r.verdict, r.reason, r.note); const out = await decideRequest(r.nick, r.verdict === 'accept'); if (out === 'ok') { GrDone.put(cms, { uid: r.uid, nick: r.nick, avatar: r.avatar, verdict: r.verdict, reason: r.reason, by: 'auto' }); done++; } } catch (e) { warn('Anwenden', e); } await sleep(rand(1200, 2500)); } }
        Vis.restore(vis);
        cur.textContent = `Fertig – ${done} Anfrage${done === 1 ? '' : 'n'} bearbeitet.`;
        m.closable = true; m.buttons([{ label: 'Schließen', focus: true, primary: true, fn: () => m.close() }]);
      } },
      { label: 'Abbrechen', fn: () => m.close() },
    ]);
  }

  // Zusatzzeile: Werte der in den Regeln benutzten Felder
  async function grMetaLine(cms, ctx, rules) {
    const g = genderCode(ctx.trait && ctx.trait.gender);
    const used = grUsedFields(cms, g, rules);
    if (!used.length) return '';
    const parts = [];
    for (const fk of used) {
      const f = grField(fk); if (!f) continue;
      if (f.type === 'bool') { const d = f.derived; const val = d === 'verified' ? ctx.verified : d === 'hasphoto' ? ctx.hasphoto : ctx[d]; parts.push(`${f.label}: ${val ? 'ja' : 'nein'}`); }
      else if (f.derived === 'photos') parts.push(`Fotos: ${(ctx.photos || []).length}`);
      else if (f.key === 'relationship') { if ((ctx.relCats || []).length) parts.push(`Beziehung: ${ctx.relCats.join(', ')}`); }
      else if (f.ctxKey) { const v = (ctx[f.ctxKey] || []).filter((c) => String(c) !== '0'); if (v.length) parts.push(`${f.label}: ${(await Promise.all(v.map((c) => grValueName(f, c)))).join('/')}`); }
      else if (f.type === 'num') { const v = grTraitVals(f, ctx.trait); if (v.length) parts.push(`${f.label}: ${v.join('/')}${f.unit || ''}`); }
      else if (f.type === 'lang') { const ls = (ctx.trait.spoken_language || []).map((a) => (a || []).map((c) => LANG_DE[c] || c).join('+')).filter(Boolean); if (ls.length) parts.push(`Sprachen: ${ls.join(', ')}`); }
      else { const v = grTraitVals(f, ctx.trait); if (v.length) parts.push(`${f.label}: ${(await Promise.all(v.map((c) => grValueName(f, c)))).join('/')}`); }
    }
    return parts.join(' · ');
  }

  // Zusatzzeile in die Einzel-Anfragen einbauen
  const grMetaCache = new Map();
  async function grReqExtraLine() {
    const cms = grReqCms(); if (!cms || !grRules()[cms]) return;
    for (const it of findRequestItems()) {
      if (!it.descEl || it.descEl.nextElementSibling && it.descEl.nextElementSibling.classList && it.descEl.nextElementSibling.classList.contains('vaf-gr-meta')) continue;
      const nick = it.name; if (!nick) continue;
      const line = grEl('div', 'vaf-gr-meta', '…'); it.descEl.after(line);
      let pr = grMetaCache.get(nick);
      if (!pr) { pr = await grProbe(nick, { decideOnly: true, photos: grUsesField(cms, 'photos') ? 50 : 1 }).catch(() => null); if (pr && pr.trait) await grEnrich(cms, pr).catch(() => {}); grMetaCache.set(nick, pr); }
      const ctx = pr && pr.trait ? pr : null;
      line.textContent = ctx ? (await grMetaLine(cms, ctx)) : '';
      if (!line.textContent) line.remove();
    }
  }

  function ensureGrStyle() {
    if (document.getElementById('vaf-gr-style')) return;
    const st = document.createElement('style'); st.id = 'vaf-gr-style';
    st.textContent = `
    .vaf-gr-editor{background:#1f1f1f;border-radius:16px;padding:18px;margin:16px 0;color:#e8e8e8;font-size:14px}
    .vaf-gr-h{margin:0 0 4px;color:#fff;font-size:17px}
    .vaf-gr-note{color:#a6a6a6;font-size:13px;margin-bottom:12px}
    .vaf-gr-block{border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0;background:#191919}
    .vaf-gr-bhead{display:flex;align-items:center;gap:10px;margin-bottom:6px}
    .vaf-gr-x{margin-left:auto;background:none;border:0;color:#a6a6a6;cursor:pointer;font-size:15px}
    .vaf-gr-chip{border:1.5px solid #3a3a3a;background:#2a2a2a;color:#e8e8e8;border-radius:999px;padding:6px 14px;cursor:pointer;font-size:13.5px}
    .vaf-gr-chip.on{border-color:#ffc21a;color:#ffc21a;font-weight:600;cursor:default}
    .vaf-gr-chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}
    .vaf-gr-lbl{color:#a6a6a6;font-size:13px}
    .vaf-gr-tt{font-weight:600;color:#fff;margin:12px 0 6px;display:flex;align-items:center;gap:7px}
    .vaf-gr-tt.acc::before{content:"✓";color:#49d17a}.vaf-gr-tt.rej::before{content:"✕";color:#ff8a80}
    .vaf-gr-group{margin:0;padding:0}
    .vaf-gr-box{border:1px solid #3a3a3a;border-right:0;border-radius:10px 0 0 10px;padding:4px 0 4px 12px;margin:6px 0}
    .vaf-gr-neg{background:none;border:1px dashed #3a3a3a;border-radius:6px;color:#6a6a6a;font-size:11px;font-weight:700;padding:2px 6px;cursor:pointer;letter-spacing:.3px;font-family:inherit}
    .vaf-gr-neg.on{border-style:solid;border-color:#ff8a80;color:#ff8a80}
    .vaf-gr-conj.neg .vaf-gr-op{color:#ff8a80}
    .vaf-gr-cond{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:6px 0}
    .vaf-gr-cond select,.vaf-gr-num,.vaf-gr-vsel{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:5px 8px;color:#e8e8e8;font-size:13px;font-family:inherit}
    .vaf-gr-field{font-weight:600;color:#fff}.vaf-gr-val .vaf-gr-vsel{color:#ffc21a}.vaf-gr-num{width:70px;color:#ffc21a}
    .vaf-gr-unit{color:#a6a6a6;font-size:12px}
    .vaf-gr-pills{display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center;vertical-align:middle;max-width:100%}
    .vaf-gr-pill{background:#2a2a2a;border:1.5px solid #3a3a3a;color:#e8e8e8;border-radius:999px;padding:4px 12px;font-size:13px;font-family:inherit;cursor:pointer;line-height:1.4;transition:border-color .12s,color .12s,background .12s}
    .vaf-gr-pill:hover{border-color:#5a5a5a}
    .vaf-gr-pill.on{border-color:#ffc21a;color:#ffc21a;background:rgba(255,194,26,.12);font-weight:600}
    .vaf-gr-pill.guess{border-style:dashed}
    .vaf-gr-pill .vaf-gr-warn{color:#e65100;font-weight:700}
    .vaf-gr-pill.on .vaf-gr-warn{color:#ffb74d}
    .vaf-gr-pload{color:#a6a6a6;font-size:13px}
    .vaf-gr-reason{display:flex;align-items:center;gap:8px;margin:8px 0 2px;padding-left:2px}
    .vaf-gr-rlbl{color:#a6a6a6;font-size:12.5px;white-space:nowrap}
    .vaf-gr-rin{flex:1;min-width:150px;max-width:340px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:5px 10px;color:#e8e8e8;font-size:13px;font-family:inherit}
    .vaf-gr-rin::placeholder{color:#6a6a6a}
    .vaf-gr-field optgroup{color:#a6a6a6;font-weight:600;font-style:normal}
    .vaf-gr-field option{color:#e8e8e8;font-weight:400}
    .vaf-gr-conj{margin:3px 0}.vaf-gr-conj .vaf-gr-op{background:none;border:0;color:#a6a6a6;font-weight:700;font-size:12px}
    .vaf-gr-rm{background:none;border:0;color:#a6a6a6;cursor:pointer;font-size:13px}
    .vaf-gr-arrows{display:inline-flex;align-items:center;gap:1px;margin-left:4px}
    .vaf-gr-arrows b{cursor:pointer;color:#a6a6a6;font-weight:400;padding:0 3px;font-size:14px;user-select:none}
    .vaf-gr-arrows b:hover{color:#ffc21a}
    .vaf-gr-arrows b.off{opacity:.25;cursor:default}.vaf-gr-arrows b.off:hover{color:#a6a6a6}
    .vaf-gr-arrows i.gap{display:inline-block;width:10px}
    .vaf-gr-add .vaf-gr-arrows{margin-left:8px}
    .vaf-gr-add{margin:6px 0}.vaf-gr-addbtn{background:none;border:1px dashed #3a3a3a;border-radius:8px;padding:4px 10px;color:#a6a6a6;font-size:12.5px;cursor:pointer;margin-right:6px}
    .vaf-gr-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}
    .vaf-gr-btn{border:1px solid #3a3a3a;background:#2a2a2a;color:#e8e8e8;border-radius:9px;padding:8px 16px;font-weight:600;cursor:pointer}
    .vaf-gr-btn.vaf-gr-pri{background:#ffc21a;color:#1a1a1a;border:0}.vaf-gr-btn:disabled{opacity:.5;cursor:default}
    .vaf-gr-status{margin-left:auto;font-weight:600;font-size:13px}.vaf-gr-status.ok{color:#49d17a}.vaf-gr-status.bad{color:#ff8a80}
    .vaf-gr-confbox{margin-top:10px}.vaf-gr-conf{background:rgba(255,138,128,.1);border-radius:10px;padding:8px 12px;margin-top:8px;font-size:13px}
    .vaf-gr-conf b{color:#ff8a80}.vaf-gr-conf span{color:#cfcfcf}
    .vaf-gr-meta{color:#ffc21a;font-size:12.5px;margin-top:2px}
    .vaf-gr-prev .vaf-gr-req{display:flex;align-items:center;gap:12px;padding:9px 2px;border-bottom:1px solid rgba(255,255,255,.07)}
    .vaf-gr-reqtx{display:flex;flex-direction:column}.vaf-gr-reqtx b{color:#fff}.vaf-gr-reqtx span{color:#a6a6a6;font-size:12.5px}
    .vaf-gr-verdict{margin-left:auto;font-weight:600;font-size:13px;padding:3px 10px;border-radius:999px}
    .v-acc{color:#49d17a;background:rgba(73,209,122,.12)}.v-rej{color:#ff8a80;background:rgba(255,138,128,.12)}.v-man{color:#a6a6a6;background:rgba(255,255,255,.06)}
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  // =====================================================================================
  // Werte-Tabelle (Code → Klartext) für die Enum-Dropdowns im Regel-Editor.
  //
  //  Dreistufig:
  //   1) TRAIT_I18N  – Code → interner i18n-Schlüssel (aus poppen-Trait-Katalog, Bundle 44621).
  //                    Stabil (semantische Namen), ändert sich praktisch nie.
  //   2) Laufzeit    – ensureTraitI18n() löst diese Schlüssel aus poppens eigener i18n in die
  //                    aktuelle Sprache auf (ein i18n/pull, 14 Tage gecacht). Immer poppen-exakt,
  //                    folgt der UI-Sprache, aktualisiert sich bei poppen-Updates automatisch.
  //   3) GR_VALUEMAP_SEED – deutscher Offline-Fallback, falls die i18n (noch) nicht geladen ist.
  //
  //  Vorrang je Code:  importierte Helfer-Tabelle (GM 'gr_valuemap')  >  Laufzeit-i18n  >  SEED.
  //  Ausgeschlossen sind reine Such-/Leerwerte ("ANY", "keine Angabe/UNSELECTED").
  // =====================================================================================

  // (1) Code → i18n-Schlüssel. Ja/Nein-Felder bewusst ausgelassen (Schlüssel "YES"/"NO" zu generisch;
  //     SEED liefert dort bereits das korrekte, gesicherte Ja/Nein).
  const TRAIT_I18N = {
    figure_name:     { 2: 'SLENDER', 3: 'NORMAL', 4: 'ATHLETIC', 5: 'PLUMP', 6: 'FAT' },
    eyes_name:       { 1: 'EYES_BROWN', 2: 'EYES_BLUE', 3: 'EYES_GREEN', 4: 'EYES_OTHER' },
    hair:            { 1: 'HAIR_BLACK', 2: 'HAIR_BROWN', 3: 'HAIR_BLOND', 4: 'HAIR_RED', 6: 'HAIR_GREY', 5: 'HAIR_OTHER' },
    hair_length:     { 2: 'BALDNESS', 3: 'SHORT', 4: 'MIDDLE', 5: 'LONG' },
    beard:           { 1: 'BEARD_NONE', 2: 'BEARD_3DAYSBART', 3: 'BEARD_GOATIE', 4: 'BEARD_FULL', 5: 'BEARD_MUSTACHE' },
    sex_type:        { 1: 'SEXUALITY_TYPE_HOMO', 2: 'SEXUALITY_TYPE_HETERO', 3: 'SEXUALITY_TYPE_BI', 4: 'SEXUALITY_TYPE_BIINTERESSIERT' },
    intimately_hair: { 1: 'L_INTIMATE_HAIR_SHAVED', 2: 'L_INTIMATE_HAIR_PART_SHAVED', 3: 'L_INTIMATE_HAIR_HAIRED' },
    body_hair:       { 1: 'BODY_HAIR_NONE', 2: 'BODY_HAIR_SOME', 3: 'BODY_HAIR_LOT' },
    tits:            { 1: 'TI_SIZE_A', 2: 'TI_SIZE_B', 3: 'TI_SIZE_C', 4: 'TI_SIZE_D', 5: 'TI_SIZE_E', 6: 'TI_SIZE_F', 7: 'TI_SIZE_G', 8: 'TI_SIZE_H', 9: 'TI_SIZE_J' },
    circumcised:     { 1: 'L_CIRCUMCISED_YES', 2: 'L_CIRCUMCISED_NO' },
    ethnicity:       { 1: 'ETHNICITY_AFRICAN', 2: 'ETHNICITY_ARAB', 3: 'ETHNICITY_ASIAN', 4: 'ETHNICITY_CAUCASIAN_WHITE', 5: 'ETHNICITY_LATINO_HISPANIC', 6: 'ETHNICITY_MEDITERRANEAN', 7: 'ETHNICITY_PACIFIC_ISLANDER', 8: 'ETHNICITY_MIXED_RACE', 9: 'ETHNICITY_INDIGENOUS', 10: 'ETHNICITY_AFRICAN_AMERICAN_BLACK', 11: 'ETHNICITY_INDIAN', 12: 'ETHNICITY_MIDDLE_EASTERN', 13: 'ETHNICITY_OTHER' },
    zodiac:          { 1: 'ZODIAC_CAPRICORN', 2: 'ZODIAC_AQUARIUS', 3: 'ZODIAC_PISCES', 4: 'ZODIAC_ARIES', 5: 'ZODIAC_TAURUS', 6: 'ZODIAC_GEMINI', 7: 'ZODIAC_CANCER', 8: 'ZODIAC_LEO', 9: 'ZODIAC_VIRGO', 10: 'ZODIAC_LIBRA', 11: 'ZODIAC_SCORPIO', 12: 'ZODIAC_SAGGITARIUS' },
  };

  // (3) Deutscher Offline-Fallback.
  const GR_VALUEMAP_SEED = {
    figure_name:     { 2: 'Schlank', 3: 'Normal', 4: 'Sportlich', 5: 'Kurvig', 6: 'Plus-size' },
    eyes_name:       { 1: 'Braun', 2: 'Blau', 3: 'Grün', 4: 'Andere' },
    hair:            { 1: 'Schwarz', 2: 'Braun', 3: 'Blond', 4: 'Rot', 6: 'Grau', 5: 'Andere' },
    hair_length:     { 2: 'Glatze', 3: 'Kurz', 4: 'Mittel', 5: 'Lang' },
    beard:           { 1: 'Glatt rasiert', 2: '3-Tage-Bart', 3: 'Goatee', 4: 'Vollbart', 5: 'Schnauzer' },
    body_hair:       { 1: 'Keine', 2: 'Leicht behaart', 3: 'Stark behaart' },
    intimately_hair: { 1: 'rasiert', 2: 'teilrasiert', 3: 'behaart' },
    tits:            { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G', 8: 'H', 9: 'J' },
    circumcised:     { 1: 'Ja', 2: 'Nein' },
    sex_type:        { 1: 'Gay', 2: 'Hetero', 3: 'Bi', 4: 'bi-interessiert' },
    ethnicity:       { 1: 'Afrikanisch', 2: 'Arabisch', 3: 'Asiatisch', 4: 'Europäisch', 5: 'Latino', 6: 'Mediterran', 7: 'Pazifische Inseln', 8: 'Mixed', 9: 'Indigen', 10: 'Afroamerikanisch', 11: 'Indisch', 12: 'Mittlerer Osten', 13: 'Andere' },
    // Ja/Nein-Merkmale  (1 = Ja, 0 = Nein; Code 2 = "egal" ist nur Suchwert)
    glass:           { 1: 'Ja', 0: 'Nein' },
    smoker:          { 1: 'Ja', 0: 'Nein' },
    tattoo:          { 1: 'Ja', 0: 'Nein' },
    piercing:        { 1: 'Ja', 0: 'Nein' },
    handicap:        { 1: 'Ja', 0: 'Nein' },
    zodiac:          { 1: 'Steinbock', 2: 'Wassermann', 3: 'Fische', 4: 'Widder', 5: 'Stier', 6: 'Zwillinge', 7: 'Krebs', 8: 'Löwe', 9: 'Jungfrau', 10: 'Waage', 11: 'Skorpion', 12: 'Schütze' },
  };

  // Codes, deren SEED-Text nur meine Übersetzung des i18n-Schlüssels ist (⚠, bis die Laufzeit-i18n greift).
  const GR_VALUEMAP_GUESS = {
    ethnicity: { 6: true, 7: true, 10: true, 11: true },   // 9 (Indigen) per Helfer bestätigt
    beard:     { 5: true },                                 // Schnauzer
  };

  // Altlast: der frühere Ethnie-Cache aus i18n/pull wird nicht mehr gebraucht (Speicher freigeben).
  try { if (G.get('eth_map', null)) G.del('eth_map'); } catch {}

  // (2) i18n-Schlüssel → aktuelle Sprache, einmal pro 14 Tage aus poppens i18n, GM-gecacht.
  const TRAIT_I18N_TTL = 14 * DAY;
  let _traitI18nBusy = null;
  async function ensureTraitI18n() {
    const c = G.get('trait_i18n', null);
    if (c && c.at > now() - TRAIT_I18N_TTL && c.labels && Object.keys(c.labels).length) return;
    if (_traitI18nBusy) return _traitI18nBusy;
    _traitI18nBusy = (async () => {
      const need = new Set();
      for (const m of Object.values(TRAIT_I18N)) for (const k of Object.values(m)) need.add(k);
      const labels = {};
      const modules = ['common', 'account', 'profile', 'search', 'personal-detail', 'user', 'setting', 'member', 'detail', 'user-info'];
      for (const module of modules) {
        let d = null; try { d = await apiPost('i18n/pull', { locale: 'de-DE', module }); } catch { continue; }
        if (!d || typeof d !== 'object') continue;
        for (const [k, v] of Object.entries(d)) {
          if (typeof v !== 'string') continue;
          const bare = k.includes(':') ? k.slice(k.lastIndexOf(':') + 1) : k;   // evtl. Namespace-Präfix abstreifen
          const hit = need.has(bare) ? bare : (need.has(bare.toUpperCase()) ? bare.toUpperCase() : null);
          if (hit && !labels[hit]) labels[hit] = v;
        }
        if (Object.keys(labels).length >= need.size) break;
      }
      if (Object.keys(labels).length) G.set('trait_i18n', { at: now(), locale: 'de-DE', labels });
    })();
    try { await _traitI18nBusy; } finally { _traitI18nBusy = null; }
  }

  // Zusammenführen: SEED (Fallback) <- Laufzeit-i18n (exakt) <- GM-Import (bestätigt).
  // Ergebnis: { code: { t: <Klartext>, guess: <bool> } }
  function grSeeded(trait) {
    const out = {};
    const seed = GR_VALUEMAP_SEED[trait] || {};
    const guess = GR_VALUEMAP_GUESS[trait] || {};
    const keys = TRAIT_I18N[trait] || {};
    const i18n = ((G.get('trait_i18n', null) || {}).labels) || {};
    const codes = new Set([...Object.keys(seed), ...Object.keys(keys)]);
    for (const c of codes) {
      const de = keys[c] && i18n[keys[c]];
      if (de) out[c] = { t: de, guess: false };                 // poppen-exakt
      else if (seed[c] != null) out[c] = { t: seed[c], guess: !!guess[c] };
    }
    const gm = (G.get('gr_valuemap', {}) || {})[trait] || {};
    for (const [c, l] of Object.entries(gm)) {
      const t = l && typeof l === 'object' ? (l.t || l.label || l.name) : l;
      if (t != null && t !== '') out[c] = { t: String(t), guess: false };
    }
    return out;
  }
  // Als Optionsliste [[code, label, guess], …], numerisch sortiert.
  function grSeededList(trait) {
    const o = grSeeded(trait);
    return Object.keys(o).sort((a, b) => (Number(a) || 0) - (Number(b) || 0)).map((c) => [c, o[c].t, o[c].guess]);
  }

  // =====================================================================================
  // Punkt 18 (schlank): neue/unbekannte Profil-Codes „kostenlos" erfassen + Tabelle exportieren.
  //  Ergänzt die vollständige Tabelle nur, wenn poppen mal einen neuen Code anhängt.
  // =====================================================================================
  // „Leer/egal"-Sentinels je Feld (keine echten Profilwerte, nicht als „neu" melden).
  const GR_SENTINEL = { figure_name: ['1'], hair_length: ['1'], glass: ['2'], smoker: ['2'], tattoo: ['2'], piercing: ['2'], handicap: ['2'] };
  const GR_KNOWN_TRAITS = [...new Set([...Object.keys(GR_VALUEMAP_SEED), ...Object.keys(TRAIT_I18N)])];

  // Momentaufnahme der kompletten Werte-Tabelle (wird in jeden Recorder-Export eingebettet).
  function grValueTableSnapshot() {
    const out = {}; const i18n = ((G.get('trait_i18n', null) || {}).labels) || {}; const gmAll = G.get('gr_valuemap', {}) || {};
    for (const t of GR_KNOWN_TRAITS) {
      out[t] = {}; const o = grSeeded(t); const gm = gmAll[t] || {};
      for (const [c, v] of Object.entries(o)) {
        const key = (TRAIT_I18N[t] || {})[c];
        let src = 'seed'; if (key && i18n[key]) src = 'i18n'; if (gm[c] != null) src = 'live';
        out[t][c] = { t: v.t, src, key: key || undefined };
      }
      for (const [c, l] of Object.entries(gm)) if (!out[t][c]) { const txt = l && typeof l === 'object' ? (l.t || '') : String(l); out[t][c] = { t: txt, src: (l && typeof l === 'object' && l.status) || 'live', key: (TRAIT_I18N[t] || {})[c] }; }
    }
    return out;
  }

  // Debounced Einzel-Export (keine Download-Flut): 45 s nach der letzten Neuerung oder beim Verstecken des Tabs.
  let _vmDirty = false, _vmTimer = null, _vmListen = false;
  function grDoValueExport() {
    if (!_vmDirty) return; _vmDirty = false;
    try {
      const d = new Date(); const p = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
      download(`poppen-werte-neu-${stamp}.json`, JSON.stringify({ version: VERSION, at: d.toISOString(), hinweis: 'Automatisch – neue/unbestätigte Profil-Codes gefunden.', valuemap: grValueTableSnapshot() }, null, 2));
    } catch {}
  }
  function grScheduleValueExport() {
    _vmDirty = true;
    if (!_vmListen) { _vmListen = true; try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') grDoValueExport(); }); } catch {} }
    clearTimeout(_vmTimer); _vmTimer = setTimeout(grDoValueExport, 45000);
  }

  // Aus user_trait (Codes) unbekannte/neue Werte je Feld erfassen – läuft bei jedem user/info.
  function grNoteUnknownCodes(tr) {
    if (!tr || typeof tr !== 'object') return;
    const gm = G.get('gr_valuemap', {}) || {}; let changed = false, pruned = false;
    // Aufräumen: nur numerische Codes sind gültig (alte null/Platzhalter entfernen)
    for (const t of Object.keys(gm)) for (const c of Object.keys(gm[t] || {})) if (!/^\d+$/.test(c)) { delete gm[t][c]; pruned = true; }
    for (const t of GR_KNOWN_TRAITS) {
      let v = tr[t]; if (v == null) continue; if (!Array.isArray(v)) v = [v];
      const known = grSeeded(t); const skip = GR_SENTINEL[t] || [];
      for (const raw of v) {
        const c = String(raw); if (!/^\d+$/.test(c) || c === '0' || skip.includes(c)) continue;   // nur echte Zahlen, kein null/Leer/Sentinel
        if (known[c] || (gm[t] && gm[t][c])) continue;               // schon bekannt oder schon vermerkt
        gm[t] = gm[t] || {}; gm[t][c] = { t: '', status: 'unconfirmed', seen: now() }; changed = true;
      }
    }
    if (changed || pruned) G.set('gr_valuemap', gm);
    if (changed) grScheduleValueExport();
  }

  // =====================================================================================
  // Beitrittsanfragen automatisch bearbeiten
  //  - im Hintergrund, ausgelöst durch die Glocke („… möchte deiner Gruppe … beitreten“) oder durch
  //    offene Anfragen in verwalteten Gruppen (höchstens alle 15 Minuten je Gruppe)
  //  - Notiz wird VOR dem Annehmen/Ablehnen geschrieben
  //  - „Bearbeitete Beitrittsanfragen“: eigener Menüpunkt unter „Beitrittsanfragen“ (mit Papierkorb)
  //  - die Original-Knöpfe „Akzeptieren“/„Ablehnen“ schreiben zuerst die Notiz und merken die Entscheidung
  // =====================================================================================
  const GA_MIN_GAP = 15 * 60000;
  const gaGroupName = (cms) => (G.get('groupnames', {}) || {})[cms] || ('Gruppe ' + cms);

  // ---------- Liste der bearbeiteten Anfragen ----------
  const GrDone = {
    all: () => G.get('grp_done', {}) || {},
    key: (e) => (e.uid && /^\d+$/.test(String(e.uid)) ? String(e.uid) : 'n:' + norm(e.nick || '')),
    list(cms) { return Object.entries(this.all()[cms] || {}).map(([k, e]) => ({ ...e, key: k })).sort((a, b) => b.at - a.at); },
    find(cms, uid, nick) {
      const m = this.all()[cms] || {};
      if (uid && m[String(uid)]) return m[String(uid)];
      return Object.values(m).find((e) => nick && norm(e.nick) === norm(nick)) || null;
    },
    put(cms, e) {
      const a = this.all(); const m = a[cms] = a[cms] || {};
      const k = this.key(e);
      if (k !== 'n:' + norm(e.nick || '')) delete m['n:' + norm(e.nick || '')];
      m[k] = { uid: e.uid || '', nick: e.nick, avatar: e.avatar || '', verdict: e.verdict, reason: e.reason || '', by: e.by || 'auto', at: now() };
      G.set('grp_done', a); Bus.emit('grpdone', cms);
    },
    del(cms, key) { const a = this.all(); if (a[cms]) { delete a[cms][key]; G.set('grp_done', a); Bus.emit('grpdone', cms); } },
  };

  // ---------- Notizen ----------
  const gaSegs = (note) => String(note || '').split(' / ').map((s) => s.trim()).filter(Boolean);
  // gehört ein Notiz-Abschnitt zum Skript (Ignorieren, Whitelist, Entscheidung, Entfernen)?
  const gaRelated = (seg) => !!parseNote(seg) || GR_DECISION_RE.test(seg) || /^Entfernt aus "/.test(seg) || /whitelist/i.test(seg);
  // Notiz aus dem Notizfeld bei manueller Entscheidung: Fremder Text wird zur Begründung
  function gaSplitNote(note) {
    const segs = gaSegs(note);
    return { reason: segs.filter((s) => !gaRelated(s)).join(' / '), keep: segs.filter(gaRelated).join(' / ') };
  }
  const gaIsDecisionFor = (cms, seg) => GR_DECISION_RE.test(seg) && seg.includes(`in "${gaGroupName(cms)}"`);
  function gaRemovedNote(cms, note) {
    const segs = gaSegs(note).filter((s) => !gaIsDecisionFor(cms, s));
    return [...segs, `Entfernt aus "${gaGroupName(cms)}" am ${deDate(new Date())}`].join(' / ');
  }
  async function gaSetNote(cms, nick, note) {
    if (dry()) return;
    await apiPost('group/attendee/note', { cms_id: cms, nickname: nick, note }, { _version: 2 });
  }

  // ---------- offene Anfragen über die Schnittstelle ----------
  async function gaPending(cms) {
    const out = []; let page = 1;
    for (let guard = 0; guard < 50; guard++) {
      const d = await apiGet('group/attendee/specific/pending/list', { _version: 2, cms_id: cms, page, limit: 100, sort: 'last_joined' });
      const l = (d && d.users) || [];
      out.push(...l);
      if (!l.length || !d.next_page || d.next_page === page) break;
      page = d.next_page;
    }
    return out;
  }
  async function gaWhitelist(cms, u) {
    if (S().managedWhitelist[cms] === false || !u || !/^\d+$/.test(String(u.uid || ''))) return;
    await seen(u, 'Gruppenanfrage', { images: false });
    await Members.update(String(u.uid), (x) => { x.auto = x.auto || {}; x.auto.grp = x.auto.grp || {}; x.auto.grp[cms] = now(); });
  }

  // ---------- Hintergrund-Bearbeitung ----------
  const gaQueued = new Set(), gaRunning = new Set();
  function gaKick(cmsList, why) {
    if (!ON_POPPEN || !isOn()) return;
    const rules = grRules();
    for (const cms of cmsList || []) {
      if (!rules[cms] || !Object.keys(rules[cms]).length || gaQueued.has(cms)) continue;
      const last = (G.get('ga_last', {}) || {})[cms] || 0;
      const wait = Math.max(0, last + GA_MIN_GAP - now());
      gaQueued.add(cms);
      setTimeout(() => { gaQueued.delete(cms); gaProcessGroup(cms, why).catch((e) => warn('Beitrittsanfragen automatisch', e)); }, wait + 3000);
    }
  }
  async function gaProcessGroup(cms, why = '') {
    const rules = grRules();
    if (!rules[cms] || !isOn()) return null;
    if (now() - ((G.get('ga_last', {}) || {})[cms] || 0) < GA_MIN_GAP) return null;
    if (isGroupRequestsPage() && reqCms() === cms && groupRun) return null;        // Prüfung läuft schon sichtbar
    if (gaRunning.has(cms)) return null;
    if (!(await Lock.take('ga_' + cms, why))) return null;
    if (gaRunning.has(cms)) return null;
    gaRunning.add(cms);
    const res = { accept: 0, reject: 0, manual: 0, fail: 0, list: [] };
    try {
      G.set('ga_last', { ...(G.get('ga_last', {}) || {}), [cms]: now() });
      const pend = await gaPending(cms);
      for (const u of pend) {
        const nick = u.nickname || u.name; const uid = String(u.uid || '');
        if (!nick || !/^\d+$/.test(uid)) continue;
        let verdict = 'manual', reason = '';
        const prev = GrDone.find(cms, uid, nick);
        if (prev) { verdict = prev.verdict; reason = prev.reason || ''; }     // schon bearbeitet → wie in der Liste
        else {
          const pr = await grProbe(nick, { decideOnly: true, photos: grUsesField(cms, 'photos') ? 50 : 1 }).catch(() => null);
          if (pr && pr.trait) { await grEnrich(cms, pr).catch(() => {}); const d = grDecide(cms, pr); verdict = d.verdict; reason = d.reason || ''; }
        }
        if (verdict !== 'accept' && verdict !== 'reject') { res.manual++; continue; }
        if (dry()) { res[verdict]++; res.list.push(`${nick}: ${verdict} (Testmodus)`); continue; }
        try {
          await grWriteDecisionNote(cms, nick, verdict, reason, typeof u.note === 'string' ? u.note : '');   // Notiz zuerst
          await apiPost('group/attendee/' + (verdict === 'accept' ? 'approve' : 'deny'), { cms_id: cms, uid });
          GrDone.put(cms, { uid, nick, avatar: u.avatar, verdict, reason, by: 'auto' });
          if (verdict === 'accept') await gaWhitelist(cms, u).catch(() => {});
          res[verdict]++; res.list.push(`${nick}: ${verdict === 'accept' ? 'angenommen' : 'abgelehnt'}${reason ? ' wegen ' + reason : ''}`);
        } catch (e) { res.fail++; warn('Beitrittsanfrage', nick, e); }
        await sleep(rand(1500, 3000));
      }
      if (res.accept || res.reject) {
        log(`Beitrittsanfragen „${gaGroupName(cms)}“ (${why}):`, res.list.join('; '));
        toast(`Beitrittsanfragen „${esc(gaGroupName(cms))}“: ${res.accept} angenommen, ${res.reject} abgelehnt${res.manual ? `, ${res.manual} zur manuellen Prüfung` : ''}.`, 10000);
        refreshPending(true).catch(() => {});
      }
      // Benachrichtigung löschen, wenn nichts mehr manuell zu prüfen ist: Schnittstelle noch unbekannt
      // (wird nachgerüstet, sobald der Rekorder ein echtes Löschen mitgeschnitten hat).
      return res;
    } finally { gaRunning.delete(cms); Lock.release('ga_' + cms); }
  }
  // Glocke: „<nick> möchte deiner Gruppe <Gruppe> beitreten“
  function gaInstallHooks() {
    onApi(/^notification\/msg\/list$/, (d) => {
      const l = (d && (d.msg_list || d.list)) || [];
      const cmsList = [];
      for (const n of l) {
        if (!n || n.msg_type !== 'cms_private_request_group') continue;
        const dd = n.data || {};
        const m = /\/(\d+)\/?$/.exec(dd.link_to_request_page || '') || /\/(\d+)\/?$/.exec(dd.link || '');
        if (m) cmsList.push(m[1]);
      }
      if (cmsList.length) gaKick([...new Set(cmsList)], 'Glocke');
    });
    Bus.on('pending', () => { const p = G.get('pending', null); if (p && p.groups) gaKick(p.groups.map((g) => g.cms), 'offene Anfragen'); });
  }

  // ---------- Original-Knöpfe „Akzeptieren“/„Ablehnen“ einhaken ----------
  async function gaUidOf(cms, nick) {
    try { const l = await gaPending(cms); const u = l.find((x) => norm(x.nickname || '') === norm(nick)); return u ? String(u.uid) : ''; } catch { return ''; }
  }
  // Notiz schreiben + merken (manuell). note = aktueller Inhalt des Notizfelds.
  async function gaManualDecision(cms, it, accept) {
    const verdict = accept ? 'accept' : 'reject';
    const { reason, keep } = gaSplitNote(it.note ? it.note.value : '');
    await grWriteDecisionNote(cms, it.name, verdict, reason, keep);
    const uid = uidFromAvatar(it.avatar) || await gaUidOf(cms, it.name);
    if (!dry()) GrDone.put(cms, { uid, nick: it.name, avatar: it.avatar, verdict, reason, by: 'manual' });
    return { verdict, reason };
  }
  function gaHookButtons() {
    if (window.__vafGaHook) return;
    window.__vafGaHook = true;
    document.addEventListener('click', (e) => {
      if (!isGroupRequestsPage() || location.hash === '#bearbeitet') return;
      const btn = e.target && e.target.closest ? e.target.closest('main button') : null;
      if (!btn || btn.closest('.vaf-ov, #vaf-gr-editor, #vaf-ga-view')) return;
      const t = norm(btn.textContent);
      if (t !== 'akzeptieren' && t !== 'ablehnen') return;
      if (btn.__vafPass) { btn.__vafPass = false; return; }
      const it = findRequestItems().find((x) => x.accept === btn || x.reject === btn);
      if (!it) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (btn.__vafBusy) return;
      btn.__vafBusy = true;
      gaManualDecision(reqCms(), it, t === 'akzeptieren')
        .catch((err) => warn('Notiz vor Entscheidung', err))
        .finally(() => { btn.__vafBusy = false; btn.__vafPass = true; btn.click(); });
    }, true);
  }

  // ---------- Menüpunkt + Seite „Bearbeitete Beitrittsanfragen“ ----------
  const gaViewOn = () => isGroupRequestsPage() && location.hash === '#bearbeitet';
  function gaMenuLink() {
    const m = /^\/groups\/(\d+)\//.exec(location.pathname);
    if (!m) return;
    const cms = m[1];
    const req = document.querySelector(`a[href="/groups/${cms}/requests"]`);
    if (!req || !req.parentElement) return;
    let a = req.parentElement.querySelector('a.vaf-ga-link');
    const base = req.classList[0] || '';
    const sibs = [...req.parentElement.querySelectorAll('a[href]')].filter((x) => x !== a && (!base || x.classList.contains(base)));
    const counts = {}; sibs.forEach((x) => x.classList.forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));
    const activeCls = Object.keys(counts).find((c) => counts[c] === 1 && sibs.length > 2) || '';
    const plain = sibs.find((x) => !x.classList.contains(activeCls) && x !== req) || req;
    if (!a) {
      a = document.createElement('a');
      a.className = [...plain.classList].filter((c) => c !== activeCls).join(' ') + ' vaf-ga-link';
      a.href = `/groups/${cms}/requests#bearbeitet`;
      a.innerHTML = '<span data-type="label">Bearbeitete Beitrittsanfragen</span>';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (isGroupRequestsPage()) { location.hash = 'bearbeitet'; gaView(); }
        else location.href = a.href;
      });
      req.after(a);
    }
    const on = gaViewOn();
    if (activeCls) {
      a.classList.toggle(activeCls, on);
      if (on) req.classList.remove(activeCls);
      else if (isGroupRequestsPage() && !sibs.some((x) => x !== req && x.classList.contains(activeCls))) req.classList.add(activeCls);
    }
  }
  function gaView() {
    const main = document.querySelector('main');
    let view = document.getElementById('vaf-ga-view');
    if (!gaViewOn() || !main) {
      if (view) { view.remove(); if (main) for (const c of main.children) if (c.dataset.vafGaHidden) { c.style.display = ''; delete c.dataset.vafGaHidden; } }
      return;
    }
    if (view && view.isConnected) return;
    ensureGaStyle();
    for (const c of main.children) if (c.id !== 'vaf-ga-view' && c.style.display !== 'none') { c.dataset.vafGaHidden = '1'; c.style.display = 'none'; }
    view = document.createElement('div'); view.id = 'vaf-ga-view';
    main.appendChild(view);
    gaRender(view, reqCms());
  }
  function gaRender(view, cms) {
    const list = GrDone.list(cms);
    view.innerHTML = `<h2 class="vaf-ga-h">Bearbeitete Beitrittsanfragen</h2>
      <div class="vaf-ga-sub">${list.length ? `${list.length} bearbeitete Anfrage${list.length === 1 ? '' : 'n'} in „${esc(gaGroupName(cms))}“. Wer hier steht, wird bei einer neuen Anfrage wieder so entschieden.` : 'Noch keine bearbeiteten Anfragen.'}</div>
      <div class="vaf-ga-list"></div>`;
    const box = view.querySelector('.vaf-ga-list');
    for (const e of list) {
      const it = document.createElement('div'); it.className = 'vaf-ga-item';
      const acc = e.verdict === 'accept';
      it.innerHTML = `<div class="vaf-ga-top"><img class="vaf-ga-av" alt="" src="${esc(e.avatar || '/v2-static/client/image/avatar-man.c502eddd.svg')}">
        <div class="vaf-ga-who"><a href="${esc(profileUrl(e.nick))}" target="_blank" rel="noopener">${esc(e.nick)}</a>
        <span class="vaf-ga-v ${acc ? 'acc' : 'rej'}">${acc ? 'angenommen' : 'abgelehnt'}</span></div>
        <button type="button" class="vaf-ga-del" title="${acc ? 'Aus der Gruppe entfernen' : 'Aus der Liste nehmen (darf erneut anfragen)'}">${GA_TRASH}</button></div>
        <div class="vaf-ga-note">${esc(`${acc ? 'Angenommen' : 'Abgelehnt'}${e.reason ? ' wegen ' + e.reason : ''} am ${deDate(new Date(e.at))}`)}<span>${e.by === 'manual' ? 'von Hand' : 'automatisch'}</span></div>`;
      it.querySelector('.vaf-ga-del').addEventListener('click', () => gaTrash(cms, e, () => gaRender(view, cms)));
      box.appendChild(it);
    }
  }
  const GA_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 24 24"><path d="M21 6h-5V4.33A2.42 2.42 0 0 0 13.5 2h-3A2.42 2.42 0 0 0 8 4.33V6H3a1 1 0 1 0 0 2h1v11a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8h1a1 1 0 1 0 0-2M10 16a1 1 0 1 1-2 0v-4a1 1 0 1 1 2 0zm0-11.67c0-.16.21-.33.5-.33h3c.29 0 .5.17.5.33V6h-4zM16 16a1 1 0 0 1-2 0v-4a1 1 0 0 1 2 0z"></path></svg>';
  // aktuelle Notiz eines (ehemaligen) Bewerbers/Mitglieds lesen
  async function gaCurrentNote(cms, nick) {
    try {
      const d = await apiPost('group/attendee/manage/list', { cms_id: cms, limit: 10, keyword: nick, sort: 'last_joined' }, { _version: 2 });
      const u = ((d && d.users) || []).find((x) => norm(x.nickname || '') === norm(nick));
      if (u && typeof u.note === 'string') return u.note;
    } catch {}
    return null;
  }
  async function gaTrash(cms, e, redraw) {
    const acc = e.verdict === 'accept';
    const v = await ask(acc ? 'Aus der Gruppe entfernen?' : 'Ablehnung zurücknehmen?',
      acc ? `<b>${esc(e.nick)}</b> wird aus „${esc(gaGroupName(cms))}“ entfernt. Die Notiz wird zu „Entfernt aus "${esc(gaGroupName(cms))}" am ${deDate(new Date())}“.`
        : `<b>${esc(e.nick)}</b> wird aus der Liste genommen, die Ablehnungs-Notiz gelöscht. Danach kann ${esc(e.nick)} erneut anfragen.`,
      [{ label: acc ? 'Entfernen' : 'Zurücknehmen', value: 'ok', primary: true }, { label: 'Abbrechen', value: '', focus: true, cancel: true }]);
    if (v !== 'ok') return;
    try {
      const cur = await gaCurrentNote(cms, e.nick);
      if (acc) {
        await gaSetNote(cms, e.nick, gaRemovedNote(cms, cur || ''));
        if (!dry()) await apiPost('group/attendee/kick', { cms_id: cms, nickname: e.nick }, { _version: 2 });
        toast(`${esc(e.nick)} aus „${esc(gaGroupName(cms))}“ entfernt.`);
      } else {
        if (cur != null) await gaSetNote(cms, e.nick, gaSegs(cur).filter((s) => !gaIsDecisionFor(cms, s)).join(' / '));
        else await gaSetNote(cms, e.nick, '').catch(() => {});
        // Erneutes Anfragen freischalten: Schnittstelle noch unbekannt (wird nachgerüstet, sobald mitgeschnitten)
        toast(`${esc(e.nick)} aus der Liste genommen.`);
      }
      if (!dry()) GrDone.del(cms, e.key);
    } catch (err) { toast('Fehlgeschlagen: ' + esc(err.message || String(err))); }
    redraw();
  }
  function ensureGaStyle() {
    if (document.getElementById('vaf-ga-style')) return;
    const st = document.createElement('style'); st.id = 'vaf-ga-style';
    st.textContent = `
      #vaf-ga-view{color:#e8e8e8;font-size:14px;padding:4px 0 40px}
      .vaf-ga-h{color:#fff;font-size:20px;margin:6px 0 4px}
      .vaf-ga-sub{color:#a6a6a6;font-size:13px;margin-bottom:14px}
      .vaf-ga-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
      .vaf-ga-item{background:#1f1f1f;border-radius:16px;padding:14px}
      .vaf-ga-top{display:flex;align-items:center;gap:12px}
      .vaf-ga-av{width:48px;height:48px;border-radius:50%;object-fit:cover;background:#3a3a3a;flex:none}
      .vaf-ga-who{flex:1;min-width:0;display:flex;flex-direction:column}
      .vaf-ga-who a{color:#fff;font-weight:600;text-decoration:none}.vaf-ga-who a:hover{text-decoration:underline}
      .vaf-ga-v{font-size:12px}.vaf-ga-v.acc{color:#49d17a}.vaf-ga-v.rej{color:#ff8a80}
      .vaf-ga-del{width:32px;height:32px;border-radius:50%;border:1px solid #4a4a4a;background:transparent;color:#e8e8e8;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
      .vaf-ga-del:hover{border-color:#ffc21a;color:#ffc21a}
      .vaf-ga-note{margin-top:10px;background:#141414;border:1px solid #3a3a3a;border-radius:10px;padding:8px 12px;font-size:13px;display:flex;justify-content:space-between;gap:10px}
      .vaf-ga-note span{color:#6a6a6a;white-space:nowrap}`;
    document.head.appendChild(st);
  }
  function gaTick() {
    try { gaMenuLink(); gaView(); } catch (e) { warn('Bearbeitete Beitrittsanfragen', e); }
  }
  function initGroupAuto() {
    gaInstallHooks();
    gaHookButtons();
    gaTick();
    setInterval(gaTick, 1000);
    W.addEventListener('hashchange', gaTick);
    Bus.on('grpdone', (cms) => { const v = document.getElementById('vaf-ga-view'); if (v && reqCms() === cms) gaRender(v, cms); });
    // nach dem Start einmal die offenen Anfragen aller verwalteten Gruppen mit Regeln prüfen
    setTimeout(() => { const p = G.get('pending', null); if (p && p.groups) gaKick(p.groups.map((g) => g.cms), 'Start'); }, 20000);
  }

  // =====================================================================================
  // Von poppen gesperrte Profile / Profile in Echtheitsprüfung
  //  Die Profilseite zeigt dann statt des Profils „Blockiertes Profil“ bzw. „Popster verifizieren“.
  //  Solche Mitglieder werden im Gedächtnis markiert (mit Datum), kommen bei neuen Einträgen ans Ende der
  //  Warteliste (schon eingereihte bleiben, wo sie sind) und tragen in Listen einen Vermerk. Der Vermerk
  //  verschwindet von selbst, sobald das Profil wieder normal zu sehen ist.
  // =====================================================================================
  const PSTATE = { gesperrt: 'von poppen gesperrt', pruefung: 'in Echtheitsprüfung' };
  const pstateNote = (m) => (m && m.pstate && PSTATE[m.pstate.k] ? ' · ' + PSTATE[m.pstate.k] : '');
  function pstateOfDoc(doc = document) {
    const r = doc.querySelector('main .ant-result-info .ant-result-title');
    if (!r) return '';
    const t = norm(r.textContent || '');
    if (t.includes('blockiertes profil')) return 'gesperrt';
    if (t.includes('popster verifizieren')) return 'pruefung';
    return '';
  }
  async function pstateSet(nick, k) {
    if (!nick) return;
    const m = await Members.byNick(nick);
    const map = { ...(G.get('pstate_nicks', {}) || {}) };
    if (k) map[norm(nick)] = { k, at: now() }; else delete map[norm(nick)];
    G.set('pstate_nicks', map);
    if (!m) return;
    await Members.update(m.uid, (x) => {
      if (k) { if (!x.pstate || x.pstate.k !== k) x.pstate = { k, at: now() }; }
      else delete x.pstate;
    });
  }
  // Profilseite /p/<nick>: Zustand erkennen bzw. Vermerk wieder entfernen
  async function profileStateUi() {
    const nick = decodeURIComponent((/^\/p\/([^/]+)/.exec(location.pathname) || [])[1] || '');
    if (!nick || profileStateUi.path === location.pathname) return;
    profileStateUi.path = location.pathname;
    const k = await waitFor(() => pstateOfDoc() || (document.querySelector('main h1, main [data-type="profile-header"], main .ant-avatar, main img[alt]') && document.querySelector('main') && document.querySelector('main').textContent.length > 200 ? 'normal' : ''), 10000);
    if (!k) return;
    if (k === 'normal') {
      const m = await Members.byNick(nick);
      if ((m && m.pstate) || (G.get('pstate_nicks', {}) || {})[norm(nick)]) { await pstateSet(nick, ''); log(`${nick}: Profil wieder sichtbar – Vermerk entfernt`); }
      return;
    }
    await pstateSet(nick, k);
    log(`${nick}: ${PSTATE[k]}`);
  }

  // =====================================================================================
  // ID → Nickname (messenger/group/item/p2p mit group_id = uid)
  //  poppens eigene Profilseite benutzt diese Abfrage; sie liefert { uid, nickname, age, gender, avatar,
  //  payclass, user_status } – auch ohne bestehenden Chat. Genutzt wird sie erst, wenn der eingebaute
  //  Selbsttest an bekannten Profilen bestanden ist (einmal automatisch, sonst per Knopf in den Experten-Einstellungen).
  // =====================================================================================
  const IDRES_GAP = 1800;                 // ms zwischen zwei Abfragen
  // nächster Versuch für ungelöste IDs: wachsende Abstände 1 → 7 → 30 Tage
  const idresNext = (c) => (c.at || 0) + [1, 7, 30][Math.min(2, Math.max(0, (c.n || 1) - 1))] * DAY;
  const idresGone = (uid) => { const c = (G.get('idres_cache', {}) || {})[String(uid)]; return !!(c && !c.nick && c.st === 'leer'); };
  const idresLabel = (uid) => (idresGone(uid) ? `Profil nicht mehr erreichbar (ID ${uid})` : `ID ${uid}`);
  // für den Rekorder: alle ungelösten IDs mit Grund
  function idresFails() {
    const c = G.get('idres_cache', {}) || {};
    const src = G.get('idres_src', {}) || {};
    return Object.entries(c).filter(([, r]) => r && !r.nick).map(([uid, r]) => ({ uid, zustand: r.st === 'leer' ? 'leere Antwort (nicht erreichbar)' : r.err ? 'Fehler' : 'ohne Nick', err: r.err || null, code: r.code != null ? r.code : null, user_status: typeof r.st === 'number' ? r.st : null, versuche: r.n || 1, zuletzt: r.at ? new Date(r.at).toISOString() : null, naechster: new Date(idresNext(r)).toISOString(), quelle: src[uid] || null }));
  }
  const Resolver = (() => {
    let last = 0, chain = Promise.resolve();
    const cache = () => G.get('idres_cache', {}) || {};
    async function raw(uid) {
      const wait = last + IDRES_GAP - now(); if (wait > 0) await sleep(wait);
      last = now();
      const d = await apiPost('messenger/group/item/p2p', { group_id: String(uid), nickname: '' });
      return d || null;
    }
    const passed = () => { const t = G.get('idres_test', null); return !!(t && t.ok); };
    async function ensureTested() {
      const t = G.get('idres_test', null);
      if (t) return !!t.ok;
      await idresSelfTest({ silent: true }).catch((e) => warn('ID-Auflösung: Selbsttest', e));
      return passed();
    }
    // eine ID auflösen (gedrosselt, je ID nur einmal); Ergebnis landet auch im Gedächtnis
    function resolve(uid) {
      uid = String(uid || '');
      if (!/^\d+$/.test(uid)) return Promise.resolve(null);
      const c = cache()[uid];
      if (c && (c.nick || now() < idresNext(c))) return Promise.resolve(c);
      const p = chain.then(async () => {
        if (!(await ensureTested())) return null;
        const c2 = cache()[uid]; if (c2 && (c2.nick || now() < idresNext(c2))) return c2;
        let res = { nick: '', st: null, at: now(), n: ((c2 && c2.n) || 0) + 1 };
        try {
          const d = await raw(uid);
          const gd = d && d.group_data;
          if (!gd) { res.st = 'leer'; res.code = d ? 0 : null; }   // poppen liefert gar nichts (Profil nicht mehr erreichbar, vermutlich gesperrt)
          if (gd && String(gd.uid) === uid) {
            res = { nick: gd.nickname || '', st: gd.user_status != null ? gd.user_status : null, at: now() };
            if (gd.user_status !== 1) log(`ID-Auflösung: ${uid} (${gd.nickname || '?'}) user_status=${gd.user_status}`);
            if (gd.nickname && !DELETED_NICK.test(gd.nickname)) await seen({ uid, nickname: gd.nickname, gender: gd.gender, age: gd.age, avatar: gd.avatar, payclass: gd.payclass }, 'ID-Auflösung', { images: false }).catch(() => {});
          }
        } catch (e) { res.err = e.message || String(e); res.code = e.code; }
        G.set('idres_cache', { ...cache(), [uid]: res });
        return res;
      });
      chain = p.catch(() => {});
      return p;
    }
    return { resolve, raw, passed, ensureTested, cache };
  })();

  // ---------- Selbsttest ----------
  async function idresChatUids(pages = 8) {
    const out = new Set(); let offset = 0;
    for (let i = 0; i < pages; i++) {
      const d = await apiPost('messenger/group/list', { offset, filter: 0 });
      const l = (d && d.list) || [];
      for (const c of l) if (c && c.group_data && c.group_data.uid) out.add(String(c.group_data.uid));
      if (!l.length) break;
      offset += l.length;
    }
    return out;
  }
  async function idresSelfTest({ silent = false, only = null } = {}) {
    if (!(await Lock.take('idres_test', 'Selbsttest'))) return G.get('idres_test', null);
    const det = { at: new Date().toISOString(), known: [], states: {}, sideEffect: null, errors: [] };
    let ok = false;
    try {
      // 1) bekannte Mitglieder: Nick (ohne Groß/Klein), Geschlecht, Alter (±1 wegen Geburtstag)
      const cand = [];
      await Members.each((m) => {
        if (cand.length >= 40) return;
        if (only && !only.includes(String(m && m.uid))) return;
        if (!m || !/^\d+$/.test(String(m.uid)) || !m.nick || !(m.ages || []).length || !(m.g || []).length || m.pstate) return;
        if (!m.ageAt || m.ageAt < isoDay(new Date(now() - 60 * DAY))) return;
        cand.push(m);
      });
      const pick = cand.sort(() => Math.random() - 0.5).slice(0, 10);
      for (const m of pick) {
        let d = null;
        try { d = await Resolver.raw(m.uid); } catch (e) { det.errors.push(`${m.uid}: ${e.message}`); }
        const gd = d && d.group_data;
        const nickOk = !!gd && norm(gd.nickname || '') === norm(m.nick);
        const gOk = !!gd && (gd.gender || []).join(',') === (m.g || []).join(',');
        const aOk = !!gd && (gd.age || []).length === (m.ages || []).length && (gd.age || []).every((a, i) => Math.abs(a - m.ages[i]) <= 1);
        det.known.push({ uid: m.uid, nick: m.nick, got: gd ? gd.nickname : null, nickOk, gOk, aOk, st: gd ? gd.user_status : null });
      }
      // 2) bekannte gelöschte / gesperrte / in Prüfung: user_status je Art festhalten
      const cats = { gesperrt: [], pruefung: [], geloescht: [] };
      await Members.each((m) => { if (m && m.pstate && cats[m.pstate.k] && cats[m.pstate.k].length < 20 && /^\d+$/.test(String(m.uid))) cats[m.pstate.k].push(m.uid); });
      let chats = new Set(), chatList = null;
      try {
        const d = await apiPost('messenger/group/list', { offset: 0, filter: 0 });
        chatList = (d && d.list) || [];
        for (const c of chatList) { const gd = c.group_data || {}; if (DELETED_NICK.test(gd.nickname || '') && gd.uid && cats.geloescht.length < 20) cats.geloescht.push(String(gd.uid)); }
      } catch (e) { det.errors.push('Chatliste: ' + e.message); }
      for (const [k, ids] of Object.entries(cats)) {
        det.states[k] = [];
        for (const uid of ids) {
          try { const d = await Resolver.raw(uid); const gd = d && d.group_data; det.states[k].push({ uid, nick: gd ? gd.nickname : null, st: gd ? gd.user_status : null }); }
          catch (e) { det.states[k].push({ uid, err: e.message }); }
        }
      }
      // 3) Nebenwirkung: entsteht beim Auflösen einer ID ohne Chat ein leerer Chat?
      try {
        chats = await idresChatUids();
        const free = pick.map((m) => String(m.uid)).find((u) => !chats.has(u));
        let probe = free;
        if (!probe) { const extra = cand.map((m) => String(m.uid)).find((u) => !chats.has(u)); probe = extra; }
        if (probe) {
          const d = await Resolver.raw(probe);
          await sleep(1500);
          const after = await idresChatUids();
          const looksNew = !!(d && d.group_id && /-/.test(String(d.group_id)));   // echte Chats haben eine UUID
          det.sideEffect = { uid: probe, chatAppeared: after.has(probe), uuid: looksNew, before: chats.size, after: after.size };
        } else det.sideEffect = { skipped: 'keine ID ohne Chat gefunden' };
      } catch (e) { det.errors.push('Nebenwirkung: ' + e.message); }
      const n = det.known.length;
      const good = det.known.filter((k) => k.nickOk && k.gOk && k.aOk).length;
      const side = det.sideEffect && !det.sideEffect.skipped && (det.sideEffect.chatAppeared || det.sideEffect.uuid);
      ok = n >= 3 && good >= Math.ceil(n * 0.9) && !side && !!det.sideEffect && !det.sideEffect.skipped;
      det.summary = `${good}/${n} bekannte Profile korrekt` + (side ? ' · FEHLER: leerer Chat entstanden' : det.sideEffect && det.sideEffect.skipped ? ' · Nebenwirkung nicht prüfbar' : ' · keine Nebenwirkung') +
        Object.entries(det.states).filter(([, l]) => l.length).map(([k, l]) => ` · ${k}: user_status ${[...new Set(l.map((x) => x.st))].join('/')}`).join('');
    } catch (e) { det.errors.push(e.message || String(e)); det.summary = 'abgebrochen: ' + (e.message || e); }
    finally { Lock.release('idres_test'); }
    const res = { ok, at: now(), details: det };
    G.set('idres_test', res);
    log('ID-Auflösung Selbsttest:', ok ? 'bestanden' : 'NICHT bestanden', det);
    if (!silent || !ok) toast(`ID-Auflösung: Selbsttest ${ok ? '<b>bestanden</b>' : '<b>nicht bestanden</b> – die Auflösung bleibt aus'}<br>${esc(det.summary || '')}`, 12000);
    return res;
  }

  // ---------- Anwendung: fehlende Nicknames nachtragen ----------
  async function resolveMissing(max = 150) {
    if (!(await Lock.take('idres', 'Nicknames nachtragen'))) return 0;
    let n = 0;
    try {
      const ids = new Set();
      const srcs = { ...(G.get('idres_src', {}) || {}) };
      const addId = (u, src) => { u = String(u); ids.add(u); if (!srcs[u]) srcs[u] = src; };
      for (const uid of G.get('evil_ids', []) || []) if (!(evilNames()[uid])) addId(uid, 'Blockierende Popsters (ignorieren mich)');
      for (const e of S().expert.evil || []) if (/^\d+$/.test(String(e).trim())) addId(String(e).trim(), 'Besonders böse Popsters');
      for (const q of await Queue.list()) if (/^\d+$/.test(String(q.uid)) && !q.nick) addId(q.uid, 'Warteliste' + (q.src ? ' (' + q.src + ')' : ''));
      await Members.each((m) => { if (ids.size < max * 2 && m && /^\d+$/.test(String(m.uid)) && !m.nick) addId(m.uid, 'Gedächtnis'); });
      for (const k of Object.keys(srcs)) if (!ids.has(k)) delete srcs[k];
      G.set('idres_src', srcs);
      const cache = Resolver.cache();
      const todo = [...ids].filter((u) => !(cache[u] && (cache[u].nick || now() < idresNext(cache[u])))).slice(0, max);
      if (!todo.length) return 0;
      if (!(await Resolver.ensureTested())) return 0;
      for (const uid of todo) {
        const r = await Resolver.resolve(uid);
        if (r && r.nick) {
          n++;
          const q = await DB.get('queue', uid).catch(() => null);
          if (q && !q.nick) { q.nick = r.nick; await DB.put('queue', q); }
        }
      }
      if (n) { log(`ID-Auflösung: ${n} Nicknames nachgetragen`); syncEvilNames().catch(() => {}); Queue.changed(); }
    } finally { Lock.release('idres'); }
    return n;
  }
  function initResolver() {
    setTimeout(() => resolveMissing().catch((e) => warn('ID-Auflösung', e)), 90000);
    setInterval(() => resolveMissing().catch(() => {}), 6 * 3600000);
  }

  // =====================================================================================
  // XXL: Hintergrund-Suche (letzte Quelle im Opa-Scan) und eigene Seite unter „Entdecken“
  //  Beides nur bei „Benutzer ist Moppel-Liebhaber“.
  // =====================================================================================
  const XXL_ICON = { w: '<mask id="__ID__"><rect width="64" height="64" fill="#fff"/> <path d="M11.5 31.5 C14 36 22 37 28.5 34.5 C31 33.5 33 32 39.5 31.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/> <path d="M13.5 47.8 Q24 52 37 48.4" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round"/> <path d="M22.8 23 C23.8 26 24.2 30 23.6 33.5" stroke="#000" stroke-width="0.9" fill="none" stroke-linecap="round"/> <path d="M31.7 52.5 L31.7 61" stroke="#000" stroke-width="1.2" stroke-linecap="round"/> <circle cx="21.5" cy="41" r="1" fill="#000"/> </mask> <path d="M30.5 4.5 C33.5 1 39.5 1.5 41 6 C42 9.5 41 12.5 43 15.5 C44.8 18 44.5 21.5 42.5 23.5 C42 20.5 40 18.5 38 17.5 C39.5 14 38.5 10 36 8.5 C34 7.3 31.5 7.2 30.5 4.5Z"/> <path d="M30.2 5.5 C33.5 4 37.5 5.5 38 9.5 C38.4 12.5 36.5 15 34 15.3 C31.5 15.6 29.5 14 29 11.5 C28.6 9.5 28.8 7 30.2 5.5Z"/> <path d="M31.8 14.8 L36 14.8 L36.6 18 L31.2 18Z"/> <path d="M41 19.5 C44.5 22 45.6 27 45.3 32 C45 36 44.5 39.5 42.5 42.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/> <g mask="url(#__ID__)"> <path d="M26 18 C31 16.6 37 16.8 40 18.5 C41.8 20 42 23 41.6 26.5 C41.3 29 40.5 30.5 39.5 31.5 C34 32 31 33.5 28.5 35 C22 38 13.5 37 11 33 C9.5 30 10.5 25.5 13.5 22.5 C16 19.5 21 18.5 26 18Z"/> <path d="M14 34 C20 36.5 26 36 30 34 L40.5 31.5 C42.5 35 43 40 41.5 44 C40.5 47 38.5 48.8 36 49.5 C30 51.5 18.5 51 13 48 C8.5 45.5 7.5 40 9.5 37 C10.8 35 12 34.2 14 34Z"/> <path d="M19 49.5 C18.5 53.5 19.8 57.5 21.5 61.5 L41 61.5 C41.8 57.5 42 53.5 40.5 48.5Z"/> </g> <path d="M21 62 L30 62 L29.5 63.6 L21.5 63.6Z"/><path d="M33.5 62 L41.5 62 L41 63.6 L33.5 63.6Z"/>', m: '<mask id="__ID__"><rect width="64" height="64" fill="#fff"/> <path d="M20.5 27 C23.5 30.5 28 30.8 31 28.5 M33 28.5 C36 30.8 40.5 30.5 43.5 27" stroke="#000" stroke-width="1.1" fill="none" stroke-linecap="round"/> <path d="M14.5 46 C22 51 42 51 49.5 46" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/> <circle cx="32" cy="41" r="1.1" fill="#000"/> <path d="M28.3 13.5 C30 15 34 15 35.7 13.5" stroke="#000" stroke-width="0.7" fill="none" stroke-linecap="round"/> <path d="M32 50.5 L32 61.5" stroke="#000" stroke-width="1.3" stroke-linecap="round"/> </mask> <path mask="url(#__ID__)" d="M27 8.5 C26.3 4.5 28.8 2.2 32 2.2 C35.2 2.2 37.7 4.5 37 8.5 C37.6 9.6 37.6 11 37 12 C36.8 15 34.8 17.3 32 17.3 C29.2 17.3 27.2 15 27 12 C26.4 11 26.4 9.6 27 8.5Z"/> <path d="M29.5 16 L34.5 16 L35 18.5 L29 18.5Z"/> <path d="M14 22.5 C10.5 26.5 9.5 33 10 39 C10.3 42.5 11 45 12 47" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/> <path d="M50 22.5 C53.5 26.5 54.5 33 54 39 C53.7 42.5 53 45 52 47" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/> <g mask="url(#__ID__)"> <path d="M22 18.5 C27 17.2 37 17.2 42 18.5 C46.5 19.8 49 22.5 49 26.5 C49 29 48.5 31 49 33 C51.5 37 52 42.5 49.5 46.5 C46.5 50.5 39 51.8 32 51.8 C25 51.8 17.5 50.5 14.5 46.5 C12 42.5 12.5 37 15 33 C15.5 31 15 29 15 26.5 C15 22.5 17.5 19.8 22 18.5Z"/> <path d="M16 48 C21 51.5 43 51.5 48 48 C48.5 52.5 47.5 57.5 46.5 62 L17.5 62 C16.5 57.5 15.5 52.5 16 48Z"/> </g>' };
  let xxlIconN = 0;
  const xxlIconSvg = (g) => { const id = 'vaf-xxlm' + (xxlIconN++); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1em" height="1em" fill="currentColor" aria-hidden="true">${XXL_ICON[g === 'm' ? 'm' : 'w'].replace(/__ID__/g, id)}</svg>`; };
  const xxlName = () => mopLabel(3, true) || 'XXL';

  // ---------- Hintergrund-Suche ----------
  // Je ausgewähltem Profiltyp von 18 bis unter die Grenze, ab der dieser Typ ignoriert würde, im eingestellten
  // Radius (75 km = Suche mit 100 km, Rest verworfen). Gesucht wird „Plus-size“; vermessen wird OHNE Profilbesuch
  // über die Suchfilter (Raster aus genauer Größe × Gewichtsbändern an den BMI-Stufen, siehe measureGrid).
  async function scanXxl(ctx) {
    const res = newRes();
    if (!mopOn()) { ctx.notes && ctx.notes.push('XXL-Suche übersprungen: „Benutzer ist Moppel-Liebhaber“ ist aus.'); return res; }
    const s = S(), mp = mop(s);
    const r = +mp.radius || 0;
    const dist = r === 75 ? 100 : r;
    const base = { ...searchBase(), figure: [6] };
    const geo = G.get('mygeo', null);
    if (dist > 0 && geo) { base.location = { ...geo, distance: dist, distance_unit: 'km' }; base.distance = dist; }
    const genders = [...new Set(mp.types.map((t) => (t === 'pw' || t === 'pm' ? 'p' : t)))];
    const plan = [];
    for (const t of genders) {
      const gk = groupOf(t === 'p' ? ['w', 'm'] : [t], s);
      let lim = AGE_MAX + 1;
      if (gk && s.groups[gk].ignore) {
        const L = gk === 'p' && s.groups.p.separate ? Math.min(limitsOf('p', 'suche', 0, s)[2], limitsOf('p', 'suche', 1, s)[2]) : limitsOf(gk, 'suche', -1, s)[2];
        lim = Math.min(lim, L);
      }
      if (lim > 18) plan.push({ t, to: lim - 1 });
    }
    let found = 0, measured = 0, queries = 0;
    const stageN = [0, 0, 0, 0];
    try {
      for (let pi = 0; pi < plan.length && !ctx.stop(); pi++) {
        const p = plan[pi];
        ctx.phase && ctx.phase(`${TYPE_NAMES[p.t] || p.t} · 18–${p.to} Jahre`);
        const st = await measureGrid({ ...base, genders: [p.t], age_min: 18, age_max: p.to }, ctx, {
          src: 'XXL-Suche', figc: 6, couple: p.t === 'p',
          keep: (u) => !(r === 75 && typeof u.distance === 'number' && u.distance > 75),
          onPerson: async (m, info = {}) => {
            res.total++; scanLiveAdd({ total: 1 });
            if (!m || !mopTypeOk(m)) return;
            found++;
            const d = { xxlFound: 1 };
            const bi = bodyInfo(m);
            const sg = bi ? mopStage(bi.lo) : -1;
            if (sg >= 0) stageN[sg]++;
            if (info.known) { res.xxlKnown = (res.xxlKnown || 0) + 1; d.xxlKnown = 1; }
            else if (info.fresh) {
              res.xxlNew = (res.xxlNew || 0) + 1; d.xxlNew = 1;
              if (sg >= 1) { res['xxlNew' + sg] = (res['xxlNew' + sg] || 0) + 1; d['xxlNew' + sg] = 1; }
            }
            scanLiveAdd(d);
            msgMaybeQueue(m);
          },
        });
        measured += st.measured; queries += st.queries;
      }
    } finally { await SearchGuard.restore(); }
    res.xxlFound = found; res.xxlMeasured = measured; res.xxl1 = stageN[1]; res.xxl2 = stageN[2]; res.xxl3 = stageN[3]; res.xxlQueries = queries;
    ctx.outer && ctx.outer(1, 1);
    return res;
  }

  // ---------- Adresse ----------
  // Die Seite hängt unter /search/member#xxl (dort gibt es poppens Seitenleiste „Entdecken“ samt Suchfilter-Platz).
  // poppens eigene Suche wird auf dieser Seite unterdrückt (Ersatz-Antwort ohne Netzverkehr), damit weder eine
  // echte Suche läuft noch poppens gespeicherte Suchfilter verändert werden.
  const XXL_HASH = 'xxl';
  const XXL_PATH = '/search/member';
  function xxlPageOn() { try { return mopOn() && location.pathname.replace(/\/+$/, '') === XXL_PATH && location.hash === '#' + XXL_HASH; } catch { return false; } }
  const xxlOn = xxlPageOn;
  let xxlBlocked = 0;
  blockPageApi((method, path) => {
    if (method !== 'POST' || !/^user\/search(\/riseup)?$/.test(path) || !xxlPageOn()) return null;
    xxlBlocked++;
    return { code: 0, data: { total: 0, next_page: 0, users: [] } };
  });

  // ---------- Menüpunkt unter „Entdecken“ (nach „Popsters“) + Hervorhebung ----------
  let xxlActCls = null;      // Klassen, die poppen dem aktiven Menüpunkt gibt (gehasht, deshalb abgeguckt)
  function xxlNavActive(nav) {
    const links = [...nav.querySelectorAll('a')].filter((x) => x.querySelector('[data-type="label"]') && !x.classList.contains('vaf-xxl-link'));
    const cur = links.find((x) => (x.getAttribute('href') || '') === location.pathname);
    if (!cur) return xxlActCls;
    const others = links.filter((x) => x !== cur);
    const cls = [...cur.classList].filter((c) => others.length && others.filter((o) => o.classList.contains(c)).length <= others.length / 3);
    if (cls.length) xxlActCls = cls;
    return xxlActCls;
  }
  function xxlMenuLink() {
    const on = mopOn();
    for (const old of document.querySelectorAll('a.vaf-xxl-link')) if (!on) old.remove();
    if (!on) return;
    for (const el of document.querySelectorAll('a')) {
      const lab = el.querySelector('[data-type="label"]');
      if (!lab || norm(lab.textContent) !== 'popsters' || el.classList.contains('vaf-xxl-link')) continue;
      let a = el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('vaf-xxl-link') ? el.nextElementSibling : null;
      const seek = mopSeek();
      const nav = el.parentElement;
      if (!a) {
        a = el.cloneNode(true);
        a.removeAttribute('id'); a.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
        a.classList.add('vaf-xxl-link');
        for (const n of [a, ...a.querySelectorAll('*')]) { if (n.removeAttribute) { n.removeAttribute('aria-current'); n.removeAttribute('data-active'); } if (n.classList) for (const c of [...n.classList]) if (/active|selected|current/i.test(c)) n.classList.remove(c); }
        const ref = [...nav.querySelectorAll('a')].find((x) => x !== el && x.querySelector('[data-type="label"]') && !x.classList.contains('vaf-xxl-link') && (x.getAttribute('href') || '') !== location.pathname);
        if (ref) { a.className = ref.className + ' vaf-xxl-link'; for (const sel of ['[data-type="label"]', '[data-type="icon"]']) { const r0 = ref.querySelector(sel), x = a.querySelector(sel); if (r0 && x) x.className = r0.className; } }
        a.dataset.vafBase = a.className;
        a.setAttribute('href', XXL_PATH + '#' + XXL_HASH);
        const badge = a.querySelector('[data-type="badge"]'); if (badge) badge.remove();
        a.addEventListener('click', (e) => { e.preventDefault(); if (location.pathname.replace(/\/+$/, '') === XXL_PATH) { location.hash = XXL_HASH; xxlTick(); } else location.href = XXL_PATH + '#' + XXL_HASH; });
        el.after(a);
      }
      // Popsters ↔ XXL: Hervorhebung umsetzen (poppen markiert sonst Popsters, gleiche Adresse)
      const act = xxlNavActive(nav) || [];
      if (xxlPageOn()) {
        for (const c of act) { el.classList.remove(c); a.classList.add(c); }
        el.removeAttribute('aria-current'); a.setAttribute('aria-current', 'page');
        if (!el.dataset.vafXxlNav) {
          el.dataset.vafXxlNav = '1';
          el.addEventListener('click', (e) => { if (xxlPageOn() || xxlBlocked) { e.preventDefault(); e.stopPropagation(); location.href = XXL_PATH; } }, true);
        }
      } else {
        for (const c of act) a.classList.remove(c);
        a.removeAttribute('aria-current');
      }
      const lab2 = a.querySelector('[data-type="label"]'); if (lab2 && lab2.textContent !== xxlName()) lab2.textContent = xxlName();
      const ic = a.querySelector('[data-type="icon"]'); if (ic && ic.dataset.g !== seek) { ic.innerHTML = xxlIconSvg(seek); ic.dataset.g = seek; }
    }
  }

  // ---------- Seite (aus dem Gedächtnis, sieht aus wie die Mitgliedersuche) ----------
  const XXL_SORTS = [['dist', 'Entfernung'], ['bmi', 'BMI'], ['age', 'Alter'], ['login', 'Nach letzter Login'], ['signup', 'Nach Anmeldedatum']];
  const XXL_ZODIAC = [['1', 'Steinbock'], ['2', 'Wassermann'], ['3', 'Fische'], ['4', 'Widder'], ['5', 'Stier'], ['6', 'Zwillinge'], ['7', 'Krebs'], ['8', 'Löwe'], ['9', 'Jungfrau'], ['10', 'Waage'], ['11', 'Skorpion'], ['12', 'Schütze']];
  const XXL_SEX = [['2', 'Hetero'], ['1', 'Gay'], ['3', 'Bi'], ['4', 'bi-interessiert']];
  const XXL_REL = [['', 'Spielt keine Rolle'], ['single', 'Single'], ['taken', 'In einer Beziehung']];
  const xxlDefaults = () => ({ g: ['m', 'w', 'p', 'ts', 'tv'].filter((t) => (t === 'p' ? mop().types.some((x) => x === 'pw' || x === 'pm') : mop().types.includes(t))), age: [18, 99], radius: mop().radius, pics: false, online: false, verified: false,
    stage: 0, unclear: false, msgok: false, lf: [], rel: '', zod: '', smoker: '', sex: '', size: [130, 220], weight: [0, 300], sort: 'bmi' });
  const xxlF = () => ({ ...xxlDefaults(), ...(G.get('xxl_filter', {}) || {}) });
  let xxlCache = null;          // { at, list: [members] }
  async function xxlLoad(force = false) {
    if (!force && xxlCache && now() - xxlCache.at < 60000) return xxlCache.list;
    await Members.flush();
    const list = [];
    await Members.each((m) => {
      if (!m || !/^\d+$/.test(String(m.uid)) || !m.nick || (m.blk && !m.unblk) || m.del) return;
      if (!mopTypeOk(m)) return;
      const bi = bodyInfo(m);
      const st = bi ? mopStage(bi.lo) : -1;
      const plus = mopPlusDeclared(m);
      if (!(st >= 1 || plus)) return;            // ab poppens „Plus-Size“ aufwärts
      list.push(m);
    });
    xxlCache = { at: now(), list };
    return list;
  }
  const xxlAge = (m) => { const a = m.birth && m.birth.length ? m.birth.map((b) => ageToday(b)) : (m.ages || []); return a.filter((x) => x > 0); };
  function xxlFilter(list, f) {
    const out = [];
    for (const m of list) {
      const t = typeCode(m.g); if (!f.g.includes(t)) continue;
      const ages = xxlAge(m); if (ages.length && !ages.some((a) => a >= f.age[0] && (f.age[1] >= 99 || a <= f.age[1]))) continue;
      if (f.radius > 0) { if (!m.dist || !isFinite(m.dist.km)) { out.noDist = (out.noDist || 0) + 1; continue; } if (m.dist.km > f.radius) continue; }
      if (f.pics && isPlaceholderAvatar(m.avatar)) continue;
      if (f.online && !(m.lastLogin && now() - m.lastLogin < 15 * 60000)) continue;
      if (f.verified && m.fake !== 'done') continue;
      const bi = bodyInfo(m);
      if (!bi) { if (!f.unclear) continue; }
      else {
        const st = mopStage(bi.lo);
        if (st < f.stage || (st === 0 && !mopPlusDeclared(m))) continue;
        if (bi.h < f.size[0] || (f.size[1] < 220 && bi.h > f.size[1])) continue;
        if (bi.whi < f.weight[0] || (f.weight[1] < 300 && bi.wlo > f.weight[1])) continue;
      }
      if (f.msgok) { const r = msgOf(m); if (r && !r.ok) continue; if (!r) MsgQ.want(m.uid, m.nick); }
      if (f.lf.length && !(m.lf || []).some((c) => f.lf.includes(String(c)))) continue;
      if (f.rel && m.rel) { const single = Array.isArray(m.rel.cats) ? !m.rel.cats.length : typeof m.rel.single === 'boolean' ? m.rel.single : null; if (single !== null && (f.rel === 'single') !== single) continue; }
      const tr = m.tr || {};
      if (f.zod && !(tr.zodiac || []).map(String).includes(f.zod)) continue;
      if (f.smoker && !(tr.smoker || []).map(String).includes(f.smoker)) continue;
      if (f.sex && !(tr.sex || []).map(String).includes(f.sex)) continue;
      out.push({ m, bi, ages });
    }
    const key = { dist: (x) => (x.m.dist ? x.m.dist.km : 1e9), bmi: (x) => (x.bi ? -x.bi.lo : 1e9), age: (x) => (x.ages[0] || 999), login: (x) => -(x.m.lastLogin || 0), signup: (x) => -(x.m.signup || 0) }[f.sort] || ((x) => 0);
    out.sort((a, b) => key(a) - key(b) || (b.bi ? b.bi.wlo : 0) - (a.bi ? a.bi.wlo : 0));
    return out;
  }
  // poppens Suchfilter-Bereich in der linken Leiste (wird auf der XXL-Seite durch unsere Filter ersetzt)
  function xxlSiderSlot() {
    const aside = document.querySelector('aside[data-type="page-sider"]') || document.querySelector('aside');
    if (!aside) return null;
    const form = [...aside.querySelectorAll('form')].find((f) => /Suchfilter/.test((f.querySelector('h2') || {}).textContent || ''));
    if (!form) return null;
    const box = form.parentElement;
    return box && box.parentElement ? { box, host: box.parentElement } : null;
  }
  function xxlRoute() {
    const main = document.querySelector('main');
    let view = document.getElementById('vaf-xxl-view');
    let fbox = document.getElementById('vaf-xxl-filters');
    const restore = () => {
      if (view) view.remove();
      if (fbox) fbox.remove();
      for (const c of document.querySelectorAll('[data-vaf-xxl-hidden]')) { c.style.display = c.dataset.vafXxlHidden === '-' ? '' : c.dataset.vafXxlHidden; delete c.dataset.vafXxlHidden; }
      pkCloseDd();
    };
    if (!xxlPageOn() || !main) {
      if (view || fbox) { restore(); if (xxlBlocked) { xxlBlocked = 0; location.reload(); } }   // poppens unterdrückte Suche nachholen
      return;
    }
    const hide = (c) => { if (c.dataset.vafXxlHidden === undefined) { c.dataset.vafXxlHidden = c.style.display || '-'; c.style.display = 'none'; } };
    for (const c of main.children) if (c.id !== 'vaf-xxl-view') hide(c);
    const slot = xxlSiderSlot();
    if (slot) hide(slot.box);
    if (view && view.isConnected && (!slot || (fbox && fbox.isConnected && fbox.parentElement === slot.host))) return;
    restore();
    for (const c of main.children) hide(c);
    if (slot) hide(slot.box);
    xxlStyle();
    view = document.createElement('div'); view.id = 'vaf-xxl-view'; view.className = 'vaf-xxl vaf-pk';
    main.appendChild(view);
    fbox = document.createElement('div'); fbox.id = 'vaf-xxl-filters'; fbox.className = 'vaf-pk vaf-xxl-f';
    if (slot) slot.host.appendChild(fbox); else { view.classList.add('nosider'); view.appendChild(fbox); }
    xxlRender(view, fbox).catch((e) => warn('XXL-Seite', e));
  }
  function xxlStyle() {
    pkStyle();
    if (document.getElementById('vaf-xxl-style')) return;
    const st = document.createElement('style'); st.id = 'vaf-xxl-style';
    st.textContent = `
      .vaf-xxl{color:#e8e8e8;font-size:14px;padding:8px 0 40px;width:100%;box-sizing:border-box}
      .vaf-xxl.nosider{display:flex;gap:24px;align-items:flex-start}.vaf-xxl.nosider .vaf-xxl-f{flex:0 0 320px}.vaf-xxl.nosider .xr{flex:1;min-width:0}
      .vaf-xxl-f{padding:0 0 30px}
      .vaf-xxl-f .btns{display:flex;gap:10px;margin-top:6px}
      .vaf-xxl-f .rst{background:none;border:0;color:#f5b800;font-weight:700;font-size:16px;cursor:pointer;padding:6px 0}
      .vaf-xxl .xr{width:100%}
      .vaf-xxl .sorts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px;align-items:center}
      .vaf-xxl .sorts .chip{border:1px solid #3d3d3d;background:#1b1b1b;color:#e8e8e8;border-radius:999px;padding:7px 16px;font-size:14.5px;font-weight:600;cursor:pointer}
      .vaf-xxl .sorts .chip.on{background:#f5b800;color:#141414;border-color:#f5b800}
      .vaf-xxl .sorts .cnt{color:#9a9a9a;font-size:14px;margin-left:auto}
      .vaf-xxl .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;width:100%}
      .vaf-xxl .card{background:#1f1f1f;border-radius:16px;overflow:hidden;color:#e8e8e8;text-decoration:none;display:flex;flex-direction:column}
      .vaf-xxl .card .pic{aspect-ratio:1/1;background:#2a2a2a center/cover no-repeat;position:relative;display:flex;align-items:center;justify-content:center;font-size:42px;color:#555}
      .vaf-xxl .card .pic .ini{font-style:normal}
      .vaf-xxl .card .bd{position:absolute;left:8px;top:8px;border-radius:6px;padding:2px 7px;font-size:12px;font-weight:700;color:#fff}
      .vaf-xxl .card .tx{padding:10px 12px}.vaf-xxl .card b{display:block;color:#fff;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .vaf-xxl .card span{color:#a6a6a6;font-size:13px}
      .vaf-xxl .more{margin:18px auto;display:block}
      .vaf-xxl .hint{color:#9a9a9a;font-size:13px;margin:0 0 10px}`;
    document.head.appendChild(st);
  }
  const xxlRadiusFmt = (r) => (r ? r + ' km' : 'Weltweit');
  // Profilbilder: gespeicherte Kopie zuerst; fehlt sie, mit gültiger Adresse kopieren, sonst (abgelaufen/fehlend) die
  // Adresse gedrosselt über messenger/group/item/p2p auffrischen (kein Profilbesuch) – sichtbare Karten zuerst.
  // poppens Platzhalter wie im Profil: gemerkte Adresse, sonst nach Profiltyp
  const xxlPlaceholder = (m) => {
    if (m.avatarPh) return m.avatarPh;
    const t = typeCode(m.g);
    return `https://www.poppen.de/images/plc/jpg/de/image_null_${t === 'p' ? 'couple' : t === 'w' ? 'female' : 'male'}_300.jpg`;
  };
  const XxlPics = (() => {
    const q = [], inq = new Set();
    let busy = false, io = null;
    async function fill(card) {
      const uid = card.dataset.uid, pic = card.querySelector('.pic');
      if (!pic || pic.dataset.vafImg) return true;
      const data = await Images.get(uid).catch(() => '');
      if (data) { pic.style.backgroundImage = `url('${data}')`; pic.dataset.vafImg = '1'; const i = pic.querySelector('.ini'); if (i) i.remove(); return true; }
      return false;
    }
    async function one(uid) {
      const m = await Members.get(uid).catch(() => null);
      if (!m) return;
      let url = m.avatar;
      if (!url || isPlaceholderAvatar(url) || avatarExpired(url)) {
        if ((!url || isPlaceholderAvatar(url)) && m.avatarPh && !m.img) return;   // nie ein Bild gehabt: poppens Platzhalter genügt
        if (m.avTry && now() - m.avTry < 3 * DAY) return;
        await Members.update(uid, (x) => { x.avTry = now(); });
        if (!(await Resolver.ensureTested().catch(() => false))) return;
        const d = await Resolver.raw(uid).catch(() => null);
        const gd = d && d.group_data;
        if (!gd || String(gd.uid) !== String(uid) || !gd.avatar || isPlaceholderAvatar(gd.avatar)) return;
        await seen({ uid: String(uid), nickname: gd.nickname || m.nick, gender: gd.gender, age: gd.age, avatar: gd.avatar, payclass: gd.payclass }, 'ID-Auflösung', { images: false }).catch(() => {});
        url = gd.avatar;
      }
      if (url && !avatarExpired(url)) Images.want(uid, url);
    }
    async function pump() {
      if (busy) return; busy = true;
      try { while (q.length) { const uid = q.shift(); inq.delete(uid); try { await one(uid); } catch {} } } finally { busy = false; }
    }
    function want(uid, front) { if (inq.has(uid)) { if (front) { q.splice(q.indexOf(uid), 1); q.unshift(uid); } return; } inq.add(uid); front ? q.unshift(uid) : q.push(uid); pump(); }
    Bus.on('img', (uid) => { for (const c of document.querySelectorAll(`.vaf-xxl .card[data-uid="${uid}"]`)) fill(c); });
    return {
      async scan(grid) {
        if (!io) io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); fill(e.target).then((ok) => { if (!ok) want(e.target.dataset.uid, true); }); } }, { rootMargin: '300px' });
        for (const c of grid.querySelectorAll('.card[data-uid]')) io.observe(c);
      },
    };
  })();
  const xxlPicsFor = (grid) => { try { XxlPics.scan(grid); } catch (e) { warn('XXL-Bilder', e); } };
  async function xxlRender(view, fbox) {
    let f = xxlF();
    const save = () => { G.set('xxl_filter', f); };
    view.insertAdjacentHTML('beforeend', '<div class="xr"><div class="sorts"></div><div class="grid"></div></div>');
    const sorts = view.querySelector('.sorts'), grid = view.querySelector('.grid');
    let shown = 120;
    let list = [];
    const draw = () => {
      for (const old of view.querySelectorAll('.more')) old.remove();
      const rows = xxlFilter(list, f);
      sorts.innerHTML = XXL_SORTS.map(([k, n]) => `<span class="chip${f.sort === k ? ' on' : ''}" data-sort="${k}">${esc(n)}</span>`).join('') + `<span class="cnt">${fmtN(rows.length)} Treffer</span>` +
        (rows.noDist ? `<span class="cnt" title="poppen hat bei der Sichtung keine Entfernung angezeigt – mit gesetztem Radius lässt sich nicht prüfen, ob sie im Umkreis liegen.">${fmtN(rows.noDist)} ohne bekannte Entfernung ausgeblendet</span>` : '');
      sorts.querySelectorAll('[data-sort]').forEach((c) => c.addEventListener('click', () => { f.sort = c.dataset.sort; save(); shown = 120; draw(); }));
      grid.innerHTML = rows.slice(0, shown).map(({ m, bi, ages }) => {
        const st = bi ? mopStage(bi.lo) : -1;
        const badge = bi ? `<span class="bd" style="background:${MOP_COLORS[Math.max(0, st)]}" title="${esc(`${bi.h} cm · ${bi.exact ? bi.wlo : `${bi.wlo}–${bi.whi}`} kg${bi.pair ? ' (einer von beiden)' : ''}`)}">${esc(mopLabel(Math.max(0, st)))} · BMI ${Math.floor(bi.lo)}${bi.exact ? '' : '+'}</span>` : '<span class="bd" style="background:#555">BMI unklar</span>';
        const live = m.avatar && !isPlaceholderAvatar(m.avatar) && !avatarExpired(m.avatar);
        const ph = !live && !m.img ? xxlPlaceholder(m) : '';
        const pic = live && !m.img ? ` style="background-image:url('${esc(m.avatar)}')"` : ph ? ` style="background-image:url('${esc(ph)}')"` : '';
        const meta = [(m.g || []).map((c) => TYPE_NAMES[c] || c).join(' & ') || '', ages.length ? ages.join('/') + ' Jahre' : '', m.dist ? Math.round(m.dist.km) + ' km' : (m.city || '')].filter(Boolean).join(' · ');
        return `<a class="card" data-uid="${esc(m.uid)}" href="${esc(pathOfName(m.nick))}"><div class="pic"${pic}>${pic || m.img ? '' : `<i class="ini">${esc((m.nick || '?')[0].toUpperCase())}</i>`}${badge}</div><div class="tx"><b>${esc(m.nick)}</b><span>${esc(meta)}</span></div></a>`;
      }).join('') || `<div style="color:#a6a6a6">Keine Treffer. Die ${esc(xxlName())}-Suche im Opa-Scan füllt diese Liste.</div>`;
      xxlPicsFor(grid);
      if (rows.length > shown) { const b = document.createElement('button'); b.type = 'button'; b.className = 'vaf-btn more'; b.textContent = `Weitere ${fmtN(Math.min(120, rows.length - shown))} anzeigen`; b.addEventListener('click', () => { shown += 120; draw(); }); grid.after(b); }
    };
    const upd = () => { save(); shown = 120; draw(); };
    const buildFilters = () => {
      fbox.innerHTML = '';
      const h = document.createElement('h2'); h.className = 'vaf-pk-h'; h.textContent = 'Suchfilter'; fbox.appendChild(h);
      const add = (label, ctrl) => fbox.appendChild(pkItem(label, ctrl));
      add('Geschlecht', pkCheckGroup([['m', 'Mann'], ['w', 'Frau'], ['p', 'Paar'], ['ts', 'Trans'], ['tv', 'Nicht-binär']], f.g, (v) => { f.g = v; upd(); }));
      add('Alter', pkSlider({ min: 18, max: 99, values: f.age, onChange: (v) => { f.age = v; upd(); } }));
      fbox.appendChild(pkDivider());
      add('Radius', pkSlider({ steps: MOP_RADII, values: [f.radius], fmt: xxlRadiusFmt, marks: [[MOP_RADII[0], xxlRadiusFmt(MOP_RADII[0])], [0, 'Weltweit']], onChange: ([v]) => { f.radius = v; upd(); } }));
      fbox.appendChild(pkDivider());
      const cbs = document.createElement('div');
      cbs.append(pkCheck('Mit Bildern', f.pics, (v) => { f.pics = v; upd(); }), pkCheck('Jetzt online', f.online, (v) => { f.online = v; upd(); }), pkCheck('Nur verifiziert', f.verified, (v) => { f.verified = v; upd(); }));
      cbs.style.cssText = 'display:flex;flex-direction:column;margin-bottom:12px'; fbox.appendChild(cbs);
      fbox.appendChild(pkDivider());
      add('Figur', pkSelect([[0, MOP_STAGE0], [1, mopLabel(1)], [2, mopLabel(2)], [3, mopLabel(3)]], f.stage, (v) => { f.stage = +v; upd(); }));
      const cb2 = document.createElement('div'); cb2.style.cssText = 'display:flex;flex-direction:column;margin:-8px 0 12px';
      cb2.append(pkCheck('auch unklarer BMI', f.unclear, (v) => { f.unclear = v; upd(); }), pkCheck('nur anschreibbare', f.msgok, (v) => { f.msgok = v; upd(); }));
      fbox.appendChild(cb2);
      add('Suche nach', pkCheckGroup(SEARCHING_VALS, f.lf, (v) => { f.lf = v; upd(); }));
      add('Beziehungsstatus', pkSelect(XXL_REL, f.rel, (v) => { f.rel = v; upd(); }));
      add('Sternzeichen', pkSelect([['', 'Beliebig'], ...XXL_ZODIAC], f.zod, (v) => { f.zod = v; upd(); }));
      add('Raucher', pkSelect([['', 'Keine Angabe'], ['1', 'Ja'], ['0', 'Nein']], f.smoker, (v) => { f.smoker = v; upd(); }));
      add('Sexualität', pkSelect([['', 'Keine Angabe'], ...XXL_SEX], f.sex, (v) => { f.sex = v; upd(); }));
      add('Größe', pkSlider({ min: 130, max: 220, values: f.size, fmt: (v) => v + ' cm', marks: [[130, '130 cm'], [220, '220 cm']], onChange: (v) => { f.size = v; upd(); } }));
      add('Gewicht', pkSlider({ min: 0, max: 300, values: f.weight, fmt: (v) => v + ' kg', marks: [[0, '0 kg'], [300, '300 kg']], onChange: (v) => { f.weight = v; upd(); } }));
      const btns = document.createElement('div'); btns.className = 'btns';
      const rst = document.createElement('button'); rst.type = 'button'; rst.className = 'rst'; rst.textContent = 'Filter zurücksetzen';
      rst.addEventListener('click', () => { f = xxlDefaults(); save(); buildFilters(); draw(); });
      btns.appendChild(rst); fbox.appendChild(btns);
    };
    buildFilters();
    grid.innerHTML = '<div style="color:#a6a6a6">Lese das Gedächtnis …</div>';
    list = await xxlLoad();
    draw();
    // Neue Messungen aus einem Scan in einem anderen Tab live nachladen (Signal über den Tampermonkey-Speicher)
    let lt = null;
    const reload = () => { clearTimeout(lt); lt = setTimeout(async () => { if (!view.isConnected) return; list = await xxlLoad(true); const y = W.scrollY; draw(); W.scrollTo(0, y); }, 4000); };
    let lid = null;
    try { lid = GM_addValueChangeListener('vaf2_xxl_rev', () => reload()); } catch {}
    const iv = setInterval(() => {
      if (!view.isConnected) { clearInterval(iv); try { if (lid != null) GM_removeValueChangeListener(lid); } catch {} return; }
      if (f.msgok) draw();
    }, 8000);
  }
  function xxlTick() { try { xxlMenuLink(); xxlRoute(); } catch (e) { warn('XXL', e); } }
  function initXxl() { xxlTick(); setInterval(xxlTick, 1000); W.addEventListener('hashchange', xxlTick); }

  // =====================================================================================
  // Gemeinsame Ablage (Briefkasten), Umzug 2.32, Rettungsanker, Einstellungs-Spiegel
  // =====================================================================================

  // ---------- gzip ↔ Text (für den Rettungsanker im Tampermonkey-Speicher) ----------
  async function gzB64(str) {
    const cs = new CompressionStream('gzip');
    const buf = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
    return B64.enc(new Uint8Array(buf));
  }
  async function unGzB64(s) {
    const ds = new DecompressionStream('gzip');
    return new Response(new Blob([B64.dec(s)]).stream().pipeThrough(ds)).text();
  }

  // ---------- Fickliste: EINE Liste für alle Skripte, im Briefkasten ----------
  //  Lesen aus einem Zwischenspeicher je Tab (wird bei Änderungen aus anderen Tabs/Skripten verworfen),
  //  Schreiben mit Versionszähler: Hat ein anderes Skript den Eintrag inzwischen geändert, wird die eigene
  //  Änderung auf den neuen Stand gemischt (mergeFick) statt ihn zu überschreiben.
  //  Briefkasten nicht erreichbar → nur lesen, aus dem Rettungsanker.
  const FickStore = (() => {
    let cache = null, loading = null, readOnly = false;
    const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
    async function load() {
      try {
        const l = await BkRpc.call('all', { s: 'fick' }, 20000);
        readOnly = false;
        const m = new Map(); for (const p of l || []) if (p && !p.deleted) m.set(p.id, p);
        return m;
      } catch (e) {
        readOnly = true;
        warn('Fickliste: Briefkasten nicht erreichbar – lese den Rettungsanker', e && e.message);
        const m = new Map();
        try { const raw = G.get('mir_fick', ''); if (raw) for (const p of JSON.parse(await unGzB64(raw))) if (p && !p.deleted) m.set(p.id, p); } catch {}
        setTimeout(() => { cache = null; }, 30000);
        return m;
      }
    }
    async function ensure() { if (cache) return cache; if (!loading) loading = load().then((m) => (cache = m)).finally(() => { loading = null; }); return loading; }
    try { GM_addValueChangeListener('vaf2_bkv_fick', () => { cache = null; Bus.emit('fick'); }); } catch {}
    const by = () => ({ pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' });
    return {
      get readOnly() { return readOnly; },
      async get(id) { return clone((await ensure()).get(id)) || undefined; },
      async all() { return [...(await ensure()).values()].map(clone); },
      async put(p) {
        let c = await ensure();
        if (readOnly) throw new Error('Briefkasten nicht erreichbar – die Fickliste kann gerade nicht gespeichert werden.');
        await assertSharedWrite();
        let v = clone(p); delete v.__fromBk;
        for (let attempt = 0; attempt < 4; attempt++) {
          c = cache || c;
          const known = c.get(v.id);
          const expect = v.rev != null ? v.rev : known ? known.rev || 0 : null;
          const r = await BkRpc.call('put', { s: 'fick', v, expect, by: by() });
          if (r && r.ok) { if (cache) cache.set(v.id, r.v); p.rev = r.v.rev; p.updatedAt = r.v.updatedAt; return p; }
          const cur = r && r.conflict;
          if (!cur) throw new Error('Fickliste: Speichern fehlgeschlagen');
          if (cur.deleted) { v.rev = cur.rev; continue; }
          const merged = clone(cur);
          mergeFick(merged, v);                       // fremde Änderung behalten, eigene darauf anwenden
          for (const k of Object.keys(v)) if (!(k in merged)) merged[k] = v[k];
          merged.rev = cur.rev;
          v = merged;
          log(`Fickliste: gleichzeitige Änderung an ${v.id} zusammengeführt`);
        }
        throw new Error('Fickliste: zu viele gleichzeitige Änderungen');
      },
      async del(id) {
        await ensure();
        if (readOnly) throw new Error('Briefkasten nicht erreichbar');
        await assertSharedWrite();
        await BkRpc.call('del', { s: 'fick', k: id, by: by() });
        if (cache) cache.delete(id);
      },
      invalidate() { cache = null; },
    };
  })();

  // ---------- Kontobindung der gemeinsamen Ablage (Regelwerk 3.4) ----------
  //  Steht in tpl ein `owner` (ich-ID eines JOYclub-Kontos), der nicht unter den eigenen „Ich“-Profilen ist, gehört die
  //  Ablage einem anderen Konto: dann weder in `tpl` noch in `fick` schreiben. Ergebnis 10 Minuten gemerkt.
  const SHARED_BLOCK_MSG = 'Die gemeinsame Ablage gehört einem anderen Konto – Fickliste und Textvorlagen werden hier nicht geschrieben.';
  async function sharedOwnerCheck(force = false, remoteTpl = null) {
    if (!force && !remoteTpl && Owner.sharedAt && now() - Owner.sharedAt < 10 * 60000) return Owner.sharedOk !== false;
    let remote = remoteTpl;
    if (!remote) { try { remote = await BkRpc.call('all', { s: 'tpl' }, 20000); } catch { return Owner.sharedOk !== false; } }
    const owners = [...new Set((remote || []).map((r) => r && r.owner).filter(Boolean))];
    let ok = true;
    if (owners.length) {
      const ich = await ichList();
      const ids = new Set(ich.map((i) => i.id || `${i.pf}:${i.uid}`));
      ok = owners.every((o) => ids.has(o));
    }
    if (!ok && Owner.sharedOk !== false) warn(SHARED_BLOCK_MSG);
    Owner.sharedOk = ok; Owner.sharedAt = now();
    return ok;
  }
  async function assertSharedWrite() { if (!(await sharedOwnerCheck())) throw new Error(SHARED_BLOCK_MSG); }

  // ---------- Textvorlagen: Briefkasten = gemeinsamer Bestand, Tampermonkey-Speicher = Zwischenspeicher ----------
  // Textvorlagen in der gemeinsamen Ablage nach dem gemeinsamen Regelwerk (FORMAT.md, „Textvorlagen“):
  //  - in der Ablage in JOYclub-Schreibweise (*name*-Smileys), hier im Tampermonkey-Speicher in poppen-Schreibweise
  //  - zuletzt abgeglichene Fassung je Vorlage (tpl_remote: der Ablage-Eintrag samt rev) = „gelesen“ für expect
  //  - gleichzeitiges Schreiben (3.1): andere Seite unverändert → schreiben; nur Ergänzungen → zusammenführen;
  //    sonst gewinnt die gerade schreibende Fassung, die andere kommt in den Papierkorb
  //  - unbekannte Felder (pfIds, owner …) werden mitgeführt
  const tplKey = (t) => (t ? `${tplNameKey(t.name)}\u0001${stripSmileys(String(t.text || '')).replace(/\s+/g, '')}` : '');
  const toJoy = (txt) => translateSmileys(String(txt || ''), 'poppen', 'joyclub').text;
  const toPop = (txt) => translateSmileys(String(txt || ''), 'joyclub', 'poppen').text.slice(0, TPL_LEN);
  const tplParas = (t) => String(t || '').split(/\n\s*\n/);
  const pkey = (x) => stripSmileys(x).replace(/\s+/g, '');
  // Ist a eine reine Ergänzung von base (alle Absätze von base in Reihenfolge enthalten)? → Einfügungen je Lücke
  function tplGaps(base, a) {
    const B = tplParas(base).filter((x) => pkey(x)), A = tplParas(a);
    const gaps = Array.from({ length: B.length + 1 }, () => []);
    let j = 0;
    for (const p of A) {
      if (j < B.length && pkey(p) === pkey(B[j])) { j++; continue; }
      if (!pkey(p)) continue;
      gaps[j].push(p);
    }
    return j === B.length ? { B, gaps } : null;
  }
  // Ergänzungen beider Seiten zusammenführen (die ältere zuerst); null = keine reinen Ergänzungen
  function tplMergeAdd(base, a, b, aOlder = true) {
    const ga = tplGaps(base, a), gb = tplGaps(base, b);
    if (!ga || !gb) return null;
    const [first, second] = aOlder ? [ga, gb] : [gb, ga];
    const out = [];
    for (let i = 0; i <= ga.B.length; i++) {
      const add = [...first.gaps[i]];
      for (const p of second.gaps[i]) if (!add.some((x) => pkey(x) === pkey(p))) add.push(p);
      out.push(...add);
      if (i < ga.B.length) out.push(ga.B[i]);
    }
    return out.join('\n\n');
  }
  function tplTrashCopy(t, why) {
    if (!t) return;
    const tr = G.get('tpl_trash', []) || [];
    if (tr.some((x) => x.id === t.id && x.text === t.text && x.name === t.name)) return;     // schon drin
    tr.push({ ...t, text: t.text, deletedAt: now(), why: why || '' });
    G.set('tpl_trash', tr.filter((x) => now() - (x.deletedAt || 0) < 30 * DAY));
  }
  const TplSync = {
    pulling: false, busy: null,
    remote() { return G.get('tpl_remote', {}) || {}; },
    setRemote(m) { G.set('tpl_remote', m); },
    // Ablage-Eintrag aus lokaler Vorlage (poppen-Text → JOYclub-Schreibweise, verlustfrei, wenn unverändert)
    asRemote(t, R, force) {
      const joy = !force && R && toPop(R.text) === t.text ? R.text : toJoy(t.text);
      const { text, updatedAt, updatedBy, ...rest } = t;
      return { ...(R || {}), ...rest, id: t.id, name: t.name, text: joy };
    },
    async write(v, expect) {
      const by = { pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' };
      return BkRpc.call('put', { s: 'tpl', v, expect, by });
    },
    async push(list) {
      if (this.pulling || !Owner.mayWriteShared()) return;
      if (this.busy) return this.busy;
      this.busy = (async () => {
        const R = this.remote();
        const ids = new Set();
        const mig = !G.get('tpl_joy', 0);        // 2.34: Ablage einmalig auf JOYclub-Schreibweise umstellen
        for (const t of list || []) {
          if (!t || !t.id) continue;
          ids.add(t.id);
          const r0 = R[t.id];
          if (r0 && !r0.deleted && tplKey({ name: r0.name, text: toPop(r0.text) }) === tplKey(t) && !(mig && r0.text !== toJoy(t.text))) continue;   // unverändert
          let v = this.asRemote(t, r0, mig), expect = r0 ? r0.rev || 0 : null;
          for (let tries = 0; tries < 4; tries++) {
            let res;
            try { res = await this.write(v, expect); } catch (e) { warn('Textvorlage teilen', e && e.message); return; }
            if (res && res.ok) { R[t.id] = res.v; break; }
            const cur = res && res.conflict;
            if (!cur) break;
            // Konflikt: jemand anderes hat inzwischen geschrieben
            const base = r0 ? r0.text : '';
            if (!cur.deleted && r0 && tplKey(cur) === tplKey(r0)) { expect = cur.rev || 0; continue; }       // andere Seite unverändert
            const merged = r0 && !cur.deleted && cur.name === v.name ? tplMergeAdd(base, cur.text, v.text, true) : null;
            if (merged != null) { v = { ...cur, ...v, text: merged }; expect = cur.rev || 0; continue; }
            if (!cur.deleted) tplTrashCopy({ ...cur, text: toPop(cur.text) }, 'überschrieben');                // Schreiber gewinnt
            v = { ...cur, ...v }; expect = cur.rev || 0;
          }
          // zusammengeführten Text lokal übernehmen
          const nr = R[t.id];
          if (nr && toPop(nr.text) !== t.text && tplKey({ name: nr.name, text: toPop(nr.text) }) !== tplKey(t)) {
            const loc = getTpls(); const i = loc.findIndex((x) => x.id === t.id);
            if (i >= 0) { loc[i] = { ...loc[i], text: toPop(nr.text) }; this.pulling = true; try { setTpls(loc); } finally { this.pulling = false; } }
          }
        }
        // lokal gelöscht → Löschmarke (nur, wenn die Ablage seitdem unverändert ist)
        for (const [id, r0] of Object.entries(R)) {
          if (ids.has(id) || !r0 || r0.deleted) continue;
          let res;
          try { res = await BkRpc.call('del', { s: 'tpl', k: id, expect: r0.rev || 0, by: { pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' } }); } catch { continue; }
          if (res && res.ok) R[id] = res.v;
          else if (res && res.conflict && !res.conflict.deleted) {
            // inzwischen anderswo geändert → nicht löschen, geänderte Fassung zurückholen
            const cur = res.conflict; R[id] = cur;
            const loc = getTpls(); if (!loc.some((x) => x.id === id)) { loc.push({ ...cur, text: toPop(cur.text) }); this.pulling = true; try { setTpls(loc); } finally { this.pulling = false; } }
          }
        }
        this.setRemote(R);
        if (mig) G.set('tpl_joy', now());
      })().finally(() => { this.busy = null; });
      return this.busy;
    },
    async pull() {
      let remote;
      try { remote = await BkRpc.call('all', { s: 'tpl' }, 20000); } catch { return; }
      // Gehört die Ablage jemand anderem (owner nicht unter den eigenen „Ich“-Profilen)? → nur lesen
      if (!(await sharedOwnerCheck(true, remote || []))) return;
      if (!Owner.mayWriteShared()) return;
      const R = this.remote();
      const local = getTpls();
      const byId = new Map(local.map((t) => [t.id, t]));
      let changed = false;
      for (const r of remote || []) {
        const r0 = R[r.id], L = byId.get(r.id);
        if (r0 && (r.rev || 0) <= (r0.rev || 0)) continue;                  // nichts Neues
        const Lchanged = L && (!r0 || tplKey(L) !== tplKey({ name: r0.name, text: toPop(r0.text) }));
        if (r.deleted) {
          if (L && !Lchanged) { tplTrashCopy(L, 'anderswo gelöscht'); byId.delete(r.id); changed = true; }
          R[r.id] = r; continue;
        }
        const asLocal = (x) => { const { rev, deleted, ...t } = x; return { ...(L || {}), ...t, text: toPop(x.text) }; };
        if (!L || !Lchanged) { byId.set(r.id, asLocal(r)); changed = true; R[r.id] = r; continue; }
        // beide Seiten geändert
        if (tplKey(L) === tplKey({ name: r.name, text: toPop(r.text) })) { R[r.id] = r; continue; }
        const merged = r0 && r.name === L.name ? tplMergeAdd(r0.text, r.text, toJoy(L.text), (r.updatedAt || 0) <= (L.updatedAt || 0)) : null;
        if (merged != null) { byId.set(r.id, { ...L, text: toPop(merged) }); changed = true; R[r.id] = r; continue; }   // wird beim push geschrieben
        if ((r.updatedAt || 0) > (L.updatedAt || 0)) { tplTrashCopy(L, 'anderswo neuer'); byId.set(r.id, asLocal(r)); changed = true; R[r.id] = r; }
        else { tplTrashCopy({ ...r, text: toPop(r.text) }, 'hier neuer'); R[r.id] = r; }
      }
      this.setRemote(R);
      if (changed) { this.pulling = true; try { setTpls([...byId.values()]); } finally { this.pulling = false; } }
      await this.push(getTpls());
    },
  };

  // ---------- „Ich“: eigene Profile aller Plattformen ----------
  async function registerIch() {
    const me = Me.get(); if (!me || !me.uid) return;
    try { await BkRpc.call('put', { s: 'ich', v: { id: 'poppen:' + me.uid, pf: 'poppen', uid: String(me.uid), nick: me.nick, url: 'https://www.poppen.de' + pathOfName(me.nick), at: now() } }); } catch {}
  }
  async function ichList() {
    try { return (await BkRpc.call('all', { s: 'ich' })) || []; } catch { const me = Me.get(); return me ? [{ pf: 'poppen', uid: String(me.uid), nick: me.nick, url: 'https://www.poppen.de' + pathOfName(me.nick) }] : []; }
  }

  // ---------- Schlüssel- und Einstellungs-Kopie im Briefkasten ----------
  const GM_SKIP = /^vaf2_(lock_|rpc[qra]_|mir_|bk_|bkv_|scan_state|blk_state|search_open|search_left|dbk|qcount|tpl_pushed|mig232)/;
  async function mirrorKeyToBk() {
    const raw = Crypt.raw(); if (!raw || G.get('dbk_bk', 0)) return;
    try { await BkRpc.call('put', { s: 'meta', v: { k: 'poppen_dbk', v: raw, at: now() } }); G.set('dbk_bk', now()); } catch {}
  }
  async function mirrorSettingsToBk() {
    const data = {};
    for (const k of GM_listValues()) if (k.startsWith('vaf2_') && !GM_SKIP.test(k)) data[k] = GM_getValue(k);
    try { await BkRpc.call('put', { s: 'meta', v: { k: 'poppen_gm', at: now(), ver: VERSION, data } }); G.set('gm_bk_at', now()); } catch {}
  }
  // Neuinstallation: Tampermonkey-Speicher leer, aber Kopie im Briefkasten → anbieten
  async function offerSettingsRestore() {
    if (GM_getValue('vaf2_settings', null) || GM_getValue('vaf2_me', null) || G.get('gm_restore_asked', 0)) return;
    let r = null;
    try { r = await BkRpc.call('get', { s: 'meta', k: 'poppen_gm' }, 20000); } catch { return; }
    G.set('gm_restore_asked', now());
    if (!r || !r.data || !Object.keys(r.data).length) return;
    const ok = await ask('Frühere Einstellungen gefunden', `<p>Im Briefkasten liegt eine Kopie deiner Einstellungen und Listen vom ${esc(deDateTime(r.at))} (Version ${esc(r.ver || '?')}).</p><p>Übernehmen?</p>`,
      [{ label: 'Übernehmen', value: true, primary: true, focus: true }, { label: 'Nicht übernehmen', value: false, cancel: true }]);
    if (!ok) return;
    for (const [k, v] of Object.entries(r.data)) if (k.startsWith('vaf2_') && !GM_SKIP.test(k)) GM_setValue(k, v);
    toast('Einstellungen übernommen. Seite wird neu geladen …');
    setTimeout(() => location.reload(), 1200);
  }

  // ---------- Umzug 2.32: Altbestand → verschlüsselte Datenbank + Briefkasten ----------
  //  Läuft einmal, vor allem anderen (andere Tabs warten). Der Altbestand bleibt 14 Tage liegen, dann wird er gelöscht.
  async function migrate232() {
    const st = G.get('mig232', null);
    if (st && st.done) {
      if (st.fickPending) migrateFick232().catch(() => {});
      if (now() - st.done > 14 * DAY && !st.oldDeleted) { try { IDB.deleteDatabase(OLD_DB_NAME); G.set('mig232', { ...st, oldDeleted: now() }); log('Altbestand „opa-schutz“ gelöscht (Umzug vor 14 Tagen)'); } catch {} }
      return;
    }
    if (!(await Lock.take('mig232', 'Umzug'))) {
      for (let i = 0; i < 240 && !(G.get('mig232', null) || {}).done; i++) await sleep(500);      // anderer Tab zieht um
      return;
    }
    const tt = toast('Opa-Schutz zieht um (verschlüsselte Ablage) …', 0);
    try {
      await Crypt.init();
      const old = await openOldDb();
      const counts = {};
      if (old) {
        const readBatches = (store, fn) => new Promise((res, rej) => {
          if (!old.objectStoreNames.contains(store)) return res();
          let buf = [];
          const rq = old.transaction(store).objectStore(store).openCursor();
          rq.onsuccess = () => { const c = rq.result; if (!c) { res(buf.length ? fn(buf) : null); return; } buf.push(c.value); c.continue(); };
          rq.onerror = () => rej(rq.error);
        });
        for (const store of ['members', 'images', 'queue', 'kv', 'archive']) {
          let n = 0;
          await readBatches(store, async (all) => {
            for (let i = 0; i < all.length; i += 2000) {
              await DB.putMany(store, all.slice(i, i + 2000));
              n += Math.min(2000, all.length - i);
              tt.textContent = `Opa-Schutz zieht um: ${store} ${fmtN(n)}/${fmtN(all.length)}`;
              await sleep(0);
            }
          });
          counts[store] = n;
        }
        // Fickliste in den Briefkasten (wenn der gerade nicht erreichbar ist: beim nächsten Start)
        let fick = [];
        await readBatches('fick', (all) => { fick = all; });
        counts.fick = fick.length;
        await KV.set('mig232_fick', fick);
        old.close();
      }
      G.set('mig232', { done: now(), counts, fickPending: !!counts.fick });
      Members.cached().clear();
      if (counts.fick) await migrateFick232();
      tt.textContent = old ? `Umzug fertig: ${fmtN(counts.members || 0)} Mitglieder, ${fmtN(counts.fick || 0)} Fickliste-Einträge.` : 'Opa-Schutz bereit.';
      setTimeout(() => tt.remove(), 6000);
    } catch (e) {
      tt.textContent = 'Umzug fehlgeschlagen: ' + (e && e.message) + ' – der Altbestand bleibt unverändert, neuer Versuch beim nächsten Laden.';
      warn('Umzug 2.32', e);
      setTimeout(() => tt.remove(), 15000);
      G.del('mig232');
    } finally { Lock.release('mig232'); }
  }
  async function migrateFick232() {
    const list = await KV.get('mig232_fick', null);
    if (!list || !list.length) { const st = G.get('mig232', {}); G.set('mig232', { ...st, fickPending: false }); return; }
    await assertSharedWrite();
    await BkRpc.call('putMany', { s: 'fick', list: list.map((p) => ({ ...p, updatedAt: p.updatedAt || p.updated || now() })) }, 60000);
    await KV.set('mig232_fick', null);
    const st = G.get('mig232', {}); G.set('mig232', { ...st, fickPending: false });
    FickStore.invalidate(); Bus.emit('fick');
    log(`Fickliste in den Briefkasten übernommen: ${list.length} Einträge`);
  }

  // ---------- Rettungsanker: gepackte Kopie im Tampermonkey-Speicher ----------
  //  Mitglieder in 32 Blöcken (täglich nur geänderte, wöchentlich alle), Warteliste und Archiv täglich,
  //  Fickliste kurz nach jeder Änderung. Überlebt „Website-Daten löschen“.
  const MIR_BUCKETS = 32;
  const MIR_FIELDS = ['uid', 'nick', 'nl', 'nicks', 'g', 'ages', 'ageAt', 'birth', 'by', 'zod', 'pay', 'city', 'first', 'last', 'lastLogin', 'signup', 'dist', 'body', 'bodyUnk', 'figc', 'blk', 'unblk', 'auto', 'friend', 'pstate', 'msg', 'seen', 'del', 'avatar', 'tr', 'lf', 'fake'];
  const mirBucket = (uid) => { let h = 0; for (const c of String(uid)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % MIR_BUCKETS; };
  const mirDirty = new Set();
  let mirDirtyT = null;
  function mirMark(uid) {
    mirDirty.add(mirBucket(uid));
    clearTimeout(mirDirtyT);
    mirDirtyT = setTimeout(() => { const s2 = new Set([...(G.get('mir_dirty', []) || []), ...mirDirty]); mirDirty.clear(); G.set('mir_dirty', [...s2]); }, 5000);
  }
  async function mirrorRun(force = false) {
    const meta = G.get('mir_meta', null) || {};
    if (!force && now() - (meta.at || 0) < 20 * 3600000) return meta;
    if (!(await Lock.take('mirror', 'Rettungsanker'))) return meta;
    try {
      const full = force || now() - (meta.full || 0) > 7 * DAY;
      const dirty = new Set(full ? [...Array(MIR_BUCKETS).keys()] : (G.get('mir_dirty', []) || []));
      let n = 0;
      if (dirty.size) {
        const buckets = new Map([...dirty].map((b) => [b, []]));
        await DB.each('members', (m) => { n++; const b = mirBucket(m.uid); const arr = buckets.get(b); if (arr) { const o = {}; for (const f of MIR_FIELDS) if (m[f] !== undefined) o[f] = m[f]; arr.push(o); } });
        for (const [b, arr] of buckets) { G.set('mir_m_' + b, await gzB64(JSON.stringify(arr))); await sleep(0); }
      } else n = meta.n || 0;
      G.set('mir_dirty', []);
      G.set('mir_q', await gzB64(JSON.stringify(await DB.all('queue'))));
      // Archiv: je Mitglied nur die letzten 5 Stände
      const arch = await DB.all('archive');
      const byU = new Map(); for (const a of arch) { const l = byU.get(a.uid) || []; l.push(a); byU.set(a.uid, l); }
      const keep = []; for (const l of byU.values()) keep.push(...l.sort((x, y) => x.at - y.at).slice(-5));
      G.set('mir_arch', await gzB64(JSON.stringify(keep)));
      await mirrorFick();
      let size = 0; for (const k of GM_listValues()) if (k.startsWith('vaf2_mir_')) { const v = GM_getValue(k, ''); size += typeof v === 'string' ? v.length : 0; }
      const out = { at: now(), full: full ? now() : (meta.full || 0), n, size, fick: (G.get('mir_fick_n', 0) || 0) };
      G.set('mir_meta', out);
      return out;
    } finally { Lock.release('mirror'); }
  }
  let mirFickT = null;
  async function mirrorFick() {
    if (FickStore.readOnly) return;
    try { const l = await Fick.all(); G.set('mir_fick', await gzB64(JSON.stringify(l))); G.set('mir_fick_n', l.length); } catch (e) { warn('Rettungsanker Fickliste', e); }
  }
  // Wiederherstellen aus dem Rettungsanker
  async function mirrorRestore(silentCheck = false) {
    const meta = G.get('mir_meta', null);
    if (!meta || !meta.at) { if (!silentCheck) toast('Kein Rettungsanker vorhanden.'); return false; }
    if (silentCheck) {
      const n = await DB.count('members').catch(() => -1);
      if (n < 0 || n >= Math.max(1, (meta.n || 0) * 0.5) || G.get('mir_restore_asked', 0) > meta.at) return false;
      G.set('mir_restore_asked', now());
      const ok = await ask('Daten gelöscht?', `<p>Dein Gedächtnis ist ${n ? 'deutlich kleiner als' : 'leer, aber'} der Rettungsanker vom ${esc(deDateTime(meta.at))} enthält ${fmtN(meta.n || 0)} Mitglieder.</p><p>Wahrscheinlich wurden Website-Daten gelöscht. Aus dem Rettungsanker wiederherstellen?</p>`,
        [{ label: 'Wiederherstellen', value: true, primary: true, focus: true }, { label: 'Nein', value: false, cancel: true }]);
      if (!ok) return false;
    }
    const tt = toast('Stelle aus dem Rettungsanker wieder her …', 0);
    try {
      let n = 0;
      for (let b = 0; b < MIR_BUCKETS; b++) {
        const raw = G.get('mir_m_' + b, ''); if (!raw) continue;
        const arr = JSON.parse(await unGzB64(raw));
        const fresh = [];
        for (const x of arr) { const cur = await DB.get('members', x.uid); if (!cur || (cur.last || 0) < (x.last || 0)) fresh.push({ ...(cur || {}), ...x }); }
        await DB.putMany('members', fresh); n += fresh.length;
        tt.textContent = `Rettungsanker: Block ${b + 1}/${MIR_BUCKETS} …`;
      }
      const q = G.get('mir_q', ''); if (q) { const l = JSON.parse(await unGzB64(q)); for (const it of l) if (!(await DB.get('queue', it.uid))) await DB.put('queue', it); }
      const a = G.get('mir_arch', ''); if (a) await DB.putMany('archive', JSON.parse(await unGzB64(a)));
      const f = G.get('mir_fick', '');
      if (f) { const l = JSON.parse(await unGzB64(f)); try { await assertSharedWrite(); await BkRpc.call('putMany', { s: 'fick', list: l }, 60000); FickStore.invalidate(); } catch (e) { warn('Rettungsanker Fickliste', e); } }
      Members.cached().clear();
      tt.textContent = `Wiederhergestellt: ${fmtN(n)} Mitglieder${f ? ' und die Fickliste' : ''}.`;
      setTimeout(() => tt.remove(), 8000);
      return true;
    } catch (e) { tt.textContent = 'Wiederherstellen fehlgeschlagen: ' + (e && e.message); setTimeout(() => tt.remove(), 10000); return false; }
  }

  function initShared() {
    Bus.on('fick', () => { clearTimeout(mirFickT); mirFickT = setTimeout(() => mirrorFick(), 60000); });
    Bus.on('settings', () => { clearTimeout(initShared.st); initShared.st = setTimeout(mirrorSettingsToBk, 5000); });
    try { GM_addValueChangeListener('vaf2_bkv_tpl', () => TplSync.pull().catch(() => {})); } catch {}
    setTimeout(async () => {
      if (!(await BkRpc.waitAlive(30000))) { warn('Briefkasten nicht erreichbar – gemeinsame Ablage vorerst nur lesend'); return; }
      await offerSettingsRestore().catch(() => {});
      await mirrorKeyToBk().catch(() => {});
      await registerIch().catch(() => {});
      await TplSync.pull().catch((e) => warn('Textvorlagen abgleichen', e));
      if (now() - G.get('gm_bk_at', 0) > 6 * 3600000) mirrorSettingsToBk().catch(() => {});
    }, 4000);
    setTimeout(() => mirrorRestore(true).catch(() => {}), 15000);
    setTimeout(() => mirrorRun().catch((e) => warn('Rettungsanker', e)), 120000);
    setInterval(() => mirrorRun().catch(() => {}), 3 * 3600000);
  }

  // =====================================================================================
  // Import einer FREMDEN Fickliste (aus einem Gedächtnis-Export eines anderen Profils)
  //  Übernommen wird nur, wo man selbst „der Fick“ ist (Partner = eines der eigenen Profile aus „Ich“).
  //  Je nach eigenem und fremdem Status erscheint ein Dialog (Fälle siehe FORMAT.md / Changelog 2.32).
  // =====================================================================================
  const FS_RANK = { no: 0, want: 1, done: 2, never: 3 };
  const fiNorm = (s) => norm(String(s || ''));
  // Gehört ein Eintrag der fremden Liste zu mir? (poppen-ID/Nick oder irgendein Profil aus „Ich“, z. B. JOYclub)
  function fiIsMe(p, ich) {
    const keys = new Set(), uids = new Set(), nicks = new Set();
    for (const i of ich) { if (i.url) keys.add(linkKey({ url: i.url })); if (i.uid) uids.add(i.pf + ':' + String(i.uid)); if (i.nick) nicks.add(i.pf + ':' + fiNorm(i.nick)); }
    const profs = [...(p.profiles || [])];
    if (p.main) profs.push({ ...p.main, name: p.main.nick, url: p.main.url || (p.main.pf === 'poppen' || !p.main.pf ? 'https://www.poppen.de' + pathOfName(p.main.nick || '') : '') });
    return profs.some((x) => {
      const pf = x.pf || 'poppen';
      if (x.uid && uids.has(pf + ':' + String(x.uid))) return true;
      if ((x.name || x.nick) && nicks.has(pf + ':' + fiNorm(x.name || x.nick))) return true;
      const k = x.url ? linkKey(x) : ''; return !!(k && keys.has(k));
    });
  }
  // Ort eines Treffens zum Vergleich: Club/Ort bzw. Link
  const fiPlace = (t) => fiNorm(t.club) || (t.link ? linkKey({ url: t.link }) : '') || fiNorm(t.where);
  const fiSamePlace = (a, b) => { const pa = fiPlace(a), pb = fiPlace(b); if (!pa || !pb) return false; return pa === pb || (a.link && b.link && linkKey({ url: a.link }) === linkKey({ url: b.link })); };
  // zukünftige Termine aus der fremden Textvorlage „Termine“
  function fiTerms(tpls) {
    const t = (tpls || []).find((x) => x && !x.deletedAt && fiNorm(x.name) === 'termine');
    if (!t || typeof upcomingTerms !== 'function') return [];
    return upcomingTerms(t.text || '').list;
  }
  const fiTermsHtml = (head, terms) => (terms.length ? `<h3>${esc(head)}</h3>` + terms.map((x) => `<div class="vaf-fi-term">${esc([x.wann, x.wo].filter(Boolean).join(' · '))}${x.was ? ' · ' + (x.link ? `<a href="${esc(/^https?:/i.test(x.link) ? x.link : 'https://' + x.link)}" target="_blank" rel="noopener">${esc(x.was)} ↗</a>` : `<span>${esc(x.was)}</span>`) : (x.link ? ` · <a href="${esc(/^https?:/i.test(x.link) ? x.link : 'https://' + x.link)}" target="_blank" rel="noopener">Link ↗</a>` : '')}</div>`).join('') : '');
  function fiStyle() {
    if (document.getElementById('vaf-fi-style')) return;
    const st = document.createElement('style'); st.id = 'vaf-fi-style';
    st.textContent = `.vaf-fi-tr{display:flex;gap:10px;align-items:flex-start;background:#2a2a2a;border-radius:10px;padding:9px 12px;margin-bottom:6px}
      .vaf-fi-tr .vaf-sw{width:34px;height:19px;border-radius:10px;background:#555;position:relative;flex:none;margin-top:2px;border:0;cursor:pointer}
      .vaf-fi-tr .vaf-sw::after{content:'';position:absolute;left:2px;top:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s}
      .vaf-fi-tr .vaf-sw.on{background:#ffc21a}.vaf-fi-tr .vaf-sw.on::after{left:17px}
      .vaf-fi-tr small{display:block;color:#a6a6a6;font-size:12px}.vaf-fi-chg{background:rgba(255,194,26,.18);color:#ffd35c;border-radius:4px;padding:0 3px}
      .vaf-fi-warn{color:#ff7875;font-size:12px;display:block;margin-top:2px}
      .vaf-fi-term{padding:3px 0}.vaf-fi-term a{color:#ffc21a;text-decoration:none}.vaf-fi-term span{color:#a6a6a6}
      .vaf-fi-big{font-size:1.15em}`;
    document.head.appendChild(st);
  }
  // Treffen-Liste mit Schaltern; liefert die ausgewählten (zusammengeführten) Treffen
  function fiMeetsUi(box, cands, myAll, exporter) {
    const rows = cands.map((t) => {
      const sameDay = myAll.filter((x) => x.t.date && x.t.date === t.date);
      const same = sameDay.find((x) => fiSamePlace(x.t, t));
      const other = sameDay.find((x) => !fiSamePlace(x.t, t));
      const merged = { ...t };
      const changed = [];
      if (same) for (const f of ['time', 'where', 'club', 'link', 'note']) if (!merged[f] && same.t[f]) { merged[f] = same.t[f]; changed.push(f); }
      return { t, merged, changed, same, other, on: !other || !!same };
    });
    const fmt = (r) => {
      const v = r.merged; const c = (f, txt) => (r.changed.includes(f) ? `<span class="vaf-fi-chg">${esc(txt)}</span>` : esc(txt));
      const parts = [v.where ? 'Was: ' + c('where', v.where) : '', v.club ? 'Wo: ' + c('club', v.club) : '', v.link ? 'Link: ' + c('link', v.link.replace(/^https?:\/\//, '')) : '', v.note ? 'Notiz: ' + c('note', '„' + v.note + '“') : ''].filter(Boolean);
      return parts.join(' · ');
    };
    box.innerHTML = rows.map((r, i) => `<div class="vaf-fi-tr"><button type="button" class="vaf-sw${r.on ? ' on' : ''}" data-i="${i}"></button><div><b>${esc(r.t.date ? deDate(new Date(r.t.date + 'T12:00')) : 'ohne Datum')}${r.t.time ? ' ' + esc(r.t.time) : ''}${r.t.club || r.t.where ? ' · ' + esc(r.t.club || r.t.where) : ''}</b>
      <small>${r.same ? `Du warst laut Fickliste am selben Ort (Treffen mit ${esc(r.same.who)}) → so würde Dein neues Treffen mit ${esc(exporter)} aussehen:` : r.other ? '' : 'neu – an dem Tag hast Du nichts eingetragen'}</small>
      <small>${fmt(r)}</small>${r.other ? `<span class="vaf-fi-warn">Laut Deiner Fickliste warst Du an dem Tag woanders (${esc(r.other.t.club || r.other.t.where || 'anderer Ort')}, mit ${esc(r.other.who)}).</span>` : ''}</div></div>`).join('');
    box.querySelectorAll('.vaf-sw').forEach((b) => b.addEventListener('click', () => { const r = rows[+b.dataset.i]; r.on = !r.on; b.classList.toggle('on', r.on); }));
    return () => rows.filter((r) => r.on).map((r) => ({ ...r.merged, id: 'm' + Math.random().toString(36).slice(2, 9), pf: r.merged.pf || 'poppen', at: now(), imported: exporter }));
  }
  // Ein Dialog; liefert { status?, meets? } oder null (nichts tun)
  function fiDialog({ title, sub, terms, termsHead, meets, myAll, exporter, buttons }) {
    fiStyle();
    return new Promise((resolve) => {
      const m = modal({ title: '', closable: false });
      m.md.querySelector('.vaf-body').innerHTML = `<h2 style="margin:0 0 6px">${title}</h2>${sub ? `<div class="vaf-sub">${esc(sub)}</div>` : ''}<div data-meets></div>${fiTermsHtml(termsHead, terms)}`;
      let pick = () => [];
      if (meets && meets.length) pick = fiMeetsUi(m.body.querySelector('[data-meets]'), meets, myAll, exporter);
      m.buttons(buttons.map((b, i) => ({ label: b.label, primary: i === 0, focus: i === 0, fn: () => { m.close(); resolve(b.status === undefined && !b.meets ? null : { status: b.status, meets: b.meets ? pick() : [] }); } })), buttons.length > 1);
    });
  }
  async function fickImportForeign(persons, account, tpls) {
    const ich = await ichList();
    const me = Me.get();
    if (me && !ich.some((i) => i.pf === 'poppen' && String(i.uid) === String(me.uid))) ich.push({ pf: 'poppen', uid: String(me.uid), nick: me.nick, url: 'https://www.poppen.de' + pathOfName(me.nick) });
    const mine = (persons || []).filter((p) => p && !p.deleted && fiIsMe(p, ich));
    if (!mine.length || !account || !account.uid) return 0;
    // I: mehrfach eingetragen → zusammenfassen, höchster Status
    const foreign = { status: null, meets: [] };
    for (const p of mine) {
      if (p.status && (foreign.status == null || FS_RANK[p.status] > FS_RANK[foreign.status])) foreign.status = p.status;
      foreign.meets.push(...(p.meets || []));
    }
    if (!foreign.status && foreign.meets.length) foreign.status = 'done';      // H: ohne Status, aber mit Treffen
    if (!foreign.status || foreign.status === 'no') return 0;                    // G: „Nein, danke!“ → nichts
    const E = account.nick || ('Profil ' + account.uid);
    let own = await Fick.adopt(account.uid, account.nick).catch(() => null) || await Fick.byUid(account.uid);
    if (!own) own = await Fick.forMember(account.uid, account.nick);
    const S0 = own.status || null;
    const terms = fiTerms(tpls);
    // eigene Treffen aller Personen (für den Widerspruchs-Abgleich)
    const myAll = [];
    for (const q of await Fick.all()) for (const t of q.meets || []) myAll.push({ t, who: (q.main && q.main.nick) || (q.ext && q.ext.name) || '?', id: q.id });
    const mk = (t) => `${t.date || ''}|${fiPlace(t)}`;
    const have = new Set((own.meets || []).map(mk));
    const newMeets = foreign.meets.filter((t) => !have.has(mk(t))).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const F = foreign.status;
    const GRIN = '<span class="vaf-fi-big">😁</span>', WOW = '<span class="vaf-fi-big">😳</span>';
    const B4 = [{ label: 'Ja, gerne wieder', status: 'done', meets: true }, { label: 'Ja, einmal ist keinmal', status: 'never', meets: true }, { label: 'Im Leben nicht', status: 'no' }, { label: 'Stimmt nicht' }];
    let res = null;
    if (F === 'want') {
      if (!S0) res = await fiDialog({ title: `${esc(E)} will Dich ficken! ${GRIN}`, sub: `Du hast ${E} noch nicht in Deiner Fickliste.`, terms, termsHead: 'Hier hättet Ihr die Gelegenheit dazu:', buttons: [{ label: 'Will ich auch!', status: 'want' }, { label: 'Nein, danke!', status: 'no' }, { label: 'Mal sehen' }] });
      else if (S0 === 'want') res = await fiDialog({ title: `<b>${esc(E)} will Dich auch ficken! ${GRIN}</b>`, terms, termsHead: 'Hier hättet Ihr die Gelegenheit dazu:', buttons: [{ label: 'OK' }] });
      else if (S0 === 'done') res = await fiDialog({ title: `${esc(E)} will Dich ficken! ${GRIN}`, sub: `Ihr hattet laut Deiner Fickliste schon das Vergnügen – ${E} hat es offenbar noch nicht eingetragen.`, terms, termsHead: 'Hier hättet Ihr erneut die Gelegenheit dazu:', buttons: [{ label: 'OK' }] });
      else if (S0 === 'never') res = await fiDialog({ title: `${esc(E)} will Dich ficken! ${WOW}`, sub: '... aber eine Wiederholung ist eigentlich überflüssig.', terms, termsHead: 'Hier hättet Ihr erneut die Gelegenheit dazu:', buttons: [{ label: 'OK' }] });
      else if (S0 === 'no') res = await fiDialog({ title: `${esc(E)} will Dich ficken! ${WOW}`, sub: '... das beruht nicht auf Gegenseitigkeit.', terms, termsHead: 'Hier hättet Ihr die Gelegenheit dazu:', buttons: [{ label: 'Doch, will ich!', status: 'want' }, { label: 'Bleibt dabei' }] });
    } else {                                                                     // fremd: Gefickt / Nie wieder
      const sub0 = `${E} hat diese Treffen mit Dir eingetragen. Ausgewählte werden als eigene Treffen mit ${E} übernommen.`;
      if (!S0 || S0 === 'want') {
        res = await fiDialog({ title: `${esc(E)} hat wohl schon mit Dir gefickt!?`, sub: S0 === 'want' && F === 'never' ? '... fand es aber nicht so toll.' : sub0, meets: newMeets, myAll, exporter: E, terms, termsHead: 'Hier hättet Ihr erneut die Gelegenheit dazu:', buttons: B4 });
      } else if (S0 === 'no') {
        res = await fiDialog({ title: `${esc(E)} hat wohl schon mit Dir gefickt!? ${WOW}`, sub: `Dabei steht ${E} bei Dir auf „Nein, danke!“.`, meets: newMeets, myAll, exporter: E, terms, termsHead: 'Hier hättet Ihr erneut die Gelegenheit dazu:', buttons: B4 });
      } else {                                                                   // eigen: Gefickt / Nie wieder
        if (!newMeets.length && !terms.length) return 0;
        const sub = S0 === 'never' && F === 'never' ? `${E} fand es auch nicht so toll.` : S0 === 'done' && F === 'never' ? 'Beim nächsten Mal mehr Mühe geben!' : S0 === 'never' && F === 'done' ? 'Hätte aber nicht sein müssen ...' : 'Immer wieder gerne 😁';
        res = await fiDialog({ title: 'Erneut gelandet!', sub, meets: newMeets, myAll, exporter: E, terms, termsHead: `${E} wäre hier wieder fickbar:`,
          buttons: newMeets.length ? [{ label: 'Ja, gerne wieder', status: 'done', meets: true }, { label: 'Ja, wieder nicht aufgepasst', status: 'never', meets: true }, { label: 'Im Leben nicht', status: 'no' }, { label: 'Stimmt nicht' }] : [{ label: 'OK' }] });
      }
    }
    if (!res) return 0;
    const p = await Fick.get(own.id) || own;
    if (res.meets && res.meets.length) {
      p.meets = [...(p.meets || []), ...res.meets];
      p.history = [...(p.history || []), { at: now(), what: `${res.meets.length} Treffen aus der Fickliste von ${E} übernommen` }];
    }
    if (res.status) { await Fick.setStatus(p, res.status); }
    else if (res.meets && res.meets.length) await Fick.put(p);
    return 1;
  }
  // =====================================================================================
  // Events (poppens Gegenstück zu den JOYclub-Partys)
  //  - vorerst NUR einfärben: keine Warteliste (Blacklisting) und keine Veranstalter-Whitelist (seit 2.36)
  //  - Listen „Gehe“ (event/attendee/list) und „Vielleicht“ (event/bookmark/list): nebenbei merken und kennzeichnen,
  //    im Opa-Scan als Quelle „Partygäste“ ins Gedächtnis lesen
  //  - AWO-Faktor je Event (gemeinsame Formel mit dem JOYclub-Skript) + Plaketten auf /search/event
  //  - Event → Treffen in der Fickliste (Knopf auf der Event-Seite)
  // =====================================================================================
  const EVT_GRACE = 30 * DAY;
  const EVT_CATS = [56, 81, 132, 197];        // Stammtisch Event, Clubs, Ausstellung & Kultur, Online-Event
  const evtWhite = () => '';   // 2.36: Veranstalter-Whitelist ausgesetzt (vorher: m.auto.evt, bleibt im Gedächtnis)
  const evtInfo = new Map();                  // cms_id → event/profile-Daten (nur im Arbeitsspeicher)
  async function evtMarkCreator(ev) {
    const c = ev && ev.creator;
    if (!c || !validUid(c) || String(c.uid) === String(Me.uid())) return null;
    const u = normUser(c); if (!u) return null;
    const m = await seen(u, 'Events', { images: false });
    if (!m) return null;
    return { m, fresh: false };      // 2.36: nur merken, kein Whitelist-Vermerk mehr
  }
  // nebenbei: Event-Seiten, Event-Suche, Teilnehmerlisten
  onApi(/^event\/profile$/, async (d) => { if (d && d.cms_id) { evtInfo.set(String(d.cms_id), d); await evtMarkCreator(d); } });
  onApi(/^event\/search$/, async (d) => { for (const ev of (d && d.cms_list) || []) await evtMarkCreator(ev); });
  onApi(/^event\/(attendee|bookmark)\/list$/, (d) => seenMany(((d && d.users) || []).filter(validUid), 'Events', { images: false }));

  async function evtList(kind, cms, ctx, onUsers) {
    let page = 1, n = 0, total = 0, invisible = 0;
    for (let guard = 0; guard < 500 && !ctx.stop(); guard++) {
      const d = await apiGet(`event/${kind}/list`, { _version: 2, cms_id: cms, page, limit: 30 });
      const l = ((d && d.users) || []).filter(validUid);
      total = (d && d.total) || total; invisible = (d && d.invisible_count) || invisible;
      n += l.length;
      if (l.length) await onUsers(l);
      if (!d || !d.next_page || d.next_page === page) break;
      page = d.next_page;
      await sleep(400);
    }
    return { n, total, invisible };
  }
  async function evtAll(ctx) {
    const geo = G.get('mygeo', null);
    const out = [];
    let page = 1;
    for (let guard = 0; guard < 200 && !ctx.stop(); guard++) {
      const body = { sort: ['status', 'start_date', 'highlight'], order: ['desc', 'asc', 'desc'], category: EVT_CATS, limit: 20, page };
      if (geo && geo.city) body.location = { city: geo.city };      // ohne „distance“ = weltweit
      const d = await apiPost('event/search', body, { _version: 2 });
      const l = (d && d.cms_list) || [];
      out.push(...l);
      if (!l.length || !d.next_page || d.next_page === page) break;
      page = d.next_page;
      await sleep(400);
    }
    return out;
  }
  // Opa-Scan-Quelle „Partygäste“: alle Events weltweit (poppen hat nur wenige), je „Gehe“ + „Vielleicht“
  async function scanEvents(ctx) {
    const res = newRes();
    const me = String(Me.uid());
    ctx.phase && ctx.phase('Events laden …');
    const evs = await evtAll(ctx);
    let i = 0;
    for (const ev of evs) {
      if (ctx.stop()) break;
      i++;
      ctx.outer && ctx.outer(i - 1, evs.length);
      ctx.phase && ctx.phase(`Event ${i}/${evs.length}: ${ev.name || ev.cms_id}`);
      // nur ins Gedächtnis lesen und zählen – keine Warteliste, keine Whitelist (2.36)
      const going = [];
      let full = true, inv = 0;
      for (const kind of ['attendee', 'bookmark']) {
        try {
          const r = await evtList(kind, String(ev.cms_id), ctx, async (users) => {
            const own = users.filter((u) => String(u.uid) !== me);
            for (const u of own) await seen(u, 'Events', { images: false });
            if (kind === 'attendee') going.push(...own.map(normUser).filter(Boolean));
            addRes(res, await judge(own.map(normUser).filter(Boolean), 'Events', { enqueue: false }));
          });
          if (kind === 'attendee') { inv = r.invisible || 0; if (r.total && r.n + inv < r.total && going.length + inv < r.total) full = false; }
        } catch (e) { full = false; ctx.error && ctx.error(`Event ${ev.name || ev.cms_id}`, e); }
        if (ctx.stop()) full = false;
        await sleep(300);
      }
      if (full) awoStore(String(ev.cms_id), going, inv);
      ctx.step && ctx.step(i, evs.length, `${fmtN(i)} von ${fmtN(evs.length)} Events`);
    }
    ctx.outer && ctx.outer(evs.length, evs.length);
    return res;
  }

  // ---------- Event-Seite: Knopf „In die Fickliste“ ----------
  const evtIdOfPath = (p = location.pathname) => { const m = /\/events\/[^/]+\/[^/]+\/(\d+)\/?$/.exec(p); return m ? m[1] : ''; };
  function evtMeetFrom(ev) {
    const d = new Date(+ev.start_time || now());
    const pad = (n) => String(n).padStart(2, '0');
    const where = ev.is_online_event ? 'Online' : [ev.raw_location && !ev.raw_location.hide_location_street ? ev.raw_location.location_street : '', ev.geo_location && ev.geo_location.city].filter(Boolean).join(', ');
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, where: String(ev.name || '').trim(), club: where, link: 'https://www.poppen.de' + (ev.profile_url || location.pathname), pf: 'poppen' };
  }
  async function evtPageButton() {
    const id = evtIdOfPath();
    const old = document.getElementById('vaf-evt-fick');
    if (!id) { if (old) old.remove(); return; }
    if (old && old.dataset.id === id) return;
    const h1 = document.querySelector('main h1') || document.querySelector('h1');
    if (!h1) return;
    if (old) old.remove();
    let ev = evtInfo.get(id);
    if (!ev) { try { ev = await apiGet('event/profile', { _version: 2, cms_id: id }); if (ev) evtInfo.set(id, ev); } catch { return; } }
    if (!ev || document.getElementById('vaf-evt-fick')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'vaf-evt-fick'; b.dataset.id = id; b.className = 'vaf-btn';
    b.style.cssText = 'margin:10px 0;display:inline-flex;gap:6px;align-items:center';
    b.textContent = 'Als Treffen in die Fickliste …';
    b.title = 'Dieses Event als Treffen mit einer Person aus deiner Fickliste eintragen (Was = Event, Wo = Ort, Datum, Link)';
    b.addEventListener('click', () => evtToFick(ev).catch((e) => toast('Fickliste: ' + e.message)));
    h1.after(b);
  }
  async function evtToFick(ev) {
    const meet = evtMeetFrom(ev);
    const all = (await Fick.all()).filter((p) => !p.deleted);
    const name = (p) => (p.main && p.main.nick) || (p.ext && p.ext.name) || p.id;
    const opts = all.sort((a, b) => name(a).localeCompare(name(b), 'de')).map((p) => `<option value="${esc(p.id)}">${esc(name(p))}</option>`).join('');
    if (!all.length) { toast('Deine Fickliste ist noch leer.'); return; }
    let pid = all[0] ? all.sort((a, b) => name(a).localeCompare(name(b), 'de'))[0].id : '';
    const pr = ask('Event als Treffen eintragen', `<p><b>${esc(meet.where)}</b><br>${esc(meet.date.split('-').reverse().join('.'))} ${esc(meet.time)} · ${esc(meet.club || '')}</p>
      <p>Mit wem? <select id="vaf-evt-p" style="min-width:220px">${opts}</select></p>
      <p class="vaf-mini">Das Treffen wird bei dieser Person eingetragen. Gibt es an dem Tag schon ein Treffen mit ihr, wird es ergänzt.</p>`,
    [{ label: 'Eintragen', value: 'ok', primary: true, focus: true }, { label: 'Abbrechen', value: null, cancel: true }]);
    const sel = document.getElementById('vaf-evt-p'); if (sel) { pid = sel.value; sel.addEventListener('change', () => { pid = sel.value; }); }
    if ((await pr) !== 'ok') return;
    const p = await Fick.get(pid);
    if (!p) return;
    p.meets = p.meets || [];
    const same = p.meets.find((t) => t.date === meet.date);
    if (same) { for (const k of ['time', 'where', 'club', 'link', 'pf']) if (!same[k] && meet[k]) same[k] = meet[k]; }
    else p.meets.push({ id: 'm' + Math.random().toString(36).slice(2, 10), ...meet, at: now() });
    p.history = [...(p.history || []), { at: now(), what: `Treffen eingetragen: ${meet.where} (${meet.date})` }];
    await Fick.put(p);
    toast(`Treffen „${meet.where}“ bei ${name(p)} eingetragen.`);
  }
  // ---------- AWO-Faktor (gemeinsame Formel mit dem JOYclub-Skript) ----------
  //  Je „Gehe“-Gast: Gruppe (m/w/p) und Stufe 1–3 mit den Grenzen der Quelle „Partygäste“; Paar-Regel wie eingestellt
  //  (einer → höhere, beide → niedrigere Stufe), Sugar Daddy/Mom → 3, unbekanntes Alter → 3, Paar mit nur einem Alter →
  //  Partner ergänzt (Frau bekannt → Mann +7, Mann bekannt → Frau −7). Unsichtbare (nur Anzahl, kein Geschlecht/Alter) →
  //  Stufe 3, anteilig auf die Gruppen verteilt wie die sichtbaren Gäste. Erwartete Anwesenheit = Quote[Gruppe][Stufe].
  //  Anteil_g = Σ Quote(Stufe 3) ÷ Σ Quote; AWO = Σ w_g·Anteil_g ÷ Σ w_g (nur Gruppen mit Gästen).
  function awoStage(u, s = S()) {
    const gk = groupOf(u.g, s);
    if (!gk) return null;
    let x = { ...u, ages: (u.ages || []).filter((a) => a > 0) };
    if (!x.ages.length) return { gk, st: 3 };
    if (gk === 'p' && (u.g || []).length === 2 && x.ages.length === 1) {
      const a = x.ages[0], first = u.g[0];
      const other = first === 'w' ? a + 7 : first === 'm' ? a - 7 : a;
      x = { ...x, ages: [a, other] };
    }
    const c = classify(x, 'Partygäste', s);
    return { gk, st: c.sugar ? 3 : Math.max(1, c.stage || 3) };
  }
  function awoCalc(guests, invisible, s = S()) {
    const q = s.awo.quota, W0 = s.awo.weight, gks = ['m', 'w', 'p'];
    const exp = { m: 0, w: 0, p: 0 }, exp3 = { m: 0, w: 0, p: 0 }, cnt = { m: 0, w: 0, p: 0 };
    for (const u of guests) {
      const r = awoStage(u, s); if (!r) continue;
      const qq = (q[r.gk] || [])[r.st - 1] / 100 || 0;
      exp[r.gk] += qq; cnt[r.gk]++;
      if (r.st === 3) exp3[r.gk] += qq;
    }
    const vis = cnt.m + cnt.w + cnt.p;
    if (invisible > 0) {
      for (const g of gks) {
        const share = vis ? cnt[g] / vis : 1 / 3;
        const qq = (q[g] || [])[2] / 100 || 0;
        exp[g] += invisible * share * qq; exp3[g] += invisible * share * qq;
      }
    }
    let num = 0, den = 0;
    gks.forEach((g, i) => { if (exp[g] > 0 && (W0[i] || 0) > 0) { num += W0[i] * (exp3[g] / exp[g]); den += W0[i]; } });
    if (!den) return null;
    return Math.round((num / den) * 1000) / 10;
  }
  const awoAll = () => G.get('evt_awo', {}) || {};
  function awoStore(cms, guests, invisible) {
    const m = awoAll();
    m[cms] = { at: now(), awo: awoCalc(guests, invisible), n: guests.length, inv: invisible || 0 };
    G.set('evt_awo', m);
  }
  const AWO_COLORS = [[10, '#9ccc65', '#000000'], [25, '#43a047', '#ffffff'], [35, '#fb8c00', '#000000'], [Infinity, '#e53935', '#ffffff']];
  const awoColor = (v) => (v == null ? ['rgba(0,0,0,.75)', '#ffffff'] : AWO_COLORS.find(([t]) => v < t).slice(1));
  const deNum1 = (v) => String(v.toFixed(1)).replace('.', ',');
  const ddmmyyyy = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const OPA_MINI = () => `<svg viewBox="0 0 640 1280" width="10" height="12" fill="currentColor" style="margin-right:4px;flex:none" aria-hidden="true"><g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OLD_MAN_PATH}"/></g></svg>`;
  // Plaketten auf den Event-Karten der Event-Suche
  function awoBadges() {
    if (!/^\/search\/event/.test(location.pathname)) return;
    if (!document.getElementById('vaf-awo-style')) {
      const st = document.createElement('style'); st.id = 'vaf-awo-style';
      st.textContent = '.vaf-awo{position:absolute;right:6px;font:bold 11px system-ui,sans-serif;padding:2px 6px;border-radius:10px;z-index:5;pointer-events:none;display:inline-flex;align-items:center;white-space:nowrap;line-height:15px}';
      document.head.appendChild(st);
    }
    const all = awoAll();
    for (const a of document.querySelectorAll('a[href*="/events/"]')) {
      const m = /\/events\/[^/]+\/[^/]+\/(\d+)\/?$/.exec(a.getAttribute('href') || ''); if (!m) continue;
      const box = a.querySelector('div[style*="padding-bottom"]') || a;
      const r = all[m[1]];
      const key = r ? `${r.at}|${r.awo}` : '-';
      if (box.dataset.vafAwo === key) continue;
      box.dataset.vafAwo = key;
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
      for (const old of box.querySelectorAll('.vaf-awo')) old.remove();
      const d = document.createElement('span'); d.className = 'vaf-awo'; d.style.cssText = 'top:6px;background:rgba(0,0,0,.75);color:#fff';
      d.innerHTML = OPA_MINI() + (r ? ddmmyyyy(r.at) : '--.--.----');
      d.title = r ? `Opa-Scan zuletzt komplett: ${deDateTime(r.at)}` : 'Opa-Scan: noch nie komplett bearbeitet';
      const v = r ? r.awo : null; const [bg, fg] = awoColor(v);
      const w = document.createElement('span'); w.className = 'vaf-awo'; w.style.cssText = `top:28px;background:${bg};color:${fg}`;
      w.textContent = v == null ? 'AWO –' : `AWO ${deNum1(v)} %`;
      w.title = v == null ? 'AWO-Faktor noch nicht berechnet' : `AWO-Faktor, berechnet am ${deDateTime(r.at)}${r.inv ? ` · inkl. ${r.inv} unsichtbare Gäste (als Stufe 3)` : ''}`;
      box.append(d, w);
    }
  }
  function initEvents() { setInterval(() => { evtPageButton().catch(() => {}); try { awoBadges(); } catch (e) { warn('AWO-Plaketten', e); } }, 1500); }
  // =====================================================================================
  // Textvorlagen beim Import einer Sicherungsdatei (gemeinsames Regelwerk, Abschnitt 4)
  //  Fall A (eigenes Konto): ohne Rückfrage, mit Löschen · Fall B (Schalter „Auch Textvorlagen migrieren“):
  //  wie A, aber ohne Löschen und ohne „Termine“ · Fall C (Schalter aus): Vorlagen nie anfassen.
  //  „Gemeinsamer Stand“ = Prüfsumme (tplBaseHash) beim letzten Import dieser Vorlage, in der Datei als `base`.
  // =====================================================================================
  async function tplBaseHash(text) { return (await sha256hex(stripSmileys(String(text || '')).replace(/\s+/g, ''))).slice(0, 16); }
  const tplBases = () => G.get('tpl_base', {}) || {};
  // Export: Vorlagen in JOYclub-Schreibweise samt base; gelöschte (Löschmarken) als Liste
  async function tplExportForFile() {
    const B = tplBases();
    const out = [];
    for (const t of getTpls()) {
      const { updatedAt, updatedBy, ...rest } = t;
      out.push({ ...rest, text: toJoy(t.text), updatedAt, updatedBy, base: B[t.id] || null, hash: await tplBaseHash(t.text) });
    }
    const R = TplSync.remote();
    const deleted = Object.values(R).filter((r) => r && r.deleted).map((r) => ({ id: r.id, name: r.name, at: r.updatedAt || 0 }));
    return { list: out, deleted };
  }
  async function tplImportFile(fileT, fileDeleted, mode) {
    const report = [];
    if (!Array.isArray(fileT) || mode === 'C') return report;
    const allowDelete = mode === 'A';
    const B = { ...tplBases() };
    const loc = getTpls();
    const byId = new Map(loc.map((t) => [t.id, t]));
    const byName = new Map(loc.map((t) => [tplNameKey(t.name), t]));
    for (const f of fileT) {
      if (!f || !f.name) continue;
      const name = String(f.name).trim();
      if (mode === 'B' && /^termine$/i.test(name)) { report.push([name, 'übersprungen (Termine einer Fremddatei werden nur angezeigt)']); continue; }
      let fText = toPop(f.text);
      let cut = false;
      if (fText.length > TPL_LEN) { fText = fText.slice(0, TPL_LEN); cut = true; }
      const L = byId.get(f.id) || byName.get(tplNameKey(name));
      const fh = await tplBaseHash(fText);
      if (!L) {
        if ([...byId.values()].length >= TPL_MAX) { report.push([name, `nicht angelegt: Grenze von ${TPL_MAX} erreicht`]); continue; }
        const nt = tplEnsureMeta({ id: f.id && !byId.has(f.id) ? f.id : undefined, name, text: fText, updatedAt: now(), updatedBy: { pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' } });
        for (const k of Object.keys(f)) if (!(k in nt) && !['text', 'base', 'hash', 'rev', 'deleted'].includes(k)) nt[k] = f[k];   // unbekannte Felder mitführen
        byId.set(nt.id, nt); byName.set(tplNameKey(name), nt); B[nt.id] = fh;
        report.push([name, 'neu' + (cut ? ' (auf 8000 Zeichen gekürzt)' : '')]);
        continue;
      }
      const lh = await tplBaseHash(L.text);
      if (lh === fh) { B[L.id] = fh; report.push([name, 'gleich']); continue; }
      const common = f.base && B[L.id] && f.base === B[L.id] ? f.base : null;
      const take = (why) => { L.text = fText; L.updatedAt = now(); L.updatedBy = { pf: 'poppen', ver: VERSION, acc: (Me.get() || {}).nick || '' }; B[L.id] = fh; report.push([name, why + (cut ? ' (auf 8000 Zeichen gekürzt)' : '')]); };
      if (common && lh === common) { take('übernommen'); continue; }                       // nur die Datei hat geändert
      if (common && fh === common) { report.push([name, 'eigene Fassung neuer – bleibt']); continue; }
      // nur Ergänzungen?
      if (mode === 'A' || common) {
        if (tplGaps(L.text, fText)) { take('übernommen (Ergänzung)'); continue; }
        if (tplGaps(fText, L.text)) { B[L.id] = lh; report.push([name, 'eigene Fassung ist eine Ergänzung – bleibt']); continue; }
      }
      report.push([name, common ? 'übersprungen: beide Seiten verschieden geändert' : 'übersprungen: Text verschieden, kein gemeinsamer Stand (zum Übernehmen die eigene Vorlage vorher löschen)']);
    }
    if (allowDelete) {
      for (const del of fileDeleted || []) {
        const L = byId.get(del.id);
        if (!L) continue;
        const lh = await tplBaseHash(L.text);
        if (B[L.id] && lh === B[L.id]) { tplTrashCopy(L, 'in der Datei gelöscht'); byId.delete(L.id); delete B[L.id]; report.push([L.name, 'gelöscht (in der Datei gelöscht, hier unverändert)']); }
        else report.push([L.name, 'nicht gelöscht: hier seit dem letzten Import geändert']);
      }
    }
    G.set('tpl_base', B);
    setTpls([...byId.values()]);
    return report;
  }
  function tplReport(report, title) {
    if (!report || !report.length) return;
    ask(title || 'Textvorlagen', `<div style="max-height:55vh;overflow:auto"><table style="width:100%;border-collapse:collapse">${report.map(([n, w]) => `<tr><td style="padding:5px 10px 5px 0;color:#fff;font-weight:600;vertical-align:top">${esc(n)}</td><td style="padding:5px 0;color:#c8c8c8">${esc(w)}</td></tr>`).join('')}</table></div>`, [{ label: 'OK', value: true, primary: true }]);
  }
  // =====================================================================================
  // Gruppen-Newsfeed (/groups/feed): Quelle „Gruppen“
  //  - Verfasser (feed_list[].creator – NICHT cms_data.creator, das ist der Gruppenbesitzer) und Kommentierende merken
  //  - Beitragskasten: Rahmen in der Farbe des Verfassers; Unterzeile nach dem Nick: „· Bezeichnung · Alter“ (+ Moppel-Stufe)
  //  - Kommentare: „· Bezeichnung · Alter“ hinter dem Nick. Das Gruppenbild bleibt unverändert.
  // =====================================================================================
  onApi(/^feed\/groups$/, (d) => seenMany(((d && d.feed_list) || []).map((f) => f && f.creator).filter(validUid), 'Gruppen', { images: false }));
  onApi(/^v2\/comment\/list$/, (d) => seenMany((Array.isArray(d) ? d : []).map((c) => c && c.creator).filter(validUid), 'Gruppen', { images: false }));

  function feedTagHtml(m, nick) {
    const info = markInfo({ nick }, 'Gruppen', m);
    const parts = [];
    if (info) parts.push(`<span style="color:${info.color};font-weight:700">${esc(info.text)}</span>`);
    try {
      if (mopOn() && m && mopTypeOk(m)) {
        const bi = bodyInfo(m);
        const st = bi ? mopStage(bi.lo) : -1;
        if (bi && (st >= 1 || (st === 0 && mopPlusDeclared(m)))) parts.push(`<span style="color:${MOP_COLORS[st]};font-weight:700">${esc(mopLabel(st))} · BMI ${Math.floor(bi.lo)}${bi.exact ? '' : '+'}</span>`);
      }
    } catch {}
    return { info, html: parts.length ? ' · ' + parts.join(' · ') : '' };
  }
  function feedPutTag(after, html) {
    let t = after.nextElementSibling && after.nextElementSibling.classList.contains('vaf-feedtag') ? after.nextElementSibling : null;
    if (!html) { if (t) t.remove(); return; }
    if (!t) { t = document.createElement('span'); t.className = 'vaf-feedtag'; after.after(t); }
    if (t.innerHTML !== html) t.innerHTML = html;
  }
  let feedBusy = false;
  async function feedMark() {
    if (feedBusy || !/^\/groups\/feed/.test(location.pathname)) return;
    feedBusy = true;
    try {
      for (const it of document.querySelectorAll('main [data-index]')) {
        const sub = [...it.querySelectorAll('span.ant-typography-secondary')].find((s) => s.querySelector(':scope > a[href^="/p/"]') && s.querySelector('a[href^="/groups/"]'));
        if (!sub) continue;
        it.setAttribute('data-vaf-skip', '1');                       // nicht von der allgemeinen Listen-Markierung erfassen
        for (const old of it.querySelectorAll(':scope > .vaf-mark')) old.remove();
        const box = [...it.children].find((c) => !c.classList.contains('vaf-mark')) || it;
        const a = sub.querySelector(':scope > a[href^="/p/"]');
        const nick = (a.textContent || '').trim();
        const m = nick ? await Members.byNick(nick) : null;
        const { info, html } = feedTagHtml(m, nick);
        feedPutTag(a, html);
        if (info) { box.style.outline = `2px solid ${info.color}`; box.style.outlineOffset = '-2px'; if (!box.style.borderRadius) box.style.borderRadius = '16px'; }
        else box.style.outline = '';
        // Kommentare: Nick-Links mit Text (nicht die Avatar-Links) außerhalb der Unterzeile
        for (const ca of it.querySelectorAll('a[href^="/p/"]')) {
          if (sub.contains(ca) || !(ca.textContent || '').trim() || ca.querySelector('img')) continue;
          const cn = ca.textContent.trim();
          const cm = await Members.byNick(cn);
          feedPutTag(ca, feedTagHtml(cm, cn).html);
        }
      }
    } catch (e) { warn('Newsfeed', e); } finally { feedBusy = false; }
  }
  function initFeed() {
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => feedMark(), 300); }).observe(document.body, { childList: true, subtree: true });
    setInterval(() => feedMark(), 4000);
  }

  // =====================================================================================
  // Start
  // =====================================================================================
  loadSettings();
  if (BK_MODE === 'poppen') { installPassiveHooks(); installMsgHooks(); }

  function ensureUi() {
    try { settingsMenu(); } catch (e) { warn('Menü', e); }
    try { routeSettings(); } catch (e) { warn('Einstellungen', e); }
    try { ignoreListUi(); } catch (e) { warn('Blockierliste', e); }
    try { profileMenu(); } catch (e) { warn('Profil-Menü', e); }
    try { messengerTerms(); } catch (e) { warn('Termine', e); }
    try { templateUi(); } catch (e) { warn('Textvorlagen', e); }
    try { privacyBlockersUi(); } catch (e) { warn('Blockierende Popsters', e); }
    try { grEditorUi(); } catch (e) { warn('Regel-Editor', e); }
    grReqExtraLine().catch((e) => warn('Regel-Zusatzzeile', e));
    friendsUi();
    if (/^\/p\/[^/]+\/?$/.test(location.pathname)) {
      blockedProfileUi().catch((e) => warn('Geblocktes Profil', e));
      profilePage().catch((e) => warn('Profil', e));
      profileStateUi().catch((e) => warn('Profil-Zustand', e));
    }
    if (location.pathname === '/setting/profile') readSecondHomeFromPage();
  }

  async function init() {
    ensureStyle();
    await migrateV1().catch((e) => warn('Umstellung', e));
    if (await handleSpecialPage()) return;
    // Kontobindung: anderes oder kein Konto angemeldet → Skript bleibt komplett aus
    if (BK_MODE === 'poppen' && !(await Owner.check().catch((e) => { warn('Kontobindung', e); return true; }))) { Owner.showOff(); return; }
    bkEmbed(true);
    await migrate232().catch((e) => warn('Umzug', e));
    loadMe().then(() => { headerButton(); ageWithMe().catch((e) => warn('Grenzen altern', e)); return loadSecondHome(); }).catch(() => {});
    setInterval(() => loadMe().then(() => ageWithMe()).catch(() => {}), 3 * 3600000);
    checkReblock().catch((e) => warn('Wiedersperren', e));
    hookTrash();
    leaveGuard();
    initListPages();
    initFigur();
    SearchGuard.start();
    initGroupAuto();
    initResolver();
    initXxl();
    initEvents();
    initFeed();
    initShared();
    initGroupRequests();
    Etappe.start();
    Scan.startTimer();
    bkStartPoppen();
    headerButton();
    updateRecorderMenu();
    setInterval(headerButton, 1500);
    refreshPending().catch(() => {});
    setInterval(() => refreshPending().catch(() => {}), 5 * 60000);
    // Zahl der Blockierten gelegentlich auffrischen
    if (now() - G.get('blocked_count_at', 0) > 3600000) {
      BL.uids().then((l) => { G.set('blocked_count', l.length); G.set('blocked_count_at', now()); }).catch(() => {});
    }
    // Blockierliste nach einem Update (und wöchentlich) still ins Gedächtnis einlesen
    setTimeout(async () => {
      if (!ingestDue()) return;
      if (!(await Lock.take('blocklist', 'ingest'))) return;
      try { await ingestBlocklist(); } catch (e) { warn('Blockierliste einlesen', e); }
      finally { Lock.release('blocklist'); }
    }, 8000);
    // einmalig: alte Rekorder-Aufnahmen verwerfen (vor 2.5 unvollständig geschwärzt)
    if (!G.get('rec_cleared_25', 0)) { Recorder.clear().catch(() => {}); G.set('rec_cleared_25', now()); }
    // einmalig: verschleierte Einträge (uid ohne Nummer) aus Gedächtnis und Warteliste räumen
    if (!G.get('masked_purged', 0)) setTimeout(async () => {
      try {
        const bad = []; await Members.each((m) => { if (!/^\d+$/.test(String(m.uid))) bad.push(m.uid); });
        for (const uid of bad) { Members.cached().delete(uid); await DB.del('members', uid); }
        for (const q of await Queue.list()) if (!q.uid.startsWith('nick:') && !/^\d+$/.test(q.uid)) await Queue.remove(q.uid);
        G.set('masked_purged', now()); if (bad.length) log(`${bad.length} verschleierte Einträge entfernt.`);
      } catch (e) { warn('Aufräumen', e); }
    }, 12000);
    // Freunde und Favoriten einmal täglich vollständig einlesen
    setTimeout(async () => {
      if (now() - G.get('ff_at', 0) < DAY) return;
      if (!(await Lock.take('ff'))) return;
      try { await refreshFriendsFavs(null); } catch (e) { warn('Freunde/Favoriten', e); } finally { Lock.release('ff'); }
    }, 15000);
    // Gruppen-Whitelist einmal täglich im Hintergrund
    setTimeout(async () => {
      if (!isOn() || now() - G.get('grp_wl_at', 0) < DAY) return;
      if (!(await Lock.take('grpwl'))) return;
      try { await refreshManagedWhitelist({ stop: () => false, step: () => {}, notes: [] }); } catch (e) { warn('Gruppen-Whitelist', e); }
      finally { Lock.release('grpwl'); }
    }, 20000);
    // Nick-Abgleich der bösen Popsters einmal täglich (TM-Speicher aus dem Gedächtnis nachführen)
    setTimeout(async () => {
      if (now() - G.get('evil_sync_at', 0) < DAY) return;
      if (!(await Lock.take('evilsync'))) return;
      try { await syncEvilNames(); G.set('evil_sync_at', now()); } catch (e) { warn('Nick-Abgleich', e); } finally { Lock.release('evilsync'); }
    }, 22000);
    // „Besonders böse Popsters“ alle 30 Minuten aus der Blockierer-Liste auffüllen (ersetzt den Inhalt)
    const EVIL_EVERY = 30 * 60000;
    const evilTick = async () => {
      if (now() - G.get('evil_at', 0) < EVIL_EVERY - 5000) return;
      if (!(await Lock.take('evilblk'))) return;
      try { await refreshEvilFromBlockers(); } catch (e) { warn('Blockierer-Liste', e); } finally { Lock.release('evilblk'); }
    };
    setTimeout(evilTick, 25000);
    setInterval(evilTick, 5 * 60000);
    // Oberfläche aktuell halten (die Seite baut Teile laufend neu auf)
    let t = null;
    // entprellt, aber spätestens jede Sekunde (unruhige Seiten dürfen die Ergänzungen nicht aushungern)
    let lastUi = 0;
    const runUi = () => { lastUi = now(); ensureUi(); };
    new MutationObserver(() => {
      clearTimeout(t);
      if (now() - lastUi > 1000) runUi(); else t = setTimeout(runUi, 250);
    }).observe(document.body, { childList: true, subtree: true });
    W.addEventListener('hashchange', ensureUi);
    let last = location.pathname + location.hash;
    setInterval(() => { const cur = location.pathname + location.hash; if (cur !== last) { last = cur; ensureUi(); checkReblock().catch(() => {}); } }, 500);
    ensureUi();
    Bus.on('settings', () => { headerButton(); updateRecorderMenu(); });
    Bus.on('on', () => headerButton());
    if (S().expert.debug) W.__opaSchutz = { S, saveSettings, Members, Queue, Etappe, KV, DB, G, api, classify, Recorder, Fick, BL, Prio, G, refreshFriendsFavs, ingestUserInfo, getTpls, setTpls, openTemplates, translateSmileys, stripSmileys, tplImport, insertTemplate, bkMergeTemplate, bkMergePerson, tplTrash, tplRestore, BK_MODE, seen, judge, openScanPopup, openScanProgress, openScanOrProgress, Scan, grEval, grDecide, grConflict, grDNF, grSetRules, grRules, grUsedFields, grEditorUi, grReqExtraLine, grProbe, grMetaLine, GR_FIELDS, grOptions, scanVisitors, scanInteractions, scanGroups, scanGroupsWhite, scanGroupsBlack, groupLead, refreshEvilFromBlockers, syncEvilNames, buildEvilList, fillBlockers, privacyBlockersUi, friendsUi, discoverMenuLink, friendsProfileSection, scanSearch, scanVisitors, Me, loadMe, ageWithMe, shiftLimits, myAgeNow, projection, limitsOf, SearchGuard, searchAll, grNormRules, grMoveKid, grRuns, grMainGroups, grOpsFor, grField, GrDone, gaProcessGroup, gaSplitNote, gaRemovedNote, gaKick, Resolver, idresSelfTest, resolveMissing, profileStateUi, pstateNote, scanXxl, xxlLoad, xxlFilter, measureGrid, xxlPageOn, scanEvents, evtToFick, tplImportFile, tplExportForFile, HandleStore, readTermFile, termShare, feedMark, sharedOwnerCheck, awoCalc, awoStage, awoBadges, chatSend, insertIntoChat, tplMergeAdd, tplGaps, Owner, evtMeetFrom, evtWhite, autoWhite, pkSelect, pkSlider, blockPageApi, mopOptions, VisAuto, mopSeek, mopPick, bodyInfo, mopStage, msgOf, MsgQ, FickStore, BkRpc, Crypt, migrate232, mirrorRun, mirrorRestore, TplSync, ichList, bkServer, fickImportForeign, openOldDb, smileysToUnicode, avatarExpired, ingestBlocklist, XxlPics };
    log(`Version ${VERSION} bereit.`);
  }
  // Betriebsart (Briefkasten): nur auf poppen.de volle Funktion; auf joyclub.de passiv (nur Briefkasten einbetten);
  // im Briefkasten-iframe nur die Relais-Logik; sonst nichts.
  if (BK_MODE === 'briefkasten') {
    try { bkIframeMain(); } catch (e) { console.error('[Opa-Schutz] Briefkasten:', e); }
  } else if (BK_MODE === 'joyclub') {
    onReady(() => { try { bkEmbed(); } catch (e) { warn('Briefkasten', e); } });
  } else if (BK_MODE === 'poppen') {
    if (/^\/view\/announcement\/page\/1236\b/.test(location.pathname) && W.top === W) { try { skipRegie(); } catch {} }
    onReady(() => init().catch((e) => { console.error('[Opa-Schutz] Fehler beim Start:', e); }));
  }
})();
