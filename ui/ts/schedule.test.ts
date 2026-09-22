import { test } from "bun:test"
import assert from "node:assert/strict"
import { DELAY, delayPlaying, delayRateLimited } from "./schedule.ts"

test("steady, jump confirm, end-of-track, floor, 429 backoff", () => {
  assert.equal(delayPlaying(200_000, 10_000, false), DELAY.playing)
  assert.equal(delayPlaying(200_000, 10_000, true), DELAY.afterJump)
  assert.equal(delayPlaying(200_000, 198_500, false), 1_800)
  assert.equal(delayPlaying(200_000, 200_500, false), DELAY.min)
  assert.deepEqual([0, 1, 2, 3, 4].map((s) => delayRateLimited(s, false)), [5000, 10000, 20000, 40000, 60000])
  assert.equal(delayRateLimited(0, true), DELAY.quota)
})
