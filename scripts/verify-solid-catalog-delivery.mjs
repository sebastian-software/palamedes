import { chromium } from "@playwright/test";

const baseUrl = process.env.PALAMEDES_SOLID_URL ?? "http://127.0.0.1:4061/";
const cspUrl = process.env.PALAMEDES_SOLID_CSP_URL;
const locales = ["en", "de"];

function localeHeaders(locale) {
  return { Cookie: `locale=${locale}` };
}

async function catalogFailureBody(route, message) {
  const response = await route.fetch();
  const original = await response.body();
  const body = Buffer.concat([
    original,
    Buffer.from(`\nthrow new Error(${JSON.stringify(message)});`),
  ]);
  return route.fulfill({ body, headers: response.headers(), status: response.status() });
}

function assertActiveLocale(requests, locale) {
  const expected = `.${locale}-`;
  if (requests.length === 0 || requests.some((url) => !url.includes(expected))) {
    throw new Error(
      `expected only active ${locale} catalog fragments, received ${JSON.stringify(requests)}`,
    );
  }
}

async function initialFailure(locale, mode) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: localeHeaders(locale) });
  const page = await context.newPage();
  const requests = [];
  let fail = true;
  let navigations = 0;
  page.on("request", (request) => {
    if (request.url().includes("/assets/palamedes-m-")) requests.push(request.url());
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.route("**/assets/palamedes-m-*.js", async (route) => {
    if (!fail) return route.continue();
    if (mode === "abort") return route.abort();
    return catalogFailureBody(route, "palamedes-solid-catalog-evaluation");
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("[data-palamedes-catalog-error]").waitFor();
  assertActiveLocale(requests, locale);
  const result = {
    errorDocument: (await page.locator("[data-palamedes-catalog-error]").count()) === 1,
    locale,
    mode,
    navigations,
    rawDiagnostic: (await page.locator("text=palamedes-solid-catalog-evaluation").count()) > 0,
  };
  if (!result.errorDocument || result.navigations !== 1 || result.rawDiagnostic) {
    throw new Error(`initial failure proof failed: ${JSON.stringify(result)}`);
  }

  fail = false;
  await page.reload({ waitUntil: "networkidle" });
  result.recovered = (await page.locator('[data-testid="client-ready"]').count()) === 1;
  if (!result.recovered) throw new Error(`reload recovery failed: ${JSON.stringify(result)}`);
  await browser.close();
  console.log("initial:", result);
}

async function normalAndLazyFailure(locale, mode) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: localeHeaders(locale) });
  const page = await context.newPage();
  const initialCatalogRequests = [];
  let navigations = 0;
  page.on("request", (request) => {
    if (request.url().includes("/assets/palamedes-m-")) initialCatalogRequests.push(request.url());
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  assertActiveLocale(initialCatalogRequests, locale);
  if ((await page.locator('[data-testid="lazy-catalog-details"]').count()) !== 0) {
    throw new Error(`lazy catalog body was evaluated before navigation for ${locale}`);
  }
  const before = navigations;
  await page.route("**/assets/palamedes-m-*.js", async (route) => {
    if (mode === "abort") return route.abort();
    return catalogFailureBody(route, "palamedes-solid-lazy-evaluation");
  });
  await page.getByRole("button", { name: "Show lazy catalog details" }).click();
  await page.locator('[data-testid="lazy-catalog-error"]').waitFor();
  const result = {
    errorBoundary: (await page.locator('[data-testid="lazy-catalog-error"]').count()) === 1,
    locale,
    mode,
    navigations,
    rawDiagnostic: (await page.locator("text=palamedes-solid-lazy-evaluation").count()) > 0,
    reloads: navigations - before,
  };
  if (!result.errorBoundary || result.reloads !== 0 || result.rawDiagnostic) {
    throw new Error(`lazy failure proof failed: ${JSON.stringify(result)}`);
  }
  await browser.close();
  console.log("lazy:", result);
}

async function csp() {
  if (!cspUrl) {
    throw new Error(
      "CSP proof requires PALAMEDES_SOLID_CSP_URL from a host with a nonce CSP header",
    );
  }
  for (const locale of locales) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ extraHTTPHeaders: localeHeaders(locale) });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(cspUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Show lazy catalog details" }).click();
    await page.locator('[data-testid="lazy-catalog-details"]').waitFor();
    const result = {
      clientReady: (await page.locator('[data-testid="client-ready"]').count()) === 1,
      lazyLoaded: (await page.locator('[data-testid="lazy-catalog-details"]').count()) === 1,
      locale,
      errors,
    };
    await browser.close();
    if (!result.clientReady || !result.lazyLoaded || result.errors.length > 0) {
      throw new Error(`CSP proof failed: ${JSON.stringify(result)}`);
    }
    console.log("csp:", result);
  }
}

for (const locale of locales) {
  await initialFailure(locale, "abort");
  await initialFailure(locale, "eval");
  await normalAndLazyFailure(locale, "abort");
  await normalAndLazyFailure(locale, "eval");
}
await csp();
