import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { setDrinkingWindow, updateWine } from "../../domain/commands";
import type { Lot, Wine } from "../../domain/types";
import { applyProposal, prepareProposal, type CardDraft, type Prepared } from "./proposals";
import type { Proposal } from "./thread";

let cellar: ReturnType<typeof makeLocation>;

beforeEach(async () => {
  await resetDatabase();
  cellar = makeLocation({ name: "Cellar" });
  await db.locations.add(cellar);
});

async function addWine(
  overrides: Partial<Wine> = {},
  quantity = 6,
): Promise<{ wine: Wine; lot: Lot }> {
  const wine = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019, ...overrides });
  const lot = makeLot({ wineId: wine.id, quantity, locationId: cellar.id, bin: "A3" });
  await db.wines.add(wine);
  await db.lots.add(lot);
  return { wine, lot };
}

function cardOf(prepared: Prepared): CardDraft {
  if (prepared.kind !== "card") throw new Error(`Expected a card, got ${prepared.result.content}`);
  return prepared.card;
}

function refusal(prepared: Prepared): string {
  if (prepared.kind !== "result") throw new Error(`Expected a result, got a card`);
  expect(prepared.result.isError).toBe(true);
  return prepared.result.content;
}

/** The card as the chat stores it while it waits for the collector. */
function pending(card: CardDraft): Proposal {
  return { ...card, status: "pending", sessionId: "test", outcome: null, batchId: null };
}

describe("propose_adjust_quantity", () => {
  it("shows the count now and after as a correction, and applies it on confirm", async () => {
    const { wine, lot } = await addWine({}, 6);

    const card = cardOf(
      await prepareProposal("propose_adjust_quantity", { lotId: lot.id, quantity: 4 }),
    );

    expect(card).toMatchObject({
      kind: "adjust",
      command: "adjustQuantity",
      title: "Correct the count of Ridge Monte Bello 2019",
      lines: ["At Cellar, bin A3: 6 now, 4 after", "A correction, not recorded as drinking"],
      wineId: wine.id,
      input: { lotId: lot.id, quantity: 4, expectedQuantity: 6 },
    });
    const outcome = await applyProposal(pending(card));
    expect(outcome.status).toBe("applied");
    expect((await db.lots.get(lot.id))?.quantity).toBe(4);
    expect(await db.consumptions.count()).toBe(0);
  });

  it("refuses a count the lot already holds", async () => {
    const { lot } = await addWine({}, 3);
    const message = refusal(
      await prepareProposal("propose_adjust_quantity", { lotId: lot.id, quantity: 3 }),
    );
    expect(message).toBe("That lot already holds 3 bottles. Nothing was changed.");
  });
});

describe("propose_update_wine", () => {
  it("lists only the fields that change, old to new", async () => {
    const { wine } = await addWine({
      region: "Santa Cruz Mountains",
      grapes: ["Cabernet Sauvignon"],
    });

    const card = cardOf(
      await prepareProposal("propose_update_wine", {
        wineId: wine.id,
        patch: {
          region: "Santa Cruz Mountains",
          appellation: "Santa Cruz Mountains AVA",
          grapes: ["Cabernet Sauvignon", "Merlot"],
        },
      }),
    );

    expect(card).toMatchObject({
      kind: "update-wine",
      command: "updateWine",
      title: "Edit Ridge Monte Bello 2019",
      wineId: wine.id,
      input: {
        wineId: wine.id,
        patch: {
          appellation: "Santa Cruz Mountains AVA",
          grapes: ["Cabernet Sauvignon", "Merlot"],
        },
      },
      lines: [
        "Appellation: none → Santa Cruz Mountains AVA",
        "Grapes: Cabernet Sauvignon → Cabernet Sauvignon, Merlot",
      ],
    });
  });

  it("refuses a patch that would change nothing", async () => {
    const { wine } = await addWine({ region: "Santa Cruz Mountains" });
    const message = refusal(
      await prepareProposal("propose_update_wine", {
        wineId: wine.id,
        patch: { region: "Santa Cruz Mountains", vintage: 2019 },
      }),
    );
    expect(message).toBe("That would change nothing. Nothing was changed.");
  });

  it("goes stale when the collector edits the wine before confirming", async () => {
    const { wine } = await addWine();
    const card = cardOf(
      await prepareProposal("propose_update_wine", {
        wineId: wine.id,
        patch: { region: "Sonoma" },
      }),
    );
    await updateWine({ wineId: wine.id, patch: { region: "Santa Cruz Mountains", notes: "Mine" } });

    const outcome = await applyProposal(pending(card));

    expect(outcome.status).toBe("stale");
    expect(outcome.toolResult.content).toMatch(/changed since/);
    expect(await db.wines.get(wine.id)).toMatchObject({
      region: "Santa Cruz Mountains",
      notes: "Mine",
    });
  });

  it("applies when the wine is unchanged since the card was made", async () => {
    const { wine } = await addWine();
    const card = cardOf(
      await prepareProposal("propose_update_wine", {
        wineId: wine.id,
        patch: { region: "Sonoma" },
      }),
    );
    const outcome = await applyProposal(pending(card));
    expect(outcome.status).toBe("applied");
    expect((await db.wines.get(wine.id))?.region).toBe("Sonoma");
  });
});

describe("propose_set_drinking_window", () => {
  it("shows the window change, the AI mark and the reason", async () => {
    const { wine } = await addWine();

    const card = cardOf(
      await prepareProposal("propose_set_drinking_window", {
        wineId: wine.id,
        from: 2027,
        to: 2045,
        source: "ai",
        note: "Needs time",
      }),
    );

    expect(card).toMatchObject({
      kind: "set-window",
      command: "setDrinkingWindow",
      title: "Set the drinking window for Ridge Monte Bello 2019",
      wineId: wine.id,
      lines: ["Drinking window: none → 2027–2045", "Marked as an AI estimate", "Why: Needs time"],
    });
    expect(card.input).toMatchObject({ wineId: wine.id, from: 2027, to: 2045, overwrite: false });
  });

  it("refuses a window that ends before it starts", async () => {
    const { wine } = await addWine();
    const message = refusal(
      await prepareProposal("propose_set_drinking_window", {
        wineId: wine.id,
        from: 2040,
        to: 2030,
        source: "ai",
      }),
    );
    expect(message).toBe("The window ends before it starts. Nothing was changed.");
  });

  it("warns when it replaces the collector's own window, and replaces it on confirm", async () => {
    const { wine } = await addWine({ windowFrom: 2025, windowTo: 2030, windowSource: "user" });

    const card = cardOf(
      await prepareProposal("propose_set_drinking_window", {
        wineId: wine.id,
        from: 2028,
        to: 2040,
        source: "ai",
      }),
    );

    expect(card.lines).toEqual([
      "Drinking window: 2025–2030 → 2028–2040",
      "Marked as an AI estimate",
      "Replaces the window you set yourself",
    ]);
    expect(card.input).toMatchObject({ overwrite: true });
    const outcome = await applyProposal(pending(card));
    expect(outcome.status).toBe("applied");
    expect(await db.wines.get(wine.id)).toMatchObject({
      windowFrom: 2028,
      windowTo: 2040,
      windowSource: "ai",
    });
  });

  it("goes stale, keeping the collector's window, when they set one before confirming", async () => {
    const { wine } = await addWine();
    const card = cardOf(
      await prepareProposal("propose_set_drinking_window", {
        wineId: wine.id,
        from: 2028,
        to: 2040,
        source: "ai",
      }),
    );
    expect(card.lines).not.toContain("Replaces the window you set yourself");
    await setDrinkingWindow({ wineId: wine.id, from: 2025, to: 2026, source: "user" });

    const outcome = await applyProposal(pending(card));

    expect(outcome.status).toBe("stale");
    expect(await db.wines.get(wine.id)).toMatchObject({
      windowFrom: 2025,
      windowTo: 2026,
      windowSource: "user",
    });
  });

  it("still refuses to replace a window set later when the card has no recorded version", async () => {
    const { wine } = await addWine();
    const card = cardOf(
      await prepareProposal("propose_set_drinking_window", {
        wineId: wine.id,
        from: 2028,
        to: 2040,
        source: "ai",
      }),
    );
    await setDrinkingWindow({ wineId: wine.id, from: 2025, to: 2026, source: "user" });
    // A card stored before cards recorded the wine's version: the command guard still holds.
    const older = pending(card);
    delete older.expectedUpdatedAt;

    const outcome = await applyProposal(older);

    expect(outcome.status).toBe("failed");
    expect((await db.wines.get(wine.id))?.windowSource).toBe("user");
  });
});
