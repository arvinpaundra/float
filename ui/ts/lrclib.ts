// LRCLIB client + lookup sequence (verified live 2026-09-22: 62/62 synced hits on a chart-heavy sample).
import { Data, Effect } from "effect"
import { LRCLIB_CLIENT, LRCLIB_GAP_MS } from "./config.ts"
import { cleanTitle, pickSearch, toRec, type Rec } from "./match.ts"

export class LrclibUnavailable extends Data.TaggedError("LrclibUnavailable")<{
  readonly message: string
  readonly retryAfterMs: number // from Retry-After (CORS-exposed by LRCLIB), 0 if none
}> {}

export interface Query {
  readonly name: string
  readonly artists: readonly string[]
  readonly album: string
  readonly durationMs: number
}
export type Found =
  | { readonly kind: "synced"; readonly id: number; readonly lrc: string }
  | { readonly kind: "plain"; readonly id: number; readonly text: string } // lyrics without timestamps
  | { readonly kind: "instrumental"; readonly id: number }
  | { readonly kind: "none" }

const BASE = "https://lrclib.net"

/** One GET. 404/400 → null (definitive), 429/503/5xx/network → LrclibUnavailable (transient, never cached). */
const request = (path: string, params: Record<string, string | number>) =>
  Effect.gen(function* () {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    const res = yield* Effect.tryPromise({
      try: (signal) => fetch(`${BASE}${path}?${qs}`, { headers: { "Lrclib-Client": LRCLIB_CLIENT }, signal }),
      catch: (e) => new LrclibUnavailable({ message: `lrclib: ${String(e)}`, retryAfterMs: 0 }),
    })
    if (res.status === 404 || res.status === 400) return null
    if (!res.ok) {
      const ra = Number(res.headers.get("retry-after"))
      return yield* Effect.fail(
        new LrclibUnavailable({ message: `lrclib ${res.status}`, retryAfterMs: Number.isFinite(ra) ? ra * 1000 : 0 }),
      )
    }
    const body: unknown = yield* Effect.tryPromise({
      try: () => res.json(),
      catch: () => new LrclibUnavailable({ message: "lrclib: unreadable body", retryAfterMs: 0 }),
    })
    return body
  }).pipe(
    Effect.timeoutFail({
      duration: "10 seconds",
      onTimeout: () => new LrclibUnavailable({ message: "lrclib: timed out", retryAfterMs: 0 }),
    }),
  )

/** Retry a transient failure twice: wait Retry-After (capped 60 s) or 1 s / 3 s. Docs: ignoring Retry-After risks a ban. */
const withRetry = <A>(eff: Effect.Effect<A, LrclibUnavailable>, attempt = 0): Effect.Effect<A, LrclibUnavailable> =>
  eff.pipe(
    Effect.catchTag("LrclibUnavailable", (e) =>
      attempt >= 2
        ? Effect.fail(e)
        : Effect.sleep(Math.min(60_000, e.retryAfterMs || [1000, 3000][attempt]!)).pipe(
            Effect.zipRight(withRetry(eff, attempt + 1)),
          ),
    ),
  )

const get = (p: Record<string, string | number>) => withRetry(request("/api/get", p)).pipe(Effect.map(toRec))
const search = (p: Record<string, string | number>) =>
  withRetry(request("/api/search", p)).pipe(
    Effect.map((b) => (Array.isArray(b) ? b.map(toRec).filter((r): r is Rec => r !== null) : [])),
  )

/**
 * Sequential lookup, stop at the first record with syncedLyrics (a 200 can be plain-only!):
 *  S1 raw title, all artists ", "-joined, album, d   (58/62 alone)
 *  S2 raw title, first artist, album, d               (only if >1 artist)
 *  S3 raw title, first artist, no album, d
 *  S4 cleaned title, first artist, no album, d        (only if cleaning changed it)
 *  S5 search track_name=clean & artist_name=first → pickSearch   (never q=: returns junk/remixes)
 */
export const findLyrics = (q: Query) =>
  Effect.gen(function* () {
    const d = Math.round(q.durationMs / 1000) // integer: the server buckets its cache by round(duration)
    const a1 = q.artists[0]
    if (d < 1 || d > 3600 || !q.name || !a1) return { kind: "none" } as Found
    const clean = cleanTitle(q.name)
    const steps: Array<Effect.Effect<Rec | null, LrclibUnavailable>> = [
      get({ track_name: q.name, artist_name: q.artists.join(", "), album_name: q.album, duration: d }),
    ]
    if (q.artists.length > 1) steps.push(get({ track_name: q.name, artist_name: a1, album_name: q.album, duration: d }))
    steps.push(get({ track_name: q.name, artist_name: a1, duration: d }))
    if (clean !== q.name) steps.push(get({ track_name: clean, artist_name: a1, duration: d }))
    // search: best synced record, else the best plain-only one (same duration/title rules)
    steps.push(
      search({ track_name: clean, artist_name: a1 }).pipe(
        Effect.map((rs) => pickSearch(rs, d, [q.name, clean]) ?? pickSearch(rs, d, [q.name, clean], (r) => r.plainLyrics !== null)),
      ),
    )

    // Priority: synced (stop immediately) > plain > instrumental > none
    let plain: Rec | null = null
    let instrumental: Rec | null = null
    for (const [i, step] of steps.entries()) {
      if (i > 0) yield* Effect.sleep(LRCLIB_GAP_MS)
      const r = yield* step
      if (r?.syncedLyrics) return { kind: "synced", id: r.id, lrc: r.syncedLyrics } as Found
      if (r?.plainLyrics && !plain) plain = r
      if (r?.instrumental && !instrumental) instrumental = r
    }
    if (plain?.plainLyrics) return { kind: "plain", id: plain.id, text: plain.plainLyrics } as Found
    return (instrumental ? { kind: "instrumental", id: instrumental.id } : { kind: "none" }) as Found
  })