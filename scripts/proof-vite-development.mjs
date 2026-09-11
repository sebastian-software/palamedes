import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cwd = `${root}/examples/react-router-cookie`;
const origin = "http://127.0.0.1:4197";
const catalogPath = `${cwd}/app/locales/de.po`;
const original = readFileSync(catalogPath, "utf8");
const server = spawn(
  "pnpm",
  ["exec", "react-router", "dev", "--host", "127.0.0.1", "--port", "4197"],
  { cwd, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
server.stdout.on("data", (data) => {
  output += data;
});
server.stderr.on("data", (data) => {
  output += data;
});
let browser;
try {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    assert(Date.now() < deadline, output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{ name: "locale", value: "de", url: origin }]);
  const requests = [];
  const page = await context.newPage();
  page.on("request", (request) => requests.push(decodeURIComponent(request.url())));
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto(origin);
  await page.getByTestId("client-ready").waitFor({ state: "attached" });
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.equal(
    await page.locator('script[type="importmap"]').count(),
    0,
    "Dev used a stale build import map",
  );
  const localeRequests = () =>
    requests.filter((url) => /palamedes:messages\/[^/]+\/(en|de|es)(?:\?|$)/u.test(url));
  assert(localeRequests().length > 0, JSON.stringify(requests));
  assert(
    localeRequests().every((url) => /\/de(?:\?|$)/u.test(url)),
    JSON.stringify(localeRequests()),
  );
  const initial = new Set(localeRequests());
  await page.getByTestId("insights-link").click();
  await page.waitForURL("**/insights");
  assert(
    localeRequests().some((url) => !initial.has(url)),
    "Lazy route did not load its own fragment",
  );
  assert(original.includes('msgstr "Sprache"'));
  writeFileSync(
    catalogPath,
    original.replaceAll('msgstr "Sprache"', 'msgstr "Katalog aktualisiert"'),
  );
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByText("Katalog aktualisiert", { exact: true }).first().waitFor();
  console.log(
    "Vite development: active-only initial/lazy delivery and live catalog invalidation passed with a production build present",
  );
} finally {
  writeFileSync(catalogPath, original);
  await browser?.close();
  server.kill("SIGTERM");
}
