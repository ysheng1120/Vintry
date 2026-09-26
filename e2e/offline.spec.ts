import { expect, test } from "@playwright/test";
import {
  addByHand,
  dismissToast,
  expectTotalBottles,
  finishOnboarding,
  pageHeading,
  toast,
  wideWindowOnly,
} from "./helpers";

wideWindowOnly("Offline behavior does not depend on the window size.");

/** The browser's navigator, as far as this spec needs it (the e2e tsconfig has no DOM lib). */
type SwNavigator = { serviceWorker: { ready: Promise<unknown>; controller: unknown } };

test("works offline: add and drink a bottle, and the data survives a reload", async ({
  page,
  context,
}) => {
  await finishOnboarding(page, "Add by hand");
  // The service worker installs on the first visit and precaches the app.
  await page.evaluate(async () => {
    await (navigator as unknown as SwNavigator).serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.reload();
  await expect(pageHeading(page, /Home|Good (morning|afternoon|evening)/)).toBeVisible();
  expect(
    await page.evaluate(
      () => (navigator as unknown as SwNavigator).serviceWorker.controller !== null,
    ),
  ).toBe(true);

  const label = await addByHand(page, {
    producer: "Ridge",
    name: "Geyserville",
    vintage: 2021,
    bottles: 2,
  });
  await dismissToast(page, `Added 2 bottles of ${label}`);
  await page.getByRole("button", { name: "Drink", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Drink a bottle" })
    .getByRole("button", { name: "Record drink" })
    .click();
  await expect(toast(page, `Drank 1 bottle of ${label}`)).toBeVisible();
  await expectTotalBottles(page, 1);

  // Still offline: reload and the bottle count and the drink are kept.
  await page.reload();
  await expect(pageHeading(page, label)).toBeVisible();
  await expectTotalBottles(page, 1);
  await expect(page.getByRole("heading", { level: 2, name: "Drinks and notes" })).toBeVisible();

  await context.setOffline(false);
});
