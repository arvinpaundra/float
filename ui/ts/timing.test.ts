import { test } from "bun:test"
import assert from "node:assert/strict"
import { applyNudge, offsetLabel, parseMenu } from "./timing.ts"

test("menu ids, nudge clamp, labels", () => {
  assert.deepEqual(parseMenu("nudge:+250"), { kind: "offset", scope: "track", action: "+" })
  assert.deepEqual(parseMenu("global:-250"), { kind: "offset", scope: "global", action: "-" })
  assert.deepEqual(parseMenu("nudge:reset"), { kind: "offset", scope: "track", action: "reset" })
  assert.deepEqual(parseMenu("sign-in"), { kind: "sign-in" })
  assert.equal(parseMenu("hide"), null) // handled in Rust
  assert.equal(parseMenu("nudge:+999"), null)
  assert.equal(applyNudge(0, "+"), 250)
  assert.equal(applyNudge(4900, "+"), 5000)
  assert.equal(applyNudge(-5000, "-"), -5000)
  assert.equal(applyNudge(1750, "reset"), 0)
  assert.equal(offsetLabel(0), null)
  assert.equal(offsetLabel(500), "0.50s sooner")
  assert.equal(offsetLabel(-250), "0.25s later")
})
