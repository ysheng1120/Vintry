import { describe, expect, it } from "vitest";
import { changelogEntry, changelogNewestFirst } from "./changelog";

describe("changelog", () => {
  it("has 1.5.2 first, and keeps 1.5.1, 1.5.0, 1.4.0, 1.3.0, 1.2.0 and earlier releases", () => {
    const [newest, v151, v150, v140, v130, v120] = changelogNewestFirst();
    expect(newest?.version).toBe("1.5.2");
    expect(newest?.date).toBe("2026-10-05");
    const latest = newest?.changes.join("\n") ?? "";
    expect(latest).toMatch(/whole web/);
    expect(latest).toMatch(/2 minutes/);
    expect(v151?.version).toBe("1.5.1");
    const v151Changes = v151?.changes.join("\n") ?? "";
    expect(v151Changes).toMatch(/only Robert Parker himself/);
    expect(v151Changes).toMatch(/William Kelley/);
    expect(v150?.version).toBe("1.5.0");
    const previous = v150?.changes.join("\n") ?? "";
    expect(previous).toMatch(/Activity/);
    expect(previous).toMatch(/Check price .*removed/);
    expect(v140?.version).toBe("1.4.0");
    expect(v140?.changes.join("\n")).toMatch(/one card/);
    expect(v130?.version).toBe("1.3.0");
    expect(v130?.changes.join("\n")).toMatch(/Automatic|backup/i);
    expect(v120?.version).toBe("1.2.0");
    const changes = v120?.changes.join("\n") ?? "";
    expect(changes).toMatch(/Year in wine/);
    expect(changes).toMatch(/bin by bin/);
    expect(changes).toMatch(/Merge two records/);
    expect(changelogEntry("1.1.0")?.changes.join("\n")).toMatch(/what a wine is worth/i);
    expect(changelogEntry("1.0.0")?.changes.length).toBeGreaterThan(0);
  });
});
