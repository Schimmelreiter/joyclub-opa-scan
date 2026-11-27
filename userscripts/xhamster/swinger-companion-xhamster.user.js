// ==UserScript==
// @name         Swinger Companion – xHamster
// @namespace    https://github.com/Schimmelreiter/swinger-companion
// @version      0.1.13
// @description  Swinger Companion für xHamster: Rekorder (Seitenaufbau und Anfragen sammeln), Scan-Lauf, Aktionstest, Export an Home Assistant, Profilkasten, Alters-Markierung in Dating-Suche und Freundschaftsanfragen
// @match        https://xhamster.com/*
// @match        https://*.xhamster.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=xhamster.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
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
  if (window.top !== window) return;
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const VER = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';
  const K = {
    rec: 'xh_rec', recOn: 'xh_rec_on', scan: 'xh_scan', act: 'xh_act', ha: 'xh_ha_url', partner: 'xh_partner',
    lists: 'xh_lists', opa: 'xh_opa', tests: 'xh_testmsgs',
  };
  const now = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gm = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (e) { return d; } };
  const gs = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* voll? */ } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
          const p = of.apply(this, arguments);
          p.then((res) => { try { res.clone().text().then((t) => recReq(method, url, body, res.status, t, res.headers.get('content-type'))).catch(() => {}); } catch (e) { /* egal */ } }).catch(() => {});
          return p;
        };
        nf.__xhRec = true;
        W.fetch = nf;
      }
    } catch (e) { /* egal */ }
    try {
      const XP = W.XMLHttpRequest.prototype;
      if (!XP.__xhRec) {
        const oo = XP.open, os = XP.send;
        XP.open = function (m, u) { this.__xhm = m; this.__xhu = String((u && u.href) || u || ''); return oo.apply(this, arguments); };
        XP.send = function (b) {
          const x = this;
          try {
            x.addEventListener('loadend', () => {
              try {
                const t = x.responseType === '' || x.responseType === 'text' ? x.responseText : x.responseType === 'json' ? JSON.stringify(x.response) : '';
                recReq(x.__xhm, x.__xhu, b, x.status, t, x.getResponseHeader('content-type'));
              } catch (e) { /* egal */ }
            });
          } catch (e) { /* egal */ }
          return os.apply(this, arguments);
        };
        XP.__xhRec = true;
      }
    } catch (e) { /* egal */ }
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
    box.querySelector('[data-a=stop]').onclick = () => { gs(K.scan, null); gs(K.act, null); uiStatus('Abgebrochen.'); };
    box.querySelector('[data-a=hide]').onclick = () => box.remove();
    document.body.appendChild(box);
    return box;
  }
  function uiStatus(t) { const b = uiBox(); if (b) b.querySelector('[data-s]').textContent = t; }
  function uiLog(t) {
    logLines.push(new Date().toLocaleTimeString() + ' ' + t);
    if (logLines.length > 60) logLines.shift();
    const b = (gm(K.scan, null) || gm(K.act, null)) ? uiBox() : box;
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
  // Anzeige auf den Seiten: Profilkasten, Alters-Markierung (Dating, Anfragen, Freunde, Blockierte)
  // =====================================================================
  const opa = () => Object.assign({ male: 60, female: 0, couple: 0, hide: false }, gm(K.opa, {}) || {});
  function opaSetup() {
    const o = opa();
    const v = prompt('Markieren ab Alter (0 = aus) für Männer, Frauen, Paare – z. B. 60,0,0:', `${o.male},${o.female},${o.couple}`);
    if (v == null) return;
    const [m, f, c] = v.split(/[,; ]+/).map((x) => Math.max(0, parseInt(x, 10) || 0));
    o.male = m || 0; o.female = f || 0; o.couple = c || 0;
    o.hide = confirm('Markierte ganz ausblenden? (Abbrechen = nur abdunkeln)');
    gs(K.opa, o);
  }
  function overLimit(p) {
    if (!p || p.age == null) return false;
    const o = opa();
    const lim = /couple/.test(p.gender) ? o.couple : /female/.test(p.gender) ? o.female : /male/.test(p.gender) ? o.male : 0;
    return lim > 0 && p.age >= lim;
  }
  function badgeHtml(p) {
    const bits = [];
    if (p.retired) bits.push('<b style="color:#ff7875">gelöscht</b>');
    if (p.age != null) bits.push(`${p.age} J.`);
    if (p.city) bits.push(esc(p.city));
    if (p.online) bits.push('<span style="color:#7bd88f">online</span>');
    const lists = gm(K.lists, {}) || {};
    if ((lists.friends || []).includes(p.id)) bits.push('<span style="color:#9ec5ff">Freund</span>');
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
    if (ch) gs(K.lists, lists);
  }
  function decorate() {
    const ini = initials() || {};
    const users = [].concat(ini.requestsUsersCollection || [], ((ini.datingListComponent || {}).users) || [], ini.friendsUsersCollection || [], ini.blockedUsersCollection || []);
    const byUrl = new Map(), byNick = new Map();
    for (const u of users) { const p = personOf(u); if (!p) continue; if (p.url) byUrl.set(p.url.toLowerCase(), p); if (p.nick) byNick.set(p.nick.toLowerCase(), p); }
    if (!byUrl.size && !byNick.size) return;
    const items = document.querySelectorAll('.item.friend, [class*="card"], [class*="Card"], li');
    for (const it of items) {
      if (it.querySelector('.xhsc-badge') || it.closest('#xhsc-box')) continue;
      const a = it.querySelector('a[href*="/users/"]');
      const r = it.querySelector('.retired');
      let p = null;
      if (a) p = byUrl.get(a.href.split(/[?#]/)[0].toLowerCase()) || null;
      if (!p && r) p = byNick.get(r.textContent.trim().toLowerCase()) || null;
      if (!p) continue;
      // nur die kleinste passende Karte schmücken
      if ([...it.querySelectorAll('.item.friend, [class*="card"], [class*="Card"], li')].some((c) => c.querySelector('a[href*="/users/"]'))) continue;
      const html = badgeHtml(p);
      if (!html) continue;
      const b = document.createElement('div');
      b.className = 'xhsc-badge';
      b.style.cssText = 'font:11.5px/1.3 system-ui,sans-serif;color:#ccc;margin-top:2px';
      b.innerHTML = html;
      (it.querySelector('.info') || it).appendChild(b);
      if (overLimit(p)) { if (opa().hide) it.style.display = 'none'; else { it.style.opacity = '.35'; it.title = `über der Altersgrenze (${p.age})`; } }
      if (p.retired) it.style.opacity = '.5';
    }
  }
  function profileBox() {
    if (!/^\/users\/[^/]+\/?$/.test(location.pathname) || document.getElementById('xhsc-prof')) return;
    const ini = initials() || {};
    const dm = ini.displayUserModel;
    const h = document.querySelector('.user-name');
    if (!dm || !h) return;
    const info = {};
    for (const r of document.querySelectorAll('.info-row')) {
      const l = r.querySelector('.label'), v = r.querySelector('.value');
      if (l && v) info[l.textContent.replace(/:\s*$/, '').trim()] = v.textContent.replace(/\s+/g, ' ').trim();
    }
    const age = (/(\d{1,3}) years old/.exec(info['I am'] || '') || [])[1];
    const c = ini.counters || {};
    const bits = [`#${dm.id}`];
    if (age) bits.push(age + ' J.');
    if (info.From) bits.push(esc(info.From));
    if (dm.currentUserRelation && dm.currentUserRelation !== 'none') bits.push(esc(dm.currentUserRelation));
    if (c.galleries != null) bits.push(`${c.galleries} Galerien`);
    if (c.videos != null) bits.push(`${c.videos} Videos`);
    if (info.Website) bits.push(`<a href="${esc(info.Website)}" target="_blank" rel="noopener" style="color:#9ec5ff">${esc(info.Website.replace(/^https?:\/\//, ''))}</a>`);
    const d = document.createElement('div');
    d.id = 'xhsc-prof';
    d.style.cssText = 'font:12.5px/1.4 system-ui,sans-serif;color:#ccc;margin:4px 0 6px';
    d.innerHTML = bits.join(' · ');
    h.after(d);
  }

  // =====================================================================
  // Start
  // =====================================================================
  hookNetwork();
  // 0.1.7: zuerst, damit es auch bei schnellem Neuladen erreichbar ist
  try { GM_registerMenuCommand('■ Scan-Lauf / Aktionstest anhalten', () => { gs(K.scan, null); gs(K.act, null); gs('xh_accept', 0); uiStatus('Angehalten.'); recEvent('Von Hand angehalten'); }); } catch (e) { /* egal */ }
  if (recGate()) try { GM_registerMenuCommand('Scan-Lauf starten', scanStart); } catch (e) { /* egal */ }
  if (recGate()) try { GM_registerMenuCommand('Aktionstest starten (mit Partnerkonto)', actStart); } catch (e) { /* egal */ }
  if (recGate()) try { GM_registerMenuCommand('Freundschaftsanfrage des Partners annehmen', acceptPartner); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand('Rekorder an Home Assistant senden', recToHa); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand('Rekorder exportieren (Datei)', recExportFile); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand(`Rekorder ${recOn() ? 'ausschalten' : 'einschalten'}`, () => { gs(K.recOn, !recOn()); alert('Rekorder ' + (recOn() ? 'an' : 'aus') + ' (gilt ab dem nächsten Laden).'); }); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand('Rekorder: Vorgabe wiederherstellen (nur Testkonten)', () => { GM_deleteValue(K.recOn); alert('Rekorder läuft jetzt nur für die Testkonten.'); }); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand('Rekorder leeren', () => { if (confirm('Alles Gesammelte löschen?')) { recBuf = null; GM_deleteValue(K.rec); } }); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand('Partnerkonto eintragen', () => { const v = prompt('Nick des Partnerkontos (leer = Vorgabe):', gm(K.partner, '') || partner()); if (v != null) gs(K.partner, v.trim()); }); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand('Altersgrenzen', opaSetup); } catch (e) { /* egal */ }
  try { GM_registerMenuCommand('Home-Assistant-Adresse eintragen', haSetup); } catch (e) { /* egal */ }

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
    if (gm(K.scan, null)) setTimeout(scanTick, 2500);
    if (gm(K.act, null)) setTimeout(actTick, 2500);
    if (Date.now() - (gm('xh_accept', 0) || 0) < 120000) setTimeout(acceptPartner, 2500);
    const tick = () => { try { profileBox(); decorate(); } catch (e) { /* egal */ } };
    tick();
    setInterval(tick, 1500);
    // Seitenwechsel ohne Neuladen: Stand der neuen Seite aufzeichnen
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; setTimeout(recPage, 2500); } }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true }); else onReady();

  // für Tests
  if (typeof W.__xhscTest === 'function') W.__xhscTest({ shrink, maskStr, maskUrl, pathPattern, ageOf, personOf, censorDiff, MSG_VARIANTS });
})();
