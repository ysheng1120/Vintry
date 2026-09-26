import { expect, test, type Locator, type Page } from "@playwright/test";

/** How a journey starts on the last onboarding step ("How do you want to start?"). */
export type StartChoice = "Add by hand" | "Explore a sample cellar";

/** The main navigation (sidebar, or the icon rail in the narrow window). */
export function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Main" });
}

/** Opens one of the five main sections from the navigation. */
export async function openSection(
  page: Page,
  name: "Home" | "Cellar" | "Add wine" | "Sommelier" | "More",
): Promise<void> {
  await mainNav(page).getByRole("link", { name, exact: true }).click();
}

/** The toast region; Undo buttons live here. */
export function toasts(page: Page): Locator {
  return page.getByRole("region", { name: "Notifications" });
}

/** The page's H1. */
export function pageHeading(page: Page, name: string | RegExp): Locator {
  return page.getByRole("heading", { level: 1, name });
}

/**
 * A new browser opens onboarding first (U11). Walks through its steps the quickest way (no
 * install, no key) and picks `start` on the last step.
 */
export async function walkOnboarding(page: Page, start: StartChoice): Promise<void> {
  await page.goto("/");
  await expect(pageHeading(page, "Welcome to Vintry")).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();
  // The install step: carry on in the browser tab.
  await page.getByRole("button", { name: /^(Continue|Not now)$/ }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(pageHeading(page, "How do you want to start?")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(start) }).click();
}

/** Skips the coach-mark tour that starts on Home after onboarding. */
export async function skipTour(page: Page): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/**
 * Finishes onboarding and the tour so the test begins as a returning user. With "Add by hand"
 * the cellar is empty; with the sample cellar it holds the sample wines. Ends on Home.
 */
export async function finishOnboarding(
  page: Page,
  start: StartChoice = "Add by hand",
): Promise<void> {
  await walkOnboarding(page, start);
  if (start === "Add by hand") {
    await expect(pageHeading(page, "Add by hand")).toBeVisible();
    await openSection(page, "Home");
  }
  await skipTour(page);
}

export interface HandAdd {
  producer: string;
  name?: string;
  vintage: number;
  bottles: number;
  /** A new location typed inline. */
  newLocation?: string;
}

/** Adds a wine through Add by hand and waits for its detail page. Returns the wine label. */
export async function addByHand(page: Page, wine: HandAdd): Promise<string> {
  await page.goto("/add/manual");
  await expect(pageHeading(page, "Add by hand")).toBeVisible();
  await page.getByRole("textbox", { name: /Producer/ }).fill(wine.producer);
  if (wine.name) await page.getByRole("textbox", { name: "Wine name" }).fill(wine.name);
  await page.getByRole("textbox", { name: /Vintage/ }).fill(String(wine.vintage));
  const quantity = page.getByRole("spinbutton", { name: "Bottles", exact: true });
  await quantity.fill(String(wine.bottles));
  await quantity.blur(); // the stepper commits its value on blur
  if (wine.newLocation) {
    await page
      .getByRole("combobox", { name: "Location", exact: true })
      .selectOption({ label: "New location…" });
    await page.getByRole("textbox", { name: "New location name" }).fill(wine.newLocation);
  }
  await page.getByRole("button", { name: `Add ${bottlesText(wine.bottles)}` }).click();
  const label = [wine.producer, wine.name, wine.vintage].filter(Boolean).join(" ");
  await expect(pageHeading(page, label)).toBeVisible();
  return label;
}

/** "1 bottle", "3 bottles": how Vintry writes a bottle count. */
export function bottlesText(count: number): string {
  return count === 1 ? "1 bottle" : `${count} bottles`;
}

/**
 * Checks the total bottle count on a wine detail page. The total shows under the wine's name
 * and in the Bottles card; `exact` keeps "2 bottles" from matching "12 bottles".
 */
export async function expectTotalBottles(page: Page, count: number): Promise<void> {
  await expect(
    page.getByRole("main").getByText(bottlesText(count), { exact: true }).first(),
  ).toBeVisible();
}

/** The wine detail page's lot groups, one list item per location. */
export function lotGroups(page: Page): Locator {
  return page.getByRole("list", { name: "Bottles by location" }).getByRole("listitem");
}

/** The cellar list's rows (each row is a link to the wine). */
export function cellarRows(page: Page): Locator {
  return page.getByRole("list", { name: "Wines" }).getByRole("link");
}

/** A toast whose text matches, e.g. /Moved 1 bottle/. */
export function toast(page: Page, text: string | RegExp): Locator {
  return toasts(page).getByRole("listitem").filter({ hasText: text });
}

/**
 * Dismisses a toast. Toasts sit over the bottom-right corner, where an open sheet keeps its
 * buttons, so a journey clears them before it opens a sheet.
 */
export async function dismissToast(page: Page, text: string | RegExp): Promise<void> {
  const item = toast(page, text);
  await item.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(item).toHaveCount(0);
}

/**
 * Runs a spec file in the "chromium" project only (the wide window). For journeys whose
 * behavior does not depend on the window size, so the suite stays fast.
 */
export function wideWindowOnly(reason: string): void {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "chromium", reason);
  });
}
