// Entry: sign in, poll currently-playing, drive the clock, load lyrics + theme per track, handle the tray menu.
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type Database from "@tauri-apps/plugin-sql"
import { Cause, Effect, Fiber, Queue, Ref, Schedule } from "effect"
import { makeAuth } from "./auth.ts"
import * as cache from "./cache.ts"
import { applySample, hold, makeClock, position, reset, resume, seekTo } from "./clock.ts"
import { installResize } from "./resize.ts"
import { GLOBAL_OFFSET_MS, LEAD_MS } from "./config.ts"
import { lyricsFor, type Verdict } from "./lyrics.ts"
import type { Playback } from "./playback.ts"
import { DELAY, delayPlaying, delayRateLimited } from "./schedule.ts"
import { control, controlProblem, currentlyPlaying, upNext, type Control } from "./spotify.ts"
import { applyNudge, offsetLabel, parseMenu } from "./timing.ts"
import { fontSize, installCopy, onLineClick, startRender, themeFromUrl, view } from "./view.ts"

type Item = Extract<Playback, { kind: "item" }>

/** Timing state: global offset (settings) + the per-track offset of the lyrics on screen. */
const timing = {
  global: GLOBAL_OFFSET_MS,
  track: null as { key: string; offset: number } | null, // null = no synced lyrics showing
}
const applyTiming = (): void => view.timing(LEAD_MS + timing.global + (timing.track?.offset ?? 0))

const show = (p: Item, v: Verdict): void => {
  timing.track = v.kind === "synced" ? { key: p.key, offset: v.offsetMs } : null
  view.badge(v.kind === "plain" ? "Not synced" : offsetLabel(timing.track?.offset ?? 0))
  applyTiming()
  if (v.kind === "synced") view.lyrics(v.lines)
  else if (v.kind === "plain") view.plain(v.lines)
  else if (v.kind === "instrumental") view.message("♪ Instrumental")
  else view.message(p.type === "episode" ? "No lyrics for podcasts" : "No synced lyrics for this track")
}

/** Per-track work in its own fiber; a newer track interrupts the older one (switch-to-latest). */
const makeLoader = (db: Database | null) =>
  Effect.gen(function* () {
    const inflight = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null)
    const load = (p: Item) =>
      Effect.gen(function* () {
        const prev = yield* Ref.get(inflight)
        if (prev) yield* Fiber.interrupt(prev) // aborts its fetches via AbortSignal
        const theme = Effect.promise(() => themeFromUrl(p.artUrl)).pipe(Effect.tap((t) => Effect.sync(() => view.theme(t))))
        const lyrics = lyricsFor(db, p).pipe(
          // LRCLIB down/rate-limited after its own retries: tell the user, try again every 30 s (3×)
          Effect.tapError(() => Effect.sync(() => view.message("Lyrics unavailable, retrying…"))),
          Effect.retry({ schedule: Schedule.spaced("30 seconds"), times: 3 }),
          Effect.tap((v) => Effect.sync(() => show(p, v))),
          Effect.catchAll((e) => Effect.sync(() => view.message(`Lyrics unavailable (${e.message})`))),
        )
        const fiber = yield* Effect.all([theme, lyrics], { concurrency: "unbounded", discard: true }).pipe(
          Effect.catchAllCause((c) => Effect.logError("track load failed", Cause.pretty(c))),
          Effect.forkDaemon, // lifetime managed here, not by the poll iteration that started it
        )
        yield* Ref.set(inflight, fiber)
      })
    return { load } as const
  })

const main = Effect.gen(function* () {
  const clock = makeClock()
  startRender(clock)
  // Rust broadcasts hover (the card is click-through otherwise, so CSS :hover can't be trusted).
  // It reveals the header's close button and drag dots.
  void listen<boolean>("float:hover", (e) => document.body.classList.toggle("hover", e.payload))
  installResize(document.getElementById("resize-r")!, "x")
  installResize(document.getElementById("resize-b")!, "y")
  installResize(document.getElementById("resize-br")!, "xy")
  document.getElementById("close")!.addEventListener("click", () => void invoke("quit"))
  // A broken cache (corrupt file, failed migration) must not stop lyrics: run uncached.
  const db: Database | null = yield* cache.open.pipe(
    Effect.catchAll((e) => Effect.logWarning("lyrics cache disabled", e.message).pipe(Effect.as(null))),
  )
  const setting = (key: string) =>
    db ? cache.getSetting(db, key).pipe(Effect.catchAll(() => Effect.succeed(null))) : Effect.succeed(null)
  const saveSetting = (key: string, value: string) =>
    db ? cache.putSetting(db, key, value).pipe(Effect.catchAll((e) => Effect.logWarning("setting not saved", e.message))) : Effect.void
  const savedOffset = yield* setting("global_offset_ms")
  if (savedOffset !== null && Number.isFinite(Number(savedOffset))) timing.global = Number(savedOffset)
  applyTiming()
  view.showCover((yield* setting("show_cover")) === "1")
  view.fontSize(fontSize(yield* setting("font_size")))
  view.teleprompter((yield* setting("teleprompter")) === "1")
  installCopy()
  const frostedOn = (yield* setting("frosted")) === "1"
  view.frosted(frostedOn)
  yield* Effect.promise(() => invoke("set_frosted", { on: frostedOn }))
  const loader = yield* makeLoader(db)
  const auth = yield* makeAuth
  const wake = yield* Queue.unbounded<void>() // cuts the poll sleep short (e.g. after "Sign in again")
  let rateStreak = 0

  // ---- Connect: the only way a browser sign-in starts (button in the card, or the tray menu) ----
  let connecting = false
  const connectFlow = Effect.gen(function* () {
    if (connecting) return // a sign-in is already waiting in the browser
    connecting = true
    view.connecting()
    yield* auth.connect
    reset(clock) // same song may still be playing: make the next poll treat it as new, so lyrics reload
    view.message("Connected. Loading…")
    yield* Queue.offer(wake, undefined) // poll now instead of after the idle delay
  }).pipe(
    Effect.catchAll((e) => Effect.sync(() => view.connect(e.message))), // denied, timed out, offline → try again
    Effect.ensuring(Effect.sync(() => (connecting = false))),
  )
  document.getElementById("connect")!.addEventListener("click", () => void Effect.runFork(connectFlow))

  // ---- settings panel (header's sliders icon): Album art toggle, Disconnect/Connect, Done ----
  let connected = false
  const setConnected = (on: boolean): void => {
    if (on !== connected) view.account(on)
    connected = on
  }
  view.account(false)
  const el = (id: string) => document.getElementById(id)!
  el("open-settings").addEventListener("click", () => view.settings(!document.body.classList.contains("settings-open")))
  el("done").addEventListener("click", () => view.settings(false))
  el("teleprompter").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked
    view.teleprompter(on)
    void Effect.runFork(saveSetting("teleprompter", on ? "1" : "0"))
  })
  el("font-size").addEventListener("input", (e) => {
    const px = fontSize((e.target as HTMLInputElement).value)
    view.fontSize(px)
    void Effect.runFork(saveSetting("font_size", String(px)))
  })
  el("frosted").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked
    view.frosted(on)
    void invoke("set_frosted", { on })
    void Effect.runFork(saveSetting("frosted", on ? "1" : "0"))
  })
  el("show-cover").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked
    view.showCover(on)
    void Effect.runFork(saveSetting("show_cover", on ? "1" : "0"))
  })
  el("account").addEventListener("click", () => {
    view.settings(false)
    if (!connected) return void Effect.runFork(connectFlow)
    void Effect.runFork(
      Effect.gen(function* () {
        yield* auth.disconnect
        setConnected(false)
        reset(clock)
        view.cover(null)
        view.connect(null)
        yield* Queue.offer(wake, undefined)
      }),
    )
  })

  // ---- tray menu (Rust forwards everything except Hide/Show and Quit) ----
  const onMenu = (id: string) =>
    Effect.gen(function* () {
      const cmd = parseMenu(id)
      if (!cmd) return
      if (cmd.kind === "sign-in") return yield* connectFlow
      if (cmd.scope === "global") {
        timing.global = applyNudge(timing.global, cmd.action)
        applyTiming()
        view.flash(`All tracks: ${offsetLabel(timing.global) ?? "reset"}`)
        if (db) yield* cache.putSetting(db, "global_offset_ms", String(timing.global))
        return
      }
      const t = timing.track
      if (!t) return view.flash("No synced lyrics to adjust")
      t.offset = applyNudge(t.offset, cmd.action)
      applyTiming()
      view.badge(offsetLabel(t.offset))
      if (db) yield* cache.setOffset(db, t.key, t.offset) // row exists: synced lyrics came from the cache path
    }).pipe(Effect.catchAllCause((c) => Effect.logError("menu action failed", Cause.pretty(c))))
  void listen<string>("float:menu", (e) => void Effect.runFork(onMenu(e.payload)))
  void listen<boolean>("float:visible", (e) => view.userVisible(e.payload))

  // ---- play/pause + next: optimistic UI, then a quick re-poll to confirm what Spotify did ----
  const onControl = (cmd: Control, positionMs?: number) =>
    Effect.gen(function* () {
      if (cmd === "pause") hold(clock, performance.now())
      if (cmd === "play") resume(clock, performance.now())
      if (cmd === "seek") seekTo(clock, positionMs ?? 0, performance.now())
      if (cmd === "pause" || cmd === "play") view.playing(cmd === "play")
      yield* auth.withToken(control(cmd, positionMs))
      yield* Effect.sleep("400 millis") // Spotify's state lags the command slightly
      yield* Queue.offer(wake, undefined)
    }).pipe(
      Effect.catchTags({
        Forbidden: (e) => Effect.sync(() => view.flash(controlProblem(403, e.message))),
        HttpError: (e) => Effect.sync(() => view.flash(e.status === 404 ? controlProblem(404, "") : `Spotify error ${e.status}`)),
      }),
      Effect.tapErrorCause(() => Queue.offer(wake, undefined)), // failed: re-poll so the UI shows the truth
      Effect.catchAllCause((c) => Effect.logError(`${cmd} failed`, Cause.pretty(c))),
    )
  document.getElementById("playpause")!.addEventListener("click", () =>
    void Effect.runFork(onControl(document.body.classList.contains("paused") ? "play" : "pause")),
  )
  document.getElementById("next")!.addEventListener("click", () => void Effect.runFork(onControl("next")))
  // click a lyric line → jump there (the view hands back the playback position for that line)
  onLineClick((positionMs) => void Effect.runFork(onControl("seek", positionMs)))

  /** One poll → the delay before the next one (ms). */
  const pollOnce = Effect.gen(function* () {
    const s = yield* auth.withToken(currentlyPlaying)
    rateStreak = 0
    setConnected(true)
    const p = s.playback
    view.playing(p.kind === "item" ? p.isPlaying : null)
    if (p.kind !== "item") {
      reset(clock)
      view.visible(false)
      return p.kind === "ad" ? DELAY.paused : DELAY.idle
    }
    if (p.key !== clock.key) {
      timing.track = null
      view.badge(null)
      view.track(p, "Loading lyrics…")
      view.cover(p.coverUrl)
      yield* loader.load(p)
      // the heads-up is optional: fetch it in the background, never delay or fail the poll
      yield* Effect.forkDaemon(
        auth
          .withToken(upNext)
          .pipe(
            Effect.tap((label) => Effect.sync(() => view.upNext(label))),
            Effect.catchAllCause(() => Effect.void),
          ),
      )
    } else view.visible(true)
    if (p.progressMs === null) {
      hold(clock, s.recvAt)
      clock.key = p.key
      return DELAY.paused
    }
    const jumped = applySample(clock, p.key, p.progressMs, p.isPlaying, s.sentAt, s.recvAt)
    return p.isPlaying ? delayPlaying(p.durationMs, position(clock, performance.now()), jumped) : DELAY.paused
  })

  // Every failure is turned into a delay here; nothing escapes, so the loop never dies.
  const iteration = pollOnce.pipe(
    Effect.catchTags({
      RateLimited: (e) => Effect.sync(() => delayRateLimited(rateStreak++, e.quota)),
      Forbidden: (e) =>
        Effect.sync(() => {
          view.message(`Spotify refused access: ${e.message}. Is this account on the app's user list and the owner's Premium active?`)
          return DELAY.forbidden
        }),
      LoginRequired: () =>
        Effect.sync(() => {
          if (!connecting) view.connect(null) // not signed in (first launch, or the sign-in expired)
          setConnected(false)
          view.cover(null)
          reset(clock)
          return DELAY.loginRetry
        }),
    }),
    Effect.catchAllCause((cause) => Effect.logError("poll failed", Cause.pretty(cause)).pipe(Effect.as(DELAY.error))),
  )

  yield* Effect.gen(function* () {
    const delay = yield* iteration
    yield* Effect.race(Effect.sleep(delay), Queue.take(wake))
  }).pipe(Effect.forever)
})

Effect.runFork(main)