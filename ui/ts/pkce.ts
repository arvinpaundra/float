// PKCE helpers (RFC 7636, S256). Uses Web Crypto: works in WKWebView and Node >= 20.
export const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/** 64 chars from [A-Za-z0-9-_] — inside Spotify's 43–128 rule. Also used for `state`. */
export const randomVerifier = (): string => b64url(crypto.getRandomValues(new Uint8Array(48)))

export const challengeOf = async (verifier: string): Promise<string> =>
  b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))