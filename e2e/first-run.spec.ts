import { expect, test } from "@playwright/test";
import { pageHeading, walkOnboarding } from "./helpers";

// Success Criteria: a new user with the sample cellar reaches a wine detail screen within 60
// seconds of first launch. The whole journey must fit in the test's own 60 s budget.
test.setTimeout(60_000);

test("a new user explores the sample cellar and opens a wine", async ({ page }) => {
  const started = Date.now();

  await walkOnboarding(page, "Explore a sample cellar");

  // Home greets the collector and shows the sample wines in its sections.
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("main").getByText(/You have \d+ bottles across \d+ wines/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Ready now" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Recently added" })).toBeVisible();

  // The tour walks through the five sections; finish it.
  const tour = page.getByRole("dialog");
  await expect(tour.getByRole("heading", { name: "Home" })).toBeVisible();
  for (const next of ["Cellar", "Add wine", "Sommelier", "More"]) {
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByRole("heading", { name: next })).toBeVisible();
  }
  await tour.getByRole("button", { name: "Done" }).click();
  await expect(tour).toHaveCount(0);

  // Open a wine from Home.
  await page
    .getByRole("main")
    .getByRole("link", { name: /Ridge Monte Bello 2019/ })
    .first()
    .click();
  await expect(pageHeading(page, "Ridge Monte Bello 2019")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Wine actions" })).toBeVisible();

  expect(Date.now() - started).toBeLessThan(60_000);
});
