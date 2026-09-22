import { test } from "bun:test"
import assert from "node:assert/strict"
import { isInstrumentalLrc, lineAt, parseLrc } from "./lrc.ts"

test("formats, multi-timestamp, metadata, word tags, gaps, sort, dedupe", () => {
  const lines = parseLrc(
    [
      "[ar:Someone]",
      "[ti:Song]",
      "[00:12.34]First line",
      "[00:05]Earlier",
      "[00:20.5][01:02.345]Chorus  <00:20.60>word <00:21.00>tags",
      "[00:30.00]",
      "[00:40:50]colon frac",
      "[00:12.34]First line",
      "garbage",
    ].join("\r\n"),
  )
  assert.deepEqual(lines, [
    { t: 5000, text: "Earlier" },
    { t: 12340, text: "First line" },
    { t: 20500, text: "Chorus word tags" },
    { t: 30000, text: "" },
    { t: 40500, text: "colon frac" },
    { t: 62345, text: "Chorus word tags" },
  ])
})

test("[offset:] positive = earlier, clamped at 0", () => {
  assert.deepEqual(parseLrc("[offset:+500]\n[00:00.20]a\n[00:10.00]b").map((l) => l.t), [0, 9500])
  assert.deepEqual(parseLrc("[offset:-250]\n[00:10.00]b").map((l) => l.t), [10250])
})

test("same-time lines merge, exact dupes drop, BOM/CR, instrumental marker", () => {
  assert.deepEqual(parseLrc("\uFEFF[00:01.00] a\r[00:01.00] b\r[00:01.00] a\r[00:02.00] c"), [
    { t: 1000, text: "a\nb" },
    { t: 2000, text: "c" },
  ])
  assert.ok(isInstrumentalLrc("[au: instrumental]\n"))
  assert.ok(!isInstrumentalLrc("[00:01.00] au: instrumental"))
})

test("lineAt: binary search boundaries", () => {
  const ls = parseLrc("[00:01.00]a\n[00:02.00]b\n[00:03.00]c")
  assert.deepEqual([0, 999, 1000, 1999, 2000, 2500, 3000, 1e9].map((ms) => lineAt(ls, ms)), [-1, -1, 0, 0, 1, 1, 2, 2])
  assert.equal(lineAt([], 5000), -1)
})
