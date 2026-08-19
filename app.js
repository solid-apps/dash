// dash — a self-hosted-style start page for your Solid pod.
//
// A gethomepage-flavoured dashboard: grouped service tiles, bookmarks, and
// live info widgets (clock, greeting, web search, weather). The whole board
// is one JSON document on your pod at <storage>public/dash/board.jsonld —
// editable in-app, written through, and live-synced across devices via
// SolidKit's Updates-Via subscription.
//
// Honest about being a browser-only app (no server proxy):
//   • widgets that work for real are the CORS-friendly ones (weather via
//     open-meteo, clock, web search) — no API keys, nothing faked;
//   • per-service "status" is a lightweight *reachability* ping from your
//     browser (an opaque no-cors fetch with a timeout), NOT an HTTP status —
//     the dot's tooltip says exactly that. Key-based service integrations
//     (Sonarr/Radarr/etc.) need a server proxy and are deliberately absent.

'use strict';

const K = window.SolidKit;
const app = document.getElementById('app');
const editBtn = document.getElementById('editBtn');
const toast = K.toaster(document.getElementById('toast'), 'show');

// "Share" copies a self-contained ?board= link (the whole board encoded in the
// URL — no host, no pod needed to open it). Created in JS so index.html stays
// static; shown by render() whenever there's a board worth sharing.
const themeBtn = el('button', { class: 'tbtn', type: 'button', title: 'Theme & accent colour' }, '🎨');
themeBtn.hidden = true;
document.querySelector('.topbar-r').insertBefore(themeBtn, editBtn);
themeBtn.addEventListener('click', appearanceModal);

// "Make this mine" — shown when signed in while viewing a shared/example board
// (?uri= / ?board=). Imports the viewed board to your pod and makes it editable,
// rather than silently clobbering your board.
const mineBtn = el('button', { class: 'tbtn', type: 'button', title: 'Save this board to your pod' }, 'Make this mine');
mineBtn.hidden = true;
document.querySelector('.topbar-r').insertBefore(mineBtn, editBtn);
mineBtn.addEventListener('click', importToPod);

const shareBtn = el('button', { class: 'tbtn', type: 'button', title: 'Copy a self-contained link to this board' }, 'Share');
shareBtn.hidden = true;
document.querySelector('.topbar-r').insertBefore(shareBtn, mineBtn);
shareBtn.addEventListener('click', () => {
  const link = shareLink();
  K.copyText(link).then((ok) => {
    if (!ok) return toast('Couldn’t copy the link', { error: true });
    toast(link.length > 4000
      ? 'Share link copied — it’s long (' + link.length + ' chars); some apps may truncate it.'
      : 'Share link copied to clipboard');
  });
});

/* ------------------------------ helpers ------------------------------ */

const esc = K.esc;
const safeDecode = K.safeDecode;

// Service/bookmark URLs are user-entered absolute links to *other* origins.
// NOT SolidKit.safeUrl: that resolves relative input against dash's own
// location, which would silently rewrite a mistyped service URL onto this
// origin. Here we require an absolute http(s) URL or reject outright.
function safeUrl(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {}
  return null;
}
const isUrl = (s) => !!safeUrl(s);

function authFetch(u, o) { return ((window.xlogin && window.xlogin.authFetch) || fetch)(u, o); }
function me() { return window.xlogin && window.xlogin.id; }

// Stable gradient from a string, so a glyph tile is always the same colour.
const PALETTE = [
  ['#6366f1', '#818cf8'], ['#06b6d4', '#22d3ee'], ['#f59e0b', '#fbbf24'],
  ['#22c55e', '#4ade80'], ['#3b82f6', '#60a5fa'], ['#ec4899', '#f472b6'],
  ['#10b981', '#34d399'], ['#f97316', '#fb923c'], ['#a855f7', '#c084fc'],
  ['#ef4444', '#f87171'], ['#14b8a6', '#2dd4bf'], ['#eab308', '#facc15']
];
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

// Built-in background presets — rich, layered gradient meshes (dark-oriented,
// like the gethomepage showcases). "accent" derives from the board's colour.
const PRESETS = {
  aurora: 'radial-gradient(1100px 760px at 12% 6%, rgba(16,185,129,.42), transparent 55%), radial-gradient(1000px 720px at 92% 18%, rgba(6,182,212,.36), transparent 55%), radial-gradient(1200px 820px at 50% 120%, rgba(59,130,246,.26), transparent 55%), linear-gradient(180deg,#04120f,#06101e)',
  nebula: 'radial-gradient(1100px 760px at 18% 0%, rgba(168,85,247,.44), transparent 55%), radial-gradient(1000px 720px at 92% 26%, rgba(236,72,153,.34), transparent 55%), radial-gradient(1200px 820px at 40% 120%, rgba(99,102,241,.3), transparent 55%), linear-gradient(180deg,#0c0518,#0a0a1e)',
  dusk: 'radial-gradient(1100px 760px at 14% 112%, rgba(249,115,22,.38), transparent 55%), radial-gradient(1000px 720px at 82% 100%, rgba(236,72,153,.3), transparent 55%), radial-gradient(1100px 820px at 60% -6%, rgba(139,92,246,.3), transparent 55%), linear-gradient(180deg,#170b1f,#0c0716)',
  ocean: 'radial-gradient(1200px 820px at 18% 0%, rgba(37,99,235,.42), transparent 55%), radial-gradient(1000px 720px at 92% 44%, rgba(20,184,166,.32), transparent 55%), radial-gradient(1000px 760px at 50% 120%, rgba(59,130,246,.2), transparent 55%), linear-gradient(180deg,#04101f,#061427)',
  ember: 'radial-gradient(1100px 760px at 14% 0%, rgba(239,68,68,.36), transparent 55%), radial-gradient(1000px 720px at 86% 92%, rgba(245,158,11,.3), transparent 55%), linear-gradient(180deg,#170806,#0e0a08)',
  mono: 'radial-gradient(1200px 860px at 50% -12%, rgba(255,255,255,.07), transparent 55%), linear-gradient(180deg,#0d0f16,#090b11)',
  accent: 'radial-gradient(1100px 820px at 12% -8%, color-mix(in srgb, var(--accent) 48%, transparent), transparent 55%), radial-gradient(1000px 720px at 95% 20%, color-mix(in srgb, var(--accent) 32%, transparent), transparent 55%), radial-gradient(1000px 760px at 55% 120%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 55%), linear-gradient(180deg,#0a0a14,#0a0c17)'
};

/* ------------------------------ storage ------------------------------ */

const PIM = 'http://www.w3.org/ns/pim/space#';
let URLDOC = null;       // absolute board-doc URL once storage is known
let lastSaveAt = 0;      // echo guard: ignore pubs within 2s of our own PUT
let unsub = null;        // live-sync unsubscribe (single subscription)
let subUrl = null;

function valOf(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return valOf(v[0]);
  if (typeof v === 'object') return v['@id'] || v['@value'] || null;
  return v;
}
function getLd(u) {
  return authFetch(u, { headers: { Accept: 'application/ld+json' } })
    .then((r) => (r.ok ? r.json().catch(() => null) : null))
    .catch(() => null);
}
function findThis(doc) {
  const g = Array.isArray(doc && doc['@graph']) ? doc['@graph'] : [doc];
  return g.find((n) => n && (n['pim:storage'] || n[PIM + 'storage'] || n['storage'])) || g[0] || {};
}
function discoverStorage(webid) {
  return getLd(webid.replace(/#.*$/, '')).then((doc) => {
    if (doc) {
      const s = findThis(doc);
      const id = valOf(s['pim:storage'] || s[PIM + 'storage'] || s['storage']);
      if (id) { try { return new URL(id, webid).href.replace(/\/?$/, '/'); } catch {} }
    }
    return new URL(webid).origin + '/';
  }).catch(() => { try { return new URL(webid).origin + '/'; } catch { return null; } });
}
function ensureContainer(u) {
  return authFetch(u, { method: 'HEAD' }).then((r) => {
    if (r.ok) return;
    return authFetch(u, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle', Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' },
      body: ''
    });
  }).catch(() => {});
}

/* ------------------------------ board model ------------------------------ */

// A board is plain JSON with a light @context so it reads cleanly on a pod.
// Kept deliberately simple: groups of services, groups of bookmarks, and a
// couple of widget settings.
function emptyBoard() {
  return { '@type': 'dash:Board', title: 'Dashboard', search: 'duckduckgo', theme: 'auto', accent: null, layout: 'auto', background: null, weather: null, groups: [], bookmarks: [] };
}

// Coerce whatever the pod hands back into a valid board (untrusted input).
function normalize(raw) {
  const b = emptyBoard();
  if (!raw || typeof raw !== 'object') return b;
  if (typeof raw.title === 'string') b.title = raw.title.slice(0, 80);
  if (['duckduckgo', 'google', 'brave', 'bing', 'kagi'].includes(raw.search)) b.search = raw.search;
  if (['auto', 'dark', 'light'].includes(raw.theme)) b.theme = raw.theme;
  if (typeof raw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent.trim())) b.accent = raw.accent.trim().toLowerCase();
  if (['auto', '1', '2', '3'].includes(String(raw.layout))) b.layout = String(raw.layout);
  if (raw.background && typeof raw.background === 'object') {
    const bgr = {};
    if (typeof raw.background.preset === 'string' && PRESETS[raw.background.preset]) bgr.preset = raw.background.preset;
    if (isUrl(raw.background.image)) bgr.image = safeUrl(raw.background.image);
    if (typeof raw.background.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.background.color.trim())) bgr.color = raw.background.color.trim().toLowerCase();
    bgr.blur = Math.max(0, Math.min(10, Math.round(+raw.background.blur || 0)));
    bgr.dim = Math.max(0, Math.min(70, Math.round(+raw.background.dim || 0)));
    if (bgr.preset || bgr.image || bgr.color) b.background = bgr;
  }
  if (raw.weather && typeof raw.weather === 'object' && isFinite(+raw.weather.lat) && isFinite(+raw.weather.lon)) {
    b.weather = { lat: +raw.weather.lat, lon: +raw.weather.lon, label: String(raw.weather.label || '').slice(0, 60) };
  }
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  b.groups = groups.slice(0, 40).map((g) => ({
    name: String((g && g.name) || 'Services').slice(0, 60),
    columns: g && [2, 3, 4].includes(+g.columns) ? +g.columns : 1,
    services: (Array.isArray(g && g.services) ? g.services : []).slice(0, 60).map(normSvc).filter(Boolean)
  }));
  const bms = Array.isArray(raw.bookmarks) ? raw.bookmarks : [];
  b.bookmarks = bms.slice(0, 40).map((bg) => ({
    name: String((bg && bg.name) || 'Bookmarks').slice(0, 60),
    links: (Array.isArray(bg && bg.links) ? bg.links : []).slice(0, 80).map(normLink).filter(Boolean)
  }));
  return b;
}
function normSvc(s) {
  if (!s || !isUrl(s.href)) return null;
  return {
    name: String(s.name || hostOf(s.href) || 'Service').slice(0, 60),
    href: safeUrl(s.href),
    subtitle: String(s.subtitle || '').slice(0, 80),
    icon: typeof s.icon === 'string' ? s.icon.slice(0, 400) : '',
    ping: !!s.ping
  };
}
function normLink(l) {
  if (!l || !isUrl(l.href)) return null;
  return { name: String(l.name || hostOf(l.href) || 'Link').slice(0, 60), href: safeUrl(l.href), icon: typeof l.icon === 'string' ? l.icon.slice(0, 200) : '' };
}

let board = emptyBoard();
let readOnly = true;       // signed-out demo, or another pod's public board
let editing = false;

function saveBoard() {
  if (!URLDOC || readOnly) return Promise.resolve();
  lastSaveAt = Date.now();
  const body = JSON.stringify(Object.assign({ '@context': { dash: 'https://solid-apps.github.io/dash/ns#' } }, board), null, 2);
  return authFetch(URLDOC, { method: 'PUT', headers: { 'Content-Type': 'application/ld+json' }, body })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); })
    .catch((e) => { toast('Couldn’t save to your pod — ' + e.message, { error: true }); throw e; });
}

/* ------------------------------ static board sources ------------------------------ */

// A structured-data island: <script type="application/ld+json" id="board">.
// This is how the demo is powered, and what seeds a fresh pod on first
// sign-in. Returns a normalized board, or null if absent/unparseable.
function islandBoard() {
  const tag = document.getElementById('board') ||
    document.querySelector('script[type="application/ld+json"]');
  if (!tag) return null;
  try {
    const data = JSON.parse(tag.textContent);
    const b = normalize(data);
    return (b.groups.length || b.bookmarks.length) ? b : null;
  } catch { return null; }
}

// ?uri=<url> — fetch and render any published dash:Board *resource*, so dash
// doubles as a viewer for boards that live anywhere (pod or not). ?uri= is the
// canonical name (matches the estate's resource-viewers, profile & pilot);
// ?src= is accepted as a silent alias (markmap/webprompts style).
function srcParam() {
  try {
    const p = new URL(location.href).searchParams;
    const s = p.get('uri') || p.get('src');
    if (!s) return null;
    // A board locator may be relative (e.g. ?uri=examples/homelab.jsonld) —
    // resolve it against the app, unlike the strict absolute-only gate we use
    // for user-entered *service* links. Still http(s) only.
    const abs = new URL(s, location.href);
    return (abs.protocol === 'http:' || abs.protocol === 'https:') ? abs.href : null;
  } catch { return null; }
}

// ?board=<data> — the board carried *inline* in the URL, so a single link is a
// whole self-contained dashboard (no host, no pod). Accepts base64url-encoded
// JSON (what "Copy share link" produces) or raw percent-encoded JSON. UTF-8
// safe so emoji icons survive the round-trip.
const NS = 'https://solid-apps.github.io/dash/ns#';
function b64urlEncode(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); }
function queryBoard() {
  try {
    const q = new URL(location.href).searchParams.get('board');  // already %-decoded
    if (!q) return null;
    const json = q.trim()[0] === '{' ? q : b64urlDecode(q);
    const b = normalize(JSON.parse(json));
    return (b.groups.length || b.bookmarks.length) ? b : null;
  } catch { return null; }
}
// Encode the current board back into a shareable ?board= link.
function shareLink() {
  const doc = Object.assign({ '@context': { dash: NS }, '@type': 'dash:Board' }, board);
  return location.origin + location.pathname + '?board=' + b64urlEncode(JSON.stringify(doc));
}

// The best available static board: the island, else the built-in sample.
function staticBoard() { return islandBoard() || sampleBoard(); }

// Shown signed-out (a real, clickable demo) and used to seed a brand-new pod.
function sampleBoard() {
  return normalize({
    title: 'dash',
    search: 'duckduckgo',
    groups: [
      { name: 'Solid Apps', columns: 2, services: [
        { name: 'glass', href: 'https://solid-apps.github.io/glass/', subtitle: 'liquid-glass desktop', icon: '❖' },
        { name: 'home', href: 'https://solid-apps.github.io/home/', subtitle: 'app launcher', icon: '\u{1F3E0}' },
        { name: 'portal', href: 'https://solid-apps.github.io/portal/', subtitle: 'link directory', icon: '\u{1F9ED}' },
        { name: 'explorer', href: 'https://solid-apps.github.io/explorer/', subtitle: 'pod file browser', icon: '\u{1F4C1}' }
      ]},
      { name: 'Media', columns: 1, services: [
        { name: 'music', href: 'https://solid-apps.github.io/music/', subtitle: 'pod music player', icon: '\u{1F3B5}' },
        { name: 'video', href: 'https://solid-apps.github.io/video/', subtitle: 'pod video', icon: '\u{1F3AC}' },
        { name: 'gallery', href: 'https://solid-apps.github.io/gallery/', subtitle: 'photo albums', icon: '\u{1F5BC}️' }
      ]}
    ],
    bookmarks: [
      { name: 'Solid', links: [
        { name: 'solidproject.org', href: 'https://solidproject.org' },
        { name: 'MDN', href: 'https://developer.mozilla.org' },
        { name: 'GitHub', href: 'https://github.com/solid-apps' }
      ]}
    ]
  });
}

/* ------------------------------ rendering ------------------------------ */

let clockTimer = null;

// Theme override (auto/dark/light) + accent colour, applied from the board so
// they travel with it. --accent-soft derives from --accent in CSS, so one
// property recolours the UI; the theme sets/clears data-theme on <html>.
function applyTheme() {
  const root = document.documentElement;
  if (board.theme && board.theme !== 'auto') root.setAttribute('data-theme', board.theme);
  else root.removeAttribute('data-theme');
  if (board.accent) root.style.setProperty('--accent', board.accent);
  else root.style.removeProperty('--accent');
}

// A fixed background layer (image with blur/dim, or a solid colour) behind the
// content; falls back to the CSS gradient when the board sets none.
function applyBackground() {
  let layer = document.getElementById('dash-bg');
  const bg = board.background;
  // image + gradient presets are rich/dark artwork → force the dark palette so
  // text stays legible over them; a solid colour respects the current theme.
  const rich = !!(bg && (bg.image || (bg.preset && PRESETS[bg.preset])));
  document.body.classList.toggle('custom-bg', !!bg);
  document.body.classList.toggle('dark-bg', rich);
  if (!bg) { if (layer) layer.remove(); return; }
  if (!layer) { layer = el('div', { id: 'dash-bg' }); document.body.insertBefore(layer, document.body.firstChild); }
  // reset anything a prior kind of background left behind
  layer.style.background = '';
  layer.style.filter = 'none';
  if (bg.preset && PRESETS[bg.preset]) {
    layer.style.background = PRESETS[bg.preset];
    layer.style.setProperty('--scrim', '0');
  } else if (bg.image) {
    layer.style.backgroundColor = 'var(--bg)';
    layer.style.backgroundImage = "url('" + bg.image.replace(/'/g, '%27') + "')";
    layer.style.filter = bg.blur ? 'blur(' + bg.blur + 'px)' : 'none';
    // "dim" is a theme-coloured scrim (var(--bg)) so text keeps contrast in
    // either theme — dark scrim under light text, light scrim under dark text.
    layer.style.setProperty('--scrim', ((bg.dim || 0) / 100).toFixed(2));
  } else {
    layer.style.backgroundColor = bg.color;
    layer.style.setProperty('--scrim', '0');
  }
}

function render() {
  applyTheme();
  applyBackground();
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  app.replaceChildren();
  editBtn.hidden = readOnly;
  editBtn.classList.toggle('on', editing);
  editBtn.textContent = editing ? 'Done' : 'Edit';
  shareBtn.hidden = !(board.groups.length || board.bookmarks.length);
  themeBtn.hidden = readOnly || !editing;
  mineBtn.hidden = !(me() && readOnly && viewingSrc);
  document.body.classList.toggle('editing', editing);

  const wrap = el('div');

  // context banner while read-only (demo, or viewing a shared ?uri= board)
  if (readOnly) {
    if (viewingSrc) {
      wrap.appendChild(el('div', { class: 'demo-note' }, 'Viewing a shared board (read-only). Sign in to build your own on your pod.'));
    } else if (!me()) {
      const note = el('div', { class: 'demo-note' }, 'Demo board — sign in to load and edit your own, or ');
      note.appendChild(el('a', { href: 'examples/', style: 'color:var(--accent);text-decoration:none;font-weight:600' }, 'browse 11 example layouts →'));
      wrap.appendChild(note);
    }
  }

  wrap.appendChild(renderHead());
  wrap.appendChild(renderSearch());

  const groups = el('div', { class: 'groups' });
  if (board.layout && board.layout !== 'auto') groups.style.gridTemplateColumns = 'repeat(' + board.layout + ', minmax(0,1fr))';
  board.groups.forEach((g, gi) => groups.appendChild(renderGroup(g, gi)));
  wrap.appendChild(groups);

  if (editing) {
    const ag = el('button', { class: 'add-group', type: 'button' }, '+ Add group');
    ag.addEventListener('click', () => { board.groups.push({ name: 'New group', columns: 1, services: [] }); saveBoard(); render(); });
    wrap.appendChild(ag);
  }

  if (board.bookmarks.length || editing) wrap.appendChild(renderBookmarks());

  app.appendChild(wrap);
  startClock();
  runPings();
}

function renderHead() {
  const now = new Date();
  const hr = now.getHours();
  const greeting = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const head = el('div', { class: 'head' });
  const l = el('div', { class: 'head-l' });
  l.appendChild(el('div', { class: 'greet' }, greeting + (me() && !readOnly ? ', ' + hostOf(me()) : '')));
  const title = el('div', { class: 'h-title' });
  title.textContent = board.title || 'Dashboard';
  if (editing) {
    title.contentEditable = 'true';
    title.spellcheck = false;
    title.addEventListener('blur', () => {
      const t = title.textContent.trim().slice(0, 80) || 'Dashboard';
      if (t !== board.title) { board.title = t; saveBoard(); }
    });
  }
  l.appendChild(title);
  head.appendChild(l);

  const r = el('div', { class: 'head-r' });
  r.appendChild(el('div', { class: 'clock', id: 'clock' }, ''));
  r.appendChild(el('div', { class: 'cdate', id: 'cdate' }, ''));
  const wx = el('div', { class: 'wx', id: 'wx' });
  r.appendChild(wx);
  head.appendChild(r);
  loadWeather(wx);
  return head;
}

function startClock() {
  const c = document.getElementById('clock');
  const d = document.getElementById('cdate');
  const tick = () => {
    const now = new Date();
    if (c) c.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (d) d.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  };
  tick();
  clockTimer = setInterval(tick, 15000);
}

const SEARCH = {
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  brave: { label: 'Brave', url: 'https://search.brave.com/search?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  kagi: { label: 'Kagi', url: 'https://kagi.com/search?q=' }
};
function renderSearch() {
  const bar = el('div', { class: 'searchbar' });
  const form = el('form');
  const inp = el('input', { class: 'si', type: 'text', placeholder: 'Search the web…', 'aria-label': 'Search the web' });
  form.appendChild(el('span', { class: 'mag' }, '\u{1F50D}'));
  form.appendChild(inp);
  const prov = el('button', { class: 'prov', type: 'button', title: 'Change search engine' }, SEARCH[board.search].label);
  prov.addEventListener('click', () => {
    const keys = Object.keys(SEARCH);
    board.search = keys[(keys.indexOf(board.search) + 1) % keys.length];
    prov.textContent = SEARCH[board.search].label;
    if (!readOnly) saveBoard();
    inp.focus();
  });
  form.appendChild(prov);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = inp.value.trim();
    if (q) window.open(SEARCH[board.search].url + encodeURIComponent(q), '_blank', 'noopener');
  });
  bar.appendChild(form);
  return bar;
}

// Icon packs — opt-in, CORS-friendly SVGs from a public CDN. "di:" is
// Dashboard Icons (full-colour self-hosted service logos, the gethomepage
// pack); "si:" is Simple Icons (monochrome brand marks). The app stays
// dependency-free unless a board actually uses a pack (emoji is the default).
const ICON_CDN = {
  di: (n) => 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/' + n + '.svg',
  si: (n) => 'https://cdn.jsdelivr.net/npm/simple-icons/icons/' + n + '.svg'
};
function packSrc(icon) {
  const m = /^(di|si):(.+)$/.exec(String(icon).trim());
  if (!m) return null;
  const n = m[2].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return n ? ICON_CDN[m[1]](n) : null;
}
// icon field: "di:<slug>" / "si:<slug>" (packs), an image URL, an emoji or
// letter, or blank (auto: the service's own favicon, then a letter). Packs,
// URLs and favicons render on a light "logo chip"; emoji/letters on a coloured
// gradient tile — the gethomepage look.
function iconTile(node, name, icon, href) {
  const [c1, c2] = hashColor(name);
  const glyph = () => {
    node.classList.remove('logo');
    node.style.background = 'linear-gradient(145deg,' + c2 + ',' + c1 + ')';
    node.replaceChildren();
    node.textContent = (icon && !packSrc(icon) && !isUrl(icon) && icon) || (name[0] || '?').toUpperCase();
  };
  const logo = (src) => {
    node.classList.add('logo');
    node.style.background = '';
    const img = el('img', { alt: '', loading: 'lazy' });
    img.src = src;
    img.addEventListener('error', () => { img.remove(); glyph(); });
    node.appendChild(img);
  };
  const ps = icon && packSrc(icon);
  if (ps) return logo(ps);
  if (icon && isUrl(icon)) return logo(safeUrl(icon));
  if (icon) return glyph();
  // No explicit icon: try the service's own favicon, fall back to a glyph.
  const origin = (() => { try { return new URL(href).origin; } catch { return null; } })();
  if (origin) return logo(origin + '/favicon.ico');
  glyph();
}

function renderGroup(g, gi) {
  const box = el('div', { class: 'group' + (g.columns > 1 ? ' cols-' + g.columns : '') });
  const h = el('div', { class: 'group-h' });
  const title = el('h2');
  title.textContent = g.name;
  if (editing) {
    title.contentEditable = 'true'; title.spellcheck = false;
    title.addEventListener('blur', () => { const t = title.textContent.trim().slice(0, 60) || 'Services'; if (t !== g.name) { g.name = t; saveBoard(); } });
  }
  h.appendChild(title);
  if (editing) {
    const ga = el('div', { class: 'ga' });
    const colBtn = el('button', { class: 'ic-btn', type: 'button', title: 'Columns (now ' + g.columns + ')' }, g.columns + '⁞');
    colBtn.addEventListener('click', () => { g.columns = g.columns >= 4 ? 1 : g.columns + 1; saveBoard(); render(); });
    const del = el('button', { class: 'ic-btn', type: 'button', title: 'Delete group' }, '✕');
    del.addEventListener('click', () => { if (confirm('Delete group "' + g.name + '"?')) { board.groups.splice(gi, 1); saveBoard(); render(); } });
    ga.appendChild(colBtn); ga.appendChild(del);
    h.appendChild(ga);
  }
  box.appendChild(h);

  const list = el('div', { class: 'svc-list' });
  g.services.forEach((s, si) => list.appendChild(renderService(g, s, si)));
  box.appendChild(list);

  if (editing) {
    const add = el('button', { class: 'add-svc', type: 'button' }, '+ Add service');
    add.addEventListener('click', () => serviceModal(g, null));
    box.appendChild(add);
  }
  return box;
}

function renderService(g, s, si) {
  const a = el('a', { class: 'svc', href: s.href, target: '_blank', rel: 'noopener noreferrer' });
  const ico = el('div', { class: 'svc-ico' });
  iconTile(ico, s.name, s.icon, s.href);
  a.appendChild(ico);
  const body = el('div', { class: 'svc-body' });
  body.appendChild(el('div', { class: 'svc-name' }, s.name));
  if (s.subtitle) body.appendChild(el('div', { class: 'svc-sub' }, s.subtitle));
  else body.appendChild(el('div', { class: 'svc-sub' }, hostOf(s.href)));
  a.appendChild(body);
  if (s.ping) {
    const dot = el('span', { class: 'svc-status', 'data-ping': s.href });
    dot.title = 'Reachability check from your browser (not an HTTP status).';
    a.appendChild(dot);
  }
  if (editing) {
    a.addEventListener('click', (e) => { e.preventDefault(); serviceModal(g, si); });
    const del = el('button', { class: 'del', type: 'button', title: 'Delete' }, '✕');
    del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); g.services.splice(si, 1); saveBoard(); render(); });
    a.appendChild(del);
  }
  return a;
}

function renderBookmarks() {
  const wrap = el('div', { class: 'bm-wrap' });
  wrap.appendChild(el('div', { class: 'group-h' }, el('h2', {}, 'Bookmarks')));
  const groups = el('div', { class: 'bm-groups' });
  board.bookmarks.forEach((bg, bi) => {
    const col = el('div', { class: 'bm-group' });
    const h = el('h3');
    h.textContent = bg.name;
    if (editing) {
      h.contentEditable = 'true'; h.spellcheck = false;
      h.addEventListener('blur', () => { const t = h.textContent.trim().slice(0, 60) || 'Bookmarks'; if (t !== bg.name) { bg.name = t; saveBoard(); } });
    }
    col.appendChild(h);
    const list = el('div', { class: 'bm-list' });
    bg.links.forEach((l, li) => {
      const a = el('a', { class: 'bm', href: l.href, target: '_blank', rel: 'noopener noreferrer' });
      const [c1, c2] = hashColor(l.name);
      const ab = el('span', { class: 'bm-abbr' });
      ab.style.background = 'linear-gradient(145deg,' + c2 + ',' + c1 + ')';
      ab.textContent = (l.name.replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase();
      a.appendChild(ab);
      a.appendChild(document.createTextNode(l.name));
      if (editing) {
        a.addEventListener('click', (e) => { e.preventDefault(); bookmarkModal(bg, li); });
        const del = el('button', { class: 'del', type: 'button', title: 'Delete' }, '✕');
        del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); bg.links.splice(li, 1); saveBoard(); render(); });
        a.appendChild(del);
      }
      list.appendChild(a);
    });
    if (editing) {
      const add = el('button', { class: 'ic-btn', type: 'button', title: 'Add bookmark' }, '+ add');
      add.addEventListener('click', () => bookmarkModal(bg, null));
      list.appendChild(add);
    }
    col.appendChild(list);
    if (editing) {
      const delG = el('button', { class: 'ic-btn', type: 'button', title: 'Delete group' }, '✕ group');
      delG.addEventListener('click', () => { if (confirm('Delete bookmark group "' + bg.name + '"?')) { board.bookmarks.splice(bi, 1); saveBoard(); render(); } });
      col.appendChild(delG);
    }
    groups.appendChild(col);
  });
  wrap.appendChild(groups);
  if (editing) {
    const ag = el('button', { class: 'add-svc', type: 'button', style: 'max-width:220px' }, '+ Add bookmark group');
    ag.addEventListener('click', () => { board.bookmarks.push({ name: 'Bookmarks', links: [] }); saveBoard(); render(); });
    wrap.appendChild(ag);
  }
  return wrap;
}

/* ------------------------------ weather (open-meteo, CORS-friendly) ------------------------------ */

const WX_ICONS = { 0: '☀️', 1: '\u{1F324}️', 2: '⛅', 3: '☁️', 45: '\u{1F32B}️', 48: '\u{1F32B}️', 51: '\u{1F327}️', 61: '\u{1F327}️', 63: '\u{1F327}️', 65: '\u{1F327}️', 71: '\u{1F328}️', 73: '\u{1F328}️', 75: '\u{1F328}️', 80: '\u{1F326}️', 81: '\u{1F326}️', 82: '⛈️', 95: '⛈️', 96: '⛈️' };
function wxIcon(code) { return WX_ICONS[code] || '\u{1F321}️'; }

function loadWeather(node) {
  if (!board.weather) {
    if (!readOnly) {
      const b = el('button', { class: 'prov', type: 'button', style: 'position:static;transform:none' }, '+ weather');
      b.addEventListener('click', weatherModal);
      node.appendChild(b);
    }
    return;
  }
  const w = board.weather;
  node.textContent = 'loading weather…';
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + w.lat + '&longitude=' + w.lon + '&current=temperature_2m,weather_code';
  fetch(url, { signal: to(8000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((d) => {
      const c = d && d.current;
      if (!c) throw new Error('no data');
      node.replaceChildren();
      node.appendChild(el('span', {}, wxIcon(c.weather_code)));
      node.appendChild(el('span', { class: 'wt' }, Math.round(c.temperature_2m) + '°'));
      node.appendChild(el('span', {}, w.label || (w.lat.toFixed(1) + ',' + w.lon.toFixed(1))));
      if (!readOnly) {
        const edit = el('button', { class: 'prov', type: 'button', title: 'Change location', style: 'position:static;transform:none;padding:0 4px' }, '✎');
        edit.addEventListener('click', weatherModal);
        node.appendChild(edit);
      }
    })
    .catch(() => { node.textContent = 'weather unavailable'; });
}

/* ------------------------------ reachability pings ------------------------------ */
// Honest coarse signal: an opaque no-cors fetch either resolves (the host
// answered — "up") or rejects/times out ("down"). It is NOT an HTTP status,
// and the dot's tooltip says so. Runs only for services with ping enabled.
function runPings() {
  for (const dot of app.querySelectorAll('.svc-status[data-ping]')) {
    const href = dot.getAttribute('data-ping');
    dot.className = 'svc-status checking';
    fetch(href, { mode: 'no-cors', signal: to(5000) })
      .then(() => { dot.className = 'svc-status up'; })
      .catch(() => { dot.className = 'svc-status down'; });
  }
}
function to(ms) { return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined; }

/* ------------------------------ edit modals ------------------------------ */

let modalOpen = false;
function modal(title, fields, onSave, extra) {
  modalOpen = true;
  const bg = el('div', { class: 'modal-bg' });
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  box.appendChild(el('h2', {}, title));
  const inputs = {};
  for (const f of fields) {
    const wrap = el('div', { class: 'field' + (f.inline ? ' inline' : '') });
    if (f.type === 'checkbox') {
      wrap.className = 'field row';
      const cb = el('input', { type: 'checkbox', id: 'f_' + f.key });
      cb.checked = !!f.value;
      wrap.appendChild(cb);
      wrap.appendChild(el('label', { for: 'f_' + f.key }, f.label));
      inputs[f.key] = cb;
    } else if (f.type === 'select') {
      wrap.appendChild(el('label', {}, f.label));
      const sel = el('select');
      for (const o of f.options) { const op = el('option', { value: o.value }, o.label); if (o.value === f.value) op.selected = true; sel.appendChild(op); }
      wrap.appendChild(sel);
      inputs[f.key] = sel;
    } else {
      wrap.appendChild(el('label', {}, f.label));
      const inp = el('input', { type: 'text', placeholder: f.placeholder || '' });
      inp.value = f.value || '';
      wrap.appendChild(inp);
      inputs[f.key] = inp;
    }
    box.appendChild(wrap);
  }
  const actions = el('div', { class: 'modal-actions' });
  const left = el('div', { class: 'left' });
  if (extra && extra.onDelete) {
    const d = el('button', { class: 'btn', type: 'button' }, 'Delete');
    d.addEventListener('click', () => { close(); extra.onDelete(); });
    left.appendChild(d);
  }
  actions.appendChild(left);
  const right = el('div', { class: 'left' });
  const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
  cancel.addEventListener('click', close);
  const save = el('button', { class: 'btn primary', type: 'button' }, 'Save');
  save.addEventListener('click', () => {
    const vals = {};
    for (const k in inputs) vals[k] = inputs[k].type === 'checkbox' ? inputs[k].checked : inputs[k].value;
    if (onSave(vals) !== false) close();
  });
  right.appendChild(cancel); right.appendChild(save);
  actions.appendChild(right);
  box.appendChild(actions);
  bg.appendChild(box);
  document.body.appendChild(bg);
  const firstInput = box.querySelector('input[type=text], select');
  if (firstInput) firstInput.focus();

  function close() { modalOpen = false; bg.remove(); document.removeEventListener('keydown', onKey); if (pendingSync) { pendingSync = false; applyRemote(); } }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); save.click(); }
  }
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
}

function serviceModal(g, si) {
  const s = si != null ? g.services[si] : { name: '', href: '', subtitle: '', icon: '', ping: false };
  modal(si != null ? 'Edit service' : 'Add service', [
    { key: 'name', label: 'Name', value: s.name, placeholder: 'Jellyfin' },
    { key: 'href', label: 'URL', value: s.href, placeholder: 'https://…' },
    { key: 'subtitle', label: 'Subtitle', value: s.subtitle, placeholder: 'Media server' },
    { key: 'icon', label: 'Icon — emoji, a letter, or an image URL (blank = auto favicon)', value: s.icon, placeholder: '\u{1F3AC} or https://…/icon.png' },
    { key: 'ping', label: 'Show a reachability status dot', type: 'checkbox', value: s.ping }
  ], (v) => {
    if (!isUrl(v.href)) { toast('Enter a valid http(s) URL', { error: true }); return false; }
    const svc = normSvc(v);
    if (si != null) g.services[si] = svc; else g.services.push(svc);
    saveBoard(); render();
  }, si != null ? { onDelete: () => { g.services.splice(si, 1); saveBoard(); render(); } } : null);
}

function bookmarkModal(bg, li) {
  const l = li != null ? bg.links[li] : { name: '', href: '' };
  modal(li != null ? 'Edit bookmark' : 'Add bookmark', [
    { key: 'name', label: 'Name', value: l.name, placeholder: 'GitHub' },
    { key: 'href', label: 'URL', value: l.href, placeholder: 'https://…' }
  ], (v) => {
    if (!isUrl(v.href)) { toast('Enter a valid http(s) URL', { error: true }); return false; }
    const link = normLink(v);
    if (li != null) bg.links[li] = link; else bg.links.push(link);
    saveBoard(); render();
  }, li != null ? { onDelete: () => { bg.links.splice(li, 1); saveBoard(); render(); } } : null);
}

function weatherModal() {
  const w = board.weather || {};
  modal('Weather location', [
    { key: 'q', label: 'Search a city', value: w.label || '', placeholder: 'Berlin' }
  ], (v) => {
    const q = (v.q || '').trim();
    if (!q) { board.weather = null; saveBoard(); render(); return; }
    // open-meteo geocoding — CORS-friendly, no key.
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(q), { signal: to(8000) })
      .then((r) => r.json())
      .then((d) => {
        const hit = d && d.results && d.results[0];
        if (!hit) { toast('City not found', { error: true }); return; }
        board.weather = { lat: hit.latitude, lon: hit.longitude, label: hit.name + (hit.country_code ? ', ' + hit.country_code : '') };
        saveBoard(); render();
      })
      .catch(() => toast('Geocoding failed', { error: true }));
  });
}

/* ------------------------------ appearance ------------------------------ */
// gethomepage-style theming: a base theme override + an accent colour, both
// stored in the board. Swatches echo the Tailwind hues homepage uses.
const ACCENTS = [
  ['Blue', '#3b82f6'], ['Indigo', '#6366f1'], ['Violet', '#8b5cf6'], ['Purple', '#a855f7'],
  ['Pink', '#ec4899'], ['Rose', '#f43f5e'], ['Red', '#ef4444'], ['Orange', '#f97316'],
  ['Amber', '#f59e0b'], ['Emerald', '#10b981'], ['Teal', '#14b8a6'], ['Cyan', '#06b6d4'],
  ['Sky', '#0ea5e9'], ['Lime', '#84cc16'], ['Slate', '#64748b']
];
function appearanceModal() {
  modalOpen = true;
  const bg = el('div', { class: 'modal-bg' });
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  box.appendChild(el('h2', {}, 'Appearance'));

  const tf = el('div', { class: 'field' });
  tf.appendChild(el('label', {}, 'Theme'));
  const seg = el('div', { class: 'seg' });
  ['auto', 'dark', 'light'].forEach((t) => {
    const b = el('button', { type: 'button' }, t[0].toUpperCase() + t.slice(1));
    if ((board.theme || 'auto') === t) b.classList.add('on');
    b.addEventListener('click', () => {
      board.theme = t;
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      applyTheme();
    });
    seg.appendChild(b);
  });
  tf.appendChild(seg);
  box.appendChild(tf);

  const af = el('div', { class: 'field' });
  af.appendChild(el('label', {}, 'Accent colour'));
  const sw = el('div', { class: 'swatches' });
  const btns = {};
  const markSel = (hex) => Object.keys(btns).forEach((k) => btns[k].classList.toggle('on', k === 'def' ? !hex : k === hex));
  const def = el('button', { class: 'swatch def', type: 'button', title: 'Theme default' }, '∅');
  def.addEventListener('click', () => { board.accent = null; applyTheme(); markSel(null); });
  btns.def = def; sw.appendChild(def);
  ACCENTS.forEach(([name, hex]) => {
    const b = el('button', { class: 'swatch', type: 'button', title: name });
    b.style.background = hex;
    b.addEventListener('click', () => { board.accent = hex; applyTheme(); markSel(hex); });
    btns[hex] = b; sw.appendChild(b);
  });
  markSel(board.accent);
  af.appendChild(sw);
  box.appendChild(af);

  // group columns (board-level layout)
  const lf = el('div', { class: 'field' });
  lf.appendChild(el('label', {}, 'Group columns'));
  const lseg = el('div', { class: 'seg' });
  ['auto', '1', '2', '3'].forEach((v) => {
    const b = el('button', { type: 'button' }, v === 'auto' ? 'Auto' : v);
    if ((board.layout || 'auto') === v) b.classList.add('on');
    b.addEventListener('click', () => {
      board.layout = v;
      lseg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      render();  // re-lays the groups grid; the modal (a body child) survives
    });
    lseg.appendChild(b);
  });
  lf.appendChild(lseg);
  box.appendChild(lf);

  // background — built-in gradient presets, or your own image
  const bf = el('div', { class: 'field' });
  bf.appendChild(el('label', {}, 'Background'));
  const prow = el('div', { class: 'bg-presets' });
  const pbtns = {};
  const markBg = (key) => Object.keys(pbtns).forEach((k) => pbtns[k].classList.toggle('on', k === key));
  const none = el('button', { class: 'bg-preset none', type: 'button', title: 'Default (theme gradient)' }, '∅');
  none.addEventListener('click', () => {
    board.background = null; bImg.value = ''; blur.value = '0'; dim.value = '0';
    applyBackground(); markBg('none');
  });
  pbtns.none = none; prow.appendChild(none);
  Object.keys(PRESETS).forEach((key) => {
    const pb = el('button', { class: 'bg-preset', type: 'button', title: key });
    pb.style.background = PRESETS[key];
    pb.addEventListener('click', () => {
      board.background = { preset: key }; bImg.value = '';
      applyBackground(); markBg(key);
    });
    pbtns[key] = pb; prow.appendChild(pb);
  });
  bf.appendChild(prow);
  const bImg = el('input', { type: 'text', placeholder: 'or a background image URL — https://…/photo.jpg' });
  bImg.value = (board.background && board.background.image) || '';
  bf.appendChild(bImg);
  box.appendChild(bf);
  const brow = el('div', { class: 'field inline' });
  const blurW = el('div', {}); blurW.appendChild(el('label', {}, 'Blur'));
  const blur = el('input', { type: 'range', min: '0', max: '10', value: String((board.background && board.background.blur) || 0) });
  blurW.appendChild(blur);
  const dimW = el('div', {}); dimW.appendChild(el('label', {}, 'Dim'));
  const dim = el('input', { type: 'range', min: '0', max: '70', value: String((board.background && board.background.dim) || 0) });
  dimW.appendChild(dim);
  brow.appendChild(blurW); brow.appendChild(dimW);
  box.appendChild(brow);
  const applyImg = () => {
    const u = bImg.value.trim();
    board.background = (u && isUrl(u)) ? { image: safeUrl(u), blur: +blur.value, dim: +dim.value } : null;
    applyBackground();
    markBg(board.background ? '__image' : 'none');
  };
  bImg.addEventListener('input', applyImg);
  blur.addEventListener('input', () => { if (board.background && board.background.image) applyImg(); });
  dim.addEventListener('input', () => { if (board.background && board.background.image) applyImg(); });
  markBg(board.background ? (board.background.preset || (board.background.image ? '__image' : 'none')) : 'none');

  const actions = el('div', { class: 'modal-actions' });
  actions.appendChild(el('div', {}));
  const done = el('button', { class: 'btn primary', type: 'button' }, 'Done');
  done.addEventListener('click', close);
  actions.appendChild(done);
  box.appendChild(actions);

  bg.appendChild(box); document.body.appendChild(bg);
  function close() { modalOpen = false; bg.remove(); document.removeEventListener('keydown', onKey); saveBoard(); render(); if (pendingSync) { pendingSync = false; applyRemote(); } }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
}

/* ------------------------------ live sync ------------------------------ */

let pendingSync = false;
function startSync() {
  if (!URLDOC || subUrl === URLDOC || readOnly) return;
  subUrl = URLDOC;
  K.subscribe(URLDOC, onRemotePub, { fetch: authFetch })
    .then((u) => { unsub = u; })
    .catch(() => { subUrl = null; /* no Updates-Via — run without live sync */ });
}
function onRemotePub() {
  if (Date.now() - lastSaveAt < 2000) return;   // our own write echoing back
  if (modalOpen || editing) { pendingSync = true; return; }  // don't clobber an edit
  applyRemote();
}
function applyRemote() {
  K.loadJson(authFetch, URLDOC, { headers: { Accept: 'application/ld+json' } }).then((r) => {
    if (!r.ok || r.missing) return;
    board = normalize(r.data);
    render();
  });
}
function stopSync() { if (unsub) { unsub(); unsub = null; } subUrl = null; pendingSync = false; }

/* ------------------------------ boot ------------------------------ */

editBtn.addEventListener('click', () => { editing = !editing; render(); if (!editing && pendingSync) { pendingSync = false; applyRemote(); } });

const SRC = srcParam();
let viewingSrc = false;   // rendering a ?src= board (shared, read-only)

// Read-only render from a static source: a ?src= document if given, else the
// inline data island, else the built-in sample. Paints instantly from the
// island/sample, then swaps in the ?src= board once it loads.
function showStatic() {
  readOnly = true; editing = false; viewingSrc = false;
  // Inline ?board= wins — it's fully self-contained, nothing to fetch.
  const qb = queryBoard();
  if (qb) { viewingSrc = true; board = qb; render(); return; }
  board = staticBoard();
  render();
  if (SRC) {
    viewingSrc = true;
    K.loadJson(fetch, SRC, { headers: { Accept: 'application/ld+json' } }).then((r) => {
      if (r.ok && !r.missing) { board = normalize(r.data); render(); }
      else toast('Couldn’t load that board — ' + (r.error ? r.error.message : 'HTTP ' + r.status), { error: true });
    });
  }
}

// Import the currently-viewed shared/example board into your pod, then switch
// to the live editable copy (clears ?uri=/?board= from the URL so a refresh
// loads your pod board).
function importToPod() {
  const webid = me();
  if (!webid) return;
  const incoming = board;
  toast('Saving to your pod…');
  discoverStorage(webid).then((storage) => {
    if (!storage) throw new Error('could not find your pod storage');
    URLDOC = storage + 'public/dash/board.jsonld';
    readOnly = false; viewingSrc = false; board = incoming;
    try { history.replaceState(null, '', location.pathname); } catch {}
    return ensureContainer(storage + 'public/dash/').then(() => saveBoard());
  }).then(() => { editing = false; render(); startSync(); toast('Saved — this board is now yours'); })
    .catch((e) => { readOnly = true; viewingSrc = true; render(); toast('Couldn’t save: ' + e.message, { error: true }); });
}

function start() {
  const webid = me();
  if (!webid) { showStatic(); return; }
  app.replaceChildren(el('div', { class: 'loading' }, 'Loading your dashboard…'));
  discoverStorage(webid).then((storage) => {
    if (!storage) throw new Error('could not find your pod storage');
    URLDOC = storage + 'public/dash/board.jsonld';
    return K.loadJson(authFetch, URLDOC, { headers: { Accept: 'application/ld+json' } }).then((r) => {
      readOnly = false;
      if (r.missing) {
        // First run: seed the pod from the data island (or the sample) so a
        // new pod isn't blank — author a board in HTML, sign in, it's yours.
        board = staticBoard();
        return ensureContainer(storage + 'public/dash/').then(() => saveBoard().catch(() => {}));
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      board = normalize(r.data);
    });
  }).then(() => { render(); startSync(); })
    .catch((e) => {
      app.replaceChildren(el('div', { class: 'err' },
        el('strong', {}, 'Couldn’t load your dashboard'),
        el('div', {}, e.message + '. Your board was not changed.'),
        el('div', { style: 'margin-top:14px' }, retryBtn())));
    });
}
function retryBtn() { const b = el('button', { class: 'btn', type: 'button' }, 'Retry'); b.addEventListener('click', start); return b; }

// A ?uri=/?board= link is always a read-only view — signing in must NOT replace
// it with your pod board (that race showed a shared board as editable). When no
// such link is present, signing in loads your pod board.
const staticView = () => !!(SRC || queryBoard());
document.addEventListener('xlogin', () => { if (!staticView()) start(); else render(); });
document.addEventListener('xlogout', () => { stopSync(); URLDOC = null; showStatic(); });

// xlogin restores sessions asynchronously; render the static board (island /
// ?uri= / ?board= / sample) immediately so the page is never blank, then
// start() runs on the xlogin event only when there's no shared-board link.
showStatic();
if (!staticView()) setTimeout(() => { if (me()) start(); }, 600);

/* ------------------------------ tiny hyperscript ------------------------------ */
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'style') n.setAttribute('style', attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  for (const kid of kids) {
    if (kid == null) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}
