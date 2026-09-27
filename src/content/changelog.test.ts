import { describe, expect, it } from "vitest";
import { changelogEntry, changelogNewestFirst } from "./changelog";

describe("changelog", () => {
  it("keeps 1.2.0 and its user-visible additions, and earlier releases", () => {
    const [newest, previous] = changelogNewestFirst();
    expect(newest?.version).toBe("1.3.0");
    expect(newest?.changes.join("\n")).toMatch(/Automatic|backup/i);
    expect(previous?.version).toBe("1.2.0");
    const changes = previous?.changes.join("\n") ?? "";
    expect(changes).toMatch(/Year in wine/);
    expect(changes).toMatch(/bin by bin/);
    expect(changes).toMatch(/Merge two records/);
    expect(changelogEntry("1.1.0")?.changes.join("\n")).toMatch(/what a wine is worth/i);
    expect(changelogEntry("1.0.0")?.changes.length).toBeGreaterThan(0);
  });
});
