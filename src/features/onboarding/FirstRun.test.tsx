import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import { getSetting, setSetting } from "../../db/settings";
import { makeWine, resetDatabase } from "../../db/testing";
import { needsOnboarding } from "./firstRun";
import { ONBOARDING_KEYS } from "./settingKeys";
import { renderApp, setBrowser, USER_AGENTS } from "./testing";

beforeEach(async () => {
  await resetDatabase();
  setBrowser(USER_AGENTS.chromeMac);
});
afterEach(() => vi.restoreAllMocks());

describe("needsOnboarding", () => {
  it("is true for a new collector", async () => {
    expect(await needsOnboarding()).toBe(true);
  });

  it("is false once onboarding is done", async () => {
    await setSetting(ONBOARDING_KEYS.onboardingDone, true);
    expect(await needsOnboarding()).toBe(false);
  });

  it("is false when the database already has wines, and remembers that", async () => {
    await db.wines.add(makeWine());
    expect(await needsOnboarding()).toBe(false);
    expect(await getSetting(ONBOARDING_KEYS.onboardingDone, false)).toBe(true);
  });
});

describe("FirstRunRedirect", () => {
  it("sends a new collector from any page to /welcome", async () => {
    const { router } = renderApp("/import");
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Welcome to Vintry" }),
    ).toBeInTheDocument();
  });

  it("leaves an existing collector where they are", async () => {
    await db.wines.add(makeWine());
    const { router } = renderApp("/");
    await new Promise((r) => setTimeout(r, 60));
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("opens Home on later launches once onboarding is done", async () => {
    await setSetting(ONBOARDING_KEYS.onboardingDone, true);
    const { router } = renderApp("/");
    await new Promise((r) => setTimeout(r, 60));
    expect(router.state.location.pathname).toBe("/");
  });

  it("never sends anyone away from /welcome", async () => {
    await setSetting(ONBOARDING_KEYS.onboardingDone, true);
    const { router } = renderApp("/welcome");
    await new Promise((r) => setTimeout(r, 60));
    expect(router.state.location.pathname).toBe("/welcome");
  });
});
