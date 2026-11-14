import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { packWorkspaceDependencies } from "./pack-workspace-dependencies.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), "palamedes-static-packed-"));
const directory = path.join(temp, "consumer");
const archiveDir = path.join(temp, "archives");
const hash = (text) => `sha256-${createHash("sha256").update(text).digest("base64")}`;
let server;
let browser;
try {
  mkdirSync(directory);
  mkdirSync(archiveDir);
  cpSync(path.join(root, "tests/fixtures/react-router-static"), directory, { recursive: true });
  const manifestPath = path.join(directory, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const names = Object.keys(manifest.dependencies).filter((name) => name.startsWith("@palamedes/"));
  const overrides = packWorkspaceDependencies(
    names.map((name) => path.join(root, "packages", name.slice("@palamedes/".length))),
    archiveDir,
  );
  for (const name of names) manifest.dependencies[name] = overrides[name];
  manifest.packageManager = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ).packageManager;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(path.join(directory, "pnpm-workspace.yaml"), JSON.stringify({ overrides }));
  execFileSync("pnpm", ["install", "--ignore-scripts"], {
    cwd: directory,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
  });
  assert.doesNotMatch(
    readFileSync(path.join(directory, "pnpm-lock.yaml"), "utf8"),
    /(?:workspace:|link:)/u,
  );
  execFileSync(
    process.execPath,
    [path.join(directory, "node_modules/@react-router/dev/bin.cjs"), "build"],
    { cwd: directory, stdio: "inherit" },
  );
  const specifier = "@palamedes/vite-plugin/delivery";
  const resolved = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `console.log(import.meta.resolve(${JSON.stringify(specifier)}))`],
    { cwd: directory, encoding: "utf8" },
  ).trim();
  const { createStaticViteCatalogBootstrap } = await import(resolved);
  assert.equal(
    typeof createRequire(path.join(directory, "package.json"))(specifier)
      .createStaticViteCatalogBootstrap,
    "function",
  );
  const clientDirectory = path.join(directory, "build/client");
  for (const name of readdirSync(path.join(clientDirectory, "assets")).filter((name) =>
    name.endsWith(".js"),
  )) {
    const code = readFileSync(path.join(clientDirectory, "assets", name), "utf8");
    assert(!code.includes("[palamedes:icu-parser]"), `ICU parser in ${name}`);
    assert(!code.includes("__VITE_PRELOAD__"), `Unresolved Vite preload marker in ${name}`);
  }
  const delivery = createStaticViteCatalogBootstrap({ clientDirectory });
  const approvals = JSON.parse(readFileSync(path.join(directory, "approved-scripts.json"), "utf8"));
  const policies = {};
  for (const file of ["index.html", "en/index.html", "de/index.html"]) {
    const htmlPath = path.join(clientDirectory, file);
    const html = readFileSync(htmlPath, "utf8");
    if (file.startsWith("en/")) assert.match(html, /<h1>Hello<\/h1>/u);
    if (file.startsWith("de/")) assert.match(html, /<h1>Hallo<\/h1>/u);
    const input = {
      html,
      scriptLimits: { maxCount: 20, maxElementBytes: 32_768, maxTotalBytes: 131_072 },
      allowedScripts: approvals[file],
      locale:
        file === "index.html"
          ? { kind: "fallback", policyModule: "/policy.js" }
          : { kind: "document" },
    };
    assert.throws(
      () =>
        delivery.transformDocument({
          ...input,
          html: html.replace(
            "</body>",
            '<script src="https://evil.example/app.js"></script></body>',
          ),
        }),
      /script/iu,
    );
    let result;
    try {
      result = delivery.transformDocument(input);
    } catch (error) {
      console.error(
        "Review changed fixture scripts",
        file,
        [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu)].map(([element]) => ({
          digest: hash(element),
          element,
        })),
      );
      throw error;
    }
    const classicHashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)].map(
      (match) => hash(match[1]),
    );
    policies[file] = [...result.cspHashes, ...classicHashes];
    writeFileSync(htmlPath, result.html);
    writeFileSync(path.join(clientDirectory, result.bootstrap.fileName), result.bootstrap.source);
  }
  // Inline modules keep the document URL as their base and retain deferred order.
  const first =
    '<script type="module">import "./relative.js"; window.proofOrder = ["first"];</script>';
  const second = '<script type="module">window.proofOrder.push("second");</script>';
  const relativeHtml = `<html lang="en"><head></head><body>${first}${second}</body></html>`;
  const relative = delivery.transformDocument({
    html: relativeHtml,
    scriptLimits: { maxCount: 2, maxElementBytes: 1024, maxTotalBytes: 2048 },
    allowedScripts: [hash(first), hash(second)],
    locale: { kind: "document" },
  });
  writeFileSync(path.join(clientDirectory, "en/relative.html"), relative.html);
  writeFileSync(
    path.join(clientDirectory, "en/relative.js"),
    "window.relativeModuleLoaded = true;",
  );
  writeFileSync(path.join(clientDirectory, relative.bootstrap.fileName), relative.bootstrap.source);
  policies["en/relative.html"] = relative.cspHashes;
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file =
      pathname === "/en/"
        ? "en/index.html"
        : pathname === "/de/"
          ? "de/index.html"
          : pathname.includes(".")
            ? pathname.slice(1)
            : "index.html";
    try {
      const data = await readFile(path.join(clientDirectory, file));
      response.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : "text/html");
      if (policies[file])
        response.setHeader(
          "content-security-policy",
          `default-src 'self'; script-src 'self' ${policies[file].map((value) => `'${value}'`).join(" ")}; style-src-attr 'unsafe-hashes' 'sha256-4d0Wi11ZTkKLZ4oyX9o2w71sRXHxsOynuQYGFwXqdVQ='; object-src 'none'`,
        );
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(25_120, "127.0.0.1", resolve),
  );
  browser = await chromium.launch({ headless: true });
  for (const [url, locale, heading] of [
    ["/en/?lang=de", "en", "Hello"],
    ["/de/?lang=en", "de", "Hallo"],
    ["/example?lang=de", "de", "Hallo"],
    ["/example?lang=en", "en", "Hello"],
    ["/example", "de", "Hallo"],
    ["/de?lang=en", "de", "Hallo"],
  ]) {
    const page = await browser.newPage({ locale: "de-DE" });
    const errors = [];
    const catalogs = [];
    await page.addInitScript(() => {
      globalThis.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        globalThis.__cspViolations.push(event.violatedDirective),
      );
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("request", (request) => {
      if (request.url().includes("palamedes-m-")) catalogs.push(request.url());
    });
    await page.goto(`http://127.0.0.1:25120${url}`);
    await page.getByRole("heading", { name: heading }).waitFor();
    await page.getByRole("button", { name: "Show details" }).click();
    await page
      .getByTestId("details")
      .waitFor({ timeout: 5000 })
      .catch(async (error) => {
        console.error(
          "browser evidence",
          url,
          errors,
          catalogs,
          await page.locator("body").innerText(),
        );
        throw error;
      });
    assert.equal(
      await page.getByTestId("details").textContent(),
      locale === "de" ? "Details geladen" : "Details loaded",
    );
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    assert(catalogs.length >= 2);
    assert(catalogs.every((url) => url.includes(`.${locale}-`)));
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => globalThis.__cspViolations), []);
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:25120/en/relative.html");
    await page.waitForFunction(() => globalThis.proofOrder?.length === 2);
    assert.deepEqual(await page.evaluate(() => globalThis.proofOrder), ["first", "second"]);
    assert.equal(await page.evaluate(() => globalThis.relativeModuleLoaded), true);
    await page.close();
  }
  for (const phase of ["initial", "lazy"]) {
    const page = await browser.newPage();
    let blocked = false;
    const target = phase === "initial" ? "d4d02e1e213a" : "1c4abca9d553";
    const routePattern = `**/palamedes-m-${target}.en-*.js`;
    await page.route(routePattern, (route) => {
      blocked = true;
      return route.abort();
    });
    await page.goto("http://127.0.0.1:25120/en/");
    if (phase === "lazy") {
      await page.getByRole("heading", { name: "Hello" }).waitFor();
      await page.getByRole("button", { name: "Show details" }).click();
    }
    await page.getByRole("alert").waitFor();
    assert(blocked, `${phase} catalog request was not blocked`);
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /palamedes-m-|#pmds|1c4abca9d553|d4d02e1e213a/u,
    );
    await page.unroute(routePattern);
    await page.getByRole("link", { name: "Reload page" }).click();
    await page.getByRole("heading", { name: "Hello" }).waitFor();
    await page.getByRole("button", { name: "Show details" }).click();
    await page.getByTestId("details").waitFor();
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.route("**/palamedes-m-d4d02e1e213a.en-*.js", (route) => route.abort());
    await page.goto("http://127.0.0.1:25120/en/");
    await page.getByRole("alert").waitFor();
    await page.unrouteAll();
    await page.getByRole("link", { name: "Go home" }).click();
    await page.waitForURL("http://127.0.0.1:25120/");
    await page.getByRole("heading", { name: "Hello" }).waitFor();
    await page.close();
  }
  console.log(
    "Packed static React Router: prerender, fallback, CSP, locale isolation, lazy catalogs and recovery passed",
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
