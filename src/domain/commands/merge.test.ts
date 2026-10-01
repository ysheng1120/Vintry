import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeWine, resetDatabase } from "../../db/testing";
import type { WinePriceCheck } from "../types";
import { undoBatch } from "../undo";
import { CommandError } from "./core";
import { consumeBottles } from "./consumption";
import { mergeWines } from "./merge";
import { addTastingNote } from "./notes";
import { addBottles } from "./wines";

const ridge = {
  producer: "Ridge",
  name: "Monte Bello",
  vintage: 2019,
  colour: "red" as const,
};

/** A stored price check; `found: false` is the "No current prices found" result. */
function makePriceCheck(found: boolean): WinePriceCheck {
  return {
    checkedFor: { producer: "Ridge", name: "Monte Bello", vintage: 2019, bottleSize: 750 },
    ranges: found
      ? [{ currency: "GBP", low: 180, middle: 195, high: 210, count: 3, usable: true }]
      : [],
    listings: [],
    found,
    generatedAt: found ? "2026-10-01T12:00:00.000Z" : "2026-09-30T12:00:00.000Z",
    model: "claude-opus-5",
  };
}

/** Two wines describing the same bottle: `keep` (with a lot) and `merge` (a lot, a note, a drink). */
async function seedDuplicates() {
  await addBottles({
    drafts: [{ ...ridge, lots: [{ quantity: 2, pricePerBottle: 200, currency: "USD" }] }],
  });
  const keep = (await db.wines.toArray())[0]!;

  await addBottles({
    drafts: [
      {
        ...ridge,
        // A second, near-identical wine record for the same bottle (an import duplicate that
        // didn't auto-match because the cuvée was typed differently).
        name: "Monte Bello Estate",
        country: "USA",
        region: "Santa Cruz Mountains",
        notes: "From the cellar sale",
        lots: [{ quantity: 3 }],
      },
    ],
  });
  const merge = (await db.wines.filter((w) => w.id !== keep.id).first())!;
  const mergeLot = (await db.lots.where("wineId").equals(merge.id).first())!;
  await consumeBottles({ lotId: mergeLot.id, quantity: 1 });
  await addTastingNote({ wineId: merge.id, text: "Cassis, graphite", date: "2026-08-01" });

  return { keep, merge };
}

describe("mergeWines", () => {
  beforeEach(resetDatabase);

  it("moves lots, drinks and notes to the kept wine, fills empty fields and deletes the merged wine in one batch", async () => {
    const { keep, merge } = await seedDuplicates();
    const batchesBefore = await db.eventBatches.count();

    const result = await mergeWines({ keepId: keep.id, mergeId: merge.id });

    // Bottles, the drink and the note all now belong to the kept wine.
    expect(await db.lots.where("wineId").equals(merge.id).count()).toBe(0);
    const lots = await db.lots.where("wineId").equals(keep.id).toArray();
    expect(lots).toHaveLength(2);
    const consumptions = await db.consumptions.where("wineId").equals(keep.id).toArray();
    expect(consumptions).toHaveLength(1);
    const notes = await db.tastingNotes.where("wineId").equals(keep.id).toArray();
    expect(notes).toHaveLength(1);

    // Empty fields on the kept wine were filled from the merged one.
    const stored = await db.wines.get(keep.id);
    expect(stored).toMatchObject({
      country: "USA",
      region: "Santa Cruz Mountains",
      notes: "From the cellar sale",
    });

    // The merged wine is soft-deleted, the same way deleteWine works.
    expect((await db.wines.get(merge.id))?.deletedAt).toBeTruthy();

    expect(result.summary).toBe("Merged 2 wines: Ridge Monte Bello 2019");
    expect(result.batchId).toBeTruthy();
    expect(await db.eventBatches.count()).toBe(batchesBefore + 1);
  });

  it("never overwrites a field the kept wine already has", async () => {
    const { keep, merge } = await seedDuplicates();
    await db.wines.update(keep.id, { region: "Elsewhere" });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.region).toBe("Elsewhere");
  });

  it("keeps the duplicate's AI profile when the kept wine has none", async () => {
    const { keep, merge } = await seedDuplicates();
    const profile = {
      summary: "A classic.",
      tasting: "Cassis.",
      pairings: ["Lamb"],
      serving: "Decant.",
      generatedAt: "2026-09-27T00:00:00.000Z",
      model: "claude-opus-5",
    };
    await db.wines.update(merge.id, { profile });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.profile).toEqual(profile);
  });

  it("keeps the duplicate's critics' summary when the kept wine has none", async () => {
    const { keep, merge } = await seedDuplicates();
    const critics = {
      consensus: "Critics like it.",
      points: [{ text: "Fresh", sources: [{ url: "https://www.decanter.com/x", title: "D" }] }],
      scores: [],
      found: true,
      generatedAt: "2026-09-27T00:00:00.000Z",
      model: "claude-opus-5",
    };
    await db.wines.update(merge.id, { critics });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.critics).toEqual(critics);
  });

  it("keeps the merged wine's real critics when the kept wine has a found: false result", async () => {
    const { keep, merge } = await seedDuplicates();
    const notFound = {
      consensus: "",
      points: [],
      scores: [],
      found: false,
      generatedAt: "2026-09-20T00:00:00.000Z",
      model: "claude-opus-5",
    };
    const real = {
      consensus: "Critics like it.",
      points: [{ text: "Fresh", sources: [{ url: "https://www.decanter.com/x", title: "D" }] }],
      scores: [],
      found: true,
      generatedAt: "2026-09-27T00:00:00.000Z",
      model: "claude-opus-5",
    };
    await db.wines.update(keep.id, { critics: notFound });
    await db.wines.update(merge.id, { critics: real });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.critics).toEqual(real);
  });

  it("keeps the kept wine's real critics over a merged found: false result", async () => {
    const { keep, merge } = await seedDuplicates();
    const base = { points: [], scores: [], model: "m" };
    const real = { ...base, consensus: "Good.", found: true, generatedAt: "2026-09-27T00:00:00Z" };
    const none = { ...base, consensus: "", found: false, generatedAt: "2026-09-28T00:00:00Z" };
    await db.wines.update(keep.id, { critics: real });
    await db.wines.update(merge.id, { critics: none });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.critics).toEqual(real);
  });

  it("keeps the duplicate's price check when the kept wine has none", async () => {
    const { keep, merge } = await seedDuplicates();
    const priceCheck = makePriceCheck(true);
    await db.wines.update(merge.id, { priceCheck });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.priceCheck).toEqual(priceCheck);
  });

  it("keeps the merged wine's real price check when the kept wine has a found: false result", async () => {
    const { keep, merge } = await seedDuplicates();
    const real = makePriceCheck(true);
    await db.wines.update(keep.id, { priceCheck: makePriceCheck(false) });
    await db.wines.update(merge.id, { priceCheck: real });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.priceCheck).toEqual(real);
  });

  it("keeps the kept wine's real price check over a merged found: false result", async () => {
    const { keep, merge } = await seedDuplicates();
    const real = makePriceCheck(true);
    await db.wines.update(keep.id, { priceCheck: real });
    await db.wines.update(merge.id, { priceCheck: makePriceCheck(false) });

    await mergeWines({ keepId: keep.id, mergeId: merge.id });

    expect((await db.wines.get(keep.id))?.priceCheck).toEqual(real);
  });

  it("undo restores the exact before state: lots, drink and note move back, the kept wine's filled fields clear, and the merged wine is undeleted", async () => {
    const { keep, merge } = await seedDuplicates();
    const before = await db.wines.get(keep.id);

    const result = await mergeWines({ keepId: keep.id, mergeId: merge.id });
    const undone = await undoBatch(result.batchId!);
    expect(undone.ok).toBe(true);

    expect(await db.lots.where("wineId").equals(merge.id).count()).toBe(1);
    expect(await db.lots.where("wineId").equals(keep.id).count()).toBe(1);
    expect(await db.consumptions.where("wineId").equals(merge.id).count()).toBe(1);
    expect(await db.tastingNotes.where("wineId").equals(merge.id).count()).toBe(1);
    expect((await db.wines.get(merge.id))?.deletedAt).toBeNull();
    expect(await db.wines.get(keep.id)).toMatchObject({
      country: before?.country ?? null,
      region: before?.region ?? null,
      notes: before?.notes ?? null,
    });
  });

  it("refuses to merge a wine into itself", async () => {
    const { keep } = await seedDuplicates();
    await expect(mergeWines({ keepId: keep.id, mergeId: keep.id })).rejects.toThrow(
      /different wines/,
    );
  });

  it("refuses a missing or already-deleted wine", async () => {
    const { keep, merge } = await seedDuplicates();
    await expect(mergeWines({ keepId: keep.id, mergeId: "nope" })).rejects.toBeInstanceOf(
      CommandError,
    );
    await mergeWines({ keepId: keep.id, mergeId: merge.id });
    // merge is now deleted; merging it again should fail as not found.
    await expect(mergeWines({ keepId: keep.id, mergeId: merge.id })).rejects.toThrow(
      /no longer exists/,
    );
  });

  it("refuses to merge a sample wine with a real one", async () => {
    const { keep } = await seedDuplicates();
    const sample = makeWine({ ...ridge, isSample: true });
    await db.wines.add(sample);

    await expect(mergeWines({ keepId: keep.id, mergeId: sample.id })).rejects.toThrow(
      /sample data/,
    );
    await expect(mergeWines({ keepId: sample.id, mergeId: keep.id })).rejects.toThrow(
      /sample data/,
    );
  });

  it("writes nothing when the input is invalid", async () => {
    await expect(mergeWines({ keepId: "a", mergeId: "" })).rejects.toBeInstanceOf(CommandError);
    expect(await db.eventBatches.count()).toBe(0);
  });
});
