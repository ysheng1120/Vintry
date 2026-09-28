import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  estimateCostUsd,
  formatUsd,
  getModel,
  labelScanCostExample,
  MODELS,
  priceFor,
  resolveModelId,
} from "./models";

describe("model table", () => {
  it("offers Opus 5, Opus 5.5, Sonnet 5, and Haiku 4.5 with Opus 5 as the default", () => {
    expect(MODELS.map((m) => m.id)).toEqual([
      "claude-opus-5",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
    expect(getModel("claude-opus-5-5")?.label).toBe("Newest (Claude Opus 5.5)");
    expect(DEFAULT_MODEL_ID).toBe("claude-opus-5");
    expect(getModel("claude-opus-5")?.label).toBe("Best (Claude Opus 5)");
    expect(getModel("claude-sonnet-5")?.label).toBe("Balanced (Claude Sonnet 5)");
    expect(getModel("claude-haiku-4-5")?.label).toBe("Economy (Claude Haiku 4.5)");
  });

  it("uses adaptive thinking and effort on Opus 5 and Sonnet 5 but not on Haiku 4.5", () => {
    expect(getModel("claude-opus-5")).toMatchObject({ adaptiveThinking: true, effort: true });
    expect(getModel("claude-sonnet-5")).toMatchObject({ adaptiveThinking: true, effort: true });
    expect(getModel("claude-haiku-4-5")).toMatchObject({ adaptiveThinking: false, effort: false });
  });

  it("falls back to the default for a missing or unknown stored model", () => {
    expect(resolveModelId(undefined)).toBe("claude-opus-5");
    expect(resolveModelId("gpt-9")).toBe("claude-opus-5");
    expect(resolveModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
});

describe("pricing", () => {
  it("prices Opus 5.5 at $4 / $20, with cache reads at its own $0.20 rate", () => {
    expect(priceFor("claude-opus-5-5")).toEqual({
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
    });
    expect(
      estimateCostUsd("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1e6 }),
    ).toBe(0.2);
    // Other models keep the tenth-of-input cache-read rate.
    expect(
      estimateCostUsd("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1e6 }),
    ).toBe(0.5);
  });

  it("prices 1,000 input and 500 output tokens on Opus 5 at $0.0175", () => {
    expect(estimateCostUsd("claude-opus-5", { inputTokens: 1000, outputTokens: 500 })).toBe(0.0175);
  });

  it("prices each model from its per-million-token rates", () => {
    expect(priceFor("claude-sonnet-5")).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(priceFor("claude-haiku-4-5")).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(estimateCostUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      1,
    );
  });

  it("recognises a dated snapshot of a known model", () => {
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
  });

  it("returns null for an unknown model", () => {
    expect(priceFor("claude-mystery-9")).toBeNull();
    expect(
      estimateCostUsd("claude-mystery-9", { inputTokens: 1000, outputTokens: 500 }),
    ).toBeNull();
  });

  it("prices cache reads at a tenth and cache writes at 1.25 times the input rate", () => {
    const cost = estimateCostUsd("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(cost).toBe(0.5 + 6.25);
  });

  it("estimates one label scan (2,500 in, 400 out) per model for the Settings copy", () => {
    expect(labelScanCostExample("claude-opus-5")).toBe(0.0225);
    expect(labelScanCostExample("claude-sonnet-5")).toBe(0.009);
    expect(labelScanCostExample("claude-haiku-4-5")).toBe(0.0045);
  });

  it("formats small dollar amounts so they never round to zero", () => {
    expect(formatUsd(0.0175)).toBe("$0.018");
    expect(formatUsd(0.0045)).toBe("$0.0045");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
