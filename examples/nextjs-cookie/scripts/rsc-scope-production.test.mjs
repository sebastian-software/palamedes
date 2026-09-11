import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { chromium } from "@playwright/test";

const port = 4198;
const baseUrl = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
let serverOutput = "";

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", resolve));
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  await Promise.race([waitForExit(child), new Promise((resolve) => setTimeout(resolve, 2000))]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/rsc-scope-probe`, {
        headers: { "accept-language": "en" },
      });
      if (response.status >= 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Next.js on port ${port}`);
}

async function assertLocale(locale, expected) {
  const response = await fetch(`${baseUrl}/rsc-scope-probe`, {
    headers: { "accept-language": locale },
  });
  const body = await response.text();

  if (response.status !== 200 || !body.includes(`data-probe-locale="${locale}"`)) {
    throw new Error(
      `Expected ${locale} request to return 200 with its request locale, got ${response.status}`,
    );
  }
  if (!body.includes(`>${expected}</output>`)) {
    throw new Error(`Expected ${locale} response to contain ${JSON.stringify(expected)}`);
  }
}

async function assertServerActionLocale(locale, expected) {
  const initialResponse = await fetch(`${baseUrl}/server-action-probe`, {
    headers: { "accept-language": locale },
  });
  const initialBody = await initialResponse.text();
  const actionName = initialBody.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!actionName) {
    throw new Error(`Could not find the generated Server Action form field for ${locale}`);
  }

  const formData = new FormData();
  formData.set(actionName, "");

  const actionResponse = await fetch(`${baseUrl}/server-action-probe`, {
    method: "POST",
    headers: {
      "accept-language": locale,
      origin: baseUrl,
    },
    body: formData,
  });
  const actionBody = await actionResponse.text();

  if (
    actionResponse.status !== 200 ||
    !actionBody.includes(`data-action-locale="${locale}"`) ||
    !actionBody.includes(`>${expected}</output>`)
  ) {
    throw new Error(
      `Expected ${locale} Server Action to return its localized request result, got ${actionResponse.status} at ${actionResponse.url}: ${actionBody.slice(0, 500)}`,
    );
  }
}

async function browserContext(browser, options) {
  const context = await browser.newContext(options);
  // Enforce a production policy in the real browser. Hash Next's streamed
  // inline bootstrap, but allow neither unsafe-inline nor unsafe-eval scripts.
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
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
        "content-security-policy": `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'`,
      },
    });
  });
  return context;
}

async function assertClientGraphSplitting() {
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);

  try {
    for (const proof of [
      {
        locale: "en",
        activeHome: "Add to cart",
        inactiveHome: ["In den Warenkorb", "Añadir al carrito"],
        activeLazy: "Loaded only after client navigation",
        inactiveLazy: [
          "Erst nach Client-Navigation geladen",
          "Cargado solo después de la navegación del cliente",
        ],
      },
      {
        locale: "de",
        activeHome: "In den Warenkorb",
        inactiveHome: ["Add to cart", "Añadir al carrito"],
        activeLazy: "Erst nach Client-Navigation geladen",
        inactiveLazy: [
          "Loaded only after client navigation",
          "Cargado solo después de la navegación del cliente",
        ],
      },
    ]) {
      const context = await browserContext(browser, {
        extraHTTPHeaders: { "accept-language": proof.locale },
        locale: proof.locale,
      });
      const page = await context.newPage();
      const errors = [];
      const chunkResponses = [];

      page.on("console", (message) => {
        if (message.type() !== "error") return;

        const text = message.text();
        // Chromium reports optional document assets (for example favicon.ico)
        // without exposing their URL in this console message. Relevant Next.js
        // assets are checked explicitly in the response listener below.
        if (text.startsWith("Failed to load resource: the server responded with a status of 404")) {
          return;
        }
        errors.push(`console: ${text}`);
      });
      page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
      page.on("requestfailed", (request) => {
        const failure = request.failure()?.errorText ?? "unknown";
        if (failure !== "net::ERR_ABORTED" || request.url().includes("/_next/static/")) {
          errors.push(`request: ${request.url()} (${failure})`);
        }
      });
      page.on("response", (response) => {
        const url = response.url();
        if (response.status() >= 400 && url.includes("/_next/static/")) {
          errors.push(`response: ${url} (${response.status()})`);
        }
        if (!url.includes("/_next/static/") || !url.endsWith(".js")) return;
        chunkResponses.push(
          response
            .body()
            .then((body) => ({ source: body.toString("utf8"), url }))
            .catch(() => ({ source: "", url })),
        );
      });

      await page.goto(baseUrl);
      try {
        await page.getByTestId("client-ready").waitFor({ state: "attached" });
      } catch (error) {
        const html = await page.locator("html").innerHTML();
        throw new Error(
          `${proof.locale}: hydration marker did not appear. Browser errors: ${errors.join(" | ") || "none"}. HTML: ${html.slice(0, 500)}`,
          { cause: error },
        );
      }
      await page.waitForLoadState("networkidle");

      const initialResponseCount = chunkResponses.length;
      const initialChunks = await Promise.all(chunkResponses.slice(0, initialResponseCount));
      const initialSource = initialChunks.map(({ source }) => source).join("\n");

      assert(
        initialSource.includes(proof.activeHome),
        `${proof.locale}: initial client requests did not include the active home fragment`,
      );
      for (const sentinel of [...proof.inactiveHome, proof.activeLazy, ...proof.inactiveLazy]) {
        assert.equal(
          initialSource.includes(sentinel),
          false,
          `${proof.locale}: initial client requests unexpectedly included ${JSON.stringify(sentinel)}`,
        );
      }

      await page.getByTestId("open-lazy-client-probe").evaluate((button) => button.click());
      await page.getByTestId("lazy-client-message").waitFor();
      await page.waitForLoadState("networkidle");

      assert.equal(
        await page.getByTestId("lazy-client-message").textContent(),
        proof.activeLazy,
        `${proof.locale}: client navigation rendered before its active message fragment loaded`,
      );
      const navigationChunks = await Promise.all(chunkResponses.slice(initialResponseCount));
      const navigationSource = navigationChunks.map(({ source }) => source).join("\n");
      assert(
        navigationSource.includes(proof.activeLazy),
        `${proof.locale}: client navigation did not request its active message fragment`,
      );
      for (const sentinel of proof.inactiveLazy) {
        assert.equal(
          navigationSource.includes(sentinel),
          false,
          `${proof.locale}: client navigation requested inactive fragment ${JSON.stringify(sentinel)}`,
        );
      }
      assert.deepEqual(
        errors,
        [],
        `${proof.locale}: browser errors during hydration or navigation`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function assertLocaleSwitchThenClientNavigation() {
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);

  try {
    const context = await browserContext(browser, {
      extraHTTPHeaders: { "accept-language": "en" },
      locale: "en",
    });
    const page = await context.newPage();
    const errors = [];
    const chunkResponses = [];

    page.on("console", (message) => {
      if (message.type() !== "error") return;

      const text = message.text();
      if (text.startsWith("Failed to load resource: the server responded with a status of 404")) {
        return;
      }
      errors.push(`console: ${text}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "unknown";
      if (failure !== "net::ERR_ABORTED" || request.url().includes("/_next/static/")) {
        errors.push(`request: ${request.url()} (${failure})`);
      }
    });
    page.on("response", (response) => {
      const url = response.url();
      if (response.status() >= 400 && url.includes("/_next/static/")) {
        errors.push(`response: ${url} (${response.status()})`);
      }
      if (!url.includes("/_next/static/") || !url.endsWith(".js")) return;
      chunkResponses.push(
        response
          .body()
          .then((body) => ({ source: body.toString("utf8"), url }))
          .catch(() => ({ source: "", url })),
      );
    });

    await page.goto(baseUrl);
    await page.getByTestId("client-ready").waitFor({ state: "attached" });

    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.getByTestId("locale-switch-de").click({ noWaitAfter: true });
    await navigation;
    await page.getByTestId("client-ready").waitFor({ state: "attached" });
    await page.waitForLoadState("networkidle");

    assert.equal(await page.locator("html").getAttribute("lang"), "de");
    assert.equal((await page.getByTestId("server-locale-value").textContent())?.trim(), "Deutsch");
    assert.equal((await page.locator(".ticket .cta").textContent())?.trim(), "In den Warenkorb");
    assert.equal((await page.locator("body").innerText()).includes("Add to cart"), false);

    const responseCountBeforeClientNavigation = chunkResponses.length;
    await page.getByTestId("open-lazy-client-probe").evaluate((button) => button.click());
    await page.getByTestId("lazy-client-message").waitFor();
    await page.waitForLoadState("networkidle");

    assert.equal(
      await page.getByTestId("lazy-client-message").textContent(),
      "Erst nach Client-Navigation geladen",
      "locale switch followed by client navigation rendered the wrong message fragment",
    );
    const navigationChunks = await Promise.all(
      chunkResponses.slice(responseCountBeforeClientNavigation),
    );
    const navigationSource = navigationChunks.map(({ source }) => source).join("\n");
    assert(
      navigationSource.includes("Erst nach Client-Navigation geladen"),
      "locale switch followed by client navigation did not request the German message fragment",
    );
    for (const inactiveFragment of [
      "Loaded only after client navigation",
      "Cargado solo después de la navegación del cliente",
    ]) {
      assert.equal(
        navigationSource.includes(inactiveFragment),
        false,
        `locale switch followed by client navigation requested inactive fragment ${JSON.stringify(inactiveFragment)}`,
      );
    }
    assert.deepEqual(
      errors,
      [],
      "locale switch followed by client navigation caused browser errors",
    );
    await context.close();
  } finally {
    await browser.close();
  }
}

async function assertFragmentFailures() {
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
  const chunkDirectory = new URL("../.next/static/chunks/", import.meta.url);
  const chunks = readdirSync(chunkDirectory).filter((name) => name.endsWith(".js"));
  try {
    for (const phase of ["initial", "navigation"]) {
      const sentinel =
        phase === "initial" ? "In den Warenkorb" : "Erst nach Client-Navigation geladen";
      const selected = chunks.filter((name) =>
        readFileSync(new URL(name, chunkDirectory), "utf8").includes(sentinel),
      );
      assert(selected.length > 0, `No emitted native ${phase} fragment found`);
      for (const failureMode of ["network", "evaluation"]) {
        const context = await browserContext(browser, {
          extraHTTPHeaders: { "accept-language": "de" },
          locale: "de",
        });
        let failedRequests = 0;
        await context.route("**/_next/static/**", async (route) => {
          if (
            !selected.some((name) => new URL(route.request().url()).pathname.endsWith(`/${name}`))
          )
            return route.continue();
          failedRequests += 1;
          if (failureMode === "network") return route.abort("failed");
          const response = await route.fetch();
          return route.fulfill({
            response,
            body: (await response.text()).replace(
              JSON.stringify(sentinel),
              '(()=>{throw new Error("PALAMEDES_PRIVATE_FRAGMENT_DIAGNOSTIC")})()',
            ),
          });
        });
        const page = await context.newPage();
        await page.goto(baseUrl);
        if (phase === "navigation") {
          await page.getByTestId("client-ready").waitFor({ state: "attached" });
          assert.equal(failedRequests, 0, "Lazy catalog was requested before navigation");
          await page.getByTestId("open-lazy-client-probe").evaluate((button) => button.click());
        }
        await page.locator('main[role="alert"]').waitFor();
        assert(failedRequests > 0, "Failure fixture did not reach an emitted catalog request");
        const errorCopy = await page.locator('main[role="alert"]').innerText();
        assert.match(errorCopy, /temporarily unavailable/u);
        assert.doesNotMatch(errorCopy, /PALAMEDES_PRIVATE|palamedes-m-|XHAxica|Error:/u);
        await context.unroute("**/_next/static/**");
        await page.getByRole("button", { name: "Reload page" }).click();
        if (phase === "navigation") await page.getByTestId("lazy-client-message").waitFor();
        else await page.getByTestId("client-ready").waitFor({ state: "attached" });
        assert.equal(await page.locator('main[role="alert"]').count(), 0);
        console.log(
          `Next ${phase} ${failureMode} failure reached ordinary error UI and document reload recovered under CSP`,
        );
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

const server = spawn(process.execPath, [nextCli, "start", "--port", String(port)], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverOutput += chunk;
  });
}

try {
  await waitForServer();
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? assertLocale("en", "More tickets") : assertLocale("de", "Mehr Tickets"),
    ),
  );
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0
        ? assertServerActionLocale("en", "Server action confirmed locale en.")
        : assertServerActionLocale("de", "Server-Action bestätigte Sprache de."),
    ),
  );
  await assertClientGraphSplitting();
  await assertLocaleSwitchThenClientNavigation();
  await assertFragmentFailures();
  console.log(
    "Next.js production scopes stayed request-local and client requests followed locale × route graphs after a document locale switch",
  );
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  await stopServer(server);
}
