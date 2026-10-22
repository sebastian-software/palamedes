import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

const translations = {
  en: {
    title: "Book your seat at Frontend Stage 2026",
    more: "More tickets",
    fewer: "Fewer tickets",
    tickets: ["1 ticket", "2 tickets"],
    cart: "Add to cart",
    result: "Added 2 tickets to your cart.",
    tip: "Lazy catalog detail loaded.",
  },
  de: {
    title: "Sichere dir deinen Platz bei Frontend Stage 2026",
    more: "Mehr Tickets",
    fewer: "Weniger Tickets",
    tickets: ["1 Ticket", "2 Tickets"],
    cart: "In den Warenkorb",
    result: "2 Tickets zum Warenkorb hinzugefügt.",
    tip: "Katalogdetails wurden bei Bedarf geladen.",
  },
  fr: {
    title: "Réservez votre place à Frontend Stage 2026",
    more: "Plus de billets",
    fewer: "Moins de billets",
    tickets: ["1 billet", "2 billets"],
    cart: "Ajouter au panier",
    result: "2 billets ajoutés à votre panier.",
    tip: "Le détail du catalogue a été chargé à la demande.",
  },
  es: {
    title: "Reserva tu plaza en Frontend Stage 2026",
    more: "Más entradas",
    fewer: "Menos entradas",
    tickets: ["1 entrada", "2 entradas"],
    cart: "Añadir al carrito",
    result: "Se han añadido 2 entradas a tu carrito.",
    tip: "El detalle del catálogo se cargó bajo demanda.",
  },
};

async function start(mode, directory = root) {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const args =
    mode === "production"
      ? ["build/index.js"]
      : [
          "node_modules/vite/bin/vite.js",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--strictPort",
        ];
  const child = spawn(process.execPath, args, {
    cwd: directory,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      ORIGIN: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const close = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid, "SIGTERM");
    await exited;
  };
  let lastResponse = "";
  try {
    for (let attempt = 0; attempt < 180; attempt++) {
      if (child.exitCode !== null) throw new Error(output);
      try {
        const response = await fetch(`${origin}/?locale=en`);
        if (response.ok) return { origin, close };
        lastResponse = (await response.text()).slice(0, 3000);
      } catch {}
      await setTimeout(250);
    }
    throw new Error(`SvelteKit ${mode} did not become ready.\n${lastResponse}\n${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}

for (const mode of ["production", "development"]) {
  test(
    `${mode}: SSR, hydration, active-locale fragments, request isolation, and lazy navigation`,
    { timeout: 180_000 },
    async () => {
      const server = await start(mode);
      try {
        for (const [locale, copy] of Object.entries(translations)) {
          const response = await fetch(`${server.origin}/?locale=${locale}`);
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.ok(html.includes(copy.title), "SSR must contain the translated booking heading");
          assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`));
          assert.ok(html.includes('data-palamedes-time-zone="Europe/Berlin"'));
          const noJs = await browser.newContext({ javaScriptEnabled: false });
          try {
            const page = await noJs.newPage();
            await page.goto(`${server.origin}/?locale=${locale}`);
            await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
            await expect(page.getByTestId("ticket-count")).toHaveText(copy.tickets[0]);
            await expect(page.getByTestId("server-proof-message")).toContainText(locale);
          } finally {
            await noJs.close();
          }

          const context = await browser.newContext();
          try {
            const page = await context.newPage();
            const errors = [];
            const catalogs = [];
            const warnings = [];
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
              if (/hydration/i.test(message.text())) warnings.push(message.text());
            });
            page.on("request", (request) => {
              const path = decodeURIComponent(new URL(request.url()).pathname);
              if (
                mode === "production"
                  ? /palamedes-m-.*\.js/u.test(path)
                  : /palamedes:messages\/[^/]+\/(?:en|de|fr|es)$/u.test(path)
              )
                catalogs.push(path);
            });
            await page.goto(`${server.origin}/?locale=${locale}`);
            await expect(page.getByTestId("client-ready")).toHaveCount(1);
            await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
            await expect(page.getByTestId("client-locale-value")).toHaveText(locale.toUpperCase());
            await page.getByRole("button", { name: copy.more, exact: true }).click();
            await expect(page.getByTestId("ticket-count")).toHaveText(copy.tickets[1]);
            await expect(page.getByTestId("ticket-total")).toHaveText(
              new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(298),
            );
            await page.getByRole("button", { name: copy.cart, exact: true }).click();
            await expect(page.getByTestId("cart-message")).toHaveText(copy.result);
            const refreshed = page.waitForResponse(
              (response) => new URL(response.url()).pathname === "/api/proof",
            );
            await page.getByTestId("server-proof-trigger").click();
            assert.equal((await (await refreshed).json()).locale, locale);
            await expect(page.getByTestId("server-proof-message")).toContainText(locale);
            assert.equal(catalogs.length, 3, JSON.stringify(catalogs));
            await page.getByTestId("lazy-catalog-trigger").click();
            await expect(page.getByTestId("lazy-catalog-details")).toHaveText(copy.tip);
            assert.equal(catalogs.length, 4);
            await page.getByTestId("lazy-catalog-trigger").click();
            await page.getByTestId("lazy-catalog-trigger").click();
            await expect(page.getByTestId("lazy-catalog-details")).toHaveText(copy.tip);
            assert.equal(catalogs.length, 4);
            const navigated = [];
            page.on("request", (request) => {
              if (request.isNavigationRequest() && request.resourceType() === "document")
                navigated.push(request.url());
            });
            await page.getByTestId("insights-link").click();
            await expect(page.getByTestId("insights-title")).toHaveText(copy.tip);
            assert.equal(catalogs.length, 5, "A SvelteKit lazy page must bring its own fragment");
            assert.deepEqual(navigated, [], "Same-locale page changes stay in the document");
            await page.getByTestId("booking-link").click();
            await expect(page.getByTestId("ticket-count")).toHaveText(copy.tickets[0]);
            const nextLocale = locale === "de" ? "fr" : "de";
            await page.getByTestId(`locale-switch-${nextLocale}`).click();
            await expect(page.getByRole("heading", { level: 1 })).toHaveText(
              translations[nextLocale].title,
            );
            assert.equal(navigated.length, 1, "A language switch must start a new document");
            const oldCatalogs = catalogs.filter((url) =>
              mode === "production" ? url.includes(`.${locale}-`) : url.endsWith(`/${locale}`),
            );
            assert.equal(
              oldCatalogs.length,
              5,
              "Every previous fragment belongs to the active locale",
            );
            assert.deepEqual(errors, []);
            assert.deepEqual(warnings, []);
          } finally {
            await context.close();
          }
        }

        const checks = Array.from({ length: 24 }, (_, index) => {
          const locale = Object.keys(translations)[index % 4];
          return Promise.all([
            fetch(`${server.origin}/?locale=${locale}&delay=${(index % 5) * 7}`).then(
              async (response) => {
                assert.equal(response.status, 200);
                assert.ok((await response.text()).includes(translations[locale].title));
              },
            ),
            fetch(`${server.origin}/api/proof?locale=${locale}&delay=${(index % 5) * 7}`).then(
              async (response) => {
                const proof = await response.json();
                assert.deepEqual(
                  [proof.locale, proof.before, proof.after],
                  [locale, locale, locale],
                );
                assert.ok(proof.message.endsWith(`${locale}.`));
              },
            ),
          ]);
        });
        await Promise.all(checks);
        const fallback = await fetch(`${server.origin}/?locale=unsupported`);
        assert.ok((await fallback.text()).includes(translations.en.title));
        const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
          await mobile.goto(`${server.origin}/?locale=de`);
          await expect(mobile.getByTestId("client-ready")).toHaveCount(1);
          assert.equal(
            await mobile
              .locator("html")
              .evaluate((element) => element.scrollWidth <= element.clientWidth),
            true,
          );
        } finally {
          await mobile.close();
        }

        if (mode === "production") {
          const initial = await browser.newPage();
          try {
            await initial.route("**/palamedes-m-*.fr-*.js", (route) => route.abort());
            await initial.goto(`${server.origin}/?locale=fr`);
            await expect(initial.getByRole("alert")).toContainText(
              "This page is temporarily unavailable.",
            );
            await expect(initial.getByTestId("ticket-count")).toHaveCount(0);
            await expect(initial.getByTestId("client-ready")).toHaveCount(0);
          } finally {
            await initial.close();
          }
          const lazy = await browser.newPage();
          try {
            let count = 0;
            await lazy.route("**/palamedes-m-*.fr-*.js", (route) =>
              ++count > 3 ? route.abort() : route.continue(),
            );
            await lazy.goto(`${server.origin}/?locale=fr`);
            await expect(lazy.getByTestId("client-ready")).toHaveCount(1);
            await lazy.getByTestId("lazy-catalog-trigger").click();
            await expect(lazy.getByTestId("lazy-catalog-error")).toBeVisible();
            await expect(lazy.getByTestId("lazy-catalog-details")).toHaveCount(0);
            await lazy.getByRole("button", { name: translations.fr.more, exact: true }).click();
            await expect(lazy.getByTestId("ticket-count")).toHaveText(translations.fr.tickets[1]);
          } finally {
            await lazy.close();
          }
        }
      } finally {
        await server.close();
      }
    },
  );
}

test("native extraction includes Svelte components and endpoint source without drift", () => {
  const cli = fileURLToPath(new URL("../../../packages/cli/bin/pmds", import.meta.url));
  execFileSync(process.execPath, [cli, "extract", "--check"], { cwd: root, stdio: "pipe" });
});

test("the production output runs outside the checkout without build tooling", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "palamedes-sveltekit-output-"));
  try {
    cpSync(path.join(root, "build"), path.join(directory, "build"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    writeFileSync(path.join(directory, "package.json"), '{"type":"module"}\n');
    const server = await start("production", directory);
    try {
      for (const [locale, copy] of Object.entries(translations)) {
        const response = await fetch(`${server.origin}/?locale=${locale}`);
        assert.equal(response.status, 200);
        assert.ok((await response.text()).includes(copy.title));
        const proof = await (await fetch(`${server.origin}/api/proof?locale=${locale}`)).json();
        assert.deepEqual([proof.before, proof.after], [locale, locale]);
      }
    } finally {
      await server.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
