import { test } from "bun:test"
import assert from "node:assert/strict"
import { marqueeShift } from "./view.ts"

test("marquee only when the title overflows, speed ≈ 30 px/s, min 6 s", () => {
  assert.equal(marqueeShift(200, 290), null)
  assert.equal(marqueeShift(291, 290), null) // ≤ 2 px: rounding noise, don't animate
  assert.deepEqual(marqueeShift(400, 290), { shift: -122, durS: Math.max(6, 122 / 30 + 3) })
  assert.equal(marqueeShift(310, 290)!.durS, 6)
})
