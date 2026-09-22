import { test } from "bun:test"
import assert from "node:assert/strict"
import { challengeOf, randomVerifier } from "./pkce.ts"

test("RFC 7636 appendix B vector + verifier shape", async () => {
  assert.equal(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  const v = randomVerifier()
  assert.match(v, /^[A-Za-z0-9\-_]{64}$/)
})
