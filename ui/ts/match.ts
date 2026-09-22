// LRCLIB matching helpers. Pure.
export interface Rec {
  readonly id: number
  readonly trackName: string | null
  readonly artistName: string | null
  readonly duration: number | null // seconds (float); null happens in search results
  readonly instrumental: boolean
  readonly plainLyrics: string | null
  readonly syncedLyrics: string | null
}

type J = Record<string, unknown>
const s = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** Validate one LRCLIB record; anything malformed → null. */
export const toRec = (x: unknown): Rec | null => {
  if (!x || typeof x !== "object") return null
  const o = x as J
  if (typeof o.id !== "number") return null
  return {
    id: o.id,
    trackName: s(o.trackName),
    artistName: s(o.artistName),
    duration: typeof o.duration === "number" ? o.duration : null,
    instrumental: o.instrumental === true,
    plainLyrics: s(o.plainLyrics)?.trim() || null, // "" / whitespace counts as missing
    syncedLyrics: s(o.syncedLyrics) || null, // "" counts as missing
  }
}

/** Client replica of LRCLIB's server-side prepare_input (utils.rs): what /api/get compares. */
export const norm = (t: string): string =>
  t
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[`~!@#$%^&*()_|+\-=?;:",.<>{}[\]\\/\u0000\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const FEAT_PAREN = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi
const DASH_SUFFIX = /\s+-\s+.*$/ // Spotify " - Remastered 2011", " - Live", " - Radio Edit", " - Twin Ver."
const VERSION_PAREN =
  /\s*[([][^)\]]*\b(?:remaster(?:ed)?|live|radio edit|edit|version|ver|mix|remix|mono|stereo|acoustic|demo|single|bonus|deluxe|explicit|clean|instrumental|anniversary|from|re-?recorded)\b[^)\]]*[)\]]/gi

/** Strip featuring/version decorations. Only used AFTER the raw title failed (it can match another recording). */
export const cleanTitle = (t: string): string => {
  const c = t.replace(FEAT_PAREN, "").replace(DASH_SUFFIX, "").replace(VERSION_PAREN, "").replace(/\s+/g, " ").trim()
  return c.length ? c : t
}

/**
 * Best search result that `has` what we want (default: synced lyrics), |Δduration| ≤ 2 s;
 * prefer exact normalized title, then closest duration, then lowest id.
 */
export const pickSearch = (
  results: readonly Rec[],
  d: number,
  titles: readonly string[],
  has: (r: Rec) => boolean = (r) => r.syncedLyrics !== null,
): Rec | null => {
  const wanted = new Set(titles.map(norm))
  const rank = (r: Rec): number => (wanted.has(norm(r.trackName ?? "")) ? 0 : 1)
  const ok = results.filter((r) => has(r) && r.duration !== null && Math.abs(r.duration - d) <= 2)
  ok.sort((a, b) => rank(a) - rank(b) || Math.abs(a.duration! - d) - Math.abs(b.duration! - d) || a.id - b.id)
  return ok[0] ?? null
}