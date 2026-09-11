import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:4070";
const server = spawn(
  "pnpm",
  ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", "4070", "--strictPort"],
  { cwd: `${root}/examples/vite-mdx`, stdio: "ignore" },
);
let browser;
try {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    assert(Date.now() < deadline, "Vite preview did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((value) => value && existsSync(value));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const locale of ["en", "de"]) {
    for (const failure of [undefined, "network", "evaluation"]) {
      const context = await browser.newContext();
      const requested = [];
      let armed = Boolean(failure);
      await context.route("**/*", async (route) => {
        if (route.request().resourceType() === "document") {
          const response = await route.fetch();
          const body = (await response.text()).replaceAll(
            "<script ",
            '<script nonce="catalog-proof" ',
          );
          return route.fulfill({
            response,
            body,
            headers: {
              ...response.headers(),
              "content-security-policy":
                "default-src 'self'; script-src 'self' 'nonce-catalog-proof'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'",
            },
          });
        }
        const url = route.request().url();
        if (!url.includes("/palamedes-m-")) return route.continue();
        requested.push(url);
        assert(url.includes(`.${locale}-`), `Inactive locale loaded: ${url}`);
        if (!armed) return route.continue();
        if (failure === "network") return route.abort("failed");
        const response = await route.fetch();
        return route.fulfill({
          response,
          body: (await response.text()).replace(
            "export const messages=(",
            'export const messages=(()=>{throw new Error("INJECTED")})(',
          ),
        });
      });
      const page = await context.newPage();
      await page.goto(`${origin}/?locale=${locale}`);
      if (failure) {
        await page.locator('main[role="alert"]').waitFor();
        assert.doesNotMatch(
          await page.locator("body").innerText(),
          /INJECTED|palamedes-m-|MissingCompiled/,
        );
        armed = false;
        await page.getByRole("link", { name: "Reload page" }).click();
      }
      await page.locator(".shell").waitFor();
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert(requested.length > 0, "No compiled catalog requests observed");
      assert.equal(await page.locator('main[role="alert"]').count(), 0);
      console.log(
        `Vite HTML ${locale} ${failure ?? "healthy"}: active-only executable catalogs and CSP recovery passed`,
      );
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
