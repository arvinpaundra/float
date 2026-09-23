import { test } from "bun:test"
import assert from "node:assert/strict"
import { FONT_DEFAULT, FONT_MAX, FONT_MIN, fontSize, GAP_DOTS, gapDots, marqueeShift, showUpNext, UP_NEXT_LEAD_MS, withIntro } from "./view.ts"

test("marquee only when the title overflows, speed ≈ 30 px/s, min 6 s", () => {
  assert.equal(marqueeShift(200, 290), null)
  assert.equal(marqueeShift(291, 290), null) // ≤ 2 px: rounding noise, don't animate
  assert.deepEqual(marqueeShift(400, 290), { shift: -122, durS: Math.max(6, 122 / 30 + 3) })
  assert.equal(marqueeShift(310, 290)!.durS, 6)
})

test("gapDots: lights 1…3 across the gap, 0 when there is no gap", () => {
  const [s, e] = [10_000, 16_000] // 6 s gap
  assert.deepEqual([10_000, 11_999, 12_000, 13_999, 14_000, 15_999].map((t) => gapDots(t, s, e)), [1, 1, 2, 2, 3, 3])
  assert.equal(gapDots(9_000, s, e), 0) // before the gap
  assert.equal(gapDots(20_000, s, e), GAP_DOTS) // past the end: stays full
  assert.equal(gapDots(10_000, 10_000, 10_000), 0) // zero-length gap (no next line)
})

test("withIntro: long intro gets a countdown line, short intro does not", () => {
  const lines = [{ t: 9_000, text: "first" }, { t: 12_000, text: "second" }]
  assert.deepEqual(withIntro(lines)[0], { t: 0, text: "" })
  assert.equal(withIntro(lines).length, 3)
  assert.equal(withIntro([{ t: 1_500, text: "quick" }]).length, 1) // under INTRO_GAP_MS
  assert.equal(withIntro([{ t: 9_000, text: "" }]).length, 1) // already a gap line
  assert.deepEqual(withIntro([]), [])
})

test("fontSize: clamps to range, falls back to the default", () => {
  assert.equal(fontSize(18), 18)
  assert.equal(fontSize("13"), 13)
  assert.equal(fontSize(FONT_MIN), FONT_MIN)
  assert.equal(fontSize(FONT_MAX), FONT_MAX)
  assert.equal(fontSize(FONT_MAX + 5), FONT_DEFAULT) // out of range → default, never a huge card
  assert.equal(fontSize(FONT_MIN - 1), FONT_DEFAULT)
  assert.equal(fontSize(null), FONT_DEFAULT) // nothing saved yet
  assert.equal(fontSize("abc"), FONT_DEFAULT)
})

test("showUpNext: last seconds only, while playing, with a next track", () => {
  assert.ok(showUpNext(UP_NEXT_LEAD_MS - 1, true, true))
  assert.ok(showUpNext(0, true, true))
  assert.ok(!showUpNext(UP_NEXT_LEAD_MS + 1, true, true)) // too early
  assert.ok(!showUpNext(1000, false, true)) // queue unknown/empty
  assert.ok(!showUpNext(1000, true, false)) // paused near the end: no countdown running
  assert.ok(!showUpNext(-2000, true, true)) // clock overran the track: next poll will switch
})
