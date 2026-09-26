import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeLot, makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import type { Wine } from "../../domain/types";
import BulkEstimate, { BulkEstimateButton } from "./BulkEstimate";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

async function addWines(count: number, overrides: Partial<Wine> = {}): Promise<Wine[]> {
  const wines = Array.from({ length: count }, (_, i) =>
    makeWine({ producer: `Producer ${String(i).padStart(2, "0")}`, name: "", ...overrides }),
  );
  await db.wines.bulkAdd(wines);
  await db.lots.bulkAdd(wines.map((w) => makeLot({ wineId: w.id })));
  return wines;
}

function queueEstimates(wines: Wine[]) {
  ai.queueJson({
    estimates: wines.map((w) => ({ wineId: w.id, from: 2027, to: 2040, reason: "Needs time." })),
  });
}

function Path() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname + location.search}</output>;
}

function renderCellar(entry: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ToastProvider>
            <Path />
            <Outlet />
          </ToastProvider>
        ),
        children: [
          {
            path: "cellar",
            element: (
              <>
                <BulkEstimate />
                <BulkEstimateButton />
              </>
            ),
          },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return user;
}

const withWindow = async () =>
  (await db.wines.toArray()).filter((w) => w.windowFrom !== null).length;

describe("BulkEstimate", () => {
  it("stays closed without estimate=all in the URL", async () => {
    await saveApiKey("sk-ant-test");
    await addWines(2);
    renderCellar("/cellar");
    await screen.findByRole("button", { name: "Estimate 2 windows with AI" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the count and cost, runs, and applies AI windows with one Undo for all", async () => {
    await saveApiKey("sk-ant-test");
    await addWines(1, { windowFrom: 2020, windowTo: 2030, windowSource: "user" });
    const wines = await addWines(3);
    queueEstimates(wines);
    const user = renderCellar("/cellar?status=none&estimate=all");

    const dialog = await screen.findByRole("dialog", { name: "Estimate drinking windows" });
    expect(await within(dialog).findByText("3 wines")).toBeInTheDocument();
    expect(within(dialog).getByText(/have no drinking window/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Estimated cost: about \$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Best \(Claude Opus 5\)/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Estimate 3 wines" }));

    expect(await within(dialog).findByText("Added windows for 3 wines.")).toBeInTheDocument();
    expect(ai.requests).toHaveLength(1);
    expect(await withWindow()).toBe(4);
    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    await user.click(await toasts.findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(await withWindow()).toBe(1));
  });

  it("removes estimate=all from the URL when closed and keeps the other filters", async () => {
    await saveApiKey("sk-ant-test");
    await addWines(1);
    const user = renderCellar("/cellar?status=none&estimate=all");

    const dialog = await screen.findByRole("dialog", { name: "Estimate drinking windows" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent(/^\/cellar\?status=none$/);
  });

  it("opens from the button", async () => {
    await saveApiKey("sk-ant-test");
    await addWines(2);
    const user = renderCellar("/cellar");

    await user.click(await screen.findByRole("button", { name: "Estimate 2 windows with AI" }));

    expect(
      await screen.findByRole("dialog", { name: "Estimate drinking windows" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("estimate=all");
  });

  it("explains the missing key and cannot run without one", async () => {
    await addWines(2);
    renderCellar("/cellar?estimate=all");

    const dialog = await screen.findByRole("dialog", { name: "Estimate drinking windows" });
    expect(await within(dialog).findByText("AI needs your Claude API key")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^Estimate \d/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /windows with AI/ })).not.toBeInTheDocument();
  });

  it("says when every wine already has a window", async () => {
    await saveApiKey("sk-ant-test");
    await addWines(1, { windowFrom: 2020, windowTo: 2030, windowSource: "ai" });
    renderCellar("/cellar?estimate=all");

    const dialog = await screen.findByRole("dialog", { name: "Estimate drinking windows" });
    expect(
      await within(dialog).findByText(/Every wine in your cellar has a drinking window/),
    ).toBeInTheDocument();
  });

  it("reports an error, keeps the windows applied, and continues with the rest", async () => {
    await saveApiKey("sk-ant-test");
    const wines = await addWines(25);
    queueEstimates(wines);
    ai.queueError(new Error("boom"));
    const user = renderCellar("/cellar?estimate=all");

    const dialog = await screen.findByRole("dialog", { name: "Estimate drinking windows" });
    await user.click(await within(dialog).findByRole("button", { name: "Estimate 25 wines" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/went wrong/);
    expect(await withWindow()).toBe(20);
    queueEstimates(wines);
    await user.click(await within(dialog).findByRole("button", { name: "Continue with 5 wines" }));
    expect(await within(dialog).findByText("Added windows for 5 wines.")).toBeInTheDocument();
    expect(await withWindow()).toBe(25);
  });
});
