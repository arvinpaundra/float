// Next-poll delay. Pure.
export const DELAY = {
  playing: 3000, afterJump: 1000, endLead: 300, min: 500,
  paused: 5000, idle: 10000, error: 5000,
  rateBase: 5000, rateMax: 60000, quota: 300000, forbidden: 300000, loginRetry: 60000,
} as const

export const delayPlaying = (durationMs: number, posMs: number, jumped: boolean): number =>
  Math.max(DELAY.min, Math.min(jumped ? DELAY.afterJump : DELAY.playing, durationMs - posMs + DELAY.endLead))

/** streak = consecutive 429s before this one (0 for the first). */
export const delayRateLimited = (streak: number, quota: boolean): number =>
  quota ? DELAY.quota : Math.min(DELAY.rateMax, DELAY.rateBase * 2 ** streak)