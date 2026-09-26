import { expect, test } from "@playwright/test";
import {
  addByHand,
  cellarRows,
  dismissToast,
  expectTotalBottles,
  finishOnboarding,
  lotGroups,
  openSection,
  pageHeading,
  toast,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await finishOnboarding(page, "Add by hand");
});

test("add by hand, drink one, move one, and undo the move", async ({ page }) => {
  const label = await addByHand(page, {
    producer: "Giacomo Conterno",
    name: "Barolo Cascina Francia",
    vintage: 2016,
    bottles: 3,
    newLocation: "Wine fridge",
  });
  await expect(toast(page, `Added 3 bottles of ${label}`)).toBeVisible();
  await dismissToast(page, `Added 3 bottles of ${label}`);

  // The wine is in the cellar with its 3 bottles.
  await openSection(page, "Cellar");
  await expect(pageHeading(page, "Cellar")).toBeVisible();
  const row = cellarRows(page).filter({ hasText: "Barolo Cascina Francia" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("3");
  await row.click();
  await expect(pageHeading(page, label)).toBeVisible();
  await expectTotalBottles(page, 3);
  await expect(lotGroups(page)).toHaveCount(1);
  await expect(lotGroups(page)).toContainText("Wine fridge");

  // Drink one, with a 4-star rating.
  await page.getByRole("button", { name: "Drink", exact: true }).click();
  const drink = page.getByRole("dialog", { name: "Drink a bottle" });
  const rating = drink.getByRole("slider", { name: "Rating" });
  await rating.focus();
  await rating.press("4");
  await expect(rating).toHaveAttribute("aria-valuetext", "4 out of 5 stars");
  await drink.getByRole("button", { name: "Record drink" }).click();
  await expect(drink).toHaveCount(0);
  await expect(toast(page, `Drank 1 bottle of ${label}`)).toBeVisible();
  await dismissToast(page, `Drank 1 bottle of ${label}`);
  await expectTotalBottles(page, 2);

  // Move one to a new location: two places now hold one bottle each.
  await page.getByRole("button", { name: "Move", exact: true }).click();
  const move = page.getByRole("dialog", { name: "Move bottles" });
  const howMany = move.getByRole("spinbutton", { name: "How many" });
  await howMany.fill("1");
  await howMany.blur();
  await move
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "New location…" });
  await move.getByRole("textbox", { name: "New location name" }).fill("Garage rack");
  await move.getByRole("button", { name: "Move 1 bottle" }).click();
  await expect(move).toHaveCount(0);
  await expect(lotGroups(page)).toHaveCount(2);
  await expect(lotGroups(page).filter({ hasText: "Garage rack" })).toContainText("1 bottle");
  await expect(lotGroups(page).filter({ hasText: "Wine fridge" })).toContainText("1 bottle");

  // Undo the move from its toast: both bottles are back in the wine fridge.
  await toast(page, /^Moved 1 bottle/)
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(lotGroups(page)).toHaveCount(1);
  await expect(lotGroups(page)).toContainText("Wine fridge");
  await expect(lotGroups(page)).toContainText("2 bottles");
  await expectTotalBottles(page, 2);

  // The cellar agrees: 2 bottles left, and the drink is kept.
  await openSection(page, "Cellar");
  await expect(page.getByRole("status").filter({ hasText: "1 wine" })).toContainText("2 bottles");
});

test("search filters the sample cellar", async ({ page }) => {
  await openSection(page, "Cellar");
  await expect(page.getByText("Your cellar is empty")).toBeVisible();
  await page.getByRole("button", { name: "Load the sample cellar" }).click();
  await expect(cellarRows(page).first()).toBeVisible();
  const total = await cellarRows(page).count();
  expect(total).toBeGreaterThan(10);

  const search = page.getByRole("searchbox", { name: "Search your cellar" });
  await search.fill("barolo");
  await expect(cellarRows(page)).toHaveCount(1);
  await expect(cellarRows(page)).toContainText("Giacomo Conterno Barolo Cascina Francia");
  await expect(page.getByText(`1 of ${total} wines`)).toBeVisible();
  await expect(page).toHaveURL(/q=barolo/);

  await search.fill("");
  await expect(cellarRows(page)).toHaveCount(total);
});
