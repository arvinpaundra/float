# float

A floating, always-on-top mini player for macOS that shows **line-synced lyrics** for whatever is playing on Spotify.

- Synced lyrics from [LRCLIB](https://lrclib.net), current line highlighted and centred; unsynced lyrics shown static with a `Not synced` badge
- Card themed from the album art (or show the cover instead of lyrics)
- Play/pause and next, title with running text, drag to move, resize from the edges
- Header (close, drag, settings) and resize zones appear only while the cursor is over the card; otherwise clicks pass through
- Menu-bar icon: hide/show, per-track and global lyrics timing, sign in again, quit
- Lyrics cached in SQLite: replaying a track makes no network request

## Requirements

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
   make install   # bun deps
   make           # build the UI bundle, then cargo run
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
ui/ts/            main.ts (poll loop + wiring), auth, spotify, playback, clock, schedule,
                  lrclib, match, lrc, lyrics, cache, theme, timing, view, resize — each with *.test.ts
docs/             prototype.html (early interactive design prototype)
```

## Development

```sh
make test        # bun test (pure logic: clock, LRC, matching, theme, …)
make typecheck   # tsc --noEmit (strict)
make watch       # rebuild the bundle on change
make clean
```

## Limitations

- **Spotify development mode:** at most 5 allowlisted users per Client ID, and the app owner needs Premium. Public distribution means each user brings their own Client ID.
- **Spotify policy:** the player API docs prohibit synchronizing Spotify content with visual media; fine for personal use, review before distributing.
- **Coverage:** LRCLIB is community-sourced — some tracks have no or only unsynced lyrics; per-track timing fixes slightly-off LRCs.
- The macOS private API (transparent window) rules out the Mac App Store.

Lyrics by [LRCLIB](https://lrclib.net).
