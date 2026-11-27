// ==UserScript==
// @name         Swinger Companion – xHamster
// @namespace    https://github.com/Schimmelreiter/swinger-companion
// @version      0.5.0
// @description  Swinger Companion für xHamster: Opas markieren und blockieren (Regeln von poppen.de oder eigene), gemeinsame Fickliste mit Bildern und Videos für Home Assistant, Textvorlagen, ohne Werbung; Rekorder für die Testkonten
// @match        https://xhamster.com/*
// @match        https://*.xhamster.com/*
// @match        https://www.poppen.de/*
// @match        https://www.joyclub.de/*
// @match        https://schimmelreiter.github.io/briefkasten.html*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=xhamster.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// @homepageURL  https://github.com/Schimmelreiter/swinger-companion
// @updateURL    https://raw.githubusercontent.com/Schimmelreiter/swinger-companion/main/userscripts/xhamster/swinger-companion-xhamster.user.js
// @downloadURL  https://raw.githubusercontent.com/Schimmelreiter/swinger-companion/main/userscripts/xhamster/swinger-companion-xhamster.user.js
// ==/UserScript==

(function () {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const VER = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';
  const K = {
    rec: 'xh_rec', recOn: 'xh_rec_on', scan: 'xh_scan', act: 'xh_act', ha: 'xh_ha_url', partner: 'xh_partner',
    lists: 'xh_lists', opa: 'xh_opa', tests: 'xh_testmsgs', oscan: 'xh_oscan',
  };
  const now = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gm = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (e) { return d; } };
  const gs = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* voll? */ } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));


  // =====================================================================
  // Briefkasten: gemeinsame Ablage „opa-gemeinsam“ (Formatdefinition: docs/FORMAT.md) – ab 0.2.0
  // =====================================================================
  // IndexedDB auf github.io, nur im unsichtbaren Briefkasten-Rahmen geöffnet. Seite ↔ Rahmen über den eigenen
  // Tampermonkey-Speicher: Anfragen xh_rpcq_<Tab>, Antworten xh_rpcr_<Tab>, Lebenszeichen xh_rpca_<Tab>.
  // Chrome trennt den Speicher eingebetteter Seiten nach der besuchten Seite: Der Briefkasten unter xhamster.com hat
  // eine andere IndexedDB als unter poppen.de oder joyclub.de. Darum bettet dieses Skript den Briefkasten auch auf
  // poppen.de und joyclub.de ein (passiv, ohne Oberfläche) und hält eine Kopie der Ablagen im eigenen Speicher
  // (xh_bkm_<Ablage>); jeder Rahmen gleicht seine IndexedDB mit dieser Kopie ab, je Eintrag gewinnt der neuere Stand.
  const BK_URL = 'https://schimmelreiter.github.io/briefkasten.html';
  const BK_HOST = 'schimmelreiter.github.io';
  const SHARED_DB = 'opa-gemeinsam';
  const SHARED_SCHEMA = 1;
  const SHARED_STORES = { meta: { keyPath: 'k' }, fick: { keyPath: 'id' }, tpl: { keyPath: 'id' }, ich: { keyPath: 'id' }, arch: { keyPath: 'id', autoIncrement: true, index: 'uid' } };
  const VERSIONED = new Set(['fick', 'tpl']);
  const BRIDGE_STORES = ['fick', 'tpl', 'ich', 'meta'];
  // aus meta nur, was dieses Skript braucht (keine Schlüssel anderer Skripte in den eigenen Speicher)
  const META_KEEP = /^(schema|poppen_gm|termine_file|xhamster_.*)$/;
  const stable = (v) => (v === null || typeof v !== 'object') ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
    : '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  const bare = (v) => { if (!v || typeof v !== 'object') return v; const o = Object.assign({}, v); delete o.rev; return o; };
  const sameEntry = (a, b) => stable(bare(a)) === stable(bare(b));
  const tOf = (v) => Number((v && (v.updatedAt || v.at || v.updated || v.statusAt)) || 0);
  // Gewinner zweier Stände desselben Eintrags (a = IndexedDB, b = Kopie); bei gleicher Zeit fest nach Inhalt
  function bridgePick(store, a, b) {
    if (!a) return b; if (!b) return a;
    if (store === 'meta' && a.k === 'schema') return Number(b.schema || 0) > Number(a.schema || 0) ? b : a;
    const ta = tOf(a), tb = tOf(b);
    if (ta !== tb) return tb > ta ? b : a;
    return stable(bare(b)) > stable(bare(a)) ? b : a;
  }
  function xhBkServer(parentTab) {
    let dbp = null;
    const sdb = () => dbp || (dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open(SHARED_DB, 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        for (const [n, def] of Object.entries(SHARED_STORES)) {
          if (d.objectStoreNames.contains(n)) continue;
          const st = d.createObjectStore(n, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
          if (def.index) st.createIndex(def.index, def.index, { unique: false });
        }
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => { dbp = null; reject(rq.error); };
    }));
    const rp = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    let bc = null; try { bc = new BroadcastChannel('opa-gemeinsam'); bc.onmessage = (e) => { const m = e.data || {}; if (m.store) { gs('xh_bkv_' + m.store, now()); bridgeSoon(); } }; } catch (e) { /* egal */ }
    const notify = (store) => { gs('xh_bkv_' + store, now()); try { if (bc) bc.postMessage({ store, at: now(), by: 'xhamster' }); } catch (e) { /* egal */ } };
    const defBy = () => ({ pf: 'xhamster', ver: VER });
    async function op(o, a) {
      const d = await sdb();
      const store = a && a.s;
      if (store && !SHARED_STORES[store]) throw new Error('unbekannte Ablage ' + store);
      if (o === 'get') return rp(d.transaction(store).objectStore(store).get(a.k));
      if (o === 'all') return rp(d.transaction(store).objectStore(store).getAll());
      if (o === 'put' || o === 'del') {
        // Lesen und Schreiben in EINER Transaktion; versionierte Ablagen mit Versionszähler gegen gleichzeitiges Schreiben
        return new Promise((res, rej) => {
          const t = d.transaction(store, 'readwrite'); const st = t.objectStore(store);
          let out = null;
          const key = o === 'del' ? a.k : a.v[SHARED_STORES[store].keyPath];
          const doWrite = (cur) => {
            if (VERSIONED.has(store)) {
              const curRev = (cur && cur.rev) || 0;
              if ('expect' in a && a.expect !== null && a.expect !== curRev) { out = { conflict: cur }; return; }
              if ('expect' in a && a.expect === null && cur && !cur.deleted) { out = { conflict: cur }; return; }
              const v = o === 'del' ? Object.assign({}, cur || { [SHARED_STORES[store].keyPath]: key }, { deleted: true }) : Object.assign({}, a.v);
              if (o !== 'del') delete v.deleted;
              v.rev = curRev + 1; v.updatedAt = now(); v.updatedBy = a.by || defBy();
              st.put(v); out = { ok: true, rev: v.rev, v };
            } else if (o === 'del') { st.delete(key); out = { ok: true }; } else { st.put(a.v); out = { ok: true }; }
          };
          if (key === undefined || key === null) { const r = st.put(a.v); r.onsuccess = () => { out = { ok: true, id: r.result }; }; } else { const g = st.get(key); g.onsuccess = () => doWrite(g.result); }
          t.oncomplete = () => { if (out && out.ok && store !== 'meta') notify(store); if (out && out.ok) bridgeSoon(); res(out); };
          t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
        });
      }
      if (o === 'count') return rp(d.transaction(store).objectStore(store).count());
      throw new Error('unbekannter Aufruf ' + o);
    }
    (async () => { // Formatversion festhalten (nur erhöhen, nie senken)
      try { const d = await sdb(); const cur = await rp(d.transaction('meta').objectStore('meta').get('schema')); if (!cur || cur.schema < SHARED_SCHEMA) await rp(d.transaction('meta', 'readwrite').objectStore('meta').put({ k: 'schema', schema: SHARED_SCHEMA, minRead: Math.max(1, (cur && cur.minRead) || 1) })); } catch (e) { /* egal */ }
    })();
    const bmKey = (s) => 'xh_bkm_' + s;
    function bridgeWrite(d, store, list) {
      const kp = SHARED_STORES[store].keyPath, versioned = VERSIONED.has(store);
      return new Promise((res, rej) => {
        const t = d.transaction(store, 'readwrite'); const st = t.objectStore(store); let n = 0;
        for (const v of list) {
          const g = st.get(v[kp]);
          g.onsuccess = () => {
            const cur = g.result;
            if (cur && (sameEntry(cur, v) || bridgePick(store, cur, v) === cur)) return;
            const w = Object.assign({}, v);
            if (versioned) w.rev = ((cur && cur.rev) || 0) + 1;
            st.put(w); n++;
          };
        }
        t.oncomplete = () => res(n); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    }
    let bridgeBusy = false, bridgeAgain = false, bridgeTimer = 0;
    async function bridge() {
      if (bridgeBusy) { bridgeAgain = true; return; }
      bridgeBusy = true;
      try {
        do {
          bridgeAgain = false;
          const d = await sdb();
          for (const store of BRIDGE_STORES) {
            const kp = SHARED_STORES[store].keyPath;
            const local = new Map();
            for (const v of await rp(d.transaction(store).objectStore(store).getAll())) if (store !== 'meta' || META_KEEP.test(String(v[kp]))) local.set(String(v[kp]), v);
            const mir = Object.assign({}, gm(bmKey(store), {}) || {});
            const toIdb = []; let mirChanged = false;
            for (const key of new Set([...local.keys(), ...Object.keys(mir)])) {
              if (store === 'meta' && !META_KEEP.test(key)) { if (key in mir) { delete mir[key]; mirChanged = true; } continue; }
              const a = local.get(key), b = mir[key];
              if (a && b && sameEntry(a, b)) continue;
              if (bridgePick(store, a, b) === a) { mir[key] = bare(a); mirChanged = true; } else toIdb.push(b);
            }
            const n = toIdb.length ? await bridgeWrite(d, store, toIdb) : 0;
            if (mirChanged) gs(bmKey(store), mir);
            if (n && store !== 'meta') notify(store);
          }
        } while (bridgeAgain);
        gs('xh_bkm_at', now());
      } catch (e) { console.warn('[xHamster-SC] Briefkasten-Brücke', e); } finally { bridgeBusy = false; }
    }
    function bridgeSoon() { clearTimeout(bridgeTimer); bridgeTimer = setTimeout(bridge, 400); }
    for (const store of BRIDGE_STORES) { try { GM_addValueChangeListener(bmKey(store), (n, o, v, remote) => { if (remote) bridgeSoon(); }); } catch (e) { /* egal */ } }
    setTimeout(bridge, 300);
    setInterval(bridge, 60000);
    if (!parentTab) return;
    const qk = 'xh_rpcq_' + parentTab, rk = 'xh_rpcr_' + parentTab, ak = 'xh_rpca_' + parentTab;
    const doneIds = new Set();
    let busy = false, again = false;
    async function pump() {
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          for (const r of gm(qk, []) || []) {
            if (doneIds.has(r.id)) continue;
            doneIds.add(r.id);
            let ans;
            try { ans = { id: r.id, v: await op(r.op, r.args) }; } catch (e) { ans = { id: r.id, err: (e && e.message) || String(e) }; }
            const out = (gm(rk, []) || []).slice(-40); out.push(ans); gs(rk, out);
          }
        } while (again);
      } finally { busy = false; }
    }
    try { GM_addValueChangeListener(qk, () => pump()); } catch (e) { /* egal */ }
    const beat = () => gs(ak, now());
    beat(); setInterval(beat, 5000);
    setInterval(pump, 3000);
    pump();
  }
  // Rahmen in die besuchte Seite einbetten (nur im obersten Fenster, einmal je Seite)
  const TAB_ID = (() => { let t = ''; try { t = sessionStorage.getItem('xh_tab_id') || ''; if (!t) { t = now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('xh_tab_id', t); } } catch (e) { t = 'x' + now().toString(36); } return t; })();
  function bkEnsureFrame(withTab) {
    if (window.top !== window) return;
    const put = () => {
      if (document.getElementById('xhsc-briefkasten') || !document.documentElement) return;
      const f = document.createElement('iframe');
      f.id = 'xhsc-briefkasten';
      // Kennung des Tabs in „xh=“ (nicht „tab=“): sonst bedient auch der Rahmen des poppen-Skripts diesen Tab und hinterlässt Reste
      f.src = `${BK_URL}#host=${location.hostname}&xh=${withTab ? encodeURIComponent(TAB_ID) : '-'}`;
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;visibility:hidden';
      document.documentElement.appendChild(f);
    };
    if (withTab) put(); else setTimeout(put, Math.floor(Math.random() * 1500));
  }
  // Aufrufe an den eigenen Rahmen
  const SH = (() => {
    const qk = 'xh_rpcq_' + TAB_ID, rk = 'xh_rpcr_' + TAB_ID, ak = 'xh_rpca_' + TAB_ID;
    const pend = new Map();
    let seq = 0, listening = false;
    function listen() {
      if (listening) return; listening = true;
      try {
        GM_addValueChangeListener(rk, (n, o, v) => {
          const done = [];
          for (const r of v || []) { const p = pend.get(r.id); if (!p) continue; pend.delete(r.id); done.push(r.id); if (r.err) p.rej(new Error(r.err)); else p.res(r.v); }
          if (done.length) gs(qk, (gm(qk, []) || []).filter((x) => !done.includes(x.id) && pend.has(x.id)));
        });
      } catch (e) { console.warn('[xHamster-SC] Ablage', e); }
      window.addEventListener('pagehide', () => { try { GM_deleteValue(qk); GM_deleteValue(rk); GM_deleteValue(ak); } catch (e) { /* egal */ } });
    }
    const alive = () => now() - (gm(ak, 0) || 0) < 15000;
    async function call(op, args, timeout = 15000) {
      listen();
      bkEnsureFrame(true);
      const t0 = now();
      while (!alive()) { if (now() - t0 > timeout) throw new Error('Briefkasten nicht erreichbar'); await sleep(250); }
      return new Promise((res, rej) => {
        const id = (++seq) + '.' + now().toString(36);
        pend.set(id, { res, rej });
        const q = gm(qk, []) || []; q.push({ id, op, args }); gs(qk, q);
        setTimeout(() => { if (pend.has(id)) { pend.delete(id); gs(qk, (gm(qk, []) || []).filter((x) => x.id !== id)); rej(new Error('Briefkasten antwortet nicht')); } }, timeout);
      });
    }
    return { call, alive };
  })();

  // Betriebsart nach Seite
  if (location.hostname === BK_HOST) {
    const m = /[#&]xh=([^&]*)/.exec(location.hash || '');
    if (window.top !== window && /\/briefkasten\.html$/.test(location.pathname) && m) {
      const tab = decodeURIComponent(m[1]);
      try { xhBkServer(tab === '-' ? '' : tab); } catch (e) { console.warn('[xHamster-SC] Briefkasten-Ablage', e); }
    }
    return;
  }
  if (/(^|\.)(poppen|joyclub)\.de$/.test(location.hostname)) {
    // passiv: nur den Briefkasten einbetten (Abgleich der Ablagen), keine Oberfläche, keine Eingriffe
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bkEnsureFrame(false), { once: true }); else bkEnsureFrame(false);
    return;
  }
  if (window.top !== window) return;

  // =====================================================================
  // Hilfen (rein, getestet)
  // =====================================================================
  // Felder, deren Inhalt nie gespeichert wird (Zugangsdaten, Kennungen für Werbung/Statistik)
  const SECRET_K = /cookie|token|csrf|secret|passw|session|signature|^sig$|^pk$|stats_tkn|recaptcha|apikey|api_key|auth/i;
  // Felder mit Nachrichtentext: nur die Länge bleibt (Ausnahme: eigene Testnachrichten)
  const TEXT_K = /^(body|text|message|lastMessage|preview|snippet)$/i;
  // Felder, die nur Ballast sind (Werbung, Statistik, Kopfzeile)
  const DROP_K = /^(layout|gtmSettings|uiStats|bannerPrefix|bannerBottom|sponsor\w*|popunder\w*|xhlMlSource|staticDomain|redirectLandingParams|userStatsParams|ecommerceData|isServiceWorker\w*|ampServiceWorkerInstallUrl|relatedData|photoRelated\w*|bannerRightDesktopProps|momentsItemsStats)$/;
  const MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  // 0.3.0: auch IPv6 (mindestens vier Gruppen, damit Uhrzeiten wie 12:30:45 bleiben)
  const IP6_RE = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi;
  function maskStr(s) { return String(s).replace(MAIL_RE, '[mail]').replace(IP6_RE, '[ip]').replace(IP_RE, '[ip]'); }
  function maskUrl(u) {
    try {
      const x = new URL(u, location.origin);
      for (const k of [...x.searchParams.keys()]) if (SECRET_K.test(k) || /^(t|h|hash|sign|s)$/.test(k)) x.searchParams.set(k, 'x');
      return maskStr(x.origin === location.origin ? x.pathname + x.search : x.href);
    } catch (e) { return maskStr(String(u || '')); }
  }
  // Pfad → Muster (Zahlen und lange Kennungen ersetzt), damit gleiche Anfragen zusammenfallen
  function pathPattern(u) {
    let p = '';
    try { p = new URL(u, location.origin).pathname; } catch (e) { p = String(u || ''); }
    return p.replace(/\/api\/front\/batch\/[^/]+/, '/api/front/batch/{b64}').replace(/\/[0-9a-f]{20,}(?=\/|$)/gi, '/{id}').replace(/\/\d+(?=\/|$)/g, '/{n}').replace(/-\d{4,}(?=\/|$)/g, '-{n}');
  }
  function shrink(v, keep, d = 0) {
    if (d > 14) return '[…]';
    if (Array.isArray(v)) {
      const a = v.slice(0, 3).map((x) => shrink(x, keep, d + 1));
      if (v.length > 3) a.push(`[… ${v.length} Einträge]`);
      return a;
    }
    if (v && typeof v === 'object') {
      const o = {};
      let n = 0;
      for (const [k, x] of Object.entries(v)) {
        if (DROP_K.test(k)) continue;
        if (++n > 90) { o['…'] = `${Object.keys(v).length} Felder`; break; }
        if (SECRET_K.test(k)) o[k] = '[x]';
        else if (TEXT_K.test(k) && typeof x === 'string' && x) o[k] = keep && keep(x) ? x : `(Text, ${x.length} Zeichen)`;
        else o[k] = shrink(x, keep, d + 1);
      }
      return o;
    }
    if (typeof v === 'string') return maskStr(v.length > 500 ? v.slice(0, 500) + `…(${v.length})` : v);
    return v;
  }
  // Alter aus personalInfo.birthday: Unix-Sekunden (auch negativ) oder "JJJJ-MM-TT"; "0000-00-00"/fehlend → null
  function ageOf(b, at = now()) {
    let d = null;
    if (typeof b === 'number' && Number.isFinite(b)) d = new Date(b * 1000);
    else if (typeof b === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b) && !/^0000/.test(b)) d = new Date(b + 'T12:00:00Z');
    if (!d || Number.isNaN(d.getTime())) return null;
    const t = new Date(at);
    let a = t.getUTCFullYear() - d.getUTCFullYear();
    if (t.getUTCMonth() < d.getUTCMonth() || (t.getUTCMonth() === d.getUTCMonth() && t.getUTCDate() < d.getUTCDate())) a--;
    return a >= 0 && a < 120 ? a : null;
  }
  // Person aus einem userModel: alles optional
  function personOf(u) {
    if (!u || typeof u !== 'object') return null;
    const pi = u.personalInfo || {};
    return {
      id: u.id != null ? String(u.id) : '', nick: u.name || '', url: u.pageURL || '', retired: !!u.retired,
      gender: (pi.gender && pi.gender.name) || '', age: ageOf(pi.birthday), city: (pi.geo && (pi.geo.city || pi.geo.cityName)) || '',
      online: !!u.isOnline, relation: u.currentUserRelation || '', thumb: u.thumbURL || '', bday: pi.birthday != null ? pi.birthday : null,
    };
  }
  // Abstand des n-ten Neuladens nach Fehler 503: 5 s, 10 s, 20 s, 40 s … höchstens 5 Minuten, mit etwas Zufall
  function retryDelay(n, rnd = Math.random()) { return Math.round(Math.min(300000, 5000 * 2 ** Math.max(0, n - 1)) * (0.9 + 0.2 * rnd)); }
  // Text, wie xHamster ihn zeigt, mit dem Gesendeten vergleichen
  function censorDiff(sent, shown) {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const a = n(sent), b = n(shown);
    if (a === b) return '';
    const marks = [];
    if (/\*{2,}/.test(b)) marks.push('Sternchen');
    if (/exit\.php/.test(b)) marks.push('Link umgeleitet');
    if (b.length < a.length * 0.6) marks.push('gekürzt');
    return marks.join(', ') || 'geändert';
  }

  // =====================================================================
  // Rekorder
  // =====================================================================
  // 0.1.13: Rekorder nur für die Testkonten des Entwicklers (Nicks als SHA-256-Kürzel); der Menü-Schalter kann ihn
  // zusätzlich ein- oder ausschalten
  const REC_ACC = ['f3b089c35fe3edb1', '3335eb505cd61f71', 'c419378fba25fd78'];
  const recGate = () => !!gm('xh_rec_gate', false);
  const recOn = () => { const v = gm(K.recOn, null); return v === null ? recGate() : !!v; };
  async function recGateUpdate(nick) {
    if (!nick) return;
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(nick).toLowerCase()));
    const on = REC_ACC.includes([...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(''));
    if (on !== recGate()) gs('xh_rec_gate', on);
  }
  const testMsgs = () => new Set(gm(K.tests, []) || []);
  const keepText = (x) => testMsgs().has(String(x).replace(/\s+/g, ' ').trim());
  let recBuf = null, recT = 0;
  function recGet() { if (!recBuf) recBuf = gm(K.rec, null) || { started: now(), pages: {}, req: {}, dom: {}, events: [] }; return recBuf; }
  function recSave() { clearTimeout(recT); recT = setTimeout(() => { if (recBuf) { recBuf.at = now(); gs(K.rec, recBuf); recBuf = null; } }, 800); }
  function recPush(map, key, sample, max = 3, rotate = false) {
    const r = recGet();
    const l = (r[map][key] = r[map][key] || { n: 0, samples: [] });
    l.n++;
    if (l.samples.length < max) l.samples.push(sample);
    else if (rotate) { l.samples.shift(); l.samples.push(sample); }
    recSave();
  }
  function recEvent(what, data) {
    const r = recGet();
    r.events.push(Object.assign({ at: now(), page: location.pathname, what }, data || {}));
    if (r.events.length > 400) r.events.splice(0, r.events.length - 400);
    recSave();
    uiLog(what + (data && data.info ? ': ' + data.info : ''));
  }
  // Ausschnitt der Seite (ohne SVG/Bilder/Kommentare), z. B. Knöpfe vor und nach einer Aktion
  function recDom(name, el) {
    if (!el) return;
    const h = String(el.outerHTML || '').replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').replace(/<!--[\s\S]*?-->/g, '').replace(/<img[^>]*>/g, '<img/>').replace(/\s+/g, ' ');
    recPush('dom', name, { at: now(), page: location.pathname, html: maskStr(h.slice(0, 6000)) }, 4);
  }
  const SKIP_URL = /collector|\/sc\/|analytics|stats|ads?\b|banner|promo|beacon|sentry|\.(js|css|png|jpe?g|gif|webp|svg|woff2?|m3u8|ts|mp4)(\?|$)/i;
  function recReq(method, url, body, status, text, ctype) {
    if (!recOn() || !url) return;
    let host = '';
    try { host = new URL(url, location.origin).hostname; } catch (e) { return; }
    if (!/xhamster/.test(host) || SKIP_URL.test(url)) return;
    let resp = null;
    if (/json/.test(ctype || '') || /^\s*[[{]/.test(text || '')) { try { resp = shrink(JSON.parse(text), keepText); } catch (e) { resp = null; } }
    if (resp == null) resp = maskStr(String(text || '').slice(0, 1500));
    let req = null;
    if (body != null && body !== '') {
      if (typeof body === 'string') { try { req = shrink(JSON.parse(body), keepText); } catch (e) { req = shrink(Object.fromEntries(new URLSearchParams(body)), keepText); } }
      else if (typeof FormData !== 'undefined' && body instanceof W.FormData) { try { req = shrink(Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '(Datei)'])), keepText); } catch (e) { req = '(FormData)'; } }
      else req = '(' + (body.constructor && body.constructor.name) + ')';
    }
    const ops = opNames(url, body);
    const key = `${String(method || 'GET').toUpperCase()} ${host === location.hostname ? '' : host}${pathPattern(url)}${ops}`;
    // /x-api ohne erkannten Vorgang: die neuesten Beispiele behalten und festhalten, was ankam (zur Fehlersuche)
    const bare = !ops && /\/x-api\/?$/.test(pathPattern(url));
    const dbg = bare ? { urlType: typeof url, bodyType: body == null ? String(body) : typeof body, rawUrl: maskStr(String(url).slice(0, 300)) } : undefined;
    recPush('req', key, { at: now(), page: location.pathname, url: maskUrl(url), status, ctype: ctype || '', req, resp, dbg }, 3, bare);
  }
  // 0.1.1: xHamster bündelt viele Vorgänge über /x-api (Name im Rumpf oder im Parameter r) und /api/front/batch/<base64> –
  // dort nach dem Vorgang unterscheiden, sonst verdrängt die ständige Nutzerabfrage alle anderen Beispiele
  function opNames(url, body) {
    try {
      const x = new URL(url, location.origin);
      let list = null;
      if (/\/x-api\/?$/.test(x.pathname)) {
        // 0.1.6: auch GET-Anfragen tragen einen (leeren) Text-Rumpf – erst den Rumpf, dann den Parameter r versuchen
        for (const raw of [typeof body === 'string' ? body : '', x.searchParams.get('r')]) {
          if (!raw) continue;
          try { list = JSON.parse(raw); } catch (e) { continue; }
          const names = (Array.isArray(list) ? list : [list]).map((o) => o && o.name).filter(Boolean);
          if (names.length) return ' ' + [...new Set(names)].join('+');
        }
        return '';
      }
      const m = /\/api\/front\/batch\/([^/?#]+)/.exec(x.pathname);
      if (m) {
        list = JSON.parse(atob(decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/')));
        const urls = (Array.isArray(list) ? list : []).map((o) => o && o.url && pathPattern(o.url)).filter(Boolean);
        return urls.length ? ' → ' + [...new Set(urls)].join('+') : '';
      }
      // 0.1.12: übrige JSON-Anfragen nach Art des Vorgangs trennen (action, items[].state), sonst verdrängt z. B.
      // „Nachricht senden“ das „Löschen“ an derselben Adresse
      if (typeof body === 'string' && /^\s*[[{]/.test(body)) {
        const o = JSON.parse(body);
        const parts = [];
        if (o && typeof o.action === 'string') parts.push('action=' + o.action);
        const st = o && Array.isArray(o.items) ? [...new Set(o.items.map((x) => x && x.state).filter((x) => typeof x === 'string'))] : [];
        if (st.length) parts.push('state=' + st.join('+'));
        return parts.length ? ' ' + parts.join(' ') : '';
      }
    } catch (e) { /* egal */ }
    return '';
  }
  function hookNetwork() {
    try {
      const of = W.fetch;
      if (of && !of.__xhRec) {
        const nf = function (input, init) {
          const url = typeof input === 'string' ? input : (input && typeof input.url === 'string' && input.url) || String((input && input.href) || input || '');
          const method = (init && init.method) || (input && input.method) || 'GET';
          const body = init && init.body;
          if (/\/x-api(\?|$)/.test(url) && /post/i.test(method)) captureHdr((init && init.headers) || (input && input.headers));
          mediaUrlSeen(url);
          const p = of.apply(this, arguments);
          p.then((res) => { try { res.clone().text().then((t) => { recReq(method, url, body, res.status, t, res.headers.get('content-type')); ingest(url, t); }).catch(() => {}); } catch (e) { /* egal */ } }).catch(() => {});
          return p;
        };
        nf.__xhRec = true;
        W.fetch = nf;
      }
    } catch (e) { /* egal */ }
    try {
      const XP = W.XMLHttpRequest.prototype;
      if (!XP.__xhRec) {
        const oo = XP.open, os = XP.send, oh = XP.setRequestHeader;
        XP.open = function (m, u) { this.__xhm = m; this.__xhu = String((u && u.href) || u || ''); this.__xhh = {}; mediaUrlSeen(this.__xhu); return oo.apply(this, arguments); };
        XP.setRequestHeader = function (k, v) { try { if (this.__xhh) this.__xhh[k] = v; } catch (e) { /* egal */ } return oh.apply(this, arguments); };
        XP.send = function (b) {
          const x = this;
          try { if (/\/x-api(\?|$)/.test(x.__xhu || '') && /post/i.test(x.__xhm || '')) captureHdr(x.__xhh); } catch (e) { /* egal */ }
          try {
            x.addEventListener('loadend', () => {
              try {
                const t = x.responseType === '' || x.responseType === 'text' ? x.responseText : x.responseType === 'json' ? JSON.stringify(x.response) : '';
                recReq(x.__xhm, x.__xhu, b, x.status, t, x.getResponseHeader('content-type'));
                ingest(x.__xhu, t);
              } catch (e) { /* egal */ }
            });
          } catch (e) { /* egal */ }
          return os.apply(this, arguments);
        };
        XP.__xhRec = true;
      }
    } catch (e) { /* egal */ }
  }
  // nachgeladene Personen (Dating „mehr“, Nachrichtenliste, Freunde Seite 2 …) für die Markierung merken
  function ingest(url, t) {
    if (!t || t.length > 3e6 || !/^\s*[[{]/.test(t)) return;
    try { if (!/xhamster/.test(new URL(url, location.origin).hostname)) return; } catch (e) { return; }
    try { peopleWalk(JSON.parse(t)); } catch (e) { /* egal */ }
  }
  const routeName = () => { const m = document.querySelector('meta[name="sentry-route-name"]'); try { return m ? decodeURIComponent(m.content) : pathPattern(location.href); } catch (e) { return pathPattern(location.href); } };
  const initials = () => { try { return W.initials || null; } catch (e) { return null; } };
  function recPage() {
    if (!recOn()) return;
    const ini = initials();
    const route = routeName();
    recPush('pages', route, { at: now(), url: maskUrl(location.href), htmlClass: document.documentElement.className, initials: ini ? shrink(ini, keepText) : null }, 2);
  }
  // Wer ist angemeldet?
  let meLive = false;   // 0.5.0: Konto steht auf dieser Seite (nicht nur gespeichert) – für die Kontobindung
  function me() {
    const ini = initials() || {};
    let u = null;
    try { u = ini.layout.headerWrapperProps.headerDesktopProps.userHeadProps.user; } catch (e) { u = null; }
    if (!u) try { u = ini.commentsComponent.authorizedUser; } catch (e) { u = null; }
    if (u && u.id) { meLive = true; const r = { id: String(u.id), nick: u.name || '' }; gs('xh_me', r); try { if (u.personalInfo && u.personalInfo.gender && u.personalInfo.gender.name) gs('xh_me_gender', u.personalInfo.gender.name); if (u.personalInfo && u.personalInfo.birthday != null) gs('xh_me_bday', u.personalInfo.birthday); } catch (e) { /* egal */ } recGateUpdate(r.nick).catch(() => {}); return r; }
    return gm('xh_me', null);
  }
  function partner() {
    const p = gm(K.partner, '');
    if (p) return p;
    const m = me();
    // erste Fassung: die beiden Testkonten des Nutzers (bewusst öffentlich, siehe Changelog 0.1.0)
    if (m && /^(sizequeenac|wildschwein_ac)$/i.test(m.nick)) return 'SpaceRat75';
    if (m && /^spacerat75$/i.test(m.nick)) return 'SizeQueenAC';
    return '';
  }

  // =====================================================================
  // Anzeige: kleiner Kasten unten rechts (Fortschritt, Protokoll, Abbrechen)
  // =====================================================================
  let box = null;
  const logLines = [];
  function uiBox() {
    if (box && box.isConnected) return box;
    if (!document.body) return null;
    box = document.createElement('div');
    box.id = 'xhsc-box';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483646;width:360px;max-height:50vh;overflow:auto;background:#1f2125;color:#eee;border:1px solid #444;border-radius:10px;font:12.5px/1.4 system-ui,sans-serif;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.5)';
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>Swinger Companion · xHamster</b><span><button data-a="stop" style="background:#c62828;color:#fff;border:0;border-radius:6px;padding:2px 8px;cursor:pointer">Abbrechen</button> <button data-a="hide" style="background:#444;color:#fff;border:0;border-radius:6px;padding:2px 8px;cursor:pointer">✕</button></span></div><div data-s style="margin:6px 0;color:#9ec5ff"></div><div data-l style="white-space:pre-wrap;font:11.5px/1.35 ui-monospace,monospace;color:#bbb"></div>';
    box.querySelector('[data-a=stop]').onclick = () => { gs(K.scan, null); gs(K.act, null); gs(K.oscan, null); gs('xh_iscan', null); uiStatus('Abgebrochen.'); };
    box.querySelector('[data-a=hide]').onclick = () => box.remove();
    document.body.appendChild(box);
    return box;
  }
  function uiStatus(t) { const b = uiBox(); if (b) b.querySelector('[data-s]').textContent = t; }
  function uiLog(t) {
    logLines.push(new Date().toLocaleTimeString() + ' ' + t);
    if (logLines.length > 60) logLines.shift();
    const b = (gm(K.scan, null) || gm(K.act, null) || gm(K.oscan, null)) ? uiBox() : box;
    if (b && b.isConnected) b.querySelector('[data-l]').textContent = logLines.join('\n');
  }

  // =====================================================================
  // DOM-Hilfen für Scan und Aktionstest
  // =====================================================================
  const visible = (e) => !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.xh-helper-hidden');
  async function waitFor(fn, ms = 10000, step = 250) {
    const t0 = now();
    while (now() - t0 < ms) { let r = null; try { r = fn(); } catch (e) { r = null; } if (r) return r; await sleep(step); }
    return null;
  }
  function click(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* egal */ }
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: W }));
    el.click();
    return true;
  }
  const sameNick = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const itemNick = (it) => { const a = it.querySelector('.info-line a[href*="/users/"], .info-line .retired'); return a ? a.textContent.trim() : ''; };
  // Bestätigungsdialog nach einem Klick (falls einer kommt)
  async function confirmDialog(name) {
    const btn = await waitFor(() => [...document.querySelectorAll('button, a.xh-button, [role=button]')].find((b) => visible(b) && /^(yes|ok|delete|remove|unfriend|confirm|block|unblock|ja|löschen|entfernen)$/i.test(b.textContent.trim()) && b.closest('[role=dialog], .modal, .popup, .xh-popup, .dialog, [class*="modal"], [class*="popup"], [class*="dialog"]')), 2500);
    if (btn) { recDom(name + ': Dialog', btn.closest('[role=dialog], .modal, .popup, .xh-popup, .dialog, [class*="modal"], [class*="popup"], [class*="dialog"]')); click(btn); return true; }
    return false;
  }
  async function scrollThrough() {
    for (let i = 0; i < 6; i++) { W.scrollTo(0, document.body.scrollHeight); await sleep(700); }
    W.scrollTo(0, 0);
  }
  const go = (url) => { location.assign(url); };
  const abs = (u) => new URL(u, location.origin).href;
  const profileUrl = (nick) => abs('/users/' + encodeURIComponent(String(nick).toLowerCase()));
  // 0.1.2: nicht öffentliche Profile leitet xHamster nach /users/profiles/<nick> um – beides gilt als „dort“
  const onProfile = (nick, sub = '') => new RegExp('^/users/(?:profiles/)?' + String(nick).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (sub ? '/' + sub : '') + '/?$', 'i').test(decodeURIComponent(location.pathname));

  // =====================================================================
  // Scan-Lauf: ruft der Reihe nach Seiten auf, der Rekorder sammelt (liest nur, klickt nichts, was etwas ändert)
  // =====================================================================
  function scanStart() {
    const m = me();
    const steps = ['/my/friends', '/my/friend-requests', '/my/blocked-users', '/notifications', '/my/messages', '@conv', '/dating?sort=activity', '@datingMore'];
    if (m && m.nick) steps.unshift('@profile:' + m.nick);
    const p = partner();
    steps.push(p ? '@profile:' + p : '@profile:first-friend');
    steps.push('@sub:videos', '@sub:shorts', '@sub:photos', '@gallery', '@photo', '@video');
    gs(K.scan, { steps, i: 0, started: now(), ctx: {} });
    recEvent('Scan-Lauf gestartet', { info: `${steps.length} Schritte` });
    scanTick();
  }
  // 0.1.4: jede Seite höchstens einmal ansteuern – leitet xHamster um (z. B. nach /users/profiles/…), wird genommen, was kam
  function goOnce(st, s, url) {
    if (st.ctx.tried === s) return 'here';
    st.ctx.tried = s; gs(K.scan, st);
    go(url);
    return 'nav';
  }
  async function scanStep(st, s) {
    const ini = initials() || {};
    if (s.startsWith('/')) return location.pathname + location.search === s ? 'here' : goOnce(st, s, abs(s));
    if (s === '@conv') {
      const c = (ini.conversationCollection || [])[0];
      if (!c || !c.pageURL) return 'skip';
      return abs(c.pageURL) === location.href ? 'here' : goOnce(st, s, abs(c.pageURL));
    }
    if (s === '@datingMore') {
      const nx = [...document.querySelectorAll('a, button')].find((e) => visible(e) && /^(next|show more|load more|more|weiter|mehr)$/i.test(e.textContent.trim()));
      if (nx) { recDom('Dating: weiter-Knopf', nx); click(nx); await sleep(5000); }
      return 'here';
    }
    if (s.startsWith('@profile:')) {
      let nick = s.slice(9);
      if (nick === 'first-friend') { nick = st.ctx.firstFriend || ''; if (!nick) return 'skip'; }
      st.ctx.profile = nick; gs(K.scan, st);
      if (!onProfile(nick)) { if (st.ctx.tried === s) return 'skip'; st.ctx.tried = s; gs(K.scan, st); go(profileUrl(nick)); return 'nav'; }
      return 'here';
    }
    if (s.startsWith('@sub:')) {
      if (!st.ctx.profile) return 'skip';
      if (!onProfile(st.ctx.profile, s.slice(5))) { if (st.ctx.tried === s) return 'skip'; st.ctx.tried = s; gs(K.scan, st); go(profileUrl(st.ctx.profile) + '/' + s.slice(5)); return 'nav'; }
      return 'here';
    }
    if (s === '@gallery') {
      const g = st.ctx.gallery || ([...document.querySelectorAll('a[href*="/photos/gallery/"]')].map((a) => a.href).find((h) => !/\/\d+\/\d+$/.test(h)));
      if (!g) return 'skip';
      st.ctx.gallery = g; gs(K.scan, st);
      return location.href === g ? 'here' : goOnce(st, s, g);
    }
    if (s === '@photo') {
      let p = st.ctx.photo;
      if (!p) { try { p = ini.galleryPage.photoItems[0].link; } catch (e) { p = ''; } }
      if (!p) p = ([...document.querySelectorAll('a[href*="/photos/gallery/"]')].map((a) => a.href).find((h) => /\/\d+\/\d+$/.test(h)) || '');
      if (!p) return 'skip';
      st.ctx.photo = p; gs(K.scan, st);
      return location.href === abs(p) ? 'here' : goOnce(st, s, abs(p));
    }
    if (s === '@video') {
      const v = st.ctx.video;
      if (!v) return 'skip';
      return location.href === v ? 'here' : goOnce(st, s, v);
    }
    return 'skip';
  }
  let scanBusy = false;
  async function scanTick() {
    const st = gm(K.scan, null);
    if (!st || scanBusy) return;
    scanBusy = true;
    try {
      if (st.i >= st.steps.length) { gs(K.scan, null); uiStatus('Scan-Lauf fertig. Menü: „Rekorder an Home Assistant senden“ oder „… exportieren“.'); recEvent('Scan-Lauf fertig'); return; }
      const s = st.steps[st.i];
      uiStatus(`Scan-Lauf: Schritt ${st.i + 1}/${st.steps.length} – ${s}`);
      const r = await scanStep(st, s);
      if (r === 'nav') return; // nächste Seite lädt, es geht dort weiter
      if (r === 'here') {
        await sleep(4000);
        await scrollThrough();
        await sleep(2000);
        recPage();
        // Merkposten für spätere Schritte
        const ini = initials() || {};
        const st2 = gm(K.scan, null);
        if (!st2) return;
        if (!st2.ctx.firstFriend) { const f = (ini.friendsUsersCollection || []).find((u) => u && !u.retired); if (f) st2.ctx.firstFriend = f.name; }
        if (!st2.ctx.video) { const v = ((ini.videoListComponent || {}).videoThumbProps || [])[0] || (ini.userRecentVideosCollection || [])[0]; if (v && v.pageURL) st2.ctx.video = v.pageURL; }
        // weitere Seiten der Blockierten
        if (/^\/my\/blocked-users/.test(location.pathname) && ini.blockedUsersPaging && !st2.ctx.blockedPages) {
          st2.ctx.blockedPages = true;
          const max = Math.min(Number(ini.blockedUsersPaging.maxPage) || 1, 10);
          const extra = [];
          for (let p = 2; p <= max; p++) extra.push('/my/blocked-users/' + p);
          st2.steps.splice(st2.i + 1, 0, ...extra);
        }
        gs(K.scan, st2);
        recEvent('Seite gesammelt', { info: routeName() });
      } else recEvent('Schritt übersprungen', { info: s });
      st2Save();
    } catch (e) { recEvent('Fehler im Scan-Lauf', { info: String(e && e.message || e) }); }
    finally { scanBusy = false; }
    function st2Save() {
      const cur = gm(K.scan, null);
      if (!cur) return;
      cur.i++;
      gs(K.scan, cur);
      setTimeout(scanTick, 1500);
    }
  }

  // =====================================================================
  // Aktionstest: entblocken/blockieren, Testnachrichten an den Partner (danach löschen), entfreunden und neu anfragen
  // =====================================================================
  const PARTY = '17.07.2026 - Club o6 in Gelsenkirchen - Die unanständige Drecksau-Party - ';
  const EV = 'joyclub.de/event/1768453.die_unanstaendige_drecksau_party.html';
  // 0.1.9: Befund 0.1.8 – enthält die Nachricht „https://“, ersetzt xHamster die Zeichen 2–9 der Nachricht durch Sternchen
  // („Party-Tipp:“ → „P********p:“), der Link selbst bleibt (über exit.php). Ohne „https://“ bleibt alles unverändert.
  // Jetzt: wo genau maskiert wird und wie man es umgeht
  // 0.1.11: Befund 0.1.10 – 10 Sternchen vorn fangen die Maskierung ab (sichtbar unverändert, Link klickbar); ein als
  // Text eingefügter Zeilenumbruch geht verloren. Jetzt: wie bekommt man zwei Zeilen (Alt+Enter, Einfügen wie Strg+V, <br>)
  const L1 = '********** Da findest Du mich:', L2 = PARTY + 'https://' + EV;
  const MSG_VARIANTS = [
    { how: 'alt', t: L1 + '\n' + L2 },
    { how: 'paste', t: L1 + '\r\n' + L2 },
    { how: 'paste', t: L1 + '\n' + L2 },
    { how: 'br', t: L1 + '\n' + L2 },
    { how: 'alt', t: 'Hallo!\nZweite Zeile ohne Link' },
    { how: 'text', t: '********** ' + PARTY + 'https://' + EV },
  ];
  const vText = (v) => (typeof v === 'string' ? v : v.t);
  // Text ins Eingabefeld: als Text, mit Alt+Enter zwischen den Zeilen, als Einfügen (Strg+V) oder mit <br>
  async function typeInto(ed, v) {
    const how = typeof v === 'string' ? 'text' : v.how;
    const t = vText(v);
    ed.focus();
    try { document.execCommand('selectAll', false); document.execCommand('delete', false); } catch (e) { ed.textContent = ''; }
    if (how === 'alt') {
      const lines = t.split('\n');
      for (let k = 0; k < lines.length; k++) {
        if (k) {
          for (const ty of ['keydown', 'keypress', 'keyup']) ed.dispatchEvent(new KeyboardEvent(ty, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, altKey: true, bubbles: true, cancelable: true }));
          await sleep(200);
        }
        try { document.execCommand('insertText', false, lines[k]); } catch (e) { ed.append(lines[k]); }
      }
    } else if (how === 'paste') {
      let dt = null;
      try { dt = new DataTransfer(); dt.setData('text/plain', t); } catch (e) { dt = null; }
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      const handled = !ed.dispatchEvent(ev); // xHamster fängt das Einfügen ab → hat es selbst eingesetzt
      if (!handled) { try { document.execCommand('insertText', false, t); } catch (e) { ed.textContent = t; } }
    } else if (how === 'br') {
      try { document.execCommand('insertHTML', false, t.split('\n').map((x) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))).join('<br>')); } catch (e) { ed.innerHTML = t.split('\n').join('<br>'); }
    } else {
      try { document.execCommand('insertText', false, t); } catch (e) { ed.textContent = t; }
    }
    ed.dispatchEvent(new InputEvent('input', { bubbles: true, data: t, inputType: 'insertText' }));
    return how;
  }
  function actStart() {
    const p = partner();
    if (!p) { alert('Bitte zuerst im Tampermonkey-Menü das Partnerkonto eintragen.'); return; }
    if (!confirm(`Aktionstest mit Partner ${p}:\n\n1. einen Blockierten entblocken und sofort wieder blockieren\n2. ${MSG_VARIANTS.length} Testnachrichten an ${p} (alle 30 s), danach wieder löschen\n3. ${p} entfreunden und neu anfragen (im anderen Konto: Menü „Freundschaftsanfrage des Partners annehmen“)\n\nDauert etwa 7 Minuten. Tab offen lassen. Starten?`)) return;
    gs(K.tests, MSG_VARIANTS.map((x) => vText(x).replace(/\s+/g, ' ').trim()));
    gs(K.act, { step: 'block', started: now(), partner: p, sent: [], i: 0 });
    recEvent('Aktionstest gestartet', { info: 'Partner ' + p });
    actTick();
  }
  function actSave(patch) { const a = gm(K.act, null); if (!a) return null; Object.assign(a, patch); gs(K.act, a); return a; }
  let actBusy = false;
  async function actTick() {
    const a = gm(K.act, null);
    if (!a || actBusy) return;
    actBusy = true;
    try {
      if (a.step === 'block') await actBlock(a);
      else if (a.step === 'conv') await actConv(a);
      else if (a.step === 'msg') await actMsg(a);
      else if (a.step === 'del') await actDel(a);
      else if (a.step === 'unfriend') await actUnfriend(a);
      else if (a.step === 'invite') await actInvite(a);
      else if (a.step === 'done') { gs(K.act, null); uiStatus('Aktionstest fertig. Im anderen Konto die Anfrage annehmen (Menü), dann Rekorder an Home Assistant senden.'); recEvent('Aktionstest fertig'); }
    } catch (e) { recEvent('Fehler im Aktionstest', { info: String(e && e.message || e) }); uiStatus('Aktionstest: Fehler – siehe Protokoll'); }
    finally { actBusy = false; }
  }
  const next = (step, patch) => { actSave(Object.assign({ step }, patch || {})); setTimeout(actTick, 1500); };
  // 0.1.4: höchstens 3 Seitenaufrufe je Schritt – sonst (Umleitung, Anmeldung …) bricht der Aktionstest ab statt endlos zu laden
  function actGo(url) {
    const a = gm(K.act, null);
    if (!a) return;
    const k = 'nav_' + a.step;
    a[k] = (a[k] || 0) + 1;
    if (a[k] > 3) {
      gs(K.act, null);
      recEvent('Aktionstest abgebrochen: Seite lässt sich nicht erreichen', { info: `${a.step} → ${url} (gelandet auf ${location.pathname})` });
      uiStatus('Aktionstest abgebrochen – Seite nicht erreichbar, siehe Protokoll');
      return;
    }
    gs(K.act, a);
    go(url);
  }
  async function actBlock(a) {
    uiStatus('Aktionstest 1/3: entblocken und wieder blockieren');
    if (!/^\/my\/blocked-users\/?$/.test(location.pathname)) { actGo(abs('/my/blocked-users')); return; }
    const it = await waitFor(() => [...document.querySelectorAll('.item.friend')].find((x) => x.querySelector('a.unblock-user') && visible(x.querySelector('a.unblock-user')) && !sameNick(itemNick(x), a.partner)));
    if (!it) { recDom('Blockierte: kein Eintrag mit Unblock', document.querySelector('.friends-users-list, main') || document.body); recEvent('Entblocken: kein Eintrag gefunden'); next('conv'); return; }
    const nick = itemNick(it);
    recDom('Blockierte: Eintrag vorher', it);
    click(it.querySelector('a.unblock-user'));
    await confirmDialog('Entblocken');
    const again = await waitFor(() => { const b = it.querySelector('a.block-user'); return b && visible(b) ? b : null; }, 10000);
    recDom('Blockierte: Eintrag nach Entblocken', it);
    if (!again) { recEvent('Entblocken: „Block again“ erschien nicht', { info: nick }); next('conv', { blockNick: nick, blockOk: false }); return; }
    await sleep(2000);
    click(again);
    await confirmDialog('Wieder blockieren');
    let ok = await waitFor(() => { const b = it.querySelector('a.unblock-user'); return b && visible(b) ? b : null; }, 10000);
    recDom('Blockierte: Eintrag nach Wieder-Blockieren', it);
    if (!ok) { // ein zweites Mal versuchen
      const b = it.querySelector('a.block-user');
      if (b && visible(b)) { click(b); await confirmDialog('Wieder blockieren (2)'); ok = await waitFor(() => { const u = it.querySelector('a.unblock-user'); return u && visible(u) ? u : null; }, 10000); }
    }
    recEvent(ok ? 'Entblockt und wieder blockiert' : 'ACHTUNG: wieder blockieren unsicher – bitte von Hand prüfen', { info: nick, ok: !!ok });
    if (!ok) alert(`Swinger Companion: ${nick} wurde entblockt, das Wieder-Blockieren ist nicht sicher geklappt. Bitte von Hand prüfen.`);
    next('conv', { blockNick: nick, blockOk: !!ok });
  }
  async function actConv(a) {
    uiStatus('Aktionstest 2/3: Chat mit ' + a.partner + ' öffnen');
    if (!onProfile(a.partner)) { if (a.tried === 'conv') { recEvent('Partnerprofil nicht erreichbar', { info: location.pathname }); next('unfriend'); return; } actSave({ tried: 'conv' }); actGo(profileUrl(a.partner)); return; }
    await sleep(1500);
    const dm = (initials() || {}).displayUserModel || {};
    recDom('Profil: Knopfleiste', document.querySelector('[data-role="controls-container"]'));
    if (!dm.messagesURL) { recEvent('Partnerprofil ohne Nachrichtenadresse'); next('unfriend'); return; }
    actSave({ conv: dm.messagesURL, step: 'msg', i: 0 });
    actGo(abs(dm.messagesURL));
  }
  const composer = () => document.querySelector('.xh-editable-content[contenteditable="true"]');
  const inPartnerChat = (a) => /^\/my\/messages\//.test(location.pathname) && decodeURIComponent(location.pathname).toLowerCase().split('/').includes(String(a.partner).toLowerCase());
  const mineIds = () => new Set([...document.querySelectorAll('.message.mine[id^="message-"]')].map((e) => e.id));
  async function actMsg(a) {
    // 0.1.8: xHamster leitet die Chat-Adresse um (z. B. neue Unterhaltung) – jede Chatseite mit dem Partner im Pfad gilt
    if (!inPartnerChat(a)) { recEvent('Chat: Umleitung', { info: location.pathname }); actGo(abs(a.conv)); return; }
    const ed0 = await waitFor(composer, 15000);
    // 0.1.11: eigene Nachrichten vor dem Test merken – alles Neue (auch versehentlich geteilte Nachrichten) wird danach gelöscht
    if (!a.startIds) { a.startIds = [...mineIds()]; actSave({ startIds: a.startIds }); }
    const ed = ed0;
    if (!ed) { recDom('Chat: kein Eingabefeld', document.querySelector('.messages-main-view') || document.body); recEvent('Chat: Eingabefeld nicht gefunden'); next('unfriend'); return; }
    for (let i = a.i; i < MSG_VARIANTS.length; i++) {
      const v = MSG_VARIANTS[i], text = vText(v);
      // 0.1.9: xHamster baut das Eingabefeld nach einigen Nachrichten neu auf – jedes Mal frisch holen
      const ed = (await waitFor(composer, 10000)) || ed0;
      uiStatus(`Aktionstest 2/3: Nachricht ${i + 1}/${MSG_VARIANTS.length}`);
      const before = mineIds();
      const mode = await typeInto(ed, v);
      await sleep(400);
      recDom(`Chat: Eingabe vor dem Senden (${mode})`, ed);
      for (const t of ['keydown', 'keypress', 'keyup']) ed.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      const newMsg = () => [...document.querySelectorAll('.message.mine[id^="message-"]')].find((e) => !before.has(e.id));
      let el = await waitFor(newMsg, 5000);
      let how = 'Enter';
      if (!el) {
        // 0.1.5: künstliches Enter nimmt xHamster evtl. nicht an → Sende-Knopf suchen (erscheint oft erst mit Text)
        const box = document.querySelector('[data-role="message-input-component"]') || document.querySelector('[data-role="input-box"]');
        if (i === a.i) recDom('Chat: Eingabe nach Enter (nichts gesendet)', box);
        const btn = box && (box.querySelector('button[class*="sendButton-"]') || [...box.querySelectorAll('button, [role=button]')].find((b) => visible(b) && !/attach|emoji|image/i.test((b.getAttribute('data-tooltip') || '') + ' ' + (b.getAttribute('aria-label') || '')) &&
          /^(send|senden)$/i.test(b.textContent.trim())));
        if (btn) {
          // der Knopf ist gesperrt, solange xHamster keinen Text erkannt hat
          if (btn.disabled) { ed.dispatchEvent(new Event('change', { bubbles: true })); ed.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); await waitFor(() => !btn.disabled, 3000); }
          recDom('Chat: Sende-Knopf' + (btn.disabled ? ' (gesperrt)' : ''), btn);
          if (!btn.disabled) { click(btn); how = 'Knopf'; el = await waitFor(newMsg, 10000); }
        }
      }
      const sent = actSave({}) || a;
      if (!el) {
        const fails = (a.fails || 0) + 1; a.fails = fails;
        recEvent('Nachricht nicht erschienen', { info: `Variante ${i + 1}`, sent: text, editor: maskStr(String(ed.textContent || '').slice(0, 200)) });
        recDom('Chat: nach dem Senden (nichts erschienen)', document.querySelector('.message-list') || document.body);
        try { document.execCommand('selectAll', false); document.execCommand('delete', false); } catch (e) { ed.textContent = ''; }
        if (fails >= 2) { recEvent('Senden klappt nicht – Nachrichtenteil übersprungen (Rekorder an HA senden, ich passe das Skript an)'); actSave({ i: i + 1 }); next((sent.sent || []).length ? 'del' : 'unfriend'); return; }
        actSave({ i: i + 1, fails });
        continue;
      } else {
        a.fails = 0;
        await sleep(1500);
        const w = el.querySelector('.message-wrapper');
        const shown = ((w || el).innerText != null ? (w || el).innerText : (w || el).textContent || '').trim();
        const diff = censorDiff(text, shown);
        sent.sent.push({ id: el.id, i });
        const lines = (w ? w.innerHTML : '').split(/<br\s*\/?>|<\/div>\s*<div|<\/p>\s*<p|\n/i).filter((x) => x.replace(/<[^>]+>/g, '').trim()).length;
        recEvent('Testnachricht', { info: `${i + 1} (${typeof v === 'string' ? 'text' : v.how}/${how}): ${diff || 'unverändert'} · ${lines} Zeile(n)`, sent: text, shown, lines, html: maskStr((w ? w.innerHTML : '').slice(0, 1500)), censored: diff });
        if (i === 0) recDom('Chat: gesendete Nachricht', el);
      }
      actSave({ i: i + 1, sent: sent.sent });
      if (i + 1 < MSG_VARIANTS.length) { uiStatus(`Aktionstest 2/3: warte 30 s (Spam-Schutz) – ${i + 1}/${MSG_VARIANTS.length} gesendet`); await sleep(30000); if (!gm(K.act, null)) return; }
    }
    next('del');
  }
  async function actDel(a) {
    uiStatus('Aktionstest 2/3: Testnachrichten löschen');
    if (!inPartnerChat(a)) { actGo(abs(a.conv)); return; }
    await waitFor(composer, 15000);
    let n = 0;
    const known = new Set((a.sent || []).map((x) => x.id));
    const extra = a.startIds ? [...mineIds()].filter((id) => !a.startIds.includes(id) && !known.has(id)).map((id) => ({ id })) : [];
    if (extra.length) recEvent('Weitere eigene Testnachrichten gefunden', { info: String(extra.length) });
    for (const s of [...(a.sent || []), ...extra]) {
      const el = document.getElementById(s.id);
      if (!el) continue;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* egal */ }
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await sleep(400);
      const b = el.querySelector('button.delete-message');
      if (!b) { recDom('Chat: kein Löschknopf', el); continue; }
      click(b);
      await confirmDialog('Nachricht löschen');
      const gone = await waitFor(() => !document.getElementById(s.id) || !visible(document.getElementById(s.id)), 8000);
      if (gone) n++; else recDom('Chat: Nachricht nach Löschen noch da', document.getElementById(s.id));
      await sleep(1500);
    }
    recEvent('Testnachrichten gelöscht', { info: `${n} von ${(a.sent || []).length + extra.length}` });
    next('unfriend');
  }
  async function actUnfriend(a) {
    uiStatus('Aktionstest 3/3: ' + a.partner + ' entfreunden');
    if (!/^\/my\/friends\/?$/.test(location.pathname)) { actGo(abs('/my/friends')); return; }
    const it = await waitFor(() => [...document.querySelectorAll('.item.friend')].find((x) => sameNick(itemNick(x), a.partner)));
    if (!it) { recEvent('Entfreunden: Partner nicht in der Freundesliste', { info: a.partner }); next('invite', { unfriended: false }); return; }
    recDom('Freunde: Eintrag vorher', it);
    click(it.querySelector('a.unfriend'));
    await confirmDialog('Entfreunden');
    // 0.1.12: nach „Remove“ blendet xHamster die Aktionen aus (die Statuszeile erscheint nicht immer) – beides zählt
    const ok = await waitFor(() => { const s = it.querySelector('.status'), ac = it.querySelector('.actions'); return (s && visible(s)) || !it.isConnected || (ac && !visible(ac)) ? true : null; }, 10000);
    recDom('Freunde: Eintrag nachher', it);
    recEvent(ok ? 'Entfreundet' : 'Entfreunden unsicher', { info: a.partner });
    next('invite', { unfriended: !!ok });
  }
  const friendBtn = () => document.querySelector('[data-role="controls-container"] button[class*="growButton-"]');
  const friendState = (b) => { const u = b && b.querySelector('use'); return (u && (u.id || (u.getAttribute('xlink:href') || '').split('#')[1])) || ''; };
  async function actInvite(a) {
    uiStatus('Aktionstest 3/3: neue Freundschaftsanfrage an ' + a.partner);
    if (!onProfile(a.partner)) { if (a.tried === 'invite') { recEvent('Partnerprofil nicht erreichbar', { info: location.pathname }); next('done'); return; } actSave({ tried: 'invite' }); actGo(profileUrl(a.partner)); return; }
    const b = await waitFor(friendBtn, 10000);
    if (!b) { recDom('Profil: kein Freundschaftsknopf', document.querySelector('[data-role="controls-container"]') || document.body); recEvent('Anfrage: Knopf nicht gefunden'); next('done'); return; }
    const s0 = friendState(b);
    recDom('Profil: Freundschaftsknopf vorher (' + s0 + ')', b.closest('[data-role="controls-container"]'));
    if (/accept/.test(s0)) { recEvent('Anfrage: noch befreundet – nichts geklickt', { info: s0 }); next('done'); return; }
    click(b);
    await confirmDialog('Freundschaftsanfrage');
    await sleep(3000);
    const b2 = friendBtn();
    recDom('Profil: Freundschaftsknopf nachher (' + friendState(b2) + ')', document.querySelector('[data-role="controls-container"]'));
    recEvent('Freundschaftsanfrage gesendet', { info: `${s0} → ${friendState(b2)}` });
    next('done');
  }
  // im anderen Konto: Anfrage des Partners annehmen
  async function acceptPartner() {
    const p = partner();
    if (!p) { alert('Bitte zuerst das Partnerkonto eintragen.'); return; }
    if (!/^\/my\/friend-requests\/?$/.test(location.pathname)) { gs('xh_accept', now()); go(abs('/my/friend-requests')); return; }
    gs('xh_accept', 0);
    uiStatus('Anfrage von ' + p + ' annehmen');
    const it = await waitFor(() => [...document.querySelectorAll('.item.friend.request')].find((x) => sameNick(itemNick(x), p)), 10000);
    if (!it) { recEvent('Keine Anfrage vom Partner gefunden', { info: p }); uiStatus('Keine Anfrage von ' + p + ' gefunden.'); return; }
    recDom('Anfragen: Eintrag vorher', it);
    click(it.querySelector('button.accept'));
    await confirmDialog('Anfrage annehmen');
    const ok = await waitFor(() => { const s = it.querySelector('.status-accept'); return s && visible(s) ? s : null; }, 10000);
    recDom('Anfragen: Eintrag nachher', it);
    recEvent(ok ? 'Anfrage angenommen' : 'Annehmen unsicher', { info: p });
    uiStatus(ok ? `Anfrage von ${p} angenommen.` : 'Annehmen unsicher – bitte prüfen.');
  }

  // =====================================================================
  // Export: Datei oder an Home Assistant (Swinger Companion ab 0.6.3, Nachrichtenart „rec“)
  // =====================================================================
  function recExportFile() {
    const r = gm(K.rec, null);
    if (!r) { alert('Der Rekorder hat noch nichts gesammelt.'); return; }
    const m = me() || {};
    const blob = new Blob([JSON.stringify({ format: 'swinger-companion-rec', platform: 'xhamster', script: VER, account: m, data: r }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `xhamster-rekorder-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function haParse(v) {
    const m = /^(https?:\/\/[^#\s]+\/api\/webhook\/[A-Za-z0-9_-]+)#([A-Za-z0-9_-]{43})$/.exec(String(v || '').trim());
    return m ? { url: m[1], key: m[2] } : null;
  }
  const b64 = (u8) => { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  function haPost(url, body) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'POST', url, headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(body), timeout: 120000,
      onload: resolve, onerror: () => reject(new Error('Home Assistant nicht erreichbar')), ontimeout: () => reject(new Error('Zeitüberschreitung')) }));
  }
  async function recToHa(auto = false) {
    const a = haParse(gm(K.ha, ''));
    if (!a) { if (!auto) haSetup(); return; }
    const r = gm(K.rec, null);
    if (!r) { if (!auto) alert('Der Rekorder hat noch nichts gesammelt.'); return; }
    // 0.1.13: automatisch alle 30 Minuten, nur bei Änderungen (ein Tab je 25 Minuten)
    const sig = `${Object.keys(r.req || {}).length}:${Object.values(r.req || {}).reduce((n, e) => n + (e.n || 0), 0)}:${(r.events || []).length}:${Object.keys(r.pages || {}).length}`;
    if (auto && (!recOn() || Date.now() - (gm('xh_ha_at', 0) || 0) < 25 * 60000 || sig === gm('xh_ha_sig', ''))) return;
    gs('xh_ha_at', Date.now());
    try {
      const key = await crypto.subtle.importKey('raw', b64url(a.key), 'AES-GCM', false, ['encrypt', 'decrypt']);
      const m = me() || {};
      const payload = { format: 'swinger-companion', v: 1, kind: 'rec', platform: 'xhamster', script: VER, account: { uid: m.id || '', nick: m.nick || '' }, data: r };
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
      const res = await haPost(a.url, { v: 1, iv: b64(iv), data: b64(ct) });
      if (res.status === 403) throw new Error('Schlüssel passt nicht – Adresse in Home Assistant neu kopieren');
      if (res.status === 404) throw new Error('Adresse unbekannt – Integration in Home Assistant eingerichtet?');
      if (res.status < 200 || res.status >= 300) throw new Error('Home Assistant antwortet mit ' + res.status);
      const env = JSON.parse(res.responseText || '{}');
      const ans = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data))));
      if (!ans.ok) throw new Error(ans.error || 'abgelehnt (Swinger Companion ab 0.6.3 nötig)');
      gs('xh_ha_sig', sig);
      if (!auto) alert(`Rekorder an Home Assistant gesendet: ${ans.file} (${Math.round(ans.size / 1024)} KB).`);
    } catch (e) { if (!auto) alert('Senden fehlgeschlagen: ' + (e && e.message || e)); else console.warn('[xHamster-SC] Rekorder an HA', e); }
  }
  function haSetup() {
    const v = prompt('Adresse aus Home Assistant (Swinger Companion › Konfigurieren), Form https://…/api/webhook/…#Schlüssel:', '');
    if (v == null) return;
    if (!haParse(v)) { alert('Das ist keine gültige Adresse.'); return; }
    gs(K.ha, v.trim());
    alert('Gespeichert.');
  }

  // =====================================================================
  // Regeln von poppen.de (ab 0.2.0): Altersgrenzen, Bezeichnungen, Whitelist aus der Einstellungs-Kopie des
  // poppen-Skripts im Briefkasten (meta.poppen_gm). Ohne Kopie gelten die Vorgaben des poppen-Skripts.
  // =====================================================================
  const POP_SRC = ['global', 'interaktionen', 'besucher', 'party', 'gruppen', 'suche'];
  const ages3 = (a, b, c) => Object.fromEntries(POP_SRC.map((k) => [k, [a, b, c]]));
  const POP_DEFAULTS = {
    groups: {
      m: { visual: true, ignore: true, types: ['m'], src: ages3(29, 48, 50), labels: ['Jungspund', 'Jungspunde', 'Mann', 'Männer', 'Opa', 'Opas'] },
      w: { visual: false, ignore: false, types: ['w'], src: ages3(29, 48, 50), labels: ['junge Frau', 'junge Frauen', 'Frau', 'Frauen', 'Oma', 'Omas'] },
      p: { visual: false, ignore: false, types: ['p'], separate: false, coupleMode: 'any', src: ages3(29, 48, 50), srcW: ages3(29, 48, 50), srcM: ages3(29, 48, 50),
        sugarDaddy: { on: false, gap: 15 }, sugarMom: { on: false, gap: 15 }, labels: ['junges Paar', 'junge Paare', 'Paar', 'Paare', 'Geronto-Paar', 'Geronto-Paare'] },
    },
    warnYears: 1,
    watch: true,
    whitelist: { names: [], prefixes: ['Pop-MOD-'] },
    expert: { sharedLimits: true },
    // Moppel-Liebhaber (nur an/aus, Bezeichnungen, gesuchte Typen)
    moppel: { on: false, labels: ['Kurvig', 'Kurvige', 'Üppig', 'Üppige', 'XXL', 'XXL'], types: ['m', 'w'] },
  };
  const AGE_MAX = 99;
  const openTop = (x) => (x >= AGE_MAX ? Infinity : x);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function setPath(o, p, v) { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null || typeof x[ks[i]] !== 'object') x[ks[i]] = {}; x = x[ks[i]]; } x[ks[ks.length - 1]] = v; }
  function flatten(o, pre = '', out = {}) { for (const [k, v] of Object.entries(o)) { const p = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, p, out); else out[p] = v; } return out; }
  // gespeicherte poppen-Einstellungen ({ Pfad: { v, src } }, nur Abweichungen) auf die Vorgaben legen – wie loadSettings()
  // im poppen-Skript: Hat sich der Quelltext-Wert seitdem geändert, gilt der neue Quelltext-Wert
  function popRules(stored) {
    const s = clone(POP_DEFAULTS);
    const st = Object.assign({}, stored || {});
    const flatDef = flatten(POP_DEFAULTS);
    for (const gk of Object.keys(POP_DEFAULTS.groups)) for (const key of ['src', 'srcW', 'srcM']) {
      const pre = `groups.${gk}.${key}`;
      if (!(pre + '.global' in st) && st[pre + '.interaktionen']) st[pre + '.global'] = Object.assign({}, st[pre + '.interaktionen']);
    }
    for (const [p, e] of Object.entries(st)) {
      if (!e || typeof e !== 'object' || !('v' in e)) continue;
      if (!/^(groups\.|warnYears$|watch$|whitelist\.(names|prefixes)$|expert\.sharedLimits$|moppel\.(on|labels|types)$)/.test(p)) continue;
      if (p === 'whitelist.names') { if (Array.isArray(e.v)) setPath(s, p, clone(e.v)); continue; }
      const def = p in flatDef ? flatDef[p] : getPath(POP_DEFAULTS, p);
      if (def !== undefined && stable(def) !== stable(e.src)) continue;
      setPath(s, p, clone(e.v));
    }
    for (const g of Object.values(s.groups)) for (const key of ['src', 'srcW', 'srcM']) {
      if (!g[key]) continue;
      for (const k of POP_SRC) if (Array.isArray(g[key][k])) g[key][k] = g[key][k].map((x) => Math.max(18, Math.min(AGE_MAX, Number(x) || 18)));
    }
    return s;
  }
  // Ruhrgebiet: „Oppa“ statt „Opa“ (wie im poppen-Skript; Wohnorte aus dessen eigenem Profil)
  const RUHR = ['bochum', 'bottrop', 'dortmund', 'duisburg', 'essen', 'gelsenkirchen', 'hagen', 'hamm', 'herne', 'mülheim an der ruhr', 'mülheim',
    'oberhausen', 'castrop-rauxel', 'datteln', 'dorsten', 'gladbeck', 'haltern am see', 'herten', 'marl', 'oer-erkenschwick', 'recklinghausen', 'waltrop',
    'bergkamen', 'bönen', 'fröndenberg', 'holzwickede', 'kamen', 'lünen', 'schwerte', 'selm', 'unna', 'werne', 'breckerfeld', 'ennepetal', 'gevelsberg',
    'hattingen', 'herdecke', 'schwelm', 'sprockhövel', 'wetter', 'witten', 'alpen', 'dinslaken', 'hamminkeln', 'hünxe', 'kamp-lintfort', 'moers',
    'neukirchen-vluyn', 'rheinberg', 'schermbeck', 'sonsbeck', 'voerde', 'wesel', 'xanten'];
  const REGIONAL = { Opa: 'Oppa', Opas: 'Oppas', Oma: 'Omma', Omas: 'Ommas' };
  const norm = (s) => String(s || '').trim().toLowerCase();
  const ruhrOf = (cities) => (cities || []).some((c) => RUHR.includes(norm(c).replace(/\s*\(.*\)$/, '')));
  // Stand: { at, src: 'poppen'|'vorgabe', stored, ruhr }
  const POPK = 'xh_poprules';
  const OWNK = 'xh_own_rules';
  let rulesCache = null;
  function rules() {
    if (rulesCache) return rulesCache;
    const r = gm(POPK, null) || {};
    rulesCache = popRules(r.stored);
    rulesCache.ruhr = !!r.ruhr;
    rulesCache.popG = r.popG || [];
    rulesCache.sextype = r.sextype || [];
    rulesCache.from = r.src === 'poppen' ? `poppen.de (Stand ${new Date(r.popAt || r.at || 0).toLocaleString('de-DE')})` : 'Vorgaben des poppen-Skripts';
    // 0.3.0: eigene Werte je Gruppe (Einstellungsseite) gehen den poppen-Werten vor: { m: { lim: [a, b, c], visual, ignore } }
    rulesCache.own = {};
    const own = gm(OWNK, {}) || {};
    for (const gk of ['m', 'w', 'p']) {
      const o = own[gk];
      if (!o || typeof o !== 'object') continue;
      const g = rulesCache.groups[gk];
      if (Array.isArray(o.lim) && o.lim.length === 3) { const l = o.lim.map((x) => Math.max(18, Math.min(AGE_MAX, Number(x) || 18))); for (const k of POP_SRC) { g.src[k] = [...l]; if (g.srcW) g.srcW[k] = [...l]; if (g.srcM) g.srcM[k] = [...l]; } }
      if ('visual' in o) g.visual = !!o.visual;
      if ('ignore' in o) g.ignore = !!o.ignore;
      if (Array.isArray(o.labels) && o.labels.length === 6 && o.labels.every((x) => typeof x === 'string' && x.trim())) { g.labels = o.labels.map((x) => x.trim()); rulesCache.ownLabels = Object.assign(rulesCache.ownLabels || {}, { [gk]: true }); }
      if (Array.isArray(o.lim) || 'visual' in o || 'ignore' in o) rulesCache.own[gk] = true;
    }
    return rulesCache;
  }
  async function rulesRefresh(force = false) {
    const cur = gm(POPK, null);
    if (!force && cur && now() - (cur.at || 0) < 30 * 60000) return false;
    let r = null;
    try { r = await SH.call('get', { s: 'meta', k: 'poppen_gm' }, 20000); } catch (e) { recEvent('Briefkasten nicht erreichbar', { info: String(e && e.message || e) }); gs(POPK, Object.assign({}, cur || {}, { at: now() })); return false; }
    const data = (r && r.data) || null;
    const next = data && data.vaf2_settings !== undefined
      ? { at: now(), src: 'poppen', popAt: r.at || 0, popVer: r.ver || '', stored: data.vaf2_settings || {}, ruhr: ruhrOf(((data.vaf2_me || {}).cities) || []), popG: ((data.vaf2_me || {}).g) || [], sextype: data.vaf2_my_sextype || [] }
      : { at: now(), src: 'vorgabe', stored: {}, ruhr: false };
    const changed = !cur || stable(cur.stored || {}) !== stable(next.stored) || cur.ruhr !== next.ruhr || stable(cur.popG || []) !== stable(next.popG || []);
    gs(POPK, next); rulesCache = null;
    return changed;
  }
  function labelsOf(gk, s = rules()) {
    const l = [...(s.groups[gk].labels || POP_DEFAULTS.groups[gk].labels)];
    if (s.ruhr && !(s.ownLabels || {})[gk]) for (const i of [4, 5]) if (REGIONAL[l[i]]) l[i] = REGIONAL[l[i]];
    return l;
  }
  // xHamster-Geschlecht → Gruppe der poppen-Regeln (Paare aus Mann und Frau; übrige Paar- und Trans-Angaben bleiben ohne Gruppe)
  const groupOfGender = (g) => (g === 'male' ? 'm' : g === 'female' ? 'w' : g === 'couple' ? 'p' : null);
  const fickXhIds = () => new Set(gm('xh_fick_ids', []) || []);
  function whiteOf(p, s = rules()) {
    const n = norm(p.nick);
    if (n && (s.whitelist.names || []).some((x) => norm(x && x.n) === n)) return 'Whitelist';
    if (n && (s.whitelist.prefixes || []).some((x) => x && n.startsWith(norm(x)))) return 'Whitelist (Präfix)';
    const ow = gm('xh_white', null);
    if (ow && n && (ow.names || []).some((x) => norm(x) === n)) return 'Whitelist (xHamster)';
    if (ow && n && (ow.prefixes || []).some((x) => x && n.startsWith(norm(x)))) return 'Whitelist (xHamster, Präfix)';
    const lists = gm(K.lists, {}) || {};
    if (p.id && (lists.subs || []).includes(p.id)) return 'Abo';
    if (p.relation === 'friend' || (lists.friends || []).includes(p.id)) return 'Freund';
    if (p.id && fickXhIds().has(p.id)) return 'Fickliste';
    const m = me();
    if (m && p.id === m.id) return 'ich';
    return '';
  }
  // Einstufung wie im poppen-Skript (eine Altersangabe je Profil, auch bei Paaren)
  // src: 'suche' (Dating) oder 'interaktionen' (Anfragen, Nachrichten, Freunde) – gilt nur, wenn die Grenzen getrennt sind
  function classify(p, src = 'suche', s = rules()) {
    const r = { gk: groupOfGender(p && p.gender), stage: 0, ignore: false, near: false, white: '', label: '', lim: null, reason: '' };
    if (!p) return r;
    r.white = whiteOf(p, s);
    if (p.age == null || !r.gk) return r;
    const grp = s.groups[r.gk];
    const set = grp.src;
    const lim = (s.expert.sharedLimits ? set.global : set[src]) || set.interaktionen;
    r.lim = lim;
    r.stage = p.age <= openTop(lim[0]) ? 1 : p.age <= openTop(lim[1]) ? 2 : 3;
    const over = p.age >= lim[2];
    r.near = !over && p.age + (s.warnYears || 0) >= lim[2] && !!s.watch;
    r.label = labelsOf(r.gk, s)[(r.stage - 1) * 2];
    r.ignore = !!grp.ignore && over && !r.white;
    if (r.ignore) r.reason = `über der Grenze (${p.age} ≥ ${lim[2]})`;
    if (r.white) { r.near = false; r.reason = r.white; }
    r.visual = !!grp.visual;
    return r;
  }
  const STAGE_COL = { 1: '#43a047', 2: '#ffb74d', 3: '#ef6c00' };
  // Wort wie im poppen-Skript: Männer schützen sich vor „Omas“, alle anderen vor „Opas“; Ruhrgebiet „Omma“/„Oppa“
  // (Geschlecht aus dem eigenen xHamster-Profil)
  function OW() { const male = gm('xh_me_gender', '') === 'male'; const ruhr = !!(gm(POPK, null) || {}).ruhr; return male ? (ruhr ? 'Omma' : 'Oma') : (ruhr ? 'Oppa' : 'Opa'); }
  const OWs = () => OW() + 's';
  // 0.3.2: Opa-/Oma-Figur wie im JOYclub- und poppen-Skript (eigener Mann → Oma, sonst Opa)
  const OPA_PATH = 'M3408 12790 c-235 -43 -487 -227 -651 -477 -33 -50 -47 -63 -67 -63 -37 0 -119 -24 -168 -49 -102 -52 -148 -120 -201 -298 -48 -164 -73 -337 -69 -483 3 -112 6 -131 30 -180 15 -30 41 -64 58 -75 29 -19 30 -23 30 -92 0 -39 -3 -74 -8 -77 -4 -2 -86 -1 -182 4 -273 12 -411 -7 -566 -80 -227 -105 -387 -276 -518 -551 -127 -266 -203 -574 -253 -1019 -22 -199 -25 -1016 -5 -1265 20 -240 60 -603 82 -750 12 -82 15 -131 9 -133 -6 -3 -6 -8 0 -16 7 -8 -3 -51 -30 -136 -109 -339 -191 -737 -235 -1140 -22 -191 -25 -693 -6 -845 33 -258 72 -434 158 -699 234 -721 431 -1986 554 -3566 12 -145 22 -265 23 -266 1 -1 52 -16 114 -34 98 -29 113 -36 121 -59 45 -127 347 -276 743 -366 622 -140 1209 -69 1131 137 l-10 28 168 0 c273 0 423 30 492 100 62 62 50 120 -43 204 -59 53 -250 150 -377 191 l-84 27 6 77 c35 439 116 2702 166 4611 15 587 12 548 44 595 65 94 130 255 161 400 9 44 19 87 21 97 4 13 23 4 102 -49 201 -134 411 -220 617 -252 109 -16 209 -22 222 -14 18 13 32 57 39 126 l6 64 69 -35 69 -36 0 -156 c0 -170 4 -186 60 -215 37 -19 64 -19 104 0 55 26 61 45 66 214 l5 155 28 7 27 7 0 -2924 c0 -3216 -5 -2965 60 -2999 62 -32 136 -10 164 49 15 31 16 279 16 3052 l0 3017 25 64 c99 246 -33 525 -286 604 -33 10 -83 19 -110 19 -27 0 -60 6 -72 14 -37 24 -132 36 -367 46 -124 6 -272 15 -330 20 -98 9 -467 74 -476 83 -3 2 -9 91 -14 198 -27 543 -53 829 -125 1389 l-6 45 53 35 c141 94 296 282 422 513 20 37 42 67 49 67 7 0 46 -17 87 -38 59 -29 78 -45 93 -74 30 -59 36 -140 25 -308 -13 -195 -6 -359 17 -424 26 -71 104 -148 178 -175 200 -73 369 48 421 302 9 42 16 81 16 86 0 17 -87 71 -148 92 -72 26 -220 28 -308 5 -34 -9 -66 -16 -72 -16 -5 0 -11 71 -15 173 -4 137 -9 186 -26 239 -28 89 -88 155 -173 193 -35 15 -65 29 -66 31 -2 1 10 39 27 83 40 105 106 337 122 433 11 69 16 78 40 88 77 32 105 336 42 457 -16 31 -21 68 -27 190 -4 84 -14 199 -21 255 -14 100 -13 104 6 120 23 19 35 74 25 113 -6 24 -10 26 -39 21 l-32 -6 -19 82 c-10 46 -35 137 -57 203 -171 527 -466 883 -824 994 -79 25 -249 36 -327 21z';
  const OMA_PARTS = '<circle cx="9.6" cy="9.2" r="3.3"/><circle cx="15.2" cy="12.4" r="5"/><path d="M8.4 16.2 C5.6 19.6 5.8 26 8.2 32 L4.6 53 L22.8 53 L19 33 C20.6 29 21 24.6 19.2 20.4 C16.6 17.2 12.2 15.4 8.4 16.2Z"/><path d="M17.4 21.6 C20.6 23.4 23.2 26 25.4 29.2 L23.8 30.4 C21.4 28 19 26 16.4 24.6Z"/><path d="M24.8 29.6 L24.8 62" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M24.8 29.6 C24.8 26.4 28.8 26.4 28.8 29.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><rect x="9.6" y="52" width="3.2" height="9" rx="1"/><rect x="14.6" y="52" width="3.2" height="9" rx="1"/><path d="M8.2 60 h5.6 v2.6 h-6.6 z"/><path d="M13.6 60 h6 v2.6 h-6 z"/>';
  const owFigure = () => (gm('xh_me_gender', '') === 'male' ? `<g transform="scale(20)">${OMA_PARTS}</g>` : `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g>`);

  // =====================================================================
  // Personen, die die Seite kennt (Anfangszustand und nachgeladene Antworten) – für die Markierung
  // =====================================================================
  const People = { byId: new Map(), byNick: new Map(), byUrl: new Map() };
  const urlKey = (u) => String(u || '').toLowerCase().split(/[?#]/)[0].replace(/\/users\/profiles\//, '/users/').replace(/\/+$/, '');
  function peopleAdd(u) {
    const p = personOf(u);
    if (!p || !p.id || !p.nick) return;
    const old = People.byId.get(p.id);
    // ein vollständigeres älteres Bild (mit Alter) nicht durch ein ärmeres ersetzen
    if (old && old.age != null && p.age == null) { p.age = old.age; p.gender = p.gender || old.gender; }
    People.byId.set(p.id, p);
    People.byNick.set(p.nick.toLowerCase(), p);
    if (p.url) People.byUrl.set(urlKey(p.url), p);
  }
  function peopleWalk(o, d = 0) {
    if (!o || typeof o !== 'object' || d > 9) return;
    if (Array.isArray(o)) { for (const x of o.slice(0, 400)) peopleWalk(x, d + 1); return; }
    if (o.id != null && typeof o.name === 'string' && (o.personalInfo || o.pageURL || o.retired === true) && /user/i.test(o.modelName || 'user')) peopleAdd(o);
    for (const k in o) if (o[k] && typeof o[k] === 'object' && k !== 'layout') peopleWalk(o[k], d + 1);
  }

  // =====================================================================
  // Gemeinsame Fickliste (ab 0.2.0)
  // =====================================================================
  const FSTAT = { want: 'Will ich', done: 'Gefickt', no: 'Nein, danke!', never: 'Nie wieder!' };
  const FCOL = { want: '#ffb74d', done: '#43a047', no: '#9e9e9e', never: '#e53935' };
  let fickCache = null, fickAt = 0;
  async function fickAll(force = false) {
    if (!force && fickCache && now() - fickAt < 60000) return fickCache;
    const l = await SH.call('all', { s: 'fick' }, 20000);
    fickCache = (l || []).filter((x) => x && !x.deleted); fickAt = now();
    const ids = new Set();
    for (const r of fickCache) for (const pr of [r.main, ...(r.profiles || [])]) if (pr && pr.pf === 'xhamster' && pr.uid && !pr.dead) ids.add(String(pr.uid));
    gs('xh_fick_ids', [...ids]); gs('xh_fick_n', fickCache.length); rulesCache = null;
    return fickCache;
  }
  const isXh = (pr, p) => !!pr && pr.pf === 'xhamster' && ((pr.uid && String(pr.uid) === p.id) || (pr.url && p.url && urlKey(pr.url) === urlKey(p.url)) || (!pr.uid && !pr.url && pr.nick && norm(pr.nick) === norm(p.nick)));
  function fickFind(list, p) { return list.find((r) => isXh(r.main, p) || (r.profiles || []).some((x) => isXh(x, p) && !x.dead && !x.deleted && !x.gone)) || null; }
  const fickBy = () => ({ pf: 'xhamster', ver: VER, acc: (me() || {}).nick || '' });
  async function fickPut(v, expect) {
    const r = await SH.call('put', { s: 'fick', v, expect, by: fickBy() }, 20000);
    fickCache = null;
    return r;
  }
  // Status setzen (status null = ohne Status); legt die Person bei Bedarf neu an (Hauptprofil xHamster)
  async function fickSetStatus(p, status) {
    for (let i = 0; i < 3; i++) {
      const list = await fickAll(true);
      const cur = fickFind(list, p);
      const at = now();
      let v, expect;
      if (cur) {
        v = clone(cur); expect = cur.rev || 0;
        v.status = status; v.statusAt = at;
        const prof = (v.profiles || []).find((x) => isXh(x, p));
        if (prof && prof.status !== undefined && !prof.sync) { prof.status = status; prof.statusAt = at; }
        if (v.main && v.main.pf === 'xhamster' && isXh(v.main, p)) Object.assign(v.main, { uid: p.id, nick: p.nick, url: p.url || v.main.url });
      } else {
        if (!status) return { ok: true };
        expect = null;
        v = { id: 'xh:' + p.id, main: { pf: 'xhamster', uid: p.id, nick: p.nick, url: p.url || profileUrl(p.nick) }, profiles: [], status, statusAt: at, created: at, history: [] };
      }
      v.history = (v.history || []).concat([{ at, what: `${status ? 'Status „' + FSTAT[status] + '“' : 'Status entfernt'} (xHamster)` }]).slice(-200);
      const r = await fickPut(v, expect);
      if (r && r.ok) { fickThumb(r.v, p).catch(() => {}); return r; }
    }
    throw new Error('Fickliste: gleichzeitig geändert, bitte noch einmal');
  }
  async function fickDelete(p) {
    const list = await fickAll(true);
    const cur = fickFind(list, p);
    if (!cur) return;
    if (!(cur.main && cur.main.pf === 'xhamster') || (cur.profiles || []).length) throw new Error('Die Person hat weitere Profile – dort löschen oder nur den Status entfernen.');
    await SH.call('del', { s: 'fick', k: cur.id, expect: cur.rev || 0, by: fickBy() }, 20000);
    fickCache = null;
  }
  // Vorschaubild (höchstens 150 px) – nur, wenn xHamster das Hauptprofil ist
  function gmBlob(url) {
    return new Promise((res, rej) => GM_xmlhttpRequest({ method: 'GET', url, responseType: 'blob', timeout: 30000, onload: (r) => (r.status === 200 && r.response ? res(r.response) : rej(new Error('Bild ' + r.status))), onerror: () => rej(new Error('Bild nicht ladbar')), ontimeout: () => rej(new Error('Zeitüberschreitung')) }));
  }
  async function thumbData(url) {
    const bm = await createImageBitmap(await gmBlob(url));
    const s = Math.min(1, 150 / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bm.width * s)); c.height = Math.max(1, Math.round(bm.height * s));
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }
  async function fickThumb(rec, p) {
    if (!rec || !rec.main || rec.main.pf !== 'xhamster' || !isXh(rec.main, p) || !p.thumb) return;
    if (rec.thumb && now() - (gm('xh_thumb_' + rec.id, 0) || 0) < 7 * 86400000) return;
    const t = await thumbData(p.thumb);
    gs('xh_thumb_' + rec.id, now());
    if (t === rec.thumb) return;
    const v = clone(rec); v.thumb = t;
    await fickPut(v, rec.rev || 0);
  }
  // Bilder aus geöffneten Galerien einer Person der Fickliste übernehmen (pics[])
  async function fickGalleryPics() {
    const g = (initials() || {}).galleryPage;
    if (!g || !Array.isArray(g.photoItems) || !g.photoItems.length) return;
    const a = ((g.infoProps || {}).authorInfoProps) || {};
    if (!a.authorLink) return;
    const p = { id: '', nick: a.authorName || '', url: a.authorLink };
    const list = await fickAll();
    const cur = fickFind(list, p);
    if (!cur) return;
    const have = new Set((cur.pics || []).map((x) => x.k));
    const add = g.photoItems.filter((x) => x && x.id && x.imgSrc && !x.isBlurredMedia && !have.has('xhamster-' + x.id)).map((x) => ({ k: 'xhamster-' + x.id, src: x.imgSrc, pf: 'xhamster', at: now() }));
    if (!add.length) return;
    const v = clone(cur); v.pics = (v.pics || []).concat(add);   // nie entfernen (FORMAT.md)
    const r = await fickPut(v, cur.rev || 0);
    if (r && r.ok) uiToast(`${add.length} Bilder in die Fickliste übernommen (${esc(p.nick)})`);
  }
  // eigenes Profil in „ich“ eintragen (einmal am Tag)
  async function ichPut() {
    const m = me();
    if (!m || !m.id || now() - (gm('xh_ich_at', 0) || 0) < 86400000) return;
    await SH.call('put', { s: 'ich', v: { id: 'xhamster:' + m.id, pf: 'xhamster', uid: m.id, nick: m.nick, url: profileUrl(m.nick), at: now() } }, 20000);
    gs('xh_ich_at', now());
  }
  function uiToast(html) {
    if (!document.body) return;
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#1f2125;color:#eee;border:1px solid #444;border-radius:8px;padding:8px 14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)';
    t.innerHTML = html;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // =====================================================================
  // Anzeige auf den Seiten: Profilkasten, Markierung nach den poppen-Regeln (Dating, Anfragen, Freunde, Blockierte, Nachrichten)
  // =====================================================================
  const opa = () => Object.assign({ hide: false }, gm(K.opa, {}) || {});
  function badgeHtml(p, c) {
    const bits = [];
    if (p.retired) bits.push('<b style="color:#ff7875">gelöscht</b>');
    if (c && c.label && (c.visual || c.ignore)) bits.push(`<b style="color:${c.ignore ? '#e53935' : STAGE_COL[c.stage] || '#ccc'}">${esc(c.label)}</b>`);
    if (p.age != null) bits.push(`${p.age} J.`);
    if (p.city) bits.push(esc(p.city));
    if (p.online) bits.push('<span style="color:#7bd88f">online</span>');
    if (c && c.near) bits.push('<span style="color:#ef6c00">bald über der Grenze</span>');
    if (c && c.white) bits.push(`<span style="color:#9ec5ff">${esc(c.white)}</span>`);
    const lists = gm(K.lists, {}) || {};
    if ((lists.blocked || []).includes(p.id)) bits.push('<span style="color:#ffb74d">blockiert</span>');
    return bits.join(' · ');
  }
  function collect() {
    const ini = initials() || {};
    const lists = gm(K.lists, {}) || {};
    let ch = false;
    const take = (k, arr, pg) => {
      if (!Array.isArray(arr) || !arr.length) return;
      const ids = arr.map((u) => String(u.id));
      const page = pg && pg.active > 1;
      const cur = new Set(page ? lists[k] || [] : []);
      ids.forEach((i) => cur.add(i));
      lists[k] = [...cur]; ch = true;
    };
    if (/^\/my\/friends/.test(location.pathname)) take('friends', ini.friendsUsersCollection, ini.friendsUsersPaging);
    if (/^\/my\/blocked-users/.test(location.pathname)) take('blocked', ini.blockedUsersCollection, ini.blockedUsersPaging);
    // 0.5.0: Abos (Subscriptions) als Ausnahme – Nutzer-Einträge aus den Seitendaten
    if (/^\/my\/subscriptions/.test(location.pathname)) {
      const us = [];
      const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 6) return; if (Array.isArray(o)) { for (const v of o.slice(0, 500)) walk(v, d + 1); return; } if (o.id != null && typeof o.name === 'string' && o.pageURL && /\/users\//.test(o.pageURL)) us.push(o); for (const k in o) if (k !== 'layout' && o[k] && typeof o[k] === 'object') walk(o[k], d + 1); };
      walk(ini, 0);
      const m0 = me();
      take('subs', us.filter((u) => !m0 || String(u.id) !== m0.id), null);
    }
    if (ch) { gs(K.lists, lists); rulesCache = null; }
  }
  const srcOfPage = () => (/^\/dating/.test(location.pathname) ? 'suche' : 'interaktionen');
  function decorate() {
    if (!People.byId.size) return;
    const src = srcOfPage();
    const items = document.querySelectorAll('.item.friend, [class*="card"], [class*="Card"], li');
    for (const it of items) {
      if (it.querySelector('.xhsc-badge') || it.closest('#xhsc-box, header, .user-dropdown, [data-role="header"], .xhsc-fl-list')) continue;
      // 0.2.0: in der Dating-Suche ist die Karte selbst der Link
      const a = it.matches('a[href*="/users/"]') ? it : it.querySelector('a[href*="/users/"]');
      const r = it.querySelector('.retired');
      const un = it.matches('.conversation-list-item') ? it.querySelector('.username') : null;
      let p = null;
      if (a) p = People.byUrl.get(urlKey(a.href)) || null;
      if (!p && r) p = People.byNick.get(r.textContent.trim().toLowerCase()) || null;
      if (!p && un) p = People.byNick.get(un.textContent.trim().toLowerCase()) || null;
      if (!p) continue;
      // nur die kleinste passende Karte schmücken
      if ([...it.querySelectorAll('.item.friend, [class*="card"], [class*="Card"], li')].some((c) => c.querySelector('a[href*="/users/"]'))) continue;
      const c = classify(p, src);
      vmAdd(p, c);
      const html = [badgeHtml(p, c), mopBadge(p)].filter(Boolean).join(' · ');
      if (!html) continue;
      const b = document.createElement('div');
      b.className = 'xhsc-badge';
      b.style.cssText = 'font:11.5px/1.3 system-ui,sans-serif;color:#ccc;margin-top:2px';
      b.innerHTML = html;
      (it.querySelector('.info, .conversation-meta, [class*="userInfo-"]') || it).appendChild(b);
      // bei jedem Neuzeichnen (z. B. nach neuen Regeln) setzen, nicht nur hinzufügen
      it.style.display = ''; it.style.opacity = ''; it.removeAttribute('title');
      // 0.3.2: auf eigenen Listen (Blockierte, Freunde, Anfragen) nur das Abzeichen, nicht abdunkeln
      const ownList = /^\/my\/(blocked-users|friends|friend-requests)/.test(location.pathname);
      if (c.ignore) { if (ownList) it.title = `${c.label}: ${c.reason}`; else if (opa().hide && src === 'suche') it.style.display = 'none'; else { it.style.opacity = '.35'; it.title = `${c.label}: ${c.reason}`; } }
      if (p.retired) it.style.opacity = '.5';
    }
  }
  // Profilseite: Steckbrief aus dem HTML („I am: Name, 51 years old, male, heterosexual“)
  function profilePerson() {
    const ini = initials() || {};
    const dm = ini.displayUserModel;
    if (!dm || !dm.id) return null;
    const info = {};
    for (const r of document.querySelectorAll('.info-row')) {
      const l = r.querySelector('.label'), v = r.querySelector('.value');
      if (l && v) info[l.textContent.replace(/:\s*$/, '').trim()] = v.textContent.replace(/\s+/g, ' ').trim();
    }
    const iam = info['I am'] || '';
    const age = (/(\d{1,3}) years old/.exec(iam) || [])[1];
    const gender = /\bcouple\b/i.test(iam) ? (/male and female couple/i.test(iam) || /^\s*[^,]*,\s*\d+ years old, couple\b/i.test(iam) ? 'couple' : 'other_couple') : /\bfemale\b/i.test(iam) ? 'female' : /\bmale\b/i.test(iam) ? 'male' : '';
    return { id: String(dm.id), nick: dm.name || '', url: dm.pageURL || location.href.split(/[?#]/)[0], thumb: dm.thumbURL || '', retired: !!dm.retired, relation: dm.currentUserRelation || '', age: age ? +age : null, gender, city: info.From || '', info };
  }
  function profileBox() {
    if (!/^\/users\/(profiles\/)?[^/]+\/?$/.test(location.pathname) || document.getElementById('xhsc-prof')) return;
    const h = document.querySelector('.user-name');
    const p = profilePerson();
    if (!p || !h) return;
    const ini = initials() || {};
    const c = ini.counters || {};
    const cl = classify(p, 'interaktionen');
    const bits = [`#${p.id}`];
    if (cl.label && (cl.visual || cl.ignore)) bits.push(`<b style="color:${cl.ignore ? '#e53935' : STAGE_COL[cl.stage]}">${esc(cl.label)}</b>`);
    if (p.age != null) bits.push(p.age + ' J.');
    if (p.city) bits.push(esc(p.city));
    if (p.relation && p.relation !== 'none') bits.push(esc(p.relation));
    if (cl.near) bits.push('<span style="color:#ef6c00">bald über der Grenze – vorgemerkt</span>');
    if (cl.white && cl.white !== 'ich') bits.push(`<span style="color:#9ec5ff">${esc(cl.white)}</span>`);
    p.bday = ((((ini.displayUserModel || {}).personalInfo) || {}).birthday);
    vmAdd(p, cl);
    bodyLearn();
    const mb = mopBadge(p); if (mb) bits.push(mb);
    if (c.galleries != null) bits.push(`${c.galleries} Galerien`);
    if (c.videos != null) bits.push(`${c.videos} Videos`);
    if (p.info.Website) bits.push(`<a href="${esc(p.info.Website)}" target="_blank" rel="noopener" style="color:#9ec5ff">${esc(p.info.Website.replace(/^https?:\/\//, ''))}</a>`);
    const d = document.createElement('div');
    d.id = 'xhsc-prof';
    d.style.cssText = 'font:12.5px/1.4 system-ui,sans-serif;color:#ccc;margin:4px 0 6px';
    d.innerHTML = `<div>${bits.join(' · ')}</div>`;
    h.after(d);
    if (cl.white === 'ich') return;
    flStateLine(p);
  }
  // 0.4.0: Stand der Fickliste unter dem Steckbrief (links), Block „Fickliste“ rechts oben, Profil-Archiv
  async function flStateLine(p, cur) {
    if (cur === undefined) { try { cur = fickFind(await fickAll(), p); } catch (e) { return; } }
    flUserInfo(p, cur);
    flProfileBlock(p, cur);
    archSnap(p, cur).catch(() => {});
    flMarkGone(p, cur).catch(() => {});
  }

  // =====================================================================
  // Fickliste-Knopf in der Knopfleiste fremder Profile (ab 0.2.4), hinter „Friend/Unfriend“, mit den Symbolen
  // des JOYclub-Skripts: Will ich (Umriss gefüllt), Gefickt (rot), Nie wieder!, Nein, danke! (durchgestrichen)
  // =====================================================================
  const FL_D = 'M65.9,26.7c0-13.6,11-24.6,24.6-24.6s24.6,11,24.6,24.6s-11,24.6-24.6,24.6S65.9,40.3,65.9,26.7z M254,191.2c0,8.7-7.1,15.8-15.8,15.8h-78.8c-8.7,0-15.8-7.1-15.8-15.8v-27.5H74.8v30.4c0,7.1-5.7,12.8-12.8,12.8H14.8c-7.1,0-12.8-5.7-12.8-12.8s5.7-12.8,12.8-12.8h34.5c0,0,0.1-36.7,0.1-37.3c-0.4-7.9,5.2-14.9,13.1-16.3l45.9-7.7c0,0,0-59.2,0-59.2c0-11.7,9.5-21.3,21.3-21.3c3.7,0,7.2,0.9,10.2,2.6c8.4,4.5,41.9,29.7,61.1,44c8.8,6.6,13.9,16.9,13.9,27.8l0.1,61.4h23.3C246.9,175.4,254,182.5,254,191.2z M183.5,175.4l-0.2-36c0-10.4-4.8-20.1-13-26.5L134,84.7v31.1l10.9-1.8c0,0,0.1,0,0.1,0c7.5-1.2,15.2,0.9,21,5.8c5.8,4.9,9.2,12.1,9.3,19.7c0,0.1,0,0.1,0,0.2v35.7h7.9H183.5z M16.5,140.3c12.4,5.6,26.3-0.3,32.6-12.3c8-15.5,4.5-33.1-2.4-42.9c0,0,0,0,0,0c-4.8,5.8-12.2,7.6-19.6,8.1C15.3,94,8.4,98.4,4.2,107.7C-1.4,120.1,4.1,134.7,16.5,140.3z';
  const FL_RED = '#e01b1b';
  // gemeinsamer Status ↔ Symbol
  const FL_KIND = { want: 'will', done: 'gef', never: 'nie', no: 'nein' };
  const FL_ORDER = ['want', 'done', 'never', 'no'];
  const FL_MENU = { want: 'Will ich ficken', done: 'Gefickt', never: 'Nie wieder!', no: 'Nein, danke!' };
  function flIcon(kind, opt = {}) {
    const size = opt.size || 20;
    const st = `width:${size}px;height:${size}px;flex:none;vertical-align:middle;`;
    if (kind === 'trash') return `<svg viewBox="0 0 24 24" style="${st}" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9zm4 2v9h1.6v-9H10zm3.4 0v9H15v-9h-1.6z"/></svg>`;
    const fill = `<path fill="currentColor" d="${FL_D}"/>`;
    const line = `<path fill="none" stroke="currentColor" stroke-width="${kind === 'nein' ? 12 : 9}" stroke-linejoin="round" d="${FL_D}"/>`;
    const col = opt.color || (kind === 'gef' && opt.redGef ? FL_RED : 'currentColor');
    if (kind === 'nein' || kind === 'nie') {
      return `<svg viewBox="-48 -71.5 352 352" style="${st}color:${col}" aria-hidden="true"><g transform="translate(128 104.5) scale(.78) translate(-128 -104.5)">${kind === 'nein' ? line : fill}</g>` +
        `<circle cx="128" cy="104.5" r="158" fill="none" stroke="${FL_RED}" stroke-width="22"/><line x1="16.3" y1="216.2" x2="239.7" y2="-7.2" stroke="${FL_RED}" stroke-width="22" stroke-linecap="round"/></svg>`;
    }
    return `<svg viewBox="${kind ? '-4 -4 264 217' : '-8 -8 272 225'}" style="${st}color:${col}" aria-hidden="true">${kind ? fill : line}</svg>`;
  }
  let flBtnCur = null;
  function flBtnRender(wrap, cur) {
    const stt = cur && cur.status;
    const b = wrap.querySelector('button');
    const k = stt ? FL_KIND[stt] : '';
    if (b.getAttribute('data-k') !== (k || '-')) { b.setAttribute('data-k', k || '-'); b.querySelector('.xhsc-fl-ico').innerHTML = flIcon(k, { size: 20 }); }
    b.style.background = stt === 'done' ? '#c71b1b' : '';
    b.style.color = stt === 'done' ? '#fff' : '';
    wrap.setAttribute('data-tooltip', stt ? 'Fickliste: ' + FSTAT[stt] : 'Fickliste');
    b.title = wrap.getAttribute('data-tooltip');
  }
  function flMenu(anchor, p, cur) {
    const old = document.getElementById('xhsc-fl-dd');
    if (old) { old.remove(); return; }
    const r = anchor.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.id = 'xhsc-fl-dd';
    dd.style.cssText = `position:fixed;z-index:2147483646;left:${Math.max(8, r.left - 80)}px;top:${r.bottom + 6}px;background:#25272b;border:1px solid #3a3d43;border-radius:10px;padding:6px 0;min-width:240px;box-shadow:0 8px 24px rgba(0,0,0,.6);font:14px system-ui,sans-serif;color:#fff`;
    const stt = cur && cur.status;
    const rows = FL_ORDER.filter((k) => k !== stt).map((k) => ({ k, html: flIcon(FL_KIND[k], { size: 20, redGef: true }), text: FL_MENU[k] }));
    if (stt) rows.push({ k: 'reset', html: flIcon('trash', { size: 20 }), text: 'Fickstatus zurücksetzen' });
    if (cur && cur.main && cur.main.pf === 'xhamster' && isXh(cur.main, p) && !(cur.profiles || []).length) rows.push({ k: 'del', html: flIcon('trash', { size: 20 }), text: 'Aus der Fickliste löschen' });
    for (const e of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:9px 16px;cursor:pointer';
      row.innerHTML = `${e.html}<span>${esc(e.text)}</span>`;
      row.addEventListener('mouseenter', () => { row.style.background = '#33363c'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', async (ev) => {
        ev.stopPropagation(); dd.remove();
        try {
          if (e.k === 'del') { if (!confirm(`${p.nick} aus der Fickliste löschen?`)) return; await fickDelete(p); }
          else await fickSetStatus(p, e.k === 'reset' ? null : e.k);
        } catch (er) { uiToast(esc(er.message)); }
        flButton(true);
      });
      dd.appendChild(row);
    }
    document.body.appendChild(dd);
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('click', off, true); } }, true), 0);
  }
  async function flButton(refresh = false) {
    if (!/^\/users\/(profiles\/)?[^/]+\/?$/.test(location.pathname)) return;
    const ctr = document.querySelector('[data-role="controls-container"]');
    if (!ctr) return;
    const p = profilePerson();
    const m = me();
    if (!p || (m && m.id === p.id)) return;
    let wrap = ctr.querySelector('.xhsc-fl-btn');
    if (!wrap) {
      const grow = ctr.querySelector('button[class*="growButton-"]');
      const inv = grow && (grow.closest('[class*="invite-"]') || grow.parentElement);
      const proto = grow || ctr.querySelector('a[class*="primary-"], button');
      if (!inv || !proto) return;
      wrap = document.createElement('div');
      wrap.className = 'xhsc-fl-btn';
      wrap.style.cssText = 'display:inline-flex';
      const cls = String(proto.className).replace(/\S*(growButton|disabled|active)\S*/g, '').replace(/\S*primary-\S*/g, (x) => x.replace('primary-', 'secondary-'));
      wrap.innerHTML = `<button type="button" class="${esc(cls)}"><span class="xhsc-fl-ico" style="display:inline-flex;align-items:center"></span></button>`;
      inv.after(wrap);
      wrap.querySelector('button').addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); flMenu(wrap.querySelector('button'), p, flBtnCur); });
      flBtnRender(wrap, null);
      refresh = true;
    }
    if (!refresh) return;
    try { flBtnCur = fickFind(await fickAll(refresh), p); } catch (e) { flBtnCur = null; wrap.setAttribute('data-tooltip', 'Fickliste nicht erreichbar'); return; }
    flBtnRender(wrap, flBtnCur);
    flStateLine(p, flBtnCur);
  }

  // =====================================================================
  // Fickliste: Übersicht (ab 0.2.2) – Reiter hinter „Friends“ im eigenen Profil und Eintrag im Nutzer-Menü
  // =====================================================================
  const FL_HASH = '#xhsc-fickliste';
  const flUrl = () => location.origin + '/my/friends' + FL_HASH;
  const PF_NAME = { poppen: 'poppen', joyclub: 'JOYclub', xhamster: 'xHamster', telegram: 'Telegram', whatsapp: 'WhatsApp', signal: 'Signal', threema: 'Threema', other: 'Sonstige' };
  function profUrl(pr) {
    if (!pr) return '';
    if (pr.url) return pr.url;
    if (pr.pf === 'poppen' && pr.nick) return 'https://www.poppen.de/p/' + encodeURIComponent(pr.nick);
    if (pr.pf === 'xhamster' && pr.nick) return profileUrl(pr.nick);
    return '';
  }
  const flName = (r) => String(r.alias || (r.main && (r.main.nick || r.main.name)) || (r.ext && r.ext.name) || r.id);
  // Ein Fick je Zeile: links Bild, Name, Status und Profile (wie ein Eintrag in „Friends“), rechts Treffen und Anmerkung
  const deDate = (d) => String(d || '').split('-').reverse().join('.');
  function flItemHtml(r) {
    const nick = (r.main && (r.main.nick || r.main.name)) || (r.ext && r.ext.name) || '';
    const name = r.alias && nick && norm(r.alias) !== norm(nick) ? `${esc(r.alias)} <span style="opacity:.6">(${esc(nick)})</span>` : esc(flName(r));
    const mainUrl = profUrl(r.main);
    const img = r.thumb && /^data:image\//.test(r.thumb) ? `<img class="xh-avatar normal" src="${esc(r.thumb)}" alt="" style="width:80px;height:80px;object-fit:cover">`
      : `<div class="xh-avatar normal" style="width:80px;height:80px;background:#3a3d44;display:flex;align-items:center;justify-content:center;font:600 30px system-ui;color:#bbb">${esc(flName(r).slice(0, 1).toUpperCase())}</div>`;
    const profs = [r.main, ...(r.profiles || [])].filter((p) => p && p.pf && !p.dead && !p.deleted && !p.gone);
    const links = profs.map((p) => {
      const u = profUrl(p);
      const lab = esc(p.pf === 'other' ? (p.pfName || 'Sonstige') : (PF_NAME[p.pf] || p.pf)) + (p !== r.main && (p.name || p.nick) && norm(p.name || p.nick) !== norm(nick) ? ': ' + esc(p.name || p.nick) : '');
      return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${lab}</a>` : `<span>${lab}${p.text ? ': ' + esc(p.text) : ''}</span>`;
    }).map((x) => `<div>${x}</div>`).join('');
    const st = r.status ? `<b style="color:${FCOL[r.status] || 'inherit'}">${esc(FSTAT[r.status] || r.status)}</b>` : '<span style="opacity:.6">ohne Status</span>';
    const meets = (r.meets || []).filter((m) => m && (m.date || m.club || m.where)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const meetHtml = meets.length ? `<div style="font-weight:600;margin-bottom:2px">Treffen (${meets.length})</div>` + meets.slice(0, 8).map((m) => {
      const bits = [m.date ? deDate(m.date) + (m.time ? ' ' + esc(m.time) : '') : '', esc(m.club || ''), esc(m.where || '')].filter(Boolean).join(' · ');
      const l = m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">Link</a>` : '';
      return `<div>${bits || '–'}${l}${m.note ? `<div style="opacity:.7;font-size:12px">${esc(String(m.note).slice(0, 200))}</div>` : ''}</div>`;
    }).join('') + (meets.length > 8 ? `<div style="opacity:.6">… und ${meets.length - 8} weitere</div>` : '') : '';
    const notes = String(r.notes || '').trim();
    const noteHtml = notes ? `<div style="font-weight:600;margin:6px 0 2px">Anmerkung</div><div class="xhsc-fl-note" style="white-space:pre-wrap;max-height:7.5em;overflow:hidden;cursor:pointer" title="Klicken: ganz anzeigen">${esc(notes)}</div>` : '';
    const vidHtml = flMediaHtml(r, false);
    const xp = [r.main, ...(r.profiles || [])].find((p) => p && p.pf === 'xhamster' && p.uid);
    const arch = xp ? archList(xp.uid) : [];
    const gone = arch.find((s) => s.gone);
    const right = (meetHtml || noteHtml ? meetHtml + noteHtml : '<span style="opacity:.5">Keine Treffen, keine Anmerkung.</span>') + vidHtml;
    return `<div class="item friend xhsc-fl-item" style="float:none;width:auto;display:flex;gap:16px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(128,128,128,.25)">
      <div style="display:flex;gap:12px;flex:0 0 340px;min-width:0"><div class="image-container avatar-container normal">${mainUrl ? `<a href="${esc(mainUrl)}" target="_blank" rel="noopener">${img}</a>` : img}</div>
      <div class="info" style="min-width:0;overflow-wrap:anywhere"><div class="info-line">${mainUrl ? `<a href="${esc(mainUrl)}" target="_blank" rel="noopener">${name}</a>` : name}</div><div>${st}${gone ? ` · <span style="color:#ff7875">xHamster-Profil gelöscht</span>` : ''}</div><div style="font-size:12px;opacity:.85;line-height:1.4;margin-top:2px">${links}</div>
      <div style="margin-top:4px;font-size:12.5px"><button type="button" class="xhsc-fl-ed" data-id="${esc(r.id)}" style="background:none;border:0;padding:0;color:#9ec5ff;cursor:pointer;font:inherit">Bearbeiten</button>${arch.length ? ` · <button type="button" class="xhsc-fl-ar" data-uid="${esc(xp.uid)}" data-name="${esc(flName(r))}" style="background:none;border:0;padding:0;color:#9ec5ff;cursor:pointer;font:inherit">Archiv (${arch.length})</button>` : ''}</div></div></div>
      <div style="flex:1 1 auto;min-width:0;font-size:13px;line-height:1.45">${right}</div></div>`;
  }
  // Liste mit Filter und Suche in einen Behälter zeichnen
  async function flRender(box) {
    box.innerHTML = '<span style="opacity:.6">Lade die Fickliste …</span>';
    let list = [];
    try { list = await fickAll(true); } catch (e) { box.innerHTML = `<span style="color:#e53935">Fickliste nicht erreichbar: ${esc(e.message)}</span>`; return; }
    box.innerHTML = `<div data-f style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px"></div>
      <button type="button" data-add style="float:right;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;color:#fff;background:#e34449;font:600 13px system-ui,sans-serif">+ Person hinzufügen</button>
      <input data-q type="search" placeholder="Name suchen …" style="width:100%;max-width:360px;box-sizing:border-box;border:1px solid rgba(128,128,128,.5);border-radius:6px;padding:6px 8px;margin-bottom:6px;background:transparent;color:inherit">
      <div data-l class="mixed-list"></div>`;
    let flt = gm('xh_fl_filter', 'all');
    const f = box.querySelector('[data-f]'), q = box.querySelector('[data-q]'), l = box.querySelector('[data-l]');
    const draw = () => {
      const cnt = (k) => (k === 'all' ? list.length : k === 'none' ? list.filter((r) => !r.status).length : list.filter((r) => r.status === k).length);
      f.innerHTML = '';
      for (const [k, v] of [['all', 'Alle'], ...Object.entries(FSTAT), ['none', 'ohne Status']]) {
        const b = document.createElement('button'); b.type = 'button';
        b.textContent = `${v} (${cnt(k)})`;
        b.style.cssText = `border:0;border-radius:6px;padding:3px 10px;cursor:pointer;color:#fff;background:${k === flt ? (FCOL[k] || '#1565c0') : '#5a5d64'}`;
        b.onclick = () => { flt = k; gs('xh_fl_filter', k); draw(); };
        f.appendChild(b);
      }
      const t = norm(q.value);
      const rows = list.filter((r) => (flt === 'all' || (flt === 'none' ? !r.status : r.status === flt)) && (!t || norm(flName(r)).includes(t) || [r.main, ...(r.profiles || [])].some((p) => p && norm(p.nick || p.name).includes(t))))
        .sort((a, b) => flName(a).localeCompare(flName(b), 'de', { sensitivity: 'base' }));
      l.innerHTML = rows.length ? rows.map(flItemHtml).join('') : '<span style="opacity:.6">Keine Einträge.</span>';
      for (const n of l.querySelectorAll('.xhsc-fl-note')) n.onclick = () => { n.style.maxHeight = n.style.maxHeight ? '' : '7.5em'; };
      flMediaBind(l);
      for (const b of l.querySelectorAll('.xhsc-fl-ed')) b.onclick = () => { const r = list.find((x) => x.id === b.dataset.id); if (r) flEdit(r, null, reload); };
      for (const b of l.querySelectorAll('.xhsc-fl-ar')) b.onclick = () => archShow(b.dataset.uid, b.dataset.name);
    };
    const reload = async () => { try { list = await fickAll(true); } catch (e) { /* alter Stand */ } draw(); };
    box.querySelector('[data-add]').onclick = () => flAddPerson(reload);
    q.oninput = draw;
    draw();
  }
  // In „Friends“ (/my/friends): an Stelle der Freundesliste, Eintrag „Fickliste“ in der Seitenleiste aktiv
  function flPage() {
    const col = document.querySelector('.user-content-section .content-column');
    const side = document.querySelector('ul.friends-side-switcher');
    if (!col || !side) return false;
    if (col.querySelector('.xhsc-fl-list')) return true;
    const hidden = [];
    for (const el of col.children) if (!el.classList.contains('xh-helper-hidden')) { el.classList.add('xh-helper-hidden'); hidden.push(el); }
    const act = [...side.querySelectorAll(':scope > li.active')];
    act.forEach((li) => li.classList.remove('active'));
    const mine = side.querySelector('.xhsc-fl-side');
    if (mine) mine.classList.add('active');
    // 0.3.1: auch oben bei den Reitern „Fickliste“ statt „Friends“ markieren
    const TAB_ON = ['active', 'current-tab'];
    const tabs = [...document.querySelectorAll('.xh-tabset a.friends')].filter((a) => TAB_ON.some((c) => a.classList.contains(c)));
    const flTabs = [...document.querySelectorAll('.xh-tabset .xhsc-fl-tab')];
    tabs.forEach((a) => TAB_ON.forEach((c) => a.classList.remove(c)));
    flTabs.forEach((a) => TAB_ON.forEach((c) => a.classList.add(c)));
    for (const ul of document.querySelectorAll('ul.friends-additional-switchers')) if (!ul.classList.contains('xh-helper-hidden')) { ul.classList.add('xh-helper-hidden'); hidden.push(ul); }
    const box = document.createElement('div');
    box.className = 'friends-list xhsc-fl-list';
    col.prepend(box);
    // anderen Eintrag der Seitenleiste gewählt → Fickliste weg, Seite wie vorher
    const leave = () => {
      box.remove(); hidden.forEach((el) => el.classList.remove('xh-helper-hidden'));
      if (mine) mine.classList.remove('active');
      flTabs.forEach((a) => TAB_ON.forEach((c) => a.classList.remove(c)));
      tabs.forEach((a) => TAB_ON.forEach((c) => a.classList.add(c)));
      if (location.hash === FL_HASH) try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* egal */ }
    };
    for (const li of side.querySelectorAll(':scope > li:not(.xhsc-fl-side)')) li.addEventListener('click', () => { if (box.isConnected) { leave(); if (!li.classList.contains('active') && act.includes(li)) li.classList.add('active'); } }, { once: true });
    flRender(box);
    return true;
  }
  // Übersicht öffnen: in „Friends“ an Ort und Stelle, sonst dorthin wechseln
  function flOpen() {
    if (/^\/my\/friends\/?$/.test(location.pathname) && flPage()) { if (location.hash !== FL_HASH) try { history.replaceState(null, '', location.pathname + location.search + FL_HASH); } catch (e) { /* egal */ } return; }
    location.assign(flUrl());
  }
  // Reiter „Fickliste“ hinter „Friends“ (nur im eigenen Profil, dort zeigt „Friends“ auf /my/friends)
  function flTab() {
    const n = gm('xh_fick_n', null);
    for (const ts of document.querySelectorAll('.xh-tabset')) {
      const have = ts.querySelector('.xhsc-fl-tab .value');
      if (have) { if (n != null && have.textContent !== String(n)) have.textContent = String(n); continue; }
      // 0.3.1: auf /my/friends selbst hat „Friends“ keinen Link (gewählter Reiter)
      const fr = [...ts.querySelectorAll('a.friends')].find((a) => /\/my\/friends\/?$/.test(a.getAttribute('href') || '') || (!a.getAttribute('href') && /^\/my\/friends\/?$/.test(location.pathname)));
      if (!fr) continue;
      const a = document.createElement('a');
      a.className = 'followable xhsc-fl-tab';
      a.href = flUrl();
      a.innerHTML = 'Fickliste<span class="value"></span>';
      if (n != null) a.querySelector('.value').textContent = String(n);
      a.addEventListener('click', (e) => { e.preventDefault(); flOpen(); });
      fr.after(a);
    }
    // Seitenleiste auf /my/friends (Friend requests, Friends, Subscriptions …): zwischen „Friends“ und „Subscriptions“
    for (const ul of document.querySelectorAll('ul.friends-side-switcher')) {
      const have = ul.querySelector('.xhsc-fl-side .value');
      if (have) { if (n != null && have.textContent !== String(n)) have.textContent = String(n); continue; }
      const fr = ul.querySelector('li.friends');
      if (!fr) continue;
      const li = document.createElement('li');
      li.className = 'xhsc-fl-side';
      li.innerHTML = `<a href="${esc(flUrl())}"><span class="label">Fickliste</span> <span class="value">${n != null ? n : ''}</span></a>`;
      li.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); flOpen(); });
      fr.after(li);
    }
  }
  function flCheckHash() { if (location.hash === FL_HASH && /^\/my\/friends\/?$/.test(location.pathname)) flPage(); }


  // =====================================================================
  // Fickliste bearbeiten (ab 0.4.0): Dialog im xHamster-Stil mit allem, was poppen- und JOYclub-Skript können –
  // Status, eigener Name, „Auch auf …“ (je Profil eigener Status, folgt der Person, gelöscht, Hauptprofil),
  // Treffen (auch mit Link zu einer JOYclub- oder poppen-Party), Anmerkung, Externe ohne Profil, Medien, Verlauf.
  // Geschrieben wird nur, was sich im Dialog geändert hat; bei gleichzeitiger Änderung auf den neuen Stand gemischt.
  // =====================================================================
  const PF_CODES = ['poppen', 'joyclub', 'xhamster', 'eronity', 'spicymatch', 'kaufmich', 'fetish', 'gays', 'telegram', 'whatsapp', 'threema', 'signal', 'other'];
  const PF_LABEL = Object.assign({ eronity: 'Eronity', spicymatch: 'SpicyMatch', kaufmich: 'Kaufmich', fetish: 'Fetisch.de', gays: 'Gays' }, PF_NAME);
  const PF_HOST = [[/(^|\.)poppen\.de$/, 'poppen'], [/(^|\.)joyclub\.(de|com)$/, 'joyclub'], [/(^|\.)xhamster\.(com|desi|one)$/, 'xhamster'], [/(^|\.)eronity\./, 'eronity'], [/(^|\.)spicymatch\./, 'spicymatch'],
    [/(^|\.)kaufmich\./, 'kaufmich'], [/(^|\.)fetisch\./, 'fetish'], [/(^|\.)gays\./, 'gays'], [/(^|\.)(t\.me|telegram\.(me|org))$/, 'telegram'], [/(^|\.)(wa\.me|whatsapp\.com)$/, 'whatsapp'], [/(^|\.)threema\./, 'threema'], [/(^|\.)signal\.(me|org)$/, 'signal']];
  function pfOfUrl(u) {
    let h = '';
    try { h = new URL(String(u || '')).hostname.toLowerCase(); } catch (e) { return ''; }
    for (const [re, pf] of PF_HOST) if (re.test(h)) return pf;
    return 'other';
  }
  const rid = (p) => p + Math.random().toString(36).slice(2, 10) + now().toString(36).slice(-4);
  const isDead = (pr) => !!(pr && (pr.dead || pr.deleted || pr.gone));
  // Eintrag mit Versionsprüfung ändern: fn(v) ändert eine Kopie des aktuellen Stands; bei Konflikt neu lesen und noch einmal
  async function fickPatch(id, fn, what) {
    for (let i = 0; i < 4; i++) {
      const cur = id ? (await SH.call('all', { s: 'fick' }, 20000) || []).find((r) => r && r.id === id) : null;
      if (id && (!cur || cur.deleted)) throw new Error('Der Eintrag wurde inzwischen gelöscht.');
      const v = cur ? clone(cur) : {};
      if (fn(v) === false) return { ok: true, v: cur };
      if (what) v.history = (v.history || []).concat([{ at: now(), what: what + ' (xHamster)' }]).slice(-200);
      const r = await fickPut(v, cur ? (cur.rev || 0) : null);
      if (r && r.ok) return r;
    }
    throw new Error('Fickliste: gleichzeitig geändert, bitte noch einmal');
  }
  async function fickRemove(rec) {
    const r = await SH.call('del', { s: 'fick', k: rec.id, expect: rec.rev || 0, by: fickBy() }, 20000);
    fickCache = null;
    if (!r || !r.ok) throw new Error('Der Eintrag wurde inzwischen geändert – bitte neu öffnen.');
  }
  function edCss() {
    if (document.getElementById('xhsc-ed-css')) return;
    const st = document.createElement('style');
    st.id = 'xhsc-ed-css';
    st.textContent = `
      .xhsc-ov{position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 12px}
      .xhsc-ed{background:#1f2125;color:#e8e8e8;border:1px solid #3a3d43;border-radius:12px;width:min(880px,100%);box-shadow:0 12px 40px rgba(0,0,0,.6);font:14px/1.45 system-ui,sans-serif}
      .xhsc-ed h3{margin:0;font-size:18px;font-weight:600;display:flex;align-items:center;gap:10px}
      .xhsc-ed .hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #33363c}
      .xhsc-ed .bd{padding:6px 18px 12px}
      .xhsc-ed .ft{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid #33363c}
      .xhsc-ed fieldset{border:0;border-top:1px solid #33363c;margin:10px 0 0;padding:10px 0 0}
      .xhsc-ed legend{font-weight:600;padding:0 6px 0 0;color:#fff}
      .xhsc-ed input[type=text],.xhsc-ed input[type=url],.xhsc-ed input[type=date],.xhsc-ed input[type=time],.xhsc-ed select,.xhsc-ed textarea{background:#2a2d32;color:#eee;border:1px solid #444850;border-radius:6px;padding:5px 7px;font:inherit;box-sizing:border-box;min-width:0}
      .xhsc-ed textarea{width:100%;min-height:110px;resize:vertical}
      .xhsc-ed .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}
      .xhsc-ed .grid2{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;align-items:center}
      .xhsc-ed .muted{opacity:.6;font-size:12.5px}
      .xhsc-ed .x{background:none;border:0;color:#ff7875;cursor:pointer;font-size:16px;padding:0 4px}
      .xhsc-ed .lnk{background:none;border:0;color:#9ec5ff;cursor:pointer;padding:0;font:inherit}
      .xhsc-ed .btn{border:0;border-radius:8px;padding:7px 16px;cursor:pointer;font:600 14px system-ui,sans-serif;color:#fff;background:#4a4d55}
      .xhsc-ed .btn.pri{background:#e34449}.xhsc-ed .btn.del{background:transparent;color:#ff7875;margin-right:auto}
      .xhsc-ed .meet{border:1px solid #33363c;border-radius:8px;padding:6px 8px;margin:6px 0}
      .xhsc-ed .hist{max-height:180px;overflow:auto;font-size:12.5px;opacity:.85}
      .xhsc-fl-block .xhsc-flb-edit{float:right;margin-top:6px;font-size:13px;cursor:pointer;color:#9ec5ff}
      .xhsc-fl-block .content-container{font-size:13px;line-height:1.5}
      .xhsc-fl-block .sub{font-weight:600;margin:8px 0 2px}
      .xhsc-fl-userinfo{border-top:1px solid rgba(128,128,128,.3);margin-top:8px;padding-top:8px;font-size:13px;line-height:1.5}`;
    (document.head || document.documentElement).appendChild(st);
  }
  const optList = (pairs, sel) => pairs.map(([v, t]) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const ST_OPTS = [['', 'ohne Status'], ...FL_ORDER.map((k) => [k, FSTAT[k]])];
  // Bild aus Datei auf höchstens 150 px verkleinern (Externe)
  async function fileThumb(file) {
    const bm = await createImageBitmap(file);
    const s = Math.min(1, 150 / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bm.width * s)); c.height = Math.max(1, Math.round(bm.height * s));
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  // Dialog: rec = vorhandener Eintrag, sonst seed = neuer Eintrag (z. B. { main } oder { ext })
  async function flEdit(rec, seed, onDone) {
    edCss();
    const orig = rec ? clone(rec) : Object.assign({ profiles: [], meets: [] }, seed || {});
    const d = clone(orig);
    d.profiles = (d.profiles || []).map((x) => Object.assign({}, x));
    d.meets = (d.meets || []).map((x) => Object.assign({}, x));
    const profs = [d.main, ...d.profiles].filter(Boolean);
    let mainIdx = d.main ? 0 : -1;
    const ov = document.createElement('div');
    ov.className = 'xhsc-ov';
    ov.innerHTML = `<div class="xhsc-ed" role="dialog" aria-modal="true"><div class="hd"><h3>${flIcon('gef', { size: 22 })}<span data-t></span></h3><button type="button" class="x" data-a="close" title="Schließen" style="color:#bbb;font-size:22px">×</button></div><div class="bd"></div><div class="ft"></div></div>`;
    const bd = ov.querySelector('.bd'), ft = ov.querySelector('.ft');
    ov.querySelector('[data-t]').textContent = rec ? 'Fickliste: ' + flName(rec) : 'Neu in der Fickliste';
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-a=close]').onclick = close;
    const ext = d.ext ? Object.assign({}, d.ext) : null;
    function profRow(pr, i) {
      const own = pr.sync ? 'sync' : (pr.status || '');
      return `<div class="row" data-pi="${i}">
        <label title="Hauptprofil"><input type="radio" name="xhsc-main" value="${i}" ${i === mainIdx ? 'checked' : ''}> Haupt</label>
        <select data-k="pf" style="width:120px">${optList(PF_CODES.map((c) => [c, PF_LABEL[c] || c]), pr.pf || 'other')}</select>
        <input type="text" data-k="link" placeholder="Link oder Benutzername" value="${esc(pr.url || pr.text || '')}" style="flex:2 1 220px">
        <input type="text" data-k="name" placeholder="Name" value="${esc(pr.name || pr.nick || '')}" style="flex:1 1 120px">
        <select data-k="st" title="Status dieses Profils">${optList([['', 'wie die Person'], ['sync', 'folgt der Person'], ...FL_ORDER.map((k) => [k, FSTAT[k]])], own)}</select>
        <label title="Profil gibt es nicht mehr"><input type="checkbox" data-k="dead" ${isDead(pr) ? 'checked' : ''}> gelöscht</label>
        ${i === mainIdx ? '' : '<button type="button" class="x" data-a="prm" title="Entfernen">✕</button>'}</div>`;
    }
    function meetRow(m, i) {
      return `<div class="meet" data-mi="${i}"><div class="row">
        <input type="date" data-k="date" value="${esc(m.date || '')}"><input type="time" data-k="time" value="${esc(m.time || '')}">
        <input type="text" data-k="club" placeholder="Wo (Club, Ort)" value="${esc(m.club || '')}" style="flex:1 1 160px">
        <input type="text" data-k="where" placeholder="Was (Party, Anlass)" value="${esc(m.where || '')}" style="flex:1 1 160px">
        <button type="button" class="x" data-a="mrm" title="Treffen löschen">✕</button></div>
        <div class="row"><input type="url" data-k="link" placeholder="Link (z. B. Party auf JOYclub oder poppen.de)" value="${esc(m.link || '')}" style="flex:2 1 260px">
        <input type="text" data-k="note" placeholder="Notiz" value="${esc(m.note || '')}" style="flex:2 1 200px">
        <span class="muted" data-pfl>${m.link ? esc(PF_LABEL[m.pf || pfOfUrl(m.link)] || '') : ''}</span>${m.imported ? `<span class="muted">aus der Liste von ${esc(m.imported)}</span>` : ''}</div></div>`;
    }
    function read() {
      // Eingaben → d (vor jedem Neuzeichnen und beim Speichern)
      d.alias = bd.querySelector('[data-k=alias]').value.trim().slice(0, 60);
      d.status = bd.querySelector('[data-k=status]').value || null;
      for (const row of bd.querySelectorAll('[data-pi]')) {
        const pr = profs[+row.dataset.pi];
        const q = (k) => row.querySelector(`[data-k=${k}]`);
        pr.pf = q('pf').value;
        const link = q('link').value.trim();
        if (/^https?:\/\//i.test(link)) { pr.url = link; delete pr.text; } else if (link) { pr.text = link; delete pr.url; } else { delete pr.url; delete pr.text; }
        if (pr.pf === 'xhamster' && pr.url) { const n = nickOfUrl(pr.url); if (n && !pr.nick) pr.nick = n; }
        const nm = q('name').value.trim();
        // Hauptprofile und poppen/xHamster führen „nick“, weitere Profile „name“ (FORMAT.md)
        if (pr.nick != null || pr.pf === 'poppen' || pr.pf === 'xhamster') { if (nm) pr.nick = nm; } else if (nm) pr.name = nm; else delete pr.name;
        const st = q('st').value;
        if (st === 'sync') { pr.sync = true; delete pr.status; } else if (st) { pr.status = st; delete pr.sync; } else { delete pr.status; delete pr.sync; }
        if (q('dead').checked) pr.dead = true; else { delete pr.dead; delete pr.deleted; delete pr.gone; }
      }
      const mr = bd.querySelector('input[name=xhsc-main]:checked');
      if (mr) mainIdx = +mr.value;
      for (const row of bd.querySelectorAll('[data-mi]')) {
        const m = d.meets[+row.dataset.mi];
        for (const k of ['date', 'time', 'club', 'where', 'link', 'note']) { const v = row.querySelector(`[data-k=${k}]`).value.trim(); if (v) m[k] = v; else delete m[k]; }
        if (m.link) m.pf = pfOfUrl(m.link); else delete m.pf;
      }
      d.notes = bd.querySelector('[data-k=notes]').value.slice(0, 8000);
      if (ext) for (const k of ['name', 'typ', 'city', 'short']) { const el = bd.querySelector(`[data-x=${k}]`); if (el) ext[k] = el.value.trim(); }
    }
    function draw() {
      const meets = d.meets.map((m, i) => [m, i]).sort((a, b) => String(b[0].date || '9').localeCompare(String(a[0].date || '9')));
      const hist = (d.history || []).slice(-40).reverse();
      bd.innerHTML = `
        <div class="grid2" style="margin-top:8px">
          <label>Status</label><select data-k="status" style="max-width:220px">${optList(ST_OPTS, d.status || '')}</select>
          <label>Eigener Name</label><input type="text" data-k="alias" maxlength="60" value="${esc(d.alias || '')}" placeholder="z. B. Vorname – Home Assistant zeigt „Name (Nick)“">
        </div>
        ${ext ? `<fieldset><legend>Person ohne Profil (Extern)</legend><div class="grid2">
          <label>Name</label><input type="text" data-x="name" value="${esc(ext.name || '')}">
          <label>Typ</label><input type="text" data-x="typ" value="${esc(ext.typ || '')}" placeholder="z. B. Frau, Paar, Mann">
          <label>Ort</label><input type="text" data-x="city" value="${esc(ext.city || '')}">
          <label>Kurz</label><input type="text" data-x="short" value="${esc(ext.short || '')}" placeholder="kurze Beschreibung">
          <label>Bild</label><div class="row" style="margin:0">${ext.img ? `<img src="${esc(ext.img)}" alt="" style="width:60px;height:60px;object-fit:cover;border-radius:6px">` : ''}<input type="file" accept="image/*" data-x="img"></div>
        </div></fieldset>` : ''}
        <fieldset><legend>Profile („Auch auf …“)</legend>${profs.map(profRow).join('') || '<div class="muted">Noch kein Profil.</div>'}
          <div class="row"><button type="button" class="lnk" data-a="padd">+ Profil hinzufügen</button></div></fieldset>
        <fieldset><legend>Treffen (${d.meets.length})</legend>${meets.map(([m, i]) => meetRow(m, i)).join('') || '<div class="muted">Noch keine Treffen.</div>'}
          <div class="row"><button type="button" class="lnk" data-a="madd">+ Treffen eintragen</button></div></fieldset>
        <fieldset><legend>Anmerkung</legend><textarea data-k="notes" maxlength="8000">${esc(d.notes || '')}</textarea><div class="muted" data-nc></div></fieldset>
        ${rec ? flMediaHtml(rec, true) : ''}
        ${hist.length ? `<fieldset><legend>Verlauf</legend><div class="hist">${hist.map((h) => `<div>${esc(new Date(h.at).toLocaleString())} – ${esc(h.what)}</div>`).join('')}</div></fieldset>` : ''}`;
      const nc = bd.querySelector('[data-nc]'), ta = bd.querySelector('[data-k=notes]');
      const cnt = () => { nc.textContent = `${ta.value.length} / 8000 Zeichen`; };
      ta.oninput = cnt; cnt();
      bd.querySelector('[data-a=padd]').onclick = () => { read(); profs.push({ pf: 'other' }); if (mainIdx < 0 && !ext) mainIdx = profs.length - 1; draw(); };
      bd.querySelector('[data-a=madd]').onclick = () => { read(); d.meets.push({ id: rid('m'), date: new Date().toISOString().slice(0, 10), at: now() }); draw(); const m = bd.querySelector(`[data-mi="${d.meets.length - 1}"] [data-k=club]`); if (m) m.focus(); };
      for (const b of bd.querySelectorAll('[data-a=prm]')) b.onclick = () => { read(); const i = +b.closest('[data-pi]').dataset.pi; profs.splice(i, 1); if (mainIdx > i) mainIdx--; draw(); };
      for (const b of bd.querySelectorAll('[data-a=mrm]')) b.onclick = () => { read(); d.meets.splice(+b.closest('[data-mi]').dataset.mi, 1); draw(); };
      for (const i of bd.querySelectorAll('[data-mi] [data-k=link]')) i.oninput = () => { const s = i.closest('[data-mi]').querySelector('[data-pfl]'); s.textContent = i.value.trim() ? (PF_LABEL[pfOfUrl(i.value.trim())] || '') : ''; };
      const fi = bd.querySelector('[data-x=img]');
      if (fi) fi.onchange = async () => { const f = fi.files && fi.files[0]; if (!f) return; try { read(); ext.img = await fileThumb(f); draw(); } catch (e) { uiToast('Bild nicht lesbar'); } };
      flMediaBind(bd);
    }
    draw();
    ft.innerHTML = `${rec ? '<button type="button" class="btn del" data-a="del">Aus der Fickliste löschen</button>' : ''}<button type="button" class="btn" data-a="cancel">Abbrechen</button><button type="button" class="btn pri" data-a="save">Speichern</button>`;
    ft.querySelector('[data-a=cancel]').onclick = close;
    if (rec) ft.querySelector('[data-a=del]').onclick = async () => {
      const others = [rec.main, ...(rec.profiles || [])].filter((x) => x && x.pf && x.pf !== 'xhamster').length;
      if (!confirm(`${flName(rec)} aus der Fickliste löschen?${others ? '\n\nDie Person steht dann auch in den Skripten der anderen Seiten nicht mehr in der Fickliste.' : ''}\n\nTreffen und Anmerkung gehen dabei verloren.`)) return;
      try { await fickRemove(rec); close(); uiToast(`${esc(flName(rec))} aus der Fickliste gelöscht.`); if (onDone) onDone(null); } catch (e) { uiToast(esc(e.message)); }
    };
    ft.querySelector('[data-a=save]').onclick = async (ev) => {
      read();
      const all = profs.filter((p) => p && (p.url || p.text || p.nick || p.name || p.uid));
      const main = mainIdx >= 0 ? profs[mainIdx] : null;
      if (!ext && !main) { uiToast('Bitte ein Hauptprofil angeben.'); return; }
      if (main && !all.includes(main)) { uiToast('Das Hauptprofil braucht einen Link oder Namen.'); return; }
      const newMain = main || null;
      const newProfiles = all.filter((p) => p !== newMain);
      const at = now();
      // nur Geänderte schreiben (Vergleich mit dem Stand beim Öffnen)
      const ch = {};
      const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
      if (!same(d.status || null, orig.status || null)) ch.status = d.status || null;
      if (!same(d.alias || '', orig.alias || '')) ch.alias = d.alias || '';
      if (!same(newMain, orig.main || null)) ch.main = newMain;
      if (!same(newProfiles, orig.profiles || [])) ch.profiles = newProfiles;
      if (!same(d.meets, orig.meets || [])) ch.meets = d.meets;
      if (!same(d.notes || '', orig.notes || '')) ch.notes = d.notes || '';
      if (ext && !same(ext, orig.ext || null)) ch.ext = ext;
      if (rec && !Object.keys(ch).length) { close(); return; }
      const what = [];
      if ('status' in ch) what.push(ch.status ? `Status „${FSTAT[ch.status]}“` : 'Status entfernt');
      if ('alias' in ch) what.push('eigener Name');
      if ('main' in ch || 'profiles' in ch) what.push('Profile');
      if ('meets' in ch) what.push('Treffen');
      if ('notes' in ch) what.push('Anmerkung');
      if ('ext' in ch) what.push('Angaben zur Person');
      ev.target.disabled = true;
      try {
        const r = await fickPatch(rec ? rec.id : null, (v) => {
          if (!rec) {
            const xm = newMain && newMain.pf === 'xhamster' && newMain.uid;
            Object.assign(v, { id: xm ? 'xh:' + newMain.uid : 'x:' + rid(''), created: at, profiles: [], meets: [] });
          }
          if ('main' in ch) { if (ch.main) v.main = ch.main; else delete v.main; }
          if ('profiles' in ch) v.profiles = ch.profiles;
          if ('status' in ch) { v.status = ch.status; v.statusAt = at; }
          // Profile mit „folgt der Person“ tragen den Status der Person
          for (const p of [v.main, ...(v.profiles || [])]) if (p && p.sync && p.status !== (v.status || undefined)) { if (v.status) p.status = v.status; else delete p.status; p.statusAt = at; }
          if ('alias' in ch) { if (ch.alias) v.alias = ch.alias; else delete v.alias; v.aliasAt = at; }
          if ('meets' in ch) v.meets = ch.meets;
          if ('notes' in ch) { v.notes = ch.notes; v.notesAt = at; v.notesBy = { pf: 'xhamster', acc: (me() || {}).nick || '' }; }
          if ('ext' in ch) { v.ext = ch.ext; if (!v.main && ch.ext.img) v.thumb = ch.ext.img; }
          for (const p of [v.main, ...(v.profiles || [])]) if (p && p.status && !p.sync && p.statusAt == null) p.statusAt = at;
          return true;
        }, rec ? what.join(', ') + ' geändert' : 'angelegt');
        close();
        uiToast(rec ? 'Fickliste gespeichert.' : 'In die Fickliste eingetragen.');
        if (onDone) onDone(r && r.v);
      } catch (e) { ev.target.disabled = false; uiToast(esc(e.message)); }
    };
    document.body.appendChild(ov);
    const first = bd.querySelector('select, input'); if (first) first.focus();
  }
  // „Person hinzufügen“ in der Übersicht: xHamster-Profil (Link) oder Person ohne Profil
  async function flAddPerson(onDone) {
    const s = prompt('Wen eintragen?\n\n• Link zu einem xHamster-Profil einfügen\n• oder einen Namen für eine Person ohne Profil (Extern)\n\nAndere Profile (JOYclub, poppen …) danach unter „Auch auf …“ ergänzen.');
    if (!s || !s.trim()) return;
    const t = s.trim();
    if (/^https?:\/\//i.test(t)) {
      if (pfOfUrl(t) !== 'xhamster') { uiToast('Hier bitte einen xHamster-Link – andere Seiten über ihr Skript eintragen oder danach unter „Auch auf …“.'); return; }
      const nick = nickOfUrl(t);
      if (!nick) { uiToast('Das ist kein Link zu einem Profil.'); return; }
      let ini = null;
      try { ini = initialsOf(await getHtml(profileUrl(nick))); } catch (e) { /* unten */ }
      const dm = ini && ini.displayUserModel;
      if (!dm || !dm.id) { uiToast('Profil nicht gefunden.'); return; }
      const p = { id: String(dm.id), nick: dm.name || nick, url: dm.pageURL || profileUrl(nick) };
      const cur = fickFind(await fickAll(true), p);
      if (cur) { flEdit(cur, null, onDone); return; }
      flEdit(null, { main: { pf: 'xhamster', uid: p.id, nick: p.nick, url: p.url } }, onDone);
      return;
    }
    flEdit(null, { ext: { name: t.slice(0, 80) } }, onDone);
  }

  // ---------- Medien einer Person (Videos und Short Videos mit Schalter) ----------
  function shortOn(mrec, sid) { const v = (mrec.son || {})[sid]; return v !== false; }
  function flMediaRows(r, list, kind) {
    const m = media()[r.id] || {};
    const vurl = gm(VURL_K, {}) || {}, done = new Set(gm(DONE_K, []) || []);
    return list.map((v) => {
      const k = (kind === 's' ? 'xhamster-s' : 'xhamster-v') + v.id;
      const on = kind === 's' ? shortOn(m, v.id) : videoOn(m, v.id);
      const st = done.has(k) ? 'in Home Assistant' : !on ? '' : kind === 's' ? 'wird geschickt' : (vurl[v.id] && now() - vurl[v.id].at < 2.5 * 3600000 ? 'wird geschickt' : 'wird beim nächsten Öffnen des Videos geschickt');
      const id = `xhsc-${kind}-${esc(r.id)}-${esc(v.id)}`.replace(/[^\w-]/g, '_');
      return `<div style="display:flex;gap:8px;align-items:center;margin:4px 0">
        <input type="checkbox" class="switcher" id="${id}" data-rec="${esc(r.id)}" data-${kind === 's' ? 'sid' : 'vid'}="${esc(v.id)}" ${on ? 'checked' : ''}><label for="${id}" class="switcher-visible"></label>
        ${v.thumb ? `<img src="${esc(v.thumb)}" alt="" style="width:${kind === 's' ? 36 : 64}px;height:${kind === 's' ? 64 : 36}px;object-fit:cover;border-radius:4px">` : ''}
        <a href="${esc(v.url)}" target="_blank" rel="noopener" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title || v.id)}</a>
        <span style="opacity:.6;font-size:12px;white-space:nowrap">${esc(st)}</span></div>`;
    }).join('');
  }
  // Abschnitt „Bilder · Short Videos (n) · Videos (n)“; asField = im Dialog als fieldset
  function flMediaHtml(r, asField) {
    const m = media()[r.id];
    if (!m) return '';
    const sh = m.shorts || [], vi = m.videos || [];
    const parts = [];
    if (m.nPics) parts.push(`<div>${m.nPics} Bilder</div>`);
    if (sh.length) parts.push(`<details style="margin-top:4px"><summary style="cursor:pointer;font-weight:600">Short Videos (${sh.length})</summary>${flMediaRows(r, sh, 's')}</details>`);
    else if (m.nShorts) parts.push(`<div>${m.nShorts} Short Videos</div>`);
    if (vi.length) parts.push(`<details style="margin-top:4px"><summary style="cursor:pointer;font-weight:600">Videos (${vi.length})${vi.length > VIDEO_AUTO_MAX ? ' <span style="font-weight:400;opacity:.6">– mehr als 5: einzeln einschalten</span>' : ''}</summary>${flMediaRows(r, vi, 'v')}</details>`);
    if (!parts.length) return '';
    return asField ? `<fieldset><legend>Bilder und Videos (Home Assistant)</legend>${parts.join('')}</fieldset>` : `<div style="margin-top:6px">${parts.join('')}</div>`;
  }
  function flMediaBind(root) {
    for (const c of root.querySelectorAll('input[data-vid]')) c.onchange = async () => { await videoToggle(c.dataset.rec, c.dataset.vid, !!c.checked); if (c.checked) mediaUpload().catch(() => {}); };
    for (const c of root.querySelectorAll('input[data-sid]')) c.onchange = async () => { await shortToggle(c.dataset.rec, c.dataset.sid, !!c.checked); if (c.checked) mediaUpload().catch(() => {}); };
  }
  async function shortToggle(recId, sid, on) {
    const ms = media();
    const m = ms[recId];
    if (!m) return;
    m.son = Object.assign({}, m.son || {}, { [sid]: !!on });
    gs(MEDIA_K, ms);
    const v = (m.shorts || []).find((x) => x.id === sid) || { id: sid, url: '' };
    if (on) await picsMerge(recId, [{ k: 'xhamster-s' + sid, src: '', pf: 'xhamster', at: now(), v: 1, vid: sid, page: v.url, short: 1 }], [], ['xhamster-s' + sid]);
    else await picsMerge(recId, [], ['xhamster-s' + sid]);
  }

  // ---------- Profilseite: Stand unter dem Steckbrief (links) und Block „Fickliste“ (rechts, ganz oben) ----------
  function flUserInfo(p, cur) {
    const ud = document.querySelector('.user-details');
    let box = document.querySelector('.xhsc-fl-userinfo');
    if (!ud) return;
    if (!box) { edCss(); box = document.createElement('div'); box.className = 'xhsc-fl-userinfo'; ud.after(box); }
    const k = cur && cur.status ? FL_KIND[cur.status] : '';
    const mainOther = cur && cur.main && !isXh(cur.main, p) ? cur.main : null;
    const html = cur
      ? `<div style="display:flex;align-items:center;gap:8px">${flIcon(k, { size: 18, redGef: true })}<span>Auf der Fickliste: <b style="color:${FCOL[cur.status] || 'inherit'}">${esc(FSTAT[cur.status] || 'ohne Status')}</b></span></div>` +
        (mainOther ? `<div style="opacity:.75">Hauptprofil: ${esc(PF_LABEL[mainOther.pf] || mainOther.pf)}${mainOther.nick || mainOther.name ? ' – ' + esc(mainOther.nick || mainOther.name) : ''}</div>` : '') +
        (cur.alias ? `<div style="opacity:.75">Eigener Name: ${esc(cur.alias)}</div>` : '')
      : '';
    if (box.innerHTML !== html) box.innerHTML = html;
    box.style.display = html ? '' : 'none';
  }
  function flProfileBlock(p, cur) {
    const rc = document.querySelector('.right-column');
    let bl = document.querySelector('.xhsc-fl-block');
    if (!cur) { if (bl) bl.remove(); return; }
    if (!rc) return;
    edCss();
    if (!bl) { bl = document.createElement('div'); bl.className = 'column-block xhsc-fl-block'; rc.prepend(bl); }
    const others = [cur.main, ...(cur.profiles || [])].filter((x) => x && x.pf && !isXh(x, p));
    const meets = (cur.meets || []).filter((m) => m && (m.date || m.club || m.where)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const meetLine = (m) => {
      const bits = [m.date ? deDate(m.date) + (m.time ? ' ' + esc(m.time) : '') : '', esc(m.club || ''), esc(m.where || '')].filter(Boolean).join(' · ');
      return `<div>${bits || '–'}${m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(PF_LABEL[m.pf || pfOfUrl(m.link)] || 'Link')}</a>` : ''}${m.note ? `<div style="opacity:.7;font-size:12px">${esc(String(m.note).slice(0, 300))}</div>` : ''}</div>`;
    };
    const notes = String(cur.notes || '').trim();
    const arch = archList(p.id);
    const html = `<div class="heading-container"><h4 class="heading pull-left" style="display:flex;align-items:center;gap:8px">${flIcon(cur.status ? FL_KIND[cur.status] : '', { size: 20, redGef: true })}Fickliste</h4><span class="xhsc-flb-edit" data-a="edit">Bearbeiten</span></div>
      <div class="content-container" style="clear:both">
        <div><b style="color:${FCOL[cur.status] || 'inherit'}">${esc(FSTAT[cur.status] || 'ohne Status')}</b>${cur.alias ? ` · ${esc(cur.alias)}` : ''}</div>
        ${others.length ? `<div class="sub">Auch auf</div>${others.map((x) => { const u = profUrl(x); const lab = esc(x.pf === 'other' ? (x.pfName || 'Sonstige') : (PF_LABEL[x.pf] || x.pf)) + (x.nick || x.name ? ': ' + esc(x.nick || x.name) : x.text ? ': ' + esc(x.text) : ''); return `<div${isDead(x) ? ' style="opacity:.5;text-decoration:line-through"' : ''}>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${lab}</a>` : lab}</div>`; }).join('')}` : ''}
        ${meets.length ? `<div class="sub">Treffen (${meets.length})</div>${meets.slice(0, 5).map(meetLine).join('')}${meets.length > 5 ? `<details><summary style="cursor:pointer;opacity:.8">alle ${meets.length} anzeigen</summary>${meets.slice(5).map(meetLine).join('')}</details>` : ''}` : ''}
        ${notes ? `<div class="sub">Anmerkung</div><div class="xhsc-fl-note" style="white-space:pre-wrap;max-height:7.5em;overflow:hidden;cursor:pointer" title="Klicken: ganz anzeigen">${esc(notes)}</div>` : ''}
        ${flMediaHtml(cur, false)}
        ${arch.length ? `<div class="sub">Profil-Archiv</div><span class="xhsc-flb-edit" style="float:none" data-a="arch">${arch.length} gespeicherte Stände ansehen</span>` : ''}
      </div>`;
    const sig = String(cur.rev || 0) + '|' + JSON.stringify(media()[cur.id] || {}).length + '|' + arch.length + '|' + (gm(DONE_K, []) || []).length;
    if (bl.dataset.sig === sig) return;
    bl.dataset.sig = sig;
    bl.innerHTML = html;
    bl.querySelector('[data-a=edit]').onclick = () => flEdit(cur, null, () => flButton(true));
    const an = bl.querySelector('[data-a=arch]'); if (an) an.onclick = () => archShow(p.id, flName(cur));
    const n = bl.querySelector('.xhsc-fl-note'); if (n) n.onclick = () => { n.style.maxHeight = n.style.maxHeight ? '' : '7.5em'; };
    flMediaBind(bl);
  }

  // ---------- Profil-Archiv (ab 0.4.0): alle Angaben eines Profils der Fickliste, auch nach dem Löschen ----------
  // GM xh_arch: { <xHamster-ID>: [{ at, h, nick, url, img, gone, data: { … } }, …] } – neuer Stand nur bei Änderung
  const ARCH_K = 'xh_arch', ARCH_MAX = 15;
  const archAll = () => gm(ARCH_K, {}) || {};
  const archList = (id) => (archAll()[String(id)] || []);
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function archData(p) {
    const ini = initials() || {};
    const dm = ini.displayUserModel || {};
    const details = [...document.querySelectorAll('.user-details .details-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const about = ((ini.profileEditableAboutMe || {}).about) || ((document.querySelector('.about-me-block-container') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const interests = (((ini.interests || {}).interestsList) || []).map((x) => (x && (x.name || x.title || x.label)) || x).filter((x) => typeof x === 'string');
    const m = Object.values(media()).find((x) => String(x.uid) === p.id) || {};
    return {
      id: p.id, nick: p.nick, url: p.url, retired: !!p.retired, info: p.info || {}, personal: dm.personalInfo || null, about: String(about || '').slice(0, 8000), interests,
      website: (p.info && p.info.Website) || '', details, counters: ini.counters || null, added: ini.userAddTime || null,
      galleries: m.nPics != null ? m.nPics : null, shorts: (m.shorts || []).map((v) => ({ id: v.id, title: v.title, url: v.url })), videos: (m.videos || []).map((v) => ({ id: v.id, title: v.title, url: v.url })),
    };
  }
  let archBusy = false;
  async function archSnap(p, cur) {
    if (archBusy || !p || !cur || !p.id) return;
    archBusy = true;
    try {
      const all = archAll();
      const list = all[p.id] || [];
      const last = list[list.length - 1];
      if (p.retired) {
        // gelöschtes Profil: nur den Zeitpunkt merken, Angaben bleiben die alten
        if (last && !last.gone) { last.gone = now(); all[p.id] = list; gs(ARCH_K, all); }
        return;
      }
      const data = archData(p);
      const h = hashStr(JSON.stringify(Object.assign({}, data, { details: data.details.filter((x) => !/online|last seen|views|subscribers/i.test(x)), counters: null })));
      if (last && last.h === h && now() - last.at < 30 * 86400000) return;
      let img = last && last.img;
      if (p.thumb && (!img || !last || last.h !== h)) { try { img = await thumbData(p.thumb); } catch (e) { /* ohne Bild */ } }
      if (last && last.h === h) { last.at = now(); last.img = img || last.img; } else list.push({ at: now(), h, nick: p.nick, url: p.url, img: img || '', data });
      if (last && last.gone && !p.retired) delete last.gone;
      all[p.id] = list.slice(-ARCH_MAX);
      gs(ARCH_K, all);
    } finally { archBusy = false; }
  }
  function archHtml(s) {
    const d = s.data || {};
    const rows = Object.entries(d.info || {}).map(([k, v]) => `<div><span class="muted">${esc(k)}:</span> ${esc(v)}</div>`).join('');
    return `<div style="display:flex;gap:12px;align-items:flex-start">${s.img ? `<img src="${esc(s.img)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:8px">` : ''}
      <div style="min-width:0"><div><b>${esc(s.nick)}</b> <span class="muted">#${esc(d.id)}</span></div>${rows}
      ${(d.details || []).length ? `<div class="muted" style="margin-top:4px">${d.details.map(esc).join(' · ')}</div>` : ''}
      ${d.website ? `<div>Website: ${esc(d.website)}</div>` : ''}${(d.interests || []).length ? `<div>Interessen: ${d.interests.map(esc).join(', ')}</div>` : ''}
      ${d.about ? `<div style="white-space:pre-wrap;margin-top:6px">${esc(d.about)}</div>` : ''}
      ${d.galleries != null ? `<div class="muted" style="margin-top:4px">${d.galleries} Bilder · ${(d.shorts || []).length} Short Videos · ${(d.videos || []).length} Videos</div>` : ''}
      ${(d.videos || []).length ? `<details><summary style="cursor:pointer">Videos</summary>${d.videos.map((v) => `<div>${esc(v.title || v.id)}</div>`).join('')}</details>` : ''}</div></div>`;
  }
  function archShow(id, name) {
    edCss();
    const list = archList(id).slice().reverse();
    if (!list.length) { uiToast('Kein gespeicherter Stand.'); return; }
    const ov = document.createElement('div');
    ov.className = 'xhsc-ov';
    const gone = list.find((s) => s.gone);
    ov.innerHTML = `<div class="xhsc-ed"><div class="hd"><h3>Profil-Archiv: ${esc(name || list[0].nick)}</h3><button type="button" class="x" style="color:#bbb;font-size:22px">×</button></div><div class="bd">
      ${gone ? `<p style="color:#ff7875;margin:10px 0">Profil gelöscht seit ${esc(new Date(gone.gone).toLocaleDateString())}</p>` : ''}
      <fieldset style="border-top:0"><legend>Stand vom ${esc(new Date(list[0].at).toLocaleString())}</legend>${archHtml(list[0])}</fieldset>
      ${list.slice(1).map((s) => `<details style="margin-top:8px"><summary style="cursor:pointer">Stand vom ${esc(new Date(s.at).toLocaleString())}</summary><div style="margin-top:6px">${archHtml(s)}</div></details>`).join('')}</div></div>`;
    const close = () => ov.remove();
    ov.querySelector('.x').onclick = close;
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }
  // gelöschtes Profil der Fickliste: im Eintrag als gelöscht markieren (nur weitere Profile; das Hauptprofil bleibt, wie es ist)
  async function flMarkGone(p, cur) {
    if (!p.retired || !cur) return;
    const pr = (cur.profiles || []).find((x) => isXh(x, p));
    if (!pr || isDead(pr)) return;
    await fickPatch(cur.id, (v) => { const x = (v.profiles || []).find((y) => isXh(y, p)); if (!x || isDead(x)) return false; x.dead = true; return true; }, 'xHamster-Profil gelöscht');
  }

  // ---------- eigenes Profil: Kasten mit Zählern und den letzten Treffen ----------
  async function flOwnBox() {
    const m = me();
    const ini = initials() || {};
    const dm = ini.displayUserModel;
    if (!m || !dm || String(dm.id) !== String(m.id) || document.querySelector('.xhsc-fl-own')) return;
    const rc = document.querySelector('.right-column');
    if (!rc) return;
    let list = [];
    try { list = await fickAll(); } catch (e) { return; }
    if (document.querySelector('.xhsc-fl-own')) return;
    edCss();
    const cnt = (k) => list.filter((r) => r.status === k).length;
    const meets = [];
    for (const r of list) for (const x of r.meets || []) if (x && x.date) meets.push([x, r]);
    meets.sort((a, b) => String(b[0].date).localeCompare(String(a[0].date)));
    const bl = document.createElement('div');
    bl.className = 'column-block xhsc-fl-block xhsc-fl-own';
    bl.innerHTML = `<div class="heading-container"><h4 class="heading pull-left" style="display:flex;align-items:center;gap:8px">${flIcon('gef', { size: 20, redGef: true })}Meine Fickliste</h4><span class="xhsc-flb-edit" data-a="open">Öffnen</span></div>
      <div class="content-container" style="clear:both"><div>${list.length} Einträge · ${FL_ORDER.map((k) => `<span style="color:${FCOL[k]}">${esc(FSTAT[k])} ${cnt(k)}</span>`).join(' · ')}</div>
      ${meets.length ? `<div class="sub">Letzte Treffen</div>${meets.slice(0, 5).map(([x, r]) => `<div>${esc(deDate(x.date))} · ${esc(flName(r))}${x.club ? ' · ' + esc(x.club) : ''}</div>`).join('')}` : ''}</div>`;
    bl.querySelector('[data-a=open]').onclick = flOpen;
    rc.prepend(bl);
  }

  // =====================================================================
  // Kopfzeile (ab 0.2.5): Werbe-Links „Live Sex“, „Nude Chat“, „Premium Videos“ ausblenden; bei „Benutzer ist
  // Moppel-Liebhaber“ (poppen-Einstellung) vor „Pornstars“ der Link zur Moppel-Suche, Name wie im poppen-Skript
  // (Bezeichnung der Stufe 3, Mehrzahl)
  // =====================================================================
  const XXL_ICON = { w: '<mask id="__ID__"><rect width="64" height="64" fill="#fff"/> <path d="M11.5 31.5 C14 36 22 37 28.5 34.5 C31 33.5 33 32 39.5 31.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/> <path d="M13.5 47.8 Q24 52 37 48.4" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round"/> <path d="M22.8 23 C23.8 26 24.2 30 23.6 33.5" stroke="#000" stroke-width="0.9" fill="none" stroke-linecap="round"/> <path d="M31.7 52.5 L31.7 61" stroke="#000" stroke-width="1.2" stroke-linecap="round"/> <circle cx="21.5" cy="41" r="1" fill="#000"/> </mask> <path d="M30.5 4.5 C33.5 1 39.5 1.5 41 6 C42 9.5 41 12.5 43 15.5 C44.8 18 44.5 21.5 42.5 23.5 C42 20.5 40 18.5 38 17.5 C39.5 14 38.5 10 36 8.5 C34 7.3 31.5 7.2 30.5 4.5Z"/> <path d="M30.2 5.5 C33.5 4 37.5 5.5 38 9.5 C38.4 12.5 36.5 15 34 15.3 C31.5 15.6 29.5 14 29 11.5 C28.6 9.5 28.8 7 30.2 5.5Z"/> <path d="M31.8 14.8 L36 14.8 L36.6 18 L31.2 18Z"/> <path d="M41 19.5 C44.5 22 45.6 27 45.3 32 C45 36 44.5 39.5 42.5 42.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/> <g mask="url(#__ID__)"> <path d="M26 18 C31 16.6 37 16.8 40 18.5 C41.8 20 42 23 41.6 26.5 C41.3 29 40.5 30.5 39.5 31.5 C34 32 31 33.5 28.5 35 C22 38 13.5 37 11 33 C9.5 30 10.5 25.5 13.5 22.5 C16 19.5 21 18.5 26 18Z"/> <path d="M14 34 C20 36.5 26 36 30 34 L40.5 31.5 C42.5 35 43 40 41.5 44 C40.5 47 38.5 48.8 36 49.5 C30 51.5 18.5 51 13 48 C8.5 45.5 7.5 40 9.5 37 C10.8 35 12 34.2 14 34Z"/> <path d="M19 49.5 C18.5 53.5 19.8 57.5 21.5 61.5 L41 61.5 C41.8 57.5 42 53.5 40.5 48.5Z"/> </g> <path d="M21 62 L30 62 L29.5 63.6 L21.5 63.6Z"/><path d="M33.5 62 L41.5 62 L41 63.6 L33.5 63.6Z"/>', m: '<mask id="__ID__"><rect width="64" height="64" fill="#fff"/> <path d="M20.5 27 C23.5 30.5 28 30.8 31 28.5 M33 28.5 C36 30.8 40.5 30.5 43.5 27" stroke="#000" stroke-width="1.1" fill="none" stroke-linecap="round"/> <path d="M14.5 46 C22 51 42 51 49.5 46" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/> <circle cx="32" cy="41" r="1.1" fill="#000"/> <path d="M28.3 13.5 C30 15 34 15 35.7 13.5" stroke="#000" stroke-width="0.7" fill="none" stroke-linecap="round"/> <path d="M32 50.5 L32 61.5" stroke="#000" stroke-width="1.3" stroke-linecap="round"/> </mask> <path mask="url(#__ID__)" d="M27 8.5 C26.3 4.5 28.8 2.2 32 2.2 C35.2 2.2 37.7 4.5 37 8.5 C37.6 9.6 37.6 11 37 12 C36.8 15 34.8 17.3 32 17.3 C29.2 17.3 27.2 15 27 12 C26.4 11 26.4 9.6 27 8.5Z"/> <path d="M29.5 16 L34.5 16 L35 18.5 L29 18.5Z"/> <path d="M14 22.5 C10.5 26.5 9.5 33 10 39 C10.3 42.5 11 45 12 47" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/> <path d="M50 22.5 C53.5 26.5 54.5 33 54 39 C53.7 42.5 53 45 52 47" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/> <g mask="url(#__ID__)"> <path d="M22 18.5 C27 17.2 37 17.2 42 18.5 C46.5 19.8 49 22.5 49 26.5 C49 29 48.5 31 49 33 C51.5 37 52 42.5 49.5 46.5 C46.5 50.5 39 51.8 32 51.8 C25 51.8 17.5 50.5 14.5 46.5 C12 42.5 12.5 37 15 33 C15.5 31 15 29 15 26.5 C15 22.5 17.5 19.8 22 18.5Z"/> <path d="M16 48 C21 51.5 43 51.5 48 48 C48.5 52.5 47.5 57.5 46.5 62 L17.5 62 C16.5 57.5 15.5 52.5 16 48Z"/> </g>' };
  let xxlIconN = 0;
  const xxlIconSvg = (g) => { const id = 'xhsc-xxlm' + (xxlIconN++); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="20" height="20" fill="currentColor" aria-hidden="true">${XXL_ICON[g === 'm' ? 'm' : 'w'].replace(/__ID__/g, id)}</svg>`; };
  function navCss() {
    if (document.getElementById('xhsc-nav-css')) return;
    const st = document.createElement('style');
    st.id = 'xhsc-nav-css';
    st.textContent = '[data-role="header-top-menu"] [data-nav-item-id="cams"],[data-role="header-top-menu"] [data-nav-item-id="premium"],[data-role="header-top-menu"] [data-nav-item-id="flirtify"],[data-role="header-top-menu"] li[data-nav-item-id="cams"],[data-role="header-top-menu"] li[data-nav-item-id="premium"],[data-role="header-top-menu"] li[data-nav-item-id="flirtify"]{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
    adCss(gm('xh_ad_prefix', ''));
  }
  // =====================================================================
  // Werbung (ab 0.3.0): xHamster gibt allen Werbe-Blöcken eine zufällige Vorsilbe vor die Klassennamen (bannerPrefix
  // in den Seitendaten, wechselt). Alles, dessen Klasse oder data-role damit beginnt, wird ausgeblendet. Dazu als
  // zweiter Weg: Blöcke mit Links zu Cams, Premium und Nude Chat (/cam/out, /fh/out, /ff/out) und Cam-Vorschauen.
  // =====================================================================
  const AD_LINK = 'a[href*="/cam/out"], a[href*="/fh/out"], a[href*="/ff/out"], [data-cam-autoplay-driven], .cam-preview-video';
  const AD_BOX = '[class*="cam-wgt"], [class*="widget"], [class*="Widget"], [class*="banner"], [class*="Banner"], [class*="promo"], [class*="Promo"]';
  function adCss(prefix) {
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(prefix || '')) return;
    let st = document.getElementById('xhsc-ad-css');
    if (st && st.dataset.p === prefix) return;
    if (!st) { st = document.createElement('style'); st.id = 'xhsc-ad-css'; (document.head || document.documentElement).appendChild(st); }
    st.dataset.p = prefix;
    const p = prefix.replace(/["\\]/g, '');
    st.textContent = `[class^="${p}"],[class*=" ${p}"],[data-role^="${p}"]{display:none!important}`;
  }
  function adHide() {
    const ini = initials() || {};
    const p = ini.bannerPrefix;
    if (p && p !== gm('xh_ad_prefix', '')) gs('xh_ad_prefix', p);
    if (p) adCss(p);
    for (const a of document.querySelectorAll(AD_LINK)) {
      if (a.closest('[data-role="header-top-menu"], #xhsc-box, .xhsc-set, .xhsc-fl-list') || a.dataset.xhscAd) continue;
      const box = a.closest(AD_BOX) || a;
      // nie ganze Seitenbereiche: der Block darf keine Profile, Videos oder Nachrichten der Seite enthalten
      const big = box.querySelector('a[href*="/users/"], a[href*="/videos/"]:not([href*="/cam/"]), .message, [data-role="user-list"]');
      const el = big ? a : box;
      el.style.setProperty('display', 'none', 'important');
      a.dataset.xhscAd = '1';
    }
  }
  // gesuchtes Geschlecht wie mopSeek() im poppen-Skript; ohne poppen-Profil nach dem eigenen xHamster-Geschlecht
  function mopSeek(s = rules()) {
    const g = s.popG || [];
    if (g.length >= 2) return g.every((x) => x === 'm') ? 'm' : 'w';
    const gay = (s.sextype || [])[0] === 1;
    let t = g[0];
    if (!t) { const mg = gm('xh_me_gender', ''); t = mg === 'female' ? 'w' : mg === 'male' ? 'm' : ''; }
    if (t === 'w') return gay ? 'w' : 'm';
    if (t === 'tv') return (s.moppel.types || []).includes('pw') ? 'w' : 'm';
    return gay ? 'm' : 'w';
  }
  // 0.3.0: eigene Länder (Vorgabe de) und Altersobergrenze = ein Jahr unter „Ignorieren ab“ der gesuchten Gruppe
  const mopCountries = () => String(gm('xh_mop_cty', 'de') || '').split(/[,; ]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]{2}$/.test(x));
  function mopUrl(cc) {
    const s = rules();
    const g = mopSeek(s);
    const grp = s.groups[g];
    const lim = (s.expert.sharedLimits ? grp.src.global : grp.src.suche) || grp.src.interaktionen;
    const q = { gender: g === 'm' ? 'male' : 'female', body: 'large' };
    if (lim && lim[2] < AGE_MAX) q.maxAge = String(Math.max(18, lim[2] - 1));
    q.sort = 'activity';
    return `${location.origin}/dating${cc ? '/' + cc : ''}?${new URLSearchParams(q)}`;
  }
  const ccName = (cc) => { try { return new Intl.DisplayNames(['de'], { type: 'region' }).of(cc.toUpperCase()) || cc.toUpperCase(); } catch (e) { return cc.toUpperCase(); } };
  function mopNav() {
    const s = rules();
    const ps = document.querySelector('[data-role="header-top-menu"] [data-nav-item-id="pornstars"]');
    const old = document.querySelector('[data-role="header-top-menu"] .xhsc-mop-nav');
    const ccs = mopCountries();
    const sig = `${s.moppel.on}|${ccs.join(',')}|${mopUrl(ccs[0] || '')}|${(s.moppel.labels || [])[5] || ''}`;
    if (old && old.dataset.sig !== sig) old.remove();
    if (!s.moppel.on) return;
    if (!ps || (old && old.isConnected && old.dataset.sig === sig)) return;
    const a0 = ps.querySelector('a');
    const ic0 = a0 && a0.querySelector('.xh-icon:not([class*="arrowIcon"])');
    const tx0 = a0 && a0.querySelector('[class*="linkText-"]');
    const arr0 = a0 && a0.querySelector('[class*="arrowIcon"]');
    const ul0 = ps.querySelector('ul.dropdown');
    const li0 = ul0 && ul0.querySelector('li a');
    if (!a0) return;
    const many = ccs.length > 1;
    const d = document.createElement('div');
    d.className = String(ps.className).replace(/\bxh-dropdown\b/, many ? 'xh-dropdown' : '').trim() + ' xhsc-mop-nav';
    d.dataset.sig = sig;
    const label = (s.moppel.labels || [])[5] || 'XXL';
    const sub = many ? `<ul class="${esc(ul0 ? ul0.className : 'dropdown')}">${ccs.map((cc) => `<li><a class="${esc(li0 ? li0.className : '')}" href="${esc(mopUrl(cc))}"></a></li>`).join('')}</ul>` : '';
    d.innerHTML = `<a class="${esc(a0.className)}" href="${esc(mopUrl(ccs[0] || ''))}" tabindex="-1"><span class="${esc(ic0 ? ic0.className : 'xh-icon')}">${xxlIconSvg(mopSeek())}</span> <div class="${esc(tx0 ? tx0.className : '')}"></div>${many && arr0 ? arr0.outerHTML : ''}</a>${sub}`;
    d.querySelector('a > div').textContent = label;
    d.querySelectorAll('ul a').forEach((x, i) => { x.textContent = ccName(ccs[i]); });
    ps.before(d);
  }

  // =====================================================================
  // Einstellungsseite „Opa-Schutz“ (ab 0.2.7) in „Edit profile“ (/my/edit/profile), Eintrag in der linken Leiste
  // hinter „Privacy“. Die Regeln selbst werden im poppen-Skript geändert; hier stehen sie nur zum Nachsehen.
  // =====================================================================
  const SET_HASH = '#opa-schutz';
  const setUrl = () => location.origin + '/my/edit/profile' + SET_HASH;
  const onEditPage = () => /^\/my\/edit\/profile\/?$/.test(location.pathname);
  // eigenes, ruhiges Raster statt xHamsters Formularzeilen (die sind für Eingabefelder gebaut, nicht für Text)
  const SET_CSS = `.xhsc-set{font-size:14px;line-height:1.45;max-width:900px}
.xhsc-set section{padding:4px 0 18px;margin-bottom:18px;border-bottom:1px solid rgba(128,128,128,.25)}
.xhsc-set section:last-child{border-bottom:0}
.xhsc-set h3{font-size:16px;font-weight:700;margin:0 0 10px}
.xhsc-set .xs-note{opacity:.75;margin:0 0 12px}
.xhsc-set .xs-grid{display:grid;grid-template-columns:240px minmax(0,1fr);column-gap:24px;row-gap:12px;align-items:center}
.xhsc-set .xs-k{font-weight:600}
.xhsc-set .xs-k small{display:block;font-weight:400;opacity:.6;font-size:12.5px;line-height:1.35;margin-top:2px}
.xhsc-set table{border-collapse:collapse;margin:0 0 14px;width:100%;max-width:760px}
.xhsc-set th,.xhsc-set td{text-align:left;padding:6px 14px 6px 0;border-bottom:1px solid rgba(128,128,128,.2);white-space:nowrap}
.xhsc-set th{font-weight:600;opacity:.7;font-size:12.5px}
.xhsc-set td:first-child{font-weight:600}
.xhsc-set input.xs-in{background:transparent;color:inherit;border:1px solid rgba(128,128,128,.5);border-radius:8px;padding:7px 10px;font:inherit;width:100%;max-width:240px;box-sizing:border-box}
.xhsc-set .xs-btns{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
.xhsc-set .xs-warn{color:#ef6c00}`;
  function setRow(label, html, tip) {
    return `<div class="xs-k">${esc(label)}${tip ? `<small>${esc(tip)}</small>` : ''}</div><div>${html}</div>`;
  }
  // Schieberegler mit drei Griffen (Stufe 1 bis, Stufe 2 bis, Ignorieren ab) – Farben wie die Markierungen
  const SLIDER_CSS = `.xhsc-set .xs-grp{padding:10px 0 14px;border-bottom:1px solid rgba(128,128,128,.18)}
.xhsc-set .xs-grp:last-of-type{border-bottom:0}
.xhsc-set .xs-gh{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.xhsc-set .xs-gh b{font-size:15px;min-width:80px}
.xhsc-set .xs-src{font-size:12.5px;opacity:.7}
.xhsc-set .xs-src.own{opacity:1;color:#ffb74d}
.xhsc-set .xs-mini{border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit;border-radius:14px;padding:2px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.xhsc-set .xs-slider{position:relative;height:30px;max-width:620px;margin:4px 0 2px}
.xhsc-set .xs-track{position:absolute;left:9px;right:9px;top:12px;height:6px;border-radius:3px;background:#555;overflow:hidden}
.xhsc-set .xs-seg{position:absolute;top:0;bottom:0}
.xhsc-set .xs-slider input[type=range]{position:absolute;left:0;top:4px;width:100%;margin:0;background:transparent;pointer-events:none;-webkit-appearance:none;appearance:none;height:22px;outline:none}
.xhsc-set .xs-slider input[type=range]::-webkit-slider-runnable-track{background:transparent;height:22px}
.xhsc-set .xs-slider input[type=range]::-moz-range-track{background:transparent}
.xhsc-set .xs-slider input[type=range]::-webkit-slider-thumb{pointer-events:auto;-webkit-appearance:none;width:18px;height:18px;margin-top:2px;border-radius:50%;background:#fff;border:2px solid #333;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.xhsc-set .xs-slider input[type=range]::-moz-range-thumb{pointer-events:auto;width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid #333;cursor:pointer}
.xhsc-set .xs-vals{font-size:13.5px;margin:2px 0 8px}
.xhsc-set .xs-vals b{font-variant-numeric:tabular-nums}
.xhsc-set .xs-sw{display:flex;gap:28px;align-items:center;flex-wrap:wrap}
.xhsc-set .xs-sw span{display:inline-flex;align-items:center;gap:10px}`;
  const GROUP_NAME = { m: 'Männer', w: 'Frauen', p: 'Paare' };
  const effLim = (g, s) => [...((s.expert.sharedLimits ? g.src.global : g.src.suche) || g.src.interaktionen)];
  function grpHtml(gk, s) {
    const g = s.groups[gk]; const l = labelsOf(gk, s); const x = effLim(g, s);
    const own = !!s.own[gk];
    const sw = (k, on, lab) => `<span><input type="checkbox" class="switcher" id="xhsc-g-${gk}-${k}" data-g="${gk}" data-sw="${k}" ${on ? 'checked' : ''}><label for="xhsc-g-${gk}-${k}" class="switcher-visible"></label>${lab}</span>`;
    return `<div class="xs-grp" data-g="${gk}">
      <div class="xs-gh"><b>${GROUP_NAME[gk]}</b><span class="xs-src${own ? ' own' : ''}">${own ? 'eigene Werte für xHamster' : 'wie poppen.de'}</span>${own ? `<button type="button" class="xs-mini" data-reset="${gk}">Wieder wie poppen.de</button>` : ''}</div>
      <div class="xs-slider" data-g="${gk}"><div class="xs-track"><div class="xs-seg" data-s="1" style="background:${STAGE_COL[1]}"></div><div class="xs-seg" data-s="2" style="background:${STAGE_COL[2]}"></div><div class="xs-seg" data-s="3" style="background:${STAGE_COL[3]}"></div><div class="xs-seg" data-s="4" style="background:#e53935"></div></div>
      ${x.map((v, i) => `<input type="range" min="18" max="${AGE_MAX}" step="1" value="${v}" data-i="${i}" aria-label="${['Stufe 1 bis', 'Stufe 2 bis', 'Ignorieren ab'][i]}">`).join('')}</div>
      <div class="xs-vals" data-g="${gk}" data-l="${esc(JSON.stringify([l[0], l[2], l[4]]))}"></div>
      <div class="xs-sw">${sw('visual', g.visual, 'markieren')}${sw('ignore', g.ignore, 'ignorieren')}${own ? sw('age', !!((gm(OWNK, {}) || {})[gk] || {}).age, 'Grenzen altern mit mir') : ''}</div></div>`;
  }
  // Segmente und Text eines Reglers nach den aktuellen Werten
  function sliderPaint(box, gk) {
    const sl = box.querySelector(`.xs-slider[data-g="${gk}"]`);
    const v = [...sl.querySelectorAll('input')].map((i) => +i.value);
    const pct = (a) => ((a - 18) / (AGE_MAX - 18)) * 100;
    const seg = (n, a, b) => { const e = sl.querySelector(`.xs-seg[data-s="${n}"]`); e.style.left = pct(a) + '%'; e.style.width = Math.max(0, pct(b) - pct(a)) + '%'; };
    seg(1, 18, v[0]); seg(2, v[0], v[1]); seg(3, v[1], v[2]); seg(4, v[2], AGE_MAX);
    const vals = box.querySelector(`.xs-vals[data-g="${gk}"]`);
    const l = JSON.parse(vals.dataset.l);
    const top = (a) => (a >= AGE_MAX ? 'offen' : a);
    vals.innerHTML = `${esc(l[0])} bis <b>${top(v[0])}</b> · ${esc(l[1])} bis <b>${top(v[1])}</b> · ${esc(l[2])} ab <b>${v[2] >= AGE_MAX ? '–' : v[2]}</b>`;
  }
  function ownSet(gk, patch) {
    const own = gm(OWNK, {}) || {};
    const s = rules();
    const cur = own[gk] || { lim: effLim(s.groups[gk], s), visual: !!s.groups[gk].visual, ignore: !!s.groups[gk].ignore };
    own[gk] = Object.assign(cur, patch);
    gs(OWNK, own); rulesCache = null;
  }
  function setPanelHtml() {
    const s = rules();
    const o = opa();
    const last = gm('xh_oscan_last', null);
    const sw = (id, on) => `<input type="checkbox" class="switcher" id="${id}" ${on ? 'checked' : ''}><label for="${id}" class="switcher-visible"></label>`;
    const lastTxt = last ? `${last.mode === 'dry' ? 'Probelauf' : 'Blockieren'} am ${esc(new Date(last.at).toLocaleString('de-DE'))}: ${esc(last.why)} · ${last.seen} gesehen · ${last.hits} Treffer · ${last.done} blockiert${last.fail ? ` · ${last.fail} Fehler` : ''}` : '<span style="opacity:.6">noch keiner</span>';
    const fromPoppen = (gm(POPK, null) || {}).src === 'poppen';
    const ha = haParse(gm(K.ha, ''));
    const ms = mediaStats();
    return `<style>${SET_CSS}${SLIDER_CSS}</style>
      <section><h3>Altersgrenzen</h3>
      <p class="xs-note">Vorgabe sind die Werte von poppen.de. Was Du hier verschiebst, gilt nur für xHamster.</p>
      ${['m', 'w', 'p'].map((gk) => grpHtml(gk, s)).join('')}</section>
      <section><h3>Von poppen.de</h3><div class="xs-grid">
      ${setRow('Stand', fromPoppen ? esc(s.from) : '<span class="xs-warn">Vorgaben des poppen-Skripts – keine Einstellungs-Kopie von poppen.de gefunden</span>', fromPoppen ? '' : 'poppen.de einmal mit installiertem xHamster-Skript öffnen, dann „Regeln neu laden“')}
      ${setRow('Bezeichnungen und Whitelist', `${(s.whitelist.names || []).length} Namen · Präfixe: ${esc((s.whitelist.prefixes || []).join(', ') || '–')}`, 'dazu immer: Freunde, Fickliste, Du selbst')}
      ${setRow('Moppel-Liebhaber', s.moppel.on ? `an – Link „${esc((s.moppel.labels || [])[5] || 'XXL')}“ in der Kopfzeile` : 'aus')}
      ${s.moppel.on ? setRow(`Länder für „${(s.moppel.labels || [])[5] || 'XXL'}“`, `<input class="xs-in" data-k="mopcty" value="${esc(gm('xh_mop_cty', 'de'))}">`, 'Kürzel, durch Komma getrennt; mehrere = Aufklappmenü') : ''}
      </div>
      <div class="xs-btns"><button type="button" class="xh-button black" data-a="reload">Regeln neu laden</button></div></section>
      <section><h3>Bezeichnungen und Whitelist für xHamster</h3>
      <p class="xs-note">Leer = wie poppen.de. Je Stufe Einzahl und Mehrzahl.</p><div class="xs-grid">
      ${['m', 'w', 'p'].map((gk) => { const l = labelsOf(gk, s); const ownL = ((gm(OWNK, {}) || {})[gk] || {}).labels; return setRow(GROUP_NAME[gk], [0, 1, 2, 3, 4, 5].map((i) => `<input class="xs-in" data-lab="${gk}" value="${esc(ownL ? ownL[i] : '')}" placeholder="${esc(l[i])}" style="max-width:130px;margin:0 4px 4px 0">`).join(''), ownL ? 'eigene Bezeichnungen' : ''); }).join('')}
      ${setRow('Whitelist: Namen', `<textarea class="xs-in" data-white="names" rows="3" style="max-width:360px;width:100%">${esc(ownWhite().names.join('\n'))}</textarea>`, 'ein Nick je Zeile – zusätzlich zur Whitelist von poppen.de')}
      ${setRow('Whitelist: Präfixe', `<textarea class="xs-in" data-white="prefixes" rows="2" style="max-width:360px;width:100%">${esc(ownWhite().prefixes.join('\n'))}</textarea>`, 'Nicks, die so anfangen')}
      ${setRow('Immer ausgenommen', 'Freunde, Abos (Subscriptions), Fickliste, Du selbst')}
      </div></section>
      <section><h3>Anzeige</h3><div class="xs-grid">
      ${setRow(`${OWs()} in der Dating-Suche ausblenden`, sw('xhsc-set-hide', o.hide), 'aus = nur abdunkeln')}
      ${s.moppel.on ? setRow(`${esc((s.moppel.labels || [])[5] || 'XXL')} zuerst`, sw('xhsc-set-mopsort', !!gm('xh_mop_sort', false)), 'Dating-Suche nach Körpertyp sortieren (bekannt aus Profilen und der Suche „Large“)') : ''}
      </div></section>
      <section><h3>${OW()}-Scan</h3><div class="xs-grid">
      ${setRow('Länder', `<input class="xs-in" data-k="cty" value="${esc(gm('xh_oscan_cty', 'de,at,ch'))}">`, 'Kürzel, durch Komma getrennt; leer = alle')}
      ${setRow('Höchstens je Lauf blockieren', `<input class="xs-in" data-k="max" type="number" min="1" value="${esc(gm('xh_oscan_max', 200))}" style="max-width:120px">`)}
      ${setRow('Letzter Lauf', lastTxt)}
      </div>
      <div class="xs-btns"><button type="button" class="xh-button black" data-a="dry">Probelauf (zählt nur)</button><button type="button" class="xh-button red" data-a="block">${OWs()} blockieren</button></div></section>
      <section><h3>Blockierliste und Interaktionen</h3><div class="xs-grid">
      ${setRow('Blockiert', `${((gm(K.lists, {}) || {}).blocked || []).length} · davon ${Object.keys(gm(BYME_K, {}) || {}).length} vom Skript · abgeglichen ${gm('xh_blocksync_at', 0) ? esc(new Date(gm('xh_blocksync_at', 0)).toLocaleString('de-DE')) : 'noch nie'}`, 'Abgleichen liest alle Seiten von „Blocked users“; danach Rückfrage, falls nach den Regeln jemand entsperrt werden kann')}
      ${setRow('Vorgemerkt', `${Object.keys(gm(VORM_K, {}) || {}).length} kurz vor der Grenze · ${vmDue().length} inzwischen drüber`, `werden beim nächsten „${OWs()} blockieren“ zuerst gesperrt`)}
      ${(() => { const il = gm('xh_iscan_last', null); return setRow('Interaktionen', il ? `${il.mode === 'dry' ? 'Probelauf' : 'Blockieren'} am ${esc(new Date(il.at).toLocaleString('de-DE'))}: ${il.seen} Absender · ${il.hits} über der Grenze · ${il.done} blockiert` : '<span style="opacity:.6">noch nicht geprüft</span>', 'Absender aus den Benachrichtigungen (Kommentare, Gifts, Freundschaften)'); })()}
      </div>
      <div class="xs-btns"><button type="button" class="xh-button black" data-a="bsync">Blockierliste abgleichen</button><button type="button" class="xh-button black" data-a="idry">Interaktionen: Probelauf</button><button type="button" class="xh-button red" data-a="iblock">Interaktionen: blockieren</button></div></section>
      <section><h3>Home Assistant</h3><div class="xs-grid">
      ${setRow('Adresse', `${ha ? '<span>eingetragen</span> ' : '<span class="xs-warn">nicht eingetragen</span> '}<input class="xs-in" data-k="ha" type="password" autocomplete="off" placeholder="neue Adresse einfügen" style="max-width:360px;margin-top:6px">`, 'aus Home Assistant: Swinger Companion › Konfigurieren (gleiche Adresse wie beim JOYclub-Skript)')}
      ${setRow('Bilder und Videos der Fickliste', `${ms.pics} Bilder · ${ms.shorts} Short Videos · ${ms.videosOn} von ${ms.videos} Videos · ${ms.sent} an Home Assistant geschickt${ms.waiting ? ` · ${ms.waiting} warten` : ''}`, 'Videos: bis 5 je Person alle, sonst einzeln einschalten')}
      </div></section>
      <section><h3>Sicherung und Prüflauf</h3><div class="xs-grid">
      ${setRow('Konto', (() => { const ow = gm(OWNER_K, null); return ow ? `gebunden an ${esc(ow.nick)} seit ${esc(new Date(ow.seit).toLocaleDateString('de-DE'))}${(ow.also || []).length ? ` · auch: ${esc(ow.also.map((y) => y.nick).join(', '))}` : ''}` : 'noch nicht gebunden'; })(), 'bei einem anderen angemeldeten Konto bleibt das Skript aus')}
      ${(() => { const t = gm('xh_selftest_last', null); return setRow('Letzter Prüflauf', t ? `${esc(new Date(t.at).toLocaleString('de-DE'))} (${esc(t.ver)}): ${t.bad} Fehler · ${t.warn} Hinweise` : '<span style="opacity:.6">noch keiner</span>', 'geht alle Funktionen durch und ändert nichts'); })()}
      </div>
      <div class="xs-btns"><button type="button" class="xh-button black" data-a="test">Prüflauf starten</button><button type="button" class="xh-button black" data-a="bexp">Sicherung exportieren</button><button type="button" class="xh-button black" data-a="bimp">Sicherung einspielen</button></div></section>`;
  }
  function setBind(box) {
    const q = (sel) => box.querySelector(sel);
    q('[data-a=reload]').onclick = async () => { await rulesRefresh(true); setFill(box); uiToast('Regeln neu geladen.'); relaxCheck(); };
    q('#xhsc-set-hide').onchange = (e) => { const o = opa(); o.hide = !!e.target.checked; gs(K.opa, o); };
    q('[data-k=cty]').onchange = (e) => gs('xh_oscan_cty', e.target.value.trim());
    q('[data-k=max]').onchange = (e) => gs('xh_oscan_max', Math.max(1, parseInt(e.target.value, 10) || 200));
    const mc = q('[data-k=mopcty]'); if (mc) mc.onchange = (e) => gs('xh_mop_cty', e.target.value.trim());
    q('[data-k=ha]').onchange = (e) => { const v = e.target.value.trim(); if (!v) return; if (!haParse(v)) { uiToast('Das ist keine gültige Adresse.'); return; } gs(K.ha, v); setFill(box); uiToast('Home-Assistant-Adresse gespeichert.'); };
    // Start mit den Werten dieser Seite (ohne Rückfragen nach Land und Höchstzahl)
    q('[data-a=dry]').onclick = () => oscanStart('dry', true);
    q('[data-a=block]').onclick = () => oscanStart('block', true);
    for (const gk of ['m', 'w', 'p']) {
      const ins = [...box.querySelectorAll(`.xs-slider[data-g="${gk}"] input`)];
      ins.forEach((inp, i) => {
        inp.addEventListener('input', () => {
          // Reihenfolge halten: Stufe 1 ≤ Stufe 2 ≤ Ignorieren ab
          const v = ins.map((x) => +x.value);
          if (i < 2 && v[i] > v[i + 1]) v[i] = v[i + 1];
          if (i > 0 && v[i] < v[i - 1]) v[i] = v[i - 1];
          inp.value = v[i];
          sliderPaint(box, gk);
        });
        inp.addEventListener('change', () => { ownSet(gk, { lim: ins.map((x) => +x.value) }); setFill(box); relaxCheck(); });
      });
      sliderPaint(box, gk);
    }
    for (const c of box.querySelectorAll('input[data-sw]')) c.onchange = () => { ownSet(c.dataset.g, { [c.dataset.sw]: !!c.checked }); if (c.dataset.sw === 'age') gs('xh_my_age_last', ageOf(gm('xh_me_bday', null)) || 0); setFill(box); if (c.dataset.sw === 'ignore') relaxCheck(); };
    for (const b of box.querySelectorAll('[data-reset]')) b.onclick = () => { const own = gm(OWNK, {}) || {}; const lab = (own[b.dataset.reset] || {}).labels; if (lab) own[b.dataset.reset] = { labels: lab }; else delete own[b.dataset.reset]; gs(OWNK, own); rulesCache = null; setFill(box); relaxCheck(); };
    // 0.5.0: eigene Bezeichnungen, eigene Whitelist, Blockierliste, Interaktionen, Sicherung, Prüflauf
    for (const gk of ['m', 'w', 'p']) {
      const ins = [...box.querySelectorAll(`input[data-lab="${gk}"]`)];
      ins.forEach((inp) => { inp.onchange = () => {
        const own = gm(OWNK, {}) || {};
        const v = ins.map((i) => i.value.trim());
        own[gk] = Object.assign({}, own[gk] || {});
        if (v.every(Boolean)) own[gk].labels = v; else delete own[gk].labels;
        if (!Object.keys(own[gk]).length) delete own[gk];
        gs(OWNK, own); rulesCache = null; setFill(box);
      }; });
    }
    for (const t of box.querySelectorAll('textarea[data-white]')) t.onchange = () => { const w = ownWhite(); w[t.dataset.white] = t.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 2000); gs(WHITE_K, w); rulesCache = null; relaxCheck(); };
    const bt = (a, f) => { const e = q(`[data-a=${a}]`); if (e) e.onclick = f; };
    bt('bsync', async () => { try { await blockSync(); setFill(box); relaxCheck(); } catch (e) { uiToast(esc(e.message)); } });
    bt('idry', () => iscanStart('dry'));
    bt('iblock', () => iscanStart('block'));
    bt('bexp', backupExport);
    bt('bimp', backupImport);
    bt('test', () => selfTest());
    const ms2 = q('#xhsc-set-mopsort'); if (ms2) ms2.onchange = (e) => gs('xh_mop_sort', !!e.target.checked);
  }
  function setFill(box) { box.innerHTML = setPanelHtml(); setBind(box); }
  // linke Leiste: Eintrag „Opa-Schutz“ hinter „Privacy“ (Vorlage: ein vorhandener Eintrag)
  function setMenu() {
    if (!onEditPage()) return;
    const ul = document.querySelector('[data-role="edit-menu"] ul');
    if (!ul || ul.querySelector('.xhsc-set-li')) return;
    const lis = [...ul.children];
    const priv = lis.find((li) => /^\s*privacy\s*$/i.test(li.textContent)) || lis[lis.length - 1];
    const proto = lis.find((li) => li.getAttribute('aria-current') !== 'page') || lis[0];
    if (!priv || !proto) return;
    const li = proto.cloneNode(true);
    li.classList.add('xhsc-set-li');
    li.setAttribute('aria-current', 'false');
    const lab = li.querySelector('[class*="label-"]') || li;
    lab.textContent = ` ${OW()}-Schutz `;
    priv.after(li);
    li.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setOpen(); }, true);
  }
  let setState = null;
  function setOpen() {
    if (!onEditPage()) { location.assign(setUrl()); return; }
    setMenu();
    const ul = document.querySelector('[data-role="edit-menu"] ul');
    const block = document.querySelector('.edit-profile-block .content-container-no-overflow') || document.querySelector('.edit-profile-block');
    const li = ul && ul.querySelector('.xhsc-set-li');
    if (!ul || !block || !li) return;
    if (setState) return;
    const lis = [...ul.children].filter((x) => x !== li);
    const cur = lis.find((x) => x.getAttribute('aria-current') === 'page') || null;
    // Klassen, die nur der gewählte Eintrag hat (gehasht, deshalb abgeguckt)
    const selCls = cur ? [...cur.classList].filter((c) => lis.filter((x) => x !== cur).every((x) => !x.classList.contains(c))) : [];
    const tabs = [...block.children].filter((x) => !x.classList.contains('xhsc-set'));
    setState = { cur, selCls, tabs: tabs.map((t) => [t, t.style.display]) };
    tabs.forEach((t) => { t.style.display = 'none'; });
    if (cur) { selCls.forEach((c) => cur.classList.remove(c)); cur.setAttribute('aria-current', 'false'); }
    selCls.forEach((c) => li.classList.add(c)); li.setAttribute('aria-current', 'page');
    const box = document.createElement('div');
    box.className = 'xhsc-set';
    block.prepend(box);
    setFill(box);
    if (location.hash !== SET_HASH) try { history.replaceState(null, '', location.pathname + location.search + SET_HASH); } catch (e) { /* egal */ }
    // anderer Eintrag der Leiste: Seite wie vorher, dann übernimmt xHamster (Lauscher vor dem von xHamster)
    const leave = (ev) => {
      const t = ev.target.closest('li');
      if (!t || t === li || !setState) return;
      ul.removeEventListener('click', leave, true);
      box.remove();
      setState.tabs.forEach(([el, d]) => { el.style.display = d; });
      selCls.forEach((c) => li.classList.remove(c)); li.setAttribute('aria-current', 'false');
      if (setState.cur) { selCls.forEach((c) => setState.cur.classList.add(c)); setState.cur.setAttribute('aria-current', 'page'); }
      setState = null;
      if (location.hash === SET_HASH) try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* egal */ }
    };
    ul.addEventListener('click', leave, true);
  }
  function setCheckHash() { if (onEditPage() && location.hash === SET_HASH) setOpen(); }

  // =====================================================================
  // Textvorlagen im Messenger (ab 0.3.0): Knopf rechts neben den Smileys. Die gemeinsamen Vorlagen (Briefkasten, Ablage
  // „tpl“) stehen in JOYclub-Schreibweise; ihre Smileys werden in xHamster-Smileys (`:name:`) übersetzt, sonst in
  // Unicode-Emoji (Tabelle aus der Smiley-Liste des poppen-Skripts). Mit „https://“ im Text kommen 10 Sternchen und ein
  // Leerzeichen an den Anfang der Nachricht (sonst ersetzt xHamster die Zeichen 2–9 durch Sternchen, siehe NOTIZEN).
  // =====================================================================
  const JOY2XH = {"*danke*":":pray:","*thankyou*":":pray:","*g*":":smile:",":)":":smile:",":-)":":smile:","*kuss*":":kiss:","*schleck4*":":kiss:","*top*":":thumbsup:","*ggg*":":grin:",":D":":grin:",":-D":":grin:","*lol*":":joy:",":lol:":":joy:","*smile*":":relaxed:","*gg*":":smiley:","*zwinker*":":wink:",";)":":wink:",";-)":":wink:","*zwinker2*":":wink:",":wink:":":wink:","*xd*":":laughing:","*achtung*":"❗",":!:":"❗","*exclaim*":"❗","*alarm*":"🚨","*knuddel*":"🤗","*wink*":":wave:","*grins*":":grin:","*mrgreen*":":grin:",":mrgreen:":":grin:","*fiesgrins*":":smiling_imp:",":twisted:":":smiling_imp:","*twisted*":":smiling_imp:","*lach*":":laughing:","*haha*":":laughing:","*rotfl*":"🤣","*rofl*":"🤣","*haumichwech*":"🤣","*freu*":":smiley:","*juhu*":"🥳","*juchu*":"🥳","*happy*":":relaxed:","*witz*":":laughing:","*traenenlach*":":joy:","*aetsch*":":stuck_out_tongue:","*baeh*":":stuck_out_tongue:",":P":":stuck_out_tongue:",":-P":":stuck_out_tongue:",":razz:":":stuck_out_tongue:","*razz*":":stuck_out_tongue:","*selbstgefall*":":smirk:","*goofy*":"🤪","*oh*":":hushed:",":o":":hushed:",":-o":":hushed:",":surprised:":":hushed:","*surprised*":":hushed:","*oh2*":":hushed:","*schock*":":scream:",":shock:":":scream:","*shock*":":scream:","*panik*":"😨","*umfall*":":dizzy_face:","*gr*":":angry:",":x":":angry:","*gr2*":":imp:",":evil:":":imp:","*evil*":":imp:","*gr3*":":rage:","*gleichplatz*":"🤬","*uah*":":confounded:","*motz*":":triumph:","*fluch*":"🤬","*basta*":":triumph:","*freundchen*":":angry:","*kommmalherfreundchen*":":angry:","*blauesauge*":"🤕","*headcrash*":"🤕","*grimasse*":"😬","*snief*":":disappointed:",":(":":disappointed:",":-(":":disappointed:",":sad:":":disappointed:","*sad*":":disappointed:","*snief2*":":cry:",":cry:":":cry:","*cry*":":cry:","*heul*":":sob:","*heul2*":":sob:","*snief3*":":sob:","*flenn*":":sob:","*traurig*":":pensive:","*liebeskummer*":":broken_heart:","*troest*":"🤗","*keks*":"🤗","*muede*":":|",":|":":|",":-|":":|",":neutral:":":|","*neutral*":":|","*morgen*":":|","*gaehn*":"🥱","*gaehn2*":"🥱","*zzz*":"💤","*heia*":":sleeping:","*heia2*":":sleeping:","*baby2*":"👶","*tel*":"📞","*blabla*":"💬","*bla*":"💬","*bla2*":"💬","*lalala*":"🎶","*schweig*":"🤐","*fluester*":"🤫","*dafuer*":":thumbsup:","*dagegen*":"👎","*flop*":"👎","*top2*":":thumbsup:","*bravo*":":clap:","*zugabe*":":clap:","*spitze*":":ok_hand:","*tomaten*":"🍅","*wow*":"😲","*sabber*":"🤤","*umpf*":"🤢","*arg*":"🤢","*pfui*":"🤢","*victory*":":v:","*hi5*":":raised_hands:","*hutab*":"🎩","*100*":":100:","*wuerg*":"🤮","*wuerg2*":"🤮","*ko*":":dizzy_face:","*crazy2*":":dizzy_face:","*aspirin*":"💊","*sternchen*":":dizzy:","*3tagewach*":"😩","*schnupfen*":"🤧","*hatschi*":"🤧","*gehirnschnecke*":"🐌","*schwester*":"🧑‍⚕️","*mundschutz*":":mask:","*essen*":"🍴","*grill*":"🍖","*bier*":":beer:","*eis*":":icecream:","*lolli*":":lollipop:","*torte*":":birthday:","*muffin*":"🧁","*tee*":"🍵","*wein*":":wine_glass:","*cocktail*":":cocktail:","*fliege2*":"🦟","*whiskey*":"🥃","*prost*":":beer:","*party*":":beer:","*cheers*":"🥂","*stoesschen*":"🥂","*sekt*":"🍾","*party2*":"🍾","*zig*":"🚬","*troet*":":tada:","*twist*":"💃","*yo*":"💃","*walk*":"💃","*dance*":"💃","*boogie*":"💃","*hicks*":"🥴","*hochleb*":":raised_hands:","*stammtisch*":":beer:","*feuerwerk*":"🎆","*knuddel2*":"😚","*knutsch*":"😚","*knutsch2*":"😚","*friends*":"👫","*bussi*":"😙","*kuss2*":":kiss:","*herz*":":heart:","*herz2*":"💕","*herz3*":"💗","*herz4*":"💖","*love*":":heart:","*love2*":":heart:","*love3*":":heart:","*love4*":":heart:","*love5*":":heart_eyes:","*blume*":"🌹","*blumezupf*":":blossom:","*blumenschenk*":":bouquet:","*roseschenk*":"🌹","*geschenk*":":gift:","*osolemio*":"🎤","*hochzeit*":"💒","*kuss3*":":kissing_heart:","*bussi2*":":kissing_heart:","*knutsch3*":":kissing_heart:","*knutsch4*":":kissing_heart:","*blume2*":"🌷","*sweetkiss*":":kissing_heart:","*liebguck*":"🥰","*anbet*":"🙇","*floet*":":kissing_face:","*skeptisch*":"🤨","*pueh*":":expressionless:","*schmoll*":":expressionless:","*stolzbin*":":relieved:","*autsch*":"🤕","*cool*":":sunglasses:","8)":":sunglasses:","8-)":":sunglasses:","*cool2*":":sunglasses:","*aua*":"🤕","*huch*":"😲","*oh3*":"😲","*oh4*":"😲","*hae*":":confused:",":?":":confused:","*nixweiss*":"🤷","*naund*":"🤷","*schiefguck*":":confused:",":/":":confused:",":-/":":confused:",":confused:":":confused:","*confused*":":confused:","*roll*":"🙄",":roll:":"🙄","*sarkasmus*":"🙄","*gruebel*":"🤔","*nachdenk*":"🤔","*kopfklatsch*":"🤦","*rotwerd*":":flushed:",":oops:":":flushed:",":redface:":":flushed:","*redface*":":flushed:","*schaem*":":flushed:","*angsthab*":":cold_sweat:","*ballaballa*":"🤪","*blumenwiese*":":blossom:","*vielglueck*":"🍀","*augenzu*":":see_no_evil:","*tanz*":"💃","*tanz2*":"💃","*tipp*":"💻","*les*":"📰","*mail*":"✉","*duschen*":"🚿","*wc*":"🚽","*omm*":":innocent:","*huhu*":":wave:","*bye*":":wave:","*fahr*":"🚗","*knips*":"📷","*film*":"🎥","*meld*":"🙋","*knicks*":"🙇","*popcorn*":"🍿","*popcorn2*":"🍿","*puh*":":sweat_smile:","*clown*":"🤡","*sing*":"🎸","*strick*":"🧶","*putz*":"🧹","*tauch*":"🏊","*fussball*":"⚽","*spanner*":"👀","*zocker*":"🎮","*megaphon*":"📢","*pumpi*":":muscle:","*pumpi2*":":muscle:","*fernglas*":"🔭","*engel*":":innocent:","*engel2*":"👼","*oma*":"👵","*opa*":"👴","*baby*":"👶","*bauarbeiter*":"👷","*polizei*":"👮","*maler*":"🎨","*koenig*":":crown:","*koenigin*":"👸","*dj*":"🎧","*rock*":"🎸","*gitarre*":"🎸","*drummer*":"🥁","*piano*":"🎹","*nikolaus*":"🎅","*teufel*":":smiling_imp:","*angel*":"👼","*wahrsager*":"🔮","*katze*":":cat:","*kuh*":"🐮","*huhn*":"🐔","*dance2*":"🐔","*schwein*":":pig:","*hund*":":dog:","*schmetterling*":"🦋","*bug*":"🐛","*einhorn*":"🦄","*fuchs*":"🦊","*schnecke*":"🐌","*wolf*":"🐺","*hamster*":":hamster:","*sonne*":"☀","*regen*":"☔","*frier*":"🥶","*schwitz*":":sweat:","*regenbogen*":":rainbow:","*pfeil*":"➡",":arrow:":"➡","*arrow*":"➡","*frage*":"❓",":?:":"❓","*question*":"❓","*idee*":"💡",":idea:":"💡","*idea*":"💡","*foto*":"📷","*beep*":"🚨","*hilfe*":"🆘","*help*":"🆘","*happybirthday*":":birthday:","*deutschland*":"🇩🇪","*bayern*":"Bayern","*bw*":"Baden-Württemberg","*berlin*":"Berlin","*brandenburg*":"Brandenburg","*bremen*":"Bremen","*hamburg*":"Hamburg","*hessen*":"Hessen","*mv*":"Mecklenburg-Vorpommern","*niedersachsen*":"Niedersachsen","*nrw*":"Nordrhein-Westfalen","*rheinland*":"Rheinland-Pfalz","*saarland*":"Saarland","*sachsen*":"Sachsen","*anhalt*":"Sachsen-Anhalt","*schleswig*":"Schleswig-Holstein","*thueringen*":"Thüringen","*oesterreich*":"🇦🇹","*schweiz*":"🇨🇭","*niederlande*":"🇳🇱"};
  const JOY_TOK = Object.keys(JOY2XH).sort((a, b) => b.length - a.length);
  function joyToXh(text) {
    const s = String(text || ''), out = [];
    let i = 0;
    while (i < s.length) {
      const rest = s.slice(i);
      if (/^(https?:\/\/|www\.)/i.test(rest)) { const m = rest.match(/^\S+/); out.push(m[0]); i += m[0].length; continue; }
      const hit = JOY_TOK.find((t) => s.startsWith(t, i));
      if (hit) { out.push(JOY2XH[hit]); i += hit.length; continue; }
      out.push(s[i]); i++;
    }
    return out.join('');
  }
  const STARS = '**********';
  const needStars = (t) => /https?:\/\//i.test(t) && !String(t).startsWith(STARS);
  let tplCache = null, tplAt = 0;
  async function tplAll() {
    if (tplCache && now() - tplAt < 60000) return tplCache;
    const l = await SH.call('all', { s: 'tpl' }, 20000);
    tplCache = (l || []).filter((x) => x && !x.deleted && x.name).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de', { sensitivity: 'base' }));
    tplAt = now();
    return tplCache;
  }
  // an der Schreibmarke einfügen (wie Strg+V: Zeilenumbrüche bleiben), dann bei Links die Sternchen vorn
  function tplInsert(ed, text) {
    ed.focus();
    const t = joyToXh(text).replace(/\r\n?/g, '\n');
    let dt = null;
    try { dt = new DataTransfer(); dt.setData('text/plain', t); } catch (e) { dt = null; }
    const handled = dt ? !ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) : false;
    if (!handled) { try { document.execCommand('insertText', false, t); } catch (e) { ed.append(t); } }
    const full = (ed.innerText || ed.textContent || '');
    if (needStars(full)) {
      try {
        const r = document.createRange(); r.setStart(ed, 0); r.collapse(true);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        document.execCommand('insertText', false, STARS + ' ');
      } catch (e) { ed.prepend(STARS + ' '); }
    }
    ed.dispatchEvent(new InputEvent('input', { bubbles: true, data: t, inputType: 'insertText' }));
  }
  const TPL_ICON = '<path d="M4 3h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2 3v1.6h8V6H6Zm0 3v1.6h5.5V9H6Z"/>';
  function tplButton() {
    const emo = document.querySelector('[class*="emojiDropdown-"]');
    if (!emo || emo.parentElement.querySelector('.xhsc-tpl')) return;
    const btn0 = emo.querySelector('button');
    const w = document.createElement('div');
    w.className = 'xhsc-tpl';
    w.style.cssText = 'position:relative;display:inline-flex';
    w.innerHTML = `<button type="button" class="${esc(btn0 ? btn0.className : '')}" data-tooltip="Textvorlage einfügen" title="Textvorlage einfügen"><span class="${esc((btn0 && btn0.querySelector('span') || {}).className || '')}"><svg viewBox="0 0 20 20" width="20" fill="currentColor">${TPL_ICON}</svg></span></button>`;
    emo.after(w);
    w.querySelector('button').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); tplMenu(w); });
  }
  async function tplMenu(w) {
    const old = document.getElementById('xhsc-tpl-dd');
    if (old) { old.remove(); return; }
    const dd = document.createElement('div');
    dd.id = 'xhsc-tpl-dd';
    dd.style.cssText = 'position:absolute;right:0;bottom:calc(100% + 6px);z-index:2147483640;width:340px;max-height:360px;overflow:auto;background:#25272b;border:1px solid #3a3d43;border-radius:10px;padding:6px 0;box-shadow:0 8px 24px rgba(0,0,0,.6);font:13.5px/1.4 system-ui,sans-serif;color:#fff;text-align:left';
    dd.innerHTML = '<div style="padding:8px 14px;opacity:.6">Lade die Textvorlagen …</div>';
    w.appendChild(dd);
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('click', off, true); } }, true), 0);
    let l;
    try { l = await tplAll(); } catch (e) { dd.innerHTML = `<div style="padding:8px 14px;color:#ff7875">Textvorlagen nicht erreichbar: ${esc(e.message)}</div>`; return; }
    let terms = [];
    try { terms = await termUpcoming(); } catch (e) { terms = []; }
    if (!l.length && !terms.length) { dd.innerHTML = '<div style="padding:8px 14px;opacity:.6">Keine Textvorlagen. Angelegt werden sie im JOYclub- oder poppen-Skript.</div>'; return; }
    dd.innerHTML = '';
    // 0.5.0: die nächsten Termine aus der gemeinsamen Termin-Datei
    if (terms.length) {
      const h = document.createElement('div'); h.style.cssText = 'padding:6px 14px 2px;font-weight:600;opacity:.8'; h.textContent = 'Termine'; dd.appendChild(h);
      for (const t of terms) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:5px 14px;cursor:pointer';
        row.textContent = [t.wann, t.wo, t.was].filter(Boolean).join(' · ');
        row.addEventListener('mouseenter', () => { row.style.background = '#33363c'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.addEventListener('click', (ev) => {
          ev.stopPropagation(); dd.remove();
          const ed = [...document.querySelectorAll('.xh-editable-content[contenteditable]')].find((x) => x.isConnected) || null;
          if (!ed) { uiToast('Kein Eingabefeld gefunden.'); return; }
          tplInsert(ed, [t.wann, t.wo, t.was, t.link].filter(Boolean).join(' - '));
        });
        dd.appendChild(row);
      }
      if (l.length) { const h2 = document.createElement('div'); h2.style.cssText = 'padding:8px 14px 2px;font-weight:600;opacity:.8;border-top:1px solid #3a3d43;margin-top:4px'; h2.textContent = 'Textvorlagen'; dd.appendChild(h2); }
    }
    for (const t of l) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:7px 14px;cursor:pointer';
      const pv = joyToXh(t.text || '').replace(/\s+/g, ' ').slice(0, 90);
      row.innerHTML = `<div style="font-weight:600"></div><div style="opacity:.65;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>`;
      row.children[0].textContent = t.name; row.children[1].textContent = pv;
      row.addEventListener('mouseenter', () => { row.style.background = '#33363c'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', (ev) => {
        ev.stopPropagation(); dd.remove();
        const ed = [...document.querySelectorAll('.xh-editable-content[contenteditable]')].find((x) => x.isConnected) || null;
        if (!ed) { uiToast('Kein Eingabefeld gefunden.'); return; }
        tplInsert(ed, t.text || '');
      });
      dd.appendChild(row);
    }
  }

  // =====================================================================
  // Bilder und Videos der Fickliste an Home Assistant (ab 0.3.0)
  //  - Sammeln (im Hintergrund, eine Person je Lauf, je Person einmal am Tag): alle Bilder aller Galerien, alle Short
  //    Videos, die Liste der Videos. Bilder und Shorts kommen in pics[] des gemeinsamen Eintrags (k: xhamster-<Foto-ID>,
  //    xhamster-s<ID>), Videos nur, wenn sie synchronisiert werden (xhamster-v<ID>): bis 5 je Person alle, sonst einzeln
  //    eingeschaltet (Videoseite oder Fickliste). Ausgeschaltete bleiben eingetragen, aber mit off: true.
  //  - Schicken: Bilder und Shorts lädt das Skript selbst (die Adressen gelten nur kurz und nur für die eigene IP).
  //    Videos: xHamster verschlüsselt ihre Adresse in den Seitendaten; das Skript merkt sich die Videoliste (m3u8), die
  //    der Player beim Öffnen der Videoseite lädt, und schickt das Video dann (gilt etwa 3 Stunden).
  //  - Home Assistant nimmt nur Bilder an, die eine Fickliste-Lieferung (JOYclub-Skript) schon gemeldet hat; sonst kommt
  //    „unknown picture“ und das Skript versucht es eine Stunde später wieder.
  // =====================================================================
  const MEDIA_K = 'xh_media';      // { <Eintrag-ID>: { nick, uid, scanAt, videos: [{ id, title, thumb, url }], von: { <ID>: bool } } }
  const VURL_K = 'xh_vurl';        // { <Video-ID>: { u, at } } – zuletzt gesehene Videoliste (m3u8) je Video
  const DONE_K = 'xh_ha_done';     // [k, …] schon in Home Assistant
  const WAIT_K = 'xh_ha_wait';     // { k: Zeitpunkt } – Home Assistant wollte es noch nicht
  const VIDEO_AUTO_MAX = 5;
  const media = () => gm(MEDIA_K, {}) || {};
  const nickOfUrl = (u) => { const m = /\/users\/(?:profiles\/)?([^/?#]+)/i.exec(String(u || '')); return m ? decodeURIComponent(m[1]) : ''; };
  function xhProfileOf(rec) {
    for (const pr of [rec.main, ...(rec.profiles || [])]) {
      if (!pr || pr.pf !== 'xhamster' || pr.dead || pr.deleted || pr.gone) continue;
      const nick = nickOfUrl(pr.url) || pr.nick || pr.name || '';
      if (nick) return { nick, uid: pr.uid ? String(pr.uid) : '' };
    }
    return null;
  }
  function videoOn(mrec, vid) {
    const v = (mrec.von || {})[vid];
    if (v === true || v === false) return v;
    return (mrec.videos || []).length <= VIDEO_AUTO_MAX;
  }
  function mediaStats() {
    let pics = 0, shorts = 0, videos = 0, videosOn = 0;
    const done = new Set(gm(DONE_K, []) || []);
    const wait = gm(WAIT_K, {}) || {};
    for (const [id, m] of Object.entries(media())) {
      pics += m.nPics || 0; shorts += m.nShorts || 0;
      videos += (m.videos || []).length;
      videosOn += (m.videos || []).filter((v) => videoOn(m, v.id)).length;
      void id;
    }
    return { pics, shorts, videos, videosOn, sent: done.size, waiting: Object.keys(wait).length };
  }
  async function getHtml(url) {
    for (let n = 1; n <= 4; n++) {
      const res = await W.fetch(url, { credentials: 'include' });
      if (res.status === 200) return res.text();
      if (res.status !== 503 && res.status !== 429) throw new Error(`${url}: ${res.status}`);
      await sleep(retryDelay(n));
    }
    throw new Error(`${url}: überlastet`);
  }
  // Links der Form …/<pfad>/<n> auf die Seite n+1 (Galerien, Videos, Shorts eines Profils)
  function nextLink(html, base, page) {
    const re = /href="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const u = m[1].replace(/&amp;/g, '&');
      try { const x = new URL(u, location.origin); if (x.pathname.replace(/\/+$/, '') === base + '/' + (page + 1)) return x.origin + x.pathname + x.search; } catch (e) { /* weiter */ }
    }
    return '';
  }
  // alle Seiten einer Liste eines Profils (videos, shorts, photos) → Einträge
  async function listPages(nick, kind, pick, maxPages = 30) {
    const base = `/users/${encodeURIComponent(nick.toLowerCase())}/${kind}`;
    let url = location.origin + base, page = 1;
    const out = [];
    while (url && page <= maxPages) {
      const html = await getHtml(url);
      const ini = initialsOf(html);
      const items = ini ? pick(ini) : [];
      if (!items.length) break;
      out.push(...items);
      url = nextLink(html, base, page); page++;
      await sleep(1500 + Math.random() * 1500);
    }
    return out;
  }
  async function galleryPhotos(gurl) {
    const out = [];
    let url = gurl, page = 1;
    while (url && page <= 40) {
      const ini = initialsOf(await getHtml(url));
      const g = ini && ini.galleryPage;
      if (!g) break;
      for (const x of g.photoItems || []) if (x && x.id && x.imgSrc && !x.isBlurredMedia) out.push({ k: 'xhamster-' + x.id, src: x.imgSrc, pf: 'xhamster', at: now() });
      const pg = g.paginationProps || {};
      if (!pg.lastPageNumber || page >= pg.lastPageNumber || !pg.pageLinkTemplate) break;
      page++; url = String(pg.pageLinkTemplate).replace('{#}', page);
      await sleep(1200 + Math.random() * 1200);
    }
    return out;
  }
  // eine Person einsammeln und ihren Eintrag ergänzen (pics nur hinzufügen, nie entfernen)
  async function mediaCollectOne(rec) {
    const xp = xhProfileOf(rec);
    if (!xp) return;
    const ms = media();
    const m = ms[rec.id] || { von: {} };
    const gals = await listPages(xp.nick, 'photos', (ini) => (((ini.contentComponent || {}).items) || []).filter((g) => g && g.pageURL && !g.isBlurred));
    const pics = [];
    for (const g of gals) { try { pics.push(...await galleryPhotos(g.pageURL)); } catch (e) { recEvent('Medien: Galerie nicht lesbar', { info: String(e.message || e).slice(0, 120) }); } }
    const shorts = await listPages(xp.nick, 'shorts', (ini) => (((ini.videoListComponent || {}).videoThumbProps) || []).filter((v) => v && v.id));
    const vids = await listPages(xp.nick, 'videos', (ini) => (((ini.videoListComponent || {}).videoThumbProps) || []).filter((v) => v && v.id && v.videoType !== 'moment'));
    m.nick = xp.nick; m.uid = xp.uid; m.scanAt = now();
    m.nPics = pics.length; m.nShorts = shorts.length;
    m.shorts = shorts.map((v) => ({ id: String(v.id), title: v.title || '', thumb: v.thumbURL || '', url: v.pageURL || '' }));
    m.videos = vids.map((v) => ({ id: String(v.id), title: v.title || '', thumb: v.thumbURL || '', url: v.pageURL || '', dur: v.duration || 0 }));
    ms[rec.id] = m; gs(MEDIA_K, ms);
    const add = [
      ...pics,
      ...shorts.filter((v) => shortOn(m, String(v.id))).map((v) => ({ k: 'xhamster-s' + v.id, src: '', pf: 'xhamster', at: now(), v: 1, vid: String(v.id), page: v.pageURL || '', short: 1 })),
      ...m.videos.filter((v) => videoOn(m, v.id)).map((v) => ({ k: 'xhamster-v' + v.id, src: '', pf: 'xhamster', at: now(), v: 1, vid: v.id, page: v.url })),
    ];
    await picsMerge(rec.id, add, m.shorts.filter((v) => !shortOn(m, v.id)).map((v) => 'xhamster-s' + v.id));
  }
  // pics eines Eintrags ergänzen (neue k anhängen) und ein-/ausschalten (off), mit Versionsprüfung
  async function picsMerge(recId, add, offKeys, onKeys = []) {
    for (let i = 0; i < 3; i++) {
      const cur = (await fickAll(true)).find((r) => r.id === recId);
      if (!cur) return;
      const v = clone(cur);
      const have = new Map((v.pics || []).map((x) => [x.k, x]));
      let ch = false;
      for (const x of add) if (!have.has(x.k)) { (v.pics = v.pics || []).push(x); have.set(x.k, x); ch = true; }
      for (const k of offKeys) { const x = have.get(k); if (x && !x.off) { x.off = true; ch = true; } }
      for (const k of onKeys) { const x = have.get(k); if (x && x.off) { delete x.off; ch = true; } }
      if (!ch) return;
      const r = await fickPut(v, cur.rev || 0);
      if (r && r.ok) return;
    }
  }
  // Video ein- oder ausschalten (Videoseite, Fickliste)
  async function videoToggle(recId, vid, on) {
    const ms = media();
    const m = ms[recId];
    if (!m) return;
    m.von = Object.assign({}, m.von || {}, { [vid]: !!on });
    gs(MEDIA_K, ms);
    const v = (m.videos || []).find((x) => x.id === vid) || { id: vid, url: '' };
    if (on) await picsMerge(recId, [{ k: 'xhamster-v' + vid, src: '', pf: 'xhamster', at: now(), v: 1, vid, page: v.url }], [], ['xhamster-v' + vid]);
    else await picsMerge(recId, [], ['xhamster-v' + vid]);
  }
  function videoOwner(vid) {
    for (const [id, m] of Object.entries(media())) if ((m.videos || []).some((v) => v.id === String(vid))) return id;
    return '';
  }
  function shortOwner(sid) {
    for (const [id, m] of Object.entries(media())) if ((m.shorts || []).some((v) => v.id === String(sid))) return id;
    return '';
  }

  // ---------- an Home Assistant ----------
  async function haAsk(obj) {
    const a = haParse(gm(K.ha, ''));
    if (!a) throw new Error('Home-Assistant-Adresse fehlt');
    const key = await crypto.subtle.importKey('raw', b64url(a.key), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(Object.assign({ format: 'swinger-companion', v: 1 }, obj))));
    const res = await haPost(a.url, { v: 1, iv: b64(iv), data: b64(ct) });
    if (res.status < 200 || res.status >= 300) throw new Error('Home Assistant antwortet mit ' + res.status);
    const env = JSON.parse(res.responseText || '{}');
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data))));
  }
  function gmGet(url, type, headers) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ method: 'GET', url, responseType: type, timeout: 180000, headers: Object.assign({ Referer: 'https://xhamster.com/' }, headers || {}),
      onload: (x) => (x.status >= 200 && x.status < 300 ? resolve(x) : reject(new Error('HTTP ' + x.status))),
      onerror: () => reject(new Error('nicht erreichbar')), ontimeout: () => reject(new Error('Zeitüberschreitung')) }));
  }
  const PART = 5 << 20;
  // HLS wie im JOYclub-Skript: beste Qualität, Teile der Reihe nach (fMP4 mit Init-Teil oder MPEG-TS)
  async function hlsParts(src, onPart) {
    const master = String((await gmGet(src, 'text')).response || '');
    const lines = master.split(/\r?\n/);
    let best = '', bw = -1;
    for (let i = 0; i < lines.length; i++) { const m = /BANDWIDTH=(\d+)/.exec(lines[i]); if (m && +m[1] > bw && lines[i + 1]) { bw = +m[1]; best = lines[i + 1].trim(); } }
    const pl = best ? new URL(best, src).href : src;
    const list = best ? String((await gmGet(pl, 'text')).response || '') : master;
    if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(list)) throw new Error('Video ist verschlüsselt');
    const segs = list.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => new URL(l.trim(), pl).href);
    if (!segs.length) throw new Error('Video ohne Inhalt');
    const init = /#EXT-X-MAP:[^\n]*URI="([^"]+)"/.exec(list);
    const mime = init || /\.(m4s|mp4)(\?|$)/i.test(segs[0]) ? 'video/mp4' : 'video/mp2t';
    if (init) segs.unshift(new URL(init[1], pl).href);
    for (let i = 0; i < segs.length; i++) await onPart(new Uint8Array((await gmGet(segs[i], 'arraybuffer')).response), i === segs.length - 1, mime);
  }
  // ein Video in Teilen von höchstens 5 MB schicken (Home Assistant setzt sie zusammen); load(cb) liefert die Stücke
  async function haVideo(rec, k, load) {
    let pid = '';
    const rr = await withPid(rec, async (p) => { const r = await haAsk({ kind: 'vidresume', pid: p, k }); if (r.ok) pid = p; return r; });
    if (!rr.ok) throw new Error(rr.error || 'abgelehnt');
    const resume = Number(rr.next) || 0;
    let part = 0, ok = false;
    await load(async (bytes, last, mime) => {
      for (let off = 0; off < bytes.length || (off === 0 && !bytes.length); off += PART) {
        const chunk = bytes.subarray(off, off + PART), i = part++, end = last && off + PART >= bytes.length;
        if (i < resume) continue;
        const r = await haAsk({ kind: 'vidpart', pid, k, i, last: end, mime: mime || 'video/mp4', data: b64(chunk) });
        if (!r.ok) throw new Error(r.error || 'Video abgelehnt');
        if (end) ok = true;
        if (!bytes.length) break;
      }
    });
    return ok;
  }
  // Adresse eines Short Videos aus seiner Seite (MP4 bevorzugt, sonst HLS)
  async function shortSource(pageUrl) {
    const html = (await getHtml(pageUrl)).replace(/\\\//g, '/');
    const mp4 = /https:\/\/video\d*\.xhcdn\.com\/key=[^"'\s\\]+?\.mp4[^"'\s\\]*/.exec(html);
    if (mp4) return { mp4: mp4[0].replace(/&amp;/g, '&') };
    const hls = /https:\/\/video[\w-]*\.xhcdn\.com\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/.exec(html);
    if (hls) return { hls: hls[0].replace(/&amp;/g, '&') };
    return null;
  }
  // Videoliste (m3u8), die der Player gerade lädt, dem Video der Seite zuordnen
  function mediaUrlSeen(url) {
    try {
      if (!/\.m3u8(\?|$)/i.test(url) || !/xhcdn\.com/i.test(url)) return;
      const vm = (initials() || {}).videoModel;
      if (!vm || !vm.id || !/^\/videos\//.test(location.pathname)) return;
      const all = gm(VURL_K, {}) || {};
      const cur = all[String(vm.id)];
      // die Hauptliste (ohne Auflösung im Namen) vor den Teil-Listen
      if (cur && now() - cur.at < 3600000 && /multi=|master|_TPL_/.test(cur.u) && !/multi=|master|_TPL_/.test(url)) return;
      for (const [k, v] of Object.entries(all)) if (now() - v.at > 4 * 3600000) delete all[k];
      all[String(vm.id)] = { u: url, at: now() };
      gs(VURL_K, all);
      setTimeout(() => mediaUpload().catch(() => {}), 3000);
    } catch (e) { /* egal */ }
  }
  // 0.3.1: Home Assistant kennt die Person unter der ID, mit der das JOYclub-Skript sie geschickt hat – oft ohne
  // Vorsilbe („10573689“ statt „j:10573689“). Erst die gemerkte, dann die gemeinsame ID, dann ohne Vorsilbe.
  const PID_K = 'xh_ha_pid';
  function pidCandidates(rec) {
    const known = (gm(PID_K, {}) || {})[rec.id];
    const out = [known, rec.id, String(rec.id).replace(/^[a-z]+:/i, '')];
    return [...new Set(out.filter(Boolean))];
  }
  // fn(pid) → { ok, error }; probiert die Kandidaten, solange Home Assistant „unknown picture“ meldet
  async function withPid(rec, fn) {
    let last = { ok: false, error: 'unknown picture' };
    for (const pid of pidCandidates(rec)) {
      last = await fn(pid);
      if (last.ok || !/unknown picture/.test(last.error || '')) {
        if (last.ok) { const m = gm(PID_K, {}) || {}; if (m[rec.id] !== pid) { m[rec.id] = pid; gs(PID_K, m); } }
        return last;
      }
    }
    return last;
  }
  let mediaBusy = false;
  const mediaLockMine = () => { const l = gm('xh_media_lock', null); return !l || l.tab === TAB_ID || now() - l.at > 120000; };
  async function mediaUpload() {
    if (mediaBusy || !haParse(gm(K.ha, '')) || !mediaLockMine()) return;
    mediaBusy = true;
    const t0 = now();
    if (gm('xh_media_ver', '') !== VER) { gs(WAIT_K, {}); gs('xh_media_ver', VER); }
    try {
      const done = new Set(gm(DONE_K, []) || []);
      const wait = gm(WAIT_K, {}) || {};
      const vurl = gm(VURL_K, {}) || {};
      const list = await fickAll(true);
      for (const rec of list) {
        for (const p of rec.pics || []) {
          if (now() - t0 > 240000) return;
          if (!p || p.pf !== 'xhamster' || !p.k || p.off || done.has(p.k) || (wait[p.k] && now() - wait[p.k] < 3600000)) continue;
          gs('xh_media_lock', { tab: TAB_ID, at: now() });
          let ok = false, why = '';
          try {
            if (!p.v) {
              const x = await gmGet(p.src, 'blob');
              const blob = x.response;
              const mime = (blob && blob.type) || 'image/jpeg';
              const buf = new Uint8Array(await blob.arrayBuffer());
              const r = await withPid(rec, (pid) => haAsk({ kind: 'pic', pid, k: p.k, mime: /^image\//.test(mime) ? mime : 'image/jpeg', data: b64(buf) }));
              ok = !!r.ok; why = r.error || '';
            } else if (p.short) {
              const src = await shortSource(p.page);
              if (!src) { why = 'keine Adresse'; } else if (src.mp4) {
                ok = await haVideo(rec, p.k, async (cb) => { const x = await gmGet(src.mp4, 'arraybuffer'); await cb(new Uint8Array(x.response), true, 'video/mp4'); });
              } else ok = await haVideo(rec, p.k, (cb) => hlsParts(src.hls, cb));
            } else {
              const u = vurl[p.vid];
              if (!u || now() - u.at > 2.5 * 3600000) { continue; } // wird beim nächsten Öffnen des Videos geladen
              ok = await haVideo(rec, p.k, (cb) => hlsParts(u.u, cb));
            }
          } catch (e) { why = String((e && e.message) || e); }
          if (ok) { done.add(p.k); delete wait[p.k]; gs(DONE_K, [...done].slice(-20000)); }
          else { wait[p.k] = now(); if (!/unknown picture/.test(why)) recEvent('Medien: nicht an Home Assistant', { info: `${p.k}: ${why}`.slice(0, 160) }); }
          gs(WAIT_K, wait);
          await sleep(800);
        }
      }
    } finally { mediaBusy = false; }
  }
  async function mediaCollect() {
    if (!mediaLockMine()) return;
    const list = await fickAll(true);
    const ms = media();
    const due = list.filter((r) => xhProfileOf(r) && now() - ((ms[r.id] || {}).scanAt || 0) > 24 * 3600000);
    if (!due.length) return;
    gs('xh_media_lock', { tab: TAB_ID, at: now() });
    try { await mediaCollectOne(due[0]); } catch (e) { recEvent('Medien: Sammeln fehlgeschlagen', { info: String(e.message || e).slice(0, 160) }); }
  }
  let mediaTimer = 0;
  function mediaStart() {
    if (mediaTimer) return;
    const run = async () => { try { await mediaCollect(); await mediaUpload(); } catch (e) { /* nächster Lauf */ } };
    mediaTimer = setInterval(run, 5 * 60000);
    setTimeout(run, 20000);
  }
  // Schalter auf der Videoseite zwischen „Favorite“ und „Comments“
  function videoSyncButton() {
    if (!/^\/(videos|moments|shorts)\//.test(location.pathname)) return;
    const vm = (initials() || {}).videoModel;
    if (!vm || !vm.id) return;
    // 0.4.0: auch Short Videos (Schalter wie bei Videos, Standard an)
    const sOwner = shortOwner(vm.id);
    const recId = sOwner || videoOwner(vm.id);
    const isOn = (rid0) => (sOwner ? shortOn(media()[rid0] || {}, String(vm.id)) : videoOn(media()[rid0], String(vm.id)));
    const toggle = (rid0, on) => (sOwner ? shortToggle(rid0, String(vm.id), on) : videoToggle(rid0, String(vm.id), on));
    const fav = document.querySelector('.controls__main-actions [data-role="favorites-control"]');
    if (!recId || !fav) return;
    let w = fav.parentElement.querySelector('.xhsc-vsync');
    const on = isOn(recId);
    if (!w) {
      const b0 = fav.querySelector('button');
      w = document.createElement('div');
      w.className = 'controls__main-action xhsc-vsync';
      w.innerHTML = `<button type="button" class="${esc(b0 ? b0.className : '')}"><span class="${esc((b0 && b0.querySelector('span') || {}).className || '')}"><svg viewBox="0 0 20 20" width="20" fill="currentColor"><path d="M10 2a8 8 0 1 1-7.4 5h2.2A6 6 0 1 0 10 4V6L6.5 3 10 0v2Zm-1 5h2v4.2l3 1.8-1 1.7-4-2.4V7Z"/></svg></span> <span class="${esc((b0 && b0.querySelector('[class*="text-"]') || {}).className || '')}" data-t></span></button>`;
      fav.after(w);
      w.querySelector('button').addEventListener('click', async () => {
        const cur = isOn(recId);
        await toggle(recId, !cur);
        videoSyncButton();
        if (!cur) { uiToast(sOwner ? 'Wird an Home Assistant geschickt.' : 'Wird an Home Assistant geschickt, sobald der Player die Videoliste geladen hat.'); setTimeout(() => mediaUpload().catch(() => {}), 2000); }
      });
    }
    const t = on ? 'Nicht synchronisieren' : 'Synchronisieren';
    const tx = w.querySelector('[data-t]');
    if (tx.textContent !== t) tx.textContent = t;
    w.querySelector('button').title = on ? 'Geht an Home Assistant – klicken zum Ausschalten' : 'An Home Assistant schicken';
  }


  // =====================================================================
  // Eigene Regeln für xHamster (ab 0.5.0): Grenzen altern mit, Vormerken, eigene Whitelist und Bezeichnungen,
  // Blockierliste abgleichen, Regeln gelockert → entsperren, Interaktionen (Benachrichtigungen) prüfen
  // =====================================================================
  const WHITE_K = 'xh_white';       // { names: [..], prefixes: [..] } – eigene Whitelist (zusätzlich zu poppen.de)
  const VORM_K = 'xh_vormerk';      // { <ID>: { nick, url, bday, g, at } } – kurz vor der Grenze
  const BYME_K = 'xh_byme';         // { <ID>: { nick, bday, g, at } } – vom Skript blockiert
  const BINFO_K = 'xh_blockinfo';   // { <ID>: { nick, bday, g, retired } } – aus der Blockierliste
  const ownWhite = () => Object.assign({ names: [], prefixes: [] }, gm(WHITE_K, {}) || {});
  // eigenes Alter (Geburtstag aus dem eigenen Profil, Kopfzeile) → Grenzen der eigenen Werte mit „altern mit mir“ anheben
  function ageWithMe() {
    const a = ageOf(gm('xh_me_bday', null));
    if (!a) return;
    const last = gm('xh_my_age_last', 0);
    if (!last || a < last) { gs('xh_my_age_last', a); return; }
    if (a === last) return;
    gs('xh_my_age_last', a);
    const own = gm(OWNK, {}) || {};
    const names = [];
    for (const gk of ['m', 'w', 'p']) {
      const o = own[gk];
      if (!o || !o.age || !Array.isArray(o.lim)) continue;
      o.lim = o.lim.map((x) => Math.min(AGE_MAX, x + (a - last)));
      names.push(GROUP_NAME[gk]);
    }
    if (!names.length) return;
    gs(OWNK, own); rulesCache = null;
    gs('xh_aged_at', now());          // kein „Regeln gelockert“ wegen des Alterns
    uiToast(`Alles Gute! Die eigenen Altersgrenzen (${esc(names.join(', '))}) sind mit Dir um ${a - last === 1 ? 'ein Jahr' : (a - last) + ' Jahre'} gealtert.`);
  }
  // Vormerken: kurz vor der Grenze (Warnalter) merken und sperren, sobald die Person drüber ist
  function vmAdd(p, c) {
    if (!c || !c.near || !p || !p.id || p.bday == null) return;
    const v = gm(VORM_K, {}) || {};
    if (v[p.id]) return;
    v[p.id] = { nick: p.nick, url: p.url, bday: p.bday, g: p.gender, at: now() };
    const ids = Object.keys(v);
    if (ids.length > 3000) ids.sort((a, b) => v[a].at - v[b].at).slice(0, ids.length - 3000).forEach((k) => delete v[k]);
    gs(VORM_K, v);
  }
  // fällige Vorgemerkte: jetzt über der Grenze und noch nicht blockiert; Weggefallene (Whitelist, jünger …) entfernen
  function vmDue() {
    const v = gm(VORM_K, {}) || {};
    const blocked = new Set((gm(K.lists, {}) || {}).blocked || []);
    const out = [];
    let ch = false;
    for (const [id, e] of Object.entries(v)) {
      if (blocked.has(id)) { delete v[id]; ch = true; continue; }
      const p = { id, nick: e.nick, url: e.url, gender: e.g, age: ageOf(e.bday), bday: e.bday };
      const c = classify(p, 'suche');
      if (c.ignore) out.push(p);
      else if (!c.near) { delete v[id]; ch = true; }
    }
    if (ch) gs(VORM_K, v);
    return out;
  }
  function bymeAdd(p) {
    const b = gm(BYME_K, {}) || {};
    b[p.id] = { nick: p.nick, bday: p.bday != null ? p.bday : null, g: p.gender || '', at: now() };
    gs(BYME_K, b);
  }
  // ganze Blockierliste lesen (/my/blocked-users, alle Seiten) → lists.blocked, Angaben je Person
  async function blockSync(quiet = false) {
    const ids = new Set(), info = {};
    let page = 1, max = 1;
    do {
      const ini = initialsOf(await getHtml(location.origin + '/my/blocked-users' + (page > 1 ? '/' + page : '')));
      if (!ini) throw new Error('Blockierliste nicht lesbar');
      for (const u of ini.blockedUsersCollection || []) {
        const p = personOf(u);
        if (!p || !p.id) continue;
        ids.add(p.id); info[p.id] = { nick: p.nick, bday: p.bday, g: p.gender, retired: p.retired };
      }
      max = Math.min(100, Number((ini.blockedUsersPaging || {}).maxPage) || 1);
      if (!quiet) uiStatus(`Blockierliste: Seite ${page} von ${max} · ${ids.size} Einträge`);
      page++;
      if (page <= max) await sleep(1200 + Math.random() * 1200);
    } while (page <= max);
    const lists = gm(K.lists, {}) || {};
    const before = new Set(lists.blocked || []);
    lists.blocked = [...ids]; gs(K.lists, lists);
    gs(BINFO_K, info);
    const b = gm(BYME_K, {}) || {};
    let gone = 0;
    for (const id of Object.keys(b)) if (!ids.has(id)) { delete b[id]; gone++; }
    gs(BYME_K, b);
    gs('xh_blocksync_at', now());
    rulesCache = null;
    const added = [...ids].filter((x) => !before.has(x)).length;
    const removed = [...before].filter((x) => !ids.has(x)).length;
    const msg = `Blockierliste abgeglichen: ${ids.size} blockiert (${added} neu bekannt, ${removed} nicht mehr blockiert${gone ? `, davon ${gone} vom Skript` : ''}).`;
    if (!quiet) uiStatus(msg);
    recEvent('Blockierliste abgeglichen', { info: `${ids.size} · +${added} · −${removed}` });
    return { n: ids.size, added, removed };
  }
  // Regeln gelockert: vom Skript Blockierte, die jetzt nicht mehr über der Grenze liegen
  function relaxCandidates() {
    const b = gm(BYME_K, {}) || {};
    const out = [];
    for (const [id, e] of Object.entries(b)) {
      const p = { id, nick: e.nick, gender: e.g, age: ageOf(e.bday), bday: e.bday };
      if (p.age == null) continue;
      const c = classify(p, 'suche');
      if (!c.ignore) out.push(Object.assign(p, { why: c.white || 'unter der Grenze' }));
    }
    return out;
  }
  function relaxCheck() {
    const list = relaxCandidates();
    const skip = new Set(gm('xh_relax_keep', []) || []);
    const todo = list.filter((p) => !skip.has(p.id));
    if (!todo.length || document.getElementById('xhsc-relax')) return;
    edCss();
    const ov = document.createElement('div');
    ov.className = 'xhsc-ov'; ov.id = 'xhsc-relax';
    ov.innerHTML = `<div class="xhsc-ed"><div class="hd"><h3>Regeln geändert</h3></div><div class="bd">
      <p>Nach den neuen Regeln liegen <b>${todo.length}</b> vom Skript blockierte Profile nicht mehr über der Grenze. Entsperren?</p>
      <div class="hist" style="max-height:240px">${todo.slice(0, 300).map((p) => `<div>${esc(p.nick)} (${p.age} J.) – ${esc(p.why)}</div>`).join('')}${todo.length > 300 ? `<div>… und ${todo.length - 300} weitere</div>` : ''}</div>
      <p class="muted">Wer neu über einer Grenze liegt, sperrt der nächste ${esc(OW())}-Scan.</p></div>
      <div class="ft"><button type="button" class="btn del" data-a="keep">Gesperrt lassen</button><button type="button" class="btn" data-a="later">Später</button><button type="button" class="btn pri" data-a="go">Entsperren</button></div></div>`;
    const close = () => ov.remove();
    ov.querySelector('[data-a=later]').onclick = close;
    ov.querySelector('[data-a=keep]').onclick = () => { gs('xh_relax_keep', [...skip, ...todo.map((p) => p.id)].slice(-5000)); close(); };
    ov.querySelector('[data-a=go]').onclick = () => { close(); relaxRun(todo); };
    document.body.appendChild(ov);
  }
  async function relaxRun(todo) {
    let ok = 0, bad = 0;
    const lists = gm(K.lists, {}) || {};
    const blocked = new Set(lists.blocked || []);
    const b = gm(BYME_K, {}) || {};
    for (const p of todo) {
      uiStatus(`Entsperren: ${ok + bad + 1} von ${todo.length} – ${p.nick}`);
      let r;
      try { r = await blockUser(p.id, false); } catch (e) { r = { ok: false, msg: e.message }; }
      if (r.ok) { ok++; blocked.delete(p.id); delete b[p.id]; } else { bad++; recEvent('Entsperren fehlgeschlagen', { info: `${r.status || ''} ${r.msg || ''}`.trim(), resp: r.text || '' }); if (bad >= 3 && !ok) break; }
      lists.blocked = [...blocked]; gs(K.lists, lists); gs(BYME_K, b);
      await sleep(2000 + Math.random() * 3000);
    }
    uiStatus(`Entsperrt: ${ok}${bad ? ` · ${bad} fehlgeschlagen` : ''}.`);
    recEvent('Regeln gelockert: entsperrt', { info: `${ok} ok · ${bad} Fehler` });
  }
  // Interaktionen: Absender aus den Benachrichtigungen (Kommentare, Gifts, Anfragen) prüfen und ggf. blockieren
  const ISCAN_K = 'xh_iscan';
  const NOTI_KNOWN = new Set(['event', 'comment', 'comment-photo', 'comment-video', 'friend-approve', 'invite', 'gift']);
  function notiRows(html) {
    const out = [];
    const re = /<div class="notifications-row"[\s\S]*?(?=<div class="notifications-row"|<\/section>|$)/g;
    let m;
    while ((m = re.exec(html))) {
      const row = m[0];
      const u = /href="https:\/\/xhamster\.com\/users\/(?:profiles\/)?([^"/?#]+)/.exec(row);
      const cls = (/<div class="event ([^"]+)"/.exec(row) || [])[1] || '';
      if (u) out.push({ nick: decodeURIComponent(u[1]), cls });
    }
    return out;
  }
  function iscanStart(mode) {
    if (gm(ISCAN_K, null)) { uiStatus('Interaktionen werden schon geprüft.'); return; }
    gs(ISCAN_K, { mode, phase: 'list', page: 1, nicks: [], i: 0, seen: 0, hits: 0, done: 0, fail: 0, skip: {}, started: now() });
    iscanRun();
  }
  let iscanBusy = false;
  async function iscanRun() {
    if (iscanBusy) return;
    iscanBusy = true;
    try {
      const m = me();
      for (;;) {
        const st = gm(ISCAN_K, null);
        if (!st) { uiStatus('Interaktionen: angehalten.'); break; }
        if (st.phase === 'list') {
          uiStatus(`Interaktionen: Benachrichtigungen Seite ${st.page}`);
          let html = '';
          try { html = await getHtml(location.origin + '/notifications' + (st.page > 1 ? '/' + st.page : '')); } catch (e) { html = ''; }
          const rows = notiRows(html);
          for (const r of rows) {
            const kinds = r.cls.split(/\s+/).filter(Boolean);
            const unk = kinds.filter((k) => !NOTI_KNOWN.has(k));
            if (unk.length) recEvent('Benachrichtigung: unbekannte Art', { info: unk.join(' ') });
            if (kinds.includes('gift')) recEvent('Benachrichtigung: Gift', { info: r.cls });
            if (!st.nicks.some((x) => norm(x) === norm(r.nick)) && !(m && norm(m.nick) === norm(r.nick))) st.nicks.push(r.nick);
          }
          if (rows.length && st.page < 10) st.page++; else st.phase = 'check';
          gs(ISCAN_K, st);
          await sleep(1200 + Math.random() * 1200);
          continue;
        }
        if (st.i >= st.nicks.length) {
          gs(ISCAN_K, null);
          const skip = Object.entries(st.skip).map(([k, v]) => `${k} ${v}`).join(', ');
          uiStatus(`Interaktionen geprüft: ${st.seen} Absender, ${st.hits} über der Grenze, ${st.done} blockiert${st.fail ? `, ${st.fail} Fehler` : ''}.`);
          uiLog(`Übersprungen: ${skip || '–'}`);
          gs('xh_iscan_last', { at: now(), mode: st.mode, seen: st.seen, hits: st.hits, done: st.done, fail: st.fail });
          recEvent('Interaktionen geprüft', { info: `${st.mode}: ${st.seen} · ${st.hits} · ${st.done}` });
          break;
        }
        const nick = st.nicks[st.i];
        uiStatus(`Interaktionen: ${st.i + 1} von ${st.nicks.length} · ${st.hits} über der Grenze · ${st.done} blockiert`);
        let p = null;
        try { const ini = initialsOf(await getHtml(profileUrl(nick))); const dm = ini && ini.displayUserModel; if (dm) p = personOf(dm); } catch (e) { p = null; }
        st.i++; st.seen++;
        const add = (k) => { st.skip[k] = (st.skip[k] || 0) + 1; };
        if (!p || !p.id) add('nicht lesbar');
        else if (p.retired) add('gelöscht');
        else {
          peopleAdd(Object.assign({ modelName: 'userModel' }, { id: p.id, name: p.nick, pageURL: p.url }));
          const c = classify(p, 'interaktionen');
          vmAdd(p, c);
          const blocked = new Set((gm(K.lists, {}) || {}).blocked || []);
          if (!c.ignore) add(c.white || (p.age == null ? 'ohne Alter' : 'unter der Grenze'));
          else if (blocked.has(p.id)) add('schon blockiert');
          else {
            st.hits++;
            if (st.mode === 'block') {
              let r;
              try { r = await blockUser(p.id, true); } catch (e) { r = { ok: false, msg: e.message }; }
              if (r.ok) { st.done++; const l = gm(K.lists, {}) || {}; l.blocked = [...new Set([...(l.blocked || []), p.id])]; gs(K.lists, l); bymeAdd(p); uiLog(`blockiert: ${p.nick} (${p.age})`); }
              else { st.fail++; recEvent('Interaktionen: Block fehlgeschlagen', { info: `${r.status || ''} ${r.msg || ''}`.trim(), resp: r.text || '' }); }
            } else uiLog(`würde blockiert: ${p.nick} (${p.age})`);
          }
        }
        gs(ISCAN_K, st);
        await sleep(1800 + Math.random() * 2000);
      }
    } finally { iscanBusy = false; }
  }

  // ---------- Moppel nach Körpertyp (xHamster kennt kein Gewicht) ----------
  const BODY_K = 'xh_body';         // { <ID>: Körpertyp wie auf xHamster, z. B. „Large“ }
  function bodyStage(b) {
    const t = norm(b);
    if (!t) return 0;
    if (/large|bbw|plus|heavy|big/.test(t)) return 3;
    if (/extra|chubby|full/.test(t)) return 2;
    if (/curvy/.test(t)) return 1;
    return 0;
  }
  function bodyLearn() {
    const all = gm(BODY_K, {}) || {};
    let ch = false;
    if (/^\/users\//.test(location.pathname)) {
      const p = profilePerson();
      const b = p && p.info && p.info['Body type'];
      if (p && b && all[p.id] !== b) { all[p.id] = b; ch = true; }
    }
    // Dating-Suche mit Filter „Large“: alle Treffer sind „Large“ (Vermessung über den Suchfilter)
    if (/^\/dating/.test(location.pathname) && /(^|[?&])body=large(&|$)/.test(location.search)) {
      for (const u of (((initials() || {}).datingListComponent || {}).users) || []) if (u && u.id != null && !all[String(u.id)]) { all[String(u.id)] = 'Large'; ch = true; }
    }
    if (ch) { const ks = Object.keys(all); if (ks.length > 20000) ks.slice(0, ks.length - 20000).forEach((k) => delete all[k]); gs(BODY_K, all); }
  }
  function mopBadge(p) {
    const s = rules();
    if (!s.moppel.on || !p || !p.id) return '';
    const st = bodyStage((gm(BODY_K, {}) || {})[p.id]);
    if (!st) return '';
    const l = s.moppel.labels || [];
    const g = p.gender === 'male' ? 'm' : 'w';
    return `<span style="display:inline-flex;align-items:center;gap:2px;color:#f0b45a">${st === 3 ? xxlIconSvg(g).replace(/width="20" height="20"/, 'width="14" height="14"') : ''}${esc(l[(st - 1) * 2] || '')}</span>`;
  }
  // Dating-Suche: Moppel zuerst (Schalter auf der Einstellungsseite)
  function mopSort() {
    if (!rules().moppel.on || !gm('xh_mop_sort', false) || !/^\/dating/.test(location.pathname)) return;
    const body = gm(BODY_K, {}) || {};
    const cards = [...document.querySelectorAll('a[href*="/users/"][class*="card"], a[href*="/users/"][class*="Card"]')].filter((a) => !a.closest('header'));
    const par = cards.length && cards[0].parentElement;
    if (!par || par.dataset.xhscSorted === String(cards.length)) return;
    const st = (a) => { const p = People.byUrl.get(urlKey(a.href)); return p ? bodyStage(body[p.id]) : 0; };
    const sib = cards.filter((a) => a.parentElement === par);
    const sorted = sib.slice().sort((a, b) => st(b) - st(a));
    if (sorted.some((a, i) => a !== sib[i])) sorted.forEach((a) => par.appendChild(a));
    par.dataset.xhscSorted = String(cards.length);
  }

  // ---------- Kopfzeile: Symbol mit Zahl der Blockierten ----------
  function hdrIcon() {
    const menu = document.querySelector('[data-role="header-top-menu"]');
    const ps = menu && menu.querySelector('[data-nav-item-id="pornstars"]');
    if (!ps) return;
    const n = ((gm(K.lists, {}) || {}).blocked || []).length;
    let d = menu.querySelector('.xhsc-hdr');
    const sig = `${n}|${OW()}`;
    if (d && d.dataset.sig === sig) return;
    if (d) d.remove();
    const a0 = ps.querySelector('a');
    const ic0 = a0 && a0.querySelector('.xh-icon:not([class*="arrowIcon"])');
    const tx0 = a0 && a0.querySelector('[class*="linkText-"]');
    if (!a0) return;
    d = document.createElement('div');
    d.className = String(ps.className).replace(/\bxh-dropdown\b/, '').trim() + ' xhsc-hdr';
    d.dataset.sig = sig;
    d.innerHTML = `<a class="${esc(a0.className)}" href="${esc(setUrl())}" title="${esc(`${OW()}-Schutz: ${n} blockiert`)}"><span class="${esc(ic0 ? ic0.className : 'xh-icon')}"><svg viewBox="0 0 640 1280" width="11" height="20" fill="currentColor" aria-hidden="true">${owFigure()}</svg></span> <div class="${esc(tx0 ? tx0.className : '')}"></div></a>`;
    d.querySelector('a > div').textContent = String(n);
    d.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); setOpen(); });
    ps.after(d);
  }

  // ---------- Kontobindung: Skript gehört zu genau einem xHamster-Konto ----------
  const OWNER_K = 'xh_owner';
  function ownerOk() {
    const m = me();
    if (!m || !m.id || !meLive) return true;
    const o = gm(OWNER_K, null);
    if (!o) { gs(OWNER_K, { id: m.id, nick: m.nick, seit: now(), also: [] }); return true; }
    return String(o.id) === String(m.id) || (o.also || []).some((x) => String(x.id) === String(m.id));
  }
  // weiteres eigenes Konto zulassen (z. B. Testkonten im selben Browser) – die gespeicherten Daten teilen sich alle
  function ownerRebind() {
    const m = me(), o = gm(OWNER_K, null) || {};
    if (!m) return;
    if (!confirm(`Swinger Companion gehört zu ${o.nick || '?'}. Auch für ${m.nick} verwenden?\n\nBeide Konten teilen sich dann die gespeicherten Daten (Blockierliste, Archiv, Einstellungen). Nur zulassen, wenn ${m.nick} Dein eigenes Konto ist.`)) return;
    o.also = (o.also || []).filter((x) => String(x.id) !== String(m.id)).concat([{ id: m.id, nick: m.nick, seit: now() }]);
    gs(OWNER_K, o);
    location.reload();
  }

  // ---------- Sicherung: eigener Tampermonkey-Speicher als Datei ----------
  const BACKUP_SKIP = /^xh_(rpc[qra]_|bkm_|rec$|ha_url$|tab_|oscan_lock$|media_lock$)/;
  function backupExport() {
    let keys = [];
    try { keys = GM_listValues(); } catch (e) { uiToast('Sicherung: Tampermonkey erlaubt das Auflisten nicht.'); return; }
    const data = {};
    for (const k of keys) if (/^xh_/.test(k) && !BACKUP_SKIP.test(k)) data[k] = gm(k, null);
    const m = me();
    const blob = new Blob([JSON.stringify({ format: 'swinger-companion-xhamster', v: 1, script: VER, at: now(), account: m ? { id: m.id, nick: m.nick } : null, data })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `swinger-companion-xhamster-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    uiToast(`Sicherung gespeichert (${Object.keys(data).length} Einträge, ohne Home-Assistant-Adresse und Rekorder).`);
  }
  function backupImport() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      let j = null;
      try { j = JSON.parse(await f.text()); } catch (e) { uiToast('Die Datei ist keine Sicherung.'); return; }
      if (!j || j.format !== 'swinger-companion-xhamster' || !j.data) { uiToast('Die Datei ist keine Sicherung des xHamster-Skripts.'); return; }
      const m = me();
      const other = j.account && m && String(j.account.id) !== String(m.id);
      if (!confirm(`Sicherung vom ${new Date(j.at).toLocaleString()} (${Object.keys(j.data).length} Einträge${j.account ? ', Konto ' + j.account.nick : ''}) einspielen?${other ? '\n\nACHTUNG: Die Sicherung stammt von einem anderen Konto.' : ''}\n\nVorhandene Werte mit gleichem Namen werden ersetzt.`)) return;
      let n = 0;
      for (const [k, v] of Object.entries(j.data)) if (/^xh_/.test(k) && !BACKUP_SKIP.test(k) && k !== OWNER_K) { gs(k, v); n++; }
      rulesCache = null;
      uiToast(`${n} Einträge eingespielt – Seite wird neu geladen.`);
      setTimeout(() => location.reload(), 1500);
    };
    inp.click();
  }

  // ---------- Termine aus der gemeinsamen Termin-Datei (meta.termine_file, Zeilen „wann - wo - was - Link“) ----------
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
    if (endDate.getMonth() !== end.m - 1) return null;
    const wann = m[0].trim();
    const parts = line.slice(m[0].length).replace(/^\s*[-–]\s*/, '').split(/\s+[-–]\s+/).map((x) => x.trim()).filter(Boolean);
    let link = '';
    if (parts.length > 1 && /^(https?:\/\/|www\.)\S+$/i.test(parts[parts.length - 1])) link = parts.pop();
    return { wann, wo: parts.shift() || '', was: parts.join(' - '), link, end: endDate };
  }
  async function termUpcoming(max = 5) {
    const r = await SH.call('get', { s: 'meta', k: 'termine_file' }, 15000);
    const text = (r && r.text) || '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const t = parseTermLine(line);
      if (!t || t.end < today) continue;
      out.push(t);
      if (out.length >= max) break;
    }
    return out;
  }

  // ---------- Prüflauf (ab 0.5.0): alle Funktionen ansehen, nichts ändern ----------
  async function selfTest() {
    edCss();
    const res = [];
    const add = (grp, name, st, info) => res.push({ grp, name, st, info: info || '' });
    const ini = initials() || {};
    const path = location.pathname;
    // Konto und Speicher
    const m = me();
    add('Konto', 'Angemeldetes Konto erkannt', m ? 'ok' : 'warn', m ? m.nick : 'nicht angemeldet oder Kopfzeile geändert');
    const o = gm(OWNER_K, null);
    add('Konto', 'Kontobindung', ownerOk() ? 'ok' : 'err', o ? `gebunden an ${o.nick}${(o.also || []).length ? ' + ' + o.also.map((y) => y.nick).join(', ') : ''}` : 'noch nicht gebunden');
    add('Konto', 'Eigenes Geschlecht und Geburtstag', gm('xh_me_gender', '') && gm('xh_me_bday', null) != null ? 'ok' : 'warn', `${gm('xh_me_gender', '') || '?'} · ${ageOf(gm('xh_me_bday', null)) || '?'} J.`);
    let t0 = now();
    try { const r = await SH.call('get', { s: 'meta', k: 'schema' }, 15000); add('Briefkasten', 'Gemeinsame Ablage erreichbar', 'ok', `${now() - t0} ms${r ? ' · Format ' + r.schema : ''}`); } catch (e) { add('Briefkasten', 'Gemeinsame Ablage erreichbar', 'err', e.message); }
    const pr = gm(POPK, null) || {};
    add('Regeln', 'Regeln von poppen.de', pr.src === 'poppen' ? (now() - (pr.popAt || 0) < 14 * 86400000 ? 'ok' : 'warn') : 'warn', pr.src === 'poppen' ? `Stand ${new Date(pr.popAt || 0).toLocaleString()}` : 'nur Vorgaben – poppen.de einmal öffnen');
    const plan = oscanPlan();
    add('Regeln', 'Ignorierte Gruppen', plan.length ? 'ok' : 'warn', plan.map((x) => `${GROUP_NAME[x.gk]} ab ${x.minAge}`).join(', ') || 'keine');
    try { const l = await fickAll(true); add('Fickliste', 'Fickliste lesbar', 'ok', `${l.length} Einträge · ${(gm('xh_fick_ids', []) || []).length} mit xHamster-Profil`); } catch (e) { add('Fickliste', 'Fickliste lesbar', 'err', e.message); }
    try { const l = await tplAll(); add('Messenger', 'Textvorlagen lesbar', l.length ? 'ok' : 'warn', `${l.length} Vorlagen`); } catch (e) { add('Messenger', 'Textvorlagen lesbar', 'err', e.message); }
    try { const t = await termUpcoming(); add('Messenger', 'Termin-Datei', t.length ? 'ok' : 'warn', t.length ? `${t.length} kommende Termine` : 'keine kommenden Termine oder keine Datei'); } catch (e) { add('Messenger', 'Termin-Datei', 'err', e.message); }
    // Hintergrund-Abrufe (nur lesen)
    t0 = now();
    try {
      const pi = initialsOf(await getHtml(location.origin + '/dating/de?gender=male&minAge=60&maxAge=99&sort=activity'));
      const us = (((pi || {}).datingListComponent || {}).users) || [];
      const withAge = us.filter((u) => personOf(u).age != null).length;
      add('Scan', 'Dating-Suche im Hintergrund lesbar', us.length && withAge ? 'ok' : 'err', `${us.length} Profile, ${withAge} mit Alter · ${now() - t0} ms`);
    } catch (e) { add('Scan', 'Dating-Suche im Hintergrund lesbar', 'err', e.message); }
    try {
      const bi = initialsOf(await getHtml(location.origin + '/my/blocked-users'));
      add('Scan', 'Blockierliste lesbar', bi && bi.blockedUsersPaging ? 'ok' : 'err', bi ? `${(bi.blockedUsersCollection || []).length} auf Seite 1 von ${(bi.blockedUsersPaging || {}).maxPage || 1}` : 'keine Seitendaten');
    } catch (e) { add('Scan', 'Blockierliste lesbar', 'err', e.message); }
    try {
      const rows = notiRows(await getHtml(location.origin + '/notifications'));
      add('Scan', 'Benachrichtigungen lesbar', 'ok', `${rows.length} auf Seite 1`);
    } catch (e) { add('Scan', 'Benachrichtigungen lesbar', 'err', e.message); }
    add('Scan', 'Kopfzeilen der Seite für Blockieren', apiHdr ? 'ok' : 'warn', apiHdr ? 'mitgeschnitten' : 'noch keine – erscheint, sobald die Seite selbst etwas lädt');
    const ls = gm(K.lists, {}) || {};
    add('Scan', 'Blockierliste bekannt', (ls.blocked || []).length ? 'ok' : 'warn', `${(ls.blocked || []).length} blockiert · ${Object.keys(gm(BYME_K, {}) || {}).length} vom Skript · abgeglichen ${gm('xh_blocksync_at', 0) ? new Date(gm('xh_blocksync_at', 0)).toLocaleDateString() : 'nie'}`);
    add('Scan', 'Vormerkliste', 'ok', `${Object.keys(gm(VORM_K, {}) || {}).length} vorgemerkt · ${vmDue().length} fällig`);
    // Medien und Home Assistant
    const ha = haParse(gm(K.ha, ''));
    add('Home Assistant', 'Adresse eingetragen', ha ? 'ok' : 'warn', ha ? 'eingetragen' : 'fehlt');
    const ms = mediaStats();
    add('Home Assistant', 'Bilder und Videos', 'ok', `${ms.pics} Bilder · ${ms.shorts} Shorts · ${ms.videosOn}/${ms.videos} Videos · ${ms.sent} geschickt${ms.waiting ? ` · ${ms.waiting} warten` : ''}`);
    // diese Seite
    const sel = (name, q, need = true) => { const ok = !!document.querySelector(q); add('Diese Seite', name, ok ? 'ok' : (need ? 'err' : 'warn'), ok ? '' : 'nicht gefunden: ' + q); };
    sel('Kopfzeilen-Menü', '[data-role="header-top-menu"] [data-nav-item-id="pornstars"]');
    if (/^\/users\/(profiles\/)?[^/]+\/?$/.test(path) && ini.displayUserModel) {
      const own = m && String(ini.displayUserModel.id) === String(m.id);
      sel('Steckbrief (.user-details)', '.user-details');
      sel('Rechte Spalte', '.right-column');
      if (!own) {
        sel('Knopfleiste', '[data-role="controls-container"]');
        sel('Freund-Knopf', '[data-role="controls-container"] button[class*="growButton-"]');
        sel('Fickliste-Knopf eingebaut', '.xhsc-fl-btn');
        const pp = profilePerson();
        add('Diese Seite', 'Steckbrief lesbar („I am“)', pp && pp.age != null ? 'ok' : 'err', pp ? `${pp.age || '?'} J. · ${pp.gender || '?'} · Körpertyp ${pp.info['Body type'] || '?'}` : '');
      }
    }
    if (/^\/my\/friends/.test(path)) { sel('Seitenleiste „Friends“', 'ul.friends-side-switcher li.friends'); sel('Fickliste in der Seitenleiste', '.xhsc-fl-side'); }
    if (/^\/dating/.test(path)) { add('Diese Seite', 'Dating-Treffer in den Seitendaten', (((ini.datingListComponent || {}).users) || []).length ? 'ok' : 'err', `${(((ini.datingListComponent || {}).users) || []).length}`); sel('Markierungen', '.xhsc-badge', false); }
    if (/^\/my\/messages/.test(path) || document.querySelector('.xh-editable-content')) { sel('Smiley-Leiste', '[class*="emojiDropdown-"]', false); sel('Vorlagen-Knopf', '.xhsc-tpl', false); }
    if (/^\/my\/edit\/profile/.test(path)) sel('Linke Leiste der Einstellungen', '[data-role="edit-menu"] ul');
    if (/^\/videos\//.test(path)) add('Diese Seite', 'Video in den Seitendaten', ini.videoModel && ini.videoModel.id ? 'ok' : 'err', '');
    if (ini.bannerPrefix) add('Diese Seite', 'Werbe-Kennung erkannt', 'ok', ini.bannerPrefix);
    const bad = res.filter((x) => x.st === 'err').length, warn = res.filter((x) => x.st === 'warn').length;
    gs('xh_selftest_last', { at: now(), ver: VER, bad, warn, res });
    recEvent('Prüflauf', { info: `${res.length} Prüfungen · ${bad} Fehler · ${warn} Hinweise`, res: res.filter((x) => x.st !== 'ok').map((x) => `${x.grp}: ${x.name} (${x.st})`) });
    const ico = { ok: '<span style="color:#7bd88f">✓</span>', warn: '<span style="color:#f0b45a">!</span>', err: '<span style="color:#ff7875">✗</span>' };
    const ov = document.createElement('div');
    ov.className = 'xhsc-ov';
    let grp = '';
    ov.innerHTML = `<div class="xhsc-ed"><div class="hd"><h3>Prüflauf ${esc(VER)} – ${bad ? `${bad} Fehler` : 'keine Fehler'}${warn ? `, ${warn} Hinweise` : ''}</h3><button type="button" class="x" style="color:#bbb;font-size:22px">×</button></div><div class="bd">
      ${res.map((x) => { const h = x.grp !== grp ? `<div class="sub" style="font-weight:600;margin:10px 0 2px">${esc(x.grp)}</div>` : ''; grp = x.grp; return `${h}<div style="display:flex;gap:8px"><b style="width:14px">${ico[x.st]}</b><span>${esc(x.name)}${x.info ? ` <span class="muted">– ${esc(x.info)}</span>` : ''}</span></div>`; }).join('')}
      <p class="muted" style="margin-top:12px">Der Prüflauf ändert nichts. Seitenbezogene Prüfungen gelten für die gerade geöffnete Seite – für vollständige Ergebnisse auch auf einem fremden Profil, in „Friends“, im Messenger und in der Dating-Suche starten.</p></div></div>`;
    ov.querySelector('.x').onclick = () => ov.remove();
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return res;
  }

  // =====================================================================
  // Opa-Scan (ab 0.2.0): Dating-Suche nach den poppen-Regeln durchgehen und Opas blockieren
  // Erst Probelauf (zählt nur), dann Blockieren: der erste Block wird geprüft, danach Pausen von 2–5 s.
  // Ausgenommen: Whitelist, Freunde, Fickliste, man selbst, schon Blockierte, gelöschte Konten.
  // =====================================================================
  let apiHdr = null;                       // Kopfzeilen der Seite für /x-api (nur im Arbeitsspeicher)
  const HDR_SKIP = /^(content-length|cookie|host|content-type)$/i;
  let ownReq = false, hdrLogged = false;   // eigene Anfragen des Skripts nicht als Vorlage nehmen
  function captureHdr(h) {
    if (!h || ownReq) return;
    const out = {};
    try {
      if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { if (!HDR_SKIP.test(k)) out[k] = v; });
      else if (Array.isArray(h)) for (const [k, v] of h) { if (!HDR_SKIP.test(k)) out[k] = v; }
      else for (const k of Object.keys(h)) if (!HDR_SKIP.test(k)) out[k] = h[k];
    } catch (e) { return; }
    // 0.3.0: einmal je Seite und nur bei neuer Zusammensetzung
    if (Object.keys(out).length && (!hdrLogged || stable(Object.keys(apiHdr || {}).sort()) !== stable(Object.keys(out).sort()))) { hdrLogged = true; recEvent('Kopfzeilen für /x-api', { info: Object.keys(out).sort().join(', ') }); }
    apiHdr = out;
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  async function blockUser(id, state = true) {
    const body = [{ name: 'entityBlockModelSync', requestData: { model: { id: null, $id: uuid(), modelName: 'entityBlockModel', itemState: 'created', entityModel: 'userModel', entityID: Number(id), state } } }];
    let res;
    ownReq = true;
    try { res = W.fetch('/x-api', { method: 'POST', credentials: 'include', headers: Object.assign({ accept: 'application/json, text/plain, */*' }, apiHdr || {}, { 'content-type': 'application/json' }), body: JSON.stringify(body) }); } finally { ownReq = false; }
    res = await res;
    const t = await res.text();
    let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    const e = (Array.isArray(j) && j[0] && j[0].extras) || {};
    // 0.3.0: Antwort bei Fehlern für den Rekorder (gekürzt, geschwärzt)
    return { ok: res.status === 200 && e.result === true, rel: e.currentUserRelation || '', msg: e.message || '', status: res.status, text: res.status === 200 && e.result === true ? '' : maskStr(String(t || '').slice(0, 400)) };
  }
  // Anfangszustand einer anderen Seite holen, ohne hinzugehen
  function initialsOf(html) {
    const i = html.indexOf('window.initials=');
    if (i < 0) return null;
    const s = html.indexOf('{', i);
    const e = html.indexOf('</script>', s);
    if (s < 0 || e < 0) return null;
    try { return JSON.parse(html.slice(s, e).replace(/;\s*$/, '')); } catch (x) { return null; }
  }
  // Link zur nächsten Ergebnisseite aus dem Seitenquelltext (Muster …/dating[/<land>]/<n+1>?…#result-block)
  function nextPageUrl(html, page) {
    const re = /href="(https:\/\/xhamster\.com\/dating[^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
      const u = m[1].replace(/&amp;/g, '&');
      try { const x = new URL(u); if (new RegExp('/' + (page + 1) + '$').test(x.pathname)) return x.origin + x.pathname + x.search; } catch (e) { /* weiter */ }
    }
    return '';
  }
  const GENDER_OF = { m: 'male', w: 'female', p: 'couple' };
  function oscanPlan(s = rules()) {
    const out = [];
    for (const gk of ['m', 'w', 'p']) {
      const g = s.groups[gk];
      if (!g.ignore) continue;
      const lim = (s.expert.sharedLimits ? g.src.global : g.src.suche) || g.src.interaktionen;
      out.push({ gk, gender: GENDER_OF[gk], minAge: lim[2] });
    }
    return out;
  }
  // quiet: Länder und Höchstzahl nicht nachfragen (Einstellungsseite)
  function oscanStart(mode, quiet = false) {
    const plan = oscanPlan();
    if (!plan.length) { alert('Nach den poppen-Regeln wird keine Gruppe ignoriert – nichts zu tun.'); return; }
    const cty = quiet ? gm('xh_oscan_cty', 'de,at,ch') : prompt('Länder (Kürzel, durch Komma getrennt; leer = alle):', gm('xh_oscan_cty', 'de,at,ch'));
    if (cty == null) return;
    gs('xh_oscan_cty', cty);
    let max = 0;
    if (mode === 'block') {
      const v = quiet ? String(gm('xh_oscan_max', 200)) : prompt('Höchstens so viele in diesem Lauf blockieren:', String(gm('xh_oscan_max', 200)));
      if (v == null) return;
      max = Math.max(1, parseInt(v, 10) || 200); gs('xh_oscan_max', max);
      const dry = gm('xh_oscan_last', null);
      if (!dry || dry.mode !== 'dry' || now() - (dry.at || 0) > 86400000) { if (!confirm('Seit einem Tag kein Probelauf. Trotzdem gleich blockieren?')) return; }
    }
    const countries = cty.split(/[,; ]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]{2}$/.test(x));
    const st = { mode, plan, countries: countries.length ? countries : [''], pi: 0, ci: 0, page: 1, url: '', seen: 0, hits: 0, done: 0, fail: 0, skip: {}, verified: false, max, started: now(), list: [], err: 0 };
    // 0.5.0: Vorgemerkte, die inzwischen über der Grenze sind, zuerst
    st.vq = vmDue().map((p) => ({ id: p.id, nick: p.nick, age: p.age, bday: p.bday, g: p.gender }));
    gs(K.oscan, st);
    recEvent('Opa-Scan gestartet', { info: `${mode} · ${plan.map((x) => x.gender + '≥' + x.minAge).join(', ')} · ${st.countries.join(',') || 'alle'}` });
    oscanRun();
  }
  function oscanUrl(st) {
    if (st.url) return st.url;
    const pl = st.plan[st.pi];
    const c = st.countries[st.ci];
    const q = new URLSearchParams({ gender: pl.gender, maxAge: '99', minAge: String(pl.minAge), sort: 'activity' });
    return `${location.origin}/dating${c ? '/' + c : ''}?${q}`;
  }
  let oscanBusy = false;
  async function oscanRun() {
    if (oscanBusy) return;
    oscanBusy = true;
    try {
      const lockMine = () => { const l = gm('xh_oscan_lock', null); return !l || l.tab === TAB_ID || now() - l.at > 30000; };
      if (!lockMine()) { uiStatus(`${OW()}-Scan läuft in einem anderen Tab.`); return; }
      await fickAll().catch(() => null);
      for (;;) {
        let st = gm(K.oscan, null);
        if (!st) { uiStatus(`${OW()}-Scan angehalten.`); break; }
        if (!lockMine()) { uiStatus(`${OW()}-Scan läuft in einem anderen Tab.`); break; }
        gs('xh_oscan_lock', { tab: TAB_ID, at: now() });
        if (st.vq && st.vq.length) {
          const q = st.vq.shift();
          st.seen++; st.hits++;
          if (st.list.length < 3000) st.list.push({ id: q.id, nick: q.nick, age: q.age, city: '', g: q.g, vm: 1 });
          if (st.mode === 'block' && st.done < st.max) {
            let r;
            try { r = await blockUser(q.id, true); } catch (e) { r = { ok: false, msg: e.message }; }
            if (r.ok) { st.done++; st.verified = true; const l = gm(K.lists, {}) || {}; l.blocked = [...new Set([...(l.blocked || []), q.id])]; gs(K.lists, l); bymeAdd({ id: q.id, nick: q.nick, bday: q.bday, gender: q.g }); const v = gm(VORM_K, {}) || {}; delete v[q.id]; gs(VORM_K, v); uiLog(`blockiert (vorgemerkt): ${q.nick} (${q.age})`); }
            else { st.fail++; st.skip['Block abgelehnt'] = (st.skip['Block abgelehnt'] || 0) + 1; }
            gs(K.oscan, st);
            await sleep(2000 + Math.random() * 3000);
          } else gs(K.oscan, st);
          continue;
        }
        if (st.pi >= st.plan.length) { oscanDone(st, 'fertig'); break; }
        const pl = st.plan[st.pi];
        const url = oscanUrl(st);
        uiStatus(`${OW()}-Scan (${st.mode === 'dry' ? 'Probelauf' : 'Blockieren'}): ${pl.gender} ab ${pl.minAge}, ${st.countries[st.ci] || 'alle Länder'}, Seite ${st.page} · ${st.hits} Treffer · ${st.done} blockiert`);
        let html = '';
        try {
          const res = await W.fetch(url, { credentials: 'include' });
          if (res.status === 503 || res.status === 429) throw Object.assign(new Error('Server ' + res.status), { retry: true });
          if (res.status !== 200) throw new Error('Seite ' + res.status);
          html = await res.text();
        } catch (e) {
          st.err = (st.err || 0) + 1;
          if (e.retry && st.err <= 6) { const w = retryDelay(st.err); uiLog(`${e.message} – neuer Versuch in ${Math.round(w / 1000)} s`); gs(K.oscan, st); await sleep(w); continue; }
          oscanDone(st, 'abgebrochen: ' + e.message); break;
        }
        st.err = 0;
        const ini = initialsOf(html);
        const users = (((ini || {}).datingListComponent || {}).users) || [];
        if (ini) peopleWalk(users);
        const lists = gm(K.lists, {}) || {};
        const blocked = new Set(lists.blocked || []);
        for (const u of users) {
          if (!gm(K.oscan, null)) break;
          const p = personOf(u);
          if (!p || !p.id) continue;
          st.seen++;
          if (p.retired) { st.skip.gelöscht = (st.skip.gelöscht || 0) + 1; continue; }
          const cc = ((u.personalInfo || {}).geo || {}).countryCode;
          if (st.countries[st.ci] && cc && cc.toLowerCase() !== st.countries[st.ci]) { st.skip['anderes Land'] = (st.skip['anderes Land'] || 0) + 1; continue; }
          const c = classify(p, 'suche');
          if (!c.ignore) { const why = c.white || (p.age == null ? 'ohne Alter' : 'unter der Grenze'); st.skip[why] = (st.skip[why] || 0) + 1; continue; }
          if (blocked.has(p.id)) { st.skip['schon blockiert'] = (st.skip['schon blockiert'] || 0) + 1; continue; }
          st.hits++;
          if (st.list.length < 3000) st.list.push({ id: p.id, nick: p.nick, age: p.age, city: p.city, g: p.gender });
          if (st.mode !== 'block') continue;
          if (st.done >= st.max) break;
          let r;
          try { r = await blockUser(p.id, true); } catch (e) { r = { ok: false, msg: e.message }; }
          if (r.ok) {
            st.done++;
            st.failRun = 0;
            blocked.add(p.id);
            lists.blocked = [...blocked]; gs(K.lists, lists);
            bymeAdd(Object.assign({}, p, { bday: (u.personalInfo || {}).birthday }));
            uiLog(`blockiert: ${p.nick} (${p.age}, ${p.city || '?'})`);
            if (!st.verified) {
              st.verified = true;
              recEvent('Opa-Scan: erster Block geprüft', { info: `Beziehung danach: ${r.rel || '?'}` });
              if (r.rel && r.rel !== 'blocked') { gs(K.oscan, st); oscanDone(st, `abgebrochen: nach dem Blockieren meldet xHamster „${r.rel}“ statt „blocked“`); return; }
            }
          } else {
            st.fail++;
            st.failRun = (st.failRun || 0) + 1;
            st.skip['Block abgelehnt'] = (st.skip['Block abgelehnt'] || 0) + 1;
            uiLog(`nicht blockiert: ${p.nick} – ${r.msg || 'Status ' + r.status}`);
            recEvent('Opa-Scan: Block fehlgeschlagen', { info: `${r.status || ''} ${r.msg || ''}`.trim(), resp: r.text || '' });
            // 0.3.0: einzelne Fehler überspringen; abbrechen erst nach 3 Fehlern hintereinander (oder wenn schon der erste scheitert)
            if (!st.verified || st.failRun >= 3) { gs(K.oscan, st); oscanDone(st, 'abgebrochen: Blockieren klappt nicht' + (r.msg ? ` (${r.msg})` : '')); return; }
          }
          gs(K.oscan, st);
          gs('xh_oscan_lock', { tab: TAB_ID, at: now() });
          await sleep(2000 + Math.random() * 3000);
        }
        if (!gm(K.oscan, null)) { uiStatus(`${OW()}-Scan angehalten.`); break; }
        if (st.mode === 'block' && st.done >= st.max) { oscanDone(st, `Höchstzahl ${st.max} erreicht`); break; }
        const next = users.length ? nextPageUrl(html, st.page) : '';
        if (next && st.page < 200) { st.page++; st.url = next; } else {
          st.page = 1; st.url = ''; st.ci++;
          if (st.ci >= st.countries.length) { st.ci = 0; st.pi++; }
        }
        gs(K.oscan, st);
        await sleep(2500 + Math.random() * 3000);
      }
    } finally { oscanBusy = false; }
  }
  function oscanDone(st, why) {
    gs(K.oscan, null);
    gs('xh_oscan_lock', null);
    const sum = { mode: st.mode, at: now(), why, seen: st.seen, hits: st.hits, done: st.done, fail: st.fail, skip: st.skip, list: st.list.slice(0, 3000) };
    gs('xh_oscan_last', sum);
    recEvent('Opa-Scan beendet', { info: `${st.mode}: ${why} · ${st.seen} gesehen · ${st.hits} Treffer · ${st.done} blockiert · ${st.fail} Fehler` });
    const skip = Object.entries(st.skip).map(([k, v]) => `${k} ${v}`).join(', ');
    uiStatus(`${OW()}-Scan ${why}: ${st.seen} gesehen, ${st.hits} ${st.mode === 'dry' ? 'würden blockiert' : 'Treffer'}, ${st.done} blockiert${st.fail ? `, ${st.fail} Fehler` : ''}.`);
    uiLog(`Übersprungen: ${skip || '–'}`);
    if (st.mode === 'dry' && st.list.length) uiLog('Beispiele: ' + st.list.slice(0, 15).map((x) => `${x.nick} (${x.age})`).join(', '));
  }
  function rulesInfo() {
    const s = rules();
    const lines = [`Regeln: ${s.from}`];
    for (const gk of ['m', 'w', 'p']) {
      const g = s.groups[gk];
      const lim = (s.expert.sharedLimits ? g.src.global : g.src.suche) || [];
      const l = labelsOf(gk, s);
      lines.push(`${{ m: 'Männer', w: 'Frauen', p: 'Paare' }[gk]}: ${l[0]} bis ${lim[0]}, ${l[2]} bis ${lim[1]}, ${l[4]} ab ${lim[2]} · markieren ${g.visual ? 'ja' : 'nein'} · ignorieren ${g.ignore ? 'ja' : 'nein'}`);
    }
    lines.push(`Whitelist: ${(s.whitelist.names || []).length} Namen, Präfixe ${(s.whitelist.prefixes || []).join(', ') || '–'}`);
    const last = gm('xh_oscan_last', null);
    if (last) lines.push(`Letzter ${OW()}-Scan (${last.mode === 'dry' ? 'Probelauf' : 'Blockieren'}, ${new Date(last.at).toLocaleString()}): ${last.why}, ${last.hits} Treffer, ${last.done} blockiert`);
    alert(lines.join('\n'));
  }

  // =====================================================================
  // Start
  // =====================================================================
  hookNetwork();
  // 0.1.7: zuerst, damit es auch bei schnellem Neuladen erreichbar ist
  // 0.2.1: eine Liste für beide Menüs – das Tampermonkey-Menü und das Nutzer-Menü von xHamster (Klick auf den eigenen Avatar)
  const running = () => !!(gm(K.scan, null) || gm(K.act, null) || gm(K.oscan, null) || gm(ISCAN_K, null));
  const stopAll = () => { gs(K.scan, null); gs(K.act, null); gs(K.oscan, null); gs(ISCAN_K, null); gs('xh_oscan_lock', null); gs('xh_accept', 0); uiStatus('Angehalten.'); recEvent('Von Hand angehalten'); };
  const toggleHide = () => { const o = opa(); o.hide = !o.hide; gs(K.opa, o); alert(o.hide ? `${OWs()} werden in der Dating-Suche ausgeblendet (ab dem nächsten Laden).` : `${OWs()} werden nur abgedunkelt (ab dem nächsten Laden).`); };
  const ACTIONS = [
    { g: 'fl', icon: 'fick', label: () => 'Fickliste', fn: flOpen },
    { g: 'fl', icon: 'figur', label: () => `${OW()}-Schutz (Einstellungen)`, ddLabel: () => `${OW()}-Schutz`, fn: setOpen },
    { g: 'fl', icon: 'stop', label: () => `■ Anhalten (${OW()}-Scan, Scan-Lauf, Aktionstest)`, ddLabel: () => 'Anhalten', fn: stopAll, dd: running },
    { g: 'opa', icon: 'scan', label: () => `${OW()}-Scan: Probelauf (zählt nur)`, fn: () => oscanStart('dry') },
    { g: 'opa', icon: 'block', label: () => `${OW()}-Scan: ${OWs()} blockieren`, fn: () => oscanStart('block') },
    { g: 'opa', icon: 'scan', label: () => 'Interaktionen prüfen: Probelauf (Benachrichtigungen)', fn: () => iscanStart('dry') },
    { g: 'opa', icon: 'block', label: () => `Interaktionen prüfen: ${OWs()} blockieren`, fn: () => iscanStart('block') },
    { g: 'opa', icon: 'reload', label: () => 'Blockierliste abgleichen', fn: () => blockSync().then(relaxCheck).catch((e) => uiStatus('Blockierliste: ' + e.message)) },
    { g: 'opa', icon: 'rules', label: () => 'Prüflauf (alle Funktionen ansehen)', fn: () => selfTest() },
    { g: 'opa', icon: 'rules', label: () => 'Sicherung exportieren', fn: backupExport },
    { g: 'opa', icon: 'rules', label: () => 'Sicherung einspielen', fn: backupImport },
    { g: 'opa', icon: 'rules', label: () => 'Regeln von poppen.de anzeigen', fn: rulesInfo },
    { g: 'opa', icon: 'reload', label: () => 'Regeln von poppen.de neu laden', fn: async () => { await rulesRefresh(true); rulesInfo(); } },
    { g: 'opa', icon: 'eye', label: () => `${OWs()} in der Dating-Suche ${opa().hide ? 'nur abdunkeln' : 'ausblenden'}`, fn: toggleHide },
    { g: 'rec', gate: true, icon: 'rec', label: () => 'Scan-Lauf starten', fn: scanStart },
    { g: 'rec', gate: true, icon: 'rec', label: () => 'Aktionstest starten (mit Partnerkonto)', fn: actStart },
    { g: 'rec', gate: true, icon: 'rec', label: () => 'Freundschaftsanfrage des Partners annehmen', fn: acceptPartner },
    { g: 'rec', gate: true, icon: 'send', label: () => 'Rekorder an Home Assistant senden', fn: () => recToHa() },
    { g: 'rec', gate: true, icon: 'send', label: () => 'Rekorder exportieren (Datei)', fn: recExportFile },
    { g: 'rec', gate: true, icon: 'rec', label: () => `Rekorder ${recOn() ? 'ausschalten' : 'einschalten'}`, fn: () => { gs(K.recOn, !recOn()); alert('Rekorder ' + (recOn() ? 'an' : 'aus') + ' (gilt ab dem nächsten Laden).'); } },
    { g: 'rec', gate: true, icon: 'rec', label: () => 'Rekorder: Vorgabe wiederherstellen (nur Testkonten)', fn: () => { GM_deleteValue(K.recOn); alert('Rekorder läuft jetzt nur für die Testkonten.'); } },
    { g: 'rec', gate: true, icon: 'rec', label: () => 'Rekorder leeren', fn: () => { if (confirm('Alles Gesammelte löschen?')) { recBuf = null; GM_deleteValue(K.rec); } } },
    { g: 'rec', gate: true, icon: 'rec', label: () => 'Partnerkonto eintragen', fn: () => { const v = prompt('Nick des Partnerkontos (leer = Vorgabe):', gm(K.partner, '') || partner()); if (v != null) gs(K.partner, v.trim()); } },
    { g: 'rec', gate: true, icon: 'rec', label: () => 'Home-Assistant-Adresse eintragen', fn: haSetup },
  ];
  for (const x of ACTIONS) if ((!x.gate || recGate()) && x.tm !== false) try { GM_registerMenuCommand(x.label(), x.fn); } catch (e) { /* egal */ }
  // Symbole (20 × 20, Stil wie die xHamster-Menüsymbole)
  // 0.3.2: Fickliste und Opa-/Oma-Schutz mit denselben Zeichnungen wie in den anderen Skripten
  const ICON_VB = { fick: '-4 -4 264 217', figur: '0 0 640 1280' };
  const ICONS = {
    fick: () => `<path d="${FL_D}"/>`,
    figur: () => owFigure(),
    stop: '<rect x="5" y="5" width="10" height="10" rx="1.5"/>',
    scan: '<path d="M8.5 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 1.8a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm4.6 8 4 4-1.3 1.3-4-4 1.3-1.3Z"/>',
    block: '<path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-4.7 4.6A6 6 0 0 0 13.4 14.7L5.3 6.6Zm1.3-1.3 8.1 8.1A6 6 0 0 0 6.6 5.3Z"/>',
    rules: '<path d="M4 3h12v2H4V3Zm0 4h12v2H4V7Zm0 4h8v2H4v-2Zm0 4h8v2H4v-2Z"/>',
    reload: '<path d="M10 3a7 7 0 0 1 6.3 4H14v2h5V4h-2v1.7A9 9 0 1 0 19 10h-2a7 7 0 1 1-7-7Z"/>',
    eye: '<path d="M10 4c4.5 0 7.6 3.6 8.6 6-1 2.4-4.1 6-8.6 6S2.4 12.4 1.4 10C2.4 7.6 5.5 4 10 4Zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/>',
    rec: '<circle cx="10" cy="10" r="5"/>',
    send: '<path d="M2 3l16 7-16 7 2.5-7L2 3Zm3.8 6h5.7v2H5.8L5 13.6 13.4 10 5 6.4 5.8 9Z"/>',
  };
  // Nutzer-Menü von xHamster: eigene Einträge vor „Edit profile“ (wird bei jedem Öffnen neu aufgebaut)
  function ddInsert() {
    const ul = document.querySelector('.user-dropdown > ul');
    if (!ul || ul.querySelector('.xhsc-dd')) return;
    const edit = [...ul.querySelectorAll('a[href]')].find((a) => /\/my\/edit\/profile\/?$/.test(a.getAttribute('href') || ''));
    const anchor = edit ? edit.closest('li') : null;
    const linkCls = (ul.querySelector('a.user-dropdown-link:not(.profile-link)') || {}).className || 'user-dropdown-link';
    const iconCls = (ul.querySelector('.user-dropdown-link .xh-icon') || {}).className || 'xh-icon';
    const svgEl = ul.querySelector('.user-dropdown-link .xh-icon svg');
    const svgCls = (svgEl && svgEl.getAttribute('class')) || '';
    const frag = document.createDocumentFragment();
    const sep = () => { const li = document.createElement('li'); li.className = 'user-dropdown-item separator xhsc-dd'; frag.appendChild(li); };
    sep();
    const head = document.createElement('li');
    head.className = 'user-dropdown-item xhsc-dd';
    head.style.cssText = 'padding:6px 16px 2px;font:600 11px/1.3 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;opacity:.6';
    head.textContent = 'Swinger Companion';
    frag.appendChild(head);
    let lastG = '';
    for (const x of ACTIONS) {
      // 0.2.8: im Nutzer-Menü nur Fickliste, Opa-Schutz und (wenn etwas läuft) Anhalten – kurze Namen, damit das
      // Menü seine Breite behält; alles andere steht auf der Einstellungsseite und im Tampermonkey-Menü
      if (x.g !== 'fl') continue;
      if (x.dd && !x.dd()) continue;
      if (lastG && x.g !== lastG) sep();
      lastG = x.g;
      const li = document.createElement('li');
      li.className = 'user-dropdown-item with-icon xhsc-dd';
      li.innerHTML = `<a class="${esc(linkCls)}" href="#"><span class="${esc(iconCls)}"><svg viewBox="${ICON_VB[x.icon] || '0 0 20 20'}" width="20" height="20" class="${esc(svgCls)}" fill="currentColor" preserveAspectRatio="xMidYMid meet">${typeof ICONS[x.icon] === 'function' ? ICONS[x.icon]() : (ICONS[x.icon] || '')}</svg></span> </a>`;
      li.querySelector('a').append(x.ddLabel ? x.ddLabel() : x.label());
      li.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        // Menü schließen (Klick neben das Menü), dann ausführen
        try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (er) { /* egal */ }
        setTimeout(() => { try { x.fn(); } catch (er) { console.warn('[xHamster-SC]', er); } }, 50);
      });
      frag.appendChild(li);
    }
    if (anchor) { const prev = anchor.previousElementSibling; (prev && prev.matches('li.separator') ? prev : anchor).before(frag); }
    else ul.appendChild(frag);
  }

  // Fehler 503 (Server überlastet): mit steigendem Abstand neu laden, das fängt sich von selbst
  function is503() {
    let st = 0;
    try { const n = performance.getEntriesByType('navigation')[0]; st = (n && n.responseStatus) || 0; } catch (e) { st = 0; }
    if (st === 503) return true;
    if (st >= 200 && st < 400) return false;
    const t = (document.title || '') + ' ' + ((document.body && document.body.innerText) || '').slice(0, 400);
    return !initials() && /\b503\b|service unavailable|temporarily unavailable/i.test(t);
  }
  function retry503() {
    if (!is503()) { try { sessionStorage.removeItem('xhsc_503'); } catch (e) { /* egal */ } return false; }
    let n = 0;
    try { n = (parseInt(sessionStorage.getItem('xhsc_503'), 10) || 0) + 1; sessionStorage.setItem('xhsc_503', String(n)); } catch (e) { n = 1; }
    const wait = retryDelay(n);
    recEvent('Fehler 503 – lade neu', { info: `Versuch ${n}, in ${Math.round(wait / 1000)} s` });
    uiStatus(`xHamster meldet 503 – neuer Versuch ${n} in ${Math.round(wait / 1000)} s`);
    setTimeout(() => location.reload(), wait);
    return true;
  }
  function onReady() {
    if (retry503()) return;
    me();
    // 0.5.0: Kontobindung – bei einem anderen Konto bleibt das Skript aus
    if (!ownerOk()) {
      const o = gm(OWNER_K, null) || {};
      try { GM_registerMenuCommand(`Swinger Companion auch für dieses Konto verwenden (gebunden an ${o.nick || '?'})`, ownerRebind); } catch (e) { /* egal */ }
      try { if (!sessionStorage.getItem('xhsc_owner_note')) { sessionStorage.setItem('xhsc_owner_note', '1'); setTimeout(() => uiToast(`Swinger Companion ist aus: angemeldet ist ein anderes Konto als ${esc(o.nick || '?')}. Einschalten über das Tampermonkey-Menü „auch für dieses Konto verwenden“.`), 1500); } } catch (e) { /* egal */ }
      return;
    }
    ageWithMe();
    bodyLearn();
    setTimeout(() => recToHa(true).catch(() => {}), 120000);
    setInterval(() => recToHa(true).catch(() => {}), 30 * 60000);
    recPage();
    collect();
    peopleWalk(initials());
    // gemeinsame Ablage: Regeln von poppen.de, Fickliste, eigenes Profil
    (async () => {
      try { if (await rulesRefresh()) { for (const b of document.querySelectorAll('.xhsc-badge')) b.remove(); const pb = document.getElementById('xhsc-prof'); if (pb) pb.remove(); const mn = document.querySelector('.xhsc-mop-nav'); if (mn) mn.remove(); setTimeout(relaxCheck, 2000); } } catch (e) { /* egal */ }
      try { await fickAll(); await ichPut(); await fickGalleryPics(); mediaStart(); } catch (e) { recEvent('Fickliste nicht erreichbar', { info: String(e && e.message || e) }); }
    })();
    if (gm(K.oscan, null)) setTimeout(oscanRun, 3000);
    if (gm(ISCAN_K, null)) setTimeout(iscanRun, 3500);
    // Rekorder: neue Gifts (Zähler in den Seitendaten)
    try { const nm = (initials() || {}).notificationsModel; if (nm && typeof nm.gifts === 'number') { const g0 = gm('xh_gifts_n', 0); if (nm.gifts > g0) recEvent('Neue Gifts', { info: `${g0} → ${nm.gifts}` }); gs('xh_gifts_n', nm.gifts); } } catch (e) { /* egal */ }
    if (gm(K.scan, null)) setTimeout(scanTick, 2500);
    if (gm(K.act, null)) setTimeout(actTick, 2500);
    if (Date.now() - (gm('xh_accept', 0) || 0) < 120000) setTimeout(acceptPartner, 2500);
    const tick = () => { try { profileBox(); decorate(); flTab(); flButton(); mopNav(); setMenu(); adHide(); tplButton(); videoSyncButton(); flOwnBox().catch(() => {}); hdrIcon(); mopSort(); } catch (e) { /* egal */ } };
    navCss();
    // Nutzer-Menü: entsteht erst beim Öffnen – sofort ergänzen
    try { new MutationObserver(() => { try { ddInsert(); } catch (e) { /* egal */ } }).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* egal */ }
    tick();
    flCheckHash();
    window.addEventListener('hashchange', flCheckHash);
    setCheckHash();
    window.addEventListener('hashchange', setCheckHash);
    setInterval(tick, 1500);
    // Seitenwechsel ohne Neuladen: Stand der neuen Seite aufzeichnen
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; setTimeout(recPage, 2500); } }, 1000);
  }
  try { navCss(); } catch (e) { /* egal */ }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true }); else onReady();

  // für Tests
  if (typeof W.__xhscTest === 'function') W.__xhscTest({ shrink, maskStr, maskUrl, pathPattern, ageOf, personOf, censorDiff, MSG_VARIANTS, popRules, classify, labelsOf, initialsOf, nextPageUrl, oscanPlan, fickFind, bridgePick, urlKey, peopleWalk, People, ruhrOf });
})();
