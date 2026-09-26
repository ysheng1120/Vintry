import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const isCI = !!process.env.CI;

/**
 * Locally, the sandbox may ship a preinstalled Chromium whose revision differs from the one this
 * @playwright/test release expects. If the expected binary is missing, fall back to the newest
 * Chromium under PLAYWRIGHT_BROWSERS_PATH instead of requiring `playwright install`.
 * In CI the matching browser is installed, so this always resolves to undefined there.
 */
function fallbackChromium(): string | undefined {
  if (isCI || existsSync(chromium.executablePath())) return undefined;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .flatMap((d) => [
      join(root, d, "chrome-linux", "chrome"),
      join(root, d, "chrome-linux64", "chrome"),
    ]);
  return candidates.find((p) => existsSync(p));
}

const executablePath = fallbackChromium();
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      // Smaller desktop window (small laptops, split-screen). Desktop-only target: no mobile devices.
      name: "narrow",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 700 }, launchOptions },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
