import { test } from "bun:test"
import assert from "node:assert/strict"
import { isFresh, toVerdict } from "./lyrics.ts"

test("verdict from cache row, freshness", () => {
  assert.equal(toVerdict("synced", "[00:01.00] a", 300).kind, "synced")
  assert.equal((toVerdict("synced", "[00:01.00] a", 300) as { offsetMs: number }).offsetMs, 300)
  assert.equal(toVerdict("synced", "not lrc", 0).kind, "none")
  assert.equal(toVerdict("synced", "[au: instrumental]", 0).kind, "instrumental")
  assert.equal(toVerdict("instrumental", null, 0).kind, "instrumental")
  assert.equal(toVerdict("none", null, 0).kind, "none")
  const now = 10 * 24 * 3600_000
  assert.ok(isFresh({ status: "synced", fetched_at: 0 }, now))
  assert.ok(!isFresh({ status: "none", fetched_at: 0 }, now))
  assert.ok(isFresh({ status: "none", fetched_at: now - 3600_000 }, now))
})

test("plain verdict: lines kept (blank lines as spacing), trailing blanks dropped; re-checked after TTL", () => {
  assert.deepEqual(toVerdict("plain", "Line one\r\n\nLine two\n\n", 0), { kind: "plain", lines: ["Line one", "", "Line two"] })
  assert.equal(toVerdict("plain", " \n ", 0).kind, "none")
  const day = 24 * 3600_000
  assert.ok(isFresh({ status: "plain", fetched_at: 0 }, 6 * day))
  assert.ok(!isFresh({ status: "plain", fetched_at: 0 }, 8 * day)) // may have become synced
})
