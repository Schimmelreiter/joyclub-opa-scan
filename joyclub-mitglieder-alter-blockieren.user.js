// ==UserScript==
// @name         JOYclub – Mitgliedersuche nach Alter ignorieren
// @namespace    local.joyclub-age-filter
// @version      1.92
// @description  Opa-Scan für JOYclub: Interaktionen, Profilbesucher, Partys, Gruppen und Mitgliedersuche nach Alter je Gruppe (Männer, Frauen, Paare) und Quelle durchsuchen und Treffer ignorieren; Einstellungsseite, Whitelist, Ignorierlisten-Limit, AWO-Faktor, Sicherung.
// @match        https://www.joyclub.de/*
// @match        https://identity.joyclub.com/*
// @match        https://www.poppen.de/*
// @match        https://poppen.de/*
// @match        https://schimmelreiter.github.io/joyclub-opa-scan/briefkasten.html*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=joyclub.de
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      image-user.feig-partner.de
// @connect      cfnimg.feig-partner.de
// @connect      www.google.com
// @connect      gstatic.com
// @connect      apiv2.joyclub.com
// @run-at       document-start
// @homepageURL  https://github.com/Schimmelreiter/joyclub-opa-scan
// @updateURL    https://raw.githubusercontent.com/Schimmelreiter/joyclub-opa-scan/main/joyclub-mitglieder-alter-blockieren.user.js
// @downloadURL  https://raw.githubusercontent.com/Schimmelreiter/joyclub-opa-scan/main/joyclub-mitglieder-alter-blockieren.user.js
// ==/UserScript==

(function () {
  'use strict';
  // ---------- Briefkasten: Abgleich mit dem Skript auf poppen.de (ab 1.90) ----------
  // Eine leere Seite ohne Code auf GitHub Pages wird unsichtbar eingebettet. Beide Skripte laufen darin und tauschen über
  // deren localStorage aus – die Seiten-Codes von JOYclub und poppen.de kommen an diesen Speicher nicht heran.
  // Seite ↔ eigenes iframe nur über den eigenen GM-Speicher (kein postMessage). Auf poppen.de ist das Skript passiv.
  const BK_URL = 'https://schimmelreiter.github.io/joyclub-opa-scan/briefkasten.html';
  const BK_HOST = 'schimmelreiter.github.io';
  const BK_ME = 'joyclub', BK_OTHER = 'poppen';
  const K_BK_OUT = 'jaf_bk_outbox';   // eigener Postausgang { v, platform, account, ts, items: [{ seq, ts, kind, data }] }
  const K_BK_SEQ = 'jaf_bk_seq';      // letzte vergebene seq
  const K_BK_ACK = 'jaf_bk_acked';    // höchste seq, die das poppen-Skript quittiert hat
  const K_BK_IN = 'jaf_bk_in';        // empfangene, noch nicht verarbeitete Einträge [{ seq, ts, kind, data, account }]
  const K_BK_INSEQ = 'jaf_bk_inseq';  // höchste übernommene seq des poppen-Skripts
  const K_BK_ALIVE = 'jaf_bk_alive';  // Lebenszeichen des iframes { ts, ls: Speicher nutzbar }
  const K_BK_PEER = 'jaf_bk_peer';    // Lebenszeichen des poppen-Skripts { ts, version, seen }
  const bkLs = (fn) => { try { return fn(window.localStorage); } catch (e) { return undefined; } };
  function bkFrameMain() {
    const gv = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch (e) { return d; } };
    const ok = bkLs((ls) => { ls.setItem('opa-bk:test', '1'); const r = ls.getItem('opa-bk:test') === '1'; ls.removeItem('opa-bk:test'); return r; }) === true;
    GM_setValue(K_BK_ALIVE, { ts: Date.now(), ls: ok });
    if (!ok) return;
    const ver = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';
    bkLs((ls) => ls.setItem(`opa-bk:hello:${BK_ME}`, JSON.stringify({ v: 1, ts: Date.now(), script: 'opa-scan', version: ver })));
    const ping = () => { try { window.dispatchEvent(new CustomEvent('opa-bk')); } catch (e) { /* egal */ } };
    const publish = () => {
      const ob = gv(K_BK_OUT, null);
      if (!ob) return;
      bkLs((ls) => ls.setItem(`opa-bk:out:${BK_ME}`, JSON.stringify(ob)));
      ping();
    };
    let busy = false;
    const read = () => {
      if (busy) return;
      busy = true;
      try {
        const peer = bkLs((ls) => ls.getItem(`opa-bk:hello:${BK_OTHER}`));
        if (peer) { try { const p = JSON.parse(peer); const o = gv(K_BK_PEER, {}) || {}; if (o.ts !== p.ts) GM_setValue(K_BK_PEER, Object.assign({}, p, { seen: Date.now() })); } catch (e) { /* egal */ } }
        const ack = +bkLs((ls) => ls.getItem(`opa-bk:ack:${BK_ME}`)) || 0;
        if (ack && ack !== gv(K_BK_ACK, 0)) GM_setValue(K_BK_ACK, ack);
        const raw = bkLs((ls) => ls.getItem(`opa-bk:out:${BK_OTHER}`));
        if (!raw) return;
        let ob; try { ob = JSON.parse(raw); } catch (e) { return; }
        const items = (ob && Array.isArray(ob.items) ? ob.items : []).filter((x) => x && Number.isFinite(+x.seq));
        if (!items.length) return;
        let last = +gv(K_BK_INSEQ, 0) || 0;
        const max = Math.max(...items.map((x) => +x.seq));
        if (max < last) last = 0; // Speicher drüben zurückgesetzt
        const fresh = items.filter((x) => +x.seq > last).sort((a, b) => a.seq - b.seq);
        if (fresh.length) {
          const inbox = gv(K_BK_IN, []) || [];
          for (const x of fresh) inbox.push(Object.assign({}, x, { account: ob.account || '', platform: ob.platform || BK_OTHER }));
          GM_setValue(K_BK_IN, inbox.slice(-500));
          GM_setValue(K_BK_INSEQ, max);
        }
        bkLs((ls) => ls.setItem(`opa-bk:ack:${BK_OTHER}`, String(max)));
      } finally { busy = false; }
    };
    try { GM_addValueChangeListener(K_BK_OUT, () => publish()); } catch (e) { /* egal */ }
    window.addEventListener('opa-bk', () => setTimeout(read, 50));
    window.addEventListener('storage', () => read());
    publish(); read();
    setInterval(() => { read(); GM_setValue(K_BK_ALIVE, { ts: Date.now(), ls: true }); }, 5000);
  }
  // Briefkasten in die besuchte Seite einbetten (nur im obersten Fenster, nur einmal je Tab)
  function bkEnsureFrame() {
    if (window.top !== window) return;
    setTimeout(() => {
      if (document.getElementById('opa-briefkasten') || !document.documentElement) return;
      const f = document.createElement('iframe');
      f.id = 'opa-briefkasten';
      f.src = `${BK_URL}#host=${location.hostname}`;
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;visibility:hidden';
      document.documentElement.appendChild(f);
    }, Math.floor(Math.random() * 1500));
  }
  if (location.hostname === BK_HOST) { if (window.top !== window && /\/briefkasten\.html$/.test(location.pathname)) bkFrameMain(); return; }
  if (/(^|\.)poppen\.de$/.test(location.hostname)) {
    // passiv: nur den Briefkasten einbetten – keine Oberfläche, keine Eingriffe, keine Aufrufe
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bkEnsureFrame, { once: true }); else bkEnsureFrame();
    return;
  }

  // ---------- API-Rekorder 2 (läuft ab Seitenstart: wenn eingeschaltet oder wenn eine Schnittstelle des Skripts 5× in Folge versagte) ----------
  // Je Adresse/Payload-Aufbau die ersten 2 Beispiele (Dauerläufer 1), Listen auf 2 Einträge + Gesamtzahl gekürzt.
  // Geschwärzt: E-Mail, Passwörter/Token/Schlüssel/Sitzungskennungen, Nachrichten- und Profiltexte, Telefonnummern, Geodaten bis auf die Stadt.
  // Zu jedem Aufruf: Seite, Titel, Seitenart, Auslöser (letzter Klick/Scrollen/Laden), Frame; dazu eine Zeitleiste.
  const K_API_REC = 'jaf_api_rec';   // an/aus
  const K_API_LOG = 'jaf_api_log';   // { key: { m, path, sig, op, n, first, last, poll, isNew, feat, ex: [{ ts, when, url, status, ctx, hdr, req, res }] } }
  const K_API_TL = 'jaf_api_tl';     // Zeitleiste [{ ts, t: 'seite'|'klick'|'aufruf', … }]
  const K_API_FB = 'jaf_api_fb';     // Rückfälle je Vorgang { feat: { n, last, err, rec: ts bis } }
  const API_MAX_KEYS = 800;
  const API_FB_LIMIT = 5;            // so viele Rückfälle in Folge → Aufrufe dieses Vorgangs wieder mitschneiden
  // Vorgänge des Skripts mit Schnittstelle → ihre Aufrufe (werden nur bei Rückfällen wieder erfasst)
  const API_FEAT_RE = {
    Ignorieren: /\/contact\/ignore$/,
    Notiz: /\/user_fav\/user_note$|\/profilev3\/save_note$/,
    Gästeliste: /\/event\/guests_scroll_data$/,
    ClubMail: /\/clubmailv3\/get_conversation_list$/,
    Mitgliedersuche: /^apiv2\.joyclub\.com\/members$/,
  };
  // bereits untersucht bzw. uninteressant → nicht mehr erfassen
  const API_SKIP_RE = [
    /^cfnimg\.joyclub\./, /^image-user\./, /\/smiley\//, /\/adsl\//, /\/newsbox\//, /\/frontend_vector_event\//, /\/support\/zendesk/, /\/notification\/auto_update/,
    /\/clubmailv3\/(clubmail_auto_update|get_latest_message_list_of_conversation|read_conversation|get_conversation_info|send_personal_message|switch_archive_conversation|reload_conversation|get_hint_list_for_message)$/,
    /\/my_joy\/(visits_likes_banner|features|messenger_contacts)$/, /\/geo\/suggestion\//, /\/profile\/beautify_text$/, /\/webauth\/access_token$/,
    /\/ajax\/contact_layer/, /^identity\.joyclub\.com\/authorize/,
  ];
  const API_SKIP_OPS = new Set(['ownClubmailUserSettings', 'getOwnClubMailUserSettings', 'isAuthorisationAllowed', 'getAchievementListByUserId', 'getAvatarByUserId', 'getGroupCount',
    'getMainAlbum', 'getProfileAlbumList', 'profileAlbumGetRegularAlbumByProfileAlbumId', 'profileAlbumGetUserImage', 'getProfileAlbumUserById', 'getProfileMainAlbumByUserId',
    'getFeedSettingsByUserId', 'getFriendFeedByUserId', 'getSeekingGenderList', 'getOwnCoinBalance', 'getReceivedComplimentsByUserId', 'getReceivedLikesByUserId', 'getMatchesByUserId',
    'getProfileVisitors', 'markGroupFeedAsRead', 'getGroupFeedByGroupId', 'getGroupFeedSubscriptionByGroupId', 'readMyJoyVisitors', 'readMyJoyReceivedLikes', 'getEventPaymentConfig']);
  const apiRedactKey = (k) => {
    const s = String(k).toLowerCase();
    if (/pass|token|secret|auth|session|csrf|xsrf|cookie|signature|apikey|api_key|bearer|credential|nonce|otp|cache_killer|jwt|registrationnumber|checkin/.test(s)) return 'Zugang';
    if (/mail/.test(s)) return 'E-Mail';
    if (/phone|telefon|mobile|handy|whatsapp|msisdn/.test(s)) return 'Telefon';
    if (/^(lat|lng|lon|long|latitude|longitude|geo|geolocation|coords?|coordinates|zip|zipcode|postal|postcode|plz|street|strasse|address|adresse|housenumber)$/.test(s)) return 'Geo';
    if (/^(text|message|messages|msg|body|content|preview|snippet|subject|description|about|aboutme|about_me|motto|teaser|profiletext|profile_text|bio|comment|note|notes|caption|html|user_note|alt_text|received_text)$/.test(s) || /message_content|profiletext|freetext|_msg$|nachricht|template_text|^name_of_template$/.test(s)) return 'Text';
    return '';
  };
  const apiJsonish = (s) => typeof s === 'string' && /^\s*[[{]/.test(s) && (() => { try { JSON.parse(s); return true; } catch (e) { return false; } })();
  function apiRedact(v, depth = 0, keyHint = '', key = '') {
    if (v == null) return v;
    if (typeof v === 'string') {
      if (key === 'query' && /^\s*(query|mutation|fragment)\b/.test(v)) return v.length > 20000 ? v.slice(0, 20000) + '…' : v; // GraphQL-Abfrage: vollständig
      if (apiJsonish(v) && keyHint !== 'Text' && keyHint !== 'Zugang') return { '(JSON)': apiRedact(JSON.parse(v), depth + 1, '', key) };
      if (keyHint) return `[${keyHint}]`;
      let s = v.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[E-Mail]').replace(/(?:\+|00)\d[\d\s/()-]{7,}\d|\b0\d{2,4}[\s/-]?\d{5,}\b/g, '[Telefon]');
      if (/^(Bearer |ey[A-Za-z0-9_-]{10,}\.)/.test(s)) s = '[Zugang]';
      return s.length > 300 ? `${s.slice(0, 160)}… (${s.length} Zeichen)` : s;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return keyHint && keyHint !== 'Text' ? `[${keyHint}]` : v;
    if (depth > 16) return '[…]';
    if (Array.isArray(v)) {
      const out = v.slice(0, 2).map((x) => apiRedact(x, depth + 1, keyHint, key));
      if (v.length > 2) out.push({ '…': `insgesamt ${v.length} Einträge` });
      return out;
    }
    if (typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = apiRedact(x, depth + 1, apiRedactKey(k) || (keyHint === 'Geo' ? 'Geo' : ''), k);
      return o;
    }
    return String(v);
  }
  const apiShape = (v, d = 0) => {
    if (v == null || typeof v !== 'object' || d > 3) return typeof v;
    if (Array.isArray(v)) return '[' + (v.length ? apiShape(v[0], d + 1) : '') + ']';
    return '{' + Object.keys(v).sort().map((k) => `${k}:${apiShape(v[k], d + 1)}`).join(',') + '}';
  };
  function apiPath(u) {
    let url;
    try { url = new URL(u, location.href); } catch (e) { return { path: String(u).slice(0, 200), qk: '', host: '', example: '' }; }
    const path = url.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid').replace(/\b[0-9a-f]{24,}\b/gi, ':hex').replace(/\d{3,}/g, ':id');
    const qk = [...url.searchParams.keys()].sort();
    const q = new URLSearchParams();
    for (const [k, x] of url.searchParams) q.append(k, apiRedactKey(k) ? `[${apiRedactKey(k)}]` : apiRedact(x));
    return { host: url.host, path, qk: qk.join(','), example: url.origin + url.pathname + (q.toString() ? '?' + q.toString() : '') };
  }
  // Request-Body → Objekt (Formulare: data-JSON wird zerlegt)
  function apiParseBody(b) {
    if (b == null) return null;
    const unJson = (o) => { for (const k of Object.keys(o)) if (apiJsonish(o[k])) o[k] = JSON.parse(o[k]); return o; };
    if (typeof b === 'string') {
      try { return JSON.parse(b); } catch (e) { /* weiter */ }
      if (/^[\w.%[\]-]+=/.test(b)) { const o = {}; for (const [k, x] of new URLSearchParams(b)) o[k] = x; return unJson(o); }
      return `(Text, ${b.length} Zeichen)`;
    }
    if (typeof FormData !== 'undefined' && b instanceof FormData) { const o = {}; for (const [k, x] of b.entries()) o[k] = typeof x === 'string' ? x : '(Datei)'; return unJson(o); }
    if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) { const o = {}; for (const [k, x] of b) o[k] = x; return unJson(o); }
    return `(${Object.prototype.toString.call(b).slice(8, -1)})`;
  }
  const apiHdrNames = (h) => {
    try {
      if (!h) return [];
      if (typeof Headers !== 'undefined' && h instanceof Headers) return [...h.keys()];
      if (Array.isArray(h)) return h.map((x) => x[0]);
      return Object.keys(h);
    } catch (e) { return []; }
  };
  // ---- Zusammenhang: Seite, Auslöser, Zeitleiste ----
  const apiLocal = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  function apiPageKind(p = location.pathname) {
    const L = [[/^\/profile\/\d+\./, 'Profil'], [/^\/my\/\d+\./, 'Profil'], [/^\/event\/\d+\./, 'Party-Seite'], [/^\/ignore/, 'Ignorierliste'], [/^\/clubmail/, 'ClubMail'],
      [/^\/my_joy\/visitors/, 'Profilbesuche'], [/^\/my_joy\/voting/, 'Mögen mich'], [/^\/kontakte/, 'Kontakte'], [/^\/gruppen?\/|^\/group/, 'Gruppe'], [/^\/dates_partys\/events\/registrations/, 'Eventanmeldungen'],
      [/^\/dates_partys/, 'Dates & Partys'], [/^\/(search|suche|mitglieder)/, 'Mitgliedersuche'], [/^\/edit\//, 'Profil verwalten'], [/^\/my_joy\/feed/, 'Startseite/Feed']];
    for (const [re, n] of L) if (re.test(p)) return n;
    return 'sonstige';
  }
  const apiCtx = { click: null, scroll: 0, load: Date.now() };
  const apiFrameName = () => { try { return window.top === window ? '' : (/^jaf-/.test(window.name || '') ? 'Hintergrund-Frame des Skripts' : 'Frame'); } catch (e) { return 'Frame'; } };
  function apiTrigger(now) {
    if (apiCtx.click && now - apiCtx.click.ts < 3000) return `Klick: ${apiCtx.click.label}`;
    if (now - apiCtx.scroll < 2000) return 'beim Scrollen';
    if (now - apiCtx.load < 6000) return 'beim Laden';
    return 'automatisch (z. B. Aktualisierung)';
  }
  const apiPageInfo = () => ({ page: location.pathname, title: (document.title || '').slice(0, 80), kind: apiPageKind(), frame: apiFrameName() });
  let apiTl = null;
  function apiTlAdd(e) { (apiTl = apiTl || []).push(Object.assign({ ts: Date.now(), when: apiLocal(Date.now()) }, e)); }
  let apiBuf = null;
  let apiFlushT = 0;
  function apiFlush() {
    apiFlushT = 0;
    if (apiBuf) {
      const log = GM_getValue(K_API_LOG, {}) || {};
      for (const [k, e] of Object.entries(apiBuf)) {
        const o = log[k];
        if (!o) { if (Object.keys(log).length < API_MAX_KEYS) log[k] = e; continue; }
        o.n += e.n; o.last = e.last;
        if (e.poll) o.poll = true;
        for (const x of e.ex) if (o.ex.length < (o.poll ? 1 : 2)) o.ex.push(x);
      }
      apiBuf = null;
      GM_setValue(K_API_LOG, log);
    }
    if (apiTl) {
      const tl = (GM_getValue(K_API_TL, []) || []).concat(apiTl).slice(-3000);
      apiTl = null;
      GM_setValue(K_API_TL, tl);
    }
  }
  const apiSched = () => { if (!apiFlushT) apiFlushT = setTimeout(apiFlush, 3000); };
  // aktive Erfassung: global an, oder Vorgang mit Rückfällen
  function apiRecState() {
    let on = false, forced = [];
    try {
      on = !!GM_getValue(K_API_REC, false);
      const fb = GM_getValue(K_API_FB, {}) || {};
      forced = Object.entries(fb).filter(([, x]) => x && x.rec && x.rec > Date.now()).map(([f]) => f);
    } catch (e) { /* egal */ }
    return { on, forced };
  }
  const API_STATE = apiRecState();
  function apiNote(method, url, reqBody, status, resBody, ctype, hdrs) {
    try {
      const p = apiPath(url);
      if (!/joyclub\.(de|com)$/.test(p.host)) return;
      if (/\.(js|css|png|jpe?g|gif|webp|svg|woff2?|ico|mp4)$/i.test(p.path)) return;
      // Dateien sind keine Schnittstellen; ganze Seiten nur bei GET – POST mit HTML-Antwort (z. B. Stornieren im Hintergrund) wird erfasst
      if (/image\/|font\/|css|javascript/i.test(ctype || '') || (/html/i.test(ctype || '') && !/^(POST|PUT|PATCH|DELETE)$/i.test(method))) return;
      const full = p.host + p.path;
      const feat = Object.keys(API_FEAT_RE).find((f) => API_FEAT_RE[f].test(full)) || '';
      const forced = feat && API_STATE.forced.includes(feat);
      if (!API_STATE.on && !forced) return;
      if (feat && !forced) return;                       // bekannt und funktioniert
      if (API_SKIP_RE.some((re) => re.test(full))) return;
      const req = apiParseBody(reqBody);
      const op = req && typeof req === 'object' && req.operationName ? req.operationName : '';
      if (op && API_SKIP_OPS.has(op)) return;
      const key = `${method.toUpperCase()} ${full}?${p.qk} ${op ? 'op=' + op + ' ' : ''}${apiShape(req)}`;
      apiBuf = apiBuf || {};
      const now = Date.now();
      // Dauerläufer: mind. 3 Aufrufe in gleichmäßigen Abständen (≥ 3 s) → nur ein Beispiel
      const known = (window.__jafApiSeen = window.__jafApiSeen || {});
      const tl = (known[key] = (known[key] || []).concat(now).slice(-3));
      const d1 = tl.length === 3 ? tl[1] - tl[0] : 0, d2 = tl.length === 3 ? tl[2] - tl[1] : 0;
      const poll = d1 >= 3000 && d2 >= 3000 && Math.abs(d1 - d2) <= Math.max(d1, d2) * 0.25;
      let e = apiBuf[key];
      if (!e) e = apiBuf[key] = { m: method.toUpperCase(), path: full, sig: apiShape(req), op, n: 0, first: now, last: now, poll: false, isNew: true, feat: forced ? feat : '', ex: [] };
      e.n++; e.last = now;
      if (poll) e.poll = true;
      const ctx = Object.assign(apiPageInfo(), { trigger: apiTrigger(now) });
      if (e.ex.length < (e.poll ? 1 : 2) && !poll) {
        let res = resBody;
        if (typeof res === 'string') { try { res = JSON.parse(res); } catch (x) { res = `(${ctype || 'Text'}, ${res.length} Zeichen)`; } }
        e.ex.push({ ts: now, when: apiLocal(now), url: p.example, status, ctx, hdr: (hdrs || []).map((h) => String(h).toLowerCase()), req: apiRedact(req), res: apiRedact(res) });
      }
      apiTlAdd({ t: 'aufruf', key: `${method.toUpperCase()} ${full}${op ? ' ' + op : ''}`, status, page: ctx.page, trigger: ctx.trigger, frame: ctx.frame });
      apiSched();
    } catch (err) { /* Rekorder darf nie stören */ }
  }
  // Kopfzeile x-requested-from, die JOYclub an seine Schnittstelle apiv2 schickt, für eigene Aufrufe merken (kein Geheimnis)
  (function api2Sniff() {
    try {
      const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const ex = (f) => { try { return typeof exportFunction === 'function' ? exportFunction(f, W) : f; } catch (e) { return f; } };
      const keep = (v) => { try { v = String(v || '').slice(0, 60); if (v && GM_getValue('jaf_api2_from', '') !== v) GM_setValue('jaf_api2_from', v); } catch (e) { /* egal */ } };
      const XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
      if (XP && !XP.__jafSniff) {
        const oh = XP.setRequestHeader;
        XP.setRequestHeader = ex(function (n, v) { if (/^x-requested-from$/i.test(String(n))) keep(v); return oh.apply(this, arguments); });
        XP.__jafSniff = true;
      }
      const of = W.fetch;
      if (typeof of === 'function' && !of.__jafSniff) {
        const nf = function (input, init) {
          try {
            const h = init && init.headers;
            if (h) { const v = typeof h.get === 'function' ? h.get('x-requested-from') : (h['x-requested-from'] || h['X-Requested-From']); if (v) keep(v); }
          } catch (e) { /* egal */ }
          return of.apply(this, arguments);
        };
        nf.__jafSniff = true;
        W.fetch = ex(nf);
      }
    } catch (e) { /* egal */ }
  })();
  (function apiHook() {
    if (!API_STATE.on && !API_STATE.forced.length) return;
    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    // Firefox: Funktionen für die Seite freigeben
    const ex = (f) => { try { return typeof exportFunction === 'function' ? exportFunction(f, W) : f; } catch (e) { return f; } };
    // Zusammenhang: Seitenaufruf, Klicks (nur Beschriftung), Scrollen
    try {
      document.addEventListener('DOMContentLoaded', () => { apiCtx.load = Date.now(); if (API_STATE.on) { apiTlAdd(Object.assign({ t: 'seite' }, apiPageInfo())); apiSched(); } }, { once: true });
      document.addEventListener('click', (ev) => {
        try {
          const path = ev.composedPath ? ev.composedPath() : [ev.target];
          const el = path.find((x) => x && x.nodeType === 1 && (/^(A|BUTTON|J-BUTTON|J-CONTROL-BUTTON|J-CONTEXT-MENU-ITEM|J-PILL|LABEL|SUMMARY)$/.test(x.tagName) || (x.getAttribute && x.getAttribute('role') === 'button'))) || path[0];
          if (!el || !el.getAttribute) return;
          if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|submit|button)$/i.test(el.type || '')) return;
          // Beschriftung: kurz und nur echter Text (keine JSON-Blöcke oder ganze Seitenbereiche)
          let tx = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (tx.length > 80 || /^[[{]/.test(tx)) tx = '';
          const lab = (el.getAttribute('aria-label') || el.getAttribute('title') || tx || el.tagName.toLowerCase()).slice(0, 60);
          apiCtx.click = { ts: Date.now(), label: lab };
          if (API_STATE.on) {
            // Ziel eines Links: Pfad und Namen der Parameter (Werte geschwärzt), Sprungmarken als „#…“
            const a = path.find((x) => x && x.nodeType === 1 && x.getAttribute && x.getAttribute('href'));
            const href = a ? a.getAttribute('href') : '';
            let ziel = '';
            if (href && /^#/.test(href)) ziel = href.slice(0, 60);
            else if (href && !/^javascript:/i.test(href)) { const q = apiPath(href); ziel = q.host ? `${q.host}${q.path}${q.qk ? '?' + q.qk : ''}` : ''; }
            apiTlAdd(Object.assign({ t: 'klick', label: lab }, ziel ? { ziel } : {}, apiPageInfo())); apiSched();
          }
        } catch (e) { /* egal */ }
      }, true);
      window.addEventListener('scroll', () => { apiCtx.scroll = Date.now(); }, true);
    } catch (e) { /* egal */ }
    // Formulare (Merken, Anmelden, Stornieren … laden die Seite neu): Ziel, Methode und Felder mitschreiben, Werte geschwärzt
    if (API_STATE.on) {
      const seenForm = new WeakSet();
      const noteForm = (f) => {
        try {
          if (!f || seenForm.has(f)) return;
          seenForm.add(f);
          setTimeout(() => seenForm.delete(f), 1500);
          const fields = new URLSearchParams();
          for (const [k, v] of new FormData(f).entries()) fields.append(k, typeof v === 'string' ? v : '(Datei)');
          const method = (f.getAttribute('method') || 'GET').toUpperCase();
          apiNote(`FORM-${method}`, f.getAttribute('action') || location.href, fields, 0, '(Seite wird neu geladen)', 'application/x-formular', []);
          apiFlush();
        } catch (e) { /* egal */ }
      };
      try {
        document.addEventListener('submit', (ev) => noteForm(ev.target), true);
        const FP = W.HTMLFormElement && W.HTMLFormElement.prototype;
        if (FP && !FP.__jafRec) {
          const os2 = FP.submit, ors = FP.requestSubmit;
          FP.submit = ex(function () { noteForm(this); return os2.apply(this, arguments); });
          if (typeof ors === 'function') FP.requestSubmit = ex(function () { noteForm(this); return ors.apply(this, arguments); });
          FP.__jafRec = true;
        }
      } catch (e) { /* egal */ }
    }
    try {
      const of = W.fetch;
      if (typeof of === 'function' && !of.__jafRec) {
        const nf = function (input, init) {
          const isReq = input && typeof input === 'object' && typeof input.url === 'string';
          const url = typeof input === 'string' ? input : (isReq ? input.url : String(input));
          const method = (init && init.method) || (isReq && input.method) || 'GET';
          const hdrs = apiHdrNames(init && init.headers).concat(isReq ? apiHdrNames(input.headers) : []);
          let bodyP = Promise.resolve(init && init.body);
          if (isReq && !(init && init.body) && !/^(GET|HEAD)$/i.test(method)) { try { bodyP = input.clone().text(); } catch (e) { /* egal */ } }
          const pr = of.apply(this, arguments);
          pr.then((r) => {
            const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
            const resP = /json/.test(ct) ? r.clone().text() : Promise.resolve(`(${ct || '?'})`);
            Promise.all([bodyP.catch(() => null), resP.catch(() => null)]).then(([b, t]) => apiNote(method, url, b, r.status, t, ct, hdrs));
          }).catch(() => {});
          return pr;
        };
        nf.__jafRec = true;
        W.fetch = ex(nf);
      }
      const XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
      if (XP && !XP.__jafRec) {
        const oo = XP.open, os = XP.send, oh = XP.setRequestHeader;
        XP.open = ex(function (m, u) { this.__jafM = m; this.__jafU = u; this.__jafH = []; return oo.apply(this, arguments); });
        XP.setRequestHeader = ex(function (n) { try { (this.__jafH = this.__jafH || []).push(n); } catch (e) { /* egal */ } return oh.apply(this, arguments); });
        XP.send = ex(function (b) {
          const x = this;
          try {
            x.addEventListener('load', () => {
              let t = null; const ct = x.getResponseHeader ? x.getResponseHeader('content-type') || '' : '';
              try { t = (x.responseType === '' || x.responseType === 'text') ? x.responseText : (x.responseType === 'json' ? JSON.stringify(x.response) : `(${x.responseType})`); } catch (e) { t = null; }
              apiNote(x.__jafM || 'GET', x.__jafU || '', b, x.status, /json/.test(ct) || x.responseType === 'json' ? t : `(${ct || '?'})`, ct, x.__jafH);
            });
          } catch (e) { /* egal */ }
          return os.apply(this, arguments);
        });
        XP.__jafRec = true;
      }
    } catch (e) { /* egal */ }
  })();

  // Alles Weitere erst, wenn das Dokument geparst ist (Skript startet wegen des Rekorders bei document-start)
  const __jafMain = () => {
  // ---------- Speicher ----------
  // Große Listen (Protokoll, Ignorierliste, Konten, Prüf-Cache, Vorgemerkte, Gedächtnis) liegen ab 1.74 als
  // EIN Tampermonkey-Wert JE MITGLIED („jaf_log|/profile/…“) statt als ein riesiger Wert. Der Rest des Skripts
  // sieht weiter ganze Listen: gmGet liefert die Liste, gmSet schreibt nur geänderte Einträge.
  // Andere Tabs erfahren über „<name>#v“, welche Einträge sich geändert haben.
  const BIG_KEYS = ['jaf_log', 'jaf_ignored', 'jaf_accounts', 'jaf_checked', 'jaf_watch', 'jaf_mem'];
  const K_STORE_V = 'jaf_store_v2'; // Namen der bereits umgebauten Listen
  const STORE_TAB = Math.random().toString(36).slice(2, 9);
  const hasListen = typeof GM_addValueChangeListener === 'function';
  const BIG = {};
  const storeMigrated = (name) => (GM_getValue(K_STORE_V, []) || []).includes(name);
  function bigLoad(name) {
    let st = BIG[name];
    if (st && st.loaded) return st;
    st = BIG[name] = st || { loaded: false, strs: new Map(), legacy: false };
    st.strs.clear();
    st.legacy = !storeMigrated(name);
    if (st.legacy) {
      const o = GM_getValue(name, null);
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) st.strs.set(k, JSON.stringify(v));
    } else {
      const pre = name + '|';
      for (const k of GM_listValues()) if (k.startsWith(pre)) { const v = GM_getValue(k); if (v !== undefined) st.strs.set(k.slice(pre.length), JSON.stringify(v)); }
    }
    st.loaded = true;
    if (!st.listen && hasListen) {
      st.listen = true;
      GM_addValueChangeListener(name + '#v', (k, o, n, remote) => {
        if (!remote || !BIG[name].loaded) return;
        const s2 = BIG[name];
        if (n && Array.isArray(n.keys) && !s2.legacy) {
          for (const x of n.keys) { const v = GM_getValue(name + '|' + x); if (v === undefined) s2.strs.delete(x); else s2.strs.set(x, JSON.stringify(v)); }
        } else s2.loaded = false;
      });
    }
    return st;
  }
  function bigGet(name, d) {
    const st = bigLoad(name);
    if (!st.strs.size) return d === undefined || d === null ? (d === null ? null : {}) : d;
    const o = {};
    for (const [k, v] of st.strs) o[k] = JSON.parse(v);
    return o;
  }
  function bigSet(name, m) {
    const st = bigLoad(name);
    m = m || {};
    const changed = [];
    if (st.legacy) {
      GM_setValue(name, m);
      st.strs.clear();
      for (const [k, v] of Object.entries(m)) st.strs.set(k, JSON.stringify(v));
    } else {
      for (const [k, v] of Object.entries(m)) {
        if (v === undefined) continue;
        const s2 = JSON.stringify(v);
        if (st.strs.get(k) !== s2) { GM_setValue(name + '|' + k, v); st.strs.set(k, s2); changed.push(k); }
      }
      for (const k of [...st.strs.keys()]) if (!(k in m) || m[k] === undefined) { GM_deleteValue(name + '|' + k); st.strs.delete(k); changed.push(k); }
      if (!changed.length) return;
    }
    GM_setValue(name + '#v', { ts: Date.now(), tab: STORE_TAB, keys: st.legacy || changed.length > 300 ? null : changed });
  }
  // einzelne Einträge (ohne die ganze Liste zu bauen)
  function bigGet1(name, key) { const v = bigLoad(name).strs.get(key); return v === undefined ? undefined : JSON.parse(v); }
  function bigSet1(name, key, v) {
    const st = bigLoad(name);
    if (st.legacy) { const m = bigGet(name, {}); if (v === undefined) delete m[key]; else m[key] = v; bigSet(name, m); return; }
    const s2 = v === undefined ? undefined : JSON.stringify(v);
    if (st.strs.get(key) === s2) return;
    if (v === undefined) { GM_deleteValue(name + '|' + key); st.strs.delete(key); } else { GM_setValue(name + '|' + key, v); st.strs.set(key, s2); }
    GM_setValue(name + '#v', { ts: Date.now(), tab: STORE_TAB, keys: [key] });
  }
  const gmGet = (k, d) => (BIG_KEYS.includes(k) ? bigGet(k, d) : GM_getValue(k, d));
  const gmSet = (k, v) => (BIG_KEYS.includes(k) ? bigSet(k, v) : GM_setValue(k, v));
  if (hasListen) GM_addValueChangeListener(K_STORE_V, (k, o, n, remote) => { if (remote) for (const x of Object.keys(BIG)) BIG[x].loaded = false; });
  // Umbau alter Einzelwerte → ein Wert je Mitglied; alte Daten bleiben, bis jeder Eintrag geprüft ist
  function storeNeedsMigration() { return BIG_KEYS.some((n) => !storeMigrated(n) && GM_getValue(n, null)); }
  function migrateStores() {
    const res = { ok: [], failed: [] };
    for (const name of BIG_KEYS) {
      if (storeMigrated(name)) continue;
      const o = GM_getValue(name, null);
      const done = () => { const l = GM_getValue(K_STORE_V, []) || []; if (!l.includes(name)) GM_setValue(K_STORE_V, l.concat(name)); };
      if (!o || typeof o !== 'object') { done(); continue; }
      const keys = Object.keys(o);
      for (const k of keys) GM_setValue(name + '|' + k, o[k]);
      const bad = keys.filter((k) => JSON.stringify(GM_getValue(name + '|' + k)) !== JSON.stringify(o[k]));
      if (bad.length) { for (const k of keys) GM_deleteValue(name + '|' + k); res.failed.push(name); continue; }
      done();
      GM_deleteValue(name);
      res.ok.push(`${name}: ${keys.length}`);
      if (BIG[name]) BIG[name].loaded = false;
    }
    return res;
  }

  // ---------- Login-Seite (identity.joyclub.com): „Angemeldet bleiben“ setzen, nur mit vom Browser ausgefüllten Feldern klicken,
  // automatisch höchstens 1× je 30 min (gemeinsam mit dem Login aus einem laufenden Scan) ----------
  if (location.hostname === 'identity.joyclub.com') {
    (async () => {
      if (!/\/ui\/login\//.test(location.pathname)) return;
      const K = 'jaf_login_pending';
      const p = gmGet(K, null);
      const scripted = !!(p && p.auto && !p.tried && Date.now() - p.ts <= 5 * 60000);
      const last = GM_getValue('jaf_login_try', 0) || 0;
      if (!scripted && Date.now() - last < 30 * 60000) return;
      const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      const q = (sel) => document.querySelector(sel);
      const report = (msg) => { if (scripted) gmSet('jaf_login_result', { token: p.token, ok: false, msg, ts: Date.now() }); };
      const hint = (msg) => {
        if (document.getElementById('jaf-login-hint')) return;
        const b = document.createElement('div');
        b.id = 'jaf-login-hint';
        b.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;background:#3a2a10;border:1px solid #ffb300;color:#fff;border-radius:8px;padding:10px 16px;font:14px system-ui;box-shadow:0 6px 18px rgba(0,0,0,.5);max-width:90vw';
        b.textContent = msg;
        document.body.appendChild(b);
      };
      const auto = (el) => { try { return el.matches(':autofill'); } catch (e) { try { return el.matches(':-webkit-autofill'); } catch (e2) { return false; } } };
      const filled = (el) => !!el && (!!el.value || auto(el));
      let user = null, pw = null;
      for (let i = 0; i < 40 && !(user && pw); i++) { user = q('[data-e2e="input-username"] input') || q('input[autocomplete="username"]'); pw = q('[data-e2e="input-password"] input[type="password"]') || q('input[autocomplete="current-password"]'); if (!(user && pw)) await sl(500); }
      if (!user || !pw) { report('Login-Formular nicht gefunden'); return; }
      for (let i = 0; i < 20 && !(filled(user) && filled(pw)); i++) await sl(500); // Passwort-Manager füllen lassen
      if (!filled(user) || !filled(pw)) { report('Benutzername/Passwort nicht ausgefüllt'); return; }
      GM_setValue('jaf_login_try', Date.now());
      if (scripted) gmSet(K, Object.assign({}, p, { tried: Date.now() }));
      const cb = q('[data-e2e="checkbox-autologin"] input[type="checkbox"]') || q('input[type="checkbox"][aria-label="Angemeldet bleiben"]');
      if (cb && !cb.checked) { cb.click(); await sl(300); }
      // Cloudflare-Prüfung (Turnstile) abwarten, falls vorhanden
      for (let i = 0; i < 60; i++) { const t = q('input[name="cf-turnstile-response"]'); if (!t || t.value) break; await sl(500); }
      const btn = q('j-button[data-e2e="button-submit"]');
      const inner = btn && btn.shadowRoot && btn.shadowRoot.querySelector('button');
      if (inner) inner.click(); else if (btn) btn.click(); else { report('Login-Button nicht gefunden'); return; }
      await sl(20000);
      if (location.hostname === 'identity.joyclub.com' && /\/ui\/login\//.test(location.pathname)) {
        report('Login nicht abgeschlossen (z. B. Cloudflare-Prüfung oder falsche Daten)');
        hint('Opa-Scan: Bitte einmal selbst auf „Login“ klicken – der Browser gibt gespeicherte Passwörter oft erst nach einem Klick frei.');
      }
    })();
    return;
  }
  // In Frames läuft das Skript nur als Hintergrund-Lader (unsichtbarer Frame für Gästelisten), sonst gar nicht.
  const IN_FRAME = window.top !== window;
  const BG_FRAME = IN_FRAME && /^jaf-bg-/.test(window.name || '');
  if (IN_FRAME && !BG_FRAME) return;
  // im Hintergrund-Frame keine Dauer-Timer (Markieren, Wächter …)
  const setInterval = BG_FRAME ? (() => 0) : globalThis.setInterval.bind(globalThis);

  // ===================== EINSTELLUNGEN =====================
  const CONFIG = {
    DRY_RUN: false,         // true = Testmodus: spielt alles durch, ignoriert aber niemanden (klickt „Abbrechen“)
    DEBUG: false,
    IGNORE_LIMIT: 1000,     // JOYclub behält nur so viele Sperren (die ältesten fallen sonst still heraus)
    MYJOY_FIRST_MAX: 1000,  // Profilbesucher / „Mögen mich“: beim ersten Scan höchstens so viele Karten
    // Rangfolge der Quellen (höchste zuerst): eine höhere Quelle ersetzt eine niedrigere, nie umgekehrt
    SOURCE_RANK: ['Likes', 'Besucher', 'Party', 'Gruppen', 'Suche', 'Sync'],

    // ---- Regeln je Gruppe (Männer m, Frauen f, Paare p) und Quelle ----
    // visual: Farben, Umbenennen, eigene Reiter · ignore: Treffer sperren (mit Notiz, rotes X)
    // names: Bezeichnungen der drei Altersstufen (Einzahl/Mehrzahl) · types: zugeordnete Profiltypen
    // src: je Quelle [Stufe 1 bis, Stufe 2 bis, ignorieren ab]; bei Paaren je { f: [...], m: [...] } (Frau/Mann)
    // Paare werden ignoriert, wenn BEIDE ihre Schwelle erreichen; split = Frau und Mann getrennt einstellen
    GROUPS: {
      m: { visual: false, ignore: false,
        names: { one: ['Mann', 'Mann', 'Opa'], many: ['Männer', 'Männer', 'Opas'] },
        types: ['Mann', 'Transmann', 'Transvestit', 'Non-binary', 'Männer-Paar'],
        src: { Likes: [29, 49, 50], Besucher: [29, 49, 50], Party: [29, 49, 50], Gruppen: [29, 49, 50], Suche: [29, 49, 100] } },
      f: { visual: false, ignore: false,
        names: { one: ['Frau', 'Frau', 'Oma'], many: ['Frauen', 'Frauen', 'Omas'] },
        types: ['Frau'],
        src: { Likes: [25, 49, 50], Besucher: [25, 49, 50], Party: [25, 49, 50], Gruppen: [25, 49, 50], Suche: [25, 49, 100] } },
      p: { visual: false, ignore: false, split: false,
        names: { one: ['Pärchen', 'Paar', 'Geronto-Paar'], many: ['Pärchen', 'Paare', 'Geronto-Paare'] },
        types: ['Paar'],
        src: { Likes: { f: [39, 59, 60], m: [39, 59, 60] }, Besucher: { f: [39, 59, 60], m: [39, 59, 60] }, Party: { f: [39, 59, 60], m: [39, 59, 60] },
          Gruppen: { f: [39, 59, 60], m: [39, 59, 60] }, Suche: { f: [39, 59, 100], m: [39, 59, 100] } },
        sd: { on: true, gap: 18 },   // Sugar Daddy: Mann mindestens gap Jahre älter als die Frau
        sm: { on: true, gap: 18 } }, // Sugar Mom: Frau mindestens gap Jahre älter als der Mann
    },
    // ---- AWO-Faktor: erwartete Anwesenheit je Gruppe und Altersstufe (%), Gewichtung der Gruppen (%) ----
    AWO: { quota: { m: [33, 66, 95], f: [95, 95, 95], p: [90, 90, 90] }, weight: { m: 67, f: 0, p: 33 } },

    // Werden NIE blockiert (Groß-/Kleinschreibung egal). Fest eingetragen; dazu kommen automatisch
    // gefundene Einträge (z. B. Gruppen-Moderatoren aus dem Opa-Scan), die im Tampermonkey-Speicher liegen.
    // Nach Begründung geordnet: neue Namen einfach in die passende Gruppe schreiben (oder eine neue Gruppe anlegen).
    WHITELIST: {
      'Veranstalter': [
        'dreamys_hh',
        'Erosaeon',
        'F_Store_Fashion',
        'FARO8',
        'JR_Relax',
        'kai2hai',
        'KAI_Partys',
        'kaihai',
        'perami',
        'Zerberux',
      ],
      'DJ': [
        'DJ_Blue_White',
        'Dj_Cherry',
        'DJ_Olli',
        'Jenz_Im_Glueck',
        'Sintouch',
      ],
      'Party': [
        'geneti',
        'Hengist',
        'Kaepten_Kikki',
        'TeufelGespielin',
        'Tritron',
      ],
      'manuell eingetragen': [
        'Wildschwein_AC',
      ],
      'Freundesliste (Stand 19.10.2026)': [
        'Goofy6767',
        'Goofy_6767',
        'here69',
        'Kleinerotesuese',
        'Klio_79',
        'MD1989',
        'Rumtreiber1993',
        'SxxxH',
        'Tr3ntn4rm',
      ],
      'Freundesliste von Wildschwein_AC (Stand 19.10.2026)': [
        'Absolution',
        'Apfeleis',
        'BlackAshSoul',
        'DirtyDxxx',
        'HerrUndKueken',
        'loewin95',
        'Nita72',
        'Sariy',
        'SizeQueenAC',
        'Spinnchen',
      ],
    },

    // Umkreis-Suche: Städte, deren Umkreise (AREA_RADIUS_KM) zusammen ganz Deutschland abdecken.
    // Gruppiert nach Bundesland in dieser Reihenfolge; jede Gruppe deckt ihr Bundesland (zusammen mit den
    // Gruppen davor) zu 100 % ab. Städte aus Nachbarländern, deren Umkreis hineinreicht, stehen mit Länderkürzel
    // in der Gruppe. Hamburg und Bremen sind über Niedersachsen abgedeckt.
    // Eintrag: [Stadt, Breitengrad, Längengrad, Bundesland-Kürzel, GeoNames-ID = JOYclub-Orts-ID ohne „x“]
    AREA_RADIUS_KM: 50,
    AREAS: {
      'Nordrhein-Westfalen': [
        ['Rheine', 52.2851, 7.4405, 'NW', 2847645],
        ['Bocholt', 51.8388, 6.6153, 'NW', 2947421],
        ['Essen', 51.4566, 7.0123, 'NW', 2928810],
        ['Olpe', 51.0290, 7.8514, 'NW', 2857306],
        ['Euskirchen', 50.6606, 6.7872, 'NW', 2928396],
        ['Biedenkopf', 50.9113, 8.5302, 'HE', 2949229],
        ['Soest', 51.5756, 8.1062, 'NW', 2831708],
        ['Bad Driburg', 51.7330, 9.0197, 'NW', 2953525],
        ['Lübbecke', 52.3070, 8.6142, 'NW', 2875626],
        ['Heinsberg', 51.0636, 6.0998, 'NW', 2907201],
      ],
      'Rheinland-Pfalz': [
        ['Trier', 49.7557, 6.6394, 'RP', 2821164],
        ['Limburg', 50.3836, 8.0503, 'HE', 2877648],
        ['Bad Kreuznach', 49.8414, 7.8671, 'RP', 2953416],
        ['Pirmasens', 49.2015, 7.6053, 'RP', 2853574],
        ['Mannheim', 49.4891, 8.4669, 'BW', 2873891],
        ['Daun', 50.1972, 6.8294, 'RP', 2938714],
      ],
      'Niedersachsen / Hamburg / Bremen': [
        ['Cuxhaven', 53.8683, 8.6990, 'NI', 2939658],
        ['Aurich', 53.4692, 7.4823, 'NI', 2954006],
        ['Uelzen', 52.9657, 10.5611, 'NI', 2820456],
        ['Verden', 52.9234, 9.2349, 'NI', 2817599],
        ['Cloppenburg', 52.8475, 8.0450, 'NI', 2939969],
        ['Meppen', 52.6906, 7.2910, 'NI', 2871845],
        ['Hannover', 52.3705, 9.7332, 'NI', 2910831],
        ['Northeim', 51.7066, 10.0000, 'NI', 2861814],
        ['Brake', 53.3333, 8.4833, 'NI', 2945545],
        ['Buxtehude', 53.4672, 9.6864, 'NI', 2940451],
        ['Dannenberg', 53.0967, 11.0900, 'NI', 2938991],
        ['Helmstedt', 52.2279, 11.0099, 'NI', 2906676],
      ],
      'Hessen': [
        ['Kassel', 51.3167, 9.5000, 'HE', 2892518],
        ['Fulda', 50.5516, 9.6752, 'HE', 2923822],
        ['Wertheim', 49.7590, 9.5085, 'BW', 2810716],
        ['Gotha', 50.9482, 10.7019, 'TH', 2918752],
        ['Friedberg', 50.3374, 8.7559, 'HE', 2924802],
      ],
      'Saarland': [
        ['Merzig', 49.4433, 6.6387, 'SL', 2871675],
      ],
      'Thüringen': [
        ['Gera', 50.8803, 12.0819, 'TH', 2921232],
        ['Saalfeld', 50.6483, 11.3654, 'TH', 2842688],
        ['Coburg', 50.2594, 10.9638, 'BY', 2939951],
        ['Sondershausen', 51.3697, 10.8701, 'TH', 2831276],
      ],
      'Schleswig-Holstein': [
        ['Heide', 54.1958, 9.0988, 'SH', 2908032],
        ['Bad Segeberg', 53.9431, 10.3021, 'SH', 2953341],
        ['Hagenow', 53.4313, 11.1916, 'MV', 2912481],
        ['Eckernförde', 54.4685, 9.8382, 'SH', 2933627],
        ['Fehmarn', 54.4378, 11.1935, 'SH', 8051091],
        ['Niebüll', 54.7866, 8.8285, 'SH', 2863696],
      ],
      'Baden-Württemberg': [
        ['Freiburg', 47.9959, 7.8522, 'BW', 2925177],
        ['Ravensburg', 47.7820, 9.6106, 'BW', 2849802],
        ['Freudenstadt', 48.4669, 8.4137, 'BW', 2924894],
        ['Schwäbisch Hall', 49.1113, 9.7391, 'BW', 2835481],
        ['Günzburg', 48.4560, 10.2769, 'BY', 2913555],
        ['Bruchsal', 49.1243, 8.5980, 'BW', 2943560],
        ['Singen', 47.7593, 8.8403, 'BW', 2831924],
        ['Reutlingen', 48.4914, 9.2043, 'BW', 2847736],
      ],
      'Bayern': [
        ['Kaufbeuren', 47.8824, 10.6219, 'BY', 2892080],
        ['Augsburg', 48.3715, 10.8985, 'BY', 2954172],
        ['Garmisch-Partenkirchen', 47.4921, 11.0958, 'BY', 2922530],
        ['Traunstein', 47.8683, 12.6433, 'BY', 2821515],
        ['Cham', 49.2257, 12.6550, 'BY', 2940204],
        ['Ansbach', 49.3048, 10.5931, 'BY', 2955936],
        ['Amberg', 49.4429, 11.8627, 'BY', 2956656],
        ['Bamberg', 49.8987, 10.9007, 'BY', 2952984],
        ['Schweinfurt', 50.0494, 10.2218, 'BY', 2834498],
        ['Marktredwitz', 50.0044, 12.0859, 'BY', 2873289],
        ['Freyung', 48.8095, 13.5477, 'BY', 2924850],
        ['Pfarrkirchen', 48.4320, 12.9381, 'BY', 2854179],
        ['Erding', 48.3060, 11.9069, 'BY', 2929715],
        ['Miesbach', 47.7890, 11.8338, 'BY', 2871198],
        ['Eichstätt', 48.8885, 11.1967, 'BY', 2932069],
        ['Kelheim', 48.9173, 11.8862, 'BY', 2891834],
      ],
      'Berlin': [
        ['Berlin', 52.5244, 13.4105, 'BE', 2950159],
      ],
      'Brandenburg': [
        ['Schwedt', 53.0596, 14.2815, 'BB', 2834629],
        ['Frankfurt (Oder)', 52.3471, 14.5506, 'BB', 2925535],
        ['Lübben', 51.9381, 13.8883, 'BB', 2875625],
        ['Wittenberg', 51.8661, 12.6497, 'ST', 7303020],
        ['Riesa', 51.3078, 13.2917, 'SN', 2846939],
        ['Pritzwalk', 53.1495, 12.1740, 'BB', 2851962],
        ['Rathenow', 52.6066, 12.3370, 'BB', 2850213],
        ['Templin', 53.1187, 13.5022, 'BB', 2823533],
        ['Weißwasser', 51.5040, 14.6402, 'SN', 2811698],
      ],
      'Sachsen': [
        ['Halle', 51.4816, 11.9795, 'ST', 2911522],
        ['Bautzen', 51.1803, 14.4349, 'SN', 2951881],
        ['Freiberg', 50.9109, 13.3388, 'SN', 2925192],
        ['Aue', 50.5903, 12.7066, 'SN', 2954695],
      ],
      'Sachsen-Anhalt': [
        ['Stendal', 52.6069, 11.8587, 'ST', 2827479],
        ['Magdeburg', 52.1277, 11.6292, 'ST', 2874545],
      ],
      'Mecklenburg-Vorpommern': [
        ['Rostock', 54.0887, 12.1405, 'MV', 2844588],
        ['Stralsund', 54.3091, 13.0818, 'MV', 2826287],
        ['Greifswald', 54.0931, 13.3879, 'MV', 2917788],
        ['Schwerin', 53.6294, 11.4132, 'MV', 2834282],
        ['Waren (Müritz)', 53.5204, 12.6799, 'MV', 2814131],
        ['Ueckermünde', 53.7379, 14.0447, 'MV', 2820471],
      ],
    },

    TEST_MAX_PROFILES: 3,   // im Testmodus höchstens so viele Profile, dann zurück zur Suche
    DEBUG_PAUSE_MS: 1200,

    MAX_PER_RUN: 1000,      // höchstens so viele Profile pro Durchlauf
    // Nachladen endet, wenn „Mehr Ergebnisse“ verschwindet ODER MAX_PER_RUN neue Treffer gefunden sind
    LOAD_MORE_SELECTOR: 'j-button[data-e2e="load-more-button"]',
    LOAD_MORE_TEXTS: ['mehr ergebnisse'],
    SCROLL_IDLE_ROUNDS: 3,  // so oft ohne neue Karten (und ohne „Mehr Ergebnisse“) → Liste ist zu Ende
    SCROLL_WAIT_MS: 8000,   // nach dem Scrollen so lange auf nachgeladene Treffer warten

    DELAY_MIN_MS: 4000,     // Pause zwischen zwei Profilen (zufällig)
    DELAY_MAX_MS: 9000,

    // Wie ignoriert wird:
    //  'ignoreliste' = über https://www.joyclub.de/ignore/ (Name eintragen → „Mitglied sperren“), keine Notiz möglich
    //  'profil'      = über die Profilseite (⋮ → „Profil ignorieren“) inkl. Profilnotiz
    IGNORE_METHOD: 'profil',
    IGNORE_PAGE_PATH: '/ignore',
    IGNORE_DELAY_MIN_MS: 2500,  // Pause zwischen zwei Namen auf der Ignorierliste
    IGNORE_DELAY_MAX_MS: 5000,
    IGNORE_SYNC_MIN: 10,        // echte Ignorierliste höchstens alle x Minuten im Hintergrund abgleichen

    WRITE_NOTE: true,       // Profilnotiz hinterlegen und mit „Speichern“ sichern – immer VOR dem Ignorieren
    NOTE_REQUIRED: true,    // true = ohne gespeicherte Notiz wird das Profil NICHT ignoriert
    // {art} = Bezeichnung der Stufe 3 (z. B. „Opa“, „Oma“, „Geronto-Paar“) bzw. „Sugar Daddy“ / „Sugar Mom“; {quelle} = z. B. „Party“
    NOTE_TEXT: '{art} ({quelle}) ignoriert am {datum} um {uhrzeit}',

    LIST_PAGES: [
      // wird vom Opa-Scan im Hintergrund gelesen (keine eigene Bedienoberfläche)
      { path: '/groups/*/mitglieder', name: 'Gruppen-Mitgliederliste', source: 'Gruppen', background: true },
      // Gästeliste einer Party (Opa-Scan auf der Seite „Eventanmeldungen“ des eigenen Profils)
      { path: '/event/*', name: 'Party-Gästeliste', source: 'Party', background: true },
    ],

    // ---- Opa-Scan (Gruppen) ----
    GROUPS_PATH: '/groups',
    GROUP_PAGE_DELAY_MIN_MS: 1500, // Pause zwischen zwei Seiten einer Mitgliederliste
    GROUP_PAGE_DELAY_MAX_MS: 3500,
    GROUP_DELAY_MIN_MS: 3000,      // Pause zwischen zwei Gruppen
    GROUP_DELAY_MAX_MS: 6000,
    // Filter der Gruppen-Mitgliederliste: welche Häkchen (w/m/p/d) zu welchem Profiltyp gehören.
    // Transmann/Transvestit: Kategorie unbekannt → sicherheitshalber Männer UND Non-binary.
    GROUP_GENDER_FILTER: {
      'Mann': ['m'], 'Transmann': ['m', 'd'], 'Transvestit': ['m', 'd'], 'Non-binary': ['d'],
      'Männer-Paar': ['p'], 'Paar': ['p'], 'Frauen-Paar': ['p'], 'Frau': ['w'], 'Transfrau': ['w', 'd'],
    },
    OPA_IGNORE_METHOD: 'profil',
    // ---- Opa-Scan (Partys) ----
    EVENT_PAGE_RE: /^\/event\/(\d+)\.[^/]+\.html$/i,
    APPOINTMENTS_RE: /^\/profile\/appointments\/(\d+)\.[^/]+\.html$/i,
    // zweite Übersicht der eigenen Eventanmeldungen (lädt beim Scrollen nach)
    REGISTRATIONS_RE: /^\/dates_partys\/events\/registrations\/?$/i,
    REG_LOAD_MAX_ROUNDS: 40,
    EVENT_DELAY_MIN_MS: 3000,      // Pause zwischen zwei Partys
    EVENT_DELAY_MAX_MS: 6000,
    PARTY_NOTE_TEXT: 'Whitelist: Party "{party}" am {datum}',
    VIP_REASON: 'VIP-Gast',
    ORGANIZER_REASON: 'Veranstalter',
    ORGANIZER_NOTE_TEXT: 'Whitelist: Veranstalter von "{party}"',
    PARTY_REASON: 'Party',
    SEARCH_NOTE_TEXT: 'Whitelist: Suche am {datum}',  // „Nicht mehr ignorieren“ in der Mitgliedersuche
    SEARCH_REASON: 'Suche',
    VISIT_NOTE_TEXT: 'Whitelist: Profilbesucher am {datum}',  // „Nicht mehr ignorieren“ auf „Profilbesuche“
    VISIT_REASON: 'Profilbesucher',
    LIKE_NOTE_TEXT: 'Whitelist: Interaktion am {datum}',      // „Nicht mehr ignorieren“ auf „Mögen mich“
    LIKE_REASON: 'Interaktion',
    FRIEND_REASON: 'Freund',                 // automatische Whitelist: Freunde (/kontakte/friendship.html)
    KNOWN_REASON: 'persönlich bekannt',      // automatische Whitelist: Kontakte mit „Persönlich bekannt“
    MOD_NOTE_TEXT: 'Whitelist: Moderator der Gruppe "{gruppe}"',
    PROFILE_PATH_RE: /^\/profile\/\d+\.[^/]+\.html$/i,

    // Texterkennung auf der Profilseite
    BLOCK_TEXTS: ['profil ignorieren', 'ignorieren', 'blockieren'],
    BLOCK_EXCLUDE: ['aufheben', 'entblock', 'nicht mehr', 'freigeben', 'beschwerde'],
    ALREADY_BLOCKED_TEXTS: ['nicht mehr ignorieren', 'ignorieren aufheben', 'ignorierung aufheben', 'blockierung aufheben', 'entblocken'],
    MORE_MENU_HINTS: ['mehr', 'weitere', 'optionen', 'menü', 'menu', 'aktionen', '⋮', '…', '...', '⋯'],
    CONFIRM_TEXTS: ['ignorieren'],   // Dialog „Profil ignorieren?“ → Knopf „Ignorieren“
    CANCEL_TEXTS: ['abbrechen', 'nein', 'schließen'],
    NOTE_OPEN_TEXTS: ['notiz'],
    NOTE_SAVE_TEXTS: ['speichern', 'übernehmen', 'fertig', 'ok'],
  };
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normType = (t) => norm(t).replace(/[-\s]/g, '');
  const SCAN_SOURCES = ['Likes', 'Besucher', 'Party', 'Gruppen', 'Suche'];
  const ALTBESTAND = 'Altbestand'; // interne Quelle: Konten ohne bekannte Quelle, immer ganz unten
  const GROUP_KEYS = ['m', 'f', 'p'];
  const GROUP_LABELS = { m: 'Männer', f: 'Frauen', p: 'Paare' };
  // bekannte JOYclub-Profiltypen und in welche Gruppen sie dürfen (erste = fest)
  const KNOWN_TYPES = {
    'Mann': ['m'], 'Frau': ['f'], 'Paar': ['p'],
    'Transmann': ['m', 'f'], 'Transfrau': ['m', 'f'], 'Transvestit': ['m', 'f'], 'Non-binary': ['m', 'f'],
    'Männer-Paar': ['m', 'p'], 'Frauen-Paar': ['f', 'p'], 'Trans-Paar': ['m', 'f', 'p'],
  };
  const FIXED_TYPES = { Mann: 'm', Frau: 'f', Paar: 'p' };
  // ==========================================================
  // ---------- Einstellungen im Skript-Speicher ----------
  // Je Einstellung: gültiger Wert + zuletzt gesehener Quelltext-Wert. Ändert man den Wert im Quelltext, gilt ab dann
  // dieser (auch wenn vorher auf der Seite „Opa-Schutz“ etwas anderes gespeichert war). Solange der Quelltext-Wert
  // unverändert bleibt, gilt der gespeicherte Wert. Listen werden als Ganzes verglichen.
  // WRITE_NOTE / NOTE_REQUIRED sind seit 1.88 fest an (nicht mehr einstellbar; alte gespeicherte Werte gelten nicht mehr)
  const SETTING_KEYS = ['DRY_RUN', 'DEBUG', 'IGNORE_LIMIT', 'MYJOY_FIRST_MAX', 'GROUPS', 'AWO', 'WHITELIST', 'SOURCE_RANK'];
  // Einstellungen bis 1.73 (werden einmalig in GROUPS übernommen und dann entfernt)
  const OLD_RULE_KEYS = ['SEARCH_IGNORE', 'MAX_AGE', 'WARN_AGE', 'ONLY_TYPES', 'COUPLE_MODE', 'COUPLE_AGE_GAP', 'COUPLE_BOTH_MIN_AGE'];
  const K_SETTINGS = 'jaf_settings'; // { KEY: { value, src } }
  const SOURCE_DEFAULTS = {};        // Werte laut Quelltext
  // alte Altersgrenzen (bis 1.73) → neue Tabelle; Schalter bleiben aus
  function migrateOldRules(st, groups) {
    const old = {};
    for (const k of OLD_RULE_KEYS) if (st[k] && st[k].value !== undefined) old[k] = st[k].value;
    if (!Object.keys(old).length) return false;
    const G = JSON.parse(JSON.stringify(groups));
    const clamp = (n) => Math.max(18, Math.min(100, Math.round(n)));
    if (old.MAX_AGE != null) {
      const t = clamp(old.MAX_AGE + 1), w = clamp(Math.min(old.WARN_AGE != null ? old.WARN_AGE : 29, t - 2));
      for (const q of SCAN_SOURCES) {
        const th = q === 'Suche' && !old.SEARCH_IGNORE ? G.m.src.Suche[2] : t;
        G.m.src[q] = [w, Math.max(w + 1, t - 1), th];
      }
    }
    if (old.COUPLE_BOTH_MIN_AGE != null) {
      const t = clamp(old.COUPLE_BOTH_MIN_AGE);
      for (const q of SCAN_SOURCES) for (const who of ['f', 'm']) {
        const v = G.p.src[q][who];
        const th = q === 'Suche' && !old.SEARCH_IGNORE ? v[2] : t;
        G.p.src[q][who] = [Math.min(v[0], t - 2), t - 1, th];
      }
    }
    if (old.COUPLE_AGE_GAP != null) G.p.sd.gap = Math.max(1, Math.round(old.COUPLE_AGE_GAP));
    if (Array.isArray(old.ONLY_TYPES)) {
      for (const t of old.ONLY_TYPES) {
        const k = Object.keys(KNOWN_TYPES).find((x) => normType(x) === normType(t)) || t;
        if (FIXED_TYPES[k] || GROUP_KEYS.some((g) => G[g].types.includes(k))) continue;
        if (!KNOWN_TYPES[k] || KNOWN_TYPES[k].includes('m')) G.m.types.push(k);
      }
    }
    for (const k of OLD_RULE_KEYS) delete st[k];
    return G;
  }
  // fehlende Felder (neue Skript-Version) aus den Quelltext-Werten ergänzen
  function completeGroups(G, D) {
    for (const g of Object.keys(D)) {
      G[g] = Object.assign({}, JSON.parse(JSON.stringify(D[g])), G[g] || {});
      for (const q of Object.keys(D[g].src)) if (!G[g].src[q]) G[g].src[q] = JSON.parse(JSON.stringify(D[g].src[q]));
      for (const x of ['sd', 'sm', 'names']) if (D[g][x]) G[g][x] = Object.assign({}, D[g][x], G[g][x] || {});
    }
    return G;
  }
  (function applyStoredSettings() {
    const st = gmGet(K_SETTINGS, {}) || {};
    let ch = false;
    if (!st.GROUPS) {
      const G = migrateOldRules(st, CONFIG.GROUPS);
      if (G) { st.GROUPS = { value: G, src: JSON.stringify(CONFIG.GROUPS) }; ch = true; }
    } else if (OLD_RULE_KEYS.some((k) => st[k])) { OLD_RULE_KEYS.forEach((k) => delete st[k]); ch = true; }
    for (const k of SETTING_KEYS) {
      const src = JSON.stringify(CONFIG[k]);
      SOURCE_DEFAULTS[k] = JSON.parse(src);
      const e = st[k];
      if (e && e.src === src && e.value !== undefined) CONFIG[k] = JSON.parse(JSON.stringify(e.value));
      else { st[k] = { value: JSON.parse(src), src }; ch = true; }
    }
    // Quellen, die im gespeicherten Wert fehlen (neue Skript-Version), hinten anhängen
    for (const q of SOURCE_DEFAULTS.SOURCE_RANK) if (!CONFIG.SOURCE_RANK.includes(q)) CONFIG.SOURCE_RANK.push(q);
    completeGroups(CONFIG.GROUPS, SOURCE_DEFAULTS.GROUPS);
    // nicht mehr benutzte Speicher (bis 1.73)
    for (const k of ['jaf_pauses', 'jaf_ms_protocol', 'jaf_ms_would']) if (gmGet(k, null) != null) GM_deleteValue(k);
    if (ch) gmSet(K_SETTINGS, st);
  })();
  // ---------- Region des eigenen Profils: im Ruhrgebiet heißt es „Oppa“ und „Omma“ ----------
  // Feste Listen (Kreise/kreisfreie Städte, wie JOYclub sie als Ort anzeigt). Rheinland dient vorerst nur der Einordnung.
  const K_REGION = 'jaf_region'; // { <eigene ID>: { region: 'ruhr' | 'rheinland' | 'anderswo' | 'unbekannt', place, ts } }
  const sessionId = () => (document.body && document.body.getAttribute('data-session-user-id')) || '';
  const regionRec = () => { const m = gmGet(K_REGION, {}) || {}; return m[sessionId()] || {}; };
  const REGION_PLACES = {
    ruhr: ['Bochum', 'Bottrop', 'Dortmund', 'Duisburg', 'Ennepe-Ruhr-Kreis', 'Essen', 'Gelsenkirchen', 'Hagen', 'Hamm', 'Herne',
      'Mülheim an der Ruhr', 'Mülheim (Ruhr)', 'Mülheim/Ruhr', 'Oberhausen', 'Recklinghausen', 'Kreis Recklinghausen', 'Unna', 'Kreis Unna', 'Wesel', 'Kreis Wesel'],
    rheinland: ['Aachen', 'Städteregion Aachen', 'Köln', 'Düsseldorf', 'Leverkusen', 'Rhein-Kreis Neuss', 'Neuss', 'Rhein-Erft-Kreis', 'Düren', 'Kreis Düren',
      'Heinsberg', 'Kreis Heinsberg', 'Bonn', 'Rhein-Sieg-Kreis', 'Euskirchen', 'Kreis Euskirchen', 'Oberbergischer Kreis', 'Mönchengladbach', 'Rheinisch-Bergischer Kreis'],
  };
  const placeKey = (t) => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '');
  function regionOfPlace(place) {
    const k = placeKey(place);
    if (!k || /^nordrheinwestfalen|deutschland$/.test(k)) return 'unbekannt';
    for (const [r, l] of Object.entries(REGION_PLACES)) if (l.some((x) => placeKey(x) === k)) return r;
    return 'anderswo';
  }
  const ownRegion = () => regionRec().region || '';
  const isRuhr = () => ownRegion() === 'ruhr';
  // Standard-Bezeichnungen ↔ Ruhrgebiet (eigene Bezeichnungen bleiben unverändert)
  const RUHR_WORDS = { Opa: 'Oppa', Opas: 'Oppas', Oma: 'Omma', Omas: 'Ommas' };
  function ruhrNames(G, back = false) {
    const map = back ? Object.fromEntries(Object.entries(RUHR_WORDS).map(([a, b]) => [b, a])) : RUHR_WORDS;
    for (const g of Object.keys(G || {})) {
      const n = G[g] && G[g].names;
      if (!n) continue;
      for (const k of ['one', 'many']) if (Array.isArray(n[k])) n[k] = n[k].map((x) => map[x] || x);
    }
    return G;
  }
  if (isRuhr()) ruhrNames(CONFIG.GROUPS);
  // Ort aus einer Profilseite: „Profil von X, Mann, …, 50 Jahre, Aachen“ bzw. Titel „X ♥ Mann - Aachen - …“
  function profilePlace(doc = document) {
    const fig = [...doc.querySelectorAll('[aria-label^="Profil von "]')][0];
    if (fig) {
      const m = fig.getAttribute('aria-label').match(/Jahre,\s*([^,]+)/);
      if (m) return m[1].trim();
    }
    const t = (doc.querySelector('title') || {}).textContent || '';
    const m2 = t.match(/♥\s*[^-]+?\s+-\s+(.+?)\s+-\s+/);
    return m2 ? m2[1].trim() : '';
  }
  // eigene Region merken; bei Wechsel sofort umschalten (Standard-Bezeichnungen)
  function setOwnRegion(place) {
    if (!place) return;
    const region = regionOfPlace(place);
    const all = gmGet(K_REGION, {}) || {}, id = sessionId();
    if (!id) return;
    const old = all[id] || {};
    if (old.region === region && old.place === place && Date.now() - (old.ts || 0) < 864e5) return;
    const wasRuhr = old.region === 'ruhr';
    all[id] = { region, place, ts: Date.now() };
    gmSet(K_REGION, all);
    if (wasRuhr !== (region === 'ruhr')) ruhrNames(CONFIG.GROUPS, wasRuhr);
  }
  // Ruhrgebiets-Wörter in Anzeigetexten
  function ruhrText(s) {
    return String(s).replace(/\bOpa(?![\wäöüß])/g, 'Oppa').replace(/\bOpas\b/g, 'Oppas').replace(/\bOma(?![\wäöüß])/g, 'Omma').replace(/\bOmas\b/g, 'Ommas');
  }
  const storedSettings = () => gmGet(K_SETTINGS, {}) || {};
  function saveSettings(values) {
    const st = storedSettings();
    for (const [k, v] of Object.entries(values)) {
      if (!SETTING_KEYS.includes(k)) continue;
      const val = JSON.parse(JSON.stringify(v));
      if (k === 'GROUPS' && isRuhr()) ruhrNames(val, true);
      st[k] = { value: val, src: JSON.stringify(SOURCE_DEFAULTS[k]) };
    }
    gmSet(K_SETTINGS, st);
  }
  // Anzeige-Namen der Quellen (intern bleiben die kurzen Namen)
  const SOURCE_LABELS = { Likes: 'Interaktionen', Besucher: 'Profilbesucher', Party: 'Partygäste', Gruppen: 'Gruppen', Suche: 'Mitgliedersuche', Sync: 'Synchronisation' };
  const SOURCE_TIPS = { Likes: 'Mitglieder, die ein „Gefällt mir“ oder einen Kommentar hinterlassen haben', Besucher: 'Profilbesucher',
    Party: 'Mitglieder, die auf denselben Partys angemeldet sind wie Du', Gruppen: 'Mitglieder aus denselben Gruppen wie Du', Suche: 'Mitgliedersuche', Sync: 'Synchronisation' };
  // Whitelist als Liste { name, reason }
  const WHITELIST = Object.entries(CONFIG.WHITELIST).flatMap(([reason, names]) => names.map((name) => ({ name, reason })));

  const K_STATE = 'jaf_state';
  const K_DONE = 'jaf_done';
  const K_FAILED = 'jaf_failed';
  const K_TYPES = 'jaf_other_types';
  const handledType = (t) => !!groupOfType(t);
  const GENDER_NAMES = { 1: 'Mann', 2: 'Frau', 3: 'Paar', 7: 'Transfrau' };

  // unbekannte Profiltypen sammeln (Profile und Karten): { Typ: [Namen …] } – erscheinen in den Einstellungen in allen Gruppen
  const isUnknownType = (t) => !!t && String(t).split('|').some((x) => !knownType(x));
  const getTypes = () => gmGet(K_TYPES, {}) || {};
  function noteType(type, name) {
    if (!isUnknownType(type)) return;
    const t = getTypes();
    for (const x of String(type).split('|').filter((y) => !knownType(y))) {
      const list = t[x] || (t[x] = []);
      if (name && !list.includes(name) && list.length < 200) list.push(name);
    }
    gmSet(K_TYPES, t);
  }
  function exportTypes() {
    const t = getTypes();
    downloadCsv('unbekannte-profiltypen', ['Profiltyp', 'Anzahl Konten', 'Beispiele'], Object.keys(t).sort().map((k) => [k, t[k].length, t[k].slice(0, 20).join(', ')]));
    return Object.keys(t).length;
  }
  function typesSummary() {
    const t = getTypes();
    const parts = Object.keys(t).sort().map((k) => `${k}: ${t[k].length}`);
    return parts.length ? 'Unbekannte Profiltypen: ' + parts.join(', ') : 'Unbekannte Profiltypen: noch keine';
  }
  function showTypes() {
    const t = getTypes();
    console.log('[Alter-Filter] Andere Profiltypen:', t);
    let el = document.querySelector('#jaf-panel .jaf-types');
    if (!el) { el = document.createElement('div'); el.className = 'jaf-types'; el.style.cssText = 'margin-top:6px;font-size:12px;color:#ffb300'; panel().insertBefore(el, panel().querySelector('.jaf-log')); }
    el.textContent = typesSummary();
    el.title = Object.keys(t).sort().map((k) => `${k}: ${t[k].join(', ')}`).join('\n');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
  const pad = (n) => String(n).padStart(2, '0');
  const cleanPath = (p) => p.replace(/\/+$/, '') || '/';

  // ---------- Verriegelung über mehrere Tabs ----------
  // Nur EIN Tab darf Listen aufbauen (nachladen, Gruppen lesen) oder ignorieren/entblocken.
  // Alle anderen Tabs markieren nur. Der Besitzer erneuert die Sperre alle 5 s; nach LOCK_TTL ohne Lebenszeichen
  // (Tab geschlossen/abgestürzt) gilt sie als frei.
  const K_LOCK = 'jaf_lock';
  const LOCK_TTL = 30000;
  const TAB_ID = (() => {
    try {
      // Vom Skript per window.open geöffnete Tabs erben die sessionStorage des Öffners → neu vergeben
      if (/^jaf-fresh/.test(window.name)) { sessionStorage.removeItem('jaf_tab_id'); window.name = ''; }
      let id = sessionStorage.getItem('jaf_tab_id'); // bleibt beim Seitenwechsel im selben Tab erhalten
      if (!id) { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('jaf_tab_id', id); }
      return id;
    } catch (e) { return 'x' + Math.random().toString(36).slice(2); }
  })();
  const getLock = () => gmGet(K_LOCK, null);
  const lockedByOther = () => { const l = getLock(); return l && l.owner !== TAB_ID && Date.now() - l.ts < LOCK_TTL ? l : null; };
  const ownsLock = () => { const l = getLock(); return !!(l && l.owner === TAB_ID); };
  async function acquireLock(what) {
    if (lockedByOther()) return false;
    gmSet(K_LOCK, { owner: TAB_ID, ts: Date.now(), what, url: location.href });
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 150)); // Gleichzeitiger Zugriff: wer zuletzt schrieb, gewinnt
    const l = getLock();
    return !!(l && l.owner === TAB_ID);
  }
  function releaseLock() { if (ownsLock()) gmSet(K_LOCK, null); }
  function lockNotice(l) {
    const age = Math.round((Date.now() - l.ts) / 1000);
    return `🔒 Ein anderer Tab arbeitet gerade (${l.what || 'beschäftigt'}, vor ${age} s aktiv) – hier wird nur markiert.`;
  }

  // ---------- Whitelist (fest + automatisch) ----------
  const K_WHITE = 'jaf_whitelist';   // { normName: { name, url, reasons: [..], modGroups: [{ key, name }], since } }
  const MOD_PREFIX = 'Moderator der Gruppe ';
  const getDynWhite = () => {
    const w = gmGet(K_WHITE, {});
    // Übernahme aus 1.26: „Moderator der Gruppe X“ stand in reasons
    let ch = false;
    for (const e of Object.values(w)) {
      if (!e.modGroups) { e.modGroups = []; ch = true; }
      const mods = (e.reasons || []).filter((r) => r.startsWith(MOD_PREFIX));
      if (mods.length) {
        mods.forEach((r) => { const n = r.slice(MOD_PREFIX.length); if (!e.modGroups.some((g) => g.name === n)) e.modGroups.push({ key: '', name: n }); });
        e.reasons = e.reasons.filter((r) => !r.startsWith(MOD_PREFIX));
        ch = true;
      }
    }
    if (ch) gmSet(K_WHITE, w);
    return w;
  };
  const sameGroup = (a, b) => (a.key && b.key ? a.key === b.key : norm(a.name) === norm(b.name));
  // Moderator für Gruppe g eintragen
  // steht schon auf der eigenen Whitelist (Quelltext/Seite „Opa-Schutz“)? → nicht zusätzlich automatisch eintragen
  const inOwnWhite = (name) => WHITELIST.some((e) => norm(e.name) === norm(name));
  function addModerator(m, g) {
    if (inOwnWhite(m.name)) return;
    const w = getDynWhite();
    const k = norm(m.name);
    const e = w[k] || { name: m.name, url: m.url || '', reasons: [], modGroups: [], since: new Date().toISOString() };
    if (m.url) e.url = m.url;
    if (m.id || idOf(m.url)) e.id = String(m.id || idOf(m.url));
    const i = e.modGroups.findIndex((x) => sameGroup(x, g));
    if (i < 0) e.modGroups.push({ key: g.key, name: g.name }); else e.modGroups[i] = { key: g.key || e.modGroups[i].key, name: g.name };
    w[k] = e;
    gmSet(K_WHITE, w);
  }
  // bekannte Moderatoren von Gruppe g, die dort nicht mehr Moderator sind → Gruppe entfernen;
  // ohne verbleibende Gruppe und ohne andere Begründung fliegen sie von der Whitelist. Rückgabe: diese Ex-Moderatoren
  function dropFormerModerators(g, currentMods) {
    const w = getDynWhite();
    const cur = currentMods.map((m) => norm(m.name));
    const former = [];
    let ch = false;
    for (const [k, e] of Object.entries(w)) {
      if (!e.modGroups.some((x) => sameGroup(x, g)) || cur.includes(k)) continue;
      e.modGroups = e.modGroups.filter((x) => !sameGroup(x, g));
      ch = true;
      if (!e.modGroups.length && !(e.reasons || []).length) {
        delete w[k];
        if (!WHITELIST.some((x) => norm(x.name) === k)) former.push({ name: e.name, url: e.url, path: e.url ? cleanPath(new URL(e.url, location.origin).pathname) : '' });
      }
    }
    if (ch) gmSet(K_WHITE, w);
    return former;
  }
  const dynReasons = (e) => (e.reasons || []).concat((e.modGroups || []).map((g) => MOD_PREFIX + g.name));
  const idOf = (p) => (String(p || '').match(/\/(?:profile|my)\/(\d+)\./) || [])[1] || '';
  // Whitelist auch über die Profil-ID (Namen können sich ändern – der Teil hinter der ID in der URL ist oft ein alter Name)
  let _wIdCache = { t: 0, set: new Set() };
  // gelernte Profil-Links der Whitelist-Mitglieder (feste Einträge haben im Skript nur den Namen)
  const K_WHITE_URLS = 'jaf_white_urls'; // { normName: { name, url, id, seen } }
  const getWhiteUrls = () => gmGet(K_WHITE_URLS, {});
  // beim Sehen eines Profils (Profilseite, Gästeliste, Karten): fehlenden Link/ID der Whitelist ergänzen
  function learnWhiteUrl(name, path) {
    if (!name || !path || !CONFIG.PROFILE_PATH_RE.test(path)) return;
    const k = norm(name);
    const id = idOf(path);
    const url = location.origin + path;
    const isStatic = WHITELIST.some((e) => norm(e.name) === k);
    const w = getDynWhite();
    const dyn = w[k];
    if (dyn && (!dyn.url || !dyn.id)) { if (!dyn.url) dyn.url = url; if (!dyn.id) dyn.id = id; gmSet(K_WHITE, w); _wIdCache.t = 0; }
    if (!isStatic) return;
    const m = getWhiteUrls();
    if (m[k] && m[k].id === id) return;
    m[k] = { name, url, id, seen: new Date().toISOString() };
    gmSet(K_WHITE_URLS, m);
    _wIdCache.t = 0;
  }
  const whiteUrlOf = (name) => { const k = norm(name); return (getWhiteUrls()[k] || {}).url || (getDynWhite()[k] || {}).url || ''; };
  function whiteIds() {
    if (Date.now() - _wIdCache.t < 2000) return _wIdCache.set;
    const set = new Set();
    for (const e of Object.values(getDynWhite())) { const id = e.id || idOf(e.url); if (id) set.add(String(id)); }
    for (const e of Object.values(getWhiteUrls())) if (e.id) set.add(String(e.id));
    _wIdCache = { t: Date.now(), set };
    return set;
  }
  const isWhiteMember = (c, white = whiteList()) => white.includes(norm(c.name)) || whiteIds().has(idOf(c.path || c.url));
  // allgemeiner Eintrag: Begründung + optional Party (VIP-Gast / Party-Freischaltung)
  function addWhiteEntry(m, reason, party) {
    if (inOwnWhite(m.name)) return;
    const w = getDynWhite();
    let k = norm(m.name);
    const id = m.id || idOf(m.url || m.path);
    // gleiche ID unter anderem Namen schon vorhanden? → diesen Eintrag verwenden
    const byId = id && Object.entries(w).find(([, e]) => (e.id || idOf(e.url)) === String(id));
    if (byId) k = byId[0];
    const e = w[k] || { name: m.name, url: m.url || '', reasons: [], modGroups: [], since: new Date().toISOString() };
    if (m.url) e.url = m.url;
    if (id) e.id = String(id);
    if (reason && !e.reasons.includes(reason)) e.reasons.push(reason);
    if (party) {
      const key = reason === CONFIG.VIP_REASON ? 'vipParties' : 'parties';
      e[key] = e[key] || [];
      if (!e[key].some((x) => x.name === party.name && x.date === party.date)) e[key].push(party);
    }
    w[k] = e;
    gmSet(K_WHITE, w);
    _wIdCache.t = 0;
  }
  function whiteList() {
    const s = WHITELIST.map((e) => norm(e.name));
    for (const k of Object.keys(getDynWhite())) if (!s.includes(k)) s.push(k);
    return s;
  }
  const isWhite = (name) => whiteList().includes(norm(name));
  function addWhite(name, url, reason) {
    if (!name || inOwnWhite(name)) return false;
    const w = getDynWhite();
    const k = norm(name);
    const e = w[k] || { name, url: url || '', reasons: [], modGroups: [], since: new Date().toISOString() };
    if (url && !e.url) e.url = url;
    const isNew = !w[k];
    if (reason && !e.reasons.includes(reason)) e.reasons.push(reason);
    w[k] = e;
    gmSet(K_WHITE, w);
    return isNew;
  }
  function whiteReason(name) {
    const k = norm(name);
    const reasons = WHITELIST.filter((e) => norm(e.name) === k).map((e) => e.reason);
    const d = getDynWhite()[k];
    if (d) reasons.push(...dynReasons(d));
    return reasons.join('; ');
  }

  const getState = () => gmGet(K_STATE, { running: false, queue: [], count: 0 });
  const setState = (s) => gmSet(K_STATE, Object.assign({}, s, { ts: Date.now() }));
  const resetState = () => gmSet(K_STATE, { running: false, queue: [], count: 0, ts: Date.now() });
  const K_LOG = 'jaf_log';           // { path: { name, url, ages, type, source, method, ts } } – vom Skript ignoriert
  const K_IGNORED = 'jaf_ignored';   // { path: { name, url, id } } – echte Ignorierliste von JOYclub (Abgleich)
  const K_IGNORED_TS = 'jaf_ignored_ts';
  const getLog = () => {
    const l = gmGet(K_LOG, null);
    if (l) return l;
    // einmalige Übernahme der alten Erledigt-Liste (nur Pfade)
    const m = {};
    for (const p of gmGet(K_DONE, [])) {
      const mm = p.match(/\/profile\/\d+\.([^/]+)\.html/);
      m[p] = { name: mm ? mm[1] : '', url: location.origin + p, method: 'Profil (alt)', ts: 0 };
    }
    gmSet(K_LOG, m);
    return m;
  };
  const getIgnored = () => gmGet(K_IGNORED, {});
  // vom Skript ignoriert und nicht wieder entblockt
  const getDone = () => Object.entries(getLog()).filter(([, r]) => !r.unblocked).map(([p]) => p);
  // bereits ignoriert = vom Skript ignoriert (nicht entblockt) ODER auf der echten Ignorierliste
  const isBlocked = (path, log_ = getLog(), ign = getIgnored()) => !!((log_[path] && !log_[path].unblocked) || ign[path]);
  const addGroup = (arr, g) => { arr = Array.isArray(arr) ? arr.slice() : []; if (g && !arr.includes(g)) arr.push(g); return arr; };
  // Rangfolge der Quellen (CONFIG.SOURCE_RANK): höher stehende ersetzt niedrigere; ohne Quelle = ganz unten
  const srcRank = (s) => { const i = CONFIG.SOURCE_RANK.indexOf(s || ''); return i < 0 ? 1000 : i; }; // unbekannt/leer = Altbestand (ganz unten)
  const betterSource = (a, b) => (srcRank(b) < srcRank(a) ? b : (a || b || ''));
  // ---------- „zuletzt gesehen“ + Quelle ----------
  // Sichtung eines Mitglieds in einer Quelle (Party-Datum, Besuchs-/Like-Datum; Gruppen/Suche ohne Datum):
  //  - höhere Quelle als bisher → Quelle steigt, „zuletzt gesehen“ = Datum dieser Sichtung (darf dabei einmalig sinken)
  //  - gleiche Quelle → nur ein neueres Datum ersetzt das alte
  //  - niedrigere Quelle → nichts ändert sich
  // Gilt für vom Skript gesperrte Einträge (Quelle) und für die Konten-Liste (seenSrc).
  const dayOfDE = (t) => { const m = String(t || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : ''; };
  function applySighting(x, source, day, srcKey, seenKey) {
    const r = srcRank(source), old = srcRank(x[srcKey]);
    if (r < old) {
      if (srcKey === 'source') { x.prevSource = x.source || ''; x.sourceTs = Date.now(); }
      x[srcKey] = source;
      if (day) x[seenKey] = day; else delete x[seenKey];
      return true;
    }
    if (r === old && day && (!x[seenKey] || day > x[seenKey])) { x[seenKey] = day; return true; }
    return false;
  }
  // members: [{ path?, id?, url?, day? }] – day je Mitglied überschreibt das allgemeine Datum
  function noteSighting(members, source, day = null) {
    if (!source || !members || !members.length) return 0;
    const l = getLog();
    const acc = getAccounts();
    const byId = {};
    for (const k of Object.keys(l)) { const id = idOf(k); if (id) byId[id] = k; }
    let n = 0, lc = false, ac = false;
    for (const m of members) {
      const d = m.day || day || null;
      const k = (m.path && l[m.path] ? m.path : null) || byId[m.id || idOf(m.path || m.url)];
      const e = k && l[k];
      if (e && !e.unblocked && applySighting(e, source, d, 'source', 'seen')) { lc = true; n++; }
      const ak = m.path && acc[m.path] ? m.path : (k && acc[k] ? k : null);
      if (ak) {
        const a = Object.assign({}, acc[ak]);
        let ch = applySighting(a, source, d, 'seenSrc', 'seen');
        // je Quelle: zuletzt gesehen (für die Werte beim Ansehen und das Gedächtnis)
        const sr = Object.assign({}, a.srcs || {});
        if (!(source in sr) || (d && (!sr[source] || d > sr[source]))) { sr[source] = d || sr[source] || ''; a.srcs = sr; ch = true; }
        if (ch) { acc[ak] = a; ac = true; }
      }
    }
    if (lc) gmSet(K_LOG, l);
    if (ac) gmSet(K_ACCOUNTS, acc);
    return n;
  }
  const upgradeSources = (members, source, day = null) => noteSighting(members, source, day);
  const addDone = (p, info = {}, method = '') => {
    const l = getLog();
    if (l[p] && l[p].ts && !l[p].unblocked) { if (info.source) noteSighting([{ path: p, day: info.seen || null }], info.source); return; }
    l[p] = {
      name: info.name || '', url: info.url || location.origin + p, ages: info.ages || [], type: info.type || '',
      source: info.source || getState().source || '', method, ts: Date.now(),
    };
    if (info.reason) l[p].reason = info.reason;
    if (info.kind) l[p].kind = toKind(info.kind, info.type);
    if (info.seen) l[p].seen = info.seen;
    if (info.fromWatch) l[p].vorgemerkt = true;
    if (info.formerMod) l[p].formerMod = true;
    memNote(p, 'blocked', Object.assign({}, info, { source: l[p].source, why: method }));
    const accOnline = (gmGet('jaf_accounts', {})[p] || {}).online;
    if (accOnline) l[p].online = accOnline;
    gmSet(K_LOG, l);
    // Zähler der JOYclub-Ignorierliste mitführen (für das Limit)
    const ign = getIgnored();
    if (!ign[p]) { ign[p] = { name: info.name || '', url: info.url || location.origin + p, id: idOf(p) }; gmSet(K_IGNORED, ign); }
    removeFromWatch(p);
    if (info.ages && info.ages.length) recordAccounts([{ path: p, url: info.url, name: info.name, ages: info.ages, type: info.type }]);
  };
  // ---------- Gedächtnis aller Kandidaten ----------
  // Jedes Mitglied, das jemals gesperrt, verdrängt, vorgemerkt oder (Testmodus) „würde gesperrt“ war:
  // { name, url, type, ages, kind, src, status, ts, hist: [{ ts, st, src, why }] }
  const K_MEM = 'jaf_mem';
  const MEM_STATUS = { blocked: 'gesperrt', displaced: 'verdrängt (Limit)', unblocked: 'entsperrt', removed: 'von JOYclub entfernt (Überlauf)', watch: 'vorgemerkt', would: 'würde gesperrt (Testmodus)' };
  const getMem = () => gmGet(K_MEM, {});
  function memNote(path, st, info = {}) {
    if (!path || !CONFIG.PROFILE_PATH_RE.test(path)) return;
    const old = bigGet1(K_MEM, path) || {};
    const e = Object.assign({}, old);
    for (const k of ['name', 'url', 'type']) if (info[k]) e[k] = info[k];
    if (info.ages && info.ages.length) e.ages = info.ages;
    if (info.kind || info.reason) e.kind = toKind(info.kind || info.reason, info.type || e.type);
    const src = info.source || info.src || '';
    if (src && srcRank(src) <= srcRank(e.src)) e.src = src;
    if (e.status === st && old.ts && Date.now() - old.ts < 60000) return;
    e.status = st; e.ts = Date.now();
    e.hist = (e.hist || []).concat({ ts: e.ts, st, src, why: info.why || '' }).slice(-20);
    bigSet1(K_MEM, path, e);
  }
  function markUnblocked(path, info, reason) {
    const l = getLog();
    const e = l[path] || { name: info.name || '', url: info.url || location.origin + path, ages: [], type: '', source: '', method: 'nur JOYclub-Ignorierliste', ts: 0 };
    e.unblocked = { ts: Date.now(), reason };
    l[path] = e;
    gmSet(K_LOG, l);
    memNote(path, /Limit|Platz/.test(reason) ? 'displaced' : /Überlauf/.test(reason) ? 'removed' : 'unblocked', Object.assign({}, e, { why: reason }));
    const ign = getIgnored();
    if (ign[path]) { delete ign[path]; gmSet(K_IGNORED, ign); }
  }
  const getFailed = () => gmGet(K_FAILED, {});
  const setFailed = (p, why) => { const f = getFailed(); f[p] = why; gmSet(K_FAILED, f); };
  const clearFailed = (p) => { const f = getFailed(); if (p in f) { delete f[p]; gmSet(K_FAILED, f); } };

  const currentListPage = () => CONFIG.LIST_PAGES.find((l) => !l.background && cleanPath(location.pathname) === l.path);
  const sourceOf = (name) => (CONFIG.LIST_PAGES.find((l) => l.name === name) || {}).source || '';
  const isProfilePage = () => CONFIG.PROFILE_PATH_RE.test(location.pathname);

  // ---------- UI ----------
  function panel() {
    let el = document.getElementById('jaf-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'jaf-panel';
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#1e1e1e;color:#fff;' +
      'font:13px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:320px';
    document.body.appendChild(el);
    return el;
  }
  function log(msg) {
    console.log('[Alter-Filter]', msg);
    const p = panel();
    let l = p.querySelector('.jaf-log');
    if (!l) { l = document.createElement('div'); l.className = 'jaf-log'; l.style.cssText = 'margin-top:6px;opacity:.9;max-height:140px;overflow:auto;white-space:pre-wrap'; p.appendChild(l); }
    l.textContent = msg;
  }
  function btn(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:2px 4px 2px 0;padding:4px 8px;border:0;border-radius:4px;cursor:pointer;background:#444;color:#fff';
    b.onclick = fn;
    return b;
  }

  // ---------- Mitgliedersuche auswerten ----------
  function readCards() {
    return [...document.querySelectorAll('a.member_search_result_link, a[data-e2e="result-item"]')].map((a) => {
      const card = a.querySelector('j-member-card');
      if (!card) return null;
      const ages = [card.getAttribute('age'), card.getAttribute('age2')]
        .map(Number).filter((n) => n >= 18 && n <= 120);
      return {
        a,
        path: cleanPath(new URL(a.href, location.origin).pathname),
        url: location.origin + cleanPath(new URL(a.href, location.origin).pathname),
        name: card.getAttribute('user-name') || '',
        ages,
        gender: card.getAttribute('universal-gender') || '',
        type: cardType(card),
      };
    }).filter(Boolean);
  }

  function cardType(card) {
    const icon = card.shadowRoot && card.shadowRoot.querySelector('j-gender-icon');
    const div = icon && icon.shadowRoot && icon.shadowRoot.querySelector('.j-gender-icon');
    let title = div && (div.getAttribute('title') || div.getAttribute('aria-label'));
    if (['Jungschwanz', 'Schwanz', 'Opa'].includes(title)) title = 'Mann'; // vom Skript umbenannt
    const num = card.getAttribute('universal-gender');
    if (title && num) learnGender(num, title);
    return title || typeFromGender(num);
  }

  // Zuordnung universal-gender-Nummer → Profiltyp lernen (aus Karten mit sichtbarem Typ),
  // damit Listen ohne Typ-Text (z. B. Gruppen-Mitgliederlisten) richtig eingeordnet werden.
  const K_GENDER = 'jaf_gender_map'; // { num: { Typ: Anzahl } }
  function learnGender(num, title) {
    const m = gmGet(K_GENDER, {});
    const e = m[num] || (m[num] = {});
    if ((e[title] || 0) >= 20) return; // genug Belege – nicht ständig schreiben
    e[title] = (e[title] || 0) + 1;
    gmSet(K_GENDER, m);
  }
  function typeFromGender(num) {
    const e = (gmGet(K_GENDER, {}) || {})[num];
    const titles = e ? Object.keys(e) : [];
    if (titles.length === 1) return titles[0];
    if (titles.length > 1) return titles.sort((a, b) => e[b] - e[a]).join('|'); // mehrdeutig
    return GENDER_NAMES[num] || `Typ ${num || '?'}`;
  }
  // =====================================================================
  // ---------- Regelwerk: Gruppen (Männer m / Frauen f / Paare p) × Quellen ----------
  // Jede Gruppe: Stufe 1 bis a, Stufe 2 bis b, darüber Stufe 3 (nur Anzeige); ignoriert ab t (wenn „Ignorieren aktiv“).
  // Paare: je Frau und Mann eigene Werte; ein Paar wird ignoriert, wenn BEIDE ihre Schwelle erreichen.
  // Sugar Daddy (Mann ≥ gap älter) und Sugar Mom (Frau ≥ gap älter) gehören zu den Paaren.
  // Männer-/Frauen-Paare in der Gruppe Paare: Werte des Mannes bzw. der Frau, verglichen mit dem höheren Alter.
  // =====================================================================
  const isCoupleType = (t) => /paar/i.test(String(t || '')); // Paar, Männer-Paar, Frauen-Paar, Trans-Paar …
  const knownType = (t) => Object.keys(KNOWN_TYPES).find((k) => normType(k) === normType(t)) || '';
  function groupOfType(t, cfg = CONFIG) {
    for (const x of String(t || '').split('|')) {
      const k = knownType(x) || x;
      if (FIXED_TYPES[k]) return FIXED_TYPES[k];
      for (const g of GROUP_KEYS) if ((cfg.GROUPS[g].types || []).some((y) => normType(y) === normType(k))) return g;
    }
    return null;
  }
  // Werte einer Quelle; Sync/Altbestand/unbekannt → unterste Quelle mit eigenen Werten
  function srcKey(src, cfg = CONFIG) {
    if (SCAN_SOURCES.includes(src)) return src;
    const ranked = cfg.SOURCE_RANK.filter((q) => SCAN_SOURCES.includes(q));
    return ranked[ranked.length - 1] || 'Suche';
  }
  const vals = (g, src, who, cfg = CONFIG) => {
    const v = cfg.GROUPS[g].src[srcKey(src, cfg)];
    return g === 'p' ? v[who || 'm'] : v;
  };
  const stageOf = (age, v) => (age == null ? null : age <= v[0] ? 1 : age <= v[1] ? 2 : 3);
  // Einordnung eines Mitglieds { type, ages } für eine Quelle:
  // { group, kind: 'opa'|'oma'|'geronto'|'sd'|'sm'|null, hit (Kriterien erfüllt), active (wird ignoriert), stage, unclear, why }
  function judge(c, src, cfg = CONFIG) {
    const out = { group: null, kind: null, hit: false, active: false, stage: null, unclear: false, why: '' };
    const type = c.type || '';
    const g = groupOfType(type, cfg);
    out.group = g;
    if (!g) { out.why = type ? `Profiltyp „${type}“ nicht zugeordnet` : 'Profiltyp unbekannt'; return out; }
    const G = cfg.GROUPS[g];
    const ages = (c.ages || []).filter((a) => a >= 18 && a <= 120);
    if (!ages.length) { out.unclear = true; out.why = 'Alter unbekannt'; return out; }
    if (g === 'p') {
      const k = knownType(type.split('|')[0]) || type;
      if (k === 'Männer-Paar' || k === 'Frauen-Paar') {
        const who = k === 'Männer-Paar' ? 'm' : 'f';
        const a = Math.max(...ages);
        const v = vals('p', src, who, cfg);
        out.stage = stageOf(a, v);
        const gap = ages.length === 2 ? Math.abs(ages[0] - ages[1]) : null;
        const gapRule = who === 'm' ? G.sd : G.sm;
        if (gap != null && gapRule && gapRule.on && gap >= gapRule.gap) { out.kind = who === 'm' ? 'sd' : 'sm'; out.why = `Unterschied ${gap}`; }
        else if (a >= v[2]) { out.kind = 'geronto'; out.why = G.names.one[2]; }
        if (ages.length < 2 && !out.kind) out.unclear = true;
      } else {
        if (ages.length < 2) { out.unclear = true; out.why = 'Paar mit nur einer Altersangabe'; out.stage = stageOf(ages[0], vals('p', src, 'm', cfg)); return out; }
        const [fa, ma] = ages; // JOYclub: zuerst die Frau, dann der Mann
        const vf = vals('p', src, 'f', cfg), vm = vals('p', src, 'm', cfg);
        out.stage = Math.min(stageOf(fa, vf), stageOf(ma, vm));
        const ger = fa >= vf[2] && ma >= vm[2];
        const sd = G.sd && G.sd.on && ma - fa >= G.sd.gap;
        const sm = G.sm && G.sm.on && fa - ma >= G.sm.gap;
        if (sd) { out.kind = 'sd'; out.why = `Sugar Daddy, Unterschied ${ma - fa}`; }
        else if (ger) { out.kind = 'geronto'; out.why = G.names.one[2]; }
        else if (sm) { out.kind = 'sm'; out.why = `Sugar Mom, Unterschied ${fa - ma}`; }
      }
    } else {
      const a = Math.max(...ages); // Paar-Typen in der Gruppe Männer/Frauen: das höhere Alter zählt
      const v = vals(g, src, null, cfg);
      out.stage = stageOf(a, v);
      if (a >= v[2]) { out.kind = g === 'm' ? 'opa' : 'oma'; out.why = G.names.one[2]; }
    }
    out.hit = !!out.kind;
    out.active = out.hit && !!G.ignore;
    return out;
  }
  // „würde/wird ignoriert“ – höchste zutreffende Quelle aus einer Liste
  function bestSource(c, sources, cfg = CONFIG) {
    const list = (sources && sources.length ? sources : [ALTBESTAND]).slice().sort((a, b) => srcRankOf(a, cfg) - srcRankOf(b, cfg));
    for (const q of list) { const j = judge(c, q, cfg); if (j.active) return { src: q, j }; }
    return null;
  }
  const srcRankOf = (s, cfg = CONFIG) => { const i = cfg.SOURCE_RANK.indexOf(s || ''); return i < 0 ? 1000 : i; };
  // Grund-Text für Protokoll/Notiz (kompatibel zu älteren Einträgen)
  const KIND_REASON = { sd: 'Altersunterschied', sm: 'Sugar Mom', geronto: 'Geronto-Paar', opa: 'Alter', oma: 'Alter' };
  const reasonKind = (r, group) => (r === 'Altersunterschied' ? 'sd' : r === 'Sugar Mom' ? 'sm' : r === 'Geronto-Paar' ? 'geronto' : group === 'f' ? 'oma' : 'opa');
  // Bezeichnung in der Notiz: Sugar Daddy / Sugar Mom / Stufe-3-Bezeichnung der Gruppe
  function kindLabel(kind, cfg = CONFIG) {
    if (kind === 'sd') return 'Sugar Daddy';
    if (kind === 'sm') return 'Sugar Mom';
    if (kind === 'geronto') return cfg.GROUPS.p.names.one[2];
    if (kind === 'oma') return cfg.GROUPS.f.names.one[2];
    return cfg.GROUPS.m.names.one[2];
  }
  // Text der aktuell ignorierten Arten (für Hinweise), z. B. „Opas, Sugar Daddys, Geronto-Paare“
  function ignoredKindsText(cfg = CONFIG) {
    const out = [];
    if (cfg.GROUPS.m.ignore) out.push(cfg.GROUPS.m.names.many[2]);
    if (cfg.GROUPS.f.ignore) out.push(cfg.GROUPS.f.names.many[2]);
    if (cfg.GROUPS.p.ignore) {
      out.push(cfg.GROUPS.p.names.many[2]);
      if (cfg.GROUPS.p.sd.on) out.push('Sugar Daddys');
      if (cfg.GROUPS.p.sm.on) out.push('Sugar Moms');
    }
    return out.join(', ') || 'derzeit keine – Ignorieren ist überall ausgeschaltet';
  }
  // alle jemals verwendeten Stufe-3-Bezeichnungen (für das Erkennen eigener Notizzeilen)
  const K_LABELS = 'jaf_note_labels';
  function noteLabels() {
    const l = new Set(['Alter Sack', 'Sugar Daddy', 'Sugar Mom', 'Geronto-Paar', 'Opa', 'Oma', 'Oppa', 'Omma'].concat(gmGet(K_LABELS, []) || []));
    for (const g of GROUP_KEYS) l.add(CONFIG.GROUPS[g].names.one[2]);
    return [...l].filter(Boolean);
  }
  function rememberNoteLabels() {
    const have = gmGet(K_LABELS, []) || [];
    const add = GROUP_KEYS.map((g) => CONFIG.GROUPS[g].names.one[2]).filter((x) => x && !have.includes(x));
    if (add.length) gmSet(K_LABELS, have.concat(add));
  }
  const escHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let _ownRe = null, _ownReKey = '';
  function ownNoteRe() {
    const labels = noteLabels();
    const key = labels.join('|');
    if (!_ownRe || key !== _ownReKey) {
      _ownReKey = key;
      _ownRe = new RegExp(`^\\s*(${labels.map(reEsc).sort((a, b) => b.length - a.length).join('|')})(?:\\s*\\([^)]*\\))?\\s+(?:geblockt|blockiert|ignoriert)\\s+am\\s+\\S+\\s+um\\s+\\S+\\s*$`, 'i');
    }
    return _ownRe;
  }
  // Kompatibilität: alte Helfer auf das neue Regelwerk abgebildet
  const isCoupleRuleType = (t) => groupOfType(t) === 'p';
  const typeOkFor = (t) => !!groupOfType(t);
  const coupleGap = (ages) => (ages && ages.length === 2 ? ages[1] - ages[0] : null);
  // Grund eines Paares (für Notiz/Protokoll): 'Altersunterschied' | 'Sugar Mom' | 'Geronto-Paar' | null
  function coupleReason(ages, src = 'Party', type = 'Paar') {
    const j = judge({ type, ages }, src);
    return j.kind ? KIND_REASON[j.kind] === 'Alter' ? null : KIND_REASON[j.kind] : null;
  }
  // Soll dieses Mitglied ignoriert werden? (ohne Prüfung „bereits ignoriert“)
  // white === null → Whitelist bewusst nicht berücksichtigen (z. B. „würde die Kriterien erfüllen“)
  function shouldBlock(c, white = whiteList(), src = 'Party') {
    if (white !== null && isWhiteMember(c, white)) return false;
    return judge(c, src).active;
  }

  // Karte/Listeneintrag für einen Scan einordnen: { kind: 'ignore'|'verify'|'skip', why, item }
  // ctx: { white, blocked } · nur, was fürs Ignorieren relevant ist, wird geprüft
  function classifyCard(c, ctx, src) {
    if (!CONFIG.PROFILE_PATH_RE.test(c.path || '')) return { kind: 'skip', why: 'kein Mitgliederprofil' };
    if (ctx.blocked && ctx.blocked.get(idOf(c.path))) return { kind: 'skip', why: 'bereits ignoriert' };
    if (ctx.white && isWhiteMember(c, ctx.white)) return { kind: 'skip', why: 'Whitelist' };
    const j = judge(c, src);
    if (!j.group) return { kind: 'skip', why: j.why };
    if (!CONFIG.GROUPS[j.group].ignore) return { kind: 'skip', why: `Ignorieren für ${GROUP_LABELS[j.group]} aus` };
    const item = { path: c.path, url: c.url || location.origin + c.path, name: c.name, ages: c.ages || [], type: c.type, source: src };
    if (c.day || c.seen) item.seen = c.day || c.seen;
    if (j.active) return { kind: 'ignore', why: j.why, item: Object.assign(item, { kind: j.kind, reason: KIND_REASON[j.kind] }) };
    if (j.unclear) return { kind: 'verify', why: j.why, item: Object.assign(item, { verify: true }) };
    return { kind: 'skip', why: 'erfüllt die Kriterien nicht' };
  }

  // Profiltyp auf der Profilseite: <div class="profile-base-info__line-2"><span>Mann</span> …
  function profileType() {
    const el = document.querySelector('.profile-base-info__line-2 > span');
    // vom Skript umbenannt → Originaltyp steht in data-jaf-orig
    if (el && el.textContent.trim()) return el.getAttribute('data-jaf-orig') || el.textContent.trim();
    const lab = [...document.querySelectorAll('[aria-label^="Profil von "]')].map((e) => e.getAttribute('aria-label'))[0];
    return lab ? (lab.split(',')[1] || '').trim() : '';
  }

  const COLORS = { white: '#ffffff', green: '#43a047', light: '#ffb74d', dark: '#ef6c00', red: '#e53935', grey: '#616161', done: '#757575' };
  const STAGE_COLORS = [null, COLORS.green, COLORS.light, COLORS.dark];


  // Knopf „Mehr Ergebnisse“ unten in der Suchliste (Panel des Skripts ausgenommen)
  // wirklich sichtbar? (nicht nur im DOM vorhanden, sondern angezeigt)
  function reallyVisible(e) {
    if (!visible(e)) return false;
    if (typeof e.checkVisibility === 'function' && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    for (let el = e; el && el !== document.body; el = el.parentElement || (el.getRootNode() && el.getRootNode().host)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    return true;
  }

  function loadMoreButton() {
    const fixed = [...document.querySelectorAll(CONFIG.LOAD_MORE_SELECTOR)].find((e) => {
      const inner = e.shadowRoot && e.shadowRoot.querySelector('button');
      return reallyVisible(e) && !(inner && inner.disabled) && e.getAttribute('disabled') === null && e.getAttribute('loading') === null;
    });
    if (fixed) return fixed;
    // Ersatz: nur J-BUTTON/BUTTON mit exakt diesem Text (keine Teiltreffer wie „Mehr anzeigen“ in Filtern)
    return [...document.querySelectorAll('j-button, button')].find((e) =>
      !e.closest('#jaf-panel') && reallyVisible(e) && CONFIG.LOAD_MORE_TEXTS.includes(norm(e.innerText || e.textContent)));
  }

  let loading = false;
  const dbg = (...a) => { if (CONFIG.DEBUG) console.log('[Alter-Filter][Laden]', ...a); };

  // Seite „echt“ nach unten scrollen: erst etwas hoch, dann ans Ende – so feuert der
  // Nachlade-Auslöser (Infinite Scroll) auch dann erneut, wenn man schon unten stand.
  // das Element, das tatsächlich scrollt (Fenster oder ein Container um die Trefferliste)
  function scroller() {
    const cards = readCards();
    let el = cards.length ? cards[cards.length - 1].a.parentElement : null;
    while (el && el !== document.body && el !== document.documentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  async function nudgeScroll() {
    const sc = scroller();
    const isDoc = sc === document.scrollingElement || sc === document.documentElement;
    const height = isDoc ? window.innerHeight : sc.clientHeight;
    const fire = () => { (isDoc ? window : sc).dispatchEvent(new Event('scroll')); };
    // etwas hoch …
    sc.scrollTop = Math.max(0, sc.scrollHeight - height * 2);
    fire();
    await sleep(500);
    // … und in Schritten bis ganz nach unten (wie ein Mensch, damit der Nachlade-Auslöser sicher feuert)
    for (let i = 0; i < 4; i++) {
      sc.scrollTop = sc.scrollHeight;
      fire();
      await sleep(250);
    }
    const cards = readCards();
    if (cards.length) cards[cards.length - 1].a.scrollIntoView({ block: 'end' });
    window.scrollTo(0, document.documentElement.scrollHeight);
    fire();
  }

  // warten, bis neue Karten da sind und die Anzahl sich 1 s lang nicht mehr ändert
  async function waitForGrowth(before, timeout) {
    const grew = await waitFor(() => (readCards().length > before ? true : null), timeout);
    if (!grew) return false;
    let last = readCards().length;
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const now = readCards().length;
      if (now === last) break;
      last = now;
    }
    return true;
  }

  function stop() {
    loading = false;
    const s = getState();
    setState({ running: false, queue: [], count: 0 });
    if (s.opa) setOpa(Object.assign(getOpa(), { running: false }));
    if (s.evscan) setEv(Object.assign(getEv(), { running: false }));
    log('Gestoppt.');
    if (s.returnUrl && isProfilePage()) location.href = s.returnUrl;
  }

  // ---------- DOM-Hilfen (inkl. Shadow DOM der j-*-Komponenten) ----------
  function deepAll(root = document) {
    const out = [];
    const walk = (r) => {
      for (const el of r.querySelectorAll('*')) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    if (root.shadowRoot) walk(root.shadowRoot);
    walk(root);
    return out;
  }
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labelOf = (e) => norm(e.innerText || e.textContent) + ' ' + norm(e.getAttribute && e.getAttribute('aria-label')) + ' ' + norm(e.title);

  function clickables(root) {
    return deepAll(root).filter((e) =>
      /^(BUTTON|A|LI|J-BUTTON|J-CONTROL-BUTTON|J-A)$/.test(e.tagName) || ['button', 'menuitem', 'link', 'option'].includes(e.getAttribute('role')))
      .filter(visible)
      .filter((e) => { const t = norm(e.innerText || e.textContent); return t.length < 60; });
  }

  function findByTexts(texts, exclude = [], root) {
    return clickables(root).find((e) => {
      const t = labelOf(e);
      return texts.some((x) => t.includes(x)) && !exclude.some((x) => t.includes(x));
    });
  }

  async function waitFor(fn, timeout = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const r = fn(); if (r) return r; await sleep(300); }
    return null;
  }

  async function realClick(el) {
    if (CONFIG.DEBUG) {
      const old = el.style.outline;
      el.style.outline = '4px solid #ffeb3b';
      el.scrollIntoView({ block: 'center' });
      await sleep(CONFIG.DEBUG_PAUSE_MS);
      el.style.outline = old;
    }
    const inner = el.shadowRoot && el.shadowRoot.querySelector('button, a');
    const target = inner || el;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true }));
    }
    target.click();
  }

  function setValue(input, value) {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function openDialog() {
    return deepAll().find((e) =>
      (e.tagName === 'DIALOG' && e.open) ||
      ((e.getAttribute('role') === 'dialog' || e.getAttribute('aria-modal') === 'true' || /\bmodal\b/.test(e.className || '')) && visible(e)));
  }

  // Art einer Sperre als Kürzel: 'opa' | 'oma' | 'geronto' | 'sd' | 'sm' (auch aus alten Gründen 'Altersunterschied' usw.)
  function toKind(kind, type = '') {
    if (['opa', 'oma', 'geronto', 'sd', 'sm'].includes(kind)) return kind;
    if (kind === true) return 'sd';
    if (kind === 'Altersunterschied' || kind === 'Geronto-Paar' || kind === 'Sugar Mom') return reasonKind(kind);
    return groupOfType(type) === 'f' ? 'oma' : 'opa';
  }
  // Art eines Protokolleintrags (gespeichert, sonst aus Grund/Typ/Alter abgeleitet)
  function entryKind(e) {
    if (!e) return 'opa';
    if (e.kind) return e.kind;
    if (e.reason === 'Altersunterschied' || e.reason === 'Geronto-Paar' || e.reason === 'Sugar Mom') return reasonKind(e.reason);
    const j = judge({ type: e.type, ages: e.ages || [] }, e.source || ALTBESTAND);
    return j.kind || (groupOfType(e.type) === 'f' ? 'oma' : 'opa');
  }
  function noteText(source, kind = false, ts = Date.now(), type = '') {
    const d = new Date(ts);
    let t = CONFIG.NOTE_TEXT.replace('{art}', kindLabel(toKind(kind, type)));
    t = source ? t.replace('{quelle}', source) : t.replace(/\s*\(\{quelle\}\)|\s*\{quelle\}/, '');
    return t.replace('{datum}', `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`)
      .replace('{uhrzeit}', `${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }

  // ---------- Auf dem Profil: Notiz + Ignorieren ----------
  // JOYclub-Profilseite (Stand 10/2026):
  //  - Menü: <j-context-menu data-e2e="profile-context-menu"> mit Knopf <j-control-button aria-label="Profiloptionen">
  //  - Einträge: <j-context-menu-item title="Profil ignorieren"> (Knopf im Shadow DOM)
  //  - Notiz: <j-setting-textarea label="Profilnotiz zu …"> mit <j-form-text-area slot="textarea"> → <textarea> im Shadow DOM
  const dialogScope = (d) => (d && d.getRootNode && d.getRootNode().host) || d;

  function visibleMenuButton() {
    return [...document.querySelectorAll('j-context-menu[data-e2e="profile-context-menu"] j-control-button[slot="activator"], j-control-button[aria-label="Profiloptionen"]')]
      .find(visible);
  }
  function menuItems() {
    return [...document.querySelectorAll('j-context-menu-item')].filter(visible);
  }
  const itemTitle = (e) => norm(e.getAttribute('title') || e.innerText || e.textContent);

  async function openProfileMenu() {
    const open = menuItems();
    if (open.length) return open;
    const b = visibleMenuButton();
    if (!b) return null;
    await realClick(b);
    return await waitFor(() => { const m = menuItems(); return m.length ? m : null; }, 4000);
  }
  async function closeProfileMenu() {
    if (!menuItems().length) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await sleep(400);
    if (menuItems().length) { const b = visibleMenuButton(); if (b) await realClick(b); await sleep(400); }
  }

  function noteHost() {
    return [...document.querySelectorAll('j-setting-textarea')]
      .find((e) => /profilnotiz/.test(norm(e.getAttribute('label'))) && visible(e)) ||
      [...document.querySelectorAll('j-setting-textarea')].find((e) => /profilnotiz/.test(norm(e.getAttribute('label'))));
  }
  const noteTextarea = (host) => {
    const fta = host.querySelector('j-form-text-area');
    return (fta && fta.shadowRoot && fta.shadowRoot.querySelector('textarea')) || deepAll(host).find((e) => e.tagName === 'TEXTAREA');
  };

  // Notizfeld öffnen → { host, ta, editing, near } oder { error }
  async function openNoteEditor() {
    const host = noteHost();
    if (!host) return { error: 'Profilnotiz-Feld nicht gefunden' };
    host.scrollIntoView({ block: 'center' });
    await sleep(400);
    // Bearbeitungsmodus öffnen: <j-setting-textarea edit-mode="true"> zeigt Textfeld + „Abbrechen“/„Speichern“
    const editing = () => host.getAttribute('edit-mode') === 'true' ||
      !!(host.shadowRoot && host.shadowRoot.querySelector('.secondary-container.edit-mode'));
    const ready = () => { const t = noteTextarea(host); return t && editing() ? t : null; };
    let ta = editing() ? await waitFor(ready, 1500) : null;
    if (!ta) {
      const sr = host.shadowRoot;
      const openers = [
        sr && sr.querySelector('.main-container .inner-container'),
        sr && sr.querySelector('.main-container'),
        sr && sr.querySelector('j-icon'),
        host,
      ].filter(Boolean);
      for (const o of openers) {
        await realClick(o);
        ta = await waitFor(ready, 1500);
        if (ta) break;
        o.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        ta = await waitFor(ready, 800);
        if (ta) break;
      }
      if (!ta) {
        // letzter Versuch: Bearbeitungsmodus direkt setzen
        host.setAttribute('edit-mode', 'true');
        ta = await waitFor(ready, 2000);
      }
    }
    if (!ta) {
      const t = noteTextarea(host);
      return { error: `Notiz-Eingabe nicht gefunden (edit-mode=${host.getAttribute('edit-mode')}, Textarea ${t ? 'vorhanden' : 'fehlt'})` };
    }
    // Knöpfe „Speichern“ / „Abbrechen“ unter dem Textfeld suchen (erst nahe am Feld, dann seitenweit)
    const exact = (texts, root) => clickables(root).find((e) => texts.includes(norm(e.innerText || e.textContent)));
    const near = (texts) => {
      let r = host;
      for (let i = 0; i < 6 && r; i++, r = r.parentElement) { const f = exact(texts, r); if (f) return f; }
      const d = openDialog();
      return (d && (exact(texts, dialogScope(d)) || exact(texts, d))) || exact(texts);
    };
    return { host, ta, editing, near };
  }

  async function cancelNote(ed) {
    const c = ed.near(['abbrechen']);
    if (c) await realClick(c);
    return !!c;
  }

  // neuen Inhalt eintragen und speichern; Erfolg = mustContain wird danach angezeigt (und mustNotContain nicht mehr)
  async function commitNote(ed, value, mustContain, mustNotContain = [], force = false) {
    const { host, ta, editing, near } = ed;
    const old = ta.value || '';
    if (CONFIG.DEBUG) { ta.style.outline = '4px solid #ffeb3b'; await sleep(CONFIG.DEBUG_PAUSE_MS); }
    ta.focus();
    setValue(ta, value);
    await sleep(600);
    if (CONFIG.DRY_RUN && !force) {
      setValue(ta, old);
      const c = await cancelNote(ed);
      return { ok: true, msg: `Notiz getestet (${c ? '„Abbrechen“ geklickt' : 'Abbrechen-Knopf nicht gefunden'}): "${value.replace(/\n/g, ' ⏎ ')}"` };
    }
    const save = await waitFor(() => near(['speichern']), 3000);
    if (!save) return { ok: false, msg: '„Speichern“-Knopf der Notiz nicht gefunden' };
    await realClick(save);
    // Prüfen: Nach dem Speichern bleibt das Feld offen und zeigt die gespeicherte Notiz.
    const good = (txt) => txt.includes(mustContain) && !mustNotContain.some((x) => txt.includes(x));
    const shows = () => {
      const t = noteTextarea(host);
      const shown = (t && t.value) || '';
      const attr = host.getAttribute('value') || '';
      if (good(attr)) return 'bestätigt';
      if (!editing() && good(shown)) return 'Feld geschlossen';
      return null;
    };
    let how = await waitFor(shows, 5000);
    if (!how) {
      // Attribut wird evtl. nicht aktualisiert: dann genügt, dass das offene Feld die Notiz weiter anzeigt
      await sleep(800);
      const t = noteTextarea(host);
      if (t && good(t.value || '')) how = 'Feld zeigt gespeicherte Notiz';
    }
    await sleep(500);
    return how ? { ok: true, msg: `Notiz gespeichert (${how})` }
      : { ok: false, msg: 'Notiz nicht gespeichert: Text fehlt nach „Speichern“' };
  }

  async function writeNote(source, kind = false, type = '') {
    const ed = await openNoteEditor();
    if (ed.error) return { ok: false, msg: ed.error };
    const old = (ed.ta.value || ed.host.getAttribute('value') || '').trim();
    const text = noteText(source, kind, Date.now(), type);
    if (old.includes(text.replace(/ am .*/, ''))) {
      await cancelNote(ed);
      return { ok: true, msg: 'Notiz schon vorhanden' };
    }
    return commitNote(ed, old ? old + '\n' + text : text, text);
  }

  // Moderator: eigene „Alter Sack … geblockt/blockiert …“-Zeilen entfernen, Whitelist-Zeile ergänzen
  async function writeModeratorNote(group) {
    return writeWhitelistNote(CONFIG.MOD_NOTE_TEXT.replace('{gruppe}', group));
  }
  async function writeWhitelistNote(line, force = false) {
    const ed = await openNoteEditor();
    if (ed.error) return { ok: false, msg: ed.error };
    const old = (ed.ta.value || ed.host.getAttribute('value') || '');
    const lines = old.split(/\r?\n/);
    const removed = lines.filter((l) => ownNoteRe().test(l));
    const kept = lines.filter((l) => !ownNoteRe().test(l)).filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1));
    if (!kept.some((l) => l.trim() === line)) kept.push(line);
    const value = kept.join('\n').replace(/^\n+|\n+$/g, '');
    if (value === old.trim()) { await cancelNote(ed); return { ok: true, msg: 'Notiz war bereits aktuell' }; }
    const r = await commitNote(ed, value, line, removed.map((x) => x.trim()).filter(Boolean), force);
    if (r.ok && removed.length) r.msg += ` – ${removed.length} alte Zeile(n) entfernt`;
    return r;
  }

  async function blockOnProfile() {
    const items = await openProfileMenu();
    if (!items) return { ok: false, msg: 'Profiloptionen (⋮) nicht gefunden' };
    if (items.some((e) => CONFIG.ALREADY_BLOCKED_TEXTS.some((t) => itemTitle(e).includes(t)))) {
      await closeProfileMenu();
      return { ok: true, msg: 'bereits ignoriert' };
    }
    const b = items.find((e) => CONFIG.BLOCK_TEXTS.some((t) => itemTitle(e).includes(t)) && !CONFIG.BLOCK_EXCLUDE.some((x) => itemTitle(e).includes(x)));
    if (!b) { await closeProfileMenu(); return { ok: false, msg: '„Profil ignorieren“ nicht im Menü gefunden' }; }
    await realClick(b);
    await sleep(1500);

    const dlg = await waitFor(openDialog, 3000);
    if (dlg) {
      const scope = dialogScope(dlg);
      if (CONFIG.DRY_RUN) {
        const c = clickables(scope).find((e) => norm(e.innerText || e.textContent) === 'abbrechen') ||
          findByTexts(CONFIG.CANCEL_TEXTS, [], scope) || findByTexts(CONFIG.CANCEL_TEXTS, [], dlg);
        if (c) await realClick(c); else { const x = scope.shadowRoot && scope.shadowRoot.querySelector('.j-modal__close'); if (x) await realClick(x); }
        return { ok: true, msg: 'Testmodus: Dialog „Profil ignorieren?“ gefunden, „Abbrechen“ geklickt' };
      }
      const exactly = (root) => clickables(root).find((e) => CONFIG.CONFIRM_TEXTS.includes(norm(e.innerText || e.textContent)));
      const c = exactly(scope) || exactly(dlg) ||
        findByTexts(CONFIG.CONFIRM_TEXTS, CONFIG.CANCEL_TEXTS.concat(CONFIG.BLOCK_EXCLUDE, ['weitere infos', 'profil ignorieren?']), scope) ||
        findByTexts(CONFIG.CONFIRM_TEXTS, CONFIG.CANCEL_TEXTS.concat(CONFIG.BLOCK_EXCLUDE, ['weitere infos']), dlg);
      if (!c) return { ok: false, msg: 'Bestätigen-Knopf im Dialog nicht gefunden' };
      await realClick(c);
      await sleep(1500);
    } else if (CONFIG.DRY_RUN) {
      return { ok: true, msg: 'Testmodus: kein Dialog erschienen – der Klick hat evtl. schon ignoriert!' };
    }
    return { ok: true, msg: 'ignoriert' };
  }

  async function processQueue() {
    const s = getState();
    const here = cleanPath(location.pathname);
    if (!s.running || !s.queue.length) return;
    if (s.queue[0].path !== here && idOf(s.queue[0].path) !== idOf(here)) {
      // falsche Seite (z. B. Weiterleitung) → Eintrag überspringen
      if (isProfilePage()) return;
      setState({ running: false, queue: [], count: 0 });
      return;
    }
    const p = panel();
    p.innerHTML = `<b>Alter-Filter</b>${CONFIG.DRY_RUN ? ' – <span style="color:#ffb300">Testmodus</span>' : ''}<br>`;
    p.appendChild(btn('Stopp', stop));
    const cur = s.queue[0];
    // Sonderaufträge aus der Opa-Liste: nur Notiz anpassen, nicht ignorieren
    if (cur.action === 'note' || cur.action === 'clean') {
      log(`${cur.name}: Notiz wird angepasst …`);
      await waitFor(profileType, 6000);
      await sleep(1500);
      let r;
      try { r = cur.action === 'note' ? await writeWhitelistNote(cur.line, true) : await cleanOwnNote(); } catch (e) { r = { ok: false, msg: 'Notiz-Fehler: ' + e.message }; }
      log(`${cur.name}: ${r.msg}`);
      const nx = getState();
      if (!nx.running) return;
      nx.queue.shift(); nx.count += 1;
      await sleep(rand(CONFIG.DELAY_MIN_MS / 2, CONFIG.DELAY_MAX_MS / 2));
      if (!nx.queue.length) { setState({ running: false, queue: [], count: 0, done: true }); location.href = nx.returnUrl || location.origin + '/member/'; }
      else { setState(nx); location.href = location.origin + nx.queue[0].path; }
      return;
    }
    if (isWhiteMember(cur)) {
      // Sicherheitsnetz: Whitelist-Mitglied nie anfassen
      s.queue.shift(); s.count += 1;
      if (!s.queue.length) { setState({ running: false, queue: [], count: 0, done: true }); location.href = s.returnUrl || location.origin + '/member/'; }
      else { setState(s); location.href = location.origin + s.queue[0].path; }
      return;
    }
    log(`Bearbeite ${cur.name} (${cur.ages.join('+')}) – ${s.count + 1}/${s.count + s.queue.length} …`);
    await visEnforce(visibilityFromDoc(document));
    await sleep(2500);

    // Sicherheitsnetz: Profiltyp auf der Profilseite nochmals prüfen
    const ptype = await waitFor(profileType, 4000);
    recordAccounts([{ path: here, name: cur.name, ages: profileAges().length ? profileAges() : cur.ages, type: ptype, online: profileOnline(), signs: profileSigns(document, profileAges()) }]);
    showTypes();
    // ehemalige Moderatoren: Kriterien erst hier auf dem Profil prüfen (Typ + aktuelles Alter)
    if (profileAges().length && ptype) setChecked(idOf(here), { name: cur.name, type: ptype, ages: profileAges() });
    if (cur.verify) {
      const ages = profileAges().length ? profileAges() : cur.ages || [];
      const c = { name: cur.name, type: ptype || cur.type, ages };
      if (!ages.length || !shouldBlock(c, whiteList(), cur.source || s.source)) {
        const who = cur.formerMod ? 'ehemaliger Moderator – ' : '';
        log(`${cur.name}: ${who}Profil geprüft (${c.type || '?'}, ${ages.join('+') || '?'} Jahre) – erfüllt die Kriterien nicht, wird nicht ignoriert`);
        s.queue.shift(); s.count += 1;
        await sleep(1500);
        if (!s.queue.length) { setState({ running: false, queue: [], count: 0, done: true }); location.href = s.returnUrl || location.origin + '/member/'; }
        else { setState(s); location.href = location.origin + s.queue[0].path; }
        return;
      }
      cur.ages = ages; cur.type = c.type;
    }
    if (!cur.force && ptype && !typeOkFor(ptype) && !isCoupleRuleType(ptype)) {
      noteType(ptype, cur.name);
      log(`${cur.name}: Profiltyp „${ptype}“ → übersprungen`);
      s.queue.shift(); s.count += 1;
      await sleep(1500);
      if (!s.queue.length) { setState({ running: false, queue: [], count: 0, done: true }); location.href = s.returnUrl || location.origin + '/member/'; }
      else { setState(s); location.href = location.origin + s.queue[0].path; }
      return;
    }

    // Platz auf der Ignorierliste (Limit) vor Notiz und Sperre klären
    const lim = s.limits || (s.limits = { displaced: 0, limitHit: 0 });
    let slot = true;
    try { slot = await ensureSlot(Object.assign({ source: cur.source || s.source }, cur), lim); } catch (e) { slot = true; }
    let noteMsg = '';
    if (CONFIG.WRITE_NOTE && slot) {
      let note;
      // Art: Sugar Daddy / Sugar Mom / Stufe-3-Bezeichnung (z. B. „Opa“, „Oma“, „Geronto-Paar“)
      const pAges = profileAges().length ? profileAges() : cur.ages;
      const kind = cur.kind || judge({ type: ptype || cur.type, ages: pAges }, cur.source || s.source).kind || toKind(cur.reason, ptype || cur.type);
      cur.kind = kind;
      try { note = await writeNote(cur.via || cur.source || s.source, kind, ptype || cur.type); } catch (e) { note = { ok: false, msg: 'Notiz-Fehler: ' + e.message }; }
      noteMsg = note.msg;
      log(`${cur.name}: ${noteMsg}`);
      await sleep(1000);
      if (!note.ok && CONFIG.NOTE_REQUIRED) {
        // ohne Notiz kein Ignorieren → als fehlgeschlagen merken und weiter
        if (!CONFIG.DRY_RUN) setFailed(here, noteMsg);
        const nx = getState();
        if (!nx.running) return;
        nx.queue.shift(); nx.count += 1;
        log(`${cur.name}: ${noteMsg} → NICHT ignoriert`);
        await sleep(2500);
        if (!nx.queue.length) { setState({ running: false, queue: [], count: 0, done: true }); location.href = nx.returnUrl || location.origin + '/member/'; }
        else { setState(nx); location.href = location.origin + nx.queue[0].path; }
        return;
      }
    }

    let res;
    if (!slot) res = { ok: false, limit: true, msg: 'Limit erreicht, nicht gesperrt' };
    else { try { res = await blockOnProfile(); } catch (e) { res = { ok: false, msg: 'Fehler: ' + e.message }; } }
    log(`${cur.name}: ${res.msg}${noteMsg ? ' · ' + noteMsg : ''}`);
    if (!CONFIG.DRY_RUN) { if (res.ok) { addDone(here, cur, 'Profil'); clearFailed(here); } else if (!res.limit) setFailed(here, res.msg); }

    const next = getState();
    next.limits = lim;
    if (!next.running) return;
    next.queue.shift();
    next.count += 1;
    if (!next.queue.length) {
      setState({ running: false, queue: [], count: 0, done: true });
      log(`Fertig: ${next.count} Profile bearbeitet. Zurück zur Suche …`);
      await sleep(3000);
      location.href = next.returnUrl || location.origin + '/member/';
      return;
    }
    setState(next);
    const wait = rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS);
    log(`${cur.name}: ${res.msg}. Nächstes Profil in ${Math.round(wait / 1000)} s …`);
    await sleep(wait);
    if (getState().running) location.href = location.origin + next.queue[0].path;
  }

  // ---------- Ignorierliste /ignore/ ----------
  // <form id="user_ignore"> mit <input name="user_ignore_name"> und <j-button class="ignore_user">Mitglied sperren</j-button>
  // Einträge: <div class="fav_menu_user"><a href="https://www.joyclub.de/my/ID.slug.html">Name</a> … <form id="user_ignore_stop_ID">
  const isIgnorePage = () => cleanPath(location.pathname) === CONFIG.IGNORE_PAGE_PATH;

  function parseIgnoreList(doc) {
    const out = {};
    doc.querySelectorAll('.fav_menu_user a[href*="/my/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/\/my\/(\d+)\.([^/]+?)\.html/);
      if (!m) return;
      const path = `/profile/${m[1]}.${m[2]}.html`;
      out[path] = { name: (a.textContent || '').trim(), url: location.origin + path, id: m[1] };
    });
    return out;
  }
  function saveIgnored(list) {
    gmSet(K_IGNORED, list);
    gmSet(K_IGNORED_TS, Date.now());
  }
  // Ignorierliste im Hintergrund abrufen (ohne die Seite zu verlassen)
  async function syncIgnoreList(force = false) {
    if (!force && Date.now() - gmGet(K_IGNORED_TS, 0) < CONFIG.IGNORE_SYNC_MIN * 60000) return getIgnored();
    try {
      const r = await jfetch(location.origin + CONFIG.IGNORE_PAGE_PATH + '/');
      const html = r.html;
      const list = parseIgnoreList(new DOMParser().parseFromString(html, 'text/html'));
      if (Object.keys(list).length || /user_ignore_name/.test(html)) saveIgnored(list);
      return list;
    } catch (e) {
      console.warn('[Alter-Filter] Ignorierliste nicht abrufbar', e);
      return getIgnored();
    }
  }

  const ignoreInput = () => document.querySelector('#user_ignore input[name="user_ignore_name"]');
  const ignoreButton = () => document.querySelector('#user_ignore j-button.ignore_user, #user_ignore .ignore_user');
  const pageErrorText = () => [...document.querySelectorAll('.error, .alert, .notice, .error_msg, .msg_error, [role=alert], j-toast, j-snackbar')]
    .filter(visible).map((e) => (e.innerText || e.textContent || '').trim()).filter(Boolean).join(' | ').slice(0, 200);

  function inIgnoreList(item) {
    const list = parseIgnoreList(document);
    if (list[item.path]) return true;
    const n = norm(item.name);
    return Object.values(list).some((e) => norm(e.name) === n);
  }

  function finishIgnoreRun(s, msg, done = true) {
    setState({ running: false, queue: [], count: 0, done });
    log(msg + (s.opa ? opaT(' Zurück zum Opa-Scan …') : ' Zurück zur Suche …'));
    setTimeout(() => { location.href = s.returnUrl || location.origin + '/member/'; }, 3000);
  }

  async function processIgnorePage() {
    let s = getState();
    const p = panel();
    p.innerHTML = `<b>Alter-Filter</b> – Ignorierliste${CONFIG.DRY_RUN ? ' – <span style="color:#ffb300">Testmodus</span>' : ''}<br>`;
    p.appendChild(btn('Stopp', () => {
      const st = getState(); setState({ running: false, queue: [], count: 0 });
      if (st.opa) setOpa(Object.assign(getOpa(), { running: false }));
      else if (st.evscan) setEv(Object.assign(getEv(), { running: false }));
      log('Gestoppt.'); if (st.returnUrl) location.href = st.returnUrl;
    }));
    await waitFor(ignoreInput, 8000);
    saveIgnored(parseIgnoreList(document));

    // Ergebnis des zuletzt abgeschickten Namens prüfen (nach dem Neuladen der Seite)
    if (s.pending) {
      const cur = s.pending;
      if (inIgnoreList(cur)) {
        addDone(cur.path, cur, 'Ignorierliste'); clearFailed(cur.path);
        log(`${cur.name}: ignoriert ✔`);
      } else {
        const err = pageErrorText();
        setFailed(cur.path, 'nicht in der Ignorierliste erschienen' + (err ? ': ' + err : ''));
        log(`${cur.name}: NICHT ignoriert${err ? ' – ' + err : ''}`);
      }
      s.pending = null; s.queue.shift(); s.count += 1;
      setState(s);
    }

    while (true) {
      s = getState();
      if (!s.running) return;
      if (!s.queue.length) { finishIgnoreRun(s, `Fertig: ${s.count} Profile bearbeitet.`); return; }
      const cur = s.queue[0];
      log(`${cur.name} (${(cur.ages || []).join('+')}) – ${s.count + 1}/${s.count + s.queue.length} …`);

      if (isWhiteMember(cur)) { s.queue.shift(); s.count += 1; setState(s); continue; }
      if (inIgnoreList(cur)) {
        addDone(cur.path, cur, 'Ignorierliste (bereits)'); clearFailed(cur.path);
        log(`${cur.name}: war bereits ignoriert`);
        s.queue.shift(); s.count += 1; setState(s); continue;
      }

      const input = ignoreInput();
      const button = ignoreButton();
      if (!input || !button) { finishIgnoreRun(s, 'Eingabefeld oder „Mitglied sperren“ nicht gefunden – abgebrochen.', false); return; }

      await sleep(rand(CONFIG.IGNORE_DELAY_MIN_MS, CONFIG.IGNORE_DELAY_MAX_MS));
      if (!getState().running) return;
      input.scrollIntoView({ block: 'center' });
      input.focus();
      setValue(input, cur.name);
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      if (CONFIG.DEBUG) { input.style.outline = '4px solid #ffeb3b'; await sleep(CONFIG.DEBUG_PAUSE_MS); input.style.outline = ''; }
      await sleep(400);
      // evtl. offenes Vorschlags-Menü schließen
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      if (CONFIG.DRY_RUN) {
        log(`Testmodus: „${cur.name}“ eingetragen, „Mitglied sperren“ NICHT geklickt.`);
        await sleep(1500);
        setValue(input, '');
        s.queue.shift(); s.count += 1; setState(s);
        continue;
      }

      // merken, was abgeschickt wird – das Formular lädt die Seite neu
      s.pending = cur; setState(s);
      await realClick(button);
      // Falls die Seite nicht neu lädt (AJAX): selbst prüfen
      const appeared = await waitFor(() => (inIgnoreList(cur) ? true : null), 8000);
      if (appeared) {
        s = getState(); s.pending = null; s.queue.shift(); s.count += 1; setState(s);
        addDone(cur.path, cur, 'Ignorierliste'); clearFailed(cur.path);
        log(`${cur.name}: ignoriert ✔`);
        continue;
      }
      // weder neu geladen noch erschienen → Formular direkt absenden (einmalig)
      const form = document.getElementById('user_ignore');
      if (form && getState().pending) { setValue(input, cur.name); form.submit(); }
      return; // nach dem Neuladen geht es oben mit „pending“ weiter
    }
  }

  // ---------- Geburtsjahre aller gesehenen Konten ----------
  // JOYclub zeigt nur das Alter. Aus „Alter a am Tag t“ folgt: Geburtstag liegt in (t − (a+1) Jahre, t − a Jahre].
  // Jede weitere Sichtung grenzt den Zeitraum ein; liegen beide Grenzen im selben Jahr, ist das Geburtsjahr exakt.
  // Pro Konto eine Liste „persons“ – bei Paaren (Paar, Männer-Paar, Frauen-Paar …) zwei Einträge in Kartenreihenfolge.
  const K_ACCOUNTS = 'jaf_accounts'; // { path: { name, url, type, persons: [{ lo, hi }], first, last } }
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function birthRange(age, t = new Date()) {
    const y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
    return { lo: isoDay(new Date(y - age - 1, m, d + 1)), hi: isoDay(new Date(y - age, m, d)) };
  }
  function mergeRange(old, cur) {
    if (!old || !old.lo || !old.hi) return cur;
    const lo = old.lo > cur.lo ? old.lo : cur.lo;
    const hi = old.hi < cur.hi ? old.hi : cur.hi;
    return lo <= hi ? { lo, hi } : cur; // widersprüchlich (z. B. Alter geändert) → neu beginnen
  }
  function birthYear(r) {
    if (!r || !r.lo) return '';
    const a = r.lo.slice(0, 4), b = r.hi.slice(0, 4);
    return a === b ? a : `${a}/${b}`;
  }
  const getAccounts = () => gmGet(K_ACCOUNTS, {});

  // ---------- Sternzeichen → Geburtszeitraum eingrenzen ----------
  // Grenztage großzügig ±1 Tag. Passt das Sternzeichen nicht in den Zeitraum, wird es ignoriert.
  const ZODIAC = { Widder: [3, 21, 4, 20], Stier: [4, 21, 5, 20], Zwillinge: [5, 21, 6, 21], Krebs: [6, 22, 7, 22], 'Löwe': [7, 23, 8, 23],
    Jungfrau: [8, 24, 9, 23], Waage: [9, 24, 10, 23], Skorpion: [10, 24, 11, 22], 'Schütze': [11, 23, 12, 21], Steinbock: [12, 22, 1, 20],
    Wassermann: [1, 21, 2, 19], Fische: [2, 20, 3, 20] };
  const zodiacName = (t) => Object.keys(ZODIAC).find((k) => norm(k) === norm(t)) || '';
  function applyZodiac(r, sign) {
    const z = ZODIAC[zodiacName(sign)];
    if (!z || !r || !r.lo || !r.hi) return r;
    const lo = Date.parse(r.lo), hi = Date.parse(r.hi);
    let a = null, b = null;
    for (let y = +r.lo.slice(0, 4) - 1; y <= +r.hi.slice(0, 4) + 1; y++) {
      const s0 = new Date(y, z[0] - 1, z[1] - 1).getTime();
      const e0 = new Date(z[2] < z[0] ? y + 1 : y, z[2] - 1, z[3] + 1).getTime();
      const x0 = Math.max(s0, lo), x1 = Math.min(e0, hi);
      if (x0 <= x1) { a = a == null ? x0 : Math.min(a, x0); b = b == null ? x1 : Math.max(b, x1); }
    }
    if (a == null) return r; // keine Überschneidung → Sternzeichen ignorieren
    return { lo: isoDay(new Date(a)), hi: isoDay(new Date(b)), sign: zodiacName(sign) };
  }
  // Sternzeichen aus dem Steckbrief: Einzelprofil → [Zeichen]; Paar → je Person { g: universal-gender, age, sign }
  // (die Steckbriefe stehen doppelt im DOM – erstes Vorkommen zählt)
  function profileSigns(doc = document, ages = []) {
    const out = [];
    const seen = new Set();
    for (const up of doc.querySelectorAll('.profile-sed-card__upper-info')) {
      const gi = up.querySelector('j-gender-icon[universal-gender]');
      const ageTxt = gi ? ((gi.parentElement && gi.parentElement.textContent) || '') : '';
      const age = gi ? +((ageTxt.match(/(\d{2,3})\s*Jahre/) || [])[1] || 0) : 0;
      const prop = [...up.querySelectorAll('.profile-sed-card__property')].find((p) => /sternzeichen/i.test((p.querySelector('.profile-sed-card__headline') || {}).textContent || ''));
      const sign = prop ? ((prop.querySelector('.profile-sed-card__content') || {}).textContent || '').trim() : '';
      const key = gi ? `${gi.getAttribute('universal-gender')}|${age}` : 'single';
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ g: gi ? gi.getAttribute('universal-gender') : '', age, sign: zodiacName(sign) });
    }
    if (!out.length) return [];
    if (ages.length <= 1) return [out[0].sign || ''];
    // Paar: Personen den Altersangaben zuordnen (gleiches Alter → Reihenfolge: Frau zuerst)
    const pool = out.slice().sort((a, b) => (a.g === '2' ? -1 : 0) - (b.g === '2' ? -1 : 0));
    return ages.map((a) => { const i = pool.findIndex((p) => p.age === a); return i < 0 ? '' : pool.splice(i, 1)[0].sign || ''; });
  }

  // ---------- Typwechsel ----------
  // Ein Profil wechselt den Typ (z. B. Mann → Paar). Festgehalten in Konten, Gedächtnis, Profil-Infos und Fickliste
  // („Typ geändert: A → B“, in der Fickliste als Archiv-Stand). Vom Skript ignorierte Mitglieder werden neu beurteilt:
  // passt die Regel nicht mehr → entsperren (Schnittstelle, sonst Seite) und die Skript-Zeile der Notiz entfernen;
  // passt sie weiter, aber mit anderer Bezeichnung → Notiz anpassen. Von Hand Gesperrte bleiben unberührt.
  const K_TYPE_Q = 'jaf_type_q';
  function typeChangeQueue(list) {
    const q = gmGet(K_TYPE_Q, []) || [];
    for (const c of list) if (!q.some((x) => x.path === c.path && x.to === c.to)) q.push(c);
    gmSet(K_TYPE_Q, q.slice(-500));
    setTimeout(() => { typeChangeRun().catch(() => {}); }, 3000);
  }
  const typeWhy = (c) => `Typ geändert: ${c.from} → ${c.to}`;
  function typeChangeRecord(c) {
    const why = typeWhy(c);
    // Gedächtnis
    const m = bigGet1(K_MEM, c.path);
    if (m) {
      m.type = c.to;
      m.hist = (m.hist || []).concat({ ts: c.ts, st: m.status || '', src: '', why }).slice(-20);
      bigSet1(K_MEM, c.path, m);
    }
    // Protokoll-Eintrag (Skript-Sperre): Typ mitziehen
    const L = getLog();
    if (L[c.path]) { L[c.path].type = c.to; L[c.path].typeHist = (L[c.path].typeHist || []).concat({ ts: c.ts, from: c.from, to: c.to }).slice(-10); gmSet(K_LOG, L); }
    // Fickliste: Typ, Verlauf und Archiv-Stand
    const id = idOf(c.path);
    const q = id && flGet(id);
    if (q) {
      q.type = c.to;
      q.hist = (q.hist || []).concat({ ts: c.ts, why });
      q.__keepStatusAt = true;
      flPut(q);
      try { flAddStandData(id, why, { type: c.to }); } catch (e) { /* kein Archiv */ }
    }
  }
  let typeBusy = false;
  async function typeChangeRun() {
    if (IN_FRAME || typeBusy) return;
    const q = gmGet(K_TYPE_Q, []) || [];
    if (!q.length) return;
    // erst festhalten (geht immer), Sperren nur, wenn gerade nichts anderes läuft
    const todo = [];
    for (const c of q) { if (!c.rec) { typeChangeRecord(c); c.rec = true; } todo.push(c); }
    gmSet(K_TYPE_Q, todo);
    if (scanActive() || lockedByOther()) return;
    typeBusy = true;
    let locked = false;
    try {
      if (!(await acquireLock('Typwechsel'))) return;
      locked = true;
      const rest = [];
      for (const c of todo) {
        try { await typeChangeJudge(c); } catch (e) { if (e.fatal) { rest.push(c); break; } }
      }
      gmSet(K_TYPE_Q, rest);
    } finally {
      if (locked) releaseLock();
      typeBusy = false;
    }
  }
  async function typeChangeJudge(c) {
    const L = getLog(), e = L[c.path];
    const ign = getIgnored();
    const ignored = Object.keys(ign).some((p) => idOf(p) === idOf(c.path));
    if (!e || e.unblocked || handMade(e) || !ignored) return; // nur Skript-Sperren
    const acc = getAccounts(), mem = getMem();
    const a = acc[c.path], m = mem[c.path];
    const ages = agesNow(c.path, acc, e, m);
    const cand = { type: c.to, ages, name: e.name || c.name, path: c.path };
    const srcs = [...new Set(Object.keys((a && a.srcs) || {}).concat([e.source, m && m.src]).filter((x) => x && x !== 'Sync'))];
    const bs = isWhiteMember(cand) ? null : bestSource(cand, srcs.length ? srcs : [ALTBESTAND]);
    const url = e.url || location.origin + c.path;
    if (!bs) {
      if (CONFIG.DRY_RUN) { console.log('[Alter-Filter] Testlauf: würde entsperren (Typ gewechselt)', e.name); return; }
      const r = await bgUnignore(idOf(c.path));
      if (!r || !r.ok) throw new Error('Entsperren fehlgeschlagen');
      markUnblocked(c.path, e, `entsperrt: Typ gewechselt (${c.from} → ${c.to})`);
      try { await actJob({ path: c.path, url, name: e.name, action: 'clean' }, 'Typwechsel'); } catch (err) { if (err.fatal) throw err; }
      console.log('[Alter-Filter] entsperrt: Typ gewechselt', e.name, c.from, '→', c.to);
      return;
    }
    if (kindLabel(bs.j.kind) !== kindLabel(entryKind(e))) {
      if (CONFIG.DRY_RUN) return;
      const r = await actJob({ path: c.path, url, name: e.name, action: 'sync', kind: bs.j.kind, source: e.source || bs.src, ts: e.ts || Date.now(), block: false }, 'Typwechsel');
      if (r && r.result === 'note') { const L2 = getLog(); if (L2[c.path]) { L2[c.path].kind = bs.j.kind; gmSet(K_LOG, L2); } }
    }
  }
  setInterval(() => { try { if (!IN_FRAME && (gmGet(K_TYPE_Q, []) || []).length) typeChangeRun().catch(() => {}); } catch (e) { /* weiter */ } }, 30000);

  // items: [{ path, url?, name?, ages: [..], type? }]
  function recordAccounts(items) {
    if (!items || !items.length) return;
    const onlineUpdates = [], typeChanges = [];
    const acc = getAccounts();
    const today = isoDay(new Date());
    let changed = false;
    for (const it of items) {
      if (!it || !it.path || !it.ages || !it.ages.length) continue;
      const old = acc[it.path];
      const rec = old ? Object.assign({}, old) : { first: today };
      if (it.name) rec.name = it.name;
      if (it.type && isUnknownType(it.type)) noteType(it.type, it.name || it.path);
      if (it.name && whiteList().includes(norm(it.name))) learnWhiteUrl(it.name, it.path);
      rec.url = it.url || location.origin + it.path;
      // Typwechsel (z. B. Mann → Paar): festhalten und später neu beurteilen
      if (old && old.type && it.type && !/^Typ /.test(old.type) && !/^Typ /.test(it.type) && normType(old.type) !== normType(it.type)) {
        rec.typeHist = (old.typeHist || []).concat({ ts: Date.now(), from: old.type, to: it.type }).slice(-10);
        typeChanges.push({ path: it.path, name: it.name || old.name || '', from: old.type, to: it.type, ts: Date.now() });
      }
      if (it.type) rec.type = it.type;
      const prev = old && old.persons && old.persons.length === it.ages.length ? old.persons : [];
      rec.persons = it.ages.map((a, i) => {
        const sign = ((it.signs || [])[i]) || (prev[i] && prev[i].sign) || '';
        const r = mergeRange(prev[i], birthRange(a));
        const z = sign ? applyZodiac(r, sign) : r;
        return z.sign || !sign ? z : r;
      });
      rec.last = today;
      if (it.online) {
        rec.online = mergeOnline(rec.online, it.online);
        if (rec.online !== (old && old.online)) onlineUpdates.push([it.path, rec.online]);
      }
      if (it.cardOnline) rec.seenOnline = Date.now();
      // „Profil zuletzt aufgerufen“ (für das Mischen fremder Sicherungen); höchstens alle 10 min schreiben
      if (it.visited && Date.now() - (rec.visited || 0) > 10 * 60000) rec.visited = Date.now();
      if (JSON.stringify(rec) !== JSON.stringify(old)) { acc[it.path] = rec; changed = true; }
    }
    if (changed) gmSet(K_ACCOUNTS, acc);
    if (typeChanges.length) typeChangeQueue(typeChanges);
    // „zuletzt online“ auch in den zutreffenden Listen (ignoriert / vorgemerkt) speichern
    if (onlineUpdates.length) {
      const l = gmGet(K_LOG, {}), w = gmGet(K_WATCH, {});
      let lc = false, wc = false;
      for (const [path, o] of onlineUpdates) {
        if (l[path]) { l[path].online = o; lc = true; }
        if (w[path]) { w[path].online = o; wc = true; }
      }
      if (lc) gmSet(K_LOG, l);
      if (wc) gmSet(K_WATCH, w);
    }
  }

  // { text: 'Online vor einer Stunde' | 'Keine Angabe' | …, at: Abrufzeitpunkt (ms) }
  // gleicher Text innerhalb von 10 min → alter Eintrag bleibt (kein Dauer-Schreiben alle 5 s)
  function mergeOnline(old, cur) {
    if (old && old.text === cur.text && cur.at - old.at < 10 * 60000) return old;
    return cur;
  }

  // Profilkopf: <div class="profile-base-info__line-3"><span class="online-status is_offline"></span> Online vor einer Stunde <div>• JOYCE App</div></div>
  function profileOnline() {
    const line2 = document.querySelector('.profile-base-info__line-2');
    if (!line2) return null; // Profilkopf noch nicht geladen
    const box = line2.parentElement || document;
    const line3 = box.querySelector('.profile-base-info__line-3') || document.querySelector('.profile-base-info__line-3');
    let text = '';
    if (line3) {
      const c = line3.cloneNode(true);
      c.querySelectorAll('div, template, style').forEach((e) => e.remove());
      text = (c.textContent || '').replace(/\s+/g, ' ').replace(/•/g, '').trim();
      if (!text) {
        const st = line3.querySelector('.online-status');
        if (st && st.classList.contains('is_online')) text = 'Online';
      }
    }
    return { text: text || 'Keine Angabe', at: Date.now() };
  }
  const birthYearsOf = (path) => ((getAccounts()[path] || {}).persons || []).map(birthYear);

  // Alter aus dem Profilkopf: <div class="profile-base-info__line-2"><span>Mann</span> <span>52 Jahre</span> …
  // Paare z. B. „48 + 50 Jahre“
  function profileAges() {
    const spans = [...document.querySelectorAll('.profile-base-info__line-2 span')];
    const s = spans.map((e) => e.textContent || '').find((t) => /jahre/i.test(t));
    if (!s) return [];
    return (s.match(/\d{2,3}/g) || []).map(Number).filter((n) => n >= 18 && n <= 120).slice(0, 2);
  }
  function profileName() {
    const lab = [...document.querySelectorAll('[aria-label^="Profil von "]')].map((e) => e.getAttribute('aria-label'))[0];
    return lab ? lab.replace(/^Profil von /, '').split(',')[0].trim() : '';
  }

  // überall auf JOYclub: alle sichtbaren Mitglieder-Karten (Suche, Freunde, Besucher …) und den Profilkopf erfassen
  function recordVisibleAccounts() {
    if (/[?&]fl=/.test(location.search)) return; // Fickliste-Ansicht auf dem eigenen Profil
    const items = [];
    document.querySelectorAll('j-member-card[age]').forEach((card) => {
      const a = card.closest('a[href*="/profile/"]');
      if (!a) return;
      const path = cleanPath(new URL(a.href, location.origin).pathname);
      if (!CONFIG.PROFILE_PATH_RE.test(path)) return;
      const ages = [card.getAttribute('age'), card.getAttribute('age2')].map(Number).filter((n) => n >= 18 && n <= 120);
      items.push({ path, name: card.getAttribute('user-name') || '', ages, type: cardType(card), cardOnline: card.getAttribute('is-online') === 'true' });
    });
    if (isProfilePage()) {
      const ages = profileAges();
      if (ages.length) items.push({ path: cleanPath(location.pathname), name: profileName(), ages, type: profileType(), online: profileOnline(), signs: profileSigns(document, ages), visited: true });
    }
    recordAccounts(items);
  }
  setInterval(() => { try { recordVisibleAccounts(); } catch (e) { console.warn('[Alter-Filter] Geburtsjahr', e); } }, 5000);

  // ---------- Vormerkliste: genau 1 Jahr unter der Schwelle (je Gruppe und Quelle; nur Einzelpersonen) ----------
  // { path: { name, url, type, ages, persons: [{lo,hi}], added } }
  const K_WATCH = 'jaf_watch';
  const getWatch = () => gmGet(K_WATCH, {});
  function updateWatch(cards, log_ = getLog(), ign = getIgnored(), source = '') {
    const w = getWatch();
    const white = whiteList();
    const today = isoDay(new Date());
    const acc = getAccounts();
    let changed = false;
    for (const c of cards) {
      const g = groupOfType(c.type);
      const single = g && g !== 'p' && !isCoupleType(c.type) && c.ages.length === 1;
      const eligible = single && CONFIG.GROUPS[g].ignore && c.ages[0] === vals(g, source || 'Suche')[2] - 1 && !white.includes(norm(c.name)) && !isBlocked(c.path, log_, ign);
      if (eligible) {
        const persons = ((acc[c.path] || {}).persons) || c.ages.map((x) => birthRange(x));
        const prev = w[c.path];
        const online = (prev && prev.online) || (acc[c.path] || {}).online;
        const rec = { name: c.name, url: c.url || location.origin + c.path, type: c.type, ages: c.ages, persons, added: (prev && prev.added) || today,
          source: betterSource(prev && prev.source, source || 'Suche') };
        if (online) rec.online = online;
        if (JSON.stringify(rec) !== JSON.stringify(prev)) { w[c.path] = rec; changed = true; if (!prev) memNote(c.path, 'watch', rec); }
      } else if (w[c.path] && (isBlocked(c.path, log_, ign) || white.includes(norm(c.name)) || !single)) {
        delete w[c.path]; changed = true;
      }
    }
    if (changed) gmSet(K_WATCH, w);
  }
  function removeFromWatch(path) {
    const w = getWatch();
    if (w[path]) { delete w[path]; gmSet(K_WATCH, w); }
  }
  // Alter heute aus Geburtszeitraum: sicher älter als MAX_AGE, wenn selbst das späteste mögliche Geburtsdatum
  // mindestens MAX_AGE+1 Jahre zurückliegt
  function surelyOlderThan(r, limit, now = new Date()) {
    if (!r || !r.hi) return false;
    const [y, m, d] = r.hi.split('-').map(Number);
    return now >= new Date(y + limit + 1, m - 1, d);
  }
  // Vorgemerkte, die die Grenze inzwischen überschritten haben
  function dueFromWatch() {
    const w = getWatch();
    const acc = getAccounts();
    const log_ = getLog();
    const ign = getIgnored();
    const white = whiteList();
    const due = [];
    for (const [path, r] of Object.entries(w)) {
      if (isBlocked(path, log_, ign) || isWhiteMember({ name: r.name, path }, white)) { removeFromWatch(path); continue; }
      const persons = ((acc[path] || {}).persons) || r.persons || [];
      if (!persons.length) continue;
      const g = groupOfType(r.type);
      if (!g || g === 'p' || !CONFIG.GROUPS[g].ignore) continue;
      const t = vals(g, r.source || 'Suche')[2];
      if (persons.some((pr) => surelyOlderThan(pr, t - 1))) {
        due.push({ path, url: r.url || location.origin + path, name: r.name, ages: r.ages || [], type: r.type || '', source: r.source || 'Suche', fromWatch: true,
          kind: g === 'f' ? 'oma' : 'opa' });
      }
    }
    return due;
  }

  // ---------- Export ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  function downloadCsv(prefix, header, rows) {
    const esc = (v) => { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [header.join(';'), ...rows.map((r) => r.map(esc).join(';'))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const now = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `${prefix}_${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const fmtTs = (t) => { const d = new Date(t); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const onlineCols = (o) => (o ? [o.text || '', o.at ? fmtTs(o.at) : ''] : ['', '']);
  const deDay = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

  // ---------- Sicherung aller Daten (JSON) ----------
  // Enthält Einstellungen, Protokoll (Gesperrte), Ignorierliste, alle Konten, Vorgemerkte, Whitelist, Gruppen, Gedächtnis usw.
  // Nicht enthalten: laufende Vorgänge/Sperren und die Fehlersuche-Listen.
  const BACKUP_SKIP = /^(jaf_state|jaf_lock|jaf_gate|jaf_login_|jaf_vis_run|jaf_bg_job_|jaf_peek|jaf_opa$|jaf_evscan$|jaf_ms_resume|jaf_evscan_failures|jaf_ms_failures|jaf_ms_single_age_couples|jaf_failed)/;
  function fullBackup() {
    const data = {};
    for (const k of GM_listValues()) {
      if (!k.startsWith('jaf_') || k.includes('|') || k.includes('#') || BACKUP_SKIP.test(k) || BIG_KEYS.includes(k) || /^jaf_fl/.test(k)) continue;
      data[k] = GM_getValue(k);
    }
    for (const n of BIG_KEYS) data[n] = bigGet(n, {});
    return { format: 'opa-scan-backup', version: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '', ts: Date.now(), data };
  }
  function downloadJson(prefix, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a');
    const now = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `${prefix}_${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  // Fickliste: verschlüsselt mit dem eigenen Nick (kein durchsuchbarer Klartext in der Datei)
  async function downloadBackup() {
    const b = fullBackup();
    const fl = flBackupPart();
    let hint = '';
    if (Object.keys(fl).length) {
      const nick = ownNick();
      if (nick) { b.fl = await flEncrypt(fl, nick); b.flHint = 'Fickliste verschlüsselt (Schlüssel: dein Nick)'; hint = b.flHint; }
      else hint = 'Fickliste NICHT gesichert: eigener Nick unbekannt (Seite mit Kopfzeile öffnen)';
    }
    downloadJson('opa-scan-sicherung', b);
    if (hint) flToast(`Sicherung gespeichert · ${hint}`, 6000);
    return Object.keys(b.data).length;
  }
  function restoreBackup() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      let b;
      try { b = JSON.parse(await file.text()); } catch (e) { alert('Die Datei ist keine gültige Sicherung.'); return; }
      if (!b || b.format !== 'opa-scan-backup' || !b.data) { alert('Die Datei ist keine Sicherung des Opa-Scans.'); return; }
      const n = Object.keys(b.data).length;
      if (!confirm(`Sicherung vom ${fmtTs(b.ts)} (Version ${b.version || '?'}, ${n} Bereiche${b.fl ? ', Fickliste verschlüsselt' : ''}) wiederherstellen?\n\nAlle aktuellen Daten werden dabei ersetzt.`)) return;
      // Fickliste entschlüsseln (eigener Nick; nach Nick-Wechsel fragen)
      let fl = null, keepFl = false;
      if (b.fl) {
        let nick = ownNick();
        fl = nick ? await flDecrypt(b.fl, nick) : null;
        while (!fl) {
          const v = await askPopup({ title: 'Fickliste verschlüsselt', lines: ['Die Fickliste wurde unter einem anderen Nick gesichert.', 'Wie hieß dein Nick beim Export?'],
            buttons: [{ label: 'Nick eingeben …', value: 'nick', primary: true }, { label: 'Ohne Fickliste wiederherstellen', value: 'skip' }, { label: 'Abbrechen', value: null, focus: true }] });
          if (!v) return;
          if (v === 'skip') { keepFl = true; break; }
          nick = await flPrompt('Nick beim Export', ['Groß- und Kleinschreibung spielt keine Rolle.'], nick || '', 'Entschlüsseln');
          if (nick) fl = await flDecrypt(b.fl, nick);
        }
      } else keepFl = true;
      for (const k of GM_listValues()) if (k.startsWith('jaf_') && !BACKUP_SKIP.test(k) && k !== K_STORE_V && !(keepFl && /^jaf_fl/.test(k))) GM_deleteValue(k);
      if (fl) for (const [k, v] of Object.entries(fl)) if (/^jaf_fl/.test(k)) GM_setValue(k, v);
      for (const nme of BIG_KEYS) if (BIG[nme]) BIG[nme].loaded = false;
      if (!storeNeedsMigration()) { const l = GM_getValue(K_STORE_V, []) || []; GM_setValue(K_STORE_V, [...new Set(l.concat(BIG_KEYS))]); }
      for (const [k, v] of Object.entries(b.data)) { if (BIG_KEYS.includes(k)) bigSet(k, v); else if (k !== K_STORE_V) GM_setValue(k, v); }
      alert('Sicherung wiederhergestellt. Die Seite wird neu geladen.');
      location.reload();
    });
    inp.click();
  }
  // ---------- Fremde Datensicherung importieren (mischen) ----------
  // Übernimmt nur Wissen über ANDERE Mitglieder: Konten (Typ, Geburtszeiträume, Sternzeichen, Online, Größe/Gewicht),
  // Prüf-Cache, Geschlechts-Zuordnung, unbekannte Profiltypen. Nicht: Partys/AWO, Einstellungen, Whitelist, Sperren,
  // Ignorierliste, Gedächtnis, Vormerkliste, Sichtungen, Scan-Zustände, Fickliste.
  // Abgleich über die Profil-ID; „Profil zuletzt aufgerufen“ entscheidet (unbekannt = 01.01.1970),
  // bei Gleichstand der vollständigere Eintrag, dann der eigene. Geburtszeiträume werden immer geschnitten.
  function accCompleteness(r) {
    if (!r) return 0;
    let n = 0;
    for (const k of ['name', 'type', 'url', 'online', 'last', 'first']) if (r[k]) n++;
    for (const q of r.persons || []) { if (q.lo) n++; if (q.sign) n++; }
    for (const q of (r.fig && r.fig.persons) || []) { if (figNum(q.h)) n++; if (figNum(q.w)) n++; }
    return n;
  }
  function mergeAccountRec(own, fr) {
    const fv = fr.visited || 0, ov = own.visited || 0;
    const foreignWins = fv > ov || (fv === ov && accCompleteness(fr) > accCompleteness(own));
    const base = JSON.parse(JSON.stringify(foreignWins ? fr : own));
    const other = foreignWins ? own : fr;
    // Personen: Geburtszeiträume schneiden, Sternzeichen/Größe/Gewicht ergänzen
    const a = base.persons || [], b = other.persons || [];
    if (a.length && a.length === b.length) {
      base.persons = a.map((p, i) => {
        const q = b[i] || {};
        const r = (p.lo && q.lo) ? mergeRange(p, q) : (p.lo ? p : q);
        const out = Object.assign({}, q, p, { lo: r.lo, hi: r.hi });
        if (!out.sign && q.sign) out.sign = q.sign;
        for (const k of ['h', 'w']) if (out[k] == null && q[k] != null) out[k] = q[k];
        return out;
      });
    } else if (!a.length && b.length) base.persons = b;
    if (other.online && (!base.online || (other.online.at || 0) > (base.online.at || 0))) base.online = other.online;
    if (other.fig && (!base.fig || (other.fig.ts || 0) > (base.fig.ts || 0))) base.fig = other.fig;
    for (const k of ['first']) if (other[k] && (!base[k] || other[k] < base[k])) base[k] = other[k];
    for (const k of ['last', 'seenOnline', 'visited']) if (other[k] && (!base[k] || other[k] > base[k])) base[k] = other[k];
    return { rec: base, foreignWins };
  }
  function mergeForeignData(d) {
    const st = { neu: 0, akt: 0, eigen: 0, checkedNeu: 0, typen: 0, gender: 0 };
    // Konten
    const acc = getAccounts();
    const byId = {};
    for (const p of Object.keys(acc)) { const id = idOf(p); if (id) byId[id] = p; }
    for (const [fp, fr] of Object.entries(d.jaf_accounts || {})) {
      if (!fr || typeof fr !== 'object') continue;
      const id = idOf(fp);
      const op = (id && byId[id]) || (acc[fp] ? fp : null);
      if (!op) { acc[fp] = fr; if (id) byId[id] = fp; st.neu++; continue; }
      const { rec, foreignWins } = mergeAccountRec(acc[op], fr);
      if (JSON.stringify(rec) !== JSON.stringify(acc[op])) { acc[op] = rec; if (foreignWins) st.akt++; else st.eigen++; }
      else st.eigen++;
    }
    gmSet(K_ACCOUNTS, acc);
    // Prüf-Cache: neuerer Eintrag gewinnt
    const ch = getChecked();
    for (const [id, e] of Object.entries(d.jaf_checked || {})) {
      if (!e) continue;
      if (!ch[id] || (e.ts || 0) > (ch[id].ts || 0)) { ch[id] = e; st.checkedNeu++; }
    }
    gmSet(K_CHECKED, ch);
    // Geschlechts-Zuordnung: Belege addieren (gedeckelt)
    const gm = gmGet(K_GENDER, {}) || {};
    for (const [num, titles] of Object.entries(d[K_GENDER] || {})) {
      const e = gm[num] || (gm[num] = {});
      for (const [t, n] of Object.entries(titles || {})) { const v = Math.min(20, (e[t] || 0) + (+n || 0)); if (v !== e[t]) { e[t] = v; st.gender++; } }
    }
    gmSet(K_GENDER, gm);
    // unbekannte Profiltypen: Namen vereinigen
    const ty = getTypes();
    for (const [t, names] of Object.entries(d[K_TYPES] || {})) {
      const l = new Set(ty[t] || []); const n0 = l.size;
      for (const x of names || []) l.add(x);
      if (l.size !== n0 || !ty[t]) { ty[t] = [...l]; st.typen++; }
    }
    gmSet(K_TYPES, ty);
    return st;
  }
  function importForeignBackup() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      let b;
      try { b = JSON.parse(await file.text()); } catch (e) { alert('Die Datei ist keine gültige Sicherung.'); return; }
      if (!b || b.format !== 'opa-scan-backup' || !b.data) { alert(opaT('Die Datei ist keine Sicherung des Opa-Scans.')); return; }
      const n = Object.keys(b.data.jaf_accounts || {}).length;
      if (!confirm(`Fremde Sicherung vom ${fmtTs(b.ts)} (Version ${b.version || '?'}) mit ${n.toLocaleString('de-DE')} Konten einmischen?\n\n` +
        'Übernommen wird nur Wissen über andere Mitglieder (Typ, Geburtszeiträume, Sternzeichen, Online-Angaben, Größe/Gewicht, geprüfte Profile).\n' +
        'Deine Einstellungen, Whitelist, Ignorierliste, Partys und Fickliste bleiben unverändert.')) return;
      const st = mergeForeignData(b.data);
      alert(`Fremde Sicherung eingemischt.\n\nKonten: ${st.neu} neu · ${st.akt} aktualisiert · ${st.eigen} eigene behalten\n` +
        `Geprüfte Profile: ${st.checkedNeu} übernommen\nProfiltypen: ${st.typen} ergänzt · Geschlechts-Zuordnung: ${st.gender} ergänzt`);
    });
    inp.click();
  }
  // einmaliger Umbau des Speichers (1.74): vorher Sicherung anbieten
  async function storeMigrationInit() {
    if (IN_FRAME || !storeNeedsMigration()) return;
    const k = 'jaf_store_mig_ask';
    const last = GM_getValue(k, 0);
    if (Date.now() - last < 60000) return; // ein anderer Tab fragt gerade
    GM_setValue(k, Date.now());
    const v = await askPopup({ title: opaT('Opa-Scan: Datenspeicher wird umgebaut'), lines: [
      'Ab Version 1.74 speichert das Skript jedes Mitglied einzeln – das ist schneller und robuster.',
      'Vor dem einmaligen Umbau kannst Du eine Sicherung aller Daten herunterladen (empfohlen). Die alten Daten werden erst gelöscht, wenn jeder Eintrag geprüft ist.'],
    buttons: [{ label: 'Sicherung herunterladen und umbauen', value: 'backup', focus: true }, { label: 'Ohne Sicherung umbauen', value: 'go' }] });
    if (v === 'backup') { downloadBackup(); await sleep(1500); }
    if (v !== 'backup' && v !== 'go') { GM_setValue(k, 0); return; }
    const r = migrateStores();
    GM_setValue(k, 0);
    if (r.failed.length) alert(`Umbau des Speichers teilweise fehlgeschlagen (${r.failed.join(', ')}). Diese Daten bleiben im alten Format und werden beim nächsten Aufruf erneut umgebaut.`);
    else console.log('[Alter-Filter] Speicher umgebaut:', r.ok.join(', '));
  }

  // jede vorkommende „Online vor …“-Angabe nur einmal (zum späteren Umrechnen in ein Datum)
  function exportOnlineTexts() {
    const stat = {};
    const add = (o) => {
      if (!o || !o.text) return;
      const s = stat[o.text] || (stat[o.text] = { n: 0, first: o.at, last: o.at });
      s.n++; if (o.at < s.first) s.first = o.at; if (o.at > s.last) s.last = o.at;
    };
    Object.values(getAccounts()).forEach((r) => add(r.online));
    const rows = Object.entries(stat).sort((a, b) => b[1].n - a[1].n)
      .map(([text, s]) => [text, s.n, s.first ? fmtTs(s.first) : '', s.last ? fmtTs(s.last) : '']);
    downloadCsv('online-angaben', ['Angabe', 'Anzahl Konten', 'zuerst abgerufen', 'zuletzt abgerufen'], rows);
    return rows.length;
  }











  // ---------- Kopfzeilen-Badge „blockierte Opas“ ----------
  const OPA_PATH = 'M3408 12790 c-235 -43 -487 -227 -651 -477 -33 -50 -47 -63 -67 -63 -37 0 -119 -24 -168 -49 -102 -52 -148 -120 -201 -298 -48 -164 -73 -337 -69 -483 3 -112 6 -131 30 -180 15 -30 41 -64 58 -75 29 -19 30 -23 30 -92 0 -39 -3 -74 -8 -77 -4 -2 -86 -1 -182 4 -273 12 -411 -7 -566 -80 -227 -105 -387 -276 -518 -551 -127 -266 -203 -574 -253 -1019 -22 -199 -25 -1016 -5 -1265 20 -240 60 -603 82 -750 12 -82 15 -131 9 -133 -6 -3 -6 -8 0 -16 7 -8 -3 -51 -30 -136 -109 -339 -191 -737 -235 -1140 -22 -191 -25 -693 -6 -845 33 -258 72 -434 158 -699 234 -721 431 -1986 554 -3566 12 -145 22 -265 23 -266 1 -1 52 -16 114 -34 98 -29 113 -36 121 -59 45 -127 347 -276 743 -366 622 -140 1209 -69 1131 137 l-10 28 168 0 c273 0 423 30 492 100 62 62 50 120 -43 204 -59 53 -250 150 -377 191 l-84 27 6 77 c35 439 116 2702 166 4611 15 587 12 548 44 595 65 94 130 255 161 400 9 44 19 87 21 97 4 13 23 4 102 -49 201 -134 411 -220 617 -252 109 -16 209 -22 222 -14 18 13 32 57 39 126 l6 64 69 -35 69 -36 0 -156 c0 -170 4 -186 60 -215 37 -19 64 -19 104 0 55 26 61 45 66 214 l5 155 28 7 27 7 0 -2924 c0 -3216 -5 -2965 60 -2999 62 -32 136 -10 164 49 15 31 16 279 16 3052 l0 3017 25 64 c99 246 -33 525 -286 604 -33 10 -83 19 -110 19 -27 0 -60 6 -72 14 -37 24 -132 36 -367 46 -124 6 -272 15 -330 20 -98 9 -467 74 -476 83 -3 2 -9 91 -14 198 -27 543 -53 829 -125 1389 l-6 45 53 35 c141 94 296 282 422 513 20 37 42 67 49 67 7 0 46 -17 87 -38 59 -29 78 -45 93 -74 30 -59 36 -140 25 -308 -13 -195 -6 -359 17 -424 26 -71 104 -148 178 -175 200 -73 369 48 421 302 9 42 16 81 16 86 0 17 -87 71 -148 92 -72 26 -220 28 -308 5 -34 -9 -66 -16 -72 -16 -5 0 -11 71 -15 173 -4 137 -9 186 -26 239 -28 89 -88 155 -173 193 -35 15 -65 29 -66 31 -2 1 10 39 27 83 40 105 106 337 122 433 11 69 16 78 40 88 77 32 105 336 42 457 -16 31 -21 68 -27 190 -4 84 -14 199 -21 255 -14 100 -13 104 6 120 23 19 35 74 25 113 -6 24 -10 26 -39 21 l-32 -6 -19 82 c-10 46 -35 137 -57 203 -171 527 -466 883 -824 994 -79 25 -249 36 -327 21z';
  const OMA_PARTS = '<circle cx="9.6" cy="9.2" r="3.3"/><circle cx="15.2" cy="12.4" r="5"/><path d="M8.4 16.2 C5.6 19.6 5.8 26 8.2 32 L4.6 53 L22.8 53 L19 33 C20.6 29 21 24.6 19.2 20.4 C16.6 17.2 12.2 15.4 8.4 16.2Z"/><path d="M17.4 21.6 C20.6 23.4 23.2 26 25.4 29.2 L23.8 30.4 C21.4 28 19 26 16.4 24.6Z"/><path d="M24.8 29.6 L24.8 62" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M24.8 29.6 C24.8 26.4 28.8 26.4 28.8 29.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><rect x="9.6" y="52" width="3.2" height="9" rx="1"/><rect x="14.6" y="52" width="3.2" height="9" rx="1"/><path d="M8.2 60 h5.6 v2.6 h-6.6 z"/><path d="M13.6 60 h6 v2.6 h-6 z"/>';
  // Symbole im 640×1280-Raster: Opa (Pfad) bzw. Oma (32×64, ×20 skaliert)
  const OPA_G = `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g>`;
  const OMA_G = `<g transform="scale(20)">${OMA_PARTS}</g>`;
  // ---------- Eigener Profiltyp: nur ein eigenes Männer-Profil heißt alles „Oma“ (Oma-Scan, Oma-Schutz …) ----------
  const K_OWN_TYPE = 'jaf_own_type';
  function detectOwnType() {
    const el = document.getElementById('ad_data');
    if (!el) return;
    try {
      const d = JSON.parse(el.getAttribute('data-custom_d') || '{}');
      const t = ((d.dimensions || []).find((x) => +x.key === 1) || {}).value;
      if (t && t !== gmGet(K_OWN_TYPE, '')) gmSet(K_OWN_TYPE, t);
    } catch (e) { /* egal */ }
  }
  const ownIsMan = () => gmGet(K_OWN_TYPE, '') === 'Mann';
  const NICK = () => opaT(ownIsMan() ? 'Oma' : 'Opa');
  const nickG = () => (ownIsMan() ? OMA_G : OPA_G);
  function opaT(s) {
    let t = String(s);
    if (ownIsMan()) t = t.replace(/Opa-(Scan|Schutz|Liste)/g, 'Oma-$1').replace(/blockierte Opas/g, 'blockierte Omas');
    return isRuhr() ? ruhrText(t) : t;
  }
  // Sicherheitsnetz: Texte und Titel aller Skript-Elemente (id/class „jaf…“) im Ruhrgebiet nachziehen
  function ruhrifyUi() {
    if (!isRuhr()) return;
    for (const root of document.querySelectorAll('[id^="jaf"], [class*="jaf-"], [class*="jaf_"]')) {
      if (root.closest('input,textarea,[contenteditable]') || root.__jafRuhr === root.textContent) continue;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!/Opa|Oma/.test(n.nodeValue) || (n.parentElement && n.parentElement.closest('input,textarea,[contenteditable]'))) continue;
        const v = ruhrText(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
      }
      for (const el of [root, ...root.querySelectorAll('[title]')]) {
        const t = el.getAttribute && el.getAttribute('title');
        if (t && /Opa|Oma/.test(t)) { const v = ruhrText(t); if (v !== t) el.setAttribute('title', v); }
      }
      root.__jafRuhr = root.textContent;
    }
  }
  function updateOpaBadge() {
    const happy = document.querySelector('.page-header-info-element.happy_member_num_info');
    if (!happy) return;
    let b = document.querySelector('.page-header-info-element.jaf_blocked_num_info');
    if (!b) {
      b = happy.cloneNode(true); // gleiche Klassen/Attribute → gleicher Stil
      b.classList.remove('happy_member_num_info');
      b.classList.add('jaf_blocked_num_info');
      const icon = b.querySelector('.page-header-info-element__icon');
      if (icon) {
        icon.innerHTML = `<svg viewBox="0 0 640 1280" width="24" height="24" preserveAspectRatio="xMidYMid meet" ` +
          `style="width:24px;height:24px;fill:currentColor;display:inline-block" aria-hidden="true">` +
          `${nickG()}</svg>`;
      }
      const lower = b.querySelector('.page-header-info-element__lower-text');
      if (lower) lower.textContent = opaT('blockierte Opas');
      const logins = happy.parentElement.querySelector('.page-header-info-element.logins_today_num_info');
      happy.parentElement.insertBefore(b, logins && logins.parentElement === happy.parentElement ? logins : happy.nextSibling);
    }
    const upper = b.querySelector('.page-header-info-element__upper-text');
    const txt = getDone().length.toLocaleString('de-DE');
    if (upper && upper.textContent !== txt) upper.textContent = txt;
  }
  setInterval(updateOpaBadge, 2000);

  // =====================================================================
  // ---------- Opa-Scan: alle eigenen Gruppen durchgehen ----------
  // Ablauf je Gruppe: Moderatoren → Whitelist (ggf. entblocken + Notiz) → Mitgliederliste lesen → Treffer ignorieren
  // Zustand (überlebt Seitenwechsel): { running, phase, groups:[{key,name,url}], gi, cur:{…}, unblock:[], notes:[], pendingUnblock, stats, ts }
  // Phasen: collect (auf /groups/) → group → [unblock (auf /ignore/) → notes (Profilseiten)] → members → [ignore (Ignorierliste)] → next
  // =====================================================================
  const K_OPA = 'jaf_opa';
  const K_GROUP_DONE = 'jaf_group_done'; // { key: { name, ts } } – Gruppe zuletzt komplett bearbeitet
  const getGroupDone = () => gmGet(K_GROUP_DONE, {});
  function markGroupDone(g) {
    const m = getGroupDone();
    m[g.key] = { name: g.name, ts: Date.now() };
    gmSet(K_GROUP_DONE, m);
  }
  const getOpa = () => gmGet(K_OPA, { running: false });
  const setOpa = (o) => gmSet(K_OPA, Object.assign({}, o, { ts: Date.now() }));
  const isGroupsPage = () => cleanPath(location.pathname) === CONFIG.GROUPS_PATH;
  const groupsUrl = () => location.origin + CONFIG.GROUPS_PATH + '/';
  const opaStale = (o) => !o.ts || Date.now() - o.ts > 10 * 60 * 1000;

  function opaPanel(title) {
    const p = panel();
    p.innerHTML = opaT(`<b>Opa-Scan</b>${title ? ' – ' + title : ''}${CONFIG.DRY_RUN ? ' – <span style="color:#ffb300">Testmodus</span>' : ''}<br>`);
    p.appendChild(btn(opaT('Opa-Scan stoppen'), opaStop));
    return p;
  }
  function opaStop() {
    const o = getOpa();
    setOpa(Object.assign(o, { running: false }));
    const st = getState();
    if (st.running) setState({ running: false, queue: [], count: 0 });
    log(opaT('Opa-Scan gestoppt.'));
    if (!isGroupsPage()) setTimeout(() => { location.href = groupsUrl(); }, 1500);
  }
  const opaLog = (msg) => { log(msg); const o = getOpa(); o.log = (o.log || []).concat(`${fmtTs(Date.now())} ${msg}`).slice(-200); gmSet(K_OPA, o); };

  // ---- Badge auf jeder Gruppenkarte: Opa-Symbol + Datum der letzten kompletten Bearbeitung ----
  // Die Karte (<j-card-group>) zeigt unten rechts im Shadow DOM ein <j-badge> mit der Mitgliederzahl;
  // unser Badge kommt links daneben in dieselbe .badge-container-right.
  function updateGroupBadges() {
    const done = getGroupDone();
    document.querySelectorAll('j-card-group[data-key]').forEach((card) => {
      const sr = card.shadowRoot;
      if (!sr) return;
      const slot = sr.querySelector('slot[name="badge-bottom-right"]');
      const box = slot && slot.parentElement;
      if (!box) return;
      const e = done[card.getAttribute('data-key')];
      const d = e && e.ts ? new Date(e.ts) : null;
      const txt = d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}` : '--.--.----';
      let b = box.querySelector('.jaf-group-badge');
      if (!b) {
        b = document.createElement('j-badge');
        b.className = 'jaf-group-badge';
        b.setAttribute('is-on-image', 'true');
        b.style.marginRight = '4px';
        b.innerHTML = `<svg slot="icon" viewBox="0 0 640 1280" width="10" height="10" preserveAspectRatio="xMidYMid meet" ` +
          `style="width:10px;height:10px;fill:currentColor" aria-hidden="true">${nickG()}</svg>`;
        box.style.display = box.style.display || 'flex';
        box.insertBefore(b, slot);
      }
      if (b.getAttribute('content') !== txt) {
        b.setAttribute('content', txt);
        b.setAttribute('aria-label', d ? opaT(`Opa-Scan zuletzt komplett: ${fmtTs(e.ts)}`) : opaT('Opa-Scan: noch nie komplett bearbeitet'));
        b.title = d ? opaT(`Opa-Scan zuletzt komplett bearbeitet: ${fmtTs(e.ts)}`) : opaT('Opa-Scan: noch nie komplett bearbeitet');
      }
    });
  }

  // ---- Knopf „Opa-Scan starten“ hinter „Regionen“ ----
  function insertOpaButton() {
    if (document.querySelector('.jaf-opa-btn')) return true;
    const filterBtn = document.querySelector('j-control-button.group-filter-button');
    if (!filterBtn) return false;
    const anchor = filterBtn.closest('j-context-menu') || filterBtn;
    const b = document.createElement('j-control-button');
    for (const at of filterBtn.attributes) if (/^data-v-/.test(at.name)) b.setAttribute(at.name, '');
    b.className = 'group-filter-button jaf-opa-btn';
    b.setAttribute('variant', 'tertiary');
    b.setAttribute('role', '');
    b.style.marginLeft = '8px';
    b.innerHTML = `<svg slot="icon-prepend" viewBox="0 0 640 1280" width="16" height="16" preserveAspectRatio="xMidYMid meet" ` +
      `style="width:16px;height:16px;fill:currentColor" aria-hidden="true">${nickG()}</svg>` +
      opaT('<span>Opa-Scan starten</span>');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); opaStart(); });
    anchor.after(b);
    return true;
  }

  async function opaStart() {
    const other = lockedByOther();
    if (other) { alert(lockNotice(other).replace(' – hier wird nur markiert.', opaT('. Der Opa-Scan kann erst danach gestartet werden.'))); return; }
    if (!(await acquireLock(opaT('Opa-Scan')))) { alert('Ein anderer Tab hat gerade begonnen zu arbeiten. Bitte später erneut versuchen.'); return; }
    const o = getOpa();
    if (o.running && !opaStale(o)) { if (!confirm(opaT('Ein Opa-Scan läuft bereits. Neu beginnen?'))) return; }
    if (!confirm(opaT(`Opa-Scan starten?\n\nFür jede deiner Gruppen: Moderatoren auf die Whitelist (ggf. entblocken), `) +
      `Mitgliederliste lesen und Treffer ignorieren.${CONFIG.DRY_RUN ? '\n\n[Testmodus: es wird nichts ignoriert/entblockt]' : ''}`)) return;
    if (!(await visGuard())) return;
    try { await syncIgnoreList(true); } catch (e) { /* egal */ }
    setOpa({ running: true, phase: 'collect', groups: [], gi: 0, stats: { groups: 0, mods: 0, unblocked: 0, members: 0, hits: 0 }, log: [] });
    opaStep();
  }

  // ---- Schritt 1: „Alle meine Gruppen“ aufklappen und Gruppen einsammeln ----
  function readMyGroups() {
    const sec = document.querySelector('section[aria-labelledby="my-groups-heading"]') || document;
    return [...sec.querySelectorAll('j-card-group[data-key]')].map((c) => {
      const key = c.getAttribute('data-key');
      const t = c.shadowRoot && c.shadowRoot.querySelector('.title');
      const img = c.querySelector('img[alt^="Profilbild der Gruppe "]');
      const name = (t && t.textContent.trim()) || (img && img.alt.replace(/^Profilbild der Gruppe /, '').trim()) || key;
      return { key, name, url: `${location.origin}${CONFIG.GROUPS_PATH}/${key}/` };
    });
  }
  async function expandMyGroups() {
    for (let i = 0; i < 30; i++) {
      const more = [...document.querySelectorAll('j-control-button.show-more-btn')]
        .find((e) => visible(e) && /alle meine gruppen/i.test(e.textContent || ''));
      if (!more) return;
      const before = readMyGroups().length;
      await realClick(more);
      const grew = await waitFor(() => (readMyGroups().length > before ? true : null), 8000);
      if (!grew) return;
      await sleep(800);
    }
  }

  // ---- Gruppen-Startseite (im Hintergrund geladen) ----
  async function fetchDoc(url) {
    const r = await jfetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.doc || new DOMParser().parseFromString(r.html, 'text/html');
  }
  function parseGroupStart(doc, g) {
    const nameEl = doc.querySelector('[data-group-name]');
    const name = (nameEl && nameEl.getAttribute('data-group-name')) || g.name;
    const mods = [];
    doc.querySelectorAll('.group_info').forEach((gi) => {
      const lab = gi.querySelector('.group_info_label');
      if (!lab || !/moderation/i.test(lab.textContent)) return;
      gi.querySelectorAll('.group_info_text a[href]').forEach((a) => {
        let u; try { u = new URL(a.getAttribute('href'), location.origin); } catch { return; }
        const path = cleanPath(u.pathname);
        if (!CONFIG.PROFILE_PATH_RE.test(path)) return; // z. B. Party-Seiten überspringen
        mods.push({ name: a.textContent.trim(), path, url: location.origin + path, id: (path.match(/\/profile\/(\d+)\./) || [])[1] });
      });
    });
    // Link zur Mitgliederliste: <div title="Mitglieder" data-linkmsq="base64">, sonst normaler Link, sonst Standardpfad
    let members = '';
    const enc = [...doc.querySelectorAll('[data-linkmsq]')].find((e) => /^mitglieder$/i.test((e.getAttribute('title') || e.textContent || '').trim()));
    if (enc) { try { members = atob(enc.getAttribute('data-linkmsq')); } catch { /* ignorieren */ } }
    if (!members) { const a = doc.querySelector(`a[href*="/groups/${g.key}/mitglieder"]`); if (a) members = new URL(a.getAttribute('href'), location.origin).href; }
    if (!members) members = g.url + 'mitglieder/';
    const gid = (doc.querySelector('[data-group-id]') || { getAttribute: () => '' }).getAttribute('data-group-id');
    const modsFound = [...doc.querySelectorAll('.group_info_label')].some((l) => /moderation/i.test(l.textContent));
    return { name, mods, members, gid, modsFound };
  }

  // ---- Mitgliederliste einer Gruppe (Seiten mit li.date_card) ----
  function parseMemberPage(doc) {
    return [...doc.querySelectorAll('li.date_card')].map((li) => {
      const a = li.querySelector('a.card[href*="/profile/"], a.card[href*="/my/"]');
      if (!a) return null;
      // JOYclub verlinkt teils auf /my/<id>.<name>.html statt /profile/… – gleiche ID
      const path = cleanPath(new URL(a.getAttribute('href'), location.origin).pathname).replace(/^\/my\//, '/profile/');
      const strong = li.querySelector('strong');
      const name = strong ? strong.textContent.trim() : (a.getAttribute('title') || '').split(' - ')[0].trim();
      const line = li.querySelector('.user_card_footer_line_one span') || li.querySelector('.user_card_footer_line_one');
      const m = line ? (line.textContent.match(/(\d{2,3})(?:\s*\+\s*(\d{2,3}))?\s*Jahre/) || []) : [];
      const ages = [m[1], m[2]].filter(Boolean).map(Number).filter((n) => n >= 18 && n <= 120);
      const gi = li.querySelector('j-gender-icon[universal-gender]');
      const num = gi ? gi.getAttribute('universal-gender') : '';
      const on = li.querySelector('.online_symbol');
      return { path, url: location.origin + path, name, ages, gender: num, type: typeFromGender(num),
        cardOnline: !!(on && on.classList.contains('online')) };
    }).filter(Boolean);
  }
  function pageUrls(doc, fallbackUrl) {
    const opts = [...doc.querySelectorAll('select.page-select option[value]')].map((o) => o.getAttribute('value'));
    let max = 1;
    let tpl = '';
    for (const v of opts) { const m = v.match(/[?&]user_page=(\d+)/); if (m) { max = Math.max(max, +m[1]); tpl = tpl || v; } }
    if (!tpl) return { max: 1, make: () => fallbackUrl };
    const make = (n) => { const u = new URL(tpl, location.origin); u.searchParams.set('user_page', String(n)); return u.href; };
    return { max, make, tpl };
  }
  // gefilterte URL: nur die Häkchen für die zu prüfenden Profiltypen (Mindestalter bewusst NICHT, wegen Paar-Regel)
  function filteredUrl(tpl, gid) {
    const u = new URL(tpl, location.origin);
    const want = new Set();
    for (const grp of GROUP_KEYS) {
      if (!CONFIG.GROUPS[grp].ignore) continue;
      const types = Object.keys(FIXED_TYPES).filter((t) => FIXED_TYPES[t] === grp).concat(CONFIG.GROUPS[grp].types || []);
      for (const t of types) {
        const k = Object.keys(CONFIG.GROUP_GENDER_FILTER).find((x) => normType(x) === normType(t));
        (k ? CONFIG.GROUP_GENDER_FILTER[k] : ['m', 'w', 'p', 'd']).forEach((g) => want.add(g));
      }
    }
    for (const g of ['w', 'm', 'p', 'd']) {
      if (want.has(g)) u.searchParams.set('user_gender_' + g, '1'); else u.searchParams.delete('user_gender_' + g);
    }
    if (gid && !u.searchParams.get('user_group_id')) u.searchParams.set('user_group_id', gid);
    if (!u.searchParams.has('user_user_is_group_member')) u.searchParams.set('user_user_is_group_member', '1');
    u.searchParams.set('user_page', '1');
    return u.href;
  }

  // h: { stop, say, prog, beat } – Abbruch, Protokoll, Fortschritt, Lebenszeichen (Standard: Gruppen-Scan mit Seitenwechsel)
  async function readGroupMembers(cur, h = {}) {
    const stop = h.stop || (() => !getOpa().running), say = h.say || opaLog, prog = h.prog || log, beat = h.beat || (() => setOpa(getOpa()));
    // 1. ungefilterte Seite → Vorlage der Seiten-URLs (mit Gruppen-ID usw.)
    let doc = await fetchDoc(cur.members);
    let pages = pageUrls(doc, cur.members);
    const first = parseMemberPage(doc);
    if (!first.length && !doc.querySelector('.date_list, .page-navigation')) return { error: 'keine Mitgliederliste verfügbar' };
    let all = first;
    let partial = false;
    if (pages.tpl) {
      // 2. gefiltert neu beginnen
      const fu = filteredUrl(pages.tpl, cur.gid);
      doc = await fetchDoc(fu);
      const p1 = parseMemberPage(doc);
      const fp = pageUrls(doc, fu);
      if (p1.length) { all = p1; pages = fp.tpl ? fp : { max: 1, make: () => fu }; }
      say(`${cur.name}: Mitgliederliste gefiltert, ${pages.max} Seite(n).`);
      for (let n = 2; n <= pages.max; n++) {
        if (stop()) return { error: 'gestoppt' };
        await sleep(rand(CONFIG.GROUP_PAGE_DELAY_MIN_MS, CONFIG.GROUP_PAGE_DELAY_MAX_MS));
        try {
          const d = await fetchDoc(pages.make(n));
          const items = parseMemberPage(d);
          all = all.concat(items);
          prog(`${cur.name}: Seite ${n}/${pages.max} gelesen – ${all.length} Mitglieder …`, n / pages.max);
          beat(); // Lebenszeichen
          if (!items.length) break;
        } catch (e) { if (e.fatal) throw e; partial = true; say(`${cur.name}: Seite ${n} nicht lesbar (${e.message})`); }
      }
    }
    // Debug: welche Typen kamen trotz Filter vor?
    const seen = {};
    all.forEach((m) => { seen[m.type] = (seen[m.type] || 0) + 1; });
    console.log(opaT('[Alter-Filter][Opa-Scan] Typen in'), cur.name, seen);
    // doppelte (falls Seiten überlappen) entfernen
    const uniq = new Map(); all.forEach((m) => uniq.set(m.path, m));
    return { members: [...uniq.values()], types: seen, partial };
  }

  // ---- Hauptschleife ----
  async function opaStep() {
    let o = getOpa();
    if (!o.running) return;

    if (o.phase === 'collect') {
      if (!isGroupsPage()) { location.href = groupsUrl(); return; }
      opaPanel('Gruppen sammeln');
      log('Lade „Alle meine Gruppen“ …');
      await waitFor(() => readMyGroups().length, 10000);
      await expandMyGroups();
      // Reihenfolge: am längsten nicht komplett bearbeitet zuerst (ohne Datum = ganz vorne)
      const doneMap = getGroupDone();
      const groups = readMyGroups()
        .map((g, i) => ({ g, i, ts: (doneMap[g.key] || {}).ts || 0 }))
        .sort((a, b) => a.ts - b.ts || a.i - b.i)
        .map((x) => x.g);
      o = getOpa(); o.groups = groups; o.gi = 0; o.phase = 'group'; setOpa(o);
      const neverDone = groups.filter((g) => !doneMap[g.key]).length;
      opaLog(`${groups.length} Gruppen gefunden` + (neverDone < groups.length ? `, ${neverDone} noch nie komplett bearbeitet – Reihenfolge nach letzter Bearbeitung.` : '.'));
    }

    while (true) {
      o = getOpa();
      if (!o.running) return;

      if (o.phase === 'group') {
        if (o.gi >= o.groups.length) {
          setOpa(Object.assign(o, { running: false, phase: 'done' }));
          const st = o.stats || {};
          opaPanel('fertig');
          opaLog(opaT(`Opa-Scan fertig: ${st.groups || 0} Gruppen, ${st.mods || 0} Moderatoren, ${st.unblocked || 0} entblockt, `) +
            `${st.members || 0} Mitglieder gelesen, ${st.hits || 0} zum Ignorieren übergeben.`);
          return;
        }
        if (!isGroupsPage()) { location.href = groupsUrl(); return; }
        const g = o.groups[o.gi];
        opaPanel(`Gruppe ${o.gi + 1}/${o.groups.length}`);
        log(`${g.name}: lese Startseite …`);
        let info;
        try { info = parseGroupStart(await fetchDoc(g.url), g); } catch (e) {
          opaLog(`${g.name}: Startseite nicht lesbar (${e.message}) – übersprungen.`);
          o = getOpa(); o.gi++; setOpa(o); continue;
        }
        const cur = Object.assign({}, g, info);
        // Moderatoren dauerhaft schützen
        await syncIgnoreList(true);
        const log_ = getLog(), ign = getIgnored();
        const ignNames = Object.values(ign).map((e) => norm(e.name));
        const blockedMods = [];
        for (const m of cur.mods) {
          addModerator(m, { key: cur.key, name: cur.name });
          if (isBlocked(m.path, log_, ign) || ignNames.includes(norm(m.name))) blockedMods.push(m);
        }
        // bekannte Moderatoren, die es in dieser Gruppe nicht mehr sind
        const former = info.modsFound ? dropFormerModerators({ key: cur.key, name: cur.name }, cur.mods) : [];
        removeWhitelistedFromWatch();
        opaLog(`${cur.name}: ${cur.mods.length} Moderator(en) auf der Whitelist` + (blockedMods.length ? `, ${blockedMods.length} davon waren ignoriert` : '') +
          (former.length ? `, ${former.length} ehemalige(r) ohne Gruppe: ${former.map((f) => f.name).join(', ')}` : '') + '.');
        o = getOpa();
        o.cur = cur; o.stats.groups++; o.stats.mods += cur.mods.length;
        o.former = (o.former || []).concat(former.filter((f) => f.path));
        if (blockedMods.length) {
          o.unblock = blockedMods; o.notes = blockedMods.slice(); o.phase = 'unblock'; setOpa(o);
          location.href = location.origin + CONFIG.IGNORE_PAGE_PATH + '/';
          return;
        }
        o.phase = 'members'; setOpa(o);
        continue;
      }

      if (o.phase === 'members') {
        if (!isGroupsPage()) { location.href = groupsUrl(); return; }
        const cur = o.cur;
        opaPanel(`Gruppe ${o.gi + 1}/${o.groups.length}`);
        log(`${cur.name}: lese Mitgliederliste …`);
        let res;
        try { res = await readGroupMembers(cur); } catch (e) { res = { error: e.message }; }
        o = getOpa();
        if (!o.running) return;
        if (res.error) {
          opaLog(`${cur.name}: ${res.error}.`);
          o.curComplete = false; o.phase = 'next'; setOpa(o); continue;
        }
        const members = res.members;
        recordAccounts(members);
        noteSighting(members, 'Gruppen', null);
        updateWatch(members, getLog(), getIgnored(), sourceOf('Gruppen-Mitgliederliste') || 'Gruppen');
        const white = whiteList(), log_ = getLog(), ign = getIgnored();
        const gctx = { white, blocked: blockedIdMap() };
        let hits = members.map((m) => classifyCard(m, gctx, 'Gruppen')).filter((r) => r.kind !== 'skip').map((r) => r.item);
        // Vorgemerkte, die inzwischen über der Grenze sind, an den Anfang
        const due = dueFromWatch();
        if (due.length) { const inDue = new Set(due.map((d) => d.path)); hits = due.concat(hits.filter((h) => !inDue.has(h.path))); }
        // ehemalige Moderatoren ohne Gruppe anhängen (Kriterien werden auf dem Profil geprüft)
        const former = (o.former || []).filter((f) => !isBlocked(f.path, log_, ign) && !white.includes(norm(f.name)) && !hits.some((h) => h.path === f.path));
        if (former.length) {
          const acc = getAccounts();
          hits = hits.concat(former.map((f) => ({ path: f.path, url: f.url, name: f.name, ages: [], type: (acc[f.path] || {}).type || '',
            source: sourceOf('Gruppen-Mitgliederliste') || 'Gruppen', verify: true, formerMod: true })));
          o.former = [];
        }
        o.stats.members += members.length; o.stats.hits += hits.length;
        opaLog(`${cur.name}: ${members.length} Mitglieder gelesen, ${hits.length} zu ignorieren` + (due.length ? ` (davon ${due.length} vorgemerkt)` : '') + '.');
        if (!hits.length) { o.former = []; o.curComplete = !res.partial; o.phase = 'next'; setOpa(o); continue; }
        const limit = CONFIG.DRY_RUN ? Math.min(CONFIG.TEST_MAX_PROFILES, CONFIG.MAX_PER_RUN) : CONFIG.MAX_PER_RUN;
        const queue = hits.slice(0, limit);
        // komplett nur, wenn alle Treffer in diesen Lauf passen (Ergebnis des Laufs wird danach geprüft)
        o.curComplete = !res.partial && hits.length <= limit;
        o.phase = 'ignore'; setOpa(o);
        if (CONFIG.OPA_IGNORE_METHOD === 'ignoreliste') {
          setState({ running: true, mode: 'ignoreliste', queue, count: 0, auto: true, opa: true, returnUrl: groupsUrl(), source: 'Gruppen' });
          location.href = location.origin + CONFIG.IGNORE_PAGE_PATH + '/';
        } else {
          setState({ running: true, mode: 'profil', queue, count: 0, auto: true, opa: true, returnUrl: groupsUrl(), source: 'Gruppen' });
          location.href = location.origin + queue[0].path;
        }
        return;
      }

      if (o.phase === 'ignore') {
        // zurück vom Ignorier-Lauf
        const st = getState();
        if (st.running) return;
        if (!st.done) o.curComplete = false; // Lauf abgebrochen/zurückgesetzt
        o.phase = 'next'; setOpa(o); continue;
      }

      if (o.phase === 'next') {
        const g = o.groups[o.gi];
        if (g && o.curComplete && !CONFIG.DRY_RUN) { markGroupDone(g); updateGroupBadges(); opaLog(`${g.name}: komplett bearbeitet ✔`); }
        else if (g) opaLog(opaT(`${g.name}: nicht komplett bearbeitet – kommt beim nächsten Opa-Scan wieder früh dran.`));
        o = getOpa();
        o.curComplete = false;
        o.gi++; o.phase = 'group'; o.cur = null; o.unblock = []; o.notes = []; setOpa(o);
        if (o.gi < o.groups.length) {
          const w = rand(CONFIG.GROUP_DELAY_MIN_MS, CONFIG.GROUP_DELAY_MAX_MS);
          log(`Nächste Gruppe in ${Math.round(w / 1000)} s …`);
          await sleep(w);
        }
        continue;
      }

      // unblock / notes laufen auf anderen Seiten – hierher nur bei Neustart
      if (o.phase === 'unblock') { location.href = location.origin + CONFIG.IGNORE_PAGE_PATH + '/'; return; }
      if (o.phase === 'notes') { opaNextNote(); return; }
      return;
    }
  }

  function removeWhitelistedFromWatch() {
    const w = getWatch();
    const white = whiteList();
    let ch = false;
    for (const [p, r] of Object.entries(w)) if (white.includes(norm(r.name))) { delete w[p]; ch = true; }
    if (ch) gmSet(K_WATCH, w);
  }

  // ---- Moderatoren entblocken (auf /ignore/) ----
  async function opaUnblockOnIgnorePage() {
    let o = getOpa();
    const cur = o.cur || {};
    opaPanel(`${cur.name}: Moderatoren entblocken`);
    await waitFor(ignoreInput, 8000);
    saveIgnored(parseIgnoreList(document));
    const reason = `Moderator der Gruppe ${cur.name}`;
    // Ergebnis eines abgeschickten Entblockens prüfen
    if (o.pendingUnblock) {
      const m = o.pendingUnblock;
      const still = m.id && document.getElementById('user_ignore_stop_' + m.id);
      if (!still) { markUnblocked(m.path, m, reason); o.stats.unblocked++; opaLog(`${m.name}: entblockt ✔`); }
      else opaLog(`${m.name}: Entblocken fehlgeschlagen – steht noch auf der Ignorierliste.`);
      o.unblock = o.unblock.filter((x) => x.path !== m.path);
      o.pendingUnblock = null; setOpa(o);
    }
    while (true) {
      o = getOpa();
      if (!o.running) return;
      if (!o.unblock.length) {
        o.phase = 'notes'; setOpa(o);
        opaNextNote();
        return;
      }
      const m = o.unblock[0];
      const form = m.id && document.getElementById('user_ignore_stop_' + m.id);
      if (!form) {
        // nur in der Liste des Skripts vermerkt (oder schon entblockt)
        if (!CONFIG.DRY_RUN) markUnblocked(m.path, m, reason);
        opaLog(`${m.name}: nicht (mehr) auf der JOYclub-Ignorierliste – als entblockt vermerkt.`);
        o.unblock.shift(); setOpa(o); continue;
      }
      if (CONFIG.DRY_RUN) {
        opaLog(`Testmodus: ${m.name} würde entblockt.`);
        if (CONFIG.DEBUG) { form.style.outline = '4px solid #ffeb3b'; await sleep(CONFIG.DEBUG_PAUSE_MS); form.style.outline = ''; }
        o.unblock.shift(); setOpa(o); continue;
      }
      await sleep(rand(CONFIG.IGNORE_DELAY_MIN_MS, CONFIG.IGNORE_DELAY_MAX_MS));
      if (!getOpa().running) return;
      o.pendingUnblock = m; setOpa(o);
      log(`${m.name}: entblocke …`);
      form.submit(); // entspricht „<Name> nicht mehr ignorieren“ – lädt die Seite neu
      return;
    }
  }

  // ---- Profilnotiz der entblockten Moderatoren anpassen ----
  function opaNextNote() {
    const o = getOpa();
    if (!o.notes || !o.notes.length) {
      o.phase = 'members'; setOpa(o);
      location.href = groupsUrl();
      return;
    }
    location.href = location.origin + o.notes[0].path;
  }
  async function opaNoteOnProfile() {
    let o = getOpa();
    const m = o.notes[0];
    const cur = o.cur || {};
    opaPanel(`${cur.name}: Notiz ${m.name}`);
    await waitFor(profileType, 6000);
    await sleep(1500);
    let r;
    try { r = await writeModeratorNote(cur.name); } catch (e) { r = { ok: false, msg: 'Notiz-Fehler: ' + e.message }; }
    opaLog(`${m.name}: ${r.msg}`);
    o = getOpa();
    if (!o.running) return;
    o.notes.shift(); setOpa(o);
    await sleep(rand(CONFIG.DELAY_MIN_MS / 2, CONFIG.DELAY_MAX_MS / 2));
    opaNextNote();
  }

  // ---- Einstieg je Seite ----
  // gibt true zurück, wenn der Opa-Scan diese Seite übernommen hat
  async function opaInit() {
    const o = getOpa();
    if (isGroupsPage()) {
      await waitFor(insertOpaButton, 15000);
      if (!window.__jafOpaBtnTimer) window.__jafOpaBtnTimer = setInterval(() => { if (isGroupsPage()) { insertOpaButton(); updateGroupBadges(); } }, 3000);
      updateGroupBadges();
      const other = lockedByOther();
      if (other) {
        if (o.running) { const p = panel(); p.innerHTML = opaT('<b>Opa-Scan</b><br>'); log(lockNotice(other)); return true; }
        return false;
      }
      if (!o.running) {
        if (o.phase === 'done' && o.log && o.log.length) { const p = panel(); p.innerHTML = opaT('<b>Opa-Scan</b><br>'); log(o.log[o.log.length - 1]); }
        return false;
      }
      if (getState().running) return false; // Ignorier-Lauf hat Vorrang
      if (opaStale(o) && o.phase !== 'ignore') { // nach einem (langen) Ignorier-Lauf immer automatisch weiter
        const p = panel();
        p.innerHTML = opaT(`<b>Opa-Scan</b> – unterbrochen bei Gruppe ${(o.gi || 0) + 1}/${(o.groups || []).length}<br>`);
        p.appendChild(btn('Fortsetzen', async () => {
          if (!(await acquireLock(opaT('Opa-Scan')))) { log(lockNotice(getLock())); return; }
          setOpa(getOpa()); opaStep();
        }));
        p.appendChild(btn('Abbrechen', () => { setOpa(Object.assign(getOpa(), { running: false })); log(opaT('Opa-Scan abgebrochen.')); }));
        log(opaT('Der Opa-Scan wurde unterbrochen.'));
        return true;
      }
      if (!(await acquireLock(opaT('Opa-Scan')))) { log(lockNotice(getLock())); return true; }
      opaStep();
      return true;
    }
    if (!o.running || opaStale(o)) return false;
    if (lockedByOther()) return false; // gehört einem anderen Tab
    if (isIgnorePage() && o.phase === 'unblock' && !getState().running) { await acquireLock(opaT('Opa-Scan: entblocken')); opaUnblockOnIgnorePage(); return true; }
    const idOf = (p) => (String(p).match(/\/profile\/(\d+)\./) || [])[1];
    if (isProfilePage() && o.phase === 'notes' && o.notes && o.notes[0] && idOf(location.pathname) === idOf(o.notes[0].path)) {
      await acquireLock(opaT('Opa-Scan: Notiz')); opaNoteOnProfile(); return true;
    }
    return false;
  }

  // =====================================================================
  // ---------- Ignorierliste im Hintergrund bearbeiten ----------
  // /ignore/ enthält normale Formulare: #user_ignore (Name eintragen) und #user_ignore_stop_<ID> („nicht mehr ignorieren“).
  // Das Skript lädt die Seite unsichtbar, übernimmt die versteckten Felder und schickt das Formular ab; danach Kontrolle.
  // =====================================================================
  const ignoreUrl = () => location.origin + CONFIG.IGNORE_PAGE_PATH + '/';
  function formDataOf(form) {
    const fd = new FormData();
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach((i) => {
      if ((i.type === 'checkbox' || i.type === 'radio') && !i.checked) return;
      fd.append(i.name, i.value);
    });
    return fd;
  }
  async function postForm(form, extra = {}) {
    const fd = formDataOf(form);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const action = new URL(form.getAttribute('action') || ignoreUrl(), location.origin).href;
    const r = await fetch(action, { method: 'POST', body: fd, credentials: 'include' });
    return r.ok;
  }
  async function bgUnignore(id) {
    if (!CONFIG.DRY_RUN) {
      const a = await apiIgnore(id, false);
      if (a.ok) { ignoredSet(id, '', false); return { ok: true, msg: 'entsperrt (Schnittstelle)' }; }
    }
    return bgUnignorePage(id);
  }
  async function bgUnignorePage(id) {
    const doc = await fetchDoc(ignoreUrl());
    const f = doc.getElementById('user_ignore_stop_' + id);
    if (!f) { saveIgnored(parseIgnoreList(doc)); return { ok: true, msg: 'stand nicht (mehr) auf der Ignorierliste' }; }
    await postForm(f);
    await sleep(700);
    const doc2 = await fetchDoc(ignoreUrl());
    saveIgnored(parseIgnoreList(doc2));
    return doc2.getElementById('user_ignore_stop_' + id) ? { ok: false, msg: 'Entsperren fehlgeschlagen – steht noch auf der Ignorierliste' } : { ok: true, msg: 'entsperrt' };
  }
  async function bgIgnore(id, name) {
    if (!CONFIG.DRY_RUN) {
      const a = await apiIgnore(id, true);
      if (a.ok) { ignoredSet(id, name, true); return { ok: true, msg: 'ignoriert (Schnittstelle)' }; }
    }
    return bgIgnorePage(id, name);
  }
  async function bgIgnorePage(id, name) {
    const doc = await fetchDoc(ignoreUrl());
    if (doc.getElementById('user_ignore_stop_' + id)) { saveIgnored(parseIgnoreList(doc)); return { ok: true, msg: 'war bereits ignoriert' }; }
    const f = doc.getElementById('user_ignore');
    if (!f) return { ok: false, msg: 'Ignorier-Formular nicht gefunden' };
    await postForm(f, { user_ignore_name: name });
    await sleep(700);
    const doc2 = await fetchDoc(ignoreUrl());
    saveIgnored(parseIgnoreList(doc2));
    return doc2.getElementById('user_ignore_stop_' + id) ? { ok: true, msg: 'ignoriert' } : { ok: false, msg: 'Ignorieren fehlgeschlagen' };
  }
  // ID-basiert: steht dieses Profil auf der Ignorierliste (JOYclub oder Skript, ohne Entblockte)?
  function blockedIdMap() {
    const m = new Map();
    for (const [p, e] of Object.entries(getIgnored())) m.set(idOf(p), { joy: true, name: e.name });
    for (const [p, e] of Object.entries(getLog())) {
      if (e.unblocked) continue;
      const id = idOf(p);
      m.set(id, Object.assign({}, m.get(id) || {}, { log: e, path: p }));
    }
    return m;
  }

  // ---------- „Profil einmalig anschauen“ ----------
  // { id: { id, path, url, name, tab, hb, state: 'opening'|'open'|'beacon', created, beaconTs } }
  const K_PEEK = 'jaf_peek';
  const getPeeks = () => gmGet(K_PEEK, {});
  const setPeeks = (p) => gmSet(K_PEEK, p);
  async function reblockPeek(e, why) {
    const p = getPeeks();
    if (!p[e.id]) return;
    p[e.id].reblocking = TAB_ID; setPeeks(p);
    let r;
    try { r = await bgIgnore(e.id, e.name); } catch (err) { r = { ok: false, msg: err.message }; }
    const q = getPeeks();
    if (r.ok) { delete q[e.id]; setPeeks(q); console.log('[Alter-Filter] Einmal-Ansicht beendet, wieder ignoriert:', e.name, why); }
    else { if (q[e.id]) { q[e.id].reblocking = null; setPeeks(q); } console.warn('[Alter-Filter] Wieder-Ignorieren fehlgeschlagen', e.name, r.msg); }
    return r;
  }
  // Wächter (in jedem Tab): verwaiste Einmal-Ansichten wieder ignorieren
  async function peekWatchdog() {
    const now = Date.now();
    for (const e of Object.values(getPeeks())) {
      if (e.reblocking && e.reblocking !== TAB_ID) continue;
      if (e.tab === TAB_ID) continue; // eigener Tab regelt das selbst
      const orphanOpen = e.state === 'open' && now - (e.hb || 0) > 25000;
      const orphanOpening = e.state === 'opening' && now - e.created > 60000;
      const closed = e.state === 'beacon' && now - (e.beaconTs || 0) > 15000;
      if (orphanOpen || orphanOpening || closed) await reblockPeek(e, 'Tab geschlossen');
    }
  }
  setInterval(() => { peekWatchdog().catch(() => {}); }, 10000);

  async function startPeek(info) {
    const w = window.open('about:blank', 'jaf-fresh-' + Date.now()); // sofort öffnen (sonst blockiert der Browser das Popup); Name → eigene Tab-Kennung
    try {
      if (w) w.document.write('<p style="font:16px system-ui;padding:20px">Profil wird kurz freigeschaltet …</p>');
    } catch (e) { /* egal */ }
    const r = await bgUnignore(info.id);
    if (!r.ok) { if (w) w.close(); alert(`${info.name}: ${r.msg}`); return; }
    const p = getPeeks();
    p[info.id] = { id: info.id, path: info.path, url: info.url, name: info.name, tab: null, hb: Date.now(), state: 'opening', created: Date.now() };
    setPeeks(p);
    if (w) w.location.href = info.url; else location.href = info.url;
  }

  // Einstieg je Seite: gehört dieser Tab zu einer Einmal-Ansicht?
  async function peekInit() {
    const peeks = getPeeks();
    const here = isProfilePage() ? idOf(location.pathname) : '';
    // eigene Einmal-Ansichten, die verlassen wurden → sofort wieder ignorieren
    for (const e of Object.values(peeks)) {
      if (e.tab === TAB_ID && e.id !== here) await reblockPeek(e, 'Profil verlassen');
    }
    const e = here && getPeeks()[here];
    if (!e || (e.tab && e.tab !== TAB_ID)) { peekWatchdog().catch(() => {}); return; }
    // Neuladen derselben Seite: der Abschiedsgruß hat evtl. schon wieder ignoriert → erneut freischalten
    if (e.state === 'beacon' && e.tab === TAB_ID) {
      const r = await bgUnignore(e.id);
      const q = getPeeks(); if (q[e.id]) { q[e.id].state = 'open'; q[e.id].hb = Date.now(); setPeeks(q); }
      if (r.ok && r.msg === 'entsperrt') { location.reload(); return; }
    }
    const q = getPeeks();
    q[here] = Object.assign(q[here], { tab: TAB_ID, state: 'open', hb: Date.now() });
    setPeeks(q);
    const p = panel();
    p.innerHTML = '<b>Einmal-Ansicht</b><br>';
    log(`${e.name} ist vorübergehend freigeschaltet und wird beim Verlassen dieser Seite oder Schließen des Tabs wieder ignoriert.`);
    // Lebenszeichen
    setInterval(() => { const x = getPeeks(); if (x[here] && x[here].tab === TAB_ID && x[here].state === 'open') { x[here].hb = Date.now(); setPeeks(x); } }, 5000);
    // Abschiedsgruß beim Schließen: Ignorieren per sendBeacon (vorbereitet mit frischen Formularfeldern)
    let beacon = null;
    try {
      const doc = await fetchDoc(ignoreUrl());
      const f = doc.getElementById('user_ignore');
      if (f) { const fd = formDataOf(f); fd.set('user_ignore_name', e.name); beacon = { url: new URL(f.getAttribute('action') || ignoreUrl(), location.origin).href, fd }; }
    } catch (err) { /* dann übernimmt der Wächter */ }
    window.addEventListener('pagehide', () => {
      const x = getPeeks();
      if (!x[here] || x[here].tab !== TAB_ID) return;
      if (beacon && navigator.sendBeacon) { try { navigator.sendBeacon(beacon.url, beacon.fd); } catch (err) { /* Wächter */ } }
      x[here].state = 'beacon'; x[here].beaconTs = Date.now(); setPeeks(x);
    });
  }

  // ---------- Notiz-Aufträge (nach „Entsperren und whitelist“) ----------
  const K_NOTEJOBS = 'jaf_note_jobs'; // { id: { line, name, created } }
  async function noteJobInit() {
    if (!isProfilePage()) return false;
    const id = idOf(location.pathname);
    const jobs = gmGet(K_NOTEJOBS, {});
    const j = jobs[id];
    if (!j) return false;
    delete jobs[id]; gmSet(K_NOTEJOBS, jobs);
    const p = panel(); p.innerHTML = '<b>Whitelist-Notiz</b><br>';
    log(`${j.name}: Notiz wird angepasst …`);
    await waitFor(profileType, 8000);
    await sleep(1500);
    let r;
    try { r = await writeWhitelistNote(j.line, true); } catch (e) { r = { ok: false, msg: 'Notiz-Fehler: ' + e.message }; }
    log(`${j.name}: ${r.msg}`);
    return true;
  }

  async function unblockAndWhitelist(info, party) {
    if (!(await visGuard())) return 'cancel';
    const w = window.open('about:blank', 'jaf-fresh-' + Date.now());
    try { if (w) w.document.write('<p style="font:16px system-ui;padding:20px">Profil wird entsperrt …</p>'); } catch (e) { /* egal */ }
    const r = await bgUnignore(info.id);
    if (!r.ok) { if (w) w.close(); console.warn('[Alter-Filter]', `${info.name}: ${r.msg}`); return false; }
    const logPath = Object.keys(getLog()).find((p) => idOf(p) === String(info.id)) || info.path;
    const reason = party.kind === 'Besucher' ? CONFIG.VISIT_REASON : party.kind === 'Likes' ? CONFIG.LIKE_REASON : party.search ? CONFIG.SEARCH_REASON : CONFIG.PARTY_REASON;
    markUnblocked(logPath, info, `Whitelist: ${reason}`);
    addWhiteEntry(info, reason, (party.search || party.kind) ? null : party);
    removeWhitelistedFromWatch();
    const jobs = gmGet(K_NOTEJOBS, {});
    const line = party.kind === 'Besucher' ? CONFIG.VISIT_NOTE_TEXT.replace('{datum}', party.date)
      : party.kind === 'Likes' ? CONFIG.LIKE_NOTE_TEXT.replace('{datum}', party.date)
        : party.search ? CONFIG.SEARCH_NOTE_TEXT.replace('{datum}', party.date)
          : CONFIG.PARTY_NOTE_TEXT.replace('{party}', party.name).replace('{datum}', party.date);
    jobs[info.id] = { line, name: info.name, created: Date.now() };
    gmSet(K_NOTEJOBS, jobs);
    if (w) w.location.href = info.url; else location.href = info.url;
    return true;
  }

  // =====================================================================
  // ---------- Event-Seite ----------
  // =====================================================================
  const isEventPage = () => CONFIG.EVENT_PAGE_RE.test(location.pathname);
  const eventIdOf = (p) => (String(p).match(/\/event\/(\d+)\./) || [])[1] || '';
  const fmtDay = (t) => { const d = new Date(t); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`; };
  function eventInfo(doc = document) {
    const h = doc.querySelector('h1.event_name') || doc.querySelector('h1');
    const name = h ? h.textContent.trim() : '';
    let start = '';
    for (const sc of doc.querySelectorAll('script')) {
      const m = (sc.textContent || '').match(/"startDate"\s*:\s*"([^"]+)"/);
      if (m) { start = m[1]; break; }
    }
    return { id: eventIdOf(location.pathname), name, start, date: start ? fmtDay(Date.parse(start)) : '' };
  }

  // Veranstalter einer Party: Eigentümer der Event-Seite (body[data-my-user-id]), der Link unter „Veranstalter:“
  // (/club/<id> bzw. /party/<id>) und „präsentiert von …“-Links im Text (/party/<id>). Die ID ist die Konto-ID.
  function eventOrganizers() {
    const out = new Map();
    const add = (id, name, url) => { if (id && !out.has(String(id))) out.set(String(id), { id: String(id), name: (name || '').trim() || `Veranstalter ${id}`, url: url || '' }); };
    const accId = (href) => (String(href || '').match(/\/(?:club|party|profile|my)\/(\d+)\./) || [])[1];
    document.querySelectorAll('.event_organizer a[href]').forEach((a) => add(accId(a.getAttribute('href')), a.textContent, a.href));
    document.querySelectorAll('.event_description a[href*="/party/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/\/party\/(veranstaltungen|homepage)\//.test(href)) return; // Unterseiten, kein eigenes Konto
      add(accId(href), a.textContent.replace(/^@/, ''), a.href);
    });
    const owner = document.body.getAttribute('data-my-user-id');
    if (owner) { const o = [...out.values()].find((x) => x.id === owner); if (!o) add(owner, (document.querySelector('.event_organizer a') || {}).textContent, ''); }
    return [...out.values()];
  }

  // Eintrag der Gästeliste (li.date_card) – Daten der ANMELDUNG
  function parseGuest(li) {
    // Profil-Link: /profile/<id>.<name>.html oder (bei nachgeladenen Einträgen) /my/<id>.<name>.html
    const a = li.querySelector('a.card[href*="/profile/"], a.card[href*="/my/"]') || li.querySelector('a[href*="/profile/"], a[href*="/my/"]');
    const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
    const line = li.querySelector('.user_card_footer_line_one') || li;
    const m = (line.textContent || '').match(/(\d{2,3})(?:\s*\+\s*(\d{2,3}))?\s*Jahre/);
    const ages = m ? [m[1], m[2]].filter(Boolean).map(Number).filter((n) => n >= 18 && n <= 120) : [];
    const gi = li.querySelector('j-gender-icon[universal-gender]');
    const num = gi ? gi.getAttribute('universal-gender') : '';
    let type = num ? typeFromGender(num) : '';
    if (!type || /^Typ /.test(type)) {
      if (/\bPaar\b/i.test(text)) type = 'Paar'; else if (/\bMann\b|\bMänner\b|\bOpa\b|\bSchwanz\b|\bJungschwanz\b/i.test(text)) type = 'Mann'; else if (/\bFrau\b|\bFrauen\b/i.test(text)) type = 'Frau';
    }
    // Links auf Shops, Clubs, Veranstalter usw. sind keine Mitgliederprofile
    const anyLink = li.querySelector('a.card[href], a[href]');
    const nonProfile = !a && !!anyLink && !/\/(profile|my)\/\d+\./.test(anyLink.getAttribute('href') || '');
    let path = a ? cleanPath(new URL(a.getAttribute('href'), location.origin).pathname) : '';
    if (path.startsWith('/my/')) path = path.replace(/^\/my\//, '/profile/');
    const strong = li.querySelector('strong');
    const name = strong ? strong.textContent.trim() : '';
    let id = idOf(path);
    const anon = /\(anonym\)/i.test(text);
    // Einträge ohne Link, aber mit Namen (z. B. ignorierte Profile werden von JOYclub nicht verlinkt):
    // über den Namen einem bekannten Konto zuordnen
    if (!path && name && !anon && !nonProfile) {
      const k = norm(name);
      const hit = Object.entries(getIgnored()).find(([, e]) => norm(e.name) === k) ||
        Object.entries(getLog()).find(([, e]) => norm(e.name) === k) ||
        Object.entries(getAccounts()).find(([, e]) => norm(e.name) === k);
      if (hit) { path = hit[0]; id = id || idOf(hit[0]); }
    }
    if (!CONFIG.PROFILE_PATH_RE.test(path)) { path = ''; id = ''; }
    return {
      li, a, path, url: path ? location.origin + path : '', id, name,
      ages, num, type, anon, nonProfile, noLink: !a, extern: /(^|[^\p{L}])extern([^\p{L}]|$)/iu.test(text),
    };
  }

  // Gruppe einer Anmeldung/Karte: zugeordneter Profiltyp, sonst nach Geschlechts-Nummer (1 Mann, 2 Frau, 3 Paar)
  const groupOfReg = (g) => (isCoupleType(g.type) || g.num === '3' || g.gender === '3' ? 'p' : groupOfType(g.type) || ({ 1: 'm', 2: 'f' }[g.num || g.gender] || null));
  // Farbe/Schild (nur mit „Visuelle Einstufung“ der Gruppe): { none } oder { color, txt, fg, dashed, group, j }
  function guestStyle(g, ctx, src = 'Party') {
    const j = judge({ type: g.type, ages: g.ages }, src);
    const grp = j.group || groupOfReg(g);
    if (!grp || !CONFIG.GROUPS[grp].visual) return { none: true, group: grp, j };
    if (!g.anon && (g.name || g.id) && isWhiteMember(g, ctx.white)) return { color: COLORS.white, txt: 'Whitelist', fg: '#000', group: grp, j };
    if (j.active) return { color: COLORS.red, txt: j.why, group: grp, j };
    if (!j.stage) return { color: COLORS.grey, txt: j.why || '', dashed: true, group: grp, j };
    const c = STAGE_COLORS[j.stage] || COLORS.grey;
    return { color: c, txt: CONFIG.GROUPS[grp].names.one[j.stage - 1], fg: c === COLORS.light ? '#000' : '#fff', group: grp, j, dashed: !!j.unclear };
  }
  // rotes X nur, wenn für die Gruppe „Ignorieren aktiv“ ist (oder die Gruppe unbekannt)
  const showX = (st) => !st.group || !!CONFIG.GROUPS[st.group].ignore;

  const X_SVG = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4">' +
    '<line x1="4" y1="4" x2="96" y2="96" stroke="#e53935" stroke-width="7" stroke-linecap="round"/>' +
    '<line x1="96" y1="4" x2="4" y2="96" stroke="#e53935" stroke-width="7" stroke-linecap="round"/></svg>';

  function decorateGuests() {
    const panes = document.querySelectorAll('#guest_list li.date_card');
    if (!panes.length) return;
    const ctx = { white: whiteList(), acc: getAccounts(), blocked: blockedIdMap(), ev: eventInfo() };
    // schon beim Ansehen: „zuletzt gesehen“ = Partydatum (nur bekannte Mitglieder, nur gleich- oder höherrangig)
    const sigKey = `${ctx.ev.id}|${panes.length}`;
    if (window.__jafGuestSeen !== sigKey) {
      window.__jafGuestSeen = sigKey;
      const day = (ctx.ev.start && isoDay(new Date(Date.parse(ctx.ev.start)))) || dayOfDE(ctx.ev.date) || null;
      try { noteSighting([...panes].map(parseGuest).filter((g) => g.id), 'Party', day); } catch (e) { /* egal */ }
    }
    panes.forEach((li) => {
      const g = parseGuest(li);
      if (g.name && g.path && !g.noLink && ctx.white.includes(norm(g.name))) learnWhiteUrl(g.name, g.path);
      const st = guestStyle(g, ctx);
      const card = li.querySelector('.card') || li;
      const blk = g.id && ctx.blocked.get(g.id);
      let b = li.querySelector('.jaf-badge');
      if (st.none) { card.style.outline = ''; if (b) b.remove(); } else {
        card.style.outline = `${st.dashed ? 2 : 3}px ${st.dashed ? 'dashed' : 'solid'} ${st.color}`;
        card.style.position = 'relative';
        if (!b) { b = document.createElement('div'); b.className = 'jaf-badge'; card.appendChild(b); }
        // Schild: Alter + Gründe fürs Ignorieren (rot)
        const extra = [g.ages.join('+') || '?', st.color === COLORS.red ? st.txt : ''].filter(Boolean).join(' · ');
        b.textContent = extra + (blk ? ' · ignoriert' : '');
        b.style.cssText = `position:absolute;top:6px;left:6px;z-index:5;font:bold 11px system-ui;padding:2px 6px;border-radius:3px;pointer-events:none;` +
          `background:${st.color};color:${st.fg || (st.color === COLORS.white ? '#000' : '#fff')}`;
      }
      // Kreuz über dem Bild (nur bei aktivem Ignorieren der Gruppe) + Popup statt Link
      const av = li.querySelector('.date_avatar');
      const x = li.querySelector('.jaf-x');
      const wantX = blk && showX(st);
      if (wantX && av && !x) { av.style.position = 'relative'; av.insertAdjacentHTML('beforeend', `<div class="jaf-x">${X_SVG}</div>`); }
      if (!wantX && x) x.remove();
      const clickEl = g.a || (g.id ? card : null);
      if (clickEl && !clickEl.__jafBound) {
        clickEl.__jafBound = true;
        if (!g.a) clickEl.style.cursor = 'pointer';
        clickEl.addEventListener('click', (ev) => {
          const now = blockedIdMap().get(idOf(g.path));
          if (!now) return; // nicht (mehr) ignoriert → normaler Link
          ev.preventDefault(); ev.stopPropagation();
          ignoredPopup(g, now, eventInfo());
        }, true);
      }
    });
  }

  // Grund aus dem Protokoll (= Text, den das Skript in die Profilnotiz schreibt)
  function logNoteText(e) {
    if (!e || !e.ts) return '';
    return noteText(e.source, entryKind(e), e.ts, e.type);
  }
  // Profilnotiz im Hintergrund lesen: eigene Zeile, sonst ganze Notiz, sonst ''
  async function fetchProfileNote(url) {
    const doc = await fetchDoc(url);
    const host = [...doc.querySelectorAll('j-setting-textarea')].find((e) => /profilnotiz/.test(norm(e.getAttribute('label') || '')));
    if (!host) return null;
    const ta = host.querySelector('textarea');
    const txt = (host.getAttribute('value') || (ta && (ta.value || ta.textContent)) || host.textContent || '').trim();
    const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
    const own = lines.filter((l) => ownNoteRe().test(l));
    return own.length ? own[own.length - 1] : lines.join(' · ');
  }
  // Button im Stil der JOYclub-Knöpfe („Event merken“), untereinander
  // einheitliche Popup-Buttons (Stil wie „Event merken“ / „Anmelden“): primary = rot (startet einen Scan)
  function popupButton(label, fn, opt = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const bg = opt.primary ? '#c71b1b' : '#4a4f53', hover = opt.primary ? '#a81515' : '#5a6064';
    b.style.cssText = `display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;background:${bg};color:#fff;` +
      'font:bold 17px/1.2 system-ui,sans-serif;padding:14px 16px;cursor:pointer;text-align:center;outline:none';
    if (opt.disabled) { b.disabled = true; b.style.opacity = '.4'; b.style.cursor = 'default'; }
    b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.background = hover; });
    b.addEventListener('mouseleave', () => { b.style.background = bg; });
    b.addEventListener('focus', () => { b.style.boxShadow = '0 0 0 2px #1d2023, 0 0 0 4px #fff'; });
    b.addEventListener('blur', () => { b.style.boxShadow = ''; });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!b.disabled && fn) fn(); });
    return b;
  }
  // Popup-Grundgerüst (dunkler Kasten in der Bildschirmmitte)
  const POPUP_BOX_CSS = 'background:#1d2023;color:#fff;font:14px/1.5 system-ui,sans-serif;padding:18px 20px;border-radius:10px;' +
    'max-width:440px;width:calc(100% - 32px);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  const opaIconSvg = (h = 22) => `<svg viewBox="0 0 640 1280" width="${Math.round(h * 0.58)}" height="${h}" style="fill:currentColor;flex:none" aria-hidden="true">` +
    `${nickG()}</svg>`;

  function ignoredPopup(g, blk, ev) {
    document.getElementById('jaf-popup')?.remove();
    const e = blk.log || {};
    const ov = document.createElement('div');
    ov.id = 'jaf-popup';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.style.cssText = 'background:#1d2023;color:#fff;font:14px/1.5 system-ui,sans-serif;padding:18px 20px;border-radius:10px;max-width:400px;width:calc(100% - 32px);box-shadow:0 8px 30px rgba(0,0,0,.5)';
    box.innerHTML = '<div class="jaf-h" style="font-size:17px;font-weight:bold;margin-bottom:4px"></div>' +
      '<div style="margin-bottom:16px"><span style="opacity:.7">Grund:</span> <span class="jaf-why"></span></div>' +
      '<div class="jaf-msg" style="margin:-8px 0 10px;color:#ffb300"></div>' +
      '<div class="jaf-btns" style="display:flex;flex-direction:column;gap:12px"></div>';
    box.querySelector('.jaf-h').textContent = `Du ignorierst ${g.name || (blk.log && blk.log.name) || blk.name || 'dieses Profil'}`;
    const why = box.querySelector('.jaf-why');
    const known = logNoteText(blk.log);
    why.textContent = known || '…';
    const msgEl = box.querySelector('.jaf-msg');
    msgEl.style.display = 'none';
    const msg = (t) => { msgEl.textContent = t; msgEl.style.display = t ? '' : 'none'; };
    let closed = false;
    const close = () => { closed = true; ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const info = { id: g.id, path: g.path, url: g.url, name: g.name };
    const bs = box.querySelector('.jaf-btns');
    bs.appendChild(popupButton('Trotzdem öffnen', () => { window.open(g.url, '_blank', 'noopener'); close(); }));
    bs.appendChild(popupButton('Nicht mehr ignorieren', async () => {
      msg('Wird entsperrt …');
      const ok = await unblockAndWhitelist(info, { name: ev.name || 'Party', date: ev.date || fmtDay(Date.now()), search: !!ev.search, kind: ev.kind || '' });
      if (ok === 'cancel') { msg(''); return; }
      if (ok) { close(); decorateGuests(); } else msg('Entsperren fehlgeschlagen.');
    }));
    const cancel = popupButton('Abbrechen', close);
    bs.appendChild(cancel);
    ov.appendChild(box);
    ov.addEventListener('click', (e2) => { if (e2.target === ov) close(); });
    function onKey(e2) { if (e2.key === 'Escape') { e2.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    cancel.focus(); // „Abbrechen“ ist vorausgewählt (Enter/Esc schließt)
    // tatsächliche Profilnotiz nachladen (auch für von Hand ignorierte Profile)
    if (g.url) fetchProfileNote(g.url).then((t) => { if (!closed && t) why.textContent = t; else if (!closed && !known) why.textContent = '-'; })
      .catch(() => { if (!closed && !known) why.textContent = '-'; });
    else if (!known) why.textContent = '-';
  }

  // ---- Cache geprüfter Profile (Party-Scans): { id: { name, type, ages, ts } } ----
  const K_CHECKED = 'jaf_checked';
  const CHECK_MAX_AGE_MS = 365 * 86400000; // nach 1 Jahr neu prüfen
  const getChecked = () => gmGet(K_CHECKED, {});
  function setChecked(id, info) {
    if (!id || !info || !info.type || !(info.ages || []).length) return;
    const m = getChecked();
    m[id] = { name: info.name || '', type: info.type, ages: info.ages, ts: Date.now() };
    gmSet(K_CHECKED, m);
  }
  // Entscheidung aus dem Cache: 'block' | 'ok' | null (unbekannt/zu alt/Geburtstag dazwischen)
  // Clubs, Shops usw.: JOYclub verlinkt sie in nachgeladenen Gästelisten als /my/<id> – sieht aus wie ein Profil, ist aber keins
  function setNonProfile(id, name, kind) {
    if (!id) return;
    const m = getChecked();
    m[id] = { name: name || '', nonProfile: kind || 'kein Mitgliederprofil', ts: Date.now() };
    gmSet(K_CHECKED, m);
  }
  function cachedNonProfile(id) {
    const e = id && getChecked()[id];
    return e && e.nonProfile && Date.now() - e.ts <= CHECK_MAX_AGE_MS ? e.nonProfile : '';
  }
  // Ziel einer (umgeleiteten) Seite: Club/Shop/… statt Mitgliederprofil? → Bezeichnung, sonst ''
  function nonMemberKind(doc, finalPath) {
    const paths = [finalPath || ''];
    const can = doc && doc.querySelector('link[rel="canonical"], meta[property="og:url"]');
    if (can) { try { paths.push(new URL(can.getAttribute('href') || can.getAttribute('content'), location.origin).pathname); } catch (e) { /* egal */ } }
    for (const p of paths) {
      const m = p.match(/^\/(club|shop|location|locations|veranstalter|organizer|magazin|business)\//i);
      if (m) return m[1].toLowerCase() === 'shop' ? 'Shop' : m[1].toLowerCase() === 'club' ? 'Club' : m[1];
    }
    // Business-Profil (Club, Veranstalter, Location …) unter /profile/-Adresse: <div id="business_profile"> mit .club_info_type
    if (doc && doc.querySelector('#business_profile, .profile_info_box_club, .club_info_type')) {
      const t = doc.querySelector('.club_info_type');
      const label = t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
      return label && label.length <= 40 ? label : 'Business-Profil';
    }
    return '';
  }
  function cachedDecision(g, white, src = 'Party') {
    const e = getChecked()[g.id];
    if (!e || e.nonProfile || !e.ages || Date.now() - e.ts > CHECK_MAX_AGE_MS) return null;
    const yrs = (Date.now() - e.ts) / (365.25 * 86400000);
    const lo = e.ages.map((a) => a + Math.floor(yrs)), hi = e.ages.map((a) => a + Math.ceil(yrs));
    const c = (ages) => shouldBlock({ name: g.name, path: g.path, type: e.type, ages }, white, src);
    if (c(lo)) return { r: 'block', type: e.type, ages: lo };
    if (!c(hi)) return { r: 'ok', type: e.type, ages: lo };
    return null;
  }
  // Profil im Hintergrund lesen: Typ + Alter aus dem Profilkopf oder aus aria-label „Profil von X, Mann, …, 52 Jahre, …“
  function parseProfileDoc(doc) {
    const line2 = doc.querySelector('.profile-base-info__line-2');
    let type = '', ages = [], name = '';
    if (line2) {
      const spans = [...line2.querySelectorAll('span')].map((e) => (e.textContent || '').trim());
      type = spans[0] || '';
      const a = spans.find((t) => /jahre/i.test(t));
      if (a) ages = (a.match(/\d{2,3}/g) || []).map(Number).filter((n) => n >= 18 && n <= 120).slice(0, 2);
    }
    const lab = [...doc.querySelectorAll('[aria-label^="Profil von "]')].map((e) => e.getAttribute('aria-label'))[0];
    if (lab) {
      const parts = lab.replace(/^Profil von /, '').split(',').map((x) => x.trim());
      name = parts[0];
      if (!type) type = parts[1] || '';
      if (!ages.length) { const j = parts.find((x) => /jahre/i.test(x)); if (j) ages = (j.match(/\d{2,3}/g) || []).map(Number).slice(0, 2); }
    }
    return type && ages.length ? { type, ages, name, signs: profileSigns(doc, ages) } : null;
  }
  // Kandidaten „verify“ vorab klären: Cache, sonst Profil im Hintergrund laden
  async function precheck(items, ctx, onProgress, stop = () => false) {
    const todo = items.filter((x) => x.c.kind === 'verify');
    let n = 0, fetched = 0, failed = 0;
    for (const x of todo) {
      n++;
      const g = x.g;
      if (!CONFIG.PROFILE_PATH_RE.test(g.path || '')) { x.c = { kind: 'anon', why: 'kein Mitgliederprofil' }; continue; }
      const wl = ctx.ignoreWhite ? null : ctx.white;
      let d = cachedDecision(g, wl);
      if (!d) {
        if (stop()) break;
        try {
          await sleep(rand(600, 1300));
          const r = await jfetch(g.url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const doc = r.doc || new DOMParser().parseFromString(r.html, 'text/html');
          const info = parseProfileDoc(doc);
          fetched++;
          let finalPath = ''; try { finalPath = new URL(r.url).pathname; } catch (e) { /* egal */ }
          const nk = info ? '' : nonMemberKind(doc, finalPath);
          if (nk) { setNonProfile(g.id, g.name, nk); x.c = { kind: 'anon', why: `kein Mitgliederprofil (${nk})` }; if (onProgress) onProgress(n, todo.length); continue; }
          if (info) {
            setChecked(g.id, Object.assign({ name: g.name }, info));
            recordAccounts([{ path: g.path, name: info.name || g.name, ages: info.ages, type: info.type, signs: info.signs }]);
            d = cachedDecision(g, wl);
          } else failed++;
        } catch (e) { failed++; if (e.fatal && bgScan) { bgScan.stop = true; bgScan.stopMsg = bgScan.stopMsg || e.message; } }
      }
      if (d && d.r === 'block') {
        x.c = { kind: 'ignore', why: `Profil: ${d.type}, ${d.ages.join('+')}`, verified: true,
          item: Object.assign({}, x.c.item, { verify: true, type: d.type, ages: d.ages }) };
      } else if (d && d.r === 'ok') {
        x.c = { kind: 'skip', why: `Profil: ${d.type}, ${d.ages.join('+')}` };
      }
      if (onProgress) onProgress(n, todo.length);
    }
    return { fetched, failed };
  }

  // ---- Entscheidung für einen Gast wie im Opa-Scan der Partys ----
  // Ergebnis: { kind: 'extern'|'anon'|'white'|'blocked'|'ignore'|'skip'|'verify', why, item? }
  function classifyGuest(g, ctx) {
    if (g.extern) return { kind: 'extern', why: 'externe Anmeldung' };
    if (g.nonProfile) return { kind: 'anon', why: 'kein Mitgliederprofil (z. B. Shop/Club)' };
    if (g.anon || !g.id) return { kind: 'anon', why: 'anonym / ohne Profil' };
    const npk = cachedNonProfile(g.id);
    if (npk) return { kind: 'anon', why: `kein Mitgliederprofil (${npk})` };
    if (!ctx.ignoreWhite && isWhiteMember(g, ctx.white)) return { kind: 'white', why: whiteReason(g.name) || 'Whitelist' };
    if (ctx.blocked.get(g.id)) return { kind: 'blocked', why: 'steht auf der Ignorierliste' };
    const src = 'Party';
    const srcLbl = sourceOf('Party-Gästeliste') || src;
    const grp = groupOfType(g.type) || groupOfReg(g);
    // nur Profile prüfen, die für die aktuellen Einstellungen relevant sind
    if (!grp) return { kind: 'skip', why: `Profiltyp ${g.type || '?'} nicht zugeordnet` };
    if (!CONFIG.GROUPS[grp].ignore) return { kind: 'skip', why: `${GROUP_LABELS[grp]}: Ignorieren aus` };
    const mk = (extra) => Object.assign({ path: g.path, url: g.url, name: g.name, source: srcLbl }, extra);
    if (grp === 'p' && isCoupleType(g.type) && g.ages.length === 2) {
      const j = judge({ type: g.type, ages: g.ages }, src);
      if (j.active) return { kind: 'ignore', why: j.why, item: mk({ ages: g.ages, type: g.type, kind: j.kind, reason: KIND_REASON[j.kind] }) };
      return { kind: 'skip', why: `Paar ${g.ages.join('+')}` };
    }
    // Profil nur prüfen, wenn schon das Alter in der Anmeldung die Schwelle erreicht
    if (grp !== 'p' && g.ages.length) {
      const regAge = Math.max(...g.ages);
      if (regAge < vals(grp, src)[2]) return { kind: 'skip', why: `Anmeldung ${g.ages.join('+')}` };
    }
    const wl = ctx.ignoreWhite ? null : ctx.white;
    const cd = cachedDecision(g, wl, src);
    if (cd && cd.r === 'ok') return { kind: 'skip', why: `geprüft: ${cd.type}, ${cd.ages.join('+')}` };
    if (cd && cd.r === 'block') return { kind: 'ignore', why: `geprüft: ${cd.type}, ${cd.ages.join('+')}`, verified: true,
      item: mk({ ages: cd.ages, type: cd.type, verify: true }) };
    const k = ctx.acc[g.path] || Object.entries(ctx.acc).find(([p]) => idOf(p) === g.id)?.[1];
    if (k && k.type && (k.persons || []).length) {
      const maxAges = k.persons.map((r) => { const [y, mo, d] = r.lo.split('-').map(Number); const now = new Date(); let a = now.getFullYear() - y; if (now < new Date(now.getFullYear(), mo - 1, d)) a--; return a; });
      if (!shouldBlock({ name: g.name, path: g.path, type: k.type, ages: maxAges }, wl, src)) return { kind: 'skip', why: `bekannt: ${k.type}, höchstens ${maxAges.join('+')}` };
    }
    return { kind: 'verify', why: 'wird auf dem Profil geprüft', item: mk({ ages: [], type: (k && k.type) || '', verify: true }) };
  }


  // ---- Reiter „Opa-Liste“ (zwischen „Dates“ und „Kommentare“) ----
  // Beim Öffnen läuft der Opa-Scan dieser Party als Testlauf (nichts wird verändert); gelistet werden nur Gäste,
  // die die Kriterien zum Ignorieren erfüllen (bzw. schon ignoriert oder trotz Kriterien auf der Whitelist sind).
  const OPA_CHOICES = [['ignore', 'Ignorieren'], ['white', 'Whitelist']];
  function setupOpaListTab() {
    if (document.getElementById('jaf_opa_list')) return true;
    const dates = document.querySelector('.event_detail_tab_content ul.nav-tabs > li > a[href="#date_pane"]');
    const comments = document.querySelector('.event_detail_tab_content ul.nav-tabs > li > a[href="#comments"]');
    const anchorLi = (dates || comments) && (dates || comments).closest('li');
    const content = document.querySelector('.event_detail_tab_content > .tab-content') || (document.getElementById('information') || {}).parentElement;
    if (!anchorLi || !content) return false;
    const li = document.createElement('li');
    li.setAttribute('role', 'presentation'); li.title = opaT('Opa-Liste'); li.className = 'jaf-opa-list-tab';
    li.innerHTML = opaT('<a href="#jaf_opa_list" data-toggle="tab" aria-controls="jaf_opa_list">Opa-Liste</a>');
    if (dates) anchorLi.after(li); else anchorLi.before(li);
    const pane = document.createElement('div');
    pane.id = 'jaf_opa_list'; pane.className = 'tab-pane'; pane.setAttribute('role', 'tabpanel');
    pane.innerHTML = '<div class="jaf-ol" style="padding:12px 0"></div>';
    content.appendChild(pane);
    li.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      showOwnTab(li, pane);
      buildOpaList(pane).catch((err) => { pane.querySelector('.jaf-ol').textContent = 'Fehler: ' + err.message; });
    });
    return true;
  }
  function showOwnTab(li, pane) {
    li.parentElement.querySelectorAll(':scope > li').forEach((x) => x.classList.remove('active'));
    li.classList.add('active');
    pane.parentElement.querySelectorAll(':scope > .tab-pane').forEach((x) => x.classList.remove('active', 'in'));
    pane.classList.add('active', 'in');
  }

  async function buildOpaList(pane) {
    if (pane.__jafBuilding) return;
    pane.__jafBuilding = true;
    const box = pane.querySelector('.jaf-ol');
    const hint = (t) => {
      box.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;background:#fff3e0;color:#5d4037">' +
        opaT('<span style="font-size:20px">⏳</span><div><b>Opa-Scan läuft (Testlauf)</b><br><span class="jaf-ol-step"></span></div></div>');
      box.querySelector('.jaf-ol-step').textContent = t;
    };
    try {
      // 1. vollständige Gästeliste „Alle“ unsichtbar im Hintergrund laden
      hint('Lade die vollständige Gästeliste im Hintergrund …');
      let allItems;
      try { allItems = htmlToItems(await bgLoadGuests('alle', (n) => hint(`Lade die vollständige Gästeliste im Hintergrund … ${n} Anmeldungen`))); }
      catch (e) { allItems = [...((document.getElementById('guest_alle') || document).querySelectorAll('#guest_alle li.date_card'))]; }
      // 2. Opa-Scan als Testlauf: einordnen wie im echten Scan, unbekannte Profile im Hintergrund prüfen (Cache 1 Jahr)
      hint('Gleiche die Ignorierliste ab …');
      await syncIgnoreList(true);
      const guests = allItems.map(parseGuest);
      const ctx = { white: whiteList(), acc: getAccounts(), blocked: blockedIdMap(), ignoreWhite: true };
      const seen = new Set();
      const items = [];
      for (const g of guests) {
        if (!g.id || seen.has(g.id)) continue;
        seen.add(g.id);
        items.push({ g, c: classifyGuest(g, ctx), white: isWhiteMember(g, ctx.white) });
      }
      await precheck(items, ctx, (n, t) => hint(`Prüfe Profile im Hintergrund … ${n}/${t}`));
      // 3. nur Opas (Kriterien erfüllt) + bereits Ignorierte
      const rows = [];
      for (const x of items) {
        const blocked = x.c.kind === 'blocked';
        const crit = x.c.kind === 'ignore'; // nur geprüfte Treffer (ungeprüfte Anmeldungen nicht)
        if (!blocked && !crit) continue;
        const def = blocked ? 'ignore' : x.white ? 'white' : 'ignore';
        rows.push({ g: x.g, c: x.c, def, white: x.white, blocked, unchecked: x.c.kind === 'verify' });
      }
      rows.sort((a, b) => (a.g.name || '').localeCompare(b.g.name || '', 'de', { sensitivity: 'base' }));
      renderOpaList(pane, rows);
    } finally { pane.__jafBuilding = false; }
  }

  function renderOpaList(pane, rows) {
    const box = pane.querySelector('.jaf-ol');
    box.innerHTML = '';
    const head = document.createElement('div');
    head.style.cssText = 'margin-bottom:10px';
    head.textContent = rows.length
      ? `${rows.length} Opa(s). Vorbelegung: Whitelist bei Whitelist-Mitgliedern, sonst Ignorieren. „Anwenden“ bearbeitet nur geänderte bzw. noch nicht ignorierte Einträge.`
      : 'Keine Gäste, die die Kriterien zum Ignorieren erfüllen.';
    box.appendChild(head);
    if (!rows.length) return;
    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;width:100%;max-width:520px';
    for (const r of rows) {
      const tr = table.insertRow();
      const td1 = tr.insertCell(); const td2 = tr.insertCell();
      td1.style.cssText = 'padding:3px 10px 3px 0;white-space:nowrap';
      td2.style.cssText = 'padding:3px 0';
      // Nickname als direkter Link zum Profil (neuer Tab)
      const link = document.createElement('a');
      link.href = r.g.url; link.target = '_blank'; link.rel = 'noopener';
      link.textContent = r.g.name;
      td1.appendChild(link);
      if (r.unchecked) td1.appendChild(document.createTextNode(' (ungeprüft)'));
      td1.title = `${r.g.ages.join('+') || '?'} – ${r.blocked ? 'steht auf der Ignorierliste' : r.c.why}`;
      const sel = document.createElement('select');
      sel.style.cssText = 'min-width:150px';
      for (const [v, l] of OPA_CHOICES) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
      sel.value = r.def;
      r.sel = sel;
      td2.appendChild(sel);
    }
    box.appendChild(table);
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:12px';
    const apply = document.createElement('j-button');
    apply.setAttribute('variant', 'primary');
    apply.textContent = 'Anwenden';
    apply.style.cursor = 'pointer';
    const msg = document.createElement('div'); msg.style.cssText = 'margin-top:8px';
    apply.addEventListener('click', () => applyOpaList(rows, msg).catch((e) => { msg.textContent = 'Fehler: ' + e.message; }));
    foot.appendChild(apply); foot.appendChild(msg);
    box.appendChild(foot);
  }

  function removeDynWhite(g) {
    const w = getDynWhite();
    let ch = false;
    for (const [k, e] of Object.entries(w)) {
      if (k === norm(g.name) || (g.id && (e.id || idOf(e.url)) === String(g.id))) { delete w[k]; ch = true; }
    }
    if (ch) { gmSet(K_WHITE, w); _wIdCache.t = 0; }
    return ch;
  }
  const isStaticWhite = (g) => WHITELIST.some((e) => norm(e.name) === norm(g.name));

  async function applyOpaList(rows, msg) {
    // zu tun: Ignorieren für noch nicht Ignorierte; Whitelist für alle, die noch nicht drauf sind (Ignorierte werden entsperrt)
    const todo = rows.filter((r) => (r.sel.value === 'ignore' && !r.blocked) || (r.sel.value === 'white' && (!r.white || r.blocked)));
    if (!todo.length) { msg.textContent = 'Nichts zu tun.'; return; }
    const other = lockedByOther();
    if (other) { msg.textContent = lockNotice(other); return; }
    const nI = todo.filter((r) => r.sel.value === 'ignore').length, nW = todo.length - nI;
    if (!confirm(`${nI} ignorieren, ${nW} auf die Whitelist?${CONFIG.DRY_RUN && nI ? '\n\n[Testmodus: Ignorieren wird nur durchgespielt]' : ''}`)) return;
    if (!(await acquireLock(opaT('Opa-Liste anwenden')))) { msg.textContent = lockNotice(getLock()); return; }
    const ev = eventInfo();
    const party = { name: ev.name || 'Party', date: ev.date || fmtDay(Date.now()) };
    const src = sourceOf('Party-Gästeliste') || 'Party';
    const queue = [];
    const out = [];
    for (const r of todo) {
      const g = r.g;
      const info = { id: g.id, path: g.path, url: g.url, name: g.name };
      msg.textContent = `${g.name}: wird bearbeitet …`;
      if (r.sel.value === 'white') {
        if (r.blocked) {
          const u = await bgUnignore(g.id);
          if (!u.ok) { out.push(`${g.name}: ${u.msg}`); continue; }
          const logPath = Object.keys(getLog()).find((p) => idOf(p) === String(g.id)) || g.path;
          markUnblocked(logPath, info, `Whitelist: ${CONFIG.PARTY_REASON}`);
          queue.push(Object.assign({}, info, { ages: [], action: 'note', line: CONFIG.PARTY_NOTE_TEXT.replace('{party}', party.name).replace('{datum}', party.date) }));
          await sleep(rand(800, 1600));
        }
        addWhiteEntry(info, CONFIG.PARTY_REASON, party);
        out.push(`${g.name}: Whitelist`);
      } else {
        if (r.white) {
          if (isStaticWhite(g)) { out.push(`${g.name}: steht fest im Skript auf der Whitelist – nicht geändert`); continue; }
          removeDynWhite(g);
        }
        // geprüfte Treffer direkt ignorieren, ungeprüfte vorher auf dem Profil prüfen
        queue.push(Object.assign({}, r.c.item || info, { source: src, verify: !!r.unchecked, force: !r.unchecked,
          reason: r.c.item && r.c.item.reason ? r.c.item.reason : 'Alter' }));
      }
    }
    removeWhitelistedFromWatch();
    decorateGuests();
    if (!queue.length) { msg.textContent = out.join(' · ') || 'Fertig.'; releaseLock(); return; }
    msg.textContent = (out.length ? out.join(' · ') + ' · ' : '') + `${queue.length} Profil(e) werden jetzt nacheinander geöffnet …`;
    await sleep(1500);
    setState({ running: true, mode: 'profil', queue, count: 0, auto: true, returnUrl: location.href.split('#')[0], source: src });
    location.href = location.origin + queue[0].path;
  }

  // Notiz nur bereinigen (eigene „Alter Sack …“-Zeilen entfernen)
  async function cleanOwnNote() {
    const ed = await openNoteEditor();
    if (ed.error) return { ok: false, msg: ed.error };
    const old = (ed.ta.value || ed.host.getAttribute('value') || '');
    const lines = old.split(/\r?\n/);
    const removed = lines.filter((l) => ownNoteRe().test(l));
    if (!removed.length) { await cancelNote(ed); return { ok: true, msg: 'keine Skript-Notiz vorhanden' }; }
    const value = lines.filter((l) => !ownNoteRe().test(l)).join('\n').replace(/^\n+|\n+$/g, '');
    const marker = value.split('\n').filter((l) => l.trim())[0] || '';
    const r = await commitNote(ed, value, marker, removed.map((x) => x.trim()), true);
    if (r.ok) r.msg = `Notiz bereinigt (${removed.length} Zeile(n) entfernt)`;
    return r;
  }

  // ---- Gästeliste unsichtbar komplett laden: dieselbe Event-Seite in einem verdeckten Frame ----
  // Der Frame (Name „jaf-bg-<m|alle>“) öffnet dort den Reiter, lädt per Scrollen/„Mehr Ergebnisse“ alles nach
  // und schickt die Einträge (HTML) zurück. Auf der sichtbaren Seite ändert sich bis dahin nichts.
  async function bgLoadGuests(gender, onProgress, timeoutMs = 180000) {
    const eid = eventIdOf(location.pathname);
    if (eid && gender === 'alle') {
      try { const l = await apiGuests(eid, 'alle', onProgress); if (l && l.length) return l; } catch (e) { /* Seitenweg */ }
    }
    return bgLoadGuestsFrame(gender, onProgress, timeoutMs);
  }
  function bgLoadGuestsFrame(gender, onProgress, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.name = 'jaf-bg-' + gender;
      f.src = location.href.split('#')[0];
      // im sichtbaren Bereich (sonst lädt JOYclub nicht nach), aber unsichtbar und nicht anklickbar
      f.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:900px;opacity:0;pointer-events:none;z-index:-1;border:0';
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      const done = (fn, v) => { window.removeEventListener('message', onMsg); clearTimeout(t); f.remove(); fn(v); };
      const onMsg = (ev) => {
        if (ev.source !== f.contentWindow || !ev.data || ev.data.jaf !== 'guests' || ev.data.gender !== gender) return;
        if (ev.data.progress != null) { if (onProgress) onProgress(ev.data.progress); return; }
        if (ev.data.error) done(reject, new Error(ev.data.error)); else done(resolve, ev.data.html || []);
      };
      const t = setTimeout(() => done(reject, new Error('Zeitüberschreitung beim Laden der Gästeliste')), timeoutMs);
      window.addEventListener('message', onMsg);
      document.body.appendChild(f);
    });
  }
  // läuft IM Frame
  async function bgFrameMain() {
    const gender = (window.name || '').slice('jaf-bg-'.length);
    const post = (m) => window.parent.postMessage(Object.assign({ jaf: 'guests', gender }, m), location.origin);
    try {
      await waitFor(() => document.querySelector('#guest_list'), 30000);
      const gTab = document.querySelector('a[href="#guest_list"]');
      if (gTab) gTab.click();
      await sleep(500);
      const tab = document.querySelector(`a[href="#guest_${gender}"]`);
      if (tab) tab.click();
      await sleep(800);
      const pane = document.getElementById('guest_' + gender);
      if (!pane) { post({ error: 'Reiter nicht gefunden' }); return; }
      await loadPaneFully(pane, (n) => post({ progress: n }));
      post({ html: [...pane.querySelectorAll('li.date_card')].map((li) => li.outerHTML) });
    } catch (e) { post({ error: e.message || String(e) }); }
  }
  const htmlToItems = (html) => { const ul = document.createElement('ul'); ul.innerHTML = html.join(''); return [...ul.children]; };

  // ---- Aufteilung der Gästeliste (nur außerhalb des Opa-Scans), im Hintergrund gebildet ----
  // Je Gruppe mit eingeschalteter „Visueller Einstufung“: Reiter nach den Mehrzahl-Bezeichnungen der Stufen
  // (gleiche Bezeichnungen = ein Reiter). Trans/Non-binary wandern in die zugeordnete Gruppe;
  // Paare (auch Männer-/Frauen-Paare) bleiben immer bei den Paaren. Der Original-Reiter bleibt sichtbar, bis die neuen fertig sind.
  const GUEST_PANE = { m: 'm', f: 'w', p: 'p' };
  // Gruppe einer Anmeldung für Reiter/AWO
  const guestGroup = (g) => (isCoupleType(g.type) || g.num === '3' ? 'p' : groupOfType(g.type) || groupOfReg(g));
  // Anzeige-Stufe einer Anmeldung (Werte „Partygäste“); ohne Alter → Stufe 3; Sugar Daddy/Mom → Stufe 3
  function guestStage(g, grp, cfg = CONFIG, src = 'Party') {
    const ages = (g.ages || []).filter((a) => a >= 18 && a <= 120);
    if (!ages.length) return 3;
    if (grp !== 'p') return stageOf(Math.max(...ages), vals(grp, src, null, cfg));
    const k = knownType(String(g.type || '').split('|')[0]);
    if (k === 'Männer-Paar' || k === 'Frauen-Paar' || ages.length < 2) {
      const who = k === 'Frauen-Paar' ? 'f' : 'm';
      const P = cfg.GROUPS.p, gap = ages.length === 2 ? Math.abs(ages[0] - ages[1]) : null;
      const rule = who === 'm' ? P.sd : P.sm;
      if (gap != null && rule && rule.on && gap >= rule.gap) return 3;
      return stageOf(Math.max(...ages), vals('p', src, who, cfg));
    }
    const P = cfg.GROUPS.p, [fa, ma] = ages;
    if ((P.sd && P.sd.on && ma - fa >= P.sd.gap) || (P.sm && P.sm.on && fa - ma >= P.sm.gap)) return 3;
    return Math.min(stageOf(fa, vals('p', src, 'f', cfg)), stageOf(ma, vals('p', src, 'm', cfg)));
  }
  // Reiter einer Gruppe: [{ key, label, stages:[…] }] – gleiche Bezeichnungen zusammengefasst
  function groupTabs(grp, cfg = CONFIG) {
    const out = [];
    cfg.GROUPS[grp].names.many.forEach((lbl, i) => {
      const t = out.find((x) => x.label === lbl);
      if (t) t.stages.push(i + 1); else out.push({ key: `${grp}${i + 1}`, label: lbl, stages: [i + 1] });
    });
    return out;
  }
  let guestAll = null; // geladene Anmeldungen (für den AWO-Faktor); false = nicht ladbar

  async function setupGuestTabs() {
    if (window.__jafSplits) return;
    if (!document.querySelector('#guest_list a[href="#guest_alle"], #guest_list a[href="#guest_m"], #guest_list a[href="#guest_p"]')) return;
    window.__jafSplits = 'loading';
    renderAwo();
    let items;
    try { items = htmlToItems(await bgLoadGuests('alle')); } catch (e) {
      console.warn('[Alter-Filter] Gästeliste im Hintergrund nicht ladbar – Original-Reiter bleiben.', e);
      guestAll = false; window.__jafSplits = 'done'; renderAwo(); return;
    }
    guestAll = items.map(parseGuest);
    // Herkunft (Original-Reiter von JOYclub) und Ziel jeder Anmeldung
    const allLink = document.querySelector('#guest_list a[href="#guest_alle"]');
    const contentOf = () => (document.getElementById('guest_alle') || document.querySelector('#guest_list .tab-pane') || {}).parentElement;
    const origGroup = (g) => (isCoupleType(g.type) || g.num === '3' ? 'p' : g.num === '2' || /frau/i.test(g.type || '') ? 'f' : 'm');
    const splitOn = (grp) => !!CONFIG.GROUPS[grp].visual;
    const tabClick = (tli, pane, content, ul) => (e) => {
      e.preventDefault();
      ul.querySelectorAll(':scope > li').forEach((x) => x.classList.remove('active'));
      tli.classList.add('active');
      content.querySelectorAll(':scope > .tab-pane').forEach((x) => x.classList.remove('active', 'in'));
      pane.classList.add('active', 'in');
    };
    // Karte kopieren: JOYclub lädt Profilbilder erst beim Hinscrollen (data-src/data-srcset) und kennt Kopien nicht –
    // deshalb die Bildadressen selbst eintragen; der Browser lädt sie dank loading="lazy" trotzdem erst bei Bedarf
    const cloneCard = (li) => {
      const c = li.cloneNode(true);
      c.querySelectorAll('img[data-src]').forEach((im) => { const u = im.getAttribute('data-src'); if (u && im.getAttribute('src') !== u) { im.setAttribute('loading', 'lazy'); im.setAttribute('src', u); } });
      c.querySelectorAll('source[data-srcset]').forEach((so) => { const u = so.getAttribute('data-srcset'); if (u && so.getAttribute('srcset') !== u) so.setAttribute('srcset', u); });
      c.querySelectorAll('.image-ui.lazy').forEach((d) => d.classList.add('initialized'));
      return c;
    };
    const mkTab = (id, label, title, n, after, content) => {
      const pane = document.createElement('div');
      pane.id = id; pane.className = 'tab-pane cards user_cards ov_h mb5'; pane.setAttribute('role', 'tabpanel');
      const ulc = document.createElement('ul');
      ulc.className = 'date_list ov_h'; ulc.setAttribute('data-max-columns', '4');
      pane.appendChild(ulc);
      content.appendChild(pane);
      const tli = document.createElement('li');
      tli.className = 'jaf-guest-tab'; tli.setAttribute('role', 'presentation'); tli.title = title;
      tli.innerHTML = `<a href="#${id}" data-toggle="tab" aria-controls="${id}">${escHtml(label)} <span>(${n})</span></a>`;
      tli.querySelector('a').addEventListener('click', tabClick(tli, pane, content, after.parentElement));
      after.after(tli);
      return { tli, pane, ul: ulc };
    };
    // Zahl in einem Original-Reiter anpassen („Frauen (25)“)
    const bumpCount = (link, d) => {
      const walk = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const n = walk.currentNode;
        if (/\(\d+\)/.test(n.nodeValue)) { n.nodeValue = n.nodeValue.replace(/\((\d+)\)/, (m0, x) => `(${+x + d})`); return; }
      }
    };
    const content = contentOf();
    const buckets = {}; // Gruppe → Reiter-Schlüssel → [li]
    const moved = {};   // Ziel-Gruppe (ohne Aufteilung) → [li] aus aufgeteilten Gruppen
    const hasNew = {}, srcCount = {};
    items.forEach((li, i) => {
      const g = guestAll[i];
      if (g.extern) return;
      const tgt = guestGroup(g) || origGroup(g);
      const src = origGroup(g);
      srcCount[src] = (srcCount[src] || 0) + 1;
      if (splitOn(tgt)) {
        const tabs = groupTabs(tgt);
        const st = guestStage(g, tgt);
        const t = tabs.find((x) => x.stages.includes(st)) || tabs[tabs.length - 1];
        ((buckets[tgt] = buckets[tgt] || {})[t.key] = buckets[tgt][t.key] || []).push(cloneCard(li));
        hasNew[tgt] = true;
      } else if (splitOn(src) && tgt !== src) {
        (moved[tgt] = moved[tgt] || []).push(cloneCard(li));
      }
    });
    if (content) {
      // 1. neue Reiter je aufgeteilter Gruppe – nur nicht leere
      for (const grp of GROUP_KEYS) {
        if (!splitOn(grp) || !hasNew[grp]) continue;
        const oLink = document.querySelector(`#guest_list a[href="#guest_${GUEST_PANE[grp]}"]`);
        const anchor = oLink || allLink;
        if (!anchor) continue;
        const oLi = anchor.closest('li');
        let after = oLi;
        for (const t of groupTabs(grp)) {
          const list = (buckets[grp] || {})[t.key] || [];
          if (!list.length) continue;
          const tab = mkTab(`jaf_guest_${t.key}`, t.label, `${GROUP_LABELS[grp]}: ${t.label}`, list.length, after, content);
          list.forEach((li) => tab.ul.appendChild(li));
          after = tab.tli;
        }
      }
      // 2. Anmeldungen ohne neuen Reiter in den Original-Reiter ihrer Gruppe (fehlt er: anlegen)
      for (const [grp, list] of Object.entries(moved)) {
        let oLink = document.querySelector(`#guest_list a[href="#guest_${GUEST_PANE[grp]}"]`);
        let pane = document.getElementById('guest_' + GUEST_PANE[grp]);
        let ulc = pane && pane.querySelector('ul.date_list');
        if (!oLink || !ulc) {
          const ref = document.querySelector('#guest_list ul.nav-pills > li:last-of-type:not(.jaf-awo)') || (allLink && allLink.closest('li'));
          if (!ref) continue;
          const tab = mkTab(`jaf_guest_orig_${grp}`, GROUP_LABELS[grp], GROUP_LABELS[grp], 0, ref, content);
          oLink = tab.tli.querySelector('a'); ulc = tab.ul;
        }
        list.forEach((li) => ulc.appendChild(li));
        bumpCount(oLink, list.length);
      }
      // 3. Original-Reiter aufgeteilter Gruppen ausblenden (alle ihre Anmeldungen sind umgezogen); leere Gruppe: Original bleibt
      for (const grp of GROUP_KEYS) {
        if (!splitOn(grp) || !srcCount[grp]) continue;
        const oLink = document.querySelector(`#guest_list a[href="#guest_${GUEST_PANE[grp]}"]`);
        if (!oLink) continue;
        const oLi = oLink.closest('li');
        const wasActive = oLi.classList.contains('active');
        oLi.style.display = 'none';
        if (wasActive) { const nx = oLi.parentElement.querySelector(':scope > li.jaf-guest-tab a'); if (nx) nx.click(); }
      }
      decorateGuests();
    }
    window.__jafSplits = 'done';
    renderAwo();
  }

  // ---- AWO-Faktor ----
  // Je Gruppe: erwartete Erscheinende = Σ Anwesenheitsquote der Stufe; Anteil = erwartete Stufe-3 ÷ alle erwarteten.
  // AWO = gewichtete Summe der Anteile; Gruppen ohne Anmeldungen geben ihr Gewicht anteilig an die anderen ab.
  function computeAwo(guests, cfg = CONFIG) {
    const out = { value: null, groups: {} };
    for (const grp of GROUP_KEYS) out.groups[grp] = { n: 0, cnt: [0, 0, 0], exp: 0, exp3: 0, share: null, w: cfg.AWO.weight[grp] || 0 };
    for (const g of guests || []) {
      if (g.extern) continue;
      const grp = guestGroup(g);
      if (!grp) continue;
      const st = guestStage(g, grp, cfg);
      const G = out.groups[grp];
      const q = (cfg.AWO.quota[grp][st - 1] || 0) / 100;
      G.n++; G.cnt[st - 1]++; G.exp += q; if (st === 3) G.exp3 += q;
    }
    let wsum = 0, sum = 0;
    for (const grp of GROUP_KEYS) {
      const G = out.groups[grp];
      if (G.n && G.exp > 0) { G.share = G.exp3 / G.exp; wsum += G.w; sum += G.w * G.share; }
    }
    if (wsum > 0) out.value = sum / wsum;
    out.wsum = wsum;
    return out;
  }
  function awoTitle(a) {
    const lines = GROUP_KEYS.filter((grp) => a.groups[grp].n).map((grp) => {
      const G = a.groups[grp], N = CONFIG.GROUPS[grp].names.many;
      return `${GROUP_LABELS[grp]}: ${G.cnt.map((c, i) => `${c} ${N[i]}`).join(' · ')} → ${pct(G.share)} (Gewicht ${a.wsum ? Math.round(G.w / a.wsum * 100) : 0} %)`;
    });
    return (lines.join('\n') || 'keine Anmeldungen') + '\nAWO = gewichtete Summe der Anteile erwarteter Stufe-3-Gäste';
  }
  // Farbe des AWO-Faktors (Prozentwert 0–100): <10 hellgrün, <25 grün, <35 orange, ab 35 rot
  function awoColor(p) {
    if (p == null) return { bg: 'rgba(0,0,0,.75)', fg: '#fff' };
    if (p < 10) return { bg: '#9ccc65', fg: '#000' };
    if (p < 25) return { bg: '#43a047', fg: '#fff' };
    if (p < 35) return { bg: '#fb8c00', fg: '#000' };
    return { bg: '#e53935', fg: '#fff' };
  }
  const pct = (x) => (x == null ? '–' : (x * 100).toFixed(1).replace('.', ',') + ' %');
  function renderAwo() {
    const ul = document.querySelector('#guest_list ul.nav-pills');
    if (!ul) return;
    let li = ul.querySelector('.jaf-awo');
    if (!li) {
      li = document.createElement('li');
      li.className = 'jaf-awo';
      li.setAttribute('role', 'presentation');
      li.style.cssText = 'float:right;margin-left:auto;padding:10px 6px;font-weight:bold;white-space:nowrap;pointer-events:auto;cursor:default';
      ul.appendChild(li);
    }
    const ready = guestAll !== null && window.__jafSplits === 'done';
    if (!ready) { li.textContent = 'AWO …'; li.title = 'wird berechnet, sobald die Gästeliste im Hintergrund geladen ist'; return; }
    if (guestAll === false) { li.textContent = 'AWO ?'; li.title = 'Gästeliste konnte im Hintergrund nicht geladen werden'; return; }
    const a = computeAwo(guestAll);
    li.textContent = `AWO ${pct(a.value)}`;
    const ac = awoColor(a.value == null ? null : a.value * 100);
    Object.assign(li.style, { background: a.value == null ? '' : ac.bg, color: a.value == null ? '' : ac.fg, borderRadius: '6px', padding: '6px 10px', marginTop: '4px' });
    li.title = awoTitle(a);
    // speichern (für spätere Auswertung/Export)
    const id = eventIdOf(location.pathname);
    if (id && a.value != null) {
      const ev = getEvents();
      ev[id] = Object.assign(ev[id] || {}, { awo: Math.round(a.value * 1000) / 10, awoTs: Date.now() });
      gmSet(K_EVENTS, ev);
    }
  }

  // eine Gästeliste (Tab-Inhalt) vollständig nachladen: scrollen, dann „Mehr Ergebnisse“
  async function loadPaneFully(pane, onGrow) {
    if (pane.__jafLoading) return;
    pane.__jafLoading = true;
    const count = () => pane.querySelectorAll('li.date_card').length;
    let idle = 0;
    try {
      while (idle < CONFIG.SCROLL_IDLE_ROUNDS) {
        const before = count();
        const items = pane.querySelectorAll('li.date_card');
        if (items.length) items[items.length - 1].scrollIntoView({ block: 'end' });
        window.scrollBy(0, 200);
        window.dispatchEvent(new Event('scroll'));
        let grew = await waitFor(() => (count() > before ? true : null), 5000);
        if (!grew) {
          const more = [...pane.querySelectorAll('j-button, button, a')].find((e) => reallyVisible(e) && /mehr ergebnisse/i.test(e.textContent || ''));
          if (more) { await realClick(more); grew = await waitFor(() => (count() > before ? true : null), 12000); }
        }
        if (grew) { idle = 0; await sleep(800); if (onGrow) onGrow(count()); } else idle++;
      }
      pane.__jafComplete = true;
    } finally { pane.__jafLoading = false; }
    return count();
  }

  // ---- Appointments-Seite (eigene Party-Anmeldungen) ----
  const isAppointmentsPage = () => CONFIG.APPOINTMENTS_RE.test(location.pathname);
  function ownProfileId() {
    const a = document.querySelector('.navigation_user_box a[href*="/profile/"]');
    return idOf(a && a.getAttribute('href')) || document.body.getAttribute('data-session-user-id') || '';
  }
  const isOwnAppointments = () => {
    const m = location.pathname.match(CONFIG.APPOINTMENTS_RE);
    return !!(m && m[1] === ownProfileId() && m[1] === (document.body.getAttribute('data-session-user-id') || m[1]));
  };
  function eventsHeadline() { return [...document.querySelectorAll('h2.profile-headline')].find((h) => /eventanmeldungen/i.test(h.textContent)); }
  function readAppointments() {
    const h = eventsHeadline();
    if (!h) return [];
    let box = h.nextElementSibling;
    while (box && !box.classList.contains('profile-appointments-page__item-container')) box = box.nextElementSibling;
    if (!box) return [];
    return [...box.querySelectorAll('a.profile-wide-content-card[href*="/event/"]')].map((a) => {
      const url = new URL(a.getAttribute('href'), location.origin);
      const id = eventIdOf(url.pathname);
      const txt = (a.textContent || '').replace(/\s+/g, ' ');
      const dm = txt.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      const loc = a.querySelector('.profile-wide-content-card__location');
      const badge = a.querySelector('j-badge');
      const status = badge ? ((badge.shadowRoot && badge.shadowRoot.querySelector('.j-badge__content')) || badge).textContent.trim() : '';
      const slug = (url.pathname.match(/\/event\/\d+\.([^/]+)\.html/) || [])[1] || '';
      return {
        id, url: url.href, a, date: dm ? dm[0] : '', dayTs: dm ? new Date(+dm[3], +dm[2] - 1, +dm[1]).getTime() : 0,
        location: loc ? loc.textContent.trim() : '', status, hidden: !!a.querySelector('j-icon[type="j-ico-eye-slash"]'),
        slugName: slug.replace(/_/g, ' '),
      };
    }).filter((e) => e.id);
  }

  // gespeicherte Partys: { id: { name, url, date, start, location, status, hidden, doneTs } }
  const K_EVENTS = 'jaf_events';
  const getEvents = () => gmGet(K_EVENTS, {});
  function saveEventsFromList(list) {
    const m = getEvents();
    for (const e of list) {
      const o = m[e.id] || {};
      const upd = { url: e.url, date: e.date, location: e.location, status: e.status, hidden: e.hidden };
      for (const k of Object.keys(upd)) if (upd[k] === undefined || upd[k] === '') delete upd[k];
      m[e.id] = Object.assign(o, upd, { name: o.name || e.name || e.slugName });
    }
    gmSet(K_EVENTS, m);
  }
  // Scan-Datum + AWO-Faktor auf einer Party-Karte (a.profile-wide-content-card); placeholder = auch ungescannt anzeigen
  function eventCardBadges(a, id, placeholder) {
    const m = getEvents();
    const ev = m[id] || {};
    const d = ev.doneTs, awo = ev.awo;
    const scanned = !!d || awo != null;
    if (!scanned && !placeholder) { a.querySelectorAll('.jaf-event-badge, .jaf-awo-badge').forEach((x) => x.remove()); return; }
    let b = a.querySelector('.jaf-event-badge');
    if (!b) {
      b = document.createElement('div');
      b.className = 'jaf-event-badge';
      b.style.cssText = 'position:absolute;top:6px;right:6px;z-index:5;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.75);color:#fff;' +
        'font:bold 11px system-ui;padding:2px 6px;border-radius:10px;pointer-events:none';
      a.style.position = 'relative';
      a.appendChild(b);
    }
    const txt = d ? fmtDay(d) : '--.--.----';
    if (b.dataset.txt !== txt) {
      b.dataset.txt = txt;
      b.innerHTML = `<svg viewBox="0 0 640 1280" width="10" height="12" style="fill:currentColor">${nickG()}</svg><span></span>`;
      b.querySelector('span').textContent = txt;
      b.title = d ? opaT(`Opa-Scan zuletzt komplett: ${fmtTs(d)}`) : opaT('Opa-Scan: noch nie komplett bearbeitet');
    }
    // zweiter Badge darunter: gespeicherter AWO-Faktor
    let w = a.querySelector('.jaf-awo-badge');
    if (!w) {
      w = document.createElement('div');
      w.className = 'jaf-awo-badge';
      w.style.cssText = 'position:absolute;top:28px;right:6px;z-index:5;background:rgba(0,0,0,.75);color:#fff;' +
        'font:bold 11px system-ui;padding:2px 6px;border-radius:10px;pointer-events:none';
      a.appendChild(w);
    }
    const wt = `AWO ${awo == null ? '–' : String(awo).replace('.', ',') + ' %'}`;
    const wc = awoColor(awo == null ? null : awo);
    w.style.background = wc.bg; w.style.color = wc.fg;
    if (w.textContent !== wt) {
      w.textContent = wt;
      w.title = awo == null ? 'AWO-Faktor noch nicht berechnet' : `AWO-Faktor, berechnet am ${fmtTs(ev.awoTs || 0)}`;
    }
  }
  function updateEventBadges() {
    if (isRegistrationsPage()) updateRegAwo();
    for (const e of readAppointments()) eventCardBadges(e.a, e.id, true);
  }
  // Profilseiten: Slider „Dates & Events“ – eigenes Profil mit Platzhaltern, fremde nur gescannte Partys
  const isOwnProfile = () => isProfilePage() && idOf(location.pathname) === (document.body.getAttribute('data-session-user-id') || ownProfileId());
  function updateProfileSliderBadges() {
    const own = isOwnProfile();
    for (const a of document.querySelectorAll('.profile-appointment-slider a.profile-wide-content-card[href*="/event/"]')) {
      let id = '';
      try { id = eventIdOf(new URL(a.getAttribute('href'), location.origin).pathname); } catch (e) { /* egal */ }
      if (id) eventCardBadges(a, id, own);
    }
  }
  function insertEventOpaButton() {
    if (document.querySelector('.jaf-ev-opa-btn')) return true;
    const h = eventsHeadline();
    if (!h) return false;
    const b = document.createElement('j-control-button');
    b.className = 'jaf-ev-opa-btn';
    b.setAttribute('variant', 'tertiary');
    b.setAttribute('role', '');
    b.style.cssText = 'margin-left:12px;vertical-align:middle';
    b.innerHTML = `<svg slot="icon-prepend" viewBox="0 0 640 1280" width="16" height="16" preserveAspectRatio="xMidYMid meet" ` +
      `style="width:16px;height:16px;fill:currentColor" aria-hidden="true">${nickG()}</svg>` +
      opaT('<span>Opa-Scan starten</span>');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); bgEvStart(); });
    h.appendChild(b);
    return true;
  }

  // ---- Seite „Dates & Events“ → eigene Event-Anmeldungen (/dates_partys/events/registrations/) ----
  const isRegistrationsPage = () => CONFIG.REGISTRATIONS_RE.test(location.pathname);
  const isScanHome = () => (isAppointmentsPage() && isOwnAppointments()) || isRegistrationsPage();
  function readRegistrations() {
    const seen = new Map();
    for (const it of document.querySelectorAll('.card-list-ui-list-item.event-card-ui[data-element-id]')) {
      if (it.classList.contains('card-ui-detail-container')) continue;
      const a = it.querySelector('a.card-ui-link[href*="/event/"]') || it.querySelector('a[href*="/event/"]');
      if (!a) continue;
      const url = new URL(a.getAttribute('href'), location.origin);
      const id = eventIdOf(url.pathname) || it.getAttribute('data-element-id');
      if (!id || seen.has(id)) continue;
      const sec = it.closest('section[data-date]');
      const dm = ((sec && sec.getAttribute('data-date')) || it.textContent || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
      const hl = it.querySelector('.card-ui-information-headline');
      const loc = it.querySelector('.location');
      const slug = (url.pathname.match(/\/event\/\d+\.([^/]+)\.html/) || [])[1] || '';
      seen.set(id, {
        id, url: url.origin + url.pathname, a, date: dm ? dm[0] : '', dayTs: dm ? new Date(+dm[3], +dm[2] - 1, +dm[1]).getTime() : 0,
        location: loc ? loc.textContent.trim() : undefined, name: hl ? hl.textContent.replace(/\s+/g, ' ').trim() : '',
        slugName: slug.replace(/_/g, ' '), status: regStatusOf(document, id),
      });
    }
    return [...seen.values()];
  }
  // alle Einträge nachladen: die Liste lädt erst beim Herunterscrollen nach
  async function loadAllRegistrations(onProgress) {
    const y0 = window.scrollY;
    const box = document.querySelector('.jc-infinite-scroll');
    const loadingEl = () => document.querySelector('.jc-infinite-scroll-loading');
    const isLoading = () => { const l = loadingEl(); return !!(l && l.style.display !== 'none' && !l.classList.contains('hidden')); };
    let n = readRegistrations().length, idle = 0;
    for (let r = 0; r < CONFIG.REG_LOAD_MAX_ROUNDS && idle < 3; r++) {
      const before = n;
      const items = document.querySelectorAll('.card-list-ui-list-item.event-card-ui');
      if (items.length) items[items.length - 1].scrollIntoView({ block: 'end' });
      window.scrollTo(0, document.documentElement.scrollHeight);
      window.dispatchEvent(new Event('scroll'));
      if (box) box.dispatchEvent(new Event('scroll'));
      let grew = await waitFor(() => (readRegistrations().length > before ? true : null), 5000);
      if (!grew && isLoading()) grew = await waitFor(() => (readRegistrations().length > before ? true : null), 10000);
      if (!grew) {
        const more = [...document.querySelectorAll('j-button, button, a')].find((e) => reallyVisible(e) && /mehr (ergebnisse|laden|anzeigen)/i.test(e.textContent || ''));
        if (more) { await realClick(more); grew = await waitFor(() => (readRegistrations().length > before ? true : null), 10000); }
      }
      n = readRegistrations().length;
      if (grew) { idle = 0; if (onProgress) onProgress(n); await sleep(600); } else idle++;
    }
    window.scrollTo(0, y0);
    return readRegistrations();
  }
  // Liste der zu scannenden Partys – je nach Seite
  async function scanEventList(onProgress) {
    if (isRegistrationsPage()) {
      if (onProgress) onProgress(readRegistrations().length);
      return loadAllRegistrations(onProgress);
    }
    return readAppointments();
  }
  // AWO-Faktor hinter „… Personen angemeldet.“ (im selben Link)
  function updateRegAwo() {
    const m = getEvents();
    for (const a of document.querySelectorAll('a.guest_list_link[href*="/event/"]')) {
      let id = '';
      try { id = eventIdOf(new URL(a.getAttribute('href'), location.origin).pathname); } catch (e) { /* egal */ }
      const ev = id && m[id];
      const awo = ev && ev.awo;
      const targets = a.querySelectorAll('.mivi_attending_persons');
      for (const t of (targets.length ? targets : [a])) {
        let w = t.querySelector('.jaf-reg-awo');
        if (!w) {
          w = document.createElement('span');
          w.className = 'jaf-reg-awo';
          w.style.cssText = 'display:inline-block;margin-left:6px;padding:0 6px;border-radius:8px;font-weight:bold;white-space:nowrap';
          t.appendChild(w);
        }
        const ts = ev && (ev.awoTs || ev.doneTs);
        const txt = awo == null ? 'AWO – (--.--.----)' : `AWO ${String(awo).replace('.', ',')} %${ts ? ` (${fmtTs(ts)})` : ''}`;
        const c = awoColor(awo == null ? null : awo);
        w.style.background = c.bg; w.style.color = c.fg;
        if (w.textContent !== txt) { w.textContent = txt; w.title = awo == null ? 'AWO-Faktor noch nicht berechnet' : ts ? `AWO-Faktor, berechnet am ${fmtTs(ts)}` : 'AWO-Faktor'; }
      }
    }
  }
  function insertRegOpaButton() {
    if (document.querySelector('.jaf-reg-opa-btn')) return true;
    const past = document.querySelector('button.button_past_events');
    if (!past) return false;
    const b = document.createElement('button');
    b.type = 'button';
    b.title = opaT('Opa-Scan starten');
    b.className = 'jaf-reg-opa-btn btn-flat-special-light btn btn-default';
    b.innerHTML = `<svg viewBox="0 0 640 1280" width="9" height="16" style="fill:currentColor;vertical-align:-2px" aria-hidden="true">` +
      opaT(`${nickG()}</svg> <span class="btn-text">Opa-Scan starten</span>`);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); bgEvStart(); });
    // vor die Button-Gruppe setzen (eigener Button mit Abstand, nicht angeklebt)
    const grp = past.closest('.btn-group') || past;
    b.style.marginRight = '8px';
    grp.parentElement.insertBefore(b, grp);
    return true;
  }

  // =====================================================================
  // ---------- Partys synchronisieren (Export/Import zwischen zwei Konten) ----------
  // Export: kommende Partys aus „Dates & Events“ (Angemeldet inkl. Warteliste / Vorgemerkt) als JSON in die Zwischenablage.
  // Import: Liste einfügen, dann merken / an- und abmelden nach Option 1–5.
  // =====================================================================
  const PS_FORMAT = 'opa-scan-partys';
  const PS_GENDER = { m: 'Mann', w: 'Frau', p: 'Paar' };
  const PS_ST = { A: 'Angemeldet', M: 'Vorgemerkt' };
  // Status einer Karte auf „Dates & Events“: A (angemeldet/Warteliste) | M (gemerkt) | ''
  function regStatusOf(root, id) {
    let st = '';
    for (const it of root.querySelectorAll(`.card-list-ui-list-item[data-element-id="${id}"]`)) {
      const box = it.querySelector('.card-ui-detail-btn-container') || it;
      const bm = box.querySelector('.event_bookmark_btn');
      if (bm && /gemerkt/i.test(bm.textContent || '')) st = st || 'M';
      for (const b of box.querySelectorAll('j-button')) { const t = norm(b.textContent); if (t === 'angemeldet' || /warteliste/.test(t)) st = 'A'; }
    }
    return st;
  }
  // eigene Konten (eingeloggtes + Zweitkonto aus „Partys synchronisieren“) zählen nie als Interaktion
  const K_OWN_ACCS = 'jaf_own_accs'; // { id: name }
  function ownIds() {
    const s = new Set(Object.keys(GM_getValue(K_OWN_ACCS, {}) || {}));
    const me = document.body && document.body.getAttribute('data-session-user-id');
    if (me) s.add(String(me));
    return s;
  }
  function rememberOwnAccount(id, name) {
    if (!id) return;
    const m = GM_getValue(K_OWN_ACCS, {}) || {};
    if (m[id] === name) return;
    m[id] = name || m[id] || '';
    GM_setValue(K_OWN_ACCS, m);
  }
  function ownAccount() {
    const a = document.querySelector('.navigation_user_box a.user_link');
    const name = a ? ((a.childNodes[0] && a.childNodes[0].nodeValue) || a.textContent).trim() : '';
    return { id: document.body.getAttribute('data-session-user-id') || ownProfileId(), name };
  }
  const todayStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  // eigene kommende Partys mit Status (aus „Dates & Events“, notfalls im Hintergrund geladen)
  async function psLoadOwn(onN) {
    let list;
    if (isRegistrationsPage()) list = (await loadAllRegistrations(onN)).map((e) => Object.assign({}, e, { status: regStatusOf(document, e.id) }));
    else {
      const data = await bgFrameG(location.origin + '/dates_partys/events/registrations/', 'jaf-bg-reg', onN, 10 * 60000);
      if (data.error) throw new Error(data.error);
      list = data.list || [];
    }
    const t0 = todayStart();
    return list.filter((e) => !e.dayTs || e.dayTs >= t0).map((e) => ({ id: e.id, url: e.url, name: e.name || e.slugName || '', date: e.date, location: e.location || '', status: e.status || '' }));
  }
  async function copyText(t) {
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(t, 'text'); return true; } } catch (e) { /* weiter */ }
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* weiter */ }
    try { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
  }
  // Zustand einer Event-Seite: st A (angemeldet) | W (Warteliste) | M (gemerkt) | N (nichts) | ? ; offered: buchbare Typen; err: Fehlerleiste
  function parseEvState(doc) {
    const box = doc.querySelector('.event_registration_buttons');
    const main = box && box.querySelector('j-button.link_to_tab');
    const mt = norm(main ? main.textContent : '');
    const bm = box && box.querySelector('j-button.js_submit_bookmark_form');
    const st = /warteliste/.test(mt) ? 'W' : mt === 'angemeldet' ? 'A' : bm && /gemerkt/i.test(bm.textContent || '') ? 'M' : main || bm ? 'N' : '?';
    // Auswahl „Anmeldung als“: Optionen stehen im Shadow DOM (live) bzw. in <template shadowrootmode> (abgerufene Seite)
    const deepText = (el) => {
      if (!el) return '';
      let t = el.textContent || '';
      if (el.shadowRoot) t += ' ' + deepText(el.shadowRoot);
      if (el.querySelectorAll) el.querySelectorAll('template').forEach((tp) => { t += ' ' + deepText(tp.content); });
      if (el.querySelectorAll) el.querySelectorAll('*').forEach((c) => { if (c.shadowRoot) t += ' ' + deepText(c.shadowRoot); });
      return t;
    };
    const wordRe = (w) => new RegExp(`(^|[^\\p{L}-])${w}([^\\p{L}-]|$)`, 'u');
    const sel = doc.querySelector('#event_anmeldung j-form-select') || doc.querySelector('j-form-select');
    const selText = deepText(sel);
    const offered = ['Frau', 'Mann', 'Paar'].filter((w) => wordRe(w).test(selText));
    const errEl = doc.querySelector('j-growl[variant="error"]');
    const growl = (v) => [...doc.querySelectorAll(`j-growl[variant="${v}"]`)].map((g) => (g.textContent || '').replace(/\s+/g, ' ').trim()).join(' ');
    const title = (doc.querySelector('title') || {}).textContent || '';
    const name = title.replace(/\s*-\s*JOYclub\s*$/, '').replace(/^Erfolgreich angemeldet für\s*/, '');
    return { st, offered, err: errEl ? (errEl.textContent || '').replace(/\s+/g, ' ').trim() : '', ok: growl('success'), info: growl('info'), title, name };
  }
  async function postFormDoc(form, extra = {}) {
    const fd = formDataOf(form);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const action = new URL(form.getAttribute('action') || location.href, location.origin).href;
    const r = await fetch(action, { method: 'POST', body: fd, credentials: 'include' });
    const html = await r.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }
  const psState = async (url) => parseEvState(await fetchDoc(url));
  // merken (want=true) bzw. nicht mehr merken
  async function psBookmark(ev, want) {
    const doc = await fetchDoc(ev.url);
    const s = parseEvState(doc);
    if (s.st === 'A' || s.st === 'W') return { r: 'skip', msg: want ? 'angemeldet – Merken nicht nötig' : 'angemeldet – bleibt' };
    if (want && s.st === 'M') return { r: 'skip', msg: 'bereits gemerkt' };
    if (!want && s.st !== 'M') return { r: 'skip', msg: 'nicht gemerkt' };
    const form = doc.getElementById('f_bookmark_event');
    if (!form) return { r: 'fail', msg: 'Merken-Formular nicht gefunden' };
    if (CONFIG.DRY_RUN) return { r: 'ok', msg: 'Testmodus' };
    await postForm(form);
    await sleep(800);
    const s2 = await psState(ev.url);
    return (want ? s2.st === 'M' : s2.st === 'N') ? { r: 'ok', msg: want ? 'gemerkt' : 'nicht mehr gemerkt' } : { r: 'fail', msg: `Status danach: ${s2.st}` };
  }
  // anmelden als g ('m'|'w'|'p'); Ergebnis r: ok (A/W) | skip | fail
  async function psRegister(ev, g) {
    const doc = await fetchDoc(ev.url);
    const s = parseEvState(doc);
    if (s.st === 'A' || s.st === 'W') return { r: 'skip', msg: 'bereits angemeldet' };
    const form = doc.getElementById('event_anmeldung');
    if (!form) return { r: 'fail', msg: 'keine Anmeldung möglich' };
    const label = PS_GENDER[g];
    if (s.offered.length && !s.offered.includes(label)) return { r: 'fail', why: 'type', msg: `nicht angemeldet – nur ${s.offered.join('/')} möglich` };
    if (CONFIG.DRY_RUN) return { r: 'ok', st: 'A', msg: 'Testmodus' };
    const res = parseEvState(await postFormDoc(form, { event_anmeldung_gender: g, event_anmeldung_request: 'save' }));
    if (res.err) return { r: 'fail', why: /zwei Veranstaltungen/i.test(res.err) ? 'day' : 'err', msg: `nicht angemeldet – ${res.err}` };
    if (/erfolgreich angemeldet/i.test(res.title) || res.ok) {
      if (/warteliste/i.test(res.info)) return { r: 'ok', st: 'W', msg: 'auf der Warteliste' };
      if (/erfolgreich angemeldet/i.test(res.ok)) return { r: 'ok', st: 'A', msg: 'angemeldet' };
    }
    await sleep(800);
    const s2 = await psState(ev.url);
    if (s2.st === 'A' || s2.st === 'W') return { r: 'ok', st: s2.st, msg: s2.st === 'W' ? 'auf der Warteliste' : 'angemeldet' };
    return { r: 'fail', why: 'err', msg: `nicht angemeldet – ${s2.err || 'unbekannter Grund'}` };
  }
  // stornieren: echte Buttons im Hintergrund-Frame („Stornieren“ → „Anmeldung stornieren“)
  const K_EVST = 'jaf_evst_job';
  async function psStorno(ev) {
    const s = await psState(ev.url);
    if (s.st !== 'A' && s.st !== 'W') return { r: 'skip', msg: 'nicht angemeldet' };
    if (CONFIG.DRY_RUN) return { r: 'ok', msg: 'Testmodus' };
    gmSet(K_EVST, { url: ev.url, phase: 'start', ts: Date.now() });
    let data;
    try { data = await bgFrameG(ev.url, 'jaf-bg-evst-' + Date.now().toString(36), null, 90000); } catch (e) { if (e.fatal) throw e; data = { error: e.message }; }
    finally { gmSet(K_EVST, null); }
    await sleep(600);
    const s2 = await psState(ev.url);
    if (s2.st === 'N' || s2.st === 'M') return { r: 'ok', msg: 'storniert' };
    return { r: 'fail', msg: `Stornieren fehlgeschlagen${data && data.error ? ' – ' + data.error : ''}` };
  }
  // IM Frame: Anmeldung stornieren
  async function evStornoFrame() {
    try {
      const job = gmGet(K_EVST, null);
      await waitFor(() => document.querySelector('.event_registration_buttons'), 30000);
      await sleep(1200);
      const s = parseEvState(document);
      if (!job || job.phase === 'clicked' || (s.st !== 'A' && s.st !== 'W')) { bgPost({ state: s.st }); return; }
      const btns = () => [...document.querySelectorAll('j-button')];
      const st = btns().find((b) => norm(b.textContent) === 'stornieren');
      if (!st) { bgPost({ error: 'Button „Stornieren“ nicht gefunden' }); return; }
      gmSet(K_EVST, Object.assign({}, job, { phase: 'clicked' }));
      await realClick(st);
      const conf = await waitFor(() => btns().find((b) => norm(b.textContent) === 'anmeldung stornieren' && reallyVisible(b)), 10000);
      if (!conf) { bgPost({ error: 'Bestätigung „Anmeldung stornieren“ nicht gefunden' }); return; }
      await realClick(conf);
      // Seite lädt neu (dann meldet der nächste Aufruf) oder ändert sich ohne Neuladen
      const changed = await waitFor(() => { const x = parseEvState(document); return x.st === 'N' || x.st === 'M' ? x : null; }, 20000);
      bgPost({ state: changed ? changed.st : parseEvState(document).st });
    } catch (e) { bgPost({ error: e.message || String(e) }); }
  }

  // ---- Popups ----
  function psOpen() {
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgBar2(null);
    bgTitle('Partys synchronisieren', false);
    bgUi('', 'Partys dieses Kontos exportieren oder die Liste eines anderen Kontos übernehmen.', null, '');
    bgPopup().querySelector('.jaf-bg-barwrap').style.display = 'none';
    bgBody(null);
    bgButtons([
      { label: 'Exportieren', fn: () => psExport() },
      { label: 'Importieren', fn: () => psImport() },
      { label: 'Abbrechen', fn: closeBgPopup, focus: true },
    ]);
  }
  async function psExport() {
    bgBody(null);
    bgUi('Exportieren', 'Lese Deine Partys aus „Dates & Events“ …', null, '');
    bgButtons([{ label: 'Abbrechen', fn: closeBgPopup, focus: true }]);
    let list;
    try { list = await psLoadOwn((n) => bgUi(null, `Lese Deine Partys … ${n}`, null, null)); } catch (e) {
      bgUi('Export nicht möglich', e.message || String(e), null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return;
    }
    const acc = ownAccount();
    const out = { format: PS_FORMAT, v: 1, account: acc.name, accountId: acc.id, ts: Date.now(),
      events: list.filter((e) => e.status).map((e) => ({ id: e.id, url: e.url, name: e.name, date: e.date, location: e.location, status: PS_ST[e.status] })) };
    const json = JSON.stringify(out);
    const ok = await copyText(json);
    const nA = out.events.filter((e) => e.status === 'Angemeldet').length;
    bgUi(ok ? `${out.events.length} Partys in die Zwischenablage kopiert` : 'Kopieren nicht möglich',
      `${nA} angemeldet (inkl. Warteliste) · ${out.events.length - nA} vorgemerkt`, null,
      ok ? 'Im anderen Konto: „Synchronisieren“ → „Importieren“ und mit Strg+V einfügen.' : 'Bitte den Text unten markieren und kopieren.');
    if (!ok) { const ta = document.createElement('textarea'); ta.value = json; ta.style.cssText = 'width:100%;height:120px;margin-top:8px;background:#24272a;color:#eee;border:1px solid #3a3e42;border-radius:6px'; bgBody(ta); ta.select(); }
    bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]);
  }
  function psImport() {
    bgUi('Importieren', 'Liste aus dem anderen Konto hier einfügen (Strg+V):', null, '');
    const ta = document.createElement('textarea');
    ta.style.cssText = 'width:100%;height:110px;box-sizing:border-box;margin-top:4px;background:#24272a;color:#eee;border:1px solid #3a3e42;border-radius:6px;padding:6px;font:12px monospace';
    const err = document.createElement('div'); err.style.cssText = 'color:#ff8a80;font-size:12px;margin-top:4px';
    const w = document.createElement('div'); w.appendChild(ta); w.appendChild(err);
    bgBody(w);
    setTimeout(() => ta.focus(), 50);
    bgButtons([
      { label: 'Weiter', fn: () => {
        let d;
        try { d = JSON.parse(ta.value.trim()); } catch (e) { err.textContent = 'Das ist keine gültige Liste.'; return; }
        if (!d || d.format !== PS_FORMAT || !Array.isArray(d.events)) { err.textContent = 'Das ist keine Party-Liste des Opa-Scans.'; return; }
        psChoose(d);
      } },
      { label: 'Abbrechen', fn: closeBgPopup, focus: true },
    ]);
  }
  function psChoose(d) {
    const t0 = todayStart();
    const evs = d.events.filter((e) => e && e.id && e.url && (() => { const m = String(e.date || '').match(/(\d{2})\.(\d{2})\.(\d{4})/); return !m || new Date(+m[3], +m[2] - 1, +m[1]).getTime() >= t0; })());
    const nA = evs.filter((e) => e.status === 'Angemeldet').length;
    const same = String(d.accountId || '') === String(ownAccount().id);
    if (!same) rememberOwnAccount(String(d.accountId || ''), d.account || '');
    bgUi(`Liste von ${d.account || '?'} vom ${fmtTs(d.ts)}`,
      `${evs.length} kommende Partys: ${nA} angemeldet (inkl. Warteliste), ${evs.length - nA} vorgemerkt`, null,
      same ? '⚠ Die Liste stammt aus diesem Konto.' : '');
    bgBody(null);
    const go = (opt) => () => psPrepare(opt, evs);
    bgButtons([
      { label: 'Importierte Partys merken', fn: go(1), hint: 'Alle Partys der Liste werden gemerkt. Bereits Gemerktes bleibt.' },
      { label: 'Importierte Partys merken / nicht mehr merken', fn: go(2), hint: 'Erst wird alles nicht mehr gemerkt, was nicht in der Liste steht (Anmeldungen bleiben), dann wird alles aus der Liste gemerkt.' },
      { label: 'Für importierte Partys anmelden', fn: go(3), hint: 'Angemeldete der Liste werden angemeldet, Vorgemerkte gemerkt. Nichts wird entfernt.' },
      { label: 'Für importierte Partys an-/abmelden', fn: go(4), hint: 'Stellt den Stand der Liste her: anmelden, merken, stornieren und nicht mehr merken.' },
      { label: 'Einzeln fragen', fn: go(5), hint: 'Jede Party einzeln mit ihrem aktuellen Status anzeigen und entscheiden.' },
      { label: 'Abbrechen', fn: closeBgPopup, focus: true },
    ]);
  }
  // Anmeldetyp wählen (3, 4, 5)
  function psAskGender() {
    return new Promise((resolve) => {
      const own = gmGet(K_OWN_TYPE, '');
      const def = { Mann: 'm', Frau: 'w', Paar: 'p' }[own] || 'm';
      bgUi('Anmeldung als', '', null, '');
      const sel = document.createElement('select');
      sel.style.cssText = 'width:100%;padding:8px;border-radius:8px;background:#24272a;color:#eee;border:1px solid #3a3e42;font:15px system-ui';
      sel.innerHTML = '<option value="m">Mann</option><option value="w">Frau</option><option value="p">Paar</option>';
      sel.value = def;
      bgBody(sel);
      bgButtons([{ label: 'Fortsetzen', fn: () => resolve(sel.value) }, { label: 'Abbrechen', fn: () => { closeBgPopup(); resolve(null); }, focus: true }]);
    });
  }
  async function psPrepare(opt, evs) {
    let g = null;
    if (opt >= 3) { g = await psAskGender(); if (!g) return; }
    bgBody(null);
    bgUi('Vorbereiten', 'Lese den Stand dieses Kontos aus „Dates & Events“ …', null, '');
    bgButtons([{ label: 'Abbrechen', fn: closeBgPopup, focus: true }]);
    let own;
    try { own = await psLoadOwn((n) => bgUi(null, `Lese Deine Partys … ${n}`, null, null)); } catch (e) {
      bgUi('Nicht möglich', e.message || String(e), null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return;
    }
    const here = new Map(own.map((e) => [String(e.id), e]));
    const imp = new Map(evs.map((e) => [String(e.id), e]));
    const hs = (id) => (here.get(id) || {}).status || '';
    const isA = (e) => e.status === 'Angemeldet';
    if (opt === 5) { psSingle(evs, g, own); return; }
    const acts = [];
    // bei 4: stornieren, was in der Liste nicht angemeldet ist; steht es dort als vorgemerkt, danach merken
    if (opt === 4) for (const [id, e] of here) if (hs(id) === 'A' && !(imp.has(id) && isA(imp.get(id)))) { acts.push({ t: 'storno', ev: e }); if (imp.has(id)) acts.push({ t: 'bm', ev: imp.get(id) }); }
    if (opt === 2 || opt === 4) for (const [id, e] of here) if (hs(id) === 'M' && !imp.has(id)) acts.push({ t: 'unbm', ev: e });
    for (const [id, e] of imp) {
      if (opt <= 2) { if (!hs(id)) acts.push({ t: 'bm', ev: e }); continue; }
      if (isA(e)) { if (hs(id) !== 'A') acts.push({ t: 'reg', ev: e }); } else if (!hs(id)) acts.push({ t: 'bm', ev: e });
    }
    if (!acts.length) { bgUi('Nichts zu tun', 'Dieses Konto entspricht bereits der Liste.', null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
    const st = acts.filter((a) => a.t === 'storno');
    if (st.length) {
      bgUi('Rückfrage', `${st.length} Anmeldungen würden storniert:`, null, '');
      const ul = document.createElement('div'); ul.style.cssText = 'max-height:220px;overflow:auto;font-size:13px';
      st.forEach((a) => { const l = document.createElement('div'); l.innerHTML = `${escHtml(a.ev.date || '')} · <a href="${escHtml(a.ev.url)}" target="_blank" style="color:#9ec5ff">${escHtml(a.ev.name || a.ev.url)}</a>`; ul.appendChild(l); });
      bgBody(ul);
      const ok = await new Promise((r) => bgButtons([{ label: 'Stornieren und fortsetzen', fn: () => r(true) }, { label: 'Abbrechen', fn: () => r(false), focus: true }]));
      if (!ok) { closeBgPopup(); return; }
    }
    psRun(acts, g);
  }
  async function psRun(acts, g) {
    const order = { storno: 0, unbm: 1, bm: 2, reg: 3 };
    acts.sort((a, b) => order[a.t] - order[b.t]);
    bgScan = { stop: false, running: true };
    window.__jafBgBusy = true;
    window.addEventListener('beforeunload', beforeUnloadGuard);
    bgBody(null);
    bgTitle('Partys synchronisieren', true);
    bgButtons([bgStopButton()]);
    const res = { reg: [], wait: [], bm: [], unbm: [], storno: [], skip: [], fail: [] };
    const stats = () => `angemeldet: ${res.reg.length} · Warteliste: ${res.wait.length} · gemerkt: ${res.bm.length} · nicht mehr gemerkt: ${res.unbm.length} · storniert: ${res.storno.length}\n` +
      `unverändert: ${res.skip.length} · nicht möglich: ${res.fail.length}${CONFIG.DRY_RUN ? '\nTestmodus: auf JOYclub wird nichts verändert' : ''}`;
    const verb = { storno: 'Storniere', unbm: 'Nicht mehr merken', bm: 'Merke', reg: 'Melde an' };
    try {
      for (let i = 0; i < acts.length && !bgScan.stop; i++) {
        const a = acts[i];
        bgUi(`${verb[a.t]} (${i + 1}/${acts.length})`, `${a.ev.date || ''} · ${a.ev.name || a.ev.url}`, i / acts.length, stats());
        let r;
        try {
          r = a.t === 'storno' ? await psStorno(a.ev) : a.t === 'reg' ? await psRegister(a.ev, g) : await psBookmark(a.ev, a.t === 'bm');
        } catch (e) { if (e.fatal) throw e; r = { r: 'fail', msg: e.message || String(e) }; }
        const item = Object.assign({}, a.ev, { msg: r.msg });
        if (r.r === 'ok') (a.t === 'reg' ? (r.st === 'W' ? res.wait : res.reg) : res[a.t]).push(item);
        else if (r.r === 'skip') res.skip.push(item); else res.fail.push(item);
        bgUi(null, null, (i + 1) / acts.length, stats());
        await sleep(rand(1500, 3000));
      }
    } catch (e) { res.fail.push({ name: 'Abbruch', msg: e.message || String(e) }); }
    finally {
      window.removeEventListener('beforeunload', beforeUnloadGuard);
      window.__jafBgBusy = false;
      const stopped = bgScan && bgScan.stop;
      bgScan = null;
      bgTitle(stopped ? 'Synchronisieren abgebrochen' : 'Synchronisieren fertig', false);
      bgUi(stopped ? 'Abgebrochen' : 'Fertig', '', stopped ? null : 1, stats());
      if (res.fail.length) {
        const box = document.createElement('div'); box.style.cssText = 'max-height:220px;overflow:auto;font-size:13px;margin-top:8px';
        box.innerHTML = '<b>Nicht möglich:</b>';
        res.fail.forEach((x) => { const l = document.createElement('div'); l.innerHTML = `${escHtml(x.date || '')} · ${x.url ? `<a href="${escHtml(x.url)}" target="_blank" style="color:#9ec5ff">${escHtml(x.name || x.url)}</a>` : escHtml(x.name || '')} – ${escHtml(x.msg || '')}`; box.appendChild(l); });
        bgBody(box);
      }
      bgButtons([{ label: 'Schließen', fn: () => { closeBgPopup(); location.reload(); }, focus: true }]);
    }
  }
  // Option 5: jede Party einzeln
  async function psSingle(evs, g, own) {
    bgScan = { stop: false, running: false };
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const last = i === evs.length - 1;
      bgBody(null);
      bgUi(`Party ${i + 1}/${evs.length}`, 'Prüfe den aktuellen Status …', null, '');
      bgButtons([{ label: 'Abbrechen', fn: closeBgPopup, focus: true }]);
      if (!document.getElementById('jaf-bg-popup')) return;
      let s;
      try { s = await psState(ev.url); } catch (e) { s = { st: '?' }; }
      if (!document.getElementById('jaf-bg-popup')) return;
      bgUi(`Party ${i + 1}/${evs.length}`, '', null, '');
      const stTxt = { A: 'angemeldet', W: 'auf der Warteliste', M: 'gemerkt', N: 'weder gemerkt noch angemeldet', '?': 'unbekannt' }[s.st];
      const done = await new Promise((resolve) => {
        const render = (note) => {
          const head = document.createElement('div');
          head.innerHTML = `<div style="font-weight:bold;margin:4px 0"><a href="${escHtml(ev.url)}" target="_blank" style="color:#9ec5ff">${escHtml(ev.name || ev.url)}</a></div>` +
            `<div style="font-size:12px;opacity:.8">${escHtml(ev.date || '')} · in der Liste: ${escHtml(ev.status || '')} · hier: ${escHtml(stTxt)}</div>` +
            (note ? `<div style="margin-top:6px;color:#ffb300">${note}</div>` : '');
          bgBody(head);
          return head;
        };
        const act = async (fn, okTxt) => {
          bgButtons([{ label: 'Bitte warten …', disabled: true }]);
          let r; try { r = await fn(); } catch (e) { r = { r: 'fail', msg: e.message || String(e) }; }
          if (r.r === 'fail' && r.why === 'day') return dayConflict(r);
          render(escHtml(r.msg || okTxt));
          bgButtons([{ label: last ? 'Schließen' : 'Weiter', fn: () => resolve(true), focus: true }]);
        };
        // „bereits zwei Veranstaltungen an diesem Tag“: Partys des Tages zeigen, je mit „Diese stornieren und hier anmelden“
        const dayConflict = (r) => {
          const head = render(escHtml(r.msg));
          const sameDay = own.filter((e) => e.status === 'A' && e.date === ev.date && String(e.id) !== String(ev.id));
          sameDay.forEach((o) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px';
            row.innerHTML = `<a href="${escHtml(o.url)}" target="_blank" style="color:#9ec5ff;flex:1">${escHtml(o.name || o.url)}</a>`;
            const b = popupButton('Diese stornieren und hier anmelden', async () => {
              bgButtons([{ label: 'Bitte warten …', disabled: true }]);
              const s1 = await psStorno(o).catch((e) => ({ r: 'fail', msg: e.message }));
              if (s1.r !== 'ok') { render(escHtml(`Stornieren fehlgeschlagen: ${s1.msg}`)); bgButtons([{ label: last ? 'Schließen' : 'Weiter', fn: () => resolve(true), focus: true }]); return; }
              o.status = '';
              const r2 = await psRegister(ev, g).catch((e) => ({ r: 'fail', msg: e.message }));
              render(escHtml(`${o.name}: storniert · ${ev.name || ''}: ${r2.msg}`));
              bgButtons([{ label: last ? 'Schließen' : 'Weiter', fn: () => resolve(true), focus: true }]);
            });
            b.style.fontSize = '13px'; b.style.padding = '8px'; b.style.width = 'auto';
            row.appendChild(b);
            head.appendChild(row);
          });
          bgButtons([{ label: last ? 'Schließen' : 'Überspringen', fn: () => resolve(true), focus: true }]);
        };
        render('');
        const btns = [];
        if (s.st === 'N') btns.push({ label: 'Merken', fn: () => act(() => psBookmark(ev, true), 'gemerkt') });
        if (s.st === 'M') btns.push({ label: 'Nicht mehr merken', fn: () => act(() => psBookmark(ev, false), 'nicht mehr gemerkt') });
        if (s.st === 'A' || s.st === 'W') btns.push({ label: 'Abmelden', fn: () => act(() => psStorno(ev), 'storniert') });
        else if (s.st !== '?') btns.push({ label: `Anmelden als ${PS_GENDER[g]}`, fn: () => act(() => psRegister(ev, g), 'angemeldet') });
        btns.push({ label: last ? 'Schließen' : 'Überspringen', fn: () => resolve(true), focus: true });
        bgButtons(btns);
      });
      if (!done || !document.getElementById('jaf-bg-popup')) return;
    }
    bgScan = null;
    closeBgPopup();
    location.reload();
  }
  // Button „Synchronisieren“ (Seite der eigenen Eventanmeldungen: rechts neben dem Opa-Scan; „Dates & Events“: links davon)
  function insertPartySyncButton() {
    if (document.querySelector('.jaf-ps-btn')) return true;
    if (isRegistrationsPage()) {
      const opa = document.querySelector('.jaf-reg-opa-btn');
      if (!opa) return false;
      const b = document.createElement('button');
      b.type = 'button'; b.title = 'Partys mit einem anderen Konto abgleichen';
      b.className = 'jaf-ps-btn btn-flat-special-light btn btn-default';
      b.style.marginRight = '8px';
      b.innerHTML = `${SYNC_SVG} <span class="btn-text">Synchronisieren</span>`;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); psOpen(); });
      opa.before(b);
      return true;
    }
    const opa = document.querySelector('.jaf-ev-opa-btn');
    if (!opa) return false;
    const b = document.createElement('j-control-button');
    b.className = 'jaf-ps-btn';
    b.setAttribute('variant', 'tertiary'); b.setAttribute('role', '');
    b.title = 'Partys mit einem anderen Konto abgleichen';
    b.style.cssText = 'margin-left:24px;vertical-align:middle';
    b.innerHTML = `<span slot="icon-prepend" style="display:inline-flex">${SYNC_SVG}</span><span>Synchronisieren</span>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); psOpen(); });
    opa.after(b);
    return true;
  }

  // ---- Reihenfolge (Punkt 17) ----
  function orderEvents(list) {
    const m = getEvents();
    const ts = (e) => (m[e.id] && m[e.id].doneTs) || 0;
    const sorted = list.map((e, i) => ({ e, i })).sort((a, b) => ts(a.e) - ts(b.e) || a.e.dayTs - b.e.dayTs || a.i - b.i).map((x) => x.e);
    const now = Date.now();
    const upcoming = list.filter((e) => e.dayTs + 86400000 > now).sort((a, b) => a.dayTs - b.dayTs);
    const next = upcoming[0];
    if (next && list.every((e) => ts(e) > 0)) {
      const startOf = (e) => { const s = m[e.id] && m[e.id].start; return s ? Date.parse(s) : e.dayTs; };
      const oldestAge = now - Math.min(...list.map(ts));
      const untilNext = startOf(next) - now;
      if (oldestAge <= untilNext) return [next].concat(sorted.filter((e) => e.id !== next.id));
    }
    return sorted;
  }

  // ---- Zustand des Party-Scans ----
  // { running, phase: 'collect'|'event'|'ignore'|'next'|'done', events:[{id,url,…}], ei, ownerTab, cur, curComplete, stats, log, ts }
  const K_EVSCAN = 'jaf_evscan';
  const getEv = () => gmGet(K_EVSCAN, { running: false });
  const setEv = (o) => gmSet(K_EVSCAN, Object.assign({}, o, { ts: Date.now() }));
  const evStale = (o) => !o.ts || Date.now() - o.ts > 10 * 60 * 1000;
  const evLog = (msg) => { log(msg); const o = getEv(); o.log = (o.log || []).concat(`${fmtTs(Date.now())} ${msg}`).slice(-200); gmSet(K_EVSCAN, o); };
  function evPanel(title) {
    const p = panel();
    p.innerHTML = opaT(`<b>Opa-Scan Partys</b>${title ? ' – ' + title : ''}${CONFIG.DRY_RUN ? ' – <span style="color:#ffb300">Testmodus</span>' : ''}<br>`);
    p.appendChild(btn(opaT('Opa-Scan stoppen'), evStop));
    return p;
  }
  function evStop() {
    const o = getEv();
    setEv(Object.assign(o, { running: false }));
    const st = getState();
    if (st.running && st.evscan) setState({ running: false, queue: [], count: 0 });
    log(opaT('Opa-Scan gestoppt.'));
    if (o.returnUrl && !isAppointmentsPage() && !isRegistrationsPage()) setTimeout(() => { location.href = o.returnUrl; }, 1500);
  }

  // normaler Scan mit Seitenwechsel (Rückfall, wenn der Hintergrund-Scan nicht geht) – ohne Browser-Meldungen
  async function evStart() {
    const p = panel(); p.innerHTML = opaT('<b>Opa-Scan Partys</b><br>');
    const why = scanBlockedReason();
    if (why) { log(why); return; }
    if (!(await visGuard())) { log('Abgebrochen.'); return; }
    if (!(await acquireLock(opaT('Opa-Scan Partys')))) { log('Ein anderer Tab hat gerade begonnen zu arbeiten. Bitte später erneut versuchen.'); return; }
    const list = await scanEventList((n) => log(`Lade alle Eventanmeldungen … ${n}`));
    if (!list.length) { log('Keine Eventanmeldungen gefunden.'); return; }
    saveEventsFromList(list);
    const events = orderEvents(list).map((e) => ({ id: e.id, url: e.url, date: e.date, name: (getEvents()[e.id] || {}).name || e.slugName }));
    setEv({ running: true, phase: 'event', events, ei: 0, ownerTab: TAB_ID, returnUrl: location.href, stats: { events: 0, vip: 0, guests: 0, hits: 0 }, log: [] });
    evLog(`${events.length} Partys, Reihenfolge: ${events.map((e) => e.date).join(', ')}`);
    evStep();
  }

  async function evStep() {
    let o = getEv();
    if (!o.running) return;
    if (o.phase === 'ignore') {
      const st = getState();
      if (st.running) return;
      if (!st.done) o.curComplete = false;
      o.phase = 'next'; setEv(o);
    }
    o = getEv();
    if (o.phase === 'next') {
      const e = o.events[o.ei];
      if (e && o.curComplete && !CONFIG.DRY_RUN) {
        const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { doneTs: Date.now() }); gmSet(K_EVENTS, m);
        evLog(`${(o.cur && o.cur.name) || e.name}: komplett bearbeitet ✔`);
      } else if (e) evLog(`${(o.cur && o.cur.name) || e.name}: nicht komplett bearbeitet.`);
      o = getEv(); o.ei++; o.phase = 'event'; o.cur = null; o.curComplete = false; setEv(o);
      if (isAppointmentsPage() || isRegistrationsPage()) updateEventBadges();
      if (o.ei < o.events.length) {
        const w = rand(CONFIG.EVENT_DELAY_MIN_MS, CONFIG.EVENT_DELAY_MAX_MS);
        log(`Nächste Party in ${Math.round(w / 1000)} s …`);
        await sleep(w);
      }
    }
    o = getEv();
    if (!o.running) return;
    if (o.ei >= o.events.length) {
      setEv(Object.assign(o, { running: false, phase: 'done' }));
      const st = o.stats || {};
      evPanel('fertig');
      evLog(opaT(`Opa-Scan Partys fertig: ${st.events || 0} Partys, ${st.vip || 0} VIP-Gäste, ${st.guests || 0} Anmeldungen gelesen, ${st.hits || 0} zum Prüfen/Ignorieren übergeben.`));
      if (!isAppointmentsPage() && !isRegistrationsPage() && o.returnUrl) setTimeout(() => { location.href = o.returnUrl; }, 2000);
      return;
    }
    // zur nächsten Party
    const e = o.events[o.ei];
    if (!(isEventPage() && eventIdOf(location.pathname) === e.id)) { setEv(o); location.href = e.url; return; }
    await evScanEventPage();
  }

  // auf der Event-Seite (nur wenn vom Scan in diesem Tab geöffnet)
  async function evScanEventPage() {
    let o = getEv();
    const e = o.events[o.ei];
    evPanel(`Party ${o.ei + 1}/${o.events.length}`);
    await waitFor(() => document.querySelector('#guest_list'), 10000);
    const info = eventInfo();
    const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { name: info.name || e.name, start: info.start || (m[e.id] || {}).start }); gmSet(K_EVENTS, m);
    const party = { name: info.name || e.name, date: info.date || e.date };
    // 0. Veranstalter: dauerhaft auf die Whitelist („Veranstalter“), ggf. entsperren – ohne Ablauf
    const orgs = eventOrganizers();
    const orgUnblocked = [];
    for (const m of orgs) {
      addWhiteEntry(m, CONFIG.ORGANIZER_REASON, party);
      if (blockedIdMap().get(m.id)) {
        let u;
        try { u = await bgUnignore(m.id); } catch (e) { u = { ok: false, msg: e.message }; }
        if (u.ok) {
          const logPath = Object.keys(getLog()).find((p) => idOf(p) === String(m.id));
          if (logPath) {
            markUnblocked(logPath, m, `Whitelist: ${CONFIG.ORGANIZER_REASON}`);
            orgUnblocked.push(Object.assign({}, m, { path: logPath, url: location.origin + logPath }));
          } else {
            const ign = getIgnored(); for (const p of Object.keys(ign)) if (idOf(p) === String(m.id)) delete ign[p]; gmSet(K_IGNORED, ign);
          }
          evLog(`${m.name}: Veranstalter – entsperrt ✔`);
        } else evLog(`${m.name}: Veranstalter – Entsperren fehlgeschlagen (${u.msg})`);
        await sleep(rand(800, 1600));
      }
    }
    if (orgs.length) { removeWhitelistedFromWatch(); evLog(`${party.name}: Veranstalter auf der Whitelist: ${orgs.map((m) => m.name).join(', ')}`); }
    // Notiz der entsperrten Veranstalter (nur bekannte Mitgliederprofile) wird im Ignorier-Lauf dieser Party angepasst
    const orgNotes = orgUnblocked.map((m) => ({ path: m.path, url: m.url, name: m.name, id: m.id, ages: [], action: 'note',
      line: CONFIG.ORGANIZER_NOTE_TEXT.replace('{party}', party.name) }));

    // 1. VIP-Gäste aus dem Veranstaltungstext
    const vips = new Map();
    document.querySelectorAll('.event_description a[href*="/profile/"]').forEach((a) => {
      const path = cleanPath(new URL(a.getAttribute('href'), location.origin).pathname);
      if (!CONFIG.PROFILE_PATH_RE.test(path)) return;
      const id = a.getAttribute('data-miniprofil-id') || idOf(path);
      if (!vips.has(id)) vips.set(id, { id, name: a.textContent.trim(), url: location.origin + path, path });
    });
    for (const v of vips.values()) addWhiteEntry(v, CONFIG.VIP_REASON, party);
    if (vips.size) { removeWhitelistedFromWatch(); evLog(`${party.name}: ${vips.size} VIP-Gast/-Gäste auf der Whitelist: ${[...vips.values()].map((v) => v.name).join(', ')}`); }
    // 2. Gästeliste „Alle“ vollständig laden
    const tab = document.querySelector('a[href="#guest_list"]');
    if (tab) { await realClick(tab); await sleep(800); }
    const pill = document.querySelector('a[href="#guest_alle"]');
    if (pill) { await realClick(pill); await sleep(800); }
    const pane = document.getElementById('guest_alle');
    if (!pane) {
      evLog(`${party.name}: keine Gästeliste gefunden.`);
      o = getEv(); o.cur = party; o.curComplete = false; o.phase = 'next'; setEv(o); return evStep();
    }
    log(`${party.name}: lade Gästeliste …`);
    await loadPaneFully(pane, (n) => { log(`${party.name}: ${n} Anmeldungen geladen …`); setEv(getEv()); });
    if (!getEv().running) return;
    // 3. auswerten (Punkte 11–13)
    await syncIgnoreList(true);
    const guests = [...pane.querySelectorAll('li.date_card')].map(parseGuest);
    const pDay = (info.start && isoDay(new Date(Date.parse(info.start)))) || dayOfDE(party.date) || null;
    noteSighting(guests.filter((g) => g.id), 'Party', pDay);
    const ctx = { white: whiteList(), blocked: blockedIdMap(), acc: getAccounts() };
    const cnt = { anon: 0, extern: 0, white: 0, blocked: 0, coupleHit: 0, coupleSkip: 0, verify: 0, knownSkip: 0, checked: 0 };
    const seen = new Set();
    const items = [];
    for (const g of guests) {
      if (g.id && seen.has(g.id)) continue;
      if (g.id) seen.add(g.id);
      items.push({ g, c: classifyGuest(g, ctx) });
    }
    // unbekannte Profile im Hintergrund prüfen (Cache 1 Jahr) – nur echte Treffer werden danach geöffnet
    const pc = await precheck(items, ctx, (n, t) => { log(`${party.name}: prüfe Profile im Hintergrund … ${n}/${t}`); if (n % 10 === 0) setEv(getEv()); }, () => !getEv().running);
    if (!getEv().running) return;
    let hits = [];
    for (const { c } of items) {
      if (c.kind === 'extern') cnt.extern++;
      else if (c.kind === 'anon') cnt.anon++;
      else if (c.kind === 'white') cnt.white++;
      else if (c.kind === 'blocked') cnt.blocked++;
      else if (c.kind === 'ignore') { if (c.verified) cnt.checked++; else cnt.coupleHit++; hits.push(c.item); }
      else if (c.kind === 'verify') { cnt.verify++; hits.push(c.item); }
      else if (/^Paar/.test(c.why)) cnt.coupleSkip++;
      else cnt.knownSkip++;
    }
    if (pc.failed) evLog(`${party.name}: ${pc.failed} Profil(e) ließen sich im Hintergrund nicht lesen – werden geöffnet.`);
    // Vorgemerkte, die inzwischen über der Grenze sind, an den Anfang
    const due = dueFromWatch();
    if (due.length) { const inDue = new Set(due.map((d) => d.path)); hits = due.concat(hits.filter((h) => !inDue.has(h.path))); }
    if (orgNotes.length) hits = orgNotes.concat(hits);
    hits.forEach((h) => { if (!h.action && !h.seen && h.source === 'Party') h.seen = pDay; });
    o = getEv();
    o.cur = party; o.stats.events++; o.stats.vip += vips.size; o.stats.guests += guests.length; o.stats.hits += hits.length;
    evLog(`${party.name}: ${guests.length} Anmeldungen – ${cnt.anon} anonym, ${cnt.extern} extern, ${cnt.white} Whitelist, ${cnt.blocked} schon ignoriert, ` +
      `Paare: ${cnt.coupleHit} Treffer/${cnt.coupleSkip} ok, ${cnt.knownSkip} geprüft/bekannt ok, ${cnt.checked} geprüft zu ignorieren, ${cnt.verify} noch auf dem Profil zu prüfen` + (due.length ? `, ${due.length} vorgemerkt` : '') + '.');
    if (!hits.length) { o.curComplete = true; o.phase = 'next'; setEv(o); return evStep(); }
    const limit = CONFIG.DRY_RUN ? Math.min(CONFIG.TEST_MAX_PROFILES, CONFIG.MAX_PER_RUN) : CONFIG.MAX_PER_RUN;
    const queue = hits.slice(0, limit);
    o.curComplete = hits.length <= limit;
    o.phase = 'ignore'; setEv(o);
    setState({ running: true, mode: 'profil', queue, count: 0, auto: true, evscan: true, returnUrl: o.returnUrl, source: 'Party' });
    location.href = location.origin + queue[0].path;
  }

  // Einstieg je Seite für Partys; true = Seite übernommen
  async function evInit() {
    const o = getEv();
    if (isAppointmentsPage() || isRegistrationsPage()) {
      if (isRegistrationsPage()) {
        await waitFor(() => document.querySelector('button.button_past_events'), 10000);
        insertRegOpaButton(); insertPartySyncButton();
        saveEventsFromList(readRegistrations());
      } else {
        if (!isOwnAppointments()) return false;
        await waitFor(eventsHeadline, 10000);
        insertEventOpaButton(); insertPartySyncButton();
        saveEventsFromList(readAppointments());
      }
      updateEventBadges();
      const nFail = gmGet(K_EVFAIL, []).length;
      if (nFail && !o.running) {
        const p = panel(); p.innerHTML = opaT('<b>Opa-Scan Partys</b><br>');
        p.appendChild(btn(`Fehlschläge exportieren (${nFail})`, () => exportEvFailures()));
        p.appendChild(btn('Fehlschläge löschen', () => { gmSet(K_EVFAIL, []); p.remove(); }));
      }
      if (!window.__jafEvTimer) window.__jafEvTimer = setInterval(() => {
        if (isAppointmentsPage()) { insertEventOpaButton(); insertPartySyncButton(); updateEventBadges(); }
        else if (isRegistrationsPage()) { insertRegOpaButton(); insertPartySyncButton(); updateEventBadges(); }
      }, 3000);
      if (!o.running) {
        if (o.phase === 'done' && o.log && o.log.length) { const p = panel(); if (!p.querySelector('button')) p.innerHTML = opaT('<b>Opa-Scan Partys</b><br>'); log(o.log[o.log.length - 1]); }
        return false;
      }
      if (getState().running) return false;
      const other = lockedByOther();
      if (other) { const p = panel(); p.innerHTML = opaT('<b>Opa-Scan Partys</b><br>'); log(lockNotice(other)); return true; }
      if (evStale(o) && o.phase !== 'ignore') {
        const p = panel();
        p.innerHTML = opaT(`<b>Opa-Scan Partys</b> – unterbrochen bei Party ${(o.ei || 0) + 1}/${(o.events || []).length}<br>`);
        p.appendChild(btn('Fortsetzen', async () => {
          if (!(await acquireLock(opaT('Opa-Scan Partys')))) { log(lockNotice(getLock())); return; }
          setEv(Object.assign(getEv(), { ownerTab: TAB_ID })); evStep();
        }));
        p.appendChild(btn('Abbrechen', () => { setEv(Object.assign(getEv(), { running: false })); log(opaT('Opa-Scan abgebrochen.')); }));
        log(opaT('Der Opa-Scan der Partys wurde unterbrochen.'));
        return true;
      }
      if (!(await acquireLock(opaT('Opa-Scan Partys')))) { log(lockNotice(getLock())); return true; }
      setEv(Object.assign(getEv(), { ownerTab: TAB_ID }));
      evStep();
      return true;
    }
    if (isEventPage()) {
      // nur wenn die Seite vom laufenden Scan IN DIESEM TAB geöffnet wurde
      const cur = o.running && o.events && o.events[o.ei];
      const owned = cur && o.phase === 'event' && o.ownerTab === TAB_ID && eventIdOf(location.pathname) === cur.id && !evStale(o) && !lockedByOther();
      // Markierungen immer (auch im Scan)
      await waitFor(() => document.querySelector('#guest_list'), 10000);
      if (!owned) { setupGuestTabs(); setupOpaListTab(); }
      decorateGuests();
      if (!window.__jafGuestTimer) {
        window.__jafGuestTimer = setInterval(() => { try { if (!owned) { setupGuestTabs(); setupOpaListTab(); } decorateGuests(); } catch (e) { /* weiter */ } }, 2500);
        syncIgnoreList().then(() => decorateGuests()).catch(() => {});
      }
      if (owned) { await acquireLock(opaT('Opa-Scan Partys')); evScanEventPage(); return true; }
      return false;
    }
    return false;
  }

  // ---------- Bezeichnungen der Stufen statt „Mann“/„Frau“/„Paar“; Opa-/Oma-Symbol bei Stufe 3 ----------
  // nur für Gruppen mit eingeschalteter „Visueller Einstufung“. Werte je nach Seite (Punkt 22).
  const OPA_ICON_SVG = (w, h, oma) => `<svg class="jaf-opa-icon" viewBox="0 0 640 1280" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" ` +
    `style="width:${w}px;height:${h}px;fill:currentColor" aria-hidden="true">${oma ? OMA_G : OPA_G}</svg>`;
  // Quelle, deren Werte beim bloßen Ansehen gelten
  function viewSrc(path) {
    if (isEventPage()) return 'Party';
    if (isGroupMembersPage()) return 'Gruppen';
    if (isMemberSearchPage()) return 'Suche';
    const mj = myJoyPage();
    if (mj) return mj.src;
    const acc = path ? (getAccounts()[path] || {}) : {};
    const seen = Object.keys(acc.srcs || {}).filter((q) => SCAN_SOURCES.includes(q));
    return seen.sort((x, y) => srcRankOf(x) - srcRankOf(y))[0] || ALTBESTAND;
  }
  // Bezeichnung + Symbol einer Anmeldung/Karte: null = nichts ändern
  function stageLabel(type, ages, src) {
    const grp = isCoupleType(type) ? (groupOfType(type) === 'p' ? 'p' : null) : groupOfType(type);
    if (!grp || !CONFIG.GROUPS[grp].visual) return null;
    const st = guestStage({ type, ages }, grp, CONFIG, src);
    const word = knownType(String(type).split('|')[0]);
    return { word: FIXED_TYPES[word] ? word : '', label: CONFIG.GROUPS[grp].names.one[st - 1], icon: grp !== 'p' && st === 3 ? (grp === 'f' ? 'oma' : 'opa') : '' };
  }
  // Geschlechtssymbol (<j-gender-icon>, Inhalt im Shadow DOM) beschriften und bei Stufe 3 austauschen
  function labelGenderIcon(gi, label, icon) {
    const sr = gi && gi.shadowRoot;
    if (!sr) return;
    const box = sr.querySelector('.j-gender-icon');
    if (box && box.getAttribute('title') !== label) { box.setAttribute('title', label); box.setAttribute('aria-label', label); }
    const orig = sr.querySelector('svg:not(.jaf-opa-icon)');
    let mine = sr.querySelector('svg.jaf-opa-icon');
    if (mine && mine.getAttribute('data-k') !== icon) { mine.remove(); mine = null; }
    if (icon) {
      if (orig && !mine) {
        const r = orig.getBoundingClientRect();
        const h = Math.round(r.height || +orig.getAttribute('height') || 16) || 16;
        orig.style.display = 'none';
        orig.insertAdjacentHTML('afterend', OPA_ICON_SVG(Math.max(6, Math.round(h / 2)), h, icon === 'oma'));
        sr.querySelector('svg.jaf-opa-icon').setAttribute('data-k', icon);
      }
    } else if (orig) orig.style.display = '';
  }
  // Text „Mann“/„Frau“/„Paar“ in einem Element ersetzen (nur Textknoten, ganze Wörter, nicht in „Männer-Paar“)
  function replaceTypeText(el, word, label) {
    if (!el || !word || word === label) return;
    const re = new RegExp(`(^|[^\\p{L}-])${reEsc(word)}(?![\\p{L}-])`, 'gu');
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) { re.lastIndex = 0; if (re.test(w.currentNode.nodeValue)) nodes.push(w.currentNode); }
    nodes.forEach((n) => { n.nodeValue = n.nodeValue.replace(re, (m0, p) => p + label); });
  }
  // Karten in Gäste- und Gruppen-Mitgliederlisten (li.date_card)
  function relabelCards(root = document) {
    const src = viewSrc();
    root.querySelectorAll('li.date_card').forEach((li) => {
      if (li.__jafLbl) return;
      const g = parseGuest(li);
      const l = stageLabel(g.type, g.ages, src);
      if (!l) return;
      li.__jafLbl = 1;
      labelGenderIcon(li.querySelector('j-gender-icon'), l.label, l.icon);
      replaceTypeText(li.querySelector('.date_info'), l.word, l.label);
    });
  }
  // Profilkopf: Typ → Bezeichnung der Stufe (Original in data-jaf-orig), Symbol(e) im Kopf tauschen
  function relabelProfile() {
    const first = document.querySelector('.profile-base-info__line-2 > span');
    if (!first) return;
    const type = first.getAttribute('data-jaf-orig') || first.textContent.trim();
    const l = stageLabel(type, profileAges(), viewSrc(cleanPath(location.pathname)));
    if (!l || !l.word) return;
    document.querySelectorAll('.profile-base-info__line-2 > span').forEach((sp) => {
      const t = sp.getAttribute('data-jaf-orig') || sp.textContent.trim();
      if (t !== type) return;
      if (!sp.hasAttribute('data-jaf-orig')) sp.setAttribute('data-jaf-orig', type);
      if (sp.textContent.trim() !== l.label) sp.textContent = l.label;
    });
    const num = { Mann: '1', Frau: '2' }[l.word];
    if (!num) return;
    document.querySelectorAll(`.profile-base-info j-gender-icon[universal-gender="${num}"], j-avatar j-gender-icon[universal-gender="${num}"]`).forEach((gi) => labelGenderIcon(gi, l.label, l.icon));
    const own = document.querySelector(`j-gender-icon.profile-sed-card__gender-icon[universal-gender="${num}"]`);
    if (own) labelGenderIcon(own, l.label, l.icon);
  }
  // Mitgliedersuche, Profilbesuche, „Mögen mich“: <j-member-card> (Symbol im Shadow DOM der Karte)
  function relabelSearchCards() {
    const src = viewSrc();
    document.querySelectorAll('j-member-card[age]').forEach((card) => {
      if (card.getAttribute('age2')) return; // Paare: Symbol bleibt
      const t = typeFromGender(card.getAttribute('universal-gender'));
      const age = Number(card.getAttribute('age')) || null;
      const l = stageLabel(t, age ? [age] : [], src);
      if (!l) return;
      const gi = card.shadowRoot && card.shadowRoot.querySelector('j-gender-icon');
      labelGenderIcon(gi, l.label, l.icon);
    });
  }
  const isGroupMembersPage = () => /^\/groups\/[^/]+\/mitglieder$/.test(cleanPath(location.pathname));
  setInterval(() => {
    try {
      if (isProfilePage()) { relabelProfile(); updateProfileSliderBadges(); }
      if (isEventPage() || isGroupMembersPage()) relabelCards();
      if (currentListPage() || isMemberSearchPage() || myJoyPage()) relabelSearchCards();
    } catch (e) { /* weiter */ }
  }, 2000);

  // =====================================================================
  // ---------- Opa-Scan über alle Partys im HINTERGRUND ----------
  // Die Seite „Eventanmeldungen“ bleibt offen; Event-Seiten und Profile werden in unsichtbaren Frames geöffnet.
  // Fortschritt + Abbrechen in einem Popup in der Bildschirmmitte. Die Seite darf währenddessen nicht verlassen werden.
  // =====================================================================

  // =====================================================================
  // ---------- Wartung / Abmeldung erkennen ----------
  // angemeldet  = <body data-session-user-id="…">
  // Login-Seite = nicht angemeldet, aber Passwortfeld vorhanden → einmal automatisch einloggen (max. 1× in 30 min)
  // Wartung     = weder angemeldet noch Login-Feld → bis zur angegebenen Uhrzeit + 5–10 min gar nicht zugreifen
  // =====================================================================
  const K_GATE = 'jaf_gate';            // { type:'maint', until, text, since } – gilt für alle Tabs
  const K_LOGIN_TRY = 'jaf_login_try';  // Zeitpunkt des letzten automatischen Login-Versuchs
  const LOGIN_RETRY_MS = 30 * 60000;
  // Uhrzeit aus dem Wartungstext („bis voraussichtlich 17 Uhr“, „17:30 Uhr“, „until approximately 5 pm“) → Zeitstempel oder null
  function parseUntil(txt) {
    const now = new Date();
    let h = null, m = 0;
    let mm = (txt || '').match(/(?:bis|ab|um|gegen)\s+(?:voraussichtlich\s+|ca\.\s*|etwa\s+|circa\s+|spätestens\s+)*(\d{1,2})(?:[:.](\d{2}))?\s*Uhr/i) ||
      (txt || '').match(/\b(\d{1,2})[:.](\d{2})\s*Uhr/i) || (txt || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (mm) { h = +mm[1]; m = +(mm[2] || 0); }
    else if ((mm = (txt || '').match(/until\s+(?:approximately\s+|about\s+|approx\.\s*)*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i))) {
      h = (+mm[1] % 12) + (/pm/i.test(mm[3]) ? 12 : 0); m = +(mm[2] || 0);
    }
    if (h == null || h > 23 || m > 59) return null;
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
    return t > Date.now() ? t : null; // schon vorbei → unbekannt
  }
  // Zustand einer (geladenen oder abgerufenen) Seite: null = angemeldet, sonst { type:'login'|'maint', text, until }
  function pageGate(doc = document, html = '') {
    const b = doc && doc.body;
    if (!b && !html) return null;
    if (b && (b.getAttribute('data-session-user-id') || '').trim()) return null;
    if (doc.querySelector('.navigation_user_box')) return null;
    // Gast-Seite („Erst einloggen, dann loslegen – Fehler 401“) bzw. abgemeldet
    if ((b && b.classList.contains('guest')) || doc.querySelector('li.login_link, .login_link[data-linkmsq]') ||
      /\/webauth\/login\//.test(html) || (doc.querySelector('.error_page_container') && /401|einloggen/i.test(doc.body ? doc.body.textContent : ''))) return { type: 'login' };
    const hasPw = !!doc.querySelector('input[type="password"]') || /type\s*=\s*["']?password/i.test(html) ||
      (doc === document && deepAll().some((e) => e.tagName === 'INPUT' && e.type === 'password'));
    if (hasPw) return { type: 'login' };
    const text = ((b && (b.innerText || b.textContent)) || '').replace(/\s+/g, ' ').trim();
    const main = (doc.querySelector('#custom_msg_container, h1') || {}).textContent || '';
    return { type: 'maint', text: (main.trim() || text).slice(0, 240), until: parseUntil(text) };
  }
  const scanActive = () => !!(window.__jafBgBusy || (bgScan && bgScan.running) || getState().running || getOpa().running || getEv().running);
  const fmtHM = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  function gateNotice(msg) {
    if (document.getElementById('jaf-bg-popup')) bgUi(null, msg, null, null);
    else { try { panel(); log(msg); } catch (e) { /* egal */ } }
  }
  // gespeicherte Wartungspause (auch aus anderem Tab) abwarten
  async function gateWaitStored() {
    const g = gmGet(K_GATE, null);
    if (!g || !g.until || g.until <= Date.now()) return;
    const head = 'JOYclub ist vorübergehend nicht erreichbar';
    const pop = document.getElementById('jaf-bg-popup');
    const oldTitle = pop && pop.querySelector('.jaf-bg-title').textContent;
    if (pop) bgTitle(opaT('Opa-Scan pausiert'), true);
    while (Date.now() < g.until) {
      if (bgScan && bgScan.stop) throw new Error('abgebrochen');
      const left = Math.ceil((g.until - Date.now()) / 60000);
      gateNotice(`${head} – nächster Versuch um ${fmtHM(g.until)} (noch ${left} min). Bis dahin kein Zugriff auf JOYclub.`);
      await sleep(Math.min(15000, Math.max(500, g.until - Date.now())));
      const g2 = gmGet(K_GATE, null);
      if (!g2 || g2.until !== g.until) break; // anderer Tab hat neu entschieden
    }
    if (pop && document.getElementById('jaf-bg-popup')) bgTitle(oldTitle || opaT('Opa-Scan läuft im Hintergrund'), true);
  }
  // Seite war Wartung/Login: warten bzw. einloggen. Wirft bei Abbruch oder gescheitertem Login.
  async function handleGate(g, url) {
    if (g.type === 'maint') {
      const base = g.until || (Date.now() + 30 * 60000);
      const until = base + rand(5 * 60000, 10 * 60000);
      const prev = gmGet(K_GATE, null);
      if (!prev || !prev.until || prev.until < until) gmSet(K_GATE, { type: 'maint', until, text: g.text || '', since: Date.now() });
      console.log('[Alter-Filter] Wartungsseite erkannt – Pause bis', fmtTs(until), g.text);
      await gateWaitStored();
      return;
    }
    // abgemeldet → Login im kleinen Fenster (automatisch höchstens 1× in 30 min), dann warten, bis wieder angemeldet
    await loginViaWindow();
  }
  const K_LOGIN_PENDING = 'jaf_login_pending'; // { token, auto, ts, tried }
  const K_LOGIN_RESULT = 'jaf_login_result';   // { token, ok, msg, ts }
  const loginUrlFor = (back) => `${location.origin}/webauth/login/?origin_url=${encodeURIComponent(back)}`;
  async function stillGuest() {
    try { const r = await fetch(location.origin + '/', { credentials: 'include' }); const h = await r.text(); return !/data-session-user-id="\d+"/.test(h); } catch (e) { return true; }
  }
  async function loginViaWindow() {
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const last = gmGet(K_LOGIN_TRY, 0);
    const auto = Date.now() - last >= LOGIN_RETRY_MS;
    if (auto) gmSet(K_LOGIN_TRY, Date.now());
    gmSet(K_LOGIN_PENDING, { token, auto, ts: Date.now() });
    const back = `${location.origin}/my_joy/feed/friends/?jaf_login=${token}`;
    const w = window.open(loginUrlFor(back), 'jaf-login', 'width=520,height=760');
    const manual = `bitte im geöffneten Fenster bei JOYclub anmelden – danach geht es automatisch weiter.`;
    let msg = !w ? 'Abgemeldet – das Login-Fenster wurde vom Browser blockiert. Bitte Popups für joyclub.de erlauben oder in einem anderen Tab anmelden – danach geht es automatisch weiter.'
      : auto ? 'Abgemeldet – melde im kleinen Fenster mit den gespeicherten Zugangsdaten an …'
        : `Abgemeldet – automatischer Login erst wieder ab ${fmtHM(last + LOGIN_RETRY_MS)}; ${manual}`;
    if (document.getElementById('jaf-bg-popup')) bgTitle(opaT('Opa-Scan pausiert'), true);
    gateNotice(msg);
    const t0 = Date.now();
    let lastCheck = Date.now();
    for (;;) {
      if (bgScan && bgScan.stop) { try { if (w) w.close(); } catch (e) { /* egal */ } throw new Error('abgebrochen'); }
      const r = gmGet(K_LOGIN_RESULT, null);
      if (r && r.token === token) {
        if (r.ok) break;
        if (!r.shown) { gmSet(K_LOGIN_RESULT, Object.assign({}, r, { shown: true })); gateNotice(`Automatischer Login nicht möglich (${r.msg}) – ${manual}`); }
      }
      if (Date.now() - lastCheck > 60000) { lastCheck = Date.now(); if (!(await stillGuest())) break; }
      if (auto && Date.now() - t0 > 90000 && msg.startsWith('Abgemeldet – melde')) { msg = 'Automatischer Login nicht abgeschlossen – ' + manual; gateNotice(msg); }
      await sleep(3000);
    }
    try { if (w && !w.closed) w.close(); } catch (e) { /* egal */ }
    gmSet(K_LOGIN_PENDING, null);
    if (document.getElementById('jaf-bg-popup')) bgTitle(opaT('Opa-Scan läuft im Hintergrund'), true);
    gateNotice('Wieder angemeldet – weiter geht es.');
  }

  // fetch mit Wartungs-/Login-Erkennung: liefert { ok, status, url, html, doc }
  async function jfetch(url, opt = {}) {
    for (let i = 0; i < 50; i++) {
      await gateWaitStored();
      const r = await fetch(url, Object.assign({ credentials: 'include' }, opt));
      const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      const html = await r.text();
      if (!/html/i.test(ct) && !/^\s*</.test(html)) return { ok: r.ok, status: r.status, url: r.url, html, doc: null };
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const g = pageGate(doc, html);
      if (!g) return { ok: r.ok, status: r.status, url: r.url, html, doc };
      if (!scanActive()) throw Object.assign(new Error(g.type === 'login' ? 'Abgemeldet' : 'JOYclub ist vorübergehend nicht erreichbar'), { gate: g });
      await handleGate(g, r.url);
    }
    throw new Error('JOYclub bleibt nicht erreichbar');
  }
  // Hintergrund-Frame mit Wartungs-/Login-Behandlung (für Scans)
  async function bgFrameG(url, name, onProgress, timeoutMs) {
    for (let i = 0; i < 50; i++) {
      await gateWaitStored();
      try { return await bgFrame(url, name, onProgress, timeoutMs); } catch (e) {
        if (!e.gate) throw e;
        await handleGate(e.gate, e.gateUrl || url);
      }
    }
    throw new Error('JOYclub bleibt nicht erreichbar');
  }
  // oberste Seite ist Wartung/Login, während ein Scan mit Seitenwechsel läuft → warten bzw. einloggen. true = behandelt
  async function topGate() {
    const g = pageGate(document);
    if (!g) {
      // Rückkehr aus dem Login-Fenster: Erfolg melden und Fenster schließen
      const tok = new URLSearchParams(location.search).get('jaf_login');
      if (tok) { gmSet(K_LOGIN_RESULT, { token: tok, ok: true, ts: Date.now() }); if (window.name === 'jaf-login') setTimeout(() => window.close(), 500); }
      return plainSpecialPage(null);
    }
    if (!scanActive()) return g.type === 'maint' && /wartung|maintenance|nicht erreichbar|gleich wieder|bald wieder/i.test(`${g.text || ''} ${document.title}`) ? plainSpecialPage(g) : false;
    if (/^\/webauth\//.test(location.pathname)) return true; // Login-Weiterleitung läuft gerade
    const p = panel(); p.innerHTML = '<b>Alter-Filter</b><br>';
    if (g.type === 'maint') {
      const prev = gmGet(K_GATE, null);
      let until = prev && prev.until > Date.now() ? prev.until : 0;
      if (!until) { until = (g.until || Date.now() + 30 * 60000) + rand(5 * 60000, 10 * 60000); gmSet(K_GATE, { type: 'maint', until, text: g.text || '', since: Date.now() }); }
      log(`JOYclub ist vorübergehend nicht erreichbar. Der laufende Scan pausiert – nächster Versuch um ${fmtHM(until)} (Seite lädt dann neu).`);
      setTimeout(() => location.reload(), until - Date.now());
      return true;
    }
    // abgemeldet während eines Scans mit Seitenwechsel: über die Login-Seite zurück auf diese Seite (automatisch max. 1× in 30 min)
    const last = gmGet(K_LOGIN_TRY, 0);
    if (Date.now() - last < LOGIN_RETRY_MS) { log(`Abgemeldet – bitte bei JOYclub anmelden (automatischer Login erst wieder ab ${fmtHM(last + LOGIN_RETRY_MS)}). Danach geht der Scan weiter.`); return true; }
    gmSet(K_LOGIN_TRY, Date.now());
    gmSet(K_LOGIN_PENDING, { token: 'top', auto: true, ts: Date.now() });
    log('Abgemeldet – melde mit den gespeicherten Zugangsdaten an …');
    setTimeout(() => { location.href = loginUrlFor(location.href); }, 1500);
    return true;
  }

  // allgemeiner Hintergrund-Frame: lädt url mit Frame-Namen name, wartet auf die Antwort (postMessage jaf:'bg')
  function bgFrame(url, name, onProgress, timeoutMs) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.name = name;
      f.src = url;
      f.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:900px;opacity:0;pointer-events:none;z-index:-1;border:0';
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      const done = (fn, v) => { window.removeEventListener('message', onMsg); clearTimeout(t); f.remove(); fn(v); };
      const onMsg = (ev) => {
        if (ev.source !== f.contentWindow || !ev.data || ev.data.jaf !== 'bg') return;
        if (ev.data.vis != null) lastVis = { v: ev.data.vis, ts: Date.now() };
        if (ev.data.progress != null) { if (onProgress) onProgress(ev.data.progress); return; }
        if (ev.data.gate) done(reject, Object.assign(new Error(ev.data.gate.type === 'login' ? 'Abgemeldet' : 'JOYclub ist vorübergehend nicht erreichbar'), { gate: ev.data.gate, gateUrl: ev.data.url }));
        else if (ev.data.error) done(reject, new Error(ev.data.error)); else done(resolve, ev.data);
      };
      const t = setTimeout(() => done(reject, new Error('Zeitüberschreitung')), timeoutMs);
      window.addEventListener('message', onMsg);
      document.body.appendChild(f);
    });
  }
  const bgPost = (m) => window.parent.postMessage(Object.assign({ jaf: 'bg', vis: visibilityFromDoc(document) }, m), location.origin);

  // IM Frame: Event-Seite auslesen (Party-Infos, VIP-Links, Veranstalter, komplette Gästeliste „Alle“)
  async function bgEventFrame() {
    try {
      await waitFor(() => document.querySelector('#guest_list'), 30000);
      const info = eventInfo();
      const vips = [];
      document.querySelectorAll('.event_description a[href*="/profile/"]').forEach((a) => {
        const path = cleanPath(new URL(a.getAttribute('href'), location.origin).pathname);
        if (!CONFIG.PROFILE_PATH_RE.test(path)) return;
        const id = a.getAttribute('data-miniprofil-id') || idOf(path);
        if (!vips.some((v) => v.id === id)) vips.push({ id, name: a.textContent.trim(), url: location.origin + path, path });
      });
      const orgs = eventOrganizers();
      const gTab = document.querySelector('a[href="#guest_list"]');
      if (gTab) gTab.click();
      await sleep(500);
      const aTab = document.querySelector('a[href="#guest_alle"]');
      if (aTab) aTab.click();
      await sleep(800);
      const pane = document.getElementById('guest_alle');
      const html = pane ? (await loadPaneFully(pane, (n) => bgPost({ progress: n })), [...pane.querySelectorAll('li.date_card')].map((li) => li.outerHTML)) : [];
      bgPost({ info, vips, orgs, html, hasList: !!pane });
    } catch (e) { bgPost({ error: e.message || String(e) }); }
  }

  // IM Frame: ein Profil bearbeiten (Notiz-Auftrag, prüfen, Notiz schreiben, ignorieren). Auftrag kommt aus GM-Speicher.
  async function bgActFrame() {
    const key = 'jaf_bg_job_' + (window.name || '').slice('jaf-bg-act-'.length);
    const job = gmGet(key, null);
    if (!job) { bgPost({ error: 'kein Auftrag' }); return; }
    const cur = job.item;
    let pt = '', pa = [];
    const res = (r, msg) => bgPost({ result: r, msg, type: pt, ages: pa });
    try {
      const ptype = await waitFor(profileType, 15000);
      await sleep(1500);
      const ages = profileAges();
      pt = ptype || ''; pa = ages;
      if (!ptype) {
        const nk = nonMemberKind(document, location.pathname);
        if (nk) { setNonProfile(idOf(cur.path), cur.name, nk); if (cur.path) clearFailed(cur.path); return res('skipped', `kein Mitgliederprofil (${nk})`); }
        if (cur.path) setFailed(cur.path, 'Profil nicht lesbar'); return res('failed', 'Profil nicht lesbar');
      }
      if (ages.length) { setChecked(idOf(location.pathname), { name: cur.name, type: ptype, ages }); recordAccounts([{ path: cleanPath(location.pathname), name: cur.name, ages, type: ptype, online: profileOnline(), signs: profileSigns(document, ages) }]); }
      // Sync: eigene Notizzeile durch die Zeile laut Skript-Speicher ersetzen, danach (wieder) sperren
      if (cur.action === 'sync') {
        const kind = cur.kind || judge({ type: ptype, ages }, cur.source || 'Sync').kind || toKind(cur.reason, ptype);
        const line = noteText(cur.source || 'Sync', kind, cur.ts || Date.now(), ptype);
        const n = await writeWhitelistNote(line, true);
        if (!n.ok) return res('failed', n.msg);
        if (!cur.block) return res('note', n.msg);
        await sleep(800);
        const r = await blockOnProfile();
        return res(r.ok ? 'ignored' : 'failed', `${n.msg}; ${r.msg}`);
      }
      if (cur.action === 'note' || cur.action === 'clean') {
        const r = cur.action === 'note' ? await writeWhitelistNote(cur.line, true) : await cleanOwnNote();
        return res(r.ok ? 'note' : 'failed', r.msg);
      }
      if (isWhiteMember(cur)) return res('skipped', 'Whitelist');
      const c = { name: cur.name, path: cur.path, type: ptype || cur.type, ages: ages.length ? ages : cur.ages || [] };
      const jj = judge(c, cur.source || job.source);
      if (cur.verify && (!c.ages.length || !jj.active)) return res('skipped', `Profil geprüft (${c.type}, ${c.ages.join('+') || '?'} Jahre) – erfüllt die Kriterien nicht`);
      if (!cur.force && !typeOkFor(c.type)) return res('skipped', `Profiltyp „${c.type}“`);
      const kind = (cur.verify ? jj.kind : cur.kind) || jj.kind || toKind(cur.reason, c.type);
      cur.kind = kind;
      if (CONFIG.WRITE_NOTE) {
        const note = await writeNote(cur.via || cur.source || job.source, kind, c.type);
        if (!note.ok && CONFIG.NOTE_REQUIRED) { if (!CONFIG.DRY_RUN) setFailed(cur.path, note.msg); return res('failed', note.msg); }
        await sleep(800);
      }
      const r = await blockOnProfile();
      if (!CONFIG.DRY_RUN) { if (r.ok) { addDone(cur.path, Object.assign({}, cur, { ages: c.ages, type: c.type }), 'Profil (Hintergrund)'); clearFailed(cur.path); } else setFailed(cur.path, r.msg); }
      return res(r.ok ? 'ignored' : 'failed', r.msg);
    } catch (e) { return res('failed', e.message || String(e)); }
  }

  async function bgFrameDispatch() {
    const n = window.name || '';
    const gate = pageGate(document);
    if (gate) { bgPost({ gate, url: location.href }); return; }
    if (n === 'jaf-bg-ev') return bgEventFrame();
    if (n.startsWith('jaf-bg-act-')) return bgActFrame();
    if (n.startsWith('jaf-bg-evst-')) return evStornoFrame();
    if (n.startsWith('jaf-bg-ms')) return msFrame();
    if (n.startsWith('jaf-bg-mj-')) return mjFrame();
    if (n === 'jaf-bg-reg') return regFrame();
    if (n === 'jaf-bg-grp') return grpFrame();
    return bgFrameMain(); // Gästeliste m/p/alle
  }




  // ---------- Schnittstellen (API) mit Rückfall auf den Seitenweg ----------
  // Formular-Aufrufe wie JOYclub selbst: cache_killer (Attribut data-cache-killer der Seite) + data (JSON).
  // Gelesen-Markierungen (readMyJoy…) ruft das Skript nie auf.
  function apiCacheKiller() {
    const el = document.querySelector('[data-cache-killer]');
    const v = el && el.getAttribute('data-cache-killer');
    if (v) { if (GM_getValue('jaf_ck', '') !== v) GM_setValue('jaf_ck', v); return v; }
    return GM_getValue('jaf_ck', '') || '';
  }
  async function joyPost(path, data, timeout = 20000) {
    const ck = apiCacheKiller();
    if (!ck) throw new Error('cache_killer unbekannt');
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
    try {
      const r = await fetch(location.origin + path, {
        method: 'POST', credentials: 'include', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams({ cache_killer: ck, data: JSON.stringify(data) }).toString(),
      });
      const j = await r.json();
      if (!r.ok || !j || (j.status_code && j.status_code !== 200) || (j.error && j.error.code)) throw new Error(`HTTP ${r.status}${j && j.error && j.error.message ? ' – ' + j.error.message : ''}`);
      return j.content;
    } finally { if (t) clearTimeout(t); }
  }
  async function joyGet(path) {
    const r = await fetch(location.origin + path, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const j = await r.json();
    if (!r.ok || !j || (j.status_code && j.status_code !== 200) || (j.error && j.error.code)) throw new Error(`HTTP ${r.status}${j && j.error && j.error.message ? ' – ' + j.error.message : ''}`);
    return j.content;
  }
  // Rückfälle zählen; nach API_FB_LIMIT in Folge: Aufrufe dieses Vorgangs 7 Tage mitschneiden
  function apiResult(feat, ok, err = '') {
    const fb = GM_getValue(K_API_FB, {}) || {};
    const x = fb[feat] || { n: 0 };
    if (ok) { if (!x.n && !x.rec) return; x.n = 0; x.rec = 0; x.okTs = Date.now(); }
    else {
      x.n = (x.n || 0) + 1; x.last = Date.now(); x.err = String(err).slice(0, 200);
      (x.hist = x.hist || []).push({ ts: Date.now(), when: apiLocal(Date.now()), err: x.err });
      x.hist = x.hist.slice(-20);
      if (x.n >= API_FB_LIMIT && !(x.rec > Date.now())) {
        x.rec = Date.now() + 7 * 864e5;
        console.warn(`[Alter-Filter] Schnittstelle „${feat}“ ${x.n}× in Folge fehlgeschlagen – Mitschnitt läuft (Rekorder)`);
        try { if (typeof log === 'function') log(`Schnittstelle „${feat}“ fiel ${x.n}× auf die Seite zurück – Rekorder schneidet mit, bitte bei Gelegenheit exportieren.`); } catch (e) { /* egal */ }
      }
    }
    fb[feat] = x;
    GM_setValue(K_API_FB, fb);
  }
  const apiHealthy = (feat) => { const x = (GM_getValue(K_API_FB, {}) || {})[feat]; return !x || (x.n || 0) < API_FB_LIMIT; };
  async function apiTry(feat, fn) {
    if (!apiHealthy(feat) && Math.random() < 0.8) return { ok: false, skipped: true }; // nach Ausfall nur noch gelegentlich probieren
    try { const v = await fn(); apiResult(feat, true); return { ok: true, v }; }
    catch (e) { apiResult(feat, false, e.message || e); return { ok: false, err: e.message || String(e) }; }
  }
  // Ignorierliste im Skript-Speicher nachführen
  function ignoredSet(id, name, on) {
    const l = getIgnored();
    for (const p of Object.keys(l)) if (idOf(p) === String(id)) delete l[p];
    if (on) {
      const p = Object.keys(getLog()).find((x) => idOf(x) === String(id)) || Object.keys(getAccounts()).find((x) => idOf(x) === String(id)) || `/profile/${id}.html`;
      l[p] = { name: name || '', url: location.origin + p, id: String(id) };
    }
    saveIgnored(l);
  }
  const apiIgnore = (id, on) => apiTry('Ignorieren', () => joyPost('/contact/ignore', { fav_user_id: Number(id), ignore: !!on }));
  const apiNoteGet = (id) => apiTry('Notiz', async () => { const c = await joyGet(`/user_fav/user_note?user_id=${encodeURIComponent(id)}`); return typeof c === 'string' ? c : (c && typeof c.user_note === 'string' ? c.user_note : ''); });
  const apiNoteSet = (id, text) => apiTry('Notiz', () => joyPost('/profilev3/save_note', { fav_user_id: Number(id), user_note: text }));
  // Notiztexte wie auf der Profilseite bilden
  function noteWithLine(old, text) {
    if (old.includes(text.replace(/ am .*/, ''))) return null;
    return old ? `${old}\n${text}` : text;
  }
  function noteWhitelisted(old, line) {
    const lines = old.split(/\r?\n/);
    const kept = lines.filter((l) => !ownNoteRe().test(l)).filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1));
    if (!kept.some((l) => l.trim() === line)) kept.push(line);
    const v = kept.join('\n').replace(/^\n+|\n+$/g, '');
    return v === old.trim() ? null : v;
  }
  function noteCleaned(old) {
    const lines = old.split(/\r?\n/);
    if (!lines.some((l) => ownNoteRe().test(l))) return null;
    return lines.filter((l) => !ownNoteRe().test(l)).join('\n').replace(/^\n+|\n+$/g, '');
  }
  // Auftrag ohne Profilaufruf erledigen; null = Seitenweg nötig
  async function apiActJob(cur, source) {
    if (CONFIG.DRY_RUN) return null;
    const id = idOf(cur.path || cur.url || '');
    if (!id) return null;
    const noteOp = async (val) => {
      if (val == null) return { ok: true, msg: 'Notiz war bereits aktuell' };
      const s = await apiNoteSet(id, val);
      return s.ok ? { ok: true, msg: 'Notiz gespeichert (Schnittstelle)' } : null;
    };
    if (cur.action === 'note' || cur.action === 'clean') {
      const g = await apiNoteGet(id);
      if (!g.ok) return null;
      const r = await noteOp(cur.action === 'note' ? noteWhitelisted(g.v || '', cur.line) : noteCleaned(g.v || ''));
      return r ? { result: 'note', msg: r.msg } : null;
    }
    if (cur.action === 'sync') {
      if (!cur.type) return null;
      const kind = cur.kind || judge({ type: cur.type, ages: cur.ages || [] }, cur.source || 'Sync').kind || toKind(cur.reason, cur.type);
      const g = await apiNoteGet(id);
      if (!g.ok) return null;
      const n = await noteOp(noteWhitelisted(g.v || '', noteText(cur.source || 'Sync', kind, cur.ts || Date.now(), cur.type)));
      if (!n) return null;
      if (!cur.block) return { result: 'note', msg: n.msg };
      const b = await apiIgnore(id, true);
      if (!b.ok) return null;
      ignoredSet(id, cur.name, true);
      return { result: 'ignored', msg: `${n.msg}; ignoriert (Schnittstelle)` };
    }
    if (cur.action) return null;
    // normales Ignorieren: nur mit bekanntem Typ und Alter (sonst muss das Profil geprüft werden)
    if (cur.verify || !cur.type || /^Typ |\|/.test(cur.type) || !(cur.ages || []).length) return null;
    if (isWhiteMember(cur)) return { result: 'skipped', msg: 'Whitelist' };
    const c = { name: cur.name, path: cur.path, type: cur.type, ages: cur.ages };
    const jj = judge(c, cur.source || source);
    if (!cur.force && !typeOkFor(c.type)) return { result: 'skipped', msg: `Profiltyp „${c.type}“` };
    const kind = cur.kind || jj.kind || toKind(cur.reason, c.type);
    cur.kind = kind;
    let noteMsg = '';
    if (CONFIG.WRITE_NOTE) {
      const g = await apiNoteGet(id);
      if (!g.ok) return null;
      const n = await noteOp(noteWithLine((g.v || '').trim(), noteText(cur.via || cur.source || source, kind, Date.now(), c.type)));
      if (!n) return null;
      noteMsg = n.msg === 'Notiz war bereits aktuell' ? 'Notiz schon vorhanden' : n.msg;
    }
    const b = await apiIgnore(id, true);
    if (!b.ok) return null;
    addDone(cur.path, Object.assign({}, cur, { ages: c.ages, type: c.type }), 'Schnittstelle');
    ignoredSet(id, cur.name, true);
    clearFailed(cur.path);
    return { result: 'ignored', msg: [noteMsg, 'ignoriert (Schnittstelle)'].filter(Boolean).join('; '), type: c.type, ages: c.ages };
  }
  // Gästeliste einer Party seitenweise (Karten als HTML); null = Seitenweg
  async function apiGuests(eventId, gender = 'alle', onProgress) {
    const out = [], seen = new Set();
    for (let page = 1; page <= 300; page++) {
      const r = await apiTry('Gästeliste', () => joyPost('/event/guests_scroll_data', { event_id: Number(eventId), gender, page }));
      if (!r.ok) return page === 1 ? null : (out.length ? out : null);
      const el = (r.v && r.v.elements) || [];
      let add = 0;
      for (const h of el) {
        const k = (String(h).match(/\/(?:profile|my)\/(\d+)\./) || [])[1] || h.slice(0, 200);
        if (seen.has(k)) continue;
        seen.add(k); out.push(h); add++;
      }
      if (onProgress) onProgress(out.length);
      if (!el.length || !add) break;
      await sleep(rand(250, 600));
    }
    return out;
  }
  // ClubMail-Unterhaltungen (Mitglieder) seitenweise; null = Seitenweg
  async function apiClubMail(max, stopDay) {
    const own = ownIds();
    const out = [];
    let param = { limit: 25, offset: null, descending: true, archive: null, unread: null, conversation_type: null, contact_folder_id: null };
    for (let i = 0; i < 400; i++) {
      const r = await apiTry('ClubMail', () => joyPost('/clubmailv3/get_conversation_list', param));
      if (!r.ok) return i === 0 ? null : out;
      const list = (r.v && r.v.conversation_list) || [];
      let older = false;
      for (const c of list) {
        const day = c.sort_time ? isoDay(new Date(c.sort_time * 1000)) : null;
        if (stopDay && day && day < stopDay) older = true;
        if (c.conversation_type !== 'P') continue;
        const u = (c.user_list || []).find((x) => String(x.id) !== String((r.v.page_down_parameter || {}).owner_id) && !own.has(String(x.id))) ||
          (c.last_message && c.last_message.from_user && !own.has(String(c.last_message.from_user.id)) ? c.last_message.from_user : null);
        if (!u || !u.profile_url || !/\/profile\/\d+\./.test(u.profile_url) || u.is_deleted) continue;
        const path = cleanPath(new URL(u.profile_url).pathname);
        const ug = u.gender && u.gender.universal_gender != null ? String(u.gender.universal_gender) : '';
        out.push({ path, url: location.origin + path, id: String(u.id), name: u.name || '', ages: [u.age, u.age2].map(Number).filter((n) => n >= 18 && n <= 120),
          gender: ug && ug !== '0' ? ug : '', type: ug && ug !== '0' ? typeFromGender(ug) : '', day, dayTxt: day || '', imgSrc: (((u.avatar_alt || {}).fallback_image_source_set || {}).source_list || []).map((s) => s.resource_path).find((s) => /image_(240|300|360)_/.test(s || '')) || '' });
      }
      if (out.length >= max || older || !list.length || !r.v.page_down_parameter) break;
      param = r.v.page_down_parameter;
      await sleep(rand(300, 700));
    }
    return out;
  }

  // Mitgliedersuche über apiv2 /members: dieselbe Anfrage, die die Suchseite selbst stellt (aus den Ladezeiten des
  // Browsers), seitenweise bis next_page leer ist; Profil-Links über /profile/get_urls. null = Seitenweg.
  function msLastApiUrl() {
    try {
      const perf = (typeof unsafeWindow !== 'undefined' && unsafeWindow.performance) || window.performance;
      const l = perf.getEntriesByType('resource').map((e) => e.name).filter((n) => /^https:\/\/apiv2\.joyclub\.com\/members\?/.test(n));
      return l.length ? l[l.length - 1] : '';
    } catch (e) { return ''; }
  }
  async function apiMembers(srcUrl, onN) {
    let u;
    try { u = new URL(srcUrl); } catch (e) { return null; }
    const byId = new Map();
    let page = -1;
    for (let i = 0; i < 300; i++) {
      u.searchParams.set('page', String(page));
      const r = await apiTry('Mitgliedersuche', () => api2('GET', u.pathname + u.search));
      if (!r.ok) return i === 0 ? null : [...byId.values()];
      const v = r.v || {};
      if (!Array.isArray(v.items)) { apiResult('Mitgliedersuche', false, 'Antwort ohne items'); return i === 0 ? null : [...byId.values()]; }
      for (const it of v.items) {
        if (!it || !it.user_id || byId.has(String(it.user_id))) continue;
        const ug = it.universal_gender != null ? String(it.universal_gender) : '';
        byId.set(String(it.user_id), { id: String(it.user_id), name: it.user_name || '', ages: [it.age, it.age2].map(Number).filter((n) => n >= 18 && n <= 120),
          gender: ug && ug !== '0' ? ug : '', type: ug && ug !== '0' ? typeFromGender(ug) : '' });
      }
      if (onN) onN(byId.size);
      if (!v.next_page || !v.items.length) break;
      page = v.next_page;
      await sleep(rand(300, 700));
    }
    // Profil-Links (mit Nick-Teil) in Blöcken
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      try {
        const c = await joyGet(`/profile/get_urls?user_ids=${part.join(',')}`);
        for (const x of (c && c.profile_urls) || []) { const m = byId.get(String(x.user_id)); if (m && x.profile_url) m.path = cleanPath(new URL(x.profile_url).pathname); }
      } catch (e) { /* Rückfall unten */ }
    }
    return [...byId.values()].map((m) => { const path = m.path || `/profile/${m.id}.${(m.name || 'x').toLowerCase()}.html`; return { path, url: location.origin + path, name: m.name, ages: m.ages, gender: m.gender, type: m.type }; });
  }

  // ---------- API-Rekorder: Bedienung (Experten-Einstellungen) ----------
  const API_FEATURES = [
    ['Profilbesucher', /visit/i], ['Mögen mich / Interaktionen', /vot|like|kiss|interaction/i], ['ClubMail', /clubmail|conversation|message|messenger/i],
    ['Ignorierliste', /ignor|block/i], ['Partys / Gästelisten', /event|guest|registration|date/i], ['Gruppen', /group|gruppe/i],
    ['Mitgliedersuche', /search|suche|finder|member/i], ['Profile', /profile|user/i], ['Kontakte / Freunde', /contact|friend|kontakt|fav/i],
    ['Profilnotiz', /note|notiz/i], ['Sichtbarkeit', /visib|invisible|online/i],
  ];
  function apiRecStats() {
    const log = GM_getValue(K_API_LOG, {}) || {};
    const l = Object.values(log);
    return { n: l.length, neu: l.filter((e) => e.isNew).length };
  }
  function apiRecExport() {
    const log = GM_getValue(K_API_LOG, {}) || {};
    const entries = Object.entries(log).map(([key, e]) => Object.assign({ key }, e, { candidateFor: API_FEATURES.filter(([, re]) => re.test(e.path)).map(([n]) => n) }));
    const covered = new Set(entries.flatMap((e) => e.candidateFor));
    const fb = GM_getValue(K_API_FB, {}) || {};
    const out = { format: 'jaf-api-rec', v: 2, script: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '', ts: Date.now(), when: apiLocal(Date.now()),
      viaApi: Object.keys(API_FEAT_RE), fallbacks: fb,
      entries, candidates: Object.fromEntries(API_FEATURES.map(([n]) => [n, entries.filter((e) => e.candidateFor.includes(n)).map((e) => e.key)])),
      noEndpointSeen: API_FEATURES.map(([n]) => n).filter((n) => !covered.has(n)),
      timeline: GM_getValue(K_API_TL, []) || [] };
    for (const e of Object.values(log)) e.isNew = false;
    GM_setValue(K_API_LOG, log);
    // nach dem Export gelten die Aufrufe wieder als bekannt
    for (const x of Object.values(fb)) if (x && x.rec) x.rec = 0;
    GM_setValue(K_API_FB, fb);
    return JSON.stringify(out, null, 1);
  }
  function apiRecControl() {
    const w = document.createElement('div');
    w.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    const lb = document.createElement('label');
    lb.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!GM_getValue(K_API_REC, false);
    lb.appendChild(cb); lb.appendChild(document.createTextNode('an'));
    const info = document.createElement('span');
    info.className = 'jaf-api-info';
    const warn = document.createElement('div');
    warn.style.cssText = 'flex-basis:100%;color:#ffb300;font-size:12.5px';
    const upd = () => {
      const st = apiRecStats(); info.textContent = `${st.n} erfasst, davon ${st.neu} neu`;
      const fb = GM_getValue(K_API_FB, {}) || {};
      const l = Object.entries(fb).filter(([, x]) => x && x.rec > Date.now());
      warn.textContent = l.length ? l.map(([f, x]) => `Schnittstelle geändert? „${f}“ fiel ${x.n}× auf die Seite zurück (zuletzt ${apiLocal(x.last)}: ${x.err}) – Mitschnitt läuft, bitte bei Gelegenheit exportieren.`).join(' ') : '';
    };
    cb.addEventListener('change', () => { GM_setValue(K_API_REC, cb.checked); upd(); });
    const ex = document.createElement('a'); ex.href = '#'; ex.textContent = 'Exportieren';
    ex.addEventListener('click', (e) => { e.preventDefault(); flDownload(`joyclub-api-rekorder-${isoDay(new Date())}.json`, apiRecExport()); upd(); });
    const cl = document.createElement('a'); cl.href = '#'; cl.textContent = 'Leeren';
    cl.addEventListener('click', (e) => { e.preventDefault(); GM_setValue(K_API_LOG, {}); GM_setValue(K_API_TL, []); upd(); });
    w.append(lb, info, ex, cl, warn);
    upd();
    return w;
  }

  // ---------- Sonderseiten ohne laufenden Scan: Wartung → zur angegebenen Uhrzeit bzw. 5, 10, 15 … 30 min neu laden; „nicht gefunden“ → 1× neu laden ----------
  const K_NOTFOUND = 'jaf_notfound'; // [{ url, ts }]
  function plainSpecialPage(g) {
    if (IN_FRAME) return false;
    let n = 0;
    try { n = +(sessionStorage.getItem('jaf_maint_n') || 0); } catch (e) { n = 0; }
    if (g && g.type === 'maint') {
      const step = Math.min(30, 5 * (n + 1)) * 60000;
      const until = g.until && g.until > Date.now() ? g.until + rand(30000, 90000) : Date.now() + step;
      try { sessionStorage.setItem('jaf_maint_n', String(g.until && g.until > Date.now() ? 0 : n + 1)); } catch (e) { /* egal */ }
      const b = document.createElement('div');
      b.id = 'jaf-maint';
      b.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483646;background:#3a2a10;border:1px solid #ffb300;color:#fff;border-radius:8px;padding:10px 16px;font:14px system-ui;box-shadow:0 6px 18px rgba(0,0,0,.5)';
      b.textContent = `Opa-Scan: JOYclub-Wartung erkannt – die Seite lädt um ${fmtHM(until)} neu${g.until ? ' (Uhrzeit laut Wartungsseite)' : ''}.`;
      (document.body || document.documentElement).appendChild(b);
      setTimeout(() => location.reload(), Math.max(10000, until - Date.now()));
      return true;
    }
    try { sessionStorage.removeItem('jaf_maint_n'); } catch (e) { /* egal */ }
    // „Seite nicht gefunden“
    const err = document.querySelector('.error_page_container');
    const t = `${document.title} ${(err && err.textContent) || ''}`;
    if (err && /404|nicht gefunden|existiert nicht/i.test(t)) {
      const key = 'jaf_nf_' + location.pathname + location.search;
      let tried = false;
      try { tried = !!sessionStorage.getItem(key); sessionStorage.setItem(key, '1'); } catch (e) { tried = true; }
      if (!tried) { setTimeout(() => location.reload(), 1500); return true; }
      const l = (GM_getValue(K_NOTFOUND, []) || []).filter((x) => x.url !== location.href).slice(-49);
      l.push({ url: location.href, ts: Date.now() });
      GM_setValue(K_NOTFOUND, l);
      console.log('[Alter-Filter] Seite nicht gefunden (auch nach Neuladen):', location.href);
    }
    return false;
  }

  // ---------- Automatische Whitelist: Freunde und „persönlich bekannt“ (Kontakte) ----------
  const K_AUTOWL_TS = 'jaf_autowl_ts';
  const K_AUTOWL_LAST = 'jaf_autowl_last'; // { ts, unblocked: [Namen] }
  const AUTOWL_GRACE = 30 * 864e5;
  function parseContacts(doc, onlyFace) {
    const out = [];
    for (const li of doc.querySelectorAll('li[id^="fav_user_"]')) {
      const a = li.querySelector('.fav_menu_user a[href*="/my/"], .fav_menu_user a[href*="/profile/"]');
      if (!a) continue;
      if (onlyFace && !li.querySelector('.btn_face2face.on')) continue;
      let path = '';
      try { path = cleanPath(new URL(a.getAttribute('href'), location.origin).pathname).replace(/^\/my\//, '/profile/'); } catch (e) { continue; }
      const id = idOf(path);
      if (id && !ownIds().has(id)) out.push({ id, name: a.textContent.trim(), path, url: location.origin + path });
    }
    return out;
  }
  function autoWhiteApply(friends, known) {
    const now = Date.now();
    const pairs = [...friends.map((m) => [m, CONFIG.FRIEND_REASON]), ...known.map((m) => [m, CONFIG.KNOWN_REASON])];
    for (const [m, r] of pairs) addWhiteEntry(m, r);
    const w = getDynWhite();
    const byId = new Map();
    for (const [k, e] of Object.entries(w)) { const id = e.id || idOf(e.url); if (id) byId.set(String(id), k); }
    for (const [m, r] of pairs) { const k = byId.get(String(m.id)) || norm(m.name); if (w[k]) { w[k].auto = Object.assign({}, w[k].auto || {}, { [r]: now }); } }
    // Wegfall: nach 30 Tagen Schonfrist austragen (könnte auch nur unsichtbar geworden sein)
    for (const [k, e] of Object.entries(w)) {
      if (!e.auto) continue;
      for (const [r, ts] of Object.entries(e.auto)) {
        if (now - ts <= AUTOWL_GRACE) continue;
        delete e.auto[r];
        e.reasons = (e.reasons || []).filter((x) => x !== r);
      }
      if (!Object.keys(e.auto).length) delete e.auto;
      if (!(e.reasons || []).length && !(e.modGroups || []).length && !(e.parties || []).length && !(e.vipParties || []).length) delete w[k];
    }
    gmSet(K_WHITE, w);
    _wIdCache.t = 0;
    return pairs;
  }
  async function autoWhiteRefresh(force = false, docs = null) {
    if (IN_FRAME || window.__jafAwlBusy) return false;
    if (!force && Date.now() - (GM_getValue(K_AUTOWL_TS, 0) || 0) < 864e5) return false;
    window.__jafAwlBusy = true;
    try {
      let fd = docs && docs.friends, kd = docs && docs.contacts;
      if (!fd) fd = (await jfetch(location.origin + '/kontakte/friendship.html')).doc;
      if (!kd) kd = (await jfetch(location.origin + '/kontakte/')).doc;
      if (!fd || !kd || pageGate(fd) || pageGate(kd)) return false;
      const pairs = autoWhiteApply(parseContacts(fd, false), parseContacts(kd, true));
      GM_setValue(K_AUTOWL_TS, Date.now());
      await autoWhiteUnblock(pairs);
      return true;
    } catch (e) { console.warn('[Alter-Filter] Freunde/Kontakte', e); return false; }
    finally { window.__jafAwlBusy = false; }
  }
  // vom Opa-Schutz Ignorierte, die jetzt auf der automatischen Whitelist stehen: entsperren (von Hand Ignorierte nie)
  async function autoWhiteUnblock(pairs) {
    const blocked = blockedIdMap();
    const log_ = getLog();
    const todo = [];
    for (const [m, r] of pairs) {
      if (!blocked.get(String(m.id))) continue;
      const lp = Object.keys(log_).find((p) => idOf(p) === String(m.id));
      if (!lp || handMade(log_[lp]) || log_[lp].unblocked) continue;
      if (!todo.some((x) => x.m.id === m.id)) todo.push({ m, r, lp });
    }
    if (!todo.length || scanActive() || lockedByOther()) return;
    if (!(await acquireLock('Whitelist: Freunde'))) return;
    const done = [];
    try {
      for (const x of todo) {
        const res = await bgUnignore(x.m.id);
        if (res.ok) { markUnblocked(x.lp, x.m, `Whitelist: ${x.r}`); done.push(`${x.m.name} (${x.r})`); }
        await sleep(rand(800, 1600));
      }
    } finally { releaseLock(); }
    if (done.length) {
      GM_setValue(K_AUTOWL_LAST, { ts: Date.now(), unblocked: done });
      try { panel(); log(`Automatische Whitelist: entsperrt – ${done.join(', ')}`); } catch (e) { /* egal */ }
    }
  }
  function autoWhiteInit() {
    if (IN_FRAME || !sessionId()) return;
    if (/^\/kontakte\/(friendship\.html)?$/.test(location.pathname)) {
      // eigene Kontakte-Seite offen: gleich übernehmen (die jeweils andere Seite wird nachgeladen)
      const isF = /friendship/.test(location.pathname);
      setTimeout(() => autoWhiteRefresh(true, isF ? { friends: document } : { contacts: document }), 1500);
      return;
    }
    setTimeout(() => autoWhiteRefresh(false), 20000);
  }

  // ---------- Profilinfos nebenbei merken (Mögen mich, Profilbesuche, ClubMail) ----------
  // jaf_pi_<id> = { nick, nicks, type, ages, persons?, img (data:-URL ~150 px), imgKey, ts }
  // Bilder bleiben dauerhaft bei Interaktionen/Fickliste; sonst höchstens PI_MAX (älteste zuerst weg).
  const K_PI = 'jaf_pi_';
  const K_PI_IDX = 'jaf_pi_idx'; // { id: [lastSeenTs, keep(0|1)] }
  const PI_MAX = 20000;
  const piGet = (id) => GM_getValue(K_PI + id, null);
  function piImgUrl(el) {
    if (!el) return '';
    const root = el.shadowRoot ? [el, el.shadowRoot] : [el];
    for (const r of root) {
      for (const so of r.querySelectorAll('source[srcset]')) {
        const list = so.getAttribute('srcset').split(',').map((x) => x.trim().split(/\s+/)).filter((x) => /feig-partner/.test(x[0]));
        if (!list.length || /\/none\.png/.test(list[0][0])) continue;
        const pick = list.find((x) => /240w|300w/.test(x[1] || '')) || list.find((x) => /360w|420w/.test(x[1] || '')) || list[list.length - 1];
        return pick[0];
      }
      const img = r.querySelector('img[src*="feig-partner"]');
      if (img && !/\/none\.png/.test(img.src)) return img.src;
    }
    return '';
  }
  const piImgKey = (u) => String(u || '').replace(/[?#].*$/, '').replace(/image_\d+_/, 'image_');
  async function piShrink(dataUrl, size = 150) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        try {
          const s = Math.min(1, size / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.8));
        } catch (e) { resolve(''); }
      };
      im.onerror = () => resolve('');
      im.src = dataUrl;
    });
  }
  const piQueue = [];
  let piBusy = false;
  async function piWork() {
    if (piBusy) return;
    piBusy = true;
    try {
      while (piQueue.length) {
        const { id, url, key } = piQueue.shift();
        const rec = piGet(id);
        if (!rec || rec.imgKey === key) continue;
        const big = await flFetchImage(url);
        const small = big ? await piShrink(big) : '';
        if (small) { const r2 = piGet(id) || rec; r2.img = small; r2.imgKey = key; GM_setValue(K_PI + id, r2); }
        await sleep(rand(300, 700));
      }
    } finally { piBusy = false; }
  }
  // items: [{ id, name, type, ages, el (Element mit Bild) }], keep = Interaktion (Bild dauerhaft behalten)
  function piNote(items, keep, withImg = true) {
    if (IN_FRAME) return;
    const idx = GM_getValue(K_PI_IDX, {}) || {};
    const nickIdx = GM_getValue('jaf_pi_nick', {}) || {};
    const fl = getFl();
    const now = Date.now();
    let n = 0;
    for (const it of items) {
      const id = String(it.id || '');
      if (!id) continue;
      const rec = piGet(id) || { nicks: [], ts: now };
      let ch = !piGet(id);
      if (it.name && rec.nick !== it.name) { if (rec.nick) rec.nicks = [...new Set([...(rec.nicks || []), rec.nick])]; rec.nick = it.name; ch = true; }
      if (it.type && !/^Typ /.test(it.type) && rec.type !== it.type) {
        if (rec.type && !/^Typ /.test(rec.type)) rec.typeHist = (rec.typeHist || []).concat({ ts: now, from: rec.type, to: it.type }).slice(-10);
        rec.type = it.type; ch = true;
      }
      if (it.ages && it.ages.length && JSON.stringify(rec.ages) !== JSON.stringify(it.ages)) { rec.ages = it.ages; rec.agesTs = now; ch = true; }
      rec.ts = now;
      if (ch || !idx[id] || now - idx[id][0] > 864e5) GM_setValue(K_PI + id, rec);
      if (rec.nick) nickIdx[norm(rec.nick)] = id;
      const k = keep || fl[id] || (idx[id] && idx[id][1]) ? 1 : 0;
      idx[id] = [now, k];
      if (withImg && it.el && n < 200) {
        const url = piImgUrl(it.el);
        const key = piImgKey(url);
        if (url && rec.imgKey !== key && !piQueue.some((q) => q.id === id)) { piQueue.push({ id, url, key }); n++; }
      }
    }
    // Obergrenze: nur Einträge ohne Interaktion/Fickliste fallen weg (älteste zuerst)
    const loose = Object.entries(idx).filter(([id, v]) => !v[1] && !fl[id]);
    if (loose.length > PI_MAX) {
      loose.sort((a, b) => a[1][0] - b[1][0]);
      for (const [id] of loose.slice(0, loose.length - PI_MAX)) { GM_deleteValue(K_PI + id); delete idx[id]; }
    }
    GM_setValue(K_PI_IDX, idx);
    GM_setValue('jaf_pi_nick', nickIdx);
    piWork();
  }

  // =====================================================================
  // ---------- Sichtbarkeit (Unsichtbar-Modus) ----------
  // Statuszeile unter dem Profilnamen: leer = sichtbar (1), „Für Freunde sichtbar“ (5), „Unsichtbar eingeloggt“ (3).
  // „Für Freunde sichtbar“ zählt als unsichtbar. Vor jedem Vorgang mit Profilaufrufen wird bei „sichtbar“ gewarnt.
  // =====================================================================
  const K_VIS_RUN = 'jaf_vis_run'; // { mode: 'invisible'|'visible', prev, ts } – wie die laufenden Vorgänge gestartet wurden
  let lastVis = { v: null, ts: 0 };
  function visibilityFromDoc(doc = document) {
    const box = doc && doc.querySelector && doc.querySelector('.navigation_user_box');
    if (!box) return null;
    const sp = box.querySelector('a.user_link span.clg, a.user_link .minifont');
    const t = norm(sp ? sp.textContent : '');
    if (!t) return 1;
    if (/freunde|friends/.test(t)) return 5;
    if (/unsichtbar|invisible/.test(t)) return 3;
    return null;
  }
  const invisibleUrl = () => location.origin + '/edit/invisible/';
  async function fetchVisibility() {
    const doc = await fetchDoc(invisibleUrl());
    const sel = doc.querySelector('select#user_online_type, select[name="user_online_type"]');
    const opt = sel && (sel.querySelector('option[selected]') || sel.options[sel.selectedIndex]);
    const v = opt ? +opt.getAttribute('value') : visibilityFromDoc(doc);
    return v || null;
  }
  async function setVisibility(v) {
    const doc = await fetchDoc(invisibleUrl());
    const form = doc.getElementById('f_user_profile_online_save');
    if (!form) return false;
    await postForm(form, { user_online_type: String(v) });
    await sleep(800);
    let now = null;
    try { now = await fetchVisibility(); } catch (e) { /* egal */ }
    lastVis = { v: now, ts: Date.now() };
    return now === v;
  }
  const visRun = () => gmGet(K_VIS_RUN, null);
  const visRunFresh = (r = visRun()) => !!(r && r.ts && Date.now() - r.ts < 2 * 60000);
  // während eines Vorgangs „unsichtbar“: hat sich jemand sichtbar geschaltet → zurück auf den vorherigen Status, 15 s warten
  async function visEnforce(v = lastVis.v) {
    const r = visRun();
    if (!r || r.mode !== 'invisible' || v !== 1) return false;
    const back = r.prev === 5 ? 5 : 3;
    console.log('[Alter-Filter] Sichtbar geschaltet während eines Vorgangs – schalte zurück auf', back);
    let ok = false;
    try { ok = await setVisibility(back); } catch (e) { /* egal */ }
    gmSet(K_VIS_RUN, Object.assign({}, r, { ts: Date.now() }));
    if (ok) await sleep(15000);
    return ok;
  }

  // ---- kleines Frage-Popup (über allen anderen) → Promise mit dem Wert des gewählten Buttons ----
  function askPopup({ title, warn = false, lines = [], buttons = [] }) {
    return new Promise((resolve) => {
      document.getElementById('jaf-ask-popup')?.remove();
      const ov = document.createElement('div');
      ov.id = 'jaf-ask-popup';
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
      const box = document.createElement('div');
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      box.style.cssText = POPUP_BOX_CSS;
      const h = document.createElement('div');
      h.style.cssText = `font:bold 20px/1.3 system-ui,sans-serif;margin-bottom:10px;${warn ? 'color:#ffb020' : ''}`;
      h.textContent = (warn ? '⚠️ ' : '') + title;
      box.appendChild(h);
      const body = document.createElement('div');
      body.className = 'jaf-ask-body';
      for (const l of lines) { const p = document.createElement('p'); p.style.cssText = 'margin:0 0 8px'; p.textContent = l; body.appendChild(p); }
      box.appendChild(body);
      const bs = document.createElement('div');
      bs.className = 'jaf-ask-btns';
      bs.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:16px';
      let focusEl = null;
      const finish = (v) => { document.removeEventListener('keydown', onKey, true); if (!ov.__keep) ov.remove(); resolve(v); };
      for (const b of buttons) {
        const el = popupButton(b.label, () => finish(b.value), b);
        bs.appendChild(el);
        if (b.focus) focusEl = el;
      }
      box.appendChild(bs);
      ov.appendChild(box);
      const cancelVal = (buttons.find((b) => b.focus) || {}).value ?? null;
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(cancelVal); } }
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
      if (focusEl) setTimeout(() => focusEl.focus(), 0);
      ov.__body = body; ov.__btns = bs;
    });
  }
  // Warnung vor einem Vorgang mit Profilaufrufen. true = weiter, false = abgebrochen
  // Vor einem Vorgang: Funktionieren die Schnittstellen, wird erst gefragt, wenn wirklich ein Profil geöffnet werden muss
  async function visGuard() {
    if (apiHealthy('Ignorieren') && apiHealthy('Notiz')) {
      let v = visibilityFromDoc(document);
      if (v == null) { try { v = await fetchVisibility(); } catch (e) { v = null; } }
      if (v !== 1) { gmSet(K_VIS_RUN, { mode: 'invisible', prev: v === 5 ? 5 : 3, ts: Date.now() }); lastVis = { v, ts: Date.now() }; return true; }
      gmSet(K_VIS_RUN, { mode: 'lazy', ts: Date.now() });
      return true;
    }
    return visGuardNow();
  }
  async function visGuardNow() {
    let v = visibilityFromDoc(document);
    if (v == null) { try { v = await fetchVisibility(); } catch (e) { v = null; } }
    if (v !== 1) { gmSet(K_VIS_RUN, { mode: 'invisible', prev: v === 5 ? 5 : 3, ts: Date.now() }); lastVis = { v, ts: Date.now() }; return true; }
    const c = await askPopup({ title: 'Achtung!', warn: true,
      lines: ['Du bist derzeit sichtbar eingeloggt.', 'Alle Mitglieder, deren Profile während dieses Vorgangs aufgerufen werden, sehen Dich als Besucher!', 'Trotzdem fortfahren?'],
      buttons: [{ label: 'Unsichtbar schalten und fortfahren', value: 'inv', primary: true }, { label: 'Sichtbar fortfahren', value: 'vis' }, { label: 'Abbrechen', value: null, focus: true }] });
    if (!c) return false;
    if (c === 'vis') { gmSet(K_VIS_RUN, { mode: 'visible', ts: Date.now() }); return true; }
    // unsichtbar schalten, dann 15 s warten
    const info = document.createElement('div');
    info.id = 'jaf-ask-popup';
    info.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    info.innerHTML = `<div style="${POPUP_BOX_CSS}"><div style="font:bold 18px system-ui;margin-bottom:8px">Unsichtbar schalten …</div><div class="jaf-vis-msg"></div></div>`;
    document.body.appendChild(info);
    const msg = (t) => { info.querySelector('.jaf-vis-msg').textContent = t; };
    msg('Status wird auf „Unsichtbar“ gesetzt …');
    let ok = false;
    try { ok = await setVisibility(3); } catch (e) { ok = false; }
    if (!ok) {
      info.remove();
      await askPopup({ title: 'Unsichtbar schalten fehlgeschlagen', warn: true, lines: ['Der Status ließ sich nicht ändern. Der Vorgang wird nicht gestartet.'], buttons: [{ label: 'Schließen', value: null, focus: true }] });
      return false;
    }
    gmSet(K_VIS_RUN, { mode: 'invisible', prev: 3, ts: Date.now() });
    for (let i = 15; i > 0; i--) { msg(`Du bist jetzt unsichtbar. Es geht in ${i} s weiter …`); await sleep(1000); }
    info.remove();
    updateTopButton();
    return true;
  }
  // Seite /edit/invisible/: Sichtbar-Schalten abfangen, solange Vorgänge mit Profilaufrufen laufen
  function invisiblePageGuard() {
    if (cleanPath(location.pathname) !== '/edit/invisible') return;
    const form = document.getElementById('f_user_profile_online_save');
    if (!form || form.__jafGuard) return;
    form.__jafGuard = true;
    const blocks = () => {
      if (form.__jafPass) return false;
      const sel = form.querySelector('select[name="user_online_type"]');
      const r = visRun();
      return !!(sel && sel.value === '1' && r && r.mode !== 'visible' && visRunFresh(r));
    };
    const ask = async () => {
      const c = await askPopup({ title: 'Achtung!', warn: true,
        lines: ['Es laufen Vorgänge mit automatisierten Profilaufrufen.', 'Alle Mitglieder, deren Profile während dieser Vorgänge aufgerufen werden, sehen Dich als Besucher!', 'Trotzdem fortfahren?'],
        buttons: [{ label: 'Trotzdem sichtbar machen', value: 'vis' }, { label: 'Unsichtbar bleiben', value: null, focus: true }] });
      if (c !== 'vis') return;
      gmSet(K_VIS_RUN, Object.assign({}, visRun(), { mode: 'visible', ts: Date.now() }));
      form.__jafPass = true;
      HTMLFormElement.prototype.submit.call(form);
    };
    const stop = (e) => { if (!blocks()) return; e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); ask(); };
    form.addEventListener('submit', stop, true);
    form.querySelectorAll('j-button[type="submit"], button[type="submit"]').forEach((b) => b.addEventListener('click', stop, true));
  }

  // =====================================================================
  // ---------- Ignorierliste: Füllstand, Limit und Verdrängung ----------
  // JOYclub behält nur CONFIG.IGNORE_LIMIT Sperren. Ist die Liste voll, macht das Skript vor einer neuen Sperre genau
  // einen Platz frei – nur aus gleich- oder niedrigerrangigen Quellen (von Hand Gesperrte nie):
  //  1. niedrigste Quelle zuerst; darin am längsten nicht gesehen (ohne Datum = 1970), nur „zuletzt gesehen“ in der
  //     Vergangenheit (heute = Zukunft); Gleichstand → älteste Sperre
  //  2. sonst (alle noch in Zukunft gesehen): Opas und Geronto-Paare mit den wenigsten Tagen über ihrer Grenze
  //     (Gleichstand → Paar zuerst); Sugar Daddys nicht
  //  3. neuer Sugar Daddy: jüngster Sugar Daddy (Mann), falls der neue älter ist bzw. gleich alt mit größerem Unterschied
  // =====================================================================
  const ignCount = () => Object.keys(getIgnored()).length;
  const fillText = () => {
    const n = ignCount();
    return `Ignorierliste: ${n.toLocaleString('de-DE')}/${CONFIG.IGNORE_LIMIT.toLocaleString('de-DE')} (${Math.max(0, CONFIG.IGNORE_LIMIT - n).toLocaleString('de-DE')} frei)`;
  };
  const itemKind = (x) => entryKind(x);
  // Verdrängungs-Rangfolge der Arten (zuerst verdrängt): Oma → Sugar Mom → Geronto-Paar → Opa → Sugar Daddy
  const KIND_ORDER = ['oma', 'sm', 'geronto', 'opa', 'sd'];
  const kindRank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? 3 : i; };
  function personsOf(path, e) {
    const acc = getAccounts()[path];
    if (acc && acc.persons && acc.persons.length) return acc.persons;
    const t = e && e.ts ? new Date(e.ts) : new Date();
    return ((e && e.ages) || []).map((a) => birthRange(a, t));
  }
  const midOf = (r) => (r && r.lo && r.hi ? (Date.parse(r.lo) + Date.parse(r.hi)) / 2 : null);
  function ageNow(r) {
    const m = midOf(r);
    if (m == null) return null;
    const b = new Date(m), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
    return a;
  }
  // Tage seit Erreichen der Ignorier-Schwelle (Werte der Quelle des Eintrags):
  // Opa/Oma: älteste Person; Geronto-Paar: die Person, die ihre Schwelle zuletzt erreicht hat; Sugar Daddy/Mom: ohne Altersregel
  function daysOver(path, e, kind) {
    if (kind === 'sd' || kind === 'sm') return Infinity;
    const ps = personsOf(path, e);
    const src = e.source || ALTBESTAND;
    const cross = (p, lim) => { const m = midOf(p); if (m == null) return null; const b = new Date(m); return new Date(b.getFullYear() + lim, b.getMonth(), b.getDate()).getTime(); };
    let t = null;
    if (kind === 'geronto' && ps.length === 2) {
      const tf = cross(ps[0], vals('p', src, 'f')[2]), tm = cross(ps[1], vals('p', src, 'm')[2]);
      t = tf == null || tm == null ? null : Math.max(tf, tm);
    } else {
      let p = null;
      for (const x of ps) if (midOf(x) != null && (p == null || midOf(x) < midOf(p))) p = x;
      const grp = kind === 'geronto' ? 'p' : groupOfType(e.type) || (kind === 'oma' ? 'f' : 'm');
      t = cross(p, grp === 'p' ? vals('p', src, knownType(e.type) === 'Frauen-Paar' ? 'f' : 'm')[2] : vals(grp, src)[2]);
    }
    if (t == null) return Infinity; // ohne Alter ans Ende
    return Math.floor((Date.now() - t) / 86400000);
  }
  // Wen verdrängen? Reihenfolge: niedrigste Quelle → Art → am längsten nicht gesehen (nur Vergangenheit) → kürzeste Zeit über der Schwelle.
  // Aus einer niedrigeren Quelle darf jede Art weichen, aus derselben Quelle nur eine gleiche oder niedrigere Art.
  // Von Hand oder über die Whitelist Gesperrte werden nie angefasst.
  function pickVictim(item) {
    // item.manual: Sperre aus einer eigenen Liste (Fickliste) – jede automatische Sperre darf weichen
    const newRank = item.manual ? -1 : srcRank(item.source);
    const newKind = item.manual ? 99 : kindRank(itemKind(item));
    const l = getLog(), ign = getIgnored();
    const ignIds = new Set(Object.keys(ign).map(idOf));
    const today = isoDay(new Date());
    const white = whiteList();
    const all = Object.entries(l)
      .filter(([p, e]) => !e.unblocked && CONFIG.PROFILE_PATH_RE.test(p) && ignIds.has(idOf(p)) && !isWhiteMember({ name: e.name, path: p }, white) &&
        !(!e.source && /JOYclub-Ignorierliste/.test(e.method || ''))) // ohne Quelle nur von JOYclub übernommen = vermutlich von Hand gesperrt
      .map(([p, e]) => ({ p, e, r: srcRank(e.source), k: kindRank(itemKind(e)) }))
      .filter((x) => x.r > newRank || (x.r === newRank && x.k <= newKind));
    if (!all.length) return null;
    const seenOf = (x) => x.e.seen || '1970-01-01';
    all.forEach((x) => { x.past = seenOf(x) < today; x.d = daysOver(x.p, x.e, KIND_ORDER[x.k]); });
    all.sort((a, b) => b.r - a.r || a.k - b.k || (b.past - a.past) ||
      (a.past && b.past ? seenOf(a).localeCompare(seenOf(b)) : 0) || a.d - b.d || (a.e.ts || 0) - (b.e.ts || 0));
    const v = all[0];
    v.kind = KIND_ORDER[v.k];
    v.why = v.past ? `am längsten nicht gesehen (${deDay(v.e.seen) || 'nie'})` : 'kürzeste Zeit über der Altersgrenze';
    return v;
  }
  // Profil im Hintergrund-Frame bearbeiten (Auftrag aus dem GM-Speicher); vorher Sichtbarkeit prüfen
  async function actJob(item, source) {
    try { const a = await apiActJob(item, source); if (a) return a; } catch (e) { /* Seitenweg */ }
    const vr = visRun();
    if (vr && vr.mode === 'lazy' && !(await visGuardNow())) throw Object.assign(new Error('Abgebrochen (sichtbar eingeloggt)'), { fatal: true });
    await visEnforce();
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    gmSet('jaf_bg_job_' + jobId, { item, source: item.source || source });
    try { return await bgFrameG(location.origin + item.path, 'jaf-bg-act-' + jobId, null, 120000); }
    catch (err) { if (err.fatal) throw err; return { result: 'failed', msg: err.message }; }
    finally { gmSet('jaf_bg_job_' + jobId, null); }
  }
  // vor einer neuen Sperre: Platz auf der Ignorierliste sicherstellen. cnt: { displaced, limitHit }
  async function ensureSlot(item, cnt) {
    if (CONFIG.DRY_RUN || item.action) return true;
    if (ignCount() < CONFIG.IGNORE_LIMIT) return true;
    const v = pickVictim(item);
    if (!v) { cnt.limitHit = (cnt.limitHit || 0) + 1; return false; }
    let r;
    try { r = await bgUnignore(idOf(v.p)); } catch (e) { if (e.fatal) throw e; r = { ok: false, msg: e.message }; }
    if (!r.ok) { cnt.limitHit = (cnt.limitHit || 0) + 1; return false; }
    markUnblocked(v.p, v.e, 'entsperrt (Platz für neue Sperre, Limit)');
    cnt.displaced = (cnt.displaced || 0) + 1;
    console.log('[Alter-Filter] Limit: entsperrt', v.e.name, '–', v.why, '→ Platz für', item.name);
    if (CONFIG.WRITE_NOTE) { try { await actJob({ path: v.p, url: v.e.url || location.origin + v.p, name: v.e.name, action: 'clean' }, 'Limit'); } catch (e) { if (e.fatal) throw e; } }
    return true;
  }
  // Treffer sperren (mit Limit-Prüfung): Ergebnis wie actJob, zusätzlich result 'limit'
  async function blockItem(it, source, cnt) {
    if (!it.action) {
      try { await autoWhiteRefresh(false); } catch (e) { /* egal */ }
      if (isWhiteMember(it)) return { result: 'skipped', msg: 'Whitelist' };
    }
    if (!it.action && !(await ensureSlot(Object.assign({ source }, it), cnt))) return { result: 'limit', msg: 'Limit erreicht, nicht gesperrt' };
    const r = await actJob(it, source);
    if (CONFIG.DRY_RUN && !it.action && r && r.result !== 'failed') memNote(it.path, 'would', Object.assign({ source }, it));
    return r;
  }

  // ---- Popup ----
  let bgScan = null; // { stop, popup }
  function bgPopup() {
    let ov = document.getElementById('jaf-bg-popup');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'jaf-bg-popup';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
    ov.innerHTML = opaT(`<div class="jaf-bg-box" role="dialog" aria-modal="true" style="${POPUP_BOX_CSS}">
      <div style="display:flex;align-items:center;gap:10px;font-size:17px;font-weight:bold;margin-bottom:6px">${opaIconSvg(24)}<span class="jaf-bg-title">Opa-Scan</span></div>
      <div class="jaf-bg-warn" style="display:none;background:#ffb300;color:#000;border-radius:6px;padding:6px 10px;margin:8px 0 12px;font-weight:bold">
        ⚠ Bitte diese Seite nicht verlassen und den Tab nicht schließen, sonst bricht der Scan ab.</div>
      <div class="jaf-bg-party" style="font-weight:bold;margin-top:8px"></div>
      <div class="jaf-bg-step" style="opacity:.9;min-height:1.5em"></div>
      <div class="jaf-bg-barlbl" style="display:none;font-size:12px;opacity:.8;margin-top:8px"></div>
      <div class="jaf-bg-barwrap" style="display:none;height:8px;background:#333;border-radius:4px;margin:4px 0 8px;overflow:hidden"><div class="jaf-bg-bar" style="height:100%;width:0;background:#43a047;transition:width .3s"></div></div>
      <div class="jaf-bg-bar2lbl" style="display:none;font-size:12px;opacity:.8"></div>
      <div class="jaf-bg-bar2wrap" style="display:none;height:8px;background:#333;border-radius:4px;margin:4px 0 8px;overflow:hidden"><div class="jaf-bg-bar2" style="height:100%;width:0;background:#43a047;transition:width .3s"></div></div>
      <div class="jaf-bg-stats" style="font-size:12px;opacity:.8;white-space:pre-line"></div>
      <div class="jaf-bg-body"></div>
      <div class="jaf-bg-btns" style="display:flex;flex-direction:column;gap:12px;margin-top:16px"></div>
    </div>`);
    const canClose = () => !(bgScan && bgScan.running);
    ov.addEventListener('click', (e) => { if (e.target === ov && canClose()) closeBgPopup(); });
    ov.__esc = (e) => { if (e.key === 'Escape' && canClose()) { e.preventDefault(); closeBgPopup(); } };
    document.addEventListener('keydown', ov.__esc, true);
    document.body.appendChild(ov);
    return ov;
  }
  function closeBgPopup() {
    const ov = document.getElementById('jaf-bg-popup');
    if (!ov) return;
    document.removeEventListener('keydown', ov.__esc, true);
    ov.remove();
    if (bgScan && !bgScan.running) bgScan = null;
  }
  // zweiter Fortschrittsbalken (z. B. aktuelle Altersklasse); frac = null → ausblenden
  // Gesamt-Opa-Scan: Fortschritt der einzelnen Scans wird auf den Gesamtbalken umgerechnet, Balken 2 = aktueller Scan
  let bgFracMap = null; // { base, span, title, label }
  function bgBar2(frac, label, force = false) {
    if (bgFracMap && !force) return;
    const ov = bgPopup();
    const show = frac != null;
    ov.querySelector('.jaf-bg-bar2wrap').style.display = show ? '' : 'none';
    ov.querySelector('.jaf-bg-bar2lbl').style.display = show ? '' : 'none';
    if (!show) { ov.querySelector('.jaf-bg-barlbl').style.display = 'none'; return; }
    const f = Math.max(0, Math.min(1, frac));
    ov.querySelector('.jaf-bg-bar2').style.width = (f * 100).toFixed(1) + '%';
    ov.querySelector('.jaf-bg-bar2lbl').textContent = `${label}: ${Math.round(f * 100)} %`;
  }
  // Titel setzen; running = Warnhinweis „Seite nicht verlassen“ zeigen
  function bgTitle(title, running) {
    const ov = bgPopup();
    ov.querySelector('.jaf-bg-title').textContent = title;
    ov.querySelector('.jaf-bg-warn').style.display = running ? '' : 'none';
  }
  // freier Inhalt zwischen Statistik und Buttons (z. B. Einstellungen); null = leeren
  function bgBody(node) {
    const b = bgPopup().querySelector('.jaf-bg-body');
    b.innerHTML = '';
    if (node) b.appendChild(node);
    return b;
  }
  // Buttons ersetzen: [{ label, fn, primary, focus, disabled }]
  function bgButtons(defs) {
    const box = bgPopup().querySelector('.jaf-bg-btns');
    box.innerHTML = '';
    let focusEl = null;
    for (const d of defs) {
      const b = popupButton(d.label, d.fn, d);
      if (d.cls) b.classList.add(d.cls);
      if (d.hint) {
        const w = document.createElement('div');
        const h = document.createElement('div');
        h.style.cssText = 'font-size:12px;opacity:.7;margin:4px 4px 0';
        h.textContent = d.hint;
        w.appendChild(b); w.appendChild(h); box.appendChild(w);
      } else box.appendChild(b);
      if (d.focus) focusEl = b;
    }
    if (focusEl) setTimeout(() => focusEl.focus(), 0);
  }
  const bgStopButton = () => ({ label: 'Abbrechen', focus: true, fn: () => {
    if (bgScan) { bgScan.stop = true; bgPopup().querySelector('.jaf-bg-step').textContent = 'Wird nach dem aktuellen Schritt abgebrochen …'; }
  } });
  function bgUi(party, step, frac, stats) {
    const ov = bgPopup();
    if (party != null) ov.querySelector('.jaf-bg-party').textContent = party;
    if (step != null) ov.querySelector('.jaf-bg-step').textContent = step;
    if (frac != null && bgFracMap) { bgBar2(frac, bgFracMap.label, true); frac = bgFracMap.base + bgFracMap.span * Math.max(0, Math.min(1, frac)); }
    if (frac != null) {
      const f = Math.max(0, Math.min(1, frac));
      ov.querySelector('.jaf-bg-barwrap').style.display = ''; ov.querySelector('.jaf-bg-bar').style.width = (f * 100).toFixed(1) + '%';
      const lbl = ov.querySelector('.jaf-bg-barlbl');
      if (ov.querySelector('.jaf-bg-bar2wrap').style.display !== 'none') { lbl.style.display = ''; lbl.textContent = `${bgFracMap ? bgFracMap.title + ' · ' : ''}Gesamt: ${(f * 100).toFixed(1).replace('.', ',')} %`; }
    }
    if (stats != null) ov.querySelector('.jaf-bg-stats').textContent = stats;
  }
  const beforeUnloadGuard = (e) => { e.preventDefault(); e.returnValue = opaT('Der Opa-Scan läuft noch.'); return e.returnValue; };

  // ---- bereits bearbeitete Anmeldungen je Party merken: erneute Scans prüfen nur Neuanmeldungen ----
  // Ändern sich die Regeln (Altersgrenzen, Typen, Paar-Regeln), wird automatisch wieder vollständig gescannt.
  // Fingerabdruck der fürs Ignorieren relevanten Regeln (Schwellen, Schalter, Typen, Sugar Daddy/Mom)
  const rulesHash = (cfg = CONFIG) => JSON.stringify(GROUP_KEYS.map((g) => {
    const G = cfg.GROUPS[g];
    const th = Object.fromEntries(SCAN_SOURCES.map((q) => [q, g === 'p' ? [G.src[q].f[2], G.src[q].m[2]] : G.src[q][2]]));
    return [G.ignore, (G.types || []).slice().sort(), th, g === 'p' ? [G.sd, G.sm] : 0];
  }));
  const guestKey = (g) => g.id || '';
  function seenGuests(eventId) {
    const e = getEvents()[eventId] || {};
    return e.seenRules === rulesHash() ? new Set(e.seen || []) : new Set();
  }
  function rememberGuests(eventId, keys) {
    const m = getEvents();
    const e = m[eventId] || {};
    const prev = e.seenRules === rulesHash() ? e.seen || [] : [];
    e.seen = [...new Set(prev.concat(keys.filter(Boolean)))];
    e.seenRules = rulesHash();
    m[eventId] = e;
    gmSet(K_EVENTS, m);
  }

  // ---- Fehlschläge des Party-Scans (Hintergrund) speichern und exportieren ----
  const K_EVFAIL = 'jaf_evscan_failures'; // [{ ts, party, partyDate, partyUrl, name, url, step, msg }]
  function addEvFailure(f) {
    const l = gmGet(K_EVFAIL, []);
    l.push(Object.assign({ ts: Date.now() }, f));
    gmSet(K_EVFAIL, l.slice(-3000));
  }
  function exportEvFailures() {
    const l = gmGet(K_EVFAIL, []);
    downloadCsv('party-scan-fehlschlaege', ['Zeitpunkt', 'Party', 'Party-Datum', 'Party-Link', 'Name', 'Profil-Link', 'Schritt', 'Meldung'],
      l.map((f) => [fmtTs(f.ts), f.party || '', f.partyDate || '', f.partyUrl || '', f.name || '', f.url || '', f.step || '', f.msg || '']));
    return l.length;
  }

  // Grund, warum gerade kein Scan starten kann (anderer Scan / anderer Tab) – sonst ''
  function scanBlockedReason() {
    if (bgScan && bgScan.running) return opaT('Hier läuft bereits ein Opa-Scan.');
    if (getOpa().running && !opaStale(getOpa())) return opaT('Der Gruppen-Opa-Scan läuft gerade. Bitte erst diesen beenden.');
    const other = lockedByOther();
    if (other) return lockNotice(other).replace(' – hier wird nur markiert.', opaT('. Der Opa-Scan kann erst danach gestartet werden.'));
    return '';
  }
  // Klick auf „Opa-Scan starten“: Popup sofort öffnen, Partys sammeln, Start erst mit „Jetzt scannen …“
  async function bgEvStart() {
    if (bgScan) { bgPopup(); return; }
    bgScan = { stop: false, running: false };
    const startBtn = (fn) => ({ label: 'Jetzt scannen …', primary: true, focus: !!fn, disabled: !fn, fn });
    const closeBtn = (focus) => ({ label: 'Schließen', fn: closeBgPopup, focus });
    const blocked = (msg) => { bgTitle(opaT('Opa-Scan Partys'), false); bgUi('Scan zurzeit nicht möglich', msg, null, ''); bgButtons([startBtn(null), closeBtn(true)]); };
    bgTitle(opaT('Opa-Scan Partys'), false);
    bgUi('Suche Eventanmeldungen …', '', null, '');
    bgButtons([startBtn(null), closeBtn(true)]);
    const why = scanBlockedReason();
    if (why) { blocked(why); bgScan = null; return; }
    let list;
    try { list = await scanEventList((n) => bgUi('Lade alle Eventanmeldungen …', `${n} Partys geladen (die Seite scrollt dazu kurz)`, null, null)); }
    catch (e) { blocked(e.message || String(e)); bgScan = null; return; }
    if (!document.getElementById('jaf-bg-popup')) { bgScan = null; return; } // inzwischen geschlossen
    bgScan = null;
    if (!list.length) { blocked('Keine Eventanmeldungen gefunden.'); return; }
    bgUi(`${list.length} Partys gefunden`, 'Reihenfolge: am längsten nicht gescannte Party zuerst',
      null, (CONFIG.DRY_RUN ? 'Testmodus: es wird nichts ignoriert.\n' : '') +
      'Für jede Party: Veranstalter und VIP-Gäste auf die Whitelist, Gästeliste lesen, Treffer ignorieren. ' +
      'Bereits gescannte Partys prüfen nur Neuanmeldungen.\nDiese Seite muss während des Scans geöffnet bleiben.');
    bgButtons([startBtn(async () => { if (await visGuard()) bgEvRun(list); }), closeBtn(false)]);
  }
  // emb = true: als Teil des Opa-Scans (Hamburger-Menü) – Popup, Sperre und Abbruch gehören dem Aufrufer; Rückgabe: Statistik
  async function bgEvRun(list, emb = false) {
    if (!emb) {
      if (bgScan && bgScan.running) return;
      const why = scanBlockedReason();
      if (why) { bgUi('Scan zurzeit nicht möglich', why, null, ''); return; }
      if (!(await acquireLock(opaT('Opa-Scan Partys (Hintergrund)')))) { bgUi('Scan zurzeit nicht möglich', 'Ein anderer Tab hat gerade begonnen zu arbeiten. Bitte später erneut versuchen.', null, ''); return; }
      bgTitle(opaT('Opa-Scan läuft im Hintergrund'), true);
      bgButtons([bgStopButton()]);
    }
    saveEventsFromList(list);
    const events = orderEvents(list).map((e) => ({ id: e.id, url: e.url, date: e.date, name: (getEvents()[e.id] || {}).name || e.slugName }));
    if (!emb) bgScan = { stop: false, running: true };
    let fallback = false;
    if (!emb) { window.__jafBgBusy = true; window.addEventListener('beforeunload', beforeUnloadGuard); }
    const st = { done: 0, ignored: 0, skipped: 0, failed: 0, notes: 0, vip: 0, orgs: 0, unblocked: 0, checked: 0, displaced: 0, limitHit: 0 };
    const stats = () => `Partys fertig: ${st.done}/${events.length} · ignoriert: ${st.ignored} · übersprungen: ${st.skipped} · fehlgeschlagen: ${st.failed}\n` +
      `Veranstalter: ${st.orgs} (entsperrt: ${st.unblocked}) · VIP-Gäste: ${st.vip} · Notizen angepasst: ${st.notes}\n` +
      `${fillText()} · verdrängt: ${st.displaced} · Limit erreicht, nicht gesperrt: ${st.limitHit}`;
    if (!emb) { bgUi('Ignorierliste', 'Lese die Ignorierliste …', null, null); try { await syncIgnoreList(true); } catch (e) { /* egal */ } }
    const logLines = [];
    const note = (m) => { logLines.push(`${fmtTs(Date.now())} ${m}`); console.log('[Alter-Filter][Hintergrund-Scan]', m); };
    let firstFrameOk = false;
    try {
      for (let ei = 0; ei < events.length && !bgScan.stop; ei++) {
        const e = events[ei];
        const head = `Party ${ei + 1}/${events.length}: ${e.name} (${e.date})`;
        const frac0 = ei / events.length, fracN = 1 / events.length;
        bgUi(head, 'Lade Event-Seite und Gästeliste …', frac0, stats());
        let data;
        try {
          data = await bgFrameG(e.url, 'jaf-bg-ev', (n) => bgUi(null, `Lade Gästeliste … ${n} Anmeldungen`, null, null), 240000);
          firstFrameOk = true;
        } catch (err) {
          if (err.fatal || bgScan.stop) { bgScan.stop = true; bgScan.stopMsg = bgScan.stopMsg || (err.fatal ? err.message : ''); break; }
          note(`${e.name}: Event-Seite nicht ladbar (${err.message})`);
          addEvFailure({ party: e.name, partyDate: e.date, partyUrl: e.url, step: 'Event-Seite laden', msg: err.message });
          if (!firstFrameOk && ei === 0) throw new Error('Event-Seiten lassen sich im Hintergrund nicht laden.');
          continue;
        }
        const info = data.info || {};
        const party = { name: info.name || e.name, date: info.date || e.date };
        const partyDay = (info.start && isoDay(new Date(Date.parse(info.start)))) || dayOfDE(party.date) || null;
        const ev = getEvents(); ev[e.id] = Object.assign(ev[e.id] || {}, { name: party.name, start: info.start || (ev[e.id] || {}).start }); gmSet(K_EVENTS, ev);
        // Veranstalter + VIP-Gäste
        const noteJobs = [];
        for (const m of data.orgs || []) {
          addWhiteEntry(m, CONFIG.ORGANIZER_REASON, party); st.orgs++;
          if (blockedIdMap().get(m.id)) {
            const u = await bgUnignore(m.id).catch((x) => ({ ok: false, msg: x.message }));
            if (u.ok) {
              st.unblocked++;
              const logPath = Object.keys(getLog()).find((p) => idOf(p) === String(m.id));
              if (logPath) { markUnblocked(logPath, m, `Whitelist: ${CONFIG.ORGANIZER_REASON}`);
                noteJobs.push({ path: logPath, url: location.origin + logPath, name: m.name, id: m.id, ages: [], action: 'note', line: CONFIG.ORGANIZER_NOTE_TEXT.replace('{party}', party.name) }); }
              note(`${m.name}: Veranstalter – entsperrt`);
            } else {
              note(`${m.name}: Veranstalter – Entsperren fehlgeschlagen (${u.msg})`);
              addEvFailure({ party: party.name, partyDate: party.date, partyUrl: e.url, name: m.name, url: m.url, step: 'Veranstalter entsperren', msg: u.msg });
            }
          }
        }
        for (const v of data.vips || []) { addWhiteEntry(v, CONFIG.VIP_REASON, party); st.vip++; }
        removeWhitelistedFromWatch();
        if (bgScan.stop) break;
        // Gäste einordnen + unbekannte Profile im Hintergrund prüfen
        await syncIgnoreList(true);
        const guests = htmlToItems(data.html || []).map(parseGuest);
        // AWO-Faktor aus der vollständigen Gästeliste (Anmeldungen) – gilt bis zum nächsten Scan bzw. Einzelaufruf
        if (data.hasList) {
          const awo = computeAwo(guests);
          if (awo.value != null) {
            const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { awo: Math.round(awo.value * 1000) / 10, awoTs: Date.now() }); gmSet(K_EVENTS, m);
            note(`${party.name}: AWO ${pct(awo.value)}`);
          }
          updateEventBadges();
        }
        noteSighting(guests.filter((g) => g.id), 'Party', partyDay);
        const ctx = { white: whiteList(), blocked: blockedIdMap(), acc: getAccounts() };
        const known = seenGuests(e.id);
        const seen = new Set(); const items = [];
        let skippedKnown = 0;
        for (const g of guests) {
          if (g.id && seen.has(g.id)) continue; if (g.id) seen.add(g.id);
          if (g.id && known.has(g.id)) { skippedKnown++; continue; } // schon beim letzten Scan bearbeitet
          items.push({ g, c: classifyGuest(g, ctx) });
        }
        st.checked += items.length;
        if (skippedKnown) note(`${party.name}: ${skippedKnown} Anmeldungen schon bei einem früheren Scan bearbeitet, ${items.length} neu`);
        bgUi(null, `${items.length} neue Anmeldungen${skippedKnown ? ` (${skippedKnown} bereits bekannt)` : ''}`, null, null);
        await precheck(items, ctx, (n, t) => bgUi(null, `Prüfe Profile im Hintergrund … ${n}/${t}`, frac0 + fracN * 0.4 * (n / Math.max(1, t)), null), () => bgScan.stop);
        if (bgScan.stop) break;
        let hits = items.filter((x) => x.c.kind === 'ignore' || x.c.kind === 'verify').map((x) => x.c.item);
        const due = dueFromWatch();
        if (due.length) { const inDue = new Set(due.map((d) => d.path)); hits = due.concat(hits.filter((h) => !inDue.has(h.path))); }
        hits = noteJobs.concat(hits);
        hits.forEach((h) => { if (!h.action && !h.seen && h.source === 'Party') h.seen = partyDay; });
        const limit = CONFIG.DRY_RUN ? Math.min(CONFIG.TEST_MAX_PROFILES, CONFIG.MAX_PER_RUN) : CONFIG.MAX_PER_RUN;
        const queue = hits.slice(0, limit);
        let complete = hits.length <= limit;
        const unfinished = new Set(hits.slice(limit).map((h) => idOf(h.path)));
        note(`${party.name}: ${guests.length} Anmeldungen, ${queue.length} Profil(e) zu bearbeiten`);
        // Profile nacheinander im Hintergrund bearbeiten
        for (let qi = 0; qi < queue.length && !bgScan.stop; qi++) {
          const it = queue[qi];
          bgUi(null, `Profil ${qi + 1}/${queue.length}: ${it.name} …`, frac0 + fracN * (0.4 + 0.6 * qi / Math.max(1, queue.length)), stats());
          let r;
          try { r = await blockItem(it, 'Party', st); }
          catch (err) { r = { result: 'failed', msg: err.message }; if (err.fatal || bgScan.stop) { bgScan.stop = true; bgScan.stopMsg = bgScan.stopMsg || (err.fatal ? err.message : ''); } }
          if (r.result === 'ignored') st.ignored++; else if (r.result === 'note') st.notes++; else if (r.result === 'skipped') st.skipped++;
          else if (r.result === 'limit') { complete = false; unfinished.add(idOf(it.path)); }
          else {
            st.failed++; complete = false; unfinished.add(idOf(it.path));
            addEvFailure({ party: party.name, partyDate: party.date, partyUrl: e.url, name: it.name, url: it.url || location.origin + it.path,
              step: it.action === 'note' ? 'Notiz anpassen' : it.verify ? 'Profil prüfen/ignorieren' : 'Ignorieren', msg: r.msg || r.result });
          }
          note(`${it.name}: ${r.result} – ${r.msg || ''}`);
          bgUi(null, `${it.name}: ${r.msg || r.result}`, null, stats());
          if (qi < queue.length - 1) await sleep(rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS));
          if (bgScan.stop) queue.slice(qi + 1).forEach((x) => unfinished.add(idOf(x.path)));
        }
        // bearbeitete Anmeldungen merken (nicht: fehlgeschlagene / nicht mehr drangekommene; im Testmodus gar nicht)
        if (!CONFIG.DRY_RUN) {
          const pending = new Set([...unfinished, ...items.filter((x) => x.c.kind === 'verify' && !queue.some((q) => q.path === x.g.path)).map((x) => x.g.id)]);
          rememberGuests(e.id, items.map((x) => guestKey(x.g)).filter((k) => k && !pending.has(k)));
        }
        if (bgScan.stop) break;
        if (complete && !CONFIG.DRY_RUN) { const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { doneTs: Date.now() }); gmSet(K_EVENTS, m); }
        st.done++;
        updateEventBadges();
        bgUi(null, `${party.name}: fertig`, (ei + 1) / events.length, stats());
        if (ei < events.length - 1) await sleep(rand(CONFIG.EVENT_DELAY_MIN_MS, CONFIG.EVENT_DELAY_MAX_MS));
      }
      if (emb) return st;
      bgTitle(bgScan.stop ? opaT('Opa-Scan abgebrochen') : opaT('Opa-Scan fertig'), false);
      bgUi(bgScan.stop ? opaT('Opa-Scan abgebrochen') : opaT('Opa-Scan fertig'), bgScan.stop ? (bgScan.stopMsg || 'Abgebrochen.') : 'Alle Partys bearbeitet.', bgScan.stop ? null : 1, stats());
    } catch (err) {
      if (emb) { st.error = err.message; return st; }
      bgTitle(opaT('Opa-Scan nicht möglich'), false);
      bgUi(opaT('Opa-Scan nicht möglich'), err.message, null, stats());
      fallback = true;
    } finally {
      if (!emb) bgEvFinish(st, fallback, logLines);
      else { const ev = getEv(); ev.log = (ev.log || []).concat(logLines).slice(-300); gmSet(K_EVSCAN, ev); }
    }
    return st;
  }
  function bgEvFinish(st, fallback, logLines) {
    {
      window.removeEventListener('beforeunload', beforeUnloadGuard);
      window.__jafBgBusy = false;
      bgScan = null;
      releaseLock();
      const btns = [];
      if (fallback) btns.push({ label: 'Normalen Scan (mit Seitenwechsel) starten', fn: () => { closeBgPopup(); evStart(true); } });
      if (st.failed) btns.push({ label: 'Fehlschläge exportieren (CSV)', fn: () => exportEvFailures() });
      btns.push({ label: 'Schließen', fn: closeBgPopup, focus: true });
      bgButtons(btns);
      const ev = getEv(); ev.log = (ev.log || []).concat(logLines).slice(-300); gmSet(K_EVSCAN, ev);
    }
  }

  // =====================================================================
  // ---------- Mitgliedersuche: neuer Opa-Scan (eigener Button im Seitenkopf) ----------
  // 1. „Mit aktuellen Sucheinstellungen filtern“: aktuelle Suche komplett laden, Treffer ignorieren
  // 2. „Systematische Suche“: alle gewählten Umkreise (CONFIG.AREAS) per Deeplink, jedes Alter einzeln (70+ abwärts),
  //    jede Einzelsuche wiederholen, bis keine neuen Profile mehr kommen (max. 20, bei 70+ max. 200 Durchläufe)
  // Geladen wird in einem unsichtbaren Frame, ignoriert wie beim Party-Scan im Hintergrund.
  // =====================================================================
  const isMemberSearchPage = () => /^\/member(\/|$)/.test(location.pathname);
  const K_MS_SET = 'jaf_ms_settings';       // gemerkte Einstellungen der systematischen Suche
  const K_MS_FAIL = 'jaf_ms_failures';      // [{ ts, search, name, url, msg }]
  const K_MS_SINGLE = 'jaf_ms_single_age_couples'; // { path: { name, url, ages, ts, search } }
  const K_MS_RESUME = 'jaf_ms_resume';      // unterbrochene systematische Suche: { opt, ai, ageIdx, nAreas, city, age, ts }
  const MS_TYPES = [['f', 'Frauen', 'frau'], ['m', 'Männer', 'mann'], ['p', 'Paare', 'paar'], ['nb', 'Non-binary', 'nonbinary']];
  const msAreaGroups = () => Object.entries(CONFIG.AREAS || {}).filter(([, l]) => l.length);
  function msSettings() {
    // Vorgabe: Typen der Gruppen mit „Ignorieren aktiv“, ab der niedrigsten Such-Schwelle
    const on = GROUP_KEYS.filter((g) => CONFIG.GROUPS[g].ignore);
    const types = [...new Set(on.flatMap((g) => (g === 'm' ? ['m'] : g === 'f' ? ['f'] : ['p']).concat((CONFIG.GROUPS[g].types || []).some((t) => /non-binary|trans/i.test(t)) ? ['nb'] : [])))];
    const th = on.flatMap((g) => (g === 'p' ? [CONFIG.GROUPS.p.src.Suche.f[2], CONFIG.GROUPS.p.src.Suche.m[2]] : [CONFIG.GROUPS[g].src.Suche[2]]));
    const d = { types: types.length ? types : ['m', 'p'], min: Math.min(70, th.length ? Math.min(...th) : 70), max: 70, lands: msAreaGroups().map(([n]) => n) };
    const s = gmGet(K_MS_SET, null);
    if (!s) return d;
    return { types: Array.isArray(s.types) ? s.types : d.types, min: s.min || d.min, max: s.max || d.max,
      lands: Array.isArray(s.lands) ? s.lands.filter((n) => (CONFIG.AREAS || {})[n]) : d.lands };
  }
  // JOYclub-Slug: ä→ae ö→oe ü→ue ß→ss, übrige Akzente weg, Leerzeichen/Klammern/Sonstiges → „_“ (z. B. „Mülheim (Ruhr)“ → muelheim_ruhr)
  const joySlug = (t) => norm(t).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/g, '_').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  const msSlug = (t) => joySlug(t) || 'ort';
  function msUrl(area, types, age) {
    const is = MS_TYPES.filter(([k]) => types.includes(k)).map(([, , slug]) => slug).join('_');
    return `${location.origin}/member/${msSlug(area[0])}-x${area[4]}-r/is-${is}/?user_geo_distance=${CONFIG.AREA_RADIUS_KM}&user_age=${age}_${age}`;
  }
  // Icon „Opa mit Lupe“ (Variante B), 24er-Raster
  function opaLupeSvg(size = 20) {
    const id = 'jafml' + Math.random().toString(36).slice(2, 7);
    const hs = 'x1="18.81" y1="18.31" x2="21.8" y2="21.6"';
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="width:${size}px;height:${size}px;fill:currentColor;color:inherit" aria-hidden="true">` +
      `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white"/>` +
      `<circle cx="15.5" cy="15" r="6.6" fill="black"/><line ${hs} stroke="black" stroke-width="4.9" stroke-linecap="round"/></mask></defs>` +
      `<g mask="url(#${id})"><svg x="0" y="0" width="12" height="24" viewBox="0 0 640 1280" preserveAspectRatio="xMidYMid meet">` +
      `${nickG()}</svg></g>` +
      `<circle cx="15.5" cy="15" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/><line ${hs} stroke="currentColor" stroke-width="2.7" stroke-linecap="round"/></svg>`;
  }
  function insertMsButton() {
    if (!isMemberSearchPage() || document.querySelector('.jaf-ms-btn')) return;
    const box = document.querySelector('.member_search_header_buttons');
    if (!box) return;
    const b = document.createElement('j-control-button');
    b.className = 'jaf-ms-btn';
    b.setAttribute('icon-only', 'true');
    b.setAttribute('variant', 'transparent');
    b.setAttribute('aria-label', opaT('Opa-Scan'));
    b.setAttribute('title', opaT('Opa-Scan'));
    b.setAttribute('role', '');
    b.style.color = 'white';
    b.innerHTML = `<span slot="icon-prepend" style="display:inline-flex;color:white">${opaLupeSvg(20)}</span>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); msOpen(); });
    const name = box.querySelector('[data-e2e="search-name-button"]');
    if (name && name.parentElement === box) name.after(b); else box.appendChild(b);
  }
  setInterval(() => { try { insertMsButton(); decorateMemberCards(); } catch (e) { /* weiter */ } }, 1500);

  // Ergebnis-Karten markieren wie Gästelisten auf Partys (Farbe nach Alter, rotes X bei Ignorierten, Popup per Klick)
  function decorateMemberCards() {
    if (!isMemberSearchPage()) return;
    const cards = readCards();
    if (!cards.length) return;
    const ctx = { white: whiteList(), acc: getAccounts(), blocked: blockedIdMap() };
    for (const c of cards) {
      const g = Object.assign({ id: idOf(c.path) }, c);
      const st = guestStyle(g, ctx, 'Suche');
      const a = c.a;
      const blk = g.id && ctx.blocked.get(g.id);
      const sig = [st.none, st.color, st.dashed, st.txt, !!blk, g.ages.join('+'), showX(st)].join('|');
      if (a.__jafSig !== sig) {
        a.__jafSig = sig;
        let b = a.querySelector('.jaf-badge');
        if (st.none) { a.style.outline = ''; if (b) b.remove(); } else {
          a.style.outline = `${st.dashed ? 2 : 3}px ${st.dashed ? 'dashed' : 'solid'} ${st.color}`;
          a.style.outlineOffset = '-1px';
          if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
          if (getComputedStyle(a).display === 'inline') a.style.display = 'block';
          if (!b) { b = document.createElement('div'); b.className = 'jaf-badge'; a.appendChild(b); }
          const extra = [g.ages.join('+') || '?', st.color === COLORS.red ? st.txt : ''].filter(Boolean).join(' · ');
          b.textContent = extra + (blk ? ' · ignoriert' : '');
          b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;font:bold 11px system-ui;padding:2px 6px;border-radius:3px;pointer-events:none;' +
            `background:${st.color};color:${st.fg || (st.color === COLORS.white ? '#000' : '#fff')}`;
        }
        const x = a.querySelector('.jaf-x');
        const wantX = blk && showX(st);
        if (wantX && !x) { if (getComputedStyle(a).position === 'static') a.style.position = 'relative'; a.insertAdjacentHTML('beforeend', `<div class="jaf-x" style="position:absolute;inset:0;z-index:4;pointer-events:none">${X_SVG}</div>`); }
        if (!wantX && x) x.remove();
      }
      if (!a.__jafBound) {
        a.__jafBound = true;
        a.addEventListener('click', (ev) => {
          const now = blockedIdMap().get(idOf(c.path));
          if (!now) return; // nicht (mehr) ignoriert → normaler Link
          ev.preventDefault(); ev.stopPropagation();
          ignoredPopup(g, now, { name: 'Suche', date: fmtDay(Date.now()), search: true });
          setTimeout(() => { a.__jafSig = ''; }, 3000);
        }, true);
      }
    }
  }

  // ---- Steckbrief(e) einer Profilseite: [{ g: universal-gender, age, props: { Größe: '170 cm', … } }] (erstes Vorkommen je Person) ----
  function parseSedCards(doc = document) {
    const out = [], seen = new Set();
    for (const up of doc.querySelectorAll('.profile-sed-card__upper-info')) {
      const gi = up.querySelector('j-gender-icon[universal-gender]');
      const ageTxt = gi ? ((gi.parentElement && gi.parentElement.textContent) || '') : '';
      const age = +((ageTxt.match(/(\d{2,3})\s*Jahre/) || [])[1] || 0);
      const g = gi ? gi.getAttribute('universal-gender') : '';
      const key = `${g}|${age}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const props = {};
      const card = up.closest('.profile-sed-card') || up.parentElement || up;
      for (const pr of card.querySelectorAll('.profile-sed-card__property')) {
        const h = ((pr.querySelector('.profile-sed-card__headline') || {}).textContent || '').trim();
        const c = pr.querySelector('.profile-sed-card__content');
        if (!h || !c) continue;
        const v = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (!(h in props)) props[h] = /keine angabe/i.test(v) ? '' : v;
      }
      const title = ((card.querySelector('h2, h3') || {}).textContent || '').trim();
      out.push({ g, age, title, props });
    }
    return out;
  }

  // ---- Figur: drei zusätzliche Auswahlwerte (JOYclub-Suche bekommt „Eher etwas mehr“) ----
  const FIG_MODES = { mollig: { label: 'Mollig', min: 30, hide: 0 }, mastschwein: { label: 'Mastschwein', min: 35, hide: 35 }, qualle: { label: 'Qualle', min: 40, hide: 40 } };
  const FIG_BANDS = [[40, 'Qualle'], [35, 'Mastschwein'], [30, 'Mollig']];
  const ssGet = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const ssSet = (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* egal */ } };
  const figMode = () => { const m = ssGet('jaf_fig'); return FIG_MODES[m] && isMemberSearchPage() && /[?&]user_bmi=3(&|$)/.test(location.search) ? m : ''; };
  function figSelects() { return [...document.querySelectorAll('j-setting-select[label]')].filter((e) => /^figur$/i.test(e.getAttribute('label') || '')); }
  function figInjectOptions() {
    for (const sel of figSelects()) {
      let items = [];
      try { items = JSON.parse(sel.getAttribute('items') || '[]'); } catch (e) { continue; }
      if (!items.some((x) => String(x.value) === '3') || items.some((x) => x.label === 'Mollig')) continue;
      items = items.concat(Object.values(FIG_MODES).map((m) => ({ label: m.label, value: '3' })));
      sel.setAttribute('items', JSON.stringify(items));
    }
    // angezeigten Wert ersetzen, solange ein eigener Modus gilt
    const m = ssGet('jaf_fig');
    if (FIG_MODES[m]) for (const sel of figSelects()) {
      if (String(sel.getAttribute('value')) !== '3' || !sel.shadowRoot) continue;
      const w = document.createTreeWalker(sel.shadowRoot, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.parentElement && n.parentElement.closest('[role="option"], [role="listbox"], li')) continue;
        if (/Eher etwas mehr/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace('Eher etwas mehr', FIG_MODES[m].label);
      }
    }
  }
  if (!IN_FRAME) document.addEventListener('click', (ev) => {
    const path = ev.composedPath ? ev.composedPath() : [];
    if (!path.some((e) => e && e.tagName === 'J-SETTING-SELECT' && /^figur$/i.test(e.getAttribute('label') || ''))) return;
    const el = path.find((e) => e && e.nodeType === 1 && /^(Eher schlank|Normale Figur|Eher etwas mehr|Mollig|Mastschwein|Qualle)$/.test((e.textContent || '').trim()));
    if (!el) return;
    const t = el.textContent.trim();
    const k = Object.keys(FIG_MODES).find((x) => FIG_MODES[x].label === t);
    ssSet('jaf_fig', k || '');
  }, true);
  // BMI eines Kontos (bei Paaren: Person des anderen Geschlechts zum eigenen Profil, sonst irgendeine mit Angaben)
  const figNum = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
  function figBmi(rec) {
    const ps = (rec && rec.fig && rec.fig.persons) || [];
    if (!ps.length) return null;
    const calc = (p) => { const h = figNum(p.h), w = figNum(p.w); return h && w ? { bmi: w / ((h / 100) ** 2), w } : { bmi: null, w: w || 0 }; };
    let pick = ps;
    if (ps.length > 1) {
      const own = gmGet(K_OWN_TYPE, '');
      const want = own === 'Mann' ? '2' : own === 'Frau' ? '1' : '';
      if (want) pick = ps.filter((p) => p.g === want);
      if (!pick.length) pick = ps;
    }
    const known = pick.map(calc).filter((x) => x.bmi != null).sort((a, b) => b.bmi - a.bmi);
    return known[0] || { bmi: null, w: Math.max(0, ...pick.map((p) => figNum(p.w) || 0)) };
  }
  function figPersonsFromDoc(doc) {
    return parseSedCards(doc).map((p) => {
      const h = (String(p.props['Größe'] || '').match(/(\d{3})/) || [])[1];
      const w = (String(p.props['Gewicht'] || '').match(/(\d{2,3})/) || [])[1];
      return { g: p.g, age: p.age, h: h ? +h : 'UNKNOWN', w: w ? +w : 'UNKNOWN' };
    });
  }
  let figBusy = false;
  async function figFetchOne(c) {
    const r = await jfetch(c.url);
    if (!r.ok || !r.doc) throw new Error(`HTTP ${r.status}`);
    const persons = figPersonsFromDoc(r.doc);
    const acc = getAccounts();
    const rec = Object.assign({ first: isoDay(new Date()), name: c.name, url: c.url, type: c.type }, acc[c.path] || {});
    rec.fig = { ts: Date.now(), persons: persons.length ? persons : [{ g: '', h: 'UNKNOWN', w: 'UNKNOWN' }] };
    acc[c.path] = rec;
    gmSet(K_ACCOUNTS, acc);
  }
  async function figWorker() {
    if (figBusy) return;
    figBusy = true;
    try {
      while (figMode()) {
        const acc = getAccounts();
        const todo = readCards().find((c) => !(acc[c.path] && acc[c.path].fig) && !c.a.__jafFigFail);
        if (!todo) break;
        if (!ssGet('jaf_fig_vis')) {
          const ok = await visGuard();
          ssSet('jaf_fig_vis', ok ? 'ok' : 'no');
        }
        if (ssGet('jaf_fig_vis') !== 'ok') break;
        try { await figFetchOne(todo); } catch (e) { todo.a.__jafFigFail = true; }
        const vr = visRun(); if (vr) gmSet(K_VIS_RUN, Object.assign(vr, { ts: Date.now() }));
        figRender();
        await sleep(1200 + Math.random() * 1200);
      }
    } finally {
      figBusy = false;
      const vr = visRun(); if (vr && vr.ts) gmSet(K_VIS_RUN, Object.assign({}, vr, { ts: 0 }));
    }
  }
  function figRender() {
    const mode = figMode();
    const cards = readCards();
    if (!mode) {
      for (const c of cards) { const b = c.a.querySelector('.jaf-fig'); if (b) b.remove(); if (c.a.__jafFigWrap) c.a.__jafFigWrap.style.display = ''; }
      return;
    }
    const M = FIG_MODES[mode];
    const acc = getAccounts();
    if (!cards.length) return;
    // gemeinsamer Container der Karten
    let P = cards[0].a.parentElement;
    while (P && !cards.every((c) => P.contains(c.a))) P = P.parentElement;
    if (!P) return;
    const rows = cards.map((c) => {
      let w = c.a; while (w.parentElement && w.parentElement !== P) w = w.parentElement;
      c.a.__jafFigWrap = w;
      const rec = acc[c.path];
      const done = !!(rec && rec.fig);
      const b = done ? figBmi(rec) : null;
      const bmi = b && b.bmi != null ? b.bmi : null;
      const eff = bmi != null ? bmi : M.min;
      return { c, w, done, bmi, eff, kg: (b && b.w) || 0 };
    });
    for (const r of rows) {
      const hide = r.done && r.eff < M.hide;
      r.w.style.display = hide ? 'none' : '';
      let el = r.c.a.querySelector('.jaf-fig');
      let txt = '';
      if (r.done) {
        if (r.bmi == null) txt = `${M.label}? · BMI ?`;
        else if (r.bmi >= Math.max(30, M.min)) txt = `${(FIG_BANDS.find(([t]) => r.bmi >= t) || [])[1]} · BMI ${r.bmi.toFixed(1).replace('.', ',')}`;
      }
      if (!txt) { if (el) el.remove(); continue; }
      if (!el) {
        el = document.createElement('div'); el.className = 'jaf-fig';
        if (getComputedStyle(r.c.a).position === 'static') r.c.a.style.position = 'relative';
        r.c.a.appendChild(el);
      }
      if (el.textContent !== txt) el.textContent = txt;
      el.style.cssText = 'position:absolute;bottom:6px;left:6px;z-index:5;font:bold 11px system-ui;padding:2px 6px;border-radius:3px;pointer-events:none;background:#7a3fb0;color:#fff';
    }
    // sortieren: geprüfte zuerst, BMI absteigend, bei Gleichstand höheres Gewicht; ungeprüfte am Ende
    const sorted = rows.slice().sort((a, b) => (b.done - a.done) || (b.eff - a.eff) || (b.kg - a.kg));
    const cur = [...P.children].filter((x) => rows.some((r) => r.w === x));
    if (sorted.some((r, i) => r.w !== cur[i])) for (const r of sorted) P.appendChild(r.w);
  }
  function figTick() {
    if (!isMemberSearchPage()) return;
    figInjectOptions();
    figRender();
    if (figMode()) figWorker();
  }
  if (!IN_FRAME) setInterval(() => { try { figTick(); } catch (e) { /* weiter */ } }, 1500);

  // ---- Popup 1: Auswahl ----
  function msOpen() {
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgScan = null;
    bgTitle(opaT('Opa-Scan Mitgliedersuche'), false);
    bgUi('', 'Wie soll gesucht werden?', null, '');
    bgPopup().querySelector('.jaf-bg-barwrap').style.display = 'none';
    bgBody(null);
    const res = gmGet(K_MS_RESUME, null);
    const btns = [
      { label: 'Mit aktuellen Sucheinstellungen filtern', fn: () => msRun({ mode: 'current' }) },
      { label: 'Systematische Suche starten', fn: () => { closeBgPopup(); msSetup(); } },
    ];
    if (res && res.opt) btns.push({ label: `Systematische Suche fortsetzen (Umkreis ${res.ai + 1}/${res.nAreas} ${res.city}, Alter ${res.age >= 70 ? '70+' : res.age})`,
      fn: () => msRun(Object.assign({}, res.opt, { mode: 'system', startAi: res.ai, startAgeIdx: res.ageIdx })) });
    btns.push({ label: 'Abbrechen', fn: closeBgPopup, focus: true });
    bgButtons(btns);
  }

  // ---- Popup 2: Einstellungen der systematischen Suche ----
  function msSetup() {
    const set = msSettings();
    bgTitle('Systematische Suche', false);
    bgUi('', '', null, '');
    const wrap = document.createElement('div');
    const css = '.jaf-ms-chk{display:inline-flex;align-items:center;gap:8px;margin:0 16px 6px 0;cursor:pointer}' +
      '.jaf-ms-chk input{width:18px;height:18px;accent-color:#c71b1b;margin:0;cursor:pointer}' +
      '.jaf-ms-range{position:relative;height:24px;margin:6px 4px 4px}' +
      '.jaf-ms-range input{position:absolute;left:0;top:0;width:100%;margin:0;background:none;pointer-events:none;-webkit-appearance:none;appearance:none;height:24px}' +
      '.jaf-ms-range input::-webkit-slider-thumb{pointer-events:auto;-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;border:0;cursor:pointer}' +
      '.jaf-ms-range input::-moz-range-thumb{pointer-events:auto;width:18px;height:18px;border-radius:50%;background:#fff;border:0;cursor:pointer}' +
      '.jaf-ms-range input::-webkit-slider-runnable-track{background:transparent}.jaf-ms-range input::-moz-range-track{background:transparent}' +
      '.jaf-ms-land{display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid #2e3236;cursor:pointer}' +
      '.jaf-ms-land input{width:18px;height:18px;accent-color:#c71b1b;margin:0;cursor:pointer}' +
      '.jaf-ms-link{cursor:pointer;text-decoration:underline;opacity:.85}';
    wrap.innerHTML = `<style>${css}</style>
      <div style="font-weight:bold;margin:2px 0 6px">Ich suche</div><div class="jaf-ms-types" style="margin-bottom:10px"></div>
      <div style="font-weight:bold">Alter <span class="jaf-ms-agetxt" style="font-weight:normal;opacity:.85"></span></div>
      <div class="jaf-ms-range"><div style="position:absolute;top:10px;left:0;right:0;height:4px;background:#4a4f53;border-radius:2px"></div>
        <div class="jaf-ms-act" style="position:absolute;top:10px;height:4px;background:#c71b1b;border-radius:2px"></div>
        <input type="range" class="jaf-ms-lo" min="18" max="70" step="1"><input type="range" class="jaf-ms-hi" min="18" max="70" step="1"></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.6;margin:0 2px 12px"><span>18</span><span>70+</span></div>
      <div style="display:flex;align-items:baseline;margin-bottom:4px"><span style="font-weight:bold;flex:1">Bundesländer</span>
        <span style="font-size:12px"><span class="jaf-ms-link jaf-ms-all">alle</span> · <span class="jaf-ms-link jaf-ms-none">keine</span></span></div>
      <div class="jaf-ms-lands"></div>
      <div class="jaf-ms-sum" style="opacity:.75;font-size:12px;margin-top:10px"></div>`;
    const types = wrap.querySelector('.jaf-ms-types');
    for (const [k, label] of MS_TYPES) {
      const l = document.createElement('label'); l.className = 'jaf-ms-chk';
      l.innerHTML = `<input type="checkbox" value="${k}"${set.types.includes(k) ? ' checked' : ''}><span></span>`;
      l.querySelector('span').textContent = label; types.appendChild(l);
    }
    const lands = wrap.querySelector('.jaf-ms-lands');
    for (const [name, list] of msAreaGroups()) {
      const l = document.createElement('label'); l.className = 'jaf-ms-land';
      l.innerHTML = `<input type="checkbox"${set.lands.includes(name) ? ' checked' : ''}><span style="flex:1"></span><span style="opacity:.6;font-size:12px">${list.length} Umkreis${list.length === 1 ? '' : 'e'}</span>`;
      l.querySelector('input').value = name; l.querySelector('span').textContent = name; lands.appendChild(l);
    }
    const lo = wrap.querySelector('.jaf-ms-lo'), hi = wrap.querySelector('.jaf-ms-hi');
    lo.value = set.min; hi.value = set.max;
    const read = () => {
      let a = +lo.value, b = +hi.value;
      if (a > b) [a, b] = [b, a];
      return { types: [...types.querySelectorAll('input:checked')].map((i) => i.value), min: a, max: b,
        lands: [...lands.querySelectorAll('input:checked')].map((i) => i.value) };
    };
    const ageText = (a, b) => (b >= 70 ? (a >= 70 ? '70 und älter' : `ab ${a} Jahre`) : (a === b ? `${a} Jahre` : `${a} – ${b} Jahre`));
    const steps = (a, b) => b - a + 1;
    const refresh = () => {
      const r = read();
      wrap.querySelector('.jaf-ms-agetxt').textContent = ageText(r.min, r.max);
      const pct = (v) => ((v - 18) / 52) * 100;
      const act = wrap.querySelector('.jaf-ms-act'); act.style.left = pct(r.min) + '%'; act.style.width = (pct(r.max) - pct(r.min)) + '%';
      const nAreas = msAreaGroups().filter(([n]) => r.lands.includes(n)).reduce((s2, [, l]) => s2 + l.length, 0);
      wrap.querySelector('.jaf-ms-sum').textContent = `${nAreas} Umkreise à ${CONFIG.AREA_RADIUS_KM} km · je ${steps(r.min, r.max)} Altersstufe${steps(r.min, r.max) === 1 ? '' : 'n'}` +
        ` (${r.max >= 70 ? '70+' : r.max} bis ${r.min}) · Einstellungen werden gemerkt`;
      gmSet(K_MS_SET, r);
      const ok = r.types.length && nAreas;
      bgButtons([
        { label: 'Systematische Suche starten', primary: true, disabled: !ok, fn: () => msRun(Object.assign({ mode: 'system' }, read())) },
        { label: 'Abbrechen', fn: closeBgPopup, focus: !wrap.__init },
      ]);
      wrap.__init = true;
    };
    wrap.addEventListener('change', refresh);
    lo.addEventListener('input', refresh); hi.addEventListener('input', refresh);
    wrap.querySelector('.jaf-ms-all').addEventListener('click', () => { lands.querySelectorAll('input').forEach((i) => { i.checked = true; }); refresh(); });
    wrap.querySelector('.jaf-ms-none').addEventListener('click', () => { lands.querySelectorAll('input').forEach((i) => { i.checked = false; }); refresh(); });
    bgBody(wrap);
    bgPopup().querySelector('.jaf-bg-party').style.display = 'none';
    bgPopup().querySelector('.jaf-bg-step').style.display = 'none';
    refresh();
  }

  // ---- Frame: eine Suche laden und alle Ergebnisse nachladen ----
  async function msFrame() {
    try {
      const first = await waitFor(() => (readCards().length || document.querySelector('.member_search_list') ? true : null), 30000);
      if (!first) throw new Error('Suchseite lädt nicht');
      await waitFor(() => (readCards().length ? true : null), 6000);
      let n = readCards().length, idle = 0, rounds = 0;
      while (idle < CONFIG.SCROLL_IDLE_ROUNDS && rounds < 400) {
        rounds++;
        await nudgeScroll();
        let ok = await waitForGrowth(n, CONFIG.SCROLL_WAIT_MS);
        if (!ok) {
          const more = await waitFor(loadMoreButton, 2000);
          if (more) { await realClick(more); ok = await waitForGrowth(n, 15000); }
        }
        n = readCards().length;
        if (ok) { idle = 0; bgPost({ progress: n }); } else idle++;
      }
      const cards = readCards().map((c) => ({ path: c.path, url: c.url, name: c.name, ages: c.ages, type: c.type, gender: c.gender }));
      bgPost({ cards, final: location.href });
    } catch (e) { bgPost({ error: e.message || String(e) }); }
  }
  // gesehene Profile auch in der Konten-Liste / Vormerkliste festhalten
  function msRecord(cards, search) {
    try { recordAccounts(cards); updateWatch(cards, getLog(), getIgnored(), 'Suche'); upgradeSources(cards, 'Suche'); } catch (e) { /* egal */ }
    const single = gmGet(K_MS_SINGLE, {});
    let ch = false;
    for (const c of cards) {
      if (isCoupleRuleType(c.type) && c.ages.length < 2 && !single[c.path]) { single[c.path] = { name: c.name, url: c.url, ages: c.ages, ts: Date.now(), search }; ch = true; }
    }
    if (ch) gmSet(K_MS_SINGLE, single);
  }
  // Karte einordnen: { kind: 'ignore'|'verify'|'skip', why, item }
  function msClassify(c, ctx) { return classifyCard(c, ctx, 'Suche'); }

  function msAddFailure(f) { const l = gmGet(K_MS_FAIL, []); l.push(Object.assign({ ts: Date.now() }, f)); gmSet(K_MS_FAIL, l.slice(-3000)); }
  function exportMsFailures() {
    const l = gmGet(K_MS_FAIL, []);
    downloadCsv('mitgliedersuche-fehlschlaege', ['Zeitpunkt', 'Suche', 'Name', 'Profil-Link', 'Meldung'], l.map((f) => [fmtTs(f.ts), f.search || '', f.name || '', f.url || '', f.msg || '']));
    return l.length;
  }
  function exportMsSingleCouples() {
    const m = gmGet(K_MS_SINGLE, {});
    downloadCsv('paare-mit-einer-altersangabe', ['Zeitpunkt', 'Name', 'Profil-Link', 'Alter', 'Suche'],
      Object.values(m).map((e) => [fmtTs(e.ts), e.name || '', e.url || '', (e.ages || []).join('+'), e.search || '']));
    return Object.keys(m).length;
  }

  // ---- Lauf (beide Modi) ----
  // emb = true: als Teil des Opa-Scans (Hamburger-Menü) – Popup, Sperre und Abbruch gehören dem Aufrufer; Rückgabe: Statistik
  async function msRun(opt, emb = false) {
    if (!emb) {
      if (bgScan && bgScan.running) return;
      const why = scanBlockedReason();
      bgBody(null);
      bgPopup().querySelector('.jaf-bg-party').style.display = '';
      bgPopup().querySelector('.jaf-bg-step').style.display = '';
      if (why) { bgTitle(opaT('Opa-Scan Mitgliedersuche'), false); bgUi('Scan zurzeit nicht möglich', why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
      if (!(await visGuard())) { closeBgPopup(); return; }
      if (!(await acquireLock(opaT('Opa-Scan Mitgliedersuche')))) { bgUi('Scan zurzeit nicht möglich', 'Ein anderer Tab hat gerade begonnen zu arbeiten.', null, ''); return; }
      bgScan = { stop: false, running: true };
      window.__jafBgBusy = true;
      window.addEventListener('beforeunload', beforeUnloadGuard);
      bgTitle(opaT('Opa-Scan läuft im Hintergrund'), true);
      bgButtons([bgStopButton()]);
    }
    const t0 = Date.now();
    const st = { seen: new Set(), ignored: 0, skipped: 0, failed: 0, single: 0, searches: 0, would: 0, displaced: 0, limitHit: 0 };
    const stats = () => `Profile gesehen: ${st.seen.size.toLocaleString('de-DE')} · ignoriert: ${st.ignored} · übersprungen: ${st.skipped} · fehlgeschlagen: ${st.failed}\n` +
        `Paare mit nur einer Altersangabe: ${st.single}\n${fillText()} · verdrängt: ${st.displaced} · Limit erreicht, nicht gesperrt: ${st.limitHit}` +
        `${CONFIG.DRY_RUN ? '\nTestmodus: es wird nichts ignoriert' : ''}`;
    let testLeft = CONFIG.DRY_RUN ? CONFIG.TEST_MAX_PROFILES : Infinity;
    const singleSeen = new Set();
    // eine Ergebnisliste laden (Frame)
    const load = async (url, onN) => bgFrameG(url, 'jaf-bg-ms' + Date.now().toString(36), onN, 15 * 60000);
    // neue Karten verarbeiten: einordnen, Treffer im Hintergrund ignorieren (bzw. nur zählen)
    const process = async (cards, search, fracOf) => {
      msRecord(cards, search);
      const ctx = { white: whiteList(), blocked: blockedIdMap() };
      const hits = [];
      for (const c of cards) {
        st.seen.add(idOf(c.path) || c.path);
        if (isCoupleRuleType(c.type) && c.ages.length < 2 && !singleSeen.has(c.path)) { singleSeen.add(c.path); st.single++; }
        const r = msClassify(c, ctx);
        if (r.kind === 'skip') st.skipped++; else hits.push(Object.assign(r.item, { _why: r.why }));
      }
      return ignoreHits(hits, search, fracOf);
    };
    const ignoreHits = async (hits, search, fracOf) => {
      let done = 0;
      for (let qi = 0; qi < hits.length && !bgScan.stop; qi++) {
        if (testLeft <= 0) { st.skipped++; continue; }
        const it = hits[qi];
        delete it._why;
        bgUi(null, `${search.step} · ignoriere … ${qi + 1}/${hits.length} · ${it.name}`, fracOf(0.5 + 0.5 * qi / hits.length), stats());
        let r;
        try { r = await blockItem(it, 'Suche', st); }
        catch (err) { r = { result: 'failed', msg: err.message }; if (err.fatal || bgScan.stop) { bgScan.stop = true; bgScan.stopMsg = bgScan.stopMsg || (err.fatal ? err.message : ''); } }
        if (CONFIG.DRY_RUN) testLeft--;
        if (r.result === 'ignored') { st.ignored++; done++; } else if (r.result === 'skipped' || r.result === 'note') st.skipped++;
        else if (r.result === 'limit') { /* gezählt in st.limitHit */ }
        else { st.failed++; msAddFailure({ search: search.label, name: it.name, url: it.url, msg: r.msg || r.result }); }
        bgUi(null, null, null, stats());
        if (qi < hits.length - 1) await sleep(rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS));
      }
      return done;
    };
    let headline = '';
    try {
      bgUi('Ignorierliste', 'Lese die Ignorierliste …', null, null); try { await syncIgnoreList(true); } catch (e) { /* egal */ }
      // fällige Vorgemerkte (inzwischen über der Schwelle) zuerst
      const due = dueFromWatch();
      if (due.length && !bgScan.stop) {
        bgUi('Vorgemerkte', `${due.length} vorgemerkte Mitglieder haben die Altersgrenze überschritten`, 0, stats());
        const dueItems = due.map((d) => Object.assign({}, d, { source: d.source || 'Suche' }));
        await ignoreHits(dueItems, { label: 'Vorgemerkte', step: 'Vorgemerkte' }, () => 0);
      }
      if (opt.mode === 'current') {
        const desc = 'Aktuelle Suche';
        headline = desc;
        bgUi(desc, 'Lade Ergebnisse …', 0, stats());
        const src = msLastApiUrl();
        let cards = src ? await apiMembers(src, (n) => bgUi(null, `lade Ergebnisse (Schnittstelle) … ${n}`, 0.25, null)) : null;
        if (!cards) { const data = await load(location.href, (n) => bgUi(null, `lade Ergebnisse … ${n}`, 0.25, null)); cards = data.cards || []; }
        bgUi(null, `${cards.length} Profile geladen`, 0.5, stats());
        await process(cards, { label: desc, step: `${cards.length} Profile` }, (f) => f);
        st.searches = 1;
      } else {
        const groups = msAreaGroups().filter(([n]) => opt.lands.includes(n));
        const areas = groups.flatMap(([land, list]) => list.map((a) => ({ a, land })));
        // Schwellen über 70: JOYclub kennt nur „70+“ → diese Klasse durchsuchen, das genaue Alter prüft die Einordnung
        const ages = []; for (let x = Math.min(70, opt.max); x >= Math.min(70, opt.min); x--) ages.push(x);
        const w = (age) => (age >= 70 ? 10 : 1);
        const wSum = ages.reduce((s2, x) => s2 + w(x), 0);
        const optSave = { types: opt.types, min: opt.min, max: opt.max, lands: opt.lands };
        for (let ai = opt.startAi || 0; ai < areas.length && !bgScan.stop; ai++) {
          const { a, land } = areas[ai];
          let wDone = 0;
          for (let gi = 0; gi < ages.length; gi++) {
            const age = ages[gi];
            if (ai === opt.startAi && gi < (opt.startAgeIdx || 0)) { wDone += w(age); continue; } // beim Fortsetzen überspringen
            if (bgScan.stop) break;
            gmSet(K_MS_RESUME, { opt: optSave, ai, ageIdx: gi, nAreas: areas.length, city: a[0], age, ts: Date.now() });
            const url = msUrl(a, opt.types, age);
            const ageLbl = age >= 70 ? '70+' : String(age);
            const head = `Alter ${ageLbl} · Umkreis ${ai + 1}/${areas.length}: ${a[0]} (${land})`;
            const base = (ai + wDone / wSum) / areas.length, span = w(age) / wSum / areas.length;
            const maxRuns = age >= 70 ? 200 : 20;
            const seen = new Set();
            let runs = 0;
            while (runs < maxRuns && !bgScan.stop) {
              runs++;
              const step = `Durchlauf ${runs}/${maxRuns}`;
              const fracOf = (f) => { bgBar2(f, `Altersklasse ${ageLbl} in ${a[0]} · Durchlauf ${runs}`); return base + span * (runs === 1 ? f : 1); };
              bgUi(head, `${step} · lade Ergebnisse …`, fracOf(0), stats());
              let data;
              try { data = await load(url, (n) => bgUi(null, `${step} · lade Ergebnisse … ${n}`, fracOf(0.25), null)); }
              catch (err) {
                if (err.fatal || bgScan.stop) { bgScan.stop = true; bgScan.stopMsg = bgScan.stopMsg || (err.fatal ? err.message : ''); break; }
                st.failed++; msAddFailure({ search: `${a[0]} ${ageLbl}`, url, msg: 'Suche nicht ladbar: ' + err.message }); break;
              }
              const fresh = (data.cards || []).filter((c) => { const k = idOf(c.path) || c.path; if (seen.has(k)) return false; seen.add(k); return true; });
              if (!fresh.length) break;
              await process(fresh, { label: `${a[0]} (${land}), Alter ${ageLbl}`, step }, fracOf);
              await sleep(rand(1500, 3000));
            }
            st.searches++;
            wDone += w(age);
            bgUi(null, null, base + span, stats());
          }
        }
        headline = `${areas.length} Umkreise`;
        if (!bgScan.stop) gmSet(K_MS_RESUME, null);
      }
      if (emb) return st;
      const dur = Math.round((Date.now() - t0) / 60000);
      const durTxt = dur >= 60 ? `${Math.floor(dur / 60)}:${pad2(dur % 60)} h` : `${dur} min`;
      bgBar2(null);
      bgTitle(bgScan.stop ? opaT('Opa-Scan abgebrochen') : opaT('Opa-Scan fertig'), false);
      bgUi(bgScan.stop ? (bgScan.stopMsg || 'Abgebrochen') : (opt.mode === 'current' ? 'Aktuelle Suche abgeschlossen' : 'Systematische Suche abgeschlossen'),
        `${headline}${opt.mode === 'system' ? ` · ${st.searches.toLocaleString('de-DE')} Einzelsuchen` : ''} · Dauer ${durTxt}`, bgScan.stop ? null : 1, stats());
    } catch (err) {
      if (emb) { st.error = err.message || String(err); return st; }
      bgTitle(opaT('Opa-Scan nicht möglich'), false);
      bgUi(opaT('Opa-Scan nicht möglich'), err.message || String(err), null, stats());
    } finally {
      if (!emb) {
        window.removeEventListener('beforeunload', beforeUnloadGuard);
        window.__jafBgBusy = false;
        bgScan = null;
        releaseLock();
        const btns = [];
        if (st.single) btns.push({ label: 'Paare mit einer Altersangabe exportieren (CSV)', fn: () => exportMsSingleCouples() });
        if (st.failed) btns.push({ label: 'Fehlschläge exportieren (CSV)', fn: () => exportMsFailures() });
        btns.push({ label: 'Schließen', fn: closeBgPopup, focus: true });
        bgButtons(btns);
      }
    }
    return st;
  }

  // =====================================================================
  // ---------- Ignorierliste synchronisieren (Seite /ignore/) ----------
  // „JOYclub hat Vorrang“: Sperren von JOYclub ins Skript übernehmen (optional Quelle/Datum aus den Notizen)
  // „Script hat Vorrang“: JOYclub an das Skript angleichen (entsperren, nachsperren, optional Notizen angleichen)
  // =====================================================================
  const K_SYNC_LAST = 'jaf_sync_last';
  const K_SYNC_NOTES = 'jaf_sync_notes';
  const SYNC_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;vertical-align:-3px">' +
    '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>';
  // Bezeichnung in einer Notizzeile → Art (Kürzel)
  function labelKind(label) {
    const l = norm(label);
    if (l === 'sugar daddy') return 'sd';
    if (l === 'sugar mom') return 'sm';
    if (l === 'geronto-paar' || l === norm(CONFIG.GROUPS.p.names.one[2])) return 'geronto';
    if (l === 'oma' || l === 'omma' || l === norm(CONFIG.GROUPS.f.names.one[2])) return 'oma';
    return 'opa';
  }
  const KIND_NAMES = { opa: opaT('Opa'), oma: opaT('Oma'), geronto: 'Geronto-Paar', sd: 'Sugar Daddy', sm: 'Sugar Mom' };
  const kindArg = (k) => k;
  // eigene Notizzeile zerlegen: { kind, label, source, ts }
  function parseOwnLine(text) {
    const lines = String(text || '').split(/\r?\n|\s·\s/).map((l) => l.trim()).filter((l) => ownNoteRe().test(l));
    if (!lines.length) return null;
    const labels = noteLabels().map(reEsc).sort((a, b) => b.length - a.length).join('|');
    const m = lines[lines.length - 1].match(new RegExp(`^(${labels})(?:\\s*\\(([^)]*)\\))?\\s+\\S+\\s+am\\s+(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})\\s+um\\s+(\\d{1,2}):(\\d{2})`, 'i'));
    if (!m) return null;
    return { kind: labelKind(m[1]), label: m[1], source: (m[2] || '').trim(), ts: new Date(+m[5], +m[4] - 1, +m[3], +m[6], +m[7]).getTime() };
  }
  // Art laut Skript (Kürzel); ohne Typ unbekannt
  function kindOfEntry(e, type, ages) {
    const t = type || (e && e.type) || '';
    if (!t && !(e && (e.kind || e.reason))) return null;
    return entryKind(Object.assign({}, e || {}, { type: t, ages: (ages && ages.length ? ages : (e && e.ages)) || [] }));
  }
  // ganze Profilnotiz aus einer abgerufenen Profilseite
  function noteFromDoc(doc) {
    const host = [...doc.querySelectorAll('j-setting-textarea')].find((e) => /profilnotiz/.test(norm(e.getAttribute('label') || '')));
    if (!host) return '';
    const ta = host.querySelector('textarea');
    return (host.getAttribute('value') || (ta && (ta.value || ta.textContent)) || host.textContent || '').trim();
  }
  function insertSyncButton() {
    if (!isIgnorePage() || document.querySelector('.jaf-sync-wrap')) return;
    const form = document.getElementById('user_ignore');
    const sperr = form && form.querySelector('j-button.ignore_user, j-button');
    if (!form || !sperr) return;
    const wrap = document.createElement('div');
    wrap.className = 'jaf-sync-wrap';
    wrap.style.cssText = 'margin:8px 0 4px';
    const b = document.createElement('j-button');
    b.className = 'jaf-sync-btn';
    b.setAttribute('variant', 'secondary');
    b.setAttribute('role', '');
    b.setAttribute('type', 'button');
    b.innerHTML = `${SYNC_SVG} Synchronisieren`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); syncOpen(); });
    const status = document.createElement('div');
    status.className = 'jaf-sync-status';
    status.style.cssText = 'font-size:12px;opacity:.85;margin-top:6px';
    const rb = document.createElement('j-button');
    rb.className = 'jaf-repair-btn';
    rb.setAttribute('variant', 'secondary');
    rb.setAttribute('role', '');
    rb.setAttribute('type', 'button');
    rb.style.marginLeft = '10px';
    rb.textContent = 'Ignorierliste reparieren';
    rb.title = 'Vom Skript gesperrte Mitglieder, die JOYclub (z. B. durch Überlauf) entfernt hat, wieder sperren – auf Kosten weniger wichtiger Einträge';
    rb.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); repairOpen(); });
    wrap.appendChild(b); wrap.appendChild(rb); wrap.appendChild(status);
    form.after(wrap);
    const align = () => { try { wrap.style.paddingLeft = Math.max(0, sperr.getBoundingClientRect().left - form.getBoundingClientRect().left) + 'px'; } catch (e) { /* egal */ } };
    align(); setTimeout(align, 800); window.addEventListener('resize', align);
    syncStatus();
  }
  function syncStatus() {
    const el = document.querySelector('.jaf-sync-status');
    if (!el) return;
    const l = gmGet(K_SYNC_LAST, null);
    el.textContent = l ? `Zuletzt synchronisiert: ${fmtTs(l.ts)} (${l.mode}${l.notes ? ', mit Notizen' : ''}) · ${l.n} auf der Ignorierliste${l.summary ? ' · ' + l.summary : ''}` : 'Noch nicht synchronisiert.';
  }
  function syncOpen() {
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgTitle('Ignorierliste synchronisieren', false);
    bgUi('Welche Seite hat Vorrang?', '', null,
      'JOYclub hat Vorrang: Sperren von JOYclub ins Skript übernehmen (z. B. nach Verlust der Skript-Daten).\n' +
      'Script hat Vorrang: JOYclub an das Skript angleichen – entsperren, nachsperren, Notizen korrigieren.' +
      (CONFIG.DRY_RUN ? '\nTestmodus: auf JOYclub wird nichts verändert, nur gezählt.' : ''));
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:12px;cursor:pointer';
    lab.innerHTML = '<input type="checkbox" style="width:18px;height:18px;accent-color:#c71b1b;margin:0"> <span>Notizen abgleichen</span>';
    const cb = lab.querySelector('input');
    cb.checked = !!gmGet(K_SYNC_NOTES, false);
    cb.addEventListener('change', () => gmSet(K_SYNC_NOTES, cb.checked));
    bgBody(lab);
    bgButtons([
      { label: 'JOYclub hat Vorrang', fn: () => runSync('joyclub', cb.checked) },
      { label: 'Script hat Vorrang', fn: () => runSync('script', cb.checked) },
      { label: 'Abbrechen', fn: closeBgPopup, focus: true },
    ]);
  }
  async function runSync(mode, notes) {
    if (bgScan && bgScan.running) return;
    bgBody(null);
    const why = scanBlockedReason();
    if (why) { bgUi('Synchronisieren zurzeit nicht möglich', why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
    if ((notes || mode === 'script') && !(await visGuard())) { closeBgPopup(); return; }
    if (!(await acquireLock('Ignorierliste synchronisieren'))) { bgUi('Synchronisieren zurzeit nicht möglich', 'Ein anderer Tab arbeitet gerade.', null, ''); return; }
    const modeName = mode === 'joyclub' ? 'JOYclub hat Vorrang' : 'Script hat Vorrang';
    bgScan = { stop: false, running: true };
    window.__jafBgBusy = true;
    window.addEventListener('beforeunload', beforeUnloadGuard);
    bgTitle(`Synchronisiere (${modeName})`, true);
    bgButtons([bgStopButton()]);
    const t0 = Date.now();
    const st = { n: 0, notesRead: 0, added: 0, srcSet: 0, markedUnblocked: 0, unblocked: 0, reblocked: 0, noteFixed: 0, cleaned: 0, failed: 0, whiteBlocked: [], plannedOnly: 0 };
    const stats = () => [
      `Eingelesen: ${st.n} Einträge${notes ? `, ${st.notesRead} Notizen` : ''}`,
      mode === 'joyclub'
        ? `Im Skript ergänzt: ${st.added} · Quelle übernommen: ${st.srcSet} · im Skript entsperrt: ${st.markedUnblocked}`
        : `Entsperrt: ${st.unblocked} · nachgesperrt: ${st.reblocked} · Notizen angeglichen: ${st.noteFixed} · eigene Zeilen entfernt: ${st.cleaned}`,
      `fehlgeschlagen: ${st.failed}${CONFIG.DRY_RUN ? ` · Testmodus: ${st.plannedOnly} Änderungen nur gezählt` : ''}`,
    ].join('\n');
    let shown = 0;
    const show = (f) => { shown = Math.max(shown, Math.min(1, f)); return shown; };
    try {
      // 1. Einlesen: Ignorierliste (+ Profilnotizen)
      bgUi('Einlesen', 'Lade die Ignorierliste …', show(0.01), stats());
      const doc = await fetchDoc(ignoreUrl());
      const jc = parseIgnoreList(doc);
      saveIgnored(jc);
      const jcList = Object.entries(jc);
      st.n = jcList.length;
      const readUnits = 1 + (notes ? jcList.length : 0);
      const info = {}; // path → { note, own, type, ages }
      if (notes) {
        for (let i = 0; i < jcList.length && !bgScan.stop; i++) {
          const [path, e] = jcList[i];
          bgUi(null, `Lese Profilnotizen … ${i + 1}/${jcList.length}: ${e.name}`, show(0.5 * (1 + i) / readUnits), null);
          try {
            const d = await fetchDoc(e.url || location.origin + path);
            const note = noteFromDoc(d);
            const pi = parseProfileDoc(d);
            info[path] = { note, own: parseOwnLine(note), type: pi ? pi.type : '', ages: pi ? pi.ages : [] };
            if (pi) recordAccounts([{ path, name: e.name, ages: pi.ages, type: pi.type, signs: pi.signs }]);
            st.notesRead++;
          } catch (err) { if (err.fatal) throw err; st.failed++; }
          bgUi(null, null, null, stats());
          await sleep(rand(300, 800));
        }
      }
      if (bgScan.stop) throw Object.assign(new Error('Abgebrochen.'), { stopped: true });
      const l = getLog();
      const byId = {}; for (const k of Object.keys(l)) { const id = idOf(k); if (id) byId[id] = k; }
      const jcIds = new Set(jcList.map(([p, e]) => String(e.id || idOf(p))));
      const white = whiteList();
      const changes = [];
      if (mode === 'joyclub') {
        // im Skript gesperrt, auf JOYclub nicht → im Skript entsperren
        for (const [k, e] of Object.entries(l)) {
          if (e.unblocked || jcIds.has(String(idOf(k)))) continue;
          e.unblocked = { ts: Date.now(), reason: 'nicht auf der JOYclub-Ignorierliste (Sync)' }; st.markedUnblocked++;
        }
        for (const [path, e] of jcList) {
          const k = (l[path] && path) || byId[e.id || idOf(path)];
          const own = info[path] && info[path].own;
          const pi = info[path] || {};
          if (isWhiteMember({ name: e.name, path }, white)) st.whiteBlocked.push(e.name);
          if (!k || l[k].unblocked) {
            const old = (k && l[k]) || {};
            const x = Object.assign({}, old, { name: e.name || old.name, url: e.url || old.url, ages: (pi.ages && pi.ages.length ? pi.ages : old.ages) || [],
              type: pi.type || old.type || '', source: (own && own.source) || old.source || '', method: 'JOYclub-Ignorierliste (Sync)',
              ts: (own && own.ts) || Date.now() });
            delete x.unblocked;
            if (own) { x.kind = own.kind; if (KIND_REASON[own.kind] !== 'Alter') x.reason = KIND_REASON[own.kind]; }
            l[k || path] = x;
            st.added++;
          } else {
            const x = l[k];
            if (own && own.source && own.source !== x.source) { x.source = own.source; st.srcSet++; }
            if (own && !x.ts) x.ts = own.ts;
            if (!x.type && pi.type) x.type = pi.type;
            if ((!x.ages || !x.ages.length) && pi.ages && pi.ages.length) x.ages = pi.ages;
          }
        }
        gmSet(K_LOG, l);
        show(1);
      } else {
        // a) auf JOYclub gesperrt, aber dem Skript nicht als gesperrt bekannt oder auf der Whitelist → entsperren
        for (const [path, e] of jcList) {
          const k = (l[path] && path) || byId[e.id || idOf(path)];
          const known = k && !l[k].unblocked;
          const wl = isWhiteMember({ name: e.name, path }, white);
          const pi = info[path] || {};
          if (!known || wl) {
            changes.push({ op: 'unblock', path, e, k, wl, clean: notes && (wl || (pi.own != null)) });
          } else if (notes) {
            // c) Notiz abgleichen (Art + Quelle, Datum egal)
            const x = l[k];
            const kind = kindOfEntry(x, pi.type, pi.ages);
            const source = x.source || (pi.own && pi.own.source) || 'Sync';
            const ts = x.ts || (pi.own && pi.own.ts) || Date.now();
            if (!x.source) x.source = source;
            if (!x.ts) x.ts = ts;
            if (!x.type && pi.type) x.type = pi.type;
            if ((!x.ages || !x.ages.length) && pi.ages && pi.ages.length) x.ages = pi.ages;
            if (!pi.own || !kind || pi.own.kind !== kind || pi.own.label !== kindLabel(kind) || pi.own.source !== source) changes.push({ op: 'fix', path, e, k, kind, source, ts });
          }
        }
        // b) im Skript gesperrt, auf JOYclub nicht → nachsperren (Whitelist geht vor: dann im Skript entsperren)
        for (const [k, x] of Object.entries(l)) {
          if (x.unblocked || jcIds.has(String(idOf(k)))) continue;
          if (isWhiteMember({ name: x.name, path: k }, white)) { x.unblocked = { ts: Date.now(), reason: 'Whitelist (Sync)' }; continue; }
          if (!CONFIG.PROFILE_PATH_RE.test(k)) continue;
          changes.push({ op: 'reblock', path: k, e: { name: x.name, url: x.url || location.origin + k, id: idOf(k) }, k,
            kind: kindOfEntry(x), source: x.source || 'Sync', ts: x.ts || Date.now() });
        }
        gmSet(K_LOG, l);
        // 2. Änderungen
        const base = show(readUnits / (readUnits + 3 * changes.length));
        for (let ci = 0; ci < changes.length && !bgScan.stop; ci++) {
          const c = changes[ci];
          const label = c.op === 'unblock' ? `Entsperren${c.clean ? ' + Notiz bereinigen' : ''}` : c.op === 'fix' ? `Notiz angleichen (entsperren, „${c.kind ? kindLabel(c.kind) : '…'} (${c.source})“, wieder sperren)` : `Nachsperren mit Notiz „${c.kind ? kindLabel(c.kind) : '…'} (${c.source})“`;
          bgUi(`Änderungen ${ci + 1}/${changes.length}`, `${label}: ${c.e.name}`, show(base + (1 - base) * ci / Math.max(1, changes.length)), stats());
          if (CONFIG.DRY_RUN) { st.plannedOnly++; continue; }
          try {
            if (c.op === 'unblock' || c.op === 'fix') {
              const r = await bgUnignore(c.e.id || idOf(c.path));
              if (!r.ok) { st.failed++; continue; }
              if (c.op === 'unblock') {
                st.unblocked++;
                if (c.k && !getLog()[c.k].unblocked) markUnblocked(c.k, c.e, c.wl ? 'Whitelist (Sync)' : 'unbekannt (Sync)');
                if (c.clean) {
                  const item = c.wl ? { path: c.path, url: c.e.url, name: c.e.name, action: 'note', line: `Whitelist: ${whiteReason(c.e.name) || 'Whitelist'}` }
                    : { path: c.path, url: c.e.url, name: c.e.name, action: 'clean' };
                  const r2 = await syncAct(item);
                  if (r2.result === 'note') st.cleaned++; else st.failed++;
                }
                continue;
              }
            }
            // fix / reblock: Notiz ersetzen und sperren
            const item = { path: c.path, url: c.e.url, name: c.e.name, action: 'sync', block: true, source: c.source, ts: c.ts,
              kind: c.kind ? kindArg(c.kind) : null };
            if (item.kind === null) delete item.kind;
            const r3 = await syncAct(item);
            if (r3.result === 'ignored') {
              if (c.op === 'fix') st.noteFixed++; else st.reblocked++;
              const L = getLog(); const x = L[c.k];
              if (x) {
                if (r3.type && !x.type) x.type = r3.type;
                if (r3.ages && r3.ages.length && (!x.ages || !x.ages.length)) x.ages = r3.ages;
                if (!x.kind && r3.type) { const jk = judge({ type: r3.type, ages: r3.ages || [] }, x.source || 'Sync').kind; if (jk) { x.kind = jk; if (KIND_REASON[jk] !== 'Alter') x.reason = KIND_REASON[jk]; } }
                delete x.unblocked; gmSet(K_LOG, L);
              }
            } else st.failed++;
          } catch (err) { if (err.fatal) throw err; st.failed++; }
          bgUi(null, null, null, stats());
          await sleep(rand(1500, 3000));
        }
      }
      const dur = Math.max(1, Math.round((Date.now() - t0) / 60000));
      const summary = mode === 'joyclub' ? `ergänzt ${st.added}, Quelle ${st.srcSet}, entsperrt ${st.markedUnblocked}`
        : `entsperrt ${st.unblocked}, nachgesperrt ${st.reblocked}, Notizen ${st.noteFixed}`;
      if (!bgScan.stop) gmSet(K_SYNC_LAST, { ts: Date.now(), mode: modeName, notes, n: st.n, summary });
      bgTitle(bgScan.stop ? 'Synchronisierung abgebrochen' : 'Synchronisierung fertig', false);
      bgUi(`${modeName}${notes ? ' · mit Notizen' : ''}`, `${st.n} auf der Ignorierliste · Dauer ${dur} min` +
        (st.whiteBlocked.length ? `\nAuf der Whitelist, aber gesperrt (bleiben gesperrt): ${st.whiteBlocked.slice(0, 15).join(', ')}${st.whiteBlocked.length > 15 ? ' …' : ''}` : ''),
      bgScan.stop ? null : show(1), stats());
    } catch (err) {
      bgTitle(err.stopped ? 'Synchronisierung abgebrochen' : 'Synchronisierung nicht möglich', false);
      bgUi(err.stopped ? 'Abgebrochen' : 'Fehler', err.message || String(err), null, stats());
    } finally {
      window.removeEventListener('beforeunload', beforeUnloadGuard);
      window.__jafBgBusy = false;
      bgScan = null;
      releaseLock();
      bgButtons([{ label: 'Schließen', fn: () => { closeBgPopup(); syncStatus(); }, focus: true }]);
      syncStatus();
    }
  }
  // ein Profil im Hintergrund bearbeiten (Notiz/Sperren) – wie im Party-Scan
  async function syncAct(item) { return actJob(item, item.source || 'Sync'); }



  // =====================================================================
  // ---------- „Profilbesuche“ (/my_joy/visitors/) und „Mögen mich“ (/my_joy/voting/top/) ----------
  // Karten wie in der Mitgliedersuche (<j-member-card>), Profil-Link und Datums-Abzeichen im Shadow DOM.
  // Datum: „Heute“, „Gestern“, Wochentag (2–6 Tage zurück) oder „TT.MM.“ (ohne Jahr; Zukunft → Vorjahr).
  // =====================================================================
  const MYJOY = {
    '/my_joy/visitors': { src: 'Besucher', label: 'Profilbesucher', tab: 'Profilbesuche', path: '/my_joy/visitors/' },
    '/my_joy/voting/top': { src: 'Likes', label: 'Interaktionen', tab: 'Mögen mich', path: '/my_joy/voting/top/' },
    '/clubmail': { src: 'Likes', key: 'ClubMail', via: 'ClubMail', label: 'Interaktionen (ClubMail)', tab: 'ClubMail', path: '/clubmail/' },
  };
  Object.values(MYJOY).forEach((x) => { if (!x.key) x.key = x.src; });
  const MYJOY_BY_SRC = Object.fromEntries(Object.values(MYJOY).map((x) => [x.key, x]));
  // ClubMail-Übersicht: jede Unterhaltung mit einem Mitglied = Interaktion (Nachrichten werden nicht gelesen)
  function cmDay(txt, now = new Date()) {
    const t = String(txt || '').trim();
    if (/^\d{1,2}:\d{2}$/.test(t)) return isoDay(now);
    const m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}` : null;
  }
  function readClubMailItems(root = document) {
    const out = [];
    const own = ownIds();
    const acc = getAccounts();
    for (const it of root.querySelectorAll('[data-e2e="conversation-list-entry"]')) {
      const av = it.querySelector('j-avatar-image');
      const href = (av && av.getAttribute('href')) || '';
      let path = '';
      try { path = href ? cleanPath(new URL(href, location.origin).pathname).replace(/^\/my\//, '/profile/') : ''; } catch (e) { path = ''; }
      if (!/^\/profile\/\d+\./.test(path)) continue; // Partys, Clubs, JOY-Team, gelöschte Konten
      const id = idOf(path);
      if (own.has(id)) continue;
      const gi = it.querySelector('j-gender-icon[universal-gender]');
      const gender = gi ? gi.getAttribute('universal-gender') : '';
      const meta = it.querySelector('.cm-conversation-list-item__meta');
      const dayTxt = meta ? (meta.childNodes[0] && meta.childNodes[0].nodeType === 3 ? meta.childNodes[0].nodeValue : meta.textContent).trim() : '';
      out.push({ card: av, path, url: location.origin + path, id, name: (av && av.getAttribute('title')) || '', ages: agesNow(path, acc), gender, type: gender ? typeFromGender(gender) : '', dayTxt, day: cmDay(dayTxt) });
    }
    return out;
  }
  const myJoyPage = () => MYJOY[cleanPath(location.pathname)] || null;
  const K_MJ = 'jaf_myjoy'; // { Besucher: { lastDay, ts }, Likes: { lastDay, ts } } – letzter vollständiger Scan
  const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
  function badgeDay(txt, now = new Date()) {
    const t = norm(txt);
    const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    if (!t) return null;
    if (t === 'heute') return isoDay(new Date(y, mo, d));
    if (t === 'gestern') return isoDay(new Date(y, mo, d - 1));
    const wd = WEEKDAYS.indexOf(t);
    if (wd >= 0) {
      const back = (now.getDay() - wd + 7) % 7;
      if (back < 2) { if (CONFIG.DEBUG) console.log('[Alter-Filter] unplausibler Wochentag', txt); return null; }
      return isoDay(new Date(y, mo, d - back));
    }
    const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/);
    if (m) {
      let dt = new Date(m[3] ? +m[3] : y, +m[2] - 1, +m[1]);
      if (!m[3] && dt > new Date(y, mo, d)) dt = new Date(y - 1, +m[2] - 1, +m[1]);
      return isoDay(dt);
    }
    if (CONFIG.DEBUG) console.log('[Alter-Filter] unbekannte Datumsangabe', txt);
    return null;
  }
  function readMyJoyCards(root = document) {
    if (/^\/clubmail\/?$/.test(location.pathname)) return readClubMailItems(root);
    const out = [];
    const seen = new Set();
    for (const card of root.querySelectorAll('section.my-joy-visits-view j-member-card, .my_joy_view j-member-card')) {
      if (seen.has(card)) continue;
      seen.add(card);
      const sr = card.shadowRoot;
      const a = sr && sr.querySelector('a[href]');
      const href = (a && a.getAttribute('href')) || card.getAttribute('href') || '';
      let path = '';
      try { path = href ? cleanPath(new URL(href, location.origin).pathname).replace(/^\/my\//, '/profile/') : ''; } catch (e) { path = ''; }
      const badge = sr && (sr.querySelector('.badge-container-right j-badge[content]') || sr.querySelector('.badge-container j-badge[content]'));
      const dayTxt = badge ? badge.getAttribute('content') || '' : '';
      const gender = card.getAttribute('universal-gender') || '';
      out.push({
        card, path, url: path ? location.origin + path : '', id: idOf(path), name: card.getAttribute('user-name') || '',
        ages: [card.getAttribute('age'), card.getAttribute('age2')].map(Number).filter((n) => n >= 18 && n <= 120),
        gender, type: gender ? cardType(card) : '', dayTxt, day: badgeDay(dayTxt),
      });
    }
    return out;
  }
  // Karten markieren wie Gästelisten (Farbe nach Alter, rotes X bei Ignorierten, Popup per Klick)
  function decorateMyJoy() {
    const pg = myJoyPage();
    if (!pg) return;
    const cards = readMyJoyCards();
    if (!cards.length) return;
    const ctx = { white: whiteList(), acc: getAccounts(), blocked: blockedIdMap() };
    // schon beim Ansehen: „zuletzt gesehen“ = Datum am Abzeichen (bekannte Mitglieder)
    const sigKey = `${pg.src}|${cards.length}`;
    if (window.__jafMjSeen !== sigKey) {
      window.__jafMjSeen = sigKey;
      try { recordAccounts(cards.filter((c) => c.path && c.ages.length)); noteSighting(cards.filter((c) => c.path && c.day), pg.src); } catch (e) { /* egal */ }
      try { piNote(cards.filter((c) => c.path && c.gender).map((c) => ({ id: c.id || idOf(c.path), name: c.name, type: c.type, ages: c.ages, el: c.card })), pg.src === 'Likes'); } catch (e) { /* egal */ }
    }
    for (const c of cards) {
      if (!c.gender || !c.path) continue; // Clubs, Veranstalter usw. bleiben ungefärbt
      const g = Object.assign({}, c);
      const st = guestStyle(g, ctx, pg.src);
      const host = c.card;
      const cell = host.parentElement || host;
      const blk = g.id && ctx.blocked.get(g.id);
      const sig = [st.none, st.color, st.dashed, st.txt, !!blk, g.ages.join('+'), showX(st)].join('|');
      if (host.__jafSig !== sig) {
        host.__jafSig = sig;
        if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
        let b = cell.querySelector(':scope > .jaf-badge');
        if (st.none) { host.style.outline = ''; if (b) b.remove(); } else {
          host.style.outline = `${st.dashed ? 2 : 3}px ${st.dashed ? 'dashed' : 'solid'} ${st.color}`;
          host.style.outlineOffset = '-1px';
          if (!b) { b = document.createElement('div'); b.className = 'jaf-badge'; cell.appendChild(b); }
          const extra = [g.ages.join('+') || '?', st.color === COLORS.red ? st.txt : ''].filter(Boolean).join(' · ');
          b.textContent = extra + (blk ? ' · ignoriert' : '');
          b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;font:bold 11px system-ui;padding:2px 6px;border-radius:3px;pointer-events:none;' +
            `background:${st.color};color:${st.fg || (st.color === COLORS.white ? '#000' : '#fff')}`;
        }
        const x = cell.querySelector(':scope > .jaf-x');
        const wantX = blk && showX(st);
        if (wantX && !x) cell.insertAdjacentHTML('beforeend', `<div class="jaf-x" style="position:absolute;inset:0;z-index:4;pointer-events:none">${X_SVG}</div>`);
        if (!wantX && x) x.remove();
      }
      if (!host.__jafBound) {
        host.__jafBound = true;
        host.addEventListener('click', (ev) => {
          const now = blockedIdMap().get(idOf(c.path));
          if (!now) return;
          ev.preventDefault(); ev.stopPropagation();
          ignoredPopup(g, now, { name: pg.label, date: fmtDay(Date.now()), kind: pg.src });
          setTimeout(() => { host.__jafSig = ''; }, 3000);
        }, true);
      }
    }
  }
  function insertMyJoyButton() {
    const pg = myJoyPage();
    document.querySelectorAll('.jaf-mj-btn').forEach((b) => { if (!pg || b.dataset.src !== pg.key) b.remove(); });
    if (!pg || document.querySelector('.jaf-mj-btn')) return;
    const box = pg.key === 'ClubMail' ? document.querySelector('.cm-sidebar__header-options') : document.querySelector('.header-options') || document.querySelector('[slot="options"]');
    if (!box) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.title = opaT('Opa-Scan starten');
    b.dataset.src = pg.key;
    b.className = 'jaf-mj-btn btn-flat-special-light btn btn-default';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap';
    b.innerHTML = `<svg viewBox="0 0 640 1280" width="9" height="16" style="fill:currentColor;vertical-align:-2px" aria-hidden="true">` +
      opaT(`${nickG()}</svg> <span class="btn-text">Opa-Scan starten</span>`);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); mjOpen(pg.key); });
    if (pg.key === 'ClubMail') { box.prepend(b); cmBtnLayout(); } else box.appendChild(b);
  }
  // ClubMail: Knopf waagerecht mittig zwischen Überschrift „ClubMail“ und Filter-Knopf; bei Platzmangel nur das Icon
  function cmBtnLayout() {
    const b = document.querySelector('.jaf-mj-btn[data-src="ClubMail"]');
    if (!b) return;
    const box = b.parentElement, hdr = box && box.closest('j-page-header');
    const filt = box && (box.querySelector('.conversation-filter__filter-icon') || [...box.children].find((x) => x !== b));
    const h1 = hdr && hdr.shadowRoot && hdr.shadowRoot.querySelector('h1');
    if (!filt || !h1) { b.style.marginRight = ''; return; }
    let titleRight;
    try { const r = document.createRange(); r.selectNodeContents(h1); titleRight = r.getBoundingClientRect().right; } catch (e) { titleRight = h1.getBoundingClientRect().right; }
    const txt = b.querySelector('.btn-text');
    const fit = (iconOnly) => {
      if (txt) txt.style.display = iconOnly ? 'none' : '';
      b.style.marginRight = '0px';
      const gap = filt.getBoundingClientRect().left - titleRight, w = b.getBoundingClientRect().width;
      return { gap, w };
    };
    let { gap, w } = fit(false);
    if (gap < w + 24) ({ gap, w } = fit(true));
    b.style.marginRight = `${Math.max(4, Math.floor((gap - w) / 2))}px`;
    if (!b.__jafRO && typeof ResizeObserver === 'function' && hdr) {
      b.__jafRO = new ResizeObserver(() => { try { cmBtnLayout(); } catch (e) { /* egal */ } });
      b.__jafRO.observe(hdr);
    }
  }
  function myJoyTick() {
    try { insertMyJoyButton(); cmBtnLayout(); decorateMyJoy(); } catch (e) { /* weiter */ }
  }
  setInterval(myJoyTick, 1500);

  // IM Frame: Liste nachladen, bis das Datum vor dem letzten vollständigen Scan liegt bzw. die Obergrenze erreicht ist
  async function mjFrame() {
    try {
      const parts = (window.name || '').split('-'); // jaf-bg-mj-<src>-<YYYYMMDD|0>-<max>-<rnd>
      const stopDay = parts[4] && parts[4] !== '0' ? `${parts[4].slice(0, 4)}-${parts[4].slice(4, 6)}-${parts[4].slice(6, 8)}` : '';
      const max = +parts[5] || CONFIG.MYJOY_FIRST_MAX;
      const ok = await waitFor(() => (readMyJoyCards().length || document.querySelector('section.my-joy-visits-view, .cm-conversation-list') ? true : null), 30000);
      if (!ok) throw new Error('Seite lädt nicht');
      await waitFor(() => (readMyJoyCards().length ? true : null), 8000);
      let n = readMyJoyCards().length, idle = 0;
      const enough = () => {
        const c = readMyJoyCards();
        if (c.length >= max) return true;
        if (!stopDay) return false;
        const last = c.filter((x) => x.day).pop();
        return !!(last && last.day < stopDay);
      };
      for (let r = 0; r < 600 && idle < 3 && !enough(); r++) {
        const items = readMyJoyCards();
        if (items.length) items[items.length - 1].card.scrollIntoView({ block: 'end' });
        window.scrollTo(0, document.documentElement.scrollHeight);
        window.dispatchEvent(new Event('scroll'));
        const grew = await waitFor(() => (readMyJoyCards().length > n ? true : null), 8000);
        if (!grew) {
          const more = [...document.querySelectorAll('.load_more_container j-button, .load_more_container button, j-button, button')]
            .find((e) => reallyVisible(e) && /mehr (laden|anzeigen|ergebnisse)/i.test(e.textContent || ''));
          if (more) { await realClick(more); await waitFor(() => (readMyJoyCards().length > n ? true : null), 10000); }
        }
        const now = readMyJoyCards().length;
        if (now > n) { idle = 0; n = now; bgPost({ progress: n }); await sleep(rand(400, 900)); } else idle++;
      }
      const cards = readMyJoyCards().slice(0, Math.max(max, 1)).map((c) => ({ path: c.path, url: c.url, id: c.id, name: c.name, ages: c.ages, gender: c.gender, type: c.type, day: c.day, dayTxt: c.dayTxt }));
      bgPost({ cards });
    } catch (e) { bgPost({ error: e.message || String(e) }); }
  }
  // Karte einordnen: { kind: 'ignore'|'verify'|'skip', why, item }
  function mjClassify(c, ctx, src) {
    if (!c.gender) return { kind: 'skip', why: 'kein Mitgliederprofil (Club/Business)' };
    if (ownIds().has(String(c.id || idOf(c.path)))) return { kind: 'skip', why: 'eigenes Konto' };
    return classifyCard(Object.assign({}, c), ctx, src);
  }

  // Start-Popup („Jetzt scannen …“) wie beim Party-Scan
  function mjOpen(src) {
    const pg = MYJOY_BY_SRC[src];
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgScan = null;
    bgBar2(null);
    bgBody(null);
    const last = (gmGet(K_MJ, {}) || {})[src];
    bgTitle(opaT(`Opa-Scan ${pg.label}`), false);
    bgUi(`„${pg.tab}“ scannen`, last ? `Letzter vollständiger Scan: ${deDay(last.lastDay)} – geprüft werden alle Einträge ab diesem Tag.`
      : `Noch nie vollständig gescannt – geprüft werden höchstens die neuesten ${CONFIG.MYJOY_FIRST_MAX.toLocaleString('de-DE')} Einträge.`, null,
    (CONFIG.DRY_RUN ? 'Testmodus: es wird nichts ignoriert.\n' : '') +
      'Treffer (Opas, Sugar Daddys, Geronto-Paare) werden mit Notiz ignoriert. Die Liste wird im Hintergrund nachgeladen.\nDiese Seite muss während des Scans geöffnet bleiben.');
    bgButtons([
      { label: 'Jetzt scannen …', primary: true, fn: () => mjRun(src) },
      { label: 'Schließen', fn: closeBgPopup, focus: true },
    ]);
  }
  // emb = true: als Teil des Opa-Scans (Hamburger-Menü). Rückgabe: Statistik
  async function mjRun(key, emb = false) {
    const pg = MYJOY_BY_SRC[key];
    const src = pg.src;
    if (!emb) {
      if (bgScan && bgScan.running) return;
      const why = scanBlockedReason();
      if (why) { bgUi('Scan zurzeit nicht möglich', why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
      if (!(await visGuard())) { closeBgPopup(); return; }
      if (!(await acquireLock(opaT(`Opa-Scan ${pg.label}`)))) { bgUi('Scan zurzeit nicht möglich', 'Ein anderer Tab hat gerade begonnen zu arbeiten.', null, ''); return; }
      bgScan = { stop: false, running: true };
      window.__jafBgBusy = true;
      window.addEventListener('beforeunload', beforeUnloadGuard);
      bgTitle(opaT('Opa-Scan läuft im Hintergrund'), true);
      bgButtons([bgStopButton()]);
    }
    const st = { checked: 0, ignored: 0, skipped: 0, failed: 0, displaced: 0, limitHit: 0 };
    const stats = () => `Geprüft: ${st.checked} · ignoriert: ${st.ignored} · übersprungen: ${st.skipped} · fehlgeschlagen: ${st.failed}\n` +
      `${fillText()} · verdrängt: ${st.displaced} · Limit erreicht, nicht gesperrt: ${st.limitHit}${CONFIG.DRY_RUN ? '\nTestmodus: es wird nichts ignoriert' : ''}`;
    let complete = false;
    const today = isoDay(new Date());
    try {
      bgUi(`„${pg.tab}“`, 'Lese die Ignorierliste …', 0, stats());
      try { await syncIgnoreList(true); } catch (e) { if (e.fatal) throw e; }
      const last = (gmGet(K_MJ, {}) || {})[key];
      const stopDay = last && last.lastDay ? last.lastDay : '';
      const max = stopDay ? 100000 : CONFIG.MYJOY_FIRST_MAX;
      bgUi(null, 'Lade die Liste im Hintergrund …', 0.02, stats());
      const fname = `jaf-bg-mj-${key}-${stopDay ? stopDay.replace(/-/g, '') : '0'}-${max}-${Date.now().toString(36)}`;
      let data = null;
      if (key === 'ClubMail') { try { const l = await apiClubMail(max, stopDay); if (l) data = { cards: l }; } catch (e) { data = null; } }
      if (!data) data = await bgFrameG(location.origin + pg.path, fname, (n) => bgUi(null, `Lade die Liste … ${n} Einträge`, 0.05, null), 30 * 60000);
      let cards = (data.cards || []).filter((c) => !stopDay || !c.day || c.day >= stopDay);
      bgUi(null, `${cards.length} Einträge geladen`, 0.1, stats());
      recordAccounts(cards.filter((c) => c.path && c.ages.length));
      noteSighting(cards.filter((c) => c.path && c.day), src);
      updateWatch(cards.filter((c) => c.path && c.ages.length), getLog(), getIgnored(), src);
      const ctx = { white: whiteList(), blocked: blockedIdMap() };
      const uniq = new Map();
      for (const c of cards) if (c.path && !uniq.has(c.path)) uniq.set(c.path, c);
      cards = [...uniq.values()];
      let hits = [];
      for (const c of cards) {
        st.checked++;
        const r = mjClassify(c, ctx, src);
        if (r.kind === 'skip') st.skipped++; else hits.push(pg.via ? Object.assign(r.item, { via: pg.via }) : r.item);
      }
      const due = dueFromWatch();
      if (due.length) { const inDue = new Set(due.map((d) => d.path)); hits = due.map((d) => Object.assign({}, d, { source: d.source || src })).concat(hits.filter((h) => !inDue.has(h.path))); }
      const limit = CONFIG.DRY_RUN ? Math.min(CONFIG.TEST_MAX_PROFILES, CONFIG.MAX_PER_RUN) : CONFIG.MAX_PER_RUN;
      const queue = hits.slice(0, limit);
      complete = hits.length <= limit;
      for (let qi = 0; qi < queue.length && !bgScan.stop; qi++) {
        const it = queue[qi];
        bgUi(null, `Profil ${qi + 1}/${queue.length}: ${it.name} …`, 0.1 + 0.9 * qi / Math.max(1, queue.length), stats());
        let r;
        try { r = await blockItem(it, src, st); }
        catch (err) { r = { result: 'failed', msg: err.message }; if (err.fatal || bgScan.stop) { bgScan.stop = true; bgScan.stopMsg = bgScan.stopMsg || (err.fatal ? err.message : ''); } }
        if (r.result === 'ignored') st.ignored++;
        else if (r.result === 'skipped' || r.result === 'note') st.skipped++;
        else if (r.result === 'limit') complete = false;
        else { st.failed++; complete = false; }
        bgUi(null, `${it.name}: ${r.msg || r.result}`, null, stats());
        if (qi < queue.length - 1) await sleep(rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS));
      }
      if (bgScan.stop) complete = false;
      if (complete && !CONFIG.DRY_RUN) { const m = gmGet(K_MJ, {}) || {}; m[key] = { lastDay: today, ts: Date.now() }; gmSet(K_MJ, m); }
      if (emb) return st;
      bgTitle(bgScan.stop ? opaT('Opa-Scan abgebrochen') : opaT('Opa-Scan fertig'), false);
      bgUi(bgScan.stop ? (bgScan.stopMsg || 'Abgebrochen') : `„${pg.tab}“ fertig`, complete ? 'Alle Einträge bearbeitet.' : 'Nicht alles bearbeitet – der nächste Scan prüft diese Einträge erneut.', bgScan.stop ? null : 1, stats());
    } catch (err) {
      if (emb) { st.error = err.message || String(err); return st; }
      bgTitle(opaT('Opa-Scan nicht möglich'), false);
      bgUi(opaT('Opa-Scan nicht möglich'), err.message || String(err), null, stats());
    } finally {
      if (!emb) {
        window.removeEventListener('beforeunload', beforeUnloadGuard);
        window.__jafBgBusy = false;
        bgScan = null;
        releaseLock();
        bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]);
      }
    }
    return st;
  }

  // =====================================================================
  // ---------- Hintergrund-Frames für den Opa-Scan aus dem Hamburger-Menü ----------
  // =====================================================================
  // IM Frame: eigene Eventanmeldungen („Dates & Events“) komplett nachladen
  async function regFrame() {
    try {
      await waitFor(() => document.querySelector('button.button_past_events, .card-list-ui-list-item.event-card-ui, .jc-infinite-scroll'), 30000);
      await sleep(800);
      const list = await loadAllRegistrations((n) => bgPost({ progress: n }));
      bgPost({ list: list.map((e) => ({ id: e.id, url: e.url, date: e.date, dayTs: e.dayTs, location: e.location, name: e.name, slugName: e.slugName, status: e.status })) });
    } catch (e) { bgPost({ error: e.message || String(e) }); }
  }
  // IM Frame: „Alle meine Gruppen“ aufklappen und sammeln
  async function grpFrame() {
    try {
      await waitFor(() => readMyGroups().length, 30000);
      await expandMyGroups();
      bgPost({ groups: readMyGroups() });
    } catch (e) { bgPost({ error: e.message || String(e) }); }
  }

  // ---- Gruppen im Hintergrund (für den Opa-Scan aus dem Hamburger-Menü) ----
  async function grpRun() {
    const st = { checked: 0, ignored: 0, skipped: 0, failed: 0, displaced: 0, limitHit: 0, groups: 0, mods: 0, unblocked: 0, notes: 0 };
    const stats = () => `Gruppen: ${st.groups} · Mitglieder geprüft: ${st.checked} · ignoriert: ${st.ignored} · übersprungen: ${st.skipped} · fehlgeschlagen: ${st.failed}\n` +
      `Moderatoren: ${st.mods} (entsperrt: ${st.unblocked}) · ${fillText()} · verdrängt: ${st.displaced} · Limit erreicht: ${st.limitHit}`;
    try {
      bgUi('Gruppen', 'Lade „Alle meine Gruppen“ …', 0, stats());
      const data = await bgFrameG(location.origin + CONFIG.GROUPS_PATH + '/', 'jaf-bg-grp', null, 5 * 60000);
      const doneMap = getGroupDone();
      const groups = (data.groups || []).map((g, i) => ({ g, i, ts: (doneMap[g.key] || {}).ts || 0 })).sort((a, b) => a.ts - b.ts || a.i - b.i).map((x) => x.g);
      let former = [];
      for (let gi = 0; gi < groups.length && !bgScan.stop; gi++) {
        const g = groups[gi];
        const f0 = gi / Math.max(1, groups.length), fN = 1 / Math.max(1, groups.length);
        bgUi(`Gruppe ${gi + 1}/${groups.length}: ${g.name}`, 'Lese die Startseite …', f0, stats());
        let info;
        try { info = parseGroupStart(await fetchDoc(g.url), g); } catch (e) { if (e.fatal) throw e; st.failed++; continue; }
        const cur = Object.assign({}, g, info);
        st.groups++; st.mods += cur.mods.length;
        // Moderatoren dauerhaft auf die Whitelist, gesperrte entsperren (+ Notiz)
        const noteJobs = [];
        for (const m of cur.mods) {
          addModerator(m, { key: cur.key, name: cur.name });
          if (blockedIdMap().get(String(m.id || idOf(m.path)))) {
            if (CONFIG.DRY_RUN) continue;
            const u = await bgUnignore(m.id || idOf(m.path)).catch((x) => ({ ok: false, msg: x.message }));
            if (u.ok) {
              st.unblocked++;
              const logPath = Object.keys(getLog()).find((p) => idOf(p) === String(m.id || idOf(m.path))) || m.path;
              markUnblocked(logPath, m, `Moderator der Gruppe ${cur.name}`);
              noteJobs.push({ path: m.path, url: m.url, name: m.name, ages: [], action: 'note', line: CONFIG.MOD_NOTE_TEXT.replace('{gruppe}', cur.name) });
            }
          }
        }
        if (info.modsFound) former = former.concat(dropFormerModerators({ key: cur.key, name: cur.name }, cur.mods).filter((f) => f.path));
        removeWhitelistedFromWatch();
        if (bgScan.stop) break;
        let res;
        try {
          res = await readGroupMembers(cur, { stop: () => bgScan.stop, say: (m) => console.log('[Alter-Filter][Gruppen]', m),
            prog: (m, f) => bgUi(null, m, f0 + fN * 0.4 * (f || 0), null), beat: () => {} });
        } catch (e) { if (e.fatal) throw e; res = { error: e.message }; }
        if (res.error) { if (!bgScan.stop) st.failed++; continue; }
        const members = res.members;
        recordAccounts(members);
        noteSighting(members, 'Gruppen', null);
        updateWatch(members, getLog(), getIgnored(), 'Gruppen');
        const white = whiteList(), log_ = getLog(), ign = getIgnored();
        st.checked += members.length;
        const gctx = { white, blocked: blockedIdMap() };
        let hits = members.map((m) => classifyCard(m, gctx, 'Gruppen')).filter((r) => r.kind !== 'skip').map((r) => r.item);
        st.skipped += members.length - hits.length;
        const due = dueFromWatch();
        if (due.length) { const inDue = new Set(due.map((d) => d.path)); hits = due.concat(hits.filter((h) => !inDue.has(h.path))); }
        const fm = former.filter((f) => !isBlocked(f.path, log_, ign) && !white.includes(norm(f.name)) && !hits.some((h) => h.path === f.path));
        if (fm.length) { hits = hits.concat(fm.map((f) => ({ path: f.path, url: f.url, name: f.name, ages: [], type: '', source: 'Gruppen', verify: true, formerMod: true }))); former = []; }
        hits = noteJobs.concat(hits);
        const limit = CONFIG.DRY_RUN ? Math.min(CONFIG.TEST_MAX_PROFILES, CONFIG.MAX_PER_RUN) : CONFIG.MAX_PER_RUN;
        const queue = hits.slice(0, limit);
        let complete = !res.partial && hits.length <= limit;
        for (let qi = 0; qi < queue.length && !bgScan.stop; qi++) {
          const it = queue[qi];
          bgUi(null, `Profil ${qi + 1}/${queue.length}: ${it.name} …`, f0 + fN * (0.4 + 0.6 * qi / Math.max(1, queue.length)), stats());
          let r;
          try { r = await blockItem(it, 'Gruppen', st); }
          catch (err) { r = { result: 'failed', msg: err.message }; if (err.fatal) { bgScan.stop = true; bgScan.stopMsg = bgScan.stopMsg || err.message; } }
          if (r.result === 'ignored') st.ignored++; else if (r.result === 'note') st.notes++; else if (r.result === 'skipped') st.skipped++;
          else if (r.result === 'limit') complete = false;
          else { st.failed++; complete = false; }
          if (qi < queue.length - 1) await sleep(rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS));
        }
        if (bgScan.stop) break;
        if (complete && !CONFIG.DRY_RUN) markGroupDone(g);
        bgUi(null, `${g.name}: fertig`, f0 + fN, stats());
        if (gi < groups.length - 1) await sleep(rand(CONFIG.GROUP_DELAY_MIN_MS, CONFIG.GROUP_DELAY_MAX_MS));
      }
    } catch (err) { st.error = err.message || String(err); }
    return st;
  }

  // =====================================================================
  // ---------- Opa-Scan aus dem Hamburger-Menü: alle Scans nacheinander ----------
  // Reihenfolge = Rangfolge der Quellen; die Mitgliedersuche läuft wegen ihrer Dauer immer zuletzt.
  // =====================================================================
  const K_COMBO_SEL = 'jaf_combo_sel';
  const COMBO_SCANS = {
    Likes: { desc: '„Mögen mich“' },
    Besucher: { desc: '„Profilbesuche“' },
    Party: { desc: 'alle Events aus „Dates & Events“' },
    Gruppen: { desc: 'alle Gruppen, in denen Du Mitglied bist' },
    Suche: { desc: 'systematische Suche mit den gemerkten Einstellungen' },
  };
  function comboOrder() {
    const o = CONFIG.SOURCE_RANK.filter((k) => COMBO_SCANS[k] && k !== 'Suche');
    for (const k of Object.keys(COMBO_SCANS)) if (!o.includes(k) && k !== 'Suche') o.push(k);
    o.push('Suche');
    return o;
  }
  function comboSel() {
    const d = {};
    for (const k of Object.keys(COMBO_SCANS)) d[k] = k !== 'Suche';
    return Object.assign(d, gmGet(K_COMBO_SEL, null) || {});
  }
  function comboOpen() {
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgScan = null;
    bgBar2(null);
    bgTitle(opaT('Opa-Scan'), false);
    bgUi('', '', null, '');
    const wrap = document.createElement('div');
    wrap.innerHTML = opaT('<p style="margin:0 0 8px">Der Opa-Scan führt alle ausgewählten Scans nacheinander durch – in der Reihenfolge, in der die Quellen unter ') +
      opaT('<i>Opa-Schutz › Rangfolge der Quellen</i> eingestellt sind.</p>') +
      `<p style="margin:0 0 12px;opacity:.75">Treffer (${escHtml(ignoredKindsText())}) werden mit Notiz ignoriert. Ist die Ignorierliste voll, ` +
      'verdrängen sie nur Einträge aus gleich- oder niedrigerrangigen Quellen.</p><div class="jaf-combo-list"></div>' +
      '<div style="font-size:12px;opacity:.6;margin:6px 0 0">Deine Auswahl wird gemerkt.</div>';
    const list = wrap.querySelector('.jaf-combo-list');
    const sel = comboSel();
    comboOrder().forEach((k, i) => {
      const l = document.createElement('label');
      l.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:7px 10px;background:#24272a;border-radius:8px;margin:4px 0;cursor:pointer';
      l.innerHTML = '<input type="checkbox" style="width:18px;height:18px;margin-top:2px;accent-color:#c71b1b;flex:none"><span><b></b><br><span class="jaf-d" style="opacity:.6;font-size:12px"></span></span>';
      const cb = l.querySelector('input');
      cb.checked = !!sel[k]; cb.value = k;
      l.querySelector('b').textContent = `${i + 1}. ${SOURCE_LABELS[k] || k}`;
      l.querySelector('.jaf-d').textContent = COMBO_SCANS[k].desc;
      cb.addEventListener('change', () => { const s2 = comboSel(); s2[k] = cb.checked; gmSet(K_COMBO_SEL, s2); refresh(); });
      list.appendChild(l);
    });
    const refresh = () => {
      const any = [...list.querySelectorAll('input:checked')].length;
      bgButtons([
        { label: opaT('Opa-Scan starten'), primary: true, disabled: !any, fn: () => comboRun() },
        { label: 'Abbrechen', fn: closeBgPopup, focus: !wrap.__init },
      ]);
      wrap.__init = true;
    };
    bgBody(wrap);
    bgPopup().querySelector('.jaf-bg-party').style.display = 'none';
    bgPopup().querySelector('.jaf-bg-step').style.display = 'none';
    refresh();
  }
  async function comboRun() {
    if (bgScan && bgScan.running) return;
    const sel = comboSel();
    const todo = comboOrder().filter((k) => sel[k]);
    if (!todo.length) return;
    bgBody(null);
    bgPopup().querySelector('.jaf-bg-party').style.display = '';
    bgPopup().querySelector('.jaf-bg-step').style.display = '';
    const why = scanBlockedReason();
    if (why) { bgUi(opaT('Opa-Scan zurzeit nicht möglich'), why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
    if (!(await visGuard())) { closeBgPopup(); return; }
    if (!(await acquireLock(opaT('Opa-Scan (alle)')))) { bgUi(opaT('Opa-Scan zurzeit nicht möglich'), 'Ein anderer Tab hat gerade begonnen zu arbeiten.', null, ''); return; }
    bgScan = { stop: false, running: true };
    window.__jafBgBusy = true;
    window.addEventListener('beforeunload', beforeUnloadGuard);
    bgTitle(opaT('Opa-Scan läuft im Hintergrund'), true);
    bgButtons([bgStopButton()]);
    const t0 = Date.now();
    const rows = [];
    try {
      bgUi('Ignorierliste', 'Lese die Ignorierliste …', 0, fillText());
      try { await syncIgnoreList(true); } catch (e) { if (e.fatal) throw e; }
      for (let i = 0; i < todo.length && !bgScan.stop; i++) {
        const k = todo[i];
        const label = SOURCE_LABELS[k] || k;
        bgFracMap = { base: i / todo.length, span: 1 / todo.length, title: `Scan ${i + 1}/${todo.length}: ${label}`, label };
        bgUi(`Scan ${i + 1}/${todo.length}: ${label}`, 'Starte …', 0, '');
        let r;
        if (k === 'Likes') {
          r = await mjRun('Likes', true);
          if (!(bgScan && bgScan.stop)) {
            const r2 = await mjRun('ClubMail', true);
            for (const f of ['checked', 'ignored', 'skipped', 'failed', 'displaced', 'limitHit']) r[f] = (r[f] || 0) + (r2[f] || 0);
            if (r2.error) r.error = [r.error, `ClubMail: ${r2.error}`].filter(Boolean).join(' · ');
          }
        } else if (k === 'Besucher') r = await mjRun(k, true);
        else if (k === 'Party') {
          let data;
          try { data = await bgFrameG(location.origin + '/dates_partys/events/registrations/', 'jaf-bg-reg', (n) => bgUi(null, `Lade alle Eventanmeldungen … ${n}`, 0.01, null), 5 * 60000); }
          catch (e) { if (e.fatal) throw e; data = { error: e.message }; }
          if (data.error || !(data.list || []).length) r = { error: data.error || 'Keine Eventanmeldungen gefunden.' };
          else r = await bgEvRun(data.list, true);
        } else if (k === 'Gruppen') r = await grpRun();
        else r = await msRun(Object.assign({ mode: 'system' }, msSettings()), true);
        r = r || {};
        rows.push({ k, label, checked: k === 'Suche' ? (r.seen ? r.seen.size : 0) : (r.checked || 0), ignored: r.ignored || 0, displaced: r.displaced || 0,
          limitHit: r.limitHit || 0, failed: r.failed || 0, error: r.error || '' });
      }
    } catch (err) {
      rows.push({ k: '', label: 'Fehler', error: err.message || String(err) });
    } finally {
      bgFracMap = null;
      bgBar2(null);
      window.removeEventListener('beforeunload', beforeUnloadGuard);
      window.__jafBgBusy = false;
      const stopped = bgScan && bgScan.stop, stopMsg = bgScan && bgScan.stopMsg;
      bgScan = null;
      releaseLock();
      const dur = Math.max(1, Math.round((Date.now() - t0) / 60000));
      bgTitle(stopped ? opaT('Opa-Scan abgebrochen') : opaT('Opa-Scan fertig'), false);
      bgUi(stopped ? (stopMsg || 'Abgebrochen') : 'Alle ausgewählten Scans abgeschlossen', `Dauer ${dur >= 60 ? `${Math.floor(dur / 60)}:${pad2(dur % 60)} h` : `${dur} min`} · ${fillText()}`, stopped ? null : 1, '');
      const tbl = document.createElement('div');
      tbl.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><thead><tr style="opacity:.7;text-align:right">' +
        '<th style="text-align:left;padding:3px 4px">Scan</th><th style="padding:3px 4px">geprüft</th><th style="padding:3px 4px">neu ignoriert</th>' +
        '<th style="padding:3px 4px">verdrängt</th><th style="padding:3px 4px">Limit erreicht, nicht gesperrt</th></tr></thead><tbody></tbody></table>';
      const tb = tbl.querySelector('tbody');
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.style.cssText = 'border-top:1px solid #2e3236;text-align:right';
        const cells = r.error && !r.checked ? [r.label, { t: r.error, span: 4 }]
          : [r.label, r.checked, r.ignored, r.displaced, r.limitHit];
        cells.forEach((c, ci) => {
          const td = document.createElement('td');
          td.style.cssText = `padding:3px 4px;${ci === 0 ? 'text-align:left;font-weight:bold' : ''}`;
          if (c && typeof c === 'object') { td.colSpan = c.span; td.style.textAlign = 'left'; td.style.color = '#ffb300'; td.textContent = c.t; } else td.textContent = String(c);
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      }
      bgBody(tbl);
      const btns = [];
      if (rows.some((r) => r.failed && r.k === 'Party')) btns.push({ label: 'Fehlschläge (Partys) exportieren (CSV)', fn: () => exportEvFailures() });
      btns.push({ label: 'Schließen', fn: closeBgPopup, focus: true });
      bgButtons(btns);
      gmSet(K_VIS_RUN, Object.assign({}, visRun() || {}, { ts: 0 }));
      updateTopButton();
    }
  }

  // =====================================================================
  // ---------- Menüeinträge, Opa-Button in der Titelzeile ----------
  // Hamburger-Menü „Profil & Einstellungen“: „Opa-Scan“ vor „Profil verwalten“, „Opa-Schutz“ vor dem Sichtbarkeits-Eintrag
  // (Text je nach Modus, daher über das Linkziel /edit/invisible/ gefunden). Linke Spalte der Profilverwaltung:
  // „Opa-Schutz“ als erster Punkt unter „Sicherheit & Datenschutz“. Titelzeile: Opa-Button rechts neben „Kontakte“.
  // =====================================================================
  const SETTINGS_PATH = '/edit/account/';
  const SETTINGS_HASH = '#opa-schutz';
  const settingsUrl = () => location.origin + SETTINGS_PATH + SETTINGS_HASH;
  const isSettingsPage = () => cleanPath(location.pathname) === cleanPath(SETTINGS_PATH) && location.hash === SETTINGS_HASH;
  const pathOfHref = (a) => { try { return cleanPath(new URL(a.getAttribute('href'), location.origin).pathname); } catch (e) { return ''; } };
  function menuLi(cls, iconHtml, text, href, onClick) {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = `<a href="${href}"><span class="nav_link_icon" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center">${iconHtml}</span><span class="item_text"></span></a>`;
    li.querySelector('.item_text').textContent = text;
    if (onClick) li.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); });
    return li;
  }
  function closeMainMenu() {
    const t = document.querySelector('button.menu_toggle[aria-expanded="true"]');
    if (t) t.click();
  }
  function insertMenuEntries() {
    const menu = document.querySelector('ul.main_navigation_settings_menu');
    if (menu) {
      if (!menu.querySelector('.jaf-menu-scan')) {
        const pv = [...menu.querySelectorAll('a[href]')].find((a) => pathOfHref(a) === '/edit');
        const li = menuLi('jaf-menu-scan', opaLupeSvg(20), opaT('Opa-Scan'), '#', () => { closeMainMenu(); comboOpen(); });
        if (pv) pv.closest('li').before(li);
        else { const t = menu.querySelector('li.menu_title'); if (t) t.after(li); else menu.prepend(li); }
      }
      if (!menu.querySelector('.jaf-menu-fl')) {
        const li = menuLi('jaf-menu-fl', flIcon('will', { size: 20, shadow: false }), 'Fickliste', flOverviewUrl(), null);
        const scan = menu.querySelector('.jaf-menu-scan');
        if (scan) scan.before(li); else { const t = menu.querySelector('li.menu_title'); if (t) t.after(li); else menu.prepend(li); }
      }
      if (!menu.querySelector('.jaf-menu-schutz')) {
        const inv = [...menu.querySelectorAll('a[href]')].find((a) => pathOfHref(a) === '/edit/invisible');
        const li = menuLi('jaf-menu-schutz', opaIconSvg(18), opaT('Opa-Schutz'), settingsUrl(), null);
        if (inv) inv.closest('li').before(li); else menu.appendChild(li);
      }
    }
    // linke Spalte der Profilverwaltung
    const sn = document.getElementById('sn');
    if (sn && !sn.querySelector('.jaf-sn-schutz')) {
      const inv = [...sn.querySelectorAll('ul.catlinks a[href]')].find((a) => pathOfHref(a) === '/edit/invisible');
      if (inv) {
        const li = document.createElement('li');
        li.className = 'jaf-sn-schutz';
        li.innerHTML = opaT(`<a href="${settingsUrl()}" class="sn">Opa-Schutz</a>`);
        inv.closest('li').before(li);
      }
    }
    if (sn && isSettingsPage()) {
      sn.querySelectorAll('a.sn_on').forEach((a) => { if (!a.closest('.jaf-sn-schutz')) { a.classList.remove('sn_on'); a.classList.add('sn'); } });
      const mine = sn.querySelector('.jaf-sn-schutz a');
      if (mine) { mine.classList.remove('sn'); mine.classList.add('sn_on'); }
    }
  }
  function topStatus() {
    if (scanActive() || lockedByOther()) return 'Scan läuft';
    if (CONFIG.DRY_RUN) return 'Testlauf';
    const n = ignCount();
    if (n >= CONFIG.IGNORE_LIMIT * 0.95) return `${n.toLocaleString('de-DE')}/${CONFIG.IGNORE_LIMIT.toLocaleString('de-DE')}`;
    return 'aktiv';
  }
  function updateTopButton() {
    const links = document.querySelector('ul.top_area_links');
    if (!links) return;
    let li = document.getElementById('jaf-top-opa');
    if (!li) {
      const kontakte = document.getElementById('cl-toggler');
      li = document.createElement('li');
      li.id = 'jaf-top-opa';
      li.className = 'hidden-xs hidden-sm';
      li.title = opaT('Opa-Schutz');
      li.innerHTML = `<a href="${settingsUrl()}"><span class="nav_link_icon" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center">${opaIconSvg(20)}</span><span class="item_text"></span></a>`;
      if (kontakte && kontakte.parentElement === links) kontakte.after(li); else links.appendChild(li);
    }
    const t = topStatus();
    const el = li.querySelector('.item_text');
    if (el.textContent !== t) el.textContent = t;
  }
  setInterval(() => { try { insertMenuEntries(); updateTopButton(); invisiblePageGuard(); ruhrifyUi(); } catch (e) { /* weiter */ } }, 1500);

  // =====================================================================
  // ---------- Seite „Opa-Schutz“ (Einstellungen) unter /edit/account/#opa-schutz ----------
  // Aufbau wie JOYclubs Seite „Account“: Abschnitte (div.h2 > h2), Tabellenzeilen (th.td_fh / td.td_fc), Hinweise (c_hint_lo),
  // Buttons „Speichern“ / „Abbrechen“. Ein Teil steht unter „Experten-Einstellungen“ (immer zugeklappt).
  // =====================================================================
  let settingsDraft = null;   // Arbeitskopie der Einstellungen + autoDel (zu löschende automatische Whitelist-Einträge)
  let settingsDirty = false;
  const cloneJ = (x) => JSON.parse(JSON.stringify(x));
  const sortDe = (arr) => arr.slice().sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  // =====================================================================
  // ---------- Regeln anwenden: Plan, Anwenden, Ignorierliste reparieren ----------
  // =====================================================================
  const handMade = (e) => !e || (!e.source && /JOYclub-Ignorierliste/.test(e.method || ''));
  // Alter heute: aus den Geburtszeiträumen, sonst aus dem gespeicherten Alter
  function agesNow(path, acc, e, m) {
    const a = acc[path];
    if (a && a.persons && a.persons.length) { const x = a.persons.map(ageNow); if (x.every((v) => v != null)) return x; }
    return (e && e.ages && e.ages.length ? e.ages : (m && m.ages)) || [];
  }
  // Wichtigkeit (zum Behalten): kleinere Zahl = wichtiger – Umkehrung der Verdrängungs-Reihenfolge
  function prioCmp(a, b) {
    const today = isoDay(new Date());
    const past = (x) => (x.seen || '1970-01-01') < today;
    return srcRank(a.src) - srcRank(b.src) || kindRank(b.kind) - kindRank(a.kind) || (past(a) - past(b)) ||
      (past(a) && past(b) ? (b.seen || '').localeCompare(a.seen || '') : 0) || (b.d || 0) - (a.d || 0);
  }
  // Was würden die Einstellungen cfg bewirken? (ohne etwas zu ändern)
  function planRules(cfg = CONFIG) {
    const acc = getAccounts(), log_ = getLog(), ign = getIgnored(), mem = getMem();
    const white = whiteList();
    const ignIds = new Set(Object.keys(ign).map(idOf));
    const managed = new Map();
    for (const [p, e] of Object.entries(log_)) if (!e.unblocked && ignIds.has(idOf(p)) && !handMade(e)) managed.set(p, e);
    const managedIds = new Set([...managed.keys()].map(idOf));
    const hand = Object.keys(ign).filter((p) => !managedIds.has(idOf(p))).length; // von Hand / Whitelist gesperrt: belegen Plätze
    const want = new Map(), unclear = [];
    const paths = new Set([...Object.keys(acc), ...Object.keys(log_), ...Object.keys(mem)].filter((p) => CONFIG.PROFILE_PATH_RE.test(p)));
    for (const p of paths) {
      const a = acc[p], e = log_[p], m = mem[p];
      const type = (a && a.type) || (e && e.type) || (m && m.type) || '';
      const name = (a && a.name) || (e && e.name) || (m && m.name) || '';
      if (!type || isWhiteMember({ name, path: p }, white)) continue;
      const ages = agesNow(p, acc, e, m);
      const srcs = [...new Set(Object.keys((a && a.srcs) || {}).concat([e && e.source, m && m.src]).filter((q) => q && q !== 'Sync'))];
      const c = { type, ages, name, path: p };
      const bs = bestSource(c, srcs.length ? srcs : [ALTBESTAND], cfg);
      const seen = (e && e.seen) || (a && a.seen) || '';
      if (bs) {
        const it = { path: p, url: (a && a.url) || (e && e.url) || location.origin + p, name, type, ages, src: bs.src, kind: bs.j.kind, seen };
        it.d = daysOver(p, Object.assign({}, e || {}, { source: bs.src, type, ages }), bs.j.kind);
        want.set(p, it);
      } else if (srcs.concat(srcs.length ? [] : [ALTBESTAND]).some((q) => { const j = judge(c, q, cfg); return j.unclear && j.group && cfg.GROUPS[j.group].ignore; })) unclear.push(p);
    }
    const unclearSet = new Set(unclear);
    const removed = [...managed.keys()].filter((p) => !want.has(p) && !unclearSet.has(p));
    const added = [...want.keys()].filter((p) => !ignIds.has(idOf(p)));
    const notes = [...managed.entries()].filter(([p, e]) => want.has(p) && kindLabel(want.get(p).kind, cfg) !== kindLabel(entryKind(e), CONFIG)).map(([p]) => p);
    return { cur: Object.keys(ign).length, hand, managed, want, removed, added, notes, unclear, total: hand + want.size };
  }
  // nach dem Speichern: Scan-Gedächtnis zurücksetzen (Partys, Gruppen, Profilbesucher/„Mögen mich“)
  function resetScanMemory() {
    const ev = getEvents(); for (const e of Object.values(ev)) { delete e.seen; delete e.seenRules; } gmSet(K_EVENTS, ev);
    gmSet(K_GROUP_DONE, {});
    gmSet(K_MJ, {});
  }
  // Neue Regeln anwenden. mode: 'all' | 'unblock' | 'block'; recheck = unklare Mitglieder auf dem Profil nachlesen
  async function applyRules(mode, recheck) {
    if (bgScan && bgScan.running) return;
    const why = scanBlockedReason();
    closeBgPopup();
    bgTitle('Neue Einstellungen anwenden', false);
    if (why) { bgUi('Zurzeit nicht möglich', why, null, 'Die Einstellungen sind gespeichert. Anwenden kannst Du sie später über „Ignorierliste reparieren“ oder den nächsten Opa-Scan.'); bgButtons([{ label: 'Schließen', fn: () => location.reload(), focus: true }]); return; }
    if (!(await visGuard())) { location.reload(); return; }
    if (!(await acquireLock('Einstellungen anwenden'))) { bgUi('Zurzeit nicht möglich', 'Ein anderer Tab arbeitet gerade.', null, ''); bgButtons([{ label: 'Schließen', fn: () => location.reload(), focus: true }]); return; }
    bgScan = { stop: false, running: true };
    window.__jafBgBusy = true;
    window.addEventListener('beforeunload', beforeUnloadGuard);
    bgTitle('Neue Einstellungen anwenden', true);
    bgButtons([bgStopButton()]);
    const st = { checked: 0, unblocked: 0, ignored: 0, notes: 0, displaced: 0, limitHit: 0, failed: 0, trimmed: 0 };
    const stats = () => `Profile nachgelesen: ${st.checked} · entsperrt: ${st.unblocked} · gesperrt: ${st.ignored} · Notizen angepasst: ${st.notes}\n` +
      `verdrängt: ${st.displaced} · Limit erreicht: ${st.limitHit} · Limit verringert, entsperrt: ${st.trimmed} · fehlgeschlagen: ${st.failed}\n${fillText()}` +
      (CONFIG.DRY_RUN ? '\nTestmodus: auf JOYclub wird nichts verändert' : '');
    try {
      bgUi('Ignorierliste', 'Lese die Ignorierliste …', 0, stats());
      try { await syncIgnoreList(true); } catch (e) { /* egal */ }
      let plan = planRules();
      if (recheck && plan.unclear.length) {
        for (let i = 0; i < plan.unclear.length && !bgScan.stop; i++) {
          const p = plan.unclear[i];
          bgUi('Unklare Mitglieder prüfen', `${i + 1}/${plan.unclear.length}`, 0.05 + 0.25 * i / plan.unclear.length, stats());
          try {
            await visEnforce();
            await sleep(rand(600, 1300));
            const r = await jfetch(location.origin + p);
            const info = r.doc ? parseProfileDoc(r.doc) : null;
            if (info && info.ages && info.ages.length) recordAccounts([{ path: p, name: info.name, ages: info.ages, type: info.type, signs: info.signs }]);
            st.checked++;
          } catch (err) { if (err.fatal) throw err; st.failed++; }
        }
        plan = planRules();
      }
      const log_ = getLog();
      // 1. entsperren, was die Regeln nicht mehr erfüllt
      if ((mode === 'all' || mode === 'unblock') && !bgScan.stop) {
        for (let i = 0; i < plan.removed.length && !bgScan.stop; i++) {
          const p = plan.removed[i], e = log_[p] || {};
          bgUi('Entsperren', `${i + 1}/${plan.removed.length} · ${e.name || p}`, 0.3 + 0.2 * i / plan.removed.length, stats());
          if (CONFIG.DRY_RUN) { st.unblocked++; continue; }
          let r;
          try { r = await bgUnignore(idOf(p)); } catch (err) { if (err.fatal) throw err; r = { ok: false }; }
          if (!r.ok) { st.failed++; continue; }
          markUnblocked(p, e, 'entsperrt (Einstellungen geändert)');
          st.unblocked++;
          if (CONFIG.WRITE_NOTE) { try { await actJob({ path: p, url: e.url || location.origin + p, name: e.name, action: 'clean' }, 'Einstellungen'); } catch (err) { if (err.fatal) throw err; } }
        }
      }
      // 2. Limit verringert → überzählige in Verdrängungs-Reihenfolge entsperren
      if (mode !== 'block' && !CONFIG.DRY_RUN) {
        while (ignCount() > CONFIG.IGNORE_LIMIT && !bgScan.stop) {
          const v = pickVictim({ source: CONFIG.SOURCE_RANK[0], kind: 'sd', type: 'Paar' });
          if (!v) break;
          bgUi('Limit', `entsperre ${v.e.name} (${v.why})`, 0.5, stats());
          let r;
          try { r = await bgUnignore(idOf(v.p)); } catch (err) { if (err.fatal) throw err; r = { ok: false }; }
          if (!r.ok) { st.failed++; break; }
          markUnblocked(v.p, v.e, 'entsperrt (Platz, Limit verringert)');
          st.trimmed++;
        }
      }
      // 3. sperren, was neu dazukommt (wichtigste zuerst)
      if ((mode === 'all' || mode === 'block') && !bgScan.stop) {
        const add = plan.added.map((p) => plan.want.get(p)).sort(prioCmp);
        for (let i = 0; i < add.length && !bgScan.stop; i++) {
          const w = add[i];
          bgUi('Sperren', `${i + 1}/${add.length} · ${w.name}`, 0.5 + 0.3 * i / add.length, stats());
          const it = { path: w.path, url: w.url, name: w.name, ages: w.ages, type: w.type, kind: w.kind, source: w.src, seen: w.seen, verify: true };
          let r;
          try { r = await blockItem(it, w.src, st); } catch (err) { if (err.fatal) throw err; r = { result: 'failed' }; }
          if (r.result === 'ignored') st.ignored++; else if (r.result !== 'limit' && r.result !== 'skipped') st.failed++;
          await sleep(rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS));
        }
      }
      // 4. Notizen an die neuen Bezeichnungen angleichen
      if (mode === 'all' && CONFIG.WRITE_NOTE && !bgScan.stop) {
        for (let i = 0; i < plan.notes.length && !bgScan.stop; i++) {
          const p = plan.notes[i], e = log_[p] || {}, w = plan.want.get(p);
          bgUi('Notizen', `${i + 1}/${plan.notes.length} · ${e.name || p}`, 0.8 + 0.1 * i / plan.notes.length, stats());
          if (CONFIG.DRY_RUN) { st.notes++; continue; }
          let r;
          try { r = await actJob({ path: p, url: e.url || location.origin + p, name: e.name, action: 'sync', kind: w.kind, source: e.source || w.src, ts: e.ts || Date.now(), block: false }, 'Einstellungen'); }
          catch (err) { if (err.fatal) throw err; r = { result: 'failed' }; }
          if (r.result === 'note') { st.notes++; const L = getLog(); if (L[p]) { L[p].kind = w.kind; gmSet(K_LOG, L); } } else st.failed++;
        }
      }
      // 5. JOYclub-Liste gegen die erwarteten Einträge prüfen und reparieren
      if (!bgScan.stop) {
        bgUi('Ignorierliste prüfen', 'Lese die Ignorierliste …', 0.9, stats());
        await syncIgnoreList(true);
        const rp = repairPlan();
        if (rp.missing.length) await runRepair(rp, st, stats);
      }
      bgTitle(bgScan.stop ? 'Anwenden abgebrochen' : 'Neue Einstellungen angewendet', false);
      bgUi(bgScan.stop ? (bgScan.stopMsg || 'Abgebrochen') : 'Fertig', '', bgScan.stop ? null : 1, stats());
    } catch (err) {
      bgTitle('Anwenden nicht möglich', false);
      bgUi('Fehler', err.message || String(err), null, stats());
    } finally {
      window.removeEventListener('beforeunload', beforeUnloadGuard);
      window.__jafBgBusy = false;
      bgScan = null;
      releaseLock();
      bgButtons([{ label: 'Schließen', fn: () => location.reload(), focus: true }]);
    }
  }
  // ---- „Ignorierliste reparieren“ ----
  // fehlend = vom Skript gesperrt, steht aber nicht (mehr) auf JOYclub (z. B. Überlauf);
  // weniger wichtig = gesperrte Einträge, die für wichtigere fehlende weichen würden; von Hand gesperrte bleiben unberührt.
  function repairPlan() {
    const acc = getAccounts(), log_ = getLog(), ign = getIgnored(), mem = getMem();
    const ignIds = new Set(Object.keys(ign).map(idOf));
    const white = whiteList();
    const toItem = (p, e) => {
      const type = e.type || (acc[p] || {}).type || '';
      const ages = agesNow(p, acc, e, mem[p]);
      const kind = entryKind(Object.assign({}, e, { type, ages }));
      const it = { path: p, url: e.url || location.origin + p, name: e.name || (acc[p] || {}).name || '', type, ages, kind, src: e.source || ALTBESTAND, seen: e.seen || '' };
      it.d = daysOver(p, e, kind);
      return it;
    };
    const missing = [], present = [];
    for (const [p, e] of Object.entries(log_)) {
      if (e.unblocked || handMade(e) || isWhiteMember({ name: e.name, path: p }, white)) continue;
      (ignIds.has(idOf(p)) ? present : missing).push(toItem(p, e));
    }
    missing.sort(prioCmp);
    const presentIds = new Set(present.map((x) => idOf(x.path)));
    const hand = Object.keys(ign).filter((p) => !presentIds.has(idOf(p))).length;
    const free = Math.max(0, CONFIG.IGNORE_LIMIT - Object.keys(ign).length);
    // wie viele vorhandene müssten für fehlende weichen? (nur weniger wichtige)
    const asc = present.slice().sort((a, b) => prioCmp(b, a)); // unwichtigste zuerst
    let less = 0, k = 0;
    for (const m of missing.slice(free)) { if (k < asc.length && prioCmp(m, asc[k]) < 0) { less++; k++; } }
    return { missing, present, hand, free, less };
  }
  async function runRepair(rp, st, stats) {
    for (let i = 0; i < rp.missing.length && !bgScan.stop; i++) {
      const m = rp.missing[i];
      bgUi('Reparieren', `${i + 1}/${rp.missing.length} · ${m.name}`, 0.9 + 0.1 * i / rp.missing.length, stats());
      const e = getLog()[m.path] || {};
      markUnblocked(m.path, e, 'von JOYclub entfernt (Überlauf)');
      if (CONFIG.DRY_RUN) continue;
      const it = { path: m.path, url: m.url, name: m.name, ages: m.ages, type: m.type, kind: m.kind, source: m.src === ALTBESTAND ? '' : m.src, seen: m.seen };
      let r;
      try { r = await blockItem(it, it.source, st); } catch (err) { if (err.fatal) throw err; r = { result: 'failed' }; }
      if (r.result === 'ignored') { st.ignored++; st.repaired = (st.repaired || 0) + 1; } else if (r.result !== 'limit') st.failed++;
      await sleep(rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS));
    }
  }
  async function repairOpen() {
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgTitle('Ignorierliste reparieren', false);
    bgUi('Lese die Ignorierliste …', '', null, '');
    bgButtons([{ label: 'Abbrechen', fn: closeBgPopup, focus: true }]);
    try { await syncIgnoreList(true); } catch (e) { /* egal */ }
    const rp = repairPlan();
    bgUi('Abgleich mit JOYclub', '', null,
      `Fehlen auf JOYclub (vom Skript gesperrt, z. B. durch Überlauf herausgefallen): ${rp.missing.length}\n` +
      `Weniger wichtige Einträge, die dafür weichen würden: ${rp.less}\n` +
      `Von Hand gesperrt (bleiben unberührt): ${rp.hand}\n${fillText()}`);
    bgButtons([
      { label: 'Jetzt reparieren', disabled: !rp.missing.length, fn: () => repairRun() },
      { label: 'Abbrechen', fn: closeBgPopup, focus: true },
    ]);
  }
  async function repairRun() {
    const why = scanBlockedReason();
    if (why) { bgUi('Zurzeit nicht möglich', why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
    if (!(await visGuard())) { closeBgPopup(); return; }
    if (!(await acquireLock('Ignorierliste reparieren'))) { bgUi('Zurzeit nicht möglich', 'Ein anderer Tab arbeitet gerade.', null, ''); return; }
    bgScan = { stop: false, running: true };
    window.__jafBgBusy = true;
    window.addEventListener('beforeunload', beforeUnloadGuard);
    bgTitle('Ignorierliste reparieren', true);
    bgButtons([bgStopButton()]);
    const st = { ignored: 0, repaired: 0, displaced: 0, limitHit: 0, failed: 0 };
    const stats = () => `wieder gesperrt: ${st.repaired} · verdrängt: ${st.displaced} · Limit erreicht: ${st.limitHit} · fehlgeschlagen: ${st.failed}\n${fillText()}`;
    try {
      await runRepair(repairPlan(), st, stats);
      bgTitle(bgScan.stop ? 'Reparatur abgebrochen' : 'Ignorierliste repariert', false);
      bgUi(bgScan.stop ? 'Abgebrochen' : 'Fertig', '', bgScan.stop ? null : 1, stats());
    } catch (err) {
      bgTitle('Reparatur nicht möglich', false); bgUi('Fehler', err.message || String(err), null, stats());
    } finally {
      window.removeEventListener('beforeunload', beforeUnloadGuard);
      window.__jafBgBusy = false;
      bgScan = null;
      releaseLock();
      bgButtons([{ label: 'Schließen', fn: () => location.reload(), focus: true }]);
    }
  }
  function settingsGuardClick(e) {
    if (!settingsDirty) return;
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.closest('#jaf-ask-popup, #jaf-wl-popup')) return;
    const href = a.getAttribute('href') || '';
    if (!href || href === '#' || href.startsWith('javascript:')) return;
    let url;
    try { url = new URL(href, location.href); } catch (err) { return; }
    if (url.pathname === location.pathname && url.hash === SETTINGS_HASH) return;
    e.preventDefault(); e.stopPropagation();
    askPopup({ title: 'Ungespeicherte Änderungen', warn: true, lines: ['Du hast Einstellungen geändert, aber noch nicht gespeichert.'],
      buttons: [{ label: 'Speichern und verlassen', value: 'save' }, { label: 'Verwerfen und verlassen', value: 'drop' }, { label: 'Abbrechen', value: null, focus: true }] })
      .then((c) => {
        if (!c) return;
        if (c === 'save') commitSettings();
        settingsDirty = false;
        location.href = url.href;
      });
  }
  const settingsBeforeUnload = (e) => { if (!settingsDirty) return; e.preventDefault(); e.returnValue = 'Ungespeicherte Änderungen'; return e.returnValue; };
  function commitSettings() {
    const d = settingsDraft;
    const vals = {};
    for (const k of SETTING_KEYS) vals[k] = d[k];
    saveSettings(vals);
    for (const k of SETTING_KEYS) CONFIG[k] = cloneJ(d[k]);
    rememberNoteLabels();
    // automatische Whitelist: gelöschte Einträge und solche, die jetzt auf der eigenen Whitelist stehen, entfernen
    const own = new Set(Object.values(d.WHITELIST || {}).flat().map(norm));
    const w = getDynWhite();
    let ch = false;
    for (const k of Object.keys(w)) if (d.autoDel.includes(k) || own.has(k)) { delete w[k]; ch = true; }
    if (ch) { gmSet(K_WHITE, w); _wIdCache.t = 0; }
    settingsDirty = false;
  }
  // ---------- Bausteine der Einstellungsseite (Regler, Schalter) ----------
  const SET_CSS = '.jaf-sl{position:relative;height:30px;margin-top:12px;touch-action:none;min-width:120px}' +
    '.jaf-sl .tr{position:absolute;top:13px;left:0;right:0;height:4px;background:rgba(127,127,127,.35);border-radius:2px}' +
    '.jaf-sl .seg{position:absolute;top:13px;height:4px;border-radius:2px}' +
    '.jaf-sl .kn{position:absolute;top:6px;width:18px;height:18px;margin-left:-9px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.7);cursor:grab;outline:none}' +
    '.jaf-sl .kn:focus{box-shadow:0 0 0 2px #c71b1b}.jaf-sl .kn span{position:absolute;top:-17px;left:50%;transform:translateX(-50%);font-size:11px;opacity:.85;pointer-events:none}' +
    '.jaf-sl.w .kn.k1{margin-left:-18px}.jaf-sl.w .kn.k2{margin-left:0}' +
    '.jaf-wl{position:relative;height:16px;font-size:12px;opacity:.85}.jaf-wl span{position:absolute;text-align:center;white-space:nowrap;overflow:hidden}' +
    '.jaf-tg{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;cursor:pointer;user-select:none;font-weight:normal}' +
    '.jaf-tg i{position:relative;width:38px;height:22px;border-radius:11px;background:#7a7f84;display:inline-block;transition:background .15s}' +
    '.jaf-tg i:after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}' +
    '.jaf-tg.on i{background:#43a047}.jaf-tg.on i:after{left:19px}' +
    'table.jaf-src{width:100%;border-collapse:collapse}table.jaf-src th{font-weight:normal;opacity:.7;font-size:12px;text-align:left;padding:2px 6px}' +
    'table.jaf-src td{padding:4px 6px;border-top:1px solid rgba(127,127,127,.2);font-size:13px;white-space:nowrap;vertical-align:middle}' +
    'table.jaf-src td.v{width:48%}table.jaf-src td.i{width:30%}table.jaf-src tr.sw td{border-top:0}.jaf-who{display:inline-block;margin-left:6px;opacity:.6;font-size:11px}' +
    'table.jaf-nm{border-collapse:collapse}table.jaf-nm th{font-weight:normal;opacity:.7;font-size:12px;text-align:left;padding:0 6px}table.jaf-nm td{padding:2px 6px 2px 0;font-size:12px}' +
    'table.jaf-nm input{width:120px;display:inline-block}.jaf-num{width:64px!important;display:inline-block!important}' +
    '.jaf-info{display:grid;grid-template-columns:auto auto;gap:4px 18px;background:rgba(127,127,127,.12);border-radius:8px;padding:10px 14px;margin:6px 0 4px;width:max-content;max-width:100%}' +
    '.jaf-info b{font-variant-numeric:tabular-nums}.jaf-cb{display:inline-flex;align-items:center;gap:6px;margin:2px 14px 2px 0;font-weight:normal;cursor:pointer}';
  function ensureSetCss() {
    if (document.getElementById('jaf-set-css')) return;
    const st = document.createElement('style'); st.id = 'jaf-set-css'; st.textContent = SET_CSS; document.head.appendChild(st);
  }
  function mkToggle(on, label, fn) {
    const t = document.createElement('label');
    t.className = 'jaf-tg' + (on ? ' on' : '');
    t.tabIndex = 0;
    t.innerHTML = '<i></i><span></span>';
    t.querySelector('span').textContent = label;
    const flip = (e) => { e.preventDefault(); fn(!t.classList.contains('on')); };
    t.addEventListener('click', flip);
    t.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') flip(e); });
    return t;
  }
  // Regler 18–100: kind 'vis' (zwei Griffe: Stufe 1 bis · Stufe 2 bis), 'ign' (ein Griff: ignorieren ab), 'w' (Gewichtung 0–100, zwei Griffe)
  function mkSlider(kind, vals, onInput, onDone) {
    const MIN = kind === 'w' ? 0 : 18, MAX = 100;
    const el = document.createElement('div');
    el.className = 'jaf-sl' + (kind === 'w' ? ' w' : '');
    el.innerHTML = '<div class="tr"></div>';
    const segs = (kind === 'vis' ? ['#43a047', '#ffb74d', '#e53935'] : kind === 'ign' ? ['rgba(127,127,127,.6)', '#e53935'] : ['#5c8dd6', '#e0a33c', '#b06ad6'])
      .map((c) => { const s = document.createElement('div'); s.className = 'seg'; s.style.background = c; el.appendChild(s); return s; });
    let v = vals.slice();
    const knobs = v.map((x, i) => {
      const k = document.createElement('div');
      k.className = 'kn k' + (i + 1); k.tabIndex = 0; k.setAttribute('role', 'slider');
      if (kind !== 'w') k.innerHTML = '<span></span>';
      el.appendChild(k);
      return k;
    });
    const pos = (x) => ((x - MIN) / (MAX - MIN)) * 100;
    const clampI = (i, x) => {
      x = Math.round(Math.max(MIN, Math.min(MAX, x)));
      const gap = kind === 'w' ? 0 : 1;
      if (i === 0 && v.length > 1) x = Math.min(x, v[1] - gap);
      if (i === 1) x = Math.max(x, v[0] + gap);
      return x;
    };
    const tip = () => {
      if (kind !== 'w') return;
      knobs[0].title = `Männer = ${v[0]} % / Frauen = ${v[1] - v[0]} %`;
      knobs[1].title = `Frauen = ${v[1] - v[0]} % / Paare = ${100 - v[1]} %`;
    };
    const render = () => {
      const p = v.map(pos);
      const cuts = [0].concat(p, [100]);
      segs.forEach((s, i) => { s.style.left = cuts[i] + '%'; s.style.width = Math.max(0, cuts[i + 1] - cuts[i]) + '%'; });
      knobs.forEach((k, i) => { k.style.left = p[i] + '%'; if (k.firstChild) k.firstChild.textContent = v[i]; k.setAttribute('aria-valuenow', v[i]); });
      tip();
    };
    const setI = (i, x) => { const n = clampI(i, x); if (n === v[i]) return; v[i] = n; render(); onInput(v.slice(), i); };
    knobs.forEach((k, i) => {
      k.addEventListener('pointerdown', (e) => {
        e.preventDefault(); k.setPointerCapture(e.pointerId); k.focus();
        const mv = (ev) => { const r = el.getBoundingClientRect(); setI(i, MIN + ((ev.clientX - r.left) / r.width) * (MAX - MIN)); };
        const up = () => { k.removeEventListener('pointermove', mv); k.removeEventListener('pointerup', up); k.removeEventListener('pointercancel', up); if (onDone) onDone(v.slice()); };
        k.addEventListener('pointermove', mv); k.addEventListener('pointerup', up); k.addEventListener('pointercancel', up);
      });
      k.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
        if (!d) return;
        e.preventDefault(); setI(i, v[i] + d); if (onDone) onDone(v.slice());
      });
    });
    render();
    return { el, set: (nv) => { v = nv.slice(); render(); }, get: () => v.slice() };
  }
  // Werte einer Quelle/Person im Entwurf: [Stufe 1 bis, Stufe 2 bis, ignorieren ab]
  const draftVals = (d, g, q, who) => (g === 'p' ? d.GROUPS.p.src[q][who] : d.GROUPS[g].src[q]);
  function setDraftVals(d, g, q, who, v) { if (g === 'p') d.GROUPS.p.src[q][who] = v; else d.GROUPS[g].src[q] = v; }
  // Änderung relevant fürs Ignorieren? (Popup beim Speichern)
  function rulesRelevantChange(d) {
    if (rulesHash(d) !== rulesHash(CONFIG) || d.IGNORE_LIMIT !== CONFIG.IGNORE_LIMIT) return true;
    return ['opa', 'oma', 'geronto'].some((k) => kindLabel(k, d) !== kindLabel(k, CONFIG));
  }
  // Popup beim Speichern regelrelevanter Änderungen
  function saveRulesPopup() {
    const d = settingsDraft;
    closeBgPopup();
    bgTitle('Einstellungen speichern', false);
    bgUi('Berechne die Auswirkungen …', '', null, '');
    bgButtons([]);
    setTimeout(() => {
      const plan = planRules(d);
      const lim = d.IGNORE_LIMIT;
      const nA = plan.added.length, nR = plan.removed.length, nN = plan.notes.length, nU = plan.unclear.length;
      bgUi('Auswirkungen der neuen Einstellungen', '', null,
        `Derzeit ignoriert: ${plan.cur.toLocaleString('de-DE')} / ${lim.toLocaleString('de-DE')}\n` +
        `Nach Anwenden: ${plan.total.toLocaleString('de-DE')}${nU ? '+' : ''} / ${lim.toLocaleString('de-DE')}\n` +
        `Fallen weg: ${nR} · Kommen dazu: ${nA} · Notizen weichen ab: ${nN} · Unklar: ${nU}` +
        (plan.total > lim ? `\nÜber dem Limit: ${(plan.total - lim).toLocaleString('de-DE')} Treffer werden nicht gesperrt bzw. verdrängen weniger wichtige.` : ''));
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:12px;cursor:pointer';
      lab.innerHTML = `<input type="checkbox" style="width:18px;height:18px;accent-color:#c71b1b;margin:0"> <span>Unklare Mitglieder erneut prüfen (${nU})</span>`;
      const cb = lab.querySelector('input');
      if (!nU) { cb.disabled = true; lab.style.opacity = '.5'; }
      const verb = nA && nR ? 'gesperrt oder entsperrt' : nA ? 'gesperrt' : nR ? 'entsperrt' : '';
      const go = (mode) => () => {
        commitSettings(); resetScanMemory();
        try { sessionStorage.setItem('jaf_settings_saved', '1'); } catch (e) { /* egal */ }
        if (mode) applyRules(mode, cb.checked); else location.reload();
      };
      const btns = [{ label: 'Änderungen speichern und anwenden', fn: go('all'),
        hint: verb ? `Speichert und gleicht die Ignorierliste an: Mitglieder werden ${verb}${nN ? ', Notizen angepasst' : ''}. Von Hand Gesperrte bleiben unberührt.`
          : `Speichert${nN ? ' und passt die Notizen an' : ''}; danach wird die Ignorierliste geprüft.` }];
      if (nR) btns.push({ label: 'Änderungen speichern und Mitglieder entsperren', fn: go('unblock'), hint: `Speichert und entsperrt ${nR} Mitglieder, die die Regeln nicht mehr erfüllen. Neue Treffer werden erst beim nächsten Scan gesperrt.` });
      if (nA) btns.push({ label: 'Änderungen speichern und Mitglieder sperren', fn: go('block'), hint: `Speichert und sperrt ${nA} neue Treffer (bei vollem Limit verdrängen sie weniger wichtige). Niemand wird entsperrt.` });
      btns.push({ label: 'Änderungen nur speichern', fn: go(null), hint: 'Die Ignorierliste bleibt, wie sie ist; die neuen Regeln gelten ab dem nächsten Scan.' });
      btns.push({ label: 'Änderungen verwerfen', focus: true, hint: 'Alle Änderungen auf dieser Seite werden verworfen.',
        fn: () => { closeBgPopup(); settingsDraft = null; settingsDirty = false; renderSettingsPage(); } });
      bgBody(lab);
      bgButtons(btns);
      const bx = bgPopup().querySelector('.jaf-bg-btns'); bx.after(lab); // Haken unter den Buttons
    }, 30);
  }
  // Abschnitte je Gruppe (Männer, Frauen, Paare) und AWO-Faktor
  function renderGroupSettings(c, d, section, row, changed, refresh) {
    const sliders = {};
    const awoLabels = {};
    const updAwo = () => { for (const g of GROUP_KEYS) if (awoLabels[g]) awoLabels[g].textContent = awoRowLabel(d, g); };
    for (const g of GROUP_KEYS) {
      const G = d.GROUPS[g];
      const reset = document.createElement('a');
      reset.href = '#'; reset.style.cssText = 'font-size:12px;font-weight:normal';
      reset.textContent = JSON.stringify(G) !== JSON.stringify(SOURCE_DEFAULTS.GROUPS[g]) ? 'Quelltext-Werte' : '';
      reset.title = 'Alle Werte dieser Gruppe auf die Werte aus dem Quelltext zurücksetzen';
      reset.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); d.GROUPS[g] = cloneJ(SOURCE_DEFAULTS.GROUPS[g]); changed(); });
      const tb = section(GROUP_LABELS[g], reset);
      // 1+2: Schalter und Altersgrenzen je Quelle
      const t = document.createElement('table');
      t.className = 'jaf-src';
      const sw = document.createElement('tr'); sw.className = 'sw';
      sw.innerHTML = '<td></td><td class="v"></td><td class="i"></td>';
      sw.children[1].appendChild(mkToggle(G.visual, 'Visuelle Einstufung', (on) => { G.visual = on; changed(); }));
      sw.children[2].appendChild(mkToggle(G.ignore, 'Ignorieren aktiv', (on) => { G.ignore = on; changed(); }));
      t.appendChild(sw);
      const hd = document.createElement('tr');
      hd.innerHTML = '<th>Quelle</th><th>Visuell (Stufe 1 bis · Stufe 2 bis)</th><th>Ignorieren ab</th>';
      t.appendChild(hd);
      for (const q of SCAN_SOURCES) {
        for (const who of g === 'p' ? ['f', 'm'] : [null]) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td class="v"></td><td class="i"></td>';
          tr.children[0].textContent = who === 'm' ? '' : SOURCE_LABELS[q] || q;
          tr.children[0].title = SOURCE_TIPS[q] || '';
          if (who) { const w = document.createElement('span'); w.className = 'jaf-who'; w.textContent = who === 'f' ? 'Frau' : 'Mann'; tr.children[0].appendChild(w); }
          const key = `${q}|${who || ''}`;
          const upd = (vv, part) => {
            const old = draftVals(d, g, q, who);
            const nv = part === 'vis' ? [vv[0], vv[1], old[2]] : [old[0], old[1], vv[0]];
            setDraftVals(d, g, q, who, nv);
            // Paare ohne „getrenntes Alter“: der andere Balken wandert mit (gleiche Verschiebung)
            if (g === 'p' && !G.split) {
              const ow = who === 'f' ? 'm' : 'f', o = draftVals(d, g, q, ow).slice();
              const idx = part === 'vis' ? [0, 1] : [2];
              idx.forEach((ix) => { o[ix] = Math.max(18, Math.min(100, o[ix] + nv[ix] - old[ix])); });
              if (o[0] >= o[1]) o[1] = Math.min(100, o[0] + 1);
              setDraftVals(d, g, q, ow, o);
              const os = sliders[g][`${q}|${ow}`];
              if (os) { os.vis.set([o[0], o[1]]); os.ign.set([o[2]]); }
            }
            settingsDirty = true;
            if (q === 'Party') updAwo();
            refresh();
          };
          const v = draftVals(d, g, q, who);
          const vis = mkSlider('vis', [v[0], v[1]], (vv) => upd(vv, 'vis'));
          const ign = mkSlider('ign', [v[2]], (vv) => upd(vv, 'ign'));
          (sliders[g] = sliders[g] || {})[key] = { vis, ign };
          tr.children[1].appendChild(vis.el); tr.children[2].appendChild(ign.el);
          t.appendChild(tr);
        }
      }
      const cell = row(tb, 'Altersgrenzen je Quelle:', t, 'Visuell = Farben, Umbenennen, eigene Reiter · Ignorieren = Sperren mit Notiz, rotes X. Unter dem ersten Griff Stufe 1, dazwischen Stufe 2, darüber Stufe 3.');
      const cp = document.createElement('button');
      cp.type = 'button'; cp.className = 'btn btn-default btn-xs jaf-copy-first';
      cp.style.cssText = 'margin-top:6px;border-radius:14px;padding:3px 12px;font-size:12px';
      cp.textContent = 'Werte der ersten Zeile für alle Quellen übernehmen';
      cp.addEventListener('click', (e) => {
        e.preventDefault();
        const q0 = SCAN_SOURCES[0];
        for (const q of SCAN_SOURCES.slice(1)) {
          if (g === 'p') G.src[q] = cloneJ(G.src[q0]); else G.src[q] = G.src[q0].slice();
        }
        changed();
      });
      cell.insertBefore(cp, cell.querySelector('.c_hint_lo'));
      if (g === 'p') {
        const sp = document.createElement('label'); sp.className = 'jaf-cb';
        sp.innerHTML = '<input type="checkbox"> <span>Frau und Mann getrennt einstellen</span>';
        sp.querySelector('input').checked = !!G.split;
        sp.querySelector('input').addEventListener('change', (e) => { G.split = e.target.checked; changed(); });
        row(tb, 'Getrenntes Alter:', sp, 'Aus: beide Balken verschieben sich gemeinsam. Ignoriert wird ein Paar erst, wenn beide ihre Schwelle erreichen.');
        for (const [k, lbl, txt] of [['sd', 'Sugar Daddy:', 'Mann älter'], ['sm', 'Sugar Mom:', 'Frau älter']]) {
          const w = document.createElement('span');
          w.style.cssText = 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap';
          w.appendChild(mkToggle(G[k].on, '', (on) => { G[k].on = on; changed(); }));
          const n = document.createElement('input');
          n.type = 'number'; n.min = 1; n.max = 80; n.className = 'form-control jaf-num'; n.value = G[k].gap;
          n.addEventListener('change', () => { const x = Math.round(+n.value); if (x >= 1 && x <= 80) G[k].gap = x; changed(); });
          w.append('ab ', n, ` Jahren Altersunterschied (${txt})`);
          row(tb, lbl, w, k === 'sd' ? 'Zählt zu den Paaren: sichtbar mit „Visuelle Einstufung“, gesperrt mit „Ignorieren aktiv“.' : '');
        }
      }
      // 3: Bezeichnungen
      const nm = document.createElement('table'); nm.className = 'jaf-nm';
      nm.innerHTML = '<tr><th></th><th>Stufe 1</th><th>Stufe 2</th><th>Stufe 3</th></tr>';
      for (const [k, lbl] of [['one', 'Einzahl'], ['many', 'Mehrzahl']]) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${lbl}</td>`;
        for (let i = 0; i < 3; i++) {
          const td = document.createElement('td');
          const inp = document.createElement('input'); inp.className = 'form-control'; inp.value = G.names[k][i];
          inp.addEventListener('input', () => { G.names[k][i] = inp.value.trim() || G.names[k][i]; settingsDirty = true; refresh(); });
          td.appendChild(inp); tr.appendChild(td);
        }
        nm.appendChild(tr);
      }
      row(tb, 'Bezeichnungen:', nm, 'Stufe 3 erscheint in der Profilnotiz („… ignoriert am …“). Gleiche Mehrzahl-Bezeichnungen ergeben einen gemeinsamen Reiter in der Gästeliste.');
      // 4: Profiltypen (jeder Typ höchstens in einer Gruppe)
      const types = document.createElement('div');
      const unknown = Object.keys(getTypes()).filter((x) => !knownType(x));
      const list = Object.keys(KNOWN_TYPES).filter((x) => KNOWN_TYPES[x].includes(g)).concat(unknown);
      for (const ty of list) {
        const l = document.createElement('label'); l.className = 'jaf-cb';
        l.innerHTML = '<input type="checkbox"> <span></span>';
        l.querySelector('span').textContent = ty;
        const cb = l.querySelector('input');
        const fixed = FIXED_TYPES[ty] === g;
        cb.checked = fixed || (G.types || []).includes(ty);
        cb.disabled = fixed;
        if (!KNOWN_TYPES[ty]) l.title = 'Unbekannter Profiltyp (vom Skript gefunden)';
        cb.addEventListener('change', () => {
          for (const x of GROUP_KEYS) d.GROUPS[x].types = (d.GROUPS[x].types || []).filter((y) => y !== ty);
          if (cb.checked) d.GROUPS[g].types.push(ty);
          changed();
        });
        types.appendChild(l);
      }
      row(tb, 'Profiltypen:', types, 'Ein Typ gehört zu höchstens einer Gruppe; ein Haken hier entfernt ihn aus den anderen. Nicht zugeordnete Typen werden nicht bearbeitet.');
    }
    return { awoLabels, updAwo };
  }
  function awoRowLabel(d, g) {
    const v = g === 'p' ? d.GROUPS.p.src.Party.m : d.GROUPS[g].src.Party;
    return `Anwesenheitsquote der ${GROUP_LABELS[g]} bis ${v[0]} / ${v[1]} / ab ${v[1] + 1}:`;
  }
  function renderAwoSettings(d, section, row, refs) {
    const tb = section('AWO-Faktor');
    for (const g of GROUP_KEYS) {
      const w = document.createElement('span');
      for (let i = 0; i < 3; i++) {
        const n = document.createElement('input');
        n.type = 'number'; n.min = 0; n.max = 100; n.step = 1; n.className = 'form-control jaf-num jaf-awo-q';
        n.value = d.AWO.quota[g][i];
        n.addEventListener('input', () => { const x = Math.round(+n.value); if (Number.isFinite(x) && x >= 0 && x <= 100) { d.AWO.quota[g][i] = x; settingsDirty = true; } });
        w.append(n, ' % ');
        if (i < 2) w.append(' ');
      }
      const td = row(tb, awoRowLabel(d, g), w, '');
      refs.awoLabels[g] = td.previousElementSibling;
    }
    // Gewichtung: zwei volle Griffe; bei Frauen 0 % liegen sie bündig nebeneinander
    const W = d.AWO.weight;
    const box = document.createElement('div');
    const lbl = document.createElement('div'); lbl.className = 'jaf-wl';
    const showL = (v) => {
      lbl.innerHTML = '';
      const parts = [['Männer', 0, v[0]], ['Frauen', v[0], v[1]], ['Paare', v[1], 100]];
      for (const [n, a, b] of parts) {
        if (b - a < 14) continue; // nur, wenn Platz ist
        const s = document.createElement('span'); s.style.left = a + '%'; s.style.width = (b - a) + '%'; s.textContent = `${n} ${b - a} %`;
        lbl.appendChild(s);
      }
    };
    const v0 = [W.m, W.m + W.f];
    const sl = mkSlider('w', v0, (v) => { d.AWO.weight = { m: v[0], f: v[1] - v[0], p: 100 - v[1] }; settingsDirty = true; showL(v); });
    showL(v0);
    box.appendChild(lbl); box.appendChild(sl.el);
    row(tb, 'Gewichtung Männer / Frauen / Paare:', box, 'Anteil am gesamten Balken (zusammen immer 100 %). Anteil je Gruppe = erwartete Anwesende der Stufe 3 ÷ alle erwarteten Anwesenden; AWO = gewichtete Summe. Gruppen ohne Anmeldungen geben ihr Gewicht anteilig ab.');
  }
  // Kopfzeile: derzeit ignoriert / nach Anwenden (live aus dem Entwurf)
  let _infoTimer = 0;
  function renderSetInfo(c, d) {
    const box = document.createElement('div'); box.className = 'jaf-info';
    box.innerHTML = '<span>Derzeit ignoriert:</span><b class="jaf-i-cur"></b><span>Nach Anwenden der neuen Einstellungen zu ignorieren:</span><b class="jaf-i-new">…</b>';
    c.appendChild(box);
    const upd = () => {
      const lim = d.IGNORE_LIMIT;
      box.querySelector('.jaf-i-cur').textContent = `${ignCount().toLocaleString('de-DE')} / ${lim.toLocaleString('de-DE')}`;
      const p = planRules(d);
      const el = box.querySelector('.jaf-i-new');
      el.textContent = `${p.total.toLocaleString('de-DE')}${p.unclear.length ? '+' : ''} / ${lim.toLocaleString('de-DE')}`;
      el.style.color = p.total > lim ? '#e53935' : lim - p.total < 50 ? '#ffb020' : '';
      el.title = `kommen dazu: ${p.added.length} · fallen weg: ${p.removed.length} · unklar: ${p.unclear.length} · von Hand gesperrt: ${p.hand}`;
    };
    upd();
    return () => { clearTimeout(_infoTimer); _infoTimer = setTimeout(() => { try { upd(); } catch (e) { /* egal */ } }, 250); };
  }
  function renderSettingsPage() {
    if (!isSettingsPage()) return false;
    const c = document.getElementById('c');
    if (!c) return false;
    if (!settingsDraft) {
      settingsDraft = {};
      for (const k of SETTING_KEYS) settingsDraft[k] = cloneJ(CONFIG[k]);
      settingsDraft.autoDel = [];
    }
    document.title = opaT('Opa-Schutz - JOYclub');
    const tb = document.querySelector('.navigation_title_bar_title');
    if (tb) tb.textContent = opaT('Opa-Schutz');
    if (!window.__jafSettingsGuard) {
      window.__jafSettingsGuard = true;
      document.addEventListener('click', settingsGuardClick, true);
      window.addEventListener('beforeunload', settingsBeforeUnload);
    }
    const d = settingsDraft;
    const expOpen = !!c.__jafExp;
    c.innerHTML = '';
    c.className = c.className || 'col-lg-6 col-md-8 sp_bb clearfix';
    const h1 = document.createElement('h1'); h1.className = 'hide_for_mobile sp_bs'; h1.textContent = opaT('Opa-Schutz'); c.appendChild(h1);
    const bc = document.createElement('ol');
    bc.className = 'breadcrumb breadcrumb_ui';
    bc.innerHTML = opaT(`<li class="forelast"><a href="${location.origin}/edit/"><span>Profil verwalten</span></a></li><li class="last"><div><span>Opa-Schutz</span></div></li>`);
    c.appendChild(bc);
    let saved = false;
    try { saved = sessionStorage.getItem('jaf_settings_saved') === '1'; sessionStorage.removeItem('jaf_settings_saved'); } catch (e) { /* egal */ }
    if (saved || c.__jafSavedMsg) {
      c.__jafSavedMsg = true;
      const ok = document.createElement('div');
      ok.className = 'c_hint_lo';
      ok.style.cssText = 'background:#2e7d32;color:#fff;padding:8px 12px;border-radius:6px;margin:8px 0';
      ok.textContent = 'Einstellungen gespeichert.';
      c.appendChild(ok);
    }
    const changed = () => { settingsDirty = true; renderSettingsPage(); };
    ensureSetCss();
    const refreshInfo = renderSetInfo(c, d);
    const deviates = (k) => JSON.stringify(d[k]) !== JSON.stringify(SOURCE_DEFAULTS[k]);
    const section = (title, extraBtn) => {
      const h = document.createElement('div');
      h.className = 'h2';
      h.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';
      h.innerHTML = '<h2 class="m0"></h2>';
      h.querySelector('h2').textContent = title;
      if (extraBtn) h.appendChild(extraBtn);
      c.appendChild(h);
      const t = document.createElement('table');
      t.className = 'table_row_xs';
      t.innerHTML = '<tbody></tbody>';
      c.appendChild(t);
      return t.querySelector('tbody');
    };
    const row = (tbody, label, ctrl, hint, opt = {}) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'td_fh top';
      th.textContent = label;
      if (opt.key && deviates(opt.key)) { const sp = document.createElement('span'); sp.textContent = ' °'; sp.title = 'weicht vom Quelltext ab'; sp.style.color = '#ffb300'; th.appendChild(sp); }
      const td = document.createElement('td');
      td.className = 'td_fc';
      if (typeof ctrl === 'string') td.innerHTML = ctrl; else td.appendChild(ctrl);
      if (opt.key && deviates(opt.key)) {
        const a = document.createElement('a');
        a.href = '#'; a.className = 'jaf-src-reset'; a.textContent = 'Quelltext-Wert';
        a.title = `Wert aus dem Quelltext: ${JSON.stringify(SOURCE_DEFAULTS[opt.key])}`;
        a.style.cssText = 'margin-left:10px;font-size:12px';
        a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); d[opt.key] = cloneJ(SOURCE_DEFAULTS[opt.key]); changed(); });
        td.appendChild(a);
      }
      if (hint) { const h = document.createElement('div'); h.className = 'c_hint_lo sp_ts'; h.innerHTML = hint; td.appendChild(h); }
      if (opt.red) { th.style.color = '#e53935'; td.style.color = '#e53935'; td.querySelectorAll('.c_hint_lo').forEach((x) => { x.style.color = '#e53935'; }); }
      tr.appendChild(th); tr.appendChild(td); tbody.appendChild(tr);
      return td;
    };
    const onOff = (k) => {
      const s = document.createElement('select');
      s.className = 'f_select';
      s.innerHTML = '<option value="1">An</option><option value="0">Aus</option>';
      s.value = d[k] ? '1' : '0';
      s.addEventListener('change', () => { d[k] = s.value === '1'; changed(); });
      return s;
    };
    const num = (k, unit, min, max) => {
      const w = document.createElement('span');
      w.innerHTML = `<input type="number" class="form-control" style="display:inline-block;width:100px" min="${min}" max="${max}"> ${unit}`;
      const i = w.querySelector('input');
      i.value = d[k];
      i.addEventListener('change', () => { const v = Math.round(+i.value); if (Number.isFinite(v) && v >= min && v <= max) d[k] = v; changed(); });
      return w;
    };
    // ---- Gruppen: Männer, Frauen, Paare ----
    const grpRefs = renderGroupSettings(c, d, section, row, changed, refreshInfo);
    let tb2;
    // ---- Whitelist ----
    const wlBtn = document.createElement('j-button');
    wlBtn.setAttribute('variant', 'secondary'); wlBtn.setAttribute('role', ''); wlBtn.setAttribute('type', 'button');
    wlBtn.className = 'jaf-wl-btn';
    wlBtn.textContent = 'Whitelist bearbeiten';
    wlBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); whitelistPopup(); });
    tb2 = section('Whitelist', wlBtn);
    const ownN = Object.values(d.WHITELIST).reduce((n, l) => n + l.length, 0);
    const autoN = Object.keys(getDynWhite()).filter((k) => !d.autoDel.includes(k)).length;
    const sum = document.createElement('div');
    sum.className = 'jaf-wl-sum';
    sum.textContent = `Eigene Whitelist: ${ownN} Namen in ${Object.keys(d.WHITELIST).length} Gruppen · Automatisch gefunden: ${autoN} Namen`;
    row(tb2, 'Nie ignorieren:', sum, '', { key: 'WHITELIST' });
    // ---- AWO-Faktor ----
    renderAwoSettings(d, section, row, grpRefs);
    // ---- Experten-Einstellungen ----
    const exp = document.createElement('div');
    exp.className = 'jaf-exp-toggle';
    exp.style.cssText = 'margin:22px 0 4px;padding:10px 12px;border-radius:8px;background:rgba(127,127,127,.15);font-weight:bold;cursor:pointer;user-select:none';
    exp.textContent = `${expOpen ? '▾' : '▸'} Experten-Einstellungen`;
    exp.addEventListener('click', () => { c.__jafExp = !c.__jafExp; renderSettingsPage(); });
    c.appendChild(exp);
    if (expOpen) {
      tb2 = section('Ignorierliste');
      const rk = document.createElement('ul');
      rk.style.cssText = 'list-style:none;margin:0;padding:0';
      d.SOURCE_RANK.forEach((q, i) => {
        const li = document.createElement('li');
        li.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;margin:3px 0;border-radius:6px;background:rgba(127,127,127,.15);max-width:280px';
        li.title = SOURCE_TIPS[q] || SOURCE_LABELS[q] || q;
        li.innerHTML = `<b style="opacity:.6;width:18px">${i + 1}.</b><span style="flex:1"></span>` +
          '<button type="button" class="jaf-up" title="nach oben" style="border:0;background:none;color:inherit;cursor:pointer;padding:0 4px">▲</button>' +
          '<button type="button" class="jaf-dn" title="nach unten" style="border:0;background:none;color:inherit;cursor:pointer;padding:0 4px">▼</button>';
        li.querySelector('span').textContent = SOURCE_LABELS[q] || q;
        const mv = (dir) => { const j = i + dir; if (j < 0 || j >= d.SOURCE_RANK.length) return; const a = d.SOURCE_RANK.slice(); [a[i], a[j]] = [a[j], a[i]]; d.SOURCE_RANK = a; changed(); };
        li.querySelector('.jaf-up').addEventListener('click', (e) => { e.preventDefault(); mv(-1); });
        li.querySelector('.jaf-dn').addEventListener('click', (e) => { e.preventDefault(); mv(1); });
        if (i === 0) li.querySelector('.jaf-up').style.visibility = 'hidden';
        if (i === d.SOURCE_RANK.length - 1) li.querySelector('.jaf-dn').style.visibility = 'hidden';
        rk.appendChild(li);
      });
      row(tb2, 'Rangfolge der Quellen:', rk, 'Eine niedrigere Quelle verdrängt nie eine höhere. Gilt ab dem Speichern für alle künftigen Entscheidungen; bestehende Sperren bleiben unverändert. Maus über eine Quelle zeigt die Erklärung.', { key: 'SOURCE_RANK' });
      row(tb2, 'Limit:', num('IGNORE_LIMIT', 'Einträge', 10, 100000), `JOYclub behält nur die letzten ${Number(d.IGNORE_LIMIT).toLocaleString('de-DE')} Sperren.`, { key: 'IGNORE_LIMIT', red: true });
      tb2 = section('API-Rekorder');
      row(tb2, 'API-Rekorder:', apiRecControl(), 'Schneidet ab dem nächsten Seitenaufruf mit, welche Schnittstellen JOYclub selbst benutzt (je Adresse 2 Beispiele, geschwärzt: E-Mail, Zugangsdaten, Nachrichten- und Profiltexte, Telefonnummern, Geodaten bis auf die Stadt). Der Export dient dazu, Seiten-Lösungen des Skripts durch Schnittstellen zu ersetzen. Wirkt sofort, ohne „Speichern“.');
      tb2 = section('Abgleich mit poppen.de');
      { const bs = document.createElement('div'); bs.className = 'jaf-bk-status'; bs.textContent = bkStatusText(); const rf = setInterval(() => { if (!bs.isConnected) { clearInterval(rf); return; } bs.textContent = bkStatusText(); }, 2000);
        row(tb2, 'Briefkasten:', bs, 'Gleicht Fickliste und Textvorlagen automatisch mit dem Skript auf poppen.de ab (über eine leere Seite auf GitHub Pages, die nur die beiden Skripte lesen können). Rückfragen erscheinen beim nächsten Öffnen der Fickliste bzw. der Textvorlagen.'); }
      tb2 = section('Betrieb');
      row(tb2, 'Debug-Ausgaben:', onOff('DEBUG'), 'Zusätzliche Meldungen in der Browser-Konsole; jedes Element wird vor dem Klick markiert.', { key: 'DEBUG' });
      row(tb2, 'Testlauf:', onOff('DRY_RUN'), 'Spielt alles durch, ignoriert aber niemanden.', { key: 'DRY_RUN' });
      row(tb2, 'Erster Scan Profilbesucher/Interaktionen:', num('MYJOY_FIRST_MAX', 'Einträge', 10, 100000), 'Beim ersten Scan von „Profilbesuche“ bzw. „Mögen mich“ höchstens so viele Einträge prüfen.', { key: 'MYJOY_FIRST_MAX' });
    }
    // ---- Buttons ----
    const bw = document.createElement('div');
    bw.className = 'td_button td_button_xs sp_ts';
    bw.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:18px';
    const save = document.createElement('j-button');
    save.className = 'sp_bs jaf-save'; save.setAttribute('variant', 'primary'); save.setAttribute('role', ''); save.setAttribute('type', 'button');
    save.innerHTML = '<span class="glyphicons glyphicons-floppy-disk" aria-hidden="true"></span>Speichern';
    save.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (rulesRelevantChange(d)) { saveRulesPopup(); return; }
      commitSettings();
      try { sessionStorage.setItem('jaf_settings_saved', '1'); } catch (err) { /* egal */ }
      location.reload();
    });
    const cancel = document.createElement('j-button');
    cancel.className = 'sp_ls sp_bs jaf-cancel'; cancel.setAttribute('variant', 'secondary'); cancel.setAttribute('role', ''); cancel.setAttribute('type', 'button');
    cancel.textContent = 'Abbrechen';
    cancel.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); settingsDirty = false; location.href = location.origin + '/edit/'; });
    bw.appendChild(save); bw.appendChild(cancel);
    c.appendChild(bw);
    const foot = document.createElement('div');
    foot.className = 'clear sp_b';
    foot.innerHTML = '<span class="c_hint_lo">° = weicht vom Quelltext ab</span>';
    c.appendChild(foot);
    insertMenuEntries();
    return true;
  }
  window.addEventListener('hashchange', () => {
    if (isSettingsPage()) { settingsDraft = null; renderSettingsPage(); }
    else if (cleanPath(location.pathname) === cleanPath(SETTINGS_PATH) && document.querySelector('#c h1') && document.querySelector('#c h1').textContent === opaT('Opa-Schutz')) location.reload();
  });

  // ---- Popup „Whitelist bearbeiten“ ----
  function whitelistPopup() {
    const d = settingsDraft;
    let groups = cloneJ(d.WHITELIST);          // { Gruppe: [Namen] }
    let autoDel = d.autoDel.slice();
    const dyn = getDynWhite();
    document.getElementById('jaf-wl-popup')?.remove();
    const ov = document.createElement('div');
    ov.id = 'jaf-wl-popup';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.style.cssText = POPUP_BOX_CSS;
    ov.appendChild(box);
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    function onKey(e) { if (e.key === 'Escape' && !document.getElementById('jaf-ask-popup')) { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey, true);
    const css = '.jaf-wl-lt{font-weight:bold;margin:14px 0 4px}.jaf-wl-cnt{opacity:.6;font-weight:normal}' +
      '.jaf-wl-list{background:#16181a;border-radius:8px;padding:6px}.jaf-wl-add{display:flex;gap:6px;margin-bottom:4px}' +
      '.jaf-wl-add input,.jaf-wl-ren{flex:1;min-width:0;background:#24272a;color:#eee;border:1px solid #3a3e42;border-radius:6px;padding:6px 8px;font:14px system-ui}' +
      '.jaf-wl-sv{background:#4a4f53;color:#fff;border:0;border-radius:6px;padding:6px 12px;font:bold 13px system-ui;cursor:pointer}' +
      '.jaf-wl-it{display:flex;align-items:center;gap:10px;padding:5px 8px;background:#24272a;border-radius:6px;margin:3px 0}.jaf-wl-nm{flex:1;min-width:0;overflow-wrap:anywhere}' +
      '.jaf-wl-x{color:#ff8080;font-weight:bold;cursor:pointer;border:0;background:none;font-size:15px}.jaf-wl-r{color:#bbb;cursor:pointer;border:0;background:none;font-size:15px}' +
      '.jaf-wl-err{color:#ff8a80;font-size:12px;margin:2px 4px 4px}.jaf-wl-sm{opacity:.6;font-size:12px}';
    const lower = (s2) => norm(s2);
    const groupOf = (name) => Object.keys(groups).find((g) => groups[g].some((n) => lower(n) === lower(name)));
    const render = () => {
      const scroll = box.scrollTop;
      box.innerHTML = `<style>${css}</style><div style="font:bold 20px/1.3 system-ui;margin-bottom:6px">Whitelist bearbeiten</div><div class="jaf-wl-body"></div>` +
        '<div class="jaf-wl-btns" style="display:flex;flex-direction:column;gap:10px;margin-top:16px"></div>';
      const body = box.querySelector('.jaf-wl-body');
      const list = (title, count, ph, onAdd) => {
        const lt = document.createElement('div'); lt.className = 'jaf-wl-lt';
        lt.innerHTML = '<span></span> <span class="jaf-wl-cnt"></span>';
        lt.firstChild.textContent = title; lt.querySelector('.jaf-wl-cnt').textContent = `(${count})`;
        body.appendChild(lt);
        const l = document.createElement('div'); l.className = 'jaf-wl-list';
        if (onAdd) {
          const add = document.createElement('div'); add.className = 'jaf-wl-add';
          add.innerHTML = '<input type="text"><button type="button" class="jaf-wl-sv">Speichern</button>';
          const inp = add.querySelector('input'); inp.placeholder = ph;
          const err = document.createElement('div'); err.className = 'jaf-wl-err'; err.style.display = 'none';
          const go = () => { const m = onAdd(inp.value.trim()); if (m) { err.textContent = m; err.style.display = ''; inp.focus(); } };
          add.querySelector('button').addEventListener('click', go);
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
          l.appendChild(add); l.appendChild(err);
        }
        body.appendChild(l);
        return l;
      };
      const item = (l, name, sub, onDel, onRen) => {
        const it = document.createElement('div'); it.className = 'jaf-wl-it';
        it.innerHTML = '<span class="jaf-wl-nm"></span>';
        const nm = it.querySelector('.jaf-wl-nm');
        nm.textContent = name;
        if (sub) { const s2 = document.createElement('div'); s2.className = 'jaf-wl-sm'; s2.textContent = sub; nm.appendChild(s2); }
        if (onRen) {
          const r = document.createElement('button'); r.type = 'button'; r.className = 'jaf-wl-r'; r.title = 'Umbenennen'; r.textContent = '✎';
          r.addEventListener('click', () => {
            const inp = document.createElement('input'); inp.className = 'jaf-wl-ren'; inp.value = name;
            const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'jaf-wl-sv'; ok.textContent = 'OK';
            const err = document.createElement('div'); err.className = 'jaf-wl-err'; err.style.display = 'none';
            it.innerHTML = ''; it.appendChild(inp); it.appendChild(ok); it.after(err);
            const go = () => { const m = onRen(inp.value.trim()); if (m) { err.textContent = m; err.style.display = ''; inp.focus(); } };
            ok.addEventListener('click', go);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); render(); } });
            inp.focus(); inp.select();
          });
          it.appendChild(r);
        }
        const x = document.createElement('button'); x.type = 'button'; x.className = 'jaf-wl-x'; x.title = 'Löschen'; x.textContent = '✕';
        x.addEventListener('click', onDel);
        it.appendChild(x);
        l.appendChild(it);
      };
      // 1. Gruppen
      const gNames = sortDe(Object.keys(groups));
      const gl = list('Eigene Whitelist-Gruppen', gNames.length, 'Neue Gruppe', (v) => {
        if (!v) return 'Bitte einen Namen eingeben.';
        const ex = Object.keys(groups).find((g) => lower(g) === lower(v));
        if (ex) return `Gruppe „${ex}“ gibt es schon.`;
        groups[v] = []; render(); return '';
      });
      for (const g of gNames) {
        item(gl, g, '', async () => {
          const c2 = await askPopup({ title: 'Gruppe löschen?', warn: true,
            lines: [`Du löschst die Gruppe „${g}“.`, `Damit werden auch alle ihre ${groups[g].length} Mitglieder von der Whitelist gelöscht.`],
            buttons: [{ label: 'Gruppe mit Mitgliedern löschen', value: 'del' }, { label: 'Abbrechen', value: null, focus: true }] });
          if (c2 === 'del') { delete groups[g]; render(); }
        }, (v) => {
          if (!v) return 'Bitte einen Namen eingeben.';
          const ex = Object.keys(groups).find((x) => x !== g && lower(x) === lower(v));
          if (ex) return `Gruppe „${ex}“ gibt es schon.`;
          const o = {};
          for (const k of Object.keys(groups)) o[k === g ? v : k] = groups[k];
          groups = o; render(); return '';
        });
      }
      // 2. je Gruppe die Mitglieder
      for (const g of gNames) {
        const names = sortDe(groups[g]);
        const ml = list(`Gruppe „${g}“`, names.length, 'Benutzername', (v) => {
          if (!v) return 'Bitte einen Benutzernamen eingeben.';
          const in2 = groupOf(v);
          if (in2) return `Steht schon in „${in2}“.`;
          groups[g].push(v);
          const k = lower(v);
          if (dyn[k] && !autoDel.includes(k)) autoDel.push(k); // eigener Eintrag hat Vorrang
          render(); return '';
        });
        for (const n of names) item(ml, n, '', () => { groups[g] = groups[g].filter((x) => x !== n); render(); });
      }
      // 3. automatisch gefunden
      const autos = Object.entries(dyn).filter(([k]) => !autoDel.includes(k)).sort((a, b) => a[1].name.localeCompare(b[1].name, 'de', { sensitivity: 'base' }));
      const al = list('Automatisch gefunden', autos.length, '', null);
      al.style.maxHeight = '220px'; al.style.overflow = 'auto';
      for (const [k, e] of autos) {
        const since = e.since ? fmtDay(Date.parse(e.since)) : '';
        item(al, e.name, [dynReasons(e).join('; '), since].filter(Boolean).join(' · '), () => { autoDel.push(k); render(); });
      }
      if (!autos.length) { const p = document.createElement('div'); p.className = 'jaf-wl-sm'; p.style.padding = '4px 8px'; p.textContent = 'keine'; al.appendChild(p); }
      const bs = box.querySelector('.jaf-wl-btns');
      bs.appendChild(popupButton('Übernehmen', () => {
        const o = {};
        for (const g of sortDe(Object.keys(groups))) o[g] = sortDe(groups[g]);
        d.WHITELIST = o; d.autoDel = autoDel;
        settingsDirty = true; close(); renderSettingsPage();
      }));
      const cancel = popupButton('Abbrechen', close);
      bs.appendChild(cancel);
      box.scrollTop = scroll;
      if (!box.__init) { box.__init = true; setTimeout(() => cancel.focus(), 0); }
    };
    document.body.appendChild(ov);
    render();
  }

  // =====================================================================
  // ---------- Fickliste ----------
  // Button neben „ClubMail“ (fünf Zustände), Popup „Ficklisteneintragung“ (Profilnotiz, Treffen, Ignorieren),
  // Profil-Archiv (Stände mit Profilbild), Seite „Meine Fickliste“, externe Ficks, Löschmeldungen aus der ClubMail.
  // Speicher: jaf_fl = { pid: Person }, jaf_fla_<pid> = [Stand], jaf_fli_<bild> = data:-URL des Profilbilds.
  // pid = Profil-ID bzw. „x-<slug>“ für externe Ficks.
  // =====================================================================
  const K_FL = 'jaf_fl';
  const K_FLA = 'jaf_fla_';
  const K_FLI = 'jaf_fli_';
  const K_FL_LVL = 'jaf_fl_lvl2';     // Stufe 2 (Seiten-Snapshot) – per Strg+Klick auf den Button
  const K_FL_CTX = 'jaf_fl_ctx';      // Party, aus deren Gästeliste zuletzt ein Profil geöffnet wurde
  const K_FL_CM = 'jaf_fl_cm';        // bereits ausgewertete JOY-Team-Löschmeldungen
  const K_FL_UNKNOWN = 'jaf_fl_unknown'; // unklare Profilzustände (Lebendprüfung)
  const FL_ST = {
    will: { label: 'Will ich', menu: 'Will ich ficken' },
    gef: { label: 'Gefickt', menu: 'Gefickt' },
    nein: { label: 'Nein, danke!', menu: 'Nein, danke!' },
    nie: { label: 'Nie wieder!', menu: 'Nie wieder!' },
  };
  const FL_ORDER = ['will', 'gef', 'nie', 'nein'];
  const FL_ST_DEFAULT = ['will', 'gef', 'nie']; // „Nein, danke!“ beim ersten Aufruf/Zurücksetzen aus
  const flLabel = (st) => (FL_ST[st] ? FL_ST[st].label : 'Ficken?');
  const getFl = () => GM_getValue(K_FL, {}) || {};
  const setFl = (m) => GM_setValue(K_FL, m);
  const flGet = (pid) => getFl()[pid] || null;
  function flPut(p) {
    const m = getFl();
    const old = m[p.id];
    if (p.__keepStatusAt) delete p.__keepStatusAt;
    else if (!old ? p.status : (old.status || '') !== (p.status || '')) p.statusAt = Date.now();
    p.updated = Date.now(); m[p.id] = p; setFl(m); return p;
  }
  const flStands = (pid) => GM_getValue(K_FLA + pid, []) || [];
  const flSetStands = (pid, l) => GM_setValue(K_FLA + pid, l);
  const flImg = (id) => (id ? GM_getValue(K_FLI + id, '') : '');
  const flIsExt = (pid) => /^x-/.test(String(pid));
  const flPath = (p) => (flIsExt(p.id) ? `${flOwnPath()}?fl=${encodeURIComponent(p.id)}` : (p.path || `/profile/${p.id}.html`));
  const flUrl = (p) => location.origin + flPath(p);
  const flDead = (p) => !!p && (p.live === 'dead' || (flIsExt(p.id) && p.wasJoy));
  const pad2f = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
  const fmtDT = (t) => { const d = new Date(t); return `${pad2f(d.getDate())}.${pad2f(d.getMonth() + 1)}.${d.getFullYear()} ${pad2f(d.getHours())}:${pad2f(d.getMinutes())}`; };
  const meetTs = (m) => { const t = Date.parse(`${m.date || '1970-01-01'}T${m.time || '00:00'}:00`); return Number.isFinite(t) ? t : 0; };
  const flMeetsSorted = (p, asc = false) => (p.meets || []).slice().sort((a, b) => (asc ? 1 : -1) * (meetTs(a) - meetTs(b)));
  const flHist = (p, why) => { (p.hist = p.hist || []).push({ ts: Date.now(), why }); };
  const flNewId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---- Symbole (Ficken-Icon; Quelle: SVG Repo „sex-doggy“) ----
  const FL_D = 'M65.9,26.7c0-13.6,11-24.6,24.6-24.6s24.6,11,24.6,24.6s-11,24.6-24.6,24.6S65.9,40.3,65.9,26.7z M254,191.2c0,8.7-7.1,15.8-15.8,15.8h-78.8c-8.7,0-15.8-7.1-15.8-15.8v-27.5H74.8v30.4c0,7.1-5.7,12.8-12.8,12.8H14.8c-7.1,0-12.8-5.7-12.8-12.8s5.7-12.8,12.8-12.8h34.5c0,0,0.1-36.7,0.1-37.3c-0.4-7.9,5.2-14.9,13.1-16.3l45.9-7.7c0,0,0-59.2,0-59.2c0-11.7,9.5-21.3,21.3-21.3c3.7,0,7.2,0.9,10.2,2.6c8.4,4.5,41.9,29.7,61.1,44c8.8,6.6,13.9,16.9,13.9,27.8l0.1,61.4h23.3C246.9,175.4,254,182.5,254,191.2z M183.5,175.4l-0.2-36c0-10.4-4.8-20.1-13-26.5L134,84.7v31.1l10.9-1.8c0,0,0.1,0,0.1,0c7.5-1.2,15.2,0.9,21,5.8c5.8,4.9,9.2,12.1,9.3,19.7c0,0.1,0,0.1,0,0.2v35.7h7.9H183.5z M16.5,140.3c12.4,5.6,26.3-0.3,32.6-12.3c8-15.5,4.5-33.1-2.4-42.9c0,0,0,0,0,0c-4.8,5.8-12.2,7.6-19.6,8.1C15.3,94,8.4,98.4,4.2,107.7C-1.4,120.1,4.1,134.7,16.5,140.3z';
  const FL_RED = '#e01b1b';
  // kind: '' (Umriss dünn = inaktiv) | will | gef | nein | nie | trash; opt: { size, color, shadow }
  function flIcon(kind, opt = {}) {
    const size = opt.size || 20;
    const sh = opt.shadow === false ? '' : 'filter:drop-shadow(1px 2px 1.5px rgba(0,0,0,.7));';
    const st = `width:${size}px;height:${size}px;flex:none;vertical-align:middle;${sh}`;
    if (kind === 'trash') {
      return `<svg class="jaf-fl-svg" viewBox="0 0 24 24" style="${st}color:${opt.color || 'currentColor'}" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9zm4 2v9h1.6v-9H10zm3.4 0v9H15v-9h-1.6z"/></svg>`;
    }
    const fill = `<path fill="currentColor" d="${FL_D}"/>`;
    const line = `<path fill="none" stroke="currentColor" stroke-width="${kind === 'nein' ? 12 : 9}" stroke-linejoin="round" d="${FL_D}"/>`;
    const col = opt.color || (kind === 'gef' && opt.redGef ? FL_RED : 'currentColor');
    if (kind === 'nein' || kind === 'nie') {
      return `<svg class="jaf-fl-svg" viewBox="-48 -71.5 352 352" style="${st}color:${col}" aria-hidden="true">` +
        `<g transform="translate(128 104.5) scale(.78) translate(-128 -104.5)">${kind === 'nein' ? line : fill}</g>` +
        `<circle cx="128" cy="104.5" r="158" fill="none" stroke="${FL_RED}" stroke-width="22"/>` +
        `<line x1="16.3" y1="216.2" x2="239.7" y2="-7.2" stroke="${FL_RED}" stroke-width="22" stroke-linecap="round"/></svg>`;
    }
    return `<svg class="jaf-fl-svg" viewBox="${kind ? '-4 -4 264 217' : '-8 -8 272 225'}" style="${st}color:${col}" aria-hidden="true">${kind ? fill : line}</svg>`;
  }
  // kleines Symbol für Karten/Listen (Zustand ≠ inaktiv)
  const flBadgeIcon = (st, size = 16) => flIcon(st, { size, redGef: true });

  // ---- Seiten-Erkennung ----
  const flOverviewPage = () => /^\/edit\/homepage\/?$/.test(location.pathname) && /[?&]fickliste(=|&|$)/.test(location.search);
  const flExternPage = () => /^\/edit\/homepage\/?$/.test(location.pathname) && /[?&]fickextern=/.test(location.search);
  const flExternSlug = () => decodeURIComponent((location.search.match(/[?&]fickextern=([^&]+)/) || [])[1] || '');
  const flArchivParam = () => +((location.search.match(/[?&]archiv=(\d+)/) || [])[1] || 0);
  const flOverviewUrl = (filter) => `${location.origin}/edit/homepage/?fickliste${filter ? '&status=' + filter : ''}`;
  // Profil der aktuellen Seite als Fickliste-Kandidat (Mann, Frau, Paar, Transperson …; nicht das eigene Profil)
  function flPagePid() {
    if (flViewerPid()) return flViewerPid();
    if (flExternPage()) return 'x-' + flExternSlug();
    if (!isProfilePage()) return '';
    const id = idOf(location.pathname);
    if (!id || isOwnProfile()) return '';
    return id;
  }
  function flSelectable() {
    if (flViewerPid()) return !!flGet(flViewerPid());
    if (flExternPage()) return !!flGet('x-' + flExternSlug());
    if (!flPagePid()) return false;
    if (flGet(flPagePid())) return true;
    const t = profileType();
    return !!t && !!knownType(String(t).split('|')[0]);
  }

  // ---- Hilfen für Popups ----
  const FL_BOX_CSS = POPUP_BOX_CSS.replace('max-width:440px', 'max-width:600px');
  const FL_INPUT_CSS = 'background:#2a2c31;border:1px solid #4a4f53;border-radius:6px;color:#fff;padding:6px 8px;font:14px system-ui,sans-serif;box-sizing:border-box';
  function flOverlay(id) {
    document.getElementById(id)?.remove();
    const ov = document.createElement('div');
    ov.id = id;
    ov.className = 'jaf-fl-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.style.cssText = FL_BOX_CSS;
    ov.appendChild(box);
    document.body.appendChild(ov);
    return { ov, box };
  }
  function flBtn(label, fn, primary = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `border:${primary ? '0' : '1px solid #6b6f76'};border-radius:20px;background:${primary ? '#c71b1b' : 'transparent'};color:#fff;` +
      'font:bold 14px system-ui,sans-serif;padding:8px 18px;cursor:pointer';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); });
    return b;
  }
  function flEl(tag, css, html) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function flToast(text, ms = 2500) {
    const t = flEl('div', 'position:fixed;left:50%;top:90px;transform:translateX(-50%);z-index:2147483647;background:#20242c;color:#fff;border-left:4px solid #2f6fd6;' +
      'border-radius:8px;padding:10px 16px;font:bold 14px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.5)');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  // rotes Popup „nicht mehr auf JOYclub“ (mittig, 10 s, mit Schließen-Knopf)
  function flDeadPopup(p) {
    document.getElementById('jaf-fl-dead')?.remove();
    const ext = p && flIsExt(p.id) && !p.wasJoy;
    const ov = flEl('div', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;pointer-events:none');
    ov.id = 'jaf-fl-dead';
    const box = flEl('div', 'pointer-events:auto;position:relative;background:#3a1c1c;border:1px solid #c71b1b;border-left:6px solid #c71b1b;border-radius:10px;' +
      'padding:18px 46px 18px 28px;color:#fff;text-align:center;font:15px/1.5 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6);max-width:520px');
    box.innerHTML = ext ? '<b style="display:block;font-size:17px">Externer Kontakt</b><span style="color:#e8c9c9">Kein JOYclub-Profil – du betrachtest deine eigene Seite zu dieser Person.</span>'
      : '<b style="display:block;font-size:17px">Dieser Benutzer ist nicht mehr auf JOYclub</b><span style="color:#e8c9c9">Du betrachtest eine statische Kopie seines alten Profils.</span>';
    const x = flEl('button', 'position:absolute;top:8px;right:10px;background:none;border:0;color:#e8c9c9;font:20px system-ui;cursor:pointer', '✕');
    x.title = 'Schließen';
    x.addEventListener('click', () => ov.remove());
    box.appendChild(x);
    ov.appendChild(box);
    document.body.appendChild(ov);
    setTimeout(() => ov.remove(), 10000);
  }
  // Eingabe-Popup (ein Textfeld)
  function flPrompt(title, lines, value = '', okLabel = 'OK') {
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-prompt');
      box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:10px', escHtml(title)));
      for (const l of lines) box.appendChild(flEl('p', 'margin:0 0 8px', escHtml(l)));
      const inp = flEl('input', FL_INPUT_CSS + ';width:100%;margin:6px 0 14px');
      inp.value = value;
      box.appendChild(inp);
      const row = flEl('div', 'display:flex;gap:10px;justify-content:flex-end');
      const done = (v) => { ov.remove(); resolve(v); };
      row.appendChild(flBtn('Abbrechen', () => done(null)));
      row.appendChild(flBtn(okLabel, () => done(inp.value.trim()), true));
      box.appendChild(row);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value.trim()); if (e.key === 'Escape') done(null); });
      setTimeout(() => inp.focus(), 50);
    });
  }

  // ---- Profil auslesen (für das Archiv) ----
  function flBestSrc(srcset) {
    let best = '', bw = 0;
    for (const part of String(srcset || '').split(',')) {
      const m = part.trim().match(/^(\S+)\s+(\d+)w$/);
      if (m && +m[2] > bw) { bw = +m[2]; best = m[1]; }
    }
    return best;
  }
  function flProfileImgUrl(doc = document) {
    const scopes = [...doc.querySelectorAll('j-avatar')].filter((a) => a.querySelector('[data-img_id]'));
    for (const sc of scopes) {
      const srcs = [...sc.querySelectorAll('source')];
      const webp = srcs.find((s) => /webp/.test(s.getAttribute('type') || '')) || srcs[0];
      const u = webp && flBestSrc(webp.getAttribute('srcset') || webp.getAttribute('data-srcset'));
      if (u && !/\/_\.gif/.test(u)) return u;
      const img = sc.querySelector('img.core-img');
      if (img && img.src && !/^data:|\/_\.gif/.test(img.src)) return img.src;
    }
    const og = doc.querySelector('meta[property="og:image"]');
    return og ? og.getAttribute('content') || '' : '';
  }
  const flImgKey = (u) => String(u || '').replace(/[?#].*$/, '');
  function flSections(doc = document) {
    const out = [], seen = new Set();
    for (const h of doc.querySelectorAll('main h2.profile-headline, main .profile-headline')) {
      const sec = h.closest('section') || h.parentElement;
      if (!sec || sec.closest('.jaf-fl-block, .jaf-fl-archive')) continue;
      const head = (h.textContent || '').replace(/\s+/g, ' ').trim();
      const body = [...sec.querySelectorAll('p, .profile-description__text')].map((p) => (p.innerText || p.textContent || '').trim()).filter(Boolean).join('\n\n');
      if (!head || !body || seen.has(head)) continue;
      seen.add(head);
      out.push({ h: head, t: body });
    }
    return out;
  }
  function flCollect(doc = document) {
    const t = ((doc.querySelector('title') || {}).textContent || '').trim();
    const tag = (t.match(/♥\s*(.*)$/) || [])[1] || '';
    const nh = noteHost();
    return {
      nick: profileName() || (t.split('♥')[0] || '').trim(),
      type: profileType(),
      ages: profileAges(),
      place: profilePlace(doc),
      tagline: tag.replace(/^[^-]+-\s*[^-]+-\s*/, '').trim() || tag,
      sed: parseSedCards(doc),
      secs: [...flDescSections(doc), ...flSections(doc).filter((x) => !['Das mag ich', 'Das mag ich nicht'].includes(x.h))],
      bs: flBsProps(doc),
      prefs: flPrefs(doc),
      pnote: nh ? (nh.getAttribute('value') || '').trim() : '',
      imgUrl: flProfileImgUrl(doc),
    };
  }
  // Seiten-Snapshot (Stufe 2): Profilbereich inkl. Shadow DOM
  function flPageHtml() {
    const main = document.querySelector('main.profile-container') || document.querySelector('main');
    if (!main) return '';
    const clone = main.cloneNode(true);
    const roots = [];
    const walk = (el) => { if (el.shadowRoot) roots.push(el.shadowRoot); for (const c of el.children) walk(c); if (el.shadowRoot) for (const c of el.shadowRoot.children) walk(c); };
    walk(main);
    try {
      if (typeof main.getHTML === 'function') {
        const h = main.getHTML({ serializableShadowRoots: true, shadowRoots: roots });
        return `<main class="${escHtml(main.className)}">${h}</main>`;
      }
    } catch (e) { /* älterer Browser */ }
    clone.querySelectorAll('[class*="jaf-"]').forEach((e) => e.remove());
    return clone.outerHTML;
  }
  // Bild als data:-URL holen (fremde Domain → GM_xmlhttpRequest)
  function flFetchImage(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(''); return; }
      const done = (blob) => { if (!blob) { resolve(''); return; } const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || '')); fr.onerror = () => resolve(''); fr.readAsDataURL(blob); };
      if (typeof GM_xmlhttpRequest === 'function') {
        try {
          GM_xmlhttpRequest({ method: 'GET', url, responseType: 'blob', timeout: 30000,
            onload: (r) => done(r.status >= 200 && r.status < 300 ? r.response : null), onerror: () => resolve(''), ontimeout: () => resolve('') });
          return;
        } catch (e) { /* weiter mit fetch */ }
      }
      fetch(url).then((r) => (r.ok ? r.blob() : null)).then(done).catch(() => resolve(''));
    });
  }
  async function flStoreImage(url) {
    const data = await flFetchImage(url);
    if (!data) return '';
    const id = flNewId();
    GM_setValue(K_FLI + id, data);
    return id;
  }
  const flCmpData = (d) => JSON.stringify(Object.assign({}, d, { imgUrl: flImgKey(d.imgUrl) }));
  // neuen Archiv-Stand anlegen; force = auch ohne Änderung (z. B. Statuswechsel)
  async function flSnapshot(pid, why, force = false) {
    if (!pid || flIsExt(pid) || !isProfilePage() || idOf(location.pathname) !== pid || flArchivParam()) return null;
    const p = flGet(pid);
    if (!p) return null;
    const d = flCollect(document);
    if (!d.ages.length && !d.sed.length) return null; // Profil (noch) nicht geladen
    const stands = flStands(pid);
    const last = stands[stands.length - 1];
    const reasons = [];
    if (last && last.data) {
      if (last.data.nick && d.nick && last.data.nick !== d.nick) reasons.push(`Nick geändert: ${last.data.nick} → ${d.nick}`);
      if (flImgKey(last.data.imgUrl) !== flImgKey(d.imgUrl) && d.imgUrl) reasons.push('Profilbild geändert');
      if (last.data.pnote !== d.pnote) reasons.push('Profilnotiz geändert');
    }
    const changed = !last || flCmpData(last.data) !== flCmpData(d);
    if (!changed && !force) return null;
    if (changed && last && !reasons.length) reasons.push('Profil geändert');
    const st = { ts: Date.now(), why: [why, ...reasons].filter(Boolean).join(' · ') || 'gespeichert', lvl: GM_getValue(K_FL_LVL, false) ? 2 : 1, data: d };
    // Profilbild nur bei neuem Bild laden (beste Qualität, Original-WebP)
    if (d.imgUrl && (!last || flImgKey(last.data.imgUrl) !== flImgKey(d.imgUrl) || !last.img)) st.img = await flStoreImage(d.imgUrl);
    else if (last) st.img = last.img;
    if (st.lvl === 2) st.html = flPageHtml();
    stands.push(st);
    flSetStands(pid, stands);
    const q = flGet(pid) || p;
    const guessed = q.nickGuess || /^html$/i.test(q.nick || '');
    if (d.nick && q.nick && d.nick !== q.nick && !guessed) { q.nicks = [...new Set([...(q.nicks || []), q.nick])]; flHist(q, `Nick geändert: ${q.nick} → ${d.nick}`); }
    if (d.nick) { q.nick = d.nick; delete q.nickGuess; }
    if (d.type) q.type = d.type;
    if (st.img) q.img = st.img;
    q.path = cleanPath(location.pathname);
    if (d.pnote) q.pnote = d.pnote;
    flPut(q);
    return st;
  }

  // ---- Button „Fickliste“ zwischen „Match!“/„Gefällt mir“ und „ClubMail“ ----
  function flCurrentPerson() {
    const pid = flPagePid();
    if (!pid) return null;
    const p = flGet(pid);
    if (p) return p;
    return { id: pid, nick: profileName(), type: profileType(), path: cleanPath(location.pathname), status: '', meets: [], hist: [], created: Date.now() };
  }
  function flCloseMenus() {
    document.querySelectorAll('.jaf-fl-cm[open]').forEach((m) => m.removeAttribute('open'));
    document.getElementById('jaf-fl-dd')?.remove();
  }
  // Einträge des Menüs (aktueller Zustand ausgeblendet; „zurücksetzen“ nur, wenn ein Zustand gesetzt ist)
  function flMenuEntries(st) {
    const l = FL_ORDER.filter((k) => k !== st).map((k) => ({ k, html: flIcon(k, { size: 20, redGef: true }), text: FL_ST[k].menu }));
    if (st) l.push({ k: 'reset', html: flIcon('trash', { size: 20 }), text: 'Fickstatus zurücksetzen' });
    return l;
  }
  function flFillMenu(cm, st) {
    cm.querySelectorAll('j-context-menu-item').forEach((i) => i.remove());
    for (const e of flMenuEntries(st)) {
      const it = document.createElement('j-context-menu-item');
      it.setAttribute('justify-content', 'start');
      it.setAttribute('data-k', e.k);
      it.setAttribute('title', e.text);
      it.innerHTML = `<span slot="icon" style="display:inline-flex;align-items:center">${e.html}</span>${escHtml(e.text)}`;
      cm.appendChild(it);
      try { it.text = e.text; it.label = e.text; } catch (x) { /* egal */ }
      it.__jafText = e.text;
    }
    requestAnimationFrame(() => flMenuTexts(cm));
  }
  // JOYclub zeigt den Text im internen Feld .j-context-menu-item__text – leer → selbst füllen; false = Text fehlt weiter
  function flMenuTexts(cm) {
    let ok = true;
    for (const it of cm.querySelectorAll('j-context-menu-item')) {
      const sp = it.shadowRoot && it.shadowRoot.querySelector('.j-context-menu-item__text');
      if (!sp) continue; // ohne Shadow DOM steht der Text direkt im Element
      if (!sp.textContent.trim() && it.__jafText) sp.textContent = it.__jafText;
      if (!sp.textContent.trim()) ok = false;
    }
    return ok;
  }
  // Ersatz-Menü, falls die JOYclub-Komponente nicht aufklappt
  function flFallbackMenu(anchor, st, onPick) {
    document.getElementById('jaf-fl-dd')?.remove();
    const r = anchor.getBoundingClientRect();
    const dd = flEl('div', `position:fixed;z-index:2147483646;left:${Math.max(8, r.left - 80)}px;top:${r.bottom + 6}px;background:#25272b;border:1px solid #3a3d43;` +
      'border-radius:10px;padding:6px 0;min-width:240px;box-shadow:0 8px 24px rgba(0,0,0,.6);font:15px system-ui,sans-serif;color:#fff');
    dd.id = 'jaf-fl-dd';
    for (const e of flMenuEntries(st)) {
      const row = flEl('div', 'display:flex;align-items:center;gap:12px;padding:9px 16px;cursor:pointer', `${e.html}<span>${escHtml(e.text)}</span>`);
      row.addEventListener('mouseenter', () => { row.style.background = '#33363c'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', (ev) => { ev.stopPropagation(); dd.remove(); onPick(e.k); });
      dd.appendChild(row);
    }
    document.body.appendChild(dd);
  }
  function flRenderButton(wrap, p) {
    const st = (p && p.status) || '';
    const big = wrap.classList.contains('profile-label-interaction-button--is-big');
    const ico = wrap.querySelector('.jaf-fl-ico');
    const want = `${st}|${big}`;
    if (ico && ico.getAttribute('data-k') !== want) {
      ico.setAttribute('data-k', want);
      ico.innerHTML = flIcon(st, { size: big ? 26 : 20 });
    }
    const jb = wrap.querySelector('j-button');
    if (jb) { if (st === 'gef') jb.setAttribute('variant', 'primary'); else jb.removeAttribute('variant'); }
    const fb = wrap.querySelector('.jaf-fl-fallback');
    if (fb) fb.style.background = st === 'gef' ? '#c71b1b' : '#33363c';
    const lbl = wrap.querySelector('.jaf-fl-lbl');
    if (lbl && lbl.textContent !== flLabel(st)) lbl.textContent = flLabel(st);
  }
  function flInsertButtons() {
    if (!flSelectable()) { document.querySelectorAll('.jaf-fl-wrap').forEach((w) => w.remove()); return; }
    const p = flCurrentPerson();
    const haveJoy = !!(window.customElements && customElements.get('j-button') && customElements.get('j-context-menu'));
    for (const box of document.querySelectorAll('.profile-interaction-buttons')) {
      let wrap = box.querySelector('.jaf-fl-wrap');
      if (!wrap) {
        const cmBtn = box.querySelector('.profile-clubmail-button');
        const cmWrap = cmBtn && cmBtn.closest('.profile-label-interaction-button');
        const ref = cmWrap || box.lastElementChild;
        const proto = cmWrap || box.querySelector('.profile-label-interaction-button');
        if (!proto) continue;
        const big = proto.classList.contains('profile-label-interaction-button--is-big');
        wrap = document.createElement('div');
        wrap.className = proto.className + ' jaf-fl-wrap';
        for (const a of proto.attributes) if (a.name.startsWith('data-v-')) wrap.setAttribute(a.name, '');
        const lblProto = proto.querySelector('.profile-label-interaction-button__label');
        const lblAttrs = lblProto ? [...lblProto.attributes].filter((a) => a.name.startsWith('data-v-')).map((a) => `${a.name}=""`).join(' ') : '';
        const size = big ? 56 : 40;
        wrap.innerHTML = haveJoy
          ? `<j-context-menu class="jaf-fl-cm"><j-button slot="activator" icon-only="true" circle="true" ${big ? 'big="true"' : ''} aria-label="Fickliste" title="Fickliste" type="button" role="" aria-controls="menu"><span class="jaf-fl-ico" style="display:inline-flex;align-items:center;justify-content:center"></span></j-button></j-context-menu>`
          : `<button type="button" class="jaf-fl-fallback" title="Fickliste" style="width:${size}px;height:${size}px;border-radius:50%;border:0;background:#33363c;color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer"><span class="jaf-fl-ico" style="display:inline-flex"></span></button>`;
        if (big) wrap.insertAdjacentHTML('beforeend', `<div ${lblAttrs} class="profile-label-interaction-button__label jaf-fl-lbl" aria-hidden="true"></div>`);
        box.insertBefore(wrap, ref === box.lastElementChild && !cmWrap ? null : ref);
        const act = wrap.querySelector('j-button, .jaf-fl-fallback');
        const cm = wrap.querySelector('.jaf-fl-cm');
        act.addEventListener('click', (ev) => {
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault(); ev.stopPropagation();
            const on = !GM_getValue(K_FL_LVL, false);
            GM_setValue(K_FL_LVL, on);
            flToast(`Erinnerungen: Stufe ${on ? 2 : 1}`);
            if (cm) cm.removeAttribute('open');
            return;
          }
          const cur = flCurrentPerson();
          if (!cm) { ev.stopPropagation(); flFallbackMenu(act, cur.status, (k) => flPick(k)); return; }
          flFillMenu(cm, cur.status);
          setTimeout(() => {
            if (!cm.hasAttribute('open')) cm.setAttribute('open', 'true');
            flMenuTexts(cm);
            setTimeout(() => {
              const it = cm.querySelector('j-context-menu-item');
              if (cm.hasAttribute('open') && it && (!visible(it) || !flMenuTexts(cm))) { cm.removeAttribute('open'); flFallbackMenu(act, cur.status, (k) => flPick(k)); }
            }, 350);
          }, 60);
        }, true);
        if (cm) cm.addEventListener('click', (ev) => {
          const it = ev.composedPath().find((e) => e && e.tagName === 'J-CONTEXT-MENU-ITEM');
          if (!it) return;
          ev.stopPropagation();
          cm.removeAttribute('open');
          flPick(it.getAttribute('data-k'));
        });
      }
      flRenderButton(wrap, p);
    }
  }
  if (!IN_FRAME) document.addEventListener('click', (ev) => {
    const path = ev.composedPath ? ev.composedPath() : [];
    if (path.some((e) => e && e.classList && (e.classList.contains('jaf-fl-wrap') || e.id === 'jaf-fl-dd'))) return;
    flCloseMenus();
  }, true);
  async function flPick(k) {
    const p = flCurrentPerson();
    if (!p) return;
    if (k === 'reset') { await flResetPopup(p); return; }
    await flEntryPopup(p, k);
  }
  // „Fickstatus zurücksetzen“: Zurücksetzen | Zurücksetzen und Daten löschen | Abbrechen
  async function flResetPopup(p) {
    const v = await askPopup({ title: 'Fickstatus zurücksetzen', lines: [
      `${p.nick || 'Dieses Profil'}: Status „${flLabel(p.status)}“.`,
      '„Zurücksetzen“ entfernt nur den Status – Treffen, Notizen und das Profil-Archiv bleiben.',
      '„Zurücksetzen und Daten löschen“ entfernt alles zu dieser Person (auch Archiv und Bilder).'],
    buttons: [{ label: 'Zurücksetzen', value: 'reset', primary: true }, { label: 'Zurücksetzen und Daten löschen', value: 'delete' }, { label: 'Abbrechen', value: null, focus: true }] });
    if (v === 'reset') {
      const q = flGet(p.id);
      if (q) { flHist(q, `Fickstatus: ${flLabel(q.status)} → zurückgesetzt`); q.status = ''; flPut(q); }
    } else if (v === 'delete') {
      flDeleteAll(p.id);
      if (flIsExt(p.id)) { location.href = flOverviewUrl(); return; }
    }
    flRefreshAll();
  }
  function flDeleteAll(pid) {
    flLinkRemove(pid);
    for (const s of flStands(pid)) if (s.img) GM_deleteValue(K_FLI + s.img);
    const p = flGet(pid);
    if (p && p.img) GM_deleteValue(K_FLI + p.img);
    GM_deleteValue(K_FLA + pid);
    const m = getFl(); delete m[pid]; setFl(m);
  }
  function flRefreshAll() {
    try { flInsertButtons(); flProfileBlock(); flDecorateCards(); } catch (e) { /* weiter */ }
    if (flOverviewPage()) flRenderOverview();
  }

  // ---- Partys (für Treffen) ----
  const flNormName = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(swingerclub|swinger|club|party|partys|events?|the|der|die|das|im|in|am|bei|und|mit)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  function flEvStart(e) {
    if (e && e.start) { const t = Date.parse(e.start); if (Number.isFinite(t)) return t; }
    const m = String((e && e.date) || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1], 20, 0).getTime() : 0;
  }
  function flEventFromDoc(doc, url) {
    const id = (String(url).match(/\/event\/(\d+)\./) || [])[1] || '';
    const h = doc.querySelector('h1.event_name') || doc.querySelector('h1');
    const name = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    let start = '';
    for (const sc of doc.querySelectorAll('script')) { const m = (sc.textContent || '').match(/"startDate"\s*:\s*"([^"]+)"/); if (m) { start = m[1]; break; } }
    const org = doc.querySelector('.event_organizer a');
    const club = org ? org.textContent.replace(/\s+/g, ' ').trim() : '';
    return { id, name, start, date: start ? fmtDay(Date.parse(start)) : '', url: String(url).replace(/[?#].*$/, ''), club };
  }
  function flSaveEvent(ev) {
    if (!ev || !ev.id) return;
    const m = getEvents();
    const o = m[ev.id] || {};
    for (const k of ['name', 'start', 'date', 'url', 'club']) if (ev[k]) o[k] = ev[k];
    m[ev.id] = o;
    gmSet(K_EVENTS, m);
  }
  // jede geöffnete Party-Seite merken (Name, Beginn, URL, Club) – auch vergangene
  function flSaveEventPage() {
    if (!isEventPage() || window.__jafFlEvSaved === location.pathname) return;
    const ev = flEventFromDoc(document, location.origin + location.pathname);
    ev.id = eventIdOf(location.pathname);
    ev.url = location.origin + location.pathname;
    if (!ev.id || !ev.name) return;
    window.__jafFlEvSaved = location.pathname;
    flSaveEvent(ev);
  }
  // Klick auf ein Profil in einer Gästeliste → Party als Vorbelegung merken
  if (!IN_FRAME) document.addEventListener('click', (ev) => {
    if (!isEventPage()) return;
    const a = ev.composedPath().find((e) => e && e.tagName === 'A' && /\/(profile|my)\/\d+\./.test(e.getAttribute('href') || ''));
    if (!a) return;
    GM_setValue(K_FL_CTX, { pid: idOf(a.getAttribute('href')), ev: eventIdOf(location.pathname), ts: Date.now() });
  }, true);
  const flMeetFromEvent = (e) => {
    const t = flEvStart(e), d = t ? new Date(t) : null;
    return { id: flNewId(), date: d ? isoDay(d) : '', time: d ? `${pad2f(d.getHours())}:${pad2f(d.getMinutes())}` : '', wo: e.name || '', url: e.url || '', club: e.club || '' };
  };
  function flCtxEvent(pid) {
    const evs = getEvents();
    const c = GM_getValue(K_FL_CTX, null);
    if (c && c.pid === pid && Date.now() - c.ts < 6 * 3600e3 && evs[c.ev]) return Object.assign({ id: c.ev }, evs[c.ev]);
    const r = (String(document.referrer || '').match(/\/event\/(\d+)\./) || [])[1];
    if (r && evs[r]) return Object.assign({ id: r }, evs[r]);
    return null;
  }
  // heute + die letzten n vergangenen Partys (eigene Anmeldungen zuerst markiert), optional Suche
  function flPartyList(q = '', n = 10) {
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const all = Object.entries(getEvents()).map(([id, e]) => Object.assign({ id }, e, { t: flEvStart(e) }))
      .filter((e) => e.t && e.t <= endToday.getTime() && e.name);
    all.sort((a, b) => b.t - a.t);
    const own = (e) => /angemeldet|warteliste/i.test(e.status || '');
    if (q) { const k = norm(q); return all.filter((e) => norm(`${e.name} ${e.club || ''} ${e.location || ''}`).includes(k)).slice(0, 50); }
    const todays = all.filter((e) => e.t >= today0.getTime());
    const past = all.filter((e) => e.t < today0.getTime()).slice(0, n);
    return [...todays, ...past].sort((a, b) => (own(b) - own(a)) || (b.t - a.t));
  }
  function flChooseParty() {
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-party');
      ov.style.zIndex = '2147483647';
      box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:8px', 'Party wählen'));
      const inp = flEl('input', FL_INPUT_CSS + ';width:100%;margin-bottom:10px');
      inp.placeholder = 'Ältere Partys suchen (Name oder Club) …';
      box.appendChild(inp);
      const list = flEl('div', 'display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto');
      box.appendChild(list);
      const done = (v) => { ov.remove(); resolve(v); };
      const render = () => {
        list.innerHTML = '';
        const l = flPartyList(inp.value.trim());
        if (!l.length) list.appendChild(flEl('div', 'color:#9a9a9a', inp.value ? 'Keine passende Party gespeichert.' : 'Noch keine vergangenen Partys gespeichert. Öffne die Party-Seite einmal oder füge ihren Link ins Feld „wo“ ein.'));
        for (const e of l) {
          const own = /angemeldet|warteliste/i.test(e.status || '');
          const row = flEl('div', 'border:1px solid #3a3d43;border-radius:8px;padding:7px 10px;cursor:pointer;background:#24262a',
            `<b>${own ? '★ ' : ''}${escHtml(e.name)}</b><br><span style="color:#9a9a9a;font-size:12.5px">${escHtml(fmtDT(e.t))}${e.club ? ' · ' + escHtml(e.club) : ''}${own ? ' · eigene Anmeldung' : ''}</span>`);
          row.addEventListener('click', () => done(e));
          list.appendChild(row);
        }
      };
      inp.addEventListener('input', render);
      render();
      const row = flEl('div', 'display:flex;justify-content:flex-end;margin-top:12px');
      row.appendChild(flBtn('Abbrechen', () => done(null)));
      box.appendChild(row);
      setTimeout(() => inp.focus(), 50);
    });
  }
  async function flEventFromUrl(url) {
    const m = String(url).match(/https?:\/\/(?:www\.)?joyclub\.de\/event\/(\d+)\.[^\s?#]*/);
    if (!m) return null;
    const known = getEvents()[m[1]];
    if (known && known.name && (known.start || known.date)) return Object.assign({ id: m[1] }, known, { url: known.url || m[0] });
    try {
      const doc = await fetchDoc(m[0]);
      const ev = flEventFromDoc(doc, m[0]);
      if (!ev.name) return { id: m[1], url: m[0] };
      flSaveEvent(ev);
      return ev;
    } catch (e) { return { id: m[1], url: m[0] }; }
  }
  // Datumsangaben in einem Notiztext → ISO-Tage
  function flNoteDates(txt) {
    const out = [];
    for (const m of String(txt || '').matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/g)) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      const d = new Date(y, +m[2] - 1, +m[1]);
      if (d.getMonth() === +m[2] - 1 && y > 1995) out.push(isoDay(d));
    }
    return [...new Set(out)];
  }
  // Partys zu einem Datum: sicher (Datum + Club oder Name passt) bzw. schwach (nur Datum)
  function flPartyMatches(dayIso, txt) {
    const note = ' ' + flNormName(txt) + ' ';
    const noteToks = note.split(' ').filter((w) => w.length >= 3);
    const day = Date.parse(dayIso + 'T12:00:00');
    const strong = [], weak = [];
    for (const [id, e] of Object.entries(getEvents())) {
      const t = flEvStart(e);
      if (!t || !e.name) continue;
      const sd = isoDay(new Date(t));
      const prev = isoDay(new Date(day - 864e5));
      if (sd !== dayIso && !(sd === prev && new Date(t).getHours() >= 17)) continue;
      const fields = [e.club, e.name, e.location].map(flNormName).filter(Boolean);
      const hit = fields.some((f) => {
        const ft = f.split(' ').filter((w) => w.length >= 3);
        return ft.some((w) => note.includes(' ' + w) || noteToks.some((n) => w.startsWith(n) || n.startsWith(w)));
      });
      (hit ? strong : weak).push(Object.assign({ id }, e, { t }));
    }
    return { strong, weak };
  }
  // Auswahl „Passende Party gefunden“ → Party oder null
  function flSuggestPopup(dayIso, txt, title = 'Passende Party gefunden') {
    const { strong, weak } = flPartyMatches(dayIso, txt);
    if (!strong.length && !weak.length) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-suggest');
      ov.style.zIndex = '2147483647';
      box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:6px', escHtml(title)));
      box.appendChild(flEl('div', 'color:#bdbdbd;margin-bottom:10px', `Zum ${escHtml(fmtDate(dayIso))} aus „${escHtml(String(txt).slice(0, 120))}“:`));
      let sel = strong[0] || null;
      const mk = (e, pre) => {
        const row = flEl('label', 'display:flex;gap:8px;align-items:flex-start;border:1px solid #3a3d43;border-radius:8px;padding:7px 10px;cursor:pointer;margin-bottom:6px;background:#24262a');
        const r = flEl('input'); r.type = 'radio'; r.name = 'jaf-fl-sg'; r.checked = sel === e; r.style.marginTop = '4px';
        r.addEventListener('change', () => { sel = e; });
        row.appendChild(r);
        row.appendChild(flEl('span', '', `<b>${escHtml(e.name)}</b><br><span style="color:#9a9a9a;font-size:12.5px">${escHtml(fmtDT(e.t))}${e.club ? ' · ' + escHtml(e.club) : ''}</span>`));
        box.appendChild(row);
      };
      strong.forEach((e) => mk(e));
      if (weak.length) { box.appendChild(flEl('div', 'color:#9a9a9a;margin:8px 0 6px', 'Am selben Tag:')); weak.forEach((e) => mk(e)); }
      const row = flEl('div', 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px');
      const done = (v) => { ov.remove(); resolve(v); };
      row.appendChild(flBtn('Ohne Party', () => done(null)));
      row.appendChild(flBtn('Andere Party wählen …', async () => { const e = await flChooseParty(); if (e) done(e); }));
      row.appendChild(flBtn('Übernehmen', () => { if (sel) done(sel); }, true));
      box.appendChild(row);
    });
  }

  // ---- Ignorieren / Entsperren aus der Fickliste (eigene Listen haben Vorrang vor automatischen Sperren) ----
  function flDropWhite(name) {
    const k = norm(name);
    const w = getDynWhite();
    if (w[k]) { delete w[k]; gmSet(K_WHITE, w); }
    let ch = false;
    const W = JSON.parse(JSON.stringify(CONFIG.WHITELIST));
    for (const r of Object.keys(W)) { const n0 = W[r].length; W[r] = W[r].filter((x) => norm(x) !== k); if (W[r].length !== n0) ch = true; }
    if (ch) { CONFIG.WHITELIST = W; saveSettings({ WHITELIST: W }); }
  }
  async function flDoIgnore(p) {
    flDropWhite(p.nick);
    if (ignCount() >= CONFIG.IGNORE_LIMIT) {
      const v = pickVictim({ manual: true });
      if (v) {
        const r = await bgUnignore(idOf(v.p));
        if (r.ok) markUnblocked(v.p, v.e, 'entsperrt (Platz für Fickliste, Limit)');
      }
    }
    return bgIgnore(p.id, p.nick);
  }
  async function flDoUnignore(p) {
    const r = await bgUnignore(p.id);
    const path = p.path || `/profile/${p.id}.html`;
    const l = getLog();
    const lp = Object.keys(l).find((x) => idOf(x) === p.id);
    if (lp) markUnblocked(lp, l[lp], 'entsperrt (Fickliste)');
    addWhite(p.nick, location.origin + path, 'Fickliste');
    return r;
  }


  // ---- Verknüpfte Profile (z. B. Paar + Frau + Mann): eine Person, mehrere Einträge ----
  // jaf_fl_groups = { gid: { primary: pid, members: { pid: { sync: bool } } } } – Einträge bleiben getrennt (lösbar)
  const K_FL_GROUPS = 'jaf_fl_groups';
  const flGroups = () => GM_getValue(K_FL_GROUPS, {}) || {};
  const flSetGroups = (g) => GM_setValue(K_FL_GROUPS, g);
  function flGroupOf(pid, G = flGroups()) {
    for (const [gid, g] of Object.entries(G)) if (g.members && g.members[pid]) return { gid, g };
    return null;
  }
  const flPrimaryId = (pid, G) => { const x = flGroupOf(pid, G); return x ? x.g.primary : pid; };
  const flMembers = (pid, G) => { const x = flGroupOf(pid, G); return x ? Object.keys(x.g.members) : [pid]; };
  // alle Treffen der Gruppe: [{ m, owner }]
  function flGroupMeets(pid) {
    const fl = getFl();
    const out = [];
    for (const id of flMembers(pid)) for (const m of (fl[id] && fl[id].meets) || []) out.push({ m, owner: fl[id] });
    return out.sort((a, b) => meetTs(b.m) - meetTs(a.m));
  }
  function flNickFromPath(path) {
    const m = String(path || '').match(/\/profile\/\d+\.([^./?#]+)/);
    return m ? m[1] : '';
  }
  // alle dem Skript bekannten Profile (ohne Fickliste): id → { id, nick, path, type, age }
  function flKnownProfiles() {
    const out = new Map();
    const yr = new Date().getFullYear();
    const add = (path, e) => {
      const id = idOf(path); if (!id || !e) return;
      const nick = e.name || e.nick || '';
      if (!nick || /^html$/i.test(nick)) return;
      const o = out.get(id) || { id, nick, path: (String(path).match(/\/profile\/\d+\.[^?#\s]*/) || [path])[0], type: '', age: 0 };
      if (!o.type && e.type && !/^Typ /.test(e.type)) o.type = e.type;
      if (!o.age) { if (e.ages && e.ages.length) o.age = e.ages[0]; else if (e.persons && e.persons[0] && e.persons[0].hi) o.age = yr - Number(String(e.persons[0].hi).slice(0, 4)); }
      out.set(id, o);
    };
    const src = [['acc', getAccounts], ['log', getLog], ['ign', getIgnored], ['mem', getMem]];
    for (const [, f] of src) { try { for (const [path, e] of Object.entries(f() || {})) add(path, e); } catch (x) { /* egal */ } }
    return out;
  }
  // echten Nick/Typ zu einer Profil-ID: bekannte Daten, sonst Profilseite im Hintergrund laden
  async function flResolveProfile(id, path) {
    const k = flKnownProfiles().get(id);
    if (k && k.nick) return k;
    try {
      const r = await jfetch(location.origin + (path || `/profile/${id}.html`));
      const d = r.doc && parseProfileDoc(r.doc);
      let nick = (d && d.name) || '';
      if (!nick && r.doc) nick = ((r.doc.querySelector('.profile-base-info__user-name') || {}).textContent || '').trim() || ((r.doc.title || '').split(' ♥ ')[0] || '').trim();
      let fpath = path; try { const fp = new URL(r.url).pathname; if (new RegExp(`/(profile|my)/${id}\\.`).test(fp)) fpath = fp.replace(/^\/my\//, '/profile/'); } catch (x) { /* egal */ }
      if (nick) return { id, nick, path: fpath, type: d ? d.type : '', age: d && d.ages ? d.ages[0] : 0 };
    } catch (x) { /* egal */ }
    const slug = flNickFromPath(path);
    return { id, nick: slug && !/^html$/i.test(slug) ? slug : `Profil ${id}`, path, type: '', age: 0, guess: true };
  }
  async function flLinkAdd(pid, otherRef) {
    const id = idOf(otherRef) || (Object.values(getFl()).find((q) => norm(q.nick) === norm(otherRef)) || {}).id ||
      ([...flKnownProfiles().values()].find((q) => norm(q.nick) === norm(otherRef)) || {}).id;
    if (!id) return 'Kein Profil-Link und kein bekannter Nick.';
    if (id === pid) return 'Das ist dasselbe Profil.';
    const G = flGroups();
    const mine = flGroupOf(pid, G), other = flGroupOf(id, G);
    if (other && (!mine || other.gid !== mine.gid)) return 'Dieses Profil ist schon mit anderen verknüpft – dort zuerst die Verknüpfung lösen.';
    if (!flGet(id)) {
      const kp = flKnownProfiles().get(id);
      const path = (String(otherRef).match(/\/profile\/\d+\.[^?#\s]*/) || [kp && kp.path] || [])[0] || `/profile/${id}.html`;
      const r = await flResolveProfile(id, path);
      flPut({ id, nick: r.nick, path: r.path || path, type: r.type || '', status: '', meets: [], hist: [], created: Date.now(), nickGuess: !!r.guess });
    }
    let gid = mine && mine.gid;
    if (!gid) { gid = flNewId(); G[gid] = { primary: pid, members: { [pid]: { sync: false } } }; }
    G[gid].members[id] = { sync: false };
    flSetGroups(G);
    for (const x of [pid, id]) { const q = flGet(x); flHist(q, `verknüpft mit ${(flGet(x === pid ? id : pid) || {}).nick || ''}`); flPut(q); }
    return '';
  }
  function flLinkRemove(pid) {
    const G = flGroups();
    const x = flGroupOf(pid, G);
    if (!x) return;
    delete x.g.members[pid];
    const rest = Object.keys(x.g.members);
    if (rest.length < 2) delete G[x.gid];
    else if (x.g.primary === pid) x.g.primary = rest[0];
    flSetGroups(G);
    const q = flGet(pid); if (q) { flHist(q, 'Verknüpfung gelöst'); flPut(q); }
  }
  // Statuswechsel des primären Profils an synchron gehaltene Profile weitergeben
  function flSyncStatus(pid) {
    const G = flGroups();
    const x = flGroupOf(pid, G);
    if (!x || x.g.primary !== pid) return;
    const st = (flGet(pid) || {}).status || '';
    for (const [id, o] of Object.entries(x.g.members)) {
      if (id === pid || !o.sync) continue;
      const q = flGet(id);
      if (q && q.status !== st) { flHist(q, `Fickstatus: ${q.status ? flLabel(q.status) : '–'} → ${st ? flLabel(st) : 'zurückgesetzt'} (synchron mit ${(flGet(pid) || {}).nick || ''})`); q.status = st; flPut(q); }
    }
  }
  // Popup „Verknüpfte Profile“
  function flLinkPopup(pid) {
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-links');
      ov.style.zIndex = '2147483647';
      const render = () => {
        box.innerHTML = '';
        box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:6px', 'Verknüpfte Profile'));
        box.appendChild(flEl('div', 'color:#9a9a9a;font-size:13px;margin-bottom:10px', 'Mehrere Profile derselben Person (z. B. Paar, Frau, Mann). In der Fickliste steht die Person unter dem primären Profil; jedes Profil behält seine Einträge.'));
        const G = flGroups();
        const x = flGroupOf(pid, G);
        const ids = x ? Object.keys(x.g.members) : [pid];
        for (const id of ids) {
          const q = flGet(id) || { id, nick: id };
          const row = flEl('div', 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid #3a3d43;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#24262a');
          const prim = (x ? x.g.primary : pid) === id;
          const r = flEl('input'); r.type = 'radio'; r.name = 'jaf-fl-prim'; r.checked = prim; r.title = 'primäres Profil';
          r.addEventListener('change', () => { if (x) { const G2 = flGroups(); G2[x.gid].primary = id; flSetGroups(G2); render(); } });
          row.appendChild(r);
          row.appendChild(flEl('span', 'flex:1;min-width:120px', `${flNickHtml(q)} <span style="opacity:.6;font-size:12px">${escHtml(q.type || '')}</span> ${flIcon(q.status, { size: 15, redGef: true })}${prim ? ' <span style="font-size:11px;opacity:.7">(primär)</span>' : ''}`));
          if (x && !prim) {
            const lb = flEl('label', 'display:flex;gap:5px;align-items:center;font-size:12.5px;cursor:pointer');
            const c = flEl('input'); c.type = 'checkbox'; c.checked = !!x.g.members[id].sync;
            c.addEventListener('change', () => { const G2 = flGroups(); G2[x.gid].members[id].sync = c.checked; flSetGroups(G2); if (c.checked) flSyncStatus(G2[x.gid].primary); });
            lb.appendChild(c); lb.appendChild(flEl('span', '', 'Status mit primärem Profil synchron halten'));
            row.appendChild(lb);
          }
          if (x) row.appendChild(flBtn('Verknüpfung lösen', () => { flLinkRemove(id); render(); }));
          box.appendChild(row);
        }
        box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin:10px 0 4px', '+ Profil verknüpfen (Profil-Link einfügen oder Nick suchen)'));
        const r2 = flEl('div', 'display:flex;gap:8px');
        const inp = flEl('input', FL_INPUT_CSS + ';width:100%;box-sizing:border-box');
        inp.placeholder = 'Profil-Link oder Nick (ab 2 Zeichen)';
        const wrap = flEl('div', 'position:relative;flex:1');
        const sug = flEl('div', 'position:absolute;left:0;right:0;top:100%;z-index:5;background:#1f2125;border:1px solid #3a3d43;border-radius:6px;margin-top:2px;max-height:260px;overflow:auto;display:none');
        sug.className = 'jaf-fl-linksug';
        wrap.appendChild(inp); wrap.appendChild(sug);
        let pickId = '';
        const fl = getFl();
        const known = flKnownProfiles();
        const item = (q, inFl) => {
          const meta = [q.type, q.age ? String(q.age) : ''].filter(Boolean).join(' · ');
          const r = flEl('div', 'padding:5px 10px;cursor:pointer;display:flex;gap:8px;align-items:center', `<span>${escHtml(q.nick)}</span>${meta ? `<span style="opacity:.6;font-size:12px">${escHtml(meta)}</span>` : ''}${inFl && q.status ? flIcon(q.status, { size: 14, redGef: true }) : ''}`);
          r.addEventListener('mouseenter', () => { r.style.background = '#2b2e34'; });
          r.addEventListener('mouseleave', () => { r.style.background = ''; });
          r.addEventListener('mousedown', (e) => { e.preventDefault(); inp.value = q.nick; pickId = q.path ? q.path : q.id; sug.style.display = 'none'; });
          return r;
        };
        const showSug = () => {
          pickId = '';
          const t = norm(inp.value.trim());
          sug.innerHTML = '';
          if (t.length < 2 || /joyclub\.de|\/profile\//.test(inp.value)) { sug.style.display = 'none'; return; }
          const a = Object.values(fl).filter((q) => !ids.includes(q.id) && !flIsExt(q.id) && norm(q.nick).includes(t))
            .sort((x, y) => norm(x.nick).indexOf(t) - norm(y.nick).indexOf(t) || x.nick.localeCompare(y.nick, 'de')).slice(0, 15);
          const b = a.length >= 15 ? [] : [...known.values()].filter((q) => !fl[q.id] && !ids.includes(q.id) && norm(q.nick).includes(t))
            .sort((x, y) => norm(x.nick).indexOf(t) - norm(y.nick).indexOf(t) || x.nick.localeCompare(y.nick, 'de')).slice(0, 15 - a.length);
          const hd = (txt) => flEl('div', 'padding:5px 10px 3px;font-size:11.5px;color:#9a9a9a;text-transform:uppercase;letter-spacing:.04em', txt);
          if (a.length) { sug.appendChild(hd('Fickliste')); a.forEach((q) => sug.appendChild(item(q, true))); }
          if (b.length) { sug.appendChild(hd('Weitere bekannte Profile')); b.forEach((q) => sug.appendChild(item(q, false))); }
          if (!a.length && !b.length) sug.appendChild(flEl('div', 'padding:6px 10px;opacity:.6;font-size:13px', 'Kein bekanntes Profil – Profil-Link einfügen'));
          sug.style.display = 'block';
        };
        inp.addEventListener('input', showSug);
        inp.addEventListener('blur', () => setTimeout(() => { sug.style.display = 'none'; }, 150));
        const err = flEl('div', 'color:#ffb020;font-size:13px;margin-top:6px;min-height:1px');
        r2.appendChild(wrap);
        r2.appendChild(flBtn('Verknüpfen', async () => {
          err.textContent = 'Profil wird gelesen …';
          const e = await flLinkAdd(pid, pickId || inp.value.trim());
          if (e) err.textContent = e; else render();
        }, true));
        box.appendChild(r2);
        box.appendChild(err);
        const row = flEl('div', 'display:flex;justify-content:flex-end;margin-top:14px');
        row.appendChild(flBtn('Schließen', () => { ov.remove(); resolve(); flRefreshAll(); }, true));
        box.appendChild(row);
      };
      render();
    });
  }
  // „verknüpft mit: A [Profil-Archiv] · B [Profil-Archiv]“
  function flLinkedHtml(pid) {
    const ids = flMembers(pid).filter((x) => x !== pid);
    if (!ids.length) return '';
    return '<div class="jaf-fl-linked" style="font-size:12.5px;margin-top:6px;opacity:.9">verknüpft mit: ' + ids.map((id) => {
      const q = flGet(id) || { id, nick: id };
      return `<a href="${escHtml(flIsExt(id) ? flLiveUrl(q) : flDead(q) ? flArchiveUrl(q) : flLiveUrl(q))}" target="_blank" style="color:inherit">${flNickHtml(q)}</a> ` +
        `<a href="${escHtml(flArchiveUrl(q))}" target="_blank" style="color:inherit;opacity:.7;font-size:12px">Profil-Archiv</a>`;
    }).join(' · ') + '</div>';
  }


  // ---- Profile auf anderen Plattformen („Auch auf …“) ----
  // p.profiles = [{ pf, pfName?, url, name, uid?, dead?, …unbekannte Felder aus dem Austausch }]
  // Personen ohne JOYclub-Profil aus dem Austausch: id „x-<pf>-<uid>“, p.main = { pf, uid, nick, url }
  const FL_PF = {
    joyclub: { label: 'JOYclub', ab: 'J', bg: '#c71b1b', dom: 'joyclub.de' },
    poppen: { label: 'poppen.de', ab: 'P', bg: '#d6246e', dom: 'poppen.de' },
    xhamster: { label: 'xHamster', ab: 'xH', bg: '#d9700b', dom: 'xhamster.com' },
    eronity: { label: 'Eronity', ab: 'Er', bg: '#7b3fb5', dom: 'eronity.com' },
    spicymatch: { label: 'SpicyMatch', ab: 'SM', bg: '#b4440f', dom: 'spicymatch.com' },
    kaufmich: { label: 'Kaufmich', ab: 'KM', bg: '#a3164f', dom: 'kaufmich.com' },
    fetish: { label: 'Fetish.com', ab: 'Fe', bg: '#3f3f46', dom: 'fetish.com' },
    gays: { label: 'Gays.com', ab: 'G', bg: '#2563eb', dom: 'gays.com' },
    telegram: { label: 'Telegram', ab: 'TG', bg: '#1f8bc4', dom: 'telegram.org' },
    whatsapp: { label: 'WhatsApp', ab: 'WA', bg: '#1f8a3a', dom: 'whatsapp.com' },
    threema: { label: 'Threema', ab: 'Th', bg: '#3c3c3c', dom: 'threema.ch' },
    signal: { label: 'Signal', ab: 'Si', bg: '#3a6fd8', dom: 'signal.org' },
    other: { label: 'Andere …', ab: '?', bg: '#5c6470' },
  };
  const FL_PF_HINT = {
    telegram: '@Name oder t.me/Name', whatsapp: 'Telefonnummer oder wa.me-Link', threema: 'Threema-ID (8 Zeichen)',
    signal: 'Telefonnummer, signal.me-Link oder Benutzername', other: 'Link oder Name',
  };
  const flPfLabel = (pf, pfName) => (pf === 'other' && pfName ? pfName : (FL_PF[pf] || FL_PF.other).label.replace(' …', ''));
  // Favicons: einmal im Browser laden (Google-Favicon-Dienst, 32 px) und dauerhaft speichern – nicht im Skript enthalten
  const K_PF_ICONS = 'jaf_pf_icons'; // { pf: data:-URL | { fail: ts } }
  let pfIcons = null;
  const pfLoading = new Set();
  function flPfIcon(pf) {
    const d = FL_PF[pf];
    if (!d || !d.dom) return '';
    if (!pfIcons) pfIcons = GM_getValue(K_PF_ICONS, {}) || {};
    const v = pfIcons[pf];
    if (typeof v === 'string') return v;
    if (v && v.fail && Date.now() - v.fail < 7 * 864e5) return '';
    if (!pfLoading.has(pf)) {
      pfLoading.add(pf);
      flFetchImage(`https://www.google.com/s2/favicons?sz=32&domain=${d.dom}`).then((data) => {
        const all = GM_getValue(K_PF_ICONS, {}) || {};
        all[pf] = /^data:image\//.test(data || '') ? data : { fail: Date.now() };
        GM_setValue(K_PF_ICONS, all);
        pfIcons = all;
        if (typeof all[pf] === 'string') document.querySelectorAll(`span.jaf-pf[data-pf="${pf}"]`).forEach((e) => { e.outerHTML = flPfBadge(pf, { size: parseInt(e.style.height, 10) || 16, title: e.title }); });
      });
    }
    return '';
  }
  function flPfBadge(pf, opt = {}) {
    const d = FL_PF[pf] || FL_PF.other;
    const sz = opt.size || 16;
    const ic = pf !== 'other' ? flPfIcon(pf) : '';
    if (ic) return `<img class="jaf-pf" data-pf="${escHtml(pf)}" src="${ic}" alt="" title="${escHtml(opt.title || flPfLabel(pf, opt.pfName))}" style="width:${sz}px;height:${sz}px;vertical-align:-3px;flex:none;border-radius:3px">`;
    const ab = pf === 'other' && opt.pfName ? opt.pfName.slice(0, 2) : d.ab;
    return `<span class="jaf-pf" data-pf="${escHtml(pf || 'other')}" title="${escHtml(opt.title || flPfLabel(pf, opt.pfName))}" style="display:inline-flex;align-items:center;justify-content:center;min-width:${sz}px;height:${sz}px;padding:0 3px;` +
      `border-radius:4px;background:${d.bg};color:#fff;font:bold ${Math.round(sz * 0.58)}px system-ui,sans-serif;line-height:1;vertical-align:-3px;box-sizing:border-box;flex:none">${escHtml(ab)}</span>`;
  }
  function flDetectPf(u) {
    const s = String(u || '').trim().toLowerCase();
    if (!s) return '';
    if (/(^|\/\/|\.)(t|telegram)\.me\//.test(s) || /^(t|telegram)\.me\//.test(s)) return 'telegram';
    if (/(^|\/\/|\.)wa\.me\/|whatsapp\.com\//.test(s)) return 'whatsapp';
    if (/(^|\/\/|\.)threema\.id\//.test(s)) return 'threema';
    if (/(^|\/\/|\.)signal\.me\//.test(s)) return 'signal';
    const h = (s.match(/^(?:[a-z]+:\/\/)?(?:www\.)?([^/?#\s]+)/) || [])[1] || '';
    if (/(^|\.)joyclub\.(de|com|at|ch)$/.test(h)) return 'joyclub';
    if (/(^|\.)poppen\.de$/.test(h)) return 'poppen';
    if (/xhamster/.test(h)) return 'xhamster';
    if (/eronity/.test(h)) return 'eronity';
    if (/spicymatch/.test(h)) return 'spicymatch';
    if (/kaufmich/.test(h)) return 'kaufmich';
    if (/(^|\.)fetish\.com$/.test(h)) return 'fetish';
    if (/(^|\.)(gays\.com|gay\.de)$/.test(h)) return 'gays';
    return '';
  }
  // Link vereinheitlichen: Groß/klein, http/https, www., Umlaut-Kodierung, ?- und #-Zusätze egal
  function flCanonLink(u) {
    let s = String(u || '').trim();
    if (!s) return '';
    try { s = decodeURIComponent(s); } catch (e) { /* so lassen */ }
    return s.normalize('NFC').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
  const flIsUrlish = (t) => /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(String(t || '').trim());
  // Telefonnummer → nur Ziffern mit Ländervorwahl (ohne Vorwahl: +49)
  function flPhoneDigits(x) {
    let d = String(x || '').replace(/[^\d+]/g, '');
    if (d.startsWith('00')) d = '+' + d.slice(2);
    if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
    d = d.replace(/\D/g, '');
    if (d.startsWith('0')) return '49' + d.slice(1);
    return d.length >= 11 && /^(49|43|41)/.test(d) ? d : '49' + d;
  }
  function flPhoneFmt(d) {
    const cc = /^(1|7)/.test(d) ? d.slice(0, 1) : d.slice(0, 2);
    const r = d.slice(cc.length);
    return `+${cc} ${r.slice(0, 3)} ${r.slice(3)}`.trim();
  }
  // Eingabe → { url, name, key, text? } (text = kein Link möglich, nur Text mit Kopieren-Knopf)
  function flNormProfile(pf, raw) {
    const t = String(raw || '').trim();
    if (!t) return null;
    switch (pf) {
      case 'telegram': {
        const m = t.match(/^(?:@|(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/)?([A-Za-z0-9_]{3,})\/?$/);
        return m ? { url: `https://t.me/${m[1]}`, name: t, key: 'telegram:' + m[1].toLowerCase() } : null;
      }
      case 'whatsapp': {
        const m = t.match(/wa\.me\/\+?(\d+)/i);
        const d = m ? m[1] : (/^[+\d][\d\s()/.-]{5,}$/.test(t) ? flPhoneDigits(t) : '');
        return d && d.length >= 8 ? { url: `https://wa.me/${d}`, name: flPhoneFmt(d), key: 'whatsapp:' + d } : null;
      }
      case 'threema': {
        const m = t.match(/^(?:(?:https?:\/\/)?threema\.id\/)?([A-Za-z0-9*]{8})\/?$/i);
        if (!m) return null;
        const id = m[1].toUpperCase();
        return { url: `https://threema.id/${id}`, name: id, key: 'threema:' + id };
      }
      case 'signal': {
        if (/signal\.me\//i.test(t)) {
          const ph = t.match(/#p\/\+?(\d+)/);
          return { url: /^https?:/i.test(t) ? t : 'https://' + t, name: ph ? flPhoneFmt(ph[1]) : t, key: ph ? 'signal:' + ph[1] : 'signal:' + t.toLowerCase() };
        }
        if (/^[+\d][\d\s()/.-]{5,}$/.test(t)) { const d = flPhoneDigits(t); return { url: `https://signal.me/#p/+${d}`, name: flPhoneFmt(d), key: 'signal:' + d }; }
        return { url: '', name: t, key: 'signal:u:' + t.toLowerCase(), text: true };
      }
      default: {
        if (flIsUrlish(t)) { const url = /^https?:/i.test(t) ? t : 'https://' + t; return { url, name: '', key: flLinkKey(url) }; }
        return { url: '', name: t, key: `${pf}:n:${norm(t)}`, text: true };
      }
    }
  }
  // Vergleichsschlüssel eines Links (JOYclub: Profil-ID)
  function flLinkKey(url) {
    const pf = flDetectPf(url);
    if (pf === 'joyclub') { const id = idOf(String(url).replace(/^https?:\/\/[^/]+/i, '')); if (id) return 'joyclub:' + id; }
    if (['telegram', 'whatsapp', 'threema', 'signal'].includes(pf)) { const n = flNormProfile(pf, url); if (n) return n.key; }
    const c = flCanonLink(url);
    return c ? 'url:' + c : '';
  }
  // alle Schlüssel eines Profils aus dem Austausch / der Fickliste
  function flProfKeys(pr) {
    if (!pr) return [];
    const out = [];
    const pf = pr.pf || flDetectPf(pr.url) || 'other';
    if (pr.uid != null && pr.uid !== '') out.push(`${pf}:uid:${String(pr.uid).toLowerCase()}`);
    if (pf === 'joyclub' && /^\d+$/.test(String(pr.uid || ''))) out.push('joyclub:' + pr.uid);
    if (pr.url) { const k = flLinkKey(pr.url); if (k) out.push(k); }
    if (!pr.url && pr.name && ['telegram', 'whatsapp', 'threema', 'signal'].includes(pf)) { const n = flNormProfile(pf, pr.name); if (n) out.push(n.key); }
    return [...new Set(out)];
  }
  const flProfName = (x) => x.name || x.nick || (x.url ? decodeURIComponent(String(x.url).replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || x.url) : '');
  // Hauptprofil einer Person (für Austausch und Links)
  function flMainOf(q) {
    if (!flIsExt(q.id)) { const o = { pf: 'joyclub', uid: q.id, nick: q.nick, url: 'https://www.joyclub.de' + (q.path || `/profile/${q.id}.html`) }; if (q.live === 'dead') o.dead = true; return o; }
    if (q.main) return Object.assign({}, q.main, { nick: q.nick || q.main.nick });
    const o = { pf: q.wasJoy ? 'joyclub' : 'other', nick: q.nick, url: '' };
    if (q.wasJoy) o.dead = true;
    return o;
  }
  // nicht-JOYclub-Hauptprofil: Nick verlinkt auf die Plattform
  const flForeignMain = (p) => !!(p && flIsExt(p.id) && p.main && p.main.pf && p.main.pf !== 'joyclub' && p.main.url);
  // Plattformen einer Person (für Filter und Symbole)
  function flPersonPfs(ids) {
    const fl = getFl(), s = new Set();
    for (const id of ids) {
      const q = fl[id]; if (!q) continue;
      if (!flIsExt(id) || q.wasJoy) s.add('joyclub');
      if (q.main && q.main.pf) s.add(q.main.pf);
      if (flIsExt(id) && !q.main && !q.wasJoy && !(q.profiles || []).length) s.add('other');
      for (const pr of q.profiles || []) s.add(pr.pf || 'other');
    }
    return [...s];
  }
  function flProfilesHtml(p, opt = {}) {
    const l = (p.profiles || []).filter((x) => !(x.pf === 'joyclub' && x.uid && flGet(String(x.uid))));
    if (flForeignMain(p)) l.unshift(Object.assign({ main: true }, p.main));
    if (!l.length && !opt.plus) return '';
    const plus = opt.plus ? `<button type="button" class="jaf-fl-plus" data-pid="${escHtml(p.id)}" title="Profil auf einer anderen Plattform oder Messenger-Kontakt zufügen" style="min-width:40px;height:22px;padding:0 12px;border-radius:11px;border:1px solid rgba(128,128,128,.6);background:rgba(128,128,128,.18);color:inherit;font:bold 15px/1 system-ui;cursor:pointer">+</button>` : '';
    return '<div class="jaf-fl-also" style="font-size:12.5px;margin-top:6px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center"><span style="opacity:.8">Auch auf:</span>' + l.map((x) => {
      const nm = escHtml(flProfName(x));
      const inner = `${flPfBadge(x.pf, { pfName: x.pfName, title: flPfLabel(x.pf, x.pfName) + (x.dead ? ' (Profil gelöscht)' : '') })}<span style="${x.dead ? 'text-decoration:line-through;opacity:.6' : ''}">${nm}</span>`;
      if (x.url) return `<a href="${escHtml(x.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;display:inline-flex;gap:5px;align-items:center;text-decoration:none">${inner}</a>`;
      return `<span style="display:inline-flex;gap:5px;align-items:center">${inner}<button type="button" class="jaf-fl-copy" data-t="${escHtml(x.name || '')}" title="Kopieren" style="background:none;border:0;color:inherit;opacity:.7;cursor:pointer;padding:0 2px;font-size:13px">⧉</button></span>`;
    }).join('') + plus + '</div>';
  }
  document.addEventListener('click', (e) => {
    const pb = e.target && e.target.closest && e.target.closest('.jaf-fl-plus');
    if (pb) {
      e.preventDefault(); e.stopPropagation();
      const pid = pb.getAttribute('data-pid');
      const p = flGet(pid);
      if (p) flProfilesPopup(pid);
      return;
    }
    const b = e.target && e.target.closest && e.target.closest('.jaf-fl-copy');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    copyText(b.getAttribute('data-t') || '').then((ok) => { b.textContent = ok ? '✓' : '✗'; setTimeout(() => { b.textContent = '⧉'; }, 1500); });
  }, true);
  // JOYclub-ID eines im Austausch/„Auch auf“ eingetragenen JOYclub-Profils (Link, uid oder bekannter Nick)
  function flJoyIdOf(pr) {
    if (!pr || pr.pf !== 'joyclub') return '';
    if (/^\d+$/.test(String(pr.uid || ''))) return String(pr.uid);
    const fromUrl = pr.url ? idOf(String(pr.url).replace(/^https?:\/\/[^/]+/i, '')) : '';
    if (fromUrl) return fromUrl;
    const nm = norm(pr.name || pr.nick || '');
    if (!nm) return '';
    const fl = Object.values(getFl()).find((q) => !flIsExt(q.id) && [q.nick, ...(q.nicks || [])].some((n) => norm(n) === nm));
    if (fl) return fl.id;
    const k = [...flKnownProfiles().values()].find((q) => norm(q.nick) === nm);
    return k ? k.id : '';
  }
  // Eintrag ohne eigenes Hauptprofil, aber mit JOYclub-Profil → JOYclub wird Hauptprofil, das fremde bleibt in profiles (main:true)
  function flRebaseX(X) {
    if (!X || !X.main || X.main.pf === 'joyclub') return X;
    const jp = (X.profiles || []).find((pr) => pr && pr.pf === 'joyclub' && flJoyIdOf(pr));
    if (!jp) return X;
    const id = flJoyIdOf(jp);
    const known = flGet(id) || flKnownProfiles().get(id);
    const url = jp.url || (known && known.path ? 'https://www.joyclub.de' + known.path : `https://www.joyclub.de/profile/${id}.html`);
    const fm = Object.assign({}, X.main, { name: X.main.nick || X.main.name, main: true }); delete fm.nick;
    const rest = (X.profiles || []).filter((pr) => pr !== jp);
    const nm = Object.assign({}, jp, { pf: 'joyclub', uid: id, nick: jp.name || jp.nick || (known && known.nick) || X.main.nick, url });
    delete nm.name; delete nm.main; delete nm.status; delete nm.statusAt; delete nm.sync;
    return Object.assign({}, X, { main: nm, profiles: [fm, ...rest] });
  }
  // bereits angelegte Fremd-Einträge mit JOYclub-Profil in JOYclub-Einträge umwandeln (bzw. mit vorhandenem zusammenführen)
  function flAdoptJoy(extId, joyId, nick, path) {
    const a = flGet(extId);
    if (!a || !joyId) return false;
    if (!flGet(joyId)) flPut({ id: joyId, nick: nick || a.nick, path: path || `/profile/${joyId}.html`, type: a.type || '', status: '', meets: [], hist: [], created: Date.now() });
    flMergePersons(extId, joyId);
    const b = flGet(joyId);
    b.profiles = (b.profiles || []).filter((pr) => !(pr.pf === 'joyclub' && flJoyIdOf(pr) === joyId));
    b.__keepStatusAt = true;
    flPut(b);
    return true;
  }
  function flAdoptScan(pagePid = '', pageNick = '', pagePath = '') {
    for (const q of Object.values(getFl())) {
      if (!flIsExt(q.id) || !q.main || q.main.pf === 'joyclub') continue;
      for (const pr of q.profiles || []) {
        if (pr.pf !== 'joyclub') continue;
        let id = flJoyIdOf(pr);
        if (!id && pagePid && pageNick && norm(pr.name || pr.nick) === norm(pageNick)) id = pagePid;
        if (id) { flAdoptJoy(q.id, id, pr.name || pr.nick, id === pagePid ? pagePath : ''); break; }
      }
    }
  }
  // Person „from“ in Person „into“ einfügen (z. B. importierter poppen-Eintrag ist dieselbe Person)
  function flMergePersons(fromId, intoId) {
    const a = flGet(fromId), b = flGet(intoId);
    if (!a || !b || fromId === intoId) return;
    const sa = flStatusAt(a), sb = flStatusAt(b);
    if (a.status && (!b.status || sa > sb)) { flHist(b, `Fickstatus: ${b.status ? flLabel(b.status) : '–'} → ${flLabel(a.status)} (aus ${a.nick})`); b.status = a.status; b.statusAt = sa; b.__keepStatusAt = true; }
    const prof = b.profiles = b.profiles || [];
    const have = new Set(prof.flatMap(flProfKeys));
    const add = (pr) => { const ks = flProfKeys(pr); if (ks.some((k) => have.has(k))) return; ks.forEach((k) => have.add(k)); prof.push(pr); };
    if (a.main && a.main.pf !== 'joyclub') { const mp = Object.assign({}, a.main, { name: a.main.nick || a.nick, main: true }); delete mp.nick; add(mp); }
    for (const pr of a.profiles || []) add(Object.assign({}, pr));
    const ids = new Set((b.meets || []).map((m) => m.id));
    b.meets = (b.meets || []).concat((a.meets || []).filter((m) => !ids.has(m.id)));
    b.hist = (b.hist || []).concat(a.hist || []).sort((x, y) => x.ts - y.ts);
    if (!b.notes && a.notes) b.notes = a.notes; else if (a.notes && a.notes !== b.notes) b.notes = `${b.notes}\n${a.notes}`;
    flHist(b, `zusammengeführt mit ${a.nick}`);
    flPut(b);
    flLinkRemove(fromId);
    const m = getFl(); delete m[fromId]; setFl(m);
  }
  // Popup „Profile auf anderen Plattformen“
  function flProfilesPopup(pid) {
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-prof');
      ov.style.zIndex = '2147483647';
      const render = () => {
        const p = flGet(pid);
        box.innerHTML = '';
        box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:6px', 'Auch auf …'));
        box.appendChild(flEl('div', 'color:#9a9a9a;font-size:13px;margin-bottom:10px', `Profile von ${escHtml(p.nick || '')} auf anderen Plattformen und Messenger-Kontakte.`));
        (p.profiles || []).forEach((x, i) => {
          const row = flEl('div', 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid #3a3d43;border-radius:8px;padding:7px 10px;margin-bottom:6px;background:#24262a');
          row.appendChild(flEl('span', 'display:inline-flex;gap:6px;align-items:center;flex:1;min-width:150px', `${flPfBadge(x.pf, { pfName: x.pfName, size: 18, title: flPfLabel(x.pf, x.pfName) + (x.dead ? ' (Profil gelöscht)' : '') })}<span style="${x.dead ? 'text-decoration:line-through;opacity:.6' : ''}">${escHtml(flProfName(x))}</span>`));
          const lb = flEl('label', 'display:flex;gap:5px;align-items:center;font-size:12.5px;cursor:pointer');
          const c = flEl('input'); c.type = 'checkbox'; c.checked = !!x.dead;
          c.addEventListener('change', () => { const q = flGet(pid); q.profiles[i].dead = c.checked || undefined; if (!c.checked) delete q.profiles[i].dead; flHist(q, `${flPfLabel(x.pf, x.pfName)}: Profil ${c.checked ? 'gelöscht' : 'wieder da'}`); flPut(q); render(); });
          lb.appendChild(c); lb.appendChild(flEl('span', '', 'Profil gelöscht'));
          row.appendChild(lb);
          const del = flEl('button', 'background:none;border:0;color:#9a9a9a;font:17px system-ui;cursor:pointer', '✕'); del.title = 'Entfernen';
          del.addEventListener('click', () => { const q = flGet(pid); q.profiles.splice(i, 1); flPut(q); render(); });
          row.appendChild(del);
          box.appendChild(row);
        });
        box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin:10px 0 4px', '+ Profil zufügen'));
        const r2 = flEl('div', 'display:flex;gap:8px;flex-wrap:wrap');
        const sel = flEl('select', FL_INPUT_CSS);
        for (const k of Object.keys(FL_PF)) if (k !== 'joyclub') sel.appendChild(new Option(FL_PF[k].label, k));
        const nm = flEl('input', FL_INPUT_CSS + ';width:130px;display:none'); nm.placeholder = 'Plattform';
        const inp = flEl('input', FL_INPUT_CSS + ';flex:1;min-width:180px');
        const sug = flEl('div', 'width:100%');
        const hint = () => { inp.placeholder = FL_PF_HINT[sel.value] || 'Profil-Link oder Name'; nm.style.display = sel.value === 'other' ? '' : 'none'; showSug(); };
        // Vorschläge: importierte Einträge dieser Plattform (ohne JOYclub-Profil) → zusammenführen
        const showSug = () => {
          sug.innerHTML = '';
          const t = norm(inp.value);
          const l = Object.values(getFl()).filter((q) => q.id !== pid && flIsExt(q.id) && q.main && q.main.pf === sel.value && (!t || norm(q.nick).includes(t) || norm(q.main.url).includes(t))).slice(0, 8);
          if (!l.length) return;
          sug.appendChild(flEl('div', 'font-size:12px;color:#9a9a9a;margin:6px 0 2px', `Importierte Einträge von ${escHtml(flPfLabel(sel.value))} – Klick führt sie mit dieser Person zusammen:`));
          for (const q of l) {
            const r = flEl('div', 'display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:6px;cursor:pointer;background:#2b2e34;margin-top:3px',
              `${flPfBadge(q.main.pf)}<span>${escHtml(q.nick)}</span>${flIcon(q.status, { size: 14, redGef: true })}<span style="opacity:.6;font-size:12px">${(q.meets || []).length} Treffen</span>`);
            r.addEventListener('click', () => { flMergePersons(q.id, pid); render(); });
            sug.appendChild(r);
          }
        };
        sel.addEventListener('change', hint);
        inp.addEventListener('input', showSug);
        const err = flEl('div', 'color:#ffb020;font-size:13px;margin-top:6px;min-height:1px');
        r2.appendChild(sel); r2.appendChild(nm); r2.appendChild(inp);
        r2.appendChild(flBtn('Zufügen', () => {
          const pf = sel.value;
          const n = flNormProfile(pf, inp.value);
          if (!n) { err.textContent = `Das passt nicht zu ${flPfLabel(pf)} (${FL_PF_HINT[pf] || 'Profil-Link oder Name'}).`; return; }
          const q = flGet(pid);
          q.profiles = q.profiles || [];
          if (q.profiles.some((x) => flProfKeys(x).includes(n.key))) { err.textContent = 'Dieses Profil ist schon eingetragen.'; return; }
          const pr = { pf, url: n.url, name: n.name || flProfName({ url: n.url }) };
          if (pf === 'other' && nm.value.trim()) pr.pfName = nm.value.trim();
          q.profiles.push(pr);
          flHist(q, `Profil zugefügt: ${flPfLabel(pf, pr.pfName)} ${pr.name}`);
          flPut(q);
          render();
        }, true));
        box.appendChild(r2);
        box.appendChild(sug);
        box.appendChild(err);
        hint();
        const row = flEl('div', 'display:flex;justify-content:flex-end;margin-top:14px');
        row.appendChild(flBtn('Schließen', () => { ov.remove(); resolve(); flRefreshAll(); }, true));
        box.appendChild(row);
      };
      render();
    });
  }

  // ---- Austausch mit poppen.de (Format „fickliste“ v1, poppen 2.1) ----
  const FL_X_ST = { will: 'want', gef: 'done', nein: 'no', nie: 'never' };
  const FL_X_ST_R = { want: 'will', done: 'gef', no: 'nein', never: 'nie' };
  function flStatusAt(p) {
    if (!p) return 0;
    if (p.statusAt) return p.statusAt;
    const h = (p.hist || []).filter((x) => /^Fickstatus/.test(x.why || '')).pop();
    return h ? h.ts : (p.created || 0);
  }
  function flMeetOut(m, owner) {
    const o = Object.assign({}, m);
    delete o.wo; delete o.url; delete o.as;
    o.where = m.wo || ''; o.club = m.club || ''; o.link = m.url || '';
    o.pf = m.pf || flDetectPf(m.url) || (flIsExt(owner.id) ? ((owner.main && owner.main.pf) || 'other') : 'joyclub');
    const uid = m.uid != null ? m.uid : (flIsExt(owner.id) ? (owner.main && owner.main.uid) : owner.id);
    if (uid != null && uid !== '') o.uid = uid; else delete o.uid;
    return o;
  }
  function flMeetIn(x) {
    const o = Object.assign({}, x);
    delete o.where; delete o.link;
    o.wo = x.where || ''; o.url = x.link || ''; o.club = x.club || '';
    if (!o.id) o.id = flNewId();
    return o;
  }
  const flMeetKey = (o) => [o.pf || '', String(o.uid == null ? '' : o.uid), o.date || '', norm(o.where), norm(o.club), flCanonLink(o.link)].join('|');
  function flExportPersons() {
    const fl = getFl(), G = flGroups(), done = new Set(), out = [];
    for (const p0 of Object.values(fl)) {
      if (done.has(p0.id)) continue;
      const prim = fl[flPrimaryId(p0.id, G)] || p0;
      const ids = flMembers(prim.id, G).filter((id) => fl[id]);
      if (!ids.includes(prim.id)) ids.unshift(prim.id);
      ids.forEach((id) => done.add(id));
      const x = Object.assign({}, prim.xfer || {});
      x.id = prim.xid || prim.id;
      x.status = FL_X_ST[prim.status] || null;
      x.statusAt = flStatusAt(prim);
      x.main = flMainOf(prim);
      if (flIsExt(prim.id)) x.ext = true; else delete x.ext;
      const g = flGroupOf(prim.id, G);
      x.profiles = [];
      for (const id of ids) {
        if (id === prim.id) continue;
        const q = fl[id], mo = flMainOf(q);
        const pr = { pf: mo.pf, url: mo.url, name: q.nick, status: FL_X_ST[q.status] || null, statusAt: flStatusAt(q), sync: !!(g && g.g.members[id] && g.g.members[id].sync) };
        if (mo.uid != null) pr.uid = mo.uid;
        if (mo.dead) pr.dead = true;
        x.profiles.push(pr);
      }
      for (const id of ids) for (const pr of fl[id].profiles || []) x.profiles.push(Object.assign({}, pr));
      x.meets = [];
      for (const id of ids) for (const m of fl[id].meets || []) x.meets.push(flMeetOut(m, fl[id]));
      x.history = (prim.hist || []).map((h) => ({ at: h.ts, what: h.why }));
      // Anmerkungen: allgemeines Feld (seit 1.88), joy.notes bleibt vorerst für ältere Stände
      x.notes = prim.notes || '';
      if (prim.notesAt) x.notesAt = prim.notesAt; else delete x.notesAt;
      if (prim.notesBy) x.notesBy = prim.notesBy; else delete x.notesBy;
      x.joy = Object.assign({}, x.joy || {}, { type: prim.type || '', notes: prim.notes || '', pnote: prim.pnote || '' });
      out.push(x);
    }
    return out;
  }
  async function flExportFile() {
    const nick = ownNick();
    if (!nick) throw new Error('Eigener Nick unbekannt – bitte einmal eine JOYclub-Seite mit Titelleiste öffnen.');
    const inner = { format: 'fickliste', version: 1, platform: 'joyclub', exported: Date.now(), persons: flExportPersons() };
    const enc = await flEncrypt(inner, nick);
    return { format: 'fickliste-enc', platform: 'joyclub', account: nick, alg: 'AES-GCM/PBKDF2', salt: enc.salt, iv: enc.iv, data: enc.data };
  }
  function flDownload(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function flExportPopup() {
    const { ov, box } = flOverlay('jaf-fl-export');
    box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:6px', 'Fickliste exportieren'));
    box.appendChild(flEl('div', 'color:#9a9a9a;font-size:13px;margin-bottom:12px', 'Für den Abgleich mit dem Skript auf poppen.de. Die Datei ist mit deinem Nick verschlüsselt (AES-GCM) und enthält alle Personen, Profile, Treffen und den Verlauf.'));
    const msg = flEl('div', 'font-size:13px;min-height:1.4em;margin-bottom:10px', 'Wird vorbereitet …');
    box.appendChild(msg);
    let text = '';
    try { const f = await flExportFile(); text = JSON.stringify(f); msg.textContent = `${flExportPersons().length} Personen bereit.`; } catch (e) { msg.textContent = e.message; msg.style.color = '#ffb020'; }
    const row = flEl('div', 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap');
    if (text) {
      row.appendChild(flBtn('Als Datei speichern', () => { flDownload(`fickliste-joyclub-${isoDay(new Date())}.json`, text); msg.textContent = 'Datei gespeichert.'; }, true));
      row.appendChild(flBtn('In die Zwischenablage', async () => { msg.textContent = (await copyText(text)) ? 'In die Zwischenablage kopiert.' : 'Kopieren nicht möglich.'; }));
    }
    row.appendChild(flBtn('Schließen', () => ov.remove()));
    box.appendChild(row);
  }
  async function flParseImport(text, askNick) {
    let d;
    try { d = JSON.parse(String(text || '').trim()); } catch (e) { throw new Error('Keine gültige Fickliste-Datei (JSON).'); }
    if (d && d.format === 'fickliste-enc') {
      let inner = await flDecrypt({ salt: d.salt, iv: d.iv, data: d.data }, d.account || '');
      if (!inner) inner = await flDecrypt({ salt: d.salt, iv: d.iv, data: d.data }, ownNick());
      while (!inner) {
        const n = await askNick(d.account);
        if (!n) throw new Error('Entschlüsseln abgebrochen.');
        inner = await flDecrypt({ salt: d.salt, iv: d.iv, data: d.data }, n);
      }
      d = inner;
    }
    if (!d || d.format !== 'fickliste' || !Array.isArray(d.persons)) throw new Error('Keine Fickliste im Austauschformat.');
    return d;
  }
  // Gruppen zweier lokaler Einträge verbinden (für „Zusammenführen“)
  function flGroupJoin(a, b) {
    const G = flGroups();
    const ga = flGroupOf(a, G), gb = flGroupOf(b, G);
    if (ga && gb && ga.gid === gb.gid) return;
    let gid = ga ? ga.gid : flNewId();
    if (!ga) G[gid] = { primary: a, members: { [a]: { sync: false } } };
    if (gb) { Object.assign(G[gid].members, gb.g.members); delete G[gb.gid]; } else G[gid].members[b] = { sync: false };
    flSetGroups(G);
  }
  // lokaler Index: Schlüssel → Eintrags-ID
  function flLocalIndex() {
    const idx = new Map();
    const put = (k, id) => { if (k && !idx.has(k)) idx.set(k, id); };
    for (const q of Object.values(getFl())) {
      if (!flIsExt(q.id)) put('joyclub:' + q.id, q.id);
      if (q.main) flProfKeys(q.main).forEach((k) => put(k, q.id));
      if (q.xid) put('xid:' + q.xid, q.id);
      for (const pr of q.profiles || []) flProfKeys(pr).forEach((k) => put(k, q.id));
    }
    return idx;
  }
  const flXKeys = (X) => [X.main, ...(X.profiles || [])].flatMap(flProfKeys);
  // neue Person aus dem Austausch anlegen → ID
  function flCreateFromX(X) {
    const mo = X.main || {};
    const fl = getFl();
    if (mo.pf === 'joyclub' && /^\d+$/.test(String(mo.uid || ''))) {
      const id = String(mo.uid);
      if (!fl[id]) {
        const path = (String(mo.url || '').match(/\/(?:profile|my)\/\d+\.[^?#\s]*/) || [`/profile/${id}.html`])[0].replace(/^\/my\//, '/profile/');
        flPut({ id, nick: mo.nick || mo.name || `Profil ${id}`, path, type: (X.joy && X.joy.type) || '', status: '', meets: [], hist: [], created: Date.now(), live: mo.dead ? 'dead' : undefined });
      }
      return id;
    }
    const pf = mo.pf || 'other';
    const slug = String(mo.uid || norm(mo.nick || mo.name || '').replace(/[^a-z0-9äöüß_-]+/g, '_') || flNewId());
    let id = `x-${pf}-${slug}`.slice(0, 80);
    while (fl[id]) id += '_';
    const q = { id, nick: mo.nick || mo.name || slug, type: (X.joy && X.joy.type) || '', ext: true, status: '', meets: [], hist: [], created: Date.now(), xid: X.id };
    if (pf === 'joyclub') q.wasJoy = true; else q.main = Object.assign({}, mo);
    flPut(q);
    return id;
  }
  // Person X in die lokale Person (Gruppe von rootId) einarbeiten → true bei Änderung
  const flSnap = (ids) => JSON.stringify(ids.map((id) => { const q = Object.assign({}, flGet(id)); delete q.updated; return q; }));
  function flMergeIn(X, rootId, isNew = false) {
    const before = flSnap(flMembers(rootId));
    const prim = flPrimaryId(rootId);
    const KNOWN = ['id', 'status', 'statusAt', 'main', 'profiles', 'meets', 'history', 'ext', 'joy', 'notes', 'notesAt', 'notesBy'];
    // JOYclub-Profile der Person (Hauptprofil und weitere) lokal sicherstellen und verknüpfen
    const joyProfs = [X.main, ...(X.profiles || [])].filter((pr) => pr && pr.pf === 'joyclub' && flJoyIdOf(pr));
    for (const pr of joyProfs) {
      const id = flJoyIdOf(pr);
      if (!flGet(id)) flCreateFromX({ main: Object.assign({}, pr, { uid: id, nick: pr.nick || pr.name }) });
      if (!flMembers(prim).includes(id) && id !== prim) {
        const G = flGroups();
        if (!flGroupOf(id, G) || flPrimaryId(id, G) === id) flGroupJoin(prim, id);
      }
      const L = flGet(id);
      if (pr !== X.main && pr.status !== undefined && (pr.statusAt || 0) > flStatusAt(L)) {
        const ns = FL_X_ST_R[pr.status] || '';
        if (ns !== (L.status || '')) flHist(L, `Fickstatus: ${L.status ? flLabel(L.status) : '–'} → ${ns ? flLabel(ns) : 'zurückgesetzt'} (Import)`);
        L.status = ns; L.statusAt = pr.statusAt; L.__keepStatusAt = true; flPut(L);
      }
      if (pr !== X.main && pr.sync != null) {
        const G = flGroups(); const g = flGroupOf(id, G);
        if (g && g.g.members[id] && !!g.g.members[id].sync !== !!pr.sync) { g.g.members[id].sync = !!pr.sync; flSetGroups(G); }
      }
      if (pr.dead && L.live !== 'dead') flSetLive(L, 'dead', 'laut Import');
    }
    // Personenstatus: neuerer gewinnt (gilt für das primäre Profil und synchron gehaltene)
    const members = flMembers(prim).map(flGet).filter(Boolean);
    const P = members.find((q) => q.id === prim) || flGet(prim);
    if (X.status !== undefined && (isNew || (X.statusAt || 0) > flStatusAt(P))) {
      const ns = FL_X_ST_R[X.status] || '';
      if (ns !== (P.status || '')) flHist(P, `Fickstatus: ${P.status ? flLabel(P.status) : '–'} → ${ns ? flLabel(ns) : 'zurückgesetzt'} (Import)`);
      P.status = ns; P.statusAt = X.statusAt || Date.now(); P.__keepStatusAt = true;
    }
    // Profile anderer Plattformen
    P.profiles = P.profiles || [];
    const haveKeys = new Map();
    for (const q of members) {
      if (q.id === P.id) continue;
      if (q.main) flProfKeys(q.main).forEach((k) => haveKeys.set(k, null));
    }
    if (P.main) flProfKeys(P.main).forEach((k) => haveKeys.set(k, null));
    for (const q of members) for (const pr of (q.id === P.id ? P : q).profiles || []) flProfKeys(pr).forEach((k) => haveKeys.set(k, pr));
    for (const pr of [X.main, ...(X.profiles || [])]) {
      if (!pr || (pr.pf === 'joyclub' && flJoyIdOf(pr))) continue; // JOYclub-Profile mit ID sind eigene Einträge
      const ks = flProfKeys(pr);
      const hit = ks.map((k) => haveKeys.get(k)).find((v) => v !== undefined);
      if (hit === undefined) {
        const n = Object.assign({}, pr); if (pr === X.main) { n.name = pr.nick || pr.name; delete n.nick; n.main = true; }
        P.profiles.push(n); ks.forEach((k) => haveKeys.set(k, n));
      } else if (hit) { for (const [k, v] of Object.entries(pr)) if (hit[k] == null && v != null && k !== 'main' && k !== 'nick') hit[k] = v; if (pr.dead && !hit.dead) hit.dead = true; }
    }
    // Treffen: gleiche id → nur Fehlendes ergänzen; sonst gleich bei pf/uid/date/where/club/link; sonst neu
    const objs = new Map(members.map((q) => [q.id, q.id === P.id ? P : q]));
    if (!objs.has(P.id)) objs.set(P.id, P);
    const all = [];
    for (const q of objs.values()) for (const m of q.meets || []) all.push({ m, q });
    const byId = new Map(all.map((x) => [x.m.id, x]));
    const byKey = new Map(all.map((x) => [flMeetKey(flMeetOut(x.m, x.q)), x]));
    const touched = new Set();
    for (const xm of X.meets || []) {
      const hit = (xm.id && byId.get(xm.id)) || byKey.get(flMeetKey(xm));
      if (hit) {
        const inn = flMeetIn(xm);
        if (typeof inn.note === 'string') inn.note = smToJoy(inn.note, flImpFrom).slice(0, 8000);
        // Ficknotiz: gleich bis auf Smileys → bleibt; Ergänzungen einmischen; sonst gewinnt die neuere
        if (inn.note && hit.m.note && smNorm(inn.note) !== smNorm(hit.m.note)) {
          const mg = tplMerge(hit.m.note, xm.note || '', flImpFrom);
          if (mg) hit.m.note = mg.text.slice(0, 8000);
          else if ((xm.noteAt || 0) > (hit.m.noteAt || 0)) { hit.m.note = inn.note; hit.m.noteAt = xm.noteAt; if (xm.noteBy) hit.m.noteBy = xm.noteBy; }
          touched.add(hit.q);
        }
        for (const [k, v] of Object.entries(inn)) if ((hit.m[k] == null || hit.m[k] === '') && v != null && v !== '') { hit.m[k] = v; touched.add(hit.q); }
        continue;
      }
      let ownerId = prim;
      if (xm.pf === 'joyclub' && xm.uid != null && objs.has(String(xm.uid))) ownerId = String(xm.uid);
      else if (xm.uid != null) { const o = [...objs.values()].find((q) => flIsExt(q.id) && q.main && String(q.main.uid) === String(xm.uid)); if (o) ownerId = o.id; }
      const owner = objs.get(ownerId);
      const nm = flMeetIn(xm);
      if (typeof nm.note === 'string') nm.note = smToJoy(nm.note, flImpFrom).slice(0, 8000);
      (owner.meets = owner.meets || []).push(nm);
      touched.add(owner);
      const rec = { m: nm, q: owner };
      byId.set(nm.id, rec); byKey.set(flMeetKey(xm), rec);
    }
    for (const q of touched) if (q !== P) flPut(q);
    // Verlauf und unbekannte Felder
    const P2 = P;
    P2.__keepStatusAt = true;
    const hk = new Set((P2.hist || []).map((h) => `${h.ts}|${h.why}`));
    for (const h of X.history || []) { const k = `${h.at}|${h.what}`; if (!hk.has(k)) { (P2.hist = P2.hist || []).push({ ts: h.at, why: h.what }); hk.add(k); } }
    (P2.hist || []).sort((a, b) => a.ts - b.ts);
    const extra = {};
    for (const [k, v] of Object.entries(X)) if (!KNOWN.includes(k)) extra[k] = v;
    if (Object.keys(extra).length) P2.xfer = Object.assign({}, P2.xfer || {}, extra);
    if (X.id && !P2.xid && flIsExt(P2.id)) P2.xid = X.id;
    // Anmerkungen: persons[].notes (neu) vor joy.notes (alt); die neuere Fassung gewinnt, gleicher Text bleibt
    const xNotes = typeof X.notes === 'string' ? X.notes.slice(0, 8000) : (X.joy && X.joy.notes) || '';
    if (xNotes && smNorm(xNotes) !== smNorm(P2.notes || '')) {
      // gleich bis auf Smileys → bleibt; Ergänzungen einmischen; sonst gewinnt die neuere Fassung
      const mg = P2.notes ? tplMerge(P2.notes, xNotes, flImpFrom) : null;
      if (mg) { if (mg.text !== P2.notes) { P2.notes = mg.text.slice(0, 8000); P2.notesAt = Date.now(); P2.notesBy = { platform: 'joyclub', account: ownNick() || '' }; } }
      else if (!P2.notes || (X.notesAt && X.notesAt > (P2.notesAt || 0))) {
        P2.notes = smToJoy(xNotes, flImpFrom).slice(0, 8000);
        if (X.notesAt) P2.notesAt = X.notesAt;
        if (X.notesBy) P2.notesBy = X.notesBy;
      }
    }
    if (X.joy) { if (!P2.notes && X.joy.notes) P2.notes = X.joy.notes; if (!P2.type && X.joy.type) P2.type = X.joy.type; if (!P2.pnote && X.joy.pnote) P2.pnote = X.joy.pnote; }
    flPut(P2);
    flSyncStatus(prim);
    return flSnap(flMembers(prim)) !== before;
  }
  var flImpFrom = 'joyclub'; // eslint-disable-line no-var // Plattform der gerade importierten Fickliste (für die Smiley-Übersetzung)
  async function flImportRun(d, ask) {
    flImpFrom = d && d.platform ? String(d.platform) : 'joyclub';
    const st = { neu: 0, auto: 0, conflict: 0, merged: 0, separate: 0, same: 0, names: [] };
    const conflicts = [];
    for (const X0 of d.persons) {
      if (!X0 || !X0.main) continue;
      const X = flRebaseX(X0);
      const idx = flLocalIndex();
      const keys = flXKeys(X).concat(X.id ? ['xid:' + X.id] : []);
      const roots = [...new Set(keys.map((k) => idx.get(k)).filter(Boolean).map((id) => flPrimaryId(id)))];
      if (!roots.length) { const id = flCreateFromX(X); flMergeIn(X, id, true); st.neu++; continue; }
      if (roots.length === 1) { if (flMergeIn(X, roots[0])) st.auto++; else st.same++; continue; }
      conflicts.push({ X, roots, X0 });
    }
    for (const c of conflicts) {
      st.conflict++;
      const roots = c.roots.filter((r) => flGet(r));
      const names = roots.map((r) => flGet(r).nick);
      const yes = await ask(c.X, names);
      if (yes === 'defer') { (st.deferred = st.deferred || []).push(c.X0); st.conflict--; continue; }
      if (yes) {
        const joy = roots.filter((r) => !flIsExt(r));
        const into = joy[0] || roots[0];
        for (const r of roots) { if (r === into) continue; if (flIsExt(r)) flMergePersons(r, into); else flGroupJoin(into, r); }
        flMergeIn(c.X, into);
        st.merged++;
      } else {
        const idx = flLocalIndex();
        const mainHit = flProfKeys(c.X.main).map((k) => idx.get(k)).find(Boolean);
        if (mainHit) flMergeIn(c.X, flPrimaryId(mainHit));
        st.separate++;
        st.names.push(names.join(' / '));
      }
    }
    return st;
  }
  function flImportPopup() {
    const { ov, box } = flOverlay('jaf-fl-import');
    box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:6px', 'Fickliste importieren'));
    box.appendChild(flEl('div', 'color:#9a9a9a;font-size:13px;margin-bottom:10px', 'Export aus dem Skript auf poppen.de (oder von hier). Gleiche Personen werden über Profil-Links und IDs erkannt und verknüpft; Treffen werden zusammengeführt, nie überschrieben; beim Status gewinnt die neuere Änderung.'));
    const file = flEl('input', 'margin-bottom:10px'); file.type = 'file'; file.accept = '.json,application/json,text/plain';
    box.appendChild(file);
    box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin:4px 0', 'oder Inhalt hier einfügen:'));
    const ta = flEl('textarea', FL_INPUT_CSS + ';width:100%;height:90px;resize:vertical;font-family:monospace;font-size:12px');
    box.appendChild(ta);
    const msg = flEl('div', 'font-size:13px;min-height:1.4em;margin-top:8px;white-space:pre-line');
    box.appendChild(msg);
    file.addEventListener('change', () => { const f = file.files && file.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { ta.value = String(fr.result || ''); }; fr.readAsText(f); });
    const row = flEl('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px');
    const go = flBtn('Importieren', async () => {
      go.disabled = true; msg.style.color = ''; msg.textContent = 'Wird gelesen …';
      try {
        const d = await flParseImport(ta.value, (acc) => flAskText('Nick zum Entschlüsseln', `Die Datei wurde mit dem Nick „${acc || '?'}“ verschlüsselt und ließ sich damit nicht öffnen. Mit welchem Nick wurde sie exportiert?`, acc || ''));
        msg.textContent = `${d.persons.length} Personen aus ${escHtml(d.platform || '?')} – wird abgeglichen …`;
        const st = await flImportRun(d, (X, names) => flAskMerge(X, names));
        msg.textContent = `Fertig.\nNeu: ${st.neu} · automatisch verknüpft/ergänzt: ${st.auto} · Konflikte: ${st.conflict} (zusammengeführt ${st.merged}, getrennt gelassen ${st.separate}) · unverändert: ${st.same}` +
          (st.names.length ? `\nGetrennt gelassen: ${st.names.join(', ')}` : '');
        flRefreshAll();
      } catch (e) { msg.style.color = '#ffb020'; msg.textContent = e.message || String(e); }
      go.disabled = false;
    }, true);
    row.appendChild(go);
    row.appendChild(flBtn('Schließen', () => { ov.remove(); if (flOverviewPage()) flRenderOverview(); }));
    box.appendChild(row);
  }
  function flAskText(title, text, val) {
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-asktext');
      ov.style.zIndex = '2147483647';
      box.appendChild(flEl('div', 'font:bold 18px system-ui;margin-bottom:6px', escHtml(title)));
      box.appendChild(flEl('div', 'font-size:13px;margin-bottom:8px', escHtml(text)));
      const i = flEl('input', FL_INPUT_CSS + ';width:100%'); i.value = val || '';
      box.appendChild(i);
      const row = flEl('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px');
      row.appendChild(flBtn('OK', () => { ov.remove(); resolve(i.value.trim()); }, true));
      row.appendChild(flBtn('Abbrechen', () => { ov.remove(); resolve(''); }));
      box.appendChild(row);
      i.focus();
    });
  }
  function flAskMerge(X, names) {
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-askmerge');
      ov.style.zIndex = '2147483647';
      box.appendChild(flEl('div', 'font:bold 18px system-ui;margin-bottom:6px', 'Gleiche Person?'));
      const pr = [X.main, ...(X.profiles || [])].filter(Boolean).map((x) => `${flPfBadge(x.pf, { pfName: x.pfName })} ${escHtml(flProfName(x))}`).join(' · ');
      box.appendChild(flEl('div', 'font-size:13.5px;line-height:1.6', `Der Import-Eintrag <b>${escHtml(X.main.nick || X.main.name || '?')}</b> (${pr}) passt zu mehreren Personen deiner Fickliste: <b>${names.map(escHtml).join('</b> und <b>')}</b>.`));
      box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin-top:6px', '„Zusammenführen“ verknüpft sie zu einer Person. „Getrennt lassen“ ändert die Zuordnung nicht.'));
      const row = flEl('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px');
      row.appendChild(flBtn('Zusammenführen', () => { ov.remove(); resolve(true); }, true));
      row.appendChild(flBtn('Getrennt lassen', () => { ov.remove(); resolve(false); }));
      box.appendChild(row);
    });
  }

  // ---- Popup „Ficklisteneintragung“ ----
  // newState: neuer Zustand (null = nur bearbeiten); opt: { meetId, prefillMeet, note, title }
  async function flEntryPopup(p0, newState, opt = {}) {
    const onProfile = !flIsExt(p0.id) && isProfilePage() && idOf(location.pathname) === p0.id && !flArchivParam();
    const dead = flDead(p0) || flIsExt(p0.id);
    const nh = onProfile ? noteHost() : null;
    const noteNow = nh ? (nh.getAttribute('value') || '').trim() : (opt.note != null ? opt.note : (p0.pnote || ''));
    const noteEditable = onProfile || dead;
    const p = JSON.parse(JSON.stringify(p0));
    p.meets = p.meets || [];
    const st = newState || p.status || '';
    // Vorbelegung: Party, aus deren Gästeliste das Profil geöffnet wurde
    const ctx = onProfile && newState ? flCtxEvent(p.id) : null;
    const members = flMembers(p.id);
    // neue Treffen: eigenes Profil bei Will ich/Gefickt/Nie wieder!, sonst (kein Status, Nein danke) das primäre
    const defAs = () => {
      if (members.length < 2) return p.id;
      const prim = flPrimaryId(p.id);
      if (prim === p.id || !members.includes(prim)) return p.id;
      return ['will', 'gef', 'nie'].includes(st) ? p.id : prim;
    };
    let meets = flGroupMeets(p.id).map(({ m, owner }) => Object.assign({}, m, { as: owner.id }));
    if (opt.prefillMeet) meets.unshift(Object.assign({ id: flNewId(), as: defAs() }, opt.prefillMeet));
    else if (ctx && !meets.some((m) => m.url && ctx.url && m.url === ctx.url)) meets.unshift(Object.assign(flMeetFromEvent(ctx), { as: defAs() }));
    if (opt.meetId) { const i = meets.findIndex((m) => m.id === opt.meetId); if (i > 0) meets.unshift(meets.splice(i, 1)[0]); }
    const isIgn = !dead && blockedIdMap().has(p.id);
    const canIgnore = !dead;
    return new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-entry');
      box.appendChild(flEl('div', 'display:flex;align-items:center;gap:10px;font:bold 20px system-ui;margin-bottom:12px',
        `<span style="width:32px;height:32px;border-radius:50%;background:${st === 'gef' ? '#c71b1b' : '#33363c'};display:inline-flex;align-items:center;justify-content:center">${flIcon(st, { size: 20 })}</span>` +
        `<span>${escHtml(opt.title || 'Ficklisteneintragung')}${st ? ' · ' + escHtml(flLabel(st)) : ''}</span>`));
      if (p.nick) box.appendChild(flEl('div', 'color:#9a9a9a;margin:-6px 0 10px', escHtml(p.nick)));
      const lab = (t) => flEl('div', 'font-size:12.5px;color:#9a9a9a;margin:10px 0 4px', escHtml(t));
      // Profilnotiz
      box.appendChild(lab(onProfile ? 'Profilnotiz (JOYclub)' : dead ? 'Profilnotiz (gespeichert)' : 'Profilnotiz (nur auf der Profilseite änderbar)'));
      const note = flEl('textarea', FL_INPUT_CSS + ';width:100%;resize:vertical');
      note.rows = 3; note.value = noteNow; note.readOnly = !noteEditable;
      if (!noteEditable) note.style.opacity = '.7';
      box.appendChild(note);
      // Vorschläge aus Datumsangaben der Notiz
      const sugBox = flEl('div', '');
      box.appendChild(sugBox);
      const dismissed = new Set(p.dismissed || []);
      const renderSug = () => {
        sugBox.innerHTML = '';
        for (const d of flNoteDates(note.value)) {
          if (dismissed.has(d) || meets.some((m) => m.date === d)) continue;
          const { strong, weak } = flPartyMatches(d, note.value);
          if (!strong.length && !weak.length) continue;
          const row = flEl('div', 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#20242c;border-left:4px solid #2f6fd6;border-radius:6px;padding:7px 10px;margin-top:8px;font-size:13.5px',
            `<span style="flex:1">Party zum ${escHtml(fmtDate(d))} gefunden – übernehmen?</span>`);
          row.appendChild(flBtn('Ansehen …', async () => {
            const e = await flSuggestPopup(d, note.value);
            if (e) { meets.unshift(Object.assign(flMeetFromEvent(e), { as: defAs() })); renderMeets(); }
            if (e !== undefined) { if (!e) dismissed.add(d); renderSug(); }
          }, true));
          row.appendChild(flBtn('Ablehnen', () => { dismissed.add(d); renderSug(); }));
          sugBox.appendChild(row);
        }
      };
      note.addEventListener('input', () => { clearTimeout(note.__t); note.__t = setTimeout(renderSug, 400); });
      // Treffen
      box.appendChild(lab('Treffen'));
      const mbox = flEl('div', 'display:flex;flex-direction:column;gap:8px');
      box.appendChild(mbox);
      const clubDl = flEl('datalist'); clubDl.id = 'jaf-fl-clublist';
      for (const n of flKnownClubs()) clubDl.appendChild(new Option(n));
      box.appendChild(clubDl);
      const renderMeets = () => {
        mbox.innerHTML = '';
        for (const m of meets) {
          const c = flEl('div', `border:1px solid ${opt.meetId === m.id ? '#2f6fd6' : '#3a3d43'};border-radius:8px;padding:8px 10px;background:#24262a`);
          const r1 = flEl('div', 'display:flex;gap:6px;align-items:center');
          r1.appendChild(flEl('span', 'width:30px', 'was'));
          const wo = flEl('input', FL_INPUT_CSS + ';flex:1;min-width:0'); wo.value = m.wo || ''; wo.placeholder = 'Party, Anlass oder Party-Link';
          wo.addEventListener('input', async () => {
            m.wo = wo.value;
            if (/joyclub\.de\/event\/\d+\./.test(wo.value)) {
              wo.disabled = true; const old = wo.value; wo.value = 'Party wird gelesen …';
              const e = await flEventFromUrl(old);
              wo.disabled = false;
              if (e && e.name) Object.assign(m, flMeetFromEvent(e), { id: m.id, note: m.note });
              else { m.url = (e && e.url) || old; m.wo = ''; }
              renderMeets();
            }
          });
          r1.appendChild(wo);
          r1.appendChild(flBtn('Party wählen …', async () => { const e = await flChooseParty(); if (e) { Object.assign(m, flMeetFromEvent(e), { id: m.id, note: m.note }); renderMeets(); } }));
          const x = flEl('button', 'background:none;border:0;color:#9a9a9a;font:18px system-ui;cursor:pointer', '✕'); x.title = 'Treffen entfernen';
          x.addEventListener('click', (e) => { e.preventDefault(); meets.splice(meets.indexOf(m), 1); renderMeets(); });
          r1.appendChild(x);
          c.appendChild(r1);
          const rw = flEl('div', 'display:flex;gap:6px;align-items:center;margin-top:6px');
          rw.appendChild(flEl('span', 'width:30px', 'wo'));
          const cl = flEl('input', FL_INPUT_CSS + ';flex:1;min-width:0'); cl.value = m.club || ''; cl.placeholder = 'Club oder Ort';
          cl.setAttribute('list', 'jaf-fl-clublist');
          cl.addEventListener('input', () => { m.club = cl.value; });
          rw.appendChild(cl);
          c.appendChild(rw);
          if (members.length > 1) {
            const ra = flEl('div', 'display:flex;gap:6px;align-items:center;margin-top:6px');
            ra.appendChild(flEl('span', 'width:30px', 'als'));
            const sel = flEl('select', FL_INPUT_CSS);
            if (!m.as) m.as = defAs();
            for (const id of members) sel.appendChild(new Option((flGet(id) || { nick: id }).nick, id, id === m.as, id === m.as));
            sel.addEventListener('change', () => { m.as = sel.value; });
            ra.appendChild(sel);
            c.appendChild(ra);
          }
          if (m.url) c.appendChild(flEl('div', 'font-size:12px;color:#9a9a9a;margin:3px 0 0 36px', `<a href="${escHtml(m.url)}" target="_blank" style="color:#e2b04a">Party-Link</a>`));
          else c.appendChild(flEl('div', 'font-size:12px;color:#777;margin:3px 0 0 36px', 'Party-Link hier einfügen → Name, Datum und Beginn werden übernommen'));
          const r2 = flEl('div', 'display:flex;gap:6px;align-items:center;margin-top:6px');
          r2.appendChild(flEl('span', 'width:30px', 'am'));
          const dt = flEl('input', FL_INPUT_CSS); dt.type = 'date'; dt.value = m.date || '';
          dt.addEventListener('input', () => { m.date = dt.value; });
          r2.appendChild(dt);
          r2.appendChild(flEl('span', 'margin-left:8px', 'um'));
          const tm = flEl('input', FL_INPUT_CSS); tm.type = 'time'; tm.value = m.time || '';
          tm.addEventListener('input', () => { m.time = tm.value; });
          r2.appendChild(tm);
          c.appendChild(r2);
          c.appendChild(flEl('div', 'font-size:12px;color:#9a9a9a;margin:6px 0 3px', 'Ficknotiz'));
          const fn = flEl('textarea', FL_INPUT_CSS + ';width:100%;resize:vertical'); fn.rows = 2; fn.value = m.note || '';
          fn.addEventListener('input', () => { m.note = fn.value.slice(0, 8000); m.noteAt = Date.now(); m.noteBy = { platform: 'joyclub', account: ownNick() || '' }; });
          c.appendChild(fn);
          mbox.appendChild(c);
        }
      };
      renderMeets();
      renderSug();
      const add = flEl('a', 'display:inline-block;color:#e2b04a;font-weight:bold;margin-top:8px;cursor:pointer', '+ weiteres Treffen');
      add.addEventListener('click', (e) => { e.preventDefault(); meets.unshift({ id: flNewId(), date: '', time: '', wo: '', url: '', club: '', note: '', as: defAs() }); renderMeets(); });
      box.appendChild(add);
      // Anmerkungen (allgemein)
      box.appendChild(lab('Anmerkungen'));
      const notes = flEl('textarea', FL_INPUT_CSS + ';width:100%;resize:vertical'); notes.rows = 2; notes.value = p.notes || '';
      box.appendChild(notes);
      // verknüpfte Profile und Profile anderswo
      const lk = flEl('div', 'margin-top:12px');
      const lkInfo = flEl('div', '');
      const lkBtns = flEl('div', 'display:flex;gap:10px;flex-wrap:wrap;margin-top:6px');
      const lkShow = () => {
        const q = flGet(p.id) || p;
        lkInfo.innerHTML = (flLinkedHtml(p.id) || '<div style="font-size:12.5px;opacity:.7">keine verknüpften Profile</div>') + flProfilesHtml(q);
      };
      lkShow();
      lk.appendChild(lkInfo); lk.appendChild(lkBtns);
      const ensure = () => { if (!flGet(p.id)) { const q0 = Object.assign({}, p, { meets: [] }); flPut(q0); } };
      if (!flIsExt(p.id) || p.wasJoy) lkBtns.appendChild(flBtn('Verknüpfte Profile …', async () => {
        ensure();
        await flLinkPopup(p.id);
        // neu verknüpfte Profile: deren Treffen mit anzeigen
        const now = flMembers(p.id);
        for (const id of now) if (!members.includes(id)) for (const m of (flGet(id) || {}).meets || []) meets.push(Object.assign({}, m, { as: id }));
        members.splice(0, members.length, ...now);
        meets = meets.filter((m) => !m.as || members.includes(m.as));
        meets.sort((a, b) => meetTs(b) - meetTs(a));
        lkShow();
        renderMeets();
      }));
      lkBtns.appendChild(flBtn('Auch auf …', async () => {
        ensure();
        await flProfilesPopup(p.id);
        // zusammengeführte Einträge (z. B. importierter poppen-Eintrag): deren Treffen übernehmen
        for (const m of (flGet(p.id) || {}).meets || []) if (!meets.some((x) => x.id === m.id)) meets.push(Object.assign({}, m, { as: p.id }));
        meets.sort((a, b) => meetTs(b) - meetTs(a));
        lkShow();
        renderMeets();
      }));
      box.appendChild(lk);
      // Ignorieren
      let chk = null;
      if (canIgnore) {
        const row = flEl('label', 'display:flex;gap:8px;align-items:center;margin-top:14px;cursor:pointer');
        chk = flEl('input'); chk.type = 'checkbox';
        chk.checked = isIgn || ['nein', 'nie'].includes(newState);
        row.appendChild(chk);
        row.appendChild(flEl('span', '', 'Profil zukünftig ignorieren'));
        box.appendChild(row);
        if (isIgn) box.appendChild(flEl('div', 'color:#ffb020;font-size:12.5px;margin:2px 0 0 24px', 'Dieses Profil wird derzeit ignoriert!'));
      }
      const msg = flEl('div', 'color:#ffb020;font-size:13px;margin-top:8px;min-height:1px');
      box.appendChild(msg);
      const bs = flEl('div', 'display:flex;gap:10px;justify-content:flex-end;margin-top:14px');
      const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
      let busy = false;
      const save = async () => {
        if (busy) return;
        busy = true;
        msg.textContent = 'Speichere …';
        try {
          const q = flGet(p.id) || p;
          const old = q.status || '';
          q.nick = q.nick || p.nick; q.type = q.type || p.type; q.path = q.path || p.path; q.created = q.created || Date.now();
          const keep = meets.filter((m) => m.wo || m.date || m.note || m.url).map((m) => Object.assign({}, m, { id: m.id || flNewId() }));
          const strip = (m) => { const o = Object.assign({}, m); delete o.as; return o; };
          q.meets = keep.filter((m) => (m.as || defAs()) === p.id || !members.includes(m.as || defAs())).map(strip);
          for (const id of members) {
            if (id === p.id) continue;
            const o = flGet(id);
            if (!o) continue;
            const mine = keep.filter((m) => (m.as || defAs()) === id).map(strip);
            if (JSON.stringify(o.meets || []) !== JSON.stringify(mine)) { o.meets = mine; flPut(o); }
          }
          const nn = notes.value.trim().slice(0, 8000);
          if (nn !== (q.notes || '')) { q.notesAt = Date.now(); q.notesBy = { platform: 'joyclub', account: ownNick() || '' }; }
          q.notes = nn;
          q.dismissed = [...dismissed];
          if (newState && newState !== old) { q.status = newState; flHist(q, `Fickstatus: ${old ? flLabel(old) : '–'} → ${flLabel(newState)}`); }
          const nv = note.value.trim();
          if (noteEditable && nv !== noteNow) {
            q.pnote = nv;
            if (onProfile) {
              const ed = await openNoteEditor();
              if (ed.error) msg.textContent = `Profilnotiz nicht gespeichert: ${ed.error}`;
              else { const r = await commitNote(ed, nv, nv.split('\n')[0] || '', [], true); if (!r.ok) msg.textContent = r.msg; }
            } else flHist(q, 'Profilnotiz geändert');
          }
          flPut(q);
          flSyncStatus(q.id);
          if (chk && chk.checked !== isIgn) {
            msg.textContent = chk.checked ? 'Ignoriere …' : 'Entsperre …';
            const r = chk.checked ? await flDoIgnore(q) : await flDoUnignore(q);
            if (!r.ok) { msg.textContent = r.msg; await sleep(2500); }
          }
          if (onProfile) await flSnapshot(q.id, newState && newState !== old ? `Fickstatus: ${old ? flLabel(old) : '–'} → ${flLabel(newState)}` : 'Ficklisteneintragung', !!newState);
          done(flGet(q.id));
          flRefreshAll();
        } catch (e) { msg.textContent = `Fehler: ${e.message || e}`; busy = false; }
      };
      bs.appendChild(flBtn('Abbrechen', () => done(null)));
      bs.appendChild(flBtn('Speichern', save, true));
      box.appendChild(bs);
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
        if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); save(); }
      };
      document.addEventListener('keydown', onKey, true);
    });
  }

  // ---- Fickliste-Block unter der Profilnotiz ----
  const FL_PEN = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm17.7-10.2a1 1 0 0 0 0-1.42l-2.33-2.33a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  const FL_EXT = '<svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-1px;margin-left:3px" aria-hidden="true"><path fill="currentColor" d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>';
  function flMeetHtml(m, asNick = '') {
    const wo = escHtml(m.wo || (m.url ? 'Party' : 'Treffen')) + (asNick ? ` <span style="font-weight:normal;opacity:.75">(als ${escHtml(asNick)})</span>` : '');
    const when = [m.date ? `am ${fmtDate(m.date)}` : '', m.time ? `um ${m.time}` : ''].filter(Boolean).join(' ');
    const where = m.club ? `<span style="opacity:.7;font-weight:normal">${escHtml(m.club)}</span>` : '<span style="opacity:.5;font-weight:normal;font-style:italic">unbekannt</span>';
    return `<div class="jaf-fl-meet" style="padding:9px 0;border-bottom:1px solid rgba(128,128,128,.25)">` +
      `<div style="font-weight:600">${m.url ? `<a href="${escHtml(m.url)}" target="_blank" rel="noopener" style="color:#e2b04a;text-decoration:none">${wo}</a>${FL_EXT.replace('style="', 'style="color:#e2b04a;')} ${flPfBadge(m.pf || flDetectPf(m.url) || 'other', { size: 14 })}` : wo} <span style="opacity:.7;font-weight:normal">·</span> ${where}</div>` +
      (when ? `<div style="font-size:12.5px;opacity:.7">${escHtml(when)}</div>` : '') +
      (m.note ? `<div style="font-size:13px;margin-top:3px;white-space:pre-wrap">${escHtml(m.note)}</div>` : '') + '</div>';
  }
  function flBlockEl(p, opt = {}) {
    const el = flEl('div', 'margin:12px 0;padding:14px 16px;border-top:3px solid rgba(128,128,128,.35);border-radius:8px;background:rgba(128,128,128,.08)');
    el.className = 'jaf-fl-block';
    const st = p.status || '';
    const gm = flGroupMeets(p.id);
    const meets = gm.map((x) => x.m);
    const asOf = new Map(gm.map((x) => [x.m, x.owner]));
    // ohne eigenen Status, aber verknüpft: Kopf zeigt das primäre (bzw. ein verknüpftes Profil mit Status)
    let ref = null;
    if (!st && flMembers(p.id).length > 1) {
      const prim = flPrimaryId(p.id);
      ref = (prim !== p.id && flGet(prim)) || flMembers(p.id).map(flGet).find((q) => q && q.id !== p.id && q.status) || null;
    }
    const ist = ref ? ref.status || '' : st;
    const head = flEl('div', 'display:flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px',
      `<span style="width:26px;height:26px;border-radius:50%;background:${ist === 'gef' ? '#c71b1b' : '#33363c'};display:inline-flex;align-items:center;justify-content:center;color:#fff;${ref ? 'opacity:.55' : ''}">${flIcon(ist, { size: 16 })}</span>` +
      (ref ? `<span>Fickliste · <span style="font-weight:normal;opacity:.8">verknüpft mit</span> ${flNickHtml(ref)}${ref.status ? ` <span style="font-weight:normal;opacity:.8">(${escHtml(flLabel(ref.status))})</span>` : ''}</span>`
        : `<span>Fickliste · ${escHtml(flLabel(st))}</span>`));
    const pen = flEl('button', 'margin-left:auto;background:none;border:0;color:inherit;opacity:.7;cursor:pointer;padding:4px', FL_PEN);
    pen.title = 'Ficklisteneintragung bearbeiten';
    pen.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); flEntryPopup(flGet(p.id) || p, null); });
    head.appendChild(pen);
    el.appendChild(head);
    if (p.notes) el.appendChild(flEl('div', 'font-size:13px;margin-top:8px;white-space:pre-wrap;opacity:.9', escHtml(p.notes)));
    const lh = flLinkedHtml(p.id); if (lh) el.insertAdjacentHTML('beforeend', lh);
    const ph = flProfilesHtml(p, { plus: opt.plus !== false && !/[?&]archiv=/.test(location.search) }); if (ph) el.insertAdjacentHTML('beforeend', ph);
    const list = flEl('div', 'margin-top:4px');
    el.appendChild(list);
    let all = false;
    const render = () => {
      list.innerHTML = (all ? meets : meets.slice(0, 3)).map((m) => { const o = asOf.get(m); return flMeetHtml(m, o && o.id !== p.id ? o.nick : ''); }).join('') || '<div style="font-size:13px;opacity:.6;padding-top:6px">Kein Treffen eingetragen</div>';
      if (meets.length > 3) {
        const more = flEl('a', 'display:inline-block;margin-top:6px;color:#e2b04a;font-weight:600;font-size:13px;cursor:pointer', all ? 'Weniger anzeigen ▴' : `Mehr anzeigen (${meets.length - 3} weitere) ▾`);
        more.addEventListener('click', (e) => { e.preventDefault(); all = !all; render(); });
        list.appendChild(more);
      }
    };
    render();
    const to = flEl('a', 'display:inline-block;margin-top:10px;font-weight:600;text-decoration:underline;color:inherit;cursor:pointer', 'Zu meiner Fickliste');
    to.className = 'jaf-fl-tolist';
    to.href = flOverviewUrl(); to.target = '_blank';
    el.appendChild(to);
    return el;
  }
  function flProfileBlock() {
    const pid = flPagePid();
    const old = document.querySelector('.jaf-fl-block:not(.jaf-fl-own)');
    const p = pid && flGet(pid);
    if (!p || (!p.status && !(p.meets || []).length && !p.notes && !(p.profiles || []).length && flMembers(pid).length < 2)) { if (old && !old.closest('.jaf-fl-archive, .jaf-fl-extern')) old.remove(); return; }
    if (old && old.closest('.jaf-fl-archive, .jaf-fl-extern')) return; // dort baut die Seite den Block selbst
    const sig = JSON.stringify([p.status, flGroupMeets(p.id).map((x) => [x.m, x.owner.id]), p.notes, flLinkedHtml(p.id), p.profiles || []]);
    // Platz: erstes Element der Badge-Liste der Seitenleiste (erscheint so direkt unter der Profilnotiz);
    // ohne Badge-Liste hinter dem Notizkasten
    const lists = [...document.querySelectorAll('j-list.profile-sidebar-container__badge-list')].filter((l) => !l.closest('.jaf-fl-archive'));
    const list = lists.find((l) => visible(l)) || lists[0];
    const nh = noteHost();
    const anchor = nh && (nh.closest('j-expandable-content-box') || nh.closest('j-setting-container') || nh);
    if (!list && !anchor) return;
    if (old && old.__sig === sig && (list ? old.parentElement === list && list.firstElementChild === old : true)) return;
    const el = old && old.__sig === sig ? old : flBlockEl(p);
    el.__sig = sig;
    if (old && old !== el) old.remove();
    if (list) list.prepend(el); else anchor.insertAdjacentElement('afterend', el);
  }

  // ---- Symbole auf Karten (Suche, Gästelisten, Besucher …) ----
  function flDecorateCards() {
    const fl = getFl();
    const ids = Object.keys(fl).filter((k) => fl[k].status);
    const put = (host, st, css) => {
      let b = host.querySelector(':scope > .jaf-fl-card');
      if (!st) { if (b) b.remove(); return; }
      if (b && b.getAttribute('data-k') === st) return;
      if (!b) { b = document.createElement('div'); b.className = 'jaf-fl-card'; host.appendChild(b); if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; }
      b.setAttribute('data-k', st);
      b.title = `Fickliste: ${flLabel(st)}`;
      b.style.cssText = `position:absolute;${css};z-index:6;width:24px;height:24px;border-radius:50%;background:${st === 'gef' ? '#c71b1b' : 'rgba(20,20,20,.75)'};display:flex;align-items:center;justify-content:center;pointer-events:none;color:#fff`;
      b.innerHTML = flIcon(st, { size: 15 });
    };
    if (!ids.length && !document.querySelector('.jaf-fl-card')) return;
    document.querySelectorAll('j-member-card').forEach((card) => {
      const a = card.closest('a[href]');
      if (!a) return;
      const id = idOf(new URL(a.href, location.origin).pathname);
      put(a, id && fl[id] ? fl[id].status : '', 'top:6px;right:6px');
    });
    document.querySelectorAll('li.date_card').forEach((li) => {
      const a = li.querySelector('a[href*="/profile/"], a[href*="/my/"]');
      if (!a) return;
      const id = idOf(a.getAttribute('href'));
      put(li, id && fl[id] ? fl[id].status : '', 'top:6px;right:6px');
    });
  }

  // ---- Eigenes Profil: Badge „Fickliste“ hinter „Freunde“, Kasten über „Account“ ----
  const flOwnPage = () => !!sessionId() && new RegExp(`/${sessionId()}\\.`).test(location.pathname) && /^\/profile\//.test(location.pathname);
  function flOwnPills() {
    if (!flOwnPage() || flViewerPid()) return;
    for (const nav of document.querySelectorAll('j-pill-navigation')) {
      if (nav.querySelector('.jaf-fl-pill')) continue;
      const fr = [...nav.querySelectorAll('j-pill')].find((x) => /^freunde$/i.test((x.textContent || '').trim()));
      if (!fr) continue;
      const pill = document.createElement('j-pill');
      for (const a of fr.attributes) if (a.name.startsWith('data-v-')) pill.setAttribute(a.name, '');
      pill.className = 'jaf-fl-pill';
      pill.setAttribute('href', flOverviewUrl());
      pill.textContent = 'Fickliste';
      pill.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); location.href = flOverviewUrl(); }, true);
      fr.insertAdjacentElement('afterend', pill);
    }
  }
  function flLastFicks(n = 3) {
    const out = [];
    for (const p of Object.values(getFl())) {
      if (!['gef', 'nie'].includes(p.status)) continue;
      const m = flMeetsSorted(p)[0];
      if (m) out.push({ p, m });
    }
    return out.sort((a, b) => meetTs(b.m) - meetTs(a.m)).slice(0, n);
  }
  function flCounts() {
    const c = { will: 0, gef: 0, nein: 0, nie: 0 };
    for (const p of Object.values(getFl())) if (c[p.status] != null) c[p.status]++;
    return c;
  }
  function flAvatar(p, size = 40, radius = '50%') {
    const src = flImg(p.img);
    const init = escHtml((p.nick || '?').slice(0, 1).toUpperCase());
    return src ? `<img src="${src}" alt="" style="width:${size}px;height:${size}px;border-radius:${radius};object-fit:cover;flex:none${flDead(p) ? ';filter:grayscale(1);opacity:.7' : ''}">`
      : `<span style="width:${size}px;height:${size}px;border-radius:${radius};background:#5c6470;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none">${init}</span>`;
  }
  // Nick mit Lebenszustand: gelöscht = durchgestrichen/grau, deaktiviert = rot
  function flNickHtml(p) {
    const css = flDead(p) ? 'text-decoration:line-through;opacity:.6' : p.live === 'deact' ? 'color:#e0453a' : '';
    const old = (p.nicks || []).length ? ` title="früher: ${escHtml(p.nicks.join(', '))}"` : '';
    const ext = flIsExt(p.id) && !p.wasJoy ? ' <span style="font-size:11px;border:1px solid currentColor;border-radius:8px;padding:0 5px;opacity:.75">extern</span>' : '';
    return `<b style="${css}"${old}>${escHtml(p.nick || '?')}</b>${ext}`;
  }
  function flOwnBox() {
    if (!flOwnPage() || flViewerPid()) return;
    const acc = document.querySelector('.profile-membership-and-coins-info');
    if (!acc) return;
    const sig = JSON.stringify([flCounts(), flLastFicks().map((x) => [x.p.id, x.m.id, x.p.live, x.p.img])]);
    let box = document.querySelector('.jaf-fl-own');
    if (box && box.__sig === sig) return;
    const h2p = acc.querySelector('h2');
    const dv = (el) => (el ? [...el.attributes].filter((a) => a.name.startsWith('data-v-')).map((a) => `${a.name}=""`).join(' ') : '');
    const linkP = acc.querySelector('j-a');
    const nb = document.createElement('div');
    nb.className = acc.className.replace('profile-membership-and-coins-info', '') + ' jaf-fl-own jaf-fl-block';
    nb.style.marginBottom = '24px';
    const c = flCounts();
    const cnt = FL_ORDER.map((k) => `<a class="jaf-fl-cnt" href="${flOverviewUrl(k)}" target="_blank" title="${escHtml(FL_ST[k].label)}" style="display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:16px;color:inherit;text-decoration:none">${flIcon(k, { size: 22, redGef: true })}${c[k]}</a>`).join('');
    const rows = flLastFicks().map(({ p, m }) => {
      const href = flIsExt(p.id) ? flLiveUrl(p, false) : flDead(p) ? flArchiveUrl(p) : flUrl(p);
      return `<a href="${escHtml(href)}" target="_blank" style="display:flex;gap:10px;align-items:center;padding:6px 0;color:inherit;text-decoration:none">${flAvatar(p)}` +
        `<span style="min-width:0"><span>${flNickHtml(p)}</span><br><span style="font-size:12.5px;opacity:.7">${escHtml(m.wo || '')}${m.wo ? '<br>' : ''}${m.date ? 'am ' + fmtDate(m.date) : ''}</span></span></a>`;
    }).join('') || '<div style="opacity:.6;font-size:13px;padding:4px 0">noch keine Ficks eingetragen</div>';
    nb.innerHTML = `<h2 ${dv(h2p)} class="profile-headline profile-headline--with-margin" style="display:flex;align-items:center;gap:8px"><span>Fickliste</span>` +
      `<j-badge><j-icon slot="icon" type="j-ico-eye-slash"></j-icon>Nur für dich sichtbar</j-badge></h2>` +
      `<div class="profile-content-card__wrapper"><j-content-card><div style="padding:4px 0">` +
      `<div style="display:flex;justify-content:space-between;padding:2px 4px 12px;border-bottom:1px solid rgba(128,128,128,.3)">${cnt}</div>` +
      `<div style="font-size:12px;opacity:.7;margin:10px 0 4px">Letzte Ficks</div>${rows}` +
      `<div style="margin-top:8px"><j-a ${dv(linkP)} class="${linkP ? escHtml(linkP.className) : ''}" href="${flOverviewUrl()}">Zu meiner Fickliste</j-a></div></div></j-content-card></div>`;
    const ja = nb.querySelector('j-a');
    ja.addEventListener('click', (e) => { e.preventDefault(); location.href = flOverviewUrl(); });
    nb.__sig = sig;
    if (box) box.replaceWith(nb); else acc.parentElement.insertBefore(nb, acc);
  }

  // ---- Profil-Archiv: Ansicht eines Stands + Navigation ----
  function flArchiveUrl(p, ts, nav = true) {
    const stands = flStands(p.id);
    const t = ts || (stands.some((s) => s.ts === p.lastStand) ? p.lastStand : (stands[stands.length - 1] || {}).ts) || 0;
    return flCarrierUrl(p.id, t, nav);
  }
  const flLiveUrl = (p, nav = true) => { if (flForeignMain(p)) return p.main.url; if (flIsExt(p.id)) return flCarrierUrl(p.id, 0, nav); const b = flPath(p); return location.origin + b + (nav ? (b.includes('?') ? '&' : '?') + 'flnav=1' : ''); };
  const flNavOn = (pid) => ssGet('jaf_flnav') === pid;
  // Navigation „Profil-Archiv“ (überblendet, wie die JOYclub-Infoleiste)
  function flShowNav(p, curTs) {
    document.getElementById('jaf-fl-nav')?.remove();
    const stands = flStands(p.id).slice().sort((a, b) => a.ts - b.ts);
    const dead = flDead(p);
    const live = !curTs;
    const idx = live ? stands.length : stands.findIndex((s) => s.ts === curTs);
    const T = (s) => (s === 'live' ? 'aktuell' : s ? fmtDT(s.ts) : '–');
    const prev = idx > 0 ? stands[idx - 1] : null;
    const next = live ? null : (stands[idx + 1] || (dead ? null : 'live'));
    // Doppelpfeile: letzter Stand vor und erster Stand nach jedem Treffen
    const tg = new Set();
    for (const m of p.meets || []) {
      const t = meetTs(m);
      if (!t) continue;
      const b = stands.filter((s) => s.ts < t).pop(); if (b) tg.add(b.ts);
      const a = stands.find((s) => s.ts > t); if (a) tg.add(a.ts);
    }
    const targets = [...tg].sort((a, b) => a - b);
    const cur = live ? Infinity : curTs;
    const pp = targets.filter((t) => t < cur).pop();
    const nn = targets.find((t) => t > cur);
    const byTs = (t) => stands.find((s) => s.ts === t);
    const go = (t) => { if (t === 'live') location.href = flLiveUrl(p, false); else if (t) location.href = flArchiveUrl(p, t.ts || t, false); };
    const bar = flEl('div', 'position:fixed;left:50%;top:76px;transform:translateX(-50%);z-index:2147483640;width:min(760px,calc(100% - 24px));box-sizing:border-box;' +
      'display:flex;gap:12px;align-items:flex-start;background:#20242c;color:#fff;border-left:4px solid #2f6fd6;border-radius:8px;padding:10px 12px;box-shadow:0 6px 18px rgba(0,0,0,.5);font:14px system-ui,sans-serif');
    bar.id = 'jaf-fl-nav';
    bar.className = 'jaf-fl-nav';
    bar.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" style="flex:none;margin-top:2px"><circle cx="12" cy="12" r="11" fill="#2f6fd6"/><path fill="#fff" d="M10.5 16.3c-.7 0-1.3.6-1.3 1.2s.6 1.3 1.3 1.3h4c.7 0 1.2-.6 1.2-1.3s-.5-1.2-1.2-1.2h-.8v-4.8c0-1.2-1-2.2-2.2-2.2h-1c-.7 0-1.3.6-1.3 1.2s.6 1.3 1.3 1.3h.7v4.5zm1.8-11.6a1.8 1.8 0 1 0 0 3.5 1.8 1.8 0 0 0 0-3.5z"/></svg>';
    const body = flEl('div', 'flex:1;min-width:0');
    body.appendChild(flEl('div', 'font-weight:700;font-size:13.5px;margin-bottom:6px', `Profil-Archiv · ${escHtml(p.nick || '')}`));
    const row = flEl('div', 'display:flex;gap:6px;align-items:flex-start');
    const b = (sym, lbl, target) => {
      const w = flEl('div', 'width:96px;text-align:center;flex:none');
      const k = flEl('button', `width:100%;height:26px;border-radius:16px;border:1px solid ${target ? '#4a505a' : '#333'};background:transparent;color:${target ? '#fff' : '#555'};font:bold 17px/1 system-ui;cursor:${target ? 'pointer' : 'default'}`, sym);
      if (target) k.addEventListener('click', () => go(target)); else k.disabled = true;
      w.appendChild(k);
      w.appendChild(flEl('div', `font-size:11px;color:${target ? '#9aa3ad' : '#555'};margin-top:3px;white-space:nowrap`, escHtml(lbl)));
      return w;
    };
    row.appendChild(b('«', pp ? fmtDT(pp) : '–', pp ? byTs(pp) : null));
    row.appendChild(b('‹', T(prev), prev));
    const mid = flEl('div', 'flex:1;min-width:0;padding:0 4px');
    const sel = flEl('select', `width:100%;height:28px;border-radius:6px;background:#2c313b;color:${live ? '#7be08f' : '#fff'};border:1px solid ${live ? '#3fae5a' : '#4a505a'};font:bold 13.5px system-ui;text-align:center`);
    if (!dead) sel.appendChild(new Option('aktuell (echtes Profil)', 'live', live, live));
    for (const s of stands.slice().reverse()) sel.appendChild(new Option(`${fmtDT(s.ts)} · ${s.why || ''}`, String(s.ts), s.ts === curTs, s.ts === curTs));
    sel.addEventListener('change', () => go(sel.value === 'live' ? 'live' : +sel.value));
    mid.appendChild(sel);
    row.appendChild(mid);
    row.appendChild(b('›', T(next), next));
    row.appendChild(b('»', nn ? fmtDT(nn) : '–', nn ? byTs(nn) : null));
    body.appendChild(row);
    bar.appendChild(body);
    if (flIsExt(p.id) && curTs) {
      const ed = flEl('a', 'display:inline-block;margin-top:6px;font-size:12.5px;font-weight:600;color:#7be08f;cursor:pointer;text-decoration:underline', 'Aktuellen Stand bearbeiten');
      ed.addEventListener('click', (e) => { e.preventDefault(); location.href = flLiveUrl(p, false); });
      body.appendChild(ed);
    }
    const x = flEl('button', 'background:none;border:0;color:#9aa3ad;font:18px system-ui;cursor:pointer;padding:0 2px', '✕');
    x.title = 'Navigation beenden';
    x.addEventListener('click', () => { ssSet('jaf_flnav', ''); bar.remove(); });
    bar.appendChild(x);
    document.body.appendChild(bar);
  }
  // einfache Profilansicht aus den Daten eines Stands (Stufe 1 bzw. externe Personen)
  function flRenderL1(d, imgSrc, opt = {}) {
    const sed = (d.sed || []).map((s) => {
      const rows = Object.entries(s.props || {}).filter(([, v]) => v).map(([k, v]) => `<tr><td style="opacity:.65;padding:3px 14px 3px 0;vertical-align:top">${escHtml(k)}</td><td style="padding:3px 0">${escHtml(v)}</td></tr>`).join('');
      const gname = s.g === '2' ? 'Sie' : s.g === '1' ? 'Er' : '';
      return `<div style="flex:1;min-width:220px;background:rgba(128,128,128,.1);border-radius:8px;padding:12px 14px"><div style="font-weight:700;margin-bottom:6px">${escHtml(s.title || ((d.sed || []).length > 1 ? `Steckbrief (${gname})` : 'Steckbrief'))}${s.age ? ` · ${s.age} Jahre` : ''}</div><table style="border-collapse:collapse;font-size:13.5px">${rows || '<tr><td style="opacity:.6">keine Angaben</td></tr>'}</table></div>`;
    }).join('');
    const secs = (d.secs || []).map((x) => `<section style="margin-top:18px"><h2 class="profile-headline" style="font-size:18px;margin:0 0 6px">${escHtml(x.h)}</h2><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${escHtml(x.t)}</div></section>`).join('');
    const img = imgSrc ? `<img src="${imgSrc}" alt="" style="width:220px;height:220px;object-fit:cover;border-radius:12px;flex:none">`
      : `<div style="width:220px;height:220px;border-radius:12px;background:#5c6470;display:flex;align-items:center;justify-content:center;font:bold 72px system-ui;color:#fff;flex:none">${escHtml((d.nick || '?').slice(0, 1).toUpperCase())}</div>`;
    return `<div class="jaf-fl-l1" style="max-width:960px;margin:24px auto 40px;padding:0 16px;color:inherit;font:14px/1.45 system-ui,sans-serif">` +
      `<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">${opt.imgHtml || img}<div style="flex:1;min-width:240px">` +
      `<h1 style="margin:0 0 4px;font-size:28px">${escHtml(d.nick || '')}</h1>` +
      `<div style="opacity:.8">${escHtml([d.type, (d.ages || []).length ? (d.ages || []).join(' + ') + ' Jahre' : '', d.place].filter(Boolean).join(' · '))}</div>` +
      (d.tagline ? `<div style="margin-top:8px;font-style:italic;opacity:.85">${escHtml(d.tagline)}</div>` : '') +
      `<div class="profile-interaction-buttons" style="display:flex;gap:14px;margin-top:16px"><div class="profile-label-interaction-button profile-label-interaction-button--is-big jaf-fl-proto" style="display:none"><span class="profile-clubmail-button"></span></div></div>` +
      `${opt.headExtra || ''}</div></div>` +
      `<div class="jaf-fl-l1-block"></div>` +
      (sed ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:22px">${sed}</div>` : '') + secs + '</div>';
  }
  function flArchiveView() {
    const ts = flArchivParam();
    const pid = flPagePid() || (isProfilePage() ? idOf(location.pathname) : '');
    const p = pid && flGet(pid);
    if (!ts || !p || flIsExt(pid)) return false;
    const stands = flStands(pid);
    const s = stands.find((x) => x.ts === ts) || stands[stands.length - 1];
    if (!s) return false;
    if (p.lastStand !== s.ts) { p.lastStand = s.ts; flPut(p); }
    if (/[?&]flnav=1/.test(location.search)) ssSet('jaf_flnav', pid);
    const host = document.querySelector('main.profile-container') || document.querySelector('main');
    let wrap = document.querySelector('.jaf-fl-archive');
    if (!wrap) {
      wrap = flEl('div', 'min-height:60vh');
      wrap.className = 'jaf-fl-archive';
      if (host) { host.style.display = 'none'; host.insertAdjacentElement('beforebegin', wrap); }
      else { const c = document.querySelector('#mfs_core, #page') || document.body; c.querySelectorAll(':scope > *:not(#jaf-panel)').forEach((e) => { if (!e.matches('header, nav, #main_navigation')) e.style.display = 'none'; }); c.appendChild(wrap); }
    }
    const imgSrc = flImg(s.img) || flImg(p.img);
    if (s.html) {
      if (typeof wrap.setHTMLUnsafe === 'function') wrap.setHTMLUnsafe(s.html); else wrap.innerHTML = s.html;
      wrap.querySelectorAll('[class*="jaf-"]').forEach((e) => e.remove());
      if (imgSrc) wrap.querySelectorAll('j-avatar [data-img_id] img, j-avatar [data-img_id] source').forEach((e) => { if (e.tagName === 'SOURCE') e.setAttribute('srcset', imgSrc); else { e.src = imgSrc; e.removeAttribute('data-src'); } });
      const nh = [...wrap.querySelectorAll('j-setting-textarea')].find((e) => /profilnotiz/.test(norm(e.getAttribute('label') || '')));
      const anchor = nh ? (nh.closest('j-expandable-content-box') || nh) : null;
      const blk = flBlockEl(p, { plus: false });
      if (anchor) anchor.insertAdjacentElement('afterend', blk); else wrap.prepend(blk);
    } else {
      wrap.innerHTML = flRenderL1(s.data || {}, imgSrc);
      wrap.querySelector('.jaf-fl-l1-block').appendChild(flBlockEl(p));
      if (s.data && s.data.pnote) wrap.querySelector('.jaf-fl-l1-block').insertAdjacentHTML('afterbegin', `<div style="margin-top:18px;padding:12px 16px;border-radius:8px;background:rgba(128,128,128,.08)"><div style="font-weight:600;font-size:13.5px;margin-bottom:4px">Profilnotiz (damals)</div><div style="white-space:pre-wrap;font-size:13px">${escHtml(s.data.pnote)}</div></div>`);
    }
    // aktive Inhalte der Kopie → echtes Profil (bzw. Hinweis, wenn es das Profil nicht mehr gibt)
    if (!wrap.__jafBound) {
      wrap.__jafBound = true;
      wrap.addEventListener('click', (ev) => {
        const path = ev.composedPath();
        if (path.some((e) => e && e.classList && (e.classList.contains('jaf-fl-wrap') || e.classList.contains('jaf-fl-block') || e.id === 'jaf-fl-dd'))) return;
        const act = path.find((e) => e && e.nodeType === 1 && (e.tagName === 'A' || e.tagName === 'BUTTON' || /^J-(BUTTON|CONTROL-BUTTON|CONTEXT-MENU|A|PILL|LINK)/.test(e.tagName)));
        if (!act) return;
        ev.preventDefault(); ev.stopPropagation();
        const q = flGet(pid) || p;
        if (flDead(q)) { flDeadPopup(q); return; }
        const href = act.getAttribute && act.getAttribute('href');
        if (href && !/^#|javascript:/.test(href) && !(idOf(href) === pid)) location.href = new URL(href, location.origin).href;
        else location.href = flLiveUrl(q, false);
      }, true);
    }
    if (flDead(p)) flDeadPopup(p);
    if (ssGet('jaf_flnav') === pid || /[?&]flnav=1/.test(location.search)) flShowNav(p, s.ts);
    document.title = `${p.nick || ''} · Profil-Archiv ${fmtDT(s.ts)}`;
    return true;
  }

  // ---- Navigation „Profil verwalten“: Eintrag „Fickliste“ als erster unter „Community & Dating“ (vor „Dates“), Kachel auf /edit/ ebenso ----
  const FL_TILE_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"><rect width="120" height="90" fill="#c71b1b"/><g transform="translate(28 16) scale(.25)" fill="#fff"><path d="${FL_D}"/></g></svg>`);
  function flEditNav() {
    if (!/^\/edit\//.test(location.pathname)) return;
    // erster Eintrag unter „Community & Dating“ (vor „Dates“); gibt es nirgends „Dates“: wie früher hinter „Videos“
    const hrefIn = (ul, re) => [...ul.querySelectorAll('a')].find((a) => re.test(a.getAttribute('href') || ''));
    const uls = [...document.querySelectorAll('ul.catlinks')];
    const withDates = uls.filter((ul) => hrefIn(ul, /\/edit\/dating\/?$/));
    const targets = withDates.length ? withDates : uls.filter((ul) => hrefIn(ul, /\/edit\/video\/?$/));
    for (const ul of targets) {
      if (ul.querySelector('.jaf-fl-sn')) continue;
      const dates = hrefIn(ul, /\/edit\/dating\/?$/), vid = hrefIn(ul, /\/edit\/video\/?$/);
      const li = document.createElement('li');
      li.className = 'jaf-fl-sn';
      li.innerHTML = `<a href="${flOverviewUrl()}" class="${flOverviewPage() ? 'sn_on' : 'sn'}">Fickliste</a>`;
      if (dates) dates.closest('li').insertAdjacentElement('beforebegin', li); else vid.closest('li').insertAdjacentElement('afterend', li);
      if (flOverviewPage() || flExternPage()) ul.querySelectorAll('a.sn_on').forEach((a) => { if (!a.closest('.jaf-fl-sn')) a.className = 'sn'; });
    }
    // Eintrag am alten Platz entfernen, sobald „Dates“ da ist
    if (withDates.length) document.querySelectorAll('ul.catlinks .jaf-fl-sn').forEach((li) => { if (!withDates.includes(li.parentElement)) li.remove(); });
    if (/^\/edit\/?$/.test(location.pathname)) {
      for (const ul of document.querySelectorAll('ul.profile_edit_list')) {
        if (ul.querySelector('.jaf-fl-tile')) continue;
        const card = (suf) => [...ul.querySelectorAll('li.profile_edit_card')].find((li) => li.querySelector(`a[href$="${suf}"]`));
        const dates = card('/edit/dating/'), vid = card('/edit/video/');
        const tpl = dates || vid;
        if (!tpl) continue;
        const li = tpl.cloneNode(true);
        li.className = 'profile_edit_card jaf-fl-tile';
        const a = li.querySelector('a'); a.href = flOverviewUrl();
        const img = li.querySelector('img'); if (img) img.style.backgroundImage = `url("${FL_TILE_IMG}")`;
        const s = li.querySelector('strong'); if (s) s.textContent = 'Fickliste';
        const n = li.querySelector('.normal'); if (n) n.textContent = 'Deine Ficks und Erinnerungen – nur für dich sichtbar.';
        if (dates) dates.insertAdjacentElement('beforebegin', li); else vid.insertAdjacentElement('afterend', li);
      }
    }
  }

  // ---- Seite „Meine Fickliste“ (/edit/homepage/?fickliste) ----
  const K_FL_VIEW = 'jaf_fl_view'; // Filter/Sortierung (bleiben erhalten)
  function flViewState() {
    const v = Object.assign({ sort: 'date', dir: 'desc', dateDir: 'desc', user: '', wo: '', clubs: null, from: '', to: '', st: FL_ST_DEFAULT.slice() }, GM_getValue(K_FL_VIEW, {}) || {});
    if (!v.v181) { v.v181 = 1; v.st = (v.st || []).filter((k) => k !== 'nein'); if (!v.st.length) v.st = FL_ST_DEFAULT.slice(); GM_setValue(K_FL_VIEW, v); }
    const q = (location.search.match(/[?&]status=(\w+)/) || [])[1];
    if (q && FL_ST[q] && !window.__jafFlQ) { window.__jafFlQ = true; v.st = [q]; GM_setValue(K_FL_VIEW, v); }
    return v;
  }
  // alle bekannten Clubs/Orte: Treffen + gemerkte Partys
  function flKnownClubs() {
    const s = new Set(flAllClubs());
    try { for (const e of Object.values(getEvents())) if (e && e.club) s.add(e.club); } catch (x) { /* egal */ }
    return [...s].sort((a, b) => a.localeCompare(b, 'de'));
  }
  function flAllClubs() {
    const s = new Set();
    for (const p of Object.values(getFl())) for (const m of p.meets || []) if (m.club) s.add(m.club);
    return [...s].sort((a, b) => a.localeCompare(b, 'de'));
  }
  function flRows(v) {
    const rows = [];
    const fl = getFl(), G = flGroups();
    const anyMeetFilter = !!(v.wo || v.from || v.to || v.clubs);
    for (const p of Object.values(fl)) {
      const prim = flPrimaryId(p.id, G);
      if (prim !== p.id && fl[prim]) continue; // verknüpfte Profile stehen unter dem primären
      const ids = flMembers(p.id, G);
      const gst = p.status || (ids.map((id) => (fl[id] || {}).status).find(Boolean) || '');
      if (!v.st.includes(gst)) continue;
      if (v.user && !norm(ids.flatMap((id) => [(fl[id] || {}).nick, ...((fl[id] || {}).nicks || []), ...((fl[id] || {}).profiles || []).map(flProfName)]).join(' ')).includes(norm(v.user))) continue;
      if (v.pfs && !flPersonPfs(ids).some((x) => v.pfs.includes(x))) continue;
      let n = 0;
      for (const id of ids) for (const m of (fl[id] && fl[id].meets) || []) {
        if (v.wo && !norm(`${m.wo || ''} ${m.club || ''}`).includes(norm(v.wo))) continue;
        if (v.clubs && !v.clubs.includes(m.club || '')) continue;
        if (v.from && (m.date || '') < v.from) continue;
        if (v.to && (m.date || '9999') > v.to) continue;
        rows.push({ p, m, owner: fl[id] }); n++;
      }
      if (!n && !anyMeetFilter && !ids.some((id) => ((fl[id] && fl[id].meets) || []).length)) rows.push({ p, m: null, owner: p });
    }
    const dd = v.dateDir === 'asc' ? 1 : -1;
    const byDate = (a, b) => (!a.m - !b.m) || dd * ((a.m ? meetTs(a.m) : 0) - (b.m ? meetTs(b.m) : 0));
    if (v.sort === 'name') rows.sort((a, b) => (v.dir === 'asc' ? 1 : -1) * String(a.p.nick || '').localeCompare(String(b.p.nick || ''), 'de', { sensitivity: 'base' }) || byDate(a, b));
    else rows.sort((a, b) => (!a.m - !b.m) || (a.m ? (v.dir === 'asc' ? 1 : -1) * (meetTs(a.m) - meetTs(b.m)) : String(a.p.nick || '').localeCompare(String(b.p.nick || ''), 'de', { sensitivity: 'base' })));
    return rows;
  }
  // eine Zeile der Fickliste (Treffen bzw. Person ohne Treffen)
  function flRowEl(p, m, asNick = '') {
    const li = flEl('div', 'display:flex;gap:12px;align-items:center;padding:10px;border-radius:8px;background:rgba(128,128,128,.12);cursor:pointer');
    li.className = 'jaf-fl-row';
    const nickHref = flIsExt(p.id) ? flLiveUrl(p) : flDead(p) ? flArchiveUrl(p) : flLiveUrl(p);
    const pfs = flPersonPfs(flMembers(p.id)).filter((x) => x !== 'joyclub' || flIsExt(p.id));
    const pfHtml = pfs.length ? `<span style="display:inline-flex;gap:3px">${pfs.map((x) => flPfBadge(x, { size: 15 })).join('')}</span>` : '';
    const hasArch = !flForeignMain(p) || flStands(p.id).length;
    li.innerHTML = `${flAvatar(p, 56, '6px')}<div style="flex:1;min-width:0">` +
      `<div class="jaf-fl-l1row" style="display:flex;align-items:center"><span class="jaf-fl-nk" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap">` +
      `<a class="jaf-fl-nick" href="${escHtml(nickHref)}" target="_blank" style="color:inherit;text-decoration:none">${flNickHtml(p)}</a>${asNick ? `<span style="opacity:.75;font-size:12.5px">(als ${escHtml(asNick)})</span>` : ''}` +
      `${p.type ? `<span style="opacity:.6;font-size:12px">${escHtml(p.type)}</span>` : ''}${flIcon(p.status, { size: 16, redGef: true })}${pfHtml}</span>` +
      (hasArch ? `<a class="jaf-fl-arch" href="${escHtml(flArchiveUrl(p))}" target="_blank" style="margin-left:10px;font-size:12.5px;opacity:.75;color:inherit">Profil-Archiv</a>` : '') + '</div>' +
      (m ? `<div style="font-size:13px">${m.url ? `<a href="${escHtml(m.url)}" target="_blank" rel="noopener" style="color:#e2b04a;text-decoration:none">${escHtml(m.wo || 'Party')}</a> ${flPfBadge(m.pf || flDetectPf(m.url) || 'other', { size: 13 })}` : escHtml(m.wo || '')}` +
        ` · <span style="${m.club ? 'opacity:.85' : 'opacity:.55;font-style:italic'}">${escHtml(m.club || 'unbekannt')}</span></div>` +
        (m.note ? `<div style="font-size:12.5px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(m.note)}</div>` : '')
        : '<div style="font-size:13px;opacity:.6">Kein Treffen eingetragen</div>') +
      `</div><div style="text-align:right;font-weight:600;font-size:13px;white-space:nowrap">${m && m.date ? fmtDate(m.date) : ''}<br><span style="opacity:.6;font-weight:normal">${m && m.time ? m.time : ''}</span></div>`;
    li.addEventListener('click', (e) => {
      if (e.composedPath().some((x) => x && x.tagName === 'A')) return;
      flEntryPopup(flGet(p.id), null, { meetId: m && m.id });
    });
    return li;
  }
  // „Profil-Archiv“ exakt untereinander: Breite der Nick-Spalte über alle sichtbaren Zeilen messen
  function flAlignNicks(ul) {
    requestAnimationFrame(() => {
      const nks = [...ul.querySelectorAll('.jaf-fl-nk')];
      nks.forEach((e) => { e.style.width = ''; });
      const w = Math.max(0, ...nks.map((e) => e.getBoundingClientRect().width));
      nks.forEach((e) => { e.style.width = `${Math.ceil(w)}px`; });
    });
  }
  // Treffen ohne Party-Link passt zu einer Party: gleicher Tag (oder Vortag ab 17 Uhr) und Name/Club im Text
  function flMeetFitsEvent(m, ev, t) {
    if (!m.date) return false;
    const sd = isoDay(new Date(t));
    const prev = isoDay(new Date(Date.parse(m.date + 'T12:00:00') - 864e5));
    if (sd !== m.date && !(sd === prev && new Date(t).getHours() >= 17)) return false;
    const txt = ' ' + flNormName([m.wo, m.club, m.note].join(' ')) + ' ';
    const toks = txt.split(' ').filter((w) => w.length >= 3);
    return [ev.club, ev.name, ev.location].map(flNormName).filter(Boolean).some((f) => f.split(' ').filter((w) => w.length >= 3)
      .some((w) => txt.includes(' ' + w) || toks.some((n) => w.startsWith(n) || n.startsWith(w))));
  }
  // Reiter „Fickliste“ auf einer Party-Seite (hinter „Opa-Liste“): alle Ficks dieser Party, alphabetisch
  function flEventTab() {
    if (!isEventPage()) return;
    const eid = eventIdOf(location.pathname);
    const rows = [];
    // Party dieser Seite (für Treffen ohne Link: Datum + Name/Club)
    const ev = Object.assign(flEventFromDoc(document, location.origin + location.pathname), getEvents()[eid] || {});
    ev.url = location.origin + location.pathname;
    const evT = flEvStart(ev);
    for (const p0 of Object.values(getFl())) {
      let changed = false;
      for (const m of p0.meets || []) {
        const mid = (String(m.url || '').match(/\/event\/(\d+)\./) || [])[1];
        if (!mid && evT && flMeetFitsEvent(m, ev, evT)) { m.url = ev.url; if (!m.club && ev.club) m.club = ev.club; if (!m.time) m.time = `${pad2f(new Date(evT).getHours())}:${pad2f(new Date(evT).getMinutes())}`; changed = true; }
      }
      if (changed) { flHist(p0, `Treffen mit Party verknüpft: ${ev.name || eid}`); flPut(p0); }
      for (const m of p0.meets || []) if (eid && (String(m.url || '').match(/\/event\/(\d+)\./) || [])[1] === eid) rows.push({ p: p0, m });
    }
    // Anzeige unter dem primären Profil; „(als X)“, wenn nicht das primäre, aber ein verknüpftes Profil angemeldet ist
    const G = flGroups(), fl = getFl();
    const guests = new Set([...document.querySelectorAll('li.date_card a[href*="/profile/"], li.date_card a[href*="/my/"]')].map((a) => idOf(a.getAttribute('href'))).filter(Boolean));
    try { if (Array.isArray(guestAll)) for (const g of guestAll) { const id = g && (g.id || idOf(g.url || g.path || '')); if (id) guests.add(String(id)); } } catch (e) { /* egal */ }
    for (const r of rows) {
      const prim = flPrimaryId(r.p.id, G);
      const owner = r.p;
      if (prim !== r.p.id && fl[prim]) r.p = fl[prim];
      const ids = flMembers(r.p.id, G);
      let as = '';
      if (ids.length > 1 && !guests.has(r.p.id)) { const on = ids.find((id) => id !== r.p.id && guests.has(id)); if (on) as = (fl[on] || {}).nick || ''; }
      if (!as && owner.id !== r.p.id) as = owner.nick;
      r.as = as;
    }
    rows.sort((a, b) => String(a.p.nick || '').localeCompare(String(b.p.nick || ''), 'de', { sensitivity: 'base' }) || meetTs(a.m) - meetTs(b.m));
    let li = document.querySelector('.jaf-fl-ev-tab');
    let pn = document.getElementById('jaf_fl_list');
    if (!rows.length) { if (li) li.remove(); if (pn) pn.remove(); return; }
    if (!li) {
      const opa = document.querySelector('.jaf-opa-list-tab');
      const dates = document.querySelector('.event_detail_tab_content ul.nav-tabs > li > a[href="#date_pane"]');
      const after = opa || (dates && dates.closest('li'));
      const content = document.querySelector('.event_detail_tab_content > .tab-content') || (document.getElementById('information') || {}).parentElement;
      if (!after || !content) return;
      li = document.createElement('li');
      li.setAttribute('role', 'presentation'); li.className = 'jaf-fl-ev-tab'; li.title = 'Fickliste';
      li.innerHTML = '<a href="#jaf_fl_list" data-toggle="tab" aria-controls="jaf_fl_list">Fickliste</a>';
      after.after(li);
      pn = document.createElement('div');
      pn.id = 'jaf_fl_list'; pn.className = 'tab-pane'; pn.setAttribute('role', 'tabpanel');
      pn.innerHTML = '<div class="jaf-fl-list" style="display:flex;flex-direction:column;gap:8px;padding:12px 0"></div>';
      content.appendChild(pn);
      const tabPane = pn, tabLi = li;
      li.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); showOwnTab(tabLi, tabPane); flAlignNicks(tabPane); });
    }
    const sig = JSON.stringify(rows.map((r) => [r.p.id, r.p.status, r.p.live, r.p.nick, r.m, r.as]));
    const ul = pn.querySelector('.jaf-fl-list');
    if (ul.__sig === sig) return;
    ul.__sig = sig;
    ul.innerHTML = '';
    for (const { p, m, as } of rows) ul.appendChild(flRowEl(p, m, as));
    flAlignNicks(ul);
  }
  function flRenderOverview() {
    const c = document.getElementById('c');
    if (!c) return;
    const v = flViewState();
    const save = () => { GM_setValue(K_FL_VIEW, v); flRenderOverview(); };
    document.title = 'Meine Fickliste – JOYclub';
    c.innerHTML = '';
    c.classList.add('jaf-fl-page');
    c.appendChild(flEl('h1', '', 'Meine Fickliste')).className = 'hide_for_mobile sp_bs';
    c.appendChild(flEl('ol', '', `<li class="forelast"><a href="${location.origin}/edit/"><span>Profil verwalten</span></a></li><li class="last"><a href="${flOverviewUrl()}"><span>Meine Fickliste</span></a></li>`)).className = 'breadcrumb breadcrumb_ui hide_for_mobile';
    c.appendChild(flEl('p', '', 'Nur für dich sichtbar. Jede Zeile ist ein Treffen – ein Klick öffnet die Eintragung, der Nick das Profil, „Profil-Archiv“ die gespeicherten Stände.')).className = 'c_hint_lo';
    const addB = flBtn('+ Externen Fick zufügen', () => flAddExternal(), true);
    const tb = flEl('div', 'display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 12px');
    tb.appendChild(addB);
    tb.appendChild(flBtn('Exportieren', () => flExportPopup()));
    tb.appendChild(flBtn('Importieren', () => flImportPopup()));
    c.appendChild(tb);
    // Filter
    const f = flEl('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 12px;background:rgba(128,128,128,.1);border-radius:8px;padding:12px;margin-bottom:10px');
    const fld = (label, el) => { const w = flEl('div', ''); w.appendChild(flEl('div', 'font-size:11.5px;opacity:.7;margin-bottom:3px', escHtml(label))); w.appendChild(el); f.appendChild(w); return el; };
    const inp = (val, ph, type = 'text') => { const e = flEl('input', FL_INPUT_CSS + ';width:100%'); e.type = type; e.value = val || ''; if (ph) e.placeholder = ph; return e; };
    const uIn = fld('Mitglied', inp(v.user, 'Name …'));
    const dl = flEl('datalist'); dl.id = 'jaf-fl-nicks';
    for (const n of [...new Set(Object.values(getFl()).flatMap((p) => [p.nick, ...(p.nicks || [])]).filter(Boolean))].sort()) dl.appendChild(new Option(n));
    f.appendChild(dl);
    uIn.setAttribute('list', 'jaf-fl-nicks');
    // Vorschläge auch mitten im Nick: eigene Liste unter dem Feld
    const sugg = flEl('div', 'position:relative');
    uIn.parentElement.appendChild(sugg);
    uIn.removeAttribute('list');
    uIn.addEventListener('input', () => {
      sugg.innerHTML = '';
      const q = norm(uIn.value);
      if (!q) return;
      const l = [...dl.options].map((o) => o.value).filter((n) => norm(n).includes(q)).slice(0, 8);
      if (!l.length || (l.length === 1 && norm(l[0]) === q)) return;
      const box = flEl('div', 'position:absolute;left:0;right:0;top:2px;z-index:5;background:#25272b;border:1px solid #3a3d43;border-radius:6px;padding:4px 0;color:#fff');
      for (const n of l) { const r = flEl('div', 'padding:4px 10px;cursor:pointer', escHtml(n)); r.addEventListener('mousedown', (e) => { e.preventDefault(); uIn.value = n; v.user = n; save(); }); box.appendChild(r); }
      sugg.appendChild(box);
    });
    uIn.addEventListener('change', () => { v.user = uIn.value.trim(); save(); });
    const wIn = fld('Was/Wo (enthält)', inp(v.wo, 'z. B. Halloween'));
    wIn.addEventListener('change', () => { v.wo = wIn.value.trim(); save(); });
    // Clubs (Auswahl mit Checkboxen)
    const clubs = flAllClubs();
    const cBtn = flEl('button', FL_INPUT_CSS + ';width:100%;text-align:left;cursor:pointer', escHtml(v.clubs ? `${v.clubs.length} gewählt ▾` : 'alle ▾'));
    fld('Wo', cBtn);
    cBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const old = document.getElementById('jaf-fl-clubs'); if (old) { old.remove(); return; }
      const r = cBtn.getBoundingClientRect();
      const dd = flEl('div', `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;width:${Math.max(r.width, 220)}px;max-height:50vh;overflow:auto;z-index:2147483645;background:#25272b;border:1px solid #3a3d43;border-radius:6px;padding:6px 8px;color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.6)`);
      dd.id = 'jaf-fl-clubs';
      const sel = new Set(v.clubs || [...clubs, '']);
      for (const cl of [...clubs, '']) {
        const lb = flEl('label', 'display:flex;gap:6px;align-items:center;padding:3px 0;cursor:pointer');
        const cb = flEl('input'); cb.type = 'checkbox'; cb.checked = sel.has(cl);
        cb.addEventListener('change', () => { if (cb.checked) sel.add(cl); else sel.delete(cl); v.clubs = sel.size === clubs.length + 1 ? null : [...sel]; GM_setValue(K_FL_VIEW, v); cBtn.textContent = v.clubs ? `${v.clubs.length} gewählt ▾` : 'alle ▾'; });
        lb.appendChild(cb); lb.appendChild(flEl('span', cl ? '' : 'font-style:italic', escHtml(cl || 'unbekannt')));
        dd.appendChild(lb);
      }
      document.body.appendChild(dd);
      setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!dd.contains(ev.target) && ev.target !== cBtn) { dd.remove(); document.removeEventListener('mousedown', h); flRenderOverview(); } }), 0);
    });
    // Plattform (Auswahl mit Checkboxen)
    const pfAll = [...new Set(Object.keys(getFl()).flatMap((id) => flPersonPfs([id])))].sort((a, b) => Object.keys(FL_PF).indexOf(a) - Object.keys(FL_PF).indexOf(b));
    const pBtn = flEl('button', FL_INPUT_CSS + ';width:100%;text-align:left;cursor:pointer', escHtml(v.pfs ? `${v.pfs.length} gewählt ▾` : 'alle ▾'));
    fld('Plattform', pBtn);
    pBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const old = document.getElementById('jaf-fl-pfs'); if (old) { old.remove(); return; }
      const r = pBtn.getBoundingClientRect();
      const dd = flEl('div', `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;width:${Math.max(r.width, 200)}px;max-height:50vh;overflow:auto;z-index:2147483645;background:#25272b;border:1px solid #3a3d43;border-radius:6px;padding:6px 8px;color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.6)`);
      dd.id = 'jaf-fl-pfs';
      const sel = new Set(v.pfs || pfAll);
      for (const k of pfAll) {
        const lb = flEl('label', 'display:flex;gap:6px;align-items:center;padding:3px 0;cursor:pointer');
        const cb = flEl('input'); cb.type = 'checkbox'; cb.checked = sel.has(k);
        cb.addEventListener('change', () => { if (cb.checked) sel.add(k); else sel.delete(k); v.pfs = sel.size === pfAll.length ? null : [...sel]; GM_setValue(K_FL_VIEW, v); pBtn.textContent = v.pfs ? `${v.pfs.length} gewählt ▾` : 'alle ▾'; });
        lb.appendChild(cb); lb.insertAdjacentHTML('beforeend', `${flPfBadge(k)}<span>${escHtml(k === 'other' ? 'Andere / ohne' : flPfLabel(k))}</span>`);
        dd.appendChild(lb);
      }
      document.body.appendChild(dd);
      setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!dd.contains(ev.target) && ev.target !== pBtn) { dd.remove(); document.removeEventListener('mousedown', h); flRenderOverview(); } }), 0);
    });
    const fromIn = fld('Datum von', inp(v.from, '', 'date'));
    fromIn.addEventListener('change', () => { v.from = fromIn.value; save(); });
    const toIn = fld('Datum bis', inp(v.to, '', 'date'));
    toIn.addEventListener('change', () => { v.to = toIn.value; save(); });
    const rs = flEl('a', 'display:block;padding-top:20px;color:#e2b04a;font-weight:600;cursor:pointer', 'Filter zurücksetzen');
    rs.addEventListener('click', (e) => { e.preventDefault(); Object.assign(v, { user: '', wo: '', clubs: null, pfs: null, from: '', to: '', st: FL_ST_DEFAULT.slice() }); save(); });
    f.appendChild(rs);
    c.appendChild(f);
    // Liste
    const rows = flRows(v);
    const bar = flEl('div', 'display:flex;gap:8px;align-items:center;margin:8px 2px;font-size:13px;flex-wrap:wrap', `<span style="opacity:.7">${rows.length} ${rows.length === 1 ? 'Eintrag' : 'Einträge'} · Sortieren:</span>`);
    const sb = (key, label) => {
      const on = v.sort === key;
      const dir = key === 'date' ? v.dateDir : v.dir;
      const e = flEl('button', `border:1px solid ${on ? '#c71b1b' : '#6b6f76'};background:${on ? '#c71b1b' : 'transparent'};color:${on ? '#fff' : 'inherit'};border-radius:14px;padding:3px 12px;font:bold 13px system-ui;cursor:pointer`,
        `${label}${on ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}`);
      e.addEventListener('click', () => {
        if (v.sort === key) { if (key === 'date') v.dateDir = v.dateDir === 'asc' ? 'desc' : 'asc'; else v.dir = v.dir === 'asc' ? 'desc' : 'asc'; }
        v.sort = key;
        if (key === 'date') v.dir = v.dateDir;
        save();
      });
      bar.appendChild(e);
    };
    sb('name', 'Name'); sb('date', 'Datum');
    c.appendChild(bar);
    const ul = flEl('div', 'display:flex;flex-direction:column;gap:8px');
    ul.className = 'jaf-fl-list';
    c.appendChild(ul);
    for (const { p, m, owner } of rows) ul.appendChild(flRowEl(p, m, owner && owner.id !== p.id ? owner.nick : ''));
    if (!rows.length) ul.appendChild(flEl('div', 'opacity:.6;padding:12px', 'Keine Einträge für diese Auswahl.'));
    flAlignNicks(ul);
    flRenderSide(v);
    flLiveWorker();
  }
  function flRenderSide(v) {
    const ts = document.getElementById('ts');
    if (!ts) return;
    const c = flCounts();
    ts.innerHTML = '';
    const w = flEl('div', '');
    w.className = 'well well-sm';
    w.appendChild(flEl('strong', '', 'Status')).className = 'h_2';
    for (const k of FL_ORDER) {
      const on = v.st.includes(k);
      const r = flEl('div', `display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;margin-top:4px;${on ? 'background:rgba(128,128,128,.18)' : 'opacity:.55'}`,
        `${flIcon(k, { size: 20, redGef: true })}<span>${escHtml(FL_ST[k].label)}</span><b style="margin-left:auto">${c[k]}</b>`);
      r.addEventListener('click', () => { v.st = on ? v.st.filter((x) => x !== k) : [...v.st, k]; GM_setValue(K_FL_VIEW, v); flRenderOverview(); });
      w.appendChild(r);
    }
    w.appendChild(flEl('p', 'font-size:12px;opacity:.7;margin-top:10px', 'Klick = Status ein-/ausblenden'));
    const vis = visibilityFromDoc(document);
    if (vis === 1) w.appendChild(flEl('p', 'font-size:12px;color:#ffb020;margin-top:6px', 'Lebendprüfung pausiert: Du bist sichtbar eingeloggt (Profilaufrufe wären als Besuch sichtbar).'));
    ts.appendChild(w);
  }

  // ---- Lebendprüfung (nur auf „Meine Fickliste“, nur unsichtbar, je Profil höchstens 1×/Tag) ----
  function flClassifyDoc(r, pid) {
    const html = r.html || '';
    let finalPath = ''; try { finalPath = new URL(r.url).pathname; } catch (e) { /* egal */ }
    if (r.status === 404 || r.status === 410) return 'dead';
    if (r.doc && parseProfileDoc(r.doc)) return /deaktiviert|pausiert/i.test(((r.doc.querySelector('.profile-base-info, header') || {}).textContent || '')) ? 'deact' : 'ok';
    if (/(vorübergehend\s+)?deaktiviert|pausiert/i.test(html)) return 'deact';
    if (finalPath && !new RegExp(`/(profile|my)/${pid}\\.`).test(finalPath)) return 'dead';
    if (/nicht gefunden|existiert nicht|gelöscht/i.test(html)) return 'dead';
    return '';
  }
  function flSetLive(p, live, why) {
    const q = flGet(p.id) || p;
    if (q.live === live) { q.checkTs = Date.now(); flPut(q); return; }
    const names = { ok: 'wieder aktiv', deact: 'deaktiviert', dead: 'gelöscht' };
    if (q.live || live !== 'ok') flHist(q, `${names[live] || live}${why ? ' (' + why + ')' : ''}`);
    q.live = live; q.liveTs = Date.now(); q.checkTs = Date.now();
    flPut(q);
  }
  async function flLiveWorker() {
    if (window.__jafFlLive) return;
    window.__jafFlLive = true;
    try {
      while (flOverviewPage()) {
        if (document.visibilityState !== 'visible' || visibilityFromDoc(document) === 1) { await sleep(5000); continue; }
        const p = Object.values(getFl()).find((x) => !flIsExt(x.id) && Date.now() - (x.checkTs || 0) > 864e5);
        if (!p) break;
        let res = '';
        try { const r = await jfetch(location.origin + (p.path || `/profile/${p.id}.html`)); res = flClassifyDoc(r, p.id); } catch (e) { res = ''; }
        if (res) flSetLive(p, res, 'Prüfung');
        else {
          const q = flGet(p.id); q.checkTs = Date.now(); flPut(q);
          const u = GM_getValue(K_FL_UNKNOWN, []) || []; u.push({ ts: Date.now(), id: p.id, nick: p.nick }); GM_setValue(K_FL_UNKNOWN, u.slice(-50));
          console.warn('[Alter-Filter] Fickliste: unbekannter Profilzustand', p.nick, p.id);
        }
        await sleep(2500 + Math.random() * 2000);
        if (flOverviewPage() && !document.querySelector('#jaf-fl-entry, #jaf-fl-clubs')) flRenderOverview();
      }
    } finally { window.__jafFlLive = false; }
  }

  // ---- Externe Ficks (eigene Profilseite, editierbar wie das eigene Profil) ----
  const FL_TYPES = ['Frau', 'Mann', 'Paar', 'Transfrau', 'Transmann', 'Frauen-Paar', 'Männer-Paar', 'Divers'];
  const FL_SED_KEYS = ['Größe', 'Gewicht', 'Haarfarbe', 'Augenfarbe', 'Aussehen', 'Neigung', 'Sternzeichen', 'Dominant / Devot', 'Sadomaso', 'Raucher', 'Kinder'];
  const FL_TEXT_KEYS = ['Motto', 'Profiltext', 'Das mag ich', 'Das mag ich nicht'];
  function flExtData(p) {
    const d = Object.assign({ nick: p.nick, type: p.type || '', ages: [], place: '', tagline: '', sed: [], secs: [], bs: [], prefs: [], pnote: p.pnote || '' }, p.extData || {});
    d.bs = d.bs || []; d.prefs = d.prefs || [];
    d.secs = (d.secs || []).map((x) => (x.h === 'Über mich' ? { h: 'Profiltext', t: x.t } : x));
    d.nick = p.nick; d.type = p.type || d.type;
    const n = /paar/i.test(d.type) ? 2 : 1;
    while (d.sed.length < n) d.sed.push({ g: n === 2 ? (d.sed.length ? '1' : '2') : '', age: 0, title: n === 2 ? (d.sed.length ? 'Steckbrief (Er)' : 'Steckbrief (Sie)') : 'Steckbrief', props: {} });
    d.sed = d.sed.slice(0, n);
    d.sed.forEach((x, i) => { if (d.ages[i]) x.age = d.ages[i]; if (x.props && x.props['Dominant/Devot'] && !x.props['Dominant / Devot']) { x.props['Dominant / Devot'] = x.props['Dominant/Devot']; delete x.props['Dominant/Devot']; } });
    return d;
  }
  function flExtSave(p, d, why = 'bearbeitet', img) {
    const q = flGet(p.id) || p;
    q.extData = d;
    q.type = d.type || q.type;
    if (img !== undefined) q.img = img;
    flPut(q);
    const stands = flStands(q.id);
    stands.push({ ts: Date.now(), why, lvl: 1, data: Object.assign({}, d), img: q.img || '' });
    flSetStands(q.id, stands);
    return q;
  }
  async function flAddExternal(pre = {}) {
    const res = await new Promise((resolve) => {
      const { ov, box } = flOverlay('jaf-fl-add');
      box.appendChild(flEl('div', 'display:flex;align-items:center;gap:10px;font:bold 20px system-ui;margin-bottom:12px', `<span style="font-size:22px">+</span>${flIcon('gef', { size: 22 })}<span>Externen Fick zufügen</span>`));
      box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin-bottom:4px', 'Name / Nick'));
      const nm = flEl('input', FL_INPUT_CSS + ';width:100%'); nm.value = pre.name || '';
      box.appendChild(nm);
      box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin:10px 0 4px', 'Profiltyp'));
      const ty = flEl('select', FL_INPUT_CSS + ';width:100%');
      for (const t of FL_TYPES) ty.appendChild(new Option(t, t, t === (pre.type || 'Frau'), t === (pre.type || 'Frau')));
      box.appendChild(ty);
      const lb = flEl('label', 'display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer');
      const wj = flEl('input'); wj.type = 'checkbox'; wj.checked = !!pre.wasJoy;
      lb.appendChild(wj); lb.appendChild(flEl('span', '', 'war bei JOYclub (Profil gelöscht)'));
      box.appendChild(lb);
      if (pre.note) { box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin:10px 0 4px', 'Profilnotiz')); box.appendChild(flEl('div', 'white-space:pre-wrap;background:#24262a;border-radius:6px;padding:6px 8px', escHtml(pre.note))); }
      const err = flEl('div', 'color:#ffb020;margin-top:8px;min-height:1px');
      box.appendChild(err);
      const row = flEl('div', 'display:flex;gap:10px;justify-content:flex-end;margin-top:14px');
      const done = (v) => { ov.remove(); resolve(v); };
      const ok = () => {
        const name = nm.value.trim();
        if (!name) { err.textContent = 'Bitte einen Namen eingeben.'; return; }
        let slug = joySlug(name) || 'fick', s = slug, i = 2;
        while (flGet('x-' + s)) s = `${slug}_${i++}`;
        done({ id: 'x-' + s, name, type: ty.value, wasJoy: wj.checked });
      };
      row.appendChild(flBtn('Abbrechen', () => done(null)));
      row.appendChild(flBtn('Anlegen', ok, true));
      box.appendChild(row);
      nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') done(null); });
      setTimeout(() => nm.focus(), 50);
    });
    if (!res) return null;
    const p = { id: res.id, nick: res.name, type: res.type, ext: true, wasJoy: res.wasJoy, status: pre.status || 'gef', meets: [], hist: [], created: Date.now(), pnote: pre.note || '' };
    if (res.wasJoy) p.live = 'dead';
    flHist(p, res.wasJoy ? 'angelegt (war bei JOYclub)' : 'angelegt (extern)');
    if (pre.cmDate) flHist(p, `gelöscht laut JOY-Team-Nachricht vom ${pre.cmDate}`);
    flPut(p);
    flExtSave(p, flExtData(p), 'angelegt');
    // Party aus der Notiz vorschlagen
    for (const d of flNoteDates(pre.note)) {
      const e = await flSuggestPopup(d, pre.note);
      const q = flGet(p.id);
      if (e) { q.meets.push(Object.assign(flMeetFromEvent(e), { note: '' })); flPut(q); }
      else if (e === undefined) { q.meets.push({ id: flNewId(), date: d, time: '', wo: '', url: '', club: '', note: '' }); flPut(q); }
      else { q.dismissed = [...(q.dismissed || []), d]; flPut(q); }
    }
    return flGet(p.id);
  }
  // Bereich-Popup auf der externen Seite
  function flExtEdit(p, area) {
    const d = flExtData(p);
    const { ov, box } = flOverlay('jaf-fl-extedit');
    const titles = { head: 'Kopf bearbeiten', img: 'Profilbild', sed: 'Steckbrief bearbeiten', text: 'Texte bearbeiten', prefs: 'Vorlieben bearbeiten', bs: 'Suchkriterien bearbeiten' };
    box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:10px', escHtml(titles[area] || 'Bearbeiten')));
    const lab = (t) => box.appendChild(flEl('div', 'font-size:12.5px;color:#9a9a9a;margin:8px 0 3px', escHtml(t)));
    const inp = (v, w = '100%') => { const e = flEl('input', FL_INPUT_CSS + `;width:${w}`); e.value = v || ''; return e; };
    const get = [];
    let newImg;
    if (area === 'head') {
      lab('Profiltyp'); const ty = flEl('select', FL_INPUT_CSS + ';width:100%'); for (const t of FL_TYPES) ty.appendChild(new Option(t, t, t === d.type, t === d.type)); box.appendChild(ty);
      lab('Alter (bei Paaren z. B. 34 + 38)'); const ag = inp((d.ages || []).join(' + ')); box.appendChild(ag);
      lab('Ort'); const pl = inp(d.place); box.appendChild(pl);
      lab('Kurztext'); const tg = inp(d.tagline); box.appendChild(tg);
      get.push(() => { d.type = ty.value; d.ages = (ag.value.match(/\d{2,3}/g) || []).map(Number).slice(0, 2); d.place = pl.value.trim(); d.tagline = tg.value.trim(); });
    } else if (area === 'img') {
      const prev = flEl('div', 'margin:6px 0', flAvatar(p, 160, '12px'));
      box.appendChild(prev);
      const f = flEl('input'); f.type = 'file'; f.accept = 'image/*';
      f.addEventListener('change', () => {
        const file = f.files && f.files[0]; if (!file) return;
        const fr = new FileReader();
        fr.onload = () => { newImg = String(fr.result || ''); prev.innerHTML = `<img src="${newImg}" style="width:160px;height:160px;object-fit:cover;border-radius:12px">`; };
        fr.readAsDataURL(file);
      });
      box.appendChild(f);
    } else if (area === 'sed') {
      const grid = flEl('div', 'display:flex;gap:14px;flex-wrap:wrap');
      for (const s of flExtData(Object.assign({}, p, { extData: d, type: d.type })).sed) {
        const col = flEl('div', 'flex:1;min-width:220px');
        col.appendChild(flEl('div', 'font-weight:700;margin:4px 0', escHtml(s.title)));
        const fields = {};
        for (const k of FL_SED_KEYS) {
          col.appendChild(flEl('div', 'font-size:12px;color:#9a9a9a;margin-top:5px', escHtml(k)));
          const e = inp(s.props[k]); fields[k] = e; col.appendChild(e);
        }
        grid.appendChild(col);
        get.push(() => { const ix = d.sed.findIndex((x) => x.title === s.title); const t = ix >= 0 ? d.sed[ix] : (d.sed.push(s), s); for (const k of FL_SED_KEYS) t.props[k] = fields[k].value.trim(); });
      }
      box.appendChild(grid);
    } else if (area === 'prefs') {
      for (const k of ['Unbedingt', 'Steh ich drauf', 'Geht gar nicht']) {
        lab(`${k} (durch Komma getrennt)`);
        const cur = ((d.prefs.find((x) => x.h === k) || {}).items || []).join(', ');
        const ta = flEl('textarea', FL_INPUT_CSS + ';width:100%;resize:vertical'); ta.rows = 2; ta.value = cur; box.appendChild(ta);
        get.push(() => { d.prefs = d.prefs.filter((x) => x.h !== k); const items = ta.value.split(',').map((x) => x.trim()).filter(Boolean); if (items.length) d.prefs.push({ h: k, items }); });
      }
      get.push(() => { const o = ['Unbedingt', 'Steh ich drauf', 'Geht gar nicht']; d.prefs.sort((a, b) => o.indexOf(a.h) - o.indexOf(b.h)); });
    } else if (area === 'bs') {
      const keys = ['Ich suche', 'Neigung', 'Beziehungsstatus', 'Besuchbar', 'Swinger', 'BDSM', 'Fotoshooting'];
      for (const k of keys) {
        lab(k);
        const e = inp((d.bs.find((x) => x.t === k) || {}).c);
        box.appendChild(e);
        get.push(() => { d.bs = d.bs.filter((x) => x.t !== k); if (e.value.trim()) d.bs.push({ t: k, c: e.value.trim() }); });
      }
      get.push(() => { d.bs.sort((a, b) => keys.indexOf(a.t) - keys.indexOf(b.t)); });
    } else {
      for (const k of FL_TEXT_KEYS) {
        lab(k);
        const cur = (d.secs.find((x) => x.h === k) || {}).t || '';
        const ta = flEl('textarea', FL_INPUT_CSS + ';width:100%;resize:vertical'); ta.rows = 4; ta.value = cur; box.appendChild(ta);
        get.push(() => { d.secs = d.secs.filter((x) => x.h !== k); if (ta.value.trim()) d.secs.push({ h: k, t: ta.value.trim() }); d.secs.sort((a, b) => FL_TEXT_KEYS.indexOf(a.h) - FL_TEXT_KEYS.indexOf(b.h)); });
      }
    }
    const row = flEl('div', 'display:flex;gap:10px;justify-content:flex-end;margin-top:14px');
    row.appendChild(flBtn('Abbrechen', () => ov.remove()));
    row.appendChild(flBtn('Speichern', () => {
      get.forEach((g) => g());
      let img;
      if (newImg) { img = flNewId(); GM_setValue(K_FLI + img, newImg); }
      flExtSave(p, d, area === 'img' ? 'Profilbild geändert' : 'bearbeitet', img);
      ov.remove();
      if (flViewerPid()) flViewerRender(true); else if (flExternPage()) flExternRender(true);
    }, true));
    box.appendChild(row);
  }
  async function flLinkJoy(p) {
    const u = await flPrompt('Mit JOYclub-Profil verknüpfen', ['Füge den Link zum JOYclub-Profil dieser Person ein. Treffen, Status, Notizen und Archiv werden übernommen.'], '', 'Verknüpfen');
    if (!u) return;
    const id = idOf(u);
    if (!id) { alert('Das ist kein Link zu einem JOYclub-Profil.'); return; }
    if (flGet(id) && !confirm('Für dieses Profil gibt es schon einen Eintrag in der Fickliste. Zusammenführen?')) return;
    const old = flGet(id) || {};
    const q = Object.assign({}, p, old, {
      id, ext: false, wasJoy: false, live: '', path: (String(u).match(/\/profile\/\d+\.[^?#]*/) || [`/profile/${id}.html`])[0],
      meets: [...(old.meets || []), ...(p.meets || [])], hist: [...(old.hist || []), ...(p.hist || [])], status: p.status || old.status,
    });
    flHist(q, `verknüpft mit JOYclub-Profil (vorher extern: ${p.nick})`);
    flSetStands(id, [...flStands(id), ...flStands(p.id)].sort((a, b) => a.ts - b.ts));
    GM_deleteValue(K_FLA + p.id);
    const m = getFl(); delete m[p.id]; setFl(m);
    flPut(q);
    location.href = location.origin + q.path;
  }
  function flExternRender(force = false) {
    const c = document.getElementById('c');
    if (!c) return;
    const pid = 'x-' + flExternSlug();
    const p = flGet(pid);
    const ts = flArchivParam();
    const sig = JSON.stringify([p, ts]);
    if (!force && c.__jafSig === sig) return;
    c.__jafSig = sig;
    const tsEl = document.getElementById('ts'); if (tsEl) tsEl.style.display = 'none';
    c.style.width = 'auto'; c.style.flex = '1';
    c.className = (c.className || '').replace(/col-lg-6/, 'col-lg-9');
    if (!p) { c.innerHTML = '<h1>Fickliste</h1><p>Diesen externen Eintrag gibt es nicht (mehr).</p>'; return; }
    if (/[?&]flnav=1/.test(location.search)) ssSet('jaf_flnav', pid);
    const stands = flStands(pid);
    const s = ts ? (stands.find((x) => x.ts === ts) || stands[stands.length - 1]) : null;
    const d = s ? s.data : flExtData(p);
    const imgSrc = s ? (flImg(s.img) || flImg(p.img)) : flImg(p.img);
    const pen = (area) => `<button type="button" class="jaf-fl-pen" data-a="${area}" title="Bearbeiten" style="background:none;border:0;color:inherit;opacity:.7;cursor:pointer;padding:2px 4px">${FL_PEN}</button>`;
    const editable = !s;
    c.innerHTML = '';
    const wrap = flEl('div', '');
    wrap.className = 'jaf-fl-extern';
    let html = flRenderL1(d, imgSrc, { headExtra: editable ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${pen('head')}<span style="opacity:.6;font-size:12px;align-self:center">Kopf</span>${pen('img')}<span style="opacity:.6;font-size:12px;align-self:center">Profilbild</span>${pen('sed')}<span style="opacity:.6;font-size:12px;align-self:center">Steckbrief</span>${pen('text')}<span style="opacity:.6;font-size:12px;align-self:center">Texte</span></div>` : '' });
    wrap.innerHTML = html;
    c.appendChild(wrap);
    if (d.pnote || p.pnote) wrap.querySelector('.jaf-fl-l1-block').insertAdjacentHTML('beforeend', `<div style="margin-top:18px;padding:12px 16px;border-radius:8px;background:rgba(128,128,128,.08)"><div style="font-weight:600;font-size:13.5px;margin-bottom:4px">Profilnotiz</div><div style="white-space:pre-wrap;font-size:13px">${escHtml(s ? d.pnote : p.pnote)}</div></div>`);
    wrap.querySelector('.jaf-fl-l1-block').appendChild(flBlockEl(p, { plus: editable }));
    if (editable) {
      wrap.querySelectorAll('.jaf-fl-pen').forEach((b) => b.addEventListener('click', () => flExtEdit(flGet(pid), b.getAttribute('data-a'))));
      const lk = flBtn('Mit JOYclub-Profil verknüpfen', () => flLinkJoy(flGet(pid)));
      lk.style.marginTop = '18px';
      wrap.querySelector('.jaf-fl-l1').appendChild(lk);
    }
    // Button im Kopf (wie auf echten Profilen)
    flInsertButtons();
    document.title = `${p.nick} · Fickliste – JOYclub`;
    if (flDead(p) || (flIsExt(pid) && !p.wasJoy && s)) { if (!wrap.__shown) { wrap.__shown = true; if (s) flDeadPopup(p); } }
    if (ssGet('jaf_flnav') === pid) flShowNav(p, s ? s.ts : 0);
  }

  // ---- ClubMail: gelöschte Kontakte erkennen, JOY-Team-Löschmeldungen auswerten ----
  function flByNick(nick) {
    const k = norm(nick);
    if (!k) return null;
    return Object.values(getFl()).find((p) => (!flIsExt(p.id) || p.wasJoy) && [p.nick, ...(p.nicks || [])].some((n) => norm(n) === k)) || null;
  }
  function flAddStandData(pid, why, patch) {
    const stands = flStands(pid);
    const last = stands[stands.length - 1];
    const data = Object.assign({}, last ? last.data : {}, patch);
    stands.push({ ts: Date.now(), why, lvl: 1, data, img: last ? last.img : '' });
    flSetStands(pid, stands);
  }
  function flParseDeletion(text) {
    const t = String(text || '').replace(/\r/g, '');
    const m = t.match(/Dein Kontakt\s+(.+?)\s+hat sich (?:leider )?gelöscht/i);
    if (!m) return null;
    const n = t.match(/Deine Anmerkungen:\s*\n?([\s\S]*?)\n?\s*Liebe Grüße/i);
    return { nick: m[1].trim(), note: n ? n[1].replace(/\n{3,}/g, '\n\n').trim() : '' };
  }
  // gelöschtes Konto: Nick durchgestrichen, Klick → Profil-Archiv, Platzhalterbild → letztes Archivbild
  function flDeletedDecor(av, nameEl, p) {
    const url = flArchiveUrl(p);
    const src = flImg(p.img) || flImg((flStands(p.id).slice().reverse().find((s0) => s0.img) || {}).img);
    if (nameEl && nameEl.getAttribute('data-jaf-del') !== p.id) {
      nameEl.setAttribute('data-jaf-del', p.id);
      if (!nameEl.getAttribute('data-jaf-nick')) nameEl.setAttribute('data-jaf-nick', nameEl.textContent.trim());
      nameEl.innerHTML = `<a href="${escHtml(url)}" target="_blank" title="Gelöscht – Profil-Archiv öffnen" style="color:inherit;text-decoration:line-through;opacity:.75">${escHtml(nameEl.getAttribute('data-jaf-nick'))}</a>`;
      nameEl.querySelector('a').addEventListener('click', (e) => e.stopPropagation(), true);
    }
    if (av && av.getAttribute('data-jaf-del') !== p.id) {
      av.setAttribute('data-jaf-del', p.id);
      av.style.cursor = 'pointer';
      av.title = `${p.nick} (gelöscht) – Profil-Archiv`;
      av.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank'); }, true);
    }
    if (av && src) {
      for (const so of av.querySelectorAll('picture source')) if (so.getAttribute('srcset') !== src) so.setAttribute('srcset', src);
      const img = av.querySelector('img');
      if (img && img.getAttribute('src') !== src) { img.setAttribute('src', src); img.style.filter = 'grayscale(1)'; }
    }
  }
  function piDeletedDecor(av, nameEl) {
    const nick = av && av.getAttribute('title');
    const id = nick && (GM_getValue('jaf_pi_nick', {}) || {})[norm(nick)];
    const rec = id && piGet(id);
    if (!rec) return;
    if (nameEl && !nameEl.getAttribute('data-jaf-del')) { nameEl.setAttribute('data-jaf-del', id); nameEl.style.textDecoration = 'line-through'; nameEl.style.opacity = '.75'; nameEl.title = 'Konto gelöscht'; }
    if (rec.img) {
      for (const so of av.querySelectorAll('picture source')) if (so.getAttribute('srcset') !== rec.img) so.setAttribute('srcset', rec.img);
      const img = av.querySelector('img');
      if (img && img.getAttribute('src') !== rec.img) { img.setAttribute('src', rec.img); img.style.filter = 'grayscale(1)'; }
    }
  }
  function flClubMail() {
    // Unterhaltungsliste: Nick vorhanden, Link leer = gelöschtes Konto
    for (const av of document.querySelectorAll('j-avatar-image.cm-conversation-list-item__avatar[title]')) {
      if (av.getAttribute('href') !== '') continue;
      const p = flByNick(av.getAttribute('title'));
      const item = av.closest('.cm-conversation-list-item') || av.parentElement;
      if (!p) { piDeletedDecor(av, item && item.querySelector('.cm-conversation-list-item__name')); continue; }
      if (p.live !== 'dead') {
        const day = (((item && item.querySelector('.cm-conversation-list-item__meta')) || {}).textContent || '').match(/\d{2}\.\d{2}\.\d{4}/);
        flSetLive(p, 'dead', `laut ClubMail, spätestens am ${day ? day[0] : fmtDay(Date.now())}`);
      }
      flDeletedDecor(av, item && item.querySelector('.cm-conversation-list-item__name'), p);
    }
    // Vorschau der JOY-Team-Meldungen in der Liste
    for (const tx of document.querySelectorAll('.cm-conversation-list-item__text')) {
      if (tx.__jafFl || !/hat sich (leider )?gelöscht/.test(tx.textContent || '')) continue;
      tx.__jafFl = true;
      const d = flParseDeletion((tx.textContent || '').replace(/\s+Hallo /, '\nHallo ').replace(/Deine Anmerkungen:/, '\nDeine Anmerkungen:\n').replace(/\s+Liebe Grüße/, '\nLiebe Grüße'));
      const p = d && flByNick(d.nick);
      if (p && p.live !== 'dead') flSetLive(p, 'dead', 'laut JOY-Team-Nachricht');
    }
    // geöffnete Unterhaltung: Kopf ohne Profil-Link / Fehlermeldung „existiert nicht oder wurde gelöscht“
    const head = document.querySelector('.cm-conversation-header__name-readonly');
    const gone = [...document.querySelectorAll('j-growl')].some((g) => /existiert nicht oder wurde gelöscht/.test(g.getAttribute('content') || g.textContent || ''));
    if (head && gone) {
      const p = flByNick((head.getAttribute('data-jaf-nick') || head.textContent).trim());
      if (p && p.live !== 'dead') flSetLive(p, 'dead', 'laut ClubMail');
      if (p) flDeletedDecor(document.querySelector('.cm-conversation-header j-avatar-image, .cm-conversation-header__avatar'), head, p);
    }
    // JOY-Team-Meldung „Dein Kontakt … hat sich gelöscht“: Zusatz in der Sprechblase
    for (const bub of document.querySelectorAll('.cm-message-bubble__content')) {
      if (!/hat sich (leider )?gelöscht/.test(bub.textContent || '')) continue;
      const d = flParseDeletion(bub.innerText || bub.textContent);
      if (!d) continue;
      const li = bub.closest('li');
      const tm = li && li.querySelector('time[datetime]');
      const day = tm ? fmtDate(tm.getAttribute('datetime')) : '';
      const p = flByNick(d.nick);
      const sig = `${d.nick}|${p ? p.id + p.live : '-'}`;
      let ft = bub.querySelector(':scope > .jaf-fl-cmft');
      if (ft && ft.__sig === sig) continue;
      if (!ft) { ft = flEl('div', 'margin-top:12px;padding-top:10px;border-top:1px solid rgba(128,128,128,.35);display:flex;align-items:center;gap:10px;flex-wrap:wrap'); ft.className = 'jaf-fl-cmft'; bub.appendChild(ft); }
      ft.__sig = sig;
      ft.innerHTML = '';
      if (p) {
        if (p.live !== 'dead') flSetLive(p, 'dead', `gelöscht laut JOY-Team-Nachricht${day ? ' vom ' + day : ''}`);
        if (d.note && d.note !== (p.pnote || '')) {
          const q = flGet(p.id); q.pnote = d.note; flPut(q);
          flAddStandData(p.id, 'Profilnotiz laut JOY-Team-Meldung', { pnote: d.note });
        }
        ft.appendChild(flEl('span', 'display:inline-flex;align-items:center;gap:7px;font-weight:600', `${flIcon(p.status, { size: 16, redGef: true })} In deiner Fickliste · als gelöscht vermerkt`));
        const a = flBtn('Profil-Archiv', () => window.open(flArchiveUrl(flGet(p.id)), '_blank'));
        ft.appendChild(a);
      } else {
        const b = flBtn('', async () => {
          const q = await flAddExternal({ name: d.nick, note: d.note, wasJoy: true, cmDate: day });
          if (q) { ft.__sig = ''; window.open(flUrl(q) + '&flnav=1', '_blank'); }
        }, true);
        b.innerHTML = `+ ${flIcon('gef', { size: 16 })} Zur Fickliste hinzufügen`;
        b.style.display = 'inline-flex'; b.style.alignItems = 'center'; b.style.gap = '7px';
        ft.appendChild(b);
        const dates = flNoteDates(d.note);
        let hint = 'übernimmt Nick und Anmerkungen';
        if (dates.length) {
          const mm = flPartyMatches(dates[0], d.note);
          const e = mm.strong[0];
          hint += e ? ` und den Vorschlag „${fmtDate(dates[0])} · ${e.club || e.name}“` : ` und das Datum ${fmtDate(dates[0])}`;
        }
        ft.appendChild(flEl('span', 'font-size:12px;opacity:.7;flex-basis:100%', escHtml(hint)));
      }
    }
  }

  // ---- Verschlüsselung der Fickliste in der Datensicherung (Schlüssel: eigener Nick) ----
  function ownNick() {
    const a = document.querySelector('.navigation_user_box a.user_link');
    const t = a ? (a.childNodes[0] && a.childNodes[0].nodeType === 3 ? a.childNodes[0].nodeValue : a.textContent) : '';
    return String(t || '').trim() || GM_getValue('jaf_own_nick', '');
  }
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function flKey(nick, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm(nick)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function flEncrypt(obj, nick) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await flKey(nick, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { v: 1, alg: 'AES-GCM/PBKDF2-SHA256', salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function flDecrypt(enc, nick) {
    try {
      const key = await flKey(nick, unb64(enc.salt));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv) }, key, unb64(enc.data));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { return null; }
  }
  const FL_KEY_RE = /^jaf_fl/;
  function flBackupPart() {
    const o = {};
    for (const k of GM_listValues()) if (FL_KEY_RE.test(k)) o[k] = GM_getValue(k);
    return o;
  }


  // ---- Profil-Ansicht im echten JOYclub-Design: Träger ist das eigene Profil (/profile/<eigene ID>…?fl=<pid>[&archiv=<ts>]) ----
  // Gerüst nach dem Aufbau eines fremden Profils (Kopf, Seitenleiste, Profiltexte, Steckbrief, Vorlieben). Die data-v-Attribute
  // werden – wenn vorhanden – von der Trägerseite übernommen, damit JOYclubs CSS greift.
  const flOwnPath = () => GM_getValue('jaf_own_path', '') || (sessionId() ? `/profile/${sessionId()}.html` : '');
  const flViewerPid = () => (isProfilePage() && sessionId() && idOf(location.pathname) === sessionId()
    ? decodeURIComponent((location.search.match(/[?&]fl=([^&]+)/) || [])[1] || '') : '');
  const flCarrierUrl = (pid, ts, nav) => `${location.origin}${flOwnPath()}?fl=${encodeURIComponent(pid)}${ts ? `&archiv=${ts}` : ''}${nav ? '&flnav=1' : ''}`;
  const FL_DV = { // Rückfall-Werte (Stand 10/2026)
    'profile-container': 'data-v-f349d257', 'profile-header': 'data-v-58838249 data-v-f349d257', 'profile-coverart': 'data-v-944beade data-v-58838249',
    'profile-header__main-infos': 'data-v-58838249', 'profile-header__pic': 'data-v-58838249', 'profile-avatar': 'data-v-9c2ac1f3 data-v-58838249',
    'profile-avatar__image-container': 'data-v-9c2ac1f3', 'profile-avatar__gradient-overlay': 'data-v-9c2ac1f3',
    'profile-header__base-information': 'data-v-58838249', 'profile-base-info': 'data-v-0a6a81ea data-v-58838249', 'profile-base-info__line-1': 'data-v-0a6a81ea',
    'profile-header__header-slot': 'data-v-58838249', 'profile-container__interaction-buttons': 'data-v-f349d257', 'profile-interaction-buttons': 'data-v-02c22baa data-v-f349d257',
    'profile-label-interaction-button': 'data-v-5a0c4a53 data-v-02c22baa', 'profile-container__body': 'data-v-f349d257',
    'profile-sidebar-container': 'data-v-191742e8 data-v-f349d257', 'profile-sidebar-container__desktop-only-content': 'data-v-191742e8',
    'profile-bs-container': 'data-v-bc5636d3 data-v-70cc99b8 data-v-191742e8', 'profile-bs-grid': 'data-v-e4e63473 data-v-70cc99b8',
    'profile-bs-property': 'data-v-fff2cf02 data-v-70cc99b8', 'profile-bs-property__title': 'data-v-fff2cf02', 'profile-sidebar-container__badge-list': 'data-v-191742e8',
    'profile-container__content': 'data-v-f349d257', 'profile-main-page': 'data-v-2be65c87 data-v-f349d257', 'profile-description': 'data-v-0cdd21da',
    'profile-description-motto': 'data-v-64cfe7b9 data-v-0cdd21da', 'profile-description-maintext': 'data-v-b3af8de8 data-v-0cdd21da',
    'profile-description-like': 'data-v-db1bc5af data-v-0cdd21da', 'profile-headline': 'data-v-795786fb', 'profile-sed-card-container': 'data-v-30811b87 data-v-2be65c87',
    'profile-sed-card-container__sed-card': 'data-v-30811b87', 'profile-sed-card': 'data-v-15f3ebeb data-v-30811b87', 'profile-sed-card__upper-info': 'data-v-15f3ebeb',
    'profile-erotic-prefs': 'data-v-be9e2df7 data-v-15f3ebeb', 'profile-erotic-prefs__header': 'data-v-be9e2df7',
  };
  const flDvCache = {};
  function flDv(cls) {
    if (flDvCache[cls]) return flDvCache[cls];
    const e = document.querySelector(`main.profile-container:not(.jaf-fl-tpl) .${cls}, main.profile-container.${cls}:not(.jaf-fl-tpl)`);
    const live = e ? [...e.attributes].filter((a) => a.name.startsWith('data-v-')).map((a) => a.name).join(' ') : '';
    return (flDvCache[cls] = live || FL_DV[cls] || '');
  }
  const dvA = (cls) => flDv(cls).split(' ').filter(Boolean).map((a) => `${a}=""`).join(' ');
  // Inhalte eines Profils (zusätzlich zu flCollect): Beschreibung, Suchkriterien, Vorlieben
  function flDescSections(doc = document) {
    const out = [];
    const map = [['.profile-description-motto', 'Motto', '.profile-description-motto__text'], ['.profile-description-maintext', 'Profiltext', '.profile-description-maintext__text'],
      ['.profile-description-like', 'Das mag ich', '.profile-description-like__text'], ['.profile-description-dislike', 'Das mag ich nicht', '.profile-description-dislike__text']];
    for (const [sel, h, tsel] of map) {
      const sec = [...doc.querySelectorAll(sel)].find((e) => !e.closest('.jaf-fl-viewer'));
      const t = sec && sec.querySelector(tsel);
      const txt = t ? (t.innerText || t.textContent || '').replace(/\n{3,}/g, '\n\n').trim() : '';
      if (txt) out.push({ h, t: txt });
    }
    return out;
  }
  function flBsProps(doc = document) {
    const out = [];
    for (const p of doc.querySelectorAll('.profile-bs-property, .profile-bs-so-property')) {
      if (p.closest('.jaf-fl-viewer')) continue;
      const t = ((p.querySelector('[class$="__title"]') || {}).textContent || '').trim();
      const c = ((p.querySelector('[class$="__content"]') || {}).innerText || (p.querySelector('[class$="__content"]') || {}).textContent || '').replace(/\s+/g, ' ').trim();
      if (t && c && !out.some((x) => x.t === t)) out.push({ t, c });
    }
    return out;
  }
  function flPrefs(doc = document) {
    const out = [];
    for (const cat of doc.querySelectorAll('.profile-erotic-prefs__category')) {
      if (cat.closest('.jaf-fl-viewer')) continue;
      const h = ((cat.querySelector('.profile-erotic-prefs__category-title') || {}).textContent || '').trim();
      const items = [...cat.querySelectorAll('j-tag')].map((t) => ((t.shadowRoot && t.shadowRoot.textContent) || t.textContent || t.getAttribute('text') || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (h && items.length && !out.some((x) => x.h === h)) out.push({ h, items });
    }
    return out;
  }
  const FL_SED_UPPER = ['Größe', 'Gewicht', 'Haarfarbe', 'Augenfarbe', 'Aussehen', 'Neigung', 'Sternzeichen'];
  // Gerüst eines fremden Profils mit den Daten eines Stands bzw. eines externen Ficks
  function flTplProfile(d, imgSrc, opt = {}) {
    const E = escHtml;
    const pen = (a) => (opt.editable ? (window.customElements && customElements.get('j-control-button')
      ? `<j-control-button class="profile-inline-edit-button jaf-fl-pen" data-a="${a}" icon-only="true" variant="secondary" a11y-label="Bearbeiten" title="Bearbeiten" style="margin-left:8px;vertical-align:middle"><j-icon type="j-ico-pen"></j-icon></j-control-button>`
      : `<button type="button" class="jaf-fl-pen" data-a="${a}" title="Bearbeiten" style="margin-left:8px;background:#33363c;border:0;border-radius:50%;width:30px;height:30px;color:#fff;cursor:pointer;vertical-align:middle">${FL_PEN}</button>`) : '');
    const sed = d.sed || [];
    const g0 = (sed[0] && sed[0].g) || (/frau/i.test(d.type || '') ? '2' : /mann/i.test(d.type || '') ? '1' : '');
    const img = imgSrc ? `<img class="core-img cover" src="${imgSrc}" alt="" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#5c6470;color:#fff;font:bold 72px system-ui">${E((d.nick || '?').slice(0, 1).toUpperCase())}</div>`;
    const ages = (d.ages || []).length ? `${(d.ages || []).join(' + ')} Jahre` : '';
    const bs = (d.bs || []).map((x) => `<div ${dvA('profile-bs-property')} class="profile-bs-property"><div ${dvA('profile-bs-property__title')} class="profile-bs-property__title">${E(x.t)}</div> <div ${dvA('profile-bs-property__title')} class="profile-bs-property__content">${E(x.c)}</div></div>`).join('');
    const desc = (d.secs || []).map((x) => {
      if (x.h === 'Motto') return `<section ${dvA('profile-description-motto')} class="profile-description-motto"><div class="profile-description-motto__text" ${dvA('profile-description-motto').split(' ')[0]}>${E(x.t)}</div></section>`;
      if (x.h === 'Profiltext' || x.h === 'Über mich') return `<section ${dvA('profile-description-maintext')} class="profile-description-maintext"><p class="profile-description-maintext__text" style="white-space:pre-wrap">${E(x.t)}</p></section>`;
      return `<section ${dvA('profile-description-like')} class="profile-description-like"><h2 ${dvA('profile-headline')} class="profile-headline profile-headline--with-margin">${E(x.h)}</h2> <p class="profile-description-like__text" style="white-space:pre-wrap">${E(x.t)}</p></section>`;
    }).join(' ');
    const prop = (k, v) => `<div ${dvA('profile-sed-card__upper-info')} class="profile-sed-card__property"><div ${dvA('profile-sed-card__upper-info')} class="profile-sed-card__headline">${E(k)}</div> <div ${dvA('profile-sed-card__upper-info')} class="profile-sed-card__content">${E(v)}</div></div>`;
    const prefs = (d.prefs || []).length ? `<div ${dvA('profile-erotic-prefs')} class="profile-erotic-prefs"><div ${dvA('profile-erotic-prefs__header')} class="profile-erotic-prefs__header"><h3 class="profile-erotic-prefs__headline">Vorlieben${pen('prefs')}</h3></div>` +
      d.prefs.map((c) => `<div class="profile-erotic-prefs__category"><h4 class="profile-erotic-prefs__category-title">${E(c.h)}</h4> <div class="profile-erotic-prefs__category-item-list" style="display:flex;flex-wrap:wrap;gap:6px">${c.items.map((t) => `<span class="jaf-fl-tag" style="display:inline-block;border:1px solid rgba(128,128,128,.5);border-radius:14px;padding:3px 10px;font-size:13px">${E(t)}</span>`).join('')}</div></div>`).join('') + '</div>'
      : (opt.editable ? `<div class="profile-erotic-prefs"><h3 class="profile-erotic-prefs__headline">Vorlieben${pen('prefs')}</h3><div style="opacity:.6">keine Angaben</div></div>` : '');
    const cards = (sed.length ? sed : [{ g: g0, age: (d.ages || [])[0] || 0, title: 'Steckbrief', props: {} }]).map((s, i) => {
      const P = s.props || {};
      const up = FL_SED_UPPER.filter((k) => P[k]).map((k) => prop(k, P[k])).join('');
      const low = Object.keys(P).filter((k) => !FL_SED_UPPER.includes(k) && P[k]).map((k) => prop(k, P[k])).join('');
      return `<div ${dvA('profile-sed-card-container__sed-card')} class="profile-sed-card-container__sed-card" style="flex:1;min-width:260px"><div ${dvA('profile-sed-card')} class="profile-sed-card"><h2 class="sr-only">${E(s.title || 'Steckbrief')}</h2>` +
        `<j-card ${dvA('profile-sed-card').split(' ')[0]}="" hide-media=""><div ${dvA('profile-sed-card__upper-info')} class="profile-sed-card__expandable-content">` +
        `<div ${dvA('profile-sed-card__upper-info')} class="profile-sed-card__upper-info"><div ${dvA('profile-sed-card__upper-info')} class="profile-sed-card__property profile-sed-card__property--filled">` +
        `${s.g ? `<j-gender-icon class="profile-sed-card__gender-icon" universal-gender="${E(s.g)}" highlighted-gender="[]"></j-gender-icon>` : ''} <span>${s.age ? `${s.age} Jahre` : E(s.title || '')}</span>${i === 0 ? pen('sed') : ''}</div>${up}</div>` +
        (low ? `<j-spacer class="profile-sed-card__spacer"></j-spacer><div ${dvA('profile-sed-card__upper-info')} class="profile-sed-card__lower-info">${low}</div>` : '') +
        (i === sed.length - 1 || !sed.length ? `<j-spacer class="profile-sed-card__spacer profile-sed-card__spacer--bigger"></j-spacer>${prefs}` : '') +
        `</div></j-card></div></div>`;
    }).join('');
    return `<main ${dvA('profile-container')} class="profile-container jaf-fl-tpl">` +
      `<div ${dvA('profile-container')}><div ${dvA('profile-header')} class="profile-header"><div ${dvA('profile-coverart')} class="profile-coverart" aria-hidden="true"></div>` +
      `<div ${dvA('profile-header__main-infos')} class="profile-header__main-infos"><div ${dvA('profile-header__pic')} class="profile-header__pic">` +
      `<div ${dvA('profile-avatar')} class="profile-avatar"><div ${dvA('profile-avatar__image-container')} class="profile-avatar__image-container"><a ${dvA('profile-avatar__image-container')} class="profile-avatar__link jaf-fl-avatar" style="${opt.editable ? 'cursor:pointer' : ''}" title="${opt.editable ? 'Profilbild ändern' : ''}">` +
      `<div class="image-ui vue-variant adaptive" style="width:100%;height:100%">${img}</div></a><div ${dvA('profile-avatar__gradient-overlay')} class="profile-avatar__gradient-overlay"></div></div></div>${pen('img')}</div>` +
      `<div ${dvA('profile-header__base-information')} class="profile-header__base-information profile-header__base-information--desktop"><div ${dvA('profile-base-info')} class="profile-base-info">` +
      `<div ${dvA('profile-base-info__line-1')} class="profile-base-info__line-1"><h1 ${dvA('profile-base-info__line-1')} class="profile-base-info__user-name">${E(d.nick || '')}</h1> ${g0 ? `<j-gender-icon universal-gender="${E(g0)}" highlighted-gender="[]"></j-gender-icon>` : ''}${pen('head')}</div>` +
      `<div ${dvA('profile-base-info__line-1')} class="profile-base-info__line-2"><span>${E(d.type || '')}</span> <span>${E(ages)}</span> <div class="profile-base-info__location-info"><span>${E(d.place || '')}</span></div></div>` +
      (opt.subline ? `<div class="profile-base-info__line-3">${opt.subline}</div>` : '') + `</div></div></div>` +
      `<div ${dvA('profile-header__header-slot')} class="profile-header__header-slot"><div ${dvA('profile-container__interaction-buttons')} class="profile-container__interaction-buttons">` +
      `<div ${dvA('profile-interaction-buttons')} class="profile-interaction-buttons"><div ${dvA('profile-label-interaction-button')} class="profile-label-interaction-button profile-label-interaction-button--is-big jaf-fl-proto" style="display:none"><span class="profile-clubmail-button"></span></div></div></div></div></div></div>` +
      `<div ${dvA('profile-container__body')} class="profile-container__body"><aside ${dvA('profile-sidebar-container')} class="profile-sidebar-container profile-container__sidebar">` +
      `<div ${dvA('profile-sidebar-container__desktop-only-content')} class="profile-sidebar-container__desktop-only-content">` +
      (bs || opt.editable ? `<div ${dvA('profile-bs-container')} class="profile-content-card__wrapper profile-bs-container"><j-content-card><h2 class="sr-only">Suchkriterien</h2>${pen('bs')}<div ${dvA('profile-bs-grid')} class="profile-bs-grid">${bs || '<div style="opacity:.6">keine Suchkriterien</div>'}</div></j-content-card></div>` : '') +
      (d.pnote ? `<j-content-card class="jaf-fl-pnote" style="display:block;margin-top:12px"><div style="font-weight:600;font-size:13.5px;margin-bottom:4px">${opt.archive ? 'Profilnotiz (damals)' : 'Profilnotiz'}</div><div style="white-space:pre-wrap;font-size:13px">${E(d.pnote)}</div></j-content-card>` : '') +
      `</div><j-list ${dvA('profile-sidebar-container__badge-list')} class="profile-sidebar-container__badge-list jaf-fl-tpl-list" role="list"></j-list></aside>` +
      `<div ${dvA('profile-container__content')} class="profile-container__content"><div ${dvA('profile-main-page')} class="profile-main-page profile-main-page--use-content-gap">` +
      `<div class="profile-main-page--mobile-horizontal-margin"><div ${dvA('profile-description')} class="profile-description">${opt.editable ? `<div style="text-align:right">${pen('text')}</div>` : ''}${desc || (opt.editable ? '<div style="opacity:.6">noch keine Profiltexte</div>' : '')}</div></div>` +
      `<div ${dvA('profile-sed-card-container')} class="profile-sed-card-container" style="display:flex;gap:16px;flex-wrap:wrap">${cards}</div>` +
      `</div></div></div></main>`;
  }
  // Ansicht rendern (Archivstand bzw. externer Fick); force = neu aufbauen
  function flViewerRender(force = false) {
    const pid = flViewerPid();
    const p = flGet(pid);
    const ts = flArchivParam();
    const host = document.querySelector('main.profile-container:not(.jaf-fl-tpl)');
    let wrap = document.querySelector('.jaf-fl-viewer');
    const sig = JSON.stringify([pid, ts, p && p.updated]);
    if (wrap && wrap.__sig === sig && !force) return;
    if (!wrap) {
      wrap = flEl('div', 'min-height:60vh');
      wrap.className = 'jaf-fl-viewer';
      if (host) { host.style.display = 'none'; host.insertAdjacentElement('beforebegin', wrap); }
      else (document.querySelector('#cfull, #page, #mfs_core') || document.body).prepend(wrap);
    }
    wrap.__sig = sig;
    if (!p) { wrap.innerHTML = '<div style="padding:40px;text-align:center">Diesen Eintrag gibt es in deiner Fickliste nicht (mehr).</div>'; return; }
    if (/[?&]flnav=1/.test(location.search)) ssSet('jaf_flnav', pid);
    const ext = flIsExt(pid);
    const stands = flStands(pid);
    const s = ts ? (stands.find((x) => x.ts === ts) || stands[stands.length - 1]) : null;
    if (!s && !ext) { location.replace(flLiveUrl(p, flNavOn(pid))); return; }
    if (s && p.lastStand !== s.ts) { p.lastStand = s.ts; flPut(p); }
    const editable = !s && ext;
    const d = s ? s.data || {} : flExtData(p);
    const imgSrc = s ? (flImg(s.img) || flImg(p.img)) : flImg(p.img);
    if (s && s.html) {
      if (typeof wrap.setHTMLUnsafe === 'function') wrap.setHTMLUnsafe(s.html); else wrap.innerHTML = s.html;
      wrap.querySelectorAll('[class*="jaf-"]').forEach((e) => e.remove());
      if (imgSrc) wrap.querySelectorAll('j-avatar [data-img_id] img, j-avatar [data-img_id] source, .profile-avatar img, .profile-avatar source').forEach((e) => { if (e.tagName === 'SOURCE') e.setAttribute('srcset', imgSrc); else { e.src = imgSrc; e.removeAttribute('data-src'); } });
      wrap.querySelectorAll('main.profile-container').forEach((m) => m.classList.add('jaf-fl-tpl'));
    } else {
      const sub = ext && !p.wasJoy ? '<span style="font-size:11px;border:1px solid currentColor;border-radius:8px;padding:0 6px;opacity:.75">extern</span>' : '';
      wrap.innerHTML = flTplProfile(d, imgSrc, { editable, archive: !!s, subline: sub });
    }
    // Fickliste-Block oben in der Badge-Liste
    const list = wrap.querySelector('j-list.profile-sidebar-container__badge-list');
    const blk = flBlockEl(p, { plus: !s });
    blk.classList.add('jaf-fl-vblock');
    if (list) list.prepend(blk); else (wrap.querySelector('aside') || wrap).prepend(blk);
    if (editable) {
      wrap.querySelectorAll('.jaf-fl-pen').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); flExtEdit(flGet(pid), b.getAttribute('data-a')); }));
      const av = wrap.querySelector('.jaf-fl-avatar');
      if (av) av.addEventListener('click', (e) => { e.preventDefault(); flExtEdit(flGet(pid), 'img'); });
      if (!p.wasJoy) {
        const lk = flBtn('Mit JOYclub-Profil verknüpfen', () => flLinkJoy(flGet(pid)));
        lk.style.margin = '16px 0';
        (wrap.querySelector('aside') || wrap).appendChild(lk);
      }
    }
    // aktive Inhalte einer Kopie → echtes Profil bzw. Hinweis
    if (!wrap.__jafBound) {
      wrap.__jafBound = true;
      wrap.addEventListener('click', (ev) => {
        if (!flArchivParam() && flIsExt(flViewerPid())) return;
        const path = ev.composedPath();
        if (path.some((e) => e && e.classList && (e.classList.contains('jaf-fl-wrap') || e.classList.contains('jaf-fl-block') || e.classList.contains('jaf-fl-pen') || e.id === 'jaf-fl-dd'))) return;
        const act = path.find((e) => e && e.nodeType === 1 && (e.tagName === 'A' || e.tagName === 'BUTTON' || /^J-(BUTTON|CONTROL-BUTTON|CONTEXT-MENU|A|PILL|LINK|TAG)/.test(e.tagName)));
        if (!act) return;
        ev.preventDefault(); ev.stopPropagation();
        const q = flGet(flViewerPid());
        if (!q) return;
        if (flDead(q) || flIsExt(q.id)) { flDeadPopup(q); return; }
        const href = act.getAttribute && act.getAttribute('href');
        if (href && !/^#|javascript:/.test(href) && idOf(href) !== q.id) location.href = new URL(href, location.origin).href;
        else location.href = flLiveUrl(q, false);
      }, true);
    }
    if (s && (flDead(p) || (ext && !wrap.__deadShown))) { wrap.__deadShown = true; if (flDead(p)) flDeadPopup(p); }
    if (!s && flDead(p) && !wrap.__deadShown) { wrap.__deadShown = true; flDeadPopup(p); }
    if (ssGet('jaf_flnav') === pid) flShowNav(p, s ? s.ts : 0);
    document.title = `${p.nick || ''}${s ? ` · Profil-Archiv ${fmtDT(s.ts)}` : ''} – JOYclub`;
  }

  // ---- Reparatur: Nicks aus Profil-Links ohne Nick („html“) ----
  let flNickFixBusy = false;
  async function flFixNicks() {
    if (flNickFixBusy) return;
    const bad = Object.values(getFl()).filter((q) => !flIsExt(q.id) && (/^html$/i.test(q.nick || '') || q.nickGuess || !q.nick || q.nick === q.id) && !(q.nickTry > Date.now() - 864e5));
    if (!bad.length) return;
    flNickFixBusy = true;
    try {
      for (const q0 of bad.slice(0, 3)) {
        const r = await flResolveProfile(q0.id, /\.html$/.test(q0.path || '') && !/\/\d+\.html$/.test(q0.path) ? q0.path : '');
        const q = flGet(q0.id); if (!q) continue;
        q.nickTry = Date.now();
        if (!r.guess) { if (q.nick !== r.nick) flHist(q, `Nick ergänzt: ${r.nick}`); q.nick = r.nick; if (r.path) q.path = r.path; if (!q.type && r.type) q.type = r.type; delete q.nickGuess; }
        else if (/^html$/i.test(q.nick || '')) { q.nick = r.nick; q.nickGuess = true; }
        flPut(q);
      }
    } finally { flNickFixBusy = false; }
  }

  // ---- Takt: alle Fickliste-Teile ----
  let flVisitDone = '';
  function flTick() {
    const on = ownNick(); if (on && on !== GM_getValue('jaf_own_nick', '')) GM_setValue('jaf_own_nick', on);
    flSaveEventPage();
    flEditNav();
    if (flOverviewPage() && !document.querySelector('.jaf-fl-page') && document.getElementById('c')) flRenderOverview();
    // eigener Profilpfad (Träger der Fickliste-Ansichten)
    const ub = document.querySelector('.navigation_user_box a[href*="/profile/"]');
    if (ub) { const op = new URL(ub.href, location.origin).pathname; if (op !== GM_getValue('jaf_own_path', '')) GM_setValue('jaf_own_path', op); }
    // alte Adressen der externen Seiten → Ansicht auf dem eigenen Profil
    if (flExternPage() && flOwnPath()) { location.replace(flCarrierUrl('x-' + flExternSlug(), flArchivParam(), /[?&]flnav=1/.test(location.search) || flNavOn('x-' + flExternSlug()))); return; }
    if (flViewerPid()) { flViewerRender(); flInsertButtons(); }
    flOwnPills();
    flOwnBox();
    if (isProfilePage() && !isOwnProfile()) {
      const pid = idOf(location.pathname);
      if (pid && !flGet(pid) && window.__jafAdopt !== pid && profileAges().length) {
        window.__jafAdopt = pid;
        try { const nk = ((document.querySelector('.profile-base-info__user-name') || {}).textContent || '').trim() || ((parseProfileDoc(document) || {}).name || ''); flAdoptScan(pid, nk, cleanPath(location.pathname)); } catch (e) { /* egal */ }
      }
      if (flArchivParam()) {
        // Archivstände werden auf dem eigenen Profil im JOYclub-Design gezeigt
        if (flGet(pid) && flOwnPath()) { location.replace(flCarrierUrl(pid, flArchivParam(), /[?&]flnav=1/.test(location.search) || flNavOn(pid))); return; }
      } else {
        flInsertButtons();
        flProfileBlock();
        const p = flGet(pid);
        // Profil nicht (mehr) erreichbar → als gelöscht vermerken und das Archiv zeigen
        if (p && !document.querySelector('main.profile-container, .profile-base-info__line-2') && !/♥/.test(document.title)) {
          window.__jafFlMiss = (window.__jafFlMiss || 0) + 1;
          if (window.__jafFlMiss === 5) {
            if (p.live !== 'dead') flSetLive(p, 'dead', 'Profil nicht erreichbar');
            if (flStands(pid).length) { location.replace(flArchiveUrl(flGet(pid), 0, flNavOn(pid) || /[?&]flnav=1/.test(location.search))); return; }
            flDeadPopup(p);
          }
        } else window.__jafFlMiss = 0;
        if (p) {
          if (/[?&]flnav=1/.test(location.search)) ssSet('jaf_flnav', pid);
          if (flNavOn(pid) && !document.getElementById('jaf-fl-nav')) flShowNav(p, 0);
          // Besuch: neuer Archiv-Stand bei Änderungen; Profil lebt
          const key = location.pathname + location.search;
          if (flVisitDone !== key && profileAges().length) {
            flVisitDone = key;
            setTimeout(async () => {
              try {
                const q = flGet(pid);
                if (q && q.live && q.live !== 'ok') flSetLive(q, 'ok', 'Profil aufgerufen');
                await flSnapshot(pid, '', false);
              } catch (e) { console.warn('[Alter-Filter] Fickliste-Archiv', e); }
            }, 2500);
          }
        }
      }
    }
    flDecorateCards();
    flEventTab();
    flFixNicks().catch(() => {});
    if (!window.__jafAdoptAll) { window.__jafAdoptAll = true; try { flAdoptScan(); } catch (e) { /* egal */ } }
    if (/^\/clubmail\//.test(location.pathname)) flClubMail();
  }
  if (!IN_FRAME) setInterval(() => { try { flTick(); } catch (e) { console.warn('[Alter-Filter] Fickliste', e); } }, 1500);

  // ---------- Start ----------
  // eigene Region: auf dem eigenen Profil lesen, sonst höchstens einmal täglich im Hintergrund
  async function regionInit() {
    try {
      if (isOwnProfile()) { const pl = await waitFor(() => profilePlace(), 6000); if (pl) setOwnRegion(pl); return; }
      const r = regionRec();
      const id = sessionId();
      if (!id || (r.region && Date.now() - (r.ts || 0) < 7 * 864e5) || Date.now() - (gmGet('jaf_region_try', 0) || 0) < 864e5) return;
      gmSet('jaf_region_try', Date.now());
      const doc = await fetchDoc(`${location.origin}/profile/${id}.html`);
      const pl = profilePlace(doc); if (pl) setOwnRegion(pl);
    } catch (e) { /* egal */ }
  }
  async function init() {
    detectOwnType();
    regionInit();
    await storeMigrationInit();
    if (await topGate()) return;
    autoWhiteInit();
    if (isSettingsPage()) { await waitFor(() => document.getElementById('c'), 10000); renderSettingsPage(); }
    await peekInit();
    if (await noteJobInit()) return;
    if (await opaInit()) return;
    if (await evInit()) return;
    const st = getState();
    if (st.running && st.mode === 'ignoreliste') {
      const stale = !st.ts || Date.now() - st.ts > 3 * 60 * 1000;
      if (isIgnorePage() && !stale) {
        if (lockedByOther()) { panel(); log(lockNotice(lockedByOther())); return; }
        await acquireLock('Ignorieren'); processIgnorePage(); return;
      }
      if (!stale && !currentListPage()) return;
      if (lockedByOther()) return; // ein anderer Tab arbeitet – nicht zurücksetzen
      resetState();
      if (currentListPage()) setTimeout(() => log('Alter, unterbrochener Lauf wurde zurückgesetzt.'), 3000);
    } else if (st.running) {
      const stale = !st.ts || Date.now() - st.ts > 3 * 60 * 1000;
      const expected = st.queue && st.queue[0] && (cleanPath(location.pathname) === st.queue[0].path || idOf(location.pathname) === idOf(st.queue[0].path));
      if (isProfilePage() && expected && !stale) {
        if (lockedByOther()) { panel(); log(lockNotice(lockedByOther())); return; }
        await acquireLock('Ignorieren'); processQueue(); return;
      }
      // Dieser Tab arbeitet den Lauf ab, landet aber nicht auf dem erwarteten Profil
      // (z. B. Weiterleitung, kein echtes Mitgliederprofil) → Eintrag überspringen statt hängen zu bleiben
      if (!stale && ownsLock() && st.queue && st.queue.length && !(isProfilePage() && expected)) {
        const cur = st.queue.shift(); st.count = (st.count || 0) + 1;
        const p = panel(); p.innerHTML = '<b>Alter-Filter</b><br>';
        log(`${cur.name || cur.path}: kein (erreichbares) Mitgliederprofil – übersprungen.`);
        if (cur.path) setFailed(cur.path, 'kein erreichbares Mitgliederprofil');
        await sleep(1500);
        if (!st.queue.length) { setState({ running: false, queue: [], count: 0, done: true }); location.href = st.returnUrl || location.origin + '/member/'; }
        else { setState(st); location.href = location.origin + st.queue[0].path; }
        return;
      }
      if (isProfilePage() && !stale) return; // fremde Profilseite während eines Laufs: nichts tun
      if (lockedByOther()) return; // ein anderer Tab arbeitet – nicht zurücksetzen
      // hängengebliebener Lauf (z. B. Skript während des Laufs aktualisiert) → zurücksetzen
      resetState();
      if (currentListPage()) setTimeout(() => log('Alter, unterbrochener Lauf wurde zurückgesetzt.'), 3000);
    }
    if (isIgnorePage()) {
      // Ignorierliste ohne laufenden Durchgang: abgleichen + Export anbieten
      await waitFor(ignoreInput, 8000);
      const list = parseIgnoreList(document);
      saveIgnored(list);
      const p = panel();
      p.innerHTML = '<b>Alter-Filter</b> – Ignorierliste<br>';
      log(`${Object.keys(list).length} Mitglieder auf der Ignorierliste, ${getDone().length} vom Skript ignoriert.`);
      insertSyncButton();
      if (!window.__jafSyncTimer) window.__jafSyncTimer = setInterval(() => { if (isIgnorePage()) insertSyncButton(); }, 2000);
      return;
    }
    const el = document.getElementById('jaf-panel'); if (el && !el.querySelector('button')) el.remove();
  }

  // im Hintergrund-Frame nur die Gästeliste laden – sonst nichts
  if (BG_FRAME) { bgFrameDispatch(); return; }

  try {
    GM_registerMenuCommand('Alter-Filter: Alle Daten sichern (JSON)', () => downloadBackup());
    GM_registerMenuCommand('Alter-Filter: Alle Daten wiederherstellen (JSON)', () => restoreBackup());
    GM_registerMenuCommand('Alter-Filter: Fremde Datensicherung importieren (mischen)', () => importForeignBackup());
    // nur zur Fehlersuche (nicht in der Sicherung, werden später entfernt)
    GM_registerMenuCommand('Alter-Filter: Unbekannte Profiltypen exportieren (CSV)', () => exportTypes());
    GM_registerMenuCommand('Alter-Filter: Online-Angaben exportieren (CSV)', () => exportOnlineTexts());
    GM_registerMenuCommand('Alter-Filter: Fehlschläge des Party-Scans exportieren (CSV)', () => exportEvFailures());
    GM_registerMenuCommand('Alter-Filter: Paare mit nur einer Altersangabe exportieren (CSV)', () => exportMsSingleCouples());
    GM_registerMenuCommand('Alter-Filter: Fehlschläge der Mitgliedersuche exportieren (CSV)', () => exportMsFailures());
    GM_registerMenuCommand(opaT('Alter-Filter: Einstellungen (Opa-Schutz) öffnen'), () => { location.href = settingsUrl(); });
    GM_registerMenuCommand('Alter-Filter: Fehlschläge des Party-Scans löschen', () => { gmSet(K_EVFAIL, []); alert('Fehlschlag-Liste gelöscht.'); });
    GM_registerMenuCommand('Alter-Filter: Partys beim nächsten Scan vollständig prüfen', () => {
      const m = getEvents(); for (const e of Object.values(m)) { delete e.seen; delete e.seenRules; } gmSet(K_EVENTS, m);
      alert('Gemerkte Anmeldungen gelöscht – der nächste Party-Scan prüft wieder alle Gäste.');
    });
    GM_registerMenuCommand('Alter-Filter: Erledigt-Liste leeren', () => {
      if (!confirm('Liste der vom Skript ignorierten Mitglieder (inkl. Datum/Uhrzeit, Quelle) wirklich löschen?\nVorher über „Alle Daten sichern“ sichern!')) return;
      gmSet(K_LOG, {}); gmSet(K_DONE, []); gmSet(K_FAILED, {}); alert('Erledigt-Liste geleert.');
    });
    GM_registerMenuCommand('Alter-Filter: Fehlschläge leeren', () => {
      if (!confirm('Alle gespeicherten Fehlschläge (Profile, Party-Scan, Mitgliedersuche) löschen?')) return;
      gmSet(K_FAILED, {}); gmSet(K_EVFAIL, []); gmSet(K_MS_FAIL, []); alert('Fehlschläge geleert.');
    });
    GM_registerMenuCommand('Alter-Filter: Typen-Info leeren', () => {
      if (!confirm('Gesammelte Infos zu anderen Profiltypen löschen?')) return;
      gmSet(K_TYPES, {}); alert('Typen-Info geleert.');
    });
    GM_registerMenuCommand('Alter-Filter: Lauf zurücksetzen', () => { resetAll(); alert('Alle laufenden Vorgänge und die Tab-Sperre wurden zurückgesetzt. Seite wird neu geladen.'); location.reload(); });
  } catch (e) { /* ältere Tampermonkey-Version */ }

  // Sperre erneuern, solange dieser Tab arbeitet; sonst freigeben
  setInterval(() => {
    const l = getLock();
    if (!l || l.owner !== TAB_ID) return;
    const st = getState();
    // nur frische Läufe zählen – ein liegengebliebener „running“-Zustand darf die Sperre nicht ewig festhalten
    const fresh = (x, ms) => x && x.running && x.ts && Date.now() - x.ts < ms;
    const busy = loading || window.__jafBgBusy || fresh(st, 3 * 60 * 1000) || fresh(getOpa(), 10 * 60 * 1000) || fresh(getEv(), 10 * 60 * 1000);
    if (busy) {
      gmSet(K_LOCK, Object.assign(l, { ts: Date.now(), url: location.href }));
      const vr = visRun(); if (vr) gmSet(K_VIS_RUN, Object.assign(vr, { ts: Date.now() })); // Lebenszeichen für die Sichtbarkeits-Wache
    }
    else releaseLock();
  }, 5000);

  // Notfall: alle Läufe (Suche, Gruppen- und Party-Scan), Sperre und Einmal-Ansichten zurücksetzen – Listen bleiben erhalten
  function resetAll() {
    resetState();
    gmSet(K_OPA, Object.assign(getOpa(), { running: false }));
    gmSet(K_EVSCAN, Object.assign(getEv(), { running: false }));
    gmSet(K_LOCK, null);
  }

  // Fehler beim Start sichtbar machen statt still zu scheitern
  async function safeInit() {
    try { await init(); } catch (e) {
      console.error('[Alter-Filter] Fehler beim Start', e);
      try {
        const p = panel();
        p.innerHTML = '<b>Alter-Filter – Fehler</b><br>';
        p.appendChild(btn('Alles zurücksetzen', () => { resetAll(); location.reload(); }));
        log(`${e && e.message ? e.message : e}\n(Details in der Browser-Konsole, F12)`);
      } catch (e2) { /* nichts mehr zu tun */ }
    }
  }

  // hängengebliebene Zustände (z. B. nach Stopp + Skript-Update) nicht ewig als „läuft“ werten
  (function cleanupStale() {
    const st = getState();
    if (st.running && (!st.ts || Date.now() - st.ts > 10 * 60 * 1000)) resetState();
    const o = getOpa(); if (o.running && opaStale(o) && o.phase !== 'ignore' && !getState().running) { /* bleibt: wird auf /groups/ zum Fortsetzen angeboten */ }
    const l = getLock(); if (l && Date.now() - l.ts > LOCK_TTL) gmSet(K_LOCK, null);
  })();

  // einmalig: Links der Whitelist-Mitglieder aus bereits bekannten Konten übernehmen
  try {
    const wl = whiteList();
    for (const [path, r] of Object.entries(getAccounts())) if (r.name && wl.includes(norm(r.name))) learnWhiteUrl(r.name, path);
  } catch (e) { /* egal */ }

  // =====================================================================
  // ---------- Textvorlagen (ClubMail › Optionen › Textvorlagen) ----------
  // Daten über JOYclubs Schnittstelle apiv2 /users/<id>/notes (Liste, Ändern; Anlegen/Löschen nach REST-Muster).
  // Zusatzangaben je Vorlage (feste Kennung, zuletzt bearbeitet am/auf, Stand beim letzten Abgleich) und ein
  // Papierkorb (30 Tage) liegen nur im Skript-Speicher. Export/Import (Datei oder Zwischenablage, mit dem Nick
  // verschlüsselt) für die Sicherung, das Zweitkonto und den Abgleich mit poppen.de; Smileys werden dabei übersetzt
  // und beim Vergleichen nicht mitgezählt. Termine-Bereich im Bearbeiten-Fenster (Name enthält „Termin“).
  // =====================================================================
  // Smiley-Zuordnung JOYclub ↔ poppen.de (Stand 25.10.2026, mit dem Nutzer abgestimmt)
  const SM_P2J = {":jumping:":"*freu2*",":hearts_around:":"*liebhab*",":heart_eyes:":"*love5*",":coffee_morning:":"*kaffee*",":coffee_happy:":"*kaffee*",":dr_love:":"*schwester*",":confused:":":/",":D":":D",":smiley:":"*gg*",":)":":)",":relaxed:":"*smile*","9_9":"☺",";)":";)",":x":"*love5*",":kissing_heart:":"*kuss3*",":kissing_closed_eyes:":"*knutsch*",":kissing:":"*floet*",":kissing_smiling_eyes:":"*bussi*",":P":":P",":stuck_out_tongue_closed_eyes:":"😝",":stuck_out_tongue:":"*aetsch*",":flushed:":":oops:",":grin:":"*grins*",":pensive:":"*traurig*",":relieved:":"*stolzbin*","¬¬":"*pueh*",":(":":(",":persevere:":"😣",":cry:":":cry:",":joy:":"*traenenlach*",":sob:":"*heul*",":sleepy:":"😪",":disappointed_relieved:":"😥",":cold_sweat:":"*angsthab*",":sweat_smile:":"*puh*",":sweat:":"*schwitz*",":weary:":"*3tagewach*",":tired_face:":"😫",":fearful:":"*panik*",":scream:":":shock:",">:(":":x",":rage:":"*gr3*",":triumph:":"*motz*",":confounded:":"*uah*","xD":"*xd*",":yum:":"😋",":mask:":"*mundschutz*","B|":"8)",":sleeping:":"*heia*",":dizzy_face:":"*umfall*",":astonished:":"*wow*",":worried:":"😟","o.O":"😦","-_-":"😧",":smiling_imp:":":twisted:",":imp:":":evil:",":o":":o",":grimacing:":"*grimasse*",":-/":":/","O.o":":?",":hushed:":"*oh2*",":no_mouth:":"😶","(A)":"*engel*",":smirk:":"*selbstgefall*",":|":":|",":man_with_gua_pi_mao:":"👲",":man_with_turban:":"👳",":cop:":"*polizei*",":construction_worker:":"*bauarbeiter*",":guardsman:":"💂",":baby:":"*baby*",":boy:":"👦",":girl:":"👧",":man:":"👨",":woman:":"👩",":older_man:":"*opa*",":older_woman:":"*oma*",":person_with_blond_hair:":"👱",":angel:":"*engel2*",":princess:":"*koenigin*",":smiley_cat:":"😺",":smile_cat:":"😸",":heart_eyes_cat:":"😻",":kissing_cat:":"😽",":smirk_cat:":"😼",":scream_cat:":"🙀",":crying_cat_face:":"😿",":joy_cat:":"😹",":pouting_cat:":"😾",":japanese_ogre:":"👹",":japanese_goblin:":"👺",":see_no_evil:":"*augenzu*",":hear_no_evil:":"🙉",":speak_no_evil:":"🙊",":skull:":"💀",":alien:":"👽",":poop:":"💩",":fire:":"🔥",":sparkles:":"✨",":star2:":"🌟",":dizzy:":"*sternchen*",":boom:":"💥",":anger:":"💢",":sweat_drops:":"💦",":droplet:":"💧",":zzz:":"*zzz*",":dash:":"💨",":ear:":"👂",":eyes:":"*spanner*",":nose:":"👃",":tongue:":"*schleck*",":lips:":"👄",":thumbsup:":"*top*",":thumbsdown:":"*flop*",":ok_hand:":"*spitze*",":punch:":"👊",":fist:":"✊",":v:":"*victory*",":wave:":"*wink*",":raised_hand:":"✋",":open_hands:":"👐",":point_up_2:":"👆",":point_down:":"👇",":point_right:":"👉",":point_left:":"👈",":raised_hands:":"*hi5*",":pray:":"*danke*",":point_up:":"☝",":clap:":"*bravo*",":muscle:":"*pumpi*",":walking:":"🚶",":runner:":"🏃",":dancer:":"*dance*",":couple:":"*friends*",":family:":"👪",":two_men_holding_hands:":"👬",":two_women_holding_hands:":"👭",":couplekiss:":"💏",":couple_with_heart:":"💑",":dancers:":"👯",":ok_woman:":"🙆",":no_good:":"🙅",":information_desk_person:":"💁",":raising_hand:":"*meld*",":massage:":"💆",":haircut:":"💇",":nail_care:":"💅",":bride_with_veil:":"👰",":person_with_pouting_face:":"🙎",":person_frowning:":"🙍",":bow:":"*anbet*",":tophat:":"*hutab*",":crown:":"*koenig*",":womans_hat:":"👒",":athletic_shoe:":"👟",":mans_shoe:":"👞",":sandal:":"👡",":high_heel:":"👠",":boot:":"👢",":shirt:":"👕",":necktie:":"👔",":womans_clothes:":"👚",":dress:":"👗",":running_shirt_with_sash:":"🎽",":jeans:":"👖",":kimono:":"👘",":bikini:":"👙",":briefcase:":"💼",":handbag:":"👜",":pouch:":"👝",":purse:":"👛",":eyeglasses:":"👓",":ribbon:":"🎀",":closed_umbrella:":"🌂",":lipstick:":"💄",":yellow_heart:":"💛",":blue_heart:":"💙",":purple_heart:":"💜",":green_heart:":"💚",":heart:":"*herz*",":broken_heart:":"*liebeskummer*",":heartpulse:":"*herz3*",":heartbeat:":"💓",":two_hearts:":"*herz2*",":sparkling_heart:":"*herz4*",":revolving_hearts:":"💞",":cupid:":"💘",":love_letter:":"💌",":kiss:":"*kuss2*",":ring:":"💍",":gem:":"💎",":bust_in_silhouette:":"👤",":busts_in_silhouette:":"👥",":speech_balloon:":"*blabla*",":footprints:":"👣",":thought_balloon:":"💭",":poppen:":"*pimper*",":poppen-1:":"*popp*",":suckmy:":"*blowjob*",":lick:":"*schleck*",":handcuffs:":"*fessel*",":vibrator:":"*sextoy*",":whipping:":"*peitsche*",":crazy:":"*crazy*",":cum:":"💦",":bed:":"*popp*",":ass:":"*arsch*",":pussy:":"🍯",":stocking:":"*hothips*",":safesex:":"*kondom*",":cock:":"🍆",":tits:":"*titten*",":banana:":"🍌",":bananarama:":"*bananen*",":spermatozoon:":"💦",":threesome:":"*ffm*",":fucku:":"🖕",":urock:":"*headbang*",":wdrop:":"💧",":ydrop:":"💧",":wdrops:":"💦",":ydrops:":"💦",":bdrops:":"💦",":dog:":"*hund*",":wolf:":"*wolf*",":cat:":"*katze*",":mouse:":"🐭",":hamster:":"*hamster*",":rabbit:":"🐰",":frog:":"🐸",":tiger:":"🐯",":koala:":"🐨",":bear:":"🐻",":pig:":"*schwein*",":pig_nose:":"🐽",":cow:":"*kuh*",":boar:":"🐗",":monkey_face:":"🐵",":monkey:":"🐒",":horse:":"🐴",":sheep:":"🐑",":elephant:":"🐘",":panda_face:":"🐼",":penguin:":"🐧",":bird:":"🐦",":baby_chick:":"🐤",":hatched_chick:":"🐥",":hatching_chick:":"🐣",":chicken:":"*huhn*",":snake:":"🐍",":turtle:":"🐢",":bug:":"*bug*",":bee:":"🐝",":ant:":"🐜",":beetle:":"🐞",":snail:":"*schnecke*",":octopus:":"🐙",":shell:":"🐚",":tropical_fish:":"🐠",":fish:":"🐟",":dolphin:":"🐬",":whale:":"🐳",":whale2:":"🐋",":cow2:":"🐄",":ram:":"🐏",":rat:":"🐀",":water_buffalo:":"🐃",":tiger2:":"🐅",":rabbit2:":"🐇",":dragon:":"🐉",":racehorse:":"🐎",":goat:":"🐐",":rooster:":"🐓",":dog2:":"🐕",":pig2:":"🐖",":mouse2:":"🐁",":ox:":"🐂",":dragon_face:":"🐲",":blowfish:":"🐡",":crocodile:":"🐊",":camel:":"🐫",":dromedary_camel:":"🐪",":leopard:":"🐆",":cat2:":"🐈",":poodle:":"🐩",":feet:":"🐾",":bouquet:":"*blumenschenk*",":cherry_blossom:":"🌸",":tulip:":"*blume2*",":four_leaf_clover:":"*vielglueck*",":rose:":"*blume*",":sunflower:":"🌻",":hibiscus:":"🌺",":maple_leaf:":"🍁",":leaves:":"🍃",":fallen_leaf:":"🍂",":herb:":"🌿",":ear_of_rice:":"🌾",":mushroom:":"🍄",":cactus:":"🌵",":palm_tree:":"🌴",":evergreen_tree:":"🌲",":deciduous_tree:":"🌳",":chestnut:":"🌰",":seedling:":"🌱",":blossom:":"*blumezupf*",":globe_with_meridians:":"🌐",":sun_with_face:":"🌞",":full_moon_with_face:":"🌝",":new_moon_with_face:":"🌚",":new_moon:":"🌑",":waxing_crescent_moon:":"🌒",":first_quarter_moon:":"🌓",":waxing_gibbous_moon:":"🌔",":full_moon:":"🌕",":waning_gibbous_moon:":"🌖",":last_quarter_moon:":"🌗",":waning_crescent_moon:":"🌘",":last_quarter_moon_with_face:":"🌜",":first_quarter_moon_with_face:":"🌛",":crescent_moon:":"🌙",":earth_africa:":"🌍",":earth_americas:":"🌎",":earth_asia:":"🌏",":volcano:":"🌋",":milky_way:":"🌌",":stars:":"🌠",":star:":"⭐",":sunny:":"*sonne*",":partly_sunny:":"⛅",":cloud:":"☁",":zap:":"⚡",":umbrella:":"*regen*",":snowflake:":"❄",":snowman:":"⛄",":cyclone:":"🌀",":foggy:":"🌁",":rainbow:":"*regenbogen*",":ocean:":"🌊",":bamboo:":"🎍",":gift_heart:":"💝",":dolls:":"🎎",":school_satchel:":"🎒",":mortar_board:":"🎓",":flags:":"🎏",":fireworks:":"*feuerwerk*",":sparkler:":"🎇",":wind_chime:":"🎐",":rice_scene:":"🎑",":jack_o_lantern:":"🎃",":ghost:":"👻",":santa:":"*nikolaus*",":christmas_tree:":"🎄",":gift:":"*geschenk*",":tanabata_tree:":"🎋",":tada:":"*troet*",":confetti_ball:":"🎊",":balloon:":"🎈",":crossed_flags:":"🎌",":crystal_ball:":"*wahrsager*",":movie_camera:":"*film*",":camera:":"*knips*",":video_camera:":"📹",":vhs:":"📼",":cd:":"💿",":dvd:":"📀",":minidisc:":"💽",":floppy_disk:":"💾",":computer:":"*tipp*",":iphone:":"📱",":telephone:":"☎",":telephone_receiver:":"*tel*",":pager:":"📟",":fax:":"📠",":satellite:":"📡",":tv:":"📺",":radio:":"📻",":loud_sound:":"🔊",":sound:":"🔉",":speaker:":"🔈",":mute:":"🔇",":bell:":"🔔",":no_bell:":"🔕",":loudspeaker:":"*megaphon*",":mega:":"📣",":hourglass_flowing_sand:":"⏳",":hourglass:":"⌛",":alarm_clock:":"⏰",":watch:":"⌚",":unlock:":"🔓",":lock:":"🔒",":lock_with_ink_pen:":"🔏",":closed_lock_with_key:":"🔐",":key:":"🔑",":mag_right:":"🔎",":bulb:":":idea:",":flashlight:":"🔦",":high_brightness:":"🔆",":low_brightness:":"🔅",":electric_plug:":"🔌",":battery:":"🔋",":mag:":"🔍",":bathtub:":"🛁",":bath:":"🛀",":shower:":"*duschen*",":toilet:":"*wc*",":wrench:":"🔧",":nut_and_bolt:":"🔩",":hammer:":"🔨",":door:":"🚪",":smoking:":"*zig*",":bomb:":"💣",":gun:":"🔫",":knife:":"🔪",":pill:":"*aspirin*",":syringe:":"💉",":moneybag:":"💰",":yen:":"💴",":dollar:":"💵",":pound:":"💷",":euro:":"💶",":credit_card:":"💳",":money_with_wings:":"💸",":calling:":"📲",":e-mail:":"📧",":inbox_tray:":"📥",":outbox_tray:":"📤",":envelope:":"*mail*",":envelope_with_arrow:":"📩",":incoming_envelope:":"📨",":postal_horn:":"📯",":mailbox:":"📫",":mailbox_closed:":"📪",":mailbox_with_mail:":"📬",":mailbox_with_no_mail:":"📭",":postbox:":"📮",":package:":"📦",":pencil:":"📝",":page_facing_up:":"📄",":page_with_curl:":"📃",":bookmark_tabs:":"📑",":bar_chart:":"📊",":chart_with_upwards_trend:":"📈",":chart_with_downwards_trend:":"📉",":scroll:":"📜",":clipboard:":"📋",":date:":"📅",":calendar:":"📆",":card_index:":"📇",":file_folder:":"📁",":open_file_folder:":"📂",":scissors:":"✂",":pushpin:":"📌",":paperclip:":"📎",":black_nib:":"✒",":pencil2:":"✏",":straight_ruler:":"📏",":triangular_ruler:":"📐",":closed_book:":"📕",":green_book:":"📗",":blue_book:":"📘",":orange_book:":"📙",":notebook:":"📓",":notebook_with_decorative_cover:":"📔",":ledger:":"📒",":books:":"📚",":book:":"📖",":bookmark:":"🔖",":name_badge:":"📛",":microscope:":"🔬",":telescope:":"*fernglas*",":newspaper:":"*les*",":art:":"*maler*",":clapper:":"🎬",":microphone:":"*osolemio*",":headphones:":"*dj*",":musical_score:":"🎼",":musical_note:":"🎵",":notes:":"*lalala*",":musical_keyboard:":"*piano*",":violin:":"🎻",":trumpet:":"🎺",":saxophone:":"🎷",":guitar:":"*rock*",":space_invader:":"👾",":video_game:":"*zocker*",":black_joker:":"🃏",":flower_playing_cards:":"🎴",":mahjong:":"🀄",":game_die:":"🎲",":dart:":"🎯",":football:":"🏈",":basketball:":"🏀",":soccer:":"*fussball*",":baseball:":"⚾",":tennis:":"🎾",":8ball:":"🎱",":rugby_football:":"🏉",":bowling:":"🎳",":golf:":"⛳",":mountain_bicyclist:":"🚵",":bicyclist:":"🚴",":checkered_flag:":"🏁",":horse_racing:":"🏇",":trophy:":"🏆",":ski:":"🎿",":snowboarder:":"🏂",":swimmer:":"*tauch*",":surfer:":"🏄",":fishing_pole_and_fish:":"🎣",":coffee:":"*kaffee*",":tea:":"*tee*",":sake:":"🍶",":baby_bottle:":"🍼",":beer:":"*bier*",":beers:":"*prost*",":cocktail:":"*cocktail*",":tropical_drink:":"🍹",":wine_glass:":"*wein*",":fork_and_knife:":"*essen*",":pizza:":"🍕",":hamburger:":"🍔",":fries:":"🍟",":poultry_leg:":"🍗",":meat_on_bone:":"*grill*",":spaghetti:":"🍝",":curry:":"🍛",":fried_shrimp:":"🍤",":bento:":"🍱",":sushi:":"🍣",":fish_cake:":"🍥",":rice_ball:":"🍙",":rice_cracker:":"🍘",":rice:":"🍚",":ramen:":"🍜",":stew:":"🍲",":oden:":"🍢",":dango:":"🍡",":egg:":"🍳",":bread:":"🍞",":doughnut:":"🍩",":custard:":"🍮",":icecream:":"*eis*",":ice_cream:":"🍨",":shaved_ice:":"🍧",":birthday:":"*torte*",":cake:":"🍰",":cookie:":"🍪",":chocolate_bar:":"🍫",":candy:":"🍬",":lollipop:":"*lolli*",":honey_pot:":"🍯",":apple:":"🍎",":green_apple:":"🍏",":tangerine:":"🍊",":lemon:":"🍋",":cherries:":"🍒",":grapes:":"🍇",":watermelon:":"🍉",":strawberry:":"🍓",":peach:":"*arsch*",":melon:":"🍈",":pear:":"🍐",":pineapple:":"🍍",":sweet_potato:":"🍠",":eggplant:":"🍆",":tomato:":"*tomaten*",":corn:":"🌽",":house:":"🏠",":house_with_garden:":"🏡",":school:":"🏫",":office:":"🏢",":post_office:":"🏣",":hospital:":"🏥",":bank:":"🏦",":convenience_store:":"🏪",":love_hotel:":"🏩",":hotel:":"🏨",":wedding:":"*hochzeit*",":church:":"⛪",":department_store:":"🏬",":european_post_office:":"🏤",":city_sunset:":"🌇",":city_dusk:":"🌆",":japanese_castle:":"🏯",":european_castle:":"🏰",":tent:":"⛺",":factory:":"🏭",":tokyo_tower:":"🗼",":japan:":"🗾",":mount_fuji:":"🗻",":sunrise_over_mountains:":"🌄",":sunrise:":"🌅",":night_with_stars:":"🌃",":statue_of_liberty:":"🗽",":bridge_at_night:":"🌉",":carousel_horse:":"🎠",":ferris_wheel:":"🎡",":fountain:":"⛲",":roller_coaster:":"🎢",":ship:":"🚢",":sailboat:":"⛵",":speedboat:":"🚤",":rowboat:":"🚣",":anchor:":"⚓",":rocket:":"🚀",":airplane:":"✈",":seat:":"💺",":helicopter:":"🚁",":steam_locomotive:":"🚂",":tram:":"🚊",":station:":"🚉",":mountain_railway:":"🚞",":train2:":"🚆",":bullettrain_side:":"🚄",":bullettrain_front:":"🚅",":light_rail:":"🚈",":metro:":"🚇",":monorail:":"🚝",":train:":"🚋",":railway_car:":"🚃",":trolleybus:":"🚎",":bus:":"🚌",":oncoming_bus:":"🚍",":blue_car:":"🚙",":oncoming_automobile:":"🚘",":red_car:":"*fahr*",":taxi:":"🚕",":oncoming_taxi:":"🚖",":articulated_lorry:":"🚛",":truck:":"🚚",":rotating_light:":"*alarm*",":police_car:":"🚓",":oncoming_police_car:":"🚔",":fire_engine:":"🚒",":ambulance:":"🚑",":minibus:":"🚐",":bike:":"🚲",":aerial_tramway:":"🚡",":suspension_railway:":"🚟",":mountain_cableway:":"🚠",":tractor:":"🚜",":barber:":"💈",":busstop:":"🚏",":ticket:":"🎫",":vertical_traffic_light:":"🚦",":traffic_light:":"🚥",":warning:":"⚠",":construction:":"🚧",":beginner:":"🔰",":fuelpump:":"⛽",":izakaya_lantern:":"🏮",":slot_machine:":"🎰",":hotsprings:":"♨",":moyai:":"🗿",":circus_tent:":"🎪",":performing_arts:":"🎭",":round_pushpin:":"📍",":triangular_flag_on_post:":"🚩",":cn:":"🇨🇳",":us:":"🇺🇸",":jp:":"🇯🇵",":ru:":"🇷🇺",":de:":"*deutschland*",":gb:":"🇬🇧",":fr:":"🇫🇷",":kr:":"🇰🇷",":it:":"🇮🇹",":es:":"🇪🇸",":no_smoking:":"🚭",":over18:":"🔞",":copyright:":"©",":parking:":"🅿",":wc:":"🚾",":hash:":"#⃣",":one:":"1⃣",":two:":"2⃣",":three:":"3⃣",":four:":"4⃣",":five:":"5⃣",":six:":"6⃣",":seven:":"7⃣",":eight:":"8⃣",":nine:":"9⃣",":zero:":"0⃣",":keycap_ten:":"🔟",":1234:":"🔢",":symbols:":"🔣",":arrow_up:":"⬆",":arrow_down:":"⬇",":arrow_left:":"⬅",":arrow_right:":":arrow:",":capital_abcd:":"🔠",":abcd:":"🔡",":abc:":"🔤",":arrow_upper_right:":"↗",":arrow_upper_left:":"↖",":arrow_lower_right:":"↘",":arrow_lower_left:":"↙",":left_right_arrow:":"↔",":arrow_up_down:":"↕",":arrows_counterclockwise:":"🔄",":arrow_backward:":"◀",":arrow_forward:":"▶",":arrow_up_small:":"🔼",":arrow_down_small:":"🔽",":leftwards_arrow_with_hook:":"↩",":arrow_right_hook:":"↪",":information_source:":"ℹ",":rewind:":"⏪",":fast_forward:":"⏩",":arrow_double_up:":"⏫",":arrow_double_down:":"⏬",":arrow_heading_down:":"⤵",":arrow_heading_up:":"⤴",":ok:":"🆗",":twisted_rightwards_arrows:":"🔀",":repeat:":"🔁",":repeat_one:":"🔂",":new:":"🆕",":up:":"🆙",":cool:":"🆒",":free:":"🆓",":ng:":"🆖",":signal_strength:":"📶",":cinema:":"🎦",":koko:":"🈁",":u6307:":"🈯",":u7a7a:":"🈳",":u6e80:":"🈵",":u5408:":"🈴",":u7981:":"🈲",":ideograph_advantage:":"🉐",":u5272:":"🈹",":u55b6:":"🈺",":u6709:":"🈶",":u7121:":"🈚",":restroom:":"🚻",":mens:":"🚹",":womens:":"🚺",":baby_symbol:":"🚼",":potable_water:":"🚰",":put_litter_in_its_place:":"🚮",":wheelchair:":"♿",":u6708:":"🈷",":u7533:":"🈸",":sa:":"🈂",":m:":"Ⓜ",":passport_control:":"🛂",":baggage_claim:":"🛄",":left_luggage:":"🛅",":customs:":"🛃",":accept:":"🉑",":secret:":"㊙",":congratulations:":"㊗",":cl:":"🆑",":sos:":"*hilfe*",":id:":"🆔",":no_entry_sign:":"🚫",":no_mobile_phones:":"📵",":do_not_litter:":"🚯",":non-potable_water:":"🚱",":no_bicycles:":"🚳",":no_pedestrians:":"🚷",":children_crossing:":"🚸",":no_entry:":"⛔",":eight_spoked_asterisk:":"✳",":sparkle:":"❇",":negative_squared_cross_mark:":"❎",":white_check_mark:":"✅",":eight_pointed_black_star:":"✴",":heart_decoration:":"💟",":vs:":"🆚",":vibration_mode:":"📳",":mobile_phone_off:":"📴",":a:":"🅰",":b:":"🅱",":ab:":"🆎",":o2:":"🅾",":diamond_shape_with_a_dot_inside:":"💠",":loop:":"➿",":recycle:":"♻",":aries:":"♈",":taurus:":"♉",":gemini:":"♊",":cancer:":"♋",":leo:":"♌",":virgo:":"♍",":libra:":"♎",":scorpius:":"♏",":sagittarius:":"♐",":capricorn:":"♑",":aquarius:":"♒",":pisces:":"♓",":ophiuchus:":"⛎",":six_pointed_star:":"🔯",":atm:":"🏧",":chart:":"💹",":heavy_dollar_sign:":"💲",":currency_exchange:":"💱",":registered:":"®",":tm:":"™",":part_alternation_mark:":"〽",":wavy_dash:":"〰",":top:":"🔝",":end:":"🔚",":back:":"🔙",":on:":"🔛",":soon:":"🔜",":x:":"❌",":o:":"⭕",":exclamation:":":!:",":question:":":?:",":grey_exclamation:":"❕",":grey_question:":"❔",":bangbang:":"‼",":interrobang:":"⁉",":arrows_clockwise:":"🔃",":clock12:":"🕛",":clock1230:":"🕧",":clock1:":"🕐",":clock130:":"🕜",":clock2:":"🕑",":clock230:":"🕝",":clock3:":"🕒",":clock330:":"🕞",":clock4:":"🕓",":clock430:":"🕟",":clock5:":"🕔",":clock530:":"🕠",":clock6:":"🕕",":clock7:":"🕖",":clock8:":"🕗",":clock9:":"🕘",":clock10:":"🕙",":clock11:":"🕚",":clock630:":"🕡",":clock730:":"🕢",":clock830:":"🕣",":clock930:":"🕤",":clock1030:":"🕥",":clock1130:":"🕦",":heavy_multiplication_x:":"✖",":heavy_plus_sign:":"➕",":heavy_minus_sign:":"➖",":heavy_division_sign:":"➗",":spades:":"♠",":hearts:":"♥",":clubs:":"♣",":diamonds:":"♦",":white_flower:":"💮",":100:":"*100*",":heavy_check_mark:":"✔",":ballot_box_with_check:":"☑",":radio_button:":"🔘",":link:":"🔗",":curly_loop:":"➰",":trident:":"🔱",":black_square_button:":"🔲",":white_square_button:":"🔳",":black_medium_square:":"◼",":white_medium_square:":"◻",":black_medium_small_square:":"◾",":white_medium_small_square:":"◽",":black_small_square:":"▪",":white_small_square:":"▫",":small_red_triangle:":"🔺",":white_large_square:":"⬜",":black_large_square:":"⬛",":black_circle:":"⚫",":white_circle:":"⚪",":red_circle:":"🔴",":large_blue_circle:":"🔵",":small_red_triangle_down:":"🔻",":large_orange_diamond:":"🔶",":large_blue_diamond:":"🔷",":small_orange_diamond:":"🔸",":small_blue_diamond:":"🔹"};
  const SM_U2J = {"🙏":"*danke*","😀":":)","👍":"*top*","😃":":D","😊":"*smile*","😄":"*gg*","😉":";)","😆":"*xd*","❗":":!:","🚨":"*alarm*","🤗":"*knuddel*","👋":"*wink*","😁":"*grins*","😈":":twisted:","🤣":"*rotfl*","🥳":"*juhu*","😂":"*traenenlach*","😛":"*aetsch*","😜":":P","😏":"*selbstgefall*","🤪":"*goofy*","😮":":o","😯":"*oh2*","😱":":shock:","😨":"*panik*","😵":"*umfall*","😠":":x","👿":":evil:","😡":"*gr3*","🤬":"*gleichplatz*","😖":"*uah*","😤":"*motz*","🤕":"*blauesauge*","😬":"*grimasse*","😞":":(","😢":":cry:","😭":"*heul*","😔":"*traurig*","💔":"*liebeskummer*","😑":":|","🥱":"*gaehn*","💤":"*zzz*","😴":"*heia*","📞":"*tel*","💬":"*blabla*","🎶":"*lalala*","🤐":"*schweig*","🤫":"*fluester*","👎":"*flop*","👏":"*bravo*","👌":"*spitze*","🍅":"*tomaten*","😲":"*wow*","🤤":"*sabber*","🤢":"*umpf*","✌":"*victory*","🙌":"*hi5*","🎩":"*hutab*","💯":"*100*","🤮":"*wuerg*","💊":"*aspirin*","💫":"*sternchen*","😩":"*3tagewach*","🤧":"*schnupfen*","😷":"*mundschutz*","🍴":"*essen*","🍖":"*grill*","🍺":"*bier*","🍦":"*eis*","🍭":"*lolli*","🎂":"*torte*","🧁":"*muffin*","☕":"*kaffee*","🍵":"*tee*","🍷":"*wein*","🍸":"*cocktail*","🦟":"*fliege2*","🥃":"*whiskey*","🍻":"*prost*","🥂":"*cheers*","🍾":"*sekt*","🚬":"*zig*","🎉":"*troet*","💃":"*dance*","🥴":"*hicks*","🤘":"*headbang*","🎆":"*feuerwerk*","😚":"*knutsch*","🥰":"*liebhab*","👫":"*friends*","😙":"*bussi*","💋":"*kuss2*","❤":"*herz*","💕":"*herz2*","💗":"*herz3*","💖":"*herz4*","😍":"*love5*","🌹":"*blume*","🌼":"*blumezupf*","💐":"*blumenschenk*","🌷":"*blume2*","🎁":"*geschenk*","🎤":"*osolemio*","💒":"*hochzeit*","🙇":"*anbet*","😗":"*floet*","🤨":"*skeptisch*","😒":"*pueh*","😌":"*stolzbin*","😎":"8)","😕":":?","🤷":"*nixweiss*","😐":":/","🙄":":roll:","🤔":"*gruebel*","🤦":"*kopfklatsch*","😳":":oops:","😰":"*angsthab*","🙈":"*augenzu*","🍀":"*vielglueck*","💻":"*tipp*","📰":"*les*","✉":"*mail*","🚿":"*duschen*","🚽":"*wc*","😇":"*engel*","👼":"*engel2*","🚗":"*fahr*","📷":"*knips*","🎥":"*film*","🙋":"*meld*","🍿":"*popcorn*","😅":"*puh*","🤡":"*clown*","🎸":"*rock*","🧶":"*strick*","🧹":"*putz*","🏊":"*tauch*","⚽":"*fussball*","👀":"*spanner*","🎮":"*zocker*","📢":"*megaphon*","💪":"*pumpi*","🔭":"*fernglas*","👅":"*schleck*","🍑":"*arsch*","👵":"*oma*","👴":"*opa*","👶":"*baby*","👷":"*bauarbeiter*","👮":"*polizei*","🎨":"*maler*","👑":"*koenig*","👸":"*koenigin*","🎧":"*dj*","🥁":"*drummer*","🎹":"*piano*","🎅":"*nikolaus*","🔮":"*wahrsager*","🐱":"*katze*","🐮":"*kuh*","🐔":"*huhn*","🐷":"*schwein*","🐶":"*hund*","🦋":"*schmetterling*","🐛":"*bug*","🦄":"*einhorn*","🦊":"*fuchs*","🐌":"*schnecke*","🐺":"*wolf*","🐹":"*hamster*","☀":"*sonne*","☔":"*regen*","🥶":"*frier*","😓":"*schwitz*","🌈":"*regenbogen*","➡":":arrow:","❓":":?:","💡":":idea:","🆘":"*hilfe*","🇩🇪":"*deutschland*","🇦🇹":"*oesterreich*","🇨🇭":"*schweiz*","🇳🇱":"*niederlande*","🧑‍⚕":"*schwester*","😘":"*kuss3*"};
  const SM_JOYTOK = ["*kommmalherfreundchen*","*ihrseiddiegroessten*","*featuremonster*","*gehirnschnecke*","*kissenschlacht*","*baerenaufbind*","*computercrash*","*experimentier*","*gutebesserung*","*happybirthday*","*klugscheisser*","*kopfschuettel*","*niedersachsen*","*partnertausch*","*schmetterling*","*werderwachsen*","*blumenschenk*","*cheerleading*","*diegroessten*","*guckstduhier*","*guterbeitrag*","*kammerjaeger*","*kindergarten*","*liebeskummer*","*selbstgefall*","*winterdienst*","*bauarbeiter*","*bitteschoen*","*blumenwiese*","*brandenburg*","*deutschland*","*feinschleif*","*geschlossen*","*gleichplatz*","*haumichwech*","*huebschmach*","*keinproblem*","*kopfklatsch*","*letzteswort*","*niederlande*","*oesterreich*","*spassbremse*","*traenenlach*","*verdaechtig*","*willkommen2*","*zaubertrank*","*arschkneif*","*ballaballa*","*blauesauge*","*freundchen*","*gehbuegeln*","*geheimtipp*","*gelbekarte*","*hackfresse*","*hotsqueeze*","*hotupshirt*","*knackarsch*","*liegestuhl*","*mundschutz*","*musketiere*","*ninjaclown*","*regenbogen*","*roseschenk*","*schiefguck*","*schneeball*","*stammtisch*","*stoesschen*","*thueringen*","*ungeduldig*","*ventilator*","*verfuehren*","*vielglueck*","*waschbrett*","*willkommen*","*3tagewach*","*abgedreht*","*blumezupf*","*feuerwehr*","*feuerwerk*","*fiesgrins*","*gutenacht*","*headcrash*","*hotbanana*","*poledance*","*rheinland*","*rotekarte*","*sarkasmus*","*schleimer*","*schleswig*","*schnupfen*","*schwester*","*skeptisch*","*slipstrip*","*steinwerf*","*sternchen*","*surprised*","*sweetkiss*","*taetschel*","*wahrsager*","*zaunpfahl*","*zufaechel*",":surprised:","*angsthab*","*brueste2*","*cocktail*","*confused*","*duschen2*","*fancycat*","*fernglas*","*fluester*","*fussball*","*geschenk*","*grimasse*","*guckguck*","*guerilla*","*handkuss*","*headbang*","*hochzeit*","*hotboobs*","*hotkiss2*","*hotlady2*","*hotlady3*","*iloveyou*","*knuddel2*","*knutsch2*","*knutsch3*","*knutsch4*","*koenigin*","*kopfkino*","*liebguck*","*megaphon*","*meinheld*","*my2cents*","*nachdenk*","*nikolaus*","*nixweiss*","*offtopic*","*osolemio*","*peitsche*","*popcorn2*","*question*","*raeusper*","*saarland*","*schleck2*","*schleck3*","*schleck4*","*schlumpf*","*schnecke*","*stolzbin*","*superman*","*thankyou*","*zeigpics*","*zumthema*","*zwinker2*",":confused:","*achtung*","*aspirin*","*augenzu*","*bananen*","*blowjob*","*brueste*","*dagegen*","*drummer*","*duschen*","*einhorn*","*exclaim*","*faechel*","*fisting*","*fliege2*","*frieden*","*friends*","*gitarre*","*gruebel*","*hamburg*","*hamster*","*hatschi*","*hochleb*","*hothips*","*hotkiss*","*hotlady*","*joyclub*","*knuddel*","*knutsch*","*kuschel*","*liebhab*","*mrgreen*","*neutral*","*polizei*","*popcorn*","*redface*","*rotwerd*","*sachsen*","*schimpf*","*schleck*","*schmoll*","*schweig*","*schwein*","*schweiz*","*schwitz*","*sixpack*","*spanner*","*tomaten*","*traurig*","*twisted*","*undwech*","*victory*","*welcome*","*whiskey*","*wiegeil*","*zwinker*",":mrgreen:",":neutral:",":redface:",":twisted:","*3affen*","*aetsch*","*anhalt*","*anmach*","*arbeit*","*autsch*","*bandit*","*barbar*","*bayern*","*berlin*","*blabla*","*blume2*","*boogie*","*bremen*","*bussi2*","*cheers*","*crazy2*","*crazy3*","*crazy4*","*crazy5*","*dafuer*","*dance2*","*engel2*","*fessel*","*fliege*","*gaehn2*","*hessen*","*hexhex*","*holmes*","*hotass*","*hotbum*","*hotman*","*imogdi*","*ironie*","*janein*","*kaffee*","*knicks*","*koenig*","*kondom*","*lalala*","*matrix*","*morgen*","*muffin*","*neinja*","*paddle*","*party2*","*pimper*","*pumpi2*","*sabber*","*schaem*","*schock*","*sextoy*","*sexypo*","*snief2*","*snief3*","*spitze*","*streit*","*strick*","*stupid*","*teufel*","*titten*","*troest*","*umfall*","*voting*","*wolke7*","*wuerg2*","*zocker*","*zugabe*","*alarm*","*anbet*","*angel*","*arrow*","*arsch*","*baby2*","*basta*","*biker*","*blume*","*bravo*","*bunny*","*bussi*","*clown*","*cool2*","*crazy*","*dance*","*danke*","*doggy*","*elvis*","*engel*","*essen*","*flenn*","*floet*","*fluch*","*frage*","*freu2*","*frier*","*fuchs*","*gaehn*","*genau*","*goofy*","*grill*","*grins*","*hand2*","*hand3*","*hand4*","*hand5*","*happy*","*heia2*","*herz2*","*herz3*","*herz4*","*heul2*","*hicks*","*hilfe*","*hutab*","*hypno*","*jedi2*","*juchu*","*katze*","*knips*","*kuss2*","*kuss3*","*lolli*","*love2*","*love3*","*love4*","*love5*","*maler*","*modda*","*muede*","*naund*","*neid2*","*ninja*","*panik*","*party*","*pfeil*","*piano*","*pieks*","*pirat*","*prost*","*pumpi*","*regen*","*rotfl*","*sauna*","*shock*","*smile*","*snief*","*sonne*","*sorry*","*spank*","*strip*","*tanz2*","*tauch*","*tonne*","*torte*","*troet*","*troll*","*tuete*","*twist*","*vogel*","*wuerg*",":arrow:",":shock:","*baby*","*baeh*","*beep*","*bier*","*bla2*","*cool*","*date*","*dito*","*evil*","*fahr*","*fans*","*film*","*flop*","*foto*","*freu*","*guru*","*haha*","*hand*","*heia*","*help*","*herz*","*heul*","*hexe*","*hot2*","*hot3*","*huch*","*huhn*","*huhu*","*hund*","*idea*","*idee*","*jedi*","*juhu*","*keks*","*koch*","*kuss*","*lach*","*leck*","*love*","*mail*","*meld*","*motz*","*nase*","*neck*","*neid*","*nein*","*nene*","*next*","*nick*","*nono*","*oede*","*oops*","*pfui*","*popp*","*pueh*","*putz*","*razz*","*rock*","*rofl*","*roll*","*sekt*","*senf*","*sing*","*snob*","*spam*","*tanz*","*tipp*","*top2*","*umpf*","*walk*","*wein*","*wink*","*witz*","*wolf*","*wuah*","*yoda*",":evil:",":idea:",":oops:",":razz:",":roll:",":wink:","*100*","*arg*","*aua*","*bla*","*bug*","*bye*","*cry*","*eis*","*ffm*","*ggg*","*gr2*","*gr3*","*hae*","*hi5*","*hot*","*kuh*","*les*","*lol*","*mmf*","*nrw*","*oh2*","*oh3*","*oh4*","*oha*","*oma*","*omm*","*opa*","*puh*","*sad*","*tee*","*tel*","*top*","*uah*","*wow*","*wua*","*zig*","*zzz*",":cry:",":lol:",":sad:","*bw*","*dd*","*dj*","*gg*","*gr*","*hm*","*ja*","*ko*","*mv*","*oh*","*wc*","*xd*","*yo*","*g*","8-)",":!:",":-(",":-)",":-/",":-D",":-P",":-o",":-|",":?:",";-)","8)",":(",":)",":/",":?",":D",":P",":o",":x",":|",";)"];
  const SM_POPTOK = [":diamond_shape_with_a_dot_inside:",":notebook_with_decorative_cover:",":first_quarter_moon_with_face:",":stuck_out_tongue_closed_eyes:",":last_quarter_moon_with_face:",":negative_squared_cross_mark:",":chart_with_downwards_trend:",":black_medium_small_square:",":leftwards_arrow_with_hook:",":twisted_rightwards_arrows:",":white_medium_small_square:",":chart_with_upwards_trend:",":eight_pointed_black_star:",":person_with_pouting_face:",":arrows_counterclockwise:",":information_desk_person:",":put_litter_in_its_place:",":running_shirt_with_sash:",":small_red_triangle_down:",":triangular_flag_on_post:",":two_women_holding_hands:",":heavy_multiplication_x:",":hourglass_flowing_sand:",":person_with_blond_hair:",":sunrise_over_mountains:",":vertical_traffic_light:",":ballot_box_with_check:",":disappointed_relieved:",":eight_spoked_asterisk:",":fishing_pole_and_fish:",":part_alternation_mark:",":two_men_holding_hands:",":closed_lock_with_key:",":european_post_office:",":flower_playing_cards:",":globe_with_meridians:",":kissing_smiling_eyes:",":large_orange_diamond:",":mailbox_with_no_mail:",":small_orange_diamond:",":waning_crescent_moon:",":waxing_crescent_moon:",":black_medium_square:",":black_square_button:",":busts_in_silhouette:",":construction_worker:",":envelope_with_arrow:",":full_moon_with_face:",":heavy_division_sign:",":ideograph_advantage:",":kissing_closed_eyes:",":man_with_gua_pi_mao:",":oncoming_automobile:",":oncoming_police_car:",":waning_gibbous_moon:",":waxing_gibbous_moon:",":white_medium_square:",":white_square_button:",":arrow_heading_down:",":black_large_square:",":black_small_square:",":bust_in_silhouette:",":first_quarter_moon:",":information_source:",":large_blue_diamond:",":mountain_bicyclist:",":new_moon_with_face:",":small_blue_diamond:",":small_red_triangle:",":suspension_railway:",":telephone_receiver:",":white_large_square:",":white_small_square:",":arrow_double_down:",":arrow_lower_right:",":arrow_upper_right:",":articulated_lorry:",":bullettrain_front:",":children_crossing:",":convenience_store:",":couple_with_heart:",":currency_exchange:",":heavy_dollar_sign:",":house_with_garden:",":incoming_envelope:",":large_blue_circle:",":last_quarter_moon:",":lock_with_ink_pen:",":mailbox_with_mail:",":mountain_cableway:",":non-potable_water:",":statue_of_liberty:",":arrow_down_small:",":arrow_heading_up:",":arrow_lower_left:",":arrow_right_hook:",":arrow_upper_left:",":arrows_clockwise:",":bullettrain_side:",":department_store:",":four_leaf_clover:",":grey_exclamation:",":heart_decoration:",":heavy_check_mark:",":heavy_minus_sign:",":left_right_arrow:",":mobile_phone_off:",":money_with_wings:",":mountain_railway:",":musical_keyboard:",":night_with_stars:",":no_mobile_phones:",":open_file_folder:",":passport_control:",":revolving_hearts:",":six_pointed_star:",":steam_locomotive:",":stuck_out_tongue:",":triangular_ruler:",":white_check_mark:",":arrow_double_up:",":bride_with_veil:",":bridge_at_night:",":closed_umbrella:",":congratulations:",":crying_cat_face:",":dromedary_camel:",":european_castle:",":heavy_plus_sign:",":high_brightness:",":izakaya_lantern:",":japanese_castle:",":japanese_goblin:",":man_with_turban:",":performing_arts:",":person_frowning:",":signal_strength:",":sparkling_heart:",":thought_balloon:",":aerial_tramway:",":arrow_backward:",":arrow_up_small:",":carousel_horse:",":checkered_flag:",":cherry_blossom:",":christmas_tree:",":coffee_morning:",":deciduous_tree:",":earth_americas:",":evergreen_tree:",":fork_and_knife:",":hatching_chick:",":heart_eyes_cat:",":jack_o_lantern:",":low_brightness:",":mailbox_closed:",":no_pedestrians:",":page_facing_up:",":page_with_curl:",":roller_coaster:",":rotating_light:",":rugby_football:",":school_satchel:",":speech_balloon:",":straight_ruler:",":tropical_drink:",":vibration_mode:",":womans_clothes:",":arrow_forward:",":arrow_up_down:",":athletic_shoe:",":baggage_claim:",":bookmark_tabs:",":chocolate_bar:",":confetti_ball:",":crescent_moon:",":crossed_flags:",":do_not_litter:",":electric_plug:",":grey_question:",":hatched_chick:",":hearts_around:",":japanese_ogre:",":kissing_heart:",":musical_score:",":no_entry_sign:",":oncoming_taxi:",":potable_water:",":round_pushpin:",":space_invader:",":speak_no_evil:",":sun_with_face:",":tanabata_tree:",":traffic_light:",":tropical_fish:",":water_buffalo:",":black_circle:",":broken_heart:",":capital_abcd:",":coffee_happy:",":construction:",":crystal_ball:",":earth_africa:",":fast_forward:",":ferris_wheel:",":fried_shrimp:",":hear_no_evil:",":horse_racing:",":left_luggage:",":meat_on_bone:",":mortar_board:",":movie_camera:",":musical_note:",":nut_and_bolt:",":oncoming_bus:",":partly_sunny:",":purple_heart:",":radio_button:",":raised_hands:",":raising_hand:",":rice_cracker:",":slot_machine:",":spermatozoon:",":sweet_potato:",":threefingers:",":video_camera:",":white_circle:",":white_flower:",":yellow_heart:",":alarm_clock:",":arrow_right:",":baby_bottle:",":baby_symbol:",":black_joker:",":circus_tent:",":city_sunset:",":closed_book:",":credit_card:",":dragon_face:",":ear_of_rice:",":exclamation:",":fallen_leaf:",":file_folder:",":fire_engine:",":floppy_disk:",":green_apple:",":green_heart:",":interrobang:",":kissing_cat:",":loudspeaker:",":love_letter:",":monkey_face:",":no_bicycles:",":older_woman:",":orange_book:",":outbox_tray:",":point_right:",":post_office:",":postal_horn:",":poultry_leg:",":pouting_cat:",":railway_car:",":raised_hand:",":sagittarius:",":see_no_evil:",":smiling_imp:",":snowboarder:",":sweat_drops:",":sweat_smile:",":tokyo_tower:",":arrow_down:",":arrow_left:",":astonished:",":baby_chick:",":bananarama:",":basketball:",":blue_heart:",":card_index:",":cold_sweat:",":confounded:",":couplekiss:",":curly_loop:",":dizzy_face:",":earth_asia:",":eyeglasses:",":flashlight:",":footprints:",":gift_heart:",":green_book:",":headphones:",":heart_eyes:",":heartpulse:",":helicopter:",":hotsprings:",":inbox_tray:",":keycap_ten:",":light_rail:",":loud_sound:",":love_hotel:",":maple_leaf:",":microphone:",":microscope:",":mount_fuji:",":name_badge:",":no_smoking:",":open_hands:",":panda_face:",":point_down:",":point_left:",":point_up_2:",":police_car:",":red_circle:",":registered:",":repeat_one:",":rice_scene:",":rubberdoll:",":safebanana:",":scream_cat:",":shaved_ice:",":smiley_cat:",":strawberry:",":thumbsdown:",":tired_face:",":trolleybus:",":two_hearts:",":twofingers:",":video_game:",":watermelon:",":wheelchair:",":wind_chime:",":wine_glass:",":womans_hat:",":ambulance:",":bar_chart:",":bicyclist:",":black_nib:",":blue_book:",":briefcase:",":capricorn:",":city_dusk:",":clipboard:",":clock1030:",":clock1130:",":clock1230:",":copyright:",":crocodile:",":fireworks:",":fish_cake:",":full_moon:",":grimacing:",":guardsman:",":hamburger:",":handcuffs:",":heartbeat:",":high_heel:",":highheels:",":honey_pot:",":hourglass:",":ice_cream:",":mag_right:",":mans_shoe:",":milky_way:",":nail_care:",":newspaper:",":older_man:",":ophiuchus:",":palm_tree:",":paperclip:",":persevere:",":pineapple:",":racehorse:",":rice_ball:",":satellite:",":saxophone:",":smile_cat:",":smirk_cat:",":snowflake:",":spaghetti:",":speedboat:",":sunflower:",":tangerine:",":telephone:",":telescope:",":threesome:",":wavy_dash:",":airplane:",":aquarius:",":arrow_up:",":bangbang:",":baseball:",":beginner:",":birthday:",":blowfish:",":blue_car:",":bookmark:",":calendar:",":cherries:",":chestnut:",":clapping:",":clock130:",":clock230:",":clock330:",":clock430:",":clock530:",":clock630:",":clock730:",":clock830:",":clock930:",":cocktail:",":computer:",":confused:",":diamonds:",":dickface:",":doughnut:",":eggplant:",":elephant:",":envelope:",":football:",":fountain:",":fuelpump:",":game_die:",":hibiscus:",":hospital:",":icecream:",":lipstick:",":lollipop:",":minidisc:",":moneybag:",":monorail:",":mushroom:",":new_moon:",":no_entry:",":no_mouth:",":notebook:",":ok_woman:",":pig_nose:",":point_up:",":poppen-1:",":princess:",":question:",":relieved:",":restroom:",":sailboat:",":scissors:",":scorpius:",":seedling:",":sleeping:",":sparkler:",":sparkles:",":stocking:",":thumbsup:",":umbrella:",":vibrator:",":whipping:",":balloon:",":bathtub:",":battery:",":blossom:",":bouquet:",":bowling:",":busstop:",":calling:",":chicken:",":clapper:",":clock10:",":clock11:",":clock12:",":custard:",":customs:",":cyclone:",":dancers:",":dolphin:",":dr_love:",":droplet:",":factory:",":fearful:",":flushed:",":haircut:",":hamster:",":handbag:",":joy_cat:",":jumping:",":kissing:",":leopard:",":mahjong:",":mailbox:",":massage:",":minibus:",":necktie:",":no_bell:",":no_good:",":octopus:",":ok_hand:",":package:",":parking:",":pencil2:",":penguin:",":pensive:",":postbox:",":pushpin:",":rabbit2:",":rainbow:",":recycle:",":red_car:",":relaxed:",":rooster:",":rowboat:",":safesex:",":smoking:",":snowman:",":sparkle:",":speaker:",":station:",":strapon:",":sunrise:",":swimmer:",":symbols:",":syringe:",":tractor:",":trident:",":triumph:",":trumpet:",":volcano:",":walking:",":warning:",":wedding:",":worried:",":accept:",":anchor:",":bamboo:",":banana:",":barber:",":bdrops:",":beetle:",":bikini:",":cactus:",":camera:",":cancer:",":church:",":cinema:",":clock1:",":clock2:",":clock3:",":clock4:",":clock5:",":clock6:",":clock7:",":clock8:",":clock9:",":coffee:",":collar:",":cookie:",":couple:",":dancer:",":dollar:",":dragon:",":e-mail:",":family:",":gemini:",":grapes:",":guitar:",":hammer:",":hearts:",":hottub:",":hushed:",":iphone:",":kimono:",":leaves:",":ledger:",":monkey:",":mouse2:",":muscle:",":office:",":over18:",":pencil:",":pisces:",":poodle:",":poppen:",":praise:",":rabbit:",":repeat:",":rewind:",":ribbon:",":rocket:",":runner:",":sandal:",":school:",":scream:",":scroll:",":secret:",":shower:",":sleepy:",":smiley:",":soccer:",":spades:",":suckmy:",":surfer:",":taurus:",":tennis:",":ticket:",":tiger2:",":toilet:",":tomato:",":tongue:",":tophat:",":train2:",":trophy:",":turtle:",":unlock:",":violin:",":wdrops:",":whale2:",":womens:",":wrench:",":ydrops:",":8ball:",":alien:",":angel:",":anger:",":apple:",":aries:",":beers:",":bento:",":books:",":bread:",":camel:",":candy:",":chart:",":cloud:",":clubs:",":crazy:",":crown:",":cupid:",":curry:",":dango:",":dizzy:",":dolls:",":dress:",":eight:",":flags:",":foggy:",":fries:",":fucku:",":ghost:",":heart:",":horse:",":hotel:",":house:",":japan:",":jeans:",":knife:",":koala:",":lemon:",":libra:",":melon:",":metro:",":mouse:",":moyai:",":notes:",":ocean:",":pager:",":peach:",":pizza:",":pouch:",":pound:",":punch:",":purse:",":pussy:",":radio:",":ramen:",":santa:",":seven:",":sheep:",":shell:",":shirt:",":skull:",":smirk:",":snail:",":snake:",":sound:",":star2:",":stars:",":sunny:",":sushi:",":sweat:",":three:",":tiger:",":train:",":truck:",":tulip:",":u5272:",":u5408:",":u55b6:",":u6307:",":u6708:",":u6709:",":u6e80:",":u7121:",":u7533:",":u7981:",":u7a7a:",":urock:",":virgo:",":watch:",":wdrop:",":weary:",":whale:",":woman:",":ydrop:",":1234:",":abcd:",":baby:",":back:",":bank:",":bath:",":bear:",":beer:",":bell:",":bike:",":bird:",":bite:",":boar:",":bomb:",":book:",":boom:",":boot:",":bulb:",":cake:",":cat2:",":clap:",":cock:",":cool:",":corn:",":cow2:",":dart:",":dash:",":date:",":dog2:",":door:",":euro:",":eyes:",":feet:",":fire:",":fish:",":fist:",":five:",":four:",":free:",":frog:",":gift:",":gimp:",":girl:",":goat:",":golf:",":grin:",":hash:",":herb:",":kiss:",":koko:",":lgbt:",":lick:",":link:",":lips:",":lock:",":loop:",":mask:",":mega:",":mens:",":mute:",":nine:",":nose:",":oden:",":pear:",":pig2:",":pill:",":poop:",":pray:",":rage:",":rice:",":ring:",":rose:",":sake:",":seat:",":ship:",":soon:",":star:",":stew:",":tada:",":taxi:",":tent:",":tits:",":tram:",":wave:",":wolf:",":zero:",":100:",":abc:",":ant:",":art:",":ass:",":atm:",":bed:",":bee:",":bow:",":boy:",":bug:",":bus:",":car:",":cat:",":cop:",":cow:",":cry:",":cum:",":dog:",":dvd:",":ear:",":egg:",":end:",":fax:",":gem:",":gun:",":imp:",":joy:",":key:",":leo:",":mag:",":man:",":new:",":one:",":pig:",":ram:",":rat:",":six:",":ski:",":sob:",":sos:",":tea:",":top:",":two:",":vhs:",":wax:",":yen:",":yum:",":zap:",":zzz:",":ab:",":cd:",":cl:",":cn:",":de:",":es:",":fr:",":gb:",":id:",":it:",":jp:",":kr:",":ng:",":o2:",":ok:",":on:",":ox:",":ru:",":sa:",":tm:",":tv:",":up:",":us:",":vs:",":wc:","(A)","-_-","9_9",":-/",":a:",":b:",":m:",":o:",":v:",":x:",">:(","O.o","o.O",":(",":)",":D",":P",":o",":x",":|",";)","B|","xD","¬¬"];
  const TPL_MAX = 100, TPL_TEXT_MAX = 8000, TPL_TRASH_DAYS = 30;
  const K_TPL = 'jaf_tpl';            // { [eigene ID]: { meta: { [JOY-ID]: { uid, name, text, hash, at, by } }, base: { [Partner]: { [uid]: hash } }, trash: [ { uid, name, text, deletedAt, by } ] } }
  const K_API2_FROM = 'jaf_api2_from'; // Wert der Kopfzeile x-requested-from, wie JOYclub sie selbst sendet
  const tplStoreAll = () => GM_getValue(K_TPL, {}) || {};
  const tplMe = () => sessionId() || ownProfileId() || '';
  function tplStore() {
    const all = tplStoreAll(), me = tplMe();
    const s = all[me] || {};
    s.meta = s.meta || {}; s.base = s.base || {}; s.trash = (s.trash || []).filter((t) => Date.now() - (t.deletedAt || 0) < TPL_TRASH_DAYS * 864e5);
    return s;
  }
  function tplSave(s) { const all = tplStoreAll(); all[tplMe()] = s; GM_setValue(K_TPL, all); }
  const tplUid = () => (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const tplBy = () => ({ platform: 'joyclub', account: ownNick() || '' });
  const tplPfName = (by) => (!by ? '' : by.platform === 'poppen' ? 'poppen.de' : by.platform === 'joyclub' ? 'JOYclub' : (by.platform || ''));

  // ---- Smileys: Zerlegen, Übersetzen, Vergleichstext ----
  const smEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const SM_URL = /(https?:\/\/\S+|www\.\S+)/;
  const SM_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
  let smReJoy = null, smRePop = null, smReU = null;
  const smJoyRe = () => smReJoy || (smReJoy = new RegExp(SM_JOYTOK.map(smEsc).join('|'), 'g'));
  const smPopRe = () => smRePop || (smRePop = new RegExp(SM_POPTOK.map(smEsc).join('|'), 'g'));
  const smURe = () => smReU || (smReU = new RegExp(Object.keys(SM_U2J).sort((a, b) => b.length - a.length).map((k) => [...k].map(smEsc).join('\\uFE0F?') + '\\uFE0F?').join('|'), 'gu'));
  // Text in Stücke außerhalb und innerhalb von Links zerlegen (in Links wird nie übersetzt oder entfernt)
  const smParts = (text) => String(text || '').split(SM_URL).map((t, i) => ({ t, url: i % 2 === 1 }));
  // Schreibweise einer anderen Plattform → JOYclub (bekannte Kürzel zuerst, sonst *name*; Unbekanntes bleibt)
  function smToJoy(text, from, unknown) {
    if (!from || from === 'joyclub') return String(text || '');
    return smParts(text).map(({ t, url }) => {
      if (url) return t;
      let x = t.replace(smPopRe(), (m) => {
        const v = SM_P2J[m];
        if (v) return v;
        if (unknown) unknown.add(m);
        return m;
      });
      x = x.replace(smURe(), (m) => SM_U2J[m.replace(/️/g, '')] || m);
      return x;
    }).join('');
  }
  // Vergleichstext: ohne Smileys/Emojis beider Plattformen, Leerraum zusammengefasst – mit Zuordnung zum Rohtext
  let smReAny = null;
  const smAnyRe = () => smReAny || (smReAny = new RegExp([...new Set(SM_JOYTOK.concat(SM_POPTOK))].sort((x, y) => y.length - x.length).map(smEsc).join('|') + '|' + SM_EMOJI.source, 'gu'));
  function smMap(text) {
    const raw = String(text || '');
    const gone = new Uint8Array(raw.length); // 1 = Smiley/Emoji (zählt wie Leerraum)
    let off = 0;
    for (const { t, url } of smParts(raw)) {
      if (!url) { const re = smAnyRe(); re.lastIndex = 0; let m; while ((m = re.exec(t))) { if (!m[0]) { re.lastIndex++; continue; } gone.fill(1, off + m.index, off + m.index + m[0].length); } }
      off += t.length;
    }
    const out = [], idx = [];
    let sp = true;
    for (let i = 0; i < raw.length; i++) {
      const ws = gone[i] || /\s/.test(raw[i]);
      if (ws) { if (!sp) { out.push(' '); idx.push(i); sp = true; } continue; }
      out.push(raw[i]); idx.push(i); sp = false;
    }
    if (out[out.length - 1] === ' ') { out.pop(); idx.pop(); }
    idx.push(raw.length);
    return { norm: out.join(''), idx, gone };
  }
  const smNorm = (text) => smMap(text).norm;
  async function smHash(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(smNorm(text)));
    return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  // Beginnt/endet ein Text (ohne Leerraum) mit einem Smiley/Emoji?
  const smEdge = (text, end) => { const m = smMap(text); const r = String(text || ''); for (let i = end ? r.length - 1 : 0; end ? i >= 0 : i < r.length; i += end ? -1 : 1) { if (/\s/.test(r[i]) && !m.gone[i]) continue; return !!m.gone[i]; } return false; };
  // Smileys/Leerraum am Rand eines Stücks abschneiden (nur Smileys, die die eigene Vorlage an dieser Stelle selbst hat)
  function smTrimEdge(piece, end) {
    const m = smMap(piece); let i = end ? piece.length - 1 : 0;
    while (end ? i >= 0 : i < piece.length) { if (m.gone[i] || /\s/.test(piece[i])) i += end ? -1 : 1; else break; }
    const cut = end ? piece.slice(i + 1) : piece.slice(0, i);
    const sep = /\n[^\S\n]*\n/.test(cut) ? '\n\n' : cut.includes('\n') ? '\n' : /\s/.test(cut) ? ' ' : '';
    return end ? piece.slice(0, i + 1) + sep : sep + piece.slice(i);
  }
  // Import-Text R (Schreibweise from) in die eigene Vorlage L einmischen → { text, how } oder null (Rückfrage nötig)
  function tplMerge(L, R, from, unknown) {
    const nL = smNorm(L), nR = smNorm(R);
    if (nL === nR) return { text: L, how: 'unverändert' };
    if (!nL) return { text: smToJoy(R, from, unknown), how: 'übernommen' };
    if (nR && nL.includes(nR)) return { text: L, how: 'unverändert' }; // Import ist nur ein Teil der eigenen Vorlage
    // 1. Ergänzung vorn und/oder hinten
    const k = nR.indexOf(nL);
    if (k >= 0) {
      const mR = smMap(R);
      let pre = R.slice(0, mR.idx[k]), post = R.slice(mR.idx[k + nL.length]);
      // grenzt die eigene Vorlage mit einem Smiley an, gehört der Smiley des Imports an dieser Stelle zur selben Stelle
      if (smEdge(L, false)) pre = smTrimEdge(pre, true);
      if (smEdge(L, true)) post = smTrimEdge(post, false);
      return { text: smToJoy(pre, from, unknown) + L.trim() + smToJoy(post, from, unknown), how: 'ergänzt' };
    }
    // 2. neue Absätze (auch in der Mitte): alle eigenen Absätze kommen in gleicher Reihenfolge auch im Import vor
    const pL = L.split(/\n\s*\n/), pR = R.split(/\n\s*\n/);
    const nPL = pL.map(smNorm), nPR = pR.map(smNorm);
    let j = 0;
    const out = [];
    for (let i = 0; i < pR.length; i++) {
      if (j < pL.length && nPR[i] === nPL[j]) { out.push(pL[j].replace(/^\n+|\n+$/g, '')); j++; } else out.push(smToJoy(pR[i], from, unknown).replace(/^\n+|\n+$/g, ''));
    }
    if (j === pL.length) return { text: out.join('\n\n'), how: 'ergänzt' };
    return null;
  }

  // ---- Schnittstelle apiv2 ----
  let api2Tok = null;
  async function api2Token(force) {
    if (!force && api2Tok && Date.now() - api2Tok.ts < 4 * 60000) return api2Tok.v;
    const c = await joyGet('/webauth/access_token');
    const v = c && c.access_token;
    if (!v) throw new Error('Kein Zugang zur Schnittstelle');
    api2Tok = { v, ts: Date.now() };
    return v;
  }
  async function api2(method, path, body) {
    const go = async (force) => {
      const tok = await api2Token(force);
      const h = { Accept: 'application/json', Authorization: `Bearer ${tok}`, 'X-Requested-With': 'XMLHttpRequest' };
      const from = GM_getValue(K_API2_FROM, '');
      if (from) h['X-Requested-From'] = from;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const url = 'https://apiv2.joyclub.com' + path;
      let status, txt;
      try {
        const r = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'include' });
        status = r.status; txt = await r.text();
      } catch (e) {
        // Rückfall ohne CORS-Grenzen
        ({ status, txt } = await new Promise((res, rej) => GM_xmlhttpRequest({ method, url, headers: h, data: body !== undefined ? JSON.stringify(body) : undefined,
          onload: (x) => res({ status: x.status, txt: x.responseText }), onerror: () => rej(new Error('Netzwerkfehler')), ontimeout: () => rej(new Error('Zeitüberschreitung')) })));
      }
      return { status, txt };
    };
    let r = await go(false);
    if (r.status === 401 || r.status === 403) r = await go(true);
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
    try { return r.txt ? JSON.parse(r.txt) : null; } catch (e) { return null; }
  }
  const tplApiList = () => api2('GET', `/users/${tplMe()}/notes`).then((l) => (Array.isArray(l) ? l : (l && (l.items || l.notes)) || []));
  const tplApiUpdate = (id, name, text) => api2('PUT', `/users/${tplMe()}/notes/${id}`, { name, text });
  const tplApiCreate = (name, text) => api2('POST', `/users/${tplMe()}/notes`, { name, text });
  const tplApiDelete = (id) => api2('DELETE', `/users/${tplMe()}/notes/${id}`);

  // ---- Zusatzangaben aktuell halten (auch Änderungen, die ohne Skript gemacht wurden) ----
  async function tplSync() {
    const list = await tplApiList();
    const s = tplStore();
    const seen = new Set();
    for (const n of list) {
      const id = String(n.id);
      seen.add(id);
      const text = String(n.text || ''), name = String(n.name || '');
      const hash = await smHash(text);
      const m = s.meta[id];
      if (!m) s.meta[id] = { uid: tplUid(), name, text, hash, at: Date.now(), by: tplBy(), first: true };
      else if (m.hash !== hash || m.name !== name || m.text !== text) {
        if (m.hash !== hash || m.name !== name) { m.at = Date.now(); m.by = tplBy(); }
        m.name = name; m.text = text; m.hash = hash; delete m.first;
      }
    }
    // auf JOYclub gelöscht → Papierkorb
    for (const [id, m] of Object.entries(s.meta)) {
      if (seen.has(id)) continue;
      if (!s.trash.some((t) => t.uid === m.uid)) s.trash.push({ uid: m.uid, name: m.name, text: m.text, deletedAt: Date.now(), by: tplBy() });
      delete s.meta[id];
    }
    tplSave(s);
    try { bkCheckTemplates(list, s); } catch (e) { /* Briefkasten ist Nebensache */ }
    return { list, s };
  }

  // ---- Export ----
  async function tplExportFile() {
    const nick = ownNick();
    if (!nick) throw new Error('Eigener Nick unbekannt – bitte einmal eine JOYclub-Seite mit Titelleiste öffnen.');
    const { list, s } = await tplSync();
    const templates = list.map((n) => { const m = s.meta[String(n.id)]; return m.first ? { id: m.uid, name: n.name, text: n.text } : { id: m.uid, name: n.name, text: n.text, updatedAt: m.at, updatedBy: m.by }; });
    for (const t of s.trash) templates.push({ id: t.uid, name: t.name, text: '', deletedAt: t.deletedAt, updatedBy: t.by });
    const inner = { format: 'fickliste', version: 1, platform: 'joyclub', exported: Date.now(), templates };
    const enc = await flEncrypt(inner, nick);
    return { file: { format: 'fickliste-enc', platform: 'joyclub', account: nick, alg: 'AES-GCM/PBKDF2', salt: enc.salt, iv: enc.iv, data: enc.data }, n: list.length };
  }
  async function tplParse(text, askNick) {
    let d;
    try { d = JSON.parse(String(text || '').trim()); } catch (e) { throw new Error('Keine gültige Datei (JSON).'); }
    let account = '', platform = '';
    if (d && d.format === 'fickliste-enc') {
      account = d.account || ''; platform = d.platform || '';
      let inner = await flDecrypt({ salt: d.salt, iv: d.iv, data: d.data }, account);
      if (!inner) inner = await flDecrypt({ salt: d.salt, iv: d.iv, data: d.data }, ownNick());
      while (!inner) {
        const n = await askNick(account);
        if (!n) throw new Error('Entschlüsseln abgebrochen.');
        inner = await flDecrypt({ salt: d.salt, iv: d.iv, data: d.data }, n);
      }
      d = inner;
    }
    if (!d || d.format !== 'fickliste' || !Array.isArray(d.templates)) throw new Error('Keine Textvorlagen in dieser Datei.');
    return { platform: d.platform || platform || 'joyclub', account: d.account || account, templates: d.templates };
  }

  // ---- Import / Abgleich ----
  // ask(kind, info) → Antwort des Nutzers; Ergebnis: Bericht
  async function tplImportRun(imp, mode, ask) {
    const from = imp.platform;
    const pk = `${from}:${norm(imp.account || '')}`;
    const { list, s } = await tplSync();
    const base = s.base[pk] = s.base[pk] || {};
    const rep = [];
    const unknown = new Set();
    const deferred = [];
    const byUid = new Map(), byName = new Map();
    for (const n of list) { const m = s.meta[String(n.id)]; byUid.set(m.uid, n); byName.set(norm(n.name), n); }
    let count = list.length;
    const touched = new Set();
    const setMeta = async (id, name, text, at, by, uid) => {
      const m = s.meta[String(id)] || (s.meta[String(id)] = { uid: uid || tplUid() });
      if (uid) m.uid = uid;
      m.name = name; m.text = text; m.hash = await smHash(text); m.at = at || Date.now(); m.by = by || tplBy();
      base[m.uid] = m.hash;
    };
    const create = async (name, text, at, by, uid) => {
      if (count >= TPL_MAX) return false;
      const r = await tplApiCreate(name, text);
      let id = r && (r.id || (r.note && r.note.id));
      if (!id) { const l2 = await tplApiList(); const hit = l2.find((x) => x.name === name && !s.meta[String(x.id)]); id = hit && hit.id; }
      if (!id) throw new Error('Anlegen nicht bestätigt');
      usedNames.add(norm(name));
      count++;
      await setMeta(id, name, text, at, by, uid);
      return true;
    };
    const usedNames = new Set(list.map((n) => norm(n.name)));
    const freeName = (name) => { let i = 2; while (usedNames.has(norm(`${name} (${i})`))) i++; return `${name} (${i})`; };
    // Wiederherstellen „ersetzen“: alles, was nicht in der Datei steht, in den Papierkorb
    if (mode === 'replace') {
      const keep = new Set(imp.templates.filter((t) => !t.deletedAt).map((t) => t.id));
      const keepNames = new Set(imp.templates.filter((t) => !t.deletedAt).map((t) => norm(t.name)));
      for (const n of list) {
        const m = s.meta[String(n.id)];
        if (keep.has(m.uid) || keepNames.has(norm(n.name))) continue;
        await tplApiDelete(n.id);
        s.trash.push({ uid: m.uid, name: n.name, text: n.text, deletedAt: Date.now(), by: tplBy() });
        delete s.meta[String(n.id)]; byUid.delete(m.uid); byName.delete(norm(n.name)); count--;
        rep.push([n.name, 'in den Papierkorb']);
      }
    }
    for (const T of imp.templates) {
      if (!T || !T.name) continue;
      const name = String(T.name).slice(0, 200);
      const Rtext = String(T.text || '').slice(0, TPL_TEXT_MAX);
      let L = (T.id && byUid.get(T.id)) || byName.get(norm(name)) || null;
      if (L && touched.has(String(L.id))) L = null;
      // gelöscht auf der anderen Seite
      if (T.deletedAt) {
        if (!L) continue;
        const m = s.meta[String(L.id)];
        const changed = base[m.uid] && base[m.uid] !== m.hash;
        let del = !changed;
        if (changed || !base[m.uid]) {
          const a = await ask('delete', { name: L.name, text: L.text, by: T.updatedBy, at: T.deletedAt });
          if (a === 'defer') { deferred.push(T); rep.push([L.name, 'Rückfrage wartet']); continue; }
          del = a === 'delete';
        }
        if (del) {
          await tplApiDelete(L.id);
          s.trash.push({ uid: m.uid, name: L.name, text: L.text, deletedAt: Date.now(), by: T.updatedBy || null });
          delete s.meta[String(L.id)]; count--;
          rep.push([L.name, 'gelöscht (Papierkorb)']);
        } else rep.push([L.name, 'Löschung nicht übernommen']);
        continue;
      }
      if (!L) {
        // hier gelöscht, dort unverändert → nicht wieder anlegen
        const tr = s.trash.find((t) => t.uid === T.id);
        if (tr && (!T.updatedAt || T.updatedAt <= tr.deletedAt)) { rep.push([name, 'hier gelöscht, nicht wieder angelegt']); continue; }
        const text = smToJoy(Rtext, from, unknown).slice(0, TPL_TEXT_MAX);
        if (await create(name, text, T.updatedAt, T.updatedBy, T.id)) rep.push([name, 'neu']); else rep.push([name, `übersprungen (höchstens ${TPL_MAX} Vorlagen)`]);
        continue;
      }
      touched.add(String(L.id));
      const m = s.meta[String(L.id)];
      if (T.id && m.uid !== T.id) { // gemeinsame Kennung: die alphabetisch kleinere gewinnt (beide Seiten entscheiden gleich)
        const u = [m.uid, T.id].sort()[0];
        if (base[m.uid] && !base[u]) base[u] = base[m.uid];
        m.uid = u;
      }
      const hL = m.hash, hR = await smHash(Rtext), hB = base[m.uid];
      const newName = name !== L.name && T.updatedAt && T.updatedAt > (m.at || 0) ? name : L.name;
      let res = null;
      if (hL === hR) res = { text: L.text, how: newName !== L.name ? 'umbenannt' : 'unverändert' };
      else if (hB && hL === hB) res = { text: smToJoy(Rtext, from, unknown), how: 'übernommen' };
      else if (hB && hR === hB) res = { text: L.text, how: 'unverändert (hier neuer)' };
      else res = tplMerge(L.text, Rtext, from, unknown);
      if (res && res.text.length > TPL_TEXT_MAX) res = null;
      if (!res) {
        const a = await ask('conflict', { name: L.name, mine: L.text, other: smToJoy(Rtext, from, unknown), otherBy: T.updatedBy, otherAt: T.updatedAt, myAt: m.at, myBy: m.by });
        if (a === 'defer') { deferred.push(T); rep.push([L.name, 'Rückfrage wartet']); continue; }
        if (a === 'other') res = { text: smToJoy(Rtext, from, unknown).slice(0, TPL_TEXT_MAX), how: 'ersetzt' };
        else if (a === 'both') {
          const nn = freeName(name);
          if (await create(nn, smToJoy(Rtext, from, unknown).slice(0, TPL_TEXT_MAX), T.updatedAt, T.updatedBy)) rep.push([L.name, `beide behalten („${nn}“)`]); else rep.push([L.name, `übersprungen (höchstens ${TPL_MAX} Vorlagen)`]);
          base[m.uid] = hR; // Stand der anderen Seite ist gesehen → beim nächsten Abgleich nicht erneut fragen
          continue;
        } else { rep.push([L.name, 'eigene behalten']); base[m.uid] = hR; continue; }
      }
      if (res.text !== L.text || newName !== L.name) {
        await tplApiUpdate(L.id, newName, res.text);
        await setMeta(L.id, newName, res.text, res.how === 'ergänzt' ? Date.now() : (T.updatedAt || Date.now()), res.how === 'ergänzt' ? tplBy() : (T.updatedBy || tplBy()));
      } else base[m.uid] = m.hash;
      rep.push([newName, res.how]);
    }
    tplSave(s);
    return { rep, unknown: [...unknown], deferred };
  }

  // ---- Popups (eigener <dialog>, damit sie über JOYclubs Overlay liegen und bedienbar sind) ----
  function tplDialog(title) {
    document.getElementById('jaf-tpl-dlg')?.remove();
    const d = document.createElement('dialog');
    d.id = 'jaf-tpl-dlg';
    d.style.cssText = 'border:0;border-radius:12px;padding:0;background:#1d1f22;color:#eee;max-width:min(560px,94vw);width:560px;box-shadow:0 10px 40px rgba(0,0,0,.6)';
    const box = flEl('div', 'padding:20px 22px;font:14px/1.45 system-ui,sans-serif;max-height:80vh;overflow:auto');
    box.appendChild(flEl('div', 'font:bold 19px system-ui;margin-bottom:10px', escHtml(title)));
    d.appendChild(box);
    (document.querySelector('j-overlay[data-e2e="overlay-templates"]') ? document.body : document.body).appendChild(d);
    try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
    const close = () => { try { d.close(); } catch (e) { /* egal */ } d.remove(); };
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(); if (d.__onCancel) d.__onCancel(); });
    return { d, box, close };
  }
  const tplRow = () => flEl('div', 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px');
  function tplChoice(title, text, choices) {
    return new Promise((res) => {
      const { d, box, close } = tplDialog(title);
      if (text) box.appendChild(flEl('div', 'margin-bottom:6px;white-space:pre-wrap', text));
      const row = tplRow();
      for (const [label, val, primary] of choices) row.appendChild(flBtn(label, () => { close(); res(val); }, primary));
      box.appendChild(row);
      d.__onCancel = () => res(null);
    });
  }
  const tplWhen = (at, by) => (at ? `zuletzt bearbeitet am ${fmtTs(at)}${by ? ' auf ' + tplPfName(by) : ''}` : '');
  async function tplAsk(kind, x) {
    if (kind === 'delete') {
      return tplChoice('Textvorlage löschen?', `„${x.name}“ wurde ${x.by ? 'auf ' + tplPfName(x.by) + ' ' : ''}gelöscht, ist hier aber geändert worden.`, [['Behalten', 'keep'], ['Löschen', 'delete', true]]);
    }
    return new Promise((res) => {
      const { d, box, close } = tplDialog(`Textvorlage „${x.name}“ unterscheidet sich`);
      const col = (h, sub, t) => {
        const c = flEl('div', 'flex:1;min-width:200px');
        c.appendChild(flEl('div', 'font-weight:bold;margin-bottom:2px', escHtml(h)));
        if (sub) c.appendChild(flEl('div', 'font-size:12px;color:#9a9a9a;margin-bottom:4px', escHtml(sub)));
        c.appendChild(flEl('div', 'white-space:pre-wrap;background:#2a2d31;border-radius:8px;padding:8px;font-size:13px;max-height:240px;overflow:auto', escHtml(t)));
        return c;
      };
      const w = flEl('div', 'display:flex;gap:12px;flex-wrap:wrap');
      w.appendChild(col('Diese Vorlage', tplWhen(x.myAt, x.myBy), x.mine));
      w.appendChild(col('Die andere', tplWhen(x.otherAt, x.otherBy), x.other));
      box.appendChild(w);
      const row = tplRow();
      row.appendChild(flBtn('Diese behalten', () => { close(); res('mine'); }));
      row.appendChild(flBtn('Beide (umbenannt)', () => { close(); res('both'); }));
      row.appendChild(flBtn('Die andere übernehmen', () => { close(); res('other'); }, true));
      box.appendChild(row);
      d.__onCancel = () => res('mine');
    });
  }
  async function tplExportImportPopup() {
    const what = await tplChoice('Textvorlagen exportieren/importieren', 'Für die Sicherung, das Zweitkonto und den Abgleich mit dem Skript auf poppen.de. Die Datei ist mit deinem Nick verschlüsselt.', [['Abbrechen', null], ['Importieren', 'imp'], ['Exportieren', 'exp', true]]);
    if (!what) return;
    const how = await tplChoice(what === 'exp' ? 'Textvorlagen exportieren' : 'Textvorlagen importieren', '', [['Abbrechen', null], ['per Zwischenablage', 'clip'], ['per Datei', 'file', true]]);
    if (!how) return;
    if (what === 'exp') {
      let f;
      try { f = await tplExportFile(); } catch (e) { await tplChoice('Export nicht möglich', e.message, [['Schließen', null, true]]); return; }
      const text = JSON.stringify(f.file);
      if (how === 'file') { flDownload(`textvorlagen-joyclub-${isoDay(new Date())}.json`, text); flToast(`${f.n} Textvorlagen gespeichert.`); }
      else flToast((await copyText(text)) ? `${f.n} Textvorlagen in die Zwischenablage kopiert.` : 'Kopieren nicht möglich.');
      return;
    }
    let text = '';
    if (how === 'file') {
      text = await new Promise((res) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,.txt,application/json,text/plain';
        inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (!f) { res(''); return; } const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => res(''); r.readAsText(f); });
        inp.click();
      });
    } else {
      try { text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
      if (!/fickliste/.test(text)) {
        text = await new Promise((res) => {
          const { d, box, close } = tplDialog('Textvorlagen importieren');
          box.appendChild(flEl('div', 'margin-bottom:6px', 'Die Zwischenablage ließ sich nicht lesen. Bitte hier mit Strg+V einfügen:'));
          const ta = flEl('textarea', 'width:100%;min-height:120px;background:#2a2d31;color:#eee;border:1px solid #444;border-radius:8px;padding:8px;font:12px monospace');
          box.appendChild(ta);
          const row = tplRow();
          row.appendChild(flBtn('Abbrechen', () => { close(); res(''); }));
          row.appendChild(flBtn('Importieren', () => { close(); res(ta.value); }, true));
          box.appendChild(row);
          d.__onCancel = () => res('');
          setTimeout(() => ta.focus(), 50);
        });
      }
    }
    if (!text) return;
    let imp;
    try {
      imp = await tplParse(text, (acc) => new Promise((res) => {
        const { d, box, close } = tplDialog('Nick zum Entschlüsseln');
        box.appendChild(flEl('div', 'margin-bottom:6px', escHtml(`Die Datei ist mit einem Nick verschlüsselt${acc ? ` (angegeben: ${acc})` : ''}. Bitte den Nick eingeben:`)));
        const i = flEl('input', 'width:100%;background:#2a2d31;color:#eee;border:1px solid #444;border-radius:8px;padding:8px');
        box.appendChild(i);
        const row = tplRow();
        row.appendChild(flBtn('Abbrechen', () => { close(); res(''); }));
        row.appendChild(flBtn('OK', () => { close(); res(i.value.trim()); }, true));
        box.appendChild(row);
        d.__onCancel = () => res('');
      }));
    } catch (e) { await tplChoice('Import nicht möglich', e.message, [['Schließen', null, true]]); return; }
    let mode = 'merge';
    if (imp.platform === 'joyclub' && norm(imp.account) === norm(ownNick())) {
      mode = await tplChoice('Sicherung wiederherstellen', 'Die Datei stammt von diesem Konto. „Ersetzen“ stellt genau den Stand der Datei her (andere Vorlagen kommen in den Papierkorb), „Ergänzen“ gleicht nur ab.', [['Abbrechen', null], ['Ersetzen', 'replace'], ['Ergänzen', 'merge', true]]);
      if (!mode) return;
    }
    flToast('Gleiche Textvorlagen ab …');
    let r;
    try { r = await tplImportRun(imp, mode, tplAsk); } catch (e) { await tplChoice('Import abgebrochen', `${e.message}\n\nBitte den API-Rekorder einschalten, eine Vorlage anlegen, ändern und löschen und den Mitschnitt schicken.`, [['Schließen', null, true]]); return; }
    const lines = r.rep.map(([n, h]) => `${n}: ${h}`).join('\n') || 'Keine Textvorlagen in der Datei.';
    await tplChoice('Import fertig', lines + (r.unknown.length ? `\n\nNicht übersetzte Smileys: ${r.unknown.join(' ')}` : ''), [['Schließen', null, true]]);
    tplUiDirty = true;
  }
  function tplTrashPopup() {
    const s = tplStore();
    const { box, close } = tplDialog(`Papierkorb (${s.trash.length})`);
    box.appendChild(flEl('div', 'font-size:12px;color:#9a9a9a;margin-bottom:8px', `Gelöschte Textvorlagen bleiben ${TPL_TRASH_DAYS} Tage hier.`));
    for (const t of s.trash.slice().reverse()) {
      const r = flEl('div', 'display:flex;gap:10px;align-items:center;padding:6px 8px;background:#2a2d31;border-radius:8px;margin:4px 0');
      r.appendChild(flEl('div', 'flex:1;min-width:0', `<b>${escHtml(t.name)}</b><div style="font-size:12px;color:#9a9a9a">gelöscht am ${fmtTs(t.deletedAt)}${t.by ? ' auf ' + escHtml(tplPfName(t.by)) : ''}</div>`));
      r.appendChild(flBtn('Wiederherstellen', async () => {
        try {
          const list = await tplApiList();
          if (list.length >= TPL_MAX) throw new Error(`Höchstens ${TPL_MAX} Textvorlagen`);
          const nm = list.some((n) => norm(n.name) === norm(t.name)) ? `${t.name} (wiederhergestellt)` : t.name;
          const res = await tplApiCreate(nm, t.text);
          const id = res && res.id;
          const s2 = tplStore();
          s2.trash = s2.trash.filter((x) => x.uid !== t.uid);
          if (id) s2.meta[String(id)] = { uid: t.uid, name: nm, text: t.text, hash: await smHash(t.text), at: Date.now(), by: tplBy() };
          tplSave(s2);
          close(); flToast(`„${nm}“ wiederhergestellt – bitte die Textvorlagen neu öffnen.`); tplUiDirty = true;
        } catch (e) { flToast(`Nicht möglich: ${e.message}`); }
      }));
      box.appendChild(r);
    }
    const row = tplRow(); row.appendChild(flBtn('Schließen', close, true)); box.appendChild(row);
  }

  // ---- Termine im Bearbeiten-Fenster ----
  const TPL_IDB = 'jaf-termine';
  function tplIdb() {
    return new Promise((res, rej) => { const r = indexedDB.open(TPL_IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function tplHandle(set) {
    const db = await tplIdb();
    return new Promise((res, rej) => {
      const tx = db.transaction('h', set === undefined ? 'readonly' : 'readwrite');
      const st = tx.objectStore('h');
      const r = set === undefined ? st.get('datei') : st.put(set, 'datei');
      r.onsuccess = () => res(set === undefined ? r.result : set); r.onerror = () => rej(r.error);
    });
  }
  // Zeilen „wann - wo - was - Link“ → die ersten 5 kommenden (heute zählt), nach Datum sortiert (stabil)
  function tplParseTermine(text, now = new Date()) {
    const today = isoDay(now);
    const out = [];
    let i = 0;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/\s+-\s+/);
      if (parts.length < 2) continue;
      const m = parts[0].match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
      if (!m) continue;
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      const day = `${y}-${pad2(+m[2])}-${pad2(+m[1])}`;
      if (day < today) continue;
      let link = '';
      if (parts.length >= 3 && /^(https?:\/\/|www\.)/i.test(parts[parts.length - 1])) link = parts.pop();
      const wann = parts[0], wo = parts[1] || '', was = parts.slice(2).join(' - ');
      if (link) link = link.replace(/^(?:https?:\/\/)?(?:www\.)?joyclub\.de\//i, 'https://www.joyclub.de/').replace(/^www\./i, 'https://www.');
      out.push({ day, i: i++, wann, wo, was, link });
      if (out.length >= 5) break;
    }
    return out.sort((a, b) => a.day.localeCompare(b.day) || a.i - b.i);
  }
  const tplTerminText = (t) => (t.link ? `${t.wann} - ${t.wo} - ${t.link}` : [t.wann, t.wo, t.was].filter(Boolean).join(' - '));
  const tplTerminLabel = (t) => [t.wann, t.wo, t.was].filter(Boolean).join(' - ');
  function tplTextarea(ov) {
    const ta = ov.querySelector('[data-e2e="input-template-text"]');
    return ta && ta.shadowRoot ? ta.shadowRoot.querySelector('textarea') : null;
  }
  function tplSetText(ov, v) {
    const host = ov.querySelector('[data-e2e="input-template-text"]');
    const ta = tplTextarea(ov);
    if (!ta) return;
    ta.value = v.slice(0, TPL_TEXT_MAX);
    ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    try { host.value = ta.value; } catch (e) { /* egal */ }
  }
  function tplInsert(ov, piece) {
    const ta = tplTextarea(ov);
    if (!ta) return;
    // Schreibmarke nur, wenn im Textfeld schon geklickt wurde – sonst ans Ende
    const v = ta.value, touched = ta.__jafTouched;
    const a = touched && ta.selectionStart != null ? ta.selectionStart : v.length, b = touched && ta.selectionEnd != null ? ta.selectionEnd : a;
    const before = v.slice(0, a).replace(/\s+$/, ''), after = v.slice(b).replace(/^\s+/, '');
    const nv = (before ? before + '\n\n' : '') + piece + (after ? '\n\n' + after : '');
    tplSetText(ov, nv);
    const pos = (before ? before.length + 2 : 0) + piece.length;
    try { ta.focus(); ta.setSelectionRange(pos, pos); } catch (e) { /* egal */ }
  }
  async function tplTermineRender(ov, box) {
    const ta0 = tplTextarea(ov);
    if (ta0 && !ta0.__jafTouchHook) { ta0.__jafTouchHook = true; for (const ev of ['focus', 'mousedown', 'keyup']) ta0.addEventListener(ev, () => { ta0.__jafTouched = true; }); }
    const btn = (label, fn, title) => {
      const b = document.createElement('j-button');
      b.setAttribute('variant', 'secondary'); b.setAttribute('role', ''); b.setAttribute('type', 'button'); b.setAttribute('size', 'small');
      b.textContent = label; if (title) b.title = title;
      b.style.cssText = 'max-width:100%';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      return b;
    };
    box.innerHTML = '';
    box.appendChild(flEl('div', 'font-weight:bold;margin:12px 0 6px', 'Termine'));
    const wrap = flEl('div', 'display:flex;flex-direction:column;gap:6px;align-items:stretch');
    box.appendChild(wrap);
    const pick = async () => {
      try {
        const pickFn = window.showOpenFilePicker || (typeof unsafeWindow !== 'undefined' && unsafeWindow.showOpenFilePicker);
        if (!pickFn) { flToast('Dein Browser kann keine Datei dauerhaft öffnen (Chrome nötig).'); return; }
        const [h] = await pickFn.call(window, { types: [{ description: 'Textdatei', accept: { 'text/plain': ['.txt', '.csv', '.md'] } }], multiple: false });
        if (h) { await tplHandle(h); tplTermineRender(ov, box); }
      } catch (e) { /* abgebrochen */ }
    };
    let h = null;
    try { h = await tplHandle(); } catch (e) { h = null; }
    if (!h) { wrap.appendChild(btn('Datei mit Terminen wählen …', pick)); return; }
    let perm = 'granted';
    try { perm = await h.queryPermission({ mode: 'read' }); } catch (e) { perm = 'prompt'; }
    if (perm !== 'granted') {
      wrap.appendChild(btn('Zugriff auf die Datei erlauben', async () => { try { if ((await h.requestPermission({ mode: 'read' })) === 'granted') tplTermineRender(ov, box); } catch (e) { /* egal */ } }));
      wrap.appendChild(btn('Datei ändern …', pick));
      return;
    }
    let list = [];
    try { const f = await h.getFile(); list = tplParseTermine(await f.text()); } catch (e) { wrap.appendChild(flEl('div', 'color:#ffb020', 'Datei nicht lesbar.')); }
    if (!list.length) wrap.appendChild(flEl('div', 'opacity:.75', 'Keine kommenden Termine'));
    for (const t of list) {
      const full = tplTerminLabel(t);
      const b = btn(full.length > 60 ? full.slice(0, 58) + '…' : full, () => tplInsert(ov, tplTerminText(t)), full);
      wrap.appendChild(b);
    }
    if (list.length) wrap.appendChild(btn('Alle übernehmen', () => tplSetText(ov, list.map(tplTerminText).join('\n\n'))));
    wrap.appendChild(btn('Datei ändern …', pick));
  }

  // ---- Einbau in JOYclubs Overlay „Textvorlagen“ ----
  let tplUiDirty = true, tplSyncTs = 0, tplSyncing = false;
  function tplUiTick() {
    if (IN_FRAME || !/^\/clubmail/.test(location.pathname)) return;
    const ov = document.querySelector('j-overlay[data-e2e="overlay-templates"]');
    if (!ov) { tplUiDirty = true; return; }
    const add = ov.querySelector('[data-e2e="button-add-template"]');
    const nameF = ov.querySelector('[data-e2e="input-template-name"]');
    if (add) {
      // Knopf „Textvorlagen exportieren/importieren“ unter „Textvorlage hinzufügen“
      if (!ov.querySelector('.jaf-tpl-xbtn')) {
        const b = document.createElement('j-button');
        b.className = 'jaf-tpl-xbtn';
        b.setAttribute('full-size', 'true'); b.setAttribute('role', ''); b.setAttribute('type', 'button'); b.setAttribute('variant', 'secondary');
        b.textContent = 'Textvorlagen exportieren/importieren';
        b.style.cssText = 'display:block;margin-top:8px';
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); tplExportImportPopup(); });
        add.insertAdjacentElement('afterend', b);
      }
      if ((tplUiDirty || Date.now() - tplSyncTs > 60000) && !tplSyncing) {
        tplSyncing = true;
        tplSync().then(() => { tplUiDirty = false; tplSyncTs = Date.now(); }).catch(() => { tplSyncTs = Date.now(); }).finally(() => { tplSyncing = false; tplDecorate(ov); });
      } else tplDecorate(ov);
    }
    if (nameF) {
      // Termine-Bereich nur bei „Termin“ im Namen
      const inner = nameF.shadowRoot && nameF.shadowRoot.querySelector('input');
      const nm = (inner && inner.value) || nameF.getAttribute('value') || '';
      const form = ov.querySelector('[data-e2e="input-template-text"]');
      let box = ov.querySelector('.jaf-tpl-termine');
      if (/termin/i.test(nm) && form) {
        if (!box) { box = flEl('div', ''); box.className = 'jaf-tpl-termine'; form.insertAdjacentElement('afterend', box); tplTermineRender(ov, box); }
      } else if (box) box.remove();
      // Speichern/Löschen → Zusatzangaben nachziehen
      for (const sel of ['[data-e2e="button-save-template"]', '[data-e2e="button-delete-template"]']) {
        const b = ov.querySelector(sel);
        if (b && !b.__jafTpl) { b.__jafTpl = true; b.addEventListener('click', () => { setTimeout(() => { tplUiDirty = true; tplSync().catch(() => {}); }, 1500); }); }
      }
    }
  }
  function tplDecorate(ov) {
    const s = tplStore();
    // Papierkorb neben „N von 100“
    const lim = ov.querySelector('[data-e2e="text-limit-templates"]');
    if (lim) {
      let a = ov.querySelector('.jaf-tpl-trash');
      if (s.trash.length) {
        if (!a) { a = flEl('a', 'margin-left:12px;cursor:pointer;text-decoration:underline'); a.className = 'jaf-tpl-trash'; a.href = '#'; a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); tplTrashPopup(); }); lim.insertAdjacentElement('afterend', a); }
        const t = `Papierkorb (${s.trash.length})`; if (a.textContent !== t) a.textContent = t;
      } else if (a) a.remove();
    }
    // „zuletzt bearbeitet am … auf …“ unter dem Namen
    const byName = new Map(Object.values(s.meta).map((m) => [norm(m.name), m]));
    for (const it of ov.querySelectorAll('[data-e2e="item-template"]')) {
      const name = [...it.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
      const m = byName.get(norm(name));
      const txt = m && !m.first ? tplWhen(m.at, m.by) : '';
      let el = it.querySelector('.jaf-tpl-meta');
      if (!txt) { if (el) el.remove(); continue; }
      if (!el) { el = flEl('div', 'font-size:12px;opacity:.65;margin-bottom:2px'); el.className = 'jaf-tpl-meta'; el.setAttribute('slot', 'description'); const d = it.querySelector('[slot="description"]'); if (d) d.insertAdjacentElement('beforebegin', el); else it.appendChild(el); }
      if (el.textContent !== txt) el.textContent = txt;
    }
  }
  setInterval(() => { try { tplUiTick(); } catch (e) { /* weiter */ } }, 1000);

  // =====================================================================
  // ---------- Briefkasten: Postausgang füllen, Eingang verarbeiten (JOYclub-Seite, oberstes Fenster) ----------
  // Fickliste: geänderte Personen werden einzeln gesendet (Vergleich mit dem zuletzt gesendeten Stand je Person).
  // Textvorlagen: nach jedem Abgleich mit JOYclub (tplSync) geänderte Vorlagen. Erster Kontakt / Zurücksetzen: „full“.
  // Eingang: wie ein Import, aber Rückfragen werden nicht gestellt, sondern vorgemerkt und beim nächsten Öffnen der
  // Fickliste bzw. der Textvorlagen angezeigt.
  // =====================================================================
  const K_BK_SENT = 'jaf_bk_sent';       // { p: { id: hash }, t: { uid: hash } } – zuletzt gesendeter Stand
  const K_BK_PEND_FL = 'jaf_bk_pend_fl'; // vorgemerkte Fickliste-Rückfragen [Person]
  const K_BK_PEND_TPL = 'jaf_bk_pend_tpl'; // vorgemerkte Vorlagen-Rückfragen { account, templates: [] }
  const K_BK_STAT = 'jaf_bk_stat';
  const K_BK_RETRY = 'jaf_bk_retry';     // Vorlagen, die wegen eines Schnittstellenfehlers später erneut versucht werden       // { start, ok, ls, sent, recv, err }
  const BK_MAX_BYTES = 1024 * 1024;
  const bkHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + s.length; };
  const bkStat = (patch) => { const s = Object.assign({}, GM_getValue(K_BK_STAT, {}) || {}, patch); GM_setValue(K_BK_STAT, s); return s; };
  function bkEnqueue(kind, data, opt = {}) {
    const acked = +GM_getValue(K_BK_ACK, 0) || 0;
    let seq = +GM_getValue(K_BK_SEQ, 0) || 0;
    if (acked > seq) seq = acked; // eigener Speicher zurückgesetzt → weiterzählen
    const ob = GM_getValue(K_BK_OUT, null) || { v: 1, platform: BK_ME, items: [] };
    ob.items = (ob.items || []).filter((x) => x.seq > acked);
    const add = (k, d) => { seq++; ob.items.push({ seq, ts: Date.now(), kind: k, data: d }); };
    if (Array.isArray(data)) data.forEach((d) => add(kind, d)); else add(kind, data);
    ob.account = ownNick() || ob.account || ''; ob.ts = Date.now(); ob.v = 1; ob.platform = BK_ME;
    if (!opt.noOverflow && JSON.stringify(ob).length > BK_MAX_BYTES) { GM_setValue(K_BK_SEQ, seq); bkSendFull(); return; }
    GM_setValue(K_BK_SEQ, seq);
    GM_setValue(K_BK_OUT, ob);
    bkStat({ sent: Date.now() });
  }
  // Vorlagen in Austauschform (wie beim Export)
  function bkTplList(list, s) {
    const out = list.map((n) => { const m = s.meta[String(n.id)]; return m.first ? { id: m.uid, name: n.name, text: n.text } : { id: m.uid, name: n.name, text: n.text, updatedAt: m.at, updatedBy: m.by }; });
    for (const t of s.trash) out.push({ id: t.uid, name: t.name, text: '', deletedAt: t.deletedAt, updatedBy: t.by });
    return out;
  }
  let bkTplLast = null; // letzte bekannte Vorlagenliste (aus tplSync)
  function bkSendFull() {
    const persons = flExportPersons();
    const data = { persons };
    const sent = { p: {}, t: {} };
    for (const p of persons) sent.p[p.id] = bkHash(JSON.stringify(p));
    if (bkTplLast) { data.templates = bkTplLast; for (const t of bkTplLast) sent.t[t.id] = bkHash(JSON.stringify(t)); }
    const acked = +GM_getValue(K_BK_ACK, 0) || 0;
    let seq = Math.max(+GM_getValue(K_BK_SEQ, 0) || 0, acked) + 1;
    GM_setValue(K_BK_SEQ, seq);
    GM_setValue(K_BK_OUT, { v: 1, platform: BK_ME, account: ownNick() || '', ts: Date.now(), items: [{ seq, ts: Date.now(), kind: 'full', data }] });
    GM_setValue(K_BK_SENT, sent);
    bkStat({ sent: Date.now(), full: Date.now() });
  }
  function bkCheckPersons() {
    const sent = GM_getValue(K_BK_SENT, null);
    if (!sent || !sent.p) return false; // noch nie gesendet → Vollabgleich
    const changed = [];
    for (const p of flExportPersons()) {
      const h = bkHash(JSON.stringify(p));
      if (sent.p[p.id] !== h) { changed.push(p); sent.p[p.id] = h; }
    }
    if (changed.length) { bkEnqueue('person', changed); GM_setValue(K_BK_SENT, sent); }
    return true;
  }
  function bkCheckTemplates(list, s) {
    bkTplLast = bkTplList(list, s);
    const sent = GM_getValue(K_BK_SENT, null);
    if (!sent) return;
    sent.t = sent.t || {};
    const changed = [];
    for (const t of bkTplLast) { const h = bkHash(JSON.stringify(t)); if (sent.t[t.id] !== h) { changed.push(t); sent.t[t.id] = h; } }
    if (changed.length) { bkEnqueue('template', changed); GM_setValue(K_BK_SENT, sent); }
  }
  // Eingang verarbeiten
  let bkWorking = false;
  async function bkProcessInbox() {
    if (bkWorking) return;
    let inbox = GM_getValue(K_BK_IN, []) || [];
    const retry = GM_getValue(K_BK_RETRY, null);
    if (retry && retry.at <= Date.now()) { GM_setValue(K_BK_RETRY, null); inbox = retry.items.concat(inbox); }
    if (!inbox.length) return;
    bkWorking = true;
    try {
      GM_setValue(K_BK_IN, []);
      const persons = [], templates = [];
      let account = '';
      for (const x of inbox) {
        account = x.account || account;
        const d = x.data || {};
        if (x.kind === 'person' && d) persons.push(d);
        else if (x.kind === 'template' && d) templates.push(d);
        else if (x.kind === 'full') { (d.persons || []).forEach((p) => persons.push(p)); (d.templates || []).forEach((t) => templates.push(t)); }
      }
      // gleiche Person/Vorlage mehrfach → nur der letzte Stand
      const lastBy = (arr, key) => { const m = new Map(); arr.forEach((v, i) => m.set(key(v) || 'i' + i, v)); return [...m.values()]; };
      const P = lastBy(persons, (p) => p && p.id), T = lastBy(templates, (t) => t && (t.id || t.name));
      if (P.length) {
        const st = await flImportRun({ platform: BK_OTHER, persons: P }, () => 'defer');
        if (st.deferred && st.deferred.length) GM_setValue(K_BK_PEND_FL, (GM_getValue(K_BK_PEND_FL, []) || []).concat(st.deferred).slice(-200));
        try { flRefreshAll(); } catch (e) { /* egal */ }
      }
      if (T.length) {
        try {
          const r = await tplImportRun({ platform: BK_OTHER, account, templates: T }, 'add', async () => 'defer');
          if (r.deferred && r.deferred.length) {
            const pend = GM_getValue(K_BK_PEND_TPL, null) || { account, templates: [] };
            pend.account = account || pend.account;
            pend.templates = lastBy(pend.templates.concat(r.deferred), (t) => t.id || t.name);
            GM_setValue(K_BK_PEND_TPL, pend);
          }
        } catch (e) {
          // Schnittstelle gerade nicht erreichbar → später erneut
          GM_setValue(K_BK_RETRY, { at: Date.now() + 5 * 60000, items: T.map((t) => ({ seq: 0, ts: Date.now(), kind: 'template', data: t, account })) });
          bkStat({ err: e.message || String(e) });
        }
      }
      bkStat({ recv: Date.now() });
    } finally { bkWorking = false; }
  }
  // vorgemerkte Rückfragen beim Öffnen der Fickliste bzw. der Textvorlagen
  let bkPendBusy = false;
  async function bkPendingFl() {
    const pend = GM_getValue(K_BK_PEND_FL, []) || [];
    if (!pend.length || bkPendBusy) return;
    bkPendBusy = true;
    try {
      GM_setValue(K_BK_PEND_FL, []);
      const st = await flImportRun({ platform: BK_OTHER, persons: pend }, (X, names) => flAskMerge(X, names));
      if (st.neu || st.merged || st.auto) flRefreshAll();
    } finally { bkPendBusy = false; }
  }
  async function bkPendingTpl() {
    const pend = GM_getValue(K_BK_PEND_TPL, null);
    if (!pend || !pend.templates || !pend.templates.length || bkPendBusy) return;
    bkPendBusy = true;
    try {
      GM_setValue(K_BK_PEND_TPL, null);
      await tplImportRun({ platform: BK_OTHER, account: pend.account || '', templates: pend.templates }, 'add', tplAsk);
      tplUiDirty = true;
    } finally { bkPendBusy = false; }
  }
  function bkStatusText() {
    const st = GM_getValue(K_BK_STAT, {}) || {}, alive = GM_getValue(K_BK_ALIVE, null), peer = GM_getValue(K_BK_PEER, null);
    if (!st.start) return 'Noch nicht geprüft.';
    if (!alive || alive.ts < st.start - 60000) return Date.now() - st.start < 15000 ? 'Wird geprüft …' : 'Briefkasten blockiert – vermutlich durch die Sicherheitsrichtlinie der Seite oder einen Werbeblocker. Export/Import per Hand geht weiter.';
    if (!alive.ls) return 'Speicher gesperrt – vermutlich ist „Drittanbieter-Cookies blockieren“ eingeschaltet. Export/Import per Hand geht weiter.';
    if (!peer) return 'Briefkasten bereit. poppen-Skript noch nicht gefunden (es muss einmal auf poppen.de oder hier laufen).';
    const last = Math.max(st.recv || 0, st.sent || 0);
    return `Abgleich aktiv mit dem poppen-Skript${peer.version ? ' ' + peer.version : ''}` + (last ? ` · letzter Austausch ${fmtTs(last)}` : '') +
      (st.err ? ` · zuletzt Fehler: ${st.err}` : '');
  }
  function bkStart() {
    if (IN_FRAME || window.top !== window) return;
    bkStat({ start: Date.now() });
    bkEnsureFrame();
    // erster Kontakt bzw. Zurücksetzen drüben → Vollabgleich
    const firstCheck = () => {
      const peer = GM_getValue(K_BK_PEER, null), acked = +GM_getValue(K_BK_ACK, 0) || 0, seq = +GM_getValue(K_BK_SEQ, 0) || 0;
      if (peer && (!GM_getValue(K_BK_SENT, null) || acked > seq)) bkSendFull();
    };
    setTimeout(firstCheck, 4000);
    try { GM_addValueChangeListener(K_BK_PEER, () => firstCheck()); } catch (e) { /* egal */ }
    try { GM_addValueChangeListener(K_BK_IN, (k, o, n, remote) => { if (n && n.length) setTimeout(() => bkProcessInbox().catch(() => {}), 300); }); } catch (e) { /* egal */ }
    setTimeout(() => bkProcessInbox().catch(() => {}), 2500);
    setInterval(() => { const r = GM_getValue(K_BK_RETRY, null); if (r && r.at <= Date.now()) bkProcessInbox().catch(() => {}); }, 60000);
    setInterval(() => { try { if (GM_getValue(K_BK_PEER, null)) bkCheckPersons(); } catch (e) { /* egal */ } }, 5000);
    // Textvorlagen gelegentlich mit JOYclub abgleichen (nur wenn das poppen-Skript bekannt ist)
    setInterval(() => { if (GM_getValue(K_BK_PEER, null) && !tplSyncing) tplSync().catch(() => {}); }, 15 * 60000);
    setTimeout(() => { if (GM_getValue(K_BK_PEER, null) && !tplSyncing) tplSync().catch(() => {}); }, 8000);
  }
  bkStart();
  setInterval(() => {
    if (IN_FRAME) return;
    try { if (flOverviewPage()) bkPendingFl().catch(() => {}); } catch (e) { /* weiter */ }
    try { if (document.querySelector('j-overlay[data-e2e="overlay-templates"] [data-e2e="button-add-template"]')) bkPendingTpl().catch(() => {}); } catch (e) { /* weiter */ }
  }, 2000);

  safeInit();
  let lastPath = location.pathname;
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; safeInit(); } }, 1000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __jafMain, { once: true });
  else __jafMain();
})();
