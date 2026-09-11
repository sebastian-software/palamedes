import { chromium } from "@playwright/test";

const baseUrl = process.env.PALAMEDES_SOLID_URL ?? "http://127.0.0.1:4061/";
const cspUrl = process.env.PALAMEDES_SOLID_CSP_URL;

async function initialFailure(mode) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.route("**/assets/palamedes-m-*.js", async (route) => {
    if (mode === "abort") return route.abort();
    return route.fulfill({
      body: 'throw new Error("palamedes-solid-catalog-evaluation");',
      contentType: "text/javascript",
      status: 200,
    });
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("[data-palamedes-catalog-error]").waitFor();
  const result = {
    errorDocument: (await page.locator("[data-palamedes-catalog-error]").count()) === 1,
    navigations,
    rawDiagnostic: (await page.locator("text=palamedes-solid-catalog-evaluation").count()) > 0,
  };
  await browser.close();
  if (!result.errorDocument || result.navigations !== 1 || result.rawDiagnostic) {
    throw new Error(`initial ${mode} proof failed: ${JSON.stringify(result)}`);
  }
  console.log(`initial ${mode}:`, result);
}

async function lazyFailure(mode) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const initialNavigations = navigations;
  await page.route("**/assets/palamedes-m-*.js", async (route) => {
    if (mode === "abort") return route.abort();
    return route.fulfill({
      body: 'throw new Error("palamedes-solid-lazy-evaluation");',
      contentType: "text/javascript",
      status: 200,
    });
  });
  await page.getByRole("button", { name: "Show lazy catalog details" }).click();
  await page.locator('[data-testid="lazy-catalog-error"]').waitFor();
  const result = {
    errorBoundary: (await page.locator('[data-testid="lazy-catalog-error"]').count()) === 1,
    navigations,
    rawDiagnostic: (await page.locator("text=palamedes-solid-lazy-evaluation").count()) > 0,
  };
  await browser.close();
  if (!result.errorBoundary || navigations !== initialNavigations || result.rawDiagnostic) {
    throw new Error(`lazy ${mode} proof failed: ${JSON.stringify(result)}`);
  }
  console.log(`lazy ${mode}:`, result);
}

async function csp() {
  if (!cspUrl) {
    console.log(
      "csp: skipped (set PALAMEDES_SOLID_CSP_URL to a host response with its CSP header)",
    );
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(cspUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Show lazy catalog details" }).click();
  const result = {
    clientReady: (await page.locator('[data-testid="client-ready"]').count()) === 1,
    lazyLoaded: (await page.getByText("Lazy catalog detail loaded.").count()) === 1,
    errors,
  };
  await browser.close();
  if (!result.clientReady || !result.lazyLoaded || result.errors.length > 0) {
    throw new Error(`CSP proof failed: ${JSON.stringify(result)}`);
  }
  console.log("csp:", result);
}

await initialFailure("abort");
await initialFailure("eval");
await lazyFailure("abort");
await lazyFailure("eval");
await csp();
