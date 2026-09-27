import { describe, expect, it } from "vitest";
import type { WineDraft } from "../../domain/commands/schemas";
import type { Lot, Wine } from "../../domain/types";
import {
  findDuplicateRowIndexes,
  isLikelyDuplicate,
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

function draft(overrides: Partial<WineDraft> = {}): WineDraft {
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
