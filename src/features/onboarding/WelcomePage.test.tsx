import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasApiKey } from "../../ai/client";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { exportBackup } from "../../db/backup";
import { db } from "../../db/db";
import { getSetting } from "../../db/settings";
import { makeWine, resetDatabase } from "../../db/testing";
import { resetInstallPromptForTests } from "../../lib/platform";
import { stopTour } from "../tour/tourStore";
import { ONBOARDING_KEYS } from "./settingKeys";
import { installPromptEvent, renderApp, setBrowser, USER_AGENTS } from "./testing";

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });

async function next(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(await screen.findByRole("button", { name }));
}

/** Walks from the welcome screen to "How do you want to start?" in Chrome, skipping the key. */
async function toStartStep(user: ReturnType<typeof userEvent.setup>) {
  await heading("Welcome to Vintry");
  await next(user, "Get started");
  await heading("Install Vintry as an app");
  await next(user, "Continue");
  await heading("Add an AI key (optional)");
  await next(user, "Skip for now");
  await heading("How do you want to start?");
}

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  resetInstallPromptForTests();
  act(() => stopTour());
  setBrowser(USER_AGENTS.chromeMac);
  ai = installFakeAi();
});
afterEach(() => {
  uninstallFakeAi();
  vi.restoreAllMocks();
});

describe("welcome step", () => {
  it("makes the three promises", async () => {
    renderApp("/welcome");
    await heading("Welcome to Vintry");
    expect(screen.getByText("Free to run")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Quick")).toBeInTheDocument();
    expect(screen.getByText(/no subscription/i)).toBeInTheDocument();
    expect(screen.getByText(/stays on your computer/i)).toBeInTheDocument();
    expect(screen.getByText(/no account/i)).toBeInTheDocument();
    // Full screen: no main navigation.
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });
});

describe("install step", () => {
  it("asks Safari on macOS to add Vintry to the Dock first", async () => {
    setBrowser(USER_AGENTS.safariMac);
    const user = userEvent.setup();
    renderApp("/welcome");
    await next(user, "Get started");
    await heading("Add Vintry to your Dock first");
    expect(screen.getByText(/choose File → Add to Dock, then click Add/)).toBeInTheDocument();
    await next(user, "Continue in browser");
    await heading("Add an AI key (optional)");
  });

  it("skips the install step when Vintry already runs as an installed app", async () => {
    setBrowser(USER_AGENTS.safariMac, { standalone: true });
    const user = userEvent.setup();
    renderApp("/welcome");
    await next(user, "Get started");
    await heading("Add an AI key (optional)");
  });

  it("offers an Install app button in Chrome when the browser's prompt fired", async () => {
    const user = userEvent.setup();
    renderApp("/welcome");
    const event = installPromptEvent("accepted");
    act(() => {
      window.dispatchEvent(event);
    });
    await next(user, "Get started");
    await heading("Install Vintry as an app");
    await next(user, "Install app");
    expect(event.prompt).toHaveBeenCalled();
    // Installed: onboarding carries on.
    await heading("Add an AI key (optional)");
  });

  it("gives menu instructions when Chrome has not offered the prompt", async () => {
    const user = userEvent.setup();
    renderApp("/welcome");
    await next(user, "Get started");
    await heading("Install Vintry as an app");
    expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
    expect(screen.getByText(/install icon/i)).toBeInTheDocument();
    expect(screen.getByText(/menu and choose Install Vintry\./)).toBeInTheDocument();
  });

  it("names Edge's own menu item", async () => {
    setBrowser(USER_AGENTS.edgeWindows);
    const user = userEvent.setup();
    renderApp("/welcome");
    await next(user, "Get started");
    await heading("Install Vintry as an app");
    expect(screen.getByText(/Install this site as an app/)).toBeInTheDocument();
  });
});

describe("AI key step", () => {
  async function toKeyStep(user: ReturnType<typeof userEvent.setup>) {
    renderApp("/welcome");
    await next(user, "Get started");
    await next(user, "Continue");
    await heading("Add an AI key (optional)");
  }

  it("explains how to get a key, the cost, and what is sent", async () => {
    const user = userEvent.setup();
    await toKeyStep(user);
    expect(screen.getByRole("link", { name: /console.anthropic.com/ })).toHaveAttribute(
      "href",
      "https://console.anthropic.com",
    );
    expect(screen.getByText(/Billing/)).toBeInTheDocument();
    expect(screen.getByText(/Create Key/)).toBeInTheDocument();
    // Cost example from the model table: Opus 5, 2500 in + 400 out = $0.0225.
    expect(screen.getByText(/\$0\.023/)).toBeInTheDocument();
    expect(
      screen.getByText(/send the text, photo, or cellar details they use to Anthropic/),
    ).toBeInTheDocument();
  });

  it("tests and saves a working key", async () => {
    const user = userEvent.setup();
    await toKeyStep(user);
    ai.queueText("OK");
    await user.type(screen.getByLabelText("Your API key"), "sk-ant-good");
    await user.click(screen.getByRole("button", { name: "Test key" }));
    expect(await screen.findByText(/Your key works/)).toBeInTheDocument();
    expect(await hasApiKey()).toBe(true);
    await next(user, "Continue");
    await heading("How do you want to start?");
  });

  it("shows why a key failed and does not save it", async () => {
    const user = userEvent.setup();
    await toKeyStep(user);
    ai.queueError(fakeApiError(401, "authentication_error", "invalid x-api-key"));
    await user.type(screen.getByLabelText("Your API key"), "sk-ant-bad");
    await user.click(screen.getByRole("button", { name: "Test key" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await hasApiKey()).toBe(false);
  });

  it("can be skipped, leaving AI without a key", async () => {
    const user = userEvent.setup();
    await toKeyStep(user);
    await next(user, "Skip for now");
    await heading("How do you want to start?");
    expect(await hasApiKey()).toBe(false);
  });
});

describe("start step", () => {
  it("offers six ways to start", async () => {
    const user = userEvent.setup();
    renderApp("/welcome");
    await toStartStep(user);
    for (const name of [
      /Scan a label/,
      /Describe it/,
      /Add by hand/,
      /Import a file/,
      /Explore a sample cellar/,
      /Restore from a Vintry backup/,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it.each([
    [/Scan a label/, "/add/scan"],
    [/Describe it/, "/add/describe"],
    [/Add by hand/, "/add/manual"],
    [/Import a file/, "/import"],
  ])("%s opens its page and finishes onboarding", async (name, path) => {
    const user = userEvent.setup();
    const { router } = renderApp("/welcome");
    await toStartStep(user);
    await user.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(await getSetting(ONBOARDING_KEYS.onboardingDone, false)).toBe(true);
    expect(await getSetting(ONBOARDING_KEYS.tourPending, false)).toBe(true);
  });

  it("finishes onboarding for good: later launches open Home and start the tour there", async () => {
    const user = userEvent.setup();
    const first = renderApp("/");
    await waitFor(() => expect(first.router.state.location.pathname).toBe("/welcome"));
    await toStartStep(user);
    await user.click(screen.getByRole("button", { name: /Add by hand/ }));
    await heading("Add by hand");
    first.view.unmount();

    const later = renderApp("/");
    await heading("Home");
    // The tour starts on Home after onboarding.
    expect(await screen.findByRole("dialog", { name: "Home" })).toBeInTheDocument();
    expect(later.router.state.location.pathname).toBe("/");
  });

  it("loads the sample cellar, lands on Home, and shows the sample banner", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/welcome");
    await toStartStep(user);
    await user.click(screen.getByRole("button", { name: /Explore a sample cellar/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText("You are exploring a sample cellar")).toBeInTheDocument();
    expect(await db.wines.filter((w) => w.isSample).count()).toBeGreaterThan(0);
  });

  it("restores a Vintry backup and lands on Home with the restored wines", async () => {
    // Make a backup with one wine, then start from an empty database.
    await db.wines.add(makeWine({ producer: "Ridge", name: "Monte Bello" }));
    const backup = await exportBackup();
    await resetDatabase();

    const user = userEvent.setup();
    const { router } = renderApp("/welcome");
    await toStartStep(user);
    const file = new File([JSON.stringify(backup)], "vintry-backup.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("Vintry backup file to restore"), file);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await db.wines.count()).toBe(1);
    expect((await db.wines.toArray())[0]?.producer).toBe("Ridge");
    expect(await getSetting(ONBOARDING_KEYS.onboardingDone, false)).toBe(true);
  });

  it("says why a file is not a backup and stays on the page", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/welcome");
    await toStartStep(user);
    const file = new File(["not json"], "notes.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Vintry backup file to restore"), file);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/not a Vintry backup/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
  });
});
