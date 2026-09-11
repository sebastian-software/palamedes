import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { EXAMPLE_MATRIX } from "./example-matrix.mjs";
import { startCommand, stopCommand } from "./example-process.mjs";

const example = EXAMPLE_MATRIX.find(({ id }) => id === "tanstack-cookie");
assert(example, "tanstack-cookie is missing from the example matrix");
const origin = `http://127.0.0.1:${example.port}`;
const server = startCommand({
  args: example.start,
  cwd: example.cwd,
  env: { ...example.startEnv, NODE_ENV: "production" },
});
let browser;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (let elapsed = 0; elapsed < 30_000; elapsed += 100) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await wait(100);
  }
  assert((await fetch(origin)).ok, `TanStack preview did not start on ${origin}`);
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((value) => value && fs.existsSync(value));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const locale of ["en", "de"])
    for (const phase of ["initial", "navigation"])
      for (const failure of ["network", "evaluation"]) {
        const context = await browser.newContext();
        await context.addCookies([{ name: "locale", value: locale, url: origin }]);
        let armed = phase === "initial";
        let injected = false;
        let expectedLocale = locale;
        await context.route("**/*", async (route) => {
          const request = route.request();
          if (request.resourceType() === "document") {
            const response = await route.fetch();
            const body = await response.text();
            const headers = {
              ...response.headers(),
              "content-security-policy":
                "default-src 'self'; script-src 'self' 'nonce-tanstack-proof'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'",
            };
            delete headers["content-length"];
            delete headers["content-encoding"];
            return route.fulfill({
              response,
              body: body.replace(/<script\b/giu, '<script nonce="tanstack-proof"'),
              headers,
            });
          }
          const match = request.url().match(/palamedes-m-[^/]+\.([a-z]+)-[^/]+\.js(?:\?|$)/u);
          if (!match) return route.continue();
          assert.equal(match[1], expectedLocale, `inactive locale requested: ${request.url()}`);
          if (!armed || injected) return route.continue();
          injected = true;
          if (failure === "network") return route.abort("failed");
          const response = await route.fetch();
          const source = await response.text();
          return route.fulfill({
            response,
            body: source.replace(
              "export const messages=",
              'export const messages=(()=>{throw new Error("INJECTED_CATALOG_FAILURE")})()//',
            ),
          });
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        if (phase === "navigation") {
          await page.getByTestId("client-ready").waitFor({ state: "attached" });
          armed = true;
          expectedLocale = "de";
          await page.getByTestId("locale-switch-de").click();
        }
        await page.locator('main[role="alert"]').waitFor({ state: "visible" });
        assert(injected, `${locale} ${phase} ${failure}: sidecar was not intercepted`);
        assert.match(await page.locator('main[role="alert"]').innerText(), /Reload page/u);
        armed = false;
        await page.locator('main[role="alert"]').getByText("Reload page", { exact: true }).click();
        await page.waitForLoadState("networkidle");
        assert.equal(await page.locator('main[role="alert"]').count(), 0);
        assert.match(await page.locator("body").innerText(), /Frontend Stage/u);
        assert.deepEqual(pageErrors, []);
        console.log(`${locale} ${phase} ${failure}: passed`);
        await context.close();
      }
} finally {
  await browser?.close();
  await stopCommand(server);
}
