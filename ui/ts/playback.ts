// Spotify currently-playing JSON → app model. Pure; tolerant of missing fields.
export type Playback =
  | { readonly kind: "idle" } // 204, or no item (unknown type)
  | { readonly kind: "ad" }
  | {
      readonly kind: "item"
      readonly key: string // item.id ?? item.uri (local files have id null)
      readonly type: "track" | "episode"
      readonly name: string
      readonly artist: string // display: all artists joined with ", "
      readonly artists: readonly string[] // lookup: LRCLIB matching needs them separately
      readonly album: string
      readonly durationMs: number
      readonly progressMs: number | null
      readonly isPlaying: boolean
      readonly artUrl: string | null // smallest image (~64 px): only used to derive the theme
      readonly coverUrl: string | null // largest image (~640 px): the "Album art" setting shows it
      readonly isrc: string | null
      readonly isLocal: boolean
    }

type J = Record<string, any>
const str = (v: unknown): string => (typeof v === "string" ? v : "")
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

export const parsePlayback = (body: J | null): Playback => {
  if (!body) return { kind: "idle" }
  if (body.currently_playing_type === "ad") return { kind: "ad" }
  const it: J | null = body.item ?? null
  if (!it || (it.type !== "track" && it.type !== "episode")) return { kind: "idle" }
  const key = str(it.id) || str(it.uri)
  const durationMs = num(it.duration_ms)
  if (!key || durationMs === null) return { kind: "idle" }
  const track = it.type === "track"
  const images: J[] = (track ? it.album?.images : it.images) ?? [] // Spotify lists widest first
  const artists: string[] = track
    ? (it.artists ?? []).map((a: J) => str(a.name)).filter(Boolean)
    : [str(it.show?.name)].filter(Boolean)
  return {
    kind: "item",
    key,
    type: it.type,
    name: str(it.name),
    artist: artists.join(", "),
    artists,
    album: track ? str(it.album?.name) : str(it.show?.name),
    durationMs,
    progressMs: num(body.progress_ms),
    isPlaying: body.is_playing === true,
    artUrl: str(images[images.length - 1]?.url) || null,
    coverUrl: str(images[0]?.url) || null,
    isrc: track ? str(it.external_ids?.isrc) || null : null,
    isLocal: it.is_local === true,
  }
}