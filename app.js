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
  return { '@type': 'dash:Board', title: 'Dashboard', search: 'duckduckgo', weather: null, groups: [], bookmarks: [] };
}

// Coerce whatever the pod hands back into a valid board (untrusted input).
function normalize(raw) {
  const b = emptyBoard();
  if (!raw || typeof raw !== 'object') return b;
  if (typeof raw.title === 'string') b.title = raw.title.slice(0, 80);
  if (['duckduckgo', 'google', 'brave', 'bing', 'kagi'].includes(raw.search)) b.search = raw.search;
  if (raw.weather && typeof raw.weather === 'object' && isFinite(+raw.weather.lat) && isFinite(+raw.weather.lon)) {
    b.weather = { lat: +raw.weather.lat, lon: +raw.weather.lon, label: String(raw.weather.label || '').slice(0, 60) };
  }
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  b.groups = groups.slice(0, 40).map((g) => ({
    name: String((g && g.name) || 'Services').slice(0, 60),
    columns: g && +g.columns === 2 ? 2 : 1,
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

/* ------------------------------ the sample board ------------------------------ */
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

function render() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  app.replaceChildren();
  editBtn.hidden = readOnly;
  editBtn.classList.toggle('on', editing);
  editBtn.textContent = editing ? 'Done' : 'Edit';
  document.body.classList.toggle('editing', editing);

  const wrap = el('div');

  // demo banner when signed out
  if (readOnly && !me()) {
    wrap.appendChild(el('div', { class: 'demo-note' },
      'Demo board — sign in to load and edit your own dashboard, stored on your Solid pod.'));
  }

  wrap.appendChild(renderHead());
  wrap.appendChild(renderSearch());

  const groups = el('div', { class: 'groups' });
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

function iconTile(node, name, icon, href, size) {
  // Precedence: explicit icon URL → emoji/letter → auto favicon → glyph.
  const [c1, c2] = hashColor(name);
  node.style.background = 'linear-gradient(145deg,' + c2 + ',' + c1 + ')';
  const glyph = () => { node.textContent = (icon && !isUrl(icon) && icon) || (name[0] || '?').toUpperCase(); };
  const tryImg = (src, onfail) => {
    const img = el('img', { alt: '', loading: 'lazy' });
    img.src = src;
    img.addEventListener('error', () => { img.remove(); onfail(); });
    node.appendChild(img);
  };
  if (icon && isUrl(icon)) return tryImg(safeUrl(icon), glyph);
  if (icon) return glyph();
  // No explicit icon: try the service's own favicon, fall back to a glyph.
  const origin = (() => { try { return new URL(href).origin; } catch { return null; } })();
  if (origin) return tryImg(origin + '/favicon.ico', glyph);
  glyph();
}

function renderGroup(g, gi) {
  const box = el('div', { class: 'group' + (g.columns === 2 ? ' cols-2' : '') });
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
    const colBtn = el('button', { class: 'ic-btn', type: 'button', title: 'Toggle columns' }, g.columns === 2 ? '▤' : '▥');
    colBtn.addEventListener('click', () => { g.columns = g.columns === 2 ? 1 : 2; saveBoard(); render(); });
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

function showDemo() {
  readOnly = true; editing = false; board = sampleBoard();
  render();
}

function start() {
  const webid = me();
  if (!webid) { showDemo(); return; }
  app.replaceChildren(el('div', { class: 'loading' }, 'Loading your dashboard…'));
  discoverStorage(webid).then((storage) => {
    if (!storage) throw new Error('could not find your pod storage');
    URLDOC = storage + 'public/dash/board.jsonld';
    return K.loadJson(authFetch, URLDOC, { headers: { Accept: 'application/ld+json' } }).then((r) => {
      readOnly = false;
      if (r.missing) {
        // First run: seed a starter board so a new pod isn't blank.
        board = sampleBoard();
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

document.addEventListener('xlogin', start);
document.addEventListener('xlogout', () => { stopSync(); URLDOC = null; showDemo(); });

// xlogin restores sessions asynchronously; render the demo immediately so the
// page is never blank, then start() re-runs on the xlogin event if signed in.
showDemo();
setTimeout(() => { if (me()) start(); }, 600);

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
