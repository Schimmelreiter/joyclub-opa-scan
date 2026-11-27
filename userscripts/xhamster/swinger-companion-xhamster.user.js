// ==UserScript==
// @name         Swinger Companion – xHamster
// @namespace    https://github.com/Schimmelreiter/swinger-companion
// @version      0.2.4
// @description  Swinger Companion für xHamster: Opas markieren und blockieren nach den Regeln des poppen-Skripts, gemeinsame Fickliste, Profilkasten; Rekorder für die Testkonten
// @match        https://xhamster.com/*
// @match        https://*.xhamster.com/*
// @match        https://www.poppen.de/*
// @match        https://www.joyclub.de/*
// @match        https://schimmelreiter.github.io/briefkasten.html*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=xhamster.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
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
  function maskStr(s) { return String(s).replace(MAIL_RE, '[mail]').replace(IP_RE, '[ip]'); }
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
      online: !!u.isOnline, relation: u.currentUserRelation || '', thumb: u.thumbURL || '',
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
        XP.open = function (m, u) { this.__xhm = m; this.__xhu = String((u && u.href) || u || ''); this.__xhh = {}; return oo.apply(this, arguments); };
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
  function me() {
    const ini = initials() || {};
    let u = null;
    try { u = ini.layout.headerWrapperProps.headerDesktopProps.userHeadProps.user; } catch (e) { u = null; }
    if (!u) try { u = ini.commentsComponent.authorizedUser; } catch (e) { u = null; }
    if (u && u.id) { const r = { id: String(u.id), nick: u.name || '' }; gs('xh_me', r); recGateUpdate(r.nick).catch(() => {}); return r; }
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
    box.querySelector('[data-a=stop]').onclick = () => { gs(K.scan, null); gs(K.act, null); gs(K.oscan, null); uiStatus('Abgebrochen.'); };
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
      if (!/^(groups\.|warnYears$|watch$|whitelist\.(names|prefixes)$|expert\.sharedLimits$)/.test(p)) continue;
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
  let rulesCache = null;
  function rules() {
    if (rulesCache) return rulesCache;
    const r = gm(POPK, null) || {};
    rulesCache = popRules(r.stored);
    rulesCache.ruhr = !!r.ruhr;
    rulesCache.from = r.src === 'poppen' ? `poppen.de (Stand ${new Date(r.popAt || r.at || 0).toLocaleString()})` : 'Vorgaben des poppen-Skripts';
    return rulesCache;
  }
  async function rulesRefresh(force = false) {
    const cur = gm(POPK, null);
    if (!force && cur && now() - (cur.at || 0) < 30 * 60000) return false;
    let r = null;
    try { r = await SH.call('get', { s: 'meta', k: 'poppen_gm' }, 20000); } catch (e) { recEvent('Briefkasten nicht erreichbar', { info: String(e && e.message || e) }); gs(POPK, Object.assign({}, cur || {}, { at: now() })); return false; }
    const data = (r && r.data) || null;
    const next = data && data.vaf2_settings !== undefined
      ? { at: now(), src: 'poppen', popAt: r.at || 0, popVer: r.ver || '', stored: data.vaf2_settings || {}, ruhr: ruhrOf(((data.vaf2_me || {}).cities) || []) }
      : { at: now(), src: 'vorgabe', stored: {}, ruhr: false };
    const changed = !cur || stable(cur.stored || {}) !== stable(next.stored) || cur.ruhr !== next.ruhr;
    gs(POPK, next); rulesCache = null;
    return changed;
  }
  function labelsOf(gk, s = rules()) {
    const l = [...(s.groups[gk].labels || POP_DEFAULTS.groups[gk].labels)];
    if (s.ruhr) for (const i of [4, 5]) if (REGIONAL[l[i]]) l[i] = REGIONAL[l[i]];
    return l;
  }
  // xHamster-Geschlecht → Gruppe der poppen-Regeln (Paare aus Mann und Frau; übrige Paar- und Trans-Angaben bleiben ohne Gruppe)
  const groupOfGender = (g) => (g === 'male' ? 'm' : g === 'female' ? 'w' : g === 'couple' ? 'p' : null);
  const fickXhIds = () => new Set(gm('xh_fick_ids', []) || []);
  function whiteOf(p, s = rules()) {
    const n = norm(p.nick);
    if (n && (s.whitelist.names || []).some((x) => norm(x && x.n) === n)) return 'Whitelist';
    if (n && (s.whitelist.prefixes || []).some((x) => x && n.startsWith(norm(x)))) return 'Whitelist (Präfix)';
    const lists = gm(K.lists, {}) || {};
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
    if (ch) { gs(K.lists, lists); rulesCache = null; }
  }
  const srcOfPage = () => (/^\/dating/.test(location.pathname) ? 'suche' : 'interaktionen');
  function decorate() {
    if (!People.byId.size) return;
    const src = srcOfPage();
    const items = document.querySelectorAll('.item.friend, [class*="card"], [class*="Card"], li');
    for (const it of items) {
      if (it.querySelector('.xhsc-badge') || it.closest('#xhsc-box, header, .user-dropdown, [data-role="header"]')) continue;
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
      const html = badgeHtml(p, c);
      if (!html) continue;
      const b = document.createElement('div');
      b.className = 'xhsc-badge';
      b.style.cssText = 'font:11.5px/1.3 system-ui,sans-serif;color:#ccc;margin-top:2px';
      b.innerHTML = html;
      (it.querySelector('.info, .conversation-meta, [class*="userInfo-"]') || it).appendChild(b);
      // bei jedem Neuzeichnen (z. B. nach neuen Regeln) setzen, nicht nur hinzufügen
      it.style.display = ''; it.style.opacity = ''; it.removeAttribute('title');
      if (c.ignore) { if (opa().hide && src === 'suche') it.style.display = 'none'; else { it.style.opacity = '.35'; it.title = `${c.label}: ${c.reason}`; } }
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
    if (cl.near) bits.push('<span style="color:#ef6c00">bald über der Grenze</span>');
    if (cl.white && cl.white !== 'ich') bits.push(`<span style="color:#9ec5ff">${esc(cl.white)}</span>`);
    if (c.galleries != null) bits.push(`${c.galleries} Galerien`);
    if (c.videos != null) bits.push(`${c.videos} Videos`);
    if (p.info.Website) bits.push(`<a href="${esc(p.info.Website)}" target="_blank" rel="noopener" style="color:#9ec5ff">${esc(p.info.Website.replace(/^https?:\/\//, ''))}</a>`);
    const d = document.createElement('div');
    d.id = 'xhsc-prof';
    d.style.cssText = 'font:12.5px/1.4 system-ui,sans-serif;color:#ccc;margin:4px 0 6px';
    d.innerHTML = `<div>${bits.join(' · ')}</div>`;
    h.after(d);
    if (cl.white === 'ich') return;
    const f = document.createElement('div');
    f.className = 'xhsc-fl-state';
    f.style.cssText = 'margin-top:2px';
    d.appendChild(f);
    flStateLine(p);
  }
  // Zeile „Fickliste: …“ im Profilkasten (geändert wird über den Knopf in der Knopfleiste)
  async function flStateLine(p, cur) {
    const f = document.querySelector('#xhsc-prof .xhsc-fl-state');
    if (!f) return;
    if (cur === undefined) { try { cur = fickFind(await fickAll(), p); } catch (e) { f.innerHTML = `<span style="color:#ff7875">Fickliste: ${esc(e.message)}</span>`; return; } }
    f.innerHTML = 'Fickliste: ' + (cur ? `<b style="color:${FCOL[cur.status] || '#ccc'}">${esc(FSTAT[cur.status] || 'ohne Status')}</b>${cur.main && cur.main.pf !== 'xhamster' ? ` (Hauptprofil ${esc(PF_NAME[cur.main.pf] || cur.main.pf)}: ${esc(cur.main.nick || cur.alias || '')})` : ''}` : 'nicht eingetragen');
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
    }).join(' · ');
    const st = r.status ? `<b style="color:${FCOL[r.status] || 'inherit'}">${esc(FSTAT[r.status] || r.status)}</b>` : '<span style="opacity:.6">ohne Status</span>';
    const meets = (r.meets || []).filter((m) => m && (m.date || m.club || m.where)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const meetHtml = meets.length ? `<div style="font-weight:600;margin-bottom:2px">Treffen (${meets.length})</div>` + meets.slice(0, 8).map((m) => {
      const bits = [m.date ? deDate(m.date) + (m.time ? ' ' + esc(m.time) : '') : '', esc(m.club || ''), esc(m.where || '')].filter(Boolean).join(' · ');
      const l = m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">Link</a>` : '';
      return `<div>${bits || '–'}${l}${m.note ? `<div style="opacity:.7;font-size:12px">${esc(String(m.note).slice(0, 200))}</div>` : ''}</div>`;
    }).join('') + (meets.length > 8 ? `<div style="opacity:.6">… und ${meets.length - 8} weitere</div>` : '') : '';
    const notes = String(r.notes || '').trim();
    const noteHtml = notes ? `<div style="font-weight:600;margin:6px 0 2px">Anmerkung</div><div class="xhsc-fl-note" style="white-space:pre-wrap;max-height:7.5em;overflow:hidden;cursor:pointer" title="Klicken: ganz anzeigen">${esc(notes)}</div>` : '';
    const right = meetHtml || noteHtml ? meetHtml + noteHtml : '<span style="opacity:.5">Keine Treffen, keine Anmerkung.</span>';
    return `<div class="item friend xhsc-fl-item" style="float:none;width:auto;display:flex;gap:16px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(128,128,128,.25)">
      <div style="display:flex;gap:12px;flex:0 0 300px;min-width:0"><div class="image-container avatar-container normal">${mainUrl ? `<a href="${esc(mainUrl)}" target="_blank" rel="noopener">${img}</a>` : img}</div>
      <div class="info" style="min-width:0"><div class="info-line">${mainUrl ? `<a href="${esc(mainUrl)}" target="_blank" rel="noopener">${name}</a>` : name}</div><div>${st}</div><div style="font-size:12px;opacity:.85">${links}</div></div></div>
      <div style="flex:1 1 auto;min-width:0;font-size:13px;line-height:1.45">${right}</div></div>`;
  }
  // Liste mit Filter und Suche in einen Behälter zeichnen
  async function flRender(box) {
    box.innerHTML = '<span style="opacity:.6">Lade die Fickliste …</span>';
    let list = [];
    try { list = await fickAll(true); } catch (e) { box.innerHTML = `<span style="color:#e53935">Fickliste nicht erreichbar: ${esc(e.message)}</span>`; return; }
    box.innerHTML = `<div data-f style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px"></div>
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
    };
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
    for (const ul of document.querySelectorAll('ul.friends-additional-switchers')) if (!ul.classList.contains('xh-helper-hidden')) { ul.classList.add('xh-helper-hidden'); hidden.push(ul); }
    const box = document.createElement('div');
    box.className = 'friends-list xhsc-fl-list';
    col.prepend(box);
    // anderen Eintrag der Seitenleiste gewählt → Fickliste weg, Seite wie vorher
    const leave = () => {
      box.remove(); hidden.forEach((el) => el.classList.remove('xh-helper-hidden'));
      if (mine) mine.classList.remove('active');
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
      const fr = [...ts.querySelectorAll('a.friends')].find((a) => /\/my\/friends\/?$/.test(a.getAttribute('href') || ''));
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
  // Opa-Scan (ab 0.2.0): Dating-Suche nach den poppen-Regeln durchgehen und Opas blockieren
  // Erst Probelauf (zählt nur), dann Blockieren: der erste Block wird geprüft, danach Pausen von 2–5 s.
  // Ausgenommen: Whitelist, Freunde, Fickliste, man selbst, schon Blockierte, gelöschte Konten.
  // =====================================================================
  let apiHdr = null;                       // Kopfzeilen der Seite für /x-api (nur im Arbeitsspeicher)
  const HDR_SKIP = /^(content-length|cookie|host|content-type)$/i;
  function captureHdr(h) {
    if (!h) return;
    const out = {};
    try {
      if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { if (!HDR_SKIP.test(k)) out[k] = v; });
      else if (Array.isArray(h)) for (const [k, v] of h) { if (!HDR_SKIP.test(k)) out[k] = v; }
      else for (const k of Object.keys(h)) if (!HDR_SKIP.test(k)) out[k] = h[k];
    } catch (e) { return; }
    if (Object.keys(out).length && (!apiHdr || stable(Object.keys(apiHdr).sort()) !== stable(Object.keys(out).sort()))) recEvent('Kopfzeilen für /x-api', { info: Object.keys(out).sort().join(', ') });
    apiHdr = out;
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  async function blockUser(id, state = true) {
    const body = [{ name: 'entityBlockModelSync', requestData: { model: { id: null, $id: uuid(), modelName: 'entityBlockModel', itemState: 'created', entityModel: 'userModel', entityID: Number(id), state } } }];
    const res = await W.fetch('/x-api', { method: 'POST', credentials: 'include', headers: Object.assign({ accept: 'application/json, text/plain, */*' }, apiHdr || {}, { 'content-type': 'application/json' }), body: JSON.stringify(body) });
    const t = await res.text();
    let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    const e = (Array.isArray(j) && j[0] && j[0].extras) || {};
    return { ok: res.status === 200 && e.result === true, rel: e.currentUserRelation || '', msg: e.message || '', status: res.status };
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
  function oscanStart(mode) {
    const plan = oscanPlan();
    if (!plan.length) { alert('Nach den poppen-Regeln wird keine Gruppe ignoriert – nichts zu tun.'); return; }
    const cty = prompt('Länder (Kürzel, durch Komma getrennt; leer = alle):', gm('xh_oscan_cty', 'de,at,ch'));
    if (cty == null) return;
    gs('xh_oscan_cty', cty);
    let max = 0;
    if (mode === 'block') {
      const v = prompt('Höchstens so viele in diesem Lauf blockieren:', String(gm('xh_oscan_max', 200)));
      if (v == null) return;
      max = Math.max(1, parseInt(v, 10) || 200); gs('xh_oscan_max', max);
      const dry = gm('xh_oscan_last', null);
      if (!dry || dry.mode !== 'dry' || now() - (dry.at || 0) > 86400000) { if (!confirm('Seit einem Tag kein Probelauf. Trotzdem gleich blockieren?')) return; }
    }
    const countries = cty.split(/[,; ]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]{2}$/.test(x));
    const st = { mode, plan, countries: countries.length ? countries : [''], pi: 0, ci: 0, page: 1, url: '', seen: 0, hits: 0, done: 0, fail: 0, skip: {}, verified: false, max, started: now(), list: [], err: 0 };
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
      if (!lockMine()) { uiStatus('Opa-Scan läuft in einem anderen Tab.'); return; }
      await fickAll().catch(() => null);
      for (;;) {
        let st = gm(K.oscan, null);
        if (!st) { uiStatus('Opa-Scan angehalten.'); break; }
        if (!lockMine()) { uiStatus('Opa-Scan läuft in einem anderen Tab.'); break; }
        gs('xh_oscan_lock', { tab: TAB_ID, at: now() });
        if (st.pi >= st.plan.length) { oscanDone(st, 'fertig'); break; }
        const pl = st.plan[st.pi];
        const url = oscanUrl(st);
        uiStatus(`Opa-Scan (${st.mode === 'dry' ? 'Probelauf' : 'Blockieren'}): ${pl.gender} ab ${pl.minAge}, ${st.countries[st.ci] || 'alle Länder'}, Seite ${st.page} · ${st.hits} Treffer · ${st.done} blockiert`);
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
            blocked.add(p.id);
            lists.blocked = [...blocked]; gs(K.lists, lists);
            uiLog(`blockiert: ${p.nick} (${p.age}, ${p.city || '?'})`);
            if (!st.verified) {
              st.verified = true;
              recEvent('Opa-Scan: erster Block geprüft', { info: `Beziehung danach: ${r.rel || '?'}` });
              if (r.rel && r.rel !== 'blocked') { gs(K.oscan, st); oscanDone(st, `abgebrochen: nach dem Blockieren meldet xHamster „${r.rel}“ statt „blocked“`); return; }
            }
          } else {
            st.fail++;
            uiLog(`nicht blockiert: ${p.nick} – ${r.msg || 'Status ' + r.status}`);
            recEvent('Opa-Scan: Block fehlgeschlagen', { info: `${r.status || ''} ${r.msg || ''}`.trim() });
            if (!st.verified || st.fail >= 3) { gs(K.oscan, st); oscanDone(st, 'abgebrochen: Blockieren klappt nicht' + (r.msg ? ` (${r.msg})` : '')); return; }
          }
          gs(K.oscan, st);
          gs('xh_oscan_lock', { tab: TAB_ID, at: now() });
          await sleep(2000 + Math.random() * 3000);
        }
        if (!gm(K.oscan, null)) { uiStatus('Opa-Scan angehalten.'); break; }
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
    uiStatus(`Opa-Scan ${why}: ${st.seen} gesehen, ${st.hits} ${st.mode === 'dry' ? 'würden blockiert' : 'Treffer'}, ${st.done} blockiert${st.fail ? `, ${st.fail} Fehler` : ''}.`);
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
    if (last) lines.push(`Letzter Opa-Scan (${last.mode === 'dry' ? 'Probelauf' : 'Blockieren'}, ${new Date(last.at).toLocaleString()}): ${last.why}, ${last.hits} Treffer, ${last.done} blockiert`);
    alert(lines.join('\n'));
  }

  // =====================================================================
  // Start
  // =====================================================================
  hookNetwork();
  // 0.1.7: zuerst, damit es auch bei schnellem Neuladen erreichbar ist
  // 0.2.1: eine Liste für beide Menüs – das Tampermonkey-Menü und das Nutzer-Menü von xHamster (Klick auf den eigenen Avatar)
  const running = () => !!(gm(K.scan, null) || gm(K.act, null) || gm(K.oscan, null));
  const stopAll = () => { gs(K.scan, null); gs(K.act, null); gs(K.oscan, null); gs('xh_oscan_lock', null); gs('xh_accept', 0); uiStatus('Angehalten.'); recEvent('Von Hand angehalten'); };
  const toggleHide = () => { const o = opa(); o.hide = !o.hide; gs(K.opa, o); alert(o.hide ? 'Opas werden in der Dating-Suche ausgeblendet (ab dem nächsten Laden).' : 'Opas werden nur abgedunkelt (ab dem nächsten Laden).'); };
  const ACTIONS = [
    { g: 'fl', icon: 'heart', label: () => 'Fickliste', fn: flOpen },
    { g: 'opa', icon: 'stop', label: () => '■ Anhalten (Opa-Scan, Scan-Lauf, Aktionstest)', fn: stopAll, dd: running },
    { g: 'opa', icon: 'scan', label: () => 'Opa-Scan: Probelauf (zählt nur)', fn: () => oscanStart('dry') },
    { g: 'opa', icon: 'block', label: () => 'Opa-Scan: Opas blockieren', fn: () => oscanStart('block') },
    { g: 'opa', icon: 'rules', label: () => 'Regeln von poppen.de anzeigen', fn: rulesInfo },
    { g: 'opa', icon: 'reload', label: () => 'Regeln von poppen.de neu laden', fn: async () => { await rulesRefresh(true); rulesInfo(); } },
    { g: 'opa', icon: 'eye', label: () => `Opas in der Dating-Suche ${opa().hide ? 'nur abdunkeln' : 'ausblenden'}`, fn: toggleHide },
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
  const ICONS = {
    stop: '<rect x="5" y="5" width="10" height="10" rx="1.5"/>',
    scan: '<path d="M8.5 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 1.8a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm4.6 8 4 4-1.3 1.3-4-4 1.3-1.3Z"/>',
    block: '<path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-4.7 4.6A6 6 0 0 0 13.4 14.7L5.3 6.6Zm1.3-1.3 8.1 8.1A6 6 0 0 0 6.6 5.3Z"/>',
    rules: '<path d="M4 3h12v2H4V3Zm0 4h12v2H4V7Zm0 4h8v2H4v-2Zm0 4h8v2H4v-2Z"/>',
    reload: '<path d="M10 3a7 7 0 0 1 6.3 4H14v2h5V4h-2v1.7A9 9 0 1 0 19 10h-2a7 7 0 1 1-7-7Z"/>',
    eye: '<path d="M10 4c4.5 0 7.6 3.6 8.6 6-1 2.4-4.1 6-8.6 6S2.4 12.4 1.4 10C2.4 7.6 5.5 4 10 4Zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/>',
    rec: '<circle cx="10" cy="10" r="5"/>',
    heart: '<path d="M10 17.3 8.9 16.3C4.8 12.6 2 10.1 2 7a4 4 0 0 1 4-4c1.5 0 3 .7 4 1.8A5.3 5.3 0 0 1 14 3a4 4 0 0 1 4 4c0 3.1-2.8 5.6-6.9 9.3L10 17.3Z"/>',
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
      if (x.gate && !recGate()) continue;
      if (x.dd && !x.dd()) continue;
      if (lastG && x.g !== lastG) sep();
      lastG = x.g;
      const li = document.createElement('li');
      li.className = 'user-dropdown-item with-icon xhsc-dd';
      li.innerHTML = `<a class="${esc(linkCls)}" href="#"><span class="${esc(iconCls)}"><svg viewBox="0 0 20 20" width="20" class="${esc(svgCls)}" fill="currentColor">${ICONS[x.icon] || ''}</svg></span> </a>`;
      li.querySelector('a').append(x.label().replace(/^■ /, ''));
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
    setTimeout(() => recToHa(true).catch(() => {}), 120000);
    setInterval(() => recToHa(true).catch(() => {}), 30 * 60000);
    recPage();
    collect();
    peopleWalk(initials());
    // gemeinsame Ablage: Regeln von poppen.de, Fickliste, eigenes Profil
    (async () => {
      try { if (await rulesRefresh()) { for (const b of document.querySelectorAll('.xhsc-badge')) b.remove(); const pb = document.getElementById('xhsc-prof'); if (pb) pb.remove(); } } catch (e) { /* egal */ }
      try { await fickAll(); await ichPut(); await fickGalleryPics(); } catch (e) { recEvent('Fickliste nicht erreichbar', { info: String(e && e.message || e) }); }
    })();
    if (gm(K.oscan, null)) setTimeout(oscanRun, 3000);
    if (gm(K.scan, null)) setTimeout(scanTick, 2500);
    if (gm(K.act, null)) setTimeout(actTick, 2500);
    if (Date.now() - (gm('xh_accept', 0) || 0) < 120000) setTimeout(acceptPartner, 2500);
    const tick = () => { try { profileBox(); decorate(); flTab(); flButton(); } catch (e) { /* egal */ } };
    // Nutzer-Menü: entsteht erst beim Öffnen – sofort ergänzen
    try { new MutationObserver(() => { try { ddInsert(); } catch (e) { /* egal */ } }).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* egal */ }
    tick();
    flCheckHash();
    window.addEventListener('hashchange', flCheckHash);
    setInterval(tick, 1500);
    // Seitenwechsel ohne Neuladen: Stand der neuen Seite aufzeichnen
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; setTimeout(recPage, 2500); } }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true }); else onReady();

  // für Tests
  if (typeof W.__xhscTest === 'function') W.__xhscTest({ shrink, maskStr, maskUrl, pathPattern, ageOf, personOf, censorDiff, MSG_VARIANTS, popRules, classify, labelsOf, initialsOf, nextPageUrl, oscanPlan, fickFind, bridgePick, urlKey, peopleWalk, People, ruhrOf });
})();
