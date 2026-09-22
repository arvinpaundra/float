import { Data } from "effect"

export class NetworkError extends Data.TaggedError("NetworkError")<{ readonly message: string }> {}
export class Unauthorized extends Data.TaggedError("Unauthorized")<{}> {}
export class Forbidden extends Data.TaggedError("Forbidden")<{ readonly message: string }> {}
export class RateLimited extends Data.TaggedError("RateLimited")<{ readonly quota: boolean }> {}
export class HttpError extends Data.TaggedError("HttpError")<{ readonly status: number }> {}
export class LoginRequired extends Data.TaggedError("LoginRequired")<{ readonly message: string }> {}