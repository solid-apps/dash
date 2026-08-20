# ◈ dash

**A self-hosted-style start page for your Solid pod.** A
[gethomepage](https://github.com/gethomepage/homepage)-flavoured dashboard —
grouped service tiles, bookmarks, and live info widgets — but the whole board
is one document **on your pod**, editable in place and synced across your
devices.

🔗 **Live demo:** https://solid-apps.github.io/dash/

Open the page. Sign in from the estate's shared login (Solid OIDC or Nostr) and
your board loads from `‹pod›/public/dash/board.jsonld`. Edit it in the browser
— add a service, drop a bookmark, pick a weather city — and it writes straight
back to the pod. Open dash on another device and it's already there; edits
appear **live** while you watch, over solid-0.1 `Updates-Via`.

Signed out, dash shows a real, clickable demo board so you can see the shape of
it before you commit.

## What's on the board

| Piece | What it does |
|---|---|
| **Service groups** | Named groups of tiles (icon, name, subtitle) in one or two columns — your apps, servers, and tools. |
| **Bookmarks** | Compact pill links, grouped — the stuff you open a dozen times a day. |
| **Info widgets** | A clock, a greeting, a web-search bar (DuckDuckGo / Google / Brave / Bing / Kagi), and live **weather** (via open-meteo — no key). |
| **Status dots** | Opt-in per service: a lightweight **reachability** ping from your browser. |
| **Icons** | Each service tile shows a **real logo** — `di:<slug>` for [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) (full-colour self-hosted service logos, the gethomepage pack), `si:<slug>` for [Simple Icons](https://simpleicons.org), an image URL, an emoji or letter, or blank for the site's own favicon. Packs are opt-in CDN SVGs — the app stays dependency-free unless a board uses one. |
| **Appearance** | A **theme** (auto / dark / light), an **accent colour**, a **background**, and **group columns** (auto / 1–3 board-wide, 1–4 per group) — all stored in the board so they travel with it via the pod and `?board=`/`?uri=`. Open with the 🎨 button in edit mode. Each example layout ships tinted to match its subject; the Minimal board shows a photo background. |
| **Backgrounds** | Nine built-in gradient **presets** — the dark meshes Aurora, Nebula, Dusk, Ocean, Ember, Mono, and **Accent** (derived from your accent colour), plus two light ones, **Paper** (warm) and **Mist** (cool). Or bring your own **image** URL (with blur + a dim scrim). Dark presets and images flip the board to a legible light-on-dark palette; the light presets flip it to a warm dark-on-light one; a solid colour follows the theme. The Classic Web Portal example uses Paper for a lighter, indie-web feel. |

## Honest about being browser-only

Real Homepage runs a server that proxies to your services, so API keys stay
server-side and CORS is bypassed. dash is a static app served from your pod —
there is no proxy — so it is deliberate about what it shows:

- ✅ **Real:** bookmarks, links, weather, clock, and web search all work for
  real, no keys, nothing faked.
- ⚠️ **Reachability, not status:** a service's status dot is an opaque `no-cors`
  fetch with a timeout — it tells you the host *answered*, not its HTTP code.
  The dot's tooltip says exactly that.
- ❌ **Not here:** the API-key service widgets (Sonarr/Radarr/etc.). Those need
  a server to hold the key and dodge CORS. When dash is served same-origin
  behind a pod server (e.g. [jspod](https://github.com/JavaScriptSolidServer/jspod)),
  that door opens — until then, dash stays honest.

## The board document

One JSON-LD file, human-readable, at `‹pod›/public/dash/board.jsonld`:

```jsonc
{
  "@context": { "dash": "https://solid-apps.github.io/dash/ns#" },
  "@type": "dash:Board",
  "title": "Dashboard",
  "search": "duckduckgo",
  "weather": { "lat": 52.52, "lon": 13.41, "label": "Berlin, DE" },
  "groups": [
    { "name": "Media", "columns": 2, "services": [
      { "name": "Jellyfin", "href": "https://jelly.example", "subtitle": "Movies & TV", "icon": "🎬", "ping": true }
    ]}
  ],
  "bookmarks": [
    { "name": "Dev", "links": [ { "name": "GitHub", "href": "https://github.com" } ] }
  ]
}
```

Edit it in-app, or edit the file directly — dash re-reads it live either way.

### Powered by a data island

The board is also a **structured-data island**: the page ships an inline
`<script type="application/ld+json" id="board">` holding a `dash:Board`. That
island is what powers the signed-out demo, and it **seeds your pod** the first
time you sign in — so you can author a whole board by editing HTML, sign in,
and it becomes yours.

dash reads its board in order of authority:

1. **your pod board** (signed in) — writable, live-synced;
2. **`?board=<data>`** — the whole board carried *inline* in the URL, so one
   link is a complete self-contained dashboard (no host, no pod). The **Share**
   button copies exactly this. Accepts base64url-encoded JSON or raw JSON;
3. **`?uri=<url>`** — fetch and render *any* published `dash:Board` resource
   (read-only), so dash doubles as a viewer for boards hosted anywhere.
   `?src=<url>` is accepted as an alias. Because a link *inside* a board can
   itself point at `?uri=` of another board, directories **nest** — see the
   **Classic Web Portal** example, a Yahoo!-style directory whose categories
   drill down into sub-boards (and sub-sub-boards), each its own `dash:Board`;
4. the **inline data island**;
5. a built-in sample.

Because a `dash:Board` is just a typed JSON-LD resource, a board saved on your
pod can also be opened by the estate's shells (glass, hub) and dispatched to a
dash pane by `rdf:type` — the same SLIP-48 flow the rest of the suite uses.

## Architecture

One `index.html` + `style.css` + `app.js`, no build step. Auth is the shared
`xlogin` widget; the hardened helpers (escaping, safe loads, honest toasts, and
the `Updates-Via` subscription manager) come from
[SolidKit](https://solid-apps.github.io/kit/), vendored as `kit.js` + `kit.css`.
Dark-first, light-mode aware, keyboard-friendly.

## License

[AGPL-3.0-only](LICENSE)
