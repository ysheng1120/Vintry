import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BannerSlot } from "./Banners";
import { AppProviders } from "./providers";
import { browser } from "./browser";
import { emitVersionChange, installMatchMedia, resetTestPwa, resetTestSettings } from "./testing";

vi.mock("../db/settings", async () => (await import("./testing")).settingsModule);
vi.mock("../db/db", async () => (await import("./testing")).dbModule);
vi.mock("./pwaRegister", async () => (await import("./testing")).pwaModule);

beforeEach(() => {
  installMatchMedia();
  resetTestSettings();
  resetTestPwa();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppProviders", () => {
  it("shows a reload banner when another tab upgrades the database (versionchange)", async () => {
    const reload = vi.spyOn(browser, "reload").mockImplementation(() => {});
    render(
      <AppProviders>
        <BannerSlot />
      </AppProviders>,
    );
    expect(screen.queryByText(/updated in another tab/i)).not.toBeInTheDocument();
    act(() => emitVersionChange());
    expect(screen.getByText("Vintry was updated in another tab")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
