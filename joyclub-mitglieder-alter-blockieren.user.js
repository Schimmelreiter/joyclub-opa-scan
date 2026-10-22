// ==UserScript==
// @name         JOYclub – Mitgliedersuche nach Alter ignorieren
// @namespace    local.joyclub-age-filter
// @version      1.73
// @description  Opa-Scan für JOYclub: Interaktionen, Profilbesucher, Partys, Gruppen und Mitgliedersuche nach Alter bzw. Altersunterschied durchsuchen und Treffer ignorieren; Einstellungsseite, Whitelist, Ignorierlisten-Limit, AWO-Faktor, Exporte.
// @match        https://www.joyclub.de/*
// @match        https://identity.joyclub.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=joyclub.de
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @homepageURL  https://github.com/Schimmelreiter/joyclub-opa-scan
// @updateURL    https://raw.githubusercontent.com/Schimmelreiter/joyclub-opa-scan/main/joyclub-mitglieder-alter-blockieren.user.js
// @downloadURL  https://raw.githubusercontent.com/Schimmelreiter/joyclub-opa-scan/main/joyclub-mitglieder-alter-blockieren.user.js
// ==/UserScript==

(function () {
  'use strict';
  // ---------- Login-Seite (identity.joyclub.com): nur einloggen, wenn das Skript den Login angestoßen hat ----------
  if (location.hostname === 'identity.joyclub.com') {
    (async () => {
      const K = 'jaf_login_pending';
      const p = GM_getValue(K, null);
      if (!p || !p.auto || p.tried || Date.now() - p.ts > 5 * 60000) return; // Login von Hand → nichts tun
      const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      const q = (sel) => document.querySelector(sel);
      let user = null, pw = null;
      for (let i = 0; i < 40 && !(user && pw); i++) { user = q('[data-e2e="input-username"] input'); pw = q('[data-e2e="input-password"] input[type="password"]'); await sl(500); }
      await sl(2500); // Passwort-Manager füllen lassen
      const report = (msg) => GM_setValue('jaf_login_result', { token: p.token, ok: false, msg, ts: Date.now() });
      if (!user || !pw) { report('Login-Formular nicht gefunden'); return; }
      if (!user.value || !pw.value) { report('Benutzername/Passwort nicht ausgefüllt'); return; }
      GM_setValue(K, Object.assign({}, p, { tried: Date.now() }));
      const cb = q('[data-e2e="checkbox-autologin"] input[type="checkbox"]');
      if (cb && !cb.checked) { cb.click(); await sl(300); }
      // Cloudflare-Prüfung (Turnstile) abwarten, falls vorhanden
      for (let i = 0; i < 40; i++) { const t = q('input[name="cf-turnstile-response"]'); if (!t || t.value) break; await sl(500); }
      const btn = q('j-button[data-e2e="button-submit"]');
      const inner = btn && btn.shadowRoot && btn.shadowRoot.querySelector('button');
      if (inner) inner.click(); else if (btn) btn.click(); else { report('Login-Button nicht gefunden'); return; }
      await sl(20000);
      if (location.hostname === 'identity.joyclub.com') report('Login nicht abgeschlossen (z. B. Cloudflare-Prüfung oder falsche Daten)');
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
    SEARCH_IGNORE: false,   // Mitgliedersuche: true = Treffer ignorieren, false = nur Statistik („würden ignoriert“)
    IGNORE_LIMIT: 1000,     // JOYclub behält nur so viele Sperren (die ältesten fallen sonst still heraus)
    MYJOY_FIRST_MAX: 1000,  // Profilbesucher / „Mögen mich“: beim ersten Scan höchstens so viele Karten
    // Rangfolge der Quellen (höchste zuerst): eine höhere Quelle ersetzt eine niedrigere, nie umgekehrt
    SOURCE_RANK: ['Likes', 'Besucher', 'Party', 'Gruppen', 'Suche', 'Sync'],

    MAX_AGE: 49,            // Mitglieder, die ÄLTER als dieser Wert sind, werden blockiert
    WARN_AGE: 29,           // Farben: bis WARN_AGE grün, darüber hellorange, genau MAX_AGE (1 Jahr vor der Grenze) dunkelorange
    ONLY_TYPES: ['Mann', 'Transmann', 'Non-binary', 'Transvestit', 'Männer-Paar'],   // nur diese Profiltypen ignorieren (z. B. 'Mann', 'Frau', 'Paar', 'Transfrau' …)
    COUPLE_MODE: 'any',     // Paare: 'any' = eine Person zu alt reicht, 'all' = beide müssen zu alt sein
    // Gemischte Paare (Frau + Mann; JOYclub zeigt zuerst das Alter der Frau, dann das des Mannes):
    // NICHT nach MAX_AGE, sondern nur, wenn die Frau COUPLE_AGE_GAP oder mehr Jahre jünger ist als der Mann.
    COUPLE_RULE_TYPES: ['Paar'],
    COUPLE_AGE_GAP: 18,
    COUPLE_BOTH_MIN_AGE: 60,  // Paare werden außerdem ignoriert, wenn BEIDE so alt oder älter sind („Geronto-Paar“)

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
    // {quelle} = "Suche" (Mitgliedersuche)
    NOTE_TEXT: 'Alter Sack ({quelle}) geblockt am {datum} um {uhrzeit}',
    // gemischte Paare, die wegen des Altersunterschieds (COUPLE_AGE_GAP) ignoriert werden
    COUPLE_NOTE_TEXT: 'Sugar Daddy ({quelle}) ignoriert am {datum} um {uhrzeit}',
    // Paare, bei denen beide COUPLE_BOTH_MIN_AGE oder älter sind
    GERONTO_NOTE_TEXT: 'Geronto-Paar ({quelle}) ignoriert am {datum} um {uhrzeit}',

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
    // neue Reiter der Gästeliste (statt „Männer“), nach Anmelde-Alter
    GUEST_TABS: [
      { key: 'jung', label: 'Jungschwänze' },   // bis WARN_AGE
      { key: 'mid', label: 'Schwänze' },         // WARN_AGE+1 … MAX_AGE
      { key: 'opa', label: 'Opas' },             // über MAX_AGE (oder ohne Altersangabe)
    ], // Opa-Scan ignoriert über die Profilseiten – nur so wird die Profilnotiz gespeichert
    MOD_NOTE_TEXT: 'Whitelist: Moderator der Gruppe "{gruppe}"',
    // eigene Notiz-Zeilen des Skripts (werden bei entblockten Moderatoren entfernt) – „geblockt“ und „blockiert“
    OWN_NOTE_RE: /^\s*(?:Alter Sack|Sugar Daddy|Geronto-Paar)(?:\s*\([^)]*\))?\s+(?:geblockt|blockiert|ignoriert)\s+am\s+\S+\s+um\s+\S+\s*$/i,
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
  // ==========================================================
  // ---------- Einstellungen im Skript-Speicher ----------
  // Je Einstellung: gültiger Wert + zuletzt gesehener Quelltext-Wert. Ändert man den Wert im Quelltext, gilt ab dann
  // dieser (auch wenn vorher auf der Seite „Opa-Schutz“ etwas anderes gespeichert war). Solange der Quelltext-Wert
  // unverändert bleibt, gilt der gespeicherte Wert. Listen werden als Ganzes verglichen.
  const SETTING_KEYS = ['DRY_RUN', 'DEBUG', 'SEARCH_IGNORE', 'IGNORE_LIMIT', 'MYJOY_FIRST_MAX', 'MAX_AGE', 'WARN_AGE', 'ONLY_TYPES', 'COUPLE_MODE',
    'COUPLE_AGE_GAP', 'COUPLE_BOTH_MIN_AGE', 'WHITELIST', 'WRITE_NOTE', 'NOTE_REQUIRED', 'SOURCE_RANK'];
  const K_SETTINGS = 'jaf_settings'; // { KEY: { value, src } }
  const SOURCE_DEFAULTS = {};        // Werte laut Quelltext
  (function applyStoredSettings() {
    const st = GM_getValue(K_SETTINGS, {}) || {};
    let ch = false;
    for (const k of SETTING_KEYS) {
      const src = JSON.stringify(CONFIG[k]);
      SOURCE_DEFAULTS[k] = JSON.parse(src);
      const e = st[k];
      if (e && e.src === src && e.value !== undefined) CONFIG[k] = JSON.parse(JSON.stringify(e.value));
      else { st[k] = { value: JSON.parse(src), src }; ch = true; }
    }
    // Quellen, die im gespeicherten Wert fehlen (neue Skript-Version), hinten anhängen
    for (const q of SOURCE_DEFAULTS.SOURCE_RANK) if (!CONFIG.SOURCE_RANK.includes(q)) CONFIG.SOURCE_RANK.push(q);
    if (ch) GM_setValue(K_SETTINGS, st);
  })();
  const storedSettings = () => GM_getValue(K_SETTINGS, {}) || {};
  function saveSettings(values) {
    const st = storedSettings();
    for (const [k, v] of Object.entries(values)) {
      if (!SETTING_KEYS.includes(k)) continue;
      st[k] = { value: JSON.parse(JSON.stringify(v)), src: JSON.stringify(SOURCE_DEFAULTS[k]) };
    }
    GM_setValue(K_SETTINGS, st);
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
  const typeAllowed = (t) => CONFIG.ONLY_TYPES.some((x) => norm(x).replace(/[-\s]/g, '') === norm(t).replace(/[-\s]/g, ''));
  const handledType = (t) => typeAllowed(t) || CONFIG.COUPLE_RULE_TYPES.some((x) => norm(x).replace(/[-\s]/g, '') === norm(t).replace(/[-\s]/g, ''));
  const GENDER_NAMES = { 1: 'Mann', 2: 'Frau', 3: 'Paar', 7: 'Transfrau' };

  // andere Profiltypen merken (Debug-Info): { Typ: [Namen …] }
  // gespeicherte Typen, ohne die inzwischen erlaubten (alte Einträge aus früheren Einstellungen)
  const getTypes = () => {
    const t = GM_getValue(K_TYPES, {});
    let changed = false;
    for (const k of Object.keys(t)) if (handledType(k)) { delete t[k]; changed = true; }
    if (changed) GM_setValue(K_TYPES, t);
    return t;
  };
  function noteType(type, name) {
    if (!type || handledType(type)) return;
    const t = getTypes();
    const list = t[type] || (t[type] = []);
    if (!list.includes(name)) { list.push(name); GM_setValue(K_TYPES, t); }
  }
  function typesSummary() {
    const t = getTypes();
    const parts = Object.keys(t).sort().map((k) => `${k}: ${t[k].length}`);
    return parts.length ? 'Andere Profiltypen (übersprungen): ' + parts.join(', ') : 'Andere Profiltypen: noch keine';
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
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
  const getLock = () => GM_getValue(K_LOCK, null);
  const lockedByOther = () => { const l = getLock(); return l && l.owner !== TAB_ID && Date.now() - l.ts < LOCK_TTL ? l : null; };
  const ownsLock = () => { const l = getLock(); return !!(l && l.owner === TAB_ID); };
  async function acquireLock(what) {
    if (lockedByOther()) return false;
    GM_setValue(K_LOCK, { owner: TAB_ID, ts: Date.now(), what, url: location.href });
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 150)); // Gleichzeitiger Zugriff: wer zuletzt schrieb, gewinnt
    const l = getLock();
    return !!(l && l.owner === TAB_ID);
  }
  function releaseLock() { if (ownsLock()) GM_setValue(K_LOCK, null); }
  function lockNotice(l) {
    const age = Math.round((Date.now() - l.ts) / 1000);
    return `🔒 Ein anderer Tab arbeitet gerade (${l.what || 'beschäftigt'}, vor ${age} s aktiv) – hier wird nur markiert.`;
  }

  // ---------- Whitelist (fest + automatisch) ----------
  const K_WHITE = 'jaf_whitelist';   // { normName: { name, url, reasons: [..], modGroups: [{ key, name }], since } }
  const MOD_PREFIX = 'Moderator der Gruppe ';
  const getDynWhite = () => {
    const w = GM_getValue(K_WHITE, {});
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
    if (ch) GM_setValue(K_WHITE, w);
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
    GM_setValue(K_WHITE, w);
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
    if (ch) GM_setValue(K_WHITE, w);
    return former;
  }
  const dynReasons = (e) => (e.reasons || []).concat((e.modGroups || []).map((g) => MOD_PREFIX + g.name));
  const idOf = (p) => (String(p || '').match(/\/(?:profile|my)\/(\d+)\./) || [])[1] || '';
  // Whitelist auch über die Profil-ID (Namen können sich ändern – der Teil hinter der ID in der URL ist oft ein alter Name)
  let _wIdCache = { t: 0, set: new Set() };
  // gelernte Profil-Links der Whitelist-Mitglieder (feste Einträge haben im Skript nur den Namen)
  const K_WHITE_URLS = 'jaf_white_urls'; // { normName: { name, url, id, seen } }
  const getWhiteUrls = () => GM_getValue(K_WHITE_URLS, {});
  // beim Sehen eines Profils (Profilseite, Gästeliste, Karten): fehlenden Link/ID der Whitelist ergänzen
  function learnWhiteUrl(name, path) {
    if (!name || !path || !CONFIG.PROFILE_PATH_RE.test(path)) return;
    const k = norm(name);
    const id = idOf(path);
    const url = location.origin + path;
    const isStatic = WHITELIST.some((e) => norm(e.name) === k);
    const w = getDynWhite();
    const dyn = w[k];
    if (dyn && (!dyn.url || !dyn.id)) { if (!dyn.url) dyn.url = url; if (!dyn.id) dyn.id = id; GM_setValue(K_WHITE, w); _wIdCache.t = 0; }
    if (!isStatic) return;
    const m = getWhiteUrls();
    if (m[k] && m[k].id === id) return;
    m[k] = { name, url, id, seen: new Date().toISOString() };
    GM_setValue(K_WHITE_URLS, m);
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
    GM_setValue(K_WHITE, w);
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
    GM_setValue(K_WHITE, w);
    return isNew;
  }
  function whiteReason(name) {
    const k = norm(name);
    const reasons = WHITELIST.filter((e) => norm(e.name) === k).map((e) => e.reason);
    const d = getDynWhite()[k];
    if (d) reasons.push(...dynReasons(d));
    return reasons.join('; ');
  }

  const getState = () => GM_getValue(K_STATE, { running: false, queue: [], count: 0 });
  const setState = (s) => GM_setValue(K_STATE, Object.assign({}, s, { ts: Date.now() }));
  const resetState = () => GM_setValue(K_STATE, { running: false, queue: [], count: 0, ts: Date.now() });
  const K_LOG = 'jaf_log';           // { path: { name, url, ages, type, source, method, ts } } – vom Skript ignoriert
  const K_IGNORED = 'jaf_ignored';   // { path: { name, url, id } } – echte Ignorierliste von JOYclub (Abgleich)
  const K_IGNORED_TS = 'jaf_ignored_ts';
  const getLog = () => {
    const l = GM_getValue(K_LOG, null);
    if (l) return l;
    // einmalige Übernahme der alten Erledigt-Liste (nur Pfade)
    const m = {};
    for (const p of GM_getValue(K_DONE, [])) {
      const mm = p.match(/\/profile\/\d+\.([^/]+)\.html/);
      m[p] = { name: mm ? mm[1] : '', url: location.origin + p, method: 'Profil (alt)', ts: 0 };
    }
    GM_setValue(K_LOG, m);
    return m;
  };
  const getIgnored = () => GM_getValue(K_IGNORED, {});
  // vom Skript ignoriert und nicht wieder entblockt
  const getDone = () => Object.entries(getLog()).filter(([, r]) => !r.unblocked).map(([p]) => p);
  // bereits ignoriert = vom Skript ignoriert (nicht entblockt) ODER auf der echten Ignorierliste
  const isBlocked = (path, log_ = getLog(), ign = getIgnored()) => !!((log_[path] && !log_[path].unblocked) || ign[path]);
  const addGroup = (arr, g) => { arr = Array.isArray(arr) ? arr.slice() : []; if (g && !arr.includes(g)) arr.push(g); return arr; };
  // Rangfolge der Quellen (CONFIG.SOURCE_RANK): höher stehende ersetzt niedrigere; ohne Quelle = ganz unten
  const srcRank = (s) => { const i = CONFIG.SOURCE_RANK.indexOf(s || ''); return i < 0 ? 99 : i; };
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
      if (ak) { const a = Object.assign({}, acc[ak]); if (applySighting(a, source, d, 'seenSrc', 'seen')) { acc[ak] = a; ac = true; } }
    }
    if (lc) GM_setValue(K_LOG, l);
    if (ac) GM_setValue(K_ACCOUNTS, acc);
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
    if (info.seen) l[p].seen = info.seen;
    if (info.fromWatch) l[p].vorgemerkt = true;
    if (info.formerMod) l[p].formerMod = true;
    const accOnline = (GM_getValue('jaf_accounts', {})[p] || {}).online;
    if (accOnline) l[p].online = accOnline;
    GM_setValue(K_LOG, l);
    // Zähler der JOYclub-Ignorierliste mitführen (für das Limit)
    const ign = getIgnored();
    if (!ign[p]) { ign[p] = { name: info.name || '', url: info.url || location.origin + p, id: idOf(p) }; GM_setValue(K_IGNORED, ign); }
    removeFromWatch(p);
    if (info.ages && info.ages.length) recordAccounts([{ path: p, url: info.url, name: info.name, ages: info.ages, type: info.type }]);
  };
  function markUnblocked(path, info, reason) {
    const l = getLog();
    const e = l[path] || { name: info.name || '', url: info.url || location.origin + path, ages: [], type: '', source: '', method: 'nur JOYclub-Ignorierliste', ts: 0 };
    e.unblocked = { ts: Date.now(), reason };
    l[path] = e;
    GM_setValue(K_LOG, l);
    const ign = getIgnored();
    if (ign[path]) { delete ign[path]; GM_setValue(K_IGNORED, ign); }
  }
  const getFailed = () => GM_getValue(K_FAILED, {});
  const setFailed = (p, why) => { const f = getFailed(); f[p] = why; GM_setValue(K_FAILED, f); };
  const clearFailed = (p) => { const f = getFailed(); if (p in f) { delete f[p]; GM_setValue(K_FAILED, f); } };

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
    const m = GM_getValue(K_GENDER, {});
    const e = m[num] || (m[num] = {});
    if ((e[title] || 0) >= 20) return; // genug Belege – nicht ständig schreiben
    e[title] = (e[title] || 0) + 1;
    GM_setValue(K_GENDER, m);
  }
  function typeFromGender(num) {
    const e = (GM_getValue(K_GENDER, {}) || {})[num];
    const titles = e ? Object.keys(e) : [];
    if (titles.length === 1) return titles[0];
    if (titles.length > 1) return titles.sort((a, b) => e[b] - e[a]).join('|'); // mehrdeutig
    return GENDER_NAMES[num] || `Typ ${num || '?'}`;
  }
  const normType = (t) => norm(t).replace(/[-\s]/g, '');
  const isCoupleRuleType = (t) => String(t || '').split('|').every((x) => CONFIG.COUPLE_RULE_TYPES.some((c) => normType(c) === normType(x)));
  // gemischtes Paar: [Frau, Mann] – Frau mindestens COUPLE_AGE_GAP Jahre jünger?
  const coupleGap = (ages) => (ages && ages.length === 2 ? ages[1] - ages[0] : null);
  const gapHit = (c) => isCoupleRuleType(c.type) && coupleGap(c.ages) != null && coupleGap(c.ages) >= CONFIG.COUPLE_AGE_GAP;
  const bothOld = (ages) => !!(ages && ages.length === 2 && ages.every((a) => a >= CONFIG.COUPLE_BOTH_MIN_AGE));
  // Grund, ein (gemischtes) Paar zu ignorieren: 'Altersunterschied' (Sugar Daddy) | 'Geronto-Paar' | null
  function coupleReason(ages) {
    const gap = coupleGap(ages);
    if (gap != null && gap >= CONFIG.COUPLE_AGE_GAP) return 'Altersunterschied';
    if (bothOld(ages)) return 'Geronto-Paar';
    return null;
  }
  const typeOkFor = (t) => String(t || '').split('|').some((x) => typeAllowed(x));
  // Soll dieses Mitglied ignoriert werden? (ohne Prüfung „bereits ignoriert“)
  // white === null → Whitelist bewusst nicht berücksichtigen (z. B. „würde die Kriterien erfüllen“)
  function shouldBlock(c, white = whiteList()) {
    if (white !== null && isWhiteMember(c, white)) return false;
    if (isCoupleRuleType(c.type)) return !!coupleReason(c.ages);
    return typeOkFor(c.type) && isTooOld(c.ages);
  }

  // Profiltyp auf der Profilseite: <div class="profile-base-info__line-2"><span>Mann</span> …
  function profileType() {
    const el = document.querySelector('.profile-base-info__line-2 > span');
    // vom Skript umbenannt (Jungschwanz/Schwanz/Opa) → eigentlicher Typ ist „Mann“
    if (el && el.textContent.trim()) return ['Jungschwanz', 'Schwanz', 'Opa'].includes(el.textContent.trim()) ? 'Mann' : el.textContent.trim();
    const lab = [...document.querySelectorAll('[aria-label^="Profil von "]')].map((e) => e.getAttribute('aria-label'))[0];
    return lab ? (lab.split(',')[1] || '').trim() : '';
  }

  // maßgebliches Alter (bei Paaren wie COUPLE_MODE: 'any' = ältere Person, 'all' = jüngere Person)
  const effAge = (ages) => (!ages.length ? null : CONFIG.COUPLE_MODE === 'all' ? Math.min(...ages) : Math.max(...ages));
  const COLORS = { white: '#ffffff', green: '#43a047', light: '#ffb74d', dark: '#ef6c00', red: '#e53935', grey: '#616161', done: '#757575' };
  function ageColor(ages) {
    const a = effAge(ages);
    if (a == null || a <= CONFIG.WARN_AGE) return COLORS.green;
    if (a >= CONFIG.MAX_AGE) return COLORS.dark; // nur noch 1 Jahr bis zur Grenze
    return COLORS.light;
  }

  function isTooOld(ages) {
    if (!ages.length) return false;
    return CONFIG.COUPLE_MODE === 'all' ? ages.every((x) => x > CONFIG.MAX_AGE) : ages.some((x) => x > CONFIG.MAX_AGE);
  }

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

  // kind: false/'' = Alter Sack, 'Altersunterschied' (oder true) = Sugar Daddy, 'Geronto-Paar' = Geronto-Paar
  function noteText(source, kind = false, ts = Date.now()) {
    const d = new Date(ts);
    let t = kind === 'Geronto-Paar' ? CONFIG.GERONTO_NOTE_TEXT : kind ? CONFIG.COUPLE_NOTE_TEXT : CONFIG.NOTE_TEXT;
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

  async function writeNote(source, couple = false) {
    const ed = await openNoteEditor();
    if (ed.error) return { ok: false, msg: ed.error };
    const old = (ed.ta.value || ed.host.getAttribute('value') || '').trim();
    const text = noteText(source, couple);
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
    const removed = lines.filter((l) => CONFIG.OWN_NOTE_RE.test(l));
    const kept = lines.filter((l) => !CONFIG.OWN_NOTE_RE.test(l)).filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1));
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
      if (!ages.length || !shouldBlock(c)) {
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
      // Paar wegen Altersunterschied → „Sugar Daddy“, beide alt → „Geronto-Paar“, sonst „Alter Sack“
      const pAges = profileAges().length ? profileAges() : cur.ages;
      const couple = (cur.reason === 'Altersunterschied' || cur.reason === 'Geronto-Paar') ? cur.reason
        : (isCoupleRuleType(ptype || cur.type) ? coupleReason(pAges) : false);
      try { note = await writeNote(cur.source || s.source, couple); } catch (e) { note = { ok: false, msg: 'Notiz-Fehler: ' + e.message }; }
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
    GM_setValue(K_IGNORED, list);
    GM_setValue(K_IGNORED_TS, Date.now());
  }
  // Ignorierliste im Hintergrund abrufen (ohne die Seite zu verlassen)
  async function syncIgnoreList(force = false) {
    if (!force && Date.now() - GM_getValue(K_IGNORED_TS, 0) < CONFIG.IGNORE_SYNC_MIN * 60000) return getIgnored();
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
    log(msg + (s.opa ? ' Zurück zum Opa-Scan …' : ' Zurück zur Suche …'));
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
  const getAccounts = () => GM_getValue(K_ACCOUNTS, {});

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

  // items: [{ path, url?, name?, ages: [..], type? }]
  function recordAccounts(items) {
    if (!items || !items.length) return;
    const onlineUpdates = [];
    const acc = getAccounts();
    const today = isoDay(new Date());
    let changed = false;
    for (const it of items) {
      if (!it || !it.path || !it.ages || !it.ages.length) continue;
      const old = acc[it.path];
      const rec = old ? Object.assign({}, old) : { first: today };
      if (it.name) rec.name = it.name;
      if (it.name && whiteList().includes(norm(it.name))) learnWhiteUrl(it.name, it.path);
      rec.url = it.url || location.origin + it.path;
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
      if (JSON.stringify(rec) !== JSON.stringify(old)) { acc[it.path] = rec; changed = true; }
    }
    if (changed) GM_setValue(K_ACCOUNTS, acc);
    // „zuletzt online“ auch in den zutreffenden Listen (ignoriert / vorgemerkt) speichern
    if (onlineUpdates.length) {
      const l = GM_getValue(K_LOG, {}), w = GM_getValue(K_WATCH, {});
      let lc = false, wc = false;
      for (const [path, o] of onlineUpdates) {
        if (l[path]) { l[path].online = o; lc = true; }
        if (w[path]) { w[path].online = o; wc = true; }
      }
      if (lc) GM_setValue(K_LOG, l);
      if (wc) GM_setValue(K_WATCH, w);
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
      if (ages.length) items.push({ path: cleanPath(location.pathname), name: profileName(), ages, type: profileType(), online: profileOnline(), signs: profileSigns(document, ages) });
    }
    recordAccounts(items);
  }
  setInterval(() => { try { recordVisibleAccounts(); } catch (e) { console.warn('[Alter-Filter] Geburtsjahr', e); } }, 5000);

  // ---------- Vormerkliste: genau MAX_AGE alt (1 Jahr vor der Grenze) ----------
  // { path: { name, url, type, ages, persons: [{lo,hi}], added } }
  const K_WATCH = 'jaf_watch';
  const getWatch = () => GM_getValue(K_WATCH, {});
  function updateWatch(cards, log_ = getLog(), ign = getIgnored(), source = '') {
    const w = getWatch();
    const white = whiteList();
    const today = isoDay(new Date());
    const acc = getAccounts();
    let changed = false;
    for (const c of cards) {
      const a = effAge(c.ages);
      const eligible = a === CONFIG.MAX_AGE && typeOkFor(c.type) && !isCoupleRuleType(c.type) && !white.includes(norm(c.name)) && !isBlocked(c.path, log_, ign);
      if (eligible) {
        const persons = ((acc[c.path] || {}).persons) || c.ages.map((x) => birthRange(x));
        const prev = w[c.path];
        const online = (prev && prev.online) || (acc[c.path] || {}).online;
        const rec = { name: c.name, url: c.url || location.origin + c.path, type: c.type, ages: c.ages, persons, added: (prev && prev.added) || today,
          source: betterSource(prev && prev.source, source || 'Suche') };
        if (online) rec.online = online;
        if (JSON.stringify(rec) !== JSON.stringify(prev)) { w[c.path] = rec; changed = true; }
      } else if (w[c.path] && (isBlocked(c.path, log_, ign) || white.includes(norm(c.name)) || !typeOkFor(c.type) || isCoupleRuleType(c.type))) {
        delete w[c.path]; changed = true;
      }
    }
    if (changed) GM_setValue(K_WATCH, w);
  }
  function removeFromWatch(path) {
    const w = getWatch();
    if (w[path]) { delete w[path]; GM_setValue(K_WATCH, w); }
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
      const over = persons.map((pr) => surelyOlderThan(pr, CONFIG.MAX_AGE));
      const isDue = CONFIG.COUPLE_MODE === 'all' ? over.every(Boolean) : over.some(Boolean);
      if (isDue) due.push({ path, url: r.url || location.origin + path, name: r.name, ages: r.ages || [], type: r.type || '', source: r.source || 'Suche', fromWatch: true });
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

  // vom Skript ignorierte Mitglieder
  function exportList() {
    const log_ = getLog();
    const acc = getAccounts();
    const rows = Object.entries(log_).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0)).map(([path, r]) => {
      const d = r.ts ? new Date(r.ts) : null;
      const by = ((acc[path] || {}).persons || []).map(birthYear);
      return [
        r.name || (acc[path] || {}).name || '', r.url || location.origin + path, (r.ages || []).join('+'),
        by[0] || '', by[1] || '', r.type || (acc[path] || {}).type || '', r.source || '', r.vorgemerkt ? 'ja' : '', r.formerMod ? 'ja' : '', r.method || '',
        d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}` : '',
        d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '',
        r.unblocked ? `entblockt am ${fmtTs(r.unblocked.ts)} (${r.unblocked.reason})` : 'ignoriert',
        ...onlineCols(r.online || (acc[path] || {}).online), deDay(r.seen),
      ];
    });
    downloadCsv('blockierte-opas',
      ['Name', 'Profil-Link', 'Alter (beim Ignorieren)', 'Geburtsjahr (Person 1 / Frau bei Paar)', 'Geburtsjahr 2 (Mann bei Paar)', 'Profiltyp', 'Quelle', 'vorgemerkt', 'ehem. Moderator', 'Methode', 'Datum', 'Uhrzeit',
        'Status', 'Zuletzt online (Angabe)', 'Angabe abgerufen am', 'zuletzt gesehen (Quelle)'], rows);
    return rows.length;
  }

  function exportWatch() {
    const w = getWatch();
    const rows = Object.entries(w).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '')).map(([path, r]) => {
      const by = (((getAccounts()[path] || {}).persons) || r.persons || []).map(birthYear);
      return [r.name || '', r.url || location.origin + path, r.type || '', (r.ages || []).join('+'), by[0] || '', by[1] || '', r.added || '',
        r.source || '',
        ...onlineCols(r.online || (getAccounts()[path] || {}).online)];
    });
    downloadCsv('vorgemerkt', ['Name', 'Profil-Link', 'Profiltyp', 'Alter (beim Vormerken)', 'Geburtsjahr (Person 1 / Frau bei Paar)', 'Geburtsjahr 2 (Mann bei Paar)', 'vorgemerkt seit',
      'gefunden in', 'Zuletzt online (Angabe)', 'Angabe abgerufen am'], rows);
    return rows.length;
  }

  function exportGroups() {
    const m = getGroupDone();
    const rows = Object.entries(m).sort((a, b) => a[1].ts - b[1].ts).map(([k, e]) => [e.name, `${location.origin}${CONFIG.GROUPS_PATH}/${k}/`, fmtTs(e.ts)]);
    downloadCsv('gruppen', ['Gruppe', 'Link', 'zuletzt komplett bearbeitet'], rows);
    return rows.length;
  }

  function exportWhitelist() {
    const dyn = getDynWhite();
    const acc = getAccounts();
    const urlOf = (name) => { const k = norm(name); const l = whiteUrlOf(name); if (l) return l; const e = Object.entries(acc).find(([, r]) => norm(r.name) === k); return e ? e[1].url : ''; };
    const rows = [];
    for (const e of WHITELIST) rows.push([e.name, urlOf(e.name), whiteReason(e.name), 'fest im Skript', '', ((dyn[norm(e.name)] || {}).modGroups || []).map((g) => g.name).join('; '), '', '']);
    for (const [k, e] of Object.entries(dyn)) {
      if (WHITELIST.some((x) => norm(x.name) === k)) continue;
      const pl = (arr) => (arr || []).map((x) => `${x.name} (${x.date})`).join('; ');
      rows.push([e.name, e.url || urlOf(e.name), dynReasons(e).join('; '), 'automatisch', e.since ? fmtTs(Date.parse(e.since)) : '',
        (e.modGroups || []).map((g) => g.name).join('; '), pl(e.vipParties), pl(e.parties)]);
    }
    downloadCsv('whitelist', ['Name', 'Profil-Link', 'Begründung', 'Herkunft', 'seit', 'moderiert Gruppe(n)', 'VIP-Gast bei Party', 'freigeschaltet bei Party'], rows);
    return rows.length;
  }

  // alle jemals gesehenen Konten mit Geburtsjahr
  function exportAccounts() {
    const acc = getAccounts();
    const log_ = getLog();
    const ign = getIgnored();
    const white = whiteList();
    const rows = Object.entries(acc).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '')).map(([path, r]) => {
      const by = (r.persons || []).map(birthYear);
      return [
        r.name || '', r.url || location.origin + path, r.type || '', by[0] || '', by[1] || '',
        log_[path] ? (log_[path].unblocked ? 'entblockt' : 'ja') : '', ign[path] ? 'ja' : '',
        white.includes(norm(r.name)) ? whiteReason(r.name) || 'ja' : '', r.first || '', r.last || '',
        ...onlineCols(r.online), r.seenOnline ? fmtTs(r.seenOnline) : '',
        deDay(r.seen), SOURCE_LABELS[r.seenSrc] || r.seenSrc || '', (r.persons || []).map((x) => x.sign || '').join(' / ').replace(/^ \/ $/, ''),
      ];
    });
    downloadCsv('joyclub-konten',
      ['Name', 'Profil-Link', 'Profiltyp', 'Geburtsjahr (Person 1 / Frau bei Paar)', 'Geburtsjahr 2 (Mann bei Paar)', 'vom Skript ignoriert', 'auf Ignorierliste', 'Whitelist (Begründung)', 'zuerst erfasst', 'zuletzt erfasst',
        'Zuletzt online (Angabe)', 'Angabe abgerufen am', 'zuletzt als „online“ gesehen (Karte)', 'zuletzt gesehen (Datum)', 'zuletzt gesehen in', 'Sternzeichen'], rows);
    return rows.length;
  }

  // ---------- Kopfzeilen-Badge „blockierte Opas“ ----------
  const OPA_PATH = 'M3408 12790 c-235 -43 -487 -227 -651 -477 -33 -50 -47 -63 -67 -63 -37 0 -119 -24 -168 -49 -102 -52 -148 -120 -201 -298 -48 -164 -73 -337 -69 -483 3 -112 6 -131 30 -180 15 -30 41 -64 58 -75 29 -19 30 -23 30 -92 0 -39 -3 -74 -8 -77 -4 -2 -86 -1 -182 4 -273 12 -411 -7 -566 -80 -227 -105 -387 -276 -518 -551 -127 -266 -203 -574 -253 -1019 -22 -199 -25 -1016 -5 -1265 20 -240 60 -603 82 -750 12 -82 15 -131 9 -133 -6 -3 -6 -8 0 -16 7 -8 -3 -51 -30 -136 -109 -339 -191 -737 -235 -1140 -22 -191 -25 -693 -6 -845 33 -258 72 -434 158 -699 234 -721 431 -1986 554 -3566 12 -145 22 -265 23 -266 1 -1 52 -16 114 -34 98 -29 113 -36 121 -59 45 -127 347 -276 743 -366 622 -140 1209 -69 1131 137 l-10 28 168 0 c273 0 423 30 492 100 62 62 50 120 -43 204 -59 53 -250 150 -377 191 l-84 27 6 77 c35 439 116 2702 166 4611 15 587 12 548 44 595 65 94 130 255 161 400 9 44 19 87 21 97 4 13 23 4 102 -49 201 -134 411 -220 617 -252 109 -16 209 -22 222 -14 18 13 32 57 39 126 l6 64 69 -35 69 -36 0 -156 c0 -170 4 -186 60 -215 37 -19 64 -19 104 0 55 26 61 45 66 214 l5 155 28 7 27 7 0 -2924 c0 -3216 -5 -2965 60 -2999 62 -32 136 -10 164 49 15 31 16 279 16 3052 l0 3017 25 64 c99 246 -33 525 -286 604 -33 10 -83 19 -110 19 -27 0 -60 6 -72 14 -37 24 -132 36 -367 46 -124 6 -272 15 -330 20 -98 9 -467 74 -476 83 -3 2 -9 91 -14 198 -27 543 -53 829 -125 1389 l-6 45 53 35 c141 94 296 282 422 513 20 37 42 67 49 67 7 0 46 -17 87 -38 59 -29 78 -45 93 -74 30 -59 36 -140 25 -308 -13 -195 -6 -359 17 -424 26 -71 104 -148 178 -175 200 -73 369 48 421 302 9 42 16 81 16 86 0 17 -87 71 -148 92 -72 26 -220 28 -308 5 -34 -9 -66 -16 -72 -16 -5 0 -11 71 -15 173 -4 137 -9 186 -26 239 -28 89 -88 155 -173 193 -35 15 -65 29 -66 31 -2 1 10 39 27 83 40 105 106 337 122 433 11 69 16 78 40 88 77 32 105 336 42 457 -16 31 -21 68 -27 190 -4 84 -14 199 -21 255 -14 100 -13 104 6 120 23 19 35 74 25 113 -6 24 -10 26 -39 21 l-32 -6 -19 82 c-10 46 -35 137 -57 203 -171 527 -466 883 -824 994 -79 25 -249 36 -327 21z';
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
          `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g></svg>`;
      }
      const lower = b.querySelector('.page-header-info-element__lower-text');
      if (lower) lower.textContent = 'blockierte Opas';
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
  const getGroupDone = () => GM_getValue(K_GROUP_DONE, {});
  function markGroupDone(g) {
    const m = getGroupDone();
    m[g.key] = { name: g.name, ts: Date.now() };
    GM_setValue(K_GROUP_DONE, m);
  }
  const getOpa = () => GM_getValue(K_OPA, { running: false });
  const setOpa = (o) => GM_setValue(K_OPA, Object.assign({}, o, { ts: Date.now() }));
  const isGroupsPage = () => cleanPath(location.pathname) === CONFIG.GROUPS_PATH;
  const groupsUrl = () => location.origin + CONFIG.GROUPS_PATH + '/';
  const opaStale = (o) => !o.ts || Date.now() - o.ts > 10 * 60 * 1000;

  function opaPanel(title) {
    const p = panel();
    p.innerHTML = `<b>Opa-Scan</b>${title ? ' – ' + title : ''}${CONFIG.DRY_RUN ? ' – <span style="color:#ffb300">Testmodus</span>' : ''}<br>`;
    p.appendChild(btn('Opa-Scan stoppen', opaStop));
    return p;
  }
  function opaStop() {
    const o = getOpa();
    setOpa(Object.assign(o, { running: false }));
    const st = getState();
    if (st.running) setState({ running: false, queue: [], count: 0 });
    log('Opa-Scan gestoppt.');
    if (!isGroupsPage()) setTimeout(() => { location.href = groupsUrl(); }, 1500);
  }
  const opaLog = (msg) => { log(msg); const o = getOpa(); o.log = (o.log || []).concat(`${fmtTs(Date.now())} ${msg}`).slice(-200); GM_setValue(K_OPA, o); };

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
          `style="width:10px;height:10px;fill:currentColor" aria-hidden="true"><g transform="translate(0,1280) scale(0.1,-0.1)">` +
          `<path d="${OPA_PATH}"/></g></svg>`;
        box.style.display = box.style.display || 'flex';
        box.insertBefore(b, slot);
      }
      if (b.getAttribute('content') !== txt) {
        b.setAttribute('content', txt);
        b.setAttribute('aria-label', d ? `Opa-Scan zuletzt komplett: ${fmtTs(e.ts)}` : 'Opa-Scan: noch nie komplett bearbeitet');
        b.title = d ? `Opa-Scan zuletzt komplett bearbeitet: ${fmtTs(e.ts)}` : 'Opa-Scan: noch nie komplett bearbeitet';
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
      `style="width:16px;height:16px;fill:currentColor" aria-hidden="true"><g transform="translate(0,1280) scale(0.1,-0.1)">` +
      `<path d="${OPA_PATH}"/></g></svg> <span>Opa-Scan starten</span>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); opaStart(); });
    anchor.after(b);
    return true;
  }

  async function opaStart() {
    const other = lockedByOther();
    if (other) { alert(lockNotice(other).replace(' – hier wird nur markiert.', '. Der Opa-Scan kann erst danach gestartet werden.')); return; }
    if (!(await acquireLock('Opa-Scan'))) { alert('Ein anderer Tab hat gerade begonnen zu arbeiten. Bitte später erneut versuchen.'); return; }
    const o = getOpa();
    if (o.running && !opaStale(o)) { if (!confirm('Ein Opa-Scan läuft bereits. Neu beginnen?')) return; }
    if (!confirm(`Opa-Scan starten?\n\nFür jede deiner Gruppen: Moderatoren auf die Whitelist (ggf. entblocken), ` +
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
    for (const t of CONFIG.ONLY_TYPES.concat(CONFIG.COUPLE_RULE_TYPES)) {
      const k = Object.keys(CONFIG.GROUP_GENDER_FILTER).find((x) => normType(x) === normType(t));
      (k ? CONFIG.GROUP_GENDER_FILTER[k] : ['m', 'w', 'p', 'd']).forEach((g) => want.add(g));
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
    console.log('[Alter-Filter][Opa-Scan] Typen in', cur.name, seen);
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
          opaLog(`Opa-Scan fertig: ${st.groups || 0} Gruppen, ${st.mods || 0} Moderatoren, ${st.unblocked || 0} entblockt, ` +
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
        let hits = members.filter((m) => shouldBlock(m, white) && !isBlocked(m.path, log_, ign))
          .map((m) => ({ path: m.path, url: m.url, name: m.name, ages: m.ages, type: m.type,
            source: sourceOf('Gruppen-Mitgliederliste') || 'Gruppen', reason: isCoupleRuleType(m.type) ? coupleReason(m.ages) : 'Alter' }));
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
        else if (g) opaLog(`${g.name}: nicht komplett bearbeitet – kommt beim nächsten Opa-Scan wieder früh dran.`);
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
    if (ch) GM_setValue(K_WATCH, w);
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
        if (o.running) { const p = panel(); p.innerHTML = '<b>Opa-Scan</b><br>'; log(lockNotice(other)); return true; }
        return false;
      }
      if (!o.running) {
        if (o.phase === 'done' && o.log && o.log.length) { const p = panel(); p.innerHTML = '<b>Opa-Scan</b><br>'; log(o.log[o.log.length - 1]); }
        return false;
      }
      if (getState().running) return false; // Ignorier-Lauf hat Vorrang
      if (opaStale(o) && o.phase !== 'ignore') { // nach einem (langen) Ignorier-Lauf immer automatisch weiter
        const p = panel();
        p.innerHTML = `<b>Opa-Scan</b> – unterbrochen bei Gruppe ${(o.gi || 0) + 1}/${(o.groups || []).length}<br>`;
        p.appendChild(btn('Fortsetzen', async () => {
          if (!(await acquireLock('Opa-Scan'))) { log(lockNotice(getLock())); return; }
          setOpa(getOpa()); opaStep();
        }));
        p.appendChild(btn('Abbrechen', () => { setOpa(Object.assign(getOpa(), { running: false })); log('Opa-Scan abgebrochen.'); }));
        log('Der Opa-Scan wurde unterbrochen.');
        return true;
      }
      if (!(await acquireLock('Opa-Scan'))) { log(lockNotice(getLock())); return true; }
      opaStep();
      return true;
    }
    if (!o.running || opaStale(o)) return false;
    if (lockedByOther()) return false; // gehört einem anderen Tab
    if (isIgnorePage() && o.phase === 'unblock' && !getState().running) { await acquireLock('Opa-Scan: entblocken'); opaUnblockOnIgnorePage(); return true; }
    const idOf = (p) => (String(p).match(/\/profile\/(\d+)\./) || [])[1];
    if (isProfilePage() && o.phase === 'notes' && o.notes && o.notes[0] && idOf(location.pathname) === idOf(o.notes[0].path)) {
      await acquireLock('Opa-Scan: Notiz'); opaNoteOnProfile(); return true;
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
  const getPeeks = () => GM_getValue(K_PEEK, {});
  const setPeeks = (p) => GM_setValue(K_PEEK, p);
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
    const jobs = GM_getValue(K_NOTEJOBS, {});
    const j = jobs[id];
    if (!j) return false;
    delete jobs[id]; GM_setValue(K_NOTEJOBS, jobs);
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
    const jobs = GM_getValue(K_NOTEJOBS, {});
    const line = party.kind === 'Besucher' ? CONFIG.VISIT_NOTE_TEXT.replace('{datum}', party.date)
      : party.kind === 'Likes' ? CONFIG.LIKE_NOTE_TEXT.replace('{datum}', party.date)
        : party.search ? CONFIG.SEARCH_NOTE_TEXT.replace('{datum}', party.date)
          : CONFIG.PARTY_NOTE_TEXT.replace('{party}', party.name).replace('{datum}', party.date);
    jobs[info.id] = { line, name: info.name, created: Date.now() };
    GM_setValue(K_NOTEJOBS, jobs);
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
  const isMixedCouple = (t) => isCoupleRuleType(t) && !/\|/.test(t || '');
  const isManReg = (g) => normType(g.type) === normType('Mann');

  // Farbe/Schild nach der ANMELDUNG (Punkte 25–27)
  function guestStyle(g, ctx) {
    if (!g.anon && (g.name || g.id) && isWhiteMember(g, ctx.white)) return { color: COLORS.white, txt: 'Whitelist', fg: '#000' };
    const age = g.ages.length ? Math.max(...g.ages) : null;
    if (isMixedCouple(g.type) || /paar/i.test(g.type)) {
      if (isMixedCouple(g.type) && g.ages.length === 2) {
        const gap = g.ages[1] - g.ages[0];
        if (gap >= CONFIG.COUPLE_AGE_GAP) return { color: COLORS.red, txt: `Unterschied ${gap}` };
        if (bothOld(g.ages)) return { color: COLORS.red, txt: 'Geronto-Paar' };
        if (g.ages[1] > CONFIG.MAX_AGE) return { color: COLORS.dark, txt: `Unterschied ${gap} · Mann zu alt` };
        return { color: COLORS.grey, txt: `Unterschied ${gap}`, dashed: true };
      }
      if (g.ages.length === 1 && isMixedCouple(g.type)) {
        const acc = ctx.acc[g.path];
        if (acc && normType(acc.type) === normType('Mann') && g.ages[0] > CONFIG.MAX_AGE) return { color: COLORS.dark, txt: 'Mann zu alt' };
        return { color: COLORS.grey, txt: 'Paar (1 Alter)', dashed: true };
      }
      if (typeOkFor(g.type)) return { color: age > CONFIG.MAX_AGE ? COLORS.red : ageColor(g.ages), txt: g.type };
      return { color: COLORS.grey, txt: g.type || 'Paar', dashed: true };
    }
    if (isManReg(g) || typeOkFor(g.type)) {
      if (age == null || age > CONFIG.MAX_AGE) return { color: COLORS.red, txt: age == null ? 'Opa (ohne Alter)' : 'Opa' };
      const c = ageColor(g.ages);
      return { color: c, txt: '', fg: c === COLORS.light ? '#000' : '#fff' };
    }
    return { color: COLORS.grey, txt: g.type || '', dashed: true };
  }
  function guestCategory(g) {
    const age = g.ages.length ? Math.max(...g.ages) : null;
    if (age == null || age > CONFIG.MAX_AGE) return 'opa';
    return age <= CONFIG.WARN_AGE ? 'jung' : 'mid';
  }

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
      card.style.outline = `${st.dashed ? 2 : 3}px ${st.dashed ? 'dashed' : 'solid'} ${st.color}`;
      card.style.position = 'relative';
      let b = li.querySelector('.jaf-badge');
      if (!b) { b = document.createElement('div'); b.className = 'jaf-badge'; card.appendChild(b); }
      // Schild: nur Alter (Originalinhalt) + Gründe fürs Ignorieren (rot)
      const extra = [g.ages.join('+') || '?', st.color === COLORS.red ? st.txt : ''].filter(Boolean).join(' · ');
      const blk = g.id && ctx.blocked.get(g.id);
      b.textContent = extra + (blk ? ' · ignoriert' : '');
      b.style.cssText = `position:absolute;top:6px;left:6px;z-index:5;font:bold 11px system-ui;padding:2px 6px;border-radius:3px;pointer-events:none;` +
        `background:${st.color};color:${st.fg || (st.color === COLORS.white ? '#000' : '#fff')}`;
      // Kreuz über dem Bild + Popup statt Link
      const av = li.querySelector('.date_avatar');
      const x = li.querySelector('.jaf-x');
      if (blk && av && !x) { av.style.position = 'relative'; av.insertAdjacentHTML('beforeend', `<div class="jaf-x">${X_SVG}</div>`); }
      if (!blk && x) x.remove();
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
    const kind = (e.reason === 'Altersunterschied' || e.reason === 'Geronto-Paar') ? e.reason
      : (isCoupleRuleType(e.type) ? (coupleReason(e.ages) || false) : false);
    return noteText(e.source, kind, e.ts);
  }
  // Profilnotiz im Hintergrund lesen: eigene Zeile, sonst ganze Notiz, sonst ''
  async function fetchProfileNote(url) {
    const doc = await fetchDoc(url);
    const host = [...doc.querySelectorAll('j-setting-textarea')].find((e) => /profilnotiz/.test(norm(e.getAttribute('label') || '')));
    if (!host) return null;
    const ta = host.querySelector('textarea');
    const txt = (host.getAttribute('value') || (ta && (ta.value || ta.textContent)) || host.textContent || '').trim();
    const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
    const own = lines.filter((l) => CONFIG.OWN_NOTE_RE.test(l));
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
    `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g></svg>`;

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
  const getChecked = () => GM_getValue(K_CHECKED, {});
  function setChecked(id, info) {
    if (!id || !info || !info.type || !(info.ages || []).length) return;
    const m = getChecked();
    m[id] = { name: info.name || '', type: info.type, ages: info.ages, ts: Date.now() };
    GM_setValue(K_CHECKED, m);
  }
  // Entscheidung aus dem Cache: 'block' | 'ok' | null (unbekannt/zu alt/Geburtstag dazwischen)
  // Clubs, Shops usw.: JOYclub verlinkt sie in nachgeladenen Gästelisten als /my/<id> – sieht aus wie ein Profil, ist aber keins
  function setNonProfile(id, name, kind) {
    if (!id) return;
    const m = getChecked();
    m[id] = { name: name || '', nonProfile: kind || 'kein Mitgliederprofil', ts: Date.now() };
    GM_setValue(K_CHECKED, m);
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
  function cachedDecision(g, white) {
    const e = getChecked()[g.id];
    if (!e || e.nonProfile || !e.ages || Date.now() - e.ts > CHECK_MAX_AGE_MS) return null;
    const yrs = (Date.now() - e.ts) / (365.25 * 86400000);
    const lo = e.ages.map((a) => a + Math.floor(yrs)), hi = e.ages.map((a) => a + Math.ceil(yrs));
    const c = (ages) => shouldBlock({ name: g.name, path: g.path, type: e.type, ages }, white);
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
    const src = sourceOf('Party-Gästeliste') || 'Party';
    if (isMixedCouple(g.type) && g.ages.length === 2) {
      const gap = g.ages[1] - g.ages[0];
      const why = coupleReason(g.ages);
      if (why) return { kind: 'ignore', why: why === 'Geronto-Paar' ? 'Geronto-Paar' : `Paar, Unterschied ${gap}`,
        item: { path: g.path, url: g.url, name: g.name, ages: g.ages, type: g.type, source: src, reason: why } };
      return { kind: 'skip', why: `Paar, Unterschied ${gap}` };
    }
    // Anmeldungen als Frau werden nicht geprüft (Scan würde sonst zu lange dauern)
    if (normType(g.type) === normType('Frau')) return { kind: 'skip', why: 'Anmeldung als Frau' };
    // Profil nur prüfen, wenn schon das Alter in der Anmeldung die Kriterien erfüllt (sonst überspringen)
    const regAge = g.ages.length ? Math.max(...g.ages) : null;
    if (regAge != null && regAge <= CONFIG.MAX_AGE) return { kind: 'skip', why: `Anmeldung ${g.ages.join('+')}` };
    const wl = ctx.ignoreWhite ? null : ctx.white;
    const cd = cachedDecision(g, wl);
    if (cd && cd.r === 'ok') return { kind: 'skip', why: `geprüft: ${cd.type}, ${cd.ages.join('+')}` };
    if (cd && cd.r === 'block') return { kind: 'ignore', why: `geprüft: ${cd.type}, ${cd.ages.join('+')}`, verified: true,
      item: { path: g.path, url: g.url, name: g.name, ages: cd.ages, type: cd.type, source: src, verify: true } };
    const k = ctx.acc[g.path] || Object.entries(ctx.acc).find(([p]) => idOf(p) === g.id)?.[1];
    if (k && k.type && (k.persons || []).length) {
      const maxAges = k.persons.map((r) => { const [y, mo, d] = r.lo.split('-').map(Number); const now = new Date(); let a = now.getFullYear() - y; if (now < new Date(now.getFullYear(), mo - 1, d)) a--; return a; });
      if (!shouldBlock({ name: g.name, path: g.path, type: k.type, ages: maxAges }, wl)) return { kind: 'skip', why: `bekannt: ${k.type}, höchstens ${maxAges.join('+')}` };
    }
    return { kind: 'verify', why: 'wird auf dem Profil geprüft', item: { path: g.path, url: g.url, name: g.name, ages: [], type: (k && k.type) || '', source: src, verify: true } };
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
    li.setAttribute('role', 'presentation'); li.title = 'Opa-Liste'; li.className = 'jaf-opa-list-tab';
    li.innerHTML = '<a href="#jaf_opa_list" data-toggle="tab" aria-controls="jaf_opa_list">Opa-Liste</a>';
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
        '<span style="font-size:20px">⏳</span><div><b>Opa-Scan läuft (Testlauf)</b><br><span class="jaf-ol-step"></span></div></div>';
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
    if (ch) { GM_setValue(K_WHITE, w); _wIdCache.t = 0; }
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
    if (!(await acquireLock('Opa-Liste anwenden'))) { msg.textContent = lockNotice(getLock()); return; }
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
    const removed = lines.filter((l) => CONFIG.OWN_NOTE_RE.test(l));
    if (!removed.length) { await cancelNote(ed); return { ok: true, msg: 'keine Skript-Notiz vorhanden' }; }
    const value = lines.filter((l) => !CONFIG.OWN_NOTE_RE.test(l)).join('\n').replace(/^\n+|\n+$/g, '');
    const marker = value.split('\n').filter((l) => l.trim())[0] || '';
    const r = await commitNote(ed, value, marker, removed.map((x) => x.trim()), true);
    if (r.ok) r.msg = `Notiz bereinigt (${removed.length} Zeile(n) entfernt)`;
    return r;
  }

  // ---- Gästeliste unsichtbar komplett laden: dieselbe Event-Seite in einem verdeckten Frame ----
  // Der Frame (Name „jaf-bg-<m|alle>“) öffnet dort den Reiter, lädt per Scrollen/„Mehr Ergebnisse“ alles nach
  // und schickt die Einträge (HTML) zurück. Auf der sichtbaren Seite ändert sich bis dahin nichts.
  function bgLoadGuests(gender, onProgress, timeoutMs = 180000) {
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
  // „Männer“ → Jungschwänze / Schwänze / Opas;  „Paare“ → Paare / Geronto-Paare.
  // Der Original-Reiter bleibt sichtbar, bis die neuen fertig sind.
  // Geronto-Paar (Anzeige + AWO): beide ≥ COUPLE_BOTH_MIN_AGE, bei nur einer Angabe diese ≥ …, oder Sugar Daddy
  function isGerontoReg(g) {
    if (g.ages.length === 2) return bothOld(g.ages) || (isMixedCouple(g.type) && g.ages[1] - g.ages[0] >= CONFIG.COUPLE_AGE_GAP);
    if (g.ages.length === 1) return g.ages[0] >= CONFIG.COUPLE_BOTH_MIN_AGE;
    return false;
  }
  const GUEST_SPLITS = [
    { gender: 'm', tabs: CONFIG.GUEST_TABS, cat: (g) => guestCategory(g) },
    { gender: 'p', tabs: [{ key: 'paare', label: 'Paare' }, { key: 'geronto', label: 'Geronto-Paare' }], cat: (g) => (isGerontoReg(g) ? 'geronto' : 'paare') },
  ];
  const guestSplit = { m: null, p: null }; // geladene Einträge je Liste (für den AWO-Faktor)

  async function setupGuestTabs() {
    if (window.__jafSplits) return;
    if (!document.querySelector('#guest_list a[href="#guest_m"], #guest_list a[href="#guest_p"]')) return;
    window.__jafSplits = 'loading';
    renderAwo();
    for (const sp of GUEST_SPLITS) {
      const oLink = document.querySelector(`#guest_list a[href="#guest_${sp.gender}"]`);
      const oPane = document.getElementById('guest_' + sp.gender);
      if (!oLink || !oPane) { guestSplit[sp.gender] = []; continue; } // z. B. keine Paare angemeldet
      let items;
      try { items = htmlToItems(await bgLoadGuests(sp.gender)); } catch (e) {
        console.warn(`[Alter-Filter] Liste „${sp.gender}“ im Hintergrund nicht ladbar – Original-Reiter bleibt.`, e);
        guestSplit[sp.gender] = false;
        continue;
      }
      guestSplit[sp.gender] = items.map(parseGuest);
      const oLi = oLink.closest('li');
      const content = oPane.parentElement;
      const groups = {};
      sp.tabs.forEach((t) => { groups[t.key] = []; });
      for (const li of items) groups[sp.cat(parseGuest(li))].push(li);
      let after = oLi;
      for (const t of sp.tabs) {
        const id = `jaf_guest_${t.key}`;
        const pane = document.createElement('div');
        pane.id = id; pane.className = 'tab-pane cards user_cards ov_h mb5'; pane.setAttribute('role', 'tabpanel');
        const ul = document.createElement('ul');
        ul.className = 'date_list ov_h'; ul.setAttribute('data-max-columns', '4');
        groups[t.key].forEach((li) => ul.appendChild(li));
        pane.appendChild(ul);
        content.appendChild(pane);
        const tli = document.createElement('li');
        tli.className = 'jaf-guest-tab'; tli.setAttribute('role', 'presentation'); tli.title = t.label;
        tli.innerHTML = `<a href="#${id}" data-toggle="tab" aria-controls="${id}">${t.label} <span>(${groups[t.key].length})</span></a>`;
        tli.querySelector('a').addEventListener('click', (e) => {
          e.preventDefault();
          oLi.parentElement.querySelectorAll(':scope > li').forEach((x) => x.classList.remove('active'));
          tli.classList.add('active');
          content.querySelectorAll(':scope > .tab-pane').forEach((x) => x.classList.remove('active', 'in'));
          pane.classList.add('active', 'in');
        });
        after.after(tli); after = tli;
      }
      const wasActive = oLi.classList.contains('active');
      oLi.style.display = 'none';
      if (wasActive) oLi.nextElementSibling.querySelector('a').click();
      decorateGuests();
      renderAwo();
    }
    window.__jafSplits = 'done';
    renderAwo();
  }

  // ---- AWO-Faktor ----
  // Männer: erwartete Erscheinende = ⌈Jung/3⌉ + ⌈Schwänze·2/3⌉ + alle Opas; Opa-Anteil = Opas / erwartet.
  // Paare: Geronto-Anteil = Geronto-Paare / alle Paare. AWO = ⅔·Männer + ⅓·Paare (fehlt eine Gruppe: der andere Anteil allein).
  function computeAwo(men, couples) {
    const m = { jung: 0, mid: 0, opa: 0 };
    (men || []).forEach((g) => { m[guestCategory(g)]++; });
    const exp = Math.ceil(m.jung / 3) + Math.ceil(m.mid * 2 / 3) + m.opa;
    const menN = m.jung + m.mid + m.opa;
    const menShare = exp ? m.opa / exp : null;
    const pN = (couples || []).length;
    const ger = (couples || []).filter(isGerontoReg).length;
    const pShare = pN ? ger / pN : null;
    let value = null;
    if (menN && pN) value = (2 / 3) * menShare + (1 / 3) * pShare;
    else if (menN) value = menShare;
    else if (pN) value = pShare;
    return { value, m, exp, menShare, pN, ger, pShare };
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
    const ready = guestSplit.m !== null && guestSplit.p !== null && window.__jafSplits === 'done';
    if (!ready) { li.textContent = 'AWO …'; li.title = 'wird berechnet, sobald die Gästeliste im Hintergrund geladen ist'; return; }
    if (guestSplit.m === false || guestSplit.p === false) { li.textContent = 'AWO ?'; li.title = 'Gästeliste konnte im Hintergrund nicht geladen werden'; return; }
    const a = computeAwo(guestSplit.m, guestSplit.p);
    li.textContent = `AWO ${pct(a.value)}`;
    const ac = awoColor(a.value == null ? null : a.value * 100);
    Object.assign(li.style, { background: a.value == null ? '' : ac.bg, color: a.value == null ? '' : ac.fg, borderRadius: '6px', padding: '6px 10px', marginTop: '4px' });
    li.title = `Männer: ${a.m.opa} Opas von ${a.exp} erwarteten (⌈${a.m.jung}/3⌉ + ⌈${a.m.mid}·2/3⌉ + ${a.m.opa}) = ${pct(a.menShare)}\n` +
      `Paare: ${a.ger} Geronto-Paare von ${a.pN} = ${pct(a.pShare)}\n` +
      (a.menShare != null && a.pShare != null ? 'AWO = ⅔ · Männer + ⅓ · Paare' : 'nur eine Gruppe angemeldet → deren Anteil');
    // speichern (für spätere Auswertung/Export)
    const id = eventIdOf(location.pathname);
    if (id && a.value != null) {
      const ev = getEvents();
      ev[id] = Object.assign(ev[id] || {}, { awo: Math.round(a.value * 1000) / 10, awoTs: Date.now() });
      GM_setValue(K_EVENTS, ev);
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
  const getEvents = () => GM_getValue(K_EVENTS, {});
  function saveEventsFromList(list) {
    const m = getEvents();
    for (const e of list) {
      const o = m[e.id] || {};
      const upd = { url: e.url, date: e.date, location: e.location, status: e.status, hidden: e.hidden };
      for (const k of Object.keys(upd)) if (upd[k] === undefined || upd[k] === '') delete upd[k];
      m[e.id] = Object.assign(o, upd, { name: o.name || e.name || e.slugName });
    }
    GM_setValue(K_EVENTS, m);
  }
  function updateEventBadges() {
    if (isRegistrationsPage()) updateRegAwo();
    const m = getEvents();
    for (const e of readAppointments()) {
      const d = m[e.id] && m[e.id].doneTs;
      let b = e.a.querySelector('.jaf-event-badge');
      if (!b) {
        b = document.createElement('div');
        b.className = 'jaf-event-badge';
        b.style.cssText = 'position:absolute;top:6px;right:6px;z-index:5;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.75);color:#fff;' +
          'font:bold 11px system-ui;padding:2px 6px;border-radius:10px;pointer-events:none';
        e.a.style.position = 'relative';
        e.a.appendChild(b);
      }
      const txt = d ? fmtDay(d) : '--.--.----';
      if (b.dataset.txt !== txt) {
        b.dataset.txt = txt;
        b.innerHTML = `<svg viewBox="0 0 640 1280" width="10" height="12" style="fill:currentColor"><g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g></svg><span></span>`;
        b.querySelector('span').textContent = txt;
        b.title = d ? `Opa-Scan zuletzt komplett: ${fmtTs(d)}` : 'Opa-Scan: noch nie komplett bearbeitet';
      }
      // zweiter Badge darunter: gespeicherter AWO-Faktor
      const awo = m[e.id] && m[e.id].awo;
      let w = e.a.querySelector('.jaf-awo-badge');
      if (!w) {
        w = document.createElement('div');
        w.className = 'jaf-awo-badge';
        w.style.cssText = 'position:absolute;top:28px;right:6px;z-index:5;background:rgba(0,0,0,.75);color:#fff;' +
          'font:bold 11px system-ui;padding:2px 6px;border-radius:10px;pointer-events:none';
        e.a.appendChild(w);
      }
      const wt = `AWO ${awo == null ? '–' : String(awo).replace('.', ',') + ' %'}`;
      const wc = awoColor(awo == null ? null : awo);
      w.style.background = wc.bg; w.style.color = wc.fg;
      if (w.textContent !== wt) {
        w.textContent = wt;
        w.title = awo == null ? 'AWO-Faktor noch nicht berechnet' : `AWO-Faktor, berechnet am ${fmtTs(m[e.id].awoTs || 0)}`;
      }
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
      `style="width:16px;height:16px;fill:currentColor" aria-hidden="true"><g transform="translate(0,1280) scale(0.1,-0.1)">` +
      `<path d="${OPA_PATH}"/></g></svg> <span>Opa-Scan starten</span>`;
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
        slugName: slug.replace(/_/g, ' '),
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
        if (awo == null) { if (w) w.remove(); continue; }
        if (!w) {
          w = document.createElement('span');
          w.className = 'jaf-reg-awo';
          w.style.cssText = 'display:inline-block;margin-left:6px;padding:0 6px;border-radius:8px;font-weight:bold;white-space:nowrap';
          t.appendChild(w);
        }
        const ts = ev.awoTs || ev.doneTs;
        const txt = `AWO ${String(awo).replace('.', ',')} %${ts ? ` (${fmtTs(ts)})` : ''}`;
        const c = awoColor(awo);
        w.style.background = c.bg; w.style.color = c.fg;
        if (w.textContent !== txt) { w.textContent = txt; w.title = ts ? `AWO-Faktor, berechnet am ${fmtTs(ts)}` : 'AWO-Faktor'; }
      }
    }
  }
  function insertRegOpaButton() {
    if (document.querySelector('.jaf-reg-opa-btn')) return true;
    const past = document.querySelector('button.button_past_events');
    if (!past) return false;
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Opa-Scan starten';
    b.className = 'jaf-reg-opa-btn btn-flat-special-light btn btn-default';
    b.innerHTML = `<svg viewBox="0 0 640 1280" width="9" height="16" style="fill:currentColor;vertical-align:-2px" aria-hidden="true">` +
      `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g></svg> <span class="btn-text">Opa-Scan starten</span>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); bgEvStart(); });
    // vor die Button-Gruppe setzen (eigener Button mit Abstand, nicht angeklebt)
    const grp = past.closest('.btn-group') || past;
    b.style.marginRight = '8px';
    grp.parentElement.insertBefore(b, grp);
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
  const getEv = () => GM_getValue(K_EVSCAN, { running: false });
  const setEv = (o) => GM_setValue(K_EVSCAN, Object.assign({}, o, { ts: Date.now() }));
  const evStale = (o) => !o.ts || Date.now() - o.ts > 10 * 60 * 1000;
  const evLog = (msg) => { log(msg); const o = getEv(); o.log = (o.log || []).concat(`${fmtTs(Date.now())} ${msg}`).slice(-200); GM_setValue(K_EVSCAN, o); };
  function evPanel(title) {
    const p = panel();
    p.innerHTML = `<b>Opa-Scan Partys</b>${title ? ' – ' + title : ''}${CONFIG.DRY_RUN ? ' – <span style="color:#ffb300">Testmodus</span>' : ''}<br>`;
    p.appendChild(btn('Opa-Scan stoppen', evStop));
    return p;
  }
  function evStop() {
    const o = getEv();
    setEv(Object.assign(o, { running: false }));
    const st = getState();
    if (st.running && st.evscan) setState({ running: false, queue: [], count: 0 });
    log('Opa-Scan gestoppt.');
    if (o.returnUrl && !isAppointmentsPage() && !isRegistrationsPage()) setTimeout(() => { location.href = o.returnUrl; }, 1500);
  }

  // normaler Scan mit Seitenwechsel (Rückfall, wenn der Hintergrund-Scan nicht geht) – ohne Browser-Meldungen
  async function evStart() {
    const p = panel(); p.innerHTML = '<b>Opa-Scan Partys</b><br>';
    const why = scanBlockedReason();
    if (why) { log(why); return; }
    if (!(await visGuard())) { log('Abgebrochen.'); return; }
    if (!(await acquireLock('Opa-Scan Partys'))) { log('Ein anderer Tab hat gerade begonnen zu arbeiten. Bitte später erneut versuchen.'); return; }
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
        const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { doneTs: Date.now() }); GM_setValue(K_EVENTS, m);
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
      evLog(`Opa-Scan Partys fertig: ${st.events || 0} Partys, ${st.vip || 0} VIP-Gäste, ${st.guests || 0} Anmeldungen gelesen, ${st.hits || 0} zum Prüfen/Ignorieren übergeben.`);
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
    const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { name: info.name || e.name, start: info.start || (m[e.id] || {}).start }); GM_setValue(K_EVENTS, m);
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
            const ign = getIgnored(); for (const p of Object.keys(ign)) if (idOf(p) === String(m.id)) delete ign[p]; GM_setValue(K_IGNORED, ign);
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
        insertRegOpaButton();
        saveEventsFromList(readRegistrations());
      } else {
        if (!isOwnAppointments()) return false;
        await waitFor(eventsHeadline, 10000);
        insertEventOpaButton();
        saveEventsFromList(readAppointments());
      }
      updateEventBadges();
      const nFail = GM_getValue(K_EVFAIL, []).length;
      if (nFail && !o.running) {
        const p = panel(); p.innerHTML = '<b>Opa-Scan Partys</b><br>';
        p.appendChild(btn(`Fehlschläge exportieren (${nFail})`, () => exportEvFailures()));
        p.appendChild(btn('Fehlschläge löschen', () => { GM_setValue(K_EVFAIL, []); p.remove(); }));
      }
      if (!window.__jafEvTimer) window.__jafEvTimer = setInterval(() => {
        if (isAppointmentsPage()) { insertEventOpaButton(); updateEventBadges(); }
        else if (isRegistrationsPage()) { insertRegOpaButton(); updateEventBadges(); }
      }, 3000);
      if (!o.running) {
        if (o.phase === 'done' && o.log && o.log.length) { const p = panel(); if (!p.querySelector('button')) p.innerHTML = '<b>Opa-Scan Partys</b><br>'; log(o.log[o.log.length - 1]); }
        return false;
      }
      if (getState().running) return false;
      const other = lockedByOther();
      if (other) { const p = panel(); p.innerHTML = '<b>Opa-Scan Partys</b><br>'; log(lockNotice(other)); return true; }
      if (evStale(o) && o.phase !== 'ignore') {
        const p = panel();
        p.innerHTML = `<b>Opa-Scan Partys</b> – unterbrochen bei Party ${(o.ei || 0) + 1}/${(o.events || []).length}<br>`;
        p.appendChild(btn('Fortsetzen', async () => {
          if (!(await acquireLock('Opa-Scan Partys'))) { log(lockNotice(getLock())); return; }
          setEv(Object.assign(getEv(), { ownerTab: TAB_ID })); evStep();
        }));
        p.appendChild(btn('Abbrechen', () => { setEv(Object.assign(getEv(), { running: false })); log('Opa-Scan abgebrochen.'); }));
        log('Der Opa-Scan der Partys wurde unterbrochen.');
        return true;
      }
      if (!(await acquireLock('Opa-Scan Partys'))) { log(lockNotice(getLock())); return true; }
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
      if (owned) { await acquireLock('Opa-Scan Partys'); evScanEventPage(); return true; }
      return false;
    }
    return false;
  }

  // ---------- „Mann“ → Jungschwanz / Schwanz / Opa, Opa-Symbol statt Geschlechtssymbol ----------
  const manLabel = (age) => (age == null || age > CONFIG.MAX_AGE ? 'Opa' : age <= CONFIG.WARN_AGE ? 'Jungschwanz' : 'Schwanz');
  const OPA_ICON_SVG = (w, h) => `<svg class="jaf-opa-icon" viewBox="0 0 640 1280" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" ` +
    `style="width:${w}px;height:${h}px;fill:currentColor" aria-hidden="true"><g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g></svg>`;
  // Geschlechtssymbol (<j-gender-icon>, Inhalt im Shadow DOM) beschriften und bei Opas austauschen
  function labelGenderIcon(gi, label) {
    const sr = gi && gi.shadowRoot;
    if (!sr) return;
    const box = sr.querySelector('.j-gender-icon');
    if (box && box.getAttribute('title') !== label) { box.setAttribute('title', label); box.setAttribute('aria-label', label); }
    const orig = sr.querySelector('svg:not(.jaf-opa-icon)');
    const mine = sr.querySelector('svg.jaf-opa-icon');
    if (label === 'Opa') {
      if (orig && !mine) {
        const r = orig.getBoundingClientRect();
        const h = Math.round(r.height || +orig.getAttribute('height') || 16) || 16;
        orig.style.display = 'none';
        orig.insertAdjacentHTML('afterend', OPA_ICON_SVG(Math.max(6, Math.round(h / 2)), h));
      }
    } else {
      if (mine) mine.remove();
      if (orig) orig.style.display = '';
    }
  }
  // Text „Mann“ in einem Element ersetzen (nur Textknoten, ganze Wörter)
  function replaceManText(el, label) {
    if (!el) return;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) if (/\bMann\b/.test(w.currentNode.nodeValue)) nodes.push(w.currentNode);
    nodes.forEach((n) => { n.nodeValue = n.nodeValue.replace(/\bMann\b/g, label); });
  }
  // Karten in Gäste- und Gruppen-Mitgliederlisten (li.date_card) – nach der Anmeldung bzw. dem Listeneintrag
  function relabelMenCards(root = document) {
    root.querySelectorAll('li.date_card').forEach((li) => {
      const g = parseGuest(li);
      if (!isManReg(g)) return;
      const label = manLabel(g.ages.length ? Math.max(...g.ages) : null);
      labelGenderIcon(li.querySelector('j-gender-icon'), label);
      replaceManText(li.querySelector('.date_info'), label);
    });
  }
  // Profilkopf: „Mann“ → Einstufung nach dem Profil-Alter, Symbol(e) im Kopf tauschen
  function relabelProfile() {
    const line2 = document.querySelector('.profile-base-info__line-2');
    if (!line2) return;
    const first = line2.querySelector('span');
    const type = first ? first.textContent.trim() : '';
    const ages = profileAges();
    const known = ['Mann', 'Jungschwanz', 'Schwanz', 'Opa'];
    if (!known.includes(type) || ages.length !== 1) return;
    const label = manLabel(ages[0]);
    document.querySelectorAll('.profile-base-info__line-2').forEach((l) => {
      const sp = l.querySelector('span');
      if (sp && known.includes(sp.textContent.trim()) && sp.textContent.trim() !== label) sp.textContent = label;
    });
    document.querySelectorAll('.profile-base-info j-gender-icon[universal-gender="1"], j-avatar j-gender-icon[universal-gender="1"]').forEach((gi) => labelGenderIcon(gi, label));
    const own = document.querySelector('j-gender-icon.profile-sed-card__gender-icon[universal-gender="1"]');
    if (own) labelGenderIcon(own, label);
  }
  // Mitgliedersuche: <j-member-card> (Symbol im Shadow DOM der Karte)
  function relabelSearchCards() {
    document.querySelectorAll('j-member-card[age]').forEach((card) => {
      const num = card.getAttribute('universal-gender');
      if (card.getAttribute('age2')) return; // Paare nicht
      const t = num === '1' ? 'Mann' : typeFromGender(num);
      if (normType(t) !== normType('Mann')) return;
      const gi = card.shadowRoot && card.shadowRoot.querySelector('j-gender-icon');
      labelGenderIcon(gi, manLabel(Number(card.getAttribute('age')) || null));
    });
  }
  const isGroupMembersPage = () => /^\/groups\/[^/]+\/mitglieder$/.test(cleanPath(location.pathname));
  setInterval(() => {
    try {
      if (isProfilePage()) relabelProfile();
      if (isEventPage() || isGroupMembersPage()) relabelMenCards();
      if (currentListPage() || isMemberSearchPage()) relabelSearchCards();
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
  const K_PAUSES = 'jaf_pauses';        // [{ since, until, end, text }]
  const LOGIN_RETRY_MS = 30 * 60000;
  // Uhrzeit aus dem Wartungstext („bis voraussichtlich 17 Uhr“, „17:30 Uhr“, „until approximately 5 pm“) → Zeitstempel oder null
  function parseUntil(txt) {
    const now = new Date();
    let h = null, m = 0;
    let mm = (txt || '').match(/bis\s+(?:voraussichtlich\s+|ca\.\s*|etwa\s+|circa\s+)*(\d{1,2})(?:[:.](\d{2}))?\s*Uhr/i);
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
    const g = GM_getValue(K_GATE, null);
    if (!g || !g.until || g.until <= Date.now()) return;
    const head = 'JOYclub ist vorübergehend nicht erreichbar';
    const pop = document.getElementById('jaf-bg-popup');
    const oldTitle = pop && pop.querySelector('.jaf-bg-title').textContent;
    if (pop) bgTitle('Opa-Scan pausiert', true);
    while (Date.now() < g.until) {
      if (bgScan && bgScan.stop) throw new Error('abgebrochen');
      const left = Math.ceil((g.until - Date.now()) / 60000);
      gateNotice(`${head} – nächster Versuch um ${fmtHM(g.until)} (noch ${left} min). Bis dahin kein Zugriff auf JOYclub.`);
      await sleep(Math.min(15000, Math.max(500, g.until - Date.now())));
      const g2 = GM_getValue(K_GATE, null);
      if (!g2 || g2.until !== g.until) break; // anderer Tab hat neu entschieden
    }
    if (pop && document.getElementById('jaf-bg-popup')) bgTitle(oldTitle || 'Opa-Scan läuft im Hintergrund', true);
  }
  // Seite war Wartung/Login: warten bzw. einloggen. Wirft bei Abbruch oder gescheitertem Login.
  async function handleGate(g, url) {
    if (g.type === 'maint') {
      const base = g.until || (Date.now() + 30 * 60000);
      const until = base + rand(5 * 60000, 10 * 60000);
      const prev = GM_getValue(K_GATE, null);
      if (!prev || !prev.until || prev.until < until) GM_setValue(K_GATE, { type: 'maint', until, text: g.text || '', since: Date.now() });
      const pauses = GM_getValue(K_PAUSES, []);
      pauses.push({ since: Date.now(), until, text: g.text || '' });
      GM_setValue(K_PAUSES, pauses.slice(-500));
      console.log('[Alter-Filter] Wartungsseite erkannt – Pause bis', fmtTs(until), g.text);
      await gateWaitStored();
      const pl = GM_getValue(K_PAUSES, []); if (pl.length) { pl[pl.length - 1].end = Date.now(); GM_setValue(K_PAUSES, pl); }
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
    const last = GM_getValue(K_LOGIN_TRY, 0);
    const auto = Date.now() - last >= LOGIN_RETRY_MS;
    if (auto) GM_setValue(K_LOGIN_TRY, Date.now());
    GM_setValue(K_LOGIN_PENDING, { token, auto, ts: Date.now() });
    const back = `${location.origin}/my_joy/feed/friends/?jaf_login=${token}`;
    const w = window.open(loginUrlFor(back), 'jaf-login', 'width=520,height=760');
    const manual = `bitte im geöffneten Fenster bei JOYclub anmelden – danach geht es automatisch weiter.`;
    let msg = !w ? 'Abgemeldet – das Login-Fenster wurde vom Browser blockiert. Bitte Popups für joyclub.de erlauben oder in einem anderen Tab anmelden – danach geht es automatisch weiter.'
      : auto ? 'Abgemeldet – melde im kleinen Fenster mit den gespeicherten Zugangsdaten an …'
        : `Abgemeldet – automatischer Login erst wieder ab ${fmtHM(last + LOGIN_RETRY_MS)}; ${manual}`;
    if (document.getElementById('jaf-bg-popup')) bgTitle('Opa-Scan pausiert', true);
    gateNotice(msg);
    const t0 = Date.now();
    let lastCheck = Date.now();
    for (;;) {
      if (bgScan && bgScan.stop) { try { if (w) w.close(); } catch (e) { /* egal */ } throw new Error('abgebrochen'); }
      const r = GM_getValue(K_LOGIN_RESULT, null);
      if (r && r.token === token) {
        if (r.ok) break;
        if (!r.shown) { GM_setValue(K_LOGIN_RESULT, Object.assign({}, r, { shown: true })); gateNotice(`Automatischer Login nicht möglich (${r.msg}) – ${manual}`); }
      }
      if (Date.now() - lastCheck > 60000) { lastCheck = Date.now(); if (!(await stillGuest())) break; }
      if (auto && Date.now() - t0 > 90000 && msg.startsWith('Abgemeldet – melde')) { msg = 'Automatischer Login nicht abgeschlossen – ' + manual; gateNotice(msg); }
      await sleep(3000);
    }
    try { if (w && !w.closed) w.close(); } catch (e) { /* egal */ }
    GM_setValue(K_LOGIN_PENDING, null);
    if (document.getElementById('jaf-bg-popup')) bgTitle('Opa-Scan läuft im Hintergrund', true);
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
      if (tok) { GM_setValue(K_LOGIN_RESULT, { token: tok, ok: true, ts: Date.now() }); if (window.name === 'jaf-login') setTimeout(() => window.close(), 500); }
      return false;
    }
    if (!scanActive()) return false;
    if (/^\/webauth\//.test(location.pathname)) return true; // Login-Weiterleitung läuft gerade
    const p = panel(); p.innerHTML = '<b>Alter-Filter</b><br>';
    if (g.type === 'maint') {
      const prev = GM_getValue(K_GATE, null);
      let until = prev && prev.until > Date.now() ? prev.until : 0;
      if (!until) { until = (g.until || Date.now() + 30 * 60000) + rand(5 * 60000, 10 * 60000); GM_setValue(K_GATE, { type: 'maint', until, text: g.text || '', since: Date.now() }); }
      log(`JOYclub ist vorübergehend nicht erreichbar. Der laufende Scan pausiert – nächster Versuch um ${fmtHM(until)} (Seite lädt dann neu).`);
      setTimeout(() => location.reload(), until - Date.now());
      return true;
    }
    // abgemeldet während eines Scans mit Seitenwechsel: über die Login-Seite zurück auf diese Seite (automatisch max. 1× in 30 min)
    const last = GM_getValue(K_LOGIN_TRY, 0);
    if (Date.now() - last < LOGIN_RETRY_MS) { log(`Abgemeldet – bitte bei JOYclub anmelden (automatischer Login erst wieder ab ${fmtHM(last + LOGIN_RETRY_MS)}). Danach geht der Scan weiter.`); return true; }
    GM_setValue(K_LOGIN_TRY, Date.now());
    GM_setValue(K_LOGIN_PENDING, { token: 'top', auto: true, ts: Date.now() });
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
    const job = GM_getValue(key, null);
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
        const kind = cur.kind || ((cur.reason === 'Altersunterschied' || cur.reason === 'Geronto-Paar') ? cur.reason
          : (isCoupleRuleType(ptype) && ages.length === 2 ? (coupleReason(ages) || false) : false));
        const line = noteText(cur.source || 'Sync', kind, cur.ts || Date.now());
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
      if (cur.verify && (!c.ages.length || !shouldBlock(c))) return res('skipped', `Profil geprüft (${c.type}, ${c.ages.join('+') || '?'} Jahre) – erfüllt die Kriterien nicht`);
      if (!cur.force && !typeOkFor(c.type) && !isCoupleRuleType(c.type)) return res('skipped', `Profiltyp „${c.type}“`);
      if (CONFIG.WRITE_NOTE) {
        const kind = (cur.reason === 'Altersunterschied' || cur.reason === 'Geronto-Paar') ? cur.reason : (isCoupleRuleType(c.type) ? coupleReason(c.ages) : false);
        const note = await writeNote(cur.source || job.source, kind);
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
    if (n.startsWith('jaf-bg-ms')) return msFrame();
    if (n.startsWith('jaf-bg-mj-')) return mjFrame();
    if (n === 'jaf-bg-reg') return regFrame();
    if (n === 'jaf-bg-grp') return grpFrame();
    return bgFrameMain(); // Gästeliste m/p/alle
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
  const visRun = () => GM_getValue(K_VIS_RUN, null);
  const visRunFresh = (r = visRun()) => !!(r && r.ts && Date.now() - r.ts < 2 * 60000);
  // während eines Vorgangs „unsichtbar“: hat sich jemand sichtbar geschaltet → zurück auf den vorherigen Status, 15 s warten
  async function visEnforce(v = lastVis.v) {
    const r = visRun();
    if (!r || r.mode !== 'invisible' || v !== 1) return false;
    const back = r.prev === 5 ? 5 : 3;
    console.log('[Alter-Filter] Sichtbar geschaltet während eines Vorgangs – schalte zurück auf', back);
    let ok = false;
    try { ok = await setVisibility(back); } catch (e) { /* egal */ }
    GM_setValue(K_VIS_RUN, Object.assign({}, r, { ts: Date.now() }));
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
  async function visGuard() {
    let v = visibilityFromDoc(document);
    if (v == null) { try { v = await fetchVisibility(); } catch (e) { v = null; } }
    if (v !== 1) { GM_setValue(K_VIS_RUN, { mode: 'invisible', prev: v === 5 ? 5 : 3, ts: Date.now() }); lastVis = { v, ts: Date.now() }; return true; }
    const c = await askPopup({ title: 'Achtung!', warn: true,
      lines: ['Du bist derzeit sichtbar eingeloggt.', 'Alle Mitglieder, deren Profile während dieses Vorgangs aufgerufen werden, sehen Dich als Besucher!', 'Trotzdem fortfahren?'],
      buttons: [{ label: 'Unsichtbar schalten und fortfahren', value: 'inv', primary: true }, { label: 'Sichtbar fortfahren', value: 'vis' }, { label: 'Abbrechen', value: null, focus: true }] });
    if (!c) return false;
    if (c === 'vis') { GM_setValue(K_VIS_RUN, { mode: 'visible', ts: Date.now() }); return true; }
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
    GM_setValue(K_VIS_RUN, { mode: 'invisible', prev: 3, ts: Date.now() });
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
      GM_setValue(K_VIS_RUN, Object.assign({}, visRun(), { mode: 'visible', ts: Date.now() }));
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
  function itemKind(x) {
    const reason = x && x.reason;
    if (reason === 'Altersunterschied') return 'sd';
    if (reason === 'Geronto-Paar') return 'geronto';
    if (x && isCoupleRuleType(x.type) && (x.ages || []).length === 2) {
      const r = coupleReason(x.ages);
      if (r === 'Altersunterschied') return 'sd';
      if (r === 'Geronto-Paar') return 'geronto';
    }
    return 'opa';
  }
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
  // Tage seit Überschreiten der Grenze: Opa = (MAX_AGE+1). Geburtstag der ältesten Person, Geronto = COUPLE_BOTH_MIN_AGE. Geburtstag des Mannes
  function daysOver(path, e, kind) {
    const ps = personsOf(path, e);
    let p = null, lim;
    if (kind === 'geronto') { p = ps[1] || ps[0]; lim = CONFIG.COUPLE_BOTH_MIN_AGE; } else {
      for (const x of ps) if (midOf(x) != null && (p == null || midOf(x) < midOf(p))) p = x;
      lim = CONFIG.MAX_AGE + 1;
    }
    const m = midOf(p);
    if (m == null) return Infinity; // ohne Alter ans Ende
    const b = new Date(m);
    return Math.floor((Date.now() - new Date(b.getFullYear() + lim, b.getMonth(), b.getDate()).getTime()) / 86400000);
  }
  function pickVictim(item) {
    const newRank = srcRank(item.source);
    const l = getLog(), ign = getIgnored();
    const ignIds = new Set(Object.keys(ign).map(idOf));
    const today = isoDay(new Date());
    const white = whiteList();
    const all = Object.entries(l)
      .filter(([p, e]) => !e.unblocked && CONFIG.PROFILE_PATH_RE.test(p) && ignIds.has(idOf(p)) && srcRank(e.source) >= newRank && !isWhiteMember({ name: e.name, path: p }, white) &&
        !(!e.source && /JOYclub-Ignorierliste/.test(e.method || ''))) // ohne Quelle nur von JOYclub übernommen = vermutlich von Hand gesperrt
      .map(([p, e]) => ({ p, e, r: srcRank(e.source), kind: itemKind(e) }));
    const ranks = [...new Set(all.map((x) => x.r))].sort((a, b) => b - a); // niedrigste Quelle zuerst
    const newKind = itemKind(item);
    const seenOf = (x) => x.e.seen || '1970-01-01';
    for (const r of ranks) {
      const list = all.filter((x) => x.r === r);
      const past = list.filter((x) => seenOf(x) < today).sort((a, b) => seenOf(a).localeCompare(seenOf(b)) || (a.e.ts || 0) - (b.e.ts || 0));
      if (past.length) return Object.assign(past[0], { why: `am längsten nicht gesehen (${deDay(past[0].e.seen) || 'nie'})` });
      const og = list.filter((x) => x.kind !== 'sd').map((x) => Object.assign(x, { d: daysOver(x.p, x.e, x.kind) }))
        .sort((a, b) => a.d - b.d || (a.kind === 'geronto' ? -1 : 0) - (b.kind === 'geronto' ? -1 : 0));
      if (og.length) return Object.assign(og[0], { why: 'kürzeste Zeit über der Altersgrenze' });
      if (newKind === 'sd') {
        const sds = list.filter((x) => x.kind === 'sd').map((x) => {
          const ps = personsOf(x.p, x.e), a = x.e.ages || [];
          return Object.assign(x, { m: ageNow(ps[1] || ps[0]) ?? (a[1] || a[0]), g: a.length === 2 ? a[1] - a[0] : 0 });
        }).filter((x) => x.m != null).sort((a, b) => a.m - b.m || a.g - b.g);
        const ia = item.ages || [];
        const nm = ia.length === 2 ? ia[1] : null, ng = ia.length === 2 ? ia[1] - ia[0] : 0;
        if (sds.length && nm != null && (nm > sds[0].m || (nm === sds[0].m && ng > sds[0].g))) return Object.assign(sds[0], { why: 'jüngerer Sugar Daddy' });
      }
    }
    return null;
  }
  // Profil im Hintergrund-Frame bearbeiten (Auftrag aus dem GM-Speicher); vorher Sichtbarkeit prüfen
  async function actJob(item, source) {
    await visEnforce();
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    GM_setValue('jaf_bg_job_' + jobId, { item, source: item.source || source });
    try { return await bgFrameG(location.origin + item.path, 'jaf-bg-act-' + jobId, null, 120000); }
    catch (err) { if (err.fatal) throw err; return { result: 'failed', msg: err.message }; }
    finally { GM_setValue('jaf_bg_job_' + jobId, null); }
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
    if (!it.action && !(await ensureSlot(Object.assign({ source }, it), cnt))) return { result: 'limit', msg: 'Limit erreicht, nicht gesperrt' };
    return actJob(it, source);
  }

  // ---- Popup ----
  let bgScan = null; // { stop, popup }
  function bgPopup() {
    let ov = document.getElementById('jaf-bg-popup');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'jaf-bg-popup';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `<div class="jaf-bg-box" role="dialog" aria-modal="true" style="${POPUP_BOX_CSS}">
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
    </div>`;
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
      box.appendChild(b);
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
  const beforeUnloadGuard = (e) => { e.preventDefault(); e.returnValue = 'Der Opa-Scan läuft noch.'; return e.returnValue; };

  // ---- bereits bearbeitete Anmeldungen je Party merken: erneute Scans prüfen nur Neuanmeldungen ----
  // Ändern sich die Regeln (Altersgrenzen, Typen, Paar-Regeln), wird automatisch wieder vollständig gescannt.
  const rulesHash = () => JSON.stringify([CONFIG.MAX_AGE, CONFIG.ONLY_TYPES, CONFIG.COUPLE_RULE_TYPES, CONFIG.COUPLE_AGE_GAP, CONFIG.COUPLE_BOTH_MIN_AGE]);
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
    GM_setValue(K_EVENTS, m);
  }

  // ---- Fehlschläge des Party-Scans (Hintergrund) speichern und exportieren ----
  const K_EVFAIL = 'jaf_evscan_failures'; // [{ ts, party, partyDate, partyUrl, name, url, step, msg }]
  function addEvFailure(f) {
    const l = GM_getValue(K_EVFAIL, []);
    l.push(Object.assign({ ts: Date.now() }, f));
    GM_setValue(K_EVFAIL, l.slice(-3000));
  }
  function exportEvFailures() {
    const l = GM_getValue(K_EVFAIL, []);
    downloadCsv('party-scan-fehlschlaege', ['Zeitpunkt', 'Party', 'Party-Datum', 'Party-Link', 'Name', 'Profil-Link', 'Schritt', 'Meldung'],
      l.map((f) => [fmtTs(f.ts), f.party || '', f.partyDate || '', f.partyUrl || '', f.name || '', f.url || '', f.step || '', f.msg || '']));
    return l.length;
  }

  // Grund, warum gerade kein Scan starten kann (anderer Scan / anderer Tab) – sonst ''
  function scanBlockedReason() {
    if (bgScan && bgScan.running) return 'Hier läuft bereits ein Opa-Scan.';
    if (getOpa().running && !opaStale(getOpa())) return 'Der Gruppen-Opa-Scan läuft gerade. Bitte erst diesen beenden.';
    const other = lockedByOther();
    if (other) return lockNotice(other).replace(' – hier wird nur markiert.', '. Der Opa-Scan kann erst danach gestartet werden.');
    return '';
  }
  // Klick auf „Opa-Scan starten“: Popup sofort öffnen, Partys sammeln, Start erst mit „Jetzt scannen …“
  async function bgEvStart() {
    if (bgScan) { bgPopup(); return; }
    bgScan = { stop: false, running: false };
    const startBtn = (fn) => ({ label: 'Jetzt scannen …', primary: true, focus: !!fn, disabled: !fn, fn });
    const closeBtn = (focus) => ({ label: 'Schließen', fn: closeBgPopup, focus });
    const blocked = (msg) => { bgTitle('Opa-Scan Partys', false); bgUi('Scan zurzeit nicht möglich', msg, null, ''); bgButtons([startBtn(null), closeBtn(true)]); };
    bgTitle('Opa-Scan Partys', false);
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
      if (!(await acquireLock('Opa-Scan Partys (Hintergrund)'))) { bgUi('Scan zurzeit nicht möglich', 'Ein anderer Tab hat gerade begonnen zu arbeiten. Bitte später erneut versuchen.', null, ''); return; }
      bgTitle('Opa-Scan läuft im Hintergrund', true);
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
        const ev = getEvents(); ev[e.id] = Object.assign(ev[e.id] || {}, { name: party.name, start: info.start || (ev[e.id] || {}).start }); GM_setValue(K_EVENTS, ev);
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
          const awo = computeAwo(guests.filter((g) => isManReg(g)), guests.filter((g) => /paar/i.test(g.type || '')));
          if (awo.value != null) {
            const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { awo: Math.round(awo.value * 1000) / 10, awoTs: Date.now() }); GM_setValue(K_EVENTS, m);
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
        if (complete && !CONFIG.DRY_RUN) { const m = getEvents(); m[e.id] = Object.assign(m[e.id] || {}, { doneTs: Date.now() }); GM_setValue(K_EVENTS, m); }
        st.done++;
        updateEventBadges();
        bgUi(null, `${party.name}: fertig`, (ei + 1) / events.length, stats());
        if (ei < events.length - 1) await sleep(rand(CONFIG.EVENT_DELAY_MIN_MS, CONFIG.EVENT_DELAY_MAX_MS));
      }
      if (emb) return st;
      bgTitle(bgScan.stop ? 'Opa-Scan abgebrochen' : 'Opa-Scan fertig', false);
      bgUi(bgScan.stop ? 'Opa-Scan abgebrochen' : 'Opa-Scan fertig', bgScan.stop ? (bgScan.stopMsg || 'Abgebrochen.') : 'Alle Partys bearbeitet.', bgScan.stop ? null : 1, stats());
    } catch (err) {
      if (emb) { st.error = err.message; return st; }
      bgTitle('Opa-Scan nicht möglich', false);
      bgUi('Opa-Scan nicht möglich', err.message, null, stats());
      fallback = true;
    } finally {
      if (!emb) bgEvFinish(st, fallback, logLines);
      else { const ev = getEv(); ev.log = (ev.log || []).concat(logLines).slice(-300); GM_setValue(K_EVSCAN, ev); }
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
      const ev = getEv(); ev.log = (ev.log || []).concat(logLines).slice(-300); GM_setValue(K_EVSCAN, ev);
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
  const K_MS_LOG = 'jaf_ms_protocol';       // [{ ts, city, land, geoId, age, runs, found, fresh, limit, url, final }]
  const K_MS_FAIL = 'jaf_ms_failures';      // [{ ts, search, name, url, msg }]
  const K_MS_SINGLE = 'jaf_ms_single_age_couples'; // { path: { name, url, ages, ts, search } }
  const K_MS_RESUME = 'jaf_ms_resume';      // unterbrochene systematische Suche: { opt, ai, ageIdx, nAreas, city, age, ts }
  const MS_TYPES = [['f', 'Frauen', 'frau'], ['m', 'Männer', 'mann'], ['p', 'Paare', 'paar'], ['nb', 'Non-binary', 'nonbinary']];
  const msAreaGroups = () => Object.entries(CONFIG.AREAS || {}).filter(([, l]) => l.length);
  function msSettings() {
    const d = { types: ['m', 'p', 'nb'], min: Math.min(70, CONFIG.MAX_AGE + 1), max: 70, lands: msAreaGroups().map(([n]) => n) };
    const s = GM_getValue(K_MS_SET, null);
    if (!s) return d;
    return { types: Array.isArray(s.types) ? s.types : d.types, min: s.min || d.min, max: s.max || d.max,
      lands: Array.isArray(s.lands) ? s.lands.filter((n) => (CONFIG.AREAS || {})[n]) : d.lands };
  }
  const msSlug = (t) => norm(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ort';
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
      `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g></svg></g>` +
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
    b.setAttribute('aria-label', 'Opa-Scan');
    b.setAttribute('title', 'Opa-Scan');
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
      const st = guestStyle(g, ctx);
      const a = c.a;
      const blk = g.id && ctx.blocked.get(g.id);
      const sig = [st.color, st.dashed, st.txt, !!blk, g.ages.join('+')].join('|');
      if (a.__jafSig !== sig) {
        a.__jafSig = sig;
        a.style.outline = `${st.dashed ? 2 : 3}px ${st.dashed ? 'dashed' : 'solid'} ${st.color}`;
        a.style.outlineOffset = '-1px';
        if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
        if (getComputedStyle(a).display === 'inline') a.style.display = 'block';
        let b = a.querySelector('.jaf-badge');
        if (!b) { b = document.createElement('div'); b.className = 'jaf-badge'; a.appendChild(b); }
        const extra = [g.ages.join('+') || '?', st.color === COLORS.red ? st.txt : ''].filter(Boolean).join(' · ');
        b.textContent = extra + (blk ? ' · ignoriert' : '');
        b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;font:bold 11px system-ui;padding:2px 6px;border-radius:3px;pointer-events:none;' +
          `background:${st.color};color:${st.fg || (st.color === COLORS.white ? '#000' : '#fff')}`;
        const x = a.querySelector('.jaf-x');
        if (blk && !x) a.insertAdjacentHTML('beforeend', `<div class="jaf-x" style="position:absolute;inset:0;z-index:4;pointer-events:none">${X_SVG}</div>`);
        if (!blk && x) x.remove();
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

  // ---- Popup 1: Auswahl ----
  function msOpen() {
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgScan = null;
    bgTitle(CONFIG.SEARCH_IGNORE ? 'Opa-Scan Mitgliedersuche' : 'Opa-Scan Mitgliedersuche (nur Statistik)', false);
    bgUi('', 'Wie soll gesucht werden?', null, CONFIG.SEARCH_IGNORE ? '' : 'Das Ignorieren in der Mitgliedersuche ist ausgeschaltet (Einstellung „Suche ignoriert“) – es wird nur gezählt, wer ignoriert würde.');
    bgPopup().querySelector('.jaf-bg-barwrap').style.display = 'none';
    bgBody(null);
    const res = GM_getValue(K_MS_RESUME, null);
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
      GM_setValue(K_MS_SET, r);
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
    const single = GM_getValue(K_MS_SINGLE, {});
    let ch = false;
    for (const c of cards) {
      if (isCoupleRuleType(c.type) && c.ages.length < 2 && !single[c.path]) { single[c.path] = { name: c.name, url: c.url, ages: c.ages, ts: Date.now(), search }; ch = true; }
    }
    if (ch) GM_setValue(K_MS_SINGLE, single);
  }
  // Karte einordnen: { kind: 'ignore'|'verify'|'skip', why, item }
  function msClassify(c, ctx) {
    const id = idOf(c.path);
    if (!CONFIG.PROFILE_PATH_RE.test(c.path)) return { kind: 'skip', why: 'kein Mitgliederprofil' };
    if (ctx.blocked.get(id)) return { kind: 'skip', why: 'bereits ignoriert' };
    if (isWhiteMember(c, ctx.white)) return { kind: 'skip', why: 'Whitelist' };
    const item = { path: c.path, url: c.url, name: c.name, ages: c.ages, type: c.type, source: 'Suche' };
    if (isCoupleRuleType(c.type)) {
      if (c.ages.length === 2) {
        const why = coupleReason(c.ages);
        return why ? { kind: 'ignore', why, item: Object.assign(item, { reason: why }) } : { kind: 'skip', why: 'Paar erfüllt die Kriterien nicht' };
      }
      return { kind: 'verify', why: 'Paar mit nur einer Altersangabe', item: Object.assign(item, { verify: true }) };
    }
    if (normType(c.type) === normType('Frau')) return { kind: 'skip', why: 'Frau' };
    return shouldBlock(c, ctx.white) ? { kind: 'ignore', why: 'Alter', item } : { kind: 'skip', why: 'erfüllt die Kriterien nicht' };
  }
  function msAddFailure(f) { const l = GM_getValue(K_MS_FAIL, []); l.push(Object.assign({ ts: Date.now() }, f)); GM_setValue(K_MS_FAIL, l.slice(-3000)); }
  function exportMsFailures() {
    const l = GM_getValue(K_MS_FAIL, []);
    downloadCsv('mitgliedersuche-fehlschlaege', ['Zeitpunkt', 'Suche', 'Name', 'Profil-Link', 'Meldung'], l.map((f) => [fmtTs(f.ts), f.search || '', f.name || '', f.url || '', f.msg || '']));
    return l.length;
  }
  function exportMsProtocol() {
    const l = GM_getValue(K_MS_LOG, []);
    downloadCsv('mitgliedersuche-protokoll', ['Zeitpunkt', 'Stadt', 'Bundesland', 'Orts-ID', 'Alter', 'Durchläufe ohne neue Treffer', 'Profile gefunden', 'davon neu ignoriert', 'Obergrenze erreicht', 'Such-Link', 'Link nach dem Laden'],
      l.map((e) => [fmtTs(e.ts), e.city || '', e.land || '', e.geoId ? 'x' + e.geoId : '', e.age >= 70 ? '70+' : e.age, e.runs, e.found, e.ignored, e.limit ? 'ja' : 'nein', e.url || '', e.final || ''])
        .concat(GM_getValue(K_PAUSES, []).map((pz) => [fmtTs(pz.since), 'PAUSE (JOYclub nicht erreichbar)', '', '', '', '', '', '', '',
          `bis ${fmtTs(pz.until)}${pz.end ? ', weiter um ' + fmtTs(pz.end) : ''}`, pz.text || ''])));
    return l.length;
  }
  function exportMsSingleCouples() {
    const m = GM_getValue(K_MS_SINGLE, {});
    downloadCsv('paare-mit-einer-altersangabe', ['Zeitpunkt', 'Name', 'Profil-Link', 'Alter', 'Suche'],
      Object.values(m).map((e) => [fmtTs(e.ts), e.name || '', e.url || '', (e.ages || []).join('+'), e.search || '']));
    return Object.keys(m).length;
  }

  // ---- „würden ignoriert“ (SEARCH_IGNORE aus: Mitgliedersuche sammelt nur Statistik) ----
  const K_MS_WOULD = 'jaf_ms_would'; // { path: { name, url, ages, type, why, ts, search } }
  function exportMsWould() {
    const m = GM_getValue(K_MS_WOULD, {});
    downloadCsv('mitgliedersuche-wuerden-ignoriert', ['Zeitpunkt', 'Name', 'Profil-Link', 'Profiltyp', 'Alter', 'Grund', 'Suche'],
      Object.values(m).map((e) => [fmtTs(e.ts), e.name || '', e.url || '', e.type || '', (e.ages || []).join('+'), e.why || '', e.search || '']));
    return Object.keys(m).length;
  }

  // ---- Lauf (beide Modi) ----
  // emb = true: als Teil des Opa-Scans (Hamburger-Menü) – Popup, Sperre und Abbruch gehören dem Aufrufer; Rückgabe: Statistik
  async function msRun(opt, emb = false) {
    const statOnly = !CONFIG.SEARCH_IGNORE;
    if (!emb) {
      if (bgScan && bgScan.running) return;
      const why = scanBlockedReason();
      bgBody(null);
      bgPopup().querySelector('.jaf-bg-party').style.display = '';
      bgPopup().querySelector('.jaf-bg-step').style.display = '';
      if (why) { bgTitle('Opa-Scan Mitgliedersuche', false); bgUi('Scan zurzeit nicht möglich', why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
      if (!(await visGuard())) { closeBgPopup(); return; }
      if (!(await acquireLock('Opa-Scan Mitgliedersuche'))) { bgUi('Scan zurzeit nicht möglich', 'Ein anderer Tab hat gerade begonnen zu arbeiten.', null, ''); return; }
      bgScan = { stop: false, running: true };
      window.__jafBgBusy = true;
      window.addEventListener('beforeunload', beforeUnloadGuard);
      bgTitle(statOnly ? 'Opa-Scan (nur Statistik)' : 'Opa-Scan läuft im Hintergrund', true);
      bgButtons([bgStopButton()]);
    }
    const t0 = Date.now();
    const st = { seen: new Set(), ignored: 0, skipped: 0, failed: 0, single: 0, searches: 0, would: 0, displaced: 0, limitHit: 0 };
    const would = statOnly ? {} : null;
    const stats = () => (statOnly
      ? `Profile gesehen: ${st.seen.size.toLocaleString('de-DE')} · würden ignoriert: ${st.would} · übersprungen: ${st.skipped} · nicht lesbar: ${st.failed}\n` +
        `Paare mit nur einer Altersangabe: ${st.single}\nNur Statistik – das Ignorieren in der Mitgliedersuche ist ausgeschaltet.`
      : `Profile gesehen: ${st.seen.size.toLocaleString('de-DE')} · ignoriert: ${st.ignored} · übersprungen: ${st.skipped} · fehlgeschlagen: ${st.failed}\n` +
        `Paare mit nur einer Altersangabe: ${st.single}\n${fillText()} · verdrängt: ${st.displaced} · Limit erreicht, nicht gesperrt: ${st.limitHit}` +
        `${CONFIG.DRY_RUN ? '\nTestmodus: es wird nichts ignoriert' : ''}`);
    let testLeft = CONFIG.DRY_RUN ? CONFIG.TEST_MAX_PROFILES : Infinity;
    const singleSeen = new Set();
    const wouldKeys = new Set();
    const addWould = (it, why, search) => {
      const k = idOf(it.path) || it.path;
      if (wouldKeys.has(k)) return;
      wouldKeys.add(k); st.would++;
      would[it.path] = { name: it.name, url: it.url || location.origin + it.path, ages: it.ages || [], type: it.type || '', why, ts: Date.now(), search: search.label };
    };
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
      return statOnly ? countHits(hits, search, fracOf) : ignoreHits(hits, search, fracOf);
    };
    // nur Statistik: Paare mit einer Altersangabe im Profil nachlesen (nur lesen), sonst direkt zählen
    const countHits = async (hits, search, fracOf) => {
      for (let qi = 0; qi < hits.length && !bgScan.stop; qi++) {
        const it = hits[qi];
        if (!it.verify) { addWould(it, it._why || it.reason || 'Alter', search); continue; }
        bgUi(null, `${search.step} · prüfe Profil … ${qi + 1}/${hits.length} · ${it.name}`, fracOf(0.5 + 0.5 * qi / hits.length), stats());
        const d = cachedDecision({ id: idOf(it.path), name: it.name, path: it.path }, whiteList());
        if (d) { if (d.r === 'block') addWould(Object.assign({}, it, { ages: d.ages, type: d.type }), `Profil: ${d.ages.join('+')}`, search); else st.skipped++; continue; }
        try {
          await visEnforce();
          await sleep(rand(600, 1300));
          const r = await jfetch(location.origin + it.path);
          const info = r.doc ? parseProfileDoc(r.doc) : null;
          if (info) {
            setChecked(idOf(it.path), Object.assign({ name: it.name }, info));
            recordAccounts([{ path: it.path, name: info.name || it.name, ages: info.ages, type: info.type, signs: info.signs }]);
            if (shouldBlock({ name: it.name, path: it.path, type: info.type, ages: info.ages })) addWould(Object.assign({}, it, info), `Profil: ${info.ages.join('+')}`, search); else st.skipped++;
          } else st.failed++;
        } catch (err) { if (err.fatal) throw err; st.failed++; }
        bgUi(null, null, null, stats());
      }
      return 0;
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
      if (!statOnly) { bgUi('Ignorierliste', 'Lese die Ignorierliste …', null, null); try { await syncIgnoreList(true); } catch (e) { /* egal */ } }
      // fällige Vorgemerkte (inzwischen über MAX_AGE) zuerst
      const due = dueFromWatch();
      if (due.length && !bgScan.stop) {
        bgUi('Vorgemerkte', `${due.length} vorgemerkte Mitglieder haben die Altersgrenze überschritten`, 0, stats());
        const dueItems = due.map((d) => Object.assign({}, d, { source: d.source || 'Suche' }));
        if (statOnly) dueItems.forEach((d) => addWould(d, 'vorgemerkt, Altersgrenze überschritten', { label: 'Vorgemerkte' }));
        else await ignoreHits(dueItems, { label: 'Vorgemerkte', step: 'Vorgemerkte' }, () => 0);
      }
      if (opt.mode === 'current') {
        const desc = 'Aktuelle Suche';
        headline = desc;
        bgUi(desc, 'Lade Ergebnisse …', 0, stats());
        const data = await load(location.href, (n) => bgUi(null, `lade Ergebnisse … ${n}`, 0.25, null));
        const cards = data.cards || [];
        bgUi(null, `${cards.length} Profile geladen`, 0.5, stats());
        await process(cards, { label: desc, step: `${cards.length} Profile` }, (f) => f);
        st.searches = 1;
      } else {
        const groups = msAreaGroups().filter(([n]) => opt.lands.includes(n));
        const areas = groups.flatMap(([land, list]) => list.map((a) => ({ a, land })));
        const ages = []; for (let x = opt.max; x >= opt.min; x--) ages.push(x);
        const w = (age) => (age >= 70 ? 10 : 1);
        const wSum = ages.reduce((s2, x) => s2 + w(x), 0);
        const proto = GM_getValue(K_MS_LOG, []);
        const optSave = { types: opt.types, min: opt.min, max: opt.max, lands: opt.lands };
        for (let ai = opt.startAi || 0; ai < areas.length && !bgScan.stop; ai++) {
          const { a, land } = areas[ai];
          let wDone = 0;
          for (let gi = 0; gi < ages.length; gi++) {
            const age = ages[gi];
            if (ai === opt.startAi && gi < (opt.startAgeIdx || 0)) { wDone += w(age); continue; } // beim Fortsetzen überspringen
            if (bgScan.stop) break;
            GM_setValue(K_MS_RESUME, { opt: optSave, ai, ageIdx: gi, nAreas: areas.length, city: a[0], age, ts: Date.now() });
            const url = msUrl(a, opt.types, age);
            const ageLbl = age >= 70 ? '70+' : String(age);
            const head = `Alter ${ageLbl} · Umkreis ${ai + 1}/${areas.length}: ${a[0]} (${land})`;
            const base = (ai + wDone / wSum) / areas.length, span = w(age) / wSum / areas.length;
            const maxRuns = age >= 70 ? 200 : 20;
            const seen = new Set();
            let runs = 0, found = 0, ign = 0, limit = false, final = '';
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
              final = data.final || final;
              const fresh = (data.cards || []).filter((c) => { const k = idOf(c.path) || c.path; if (seen.has(k)) return false; seen.add(k); return true; });
              if (!fresh.length) break;
              found += fresh.length;
              ign += await process(fresh, { label: `${a[0]} (${land}), Alter ${ageLbl}`, step }, fracOf);
              if (runs >= maxRuns) limit = true;
              await sleep(rand(1500, 3000));
            }
            st.searches++;
            proto.push({ ts: Date.now(), city: a[0], land, geoId: a[4], age, runs, found, ignored: ign, limit, url, final });
            GM_setValue(K_MS_LOG, proto.slice(-20000));
            wDone += w(age);
            bgUi(null, null, base + span, stats());
          }
        }
        headline = `${areas.length} Umkreise`;
        if (!bgScan.stop) GM_setValue(K_MS_RESUME, null);
      }
      if (statOnly) { const m = GM_getValue(K_MS_WOULD, {}); Object.assign(m, would); GM_setValue(K_MS_WOULD, m); }
      if (emb) return st;
      const dur = Math.round((Date.now() - t0) / 60000);
      const durTxt = dur >= 60 ? `${Math.floor(dur / 60)}:${pad2(dur % 60)} h` : `${dur} min`;
      bgBar2(null);
      bgTitle(bgScan.stop ? 'Opa-Scan abgebrochen' : (statOnly ? 'Opa-Scan fertig (nur Statistik)' : 'Opa-Scan fertig'), false);
      bgUi(bgScan.stop ? (bgScan.stopMsg || 'Abgebrochen') : (opt.mode === 'current' ? 'Aktuelle Suche abgeschlossen' : 'Systematische Suche abgeschlossen'),
        `${headline}${opt.mode === 'system' ? ` · ${st.searches.toLocaleString('de-DE')} Einzelsuchen` : ''} · Dauer ${durTxt}`, bgScan.stop ? null : 1, stats());
    } catch (err) {
      if (statOnly && would) { const m = GM_getValue(K_MS_WOULD, {}); Object.assign(m, would); GM_setValue(K_MS_WOULD, m); }
      if (emb) { st.error = err.message || String(err); return st; }
      bgTitle('Opa-Scan nicht möglich', false);
      bgUi('Opa-Scan nicht möglich', err.message || String(err), null, stats());
    } finally {
      if (!emb) {
        window.removeEventListener('beforeunload', beforeUnloadGuard);
        window.__jafBgBusy = false;
        bgScan = null;
        releaseLock();
        const btns = [];
        if (statOnly && st.would) btns.push({ label: `Liste „würden ignoriert“ exportieren (${st.would})`, fn: () => exportMsWould() });
        if (opt.mode === 'system') btns.push({ label: 'Protokoll exportieren (CSV)', fn: () => exportMsProtocol() });
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
  const KIND_NAMES = { false: 'Alter Sack', Altersunterschied: 'Sugar Daddy', 'Geronto-Paar': 'Geronto-Paar' };
  const kindArg = (name) => (name === 'Sugar Daddy' ? 'Altersunterschied' : name === 'Geronto-Paar' ? 'Geronto-Paar' : false);
  // eigene Notizzeile zerlegen: { kind, source, ts }
  function parseOwnLine(text) {
    const lines = String(text || '').split(/\r?\n|\s·\s/).map((l) => l.trim()).filter((l) => CONFIG.OWN_NOTE_RE.test(l));
    if (!lines.length) return null;
    const m = lines[lines.length - 1].match(/^(Alter Sack|Sugar Daddy|Geronto-Paar)(?:\s*\(([^)]*)\))?\s+\S+\s+am\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s+um\s+(\d{1,2}):(\d{2})/i);
    if (!m) return null;
    const kind = /sugar/i.test(m[1]) ? 'Sugar Daddy' : /geronto/i.test(m[1]) ? 'Geronto-Paar' : 'Alter Sack';
    return { kind, source: (m[2] || '').trim(), ts: new Date(+m[5], +m[4] - 1, +m[3], +m[6], +m[7]).getTime() };
  }
  // Art laut Skript: aus Grund bzw. Paar-Regeln
  function kindOfEntry(e, type, ages) {
    if (e && e.reason === 'Altersunterschied') return 'Sugar Daddy';
    if (e && e.reason === 'Geronto-Paar') return 'Geronto-Paar';
    const t = type || (e && e.type) || '', a = (ages && ages.length ? ages : (e && e.ages)) || [];
    if (isCoupleRuleType(t) && a.length === 2) return KIND_NAMES[coupleReason(a) || false] || 'Alter Sack';
    return t ? 'Alter Sack' : null; // ohne Typ unbekannt
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
    wrap.appendChild(b); wrap.appendChild(status);
    form.after(wrap);
    const align = () => { try { wrap.style.paddingLeft = Math.max(0, sperr.getBoundingClientRect().left - form.getBoundingClientRect().left) + 'px'; } catch (e) { /* egal */ } };
    align(); setTimeout(align, 800); window.addEventListener('resize', align);
    syncStatus();
  }
  function syncStatus() {
    const el = document.querySelector('.jaf-sync-status');
    if (!el) return;
    const l = GM_getValue(K_SYNC_LAST, null);
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
    cb.checked = !!GM_getValue(K_SYNC_NOTES, false);
    cb.addEventListener('change', () => GM_setValue(K_SYNC_NOTES, cb.checked));
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
            if (own && own.kind !== 'Alter Sack') x.reason = kindArg(own.kind);
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
        GM_setValue(K_LOG, l);
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
            if (!pi.own || !kind || pi.own.kind !== kind || pi.own.source !== source) changes.push({ op: 'fix', path, e, k, kind, source, ts });
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
        GM_setValue(K_LOG, l);
        // 2. Änderungen
        const base = show(readUnits / (readUnits + 3 * changes.length));
        for (let ci = 0; ci < changes.length && !bgScan.stop; ci++) {
          const c = changes[ci];
          const label = c.op === 'unblock' ? `Entsperren${c.clean ? ' + Notiz bereinigen' : ''}` : c.op === 'fix' ? `Notiz angleichen (entsperren, „${c.kind || '…'} (${c.source})“, wieder sperren)` : `Nachsperren mit Notiz „${c.kind || '…'} (${c.source})“`;
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
                if (!x.reason && isCoupleRuleType(r3.type) && r3.ages && r3.ages.length === 2) { const cr = coupleReason(r3.ages); if (cr) x.reason = cr; }
                delete x.unblocked; GM_setValue(K_LOG, L);
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
      if (!bgScan.stop) GM_setValue(K_SYNC_LAST, { ts: Date.now(), mode: modeName, notes, n: st.n, summary });
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
  };
  const MYJOY_BY_SRC = Object.fromEntries(Object.values(MYJOY).map((x) => [x.src, x]));
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
    }
    for (const c of cards) {
      if (!c.gender || !c.path) continue; // Clubs, Veranstalter usw. bleiben ungefärbt
      const g = Object.assign({}, c);
      const st = guestStyle(g, ctx);
      const host = c.card;
      const cell = host.parentElement || host;
      const blk = g.id && ctx.blocked.get(g.id);
      const sig = [st.color, st.dashed, st.txt, !!blk, g.ages.join('+')].join('|');
      if (host.__jafSig !== sig) {
        host.__jafSig = sig;
        host.style.outline = `${st.dashed ? 2 : 3}px ${st.dashed ? 'dashed' : 'solid'} ${st.color}`;
        host.style.outlineOffset = '-1px';
        if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
        let b = cell.querySelector(':scope > .jaf-badge');
        if (!b) { b = document.createElement('div'); b.className = 'jaf-badge'; cell.appendChild(b); }
        const extra = [g.ages.join('+') || '?', st.color === COLORS.red ? st.txt : ''].filter(Boolean).join(' · ');
        b.textContent = extra + (blk ? ' · ignoriert' : '');
        b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;font:bold 11px system-ui;padding:2px 6px;border-radius:3px;pointer-events:none;' +
          `background:${st.color};color:${st.fg || (st.color === COLORS.white ? '#000' : '#fff')}`;
        const x = cell.querySelector(':scope > .jaf-x');
        if (blk && !x) cell.insertAdjacentHTML('beforeend', `<div class="jaf-x" style="position:absolute;inset:0;z-index:4;pointer-events:none">${X_SVG}</div>`);
        if (!blk && x) x.remove();
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
    document.querySelectorAll('.jaf-mj-btn').forEach((b) => { if (!pg || b.dataset.src !== pg.src) b.remove(); });
    if (!pg || document.querySelector('.jaf-mj-btn')) return;
    const box = document.querySelector('.header-options') || document.querySelector('[slot="options"]');
    if (!box) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Opa-Scan starten';
    b.dataset.src = pg.src;
    b.className = 'jaf-mj-btn btn-flat-special-light btn btn-default';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap';
    b.innerHTML = `<svg viewBox="0 0 640 1280" width="9" height="16" style="fill:currentColor;vertical-align:-2px" aria-hidden="true">` +
      `<g transform="translate(0,1280) scale(0.1,-0.1)"><path d="${OPA_PATH}"/></g></svg> <span class="btn-text">Opa-Scan starten</span>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); mjOpen(pg.src); });
    box.appendChild(b);
  }
  function myJoyTick() {
    try { insertMyJoyButton(); decorateMyJoy(); } catch (e) { /* weiter */ }
  }
  setInterval(myJoyTick, 1500);

  // IM Frame: Liste nachladen, bis das Datum vor dem letzten vollständigen Scan liegt bzw. die Obergrenze erreicht ist
  async function mjFrame() {
    try {
      const parts = (window.name || '').split('-'); // jaf-bg-mj-<src>-<YYYYMMDD|0>-<max>-<rnd>
      const stopDay = parts[4] && parts[4] !== '0' ? `${parts[4].slice(0, 4)}-${parts[4].slice(4, 6)}-${parts[4].slice(6, 8)}` : '';
      const max = +parts[5] || CONFIG.MYJOY_FIRST_MAX;
      const ok = await waitFor(() => (readMyJoyCards().length || document.querySelector('section.my-joy-visits-view') ? true : null), 30000);
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
    if (!CONFIG.PROFILE_PATH_RE.test(c.path || '')) return { kind: 'skip', why: 'kein Mitgliederprofil' };
    if (ctx.blocked.get(idOf(c.path))) return { kind: 'skip', why: 'bereits ignoriert' };
    if (isWhiteMember(c, ctx.white)) return { kind: 'skip', why: 'Whitelist' };
    const item = { path: c.path, url: c.url, name: c.name, ages: c.ages, type: c.type, source: src, seen: c.day || null };
    if (isCoupleRuleType(c.type)) {
      if (c.ages.length === 2) {
        const why = coupleReason(c.ages);
        return why ? { kind: 'ignore', why, item: Object.assign(item, { reason: why }) } : { kind: 'skip', why: 'Paar erfüllt die Kriterien nicht' };
      }
      return { kind: 'verify', why: 'Paar mit nur einer Altersangabe', item: Object.assign(item, { verify: true }) };
    }
    if (normType(c.type) === normType('Frau')) return { kind: 'skip', why: 'Frau' };
    return shouldBlock(c, ctx.white) ? { kind: 'ignore', why: 'Alter', item } : { kind: 'skip', why: 'erfüllt die Kriterien nicht' };
  }
  // Start-Popup („Jetzt scannen …“) wie beim Party-Scan
  function mjOpen(src) {
    const pg = MYJOY_BY_SRC[src];
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgScan = null;
    bgBar2(null);
    bgBody(null);
    const last = (GM_getValue(K_MJ, {}) || {})[src];
    bgTitle(`Opa-Scan ${pg.label}`, false);
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
  async function mjRun(src, emb = false) {
    const pg = MYJOY_BY_SRC[src];
    if (!emb) {
      if (bgScan && bgScan.running) return;
      const why = scanBlockedReason();
      if (why) { bgUi('Scan zurzeit nicht möglich', why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
      if (!(await visGuard())) { closeBgPopup(); return; }
      if (!(await acquireLock(`Opa-Scan ${pg.label}`))) { bgUi('Scan zurzeit nicht möglich', 'Ein anderer Tab hat gerade begonnen zu arbeiten.', null, ''); return; }
      bgScan = { stop: false, running: true };
      window.__jafBgBusy = true;
      window.addEventListener('beforeunload', beforeUnloadGuard);
      bgTitle('Opa-Scan läuft im Hintergrund', true);
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
      const last = (GM_getValue(K_MJ, {}) || {})[src];
      const stopDay = last && last.lastDay ? last.lastDay : '';
      const max = stopDay ? 100000 : CONFIG.MYJOY_FIRST_MAX;
      bgUi(null, 'Lade die Liste im Hintergrund …', 0.02, stats());
      const fname = `jaf-bg-mj-${src}-${stopDay ? stopDay.replace(/-/g, '') : '0'}-${max}-${Date.now().toString(36)}`;
      const data = await bgFrameG(location.origin + pg.path, fname, (n) => bgUi(null, `Lade die Liste … ${n} Einträge`, 0.05, null), 30 * 60000);
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
        if (r.kind === 'skip') st.skipped++; else hits.push(r.item);
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
      if (complete && !CONFIG.DRY_RUN) { const m = GM_getValue(K_MJ, {}) || {}; m[src] = { lastDay: today, ts: Date.now() }; GM_setValue(K_MJ, m); }
      if (emb) return st;
      bgTitle(bgScan.stop ? 'Opa-Scan abgebrochen' : 'Opa-Scan fertig', false);
      bgUi(bgScan.stop ? (bgScan.stopMsg || 'Abgebrochen') : `„${pg.tab}“ fertig`, complete ? 'Alle Einträge bearbeitet.' : 'Nicht alles bearbeitet – der nächste Scan prüft diese Einträge erneut.', bgScan.stop ? null : 1, stats());
    } catch (err) {
      if (emb) { st.error = err.message || String(err); return st; }
      bgTitle('Opa-Scan nicht möglich', false);
      bgUi('Opa-Scan nicht möglich', err.message || String(err), null, stats());
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
      bgPost({ list: list.map((e) => ({ id: e.id, url: e.url, date: e.date, dayTs: e.dayTs, location: e.location, name: e.name, slugName: e.slugName })) });
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
        let hits = members.filter((m) => shouldBlock(m, white) && !isBlocked(m.path, log_, ign))
          .map((m) => ({ path: m.path, url: m.url, name: m.name, ages: m.ages, type: m.type, source: 'Gruppen', reason: isCoupleRuleType(m.type) ? coupleReason(m.ages) : 'Alter' }));
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
    for (const k of Object.keys(COMBO_SCANS)) d[k] = k === 'Suche' ? !!CONFIG.SEARCH_IGNORE : true;
    return Object.assign(d, GM_getValue(K_COMBO_SEL, null) || {});
  }
  function comboOpen() {
    if (bgScan && bgScan.running) { bgPopup(); return; }
    closeBgPopup();
    bgScan = null;
    bgBar2(null);
    bgTitle('Opa-Scan', false);
    bgUi('', '', null, '');
    const wrap = document.createElement('div');
    wrap.innerHTML = '<p style="margin:0 0 8px">Der Opa-Scan führt alle ausgewählten Scans nacheinander durch – in der Reihenfolge, in der die Quellen unter ' +
      '<i>Opa-Schutz › Rangfolge der Quellen</i> eingestellt sind.</p>' +
      '<p style="margin:0 0 12px;opacity:.75">Gefundene Opas, Sugar Daddys und Geronto-Paare werden mit Notiz ignoriert. Ist die Ignorierliste voll, ' +
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
      if (k === 'Suche' && !CONFIG.SEARCH_IGNORE) {
        const w = document.createElement('span');
        w.style.cssText = 'display:block;color:#ff8a80;font-size:12px';
        w.textContent = 'Sammelt nur Statistiken, da das Ignorieren in der Mitgliederliste inaktiv ist!';
        l.querySelector('span').appendChild(w);
      }
      cb.addEventListener('change', () => { const s2 = comboSel(); s2[k] = cb.checked; GM_setValue(K_COMBO_SEL, s2); refresh(); });
      list.appendChild(l);
    });
    const refresh = () => {
      const any = [...list.querySelectorAll('input:checked')].length;
      bgButtons([
        { label: 'Opa-Scan starten', primary: true, disabled: !any, fn: () => comboRun() },
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
    if (why) { bgUi('Opa-Scan zurzeit nicht möglich', why, null, ''); bgButtons([{ label: 'Schließen', fn: closeBgPopup, focus: true }]); return; }
    if (!(await visGuard())) { closeBgPopup(); return; }
    if (!(await acquireLock('Opa-Scan (alle)'))) { bgUi('Opa-Scan zurzeit nicht möglich', 'Ein anderer Tab hat gerade begonnen zu arbeiten.', null, ''); return; }
    bgScan = { stop: false, running: true };
    window.__jafBgBusy = true;
    window.addEventListener('beforeunload', beforeUnloadGuard);
    bgTitle('Opa-Scan läuft im Hintergrund', true);
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
        if (k === 'Likes' || k === 'Besucher') r = await mjRun(k, true);
        else if (k === 'Party') {
          let data;
          try { data = await bgFrameG(location.origin + '/dates_partys/events/registrations/', 'jaf-bg-reg', (n) => bgUi(null, `Lade alle Eventanmeldungen … ${n}`, 0.01, null), 5 * 60000); }
          catch (e) { if (e.fatal) throw e; data = { error: e.message }; }
          if (data.error || !(data.list || []).length) r = { error: data.error || 'Keine Eventanmeldungen gefunden.' };
          else r = await bgEvRun(data.list, true);
        } else if (k === 'Gruppen') r = await grpRun();
        else r = await msRun(Object.assign({ mode: 'system' }, msSettings()), true);
        r = r || {};
        const statOnly = k === 'Suche' && !CONFIG.SEARCH_IGNORE;
        rows.push({ k, label, checked: k === 'Suche' ? (r.seen ? r.seen.size : 0) : (r.checked || 0), ignored: r.ignored || 0, displaced: r.displaced || 0,
          limitHit: r.limitHit || 0, would: statOnly ? (r.would || 0) : null, failed: r.failed || 0, error: r.error || '' });
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
      bgTitle(stopped ? 'Opa-Scan abgebrochen' : 'Opa-Scan fertig', false);
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
          : [r.label, r.checked, r.would != null ? `würden ignoriert: ${r.would}` : r.ignored, r.would != null ? '–' : r.displaced, r.would != null ? '–' : r.limitHit];
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
      if (rows.some((r) => r.would)) btns.push({ label: 'Liste „würden ignoriert“ exportieren (CSV)', fn: () => exportMsWould() });
      if (rows.some((r) => r.failed && r.k === 'Party')) btns.push({ label: 'Fehlschläge (Partys) exportieren (CSV)', fn: () => exportEvFailures() });
      btns.push({ label: 'Schließen', fn: closeBgPopup, focus: true });
      bgButtons(btns);
      GM_setValue(K_VIS_RUN, Object.assign({}, visRun() || {}, { ts: 0 }));
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
        const li = menuLi('jaf-menu-scan', opaLupeSvg(20), 'Opa-Scan', '#', () => { closeMainMenu(); comboOpen(); });
        if (pv) pv.closest('li').before(li);
        else { const t = menu.querySelector('li.menu_title'); if (t) t.after(li); else menu.prepend(li); }
      }
      if (!menu.querySelector('.jaf-menu-schutz')) {
        const inv = [...menu.querySelectorAll('a[href]')].find((a) => pathOfHref(a) === '/edit/invisible');
        const li = menuLi('jaf-menu-schutz', opaIconSvg(18), 'Opa-Schutz', settingsUrl(), null);
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
        li.innerHTML = `<a href="${settingsUrl()}" class="sn">Opa-Schutz</a>`;
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
      li.title = 'Opa-Schutz';
      li.innerHTML = `<a href="${settingsUrl()}"><span class="nav_link_icon" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center">${opaIconSvg(20)}</span><span class="item_text"></span></a>`;
      if (kontakte && kontakte.parentElement === links) kontakte.after(li); else links.appendChild(li);
    }
    const t = topStatus();
    const el = li.querySelector('.item_text');
    if (el.textContent !== t) el.textContent = t;
  }
  setInterval(() => { try { insertMenuEntries(); updateTopButton(); invisiblePageGuard(); } catch (e) { /* weiter */ } }, 1500);

  // =====================================================================
  // ---------- Seite „Opa-Schutz“ (Einstellungen) unter /edit/account/#opa-schutz ----------
  // Aufbau wie JOYclubs Seite „Account“: Abschnitte (div.h2 > h2), Tabellenzeilen (th.td_fh / td.td_fc), Hinweise (c_hint_lo),
  // Buttons „Speichern“ / „Abbrechen“. Ein Teil steht unter „Experten-Einstellungen“ (immer zugeklappt).
  // =====================================================================
  const ALL_TYPES = ['Mann', 'Transmann', 'Non-binary', 'Transvestit', 'Männer-Paar', 'Frau', 'Transfrau', 'Paar', 'Frauen-Paar'];
  let settingsDraft = null;   // Arbeitskopie der Einstellungen + autoDel (zu löschende automatische Whitelist-Einträge)
  let settingsDirty = false;
  const cloneJ = (x) => JSON.parse(JSON.stringify(x));
  const sortDe = (arr) => arr.slice().sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
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
    // automatische Whitelist: gelöschte Einträge und solche, die jetzt auf der eigenen Whitelist stehen, entfernen
    const own = new Set(Object.values(d.WHITELIST || {}).flat().map(norm));
    const w = getDynWhite();
    let ch = false;
    for (const k of Object.keys(w)) if (d.autoDel.includes(k) || own.has(k)) { delete w[k]; ch = true; }
    if (ch) { GM_setValue(K_WHITE, w); _wIdCache.t = 0; }
    settingsDirty = false;
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
    document.title = 'Opa-Schutz - JOYclub';
    const tb = document.querySelector('.navigation_title_bar_title');
    if (tb) tb.textContent = 'Opa-Schutz';
    if (!window.__jafSettingsGuard) {
      window.__jafSettingsGuard = true;
      document.addEventListener('click', settingsGuardClick, true);
      window.addEventListener('beforeunload', settingsBeforeUnload);
    }
    const d = settingsDraft;
    const expOpen = !!c.__jafExp;
    c.innerHTML = '';
    c.className = c.className || 'col-lg-6 col-md-8 sp_bb clearfix';
    const h1 = document.createElement('h1'); h1.className = 'hide_for_mobile sp_bs'; h1.textContent = 'Opa-Schutz'; c.appendChild(h1);
    const bc = document.createElement('ol');
    bc.className = 'breadcrumb breadcrumb_ui';
    bc.innerHTML = `<li class="forelast"><a href="${location.origin}/edit/"><span>Profil verwalten</span></a></li><li class="last"><div><span>Opa-Schutz</span></div></li>`;
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
    // ---- Regeln ----
    let tb2 = section('Regeln');
    row(tb2, 'Höchstalter Männer:', num('MAX_AGE', 'Jahre', 18, 99), 'Mitglieder, die älter sind, werden ignoriert.', { key: 'MAX_AGE' });
    row(tb2, 'Warnalter:', num('WARN_AGE', 'Jahre', 18, 99), 'Farbmarkierung: bis hier grün, darüber orange.', { key: 'WARN_AGE' });
    const types = document.createElement('div');
    for (const t of ALL_TYPES.concat(d.ONLY_TYPES.filter((x) => !ALL_TYPES.includes(x)))) {
      const l = document.createElement('label');
      l.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin:2px 14px 2px 0;font-weight:normal;cursor:pointer';
      l.innerHTML = '<input type="checkbox"> <span></span>';
      l.querySelector('span').textContent = t;
      const cb = l.querySelector('input');
      cb.checked = d.ONLY_TYPES.includes(t);
      cb.addEventListener('change', () => { d.ONLY_TYPES = ALL_TYPES.concat(d.ONLY_TYPES.filter((x) => !ALL_TYPES.includes(x))).filter((x) => (x === t ? cb.checked : d.ONLY_TYPES.includes(x))); changed(); });
      types.appendChild(l);
    }
    row(tb2, 'Profiltypen:', types, 'Nur diese Profiltypen werden nach Höchstalter ignoriert.', { key: 'ONLY_TYPES' });
    const cm = document.createElement('select');
    cm.className = 'f_select';
    cm.innerHTML = '<option value="any">eine Person zu alt reicht</option><option value="all">beide Personen müssen zu alt sein</option>';
    cm.value = d.COUPLE_MODE;
    cm.addEventListener('change', () => { d.COUPLE_MODE = cm.value; changed(); });
    row(tb2, 'Paar-Modus:', cm, 'Gilt für Paar-Profiltypen aus der Liste oben (z. B. Männer-Paar).', { key: 'COUPLE_MODE' });
    row(tb2, 'Altersunterschied Sugar Daddy:', num('COUPLE_AGE_GAP', 'Jahre', 1, 80), 'Gemischte Paare, bei denen die Frau so viel oder mehr jünger ist.', { key: 'COUPLE_AGE_GAP' });
    row(tb2, 'Mindestalter Geronto-Paar:', num('COUPLE_BOTH_MIN_AGE', 'Jahre', 18, 120), 'Paare, bei denen beide so alt oder älter sind.', { key: 'COUPLE_BOTH_MIN_AGE' });
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
    // ---- Experten-Einstellungen ----
    const exp = document.createElement('div');
    exp.className = 'jaf-exp-toggle';
    exp.style.cssText = 'margin:22px 0 4px;padding:10px 12px;border-radius:8px;background:rgba(127,127,127,.15);font-weight:bold;cursor:pointer;user-select:none';
    exp.textContent = `${expOpen ? '▾' : '▸'} Experten-Einstellungen`;
    exp.addEventListener('click', () => { c.__jafExp = !c.__jafExp; renderSettingsPage(); });
    c.appendChild(exp);
    if (expOpen) {
      tb2 = section('Betrieb');
      row(tb2, 'Debug-Ausgaben:', onOff('DEBUG'), 'Zusätzliche Meldungen in der Browser-Konsole; jedes Element wird vor dem Klick markiert.', { key: 'DEBUG' });
      row(tb2, 'Testlauf:', onOff('DRY_RUN'), 'Spielt alles durch, ignoriert aber niemanden.', { key: 'DRY_RUN' });
      const si = row(tb2, 'Suche ignoriert:', onOff('SEARCH_IGNORE'), 'Aus = die Mitgliedersuche erstellt nur Statistiken.', { key: 'SEARCH_IGNORE' });
      if (d.SEARCH_IGNORE) { const w = document.createElement('div'); w.className = 'c_hint_lo'; w.style.color = '#e53935'; w.textContent = 'Diese Einstellung führt zu sehr vielen Sperrungen, die das JOYclub-Limit überschreiten würden!'; si.appendChild(w); }
      row(tb2, 'Erster Scan Profilbesucher/Interaktionen:', num('MYJOY_FIRST_MAX', 'Einträge', 10, 100000), 'Beim ersten Scan von „Profilbesuche“ bzw. „Mögen mich“ höchstens so viele Einträge prüfen.', { key: 'MYJOY_FIRST_MAX' });
      tb2 = section('Ignorierliste');
      row(tb2, 'Limit:', num('IGNORE_LIMIT', 'Einträge', 10, 100000), `JOYclub behält nur die letzten ${Number(d.IGNORE_LIMIT).toLocaleString('de-DE')} Sperren.`, { key: 'IGNORE_LIMIT', red: true });
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
      tb2 = section('Notizen');
      row(tb2, 'Notiz schreiben:', onOff('WRITE_NOTE'), 'Profilnotiz vor dem Ignorieren hinterlegen.', { key: 'WRITE_NOTE' });
      row(tb2, 'Notiz Pflicht:', onOff('NOTE_REQUIRED'), 'Ohne gespeicherte Notiz wird nicht ignoriert.', { key: 'NOTE_REQUIRED' });
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
    else if (cleanPath(location.pathname) === cleanPath(SETTINGS_PATH) && document.querySelector('#c h1') && document.querySelector('#c h1').textContent === 'Opa-Schutz') location.reload();
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

  // ---------- Start ----------
  async function init() {
    if (await topGate()) return;
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
      p.appendChild(btn('Export (CSV)', () => log(`${exportList()} Einträge exportiert.`)));
      p.appendChild(btn('Alle Konten (CSV)', () => log(`${exportAccounts()} Konten exportiert.`)));
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
    GM_registerMenuCommand('Alter-Filter: Liste exportieren (CSV)', () => exportList());
    GM_registerMenuCommand('Alter-Filter: alle Konten mit Geburtsjahr exportieren (CSV)', () => exportAccounts());
    GM_registerMenuCommand('Alter-Filter: Vorgemerkte exportieren (CSV)', () => exportWatch());
    GM_registerMenuCommand('Alter-Filter: Online-Angaben exportieren (CSV)', () => exportOnlineTexts());
    GM_registerMenuCommand('Alter-Filter: Whitelist exportieren (CSV)', () => exportWhitelist());
    GM_registerMenuCommand('Alter-Filter: Gruppen (zuletzt bearbeitet) exportieren (CSV)', () => exportGroups());
    GM_registerMenuCommand('Alter-Filter: Fehlschläge des Party-Scans exportieren (CSV)', () => exportEvFailures());
    GM_registerMenuCommand('Alter-Filter: Protokoll der Mitgliedersuche exportieren (CSV)', () => exportMsProtocol());
    GM_registerMenuCommand('Alter-Filter: Paare mit nur einer Altersangabe exportieren (CSV)', () => exportMsSingleCouples());
    GM_registerMenuCommand('Alter-Filter: Fehlschläge der Mitgliedersuche exportieren (CSV)', () => exportMsFailures());
    GM_registerMenuCommand('Alter-Filter: Mitgliedersuche – „würden ignoriert“ exportieren (CSV)', () => exportMsWould());
    GM_registerMenuCommand('Alter-Filter: Einstellungen (Opa-Schutz) öffnen', () => { location.href = settingsUrl(); });
    GM_registerMenuCommand('Alter-Filter: Fehlschläge des Party-Scans löschen', () => { GM_setValue(K_EVFAIL, []); alert('Fehlschlag-Liste gelöscht.'); });
    GM_registerMenuCommand('Alter-Filter: Partys beim nächsten Scan vollständig prüfen', () => {
      const m = getEvents(); for (const e of Object.values(m)) { delete e.seen; delete e.seenRules; } GM_setValue(K_EVENTS, m);
      alert('Gemerkte Anmeldungen gelöscht – der nächste Party-Scan prüft wieder alle Gäste.');
    });
    GM_registerMenuCommand('Alter-Filter: Erledigt-Liste leeren', () => {
      if (!confirm('Liste der vom Skript ignorierten Mitglieder (inkl. Datum/Uhrzeit, Quelle) wirklich löschen?\nVorher über „Liste exportieren“ sichern!')) return;
      GM_setValue(K_LOG, {}); GM_setValue(K_DONE, []); GM_setValue(K_FAILED, {}); alert('Erledigt-Liste geleert.');
    });
    GM_registerMenuCommand('Alter-Filter: Fehlschläge leeren', () => {
      if (!confirm('Alle gespeicherten Fehlschläge (Profile, Party-Scan, Mitgliedersuche) löschen?')) return;
      GM_setValue(K_FAILED, {}); GM_setValue(K_EVFAIL, []); GM_setValue(K_MS_FAIL, []); alert('Fehlschläge geleert.');
    });
    GM_registerMenuCommand('Alter-Filter: Typen-Info leeren', () => {
      if (!confirm('Gesammelte Infos zu anderen Profiltypen löschen?')) return;
      GM_setValue(K_TYPES, {}); alert('Typen-Info geleert.');
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
      GM_setValue(K_LOCK, Object.assign(l, { ts: Date.now(), url: location.href }));
      const vr = visRun(); if (vr) GM_setValue(K_VIS_RUN, Object.assign(vr, { ts: Date.now() })); // Lebenszeichen für die Sichtbarkeits-Wache
    }
    else releaseLock();
  }, 5000);

  // Notfall: alle Läufe (Suche, Gruppen- und Party-Scan), Sperre und Einmal-Ansichten zurücksetzen – Listen bleiben erhalten
  function resetAll() {
    resetState();
    GM_setValue(K_OPA, Object.assign(getOpa(), { running: false }));
    GM_setValue(K_EVSCAN, Object.assign(getEv(), { running: false }));
    GM_setValue(K_LOCK, null);
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
    const l = getLock(); if (l && Date.now() - l.ts > LOCK_TTL) GM_setValue(K_LOCK, null);
  })();

  // einmalig: Links der Whitelist-Mitglieder aus bereits bekannten Konten übernehmen
  try {
    const wl = whiteList();
    for (const [path, r] of Object.entries(getAccounts())) if (r.name && wl.includes(norm(r.name))) learnWhiteUrl(r.name, path);
  } catch (e) { /* egal */ }

  safeInit();
  let lastPath = location.pathname;
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; safeInit(); } }, 1000);
})();
