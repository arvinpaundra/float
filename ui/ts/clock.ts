// Local playback clock. Pure: caller passes performance.now() values.
export const SNAP_MS = 1000 // error beyond this = seek/stall → jump
export const SLEW_MS = 3000 // smaller errors are absorbed over this window
export const STALE_RTT_MS = 1500 // a sample this slow cannot be placed accurately enough to correct with

export interface Clock {
  key: string | null // track key the clock belongs to
  pos: number // position (ms) at `at`
  at: number // performance.now() of the anchor
  rate: number // playback rate during the slew window (1 = normal)
  playing: boolean
  backVotes: number // consecutive samples asking to jump backwards
}

export const makeClock = (): Clock => ({ key: null, pos: 0, at: 0, rate: 1, playing: false, backVotes: 0 })

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
  const rtt = recvAt - sentAt
  const measured = progressMs + (playing ? rtt / 2 : 0)
  const est = position(c, recvAt)
  const err = measured - est
  const known = key === c.key && playing === c.playing
  if (!known) {
    Object.assign(c, { key, pos: measured, at: recvAt, rate: 1, playing, backVotes: 0 })
    return true
  }
  // a slow round trip places `measured` too loosely to correct with: keep extrapolating
  if (rtt > STALE_RTT_MS) return false
  if (Math.abs(err) > SNAP_MS) {
    // buffering makes progress_ms lag, so one backward jump is noise; a real rewind repeats
    if (err < 0 && c.backVotes === 0) {
      c.backVotes = 1
      return false
    }
    Object.assign(c, { key, pos: measured, at: recvAt, rate: 1, playing, backVotes: 0 })
    return true
  }
  // slew: bend the rate so the error is gone after SLEW_MS; rate stays in [2/3, 4/3] → never runs backwards
  Object.assign(c, { pos: est, at: recvAt, rate: 1 + err / SLEW_MS, backVotes: 0 })
  return false
}

/** Freeze at the current estimate (progress_ms null). The next real sample snaps (playing flag changes). */
export const hold = (c: Clock, now: number): void => {
  Object.assign(c, { pos: position(c, now), at: now, rate: 1, playing: false, backVotes: 0 })
}

export const reset = (c: Clock): void => {
  Object.assign(c, makeClock())
}

/** Optimistic jump after clicking a lyric line: show the new position before Spotify confirms it. */
export const seekTo = (c: Clock, ms: number, now: number): void => {
  Object.assign(c, { pos: Math.max(0, ms), at: now, rate: 1, backVotes: 0 })
}

/** Optimistic resume after the play button: keep the position, start advancing from `now`. */
export const resume = (c: Clock, now: number): void => {
  Object.assign(c, { at: now, rate: 1, playing: true, backVotes: 0 })
}
