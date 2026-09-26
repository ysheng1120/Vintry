/**
 * Test helpers for sommelier tests: scripted reply blocks and request checks. Import only from
 * `*.test.ts(x)` files.
 */
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { FakeAi } from "../fake";

let counter = 0;

/** A tool_use block as Claude returns it. */
export function toolUse(name: string, input: unknown, id = `toolu_${++counter}`): BetaContentBlock {
  return { type: "tool_use", id, name, input } as BetaContentBlock;
}

export function text(value: string): BetaContentBlock {
  return { type: "text", text: value, citations: null } as BetaContentBlock;
}

/** Queues a reply that calls tools. */
export function queueTools(ai: FakeAi, ...blocks: BetaContentBlock[]): void {
  ai.queueResponse({ content: blocks, stop_reason: "tool_use" });
}

export function blocksOf(message: BetaMessageParam | undefined): BetaContentBlockParam[] {
  if (!message) return [];
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : message.content;
}

/** The tool_result blocks of a request's last message, by tool_use id. */
export function lastToolResults(messages: BetaMessageParam[]) {
  const results = blocksOf(messages.at(-1)).filter((b) => b.type === "tool_result");
  return results.map((b) => ({
    id: b.tool_use_id,
    content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
    isError: b.is_error === true,
  }));
}

/**
 * Checks the request is well formed: roles alternate starting with user, and every tool_use
 * is answered by a tool_result at the start of the next message.
 */
export function expectValidConversation(messages: BetaMessageParam[]): void {
  messages.forEach((message, index) => {
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (message.role !== expectedRole) {
      throw new Error(`Message ${index} is ${message.role}, expected ${expectedRole}`);
    }
    if (message.role !== "assistant") return;
    const ids = blocksOf(message)
      .filter((b) => b.type === "tool_use")
      .map((b) => b.id);
    if (ids.length === 0) return;
    const next = blocksOf(messages[index + 1]);
    const leading = next.slice(0, ids.length);
    const answered = leading.map((b) => (b.type === "tool_result" ? b.tool_use_id : null));
    if (JSON.stringify(answered) !== JSON.stringify(ids)) {
      throw new Error(
        `tool_use ${JSON.stringify(ids)} answered by ${JSON.stringify(answered)} in message ${index + 1}`,
      );
    }
  });
}

/** All text blocks of a message joined. */
export function textOf(message: BetaMessageParam | undefined): string {
  return blocksOf(message)
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");
}
