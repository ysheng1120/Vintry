import { describe, expect, it } from "vitest";
import type { ImportDraft, WineDraft } from "../../domain/commands/schemas";
import type { Lot, Wine } from "../../domain/types";
import {
  draftsToImport,
  findDuplicateRowIndexes,
  isLikelyDuplicate,
  leftOutRowIndexes,
  planImportRows,
  rowPlanLabel,
  shouldImportRow,
  type ExistingCellar,
} from "./duplicates";
import type { ImportRow } from "./rows";

function wine(overrides: Partial<Wine> = {}): Wine {
  const t = "2024-01-01T00:00:00.000Z";
  return {
    id: "wine-1",
    createdAt: t,
    updatedAt: t,
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    colour: "red",
    country: null,
    region: null,
    appellation: null,
    grapes: [],
    bottleSize: 750,
    windowFrom: null,
    windowTo: null,
    windowSource: null,
    windowNote: null,
    thumbnail: null,
    rating: null,
    tags: [],
    notes: null,
    valuePerBottle: null,
    valueCurrency: null,
    valueUpdatedAt: null,
    deletedAt: null,
    isSample: false,
    ...overrides,
  };
}

function lot(overrides: Partial<Lot> & { wineId: string }): Lot {
  const t = "2024-01-01T00:00:00.000Z";
  return {
    id: "lot-1",
    createdAt: t,
    updatedAt: t,
    locationId: null,
    bin: null,
    quantity: 6,
    closedAt: null,
    splitFromLotId: null,
    purchaseDate: null,
    pricePerBottle: null,
    currency: null,
    store: null,
    isSample: false,
    ...overrides,
  };
}

function draft(overrides: Partial<ImportDraft> = {}): ImportDraft {
  return {
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    colour: "red",
    lots: [{ quantity: 6, locationId: null, purchaseDate: "2024-03-01", pricePerBottle: 250 }],
    ...overrides,
  };
}

function cellar(overrides: Partial<ExistingCellar> = {}): ExistingCellar {
  return {
    wines: [wine()],
    lots: [lot({ wineId: "wine-1", quantity: 6, purchaseDate: "2024-03-01", pricePerBottle: 250 })],
    locations: [],
    ...overrides,
  };
}

describe("isLikelyDuplicate", () => {
  it("is true for an exact match: same wine, quantity, date and price", () => {
    expect(isLikelyDuplicate(draft(), cellar())).toBe(true);
  });

  it("is false when the price per bottle differs", () => {
    const d = draft({ lots: [{ quantity: 6, purchaseDate: "2024-03-01", pricePerBottle: 99 }] });
    expect(isLikelyDuplicate(d, cellar())).toBe(false);
  });

  it("is false when the purchase date differs", () => {
    const d = draft({ lots: [{ quantity: 6, purchaseDate: "2024-04-01", pricePerBottle: 250 }] });
    expect(isLikelyDuplicate(d, cellar())).toBe(false);
  });

  it("is false when the quantity differs", () => {
    const d = draft({ lots: [{ quantity: 3, purchaseDate: "2024-03-01", pricePerBottle: 250 }] });
    expect(isLikelyDuplicate(d, cellar())).toBe(false);
  });

  it("is false when the wine itself doesn't match (different vintage)", () => {
    expect(isLikelyDuplicate(draft({ vintage: 2020 }), cellar())).toBe(false);
  });

  it("treats a blank purchase date and price as matching a lot with none", () => {
    const c = cellar({
      lots: [lot({ wineId: "wine-1", quantity: 6, purchaseDate: null, pricePerBottle: null })],
    });
    const d = draft({ lots: [{ quantity: 6, purchaseDate: null, pricePerBottle: null }] });
    expect(isLikelyDuplicate(d, c)).toBe(true);
  });

  it("matches on a closed lot (quantity 0 or not, closedAt set) just as it would an open one", () => {
    const c = cellar({
      lots: [
        lot({
          wineId: "wine-1",
          quantity: 6,
          purchaseDate: "2024-03-01",
          pricePerBottle: 250,
          closedAt: "2024-06-01",
        }),
      ],
    });
    expect(isLikelyDuplicate(draft(), c)).toBe(true);
  });

  it("matches by location name, not id: two ids naming the same location still match", () => {
    const c = cellar({
      lots: [
        lot({
          wineId: "wine-1",
          quantity: 6,
          purchaseDate: "2024-03-01",
          pricePerBottle: 250,
          locationId: "old-id",
        }),
      ],
      locations: [
        { id: "old-id", name: "Kitchen rack" },
        { id: "new-id", name: "Kitchen rack" },
      ],
    });
    const d = draft({
      lots: [
        { quantity: 6, purchaseDate: "2024-03-01", pricePerBottle: 250, locationId: "new-id" },
      ],
    });
    expect(isLikelyDuplicate(d, c)).toBe(true);
  });

  it("is false when the location name differs", () => {
    const c = cellar({
      lots: [
        lot({
          wineId: "wine-1",
          quantity: 6,
          purchaseDate: "2024-03-01",
          pricePerBottle: 250,
          locationId: "cellar-id",
        }),
      ],
      locations: [{ id: "cellar-id", name: "Cellar" }],
    });
    expect(isLikelyDuplicate(draft(), c)).toBe(false);
  });

  it("ignores a sample wine even when it otherwise matches", () => {
    const c = cellar({ wines: [wine({ isSample: true })] });
    expect(isLikelyDuplicate(draft(), c)).toBe(false);
  });

  it("ignores a deleted wine even when it otherwise matches", () => {
    const c = cellar({ wines: [wine({ deletedAt: "2024-01-01" })] });
    expect(isLikelyDuplicate(draft(), c)).toBe(false);
  });

  it("is false for a row with no lots", () => {
    expect(isLikelyDuplicate(draft({ lots: [] }), cellar())).toBe(false);
  });
});

describe("findDuplicateRowIndexes", () => {
  function row(rowIndex: number, d: WineDraft | null): ImportRow {
    return { rowIndex, draft: d, issues: [] };
  }

  it("flags only the rows that match, keeping the rest out", () => {
    const rows = [row(0, draft()), row(1, draft({ producer: "Someone Else" })), row(2, null)];
    expect(findDuplicateRowIndexes(rows, cellar())).toEqual(new Set([0]));
  });
});

describe("shouldImportRow", () => {
  const row: ImportRow = { rowIndex: 0, draft: draft(), issues: [] };
  const skipped: ImportRow = { rowIndex: 1, draft: null, issues: [] };

  it("keeps a non-duplicate row", () => {
    expect(shouldImportRow(row, new Set(), new Set())).toBe(true);
  });

  it("leaves out a duplicate row by default", () => {
    expect(shouldImportRow(row, new Set([0]), new Set())).toBe(false);
  });

  it("includes a duplicate row the collector chose to include", () => {
    expect(shouldImportRow(row, new Set([0]), new Set([0]))).toBe(true);
  });

  it("never keeps a skipped row (no draft), duplicate or not", () => {
    expect(shouldImportRow(skipped, new Set(), new Set([1]))).toBe(false);
  });
});

describe("planImportRows", () => {
  function row(rowIndex: number, d: ImportDraft | null): ImportRow {
    return { rowIndex, draft: d, issues: [] };
  }
  const ct = { compareCounts: true };
  const kitchen = { id: "kitchen", name: "Kitchen rack" };

  /** Vintry has `quantity` open bottles of Ridge Monte Bello 2019 in the kitchen rack, bin A1. */
  function cellarWith(quantity: number, wineOverrides: Partial<Wine> = {}): ExistingCellar {
    return {
      wines: [wine(wineOverrides)],
      lots: [lot({ wineId: "wine-1", quantity, locationId: "kitchen", bin: "A1" })],
      locations: [kitchen],
    };
  }

  function ctRow(quantity: number, overrides: Partial<ImportDraft> = {}): ImportDraft {
    return draft({
      cellarTrackerId: "100001",
      lots: [{ quantity, locationId: "kitchen", bin: "a1", pricePerBottle: 250 }],
      ...overrides,
    });
  }

  it("tops up: 6 in the file against 5 in the cellar adds only 1", () => {
    const plans = planImportRows([row(0, ctRow(6))], cellarWith(5), ct);
    expect(plans.get(0)).toEqual({ kind: "topUp", add: 1, have: 5 });
    expect(rowPlanLabel(plans.get(0))).toBe("Adds 1 (5 already in your cellar)");
    const [only] = draftsToImport([row(0, ctRow(6))], plans, new Set());
    expect(only?.draft.lots?.[0]).toMatchObject({ quantity: 1, locationId: "kitchen" });
  });

  it("leaves out a row whose count matches, even when its price or date differ", () => {
    const plans = planImportRows([row(0, ctRow(6))], cellarWith(6), ct);
    expect(plans.get(0)).toEqual({ kind: "already" });
    expect(rowPlanLabel(plans.get(0))).toBe("Already in your cellar");
    expect(draftsToImport([row(0, ctRow(6))], plans, new Set())).toEqual([]);
  });

  it("changes nothing when the file has fewer bottles than the cellar", () => {
    const plans = planImportRows([row(0, ctRow(4))], cellarWith(6), ct);
    expect(plans.get(0)).toEqual({ kind: "fewer", have: 6, file: 4 });
    expect(rowPlanLabel(plans.get(0))).toBe(
      "Vintry has 6, the file has 4: record drinks in Vintry",
    );
    expect(leftOutRowIndexes(plans)).toEqual(new Set([0]));
    expect(draftsToImport([row(0, ctRow(4))], plans, new Set())).toEqual([]);
  });

  it("matches by CellarTracker id after the wine's name was edited in Vintry", () => {
    const c = cellarWith(5, { name: "Monte Bello Estate", cellarTrackerId: "100001" });
    expect(planImportRows([row(0, ctRow(6))], c, ct).get(0)).toEqual({
      kind: "topUp",
      add: 1,
      have: 5,
    });
    // Without the id the edited name no longer matches: the whole row is new.
    const noId = ctRow(6, { cellarTrackerId: undefined });
    expect(planImportRows([row(0, noId)], c, ct).get(0)).toEqual({ kind: "new" });
  });

  it("keeps the exact-duplicate rule for a file that isn't a cellar export (no count compare)", () => {
    const generic = ctRow(6, { cellarTrackerId: undefined });
    // A generic row with a different count is a new purchase: imported in full.
    expect(planImportRows([row(0, generic)], cellarWith(5)).get(0)).toEqual({ kind: "new" });
    expect(planImportRows([row(0, generic)], cellarWith(9)).get(0)).toEqual({ kind: "new" });
    // An exact match (same count, price, date and location) is still left out.
    const exact: ExistingCellar = {
      ...cellarWith(6),
      lots: [lot({ wineId: "wine-1", quantity: 6, locationId: "kitchen", pricePerBottle: 250 })],
    };
    expect(planImportRows([row(0, generic)], exact).get(0)).toEqual({ kind: "already" });
  });

  it("uses the exact-duplicate rule for a CellarTracker row where the wine has no open bottles", () => {
    const c: ExistingCellar = {
      wines: [wine()],
      lots: [lot({ wineId: "wine-1", quantity: 5, locationId: null, pricePerBottle: 250 })],
      locations: [kitchen],
    };
    // The wine's bottles are elsewhere (No location), so the kitchen row is new.
    expect(planImportRows([row(0, ctRow(6))], c, ct).get(0)).toEqual({ kind: "new" });
  });

  it("never matches a row that goes to a location Vintry doesn't have yet", () => {
    const toNewRack = ctRow(6, { lots: [{ quantity: 6, locationId: "tmp-rack", bin: "A1" }] });
    const c: ExistingCellar = {
      wines: [wine()],
      lots: [lot({ wineId: "wine-1", quantity: 6, locationId: null })],
      locations: [kitchen],
    };
    expect(planImportRows([row(0, toNewRack)], c, ct).get(0)).toEqual({ kind: "new" });
    expect(planImportRows([row(0, toNewRack)], c).get(0)).toEqual({ kind: "new" });
  });

  it("compares a place's rows together: bottles already there cover the first rows", () => {
    const rows = [row(0, ctRow(3)), row(1, ctRow(2)), row(2, ctRow(2))];
    const plans = planImportRows(rows, cellarWith(4), ct);
    expect(plans.get(0)).toEqual({ kind: "already" });
    expect(plans.get(1)).toEqual({ kind: "topUp", add: 1, have: 1 });
    expect(plans.get(2)).toEqual({ kind: "new" });
    const sent = draftsToImport(rows, plans, new Set()).map((d) => d.draft.lots?.[0]?.quantity);
    expect(sent).toEqual([1, 2]);
  });

  it("imports the full row when the collector includes it anyway", () => {
    const rows = [row(0, ctRow(6)), row(1, ctRow(4, { vintage: 2020 }))];
    const c: ExistingCellar = {
      wines: [wine(), wine({ id: "wine-2", vintage: 2020 })],
      lots: [
        lot({ id: "l1", wineId: "wine-1", quantity: 5, locationId: "kitchen", bin: "A1" }),
        lot({ id: "l2", wineId: "wine-2", quantity: 6, locationId: "kitchen", bin: "A1" }),
      ],
      locations: [kitchen],
    };
    const plans = planImportRows(rows, c, ct);
    expect(plans.get(0)?.kind).toBe("topUp");
    expect(plans.get(1)?.kind).toBe("fewer");
    const sent = draftsToImport(rows, plans, new Set([0, 1]));
    expect(sent.map((d) => d.draft.lots?.[0]?.quantity)).toEqual([6, 4]);
    expect(sent[0]?.draft).toBe(rows[0]?.draft);
  });
});
