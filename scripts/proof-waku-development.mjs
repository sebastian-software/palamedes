import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { ensurePortFree, startCommand, stopCommand } from "./example-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cwd = `${root}/examples/waku-cookie`;
const origin = "http://localhost:4198";
const catalogPath = `${cwd}/src/locales/de.po`;
const original = readFileSync(catalogPath, "utf8");

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Waku development server did not start");
}

await ensurePortFree(4198);
const server = startCommand({
  args: ["exec", "waku", "dev", "--port", "4198"],
  cwd,
  env: { NODE_ENV: "development", PORT: "4198" },
});
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{ name: "locale", value: "de", url: origin }]);
  const requests = [];
  let page = await context.newPage();
  page.on("request", (request) => requests.push(decodeURIComponent(request.url())));
  const catalogRequests = () =>
    requests.filter((url) => /palamedes:messages\/[^/]+\/de(?:[/?#]|$)/u.test(url));

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("client-ready").waitFor({ state: "attached", timeout: 15_000 });
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.equal(await page.locator('script[type="importmap"]').count(), 0);
  assert(
    catalogRequests().length > 0,
    `development did not request a locale catalog: ${JSON.stringify(requests)}`,
  );
  const initial = new Set(catalogRequests());

  await page.getByRole("button", { name: "Show lazy catalog details" }).click();
  await page.getByTestId("lazy-catalog-details").waitFor({ timeout: 15_000 });
  assert(
    catalogRequests().some((url) => !initial.has(url)),
    "development lazy navigation did not request a new catalog fragment",
  );

  assert(original.includes('msgstr "Sprache"'));
  await page.close();
  writeFileSync(
    catalogPath,
    original.replaceAll('msgstr "Sprache"', 'msgstr "Katalog aktualisiert"'),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page
    .getByText("Katalog aktualisiert", { exact: true })
    .first()
    .waitFor({ timeout: 15_000 });
  console.log("Waku development: active locale, lazy catalog loading and PO invalidation passed");
  await context.close();
} finally {
  writeFileSync(catalogPath, original);
  await browser?.close();
  await stopCommand(server);
}
