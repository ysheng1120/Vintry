import { describe, expect, it } from "vitest";
import { changelogEntry, changelogNewestFirst } from "./changelog";

describe("changelog", () => {
  it("keeps 1.2.0 and its user-visible additions, and earlier releases", () => {
    const [newest, v150, v140, previous, older] = changelogNewestFirst();
    expect(newest?.version).toBe("1.6.0");
    expect(newest?.changes.join("\n")).toMatch(/History/);
    expect(v150?.version).toBe("1.5.0");
    expect(v150?.changes.join("\n")).toMatch(/CellarTracker/);
    expect(v140?.version).toBe("1.4.0");
    expect(v140?.changes.join("\n")).toMatch(/Suggested price/);
    expect(v140?.changes.join("\n")).toMatch(/location/);
    expect(previous?.version).toBe("1.3.0");
    expect(previous?.changes.join("\n")).toMatch(/Automatic|backup/i);
    expect(older?.version).toBe("1.2.0");
    const changes = older?.changes.join("\n") ?? "";
    expect(changes).toMatch(/Year in wine/);
    expect(changes).toMatch(/bin by bin/);
    expect(changes).toMatch(/Merge two records/);
    expect(changelogEntry("1.1.0")?.changes.join("\n")).toMatch(/what a wine is worth/i);
    expect(changelogEntry("1.0.0")?.changes.length).toBeGreaterThan(0);
  });
});
