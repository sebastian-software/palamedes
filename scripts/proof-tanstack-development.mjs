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

async function runCatalogFailureCase({ browser, phase, failure }) {
  console.log(`TanStack development ${phase} ${failure}: starting`);
  const context = await browser.newContext();
  await context.addCookies([{ name: "locale", value: "de", url: origin }]);
  const requests = [];
  const initialSidecars = new Set();
  const catalogRequests = new Set();
  let armed = phase === "initial";
  let injected = false;
  const sidecarPattern = /@id\/__x00__palamedes:messages\/[^/]+\/(en|de|es)(?:$|\?)/u;

  await context.route("**/*", async (route) => {
    const request = route.request();
    requests.push(request.url());
    const match = request.url().match(sidecarPattern);
    if (!match) return route.continue();
    assert.equal(match[1], "de", `${phase} ${failure}: inactive locale requested`);
    catalogRequests.add(request.url());
    if (!armed || (phase === "lazy" && initialSidecars.has(request.url())) || injected) {
      if (!armed) initialSidecars.add(request.url());
      return route.continue();
    }
    injected = true;
    if (failure === "network") return route.abort("failed");
    const response = await route.fetch();
    const source = await response.text();
    const headers = { ...response.headers() };
    delete headers.etag;
    delete headers["last-modified"];
    delete headers["content-length"];
    return route.fulfill({
      response,
      headers,
      body: `${source}\n;throw new Error("INJECTED_DEV_CATALOG_FAILURE");\n`,
    });
  });

  try {
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    assert.equal(
      await page.locator("html").getAttribute("data-tanstack-lazy-body"),
      null,
      `${phase} ${failure}: lazy module evaluated before interaction`,
    );
    if (phase === "lazy") {
      await page.getByTestId("client-ready").waitFor({ state: "attached" });
      assert.equal(await page.getByTestId("lazy-feature").count(), 0);
      const requestsBeforeClick = new Set(catalogRequests);
      armed = true;
      await page.getByTestId("lazy-feature-trigger").click();
      await page.locator('main[role="alert"]').waitFor({ state: "visible" });
      assert(
        [...catalogRequests].some((url) => !requestsBeforeClick.has(url)),
        `${phase} ${failure}: no post-mount catalog request`,
      );
    } else {
      try {
        await page.locator('main[role="alert"]').waitFor({ state: "visible", timeout: 5000 });
      } catch (error) {
        console.error(
          `TanStack development ${phase} ${failure} body:`,
          await page.locator("body").innerText(),
        );
        throw error;
      }
    }
    assert(injected, `${phase} ${failure}: no catalog request was faulted`);
    assert.match(await page.locator('main[role="alert"]').innerText(), /Reload page/u);
    assert.equal(
      await page.locator("html").getAttribute("data-tanstack-lazy-body"),
      null,
      `${phase} ${failure}: failed import evaluated lazy module`,
    );

    // Keep the interceptor installed during recovery. This prevents a stale
    // ETag/browser cache from masking a successful retry of the same URL.
    armed = false;
    await page.locator('main[role="alert"]').getByText("Reload page", { exact: true }).click();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator('main[role="alert"]').count(), 0);
    assert.match(await page.locator("body").innerText(), /Frontend Stage/u);
    if (phase === "lazy") {
      await page.getByTestId("lazy-feature-trigger").click();
      await page.getByTestId("lazy-feature").waitFor({ state: "visible" });
      assert.equal(await page.locator("html").getAttribute("data-tanstack-lazy-body"), "executed");
    }
    console.log(`TanStack development ${phase} ${failure}: failure and recovery passed`);
  } finally {
    await context.close();
  }
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

  for (const phase of ["initial", "lazy"])
    for (const failure of ["network", "evaluation"])
      await runCatalogFailureCase({ browser, phase, failure });

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
