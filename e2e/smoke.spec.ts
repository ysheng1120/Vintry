import { expect, test } from "@playwright/test";

/** The five main sections: nav link name, URL, and the page's H1. */
const SECTIONS = [
  { link: "Cellar", url: /\/cellar$/, heading: "Cellar" },
  { link: "Add wine", url: /\/add$/, heading: "Add wine" },
  { link: "Sommelier", url: /\/sommelier$/, heading: "Sommelier" },
  { link: "More", url: /\/more$/, heading: "More" },
  { link: "Home", url: /\/$/, heading: "Home" },
];

// Runs in both Playwright projects: the wide window (sidebar) and the narrow 1024 × 700 window
// (icon rail below 1100 px).
test("loads the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Vintry");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("navigates the five main sections", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  for (const section of SECTIONS) {
    const link = nav.getByRole("link", { name: section.link, exact: true });
    await link.click();
    await expect(page).toHaveURL(section.url);
    await expect(page.getByRole("heading", { level: 1, name: section.heading })).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
  }
});

test("keyboard shortcuts open Cellar and Add", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { level: 1, name: "Add wine" })).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.getByRole("heading", { level: 1, name: "Cellar" })).toBeVisible();
});

test("unknown pages show a way home", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
});
