import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { rmSync } from "node:fs";

import { chromium } from "@playwright/test";

import {
  createFixture,
  extractFixture,
  root,
  writeFixtureFile,
} from "./adoption-skill-fixtures.mjs";
import { startCommand, stopCommand } from "./example-process.mjs";

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Fixture server exited before ${url}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Fixture server did not start: ${url}`);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const host of ["nextjs", "vite-react"]) {
    for (const migration of [false, true]) {
      const directory = createFixture(host, migration);
      let child;
      try {
        extractFixture(directory);
        if (!migration) {
          for (const locale of ["en", "de"]) {
            writeFixtureFile(
              directory,
              `src/locales/${locale}.po`,
              `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\nmsgid "Welcome to Palamedes"\nmsgstr "${locale === "de" ? "Willkommen bei Palamedes" : "Welcome to Palamedes"}"\n`,
            );
          }
        }
        if (host === "nextjs") {
          await run(
            process.execPath,
            [path.join(root, "scripts/next-build-from-root.mjs"), path.relative(root, directory)],
            root,
          );
        } else await run("pnpm", ["exec", "vite", "build"], directory);
        const port = await freePort();
        const url = `http://127.0.0.1:${port}`;
        child = startCommand({
          args:
            host === "nextjs"
              ? ["exec", "next", "start", "--port", String(port), "--hostname", "127.0.0.1"]
              : [
                  "exec",
                  "vite",
                  "preview",
                  "--port",
                  String(port),
                  "--host",
                  "127.0.0.1",
                  "--strictPort",
                ],
          cwd: directory,
          env: { NEXT_TELEMETRY_DISABLED: "1" },
        });
        await waitForServer(child, url);
        for (const locale of ["en", "de"]) {
          const context = await browser.newContext();
          try {
            if (host === "nextjs") {
              await context.addCookies([{ name: "locale", value: locale, url }]);
              const response = await context.request.get(url);
              assert.equal(response.status(), 200);
              assert.equal(response.headers()["set-cookie"], undefined);
              assert.equal(response.headers()["x-powered-by"], undefined);
              assert.match(
                await response.text(),
                new RegExp(
                  locale === "de" ? "Willkommen bei Palamedes" : "Welcome to Palamedes",
                  "u",
                ),
              );
            } else {
              // Simulate host document negotiation before any entry module runs.
              await context.route(`${url}/`, async (route) => {
                const response = await route.fetch();
                const body = (await response.text()).replace(
                  '<html lang="en">',
                  `<html lang="${locale}">`,
                );
                await route.fulfill({ response, body });
              });
            }
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.goto(url);
            await page.getByRole("heading", { level: 1 }).waitFor();
            assert.equal(
              await page.getByRole("heading", { level: 1 }).textContent(),
              locale === "de" ? "Willkommen bei Palamedes" : "Welcome to Palamedes",
            );
            assert.equal(await page.locator("html").getAttribute("lang"), locale);
            if (migration) {
              assert.equal(
                await page
                  .getByRole("button", { name: locale === "de" ? "Jetzt kaufen" : "Buy now" })
                  .count(),
                1,
              );
              const text = await page.locator("body").textContent();
              for (const expected of locale === "de"
                ? ["Angebote", "Hallo Ada", "2 Angebote", "Öffnen", "Offen"]
                : ["Offers", "Hello Ada", "2 offers", "Open"])
                assert.ok(text.includes(expected), `Missing ${expected}`);
            }
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        }
        console.log(
          `PASS ${host} ${migration ? "Lingui migration" : "setup"}: production output in en/de`,
        );
      } finally {
        if (child) await stopCommand(child);
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
} finally {
  await browser.close();
}
