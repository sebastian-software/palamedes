import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";
import { createServer, preview } from "vite";

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

for (const mode of ["development", "production"]) {
  test(`${mode}: direct SFC macros, shared booking demo, locale isolation, and lazy catalogs`, async () => {
    const server =
      mode === "development"
        ? await createServer({ root, server: { host: "127.0.0.1", port: 0 } })
        : await preview({ root, preview: { host: "127.0.0.1", port: 0 } });
    if (mode === "development") await server.listen();
    const origin = server.resolvedUrls.local[0];
    try {
      for (const [locale, copy] of Object.entries(translations)) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const errors = [];
          const catalogs = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("request", (request) => {
            const url = decodeURIComponent(new URL(request.url()).pathname);
            if (
              mode === "production"
                ? /palamedes-m-.*\.js/u.test(url)
                : /palamedes:messages\/[^/]+\/(?:en|fr|es)$/u.test(url)
            )
              catalogs.push(url);
          });
          await page.goto(`${origin}?locale=${locale}`);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expect(
            page.getByRole("heading", { name: "Frontend Stage 2026", exact: true }),
          ).toBeVisible();
          await expect(page.getByTestId("ticket-count")).toHaveText(copy.tickets[0]);
          await expect(page.getByRole("button", { name: copy.fewer, exact: true })).toBeDisabled();
          await page.getByRole("button", { name: copy.more, exact: true }).click();
          await expect(page.getByTestId("ticket-count")).toHaveText(copy.tickets[1]);
          const total = new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "EUR",
          }).format(298);
          await expect(page.getByTestId("ticket-total")).toHaveText(total);
          await page.getByRole("button", { name: copy.cart, exact: true }).click();
          await expect(page.getByTestId("cart-message")).toHaveText(copy.result);
          await page.getByTestId("client-proof-trigger").click();
          assert.equal(
            catalogs.length,
            3,
            "Only the three entry SFC fragments should load initially",
          );
          await page.getByTestId("lazy-catalog-trigger").click();
          await expect(page.getByTestId("lazy-catalog-details")).toHaveText(copy.tip);
          assert.equal(catalogs.length, 4, "The async SFC should load its own fragment");
          for (const url of catalogs)
            assert.ok(
              mode === "production" ? url.includes(`.${locale}-`) : url.endsWith(`/${locale}`),
              url,
            );
          await page.getByTestId("lazy-catalog-trigger").click();
          await page.getByTestId("lazy-catalog-trigger").click();
          await expect(page.getByTestId("lazy-catalog-details")).toHaveText(copy.tip);
          assert.equal(catalogs.length, 4, "Remounting should reuse the loaded SFC catalog");
          const nextLocale = locale === "en" ? "fr" : "en";
          await page.getByTestId(`locale-switch-${nextLocale}`).click();
          await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            translations[nextLocale].title,
          );
          await expect(page.getByTestId("ticket-count")).toHaveText(
            translations[nextLocale].tickets[0],
          );
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      }
      const page = await browser.newPage();
      try {
        await page.goto(`${origin}?locale=unsupported`);
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(translations.en.title);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await page
            .locator("html")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
          true,
        );
      } finally {
        await page.close();
      }

      if (mode === "production") {
        const failedPage = await browser.newPage();
        try {
          await failedPage.route("**/palamedes-m-*.fr-*.js", (route) => route.abort());
          await failedPage.goto(`${origin}?locale=fr`);
          await expect(failedPage.getByRole("alert")).toContainText(
            "This page is temporarily unavailable.",
          );
          await expect(failedPage.getByTestId("ticket-count")).toHaveCount(0);
        } finally {
          await failedPage.close();
        }

        const lazyFailure = await browser.newPage();
        try {
          let requests = 0;
          await lazyFailure.route("**/palamedes-m-*.fr-*.js", (route) =>
            ++requests > 3 ? route.abort() : route.continue(),
          );
          await lazyFailure.goto(`${origin}?locale=fr`);
          await expect(lazyFailure.getByTestId("ticket-count")).toHaveText(
            translations.fr.tickets[0],
          );
          await lazyFailure.getByTestId("lazy-catalog-trigger").click();
          await expect(lazyFailure.getByTestId("lazy-catalog-error")).toBeVisible();
          await expect(lazyFailure.getByTestId("lazy-catalog-details")).toHaveCount(0);
          await lazyFailure
            .getByRole("button", { name: translations.fr.more, exact: true })
            .click();
          await expect(lazyFailure.getByTestId("ticket-count")).toHaveText(
            translations.fr.tickets[1],
          );
        } finally {
          await lazyFailure.close();
        }
      }
    } finally {
      if (mode === "development") await server.close();
      else
        await new Promise((resolve, reject) =>
          server.httpServer.close((error) => (error ? reject(error) : resolve())),
        );
    }
  });
}

test("native CLI extraction agrees with the direct-SFC production build", () => {
  const cli = fileURLToPath(new URL("../../../packages/cli/bin/pmds", import.meta.url));
  execFileSync(process.execPath, [cli, "extract", "--check"], { cwd: root, stdio: "pipe" });
});
