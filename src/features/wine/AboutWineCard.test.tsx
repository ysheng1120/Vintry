import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import type { Wine } from "../../domain/types";
import ProfileSection from "./AboutWineCard";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

async function addWine(overrides: Partial<Wine> = {}): Promise<Wine> {
  const wine = makeWine(overrides);
  await db.wines.add(wine);
  return wine;
}

function renderCard(wine: Wine) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <ProfileSection wine={wine} />
    </ToastProvider>,
  );
  return user;
}

const REPLY = {
  summary: "Ridge makes structured, age-worthy reds from the Santa Cruz Mountains.",
  tasting: "Typically shows blackcurrant and cedar, with firm tannins.",
  pairings: ["Roast lamb", "Aged cheddar", "Grilled steak"],
  serving: "Serve at 16 to 18°C; decant for about an hour.",
};

describe("ProfileSection (About this wine)", () => {
  it("shows a disabled Write a profile button titled Needs AI key when there is no key", async () => {
    const wine = await addWine();
    renderCard(wine);
    expect(await screen.findByRole("heading", { level: 3, name: "Profile" })).toBeVisible();
    const button = await screen.findByRole("button", { name: "Write a profile" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Needs AI key");
  });

  it("writes a profile, saves it, and offers Undo", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueJson(REPLY);
    const user = renderCard(wine);

    await user.click(await screen.findByRole("button", { name: "Write a profile" }));

    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/Wrote a profile/)).toBeInTheDocument();
    expect(toasts.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    const saved = await db.wines.get(wine.id);
    expect(saved?.profile).toMatchObject(REPLY);
  });

  it("shows a saved profile with pairings, serving, and when it was written", async () => {
    const wine = await addWine({
      profile: { ...REPLY, generatedAt: "2026-09-20T12:00:00.000Z", model: "claude-opus-5" },
    });
    renderCard(wine);

    expect(await screen.findByText(REPLY.summary)).toBeInTheDocument();
    expect(screen.getByText(REPLY.tasting)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Pairs well with" })).toBeVisible();
    for (const pairing of REPLY.pairings) expect(screen.getByText(pairing)).toBeInTheDocument();
    expect(screen.getByText(REPLY.serving)).toBeInTheDocument();
    expect(screen.getByText(/Written by AI on/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rewrite profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove profile" })).toBeInTheDocument();
  });

  it("removes a saved profile and offers Undo", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine({
      profile: { ...REPLY, generatedAt: "2026-09-20T12:00:00.000Z", model: "claude-opus-5" },
    });
    const user = renderCard(wine);

    await user.click(await screen.findByRole("button", { name: "Remove profile" }));

    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/Removed the profile/)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.profile).toBeNull();
  });

  it("sends one request even on a double click", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueJson(REPLY);
    const user = renderCard(wine);

    const button = await screen.findByRole("button", { name: "Write a profile" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.dblClick(button);

    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/Wrote a profile/)).toBeInTheDocument();
    expect(ai.requests).toHaveLength(1);
  });

  it("keeps no profile and explains the error when the request fails", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueError(fakeApiError(429, "rate_limit_error", "slow down"));
    const user = renderCard(wine);

    await user.click(await screen.findByRole("button", { name: "Write a profile" }));

    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/Too many requests/)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.profile).toBeUndefined();
  });
});
