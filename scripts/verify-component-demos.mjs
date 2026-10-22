import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { COMPONENT_DEMOS } from "./component-demos.mjs";
import { selectDeployment } from "./demo-deployment.mjs";
import { buildStartArgs, buildStartEnv } from "./container/start-plan.mjs";

const copy = {
  en: [
    "Book your seat at Frontend Stage 2026",
    "More tickets",
    "2 tickets",
    "Lazy catalog detail loaded.",
  ],
  de: [
    "Sichere dir deinen Platz bei Frontend Stage 2026",
    "Mehr Tickets",
    "2 Tickets",
    "Katalogdetails wurden bei Bedarf geladen.",
  ],
  fr: [
    "Réservez votre place à Frontend Stage 2026",
    "Plus de billets",
    "2 billets",
    "Le détail du catalogue a été chargé à la demande.",
  ],
  es: [
    "Reserva tu plaza en Frontend Stage 2026",
    "Más entradas",
    "2 entradas",
    "El detalle del catálogo se cargó bajo demanda.",
  ],
};
function localeUrl(entry, locale) {
  const url = new URL(entry.origin);
  if (entry.strategy === "route") url.pathname = `/${locale}`;
  if (entry.strategy === "subdomain") url.hostname = url.hostname.replace(/^en\./u, `${locale}.`);
  if (entry.strategy === "tld")
    url.hostname = url.hostname.replace(/\.com$/u, locale === "en" ? ".com" : `.${locale}`);
  return url;
}

export async function verifyComponentDemo(browser, entry) {
  for (const [locale, [title, more, plural, detail]] of Object.entries(copy)) {
    // Use a conflicting preference to distinguish URL authority from negotiation.
    const context = await browser.newContext({
      locale: "es",
      timezoneId: "America/Los_Angeles",
    });
    if (entry.strategy === "cookie")
      await context.addCookies([{ name: "locale", value: locale, url: entry.origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/hydration.*(mismatch|fail)/iu.test(message.text())) errors.push(message.text());
    });
    const url = localeUrl(entry, locale);
    try {
      await page.goto(url.href);
      await expect(page.getByTestId("client-ready")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(title);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByTestId("client-locale-value")).toHaveText(locale.toUpperCase());
      await page.getByRole("button", { name: more, exact: true }).click();
      await expect(page.getByTestId("ticket-count")).toHaveText(plural);
      await page.getByTestId("lazy-catalog-trigger").click();
      await expect(page.getByTestId("lazy-catalog-details")).toHaveText(detail);
      if (entry.rendering === "ssr") {
        const proofResponse = page.waitForResponse(
          (response) => new URL(response.url()).pathname === "/api/proof",
        );
        await page.getByTestId("server-proof-trigger").click();
        assert.equal((await (await proofResponse).json()).locale, locale);
        const documents = [];
        const recordDocument = (request) => {
          if (request.isNavigationRequest() && request.resourceType() === "document")
            documents.push(request.url());
        };
        page.on("request", recordDocument);
        await page.getByTestId("insights-link").click();
        await expect(page.getByTestId("insights-title")).toHaveText(detail);
        if (entry.strategy === "route")
          assert.equal(new URL(page.url()).pathname, `/${locale}/insights`);
        await page.getByTestId("booking-link").click();
        await expect(page.locator("h1")).toHaveText(title);
        assert.deepEqual(
          documents,
          [],
          `${entry.id}: same-locale navigation must reuse the document`,
        );
        page.off("request", recordDocument);
      }
      const next = locale === "de" ? "fr" : "de";
      await page.getByTestId(`locale-switch-${next}`).click();
      await expect(page.locator("html")).toHaveAttribute("lang", next);
      await expect(page.locator("h1")).toHaveText(copy[next][0]);
      assert.equal(new URL(page.url()).hostname, localeUrl(entry, next).hostname);
      if (entry.strategy === "route") assert.equal(new URL(page.url()).pathname, `/${next}`);
      await page.reload();
      await expect(page.locator("h1")).toHaveText(copy[next][0]);
      assert.deepEqual(errors, [], `${entry.id}: browser errors`);
    } finally {
      await context.close();
    }
    if (entry.rendering === "ssr") {
      const nojs = await browser.newContext({ javaScriptEnabled: false, locale });
      try {
        const document = await nojs.newPage();
        await document.goto(url.href);
        await expect(document.locator("h1")).toHaveText(title);
      } finally {
        await nojs.close();
      }
    }
  }
  if (entry.strategy === "route" || entry.strategy === "cookie") {
    const context = await browser.newContext({ locale: "de" });
    try {
      const page = await context.newPage();
      await page.goto(entry.origin);
      if (entry.strategy === "route") await expect(page).toHaveURL(/\/de$/u);
      await expect(page.locator("h1")).toHaveText(copy.de[0]);
    } finally {
      await context.close();
    }
  }
}

if (process.argv[1] === import.meta.filename) {
  const local = process.argv.includes("--local");
  const idIndex = process.argv.indexOf("--id");
  const ids = idIndex === -1 ? COMPONENT_DEMOS.map(({ id }) => id) : [process.argv[idIndex + 1]];
  const plan = selectDeployment(ids);
  const children = [];
  let browser;
  try {
    if (local) {
      for (const entry of plan) {
        const demo = COMPONENT_DEMOS.find(({ id }) => id === entry.id);
        const child = spawn("pnpm", buildStartArgs(demo), {
          cwd: demo.cwd,
          detached: true,
          env: buildStartEnv(demo, process.env),
          stdio: "ignore",
        });
        children.push(child);
        entry.origin = `http://${entry.hosts[0]}:${entry.port}`;
        const deadline = Date.now() + 60_000;
        for (;;) {
          try {
            await new Promise((resolve, reject) => {
              const request = http.get(
                {
                  hostname: "127.0.0.1",
                  port: entry.port,
                  path: demo.smokeChecks[0].path,
                  headers: demo.smokeChecks[0].headers,
                },
                (response) => {
                  response.resume();
                  response.statusCode < 400
                    ? resolve()
                    : reject(new Error(`HTTP ${response.statusCode}`));
                },
              );
              request.on("error", reject);
            });
            break;
          } catch (error) {
            if (Date.now() > deadline) throw error;
            await setTimeout(200);
          }
        }
      }
    }
    browser = await chromium.launch({
      headless: true,
      args: local
        ? [
            "--no-proxy-server",
            "--host-resolver-rules=MAP *.examples.palamedes.dev 127.0.0.1, MAP *.examples.palamedes-i18n.* 127.0.0.1",
          ]
        : [],
    });
    for (const entry of plan) {
      await verifyComponentDemo(browser, entry);
      console.log(`${entry.id}: four locales, navigation, interaction, and lazy catalogs passed`);
    }
  } finally {
    await browser?.close();
    for (const child of children) {
      if (child.exitCode === null) process.kill(-child.pid, "SIGTERM");
    }
  }
}
