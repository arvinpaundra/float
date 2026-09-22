import { test } from "bun:test"
import assert from "node:assert/strict"
import { controlProblem } from "./spotify.ts"

test("control errors map to user messages", () => {
  assert.equal(controlProblem(404, ""), "No active Spotify device")
  assert.match(controlProblem(403, "Insufficient client scope"), /Sign in to Spotify again/)
  assert.equal(controlProblem(403, "Player command failed: Premium required"), "Controls need Spotify Premium")
  assert.equal(controlProblem(403, "Restriction violated"), "Restriction violated")
})
