import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { palamedes } from "../packages/vite-plugin/dist/index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "packages/vite-plugin/package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { default: react } = await import(
  pathToFileURL(require.resolve("@vitejs/plugin-react")).href
);
const sources = ["Call label", "Eager label", "Lazy label"];

function catalog(format, locale, generation, omitted = []) {
  const entries = sources.filter((source) => !omitted.includes(source));
  const targets = entries.map((source) =>
    locale === "en" ? source : `${source} DE ${generation}`,
  );
  if (format === "fcl") {
    return `%FCL1\tsource=en\n${entries.map((source, index) => `${source}\t\t${targets[index]}\n`).join("")}`;
  }
  return `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\n${entries.map((source, index) => `msgid ${JSON.stringify(source)}\nmsgstr ${JSON.stringify(targets[index])}\n`).join("\n")}`;
}

async function verifyFormat(browser, format) {
  const fixture = await mkdtemp(path.join(root, "examples/react-router-cookie/.catalog-hmr-"));
  let server;
  try {
    await mkdir(path.join(fixture, "src"));
    await mkdir(path.join(fixture, "locales"));
    const configPath = path.join(fixture, "palamedes.yaml");
    const configuration = `locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n    format: ${format}\n`;
    await writeFile(configPath, configuration);
    for (const locale of ["en", "de"])
      await writeFile(
        path.join(fixture, `locales/${locale}.${format}`),
        catalog(format, locale, 0),
      );
    const catalogPath = path.join(fixture, `locales/de.${format}`);
    await writeFile(
      path.join(fixture, "index.html"),
      '<html lang="de"><body><div id="root"></div><script type="module" src="/src/entry.tsx"></script></body></html>',
    );
    await writeFile(
      path.join(fixture, "src/entry.tsx"),
      'import { createRoot } from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")).render(<App/>);',
    );
    const appPath = path.join(fixture, "src/App.tsx");
    const app = `import { useState, lazy, Suspense } from "react";
import { Trans } from "@palamedes/react/macro";
import { t } from "@palamedes/core/macro";
const Lazy = lazy(() => import("./Lazy"));
globalThis.__readCatalogCall = () => t\`Call label\`;
export default function App() {
  const [count, setCount] = useState(1);
  const [show, setShow] = useState(false);
  return <><h1><Trans>Eager label</Trans></h1><p data-testid="call">{t\`Call label\`}</p>
    <button onClick={() => setCount(count + 1)}>Add</button><span data-testid="count">{count}</span>
    <button onClick={() => setShow(true)}>Lazy</button>
    {show && <Suspense fallback="Loading"><Lazy/></Suspense>}</>;
}`;
    await writeFile(appPath, app);
    await writeFile(
      path.join(fixture, "src/Lazy.tsx"),
      'import { t } from "@palamedes/core/macro"; export default function Lazy(){ return <p data-testid="lazy">{t`Lazy label`}</p>; }',
    );
    server = await createServer({
      root: fixture,
      configFile: false,
      plugins: [palamedes({ configPath, mdx: false, experimentalReactCatalogHmr: true }), react()],
      resolve: { dedupe: ["react", "react-dom"] },
      server: { host: "127.0.0.1", port: 0, watch: { usePolling: true, interval: 100 } },
    });
    await server.listen();
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext();
    const requests = [];
    const page = await context.newPage();
    page.on("request", (request) => requests.push(decodeURIComponent(request.url())));
    await page.goto(origin);
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 0");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("count")).toHaveText("2");
    await page.evaluate(() => {
      globalThis.__catalogHmrDocument = "retained";
    });

    // Vite's first normal update after an overlay reloads its document. Keep
    // that host recovery policy, and prove the last valid UI lasts until then.
    await writeFile(catalogPath, "this is not a catalog\n");
    await page.locator("vite-error-overlay").waitFor({ state: "attached" });
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 0");
    await expect(page.getByTestId("count")).toHaveText("2");
    const firstRecovery = page.waitForEvent("framenavigated");
    await writeFile(catalogPath, catalog(format, "de", 0));
    await firstRecovery;
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 0");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), undefined);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("count")).toHaveText("2");
    await page.evaluate(() => {
      globalThis.__catalogHmrDocument = "retained";
    });

    await writeFile(catalogPath, catalog(format, "de", 1));
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 1", { timeout: 15_000 });
    await expect(page.getByTestId("call")).toHaveText("Call label DE 1");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), "retained");
    await expect(page.getByTestId("count")).toHaveText("2");
    await page.getByRole("button", { name: "Lazy", exact: true }).click();
    await expect(page.getByTestId("lazy")).toHaveText("Lazy label DE 1");

    let releaseSnapshot;
    const heldSnapshot = new Promise((resolve) => {
      releaseSnapshot = resolve;
    });
    let snapshotRequested;
    const requestedSnapshot = new Promise((resolve) => {
      snapshotRequested = resolve;
    });
    const pendingGeneration =
      Math.max(
        ...requests.flatMap((url) => {
          const match = /palamedes:react-catalog-snapshot\/(\d+)\/de/u.exec(url);
          return match ? [Number(match[1])] : [];
        }),
      ) + 1;
    const olderSnapshot = (url) =>
      decodeURIComponent(url.href).includes(
        `palamedes:react-catalog-snapshot/${pendingGeneration}/de`,
      );
    await page.route(olderSnapshot, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      snapshotRequested();
      await heldSnapshot;
      await route.fulfill({ response, body });
    });
    try {
      await writeFile(catalogPath, catalog(format, "de", 2));
      await requestedSnapshot;
      await writeFile(catalogPath, catalog(format, "de", 3));
      await page.waitForFunction(() => globalThis.__readCatalogCall?.() === "Call label DE 3");
    } finally {
      releaseSnapshot();
    }
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 3");
    await expect(page.getByTestId("lazy")).toHaveText("Lazy label DE 3");
    await expect(page.getByTestId("call")).toHaveText("Call label DE 3");
    await page.unroute(olderSnapshot);
    await expect(page.getByTestId("count")).toHaveText("2");

    await writeFile(catalogPath, "this is not a catalog\n");
    await page.locator("vite-error-overlay").waitFor({ state: "attached" });
    const errorDetails = await page
      .locator("vite-error-overlay")
      .evaluate((overlay) => overlay.shadowRoot?.textContent ?? overlay.textContent);
    assert(errorDetails.includes(`de.${format}`), errorDetails);
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 3");
    await expect(page.getByTestId("count")).toHaveText("2");
    await writeFile(catalogPath, catalog(format, "de", 4));
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 4", { timeout: 15_000 });
    await expect(page.getByTestId("lazy")).toHaveText("Lazy label DE 4");
    await expect(page.getByTestId("count")).toHaveText("2");
    await page.locator("vite-error-overlay").waitFor({ state: "detached" });
    // Valid ICU can still be incompatible with the source's placeholders.
    await writeFile(
      catalogPath,
      catalog(format, "de", 4).replace("Call label DE 4", "Call label DE {extra}"),
    );
    await page.locator("vite-error-overlay").waitFor({ state: "attached", timeout: 5000 });
    const compileDetails = await page
      .locator("vite-error-overlay")
      .evaluate((overlay) => overlay.shadowRoot?.textContent ?? overlay.textContent);
    assert(compileDetails.includes("icu.extra_argument"), compileDetails);
    await expect(page.getByTestId("call")).toHaveText("Call label DE 4");
    await expect(page.getByTestId("count")).toHaveText("2");
    await writeFile(catalogPath, catalog(format, "de", 4));
    await page.locator("vite-error-overlay").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), "retained");
    const snapshots = requests.filter((url) => url.includes("palamedes:react-catalog-snapshot/"));
    assert(snapshots.length >= 4);
    assert(
      snapshots.every((url) => /\/de(?:\?|$)/u.test(url)),
      "inactive locale snapshot requested",
    );

    // Config and source message-set changes keep the safe document boundary.
    await mkdir(path.join(fixture, "locales-alt"));
    for (const locale of ["en", "de"])
      await writeFile(
        path.join(fixture, `locales-alt/${locale}.${format}`),
        catalog(format, locale, 5),
      );
    const navigation = page.waitForEvent("framenavigated");
    await writeFile(configPath, configuration.replace("locales/{locale}", "locales-alt/{locale}"));
    await navigation;
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 5");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), undefined);

    // An unused catalog cannot supply or override a source's matching catalog.
    await mkdir(path.join(fixture, "locales-other"));
    for (const locale of ["en", "de"])
      await writeFile(
        path.join(fixture, `locales-other/${locale}.${format}`),
        catalog(format, locale, 5),
      );
    const splitConfiguration = `${configuration.replace("locales/{locale}", "locales-alt/{locale}")}  - path: locales-other/{locale}\n    include: [unused]\n    format: ${format}\n`;
    const splitNavigation = page.waitForEvent("framenavigated");
    await writeFile(configPath, splitConfiguration);
    await splitNavigation;
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 5");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.evaluate(() => {
      globalThis.__catalogHmrDocument = "scoped";
    });
    const otherCatalog = path.join(fixture, `locales-other/de.${format}`);
    const primaryTarget = path.join(fixture, `locales-alt/de.${format}`);
    await Promise.all(
      [primaryTarget, otherCatalog].map((file) => writeFile(file, catalog(format, "de", 6))),
    );
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 6");
    await expect(page.getByTestId("count")).toHaveText("2");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), "scoped");
    await writeFile(otherCatalog, catalog(format, "de", 7));
    await page.locator("vite-error-overlay").waitFor({ state: "attached", timeout: 5000 });
    assert(
      (
        await page
          .locator("vite-error-overlay")
          .evaluate((overlay) => overlay.shadowRoot?.textContent)
      ).includes("conflicting"),
    );
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 6");
    await expect(page.getByTestId("count")).toHaveText("2");
    await writeFile(otherCatalog, catalog(format, "de", 6));
    await page.locator("vite-error-overlay").waitFor({ state: "detached" });
    await expect(page.getByTestId("count")).toHaveText("2");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), "scoped");
    const primarySource = path.join(fixture, `locales-alt/en.${format}`);
    await writeFile(primarySource, catalog(format, "en", 5, ["Eager label"]));
    await page.locator("vite-error-overlay").waitFor({ state: "attached", timeout: 5000 });
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 6");
    await expect(page.getByTestId("count")).toHaveText("2");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), "scoped");
    await writeFile(primarySource, catalog(format, "en", 5));
    await page.locator("vite-error-overlay").waitFor({ state: "detached" });
    await expect(page.getByTestId("count")).toHaveText("2");
    await page.evaluate(() => {
      globalThis.__catalogHmrDocument = "source-edit";
    });
    const sourceUpdate = page.waitForResponse((response) =>
      response.url().includes("/src/App.tsx?t="),
    );
    await writeFile(appPath, `${app}\n// ordinary React source edit\n`);
    await sourceUpdate;
    await expect(page.getByTestId("count")).toHaveText("2");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), "source-edit");
    const sourceNavigation = page.waitForEvent("framenavigated");
    await writeFile(appPath, app.replaceAll("Call label", "Eager label"));
    await sourceNavigation;
    await expect(page.getByRole("heading")).toHaveText("Eager label DE 6");
    assert.equal(await page.evaluate(() => globalThis.__catalogHmrDocument), undefined);
    console.log(
      `React ${format} catalog HMR: state/document preservation, eager/lazy generation, stale-response rejection, active-only delivery, invalid/incompatible/scoped catalog recovery, normal Fast Refresh and membership/config reload passed`,
    );
    await context.close();
  } finally {
    await server?.close();
    await rm(fixture, { recursive: true, force: true });
  }
}

const browser = await chromium.launch();
try {
  await verifyFormat(browser, "po");
  await verifyFormat(browser, "fcl");
} finally {
  await browser.close();
}
