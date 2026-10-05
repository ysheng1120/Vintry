/**
 * Scripted fake for AI tests (KTD19). No test may reach the real API.
 *
 * Usage in a test file:
 *
 *   let ai: FakeAi;
 *   beforeEach(async () => {
 *     await resetDatabase();
 *     ai = installFakeAi();              // every request now goes to the fake
 *     await saveApiKey("sk-ant-test");   // from ./client; without a key requests fail "no-key"
 *   });
 *   afterEach(() => uninstallFakeAi());
 *
 *   ai.queueJson({ producer: "Ridge" });                        // structured output reply
 *   ai.queueText("Open the Barolo.");                           // plain text reply
 *   ai.queueResponse({ content: [toolUseBlock], stop_reason: "tool_use" }); // any message
 *   ai.queueError(fakeApiError(429, "rate_limit_error", "slow")); // SDK error
 *   ai.queueResponse({                                          // server web search
 *     content: [...fakeWebSearch("srv_1", "query", [{ url, title }]), fakeCitedText(text, [...])],
 *     stop_reason: "pause_turn",                                // or "end_turn"
 *   });
 *   ai.requests[0]                                              // parameters actually sent
 *
 * Responses are used in order, one per request; an unexpected request fails loudly.
 * With `onText` (streaming), the fake passes each text block to it before returning.
 */
import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ErrorType } from "@anthropic-ai/sdk/resources/shared";
import { setAiTransport, type AiTransport, type MessageParams } from "./transport";

export interface FakeResponse extends Omit<Partial<BetaMessage>, "usage"> {
  usage?: Partial<BetaUsage>;
}

type Scripted = { kind: "response"; response: FakeResponse } | { kind: "error"; error: unknown };

export interface FakeAi {
  /** Parameters of every request sent, in order. */
  readonly requests: MessageParams[];
  queueResponse(response: FakeResponse): void;
  /** A reply whose single text block is `JSON.stringify(value)`. */
  queueJson(value: unknown, overrides?: FakeResponse): void;
  queueText(text: string, overrides?: FakeResponse): void;
  queueError(error: unknown): void;
  /** Scripted replies not used yet. */
  remaining(): number;
}

const EMPTY_USAGE: BetaUsage = {
  cache_creation: null,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  fallback_credit: null,
  inference_geo: null,
  input_tokens: 100,
  iterations: null,
  output_tokens: 50,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: "standard",
  speed: "standard",
};

/** A complete BetaMessage; by default the served model is the requested one. */
export function fakeMessage(overrides: FakeResponse = {}, requestedModel = "claude-opus-5") {
  const { usage, ...rest } = overrides;
  const message: BetaMessage = {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: requestedModel,
    content: [],
    container: null,
    context_management: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    ...rest,
    usage: { ...EMPTY_USAGE, ...usage },
  } as BetaMessage; // BetaMessage has more optional-in-practice fields than a fake needs
  return message;
}

function textBlock(text: string): BetaContentBlock {
  return { type: "text", text, citations: null } as BetaContentBlock;
}

/**
 * A web search the server ran (server tools need no client step): its `server_tool_use` block
 * and its `web_search_tool_result`, which holds the results or an error object.
 */
export function fakeWebSearch(
  id: string,
  query: string,
  results: { url: string; title: string; pageAge?: string }[] | { errorCode: string },
): BetaContentBlock[] {
  const content = Array.isArray(results)
    ? results.map((r) => ({
        type: "web_search_result",
        url: r.url,
        title: r.title,
        page_age: r.pageAge ?? null,
        encrypted_content: "enc",
      }))
    : { type: "web_search_tool_result_error", error_code: results.errorCode };
  return [
    { type: "server_tool_use", id, name: "web_search", input: { query } },
    { type: "web_search_tool_result", tool_use_id: id, content },
  ] as BetaContentBlock[];
}

/**
 * A page the server read with web fetch: its `server_tool_use` block and its
 * `web_fetch_tool_result`, which holds the page text or an error object.
 */
export function fakeWebFetch(
  id: string,
  url: string,
  page: { title: string | null; text: string } | { errorCode: string },
): BetaContentBlock[] {
  const content =
    "errorCode" in page
      ? { type: "web_fetch_tool_result_error", error_code: page.errorCode }
      : {
          type: "web_fetch_result",
          url,
          retrieved_at: "2026-10-05T12:00:00Z",
          content: {
            type: "document",
            title: page.title,
            citations: null,
            source: { type: "text", media_type: "text/plain", data: page.text },
          },
        };
  return [
    { type: "server_tool_use", id, name: "web_fetch", input: { url } },
    { type: "web_fetch_tool_result", tool_use_id: id, content },
  ] as BetaContentBlock[];
}

/** A text block citing web search results. */
export function fakeCitedText(
  text: string,
  citations: { url: string; title: string | null; citedText: string }[],
): BetaContentBlock {
  return {
    type: "text",
    text,
    citations: citations.map((c) => ({
      type: "web_search_result_location",
      url: c.url,
      title: c.title,
      cited_text: c.citedText,
      encrypted_index: "idx",
    })),
  } as BetaContentBlock;
}

/** An SDK error for an HTTP status, built the way the SDK builds it from a response. */
export function fakeApiError(status: number, type: ErrorType, message: string): APIError {
  return APIError.generate(
    status,
    { type: "error", error: { type, message } },
    undefined,
    new Headers(),
  );
}

/** The error the SDK throws when the request never reached Anthropic. */
export function fakeConnectionError(): APIConnectionError {
  return new APIConnectionError({ message: "Connection error." });
}

export function installFakeAi(): FakeAi {
  const script: Scripted[] = [];
  const requests: MessageParams[] = [];

  const transport: AiTransport = {
    async send(params, { onText }) {
      requests.push(structuredClone(params));
      const next = script.shift();
      if (!next) throw new Error(`FakeAi: no scripted reply for request ${requests.length}`);
      if (next.kind === "error") throw next.error;
      const message = fakeMessage(next.response, params.model);
      if (onText) {
        let snapshot = "";
        for (const block of message.content) {
          if (block.type !== "text") continue;
          snapshot += block.text;
          onText(block.text, snapshot);
        }
      }
      return message;
    },
  };

  const fake: FakeAi = {
    requests,
    queueResponse: (response) => script.push({ kind: "response", response }),
    queueJson: (value, overrides = {}) =>
      script.push({
        kind: "response",
        response: { content: [textBlock(JSON.stringify(value))], ...overrides },
      }),
    queueText: (text, overrides = {}) =>
      script.push({ kind: "response", response: { content: [textBlock(text)], ...overrides } }),
    queueError: (error) => script.push({ kind: "error", error }),
    remaining: () => script.length,
  };

  setAiTransport(transport);
  return fake;
}

export function uninstallFakeAi(): void {
  setAiTransport(null);
}
