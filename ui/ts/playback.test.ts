import { test } from "bun:test"
import assert from "node:assert/strict"
import { parsePlayback } from "./playback.ts"

test("track, local file, episode, ad, idle", () => {
  const t = parsePlayback({
    is_playing: true, progress_ms: 1234, currently_playing_type: "track",
    item: { type: "track", id: "abc", uri: "spotify:track:abc", name: "Numb", duration_ms: 185000, is_local: false,
      artists: [{ name: "Linkin Park" }], album: { name: "Meteora", images: [{ url: "https://i.scdn.co/x" }] },
      external_ids: { isrc: "USWB10300474" } },
  })
  assert.equal(t.kind === "item" && `${t.key}|${t.artist}|${t.album}|${t.artUrl}|${t.isrc}`, "abc|Linkin Park|Meteora|https://i.scdn.co/x|USWB10300474")
  const local = parsePlayback({ is_playing: true, progress_ms: 0, item: { type: "track", id: null, uri: "spotify:local:A:B:C:200", name: "C", duration_ms: 200000, is_local: true, artists: [{ name: "A" }], album: { name: "B", images: [] } } })
  assert.equal(local.kind === "item" && `${local.key}|${local.artUrl}|${local.isLocal}`, "spotify:local:A:B:C:200|null|true")
  const ep = parsePlayback({ is_playing: false, progress_ms: null, currently_playing_type: "episode", item: { type: "episode", id: "e1", name: "Ep", duration_ms: 1000, show: { name: "Show" }, images: [] } })
  assert.equal(ep.kind === "item" && `${ep.artist}|${ep.progressMs}|${ep.isPlaying}`, "Show|null|false")
  assert.deepEqual(parsePlayback({ currently_playing_type: "ad", item: null, is_playing: true }), { kind: "ad" })
  assert.deepEqual(parsePlayback({ currently_playing_type: "episode", item: null }), { kind: "idle" })
  assert.deepEqual(parsePlayback(null), { kind: "idle" })
})

test("coverUrl is the largest image, artUrl the smallest", () => {
  const p = parsePlayback({ is_playing: true, progress_ms: 0, item: { type: "track", id: "x", name: "n", duration_ms: 1000,
    artists: [{ name: "a" }], album: { name: "b", images: [{ url: "https://i.scdn.co/640" }, { url: "https://i.scdn.co/300" }, { url: "https://i.scdn.co/64" }] } } })
  assert.equal(p.kind === "item" && `${p.coverUrl}|${p.artUrl}`, "https://i.scdn.co/640|https://i.scdn.co/64")
})

test("a queue entry parses as an item, so its lyrics can be prefetched", () => {
  const entry = { id: "q1", type: "track", name: "Next", duration_ms: 200_000, artists: [{ name: "A" }], album: { name: "Al", images: [{ url: "u" }] } }
  const p = parsePlayback({ item: entry, is_playing: false, progress_ms: null })
  assert.equal(p.kind, "item")
  if (p.kind === "item") {
    assert.equal(p.name, "Next")
    assert.deepEqual([...p.artists], ["A"])
    assert.equal(p.progressMs, null)
  }
})
