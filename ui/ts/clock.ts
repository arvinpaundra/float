// Local playback clock. Pure: caller passes performance.now() values.
export const SNAP_MS = 1000 // error beyond this = seek/stall → jump
export const SLEW_MS = 3000 // smaller errors are absorbed over this window

export interface Clock {
  key: string | null // track key the clock belongs to
  pos: number // position (ms) at `at`
  at: number // performance.now() of the anchor
  rate: number // playback rate during the slew window (1 = normal)
  playing: boolean
}

export const makeClock = (): Clock => ({ key: null, pos: 0, at: 0, rate: 1, playing: false })

export const position = (c: Clock, now: number): number => {
  if (!c.playing) return c.pos
  const dt = Math.max(0, now - c.at)
  return c.pos + Math.min(dt, SLEW_MS) * c.rate + Math.max(0, dt - SLEW_MS)
}

/** Feed one Spotify sample. Returns true when the clock jumped (track change, play/pause, seek). */
export const applySample = (
  c: Clock, key: string, progressMs: number, playing: boolean, sentAt: number, recvAt: number,
): boolean => {
  // progress_ms was sampled ~mid-flight; it has advanced by rtt/2 by the time we read it
  const measured = progressMs + (playing ? (recvAt - sentAt) / 2 : 0)
  const est = position(c, recvAt)
  const err = measured - est
  if (key !== c.key || playing !== c.playing || Math.abs(err) > SNAP_MS) {
    Object.assign(c, { key, pos: measured, at: recvAt, rate: 1, playing })
    return true
  }
  // slew: bend the rate so the error is gone after SLEW_MS; rate stays in [2/3, 4/3] → never runs backwards
  Object.assign(c, { pos: est, at: recvAt, rate: 1 + err / SLEW_MS })
  return false
}

/** Freeze at the current estimate (progress_ms null). The next real sample snaps (playing flag changes). */
export const hold = (c: Clock, now: number): void => {
  Object.assign(c, { pos: position(c, now), at: now, rate: 1, playing: false })
}

export const reset = (c: Clock): void => {
  Object.assign(c, makeClock())
}

/** Optimistic resume after the play button: keep the position, start advancing from `now`. */
export const resume = (c: Clock, now: number): void => {
  Object.assign(c, { at: now, rate: 1, playing: true })
}
