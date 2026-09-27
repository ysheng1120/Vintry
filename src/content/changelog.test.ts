import { describe, expect, it } from "vitest";
import { changelogEntry, changelogNewestFirst } from "./changelog";

describe("changelog", () => {
  it("leads with 1.1.0 and its user-visible additions, keeping the launch release", () => {
    const [newest] = changelogNewestFirst();
    expect(newest?.version).toBe("1.1.0");
    const changes = newest?.changes.join("\n") ?? "";
    expect(changes).toMatch(/what a wine is worth/i);
    expect(changes).toMatch(/label photo/i);
    expect(changes).toMatch(/Not sure what to open tonight/);
    expect(changelogEntry("1.0.0")?.changes.length).toBeGreaterThan(0);
  });
});
