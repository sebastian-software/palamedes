import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://localhost:4196";
const server = spawn("pnpm", ["exec", "react-router-serve", "build/server/index.js"], {
  cwd: `${root}/examples/react-router-cookie`,
  env: { ...process.env, PORT: "4196", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (data) => {
  output += data;
});
server.stderr.on("data", (data) => {
  output += data;
});
let browser;
try {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    assert(Date.now() < deadline, `Server did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((value) => value && existsSync(value));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const locale of ["en", "de"]) {
    for (const phase of ["initial", "navigation"]) {
      for (const failure of ["network", "evaluation"]) {
        const context = await browser.newContext();
        await context.addCookies([{ name: "locale", value: locale, url: origin }]);
        let armed = phase === "initial";
        let injected = false;
        let failedUrl;
        const catalogs = new Set();
        await context.route("**/*", async (route) => {
          const request = route.request();
          if (request.resourceType() === "document") {
            const response = await route.fetch();
            const body = await response.text();
            const hashes = [...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)].map(
              (match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`,
            );
            return route.fulfill({
              response,
              body,
              headers: {
                ...response.headers(),
                "content-security-policy": `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'`,
              },
            });
          }
          if (!request.url().includes("/palamedes-m-")) return route.continue();
          catalogs.add(request.url());
          assert(
            request.url().includes(`.${locale}-`),
            `Inactive locale requested: ${request.url()}`,
          );
          if (!armed) return route.continue();
          failedUrl ??= request.url();
          if (request.url() !== failedUrl) return route.continue();
          injected = true;
          if (failure === "network") return route.abort("failed");
          const response = await route.fetch();
          const source = await response.text();
          assert(source.includes("export const messages=("));
          return route.fulfill({
            response,
            body: source.replace(
              "export const messages=(",
              'export const messages=(()=>{throw new Error("INJECTED_CATALOG_FAILURE")})(',
            ),
          });
        });
        const page = await context.newPage();
        await page.goto(origin);
        if (phase === "navigation") {
          await page.getByTestId("client-ready").waitFor({ state: "attached" });
          const initialCount = catalogs.size;
          armed = true;
          await page.getByTestId("insights-link").click();
          await page.locator('main[role="alert"]').waitFor();
          assert(catalogs.size > initialCount, "Lazy navigation did not load a new catalog");
        } else {
          await page.locator('main[role="alert"]').waitFor();
        }
        assert(injected, "Failure injection never reached a catalog dependency");
        const errorText = await page.locator('main[role="alert"]').innerText();
        assert.match(errorText, /Reload page/);
        assert.doesNotMatch(errorText, /INJECTED|MissingCompiled|palamedes-m-|\{.*plural/);
        armed = false;
        await page.locator('main[role="alert"]').getByText("Reload page", { exact: true }).click();
        await page.waitForLoadState("networkidle");
        assert.equal(await page.locator('main[role="alert"]').count(), 0);
        assert((await page.locator("body").innerText()).includes("Frontend Stage"));
        console.log(
          `${locale} ${phase} ${failure}: active-only delivery, host error UI and reload recovery passed under CSP`,
        );
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
