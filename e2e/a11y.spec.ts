import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { cellarRows, finishOnboarding, openSection, pageHeading } from "./helpers";

// Success Criteria: no serious or critical axe-core violations on Home, Cellar, Wine detail,
// Add and Scan, Sommelier, and the welcome flow.

// Settled rendering: no entrance animations half-way through when axe measures contrast.
test.use({ reducedMotion: "reduce" });

/** Runs axe on the page and fails with a readable list of serious or critical violations. */
async function expectNoSeriousViolations(page: Page, screen: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      screen,
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`),
    }));
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("the welcome flow has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(pageHeading(page, "Welcome to Vintry")).toBeVisible();
  await expectNoSeriousViolations(page, "Welcome");

  await page.getByRole("button", { name: "Get started" }).click();
  await expect(pageHeading(page, /Install Vintry|Add Vintry to your Dock/)).toBeVisible();
  await expectNoSeriousViolations(page, "Install step");

  await page.getByRole("button", { name: /^(Continue|Not now)$/ }).click();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await expectNoSeriousViolations(page, "Key step");

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(pageHeading(page, "How do you want to start?")).toBeVisible();
  await expectNoSeriousViolations(page, "Start step");
});

test.describe("main screens with the sample cellar", () => {
  test.beforeEach(async ({ page }) => {
    await finishOnboarding(page, "Explore a sample cellar");
  });

  test("Home", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 2, name: "Ready now" })).toBeVisible();
    await expectNoSeriousViolations(page, "Home");
  });

  test("Cellar and Wine detail", async ({ page }) => {
    await openSection(page, "Cellar");
    await expect(cellarRows(page).first()).toBeVisible();
    await expectNoSeriousViolations(page, "Cellar");

    await cellarRows(page).filter({ hasText: "Monte Bello" }).click();
    await expect(pageHeading(page, "Ridge Monte Bello 2019")).toBeVisible();
    await expectNoSeriousViolations(page, "Wine detail");
  });

  test("Add hub and Scan", async ({ page }) => {
    await openSection(page, "Add wine");
    await expect(pageHeading(page, "Add wine")).toBeVisible();
    await expectNoSeriousViolations(page, "Add hub");

    await page.goto("/add/scan");
    await expect(pageHeading(page, "Scan a label")).toBeVisible();
    await expectNoSeriousViolations(page, "Scan");
  });

  test("Sommelier", async ({ page }) => {
    await openSection(page, "Sommelier");
    await expect(pageHeading(page, "Sommelier")).toBeVisible();
    await expectNoSeriousViolations(page, "Sommelier");
  });
});
