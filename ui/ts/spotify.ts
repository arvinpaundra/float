// GET /v1/me/player/currently-playing → Sample (playback + request timing for the clock).
import { Effect } from "effect"
import { Forbidden, HttpError, NetworkError, RateLimited, Unauthorized } from "./errors.ts"
import { parsePlayback, type Playback } from "./playback.ts"

const URL_CP = "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode"

export interface Sample {
  readonly playback: Playback
  readonly sentAt: number // performance.now() before fetch
  readonly recvAt: number // performance.now() when headers arrived
}

type J = Record<string, any>
const safeJson = (s: string): J | null => {
  try {
    return s ? (JSON.parse(s) as J) : null
  } catch {
    return null
  }
}

export const currentlyPlaying = (accessToken: string) =>
  Effect.gen(function* () {
    const sentAt = performance.now()
    const res = yield* Effect.tryPromise({
      try: (signal) => fetch(URL_CP, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal }),
      catch: (e) => new NetworkError({ message: `currently-playing: ${String(e)}` }),
    })
    const recvAt = performance.now()
    // Never .json() a 204: the body is empty.
    const body = res.status === 204 ? null : safeJson(
      yield* Effect.tryPromise({ try: () => res.text(), catch: (e) => new NetworkError({ message: String(e) }) }),
    )
    switch (res.status) {
      case 200:
      case 204: {
        const sample: Sample = { playback: parsePlayback(body), sentAt, recvAt }
        return sample
      }
      case 401:
        return yield* Effect.fail(new Unauthorized())
      case 403:
        return yield* Effect.fail(new Forbidden({ message: String(body?.error?.message ?? "forbidden") }))
      case 429: // Retry-After is not CORS-exposed by api.spotify.com → our own backoff
        return yield* Effect.fail(new RateLimited({ quota: body?.error?.reason === "QUOTA_EXCEEDED" }))
      default:
        return yield* Effect.fail(new HttpError({ status: res.status }))
    }
  }).pipe(Effect.timeoutFail({ duration: "10 seconds", onTimeout: () => new NetworkError({ message: "currently-playing timed out" }) }))

// ---- playback controls (Premium + user-modify-playback-state) ----
export type Control = "pause" | "play" | "next"
const CONTROL: Record<Control, { readonly method: "PUT" | "POST"; readonly path: string }> = {
  pause: { method: "PUT", path: "/pause" },
  play: { method: "PUT", path: "/play" }, // no body = resume the current context
  next: { method: "POST", path: "/next" },
}

/** One control call. 2xx → done; 403 → Forbidden (Premium / scope / restriction); 404 → HttpError (no active device). */
export const control = (cmd: Control) => (accessToken: string) =>
  Effect.gen(function* () {
    const { method, path } = CONTROL[cmd]
    const res = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`https://api.spotify.com/v1/me/player${path}`, { method, headers: { Authorization: `Bearer ${accessToken}` }, signal }),
      catch: (e) => new NetworkError({ message: `${cmd}: ${String(e)}` }),
    })
    if (res.ok) return
    const body = safeJson(yield* Effect.tryPromise({ try: () => res.text(), catch: (e) => new NetworkError({ message: String(e) }) }))
    if (res.status === 401) return yield* Effect.fail(new Unauthorized())
    if (res.status === 403) return yield* Effect.fail(new Forbidden({ message: String(body?.error?.message ?? "forbidden") }))
    if (res.status === 429) return yield* Effect.fail(new RateLimited({ quota: body?.error?.reason === "QUOTA_EXCEEDED" }))
    return yield* Effect.fail(new HttpError({ status: res.status }))
  }).pipe(Effect.timeoutFail({ duration: "10 seconds", onTimeout: () => new NetworkError({ message: `${cmd} timed out` }) }))

/** Pure: Spotify's 403/404 for a control → what to tell the user. */
export const controlProblem = (status: 403 | 404, message: string): string =>
  status === 404
    ? "No active Spotify device"
    : /scope/i.test(message)
      ? "Menu bar → Sign in to Spotify again to enable controls"
      : /premium/i.test(message)
        ? "Controls need Spotify Premium"
        : message
