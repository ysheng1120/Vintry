import { expect, test } from "@playwright/test";
import { mockAnthropic, type ScriptedReply } from "./anthropicMock";
import {
  addByHand,
  cellarRows,
  dismissToast,
  expectTotalBottles,
  finishOnboarding,
  openSection,
  pageHeading,
  toast,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await finishOnboarding(page, "Add by hand");
});

test("merges a duplicate wine, then undoes it from the toast", async ({ page }) => {
  const wine1 = await addByHand(page, {
    producer: "Domaine Leflaive",
    name: "Wine One",
    vintage: 2018,
    bottles: 4,
  });
  await dismissToast(page, `Added 4 bottles of ${wine1}`);
  const wine2 = await addByHand(page, {
    producer: "Domaine Leflaive",
    name: "Wine Two",
    vintage: 2018,
    bottles: 7,
  });
  await dismissToast(page, `Added 7 bottles of ${wine2}`);

  // Open the first wine and merge the second (its likely duplicate) into it.
  await openSection(page, "Cellar");
  await cellarRows(page).filter({ hasText: "Wine One" }).click();
  await expect(pageHeading(page, wine1)).toBeVisible();
  await expectTotalBottles(page, 4);

  await page.getByRole("button", { name: "Merge with another wine" }).click();
  const merge = page.getByRole("dialog", { name: "Merge with another wine" });
  await expect(merge).toBeVisible();
  await merge.getByRole("button", { name: wine2 }).click();
  await expect(merge).toContainText(`${wine2} is then deleted`);
  await merge.getByRole("button", { name: "Merge wines" }).click();
  await expect(merge).toHaveCount(0);

  await expect(toast(page, `Merged 2 wines: ${wine1}`)).toBeVisible();
  await expectTotalBottles(page, 11);

  // The duplicate is gone from the cellar.
  await openSection(page, "Cellar");
  await expect(cellarRows(page).filter({ hasText: "Wine Two" })).toHaveCount(0);
  await expect(cellarRows(page).filter({ hasText: "Wine One" })).toHaveCount(1);

  // Undo from the toast brings it back, bottles and all.
  await toast(page, `Merged 2 wines: ${wine1}`).getByRole("button", { name: "Undo" }).click();
  await expect(cellarRows(page).filter({ hasText: "Wine Two" })).toHaveCount(1);
  await expect(cellarRows(page).filter({ hasText: "Wine One" })).toHaveCount(1);
});

test("locations show their bins, and a bin's wine link opens the wine page", async ({ page }) => {
  await openSection(page, "Cellar");
  await page.getByRole("button", { name: "Load the sample cellar" }).click();

  await openSection(page, "More");
  await page.getByRole("link", { name: /^Locations/ }).click();
  await expect(pageHeading(page, "Locations")).toBeVisible();

  const row = page.getByRole("list", { name: "Locations" }).getByRole("listitem");
  const euroCave = row.filter({ hasText: "EuroCave A" });
  await euroCave.getByRole("button", { name: "Show contents" }).click();
  await expect(euroCave.getByRole("heading", { level: 3, name: "A1" })).toBeVisible();

  const wineLink = euroCave.getByRole("link", { name: "Ridge Monte Bello 2019" });
  await expect(wineLink).toBeVisible();
  await wineLink.click();
  await expect(pageHeading(page, "Ridge Monte Bello 2019")).toBeVisible();
});

test("buy again adds a real wine to the wishlist", async ({ page }) => {
  const label = await addByHand(page, {
    producer: "Clos Apalta",
    name: "Reserve",
    vintage: 2021,
    bottles: 2,
  });
  await dismissToast(page, `Added 2 bottles of ${label}`);

  await page.getByRole("button", { name: "Buy again" }).click();
  const wishlistLink = page.getByRole("link", { name: "On your wishlist" });
  await expect(wishlistLink).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy again" })).toHaveCount(0);

  await wishlistLink.click();
  await expect(pageHeading(page, "Wishlist")).toBeVisible();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
});

test("drinking a bottle shows up in Stats' Year in wine", async ({ page }) => {
  const label = await addByHand(page, {
    producer: "Test Cellar Co",
    name: "Vin de Test",
    vintage: 2020,
    bottles: 1,
  });
  await dismissToast(page, `Added 1 bottle of ${label}`);

  await page.getByRole("button", { name: "Drink", exact: true }).click();
  const drink = page.getByRole("dialog", { name: "Drink a bottle" });
  await drink.getByRole("button", { name: "Record drink" }).click();
  await expect(drink).toHaveCount(0);
  await dismissToast(page, `Drank 1 bottle of ${label}`);

  await openSection(page, "More");
  await page.getByRole("link", { name: /^Stats/ }).click();
  await expect(pageHeading(page, "Stats")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Year in wine" })).toBeVisible();
  const yearSection = page.locator("section:has(#year-in-wine-heading)");
  const drunkStat = yearSection.getByText("Bottles drunk", { exact: true }).locator("xpath=..");
  await expect(drunkStat).toContainText("1 bottle");
});

test.describe("About this wine, with a mocked Anthropic API", () => {
  // A service worker could answer requests before page.route sees them; the mock must see all.
  test.use({ serviceWorkers: "block" });

  const TEST_KEY = "sk-ant-test-e2e-collector-0000";
  const PROFILE = {
    summary:
      "Domaine Ott crafts refined, structured Provençal rosé, blending Grenache, Cinsault, and Syrah into pale, dry wines built for cellaring.",
    tasting: "Typically shows ripe strawberry and white flower aromas, with a crisp, dry finish.",
    pairings: ["Grilled fish", "Bouillabaisse", "Fresh goat cheese", "Niçoise salad"],
    serving: "Serve at 8 to 10°C; no decanting needed.",
  };

  test("writes a profile and shows it on the wine page", async ({ page }) => {
    const label = await addByHand(page, {
      producer: "Domaine Ott",
      name: "Rosé",
      vintage: 2022,
      bottles: 1,
    });
    await dismissToast(page, `Added 1 bottle of ${label}`);

    await mockAnthropic(page, (request): ScriptedReply => {
      if (request.stream) throw new Error("This journey makes no streaming request.");
      const last = request.messages.at(-1);
      const text = typeof last?.content === "string" ? last.content : "";
      if (text.includes("Reply with the single word OK")) {
        return { content: [{ type: "text", text: "OK" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(PROFILE) }] };
    });

    await openSection(page, "More");
    await page.getByRole("link", { name: /^Settings/ }).click();
    await expect(pageHeading(page, "Settings")).toBeVisible();
    await page.getByLabel("Claude API key").fill(TEST_KEY);
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByText("Your key works.")).toBeVisible();

    await openSection(page, "Cellar");
    await cellarRows(page).filter({ hasText: "Domaine Ott" }).click();
    await expect(pageHeading(page, label)).toBeVisible();

    // One card, one heading, two stacked sections (KTD5).
    await expect(page.getByRole("heading", { level: 2, name: "About this wine" })).toBeVisible();
    for (const section of ["Profile", "What others (excl. Parker) say"]) {
      await expect(page.getByRole("heading", { level: 3, name: section })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Find what others say" })).toBeEnabled();

    await page.getByRole("button", { name: "Write a profile" }).click();
    await expect(page.getByText(PROFILE.summary)).toBeVisible();
    await expect(page.getByText("Grilled fish")).toBeVisible();
    await expect(page.getByText(/Written by AI/)).toBeVisible();
    await dismissToast(page, /Wrote a profile/);

    await page.getByRole("button", { name: "Remove profile" }).click();
    await expect(page.getByRole("button", { name: "Write a profile" })).toBeVisible();
    await toast(page, /Removed the profile/)
      .getByRole("button", { name: "Undo" })
      .click();
    await expect(page.getByText(PROFILE.summary)).toBeVisible();
    await expect(page.getByRole("button", { name: "Rewrite profile" })).toBeVisible();
  });
});
