import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ensurePortFree, startCommand, stopCommand } from "./example-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const example = path.join(root, "examples/solid-cookie");
const ownsHost = !process.env.PALAMEDES_SOLID_URL;
const hostPort = Number(process.env.PALAMEDES_SOLID_PORT ?? 4061);
const cspPort = Number(process.env.PALAMEDES_SOLID_CSP_PORT ?? 4063);
const baseUrl = process.env.PALAMEDES_SOLID_URL ?? `http://127.0.0.1:${hostPort}/`;
let cspUrl = process.env.PALAMEDES_SOLID_CSP_URL;
const locales = ["en", "de"];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function waitForHost(url, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Solid host exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Solid host did not become ready: ${url}`);
}

function createCspProxy(targetUrl, port) {
  const nonce = process.env.PALAMEDES_CSP_NONCE ?? "palamedes-solid-csp";
  const server = createServer((request, response) => {
    const target = new URL(request.url ?? "/", targetUrl);
    const upstream = httpRequest(
      target,
      {
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (upstreamResponse) => {
        const headers = { ...upstreamResponse.headers };
        delete headers["content-length"];
        headers["content-security-policy"] =
          `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'`;
        response.writeHead(upstreamResponse.statusCode ?? 502, headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      if (!response.headersSent) response.writeHead(502);
      response.end(String(error));
    });
    request.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

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
  await page.goto(cspUrl ?? baseUrl, { waitUntil: "domcontentloaded" });
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
  await page.getByRole("link", { name: "Reload page", exact: true }).click();
  await page.getByTestId("client-ready").waitFor({ state: "attached" });
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
  let fail = true;
  let navigations = 0;
  page.on("request", (request) => {
    if (request.url().includes("/assets/palamedes-m-")) initialCatalogRequests.push(request.url());
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await page.goto(cspUrl ?? baseUrl, { waitUntil: "networkidle" });
  assertActiveLocale(initialCatalogRequests, locale);
  if ((await page.locator("html").getAttribute("data-solid-lazy-body")) !== null) {
    throw new Error(`lazy catalog body was evaluated before navigation for ${locale}`);
  }
  const before = navigations;
  const initialCount = initialCatalogRequests.length;
  await page.route("**/assets/palamedes-m-*.js", async (route) => {
    if (!fail) return route.continue();
    if (mode === "abort") return route.abort();
    return catalogFailureBody(route, "palamedes-solid-lazy-evaluation");
  });
  await page.getByRole("button", { name: "Show lazy catalog details" }).click();
  await page.locator('[data-testid="lazy-catalog-error"]').waitFor();
  assertActiveLocale(initialCatalogRequests, locale);
  if (initialCatalogRequests.length <= initialCount)
    throw new Error("No new lazy fragment requested");
  if ((await page.locator("html").getAttribute("data-solid-lazy-body")) !== null)
    throw new Error("Rejected catalog dependency allowed lazy module evaluation");
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
  fail = false;
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await page.getByTestId("client-ready").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Show lazy catalog details" }).click();
  await page.getByTestId("lazy-catalog-details").waitFor();
  if ((await page.locator("html").getAttribute("data-solid-lazy-body")) !== "executed")
    throw new Error("Recovered lazy module did not evaluate");
  result.recovered = true;
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
      errors: [...errors],
    };
    if (!result.clientReady || !result.lazyLoaded || result.errors.length > 0) {
      await browser.close();
      throw new Error(`CSP proof failed: ${JSON.stringify(result)}`);
    }
    const unauthorizedRan = await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "globalThis.__solidUnauthorizedInline = true";
      document.head.appendChild(script);
      return globalThis.__solidUnauthorizedInline === true;
    });
    await browser.close();
    if (unauthorizedRan)
      throw new Error("The host CSP did not block an unauthorized inline script");
    console.log("csp:", { ...result, unauthorizedInlineBlocked: true });
  }
}

let host;
let cspProxy;
try {
  if (ownsHost) {
    await run("pnpm", ["--filter", "@palamedes/example-solid-cookie", "build"]);
    await ensurePortFree(hostPort);
    await ensurePortFree(cspPort);
    host = startCommand({
      args: ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(hostPort)],
      cwd: example,
      env: {
        ...process.env,
        PALAMEDES_CSP_NONCE: process.env.PALAMEDES_CSP_NONCE ?? "palamedes-solid-csp",
      },
    });
    await waitForHost(baseUrl, host);
    cspProxy = await createCspProxy(baseUrl, cspPort);
    cspUrl = `http://127.0.0.1:${cspPort}/`;
  } else if (!cspUrl) {
    throw new Error(
      "CSP proof requires PALAMEDES_SOLID_CSP_URL from a host with a nonce CSP header",
    );
  }

  for (const locale of locales) {
    await initialFailure(locale, "abort");
    await initialFailure(locale, "eval");
    await normalAndLazyFailure(locale, "abort");
    await normalAndLazyFailure(locale, "eval");
  }
  await csp();
} finally {
  if (cspProxy) await new Promise((resolve) => cspProxy.close(resolve));
  if (host) await stopCommand(host);
}
