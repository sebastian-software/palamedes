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
    const catalogRequests = () => requests.filter((url) => url.includes("palamedes:messages"));
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

    const beforeLazyCatalogRequests = catalogRequests();
    await page.getByRole("button", { name: "Show lazy catalog details" }).click();
    await page.locator('[data-testid="lazy-catalog-details"]').waitFor();
    const afterLazyCatalogRequests = catalogRequests();
    assertActiveLocale(afterLazyCatalogRequests, "after lazy delivery");
    if (afterLazyCatalogRequests.length <= beforeLazyCatalogRequests.length) {
      throw new Error("Solid development did not request a new lazy catalog fragment");
    }
    if ((await page.locator("html").getAttribute("data-solid-lazy-body")) !== "executed") {
      throw new Error("Solid lazy catalog body did not evaluate after the user action");
    }
    console.log(
      "Solid development: active-only catalogs, real PO invalidation, and post-mount lazy delivery passed",
    );
  } finally {
    await writeFile(catalogPath, originalCatalog);
    await browser?.close();
    await stopCommand(server);
    await ensurePortFree(port);
    await rm(configPath, { force: true });
  }
}

await main();
