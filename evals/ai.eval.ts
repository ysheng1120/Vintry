/**
 * Live AI eval (Verification Contract "Live AI eval", U8/U9/U12). Manual, needs a real
 * ANTHROPIC_API_KEY, so it is skipped whenever one is not set (and always skipped under
 * `npm test` / CI, which never set one). Run with:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npm run eval:ai
 *
 * Each case asserts observable outcomes of a real model response, so they are inherently a
 * little fuzzy; keep assertions loose enough to tolerate reasonable phrasing while still
 * checking the behavior the feature promises.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/db";
import { resetDatabase } from "../src/db/testing";
import { saveApiKey, setSelectedModel } from "../src/ai/client";
import type { ModelId } from "../src/ai/models";
import { describeBottles } from "../src/ai/features/describe";
import { suggestCsvMapping } from "../src/ai/features/mapCsv";
import { addBottles, loadSampleCellar } from "../src/domain/commands";
import { askInNewThread } from "../src/ai/sommelier/loop";
import { isReadTool } from "../src/ai/sommelier/readTools";
import { listMessages } from "../src/ai/sommelier/thread";
import { listUsage, summarizeUsage } from "../src/ai/usage";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const TIMEOUT = 90_000;

/** Joins the text blocks of a stored message's content (see ChatMessageSchema). */
function textOf(content: string | Record<string, unknown>[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

async function withKey(): Promise<void> {
  await saveApiKey(API_KEY ?? "");
  const model = process.env.VINTRY_EVAL_MODEL;
  if (model) await setSelectedModel(model as ModelId);
}

describe.skipIf(!API_KEY)("Live AI eval", () => {
  beforeAll(async () => {
    await resetDatabase();
    await withKey();
  });

  afterAll(async () => {
    const summary = summarizeUsage(await listUsage());
    const { requests, costUsd, unpricedRequests } = summary.allTime;
    const priced = unpricedRequests > 0 ? ` (${unpricedRequests} unpriced)` : "";
    console.log(
      `\nLive AI eval: ${requests} request(s), total cost $${costUsd.toFixed(4)}${priced}\n`,
    );
  });

  it(
    "describeBottles: bought bottles with a per-bottle USD price",
    async () => {
      const drafts = await describeBottles(
        "bought 6 bottles of 2019 Ridge Monte Bello for $250 each from K&L",
      );

      expect(drafts).toHaveLength(1);
      const draft = drafts[0]!;
      expect(draft.producer ?? "").toMatch(/Ridge/i);
      expect(draft.vintage).toBe(2019);
      expect(draft.lots).toHaveLength(1);
      const lot = draft.lots[0]!;
      expect(lot.quantity).toBe(6);
      expect(lot.pricePerBottle).toBe(250);
      expect((lot.currency ?? "").toUpperCase()).toBe("USD");
    },
    TIMEOUT,
  );

  it(
    "describeBottles: a case of wine with a total GBP price",
    async () => {
      const drafts = await describeBottles("a case of 2016 Barolo for £600");

      expect(drafts.length).toBeGreaterThanOrEqual(1);
      const draft = drafts[0]!;
      expect(draft.vintage).toBe(2016);
      expect(draft.lots).toHaveLength(1);
      const lot = draft.lots[0]!;
      expect(lot.quantity).toBe(12);
      expect((draft.notes ?? []).some((note) => /case/i.test(note))).toBe(true);

      // The £600 is for the whole case: either kept as a total, or already divided per bottle.
      const totalAsStated = draft.priceBasis === "total" && lot.totalPrice === 600;
      const dividedPerBottle =
        lot.pricePerBottle != null && Math.round(lot.pricePerBottle * 12) === 600;
      expect(totalAsStated || dividedPerBottle).toBe(true);
      expect((lot.currency ?? "").toUpperCase()).toBe("GBP");
    },
    TIMEOUT,
  );

  it(
    "sommelier recommends a wine for roast lamb from the sample cellar",
    async () => {
      await loadSampleCellar();

      const { threadId, done } = await askInNewThread(
        "What should I open tonight with roast lamb?",
        {},
      );
      await done;

      const rows = await listMessages(threadId);
      const toolRecords = rows.flatMap((row) => row.meta.tools ?? []);
      expect(toolRecords.some((record) => isReadTool(record.name))).toBe(true);

      const shownIds = new Set(toolRecords.flatMap((record) => record.wineIds));
      expect(shownIds.size).toBeGreaterThan(0);
      for (const wineId of shownIds) {
        const wine = await db.wines.get(wineId);
        expect(wine, `recommended wine ${wineId} should exist`).toBeDefined();
        const lots = await db.lots.where("wineId").equals(wineId).toArray();
        const bottleCount = lots.reduce((sum, lot) => sum + lot.quantity, 0);
        expect(bottleCount, `recommended wine ${wineId} should have bottles left`).toBeGreaterThan(
          0,
        );
      }
    },
    TIMEOUT,
  );

  it(
    "AE3: an ambiguous wine reference asks which vintage instead of guessing",
    async () => {
      await resetDatabase();
      await withKey();
      await addBottles({
        drafts: [
          {
            producer: "Ridge",
            name: "Monte Bello",
            vintage: 2016,
            colour: "red",
            lots: [{ quantity: 2 }],
          },
        ],
      });
      await addBottles({
        drafts: [
          {
            producer: "Ridge",
            name: "Monte Bello",
            vintage: 2019,
            colour: "red",
            lots: [{ quantity: 2 }],
          },
        ],
      });
      const batchesBefore = await db.eventBatches.count();

      const { threadId, done } = await askInNewThread("I drank the Monte Bello last night", {});
      await done;

      const rows = await listMessages(threadId);
      const toolRecords = rows.flatMap((row) => row.meta.tools ?? []);
      expect(toolRecords.every((record) => record.proposal?.status !== "applied")).toBe(true);
      expect(await db.eventBatches.count()).toBe(batchesBefore);

      const lastAssistant = rows.findLast((row) => row.meta.kind === "assistant");
      expect(textOf(lastAssistant?.content ?? "")).toMatch(/2016|2019|which/i);
    },
    TIMEOUT,
  );

  it(
    "suggestCsvMapping maps a German-language export",
    async () => {
      const headers = ["Weingut", "Wein", "Jahrgang", "Anzahl", "Preis"];
      const sampleRows = [
        ["Ridge", "Monte Bello", "2019", "6", "250"],
        ["Chateau Musar", "", "2015", "3", "45"],
        ["Domaine Leflaive", "Puligny-Montrachet", "2018", "2", "90"],
      ];

      const { mapping } = await suggestCsvMapping(headers, sampleRows);

      expect(mapping.producer).toBe("Weingut");
      expect(mapping.vintage).toBe("Jahrgang");
    },
    TIMEOUT,
  );
});
