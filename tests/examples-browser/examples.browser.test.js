import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { afterEach, expect, test } from "vitest";

import { DEMO_DEPLOYMENT } from "../../scripts/demo-deployment.mjs";
import { observeBrowserArtifacts } from "../../scripts/verify-browser-artifacts.mjs";

let browser;
let verifyObservedArtifacts;

function resolveChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "darwin" && fs.existsSync(macChrome)) {
    return macChrome;
  }

  return;
}

function activeExample() {
  return {
    baseUrl: process.env.PALAMEDES_VERIFY_BASE_URL ?? "",
    captureScreenshots: process.env.PALAMEDES_CAPTURE_SCREENSHOTS === "1",
    framework: process.env.PALAMEDES_VERIFY_FRAMEWORK ?? "",
    hostMismatchUrl: process.env.PALAMEDES_VERIFY_HOST_MISMATCH_URL ?? "",
    id: process.env.PALAMEDES_VERIFY_EXAMPLE_ID ?? "",
    screenshotDir: process.env.PALAMEDES_SCREENSHOT_DIR ?? "",
    strategy: process.env.PALAMEDES_VERIFY_STRATEGY ?? "",
    subdomainUrl: process.env.PALAMEDES_VERIFY_SUBDOMAIN_URL ?? "",
    tldUrl: process.env.PALAMEDES_VERIFY_TLD_URL ?? "",
  };
}

function postReactRouterAction(url, host, origin) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "POST",
        headers: {
          host,
          origin,
          "content-type": "application/x-www-form-urlencoded",
          "accept-language": "en",
        },
        timeout: 10_000,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Action origin probe timed out")));
    request.end("intent=probe");
  });
}

test.runIf(activeExample().framework === "react-router")(
  "React Router accepts public HTTPS action origins and rejects foreign origins",
  async () => {
    const example = activeExample();
    const { hosts } = DEMO_DEPLOYMENT.find(({ id }) => id === example.id);
    for (const host of hosts) {
      const url = new URL(example.baseUrl);
      // Local runs model the CDN's HTTP hop while keeping the real public Host
      // and HTTPS Origin. Hosted runs exercise the same contract through TLS.
      if (url.protocol === "https:") url.hostname = host;
      url.pathname = example.strategy === "route" ? "/en.data" : "/_.data";
      if (example.strategy !== "route") url.search = "?index";
      expect(await postReactRouterAction(url, host, `https://${host}`), host).toBe(200);
      expect(await postReactRouterAction(url, host, "https://untrusted.invalid"), host).toBe(400);
    }
  },
);

function remixLocales() {
  return ["en", "de", "es", "fr"];
}

function remixDocumentUrl(example, locale = "en") {
  const url = new URL(example.subdomainUrl || example.tldUrl || example.baseUrl);
  if (example.strategy === "route") url.pathname = `/${locale}`;
  if (example.strategy === "subdomain") url.hostname = url.hostname.replace(/^[^.]+/u, locale);
  if (example.strategy === "tld")
    url.hostname = url.hostname.replace(/\.[^.]+$/u, locale === "en" ? ".com" : `.${locale}`);
  return url.href;
}

function remixLaunchArgs(example) {
  return example.strategy === "tld" ? tldHostResolverArgs() : [];
}

// The tld strategy derives the locale from a real top-level domain, so the
// browser must reach four distinct domains locally. Chromium's host resolver
// rules map them to the loopback dev server without touching DNS or /etc/hosts.
const TLD_TEST_HOSTS = [
  "palamedes-i18n.com",
  "palamedes-i18n.de",
  "palamedes-i18n.es",
  "palamedes-i18n.fr",
];

function tldHostResolverArgs() {
  const rules = TLD_TEST_HOSTS.map((host) => `MAP ${host} 127.0.0.1`).join(",");
  return [`--host-resolver-rules=${rules}`];
}

function routeUrl(baseUrl) {
  return `${baseUrl}/en`;
}

function germanDocumentUrl(example) {
  if (example.strategy === "route") {
    return `${example.baseUrl}/de`;
  }
  if (example.strategy === "subdomain") {
    return example.subdomainUrl.replace("//en.", "//de.");
  }
  if (example.strategy === "tld") {
    const url = new URL(example.tldUrl);
    url.hostname = url.hostname.replace(/\.com$/u, ".de");
    return url.href;
  }
  return `${example.baseUrl}/`;
}

function hasClientLocaleProbe(example) {
  return ["solid-cookie", "tanstack-cookie", "waku-cookie"].includes(example.id);
}

function isHydrationMismatch(message) {
  return (
    /\b(?:hydration|hydrate|hydrated)\b.*\b(?:mismatch|failed|error)/iu.test(message) ||
    /\b(?:server rendered|server-rendered)\b.*\b(?:html|text|markup)/iu.test(message) ||
    /\b(?:text content|html)\b.*\b(?:does not match|did not match|mismatch)/iu.test(message)
  );
}

async function launchPage(launchArgs = [], { browserLocale = "en-US", navigatorLocale } = {}) {
  browser = await chromium.launch({
    args: launchArgs,
    executablePath: resolveChromiumExecutable(),
    headless: true,
  });
  const context = await browser.newContext({
    colorScheme: "light",
    locale: browserLocale,
    // Keep the browser away from both the UTC CI host and the Berlin event.
    timezoneId: "America/Los_Angeles",
    viewport: {
      width: 1440,
      height: 1200,
    },
  });
  const page = await context.newPage();

  if (navigatorLocale) {
    await page.addInitScript((locale) => {
      Object.defineProperties(navigator, {
        language: {
          configurable: true,
          get: () => locale,
        },
        languages: {
          configurable: true,
          get: () => [locale],
        },
      });
    }, navigatorLocale);
  }

  return page;
}

afterEach(async () => {
  try {
    await verifyObservedArtifacts?.();
  } finally {
    verifyObservedArtifacts = undefined;
    await browser?.close();
    browser = undefined;
  }
});

// React recovers from a hydration mismatch instead of throwing, so it only
// surfaces as a console error. Both buckets are therefore checked together,
// once the document has settled and again after the locale switch.
function expectNoRuntimeErrors(pageErrors, hydrationErrors) {
  expect(pageErrors).toEqual([]);
  expect(hydrationErrors).toEqual([]);
}

async function currentServerLocale(page) {
  return (await page.getByTestId("server-locale-value").textContent())?.trim() ?? "";
}

async function waitForClientReady(page) {
  await page.getByTestId("client-ready").waitFor({ state: "attached", timeout: 10_000 });
  const remixProof = page.getByTestId("remix-runtime-proof");
  if ((await remixProof.count()) && (await remixProof.getAttribute("open")) === null) {
    await page.getByTestId("remix-proof-toggle").click();
  }
}

async function chooseCookieLocale(page, locale) {
  const mutation = page.waitForRequest((request) => request.method() === "POST");
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  await page.getByTestId(`locale-switch-${locale}`).click({ noWaitAfter: true });
  const [request] = await Promise.all([mutation, navigation]);
  await waitForClientReady(page);
  await page.waitForLoadState("networkidle");
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);
  expect((await page.context().cookies()).find((cookie) => cookie.name === "locale")?.value).toBe(
    locale,
  );
  return request;
}

test
  .runIf(
    [
      "tanstack-cookie",
      "solid-cookie",
      "waku-cookie",
      "react-router-cookie",
      "remix-cookie",
    ].includes(activeExample().id),
  )
  .each([undefined, "unsupported", "en"])(
  "cookie preference writes are explicit and unchanged choices are inert (cookie=%s)",
  async (cookieValue) => {
    const example = activeExample();
    const page = await launchPage();
    const context = page.context();
    if (cookieValue !== undefined) {
      await context.addCookies([{ name: "locale", value: cookieValue, url: example.baseUrl }]);
    }
    const localeCookie = async () =>
      (await context.cookies()).find((cookie) => cookie.name === "locale")?.value;
    const document = await page.goto(example.baseUrl, { waitUntil: "domcontentloaded" });
    expect(document?.status()).toBe(200);
    expect((await document.allHeaders())["set-cookie"]).toBeUndefined();
    await waitForClientReady(page);
    await page.waitForLoadState("networkidle");
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    expect(await localeCookie()).toBe(cookieValue);
    await page.evaluate(() => {
      window.__palamedesLocaleContractDocument = "current";
    });

    if (example.id === "remix-cookie") {
      const summary = await context.request.get(`${example.baseUrl}/frames/locale-summary`);
      expect(summary.status()).toBe(200);
      expect(summary.headers()["set-cookie"]).toBeUndefined();
      expect(summary.headers()["x-palamedes-locale"]).toBe("en");
    } else {
      // Observe Chromium's real response, including Set-Cookie. Replaying with
      // route.fetch() drops Fetch Metadata and can trip a same-origin RPC guard.
      const pendingReads = [];
      const observeRead = (response) => {
        const request = response.request();
        if (!["fetch", "xhr"].includes(request.resourceType())) return;
        pendingReads.push(
          response.allHeaders().then((headers) => ({
            method: request.method(),
            path: new URL(request.url()).pathname,
            headers,
          })),
        );
      };
      page.on("response", observeRead);
      try {
        const response = page.waitForResponse((result) =>
          ["fetch", "xhr"].includes(result.request().resourceType()),
        );
        await page.getByTestId("server-proof-trigger").click();
        expect((await response).ok()).toBe(true);
        await page.waitForLoadState("networkidle");
      } finally {
        page.off("response", observeRead);
      }
      const reads = await Promise.all(pendingReads);
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) expect(read.headers["set-cookie"]).toBeUndefined();
      if (example.id === "react-router-cookie") {
        expect(reads).toHaveLength(1);
        expect(reads[0].method).toBe("GET");
        expect(reads[0].path).toMatch(/^\/server-status(?:\.data)?$/u);
      }
    }
    expect(await localeCookie()).toBe(cookieValue);
    expect(await page.evaluate(() => window.__palamedesLocaleContractDocument)).toBe("current");

    const activeChoice = page.getByTestId("locale-switch-en");
    expect(await activeChoice.isDisabled()).toBe(cookieValue === "en");
    if (cookieValue !== "en") {
      await chooseCookieLocale(page, "en");
      expect(await page.evaluate(() => window.__palamedesLocaleContractDocument)).toBeUndefined();
    }
    expect(await activeChoice.isDisabled()).toBe(true);
    await page.evaluate(() => {
      window.__palamedesLocaleContractDocument = "saved";
    });
    const redundantRequests = [];
    const observeChoice = (request) => {
      if (request.method() === "POST" || request.resourceType() === "document") {
        redundantRequests.push(request.url());
      }
    };
    page.on("request", observeChoice);
    await activeChoice.evaluate((button) => button.click());
    await page.evaluate(() => new Promise(requestAnimationFrame));
    page.off("request", observeChoice);
    expect(redundantRequests).toEqual([]);
    expect(await page.evaluate(() => window.__palamedesLocaleContractDocument)).toBe("saved");

    const mutation = await chooseCookieLocale(page, "de");
    expect(await page.evaluate(() => window.__palamedesLocaleContractDocument)).toBeUndefined();
    expect(await page.getByTestId("locale-switch-de").isDisabled()).toBe(true);

    // Replay the real framework transport to exercise the server guard independently of the UI.
    const headers = await mutation.allHeaders();
    for (const name of ["cookie", "content-length", "host", "connection"]) delete headers[name];
    // Chromium exposes HTTP/2 pseudoheaders on HTTPS requests; the replay client owns them.
    for (const name of Object.keys(headers)) if (name.startsWith(":")) delete headers[name];
    const repeated = await context.request.fetch(mutation.url(), {
      method: mutation.method(),
      headers,
      data: mutation.postDataBuffer(),
      maxRedirects: 0,
    });
    expect(repeated.status()).toBeGreaterThanOrEqual(200);
    expect(repeated.status()).toBeLessThan(400);
    expect(repeated.headers()["set-cookie"]).toBeUndefined();
    expect(await localeCookie()).toBe("de");
  },
);

// The served document carries the locale, but hydration and any revalidation
// that follows it can reassign `lang` from client state. A poll alone would
// accept the served value and never see the later flip, so the attribute is
// read again after the app has had time to settle.
async function expectSettledDocumentLocale(page, locale) {
  await waitForClientReady(page);
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(locale);
  await page.waitForTimeout(500);
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);
}

async function expectTanStackServerFunctionMessages(page, locale) {
  if (activeExample().id !== "tanstack-cookie") {
    return;
  }

  const messages =
    locale === "de"
      ? [
          ["server-proof-message", "Serverfunktion bestätigte Sprache de."],
          ["server-proof-sync", "Synchroner Server-Helfer bestätigte Sprache."],
          ["server-proof-async", "Asynchroner Server-Helfer bestätigte Sprache."],
          ["server-proof-cross-module", "Modulübergreifender Server-Helfer bestätigte Sprache."],
        ]
      : [
          ["server-proof-message", `Server function confirmed locale ${locale}.`],
          ["server-proof-sync", "Synchronous server helper confirmed locale."],
          ["server-proof-async", "Asynchronous server helper confirmed locale."],
          ["server-proof-cross-module", "Cross-module server helper confirmed locale."],
        ];

  for (const [testId, expected] of messages) {
    await expect
      .poll(async () => (await page.getByTestId(testId).textContent())?.trim() ?? "")
      .toBe(expected);
  }
}

async function expectRemixClientProof(page, locale, count) {
  if (activeExample().framework !== "remix") {
    return;
  }

  const messages = {
    en: {
      heading: "Palamedes is active in the browser",
      plural: `${count} browser ${count === 1 ? "message" : "messages"}`,
      rich: "Open the Remix client guide.",
      select: "Built for developers",
    },
    de: {
      heading: "Palamedes ist im Browser aktiv",
      plural: `${count} Browser-${count === 1 ? "Nachricht" : "Nachrichten"}`,
      rich: "Öffne den Remix-Client-Leitfaden.",
      select: "Für Entwickler gemacht",
    },
    es: {
      heading: "Palamedes está activo en el navegador",
      plural: `${count} ${count === 1 ? "mensaje" : "mensajes"} del navegador`,
      rich: "Abre la guía del cliente de Remix.",
      select: "Creado para desarrolladores",
    },
    fr: {
      heading: "Palamedes est actif dans le navigateur",
      plural: `${count} ${count === 1 ? "message" : "messages"} du navigateur`,
      rich: "Ouvrez le guide du client Remix.",
      select: "Conçu pour les développeurs",
    },
  }[locale];

  await expect.poll(() => page.getByTestId("client-heading").textContent()).toBe(messages.heading);
  await expect
    .poll(() => page.getByTestId("client-rich-message").textContent())
    .toBe(messages.rich);
  await expect
    .poll(() => page.getByTestId("client-rich-message").locator("a").getAttribute("href"))
    .toBe(activeExample().strategy === "route" ? `/${locale}/frames` : "/frames");
  await expect
    .poll(() => page.getByTestId("client-plural-message").textContent())
    .toBe(messages.plural);
  await expect
    .poll(() => page.getByTestId("client-select-message").textContent())
    .toBe(messages.select);
}

async function stabilizePage(page) {
  await page
    .addStyleTag({
      content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
    })
    .catch(() => {});
}

async function captureScreenshot(page, example, state) {
  if (!example.captureScreenshots || !example.screenshotDir) {
    return;
  }

  await mkdir(example.screenshotDir, { recursive: true });
  await stabilizePage(page);
  await page.screenshot({
    fullPage: true,
    path: path.join(example.screenshotDir, `${example.id}-${state}.png`),
  });
}

async function rejectModuleEvaluation(route, message) {
  // A standalone throwing module exercises evaluation failures without a Node-side
  // fetch, which cannot use Chromium's local TLD host mappings.
  await route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `throw new Error(${JSON.stringify(message)});`,
  });
}

async function reloadRemixAfterFailure(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "Reload", exact: true }).click({ noWaitAfter: true }),
  ]);
  await waitForClientReady(page);
}

test("Remix client entry shows a catalog-free error UI and recovers after reload", async () => {
  const example = activeExample();
  if (example.framework !== "remix") {
    return;
  }

  const page = await launchPage(remixLaunchArgs(example));
  let failure = "entry-network";
  const cspViolations = [];
  page.on("console", (message) => {
    if (/content security policy|unsafe-(?:inline|eval)/iu.test(message.text())) {
      cspViolations.push(message.text());
    }
  });
  await page.route("**/assets/app/public/client.tsx", async (route) => {
    if (failure === "entry-network") {
      await route.abort("failed");
      return;
    }
    if (failure === "entry-evaluation") {
      await rejectModuleEvaluation(route, "injected Remix entry evaluation failure");
      return;
    }
    await route.continue();
  });
  await page.route("**/__palamedes/catalog-fragments/**", async (route) => {
    if (failure === "fragment-network") {
      await route.abort("failed");
      return;
    }
    if (failure === "fragment-evaluation") {
      await rejectModuleEvaluation(route, "injected Remix catalog fragment evaluation failure");
      return;
    }
    await route.continue();
  });

  await page.goto(remixDocumentUrl(example), { waitUntil: "domcontentloaded" });
  await page.getByRole("alert").waitFor({ state: "visible" });
  expect(await page.getByRole("alert").textContent()).toContain("Something went wrong");

  failure = "ok";
  await reloadRemixAfterFailure(page);

  failure = "entry-evaluation";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("alert").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Reload", exact: true }).waitFor({ state: "visible" });

  failure = "ok";
  await reloadRemixAfterFailure(page);

  failure = "fragment-network";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("alert").waitFor({ state: "visible" });

  failure = "ok";
  await reloadRemixAfterFailure(page);

  failure = "fragment-evaluation";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("alert").waitFor({ state: "visible" });

  failure = "ok";
  await reloadRemixAfterFailure(page);
  expect(cspViolations).toEqual([]);
});

test("Remix lazy catalog failures recover in all document locales under CSP", async () => {
  const example = activeExample();
  if (example.framework !== "remix") return;
  for (const locale of remixLocales()) {
    for (const mode of ["network", "evaluation"]) {
      const page = await launchPage(remixLaunchArgs(example));
      await page.context().addCookies([{ name: "locale", value: locale, url: example.baseUrl }]);
      let fail = false;
      const fragments = [];
      const violations = [];
      page.on("console", (message) => {
        if (/content security policy|unsafe-(?:inline|eval)/iu.test(message.text()))
          violations.push(message.text());
      });
      await page.route("**/__palamedes/catalog-fragments/**", async (route) => {
        fragments.push(route.request().url());
        if (!fail) return route.continue();
        if (mode === "network") return route.abort("failed");
        await rejectModuleEvaluation(route, "injected catalog evaluation failure");
      });
      await page.goto(remixDocumentUrl(example, locale), { waitUntil: "domcontentloaded" });
      await waitForClientReady(page);
      const initialCount = fragments.length;
      fail = true;
      await page.getByTestId("client-load-lazy").click();
      await page.getByRole("alert").waitFor();
      expect(fragments.length).toBeGreaterThan(initialCount);
      expect(fragments.every((url) => new URL(url).searchParams.get("locale") === locale)).toBe(
        true,
      );
      expect(await page.getByRole("alert").textContent()).not.toMatch(
        /injected|Palamedes|catalog/iu,
      );
      expect(await page.locator("html").getAttribute("data-remix-lazy-body")).toBeNull();
      fail = false;
      await reloadRemixAfterFailure(page);
      await page.getByTestId("client-load-lazy").click();
      await page.getByTestId("client-lazy-message").waitFor();
      expect(await page.getByTestId("client-lazy-message").textContent()).toBe(
        {
          en: "This message arrived after the page was ready",
          de: "Diese Nachricht kam nach dem Laden der Seite an",
          es: "Este mensaje llegó después de que la página estuviera lista",
          fr: "Ce message est arrivé après le chargement de la page",
        }[locale],
      );
      expect(violations).toEqual([]);
      await page.context().browser()?.close();
    }
  }
});

test("Waku initial HTML document uses the request locale", async () => {
  const example = activeExample();
  if (example.framework !== "waku") {
    return;
  }

  const page = await launchPage(example.strategy === "tld" ? tldHostResolverArgs() : [], {
    browserLocale: "de-DE",
  });
  const response = await page.goto(germanDocumentUrl(example), {
    waitUntil: "domcontentloaded",
  });
  expect(response).not.toBeNull();

  const initialHtml = await response.text();
  const documentLocale = initialHtml.match(/<html\b[^>]*\blang=["']([^"']+)["']/iu)?.[1];
  expect(documentLocale).toBe("de");
});

async function verifyRemixBrowserContract(example) {
  const page = await launchPage(remixLaunchArgs(example));
  verifyObservedArtifacts = observeBrowserArtifacts(page, example);
  let firstDocument = true;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const fragments = [];
  page.on("request", (request) => {
    if (request.url().includes("/catalog-fragments/")) fragments.push(request.url());
  });
  for (const locale of remixLocales()) {
    if (example.strategy === "cookie")
      await page.context().addCookies([{ name: "locale", value: locale, url: example.baseUrl }]);
    const response = await page.goto(remixDocumentUrl(example, locale), {
      waitUntil: "domcontentloaded",
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toContain("script-src 'self' 'nonce-");
    const html = await response.text();
    expect(html).toContain(`<html lang="${locale}" data-palamedes-time-zone="Europe/Berlin">`);
    expect(html).toContain(`/assets/__palamedes/catalog/${locale}.js`);
    expect(html).toContain("data-remix-client-proof");
    expect(html).toContain(
      {
        en: "Palamedes is active in the browser",
        de: "Palamedes ist im Browser aktiv",
        es: "Palamedes está activo en el navegador",
        fr: "Palamedes est actif dans le navigateur",
      }[locale],
    );
    expect(html).not.toContain('data-testid="client-ready"');
    await waitForClientReady(page);
    await expectRemixClientProof(page, locale, 1);
    if (firstDocument) {
      await verifyObservedArtifacts.checkpoint();
      firstDocument = false;
    }
    await page.getByTestId("client-increment").click();
    await expectRemixClientProof(page, locale, 2);
    const frameUrl = new URL(
      await page.getByTestId("client-rich-message").locator("a").getAttribute("href"),
      page.url(),
    );
    for (const path of [frameUrl.href, `${frameUrl.href}/locale-summary`]) {
      const frame = await page.evaluate(async (url) => {
        const response = await fetch(url);
        return {
          status: response.status,
          locale: response.headers.get("x-palamedes-locale"),
          body: await response.text(),
        };
      }, path);
      expect(frame.status).toBe(200);
      expect(frame.locale).toBe(locale);
      expect(frame.body).toContain(`Frame locale code: ${locale}`);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForClientReady(page);
    await expectRemixClientProof(page, locale, 1);
    await page.evaluate(() => {
      window.__remixParityDocument = true;
    });
    const next = locale === "de" ? "es" : "de";
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.getByTestId(`locale-switch-${next}`).click({ noWaitAfter: true }),
    ]);
    await waitForClientReady(page);
    expect(await page.locator("html").getAttribute("lang")).toBe(next);
    expect(page.url()).toBe(remixDocumentUrl(example, next));
    expect(await page.evaluate(() => window.__remixParityDocument)).toBeUndefined();
    await expectRemixClientProof(page, next, 1);
  }
  await page.waitForLoadState("networkidle");
  expect(fragments.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
}

test("matrix example browser contract", async () => {
  const example = activeExample();
  expect(example.id).not.toBe("");
  if (example.framework === "remix") return verifyRemixBrowserContract(example);

  const page = await launchPage(example.strategy === "tld" ? tldHostResolverArgs() : [], {
    // The browser sends es-ES to SSR, while client code sees en-US. A client
    // bootstrap which chooses navigator.language would therefore diverge from
    // the Spanish server document during hydration.
    browserLocale: example.strategy === "cookie" ? "es-ES" : "en-US",
    navigatorLocale: example.strategy === "cookie" ? "en-US" : undefined,
  });
  verifyObservedArtifacts = observeBrowserArtifacts(page, example);

  const pageErrors = [];
  const hydrationErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && isHydrationMismatch(message.text())) {
      hydrationErrors.push(message.text());
    }
  });

  if (example.id === "tanstack-route") {
    // Server-function URLs have no locale path. Exercise the documented
    // validated header policy when the document deliberately suppresses the
    // browser Referer header.
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (
        route.request().resourceType() !== "document" ||
        requestUrl.hostname !== "127.0.0.1" ||
        requestUrl.pathname !== "/de"
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "referrer-policy": "no-referrer" },
      });
    });
  }

  const initialUrl =
    example.strategy === "route"
      ? routeUrl(example.baseUrl)
      : example.strategy === "subdomain"
        ? example.subdomainUrl
        : example.strategy === "tld"
          ? example.tldUrl
          : `${example.baseUrl}/`;
  const initialResponse = await page.goto(initialUrl, { waitUntil: "domcontentloaded" });

  if (example.strategy === "client") {
    const mdxPage = page.getByTestId("mdx-page");
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Palamedes MDX handbook");

    await verifyObservedArtifacts.checkpoint();
    await page.getByTestId("page-link-extraction").click();
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Extract once, render everywhere");

    await page.getByTestId("page-link-runtime").click();
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("One locale per document");

    await page.getByTestId("locale-switch-de").click();
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Eine Sprache pro Dokument");

    await page.getByTestId("page-link-welcome").click();
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Palamedes-MDX-Handbuch");
    expectNoRuntimeErrors(pageErrors, hydrationErrors);
    await captureScreenshot(page, example, "interactive");
    return;
  }

  await expect
    .poll(() => currentServerLocale(page))
    .toMatch(example.strategy === "cookie" ? /español/iu : /english/iu);
  await expectSettledDocumentLocale(page, example.strategy === "cookie" ? "es" : "en");
  expectNoRuntimeErrors(pageErrors, hydrationErrors);
  if (hasClientLocaleProbe(example)) {
    await expect
      .poll(() => page.getByTestId("client-locale-value").textContent())
      .toBe("Añadir al carrito");
  }
  await verifyObservedArtifacts.checkpoint();
  await captureScreenshot(page, example, "initial");

  if (example.strategy === "cookie") {
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await page
      .getByTestId("locale-switch-de")
      .click({ force: true, noWaitAfter: true, timeout: 15_000 });
    await navigation;

    await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("de");
    await expect.poll(() => currentServerLocale(page)).toContain("Deutsch");

    await expectSettledDocumentLocale(page, "de");
    if (example.id === "nextjs-cookie") {
      await expect.poll(() => page.locator(".ticket .cta").textContent()).toBe("In den Warenkorb");
      await expect
        .poll(async () => (await page.locator("body").innerText()).includes("Add to cart"))
        .toBe(false);
    }
    await page.evaluate(() => {
      document.querySelector('[data-testid="server-proof-trigger"]')?.click();
    });
    await expect
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "",
      )
      .toContain("de");
    if (example.id === "waku-cookie") {
      await expect
        .poll(() => page.getByTestId("server-proof-sync").textContent())
        .toBe("Synchroner Serveraktionshelfer bestätigte Sprache.");
      await expect
        .poll(() => page.getByTestId("server-proof-async").textContent())
        .toBe("Asynchroner Serveraktionshelfer bestätigte Sprache.");
      await expect
        .poll(() => page.getByTestId("server-proof-cross-module").textContent())
        .toBe("Modulübergreifender Serveraktionshelfer bestätigte Sprache.");
      await expect
        .poll(() => page.getByTestId("server-proof-default-parameter").textContent())
        .toBe("Parameterstandard bestätigte Sprache.");

      const englishContext = await browser.newContext({
        locale: "en-US",
        timezoneId: "America/Los_Angeles",
      });
      const englishPage = await englishContext.newPage();
      await englishPage.goto(`${example.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await waitForClientReady(englishPage);
      await Promise.all([
        page.evaluate(() =>
          document.querySelector('[data-testid="server-proof-trigger"]')?.click(),
        ),
        englishPage.evaluate(() =>
          document.querySelector('[data-testid="server-proof-trigger"]')?.click(),
        ),
      ]);
      await expect
        .poll(
          async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "",
        )
        .toContain("de");
      await expect
        .poll(
          async () =>
            (await englishPage.getByTestId("server-proof-message").textContent())?.trim() ?? "",
        )
        .toContain("en");
      await englishContext.close();
    }
    await expectTanStackServerFunctionMessages(page, "de");
    await expectSettledDocumentLocale(page, "de");
    expectNoRuntimeErrors(pageErrors, hydrationErrors);
    await captureScreenshot(page, example, "interactive");
    return;
  }

  if (example.strategy === "subdomain") {
    // Switching locale loads a different host (de.<base>); the leftmost DNS
    // label is authoritative, so the path stays "/".
    await page
      .getByTestId("locale-switch-de")
      .click({ force: true, noWaitAfter: true, timeout: 15_000 });
    await page.waitForURL(germanDocumentUrl(example));
    await expect.poll(() => currentServerLocale(page)).toContain("Deutsch");

    await waitForClientReady(page);
    await page.evaluate(() => {
      document.querySelector('[data-testid="server-proof-trigger"]')?.click();
    });
    await expect
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "",
      )
      .toContain("de");
    await expectSettledDocumentLocale(page, "de");
    expectNoRuntimeErrors(pageErrors, hydrationErrors);
    await captureScreenshot(page, example, "interactive");
    return;
  }

  if (example.strategy === "tld") {
    // Switching locale swaps the top-level domain (the .com host becomes a .de
    // host); the tld is authoritative for the locale, so the path stays "/".
    await page
      .getByTestId("locale-switch-de")
      .click({ force: true, noWaitAfter: true, timeout: 15_000 });
    await page.waitForURL(germanDocumentUrl(example));
    await expect.poll(() => currentServerLocale(page)).toContain("Deutsch");

    await waitForClientReady(page);
    await page.evaluate(() => {
      document.querySelector('[data-testid="server-proof-trigger"]')?.click();
    });
    await expect
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "",
      )
      .toContain("de");
    await expectSettledDocumentLocale(page, "de");
    expectNoRuntimeErrors(pageErrors, hydrationErrors);
    await captureScreenshot(page, example, "interactive");
    return;
  }

  await page
    .getByTestId("locale-switch-de")
    .click({ force: true, noWaitAfter: true, timeout: 15_000 });
  await page.waitForURL(/\/de$/);
  expect(page.url()).toContain("/de");
  await expect.poll(() => currentServerLocale(page)).toContain("Deutsch");

  await waitForClientReady(page);
  await page.evaluate(() => {
    document.querySelector('[data-testid="server-proof-trigger"]')?.click();
  });
  await expect
    .poll(async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "")
    .toContain("de");
  if (example.id === "tanstack-route") {
    await expect
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "",
      )
      .toBe("Serverfunktion bestätigte Sprache de.");
  }
  await expectSettledDocumentLocale(page, "de");
  expectNoRuntimeErrors(pageErrors, hydrationErrors);
  await captureScreenshot(page, example, "interactive");

  if (!example.hostMismatchUrl) {
    // Hosted route origins need not have a locale-mapped alias. The route
    // authority and Accept-Language suggestion were checked above.
    return;
  }

  await page.goto(example.hostMismatchUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("locale-suggestion-cta").waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByTestId("locale-suggestion-cta")
    .click({ force: true, noWaitAfter: true, timeout: 15_000 });
  await page.waitForURL(/\/de$/);
  expect(page.url()).toContain("/de");
  expect(page.url()).toContain("de.lvh.me");
  await waitForClientReady(page);
  await expect.poll(() => currentServerLocale(page)).toContain("Deutsch");
  await expectSettledDocumentLocale(page, "de");
  expectNoRuntimeErrors(pageErrors, hydrationErrors);
});

test("French documents preserve translated UI, interaction, and reloads", async () => {
  const example = activeExample();
  const page = await launchPage(example.strategy === "tld" ? tldHostResolverArgs() : [], {
    browserLocale: "fr-FR",
    navigatorLocale: "en-US",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && isHydrationMismatch(message.text()))
      errors.push(message.text());
  });
  const url = new URL(example.subdomainUrl || example.tldUrl || example.baseUrl);
  if (example.strategy === "route") url.pathname = "/fr";
  if (example.strategy === "subdomain") url.hostname = url.hostname.replace(/^[^.]+/u, "fr");
  if (example.strategy === "tld") url.hostname = url.hostname.replace(/\.[^.]+$/u, ".fr");
  if (example.strategy === "client") url.searchParams.set("locale", "fr");
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
  expect(response.status()).toBe(200);
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("fr");
  if (example.strategy === "client") {
    await expect
      .poll(() => page.getByTestId("mdx-page").textContent())
      .toContain("Guide MDX de Palamedes");
    await page.getByTestId("page-link-runtime").click();
    await expect
      .poll(() => page.getByTestId("mdx-page").textContent())
      .toContain("Une langue par document");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => page.getByTestId("mdx-page").textContent())
      .toContain("Une langue par document");
  } else {
    expect(await response.text()).toContain("Ajouter au panier");
    await waitForClientReady(page);
    await expect.poll(() => page.locator(".ticket .cta").textContent()).toBe("Ajouter au panier");
    await page.locator(".stepper button").last().click();
    await expect.poll(() => page.locator(".stepper-num").textContent()).toBe("2");
    await expect.poll(() => page.locator(".total-value").textContent()).toContain("298,00");
    await page.getByTestId("server-proof-trigger").click();
    await expect.poll(() => page.getByTestId("server-proof-message").textContent()).toContain("fr");
    if (example.framework === "remix") {
      const failServerRequest = (route) => route.abort("failed");
      await page.route("**/server-status", failServerRequest);
      await page.getByTestId("server-proof-trigger").click();
      await expect
        .poll(() => page.getByTestId("server-proof-message").textContent())
        .toBe("La requête au serveur a échoué. Réessayez.");
      await page.unroute("**/server-status", failServerRequest);
      const retried = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/server-status"),
      );
      await page.getByTestId("server-proof-trigger").click();
      const result = await retried;
      expect(result.status()).toBe(200);
      expect((await result.json()).message).toContain("fr.");
      await expect
        .poll(() => page.getByTestId("server-proof-message").textContent())
        .toContain("fr.");
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForClientReady(page);
    await expect.poll(() => page.locator(".ticket .cta").textContent()).toBe("Ajouter au panier");
    await expect.poll(() => page.locator(".stepper-num").textContent()).toBe("1");
  }
  expect(await page.locator("html").getAttribute("lang")).toBe("fr");
  expect(errors).toEqual([]);
});
