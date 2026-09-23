import { test } from "bun:test"
import assert from "node:assert/strict"
import { controlProblem, nextLabel } from "./spotify.ts"

test("control errors map to user messages", () => {
  assert.equal(controlProblem(404, ""), "No active Spotify device")
  assert.match(controlProblem(403, "Insufficient client scope"), /Sign in to Spotify again/)
  assert.equal(controlProblem(403, "Player command failed: Premium required"), "Controls need Spotify Premium")
  assert.equal(controlProblem(403, "Restriction violated"), "Restriction violated")
})

test("nextLabel: song — artists, episodes without artists, junk", () => {
  assert.equal(nextLabel({ name: "Lemon", artists: [{ name: "Kenshi Yonezu" }] }), "Lemon — Kenshi Yonezu")
  assert.equal(nextLabel({ name: "Duo", artists: [{ name: "A" }, { name: "B" }] }), "Duo — A, B")
  assert.equal(nextLabel({ name: "Some Episode" }), "Some Episode")
  assert.equal(nextLabel({ artists: [{ name: "A" }] }), null)
  assert.equal(nextLabel({}), null)
})
