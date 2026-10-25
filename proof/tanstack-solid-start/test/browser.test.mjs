import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const base = "http://127.0.0.1:4076";
const messages = {
  de: {
    server: "Server-Rendern bestätigte Sprache.",
    fn: "Serverfunktion bestätigte Sprache.",
    helper: "Modulübergreifender Helfer bestätigte Sprache.",
    lazy: "Lokales Browserfragment bestätigte Sprache.",
    navigation: "Navigation bestätigte Sprache.",
  },
  fr: {
    server: "Le rendu serveur a confirmé la langue.",
    fn: "La fonction serveur a confirmé la langue.",
    helper: "La fonction auxiliaire intermodule a confirmé la langue.",
    lazy: "Le fragment du navigateur chargé à la demande a confirmé la langue.",
    navigation: "La navigation a confirmé la langue.",
  },
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start() {
  const child = spawn("pnpm", ["preview"], {
    cwd: root,
    env: { ...process.env, PALAMEDES_I18N_TEST_BARRIER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (value) => {
    log += value;
  });
  child.stderr.on("data", (value) => {
    log += value;
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base);
      return child;
    } catch {
      await pause(100);
    }
    if (child.exitCode !== null) throw new Error(log);
  }
  child.kill();
  throw new Error(`Start preview did not listen: ${log}`);
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
async function text(page, id, expected) {
  await page.getByTestId(id).waitFor();
  try {
    await page.waitForFunction(
      ({ id, expected }) =>
        document.querySelector(`[data-testid="${id}"]`)?.textContent === expected,
      { id, expected },
      { timeout: 10_000 },
    );
  } catch (error) {
    throw new Error(
      `${id}: expected ${expected}; actual ${await page.getByTestId(id).textContent()}`,
      { cause: error },
    );
  }
}

test(
  "Solid Start SSR, hydration, navigation, locale isolation, and catalog recovery",
  { timeout: 120_000 },
  async () => {
    const server = await start();
    const browser = await chromium.launch();
    try {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => ["de", "fr"])
          .flat()
          .map(async (locale) => {
            const response = await fetch(base, {
              headers: { cookie: `session=proof; locale=${locale}` },
            });
            assert.equal(
              response.status,
              200,
              "Solid Start SSR must work with the patched core; see the documented upstream blocker.",
            );
            assert.equal(response.headers.has("set-cookie"), false);
            const html = await response.text();
            assert.match(html, new RegExp(`lang="${locale}"`));
            assert.ok(html.includes(messages[locale].server));
            assert.doesNotMatch(html, /["']\/#pmds\//u);
            return response;
          }),
      );
      assert.equal(responses.length, 8);
      const preferred = await fetch(base, { headers: { "accept-language": "fr-CA,en;q=0.5" } });
      assert.ok((await preferred.text()).includes(messages.fr.server));

      const contexts = await Promise.all(
        ["de", "fr"].map(async (locale) => {
          const context = await browser.newContext();
          await context.addCookies([{ name: "locale", value: locale, url: base }]);
          const page = await context.newPage();
          const errors = [];
          const catalogs = [];
          page.on("pageerror", (error) => {
            errors.push(error.message);
          });
          page.on("console", (message) => {
            if (message.type() === "error")
              errors.push(`${message.text()} ${JSON.stringify(message.location())}`);
          });
          page.on("request", (request) => {
            if (request.url().includes("/palamedes-m-")) catalogs.push(request.url());
          });
          await page.goto(base);
          await text(page, "server-message", messages[locale].server);
          return { context, page, locale, errors, catalogs };
        }),
      );
      await Promise.all(
        contexts.map(({ context }) =>
          context.setExtraHTTPHeaders({
            "x-palamedes-i18n-test-barrier": "tanstack-solid-status",
          }),
        ),
      );
      await Promise.all(
        contexts.map(async ({ context, page, locale }) => {
          await page.getByTestId("server-trigger").click();
          await page.waitForFunction(() =>
            document
              .querySelector('[data-testid="server-result"]')
              ?.textContent?.includes('"message"'),
          );
          const result = JSON.parse(await page.getByTestId("server-result").textContent());
          assert.deepEqual(result, {
            locale,
            before: locale,
            message: messages[locale].fn,
            helper: messages[locale].helper,
          });
          await context.setExtraHTTPHeaders({});
          await page.getByTestId("lazy-trigger").click();
          await text(page, "lazy-message", messages[locale].lazy);
          await page.getByTestId("details-link").click();
          await text(page, "details-message", messages[locale].navigation);
          await page.getByRole("link", { name: "Home", exact: true }).click();
          await text(page, "server-message", messages[locale].server);
        }),
      );
      for (const { context, page, locale, catalogs, errors } of contexts) {
        assert.ok(catalogs.length > 0);
        assert.ok(
          catalogs.every((url) => url.includes(`.${locale}-`)),
          catalogs.join("\n"),
        );
        assert.deepEqual(errors, []);
        await page.getByTestId("locale-en").click();
        await text(page, "server-message", "Server render confirmed locale.");
        await page.getByTestId(`locale-${locale}`).click();
        await text(page, "server-message", messages[locale].server);
        await context.close();
      }

      const context = await browser.newContext();
      try {
        await context.addCookies([{ name: "locale", value: "fr", url: base }]);
        await context.route("**/palamedes-m-*.fr-*.js", (route) => route.abort());
        const page = await context.newPage();
        await page.goto(base);
        await page.getByRole("alert").waitFor();
        assert.doesNotMatch(
          await page.getByRole("alert").innerText(),
          /MissingCompiled|palamedes-m-/u,
        );
        await context.unrouteAll({ behavior: "wait" });
        await page.getByRole("link", { name: "Reload page", exact: true }).click();
        await text(page, "server-message", messages.fr.server);
        await context.setExtraHTTPHeaders({});
        await page.getByTestId("lazy-trigger").click();
        await text(page, "lazy-message", messages.fr.lazy);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
      await stop(server);
    }
  },
);

test(
  "a missing server catalog fails explicitly and the next request recovers",
  { timeout: 30_000 },
  async () => {
    const assets = path.join(root, "dist/server/assets");
    const files = (await readdir(assets)).filter((file) => /^fr-.*\.js$/u.test(file));
    assert.equal(files.length, 1);
    const catalog = path.join(assets, files[0]);
    assert.ok((await readFile(catalog, "utf8")).includes("Le rendu serveur"));
    await rename(catalog, `${catalog}.moved`);
    let server;
    try {
      server = await start();
      const failed = await fetch(base, { headers: { cookie: "locale=fr" } });
      assert.equal(failed.status, 500);
      await rename(`${catalog}.moved`, catalog);
      const recovered = await fetch(base, { headers: { cookie: "locale=fr" } });
      assert.equal(recovered.status, 200);
      assert.ok((await recovered.text()).includes(messages.fr.server));
    } finally {
      await rename(`${catalog}.moved`, catalog).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (server) await stop(server);
    }
  },
);
