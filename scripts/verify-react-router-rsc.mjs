import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { chromium } from "@playwright/test";

const port = 4071;
const baseUrl = `http://127.0.0.1:${port}`;
const TEST_BARRIER_HEADER = "x-palamedes-i18n-test-barrier";
const TEST_BARRIER_REACHED_HEADER = "x-palamedes-i18n-test-barrier-reached";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`React Router RSC fixture did not start: ${String(lastError)}`);
}

async function expectText(page, testId, expected) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const actual = await page.getByTestId(testId).textContent();
    if (actual?.trim() === expected) return;
    await delay(100);
  }
  throw new Error(`Expected ${testId} to be ${JSON.stringify(expected)}`);
}

async function expectMultiCookieLocale() {
  const response = await fetch(baseUrl, {
    headers: { cookie: "session=production-proof; locale=de" },
  });
  const html = await response.text();
  if (!response.ok || !html.includes("Server-Rendern bestätigte Sprache.")) {
    throw new Error("A production request with session and locale cookies did not render German.");
  }
  // This fixture sits outside EXAMPLE_MATRIX, so its served document locale is
  // asserted here rather than by the matrix smoke checks.
  if (!/<html[^>]*\slang="de"/u.test(html)) {
    throw new Error("A German document was served without a matching html lang attribute.");
  }
}

async function expectDefaultDocumentLocale() {
  const response = await fetch(baseUrl, { headers: { "accept-language": "en" } });
  const html = await response.text();
  if (!response.ok || !/<html[^>]*\slang="en"/u.test(html)) {
    throw new Error("An English document was served without a matching html lang attribute.");
  }
}

async function addServerFunctionBarrier(page, barrierId) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    await route.continue({
      headers: { ...request.headers(), [TEST_BARRIER_HEADER]: barrierId },
    });
  });
}

function waitForServerFunctionBarrier(page, barrierId) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.headers()[TEST_BARRIER_REACHED_HEADER] === barrierId,
  );
}

await run("pnpm", ["--filter", "@palamedes/example-react-router-rsc-cookie", "build"]);

const server = spawn("pnpm", ["--filter", "@palamedes/example-react-router-rsc-cookie", "start"], {
  env: { ...process.env, PALAMEDES_I18N_TEST_BARRIER: "1", PORT: String(port) },
  stdio: "inherit",
});

try {
  await waitForServer();
  await expectMultiCookieLocale();
  await expectDefaultDocumentLocale();
  const browser = await chromium.launch({ headless: true });
  try {
    const [deContext, enContext] = await Promise.all([browser.newContext(), browser.newContext()]);
    await Promise.all([
      deContext.addCookies([{ name: "locale", value: "de", url: baseUrl }]),
      enContext.addCookies([{ name: "locale", value: "en", url: baseUrl }]),
    ]);
    const [dePage, enPage] = await Promise.all([deContext.newPage(), enContext.newPage()]);
    await Promise.all([dePage.goto(baseUrl), enPage.goto(baseUrl)]);

    await expectText(dePage, "server-rendered-message", "Server-Rendern bestätigte Sprache.");
    await expectText(enPage, "server-rendered-message", "Server render confirmed locale.");
    const barrierId = `react-router-rsc-server-function-${Date.now()}`;
    await Promise.all([
      addServerFunctionBarrier(dePage, barrierId),
      addServerFunctionBarrier(enPage, barrierId),
    ]);
    const [deResponse, enResponse] = await Promise.all([
      waitForServerFunctionBarrier(dePage, barrierId),
      waitForServerFunctionBarrier(enPage, barrierId),
      dePage.getByTestId("server-function-trigger").click(),
      enPage.getByTestId("server-function-trigger").click(),
    ]);
    if (!deResponse.ok() || !enResponse.ok()) {
      throw new Error("A rendezvoused React Router RSC Server Function request failed.");
    }
    await Promise.all([
      expectText(
        dePage,
        "server-function-direct",
        "Direktes Serverfunktionsmakro bestätigte Sprache.",
      ),
      expectText(
        enPage,
        "server-function-direct",
        "Direct Server Function macro confirmed locale.",
      ),
      expectText(dePage, "server-function-sync", "Synchroner Helfer bestätigte Sprache."),
      expectText(enPage, "server-function-sync", "Synchronous helper confirmed locale."),
      expectText(dePage, "server-function-async", "Asynchroner Helfer bestätigte Sprache."),
      expectText(enPage, "server-function-async", "Asynchronous helper confirmed locale."),
      expectText(
        dePage,
        "server-function-cross-module",
        "Modulübergreifender Helfer bestätigte Sprache.",
      ),
      expectText(enPage, "server-function-cross-module", "Cross-module helper confirmed locale."),
      expectText(dePage, "server-function-default", "Parameterstandard bestätigte Sprache."),
      expectText(enPage, "server-function-default", "Default parameter confirmed locale."),
    ]);
    await Promise.all([
      dePage.getByTestId("lazy-browser-trigger").click(),
      enPage.getByTestId("lazy-browser-trigger").click(),
    ]);
    await Promise.all([
      expectText(dePage, "lazy-browser-message", "Lokales Browserfragment bestätigte Sprache."),
      expectText(enPage, "lazy-browser-message", "Lazy browser fragment confirmed locale."),
    ]);
    await Promise.all([
      expectText(dePage, "server-rendered-message", "Server-Rendern bestätigte Sprache."),
      expectText(enPage, "server-rendered-message", "Server render confirmed locale."),
    ]);
    await Promise.all([deContext.close(), enContext.close()]);

    const initialFailureContext = await browser.newContext();
    try {
      await initialFailureContext.addCookies([{ name: "locale", value: "de", url: baseUrl }]);
      const initialFailurePage = await initialFailureContext.newPage();
      await initialFailurePage.route("**/assets/palamedes-m-*.de-*.js", (route) => route.abort());
      await initialFailurePage.goto(baseUrl);
      await initialFailurePage.getByRole("alert").waitFor({ state: "visible", timeout: 10_000 });
      if (!(await initialFailurePage.getByText("Reload page").isVisible())) {
        throw new Error(
          "An initial catalog failure did not render the catalog-independent recovery UI.",
        );
      }
      await initialFailurePage.unroute("**/assets/palamedes-m-*.de-*.js");
      await initialFailurePage.reload();
      await expectText(
        initialFailurePage,
        "server-rendered-message",
        "Server-Rendern bestätigte Sprache.",
      );
    } finally {
      await initialFailureContext.close();
    }

    const lazyFailureContext = await browser.newContext();
    try {
      await lazyFailureContext.addCookies([{ name: "locale", value: "en", url: baseUrl }]);
      const lazyFailurePage = await lazyFailureContext.newPage();
      await lazyFailurePage.route("**/assets/lazy-browser-message-*.js", (route) => route.abort());
      await lazyFailurePage.goto(baseUrl);
      await lazyFailurePage.getByTestId("lazy-browser-trigger").click();
      await lazyFailurePage
        .getByTestId("lazy-browser-error")
        .waitFor({ state: "visible", timeout: 10_000 });
      await lazyFailurePage.unroute("**/assets/lazy-browser-message-*.js");
      await lazyFailurePage.close();
      const recoveryPage = await lazyFailureContext.newPage();
      await recoveryPage.goto(baseUrl);
      await delay(500);
      await recoveryPage.getByTestId("lazy-browser-trigger").click();
      await expectText(
        recoveryPage,
        "lazy-browser-message",
        "Lazy browser fragment confirmed locale.",
      );
    } finally {
      await lazyFailureContext.close();
    }

    for (const locale of ["en", "de"]) {
      for (const failure of ["network", "evaluation"]) {
        const context = await browser.newContext();
        try {
          await context.addCookies([{ name: "locale", value: locale, url: baseUrl }]);
          let injected = false;
          let failedUrl;
          await context.route("**/*", async (route) => {
            const request = route.request();
            if (request.resourceType() === "document") {
              const response = await route.fetch();
              const body = await response.text();
              const hashes = [...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)].map(
                (match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`,
              );
              await route.fulfill({
                response,
                body,
                headers: {
                  ...response.headers(),
                  "content-security-policy": `default-src 'self'; script-src 'self' ${hashes.join(" ")}; object-src 'none'; base-uri 'self'`,
                },
              });
              return;
            }
            if (!request.url().includes("/palamedes-m-")) return route.continue();
            if (!request.url().includes(`.${locale}-`)) {
              throw new Error(`Inactive locale catalog requested: ${request.url()}`);
            }
            failedUrl ??= request.url();
            if (request.url() !== failedUrl) return route.continue();
            injected = true;
            if (failure === "network") return route.abort("failed");
            const response = await route.fetch();
            const source = await response.text();
            if (!source.includes("export const messages=(")) {
              throw new Error(`Catalog source did not expose a messages export: ${request.url()}`);
            }
            await route.fulfill({
              response,
              body: source.replace(
                "export const messages=(",
                'export const messages=(()=>{throw new Error("INJECTED_CATALOG_FAILURE")})(',
              ),
            });
          });
          const page = await context.newPage();
          await page.goto(baseUrl);
          await page.locator('main[role="alert"]').waitFor({ state: "visible", timeout: 10_000 });
          if (!injected) throw new Error(`${locale} ${failure} did not reach a catalog module`);
          const errorText = await page.locator('main[role="alert"]').innerText();
          if (
            !errorText.includes("Reload page") ||
            /INJECTED|MissingCompiled|palamedes-m-/u.test(errorText)
          ) {
            throw new Error(`${locale} ${failure} exposed internal catalog failure text`);
          }
          await page
            .locator('main[role="alert"]')
            .getByText("Reload page", { exact: true })
            .click();
          await page.waitForLoadState("networkidle");
          if ((await page.locator('main[role="alert"]').count()) !== 0) {
            throw new Error(`${locale} ${failure} did not recover after the user reload action`);
          }
          console.log(`${locale} ${failure}: native catalog failure recovered under hash CSP`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}
