// Starts Vintry on this computer: installs what it needs, builds when the code changed,
// serves the app on a fixed local address, and opens it in the browser.
// Used by "Start Vintry.command" (macOS) and "Start Vintry.bat" (Windows).
// Set VINTRY_NO_OPEN=1 to skip opening the browser (used by the CI smoke check).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 47821; // Keep in sync with LAUNCHER_PORT in src/config/securityHeaders.ts.
const URL = `http://localhost:${PORT}/`;
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const say = (text) => console.log(`  ${text}`);

function fail(text) {
  console.error(`\n  Vintry could not start: ${text}\n`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: isWindows });
  return result.status === 0;
}

function newestChange(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = info.mtimeMs;
  for (const entry of readdirSync(path)) newest = Math.max(newest, newestChange(join(path, entry)));
  return newest;
}

function needsInstall() {
  const marker = join(ROOT, "node_modules", ".package-lock.json");
  return (
    !existsSync(marker) || newestChange(join(ROOT, "package-lock.json")) > newestChange(marker)
  );
}

function needsBuild() {
  const built = join(ROOT, "dist", "index.html");
  if (!existsSync(built)) return true;
  const sources = ["src", "public", "index.html", "package.json", "vite.config.ts"];
  const newestSource = Math.max(...sources.map((s) => newestChange(join(ROOT, s))));
  return newestSource > statSync(built).mtimeMs;
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: "localhost" });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function isVintryRunning() {
  try {
    // A program that accepts the connection but never answers must not hang the launcher.
    const response = await fetch(URL, { signal: AbortSignal.timeout(3000) });
    return (await response.text()).includes("<title>Vintry");
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.VINTRY_NO_OPEN) return;
  if (isWindows) spawn("cmd", ["/c", "start", "", URL], { detached: true, stdio: "ignore" });
  else if (process.platform === "darwin") spawn("open", [URL], { detached: true, stdio: "ignore" });
  else spawn("xdg-open", [URL], { detached: true, stdio: "ignore" });
}

console.log("\n  Starting Vintry...\n");

// The minimum Node version comes from package.json "engines" (for example ">=22.22").
const engines = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).engines?.node ?? "";
const [minMajor = 0, minMinor = 0] = (engines.match(/\d+(\.\d+)?/)?.[0] ?? "0")
  .split(".")
  .map(Number);
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < minMajor || (major === minMajor && minor < minMinor)) {
  fail(
    `Vintry needs Node.js ${minMajor}.${minMinor} or newer, and this computer has ${process.versions.node}. ` +
      "Install the LTS version from https://nodejs.org/en/download and try again.",
  );
}

if (await portInUse()) {
  if (await isVintryRunning()) {
    say(`Vintry is already running. Opening ${URL}`);
    openBrowser();
    process.exit(0);
  }
  fail(`another program is using port ${PORT}. Close it and try again.`);
}

if (needsInstall()) {
  say("First run: getting everything Vintry needs (this takes a minute or two)...");
  if (!run(npm, ["ci", "--no-audit", "--no-fund"]))
    fail("the install step failed. Check your internet connection and try again.");
}

if (needsBuild()) {
  say("Preparing the app...");
  if (!run(npm, ["run", "build"])) fail("the build step failed. See the messages above.");
}

say(`Vintry is running at ${URL}`);
say("Keep this window open while you use Vintry. Close it to stop Vintry.\n");

const server = spawn(npm, ["run", "preview", "--", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  stdio: ["ignore", "ignore", "inherit"],
  shell: isWindows,
});
server.on("exit", (code) => process.exit(code ?? 0));

for (let attempt = 0; attempt < 50; attempt += 1) {
  if (await portInUse()) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
openBrowser();
