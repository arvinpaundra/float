// Timing controls from the tray menu. Pure.
export const NUDGE_STEP_MS = 250
export const NUDGE_LIMIT_MS = 5000

export type MenuCommand =
  | { readonly kind: "sign-in" }
  | { readonly kind: "offset"; readonly scope: "track" | "global"; readonly action: "+" | "-" | "reset" }

/** Tray menu item ids (see build_controls in lib.rs) → command. Unknown ids → null. */
export const parseMenu = (id: string): MenuCommand | null => {
  if (id === "sign-in") return { kind: "sign-in" }
  const m = /^(nudge|global):(\+250|-250|reset)$/.exec(id)
  if (!m) return null
  return {
    kind: "offset",
    scope: m[1] === "nudge" ? "track" : "global",
    action: m[2] === "reset" ? "reset" : m[2] === "+250" ? "+" : "-",
  }
}

/** Positive = lyrics earlier (the offset is added to the clock before the line lookup). Clamped to ±5 s. */
export const applyNudge = (current: number, action: "+" | "-" | "reset"): number =>
  action === "reset"
    ? 0
    : Math.max(-NUDGE_LIMIT_MS, Math.min(NUDGE_LIMIT_MS, current + (action === "+" ? NUDGE_STEP_MS : -NUDGE_STEP_MS)))

/** Badge text for an offset, or null when there is nothing to show. */
export const offsetLabel = (ms: number): string | null =>
  ms === 0 ? null : `${(Math.abs(ms) / 1000).toFixed(2)}s ${ms > 0 ? "sooner" : "later"}`
