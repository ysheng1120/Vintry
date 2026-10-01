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
import type { Wine, WinePriceCheck } from "../../domain/types";
import PriceSection from "./PriceSection";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-10-01T12:00:00Z");
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

const BBR = "https://www.bbr.com/products-20191234-ridge-monte-bello-2019";
const FARR = "https://www.farrvintners.com/wine.php?id=88";
const JUSTERINIS = "https://www.justerinis.com/ridge-monte-bello-2019";
const WINE_COM = "https://www.wine.com/product/ridge-monte-bello-2019/1234";

const QUOTES = {
  [BBR]: "Ridge Monte Bello 2019 £225.00 per bottle",
  [FARR]: "Ridge Monte Bello 2019 75cl £200.00",
  [JUSTERINIS]: "Ridge Monte Bello 2019 bottle £240.00",
};

async function addWine(overrides: Partial<Wine> = {}): Promise<Wine> {
  const wine = makeWine(overrides);
  await db.wines.add(wine);
  return wine;
}

/** Renders the section from the live row, as the wine page does. */
function LiveSection({ id }: { id: string }) {
  const wine = useLiveQuery(() => db.wines.get(id), [id]);
  return wine ? <PriceSection wine={wine} /> : null;
}

function renderSection(wine: Wine) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <LiveSection id={wine.id} />
    </ToastProvider>,
  );
  return user;
}

/** One research turn on three UK shops, each quoting one bottle price. */
function queueResearch() {
  ai.queueResponse({
    content: [
      ...fakeWebSearch("srv_1", "ridge monte bello 2019 price", [
        { url: BBR, title: "Ridge Monte Bello 2019 | BBR" },
        { url: FARR, title: "Ridge Monte Bello 2019 | Farr Vintners" },
        { url: JUSTERINIS, title: "Ridge Monte Bello 2019 | Justerini & Brooks" },
      ]),
      fakeCitedText(
        "Shops list it from £200 to £240.",
        Object.entries(QUOTES).map(([url, citedText]) => ({ url, title: null, citedText })),
      ),
    ],
  });
}

const bottle = (amount: number, merchant: string, sourceId: number) => ({
  written: `£${amount}.00`,
  amount,
  currency: "£",
  unit: "bottle",
  sizeMl: 750,
  vintage: 2019,
  basis: "duty-paid retail",
  availability: "for sale",
  merchant,
  sourceId,
});

const SUMMARY = {
  prices: [
    bottle(225, "Berry Bros. & Rudd", 1),
    bottle(200, "Farr Vintners", 2),
    bottle(240, "Justerini & Brooks", 3),
  ],
};

const source = (url: string, title: string) => ({ url, title });

/** AE2: three GBP bottle prices, one USD price, and one case price as an other listing. */
const SAVED: WinePriceCheck = {
  checkedFor: { producer: "Ridge", name: "Monte Bello", vintage: 2019, bottleSize: 750 },
  ranges: [
    { currency: "GBP", low: 200, middle: 225, high: 240, count: 3, usable: true },
    { currency: "USD", low: 310, middle: 310, high: 310, count: 1, usable: true },
  ],
  listings: [
    {
      amount: "£225.00",
      value: 225,
      currency: "GBP",
      merchant: "Berry Bros. & Rudd",
      unit: "bottle",
      sizeMl: 750,
      vintage: 2019,
      basis: "duty-paid retail",
      availability: "for sale",
      inRange: true,
      source: source(BBR, "BBR"),
    },
    {
      amount: "£200.00",
      value: 200,
      currency: "GBP",
      merchant: "Farr Vintners",
      unit: "bottle",
      sizeMl: 750,
      vintage: 2019,
      basis: "duty-paid retail",
      availability: "for sale",
      inRange: true,
      source: source(FARR, "Farr"),
    },
    {
      amount: "£240.00",
      value: 240,
      currency: "GBP",
      merchant: "Justerini & Brooks",
      unit: "bottle",
      sizeMl: 750,
      vintage: 2019,
      basis: "duty-paid retail",
      availability: "for sale",
      inRange: true,
      source: source("javascript:alert(1)", "Bad"),
    },
    {
      amount: "$310.00",
      value: 310,
      currency: "USD",
      merchant: "Wine.com",
      unit: "bottle",
      sizeMl: 750,
      vintage: 2019,
      basis: "unknown",
      availability: "for sale",
      inRange: true,
      source: source(WINE_COM, "Wine.com"),
    },
    {
      amount: "£1,250",
      value: 1250,
      currency: "GBP",
      merchant: "Farr Vintners",
      unit: "case",
      sizeMl: 750,
      vintage: 2019,
      basis: "in bond or ex-tax",
      availability: "sold out",
      inRange: false,
      source: source(FARR, "Farr"),
    },
  ],
  found: true,
  generatedAt: "2026-09-30T12:00:00.000Z",
  model: "claude-opus-5",
};

/** Two requests and a save run after a click; allow for a busy test machine. */
const SLOW = { timeout: 5000 };

async function checkButton() {
  const button = await screen.findByRole("button", { name: "Check price" });
  await waitFor(() => expect(button).toBeEnabled(), SLOW);
  return button;
}

const toasts = () => within(screen.getByRole("region", { name: "Notifications" }));

describe("PriceSection", () => {
  it("shows the cost note and a disabled Check price without a key", async () => {
    const wine = await addWine();
    renderSection(wine);
    expect(await screen.findByRole("heading", { level: 3, name: "Shop prices" })).toBeVisible();
    const button = screen.getByRole("button", { name: "Check price" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Needs AI key");
    expect(
      screen.getByText(
        "Searches a fixed list of wine shops. Uses your AI key (up to 5 web searches).",
      ),
    ).toBeInTheDocument();
  });

  it("checks prices and shows the GBP range, the date, and a link per source", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson(SUMMARY);
    const user = renderSection(wine);

    await user.click(await checkButton());

    expect(await toasts().findByText(/Found prices for/, {}, SLOW)).toBeInTheDocument();
    expect(toasts().getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(
      await screen.findByText("GBP £200 to £240, middle £225 (3 prices)", {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByText(/Checked by AI on/)).toHaveTextContent(
      "Shop prices are often above auction or collector prices.",
    );
    expect(screen.getByText(/Checked by AI on/)).toHaveTextContent("2026");
    for (const url of [BBR, FARR, JUSTERINIS]) {
      const link = screen
        .getAllByRole("link")
        .find((element) => element.getAttribute("href") === url);
      expect(link).toBeDefined();
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByRole("button", { name: "Refresh prices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove prices" })).toBeInTheDocument();
    // The result alone never sets the collector's value.
    const saved = await db.wines.get(wine.id);
    expect(saved?.valuePerBottle).toBeNull();
    expect(saved?.valueCurrency).toBeNull();
  });

  it("sends one research request on a double click", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson(SUMMARY);
    const user = renderSection(wine);

    await user.dblClick(await checkButton());

    expect(await screen.findByText(/^GBP £200 to £240/, {}, SLOW)).toBeInTheDocument();
    expect(ai.requests).toHaveLength(2);
    expect(ai.requests.filter((request) => request.tools)).toHaveLength(1);
  });

  it('shows "No current prices found" for a found: false result', async () => {
    const wine = await addWine({
      priceCheck: { ...SAVED, ranges: [], listings: [], found: false },
    });
    renderSection(wine);

    expect(await screen.findByText("No current prices found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use this price/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh prices" })).toBeInTheDocument();
  });

  it("shows one row per currency with Use this price under each, and other listings (AE2)", async () => {
    const wine = await addWine({ priceCheck: SAVED });
    renderSection(wine);

    const gbp = await screen.findByText("GBP £200 to £240, middle £225 (3 prices)");
    expect(screen.getByText("USD $310 (1 price)")).toBeInTheDocument();
    const uses = screen.getAllByRole("button", { name: /^Use this price/ });
    expect(uses).toHaveLength(2);
    expect(uses[0]).toHaveAccessibleName(/GBP/);
    expect(uses[1]).toHaveAccessibleName(/USD/);
    expect(gbp).toBeVisible();

    expect(screen.getByRole("heading", { level: 4, name: "Other listings" })).toBeVisible();
    const other = screen.getByText(/£1,250/);
    expect(other).toHaveTextContent(/per case/);
    expect(other).toHaveTextContent(/750 ml/);
    expect(other).toHaveTextContent(/sold out/);
    const otherLink = within(other.closest("li")!).getByRole("link");
    expect(otherLink).toHaveAttribute("href", FARR);
    // A non-http source is never linked.
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href")?.startsWith("javascript")),
    ).toBe(false);
  });

  it("marks a result for another vintage out of date and hides Use this price (AE3)", async () => {
    const wine = await addWine({ vintage: 2018, priceCheck: SAVED });
    renderSection(wine);

    expect(await screen.findByText(/Checked for 2019; this wine is now 2018/)).toBeInTheDocument();
    expect(screen.getByText("GBP £200 to £240, middle £225 (3 prices)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use this price/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh prices" })).toBeInTheDocument();
  });

  it("marks a result for another bottle size out of date", async () => {
    const wine = await addWine({ bottleSize: 1500, priceCheck: SAVED });
    renderSection(wine);

    expect(
      await screen.findByText(/Checked for 750 ml; this wine is now 1\.5 L/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use this price/ })).not.toBeInTheDocument();
  });

  it("withholds Use this price for an unclear currency, with its reason", async () => {
    const wine = await addWine({
      priceCheck: {
        ...SAVED,
        ranges: [{ currency: "$", low: 300, middle: 300, high: 300, count: 1, usable: false }],
      },
    });
    renderSection(wine);

    expect(await screen.findByText(/\$300 \(1 price\)/)).toBeInTheDocument();
    expect(
      screen.getByText("Currency unclear. Enter your value in Edit wine."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use this price/ })).not.toBeInTheDocument();
  });

  it("removes the result and Undo brings it back", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine({ priceCheck: SAVED });
    const user = renderSection(wine);

    const remove = await screen.findByRole("button", { name: "Remove prices" });
    await waitFor(() => expect(remove).toBeEnabled(), SLOW);
    await user.click(remove);

    expect(await toasts().findByText(/Removed the price check/, {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Check price" })).toBeEnabled();
    expect((await db.wines.get(wine.id))?.priceCheck).toBeNull();

    await user.click(toasts().getByRole("button", { name: "Undo" }));

    expect(await screen.findByText(/^GBP £200 to £240/, {}, SLOW)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.priceCheck).toEqual(SAVED);
  });

  it("keeps the earlier result and explains the error when the check fails", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine({ priceCheck: SAVED });
    ai.queueError(fakeApiError(429, "rate_limit_error", "slow down"));
    const user = renderSection(wine);

    const refresh = await screen.findByRole("button", { name: "Refresh prices" });
    await waitFor(() => expect(refresh).toBeEnabled(), SLOW);
    await user.click(refresh);

    expect(await toasts().findByText("Couldn't check prices", {}, SLOW)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.priceCheck).toEqual(SAVED);
    expect(screen.getByText(/^GBP £200 to £240/)).toBeInTheDocument();
  });
});
