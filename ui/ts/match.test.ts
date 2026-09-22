import { test } from "bun:test"
import assert from "node:assert/strict"
import { cleanTitle, norm, pickSearch, toRec, type Rec } from "./match.ts"

test("norm replicates LRCLIB prepare_input", () => {
  assert.equal(norm("Bohémian   Rhapsödy!"), "bohemian rhapsody")
  assert.equal(norm("Sweet Child O' Mine"), "sweet child o mine")
  assert.equal(norm("Post Malone & Swae Lee"), "post malone swae lee")
  assert.equal(norm("Daoko/Kenshi Yonezu"), norm("DAOKO, Kenshi Yonezu"))
  assert.equal(norm("夜に駆ける"), "夜に駆ける")
})

test("cleanTitle strips decorations, keeps real titles", () => {
  const cases: Array<[string, string]> = [
    ["Bohemian Rhapsody - Remastered 2011", "Bohemian Rhapsody"],
    ["Levitating (feat. DaBaby)", "Levitating"],
    ["Seven (feat. Latto) (Explicit Ver.)", "Seven"],
    ["Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]", "Get Lucky"],
    ["STAY (with Justin Bieber)", "STAY"],
    ["スパークル [original ver.]", "スパークル"],
    ['What Was I Made For? [From The Motion Picture "Barbie"]', "What Was I Made For?"],
    ["Anti-Hero", "Anti-Hero"],
    ["Pink + White", "Pink + White"],
    ["Gangnam Style (강남스타일)", "Gangnam Style (강남스타일)"],
    ["Love Story (Taylor's Version)", "Love Story"],
  ]
  for (const [raw, want] of cases) assert.equal(cleanTitle(raw), want, raw)
})

const rec = (id: number, trackName: string, duration: number | null, synced: boolean): Rec => ({
  id, trackName, artistName: "x", duration, instrumental: false, plainLyrics: "p", syncedLyrics: synced ? "[00:01.00] a" : null,
})

test("pickSearch = synced, ±2 s, exact title first, then closest, then lowest id", () => {
  const rs = [rec(1, "Lemon (Live)", 255, true), rec(2, "Lemon", 258, true), rec(3, "Lemon", 256, false),
    rec(4, "Lemon", 254, true), rec(5, "Lemon", null, true), rec(6, "lemon", 256, true)]
  assert.equal(pickSearch(rs, 255, ["Lemon"])?.id, 4) // 4 and 6 both exact title, Δ1 s → lowest id
  assert.equal(pickSearch([rec(1, "Other", 255, true)], 255, ["Lemon"])?.id, 1) // non-exact title still allowed
  assert.equal(pickSearch([rec(1, "Lemon", 260, true)], 255, ["Lemon"]), null) // Δ 5 s → reject
  assert.equal(toRec({ id: 1, syncedLyrics: "" })?.syncedLyrics, null)
  assert.equal(toRec({ trackName: "no id" }), null)
})

test("pickSearch with a predicate picks plain-only records (blank text ignored)", () => {
  const plain = (id: number, text: string | null) =>
    toRec({ id, trackName: "Song", duration: 200, instrumental: false, plainLyrics: text, syncedLyrics: null })!
  const rs = [plain(1, "a\nb"), plain(2, "   ")]
  assert.equal(pickSearch(rs, 200, ["Song"]), null) // default: synced only
  assert.equal(pickSearch(rs, 200, ["Song"], (r) => r.plainLyrics !== null)?.id, 1)
})
