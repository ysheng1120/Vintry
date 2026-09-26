import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../../db/testing";
import { onCommandCommitted } from "./core";
import { createLocation } from "./locations";
import { loadSampleCellar } from "./sample";

describe("onCommandCommitted", () => {
  beforeEach(resetDatabase);

  it("notifies listeners after a real change is committed", async () => {
    const seen: string[] = [];
    const stop = onCommandCommitted((result) => seen.push(result.summary));
    await createLocation({ name: "Kitchen rack" });
    stop();
    await createLocation({ name: "Garage" });
    expect(seen).toHaveLength(1);
  });

  it("does not notify for sample data, which is not the collector's own change", async () => {
    let calls = 0;
    const stop = onCommandCommitted(() => (calls += 1));
    await loadSampleCellar();
    stop();
    expect(calls).toBe(0);
  });
});
