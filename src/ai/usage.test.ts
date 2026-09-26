import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db";
import { resetDatabase } from "../db/testing";
import { setClock } from "../domain/clock";
import { listUsage, recordUsage, summarizeUsage } from "./usage";

beforeEach(resetDatabase);

describe("recordUsage", () => {
  it("stores tokens and the estimated cost for 1,000 in / 500 out on Opus 5 as $0.0175", async () => {
    const row = await recordUsage({
      feature: "scan",
      model: "claude-opus-5",
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(row.costUsd).toBe(0.0175);
    const [stored] = await db.aiUsage.toArray();
    expect(stored).toMatchObject({
      feature: "scan",
      model: "claude-opus-5",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      costUsd: 0.0175,
    });
  });

  it("stores a null cost for an unknown model", async () => {
    const row = await recordUsage({
      feature: "chat",
      model: "claude-unknown",
      inputTokens: 10,
      outputTokens: 10,
    });
    expect(row.costUsd).toBeNull();
  });
});

describe("summarizeUsage", () => {
  it("totals this month and all time, per feature, and counts unpriced requests", async () => {
    setClock("2026-08-15T12:00:00Z");
    await recordUsage({
      feature: "scan",
      model: "claude-opus-5",
      inputTokens: 1000,
      outputTokens: 500,
    });
    setClock("2026-09-10T12:00:00Z");
    await recordUsage({
      feature: "scan",
      model: "claude-opus-5",
      inputTokens: 1000,
      outputTokens: 500,
    });
    await recordUsage({
      feature: "chat",
      model: "claude-unknown",
      inputTokens: 200,
      outputTokens: 100,
    });

    const summary = summarizeUsage(await listUsage(), new Date("2026-09-20T12:00:00Z"));

    expect(summary.allTime).toMatchObject({
      requests: 3,
      inputTokens: 2200,
      outputTokens: 1100,
      costUsd: 0.035,
      unpricedRequests: 1,
    });
    expect(summary.thisMonth).toMatchObject({ requests: 2, costUsd: 0.0175, unpricedRequests: 1 });
    expect(summary.thisMonth.byFeature).toEqual([
      expect.objectContaining({
        feature: "scan",
        label: "Label scan",
        requests: 1,
        costUsd: 0.0175,
      }),
      expect.objectContaining({ feature: "chat", label: "Sommelier", requests: 1, costUsd: 0 }),
    ]);
  });

  it("is all zeros with no usage", () => {
    const summary = summarizeUsage([], new Date());
    expect(summary.allTime).toMatchObject({ requests: 0, costUsd: 0, byFeature: [] });
  });
});
