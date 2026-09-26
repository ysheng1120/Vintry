import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  cellarRows,
  finishOnboarding,
  openSection,
  pageHeading,
  toast,
  wideWindowOnly,
} from "./helpers";

const CELLARTRACKER_CSV = fileURLToPath(new URL("./fixtures/cellartracker.csv", import.meta.url));

wideWindowOnly("Files and downloads behave the same in both window sizes.");

/** The cellar's status line, e.g. "3 wines · 6 bottles". */
function cellarSummary(page: Page) {
  return page
    .getByRole("main")
    .getByRole("status")
    .filter({ hasText: /wines?\b/ });
}

async function openBackup(page: Page) {
  await openSection(page, "More");
  await page.getByRole("link", { name: /Backup & restore/ }).click();
  await expect(pageHeading(page, "Backup & restore")).toBeVisible();
}

test("import a CellarTracker file, back it up, erase everything, and restore", async ({ page }) => {
  await finishOnboarding(page, "Add by hand");

  // Import: the preset is detected, the preview lists the rows, and the import adds them.
  await page.goto("/import");
  await expect(pageHeading(page, "Import")).toBeVisible();
  await page.getByLabel("CSV, TSV, or text file to import").setInputFiles(CELLARTRACKER_CSV);
  await expect(page.getByText("Detected format:")).toContainText("CellarTracker");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByText("3 wines will be added.")).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Château Margaux");
  await page.getByRole("button", { name: "Import 3 wines" }).click();
  await page.getByRole("link", { name: "Go to cellar" }).click();

  // The windows-1252 file shows its accents correctly.
  await expect(pageHeading(page, "Cellar")).toBeVisible();
  await expect(cellarRows(page)).toHaveCount(3);
  await expect(cellarRows(page).filter({ hasText: "Château Margaux" })).toHaveCount(1);
  await expect(cellarRows(page).filter({ hasText: "Domaine de la Côte-Rôtie" })).toHaveCount(1);
  const before = (await cellarSummary(page).textContent())?.trim();
  expect(before).toMatch(/^3 wines · 6 bottles$/);

  // Export a backup file.
  await openBackup(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const backupPath = test.info().outputPath("backup.json");
  await download.saveAs(backupPath);
  await expect(toast(page, "Backup exported")).toBeVisible();

  // Delete all data, with the typed confirmation.
  await page.getByRole("button", { name: "Delete all data" }).click();
  const wipe = page.getByRole("alertdialog", { name: "Delete all data on this device?" });
  const deleteButton = wipe.getByRole("button", { name: "Delete everything" });
  await expect(deleteButton).toBeDisabled();
  await wipe.getByRole("textbox", { name: 'Type "DELETE" to confirm' }).fill("DELETE");
  await deleteButton.click();
  await expect(wipe).toHaveCount(0);
  await openSection(page, "Cellar");
  await expect(page.getByText("Your cellar is empty")).toBeVisible();

  // Restore from the file, with the typed confirmation.
  await openBackup(page);
  await page.getByLabel("Vintry backup file to restore").setInputFiles(backupPath);
  const restore = page.getByRole("alertdialog", { name: "Replace all data with this backup?" });
  await restore.getByRole("textbox", { name: 'Type "REPLACE" to confirm' }).fill("REPLACE");
  await restore.getByRole("button", { name: "Replace data" }).click();
  await expect(restore).toHaveCount(0);
  await expect(toast(page, "Restored a backup")).toBeVisible();

  // The same cellar is back.
  await openSection(page, "Cellar");
  await expect(cellarRows(page)).toHaveCount(3);
  await expect(cellarSummary(page)).toHaveText(before ?? "");
  await expect(cellarRows(page).filter({ hasText: "Château Margaux" })).toHaveCount(1);
});
