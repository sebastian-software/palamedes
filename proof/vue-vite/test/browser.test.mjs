import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";
import { palamedes } from "@palamedes/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { build, createServer, preview } from "vite";

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
    title: "Plan your next trip",
    name: "Traveler name",
    greeting: "Welcome, Sam!",
    add: "Add traveler",
    remove: "Remove traveler",
    counts: ["No travelers yet", "1 traveler ready", "2 travelers ready"],
    details: "Show packing tip",
    tip: "Pack light. Leave room for memories.",
  },
  fr: {
    title: "Préparez votre prochain voyage",
    name: "Nom du voyageur",
    greeting: "Bienvenue, Sam !",
    add: "Ajouter un voyageur",
    remove: "Retirer un voyageur",
    counts: ["Aucun voyageur pour le moment", "1 voyageur prêt", "2 voyageurs prêts"],
    details: "Voir le conseil de voyage",
    tip: "Voyagez léger. Gardez de la place pour les souvenirs.",
  },
  es: {
    title: "Prepara tu próximo viaje",
    name: "Nombre del viajero",
    greeting: "¡Bienvenido, Sam!",
    add: "Añadir viajero",
    remove: "Quitar viajero",
    counts: ["Todavía no hay viajeros", "1 viajero listo", "2 viajeros listos"],
    details: "Ver consejo de viaje",
    tip: "Viaja ligero. Deja espacio para los recuerdos.",
  },
};

for (const mode of ["development", "production"]) {
  test(`${mode}: Vue reactivity, active-locale delivery, lazy messages, and document navigation`, async () => {
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
            ) {
              catalogs.push(url);
            }
          });
          await page.goto(`${origin}?locale=${locale}`);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await page.getByLabel(copy.name).fill("Sam");
          await expect(page.getByTestId("greeting")).toHaveText(copy.greeting);
          await expect(page.getByTestId("traveler-count")).toHaveText(copy.counts[1]);
          await page.getByRole("button", { name: copy.add, exact: true }).click();
          await expect(page.getByTestId("traveler-count")).toHaveText(copy.counts[2]);
          await page
            .getByRole("button", { name: copy.remove, exact: true })
            .click({ clickCount: 2 });
          await expect(page.getByTestId("traveler-count")).toHaveText(copy.counts[0]);
          await expect(page.getByRole("button", { name: copy.remove, exact: true })).toBeDisabled();
          assert.equal(catalogs.length, 1, "Only the entry message fragment should load initially");
          await page.getByRole("button", { name: copy.details }).click();
          await expect(page.getByTestId("packing-tip")).toHaveText(copy.tip);
          assert.equal(catalogs.length, 2, "The async Vue component should load its own fragment");
          for (const url of catalogs) {
            assert.ok(
              mode === "production" ? url.includes(`.${locale}-`) : url.endsWith(`/${locale}`),
              url,
            );
          }
          await page.getByRole("button", { name: copy.add, exact: true }).click();
          assert.equal(catalogs.length, 2, "Reactive updates should reuse the loaded catalogs");

          // A real document navigation must reset Vue state and replace the locale.
          const nextLocale = locale === "en" ? "fr" : "en";
          const nextLabel = nextLocale === "fr" ? "Français" : "English";
          await page.getByRole("link", { name: nextLabel, exact: true }).click();
          await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            translations[nextLocale].title,
          );
          await expect(page.getByLabel(translations[nextLocale].name)).toHaveValue("Alex");
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
          await expect(failedPage.getByTestId("greeting")).toHaveCount(0);
        } finally {
          await failedPage.close();
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

test("direct macros in a Vue SFC still require a host integration", async () => {
  await assert.rejects(
    build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [palamedes({ framework: "none", mdx: false }), vue()],
      build: {
        write: false,
        rolldownOptions: {
          input: fileURLToPath(new URL("fixtures/Inline.vue", import.meta.url)),
        },
      },
    }),
    /macro.*outside the context of compilation/su,
  );
});
