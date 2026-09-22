// Spotify PKCE sign-in, token persistence, single-flight refresh.
import { Effect, SynchronizedRef } from "effect"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { cancel, onUrl, start } from "@fabianlars/tauri-plugin-oauth"
import { CLIENT_ID, LOGIN_TIMEOUT_MS, REDIRECT_PORTS, SCOPES, redirectUri } from "./config.ts"
import { LoginRequired, NetworkError, type Unauthorized } from "./errors.ts"
import { challengeOf, randomVerifier } from "./pkce.ts"

export interface Tokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number // epoch ms (wall clock is fine across restarts)
  readonly authorizedAt: number // epoch ms of the interactive sign-in; refresh tokens die 6 months after it
}
interface Slot { readonly tokens: Tokens | null; readonly version: number }

const TOKEN_URL = "https://accounts.spotify.com/api/token"
const REFRESH_EARLY_MS = 60_000
const DONE_HTML =
  "<!doctype html><meta charset=utf-8><title>float</title>" +
  "<body style='font:16px -apple-system,sans-serif;padding:40px'>Signed in to float. You can close this tab.</body>"

// ---- persistence (Rust commands read_auth / write_auth; failures are defects) ----
const parseTokens = (s: string | null): Tokens | null => {
  try {
    const t = s ? JSON.parse(s) : null
    return t && typeof t.accessToken === "string" && typeof t.refreshToken === "string" ? (t as Tokens) : null
  } catch {
    return null
  }
}
const readAuth = Effect.promise(() => invoke<string | null>("read_auth")).pipe(Effect.map(parseTokens))
const writeAuth = (t: Tokens | null) => Effect.promise(() => invoke<void>("write_auth", { json: JSON.stringify(t) }))

// ---- token endpoint ----
type J = Record<string, any>
const tokenRequest = (form: Record<string, string>, authorizedAt: number, prevRefresh: string | null) =>
  Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(form),
          signal,
        }),
      catch: (e) => new NetworkError({ message: `token request: ${String(e)}` }),
    })
    const j: J = yield* Effect.tryPromise({
      try: () => res.json() as Promise<J>,
      catch: () => new NetworkError({ message: `token ${res.status}: unreadable body` }),
    })
    if (res.status === 400 && j.error === "invalid_grant")
      return yield* Effect.fail(new LoginRequired({ message: "Spotify sign-in expired" }))
    if (!res.ok || typeof j.access_token !== "string")
      return yield* Effect.fail(new NetworkError({ message: `token ${res.status}: ${j.error ?? "?"} ${j.error_description ?? ""}` }))
    const refreshToken = typeof j.refresh_token === "string" ? j.refresh_token : prevRefresh // keep old one if not rotated
    if (!refreshToken) return yield* Effect.fail(new NetworkError({ message: "token response without refresh_token" }))
    const tokens: Tokens = {
      accessToken: j.access_token,
      refreshToken,
      expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000,
      authorizedAt,
    }
    return tokens
  }).pipe(Effect.timeoutFail({ duration: "15 seconds", onTimeout: () => new NetworkError({ message: "token request timed out" }) }))

// ---- interactive sign-in: loopback listener (Rust plugin) + system browser ----
const waitForCode = async (state: string, challenge: string): Promise<{ code: string; redirect: string }> => {
  let resolve!: (url: string) => void
  const got = new Promise<string>((r) => (resolve = r))
  const unlisten = await onUrl(resolve) // listen BEFORE start so the callback can't be missed
  let port: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    port = await start({ ports: REDIRECT_PORTS, response: DONE_HTML }) // first free port of the list
    const redirect = redirectUri(port)
    const q = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: redirect,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SCOPES,
      state,
    })
    await openUrl(`https://accounts.spotify.com/authorize?${q}`)
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), LOGIN_TIMEOUT_MS)
    })
    const url = new URL(await Promise.race([got, timeout]))
    if (url.searchParams.get("state") !== state) throw new Error("state mismatch")
    const err = url.searchParams.get("error")
    if (err) throw new Error(err) // e.g. access_denied
    const code = url.searchParams.get("code")
    if (!code) throw new Error("no code in callback")
    return { code, redirect }
  } finally {
    clearTimeout(timer)
    unlisten()
    if (port !== null) await cancel(port).catch(() => {}) // listener may already be gone
  }
}

const login = Effect.gen(function* () {
  const verifier = randomVerifier()
  const state = randomVerifier()
  const challenge = yield* Effect.promise(() => challengeOf(verifier))
  const { code, redirect } = yield* Effect.tryPromise({
    try: () => waitForCode(state, challenge),
    catch: (e) => new LoginRequired({ message: `Sign-in failed: ${e instanceof Error ? e.message : String(e)}` }),
  })
  return yield* tokenRequest(
    { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: CLIENT_ID, code_verifier: verifier },
    Date.now(),
    null,
  )
})

// ---- the service ----
// The browser sign-in only ever starts from a user action (the card's Connect button or the tray's
// "Sign in to Spotify again"). Missing or dead tokens just surface as LoginRequired.
export const makeAuth = Effect.gen(function* () {
  const slot = yield* SynchronizedRef.make<Slot>({ tokens: yield* readAuth, version: 0 })

  /** Refresh unless another caller already replaced the version we saw. Single-flight. Never opens a browser. */
  const renew = (seen: number) =>
    SynchronizedRef.updateAndGetEffect(slot, (cur) => {
      if (cur.version !== seen && cur.tokens) return Effect.succeed(cur)
      if (!cur.tokens) return Effect.succeed(cur) // not signed in: accessOf reports it
      return tokenRequest(
        { grant_type: "refresh_token", refresh_token: cur.tokens.refreshToken, client_id: CLIENT_ID },
        cur.tokens.authorizedAt,
        cur.tokens.refreshToken,
      ).pipe(
        Effect.tap(writeAuth),
        Effect.map((tokens): Slot => ({ tokens, version: cur.version + 1 })),
        // refresh token revoked/expired (6-month limit): forget it so we stop retrying; the user reconnects
        Effect.catchTag("LoginRequired", () => writeAuth(null).pipe(Effect.as<Slot>({ tokens: null, version: cur.version + 1 }))),
      )
    })

  const accessOf = (s: Slot) =>
    s.tokens ? Effect.succeed(s.tokens.accessToken) : Effect.fail(new LoginRequired({ message: "Not connected" }))

  /** Run `req` with a valid access token; refresh early, and once more on 401. */
  const withToken = <A, E>(req: (accessToken: string) => Effect.Effect<A, E | Unauthorized>) =>
    Effect.gen(function* () {
      let s = yield* SynchronizedRef.get(slot)
      if (s.tokens && s.tokens.expiresAt - REFRESH_EARLY_MS < Date.now()) s = yield* renew(s.version)
      const seen = s.version
      return yield* req(yield* accessOf(s)).pipe(
        Effect.catchTag("Unauthorized", () =>
          Effect.gen(function* () {
            const fresh = yield* renew(seen)
            return yield* req(yield* accessOf(fresh))
          }),
        ),
      )
    })

  /**
   * Interactive browser sign-in (user action only). Runs outside the token lock so polling never waits
   * on the browser; old tokens stay in use until the new ones arrive (a cancelled re-sign-in changes nothing).
   */
  const connect = Effect.gen(function* () {
    const tokens = yield* login
    yield* writeAuth(tokens)
    yield* SynchronizedRef.update(slot, (cur): Slot => ({ tokens, version: cur.version + 1 }))
  })

  /** Settings → Disconnect: forget the tokens (file + memory). The next poll shows the Connect button. */
  const disconnect = Effect.gen(function* () {
    yield* writeAuth(null)
    yield* SynchronizedRef.update(slot, (cur): Slot => ({ tokens: null, version: cur.version + 1 }))
  })

  return { withToken, connect, disconnect } as const
})
