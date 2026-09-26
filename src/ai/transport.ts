import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type MessageParams = MessageCreateParamsNonStreaming;

export interface TransportOptions {
  apiKey: string;
  signal?: AbortSignal;
  /** When set, the request streams and each text delta is passed here as it arrives. */
  onText?: (delta: string, snapshot: string) => void;
}

/**
 * The one place a request leaves the app. Tests swap it for the scripted fake in fake.ts
 * with `setAiTransport`, so no test ever reaches the network.
 */
export interface AiTransport {
  send(params: MessageParams, options: TransportOptions): Promise<BetaMessage>;
}

/** The browser SDK client for a key (KTD2). The key only ever goes to api.anthropic.com. */
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

const sdkTransport: AiTransport = {
  async send(params, { apiKey, signal, onText }) {
    const client = createAnthropicClient(apiKey);
    if (!onText) return client.beta.messages.create(params, { signal });
    const stream = client.beta.messages.stream(params, { signal });
    stream.on("text", onText);
    return stream.finalMessage();
  },
};

let override: AiTransport | null = null;

/** Replaces the network transport (tests only). Pass null to restore the real one. */
export function setAiTransport(transport: AiTransport | null): void {
  override = transport;
}

export function getAiTransport(): AiTransport {
  return override ?? sdkTransport;
}
