import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeLot, makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import type { Wine } from "../../domain/types";
import EstimateWindowButton from "./EstimateWindowButton";

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
  await db.lots.add(makeLot({ wineId: wine.id }));
  return wine;
}

function renderButton(wine: Wine) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <EstimateWindowButton wine={wine} />
    </ToastProvider>,
  );
  return user;
}

const reply = (wine: Wine) => ({
  estimates: [{ wineId: wine.id, from: 2027, to: 2040, reason: "Firm young Cabernet." }],
});

describe("EstimateWindowButton", () => {
  it("is hidden when there is no key", async () => {
    const wine = await addWine();
    renderButton(wine);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /Estimate with AI/ })).not.toBeInTheDocument();
  });

  it("applies an AI window with its reason and offers Undo", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueJson(reply(wine));
    const user = renderButton(wine);

    await user.click(await screen.findByRole("button", { name: /Estimate with AI/ }));

    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/Set drinking window/)).toBeInTheDocument();
    expect(await db.wines.get(wine.id)).toMatchObject({
      windowFrom: 2027,
      windowTo: 2040,
      windowSource: "ai",
      windowNote: "Firm young Cabernet.",
    });

    await user.click(toasts.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await db.wines.get(wine.id))?.windowFrom).toBeNull());
  });

  it("asks before replacing a window the user set, and changes nothing on Cancel", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine({ windowFrom: 2025, windowTo: 2030, windowSource: "user" });
    ai.queueJson(reply(wine));
    const user = renderButton(wine);

    await user.click(await screen.findByRole("button", { name: /Estimate with AI/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/You set this window yourself/);
    expect(ai.requests).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(ai.requests).toHaveLength(0);
    expect(await db.wines.get(wine.id)).toMatchObject({ windowFrom: 2025, windowSource: "user" });

    await user.click(screen.getByRole("button", { name: /Estimate with AI/ }));
    await user.click(await screen.findByRole("button", { name: "Estimate and replace" }));
    await waitFor(async () =>
      expect(await db.wines.get(wine.id)).toMatchObject({ windowFrom: 2027, windowSource: "ai" }),
    );
  });

  it("says so when Claude cannot estimate the wine", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueJson({ estimates: [] });
    const user = renderButton(wine);

    await user.click(await screen.findByRole("button", { name: /Estimate with AI/ }));

    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/couldn't estimate a window/i)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.windowFrom).toBeNull();
  });
});
