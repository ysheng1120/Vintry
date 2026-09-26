import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeController } from "./ThemeController";
import { installMatchMedia, resetTestSettings, settingsModule } from "./testing";

vi.mock("../db/settings", async () => (await import("./testing")).settingsModule);

const html = document.documentElement;

beforeEach(() => {
  html.className = "";
  window.localStorage.clear();
  resetTestSettings();
});

describe("ThemeController", () => {
  it("adds the dark class when the theme is set to dark", async () => {
    installMatchMedia({ dark: false });
    resetTestSettings({ theme: "dark" });
    render(<ThemeController />);
    expect(html).toHaveClass("dark");
    expect(html).not.toHaveClass("light");
  });

  it("switches live when the setting changes", async () => {
    installMatchMedia({ dark: false });
    render(<ThemeController />);
    expect(html).toHaveClass("light");
    await act(() => settingsModule.setSetting("theme", "dark"));
    expect(html).toHaveClass("dark");
    await act(() => settingsModule.setSetting("theme", "light"));
    expect(html).toHaveClass("light");
    expect(html).not.toHaveClass("dark");
  });

  it("follows prefers-color-scheme when the theme is system", () => {
    const media = installMatchMedia({ dark: true });
    resetTestSettings({ theme: "system" });
    render(<ThemeController />);
    expect(html).toHaveClass("dark");
    act(() => media.set({ dark: false }));
    expect(html).toHaveClass("light");
    expect(html).not.toHaveClass("dark");
  });

  it("remembers the choice locally so the next load paints the right theme first", async () => {
    installMatchMedia({ dark: false });
    resetTestSettings({ theme: "dark" });
    render(<ThemeController />);
    expect(window.localStorage.getItem("vintry.theme")).toBe("dark");
  });
});
