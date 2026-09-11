import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const example = path.join(root, "examples/solid-cookie");
const origin = `http://127.0.0.1:${process.env.PALAMEDES_SOLID_DEV_PORT ?? 4074}`;
const catalogPath = path.join(example, "src/locales/de.po");
const configPath = path.join(example, `.vite-proof-${process.pid}.mjs`);
const viteBinary = path.join(example, "node_modules/.bin/vite");

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
        if (response.status < 500) {
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

  const server = spawn(
    viteBinary,
    ["dev", "--host", "127.0.0.1", "--port", origin.split(":").at(-1)],
    {
      cwd: example,
      stdio: "inherit",
    },
  );
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
    if ((await page.locator('[data-testid="lazy-catalog-details"]').count()) !== 0) {
      throw new Error("Solid lazy catalog body evaluated before the user action");
    }
    const localeRequests = requests.filter((url) => /\/(?:en|de|es)$/u.test(new URL(url).pathname));
    if (
      localeRequests.length === 0 ||
      localeRequests.some((url) => !new URL(url).pathname.endsWith("/de"))
    ) {
      throw new Error(
        `Solid development loaded inactive locale fragments: ${JSON.stringify(localeRequests)}`,
      );
    }

    const navigation = page.waitForEvent("framenavigated", { timeout: 30_000 });
    await writeFile(catalogPath, updatedCatalog);
    await navigation;
    await page.getByText("Katalog aktualisiert", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Show lazy catalog details" }).click();
    await page.locator('[data-testid="lazy-catalog-details"]').waitFor();
    console.log(
      "Solid development: active-only catalogs, real PO invalidation, and post-mount lazy delivery passed",
    );
  } finally {
    await writeFile(catalogPath, originalCatalog);
    await browser?.close();
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
    await rm(configPath, { force: true });
  }
}

await main();
