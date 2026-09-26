import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import {
  convertPriceText,
  defaultLocationId,
  draftFormState,
  NEW_LOCATION,
  parseAmount,
  resolveLotLocation,
  toWineDraft,
  validateDraftForm,
  validateWineValues,
  wineFormValues,
} from "./draft";

beforeEach(resetDatabase);

describe("validateWineValues", () => {
  const valid = wineFormValues({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });

  it("accepts a complete wine", () => {
    expect(validateWineValues(valid, 2026)).toEqual({});
  });

  it("requires a producer", () => {
    expect(validateWineValues({ ...valid, producer: "  " }, 2026).producer).toBe(
      "Producer is required",
    );
  });

  it("accepts vintages up to next year, or NV", () => {
    expect(validateWineValues({ ...valid, vintage: "2027" }, 2026).vintage).toBeUndefined();
    expect(validateWineValues({ ...valid, vintage: "2028" }, 2026).vintage).toMatch(/1800 to 2027/);
    expect(validateWineValues({ ...valid, vintage: "1799" }, 2026).vintage).toBeDefined();
    expect(validateWineValues({ ...valid, vintage: "", nv: true }, 2026).vintage).toBeUndefined();
    expect(validateWineValues({ ...valid, vintage: "" }, 2026).vintage).toBe(
      "Enter a vintage or tick NV",
    );
  });

  it("refuses a window that ends before it starts", () => {
    const errors = validateWineValues({ ...valid, windowFrom: "2030", windowTo: "2028" }, 2026);
    expect(errors.windowTo).toMatch(/not be before/);
  });
});

describe("prices", () => {
  it("parses decimal commas and currency symbols", () => {
    expect(parseAmount("24,50")).toBe(24.5);
    expect(parseAmount("£1,200")).toBe(1200);
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("abc")).toBeNaN();
  });

  it("converts between per bottle and total with the quantity", () => {
    expect(convertPriceText("250", "per-bottle", "total", 6)).toBe("1500");
    expect(convertPriceText("1500", "total", "per-bottle", 6)).toBe("250");
    // From "unclear" the number is kept: the user is saying what it meant.
    expect(convertPriceText("1500", "unclear", "total", 6)).toBe("1500");
  });

  it("saves a total price as a price per bottle", () => {
    const form = draftFormState(
      {
        producer: "Ridge",
        vintage: 2019,
        priceBasis: "total",
        lots: [{ quantity: 6, totalPrice: 1500, currency: "USD" }],
      },
      "GBP",
    );
    const draft = toWineDraft(form, () => null);
    expect(draft.lots?.[0]).toMatchObject({ quantity: 6, pricePerBottle: 250, currency: "USD" });
  });

  it("asks before saving when the price basis is unclear", () => {
    const form = draftFormState(
      {
        producer: "Ridge",
        vintage: 2019,
        priceBasis: "unclear",
        lots: [{ quantity: 6, pricePerBottle: 1500 }],
      },
      "GBP",
    );
    expect(validateDraftForm(form, 2026).lots[0]?.price).toMatch(
      /Choose Per bottle or For all bottles/,
    );
  });
});

describe("windows", () => {
  it("keeps an unchanged AI window's source and marks an edited one as the user's", () => {
    const form = draftFormState(
      {
        producer: "Ridge",
        vintage: 2019,
        windowFrom: 2027,
        windowTo: 2045,
        windowSource: "ai",
        lots: [{ quantity: 1 }],
      },
      "GBP",
    );
    expect(toWineDraft(form, () => null).windowSource).toBe("ai");
    const edited = { ...form, wine: { ...form.wine, windowTo: "2040" } };
    expect(toWineDraft(edited, () => null)).toMatchObject({ windowTo: 2040, windowSource: "user" });
  });
});

describe("locations", () => {
  it("uses an existing location when a new name matches it", () => {
    const rack = makeLocation({ name: "Kitchen rack" });
    const lot = { location: NEW_LOCATION, newLocationName: " kitchen  RACK " };
    expect(resolveLotLocation(lot, [rack], null)).toEqual({ kind: "id", id: rack.id });
    expect(resolveLotLocation({ ...lot, newLocationName: "Fridge" }, [rack], null)).toEqual({
      kind: "new",
      name: "Fridge",
    });
  });

  it("defaults to the location used last, else the first by name", async () => {
    expect(await defaultLocationId()).toBeNull();
    const fridge = makeLocation({ name: "Fridge" });
    const attic = makeLocation({ name: "Attic" });
    await db.locations.bulkAdd([fridge, attic]);
    expect(await defaultLocationId()).toBe(attic.id);
    const wine = makeWine();
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, locationId: fridge.id }));
    expect(await defaultLocationId()).toBe(fridge.id);
  });
});
