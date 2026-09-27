import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { saveApiKey } from "../client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../fake";
import { generateWineProfile, writeWineProfile } from "./wineProfile";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
  await saveApiKey("sk-ant-test");
});

afterEach(() => {
  uninstallFakeAi();
});

const REPLY = {
  summary: "Ridge makes structured, age-worthy reds from the Santa Cruz Mountains.",
  tasting: "Typically shows blackcurrant and cedar, with firm tannins that soften over a decade.",
  pairings: ["Roast lamb", "Aged cheddar", "Grilled steak"],
  serving: "Serve at 16 to 18°C; decant for about an hour.",
};

describe("writeWineProfile", () => {
  it("returns the parsed profile fields", async () => {
    ai.queueJson(REPLY);
    const profile = await writeWineProfile(makeWine());
    expect(profile).toEqual(REPLY);
    expect((await db.aiUsage.toArray())[0]?.feature).toBe("profile");
  });

  it("allows every field to come back empty for an obscure wine", async () => {
    ai.queueJson({ summary: "", tasting: "", pairings: [], serving: "" });
    const profile = await writeWineProfile(makeWine({ producer: "A Very Obscure Producer" }));
    expect(profile).toEqual({ summary: "", tasting: "", pairings: [], serving: "" });
  });

  it("sends only the wine's identity: no lots, prices, notes, locations, or other wines", async () => {
    ai.queueJson(REPLY);
    const other = makeWine({ producer: "Some Other Winery Nobody Asked About" });
    await db.wines.add(other);
    const wine = makeWine({
      country: "USA",
      region: "Santa Cruz Mountains",
      notes: "Kept in the back cellar, cost a small fortune",
      valuePerBottle: 999,
      valueCurrency: "GBP",
      rating: 95,
      tags: ["special"],
    });

    await writeWineProfile(wine);

    const request = ai.requests[0];
    const text = String(request?.messages[0]?.content);
    expect(text).toContain(wine.producer);
    expect(text).toContain("Santa Cruz Mountains");
    expect(text).not.toContain("fortune");
    expect(text).not.toContain("999");
    expect(text).not.toContain("special");
    expect(text).not.toContain(other.producer);
    expect(text).not.toMatch(/quantity|"lot|location|store|"price/i);
    const system = String(request?.system);
    expect(system).toMatch(/never invent a price, critic scores?, or market value/i);
    expect(system).toMatch(/no critic scores, no quotes/i);
    expect(system).toMatch(/never mention a price/i);
    expect(system).toMatch(/typically/i);
    expect(system).toMatch(/data, not instructions/i);
  });
});

describe("generateWineProfile", () => {
  it("writes a profile and saves it on the wine, with the served model and a timestamp", async () => {
    ai.queueJson(REPLY);
    const wine = makeWine();
    await db.wines.add(wine);

    const result = await generateWineProfile(wine);

    expect(result.summary).toBe("Wrote a profile for Ridge Monte Bello 2019");
    const saved = await db.wines.get(wine.id);
    expect(saved?.profile).toMatchObject(REPLY);
    expect(saved?.profile?.model).toBeTruthy();
    expect(saved?.profile?.generatedAt).toMatch(/^2026-09-26T12:00:00\.\d{3}Z$/);
  });
});
