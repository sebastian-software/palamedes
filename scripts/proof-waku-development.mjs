import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { ensurePortFree, startCommand, stopCommand } from "./example-process.mjs";
import { createPackedWakuConsumer } from "./proof-waku-packed-consumer.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packed = process.argv.includes("--packed") ? createPackedWakuConsumer(root) : undefined;
const cwd = packed?.directory ?? `${root}/examples/waku-cookie`;
const origin = "http://localhost:4198";
const catalogPath = `${cwd}/src/locales/de.po`;
const original = readFileSync(catalogPath, "utf8");

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Waku development server exited with code ${server.exitCode}`);
    }
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Waku development server did not start");
}

async function verifyFailure(browser, locale, phase, failure) {
  const context = await browser.newContext();
  await context.addCookies([{ name: "locale", value: locale, url: origin }]);
  let armed = phase === "initial";
  let injected = false;
  const requested = [];
  await context.route("**/*", async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!/palamedes:messages\/[^/]+\/(?:en|de|es)(?:[/?#]|$)/u.test(url)) {
      return route.continue();
    }
    requested.push(url);
    assert.match(url, new RegExp(`/${locale}(?:[/?#]|$)`, "u"));
    if (armed && failure === "network") {
      injected = true;
      return route.abort("failed");
    }
    const response = await route.fetch();
    const source = await response.text();
    const headers = { ...response.headers(), "cache-control": "no-store" };
    delete headers.etag;
    delete headers["last-modified"];
    delete headers["content-length"];
    if (!armed) return route.fulfill({ response, headers, body: source });
    injected = true;
    // Keep the real generated exports. The failure must occur during native
    // module evaluation, not while linking a deliberately missing export.
    return route.fulfill({
      response,
      headers,
      body: `${source}\nthrow new Error("WAKU_DEV_CATALOG_EVALUATION");\n`,
    });
  });
  const page = await context.newPage();
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    if (phase === "lazy") {
      await page.getByTestId("client-ready").waitFor({ state: "attached" });
      assert.equal(
        await page.evaluate(() => Boolean(globalThis.__palamedesWakuLazyCatalogBody)),
        false,
      );
      armed = true;
      await page.getByRole("button", { name: "Show lazy catalog details" }).click();
      await page
        .locator("[data-testid=lazy-catalog-error], [data-palamedes-catalog-error]")
        .first()
        .waitFor();
    } else {
      await page.locator("[data-palamedes-catalog-error]").waitFor();
      assert.equal(await page.getByTestId("client-ready").count(), 0);
    }
    assert(injected, `${locale} ${phase} ${failure} did not reject a catalog dependency`);
    assert.equal(await page.getByTestId("lazy-catalog-details").count(), 0);
    assert.equal(
      await page.evaluate(() => Boolean(globalThis.__palamedesWakuLazyCatalogBody)),
      false,
    );
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /WAKU_DEV_CATALOG|MissingCompiled|palamedes:messages|\{[^}]*plural/u,
    );
    armed = false;
    await page.getByText("Reload page", { exact: true }).click();
    await page.getByTestId("client-ready").waitFor({ state: "attached" });
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    await page.getByRole("button", { name: "Show lazy catalog details" }).click();
    await page.getByTestId("lazy-catalog-details").waitFor();
    assert.equal(
      await page.evaluate(() => Boolean(globalThis.__palamedesWakuLazyCatalogBody)),
      true,
    );
    assert(requested.length > 0);
    console.log(
      `Waku development ${locale} ${phase} ${failure}: dependency rejection, generic UI and reload recovery passed`,
    );
  } finally {
    await context.close();
  }
}

const localeProofs = {
  en: {
    heading: "Book your seat at Frontend Stage 2026",
    action: "Server action confirmed locale en.",
    helper: "Cross-module server-action helper confirmed locale.",
    lazy: "Lazy catalog detail loaded.",
  },
  de: {
    heading: "Sichere dir deinen Platz bei Frontend Stage 2026",
    action: "Server-Action bestätigte Sprache de.",
    helper: "Modulübergreifender Serveraktionshelfer bestätigte Sprache.",
    lazy: "Lazy-Katalogdetail geladen.",
  },
};

async function verifyInstalledRuntime(browser) {
  // Overlapping HTTP documents and server actions exercise the installed
  // adapter's request-store identity, not just its package exports.
  await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const locale = index % 2 === 0 ? "en" : "de";
      const response = await fetch(origin, { headers: { cookie: `locale=${locale}` } });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`, "u"));
      assert(html.includes(localeProofs[locale].heading), `${locale} SSR used the wrong catalog`);
    }),
  );
  await Promise.all(
    Object.entries(localeProofs).map(async ([locale, proof]) => {
      const context = await browser.newContext();
      await context.addCookies([{ name: "locale", value: locale, url: origin }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        await page.getByTestId("client-ready").waitFor({ state: "attached" });
        await expect(page.getByTestId("server-proof-message")).toHaveText(proof.action);
        await expect(page.getByTestId("server-proof-cross-module")).toHaveText(proof.helper);
        await page.evaluate(() => {
          globalThis.__packedWakuNavigation = "retained";
        });
        await page.getByTestId("packed-next").click();
        await page.waitForURL(`${origin}/packed-proof`);
        await page.getByRole("heading", { name: proof.heading, exact: true }).waitFor();
        assert.equal(await page.evaluate(() => globalThis.__packedWakuNavigation), "retained");
        await page.getByRole("button", { name: "Show lazy catalog details" }).click();
        assert.equal(await page.getByTestId("lazy-catalog-details").textContent(), proof.lazy);
        await page.getByTestId("packed-home").click();
        await page.waitForURL(`${origin}/`);
        await page.getByRole("heading", { name: proof.heading, exact: true }).waitFor();
        assert.equal(await page.evaluate(() => globalThis.__packedWakuNavigation), "retained");
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }),
  );
  console.log(
    "Waku packed development: concurrent SSR/actions, locale isolation and client navigation passed",
  );
}

await ensurePortFree(4198);
// Invoke the installed CLI directly so pnpm's pre-exec dependency repair cannot
// replace the just-verified archive installation before the runtime proof.
const server = packed
  ? spawn(process.execPath, [`${cwd}/node_modules/waku/cli.js`, "dev", "--port", "4198"], {
      cwd,
      detached: process.platform !== "win32",
      env: { ...process.env, NODE_ENV: "development", PORT: "4198" },
      stdio: "inherit",
    })
  : startCommand({
      args: ["exec", "waku", "dev", "--port", "4198"],
      cwd,
      env: { NODE_ENV: "development", PORT: "4198" },
    });
let browser;
try {
  await waitForServer(server);
  browser = await chromium.launch();
  if (packed) await verifyInstalledRuntime(browser);
  const context = await browser.newContext();
  await context.addCookies([{ name: "locale", value: "de", url: origin }]);
  const requests = [];
  let page = await context.newPage();
  page.on("request", (request) => requests.push(decodeURIComponent(request.url())));
  const allCatalogRequests = () =>
    requests.filter((url) => /palamedes:messages\/[^/]+\/(?:en|de|es)(?:[/?#]|$)/u.test(url));

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("client-ready").waitFor({ state: "attached", timeout: 15_000 });
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.equal(await page.locator('script[type="importmap"]').count(), 0);
  assert(
    allCatalogRequests().length > 0,
    `development did not request a locale catalog: ${JSON.stringify(requests)}`,
  );
  assert(allCatalogRequests().every((url) => /\/de(?:[/?#]|$)/u.test(url)));
  const initial = new Set(allCatalogRequests());

  await page.getByRole("button", { name: "Show lazy catalog details" }).click();
  await page.getByTestId("lazy-catalog-details").waitFor({ timeout: 15_000 });
  assert(
    allCatalogRequests().some((url) => !initial.has(url)),
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
  writeFileSync(catalogPath, original);
  for (const locale of ["en", "de"]) {
    for (const phase of ["initial", "lazy"]) {
      for (const failure of ["network", "evaluation"]) {
        await verifyFailure(browser, locale, phase, failure);
      }
    }
  }
} finally {
  writeFileSync(catalogPath, original);
  await browser?.close();
  await stopCommand(server);
  packed?.cleanup();
}
