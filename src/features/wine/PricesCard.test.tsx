import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLiveQuery } from "dexie-react-hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import {
  fakeApiError,
  fakeCitedText,
  fakeWebSearch,
  installFakeAi,
  uninstallFakeAi,
  type FakeAi,
} from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { formatMoney } from "../../domain/money";
import type { Wine, WinePrices } from "../../domain/types";
import PricesCard from "./PricesCard";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

const SEARCHER = "https://www.wine-searcher.com/find/ridge+monte+bello/2019";
const BBR = "https://www.bbr.com/products-2019-monte-bello-ridge";
const FARR = "https://www.farrvintners.com/wine.php?id=2019-monte-bello";

async function addWine(overrides: Partial<Wine> = {}): Promise<Wine> {
  const wine = makeWine(overrides);
  await db.wines.add(wine);
  return wine;
}

/** Renders the card from the live row, as the wine page does. */
function LiveCard({ id }: { id: string }) {
  const wine = useLiveQuery(() => db.wines.get(id), [id]);
  return wine ? <PricesCard wine={wine} /> : null;
}

function renderCard(wine: Wine) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <LiveCard id={wine.id} />
    </ToastProvider>,
  );
  return user;
}

function queueResearch() {
  ai.queueResponse({
    content: [
      ...fakeWebSearch("srv_1", "Ridge Monte Bello 2019 price", [
        { url: SEARCHER, title: "Ridge Monte Bello 2019 | Wine-Searcher" },
        { url: BBR, title: "2019 Monte Bello | Berry Bros. & Rudd" },
        { url: FARR, title: "Monte Bello 2019 | Farr Vintners" },
      ]),
      fakeCitedText("Wine-Searcher shows an average of $285.", [
        { url: SEARCHER, title: "Wine-Searcher", citedText: "Avg Price (ex-tax) $ 285 / 750ml" },
      ]),
      fakeCitedText(" Berry Bros. & Rudd asks £210 and Farr Vintners £195.", [
        { url: BBR, title: "Berry Bros. & Rudd", citedText: "Bottle £210.00" },
        { url: FARR, title: "Farr Vintners", citedText: "Price per bottle: £195" },
      ]),
    ],
  });
}

const SUMMARY = {
  summary: "Offers from two London merchants and a price comparison site.",
  points: [
    { price: "£210.00", currency: "GBP", bottleSize: null, kind: "retail", sourceId: 2 },
    { price: "£195", currency: "GBP", bottleSize: null, kind: "retail", sourceId: 3 },
    { price: "$285", currency: "USD", bottleSize: 750, kind: "average", sourceId: 1 },
  ],
  found: true,
};

const SAVED: WinePrices = {
  summary: "Prices from UK shops.",
  points: [
    {
      price: "£210",
      amount: 210,
      currency: "GBP",
      bottleSize: null,
      kind: "retail",
      source: { url: BBR, title: "Berry Bros. & Rudd" },
    },
    {
      price: "£999",
      amount: 999,
      currency: "GBP",
      bottleSize: null,
      kind: "auction",
      source: { url: "javascript:alert(1)", title: "Bad" },
    },
  ],
  found: true,
  generatedAt: "2026-09-20T12:00:00.000Z",
  model: "claude-opus-5",
};

/** Two requests and a save run after a click; allow for a busy test machine. */
const SLOW = { timeout: 5000 };

/** The Find button once the saved key has loaded (it is disabled until then). */
async function findButton() {
  const button = await screen.findByRole("button", { name: "Find prices" });
  await waitFor(() => expect(button).toBeEnabled(), SLOW);
  return button;
}

const toasts = () => within(screen.getByRole("region", { name: "Notifications" }));

describe("PricesCard", () => {
  it("shows a disabled button, the note, and Needs AI key when there is no key", async () => {
    const wine = await addWine();
    renderCard(wine);
    expect(await screen.findByRole("button", { name: "Find prices" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Suggested price" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Searches reputable wine shops and price sites. Uses your AI key (a few web searches).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs AI key")).toBeInTheDocument();
  });

  it("finds prices and shows each checked price with its source and a range per currency", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson(SUMMARY);
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(await toasts().findByText(/Found prices/, {}, SLOW)).toBeInTheDocument();
    expect(toasts().getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(await screen.findByText(SUMMARY.summary)).toBeInTheDocument();
    const gbp = (n: number) => formatMoney(n, "GBP");
    expect(screen.getByText(`From ${gbp(195)} to ${gbp(210)}`)).toBeInTheDocument();
    // One USD price is not a range, and currencies are never mixed.
    expect(screen.queryByText(/From .*\$/)).not.toBeInTheDocument();
    const bbr = screen.getByText(`Shop price: ${gbp(210)}`, { exact: false });
    const link = within(bbr).getByRole("link", { name: /^Source: Berry Bros/ });
    expect(link).toHaveAttribute("href", BBR);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("bbr.com");
    const average = screen.getByText(`Average price: ${formatMoney(285, "USD")}`, {
      exact: false,
    });
    expect(within(average).getByRole("link")).toHaveAttribute("href", SEARCHER);
    expect(screen.getByText(/Prices found on the web by AI on/)).toHaveTextContent(
      "not your value. Check the linked pages.",
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(ai.requests).toHaveLength(2);
    expect(await db.wines.get(wine.id)).toMatchObject({ valuePerBottle: null });
  });

  it("drops a price the cited text does not show", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson({
      ...SUMMARY,
      points: [SUMMARY.points[0], { ...SUMMARY.points[1], price: "£150" }],
    });
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(await screen.findByText(SUMMARY.summary, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText(/150/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.prices?.points.map((p) => p.amount)).toEqual([210]);
  });

  it("says no prices were found when nothing can be verified", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson({
      ...SUMMARY,
      points: [{ price: "£400", currency: "GBP", bottleSize: null, kind: "retail", sourceId: 7 }],
    });
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(
      await screen.findByText("No prices found for this vintage.", {}, SLOW),
    ).toBeInTheDocument();
    expect(toasts().getByText(/No prices found for Ridge/)).toBeInTheDocument();
    expect(screen.queryByText(/400/)).not.toBeInTheDocument();
  });

  it("sends one request per step even on a double click", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson(SUMMARY);
    const user = renderCard(wine);

    await user.dblClick(await findButton());

    expect(await screen.findByText(SUMMARY.summary, {}, SLOW)).toBeInTheDocument();
    expect(ai.requests).toHaveLength(2);
    expect(ai.requests[0]?.tools).toBeDefined();
    expect(ai.requests[1]?.tools).toBeUndefined();
  });

  it("shows only prices whose source can be linked", async () => {
    const wine = await addWine({ prices: SAVED });
    renderCard(wine);

    expect(await screen.findByText("Prices from UK shops.")).toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", BBR);
  });

  it("removes the prices and Undo brings them back", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine({ prices: SAVED });
    const user = renderCard(wine);

    const remove = await screen.findByRole("button", { name: "Remove" });
    await waitFor(() => expect(remove).toBeEnabled(), SLOW);
    await user.click(remove);

    expect(await toasts().findByText(/Removed suggested prices/, {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Find prices" })).toBeEnabled();
    expect((await db.wines.get(wine.id))?.prices).toBeNull();

    await user.click(toasts().getByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Prices from UK shops.", {}, SLOW)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.prices).toEqual(SAVED);
  });

  it("keeps nothing and explains the error when the request fails", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueError(fakeApiError(429, "rate_limit_error", "slow down"));
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(await toasts().findByText(/Too many requests/, {}, SLOW)).toBeInTheDocument();
    expect(toasts().getByText("Couldn't find prices")).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.prices).toBeUndefined();
    expect(screen.getByRole("button", { name: "Find prices" })).toBeEnabled();
  });
});
