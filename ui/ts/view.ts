// DOM: mini-player card — themed art panel (lyrics or a status message) + title/artist info row.
// textContent only (never innerHTML) — lyrics and track names are untrusted.
import { position, type Clock } from "./clock.ts"
import { lineAt, type Line } from "./lrc.ts"
import type { Playback } from "./playback.ts"
import { DEFAULT_THEME, themeFromPixels, type Theme } from "./theme.ts"

type Item = Extract<Playback, { kind: "item" }>
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} missing from index.html`)
  return el
}

let lines: readonly Line[] = []
let offsetMs = 0 // lead + global + per-track offset, added to the clock before lookup
let badgeText: string | null = null // persistent badge (this track's offset)
let flashTimer: ReturnType<typeof setTimeout> | undefined
let active = -2 // -2 = force re-layout on next frame
let theme: Theme = DEFAULT_THEME

const setMode = (mode: "lyrics" | "message" | "connect"): void => {
  $("art").dataset.mode = mode
}

/** Running text: if the title is wider than its row, scroll it back and forth (speed ≈ 30 px/s). */
export const marqueeShift = (textWidth: number, boxWidth: number): { shift: number; durS: number } | null => {
  const over = Math.ceil(textWidth - boxWidth)
  return over > 2 ? { shift: -(over + 12), durS: Math.max(6, (over + 12) / 30 + 3) } : null
}
const updateMarquee = (): void => {
  const wrap = $("title-wrap")
  const title = $("title")
  const m = marqueeShift(title.scrollWidth, wrap.clientWidth)
  wrap.classList.toggle("overflow", m !== null)
  if (m) {
    title.style.setProperty("--shift", `${m.shift}px`)
    title.style.setProperty("--dur", `${m.durS}s`)
  }
}
addEventListener("resize", updateMarquee)

export const view = {
  /** New track: title/artist in the info row, a status line in the art panel until lyrics (or a verdict) arrive. */
  track(p: Item, status: string): void {
    lines = []
    active = -2
    $("title-wrap").classList.remove("overflow") // restart the marquee from the left
    $("title").textContent = p.name
    $("artist").textContent = p.artist
    requestAnimationFrame(updateMarquee) // measure after layout
    $("status").textContent = status
    setMode("message")
    view.visible(true)
  },
  message(text: string): void {
    $("status").textContent = text
    setMode("message")
    view.visible(true)
  },
  lyrics(ls: readonly Line[]): void {
    $("art").classList.remove("plain")
    lines = ls
    active = -2
    $("lines").replaceChildren(
      ...ls.map((l) => {
        const p = document.createElement("p")
        p.textContent = l.text || "♪" // empty LRC line = instrumental gap
        return p
      }),
    )
    setMode("lyrics")
    view.visible(true)
  },
  /** Total offset (ms) added to the clock before the line lookup; takes effect on the next frame. */
  timing(ms: number): void {
    offsetMs = ms
  },
  /** Persistent badge (top-left of the art panel), e.g. this track's offset; null hides it. */
  badge(text: string | null): void {
    badgeText = text
    if (!flashTimer) showBadge(text)
  },
  /** Badge for 2 s (e.g. a global offset change), then back to the persistent one. */
  flash(text: string): void {
    clearTimeout(flashTimer)
    showBadge(text)
    flashTimer = setTimeout(() => {
      flashTimer = undefined
      showBadge(badgeText)
    }, 2000)
  },
  /** Not signed in: the Connect button (optionally with why, e.g. a failed or expired sign-in). */
  connect(note: string | null): void {
    lines = []
    $("title").textContent = "FLOAT"
    $("artist").textContent = "Not connected to Spotify"
    $("title-wrap").classList.remove("overflow")
    ;($("connect") as HTMLButtonElement).disabled = false
    $("connect-note").textContent = note ?? ""
    view.playing(null)
    setMode("connect")
    view.visible(true)
  },
  /** Connect clicked: the browser is open, waiting for the user to approve. */
  connecting(): void {
    ;($("connect") as HTMLButtonElement).disabled = true
    $("connect-note").textContent = "Approve float in your browser…"
    setMode("connect")
    view.visible(true)
  },
  /**
   * "Album art" setting: the song's cover instead of the lyrics. Only Spotify's CDN is accepted (the URL comes
   * from the API, but it still lands in the DOM); crossorigin keeps the image from tainting anything.
   */
  cover(url: string | null): void {
    coverUrl = url !== null && url.startsWith("https://i.scdn.co/") ? url : null
    applyCover()
  },
  showCover(on: boolean): void {
    coverOn = on
    $("art").classList.toggle("with-cover", on)
    ;($("show-cover") as HTMLInputElement).checked = on
    applyCover()
  },
  settings(open: boolean): void {
    document.body.classList.toggle("settings-open", open) // not "settings": that is the panel's own class
  },
  /** Settings' Spotify row: Disconnect when signed in, Connect when not. */
  account(connected: boolean): void {
    $("account").textContent = connected ? "Disconnect" : "Connect"
    $("account-note").textContent = connected ? "Connected" : "Not connected"
  },
  /** Play/pause icon + button state; null = nothing playing (buttons disabled). */
  playing(on: boolean | null): void {
    document.body.classList.toggle("paused", on === false)
    for (const id of ["playpause", "next"]) ($(id) as HTMLButtonElement).disabled = on === null
  },
  /** Tray "Hide float": fade the card out regardless of playback. */
  userVisible(on: boolean): void {
    $("card").classList.toggle("user-hidden", !on)
  },
  /**
   * Lyrics without timestamps: all lines, no highlight, no auto-scroll (the render loop only runs for
   * synced `lines`, which stay empty here). Starts at the top; the wheel scrolls while hovered.
   */
  plain(text: readonly string[]): void {
    lines = []
    active = -2
    $("art").classList.add("plain")
    $("lines").replaceChildren(
      ...text.map((t) => {
        const p = document.createElement("p")
        p.textContent = t || "\u00a0" // keep blank lines as spacing between verses
        return p
      }),
    )
    setMode("lyrics")
    $("lyrics").scrollTop = 0
    view.visible(true)
  },
  /** Fade only — never window.hide(): hidden webviews get their timers throttled. */
  visible(on: boolean): void {
    $("card").classList.toggle("faded", !on)
  },
  theme(t: Theme): void {
    if (t.top === theme.top && t.bottom === theme.bottom) return
    const art = $("art")
    art.style.setProperty("--prev-top", theme.top)
    art.style.setProperty("--prev-bottom", theme.bottom)
    art.style.setProperty("--top", t.top)
    art.style.setProperty("--bottom", t.bottom)
    art.classList.remove("fading")
    void art.offsetWidth // restart the animation
    art.classList.add("fading")
    theme = t
  },
}

// Album art: remember the current track's cover, but only load it while the setting is on
// (no 640 px download per track for nothing).
let coverUrl: string | null = null
let coverOn = false
const applyCover = (): void => {
  const img = $("cover") as HTMLImageElement
  const want = coverOn ? coverUrl : null
  if (want !== null && img.getAttribute("src") === want) return
  img.classList.remove("loaded")
  if (want === null) return void img.removeAttribute("src")
  img.onload = () => img.classList.add("loaded")
  img.src = want
}

const showBadge = (text: string | null): void => {
  const b = $("badge")
  if (text) b.textContent = text
  b.classList.toggle("show", text !== null)
}

/** Load album art (CORS: i.scdn.co sends ACAO *) and derive the theme. Resolves DEFAULT_THEME on any failure. */
export const themeFromUrl = async (url: string | null): Promise<Theme> => {
  if (!url) return DEFAULT_THEME
  try {
    const img = new Image()
    img.crossOrigin = "anonymous" // required, or the canvas is tainted and getImageData throws
    img.src = url
    await img.decode()
    const size = 32
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return DEFAULT_THEME
    ctx.drawImage(img, 0, 0, size, size)
    return themeFromPixels(ctx.getImageData(0, 0, size, size).data)
  } catch {
    return DEFAULT_THEME
  }
}

const USER_SCROLL_PAUSE_MS = 3000 // after a manual scroll, auto-scroll waits this long (Spotify-like)

/** Highlight line `i` (-1 = before the first line: nothing highlighted). */
const highlight = (i: number): void => {
  const ps = $("lines").children
  for (let k = 0; k < ps.length; k++) ps[k]!.classList.toggle("active", k === i)
}

/**
 * Scroll so line `i` (or the first line while i = -1) sits in the middle of the box.
 * Returns false when the box is hidden (album art, message, Connect): the caller must not count it as done.
 */
const scrollToLine = (i: number, smooth: boolean): boolean => {
  const box = $("lyrics")
  const target = $("lines").children[Math.max(0, i)] as HTMLElement | undefined
  if (!target || box.clientHeight === 0) return false
  // offsetTop is layout position inside .lyrics (its offsetParent), unaffected by scroll and transforms
  const top = target.offsetTop + target.offsetHeight / 2 - box.clientHeight / 2
  box.scrollTo({ top, behavior: smooth ? "smooth" : "auto" })
  return true
}

/**
 * rAF loop: current line = lineAt(clock + offsets). Highlight changes immediately; the scroll follows
 * unless the user scrolled in the last USER_SCROLL_PAUSE_MS, then it catches up smoothly.
 */
export const startRender = (clock: Clock): void => {
  let userScrollUntil = 0
  let scrolledTo = -2 // line the box was last scrolled to; -2 = unknown (new lyrics, resize)
  const RETURN = -3 // user scrolled away: glide back to the current line once the pause ends
  $("lyrics").addEventListener(
    "wheel",
    () => {
      userScrollUntil = performance.now() + USER_SCROLL_PAUSE_MS
      scrolledTo = RETURN
    },
    { passive: true },
  )
  // Lyrics box changed size (window resize, header strip collapsing/expanding on hover) → re-centre, no animation.
  new ResizeObserver(() => (scrolledTo = -2)).observe($("lyrics"))
  let wasVisible = false
  const frame = (): void => {
    // display:none throws away a scroll container's position: whenever the lyrics box comes back
    // (album art off, message/Connect → lyrics), jump to the current line again.
    const visible = $("lyrics").clientHeight > 0
    if (visible && !wasVisible) scrolledTo = -2
    wasVisible = visible
    if (lines.length && clock.key) {
      const i = lineAt(lines, position(clock, performance.now()) + offsetMs)
      if (i !== active) {
        if (active === -2) scrolledTo = -2 // fresh lyrics
        highlight(i)
        active = i
      }
      if (i !== scrolledTo && performance.now() >= userScrollUntil && scrollToLine(i, scrolledTo !== -2)) {
        scrolledTo = i // jumped on fresh lyrics/resize/re-show, glided otherwise
      }
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
