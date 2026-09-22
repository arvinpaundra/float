import { test } from "bun:test"
import assert from "node:assert/strict"
import { applySample, hold, makeClock, position, resume, SLEW_MS } from "./clock.ts"

test("first sample snaps, adds rtt/2, advances only while playing", () => {
  const c = makeClock()
  assert.equal(applySample(c, "A", 10_000, true, 0, 200), true)
  assert.equal(position(c, 200), 10_100)
  assert.equal(position(c, 1200), 11_100)
  applySample(c, "A", 11_000, false, 1200, 1300) // pause → snap, no rtt credit
  assert.equal(position(c, 99_999), 11_000)
})

test("small error slews without going backwards, converges after SLEW_MS", () => {
  const c = makeClock()
  applySample(c, "A", 0, true, 0, 0)
  // at t=3000 Spotify says 2600 → we are 400ms ahead
  assert.equal(applySample(c, "A", 2600, true, 3000, 3000), false)
  let prev = -Infinity
  for (let t = 3000; t <= 3000 + SLEW_MS + 1000; t += 16) {
    const p = position(c, t)
    assert.ok(p >= prev, `monotonic at ${t}`)
    prev = p
  }
  assert.ok(Math.abs(position(c, 3000 + SLEW_MS) - (2600 + SLEW_MS)) < 1e-6)
})

test("seek, track change and play toggle snap", () => {
  const c = makeClock()
  applySample(c, "A", 0, true, 0, 0)
  assert.equal(applySample(c, "A", 60_000, true, 3000, 3000), true) // seek
  assert.equal(position(c, 3000), 60_000)
  assert.equal(applySample(c, "B", 0, true, 4000, 4000), true) // track change
  assert.equal(applySample(c, "B", 900, false, 5000, 5000), true) // pause
})

test("hold freezes, next playing sample snaps", () => {
  const c = makeClock()
  applySample(c, "A", 5000, true, 0, 0)
  hold(c, 1000)
  assert.equal(position(c, 9999), 6000)
  assert.equal(applySample(c, "A", 6100, true, 2000, 2000), true)
})

test("resume after pause keeps the position", () => {
  const c = makeClock()
  applySample(c, "A", 10_000, true, 0, 0)
  hold(c, 2000) // pause at 12 s
  resume(c, 5000) // play 3 s later
  assert.equal(position(c, 6000), 13_000)
})
