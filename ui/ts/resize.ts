// macOS-style resize: no visible grip, just edge/corner zones with the native resize cursors.
// Works while hovered (the card only takes the mouse then). Top/left edges are left out: resize_lyrics
// keeps the top-left corner fixed, which is what dragging the right/bottom edges means anyway.
import { invoke } from "@tauri-apps/api/core"

export type Axis = "x" | "y" | "xy"

/** New size for a drag of (dx, dy) from `start`, only along `axis` (clamping happens in Rust). */
export const resized = (start: { w: number; h: number }, dx: number, dy: number, axis: Axis): { w: number; h: number } => ({
  w: axis === "y" ? start.w : start.w + dx,
  h: axis === "x" ? start.h : start.h + dy,
})

// ponytail: manual resize — tao's start_resize_dragging is NotSupported on macOS
export const installResize = (zone: HTMLElement, axis: Axis): void => {
  let start: { x: number; y: number; w: number; h: number } | null = null
  const stop = (): void => {
    start = null
  }
  zone.addEventListener("pointerdown", async (e) => {
    e.preventDefault()
    zone.setPointerCapture(e.pointerId)
    const { screenX: x, screenY: y } = e
    const size = await invoke<[number, number] | null>("lyrics_size")
    if (size) start = { x, y, w: size[0], h: size[1] }
  })
  zone.addEventListener("pointermove", (e) => {
    if (!start) return
    if (e.buttons === 0) return stop() // button released outside (e.g. hover ended mid-drag)
    void invoke("resize_lyrics", resized(start, e.screenX - start.x, e.screenY - start.y, axis))
  })
  zone.addEventListener("pointerup", stop)
  zone.addEventListener("pointercancel", stop)
  zone.addEventListener("lostpointercapture", stop)
}
