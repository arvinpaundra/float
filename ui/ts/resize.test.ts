import { test } from "bun:test"
import assert from "node:assert/strict"
import { resized } from "./resize.ts"

test("edges move one axis, corner both", () => {
  const s = { w: 320, h: 318 }
  assert.deepEqual(resized(s, 40, 25, "x"), { w: 360, h: 318 })
  assert.deepEqual(resized(s, 40, 25, "y"), { w: 320, h: 343 })
  assert.deepEqual(resized(s, -40, 25, "xy"), { w: 280, h: 343 })
})
