import type { Page, Route } from "@playwright/test";

/**
 * A scripted stand-in for api.anthropic.com at the network layer (no test may reach the real
 * API). It answers the Messages API the way the SDK expects: a JSON message for plain requests
 * and a server-sent event stream for `stream: true` requests (the sommelier streams).
 */

/** A source a text block cites, as the web search tool reports it. */
export interface Citation {
  type: "web_search_result_location";
  url: string;
  title: string | null;
  cited_text: string;
  encrypted_index?: string;
}

/** One result of a web search; `encrypted_content` is filled in when left out. */
export interface WebSearchResult {
  url: string;
  title: string;
  page_age?: string | null;
  encrypted_content?: string;
}

export type Block =
  /** `citations` is set on a text block that cites web search results. */
  | { type: "text"; text: string; citations?: Citation[] }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  /** A search the server ran for the model. */
  | { type: "server_tool_use"; id: string; name: "web_search"; input: Record<string, unknown> }
  /** What that search returned: a list of results, or an error object. */
  | {
      type: "web_search_tool_result";
      tool_use_id: string;
      content: WebSearchResult[] | { type: "web_search_tool_result_error"; error_code: string };
    };

export interface ScriptedReply {
  content: Block[];
  stop_reason?: "end_turn" | "tool_use" | "pause_turn";
}

/** A web search the server ran: its `server_tool_use` block and its result block. */
export function webSearch(
  id: string,
  query: string,
  results: WebSearchResult[] | { errorCode: string },
): Block[] {
  return [
    { type: "server_tool_use", id, name: "web_search", input: { query } },
    {
      type: "web_search_tool_result",
      tool_use_id: id,
      content: Array.isArray(results)
        ? results
        : { type: "web_search_tool_result_error", error_code: results.errorCode },
    },
  ];
}

/** A text block that cites web search results. */
export function citedText(
  text: string,
  citations: { url: string; title: string | null; citedText: string }[],
): Block {
  return {
    type: "text",
    text,
    citations: citations.map((c) => ({
      type: "web_search_result_location",
      url: c.url,
      title: c.title,
      cited_text: c.citedText,
    })),
  };
}

/** The parts of a Messages API request body the script looks at. */
export interface MessagesRequest {
  model: string;
  stream?: boolean;
  /** Set on a request that offers tools, such as a web research request. */
  tools?: { type?: string; name?: string }[];
  messages: { role: "user" | "assistant"; content: string | Record<string, unknown>[] }[];
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

const USAGE = {
  input_tokens: 120,
  output_tokens: 40,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function message(model: string, reply: ScriptedReply, content: unknown[]) {
  return {
    id: `msg_e2e_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: reply.stop_reason ?? "end_turn",
    stop_sequence: null,
    usage: USAGE,
  };
}

/** A search result as the API returns it, with the encrypted text a real result carries. */
function fullResults(content: WebSearchResult[] | { type: string; error_code: string }) {
  if (!Array.isArray(content)) return content;
  return content.map((r) => ({
    type: "web_search_result",
    url: r.url,
    title: r.title,
    page_age: r.page_age ?? null,
    encrypted_content: r.encrypted_content ?? "enc",
  }));
}

/** A reply's blocks as the JSON API returns them: citations and search results filled out. */
function jsonContent(blocks: Block[]): unknown[] {
  return blocks.map((block) => {
    if (block.type === "text") {
      return {
        ...block,
        citations:
          block.citations?.map((c) => ({ ...c, encrypted_index: c.encrypted_index ?? "idx" })) ??
          null,
      };
    }
    if (block.type === "web_search_tool_result") {
      return { ...block, content: fullResults(block.content) };
    }
    return block;
  });
}

/** The SSE events for one reply, in the order the API sends them. */
function sseBody(model: string, reply: ScriptedReply): string {
  const events: [string, unknown][] = [
    ["message_start", { type: "message_start", message: message(model, reply, []) }],
  ];
  reply.content.forEach((block, index) => {
    if (block.type === "text") {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "", ...(block.citations ? { citations: [] } : {}) },
        },
      ]);
      events.push([
        "content_block_delta",
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
      ]);
      for (const citation of block.citations ?? []) {
        events.push([
          "content_block_delta",
          {
            type: "content_block_delta",
            index,
            delta: {
              type: "citations_delta",
              citation: { ...citation, encrypted_index: citation.encrypted_index ?? "idx" },
            },
          },
        ]);
      }
    } else if (block.type === "web_search_tool_result") {
      // A tool result arrives whole, in its start event, with no deltas.
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { ...block, content: fullResults(block.content) },
        },
      ]);
    } else {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: block.type, id: block.id, name: block.name, input: {} },
        },
      ]);
      events.push([
        "content_block_delta",
        {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        },
      ]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: reply.stop_reason ?? "end_turn", stop_sequence: null },
      usage: USAGE,
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** The tool results in the request's last user message, by tool_use id. */
export function toolResults(request: MessagesRequest): Map<string, string> {
  const last = request.messages.at(-1);
  const results = new Map<string, string>();
  if (!last || typeof last.content === "string") return results;
  for (const block of last.content) {
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      results.set(block.tool_use_id, typeof block.content === "string" ? block.content : "");
    }
  }
  return results;
}

/**
 * Routes every api.anthropic.com request to `reply`. Returns the request bodies seen, in
 * order, so a test can check what was sent.
 */
export async function mockAnthropic(
  page: Page,
  reply: (request: MessagesRequest) => ScriptedReply,
): Promise<MessagesRequest[]> {
  const seen: MessagesRequest[] = [];
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const body = request.postDataJSON() as MessagesRequest;
    seen.push(body);
    const scripted = reply(body);
    if (body.stream) {
      await route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "text/event-stream" },
        body: sseBody(body.model, scripted),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: CORS,
        contentType: "application/json",
        json: message(body.model, scripted, jsonContent(scripted.content)),
      });
    }
  });
  return seen;
}
