import type {
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageParam,
  BetaOutputConfig,
  BetaTextBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { deleteSetting, getSetting, setSetting, useSetting } from "../db/settings";
import { nowIso } from "../domain/clock";
import { AiError, toAiError, type AiErrorKind } from "./errors";
import { getModel, resolveModelId, type ModelId, type ModelInfo } from "./models";
import { getAiTransport, type MessageParams } from "./transport";
import { recordUsage } from "./usage";

export { createAnthropicClient } from "./transport";

/**
 * The only module that reads the stored API key (KTD2). Other modules ask whether a key
 * exists, or send requests through `sendMessage`.
 */

// Setting keys (the same strings as SETTING_KEYS in src/db/settings). Plain strings keep this
// module working under the shell tests' settings mock, which has no SETTING_KEYS export.
const API_KEY = "apiKey";
const MODEL_KEY = "model";

/** Setting that remembers a key or billing problem until a later request succeeds. */
export const AI_LAST_ERROR_KEY = "aiLastError";

export interface StoredAiError {
  kind: AiErrorKind;
  message: string;
  at: string;
}

/** Beta header for `fallbacks: "default"` (KTD3). */
export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function cleanKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readApiKey(): Promise<string> {
  return cleanKey(await getSetting<unknown>(API_KEY, ""));
}

export async function saveApiKey(key: string): Promise<void> {
  await setSetting(API_KEY, cleanKey(key));
  await deleteSetting(AI_LAST_ERROR_KEY);
}

export async function removeApiKey(): Promise<void> {
  await deleteSetting(API_KEY);
  await deleteSetting(AI_LAST_ERROR_KEY);
}

export async function hasApiKey(): Promise<boolean> {
  return (await readApiKey()) !== "";
}

function hintFor(key: string): string | null {
  return key === "" ? null : `…${key.slice(-4)}`;
}

/** The last four characters of the saved key, e.g. "…WXYZ", or null without a key. */
export async function apiKeyHint(): Promise<string | null> {
  return hintFor(await readApiKey());
}

/** Live: whether a key is saved. False while loading. */
export function useHasApiKey(): boolean {
  return cleanKey(useSetting<unknown>(API_KEY, "")) !== "";
}

/** Live version of `apiKeyHint`, for Settings. */
export function useApiKeyHint(): string | null {
  return hintFor(cleanKey(useSetting<unknown>(API_KEY, "")));
}

export async function getSelectedModel(): Promise<ModelInfo> {
  const id = resolveModelId(await getSetting<unknown>(MODEL_KEY, undefined));
  return getModel(id) as ModelInfo;
}

export function useSelectedModelId(): ModelId {
  return resolveModelId(useSetting<unknown>(MODEL_KEY, undefined));
}

export async function setSelectedModel(id: ModelId): Promise<void> {
  await setSetting(MODEL_KEY, id);
}

export interface AiRequest {
  /** Feature name for usage totals, e.g. "scan" or "chat" (see usage.ts FEATURE_LABELS). */
  feature: string;
  messages: BetaMessageParam[];
  system?: string | BetaTextBlockParam[];
  tools?: BetaToolUnion[];
  /** Ignored on models without effort (Haiku 4.5). */
  effort?: Effort;
  maxTokens?: number;
  /** Structured output format (`output_config.format`). */
  outputFormat?: BetaJSONOutputFormat;
  /** Turns thinking off on models that think by default; for trivial requests only. */
  noThinking?: boolean;
}

export interface SendOptions {
  signal?: AbortSignal;
  /** Streams the reply; called with each text delta and the text so far. */
  onText?: (delta: string, snapshot: string) => void;
  /** Sends with this key instead of the saved one (Settings "Test key" before saving). */
  apiKey?: string;
}

const DEFAULT_MAX_TOKENS = 16000;

/** Builds request parameters for a model: adaptive thinking, effort, and refusal fallback (KTD3). */
export function buildParams(model: ModelInfo, request: AiRequest): MessageParams {
  const params: MessageParams = {
    model: model.id,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: request.messages,
  };
  if (request.system !== undefined) params.system = request.system;
  if (request.tools) params.tools = request.tools;

  const outputConfig: BetaOutputConfig = {};
  if (request.outputFormat) outputConfig.format = request.outputFormat;
  if (model.effort && request.effort) outputConfig.effort = request.effort;
  if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;

  if (model.adaptiveThinking) {
    params.thinking = request.noThinking ? { type: "disabled" } : { type: "adaptive" };
  }
  if (model.refusalFallback) {
    params.betas = [REFUSAL_FALLBACK_BETA];
    params.fallbacks = "default";
  }
  return params;
}

async function rememberError(error: AiError): Promise<void> {
  const stored: StoredAiError = { kind: error.kind, message: error.message, at: nowIso() };
  await setSetting(AI_LAST_ERROR_KEY, stored);
}

async function clearLastError(): Promise<void> {
  if ((await getSetting<unknown>(AI_LAST_ERROR_KEY, null)) !== null) {
    await deleteSetting(AI_LAST_ERROR_KEY);
  }
}

/**
 * Sends one request with the saved key and the chosen model, records its usage, and returns
 * the raw message. Callers check `stop_reason` themselves (runStructured does). Throws AiError.
 */
export async function sendMessage(
  request: AiRequest,
  options: SendOptions = {},
): Promise<BetaMessage> {
  const usingSavedKey = options.apiKey === undefined;
  const [apiKey, model] = await Promise.all([
    usingSavedKey ? readApiKey() : cleanKey(options.apiKey),
    getSelectedModel(),
  ]);
  if (apiKey === "") throw new AiError("no-key");

  const params = buildParams(model, request);
  let receivedText = false;
  const onText = options.onText
    ? (delta: string, snapshot: string) => {
        receivedText = true;
        options.onText?.(delta, snapshot);
      }
    : undefined;

  let response: BetaMessage;
  try {
    response = await getAiTransport().send(params, { apiKey, signal: options.signal, onText });
  } catch (thrown) {
    let error = toAiError(thrown);
    if (receivedText && (error.kind === "network" || error.kind === "unknown")) {
      error = new AiError("stream-dropped", { cause: thrown });
    }
    if (usingSavedKey && error.blocksAi) await rememberError(error);
    throw error;
  }

  await recordUsage({
    feature: request.feature,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  });
  if (usingSavedKey) await clearLastError();
  return response;
}

export type KeyTestResult = { ok: true } | { ok: false; error: AiError };

/**
 * Sends a tiny request to check a key works with the chosen model. Tests the saved key, or
 * `candidate` when given (which is not saved).
 */
export async function testApiKey(candidate?: string): Promise<KeyTestResult> {
  try {
    await sendMessage(
      {
        feature: "key-test",
        messages: [{ role: "user", content: "Reply with the single word OK." }],
        maxTokens: 16,
        effort: "low",
        noThinking: true,
      },
      candidate === undefined ? {} : { apiKey: candidate },
    );
    return { ok: true };
  } catch (thrown) {
    return { ok: false, error: toAiError(thrown) };
  }
}
