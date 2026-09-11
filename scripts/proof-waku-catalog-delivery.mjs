import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { ensurePortFree, startCommand, stopCommand } from "./example-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const chromePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));

const TLD_HOSTS = [
  "palamedes-i18n.com",
  "palamedes-i18n.de",
  "palamedes-i18n.es",
  "palamedes-i18n.fr",
];

const examples = [
  { id: "waku-cookie", directory: "waku-cookie", port: 4130, strategy: "cookie" },
  { id: "waku-route", directory: "waku-route", port: 4131, strategy: "route" },
  { id: "waku-subdomain", directory: "waku-subdomain", port: 4132, strategy: "subdomain" },
  { id: "waku-tld", directory: "waku-tld", port: 4133, strategy: "tld" },
];

const failures = ["network", "evaluation"];

function urlFor(example, locale) {
  if (example.strategy === "route") return `http://127.0.0.1:${example.port}/${locale}`;
  if (example.strategy === "subdomain") return `http://${locale}.lvh.me:${example.port}/`;
  if (example.strategy === "tld") {
    const tld = locale === "en" ? "com" : locale;
    return `http://palamedes-i18n.${tld}:${example.port}/`;
  }
  return `http://127.0.0.1:${example.port}/`;
}

function start(example) {
  const cwd = `${root}/examples/${example.directory}`;
  const server = startCommand({
    args: ["exec", "waku", "start", "--port", String(example.port)],
    cwd,
    env: { ...process.env, NODE_ENV: "production", PORT: String(example.port) },
  });
  return { server };
}

async function waitForServer(origin) {
  const deadline = Date.now() + 30_000;
  const target = new URL(origin);
  const probe =
    target.hostname === "127.0.0.1" ? origin : `http://127.0.0.1:${target.port}${target.pathname}`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(probe, {
        headers: target.hostname === "127.0.0.1" ? undefined : { host: target.host },
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Waku server did not start at ${origin}`);
}

function cspForDocument(body) {
  const hashes = [...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)].map(
    (match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`,
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

function isCatalog(url) {
  return /\/assets\/palamedes-m-[^/]+\.[a-z]+-[^/]+\.js(?:\?|$)/u.test(url);
}

function catalogLocale(url) {
  return url.match(/\.([a-z]+)-[^/]+\.js(?:\?|$)/u)?.[1];
}

async function fetchUpstream(route) {
  const requestUrl = new URL(route.request().url());
  const hostLabel = requestUrl.hostname.split(".").at(-1);
  const isTldHost = TLD_HOSTS.some((candidate) => candidate.endsWith(`.${hostLabel}`));
  if (!isTldHost) {
    const response = await route.fetch();
    return {
      status: response.status(),
      headers: response.headers(),
      body: await response.text(),
    };
  }

  // Chromium's resolver rules do not apply to Playwright's route.fetch().
  // Probe the local Waku server directly while preserving the TLD Host header
  // that the application uses to select its locale.
  const host = `palamedes-i18n.${hostLabel}:${requestUrl.port}`;
  const response = await fetch(
    `http://127.0.0.1:${requestUrl.port}${requestUrl.pathname}${requestUrl.search}`,
    { headers: { host } },
  );
  const headers = Object.fromEntries(response.headers);
  delete headers["content-encoding"];
  delete headers["content-length"];
  delete headers["transfer-encoding"];
  return {
    status: response.status,
    headers,
    body: await response.text(),
  };
}

async function createContext(browser, example, expectedLocale, options = {}) {
  const context = await browser.newContext(example.strategy === "tld" ? { locale: "en-US" } : {});
  const requested = [];
  let failureArmed = options.failure !== undefined;
  let injected = false;
  let firstFailureUrl;
  let expected = expectedLocale;
  let enforceLocale = true;

  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.resourceType() === "document") {
      // Chromium's host resolver presents mapped TLD navigations as a
      // loopback address to Playwright's response fulfiller. Let the real
      // document response pass through for this strategy; catalog assets are
      // still inspected and fault-injected below.
      if (example.strategy === "subdomain" || example.strategy === "tld") {
        return route.continue();
      }
      const response = await fetchUpstream(route);
      const body = `${response.body}<script>globalThis.__palamedesUnauthorizedInline = true;</script>`;
      const headers = {
        ...response.headers,
        "content-security-policy": cspForDocument(response.body),
      };
      assert(!headers["content-security-policy"].includes("unsafe-inline"));
      assert(!headers["content-security-policy"].includes("unsafe-eval"));
      return route.fulfill({ status: response.status, body, headers });
    }
    if (!isCatalog(request.url())) return route.continue();
    const locale = catalogLocale(request.url());
    requested.push({ url: request.url(), locale });
    if (enforceLocale) {
      assert.equal(locale, expected, `inactive Waku catalog requested: ${request.url()}`);
    }
    const response = await fetchUpstream(route);
    const source = response.body;
    assert.match(source, /export const locale=/u);
    assert.match(source, /export const messages=/u);
    if (!failureArmed || (firstFailureUrl && firstFailureUrl !== request.url())) {
      return route.fulfill({ status: response.status, body: source, headers: response.headers });
    }

    firstFailureUrl ??= request.url();
    injected = true;
    if (options.failure === "network") return route.abort("failed");

    return route.fulfill({
      status: response.status,
      headers: response.headers,
      body: `${source}\nthrow new Error("WAKU_INJECTED_CATALOG_EVALUATION");\n`,
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/violates the following Content Security Policy/iu.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  return {
    context,
    page,
    requested,
    errors,
    get injected() {
      return injected;
    },
    disarm() {
      failureArmed = false;
    },
    arm() {
      failureArmed = true;
    },
    setExpectedLocale(locale) {
      expected = locale;
    },
    suspendLocaleAssertion() {
      enforceLocale = false;
    },
    resumeLocaleAssertion(locale) {
      expected = locale;
      enforceLocale = true;
    },
  };
}

async function waitReady(page) {
  await page.getByTestId("client-ready").waitFor({ state: "attached", timeout: 15_000 });
}

async function assertUnauthorizedInlineBlocked(page) {
  assert.equal(
    await page.evaluate(() => Boolean(globalThis.__palamedesUnauthorizedInline)),
    false,
    "CSP allowed an unauthorized inline script",
  );
}

function deliveryProofLabel(example) {
  return example.strategy === "subdomain" || example.strategy === "tld"
    ? "native mapped-host response"
    : "CSP";
}

function assertHealthy(proof, locale, start = 0) {
  const requests = proof.requested.slice(start);
  assert(requests.length > 0, "no Waku catalog request observed");
  assert(requests.every((entry) => entry.locale === locale));
  assert.equal(proof.errors.length, 0, `browser errors: ${proof.errors.join(" | ")}`);
}

async function runHealthy(browser, example, locale) {
  const proof = await createContext(browser, example, locale);
  try {
    if (example.strategy === "cookie") {
      await proof.context.addCookies([
        { name: "locale", value: locale, url: urlFor(example, locale) },
      ]);
    }
    await proof.page.goto(urlFor(example, locale), { waitUntil: "domcontentloaded" });
    await waitReady(proof.page);
    if (example.strategy !== "subdomain" && example.strategy !== "tld") {
      await assertUnauthorizedInlineBlocked(proof.page);
    }
    assert.equal(await proof.page.locator("html").getAttribute("lang"), locale);
    assertHealthy(proof, locale);

    if (locale === "en") {
      const switchStart = proof.requested.length;
      proof.suspendLocaleAssertion();
      const navigation = proof.page.waitForNavigation({ waitUntil: "domcontentloaded" });
      await proof.page.getByTestId("locale-switch-de").click({ force: true });
      await navigation;
      await waitReady(proof.page);
      const switchRequests = proof.requested.slice(switchStart);
      proof.resumeLocaleAssertion("de");
      assert.equal(await proof.page.locator("html").getAttribute("lang"), "de");
      assert(
        switchRequests.some((entry) => entry.locale === "de"),
        "locale switch loaded no new catalog",
      );
      assert.equal(proof.errors.length, 0, `browser errors: ${proof.errors.join(" | ")}`);
      const beforeReload = proof.requested.length;
      await proof.page.reload({ waitUntil: "domcontentloaded" });
      await waitReady(proof.page);
      assert.equal(await proof.page.locator("html").getAttribute("lang"), "de");
      assertHealthy(proof, "de", beforeReload);
    }
    console.log(
      `${example.id} ${locale}: active-only native exports, locale switch and reload passed under ${deliveryProofLabel(example)}`,
    );
  } finally {
    await proof.context.close();
  }
}

async function runInitialFailure(browser, example, locale, failure) {
  const proof = await createContext(browser, example, locale, { failure });
  try {
    if (example.strategy === "cookie") {
      await proof.context.addCookies([
        { name: "locale", value: locale, url: urlFor(example, locale) },
      ]);
    }
    await proof.page.goto(urlFor(example, locale), { waitUntil: "domcontentloaded" });
    await proof.page.locator("[data-palamedes-catalog-error]").waitFor({ timeout: 15_000 });
    if (example.strategy !== "subdomain" && example.strategy !== "tld") {
      await assertUnauthorizedInlineBlocked(proof.page);
    }
    assert(proof.injected, "initial failure was not injected into a catalog dependency");
    const text = await proof.page.locator("body").innerText();
    assert.match(text, /Reload page/u);
    assert.doesNotMatch(text, /WAKU_INJECTED|palamedes-m-|MissingCompiled|\{.*plural/u);
    assert.equal(await proof.page.getByTestId("client-ready").count(), 0);
    proof.disarm();
    await proof.page.getByRole("link", { name: "Reload page" }).click();
    await waitReady(proof.page);
    assert.equal(await proof.page.locator("[data-palamedes-catalog-error]").count(), 0);
    assert.equal(await proof.page.locator("html").getAttribute("lang"), locale);
    console.log(
      `${example.id} ${locale} initial ${failure}: catalog-free UI and reload recovery passed under ${deliveryProofLabel(example)}`,
    );
  } finally {
    await proof.context.close();
  }
}

async function runLazyFailure(browser, locale, failure) {
  const example = examples[0];
  const proof = await createContext(browser, example, locale, { failure });
  try {
    await proof.context.addCookies([
      { name: "locale", value: locale, url: urlFor(example, locale) },
    ]);
    proof.disarm();
    await proof.page.goto(urlFor(example, locale), { waitUntil: "domcontentloaded" });
    await waitReady(proof.page);
    await assertUnauthorizedInlineBlocked(proof.page);
    assertHealthy(proof, locale);
    proof.arm();
    await proof.page.getByRole("button", { name: "Show lazy catalog details" }).click();
    await proof.page.getByTestId("lazy-catalog-error").waitFor({ timeout: 15_000 });
    assert(proof.injected, "lazy failure was not injected into a catalog dependency");
    assert.equal(await proof.page.getByTestId("lazy-catalog-details").count(), 0);
    assert.equal(
      await proof.page.evaluate(() => Boolean(globalThis.__palamedesWakuLazyCatalogBody)),
      false,
      "lazy component body ran after its catalog dependency rejected",
    );
    const text = await proof.page.locator("body").innerText();
    assert.match(text, /Details are temporarily unavailable/u);
    assert.doesNotMatch(text, /WAKU_INJECTED|palamedes-m-|MissingCompiled/u);
    proof.disarm();
    await proof.page.getByRole("button", { name: "Reload page" }).click();
    await waitReady(proof.page);
    assert.equal(await proof.page.locator("[data-testid='lazy-catalog-error']").count(), 0);
    console.log(
      `waku-cookie ${locale} lazy ${failure}: rejected dependency skipped body and recovered on reload`,
    );
  } finally {
    await proof.context.close();
  }
}

let browser;
const servers = [];
try {
  const args = [
    `--host-resolver-rules=${TLD_HOSTS.map((host) => `MAP ${host} 127.0.0.1`).join(",")}`,
  ];
  browser = await chromium.launch(chromePath ? { executablePath: chromePath, args } : { args });
  for (const example of examples) {
    await ensurePortFree(example.port);
    const started = start(example);
    servers.push(started.server);
    await waitForServer(urlFor(example, "en"));
    for (const locale of ["en", "de"]) {
      await runHealthy(browser, example, locale);
      for (const failure of failures) await runInitialFailure(browser, example, locale, failure);
    }
    await stopCommand(started.server);
    servers.pop();
  }

  const lazyExample = examples[0];
  await ensurePortFree(lazyExample.port);
  const lazyServer = start(lazyExample);
  servers.push(lazyServer.server);
  await waitForServer(urlFor(lazyExample, "en"));
  for (const locale of ["en", "de"]) {
    for (const failure of failures) await runLazyFailure(browser, locale, failure);
  }
  await stopCommand(lazyServer.server);
  servers.pop();
} finally {
  for (const server of servers) await stopCommand(server);
  await browser?.close();
}
