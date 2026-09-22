// Track → lyrics verdict: cache first, then LRCLIB, then write back. Cache failures never block lyrics.
import type Database from "@tauri-apps/plugin-sql"
import { Effect } from "effect"
import * as cache from "./cache.ts"
import { MISS_TTL_MS } from "./config.ts"
import { findLyrics, type Found } from "./lrclib.ts"
import { isInstrumentalLrc, parseLrc, type Line } from "./lrc.ts"
import type { Playback } from "./playback.ts"

type Item = Extract<Playback, { kind: "item" }>
export type Verdict =
  | { readonly kind: "synced"; readonly lines: readonly Line[]; readonly offsetMs: number }
  | { readonly kind: "plain"; readonly lines: readonly string[] } // no timestamps: shown static
  | { readonly kind: "instrumental" }
  | { readonly kind: "none" }

/** Pure: cached status/lrc → what to show. Unparseable LRC counts as none. */
export const toVerdict = (status: cache.Status, lrc: string | null, offsetMs: number): Verdict => {
  if (status === "instrumental" || (lrc && isInstrumentalLrc(lrc))) return { kind: "instrumental" }
  if (status === "plain" && lrc) {
    const text = lrc.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim())
    while (text.length && !text[text.length - 1]) text.pop()
    return text.some(Boolean) ? { kind: "plain", lines: text } : { kind: "none" }
  }
  if (status !== "synced" || !lrc) return { kind: "none" }
  const lines = parseLrc(lrc)
  return lines.length ? { kind: "synced", lines, offsetMs } : { kind: "none" }
}

/**
 * Pure: is this cached row still authoritative? Synced/instrumental never expire; "none" and "plain"
 * are re-checked after MISS_TTL_MS (LRCLIB keeps getting contributions — plain may become synced).
 */
export const isFresh = (row: Pick<cache.LyricsRow, "status" | "fetched_at">, now: number): boolean =>
  row.status === "synced" || row.status === "instrumental" || now - row.fetched_at < MISS_TTL_MS

export const lyricsFor = (db: Database | null, p: Item) =>
  Effect.gen(function* () {
    if (p.type === "episode") return { kind: "none" } as Verdict // podcasts: no lookup
    const row = db
      ? yield* cache.get(db, p.key).pipe(
          Effect.catchAll((e) => Effect.logWarning("cache read failed", e.message).pipe(Effect.as(null))),
        )
      : null
    if (row && isFresh(row, Date.now())) return toVerdict(row.status, row.lrc, row.offset_ms)

    const found: Found = yield* findLyrics({ name: p.name, artists: p.artists, album: p.album, durationMs: p.durationMs })
    const status: cache.Status = found.kind
    const lrc = found.kind === "synced" ? found.lrc : found.kind === "plain" ? found.text : null
    if (db)
      yield* cache.put(db, p.key, status, lrc, found.kind === "none" ? null : found.id, Date.now()).pipe(
        Effect.catchAll((e) => Effect.logWarning("cache write failed", e.message)),
      )
    return toVerdict(status, lrc, row?.offset_ms ?? 0)
  })