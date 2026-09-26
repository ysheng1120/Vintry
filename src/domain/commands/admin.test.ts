import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { getSetting, setSetting } from "../../db/settings";
import { resetDatabase } from "../../db/testing";
import { undoBatch } from "../undo";
import { wipeAll } from "./admin";
import { addBottles } from "./wines";

describe("wipeAll", () => {
  beforeEach(resetDatabase);

  it("erases cellar data, keeps the API key, and can be undone from its safety snapshot", async () => {
    await setSetting("apiKey", "sk-ant-keep");
    await addBottles({
      drafts: [
        {
          producer: "Ridge",
          name: "Monte Bello",
          vintage: 2019,
          colour: "red",
          lots: [{ quantity: 6 }],
        },
      ],
    });

    const result = await wipeAll({});
    expect(await db.wines.count()).toBe(0);
    expect(await db.lots.count()).toBe(0);
    expect(await getSetting("apiKey", "")).toBe("sk-ant-keep");
    expect(result.summary).toBe("Erased all data");

    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect(await db.wines.count()).toBe(1);
    expect(await db.lots.count()).toBe(1);
  });
});
