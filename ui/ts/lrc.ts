// LRC → sorted lines. Pure. Tolerates [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx], [mm:ss:xx],
// several timestamps per line, metadata tags, word-level <mm:ss.xx> tags, [offset:±ms], CRLF and a BOM.
// LRCLIB in practice (267-record survey): "[mm:ss.xx] text", empty-text lines = gaps / end marker,
// and occasionally two lines with the same timestamp (merged into one display line).
export interface Line {
  readonly t: number // ms, after [offset:] is applied, never negative
  readonly text: string // "" = instrumental gap; may contain "\n" when same-time lines were merged
}

const TIME = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]/i
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

const fracMs = (f: string | undefined): number => (f ? Number(f.padEnd(3, "0").slice(0, 3)) : 0)

export const parseLrc = (raw: string): Line[] => {
  let offset = 0
  const out: Line[] = []
  for (const rawLine of raw.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    let rest = rawLine.trim()
    const off = OFFSET.exec(rest)
    if (off) {
      offset = Number(off[1])
      continue
    }
    const times: number[] = []
    for (let m = TIME.exec(rest); m; m = TIME.exec(rest)) {
      times.push(Number(m[1]) * 60_000 + Number(m[2]) * 1000 + fracMs(m[3]))
      rest = rest.slice(m[0].length).trimStart()
    }
    if (times.length === 0) continue // metadata ([ar:], [ti:], …) or junk
    const text = rest.replace(WORD_TAG, "").replace(/\s+/g, " ").trim()
    for (const t of times) out.push({ t, text })
  }
  // LRC spec: positive offset → lyrics appear sooner
  const shifted = out.map((l) => ({ t: Math.max(0, l.t - offset), text: l.text }))
  shifted.sort((a, b) => a.t - b.t) // Array.prototype.sort is stable → source order kept for equal t
  const merged: Line[] = []
  for (const l of shifted) {
    const prev = merged[merged.length - 1]
    if (!prev || prev.t !== l.t) merged.push(l)
    else if (l.text && !prev.text.split("\n").includes(l.text)) // exact duplicate → drop; different text → merge
      merged[merged.length - 1] = { t: l.t, text: prev.text ? `${prev.text}\n${l.text}` : l.text }
  }
  return merged
}

/** LRCLIB's own instrumental marker inside LRC text. */
export const isInstrumentalLrc = (raw: string): boolean => /^\s*\[au:\s*instrumental\s*\]/im.test(raw)

/** Index of the last line with t <= ms, or -1 before the first line. Binary search. */
export const lineAt = (lines: readonly Line[], ms: number): number => {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid]!.t <= ms) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}