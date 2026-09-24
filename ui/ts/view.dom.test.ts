import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { test } from "bun:test"
import assert from "node:assert/strict"

GlobalRegistrator.register()
document.body.innerHTML = `
  <div class="card" id="card">
    <div class="header"></div>
    <div class="art" id="art" data-mode="message">
      <img class="cover" id="cover">
      <div id="badge"></div>
      <div class="upnext" id="upnext"><span id="upnext-text"></span></div>
      <div class="lyrics" id="lyrics"><div class="lines" id="lines"></div></div>
      <div class="ct busy" id="ct"><span class="spinner"></span><p id="status"></p></div>
      <div class="connect" id="connect-panel"><button id="connect"></button><p id="connect-note"></p></div>
    </div>
    <div class="info">
      <div class="meta"><div class="title-wrap" id="title-wrap"><span id="title"></span></div><div id="artist"></div></div>
      <div class="controls"><button id="playpause"></button><button id="next"></button></div>
    </div>
    <div class="settings"><input type="checkbox" id="show-cover"><input type="checkbox" id="frosted">
      <input type="checkbox" id="teleprompter"><input type="range" id="font-size" min="12" max="24"><small id="font-size-label"></small></div>
  </div>`

const { view, startRender } = await import("./view.ts")
const { makeClock, applySample } = await import("./clock.ts")
const { parseLrc } = await import("./lrc.ts")

const activeText = () => document.querySelector("#lines p.active")?.textContent ?? null
// the render loop may not tick within one rAF under a concurrent test run
const settled = async (want: string | null): Promise<string | null> => {
  for (let i = 0; i < 200; i++) {
    if (activeText() === want) break
    await new Promise((r) => setTimeout(r, 5))
  }
  return activeText()
}

test("the timing offset changes which line is active", async () => {
  const clock = makeClock()
  const lines = parseLrc("[00:10.00]one\n[00:20.00]two\n[00:30.00]three")
  view.lyrics(lines)
  startRender(clock)
  applySample(clock, "A", 19_000, false, 0, 0) // paused at 19 s so the position cannot drift mid-test
  view.timing(0)
  assert.equal(await settled("one"), "one")

  view.timing(2000) // "show lyrics 2 s sooner" → 21 s → line "two"
  assert.equal(await settled("two"), "two", "offset must move the active line")

  view.timing(-8000) // far behind → before the first line
  assert.notEqual(await settled(null), "two")
})

test("the heads-up shows in the last seconds when a next track is known", async () => {
  const clock = makeClock()
  view.track({ name: "T", artist: "A", durationMs: 200_000 } as never, "…")
  view.lyrics(parseLrc("[00:10.00]one\n[03:00.00]two"))
  startRender(clock)
  view.upNext("Berlari — Artist")
  applySample(clock, "B", 197_000, true, 0, 0)
  for (let i = 0; i < 100 && !document.getElementById("upnext")!.classList.contains("show"); i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  assert.ok(document.getElementById("upnext")!.classList.contains("show"), "#upnext should have class show")
  assert.equal(document.getElementById("upnext-text")!.textContent, "Berlari — Artist")
})
