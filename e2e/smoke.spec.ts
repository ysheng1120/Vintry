import { expect, test } from "@playwright/test";

test("loads the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Vintry");
  await expect(page.getByRole("heading", { level: 1, name: "Vintry" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
});
