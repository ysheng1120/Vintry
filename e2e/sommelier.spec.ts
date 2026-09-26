import { expect, test } from "@playwright/test";
import { mockAnthropic, toolResults, type ScriptedReply } from "./anthropicMock";
import {
  expectTotalBottles,
  finishOnboarding,
  openSection,
  pageHeading,
  toast,
  wideWindowOnly,
} from "./helpers";

wideWindowOnly("The chat journey does not depend on the window size.");

// A service worker could answer requests before page.route sees them; the mock must see all.
test.use({ serviceWorkers: "block" });

const TEST_KEY = "sk-ant-test-e2e-0000000000000000";

interface SearchResult {
  wines: { wineId: string; wine: string; lots: { lotId: string; bottles: number }[] }[];
}

test.beforeEach(async ({ page }) => {
  await finishOnboarding(page, "Explore a sample cellar");
});

test("without a key, the sommelier explains what it needs", async ({ page }) => {
  await openSection(page, "Sommelier");
  await expect(pageHeading(page, "Sommelier")).toBeVisible();
  await expect(page.getByText("AI needs your Claude API key")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a key in Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  await expect(page.getByRole("link", { name: "Browse the cellar" })).toBeVisible();
});

test("a mocked sommelier recommends a bottle and a confirmed drink lowers its count", async ({
  page,
}) => {
  // What the sommelier found, for the next scripted reply and the final check.
  let found: { wineId: string; wine: string; lotId: string; bottles: number } | null = null;

  const requests = await mockAnthropic(page, (request): ScriptedReply => {
    // Settings' key check: a plain, non-streaming request.
    if (!request.stream) return { content: [{ type: "text", text: "OK" }] };

    const results = toolResults(request);
    const search = results.get("toolu_search");
    if (search !== undefined) {
      const parsed = JSON.parse(search) as SearchResult;
      const wine = parsed.wines[0];
      const lot = wine?.lots[0];
      if (!wine || !lot) throw new Error(`search_cellar found nothing: ${search}`);
      found = { wineId: wine.wineId, wine: wine.wine, lotId: lot.lotId, bottles: lot.bottles };
      return {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: `Open the ${wine.wine} tonight. Shall I note it down?` },
          {
            type: "tool_use",
            id: "toolu_show",
            name: "show_bottles",
            input: { wineIds: [wine.wineId] },
          },
          {
            type: "tool_use",
            id: "toolu_consume",
            name: "propose_consume",
            input: { lotId: lot.lotId, quantity: 1, occasion: "Friday supper" },
          },
        ],
      };
    }
    if (results.has("toolu_consume")) {
      return { content: [{ type: "text", text: "Done. Enjoy the Monte Bello!" }] };
    }
    return {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me look in your cellar." },
        {
          type: "tool_use",
          id: "toolu_search",
          name: "search_cellar",
          input: { query: "Monte Bello" },
        },
      ],
    };
  });

  // Save a key in Settings; the save runs a key test, and Test key checks it again.
  await openSection(page, "More");
  await page.getByRole("link", { name: /^Settings/ }).click();
  await expect(pageHeading(page, "Settings")).toBeVisible();
  await page.getByLabel("Claude API key").fill(TEST_KEY);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("Your key works.")).toBeVisible();
  await page.getByRole("button", { name: "Test key" }).click();
  await expect(page.getByText("Your key works.")).toBeVisible();
  expect(requests.filter((r) => !r.stream)).toHaveLength(2);

  // Ask the sommelier.
  await openSection(page, "Sommelier");
  await page
    .getByRole("textbox", { name: "Ask the sommelier" })
    .fill("What should I open tonight?");
  await page.getByRole("button", { name: "Send" }).click();

  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("Open the Ridge Monte Bello 2019 tonight.");
  await expect(log.getByText(/Searched cellar/)).toBeVisible();
  await expect(
    log
      .getByRole("list", { name: "Bottles" })
      .getByRole("link", { name: /Ridge Monte Bello 2019/ }),
  ).toBeVisible();

  // Confirm the proposed drink.
  const card = log.getByRole("group").filter({ hasText: "Proposed change" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText("Done", { exact: true })).toBeVisible();
  await expect(toast(page, /Drank 1 bottle of Ridge Monte Bello 2019/)).toBeVisible();
  await expect(log).toContainText("Done. Enjoy the Monte Bello!");

  // The wine page shows one bottle fewer.
  expect(found).not.toBeNull();
  const before = found!.bottles;
  await card.getByRole("link", { name: "Open the wine" }).click();
  await expect(pageHeading(page, "Ridge Monte Bello 2019")).toBeVisible();
  await expectTotalBottles(page, before - 1);
});
