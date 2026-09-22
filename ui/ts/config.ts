// Spotify app settings. The client ID is public (PKCE has no secret) but kept out of the repo.
// Inlined at build time from .env (see .env.example); the Makefile refuses to build without it.
export const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? ""
// Each must be registered in the Spotify dashboard as http://127.0.0.1:<port>/callback
export const REDIRECT_PORTS = [43821, 43822, 43823]
export const redirectUri = (port: number): string => `http://127.0.0.1:${port}/callback`
// user-modify-playback-state: play/pause/next buttons (Premium only). Older sign-ins lack it → "Sign in again".
export const SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state"
export const LOGIN_TIMEOUT_MS = 5 * 60_000

// ---- lyrics ----
// LRCLIB asks clients to identify themselves; browsers can't set User-Agent, so this goes in Lrclib-Client.
export const LRCLIB_CLIENT = "float/0.1.0 (personal macOS lyrics overlay)"
export const LRCLIB_GAP_MS = 250 // pause between sequential LRCLIB requests (docs: 200–500 ms)
export const MISS_TTL_MS = 7 * 24 * 3600_000 // re-ask LRCLIB about a "none" after a week (server caches misses 24 h)
export const LEAD_MS = 250 // show a line slightly before it is sung
export const GLOBAL_OFFSET_MS = 0 // default for "Timing for all tracks"; the adjusted value lives in settings
