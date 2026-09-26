# float

A floating, always-on-top mini player for macOS and Linux showing **line-synced lyrics** for whatever is playing
on Spotify. Lyrics come from [LRCLIB](https://lrclib.net) and are cached in SQLite. Click a line to jump there,
right-click to copy it. The header and resize zones appear only while the cursor is over the card; otherwise
clicks pass straight through. The menu-bar icon holds the rest: hide/show, timing nudges, sign in again, quit.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/arvinpaundra/float/master/install.sh | bash
```

Verifies the release SHA-256 and installs without sudo — `float.app` into `~/Applications`, or an AppImage into
`~/.local/bin` plus a desktop entry on Linux (x86_64, glibc 2.35+). Pin a version with `| bash -s -- 0.3.1`,
remove with `| bash -s -- --uninstall`. Your Spotify account must be on the build's User Management list, see
[Limitations](#limitations).

## Setup

Needs [Rust](https://rustup.rs), [bun](https://bun.sh), Spotify **Premium** and a Spotify app you own. On Linux
also `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`,
`build-essential`.

1. At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) create a Web API app, add the
   redirect URIs `http://127.0.0.1:43821/callback` and the same for `:43822` and `:43823`, then add every
   account that will use float under **User Management** (development mode allows 5).
2. `cp .env.example .env` and set `SPOTIFY_CLIENT_ID` — inlined into the UI bundle at build time (PKCE, no secret).
3. `bun install && bun run dev`, then hover the card and click **Connect**.

## How it works

```
poll /me/player/currently-playing (adaptive 0.5-10 s)
   └─► local clock (monotonic, RTT/2, slews small drift, snaps on seek/skip/pause)
new track ─► SQLite cache ─► LRCLIB /api/get (title → artist → no album → cleaned) → /api/search
         ─► LRC parse ─► rAF: line = lineAt(clock + lead + offsets) ─► highlight + smooth scroll
```

Tauri v2 (Rust: window, tray, OAuth loopback, hover watcher, SQLite migrations) plus TypeScript with
[Effect](https://effect.website) in one webview, bundled by `bun build`. Spotify has no push API, so float polls
and extrapolates: accuracy is line-level, and a seek made in Spotify shows up within ~3 s. Click-through is
lifted by a 10 Hz cursor poll in Rust. Data lives in `dev.float.lyrics/`: `auth.json` (0600), `float.db`,
`position.json`.

`ui/ts/` holds the logic, one module per concern, each with a `*.test.ts`. `tauri/src/lib.rs` is the whole Rust
side; `ui/src/index.html` is the entire card UI.

## Development

```sh
bun run dev         # UI bundle + cargo run
bun run watch       # rebuild the bundle on change
bun run test        # pure logic: clock, LRC, matching, theme, …
bun run typecheck   # tsc --noEmit (strict)
```

## Release

The **git tag is the version** — every manifest in the repo holds `0.0.0`:

```sh
git tag v0.3.5 && git push origin v0.3.5   # CI builds macOS + Linux and publishes
```

`scripts/release.sh` does the same locally, with `--install`, `--publish`, and `--sign` for Developer ID and
notarization. Builds are ad-hoc signed; `install.sh` downloads with curl, which doesn't quarantine, so the app
opens without a Gatekeeper prompt — a `.dmg` fetched in a browser needs *Open Anyway* once.

## Platform notes

Linux runs the same card and tray. Frosted glass is macOS-only, and copying uses `wl-copy`/`xclip`/`xsel`. The
card needs X11 semantics — native Wayland has no global cursor position, no always-on-top and no window
placement — so float switches to XWayland where it is available. Without it the card still works but stays
clickable rather than click-through and won't float above other windows. MPRIS (VLC, mpv, browsers) is not built
yet.

The AppImage carries its own WebKitGTK, whose DMA-BUF renderer can abort against a newer host graphics stack
(blank card, or `WebKitWebProcess has encountered a fatal error`). float sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`
for AppImage runs; set it to `0` to opt out, or try `WEBKIT_DISABLE_COMPOSITING_MODE=1`.

## Limitations

- **Spotify development mode:** 5 allowlisted users per Client ID, and the owner needs Premium. Distributing
  publicly means each user brings their own Client ID.
- **Spotify policy:** the player API docs prohibit synchronizing Spotify content with visual media — fine for
  personal use, review before distributing.
- **Coverage:** LRCLIB is community-sourced, so some tracks have no synced lyrics. Per-track timing nudges fix
  slightly-off LRCs.

Lyrics by [LRCLIB](https://lrclib.net).
