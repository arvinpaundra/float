// SQLite lyrics cache via tauri-plugin-sql. One table (migration v1 in tauri/src/lib.rs).
import Database from "@tauri-apps/plugin-sql"
import { Data, Effect } from "effect"

export class CacheError extends Data.TaggedError("CacheError")<{ readonly message: string }> {}

// Must equal the db_url passed to add_migrations() in tauri/src/lib.rs, byte for byte.
export const DB_URL = "sqlite:float.db"

export type Status = "synced" | "plain" | "instrumental" | "none"
export interface LyricsRow {
  readonly track_key: string
  readonly lrc: string | null // synced: LRC text; plain: the unsynced lyrics text; otherwise null
  readonly status: Status
  readonly offset_ms: number
  readonly source_id: number | null
  readonly fetched_at: number // epoch ms
}

// The plugin rejects with plain strings.
const wrap = <A>(what: string, f: () => Promise<A>): Effect.Effect<A, CacheError> =>
  Effect.tryPromise({ try: f, catch: (e) => new CacheError({ message: `${what}: ${String(e)}` }) })

/** Runs pending migrations. Call ONCE and share the handle (a second load skips migrations). */
export const open: Effect.Effect<Database, CacheError> = wrap("load", () => Database.load(DB_URL))

export const get = (db: Database, key: string): Effect.Effect<LyricsRow | null, CacheError> =>
  wrap("select", () =>
    db.select<LyricsRow[]>(
      "SELECT track_key, lrc, status, offset_ms, source_id, fetched_at FROM lyrics WHERE track_key = $1",
      [key],
    ),
  ).pipe(Effect.map((rows) => rows[0] ?? null))

// Upsert that never touches offset_ms, so a user's timing nudge survives a refetch.
const UPSERT = `INSERT INTO lyrics (track_key, lrc, status, source_id, fetched_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT(track_key) DO UPDATE SET
  lrc = excluded.lrc, status = excluded.status, source_id = excluded.source_id, fetched_at = excluded.fetched_at`

/** Bind only strings, integers and null (numbers go over as f64; JS booleans would be stored as text). */
export const put = (
  db: Database,
  key: string,
  status: Status,
  lrc: string | null,
  sourceId: number | null,
  now: number,
): Effect.Effect<void, CacheError> =>
  wrap("put", () => db.execute(UPSERT, [key, lrc, status, sourceId, Math.round(now)])).pipe(Effect.asVoid)

/** Per-track timing nudge (tray menu). Returns false when the track has no cached row (nothing updated). */
export const setOffset = (db: Database, key: string, offsetMs: number): Effect.Effect<boolean, CacheError> =>
  wrap("setOffset", () =>
    db.execute("UPDATE lyrics SET offset_ms = $1 WHERE track_key = $2", [Math.round(offsetMs), key]),
  ).pipe(Effect.map((r) => r.rowsAffected > 0))

// ---- settings (migration v2): tiny key/value store ----
export const getSetting = (db: Database, key: string): Effect.Effect<string | null, CacheError> =>
  wrap("getSetting", () => db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key])).pipe(
    Effect.map((rows) => rows[0]?.value ?? null),
  )

export const putSetting = (db: Database, key: string, value: string): Effect.Effect<void, CacheError> =>
  wrap("putSetting", () =>
    db.execute("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
      key,
      value,
    ]),
  ).pipe(Effect.asVoid)
