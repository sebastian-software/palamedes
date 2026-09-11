import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { EXAMPLE_MATRIX } from "./example-matrix.mjs";
import { startCommand, stopCommand } from "./example-process.mjs";

const example = EXAMPLE_MATRIX.find(({ id }) => id === "tanstack-cookie");
assert(example, "tanstack-cookie is missing from the example matrix");
const origin = `http://127.0.0.1:${example.port}`;
const catalogPath = path.join(example.cwd, "src/locales/de.po");
const originalCatalog = fs.readFileSync(catalogPath, "utf8");
const updatedCatalog = originalCatalog.replaceAll(
  'msgstr "Sprache"',
  'msgstr "Katalog aktualisiert"',
);
assert.notEqual(updatedCatalog, originalCatalog, "German invalidation marker is missing");
const server = startCommand({
  args: ["dev", "--host", "127.0.0.1", "--port", String(example.port)],
  cwd: example.cwd,
});
let browser;

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`TanStack development server did not start on ${origin}`);
}

async function waitForUpdatedSidecar(urls) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const url of urls) {
      const body = await fetch(url).then((response) => response.text());
      if (body.includes("Katalog aktualisiert")) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`TanStack development sidecar did not invalidate: ${urls.join(", ")}`);
}

try {
  await waitForServer();
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  );
  const context = await browser.newContext();
  await context.addCookies([{ name: "locale", value: "de", url: origin }]);
  const requests = [];
  const page = await context.newPage();
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("client-ready").waitFor({ state: "attached" });

  const sidecarPattern = /@id\/__x00__palamedes:messages\/[^/]+\/(en|de|es)(?:$|\?)/u;
  const sidecars = requests.filter((url) => sidecarPattern.test(url));
  assert(
    sidecars.length > 0,
    `No development catalog sidecars were requested: ${requests.join("\n")}`,
  );
  assert(
    sidecars.every((url) => /\/de(?:$|\?)/u.test(url)),
    sidecars.join("\n"),
  );

  fs.writeFileSync(catalogPath, updatedCatalog);
  await waitForUpdatedSidecar([...new Set(sidecars)]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Katalog aktualisiert", { exact: true }).first().waitFor();
  console.log("TanStack development: active-only sidecars and catalog invalidation passed");
  await context.close();
} finally {
  fs.writeFileSync(catalogPath, originalCatalog);
  await browser?.close();
  await stopCommand(server);
}
