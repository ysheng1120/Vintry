import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import { getSetting, setSetting } from "../../db/settings";
import { resetDatabase } from "../../db/testing";
import { addBottles, loadSampleCellar } from "../../domain/commands";
import { ONBOARDING_KEYS } from "./settingKeys";
import { renderApp, setBrowser, USER_AGENTS } from "./testing";

const SAMPLE_BANNER = "You are exploring a sample cellar";
const ASK_BANNER = "Clear the sample cellar?";

const realWine = {
  drafts: [
    {
      producer: "Ridge",
      name: "Lytton Springs",
      vintage: 2021,
      colour: "red" as const,
      lots: [{ quantity: 2 }],
    },
  ],
};

const banner = (title: string) =>
  screen.findByText(title).then((el) => el.closest<HTMLElement>("[data-banner]")!);

beforeEach(async () => {
  await resetDatabase();
  await setSetting(ONBOARDING_KEYS.onboardingDone, true);
  setBrowser(USER_AGENTS.chromeMac);
});
afterEach(() => vi.restoreAllMocks());

describe("SampleDataWatcher", () => {
  it("shows no banner without samples", async () => {
    renderApp("/");
    await screen.findByRole("heading", { name: "Home" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(SAMPLE_BANNER)).not.toBeInTheDocument();
  });

  it("marks the sample cellar, and Clear sample data removes the samples and the banner", async () => {
    await loadSampleCellar();
    renderApp("/");
    const box = await banner(SAMPLE_BANNER);
    await userEvent.setup().click(within(box).getByRole("button", { name: "Clear sample data" }));
    await waitFor(() => expect(screen.queryByText(SAMPLE_BANNER)).not.toBeInTheDocument());
    expect(await db.wines.filter((w) => w.isSample).count()).toBe(0);
    // The change can be undone from its toast.
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("asks whether to clear the samples after the first real add", async () => {
    await loadSampleCellar();
    renderApp("/");
    await banner(SAMPLE_BANNER);
    await act(async () => {
      await addBottles(realWine);
    });
    const ask = await banner(ASK_BANNER);
    await userEvent.setup().click(within(ask).getByRole("button", { name: "Clear sample data" }));
    await waitFor(() => expect(screen.queryByText(ASK_BANNER)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(SAMPLE_BANNER)).not.toBeInTheDocument());
    // The collector's own wine stays.
    const wines = await db.wines.toArray();
    expect(wines.map((w) => w.producer)).toEqual(["Ridge"]);
    expect(wines[0]?.isSample).toBe(false);
  });

  it("asks only once, and Keep samples keeps them", async () => {
    await loadSampleCellar();
    renderApp("/");
    await banner(SAMPLE_BANNER);
    await act(async () => {
      await addBottles(realWine);
    });
    const ask = await banner(ASK_BANNER);
    await userEvent.setup().click(within(ask).getByRole("button", { name: "Keep samples" }));
    await waitFor(() => expect(screen.queryByText(ASK_BANNER)).not.toBeInTheDocument());
    expect(await getSetting(ONBOARDING_KEYS.sampleClearAsked, false)).toBe(true);

    await act(async () => {
      await addBottles({
        drafts: [{ producer: "Other", colour: "white", vintage: 2020, lots: [{ quantity: 1 }] }],
      });
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(ASK_BANNER)).not.toBeInTheDocument();
    expect(await db.wines.filter((w) => w.isSample).count()).toBeGreaterThan(0);
  });

  it("does not ask when there are no samples", async () => {
    renderApp("/");
    await screen.findByRole("heading", { name: "Home" });
    await act(async () => {
      await addBottles(realWine);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(ASK_BANNER)).not.toBeInTheDocument();
  });
});

describe("SafariTabWarning", () => {
  it("keeps a warning in a Safari tab", async () => {
    setBrowser(USER_AGENTS.safariMac);
    const { router } = renderApp("/");
    const box = await banner("Add Vintry to your Dock to keep your cellar safe");
    await userEvent.setup().click(within(box).getByRole("button", { name: "Show me how" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/help"));
    expect(router.state.location.hash).toBe("#install");
  });

  it("stays quiet in the Safari Dock app and in Chrome", async () => {
    setBrowser(USER_AGENTS.safariMac, { standalone: true });
    const first = renderApp("/");
    await screen.findByRole("heading", { name: "Home" });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/Add Vintry to your Dock/)).not.toBeInTheDocument();
    first.view.unmount();

    setBrowser(USER_AGENTS.chromeMac);
    renderApp("/");
    await screen.findByRole("heading", { name: "Home" });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/Add Vintry to your Dock/)).not.toBeInTheDocument();
  });
});
