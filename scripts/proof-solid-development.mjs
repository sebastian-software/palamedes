import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ensurePortFree, startCommand, stopCommand } from "./example-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const example = path.join(root, "examples/solid-cookie");
const port = Number(process.env.PALAMEDES_SOLID_DEV_PORT ?? 4074);
const origin = `http://127.0.0.1:${port}`;
const catalogPath = path.join(example, "src/locales/de.po");
const configPath = path.join(example, `.vite-proof-${process.pid}.mjs`);

function waitForHost(url, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 45_000;
    const poll = async () => {
      if (child.exitCode !== null) {
        reject(new Error(`Solid Vite dev server exited with ${child.exitCode}`));
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Solid Vite dev server did not become ready: ${url}`));
        return;
      }
      try {
        const response = await fetch(url);
        if (response.status === 200) {
          resolve();
          return;
        }
      } catch {}
      setTimeout(poll, 100);
    };
    poll();
  });
}

function catalogLocale(url) {
  return decodeURIComponent(new URL(url).pathname).match(
    /palamedes:messages\/[^/]+\/(en|de|es)$/u,
  )?.[1];
}

async function verifyFailure(browser, locale, phase, failure) {
  const context = await browser.newContext();
  await context.addCookies([{ name: "locale", value: locale, url: origin }]);
  let armed = phase === "initial";
  let injected = 0;
  const requested = [];
  await context.route("**/*", async (route) => {
    const requestedLocale = catalogLocale(route.request().url());
    if (!requestedLocale) return route.continue();
    requested.push(route.request().url());
    assert.equal(requestedLocale, locale, "inactive Solid development catalog requested");
    if (armed && failure === "network") {
      injected += 1;
      return route.abort("failed");
    }
    const response = await route.fetch();
    assert(response.ok(), "generated Solid development catalog was not available");
    const source = await response.text();
    const headers = { ...response.headers(), "cache-control": "no-store" };
    delete headers.etag;
    delete headers["last-modified"];
    delete headers["content-length"];
    if (!armed) return route.fulfill({ response, headers, body: source });
    injected += 1;
    // Preserve the generated exports so the failure happens during native
    // module evaluation, rather than linking a deliberately incomplete module.
    return route.fulfill({
      response,
      headers,
      body: `${source}\nthrow new Error("SOLID_DEV_CATALOG_EVALUATION");\n`,
    });
  });
  const page = await context.newPage();
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    if (phase === "lazy") {
      await page.getByTestId("client-ready").waitFor({ state: "attached" });
      assert.equal(await page.locator("html").getAttribute("data-solid-lazy-body"), null);
      const initialRequests = new Set(requested);
      armed = true;
      await page.getByRole("button", { name: "Show lazy catalog details" }).click();
      await page
        .locator(
          "[data-testid=lazy-catalog-error], [data-palamedes-catalog-error], main.error-state",
        )
        .first()
        .waitFor();
      assert(
        requested.some((url) => !initialRequests.has(url)),
        "lazy interaction requested no new catalog dependency",
      );
    } else {
      await page.locator("[data-palamedes-catalog-error], main.error-state").first().waitFor();
      assert.equal(await page.getByTestId("client-ready").count(), 0);
    }
    assert(injected > 0, `${locale} ${phase} ${failure} did not inject a dependency failure`);
    assert.equal(await page.getByTestId("lazy-catalog-details").count(), 0);
    assert.equal(await page.locator("html").getAttribute("data-solid-lazy-body"), null);
    const errorView = page
      .locator("[data-testid=lazy-catalog-error], [data-palamedes-catalog-error], main.error-state")
      .first();
    assert.match(await errorView.innerText(), /Reload/u);
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /SOLID_DEV_CATALOG|MissingCompiled|palamedes:messages|\{[^}]*plural/u,
    );
    armed = false;
    // Exercise the real recovery control. Programmatic reload would hide a
    // broken link or a stale router intercepting this catalog-free document.
    await errorView
      .getByRole("link", { name: /^Reload(?: page)?$/u })
      .or(errorView.getByRole("button", { name: /^Reload(?: page)?$/u }))
      .click();
    await page.getByTestId("client-ready").waitFor({ state: "attached" });
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    await page.getByRole("button", { name: "Show lazy catalog details" }).click();
    await page.getByTestId("lazy-catalog-details").waitFor();
    assert.equal(await page.locator("html").getAttribute("data-solid-lazy-body"), "executed");
    console.log(
      `Solid development ${locale} ${phase} ${failure}: dependency rejection, generic UI and reload recovery passed`,
    );
  } finally {
    await context.close();
  }
}

async function main() {
  const originalCatalog = await readFile(catalogPath, "utf8");
  const updatedCatalog = originalCatalog.replace(
    'msgid "Locale"\nmsgstr "Sprache"',
    'msgid "Locale"\nmsgstr "Katalog aktualisiert"',
  );
  if (updatedCatalog === originalCatalog) {
    throw new Error("Solid development proof fixture no longer contains the expected translation");
  }

  // Vite's polling watcher keeps this proof runnable on macOS hosts with the
  // system's low FSEvents descriptor limit, while leaving the example config
  // untouched in the worktree.
  await writeFile(
    configPath,
    `import config from ${JSON.stringify(pathToFileURL(path.join(example, "vite.config.ts")).href)};\nexport default { ...config, server: { ...(config.server ?? {}), watch: { ...(config.server?.watch ?? {}), usePolling: true, interval: 500 } } };\n`,
  );

  await ensurePortFree(port);
  const server = startCommand({
    args: ["dev", "--host", "127.0.0.1", "--port", String(port), "--config", configPath],
    cwd: example,
    env: { CHOKIDAR_USEPOLLING: "true" },
  });
  let browser;
  try {
    await waitForHost(`${origin}/`, server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ extraHTTPHeaders: { Cookie: "locale=de" } });
    const page = await context.newPage();
    const requests = [];
    page.on("request", (request) => {
      if (request.url().includes("palamedes:messages")) requests.push(request.url());
    });

    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="client-ready"]').waitFor({ state: "attached" });
    if ((await page.locator("html").getAttribute("data-solid-lazy-body")) !== null) {
      throw new Error("Solid lazy catalog body evaluated before the user action");
    }
    const catalogRequests = () =>
      requests.filter((url) =>
        /palamedes:messages\/[^/]+\/[^/]+$/u.test(decodeURIComponent(new URL(url).pathname)),
      );
    const assertActiveLocale = (urls, phase) => {
      if (urls.length === 0 || urls.some((url) => !new URL(url).pathname.endsWith("/de"))) {
        throw new Error(
          `Solid development ${phase} loaded inactive locale fragments: ${JSON.stringify(urls)}`,
        );
      }
    };
    const initialCatalogRequests = catalogRequests();
    assertActiveLocale(initialCatalogRequests, "initially");

    const navigation = page.waitForEvent("framenavigated", { timeout: 30_000 });
    await writeFile(catalogPath, updatedCatalog);
    await navigation;
    await page.getByText("Katalog aktualisiert", { exact: true }).waitFor();

    await page.getByTestId("client-ready").waitFor({ state: "attached" });
    const beforeLazyCatalogRequests = new Set(catalogRequests());
    await page.getByRole("button", { name: "Show lazy catalog details" }).click();
    await page.locator('[data-testid="lazy-catalog-details"]').waitFor();
    const afterLazyCatalogRequests = catalogRequests();
    assertActiveLocale(afterLazyCatalogRequests, "after lazy delivery");
    if (!afterLazyCatalogRequests.some((url) => !beforeLazyCatalogRequests.has(url))) {
      throw new Error("Solid development did not request a new lazy catalog fragment");
    }
    if ((await page.locator("html").getAttribute("data-solid-lazy-body")) !== "executed") {
      throw new Error("Solid lazy catalog body did not evaluate after the user action");
    }
    console.log(
      "Solid development: active-only catalogs, real PO invalidation, and post-mount lazy delivery passed",
    );
    await context.close();
    await writeFile(catalogPath, originalCatalog);
    for (const locale of ["en", "de"]) {
      for (const phase of ["initial", "lazy"]) {
        for (const failure of ["network", "evaluation"]) {
          await verifyFailure(browser, locale, phase, failure);
        }
      }
    }
  } finally {
    await writeFile(catalogPath, originalCatalog);
    await browser?.close();
    await stopCommand(server);
    await ensurePortFree(port);
    await rm(configPath, { force: true });
  }
}

await main();
