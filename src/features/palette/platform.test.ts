import { describe, expect, it } from "vitest";
import { isApplePlatform, modifierLabel } from "./platform";

describe("platform", () => {
  it("detects Apple computers from userAgentData or navigator.platform", () => {
    expect(isApplePlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform({ userAgentData: { platform: "Windows" }, platform: "Win32" })).toBe(
      false,
    );
    expect(isApplePlatform({})).toBe(false);
  });

  it("shows ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(modifierLabel({ platform: "MacIntel" })).toBe("⌘");
    expect(modifierLabel({ platform: "Win32" })).toBe("Ctrl");
  });
});
