// Album art pixels → card gradient. Pure (RGBA bytes in, CSS colors out).
export interface Theme {
  readonly top: string
  readonly bottom: string
  readonly accent: string // vivid (not darkened): the ambient glow only, never behind text
}
export const DEFAULT_THEME: Theme = { top: "#2b2b2e", bottom: "#141416", accent: "#3c3c46" } // static dark fallback

type RGB = readonly [number, number, number]

const lin = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
/** WCAG relative luminance, 0..1 */
export const luminance = ([r, g, b]: RGB): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
/** WCAG contrast of white text on this color */
export const whiteContrast = (c: RGB): number => 1.05 / (luminance(c) + 0.05)

const hex = ([r, g, b]: RGB): string =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")

const scale = ([r, g, b]: RGB, k: number): RGB => [r * k, g * k, b * k]

/** Darken until white text reaches `min` contrast (4.5 = WCAG AA). */
export const darkenFor = (c: RGB, min = 4.5): RGB => {
  let out = c
  for (let i = 0; i < 40 && whiteContrast(out) < min; i++) out = scale(out, 0.92)
  return out
}

/**
 * Dominant color: hue histogram (24 buckets) weighted by saturation, ignoring near-black/near-white
 * and transparent pixels. Falls back to the plain average when the art is essentially grey.
 */
export const dominant = (rgba: Uint8ClampedArray | Uint8Array): RGB | null => {
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  let n = 0
  let ar = 0
  let ag = 0
  let ab = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!
    const g = rgba[i + 1]!
    const b = rgba[i + 2]!
    if (rgba[i + 3]! < 200) continue
    n++
    ar += r
    ag += g
    ab += b
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 510
    if (l < 0.08 || l > 0.92 || max === min) continue
    const d = (max - min) / 255
    const s = d / (1 - Math.abs(2 * l - 1))
    let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
    h = (h * 60 + 360) % 360
    const bk = buckets[Math.floor(h / 15) % 24]!
    const w = s * s // favour vivid colors strongly
    bk.w += w
    bk.r += r * w
    bk.g += g * w
    bk.b += b * w
  }
  if (n === 0) return null
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a))
  // < ~6% of pixels fully saturated-equivalent → treat as greyscale art
  if (best.w < n * 0.06) return [ar / n, ag / n, ab / n]
  return [best.r / best.w, best.g / best.w, best.b / best.w]
}

export const themeFromPixels = (rgba: Uint8ClampedArray | Uint8Array): Theme => {
  const c = dominant(rgba)
  if (!c) return DEFAULT_THEME
  const top = darkenFor(c)
  // accent: the dominant colour kept bright, lifted a little so dark art still glows
  const lift = Math.max(1, 150 / Math.max(1, Math.max(c[0], c[1], c[2])))
  return { top: hex(top), bottom: hex(scale(top, 0.55)), accent: hex(scale(c, lift)) }
}