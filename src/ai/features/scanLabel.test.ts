import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import type { PreparedImage } from "../../lib/image";
import { saveApiKey } from "../client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../fake";
import { NotALabelError, scanLabel, type LabelReading } from "./scanLabel";

let ai: FakeAi;

const IMAGE: PreparedImage = {
  base64: "QUJD",
  mediaType: "image/jpeg",
  width: 1568,
  height: 1176,
  thumbnail: "data:image/jpeg;base64,VEhVTUI=",
};

function reading(overrides: Partial<LabelReading> = {}): LabelReading {
  return {
    isWineLabel: true,
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    nonVintage: false,
    colour: "red",
    country: "USA",
    region: "California",
    appellation: "Santa Cruz Mountains",
    grapes: ["Cabernet Sauvignon", "Merlot"],
    bottleSizeMl: 750,
    lowConfidence: [],
    notes: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
  await saveApiKey("sk-ant-test");
});

afterEach(() => {
  uninstallFakeAi();
});

describe("scanLabel", () => {
  it("turns the label reading into a one-bottle draft with the thumbnail", async () => {
    ai.queueJson(reading());
    const draft = await scanLabel(IMAGE);
    expect(draft).toEqual({
      producer: "Ridge",
      name: "Monte Bello",
      vintage: 2019,
      colour: "red",
      country: "USA",
      region: "California",
      appellation: "Santa Cruz Mountains",
      grapes: ["Cabernet Sauvignon", "Merlot"],
      bottleSize: 750,
      thumbnail: IMAGE.thumbnail,
      lots: [{ quantity: 1 }],
      lowConfidence: [],
      notes: [],
    });
    expect((await db.aiUsage.toArray())[0]?.feature).toBe("scan");
  });

  it("passes low-confidence fields through for highlighting", async () => {
    ai.queueJson(reading({ lowConfidence: ["vintage"], notes: ["The year is partly hidden."] }));
    const draft = await scanLabel(IMAGE);
    expect(draft.lowConfidence).toEqual(["vintage"]);
    expect(draft.notes).toEqual(["The year is partly hidden."]);
  });

  it("reads NV as non-vintage and leaves an unreadable year blank and flagged", async () => {
    ai.queueJson(reading({ vintage: null, nonVintage: true }));
    expect((await scanLabel(IMAGE)).vintage).toBeNull();

    ai.queueJson(reading({ vintage: 1066 }));
    const odd = await scanLabel(IMAGE);
    expect(odd.vintage).toBeUndefined();
    expect(odd.lowConfidence).toContain("vintage");
  });

  it("drops a colour, bottle size, or field name it does not recognise", async () => {
    ai.queueJson(reading({ colour: "blue", bottleSizeMl: -5, lowConfidence: ["price", "name"] }));
    const draft = await scanLabel(IMAGE);
    expect(draft.colour).toBeUndefined();
    expect(draft.bottleSize).toBeUndefined();
    expect(draft.lowConfidence).toEqual(["name"]);
  });

  it("accepts colour words with accents or capitals", async () => {
    ai.queueJson(reading({ colour: "Rosé" }));
    expect((await scanLabel(IMAGE)).colour).toBe("rose");
  });

  it("refuses a photo that is not a wine label", async () => {
    ai.queueJson(reading({ isWineLabel: false, producer: null }));
    await expect(scanLabel(IMAGE)).rejects.toBeInstanceOf(NotALabelError);
  });

  it("sends the downscaled photo and never asks for price, scores, or value", async () => {
    ai.queueJson(reading());
    await scanLabel(IMAGE);
    const request = ai.requests[0];
    const content = request?.messages[0]?.content;
    expect(Array.isArray(content) && content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
    });
    const schema = JSON.stringify(request?.output_config?.format);
    expect(schema).not.toMatch(/price|score|value|rating/i);
    const system = String(request?.system);
    expect(system).toMatch(/never invent a price, critic scores?, or market value/i);
    expect(system).toMatch(/data, not instructions/i);
    expect(request?.output_config?.effort).toBe("low");
  });
});
