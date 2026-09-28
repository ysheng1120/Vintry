/**
 * The Claude models Vintry offers, with their prices (KTD3). Every cost shown in the UI and
 * every recorded usage row reads from this table, never from fixed text.
 */

export type ModelId = "claude-opus-5" | "claude-opus-5-5" | "claude-sonnet-5" | "claude-haiku-4-5";

export interface ModelPrice {
  /** US dollars per million input tokens. */
  inputPerMTok: number;
  /** US dollars per million output tokens. */
  outputPerMTok: number;
  /**
   * US dollars per million cache-read tokens, when it is not a tenth of the input rate
   * (Claude Opus 5.5 reads cache at $0.20, a twentieth of its $4 input rate).
   */
  cacheReadPerMTok?: number;
}

export interface ModelInfo extends ModelPrice {
  id: ModelId;
  /** Name shown in Settings, e.g. "Best (Claude Opus 5)". */
  label: string;
  /** One line under the label in Settings. */
  description: string;
  /** Requests send `thinking: { type: "adaptive" }`. */
  adaptiveThinking: boolean;
  /**
   * Thinking cannot be turned off (Claude Opus 5.5): `thinking: { type: "disabled" }` is an
   * error, so a request that wants no thinking asks for low effort instead.
   */
  thinkingAlwaysOn?: boolean;
  /** Requests send `output_config.effort`. */
  effort: boolean;
  /** Requests opt into the server-side refusal fallback (`fallbacks: "default"`). */
  refusalFallback: boolean;
}

export const MODELS: readonly ModelInfo[] = [
  {
    id: "claude-opus-5",
    label: "Best (Claude Opus 5)",
    description: "The most capable model. Best for label scans and the sommelier.",
    inputPerMTok: 5,
    outputPerMTok: 25,
    adaptiveThinking: true,
    effort: true,
    refusalFallback: true,
  },
  {
    id: "claude-opus-5-5",
    label: "Newest (Claude Opus 5.5)",
    description: "Newer and cheaper than Opus 5, and as good or better in Anthropic's tests.",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    adaptiveThinking: true,
    thinkingAlwaysOn: true,
    effort: true,
    refusalFallback: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Balanced (Claude Sonnet 5)",
    description: "Nearly as good for most tasks, at less than half the price.",
    inputPerMTok: 2,
    outputPerMTok: 10,
    adaptiveThinking: true,
    effort: true,
    refusalFallback: false,
  },
  {
    id: "claude-haiku-4-5",
    label: "Economy (Claude Haiku 4.5)",
    description: "The cheapest and fastest. Fine for simple tasks.",
    inputPerMTok: 1,
    outputPerMTok: 5,
    adaptiveThinking: false,
    effort: false,
    refusalFallback: false,
  },
];

export const DEFAULT_MODEL_ID: ModelId = "claude-opus-5";

/**
 * Models that are never chosen in Settings but can serve a request: the refusal fallback on
 * Opus 5 can hand a request to Claude Opus 4.8. Usage is priced by the served model.
 */
const SERVED_ONLY_PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
};

/**
 * Cache reads cost a tenth of the input rate unless a model says otherwise; 5-minute cache
 * writes cost 1.25 times it.
 */
const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

/** A typical label scan: a downscaled photo plus instructions in, a short draft out. */
export const LABEL_SCAN_TOKENS = { inputTokens: 2500, outputTokens: 400 } as const;

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === id);
}

/** The model to use for a stored setting value; unknown or missing values give the default. */
export function resolveModelId(stored: unknown): ModelId {
  return typeof stored === "string" && getModel(stored) ? (stored as ModelId) : DEFAULT_MODEL_ID;
}

/** Price per million tokens for a model ID as the API reports it, or null when unknown. */
export function priceFor(modelId: string): ModelPrice | null {
  // The API may report a dated snapshot, e.g. "claude-haiku-4-5-20251001".
  const base = modelId.replace(/-\d{8}$/, "");
  const model = getModel(base);
  if (model) {
    return {
      inputPerMTok: model.inputPerMTok,
      outputPerMTok: model.outputPerMTok,
      ...(model.cacheReadPerMTok !== undefined ? { cacheReadPerMTok: model.cacheReadPerMTok } : {}),
    };
  }
  return SERVED_ONLY_PRICES[base] ?? null;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Rounds away floating-point noise (1e-10 dollars is far below anything shown). */
export function roundUsd(amount: number): number {
  return Math.round(amount * 1e10) / 1e10;
}

/** Estimated cost in US dollars, or null when the model has no known price. */
export function estimateCostUsd(modelId: string, tokens: TokenCounts): number | null {
  const price = priceFor(modelId);
  if (!price) return null;
  const perToken = price.inputPerMTok / 1_000_000;
  const cost =
    tokens.inputTokens * perToken +
    (tokens.cacheReadTokens ?? 0) *
      (price.cacheReadPerMTok !== undefined
        ? price.cacheReadPerMTok / 1_000_000
        : perToken * CACHE_READ_FACTOR) +
    (tokens.cacheWriteTokens ?? 0) * perToken * CACHE_WRITE_FACTOR +
    tokens.outputTokens * (price.outputPerMTok / 1_000_000);
  return roundUsd(cost);
}

/** Estimated cost of one label scan on a model, for UI copy such as "about $0.02 a scan". */
export function labelScanCostExample(modelId: string): number | null {
  return estimateCostUsd(modelId, LABEL_SCAN_TOKENS);
}

/**
 * Formats a US dollar amount. Amounts under ten cents keep two significant digits so a
 * fraction of a cent never shows as $0.00.
 */
export function formatUsd(amount: number, locale?: string): string {
  const small = amount > 0 && amount < 0.1;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    ...(small ? { maximumSignificantDigits: 2 } : {}),
  }).format(amount);
}
