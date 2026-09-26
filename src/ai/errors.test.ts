import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, AI_ERROR_MESSAGES, toAiError } from "./errors";
import { fakeApiError, fakeConnectionError } from "./fake";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toAiError", () => {
  it("maps a 401 to the invalid key message", () => {
    const error = toAiError(fakeApiError(401, "authentication_error", "invalid x-api-key"));
    expect(error).toBeInstanceOf(AiError);
    expect(error.kind).toBe("invalid-key");
    expect(error.message).toBe("That key was not accepted. Check it was copied fully.");
  });

  it("maps a 429 to a plain rate limit message", () => {
    const error = toAiError(fakeApiError(429, "rate_limit_error", "rate limited"));
    expect(error.kind).toBe("rate-limit");
    expect(error.message).toContain("Too many requests, try again in a minute");
  });

  it("maps a 529 to overloaded", () => {
    expect(toAiError(fakeApiError(529, "overloaded_error", "Overloaded")).kind).toBe("overloaded");
  });

  it("maps a 404 to model not found", () => {
    expect(toAiError(fakeApiError(404, "not_found_error", "model: nope")).kind).toBe(
      "model-not-found",
    );
  });

  it("maps billing errors, including the low credit 400, to billing", () => {
    expect(toAiError(fakeApiError(402, "billing_error", "Payment required")).kind).toBe("billing");
    const lowCredit = fakeApiError(
      400,
      "invalid_request_error",
      "Your credit balance is too low to access the Anthropic API.",
    );
    expect(toAiError(lowCredit).kind).toBe("billing");
    expect(toAiError(fakeApiError(400, "invalid_request_error", "bad field")).kind).toBe(
      "bad-request",
    );
  });

  it("says you are offline when the connection fails while the browser is offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const error = toAiError(fakeConnectionError());
    expect(error.kind).toBe("offline");
    expect(error.message).toContain("You are offline");
  });

  it("reports a network problem when online but the request could not connect", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    expect(toAiError(fakeConnectionError()).kind).toBe("network");
  });

  it("passes an AiError through unchanged and wraps unknown errors", () => {
    const original = new AiError("refusal");
    expect(toAiError(original)).toBe(original);
    const wrapped = toAiError(new Error("boom"));
    expect(wrapped.kind).toBe("unknown");
    expect(wrapped.message).toBe(AI_ERROR_MESSAGES.unknown);
  });

  it("marks only key and billing problems as blocking", () => {
    expect(new AiError("invalid-key").blocksAi).toBe(true);
    expect(new AiError("billing").blocksAi).toBe(true);
    expect(new AiError("rate-limit").blocksAi).toBe(false);
  });
});
