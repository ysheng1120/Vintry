import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";

/** Every way an AI request can fail, each with one plain-language message (R18). */
export type AiErrorKind =
  | "no-key"
  | "invalid-key"
  | "billing"
  | "permission"
  | "rate-limit"
  | "overloaded"
  | "server"
  | "offline"
  | "network"
  | "timeout"
  | "stream-dropped"
  | "model-not-found"
  | "too-large"
  | "bad-request"
  | "refusal"
  | "max-tokens"
  | "invalid-output"
  | "aborted"
  | "unknown";

export const AI_ERROR_MESSAGES: Record<AiErrorKind, string> = {
  "no-key": "Add your Claude API key in Settings to use AI features.",
  "invalid-key": "That key was not accepted. Check it was copied fully.",
  billing:
    "Your Anthropic account is out of credit. Add credit at console.anthropic.com, then test your key again in Settings.",
  permission: "This key is not allowed to do that. Check its permissions at console.anthropic.com.",
  "rate-limit": "Too many requests, try again in a minute.",
  overloaded: "Claude is very busy right now. Try again in a few minutes.",
  server: "Anthropic had a problem on their side. Try again in a moment.",
  offline: "You are offline. AI features need an internet connection.",
  network: "Could not reach Anthropic. Check your internet connection and try again.",
  timeout: "Claude took too long to answer. Try again.",
  "stream-dropped": "The connection dropped before Claude finished. Try again.",
  "model-not-found":
    "The chosen model is not available to your key. Pick another model in Settings.",
  "too-large": "That was too large to send. Try a smaller photo or less text.",
  "bad-request": "Anthropic could not process this request. Try again, or do it by hand.",
  refusal: "Claude declined this request. Try rewording it, or add the details by hand.",
  "max-tokens": "Claude's answer was too long and got cut off. Try again with less text.",
  "invalid-output":
    "Claude's answer was not in the expected shape. Try again, or fill in the details by hand.",
  aborted: "Cancelled.",
  unknown: "Something went wrong with the AI request. Try again.",
};

/** Errors that stop every AI feature until the key or account is fixed (useAiStatus). */
const BLOCKING: ReadonlySet<AiErrorKind> = new Set(["invalid-key", "billing", "permission"]);

/** Temporary problems where trying again later can work. */
const RETRYABLE: ReadonlySet<AiErrorKind> = new Set([
  "rate-limit",
  "overloaded",
  "server",
  "offline",
  "network",
  "timeout",
  "stream-dropped",
]);

/** A failed AI request with a plain message. Every AI function throws only this. */
export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, options?: { cause?: unknown; message?: string }) {
    super(options?.message ?? AI_ERROR_MESSAGES[kind], { cause: options?.cause });
    this.name = "AiError";
    this.kind = kind;
  }

  /** True when AI stays unavailable until the user fixes the key or billing. */
  get blocksAi(): boolean {
    return BLOCKING.has(this.kind);
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const BILLING_TEXT = /credit balance|billing|payment/i;

function kindForApiError(error: APIError): AiErrorKind {
  // Most specific first; APIConnectionError is a subclass of APIError in the TypeScript SDK.
  if (error instanceof APIUserAbortError) return "aborted";
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  if (error instanceof APIConnectionError) return isOffline() ? "offline" : "network";
  if (error.type === "billing_error" || error.status === 402) return "billing";
  if (error instanceof AuthenticationError) return "invalid-key";
  if (error instanceof PermissionDeniedError) return "permission";
  if (error instanceof NotFoundError) return "model-not-found";
  if (error instanceof RateLimitError) return "rate-limit";
  if (error.status === 413) return "too-large";
  if (error instanceof BadRequestError) {
    return BILLING_TEXT.test(error.message) ? "billing" : "bad-request";
  }
  if (error.type === "overloaded_error" || error.status === 529) return "overloaded";
  if (error instanceof InternalServerError) return "server";
  return "unknown";
}

/** Turns anything thrown by the SDK (or by us) into an AiError with a plain message. */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof APIError) return new AiError(kindForApiError(error), { cause: error });
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AiError("aborted", { cause: error });
  }
  if (isOffline()) return new AiError("offline", { cause: error });
  return new AiError("unknown", { cause: error });
}
