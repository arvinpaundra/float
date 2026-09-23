// DOM: mini-player card — themed art panel (lyrics or a status message) + title/artist info row.
// textContent only (never innerHTML) — lyrics and track names are untrusted.
import { invoke } from "@tauri-apps/api/core"
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

/** The "up next" heads-up appears this long before the track ends. */
export const UP_NEXT_LEAD_MS = 5000

/** Pure: show the heads-up? Only while playing, with a known next track, in the last seconds. */
export const showUpNext = (remainingMs: number, hasNext: boolean, playing: boolean): boolean =>
  hasNext && playing && remainingMs <= UP_NEXT_LEAD_MS && remainingMs > -500

export const FONT_MIN = 12
export const FONT_MAX = 24
export const FONT_DEFAULT = 15

/** Pure: a stored/queried lyrics size clamped into range, falling back to the default. */
export const fontSize = (value: string | number | null): number => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? n : FONT_DEFAULT
}

/** A gap before the first line this long shows the countdown instead of an empty card. */
export const INTRO_GAP_MS = 4000
/** Dots shown while an instrumental gap runs. */
export const GAP_DOTS = 3

/** Pure: how many dots are lit during a gap, 0…GAP_DOTS (times in ms). */
export const gapDots = (now: number, start: number, end: number): number => {
  if (!(end > start)) return 0
  const p = (now - start) / (end - start)
  return Math.max(0, Math.min(GAP_DOTS, Math.floor(p * GAP_DOTS) + 1))
}

/** Pure: a long intro becomes a leading gap line, so the countdown runs before the first lyric. */
export const withIntro = (ls: readonly Line[]): readonly Line[] =>
  ls.length && ls[0]!.t >= INTRO_GAP_MS && ls[0]!.text !== "" ? [{ t: 0, text: "" }, ...ls] : ls

let lines: readonly Line[] = []
let offsetMs = 0 // lead + global + per-track offset, added to the clock before lookup
let badgeText: string | null = null // persistent badge (this track's offset)
let flashTimer: ReturnType<typeof setTimeout> | undefined
let active = -2 // -2 = force re-layout on next frame
let theme: Theme = DEFAULT_THEME
let upNextLabel: string | null = null
let trackDuration = 0
let headsUpShown = false

const showHeadsUp = (on: boolean): void => {
  if (on === headsUpShown) return
  headsUpShown = on
  $("upnext").classList.toggle("show", on)
}

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
  /** Next track in the queue ("Song — Artist"), shown as a heads-up near the end. */
  upNext(label: string | null): void {
    upNextLabel = label
    if (!label) showHeadsUp(false)
    else $("upnext-text").textContent = label
  },
  track(p: Item, status: string): void {
    trackDuration = p.durationMs
    upNextLabel = null
    showHeadsUp(false)
    lines = []
    active = -2
    $("title-wrap").classList.remove("overflow") // restart the marquee from the left
    $("title").textContent = p.name
    $("artist").textContent = p.artist
    requestAnimationFrame(updateMarquee) // measure after layout
    $("status").textContent = status
    $("ct").classList.add("busy") // a new track always starts by loading its lyrics
    setMode("message")
    view.visible(true)
  },
  /** `busy` (default): float is waiting on something, so the spinner runs. Verdicts pass false. */
  message(text: string, busy = true): void {
    $("status").textContent = text
    $("ct").classList.toggle("busy", busy)
    setMode("message")
    view.visible(true)
  },
  lyrics(ls: readonly Line[]): void {
    $("art").classList.remove("plain")
    lines = withIntro(ls)
    active = -2
    $("lines").replaceChildren(
      ...lines.map((l) => {
        const p = document.createElement("p")
        if (l.text) p.textContent = l.text
        else {
          // instrumental gap (or a long intro): ♪ marks that light up as the gap runs out
          p.className = "gap"
          p.append(
            ...Array.from({ length: GAP_DOTS }, () => {
              const note = document.createElement("i")
              note.textContent = "♪"
              return note
            }),
          )
        }
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
    $("connect-panel").classList.remove("busy")
    view.playing(null)
    setMode("connect")
    view.visible(true)
  },
  /** Connect clicked: the browser is open, waiting for the user to approve. */
  connecting(): void {
    ;($("connect") as HTMLButtonElement).disabled = true
    $("connect-note").textContent = "Approve float in your browser…"
    $("connect-panel").classList.add("busy")
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
  /** Teleprompter: show only the current line (large) and the next one (dim). */
  teleprompter(on: boolean): void {
    document.body.classList.toggle("teleprompter", on)
    ;($("teleprompter") as HTMLInputElement).checked = on
  },
  /** Lyrics font size in px (the gap ♪ and the unsynced view scale with it). */
  fontSize(px: number): void {
    const size = fontSize(px)
    document.documentElement.style.setProperty("--lyric-size", `${size}px`)
    const slider = $("font-size") as HTMLInputElement
    slider.value = String(size)
    slider.style.setProperty("--fill", `${((size - FONT_MIN) / (FONT_MAX - FONT_MIN)) * 100}%`)
    $("font-size-label").textContent = `${size} px`
  },
  /** "Frosted glass": the translucent card styling (Rust applies the window vibrancy itself). */
  frosted(on: boolean): void {
    document.body.classList.toggle("frosted", on)
    ;($("frosted") as HTMLInputElement).checked = on
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
    art.style.setProperty("--accent", t.accent)
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

/** Copy via Rust (pbcopy): the webview blocks navigator.clipboard and execCommand under tauri://. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    await invoke("copy_text", { text })
    return true
  } catch {
    return false
  }
}

/** Right-click a lyric line to copy it (left-click seeks). Right-click elsewhere copies "Title — Artist". */
export const installCopy = (): void => {
  const copy = (text: string): void => {
    if (!text) return
    void copyText(text).then((ok) => view.flash(ok ? "Copied" : "Copy failed"))
  }
  $("lines").addEventListener("contextmenu", (e) => {
    const p = (e.target as HTMLElement).closest("p")
    if (!p || p.classList.contains("gap")) return
    e.preventDefault()
    e.stopPropagation()
    copy(p.textContent ?? "")
  })
  $("card").addEventListener("contextmenu", (e) => {
    e.preventDefault()
    const title = $("title").textContent ?? ""
    const artist = $("artist").textContent ?? ""
    copy(title && artist ? `${title} — ${artist}` : title)
  })
}

/**
 * Click a lyric line to jump there: the callback gets the playback position that puts this line on screen
 * (its timestamp minus the offsets the render loop adds).
 */
export const onLineClick = (seek: (positionMs: number) => void): void => {
  $("lines").addEventListener("click", (e) => {
    const p = (e.target as HTMLElement).closest("p")
    if (!p || !lines.length) return
    const line = lines[Array.prototype.indexOf.call($("lines").children, p)]
    if (line) seek(Math.max(0, line.t - offsetMs))
  })
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
  let litDots = -1
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
        litDots = -1
      }
      // "up next" heads-up in the last seconds of the track
      showHeadsUp(showUpNext(trackDuration - position(clock, performance.now()), upNextLabel !== null, clock.playing))
      // instrumental gap: light the dots as it runs out (DOM touched only when the count changes)
      const gap = i >= 0 ? lines[i] : undefined
      if (gap && !gap.text) {
        const lit = gapDots(position(clock, performance.now()) + offsetMs, gap.t, lines[i + 1]?.t ?? gap.t)
        if (lit !== litDots) {
          litDots = lit
          ;($("lines").children[i] as HTMLElement | undefined)?.setAttribute("data-lit", String(lit))
        }
      }
      if (i !== scrolledTo && performance.now() >= userScrollUntil && scrollToLine(i, scrolledTo !== -2)) {
        scrolledTo = i // jumped on fresh lyrics/resize/re-show, glided otherwise
      }
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
