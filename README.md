# float

A floating, always-on-top mini player for macOS that shows **line-synced lyrics** for whatever is playing on Spotify.

- Synced lyrics from [LRCLIB](https://lrclib.net), current line highlighted and centred; unsynced lyrics shown static with a `Not synced` badge
- Click any line to jump playback there (right-click copies it); instrumental gaps and long intros count down as ♪ marks light up
- Settings: album art instead of lyrics, frosted glass, teleprompter mode (highlight the active lyrics), lyrics size
- Card themed from the album art (or show the cover instead of lyrics)
- Play/pause and next, title with running text, drag to move, resize from the edges
- Header (close, drag, settings) and resize zones appear only while the cursor is over the card; otherwise clicks pass through
- Menu-bar icon: hide/show, per-track and global lyrics timing, sign in again, quit
- Lyrics cached in SQLite: replaying a track makes no network request

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/arvinpaundra/float/master/install.sh | bash
```

Downloads the latest release, verifies its SHA-256 against the release manifest and installs `float.app` into
`~/Applications` (no sudo). Pin a version with `| bash -s -- 0.1.0`, remove with `| bash -s -- --uninstall`.
Your Spotify account must be on the release's User Management list (see [Limitations](#limitations)).

## Requirements (to build)

- macOS 14+ (Apple Silicon or Intel)
- [Rust](https://rustup.rs) and [bun](https://bun.sh)
- Spotify **Premium**, and a Spotify developer app you own

## Setup

1. **Spotify app** — at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), create an app (Web API) and:
   - add these redirect URIs exactly:
     `http://127.0.0.1:43821/callback`, `http://127.0.0.1:43822/callback`, `http://127.0.0.1:43823/callback`
   - under **User Management**, add every Spotify account that will use float (development mode allows 5)
2. **Client ID** — `cp .env.example .env` and set `SPOTIFY_CLIENT_ID`. It's inlined into the UI bundle at build time (PKCE, no secret).
3. **Run**
   ```sh
   bun install
   bun run dev    # build the UI bundle, then cargo run
   ```
4. Hover the card and click **Connect**. Approve in the browser; the tab tells you when to close it.

## Usage

| Where | What |
|---|---|
| Card (hover) | drag the header · red button quits · sliders icon opens settings · resize from the right/bottom edges or corner · wheel scrolls lyrics (auto-scroll resumes after 3 s) · ⏯ ⏭ |
| Settings | **Album art** (cover instead of lyrics) · **Disconnect / Connect** |
| Menu-bar icon | Hide/Show · Lyrics earlier/later (0.25 s, per track, ±5 s) · Timing for all tracks · Sign in to Spotify again · Quit |

## How it works

```
Spotify Web API (poll /me/player/currently-playing, adaptive 0.5–10 s)
   └─► local clock (monotonic, RTT/2, slews small drift, snaps on seek/skip/pause)
new track ─► SQLite cache ─► LRCLIB /api/get (raw title → first artist → no album → cleaned title) → /api/search
         ─► LRC parse ─► rAF: line = lineAt(clock + 250 ms lead + offsets) ─► highlight + smooth scroll
```

- **Stack:** Tauri v2 (Rust: windows, tray, OAuth loopback, hover watcher, SQLite migrations) + TypeScript with [Effect](https://effect.website) in a single webview, bundled with `bun build`.
- **Sync:** Spotify has no push API, so the app polls and extrapolates. Steady-state accuracy is line-level; a seek or pause made in Spotify shows up within ~3 s.
- **Matching:** LRCLIB `/api/get` matches exact normalized title/artist within ±2 s duration; a 200 can lack synced lyrics, so the lookup continues until one has `syncedLyrics` (then plain, then instrumental). Misses and plain results are re-checked after 7 days.
- **Click-through:** the card ignores the mouse until a 10 Hz cursor poll (Rust) sees the pointer over it.
- **Data** (`~/Library/Application Support/dev.float.lyrics/`): `auth.json` (tokens, 0600), `float.db` (lyrics cache + settings), `position.json`.

## Project layout

```
tauri/            Rust crate: src/lib.rs (window, tray, hover, commands, migrations), tauri.conf.json, capabilities/
ui/src/           index.html (the whole card UI) → bundle in ui/src/js/
install.sh        end-user installer (curl | bash) · scripts/release.sh  build + package + publish
ui/ts/            main.ts (poll loop + wiring), auth, spotify, playback, clock, schedule,
                  lrclib, match, lrc, lyrics, cache, theme, timing, view, resize — each with *.test.ts
docs/             prototype.html (early interactive design prototype)
```

## Development

```sh
bun run dev         # UI bundle + cargo run
bun run watch       # rebuild the UI bundle on change
bun run test        # bun test (pure logic: clock, LRC, matching, theme, …)
bun run typecheck   # tsc --noEmit (strict)
```

## Release

```sh
scripts/release.sh             # checks → universal app → dist/v<version>/ (zip, manifest.json, dmg)
scripts/release.sh --install   # …and install that build into ~/Applications via install.sh
scripts/release.sh --publish   # …and create GitHub release v<version> (gh) — what install.sh downloads
```

Bump `version` in both `tauri/tauri.conf.json` and `package.json` first (the script checks they match).
Builds are ad-hoc signed. `install.sh` downloads with curl, which doesn't quarantine files, so the app opens without a
Gatekeeper prompt; a **.dmg downloaded in a browser** is quarantined and needs *System Settings → Privacy & Security →
Open Anyway* once. To sign and notarize with a Developer ID instead:

```sh
APPLE_ID=you@example.com APPLE_PASSWORD=<app-specific password> APPLE_TEAM_ID=TEAMID \
scripts/release.sh --sign "Developer ID Application: Your Name (TEAMID)"
```

The Client ID from `.env` is baked into the build, so every user's Spotify account must be on that app's User
Management list (max 5). The Mac App Store is not an option (private API for the transparent window).

## Limitations

- **Spotify development mode:** at most 5 allowlisted users per Client ID, and the app owner needs Premium. Public distribution means each user brings their own Client ID.
- **Spotify policy:** the player API docs prohibit synchronizing Spotify content with visual media; fine for personal use, review before distributing.
- **Coverage:** LRCLIB is community-sourced — some tracks have no or only unsynced lyrics; per-track timing fixes slightly-off LRCs.

Lyrics by [LRCLIB](https://lrclib.net).
