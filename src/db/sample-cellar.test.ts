import { describe, expect, it } from "vitest";
import { COLOURS } from "../domain/types";
import { WINDOW_STATUSES, windowStatus } from "../domain/window";
import { buildSampleCellar } from "./sample-cellar";

describe("sample cellar data", () => {
  const sample = buildSampleCellar({ year: 2026, today: new Date("2026-09-26T12:00:00") });

  it("has about two dozen wines in two locations, all marked as samples", () => {
    expect(sample.wines.length).toBeGreaterThanOrEqual(22);
    expect(sample.locations.map((l) => l.name)).toEqual(["EuroCave A", "Kitchen rack"]);
    const all = [
      ...sample.wines,
      ...sample.lots,
      ...sample.locations,
      ...sample.consumptions,
      ...sample.tastingNotes,
      ...sample.wishlist,
    ];
    expect(all.every((row) => row.isSample)).toBe(true);
  });

  it("covers every colour and every window status", () => {
    expect(new Set(sample.wines.map((w) => w.colour))).toEqual(new Set(COLOURS));
    const statuses = new Set(sample.wines.map((w) => windowStatus(w, 2026)));
    for (const status of WINDOW_STATUSES) expect(statuses).toContain(status);
  });

  it("links every lot, drink and note to a sample wine and location", () => {
    const wineIds = new Set(sample.wines.map((w) => w.id));
    const locationIds = new Set(sample.locations.map((l) => l.id));
    for (const lot of sample.lots) {
      expect(wineIds).toContain(lot.wineId);
      expect(locationIds).toContain(lot.locationId);
    }
    for (const row of [...sample.consumptions, ...sample.tastingNotes]) {
      expect(wineIds).toContain(row.wineId);
    }
    expect(sample.consumptions.length).toBeGreaterThanOrEqual(3);
    expect(sample.lots.some((lot) => lot.quantity === 0 && lot.closedAt)).toBe(true);
  });

  it("includes more than one currency and bottle size", () => {
    expect(new Set(sample.lots.map((l) => l.currency)).size).toBeGreaterThan(1);
    expect(new Set(sample.wines.map((w) => w.bottleSize)).size).toBeGreaterThan(1);
  });
});
