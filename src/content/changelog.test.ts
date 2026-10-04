import { describe, expect, it } from "vitest";
import { changelogEntry, changelogNewestFirst } from "./changelog";

describe("changelog", () => {
  it("has 1.5.0 first, and keeps 1.4.0, 1.3.0, 1.2.0 and earlier releases", () => {
    const [newest, previous, second, third] = changelogNewestFirst();
    expect(newest?.version).toBe("1.5.0");
    expect(newest?.date).toBe("2026-10-04");
    const latest = newest?.changes.join("\n") ?? "";
    expect(latest).toMatch(/Parker/);
    expect(latest).toMatch(/Activity/);
    expect(latest).toMatch(/Check price .*removed/);
    expect(previous?.version).toBe("1.4.0");
    expect(previous?.changes.join("\n")).toMatch(/one card/);
    expect(second?.version).toBe("1.3.0");
    expect(second?.changes.join("\n")).toMatch(/Automatic|backup/i);
    expect(third?.version).toBe("1.2.0");
    const changes = third?.changes.join("\n") ?? "";
    expect(changes).toMatch(/Year in wine/);
    expect(changes).toMatch(/bin by bin/);
    expect(changes).toMatch(/Merge two records/);
    expect(changelogEntry("1.1.0")?.changes.join("\n")).toMatch(/what a wine is worth/i);
    expect(changelogEntry("1.0.0")?.changes.length).toBeGreaterThan(0);
  });
});
