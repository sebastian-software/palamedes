import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const PORT = 4103;
const origin = `http://127.0.0.1:${PORT}`;
const cacheDir = mkdtempSync(join(tmpdir(), "palamedes-vite-cache-"));
const siteRoot = join(import.meta.dirname, "..");
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

/*
 * The dev server answers its first document request only after it has compiled
 * every route module, including more than 160 generated Markdown routes. That
 * takes 12-14 s on a fast laptop and reached the 30 s Playwright navigation
 * timeout on CI runners. Pay that server-side cost once with a plain request,
 * outside the browser timeout. The client dependency cache stays cold: the
 * browser steps still request every client module, and discover any
 * late dependency, for the first time.
 */
async function warmServerRender() {
  const started = performance.now();
  const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(180_000) });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`warm-up render of / returned HTTP ${response.status}`);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`verify-docs-development: first server render took ${seconds}s`);
}
