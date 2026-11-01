import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "./ardo-vite.mjs";

const PORT = 4103;
const origin = `http://127.0.0.1:${PORT}`;
const siteRoot = join(import.meta.dirname, "..");
// Ardo's package boundary also applies to Vite's generated dependency modules.
const cacheDir = mkdtempSync(join(siteRoot, ".ardo-dev-cache-"));
const browserExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((path) => path && existsSync(path));
const failures = [];

const server = await createServer({
  root: siteRoot,
  configFile: join(siteRoot, "vite.config.ts"),
  cacheDir,
  server: {
    host: "127.0.0.1",
    port: PORT,
    strictPort: true,
  },
});

let browser;
try {
  await server.listen();
  await warmServerRender();
  browser = await chromium.launch({
    headless: true,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  });
  const page = await browser.newPage();

  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console error: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith(origin)) {
      failures.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("banner").getByRole("link", { name: "Docs", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Documentation" }).waitFor();
  await page.getByRole("banner").getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Search", exact: true });
  await search.getByRole("combobox", { name: "Search" }).fill("First Working Translation");
  await search.getByRole("option").first().waitFor();
  await page.keyboard.press("Escape");
  await search.waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "First Working Translation" }).first().click();
  await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor();

  await page.goBack({ waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Documentation" }).waitFor();
  await page.goForward({ waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor();

  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}

console.log("verify-docs-development: cold-cache docs navigation passed");

/* Prime server rendering outside the browser navigation timeout. The browser
 * still requests every client dependency with a cold cache. */
async function warmServerRender() {
  const started = performance.now();
  const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(180_000) });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`warm-up render of / returned HTTP ${response.status}`);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`verify-docs-development: first server render took ${seconds}s`);
}
