import { test } from "bun:test"
import assert from "node:assert/strict"
import { DEFAULT_THEME, dominant, themeFromPixels, whiteContrast } from "./theme.ts"

const solid = (r: number, g: number, b: number, n = 64, a = 255) => {
  const px = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) px.set([r, g, b, a], i * 4)
  return px
}
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

test("vivid art keeps its hue, always readable (white text ≥ 4.5:1)", () => {
  for (const [r, g, b] of [[208, 35, 26], [250, 220, 40], [40, 200, 90], [60, 90, 230], [255, 255, 255], [128, 128, 128]] as const) {
    const t = themeFromPixels(solid(r, g, b))
    assert.ok(whiteContrast(rgbOf(t.top)) >= 4.5, `${r},${g},${b} → ${t.top}`)
    assert.ok(whiteContrast(rgbOf(t.bottom)) >= 4.5)
  }
  const red = rgbOf(themeFromPixels(solid(208, 35, 26)).top)
  assert.ok(red[0] > red[1] * 3 && red[0] > red[2] * 3, "red stays red")
})
test("dominant picks the vivid majority over grey/black, falls back on empty", () => {
  const px = new Uint8ClampedArray([...solid(20, 20, 20, 50), ...solid(30, 60, 220, 30), ...solid(200, 200, 200, 20)])
  const c = dominant(px)!
  assert.ok(c[2] > c[0] * 2 && c[2] > c[1] * 2, `blue wins, got ${c}`)
  assert.deepEqual(themeFromPixels(solid(0, 0, 0, 10, 0)), DEFAULT_THEME) // fully transparent
})
