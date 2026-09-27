import { describe, expect, it } from "vitest";
import { windowRange, windowStatus, WINDOW_STATUS_LABELS } from "./window";

const w = (windowFrom: number | null, windowTo: number | null) => ({ windowFrom, windowTo });

describe("windowStatus", () => {
  it("follows the rule for 2026", () => {
    expect(windowStatus(w(2028, 2035), 2026)).toBe("hold");
    expect(windowStatus(w(2020, 2027), 2026)).toBe("drink-soon");
    expect(windowStatus(w(2020, 2024), 2026)).toBe("past-peak");
    expect(windowStatus(w(2022, 2030), 2026)).toBe("ready");
    expect(windowStatus(w(null, null), 2026)).toBe("none");
  });

  it("handles edges and open-ended windows", () => {
    expect(windowStatus(w(2026, 2026), 2026)).toBe("drink-soon");
    expect(windowStatus(w(2027, null), 2026)).toBe("hold");
    expect(windowStatus(w(2020, null), 2026)).toBe("ready");
    expect(windowStatus(w(null, 2025), 2026)).toBe("past-peak");
    expect(windowStatus(w(null, 2040), 2026)).toBe("ready");
  });

  it("has a label for every status", () => {
    expect(WINDOW_STATUS_LABELS["drink-soon"]).toBe("Drink soon");
    expect(WINDOW_STATUS_LABELS.none).toBe("No window");
  });
});

describe("windowRange", () => {
  it("writes both ends, with an ellipsis for an open end", () => {
    expect(windowRange(2020, 2035)).toBe("2020–2035");
    expect(windowRange(null, 2035)).toBe("…–2035");
    expect(windowRange(2020, null)).toBe("2020–…");
  });
});
