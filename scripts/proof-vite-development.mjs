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

  const catalogUrl = /palamedes:messages\/[^/]+\/de(?:\?|$)/u;
  const runFailureCase = async ({ phase, evaluation }) => {
    const failurePage = await context.newPage();
    let armed = phase === "initial";
    await failurePage.route("**/*", async (route) => {
      const url = decodeURIComponent(route.request().url());
      if (phase === "lazy" && /\/app\/routes\/insights\.tsx(?:\?|$)/u.test(url)) {
        const response = await route.fetch();
        const body = await response.text();
        await route.fulfill({
          response,
          body: `${body}\nglobalThis.__palamedesRouteSideEffect = true;`,
        });
        return;
      }
      if (armed && catalogUrl.test(url)) {
        armed = false;
        if (evaluation) {
          await route.fulfill({
            status: 200,
            contentType: "application/javascript",
            body: 'throw new Error("injected catalog evaluation failure");',
          });
        } else {
          await route.abort("failed");
        }
        return;
      }
      await route.continue();
    });

    if (phase === "initial") {
      await failurePage.goto(origin, { waitUntil: "domcontentloaded" });
    } else {
      await failurePage.goto(origin);
      await failurePage.getByTestId("client-ready").waitFor({ state: "attached" });
      armed = true;
      await failurePage.getByTestId("insights-link").click();
    }
    await failurePage.getByRole("alert").first().waitFor();
    assert.match(
      await failurePage.getByRole("alert").first().innerText(),
      /temporarily unavailable|reload the page/i,
    );
    if (phase === "lazy") {
      assert.equal(
        await failurePage.evaluate(() => globalThis.__palamedesRouteSideEffect ?? false),
        false,
      );
    }

    await failurePage.unroute("**/*");
    await failurePage.reload();
    await failurePage.getByText("Frontend Stage", { exact: true }).waitFor();
    assert.equal(await failurePage.getByRole("alert").count(), 0);
    await failurePage.close();
  };

  await runFailureCase({ phase: "initial", evaluation: false });
  await runFailureCase({ phase: "initial", evaluation: true });
  await runFailureCase({ phase: "lazy", evaluation: false });
  await runFailureCase({ phase: "lazy", evaluation: true });

  console.log(
    "Vite development: active-only initial/lazy delivery, live invalidation, and initial/lazy network/evaluation recovery passed with a production build present",
  );
} finally {
  writeFileSync(catalogPath, original);
  await browser?.close();
  server.kill("SIGTERM");
}
