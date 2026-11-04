// Checks the contract of `experimentalClientCatalogPermutations` (ADR-031)
// against a standalone build: every affected chunk has one hashed copy per
// locale with the neutral marker replaced, the artifacts Next prerendered and
// the documents, Flight responses, and lazy chunks a started server emits
// name only the request locale's copies, concurrent mixed-locale requests
// stay isolated, and a real browser hydrates German client text without
// requesting a neutral or foreign-locale chunk.
//
//   node scripts/check-next-client-catalog-permutations.mjs <example-dir> [dist-dir]
//
// The example serves each locale at `/<locale>` and prerenders
// `/<locale>/prerendered` at build time. The server listens on a free port
// unless `PORT` is set. The browser check uses Playwright's Chromium, or the
// executable in `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";

const exampleDir = path.resolve(process.argv[2] ?? ".");
const distName = process.argv[3] ?? ".next";
const distDir = path.join(exampleDir, distName);
const standaloneDir = path.join(distDir, "standalone");
assert.ok(
  existsSync(standaloneDir),
  `Missing ${standaloneDir}; build with output: "standalone" first`,
);

const LOCALES = ["de", "en", "es", "fr"];
const CHUNK_REFERENCE = /static\/chunks\/[\w.-]+\.js/gu;
const VARIANT_NAME = /^(?<name>[\w-]+)\.(?<locale>[\w-]+)-(?<hash>[0-9a-f]{8})\.js$/u;

function files(directory, test) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}standalone${path.sep}`))
    .sort();
}

// Affected chunk name to its copy per locale, read back from the file names.
const variants = new Map();
for (const file of readdirSync(path.join(distDir, "static/chunks"))) {
  const match = VARIANT_NAME.exec(file);
  if (!match || !LOCALES.includes(match.groups.locale)) continue;
  const copies = variants.get(match.groups.name) ?? new Map();
  copies.set(match.groups.locale, `static/chunks/${file}`);
  variants.set(match.groups.name, copies);
}
assert.notEqual(variants.size, 0, "The build wrote no locale copies of client chunks");
const neutral = new Set([...variants.keys()].map((name) => `static/chunks/${name}.js`));

// Each copy is named by its content, carries no marker, and names no neutral
// affected chunk; the neutral chunk still exists on disk.
for (const [name, copies] of variants) {
  assert.ok(existsSync(path.join(distDir, `static/chunks/${name}.js`)), `${name}.js is gone`);
  assert.deepEqual([...copies.keys()].sort(), LOCALES, `${name} lacks a copy for every locale`);
  for (const [locale, copy] of copies) {
    const body = readFileSync(path.join(distDir, copy), "utf8");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 8);
    assert.ok(copy.endsWith(`.${locale}-${hash}.js`), `${copy} is not named by its content`);
    assert.doesNotMatch(body, /pmds-next:[0-9a-f]{12}:/u, `${copy} still carries a marker`);
    assert.doesNotMatch(body, /sourceMappingURL/u, `${copy} points at the neutral source map`);
    assertLocaleReferences(body, locale, copy);
  }
}

function classify(reference) {
  if (neutral.has(reference)) return "neutral";
  const match = VARIANT_NAME.exec(path.posix.basename(reference));
  return match && variants.has(match.groups.name) ? match.groups.locale : "unrelated";
}

/** Fails on a neutral affected chunk or another locale's copy in the text. */
function assertLocaleReferences(text, locale, label) {
  const found = [...new Set(text.match(CHUNK_REFERENCE) ?? [])];
  const bad = found.filter((reference) => !["unrelated", locale].includes(classify(reference)));
  assert.deepEqual(bad, [], `${label} names ${bad.join(", ")} for locale ${locale}`);
  return found.filter((reference) => classify(reference) === locale);
}

// Artifacts the build prerendered in its workers: documents, Flight payloads,
// and segment prefetch files under server/app/<locale>/.
let prerendered = 0;
for (const file of files(path.join(distDir, "server/app"), (name) => /\.(html|rsc)$/u.test(name))) {
  const relative = path.relative(path.join(distDir, "server/app"), file);
  const locale = relative.split(path.sep)[0];
  const text = readFileSync(file, "utf8");
  if (LOCALES.includes(locale)) {
    // A route tree segment names no chunks; the document and the page
    // segment do.
    if (assertLocaleReferences(text, locale, relative).length > 0) prerendered += 1;
  } else {
    const found = (text.match(CHUNK_REFERENCE) ?? []).filter((reference) => neutral.has(reference));
    assert.deepEqual(found, [], `${relative} names neutral affected chunks`);
  }
}
assert.notEqual(prerendered, 0, "No prerendered locale artifact was found under server/app");

const serverFiles = JSON.parse(readFileSync(path.join(distDir, "required-server-files.json")));
const appDir = path.relative(serverFiles.config.outputFileTracingRoot, exampleDir);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(origin, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (!output.join("").includes("Ready")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      await fetch(origin);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`The standalone server did not start:\n${output.join("")}`);
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
  return response.text();
}

/** Document and Flight payload of one route, checked for the locale. */
async function checkRoute(origin, locale, route) {
  const url = `${origin}/${locale}${route}`;
  const html = await fetchText(url);
  assert.match(html, new RegExp(`<html[^>]*\\blang="${locale}"`, "u"), `${url} document locale`);
  const inDocument = assertLocaleReferences(html, locale, `${url} document`);
  assert.notEqual(inDocument.length, 0, `${url} document names no ${locale} chunk copy`);
  const flight = await fetchText(url, { RSC: "1" });
  const inFlight = assertLocaleReferences(flight, locale, `${url} Flight`);
  assert.notEqual(inFlight.length, 0, `${url} Flight names no ${locale} chunk copy`);
  return inDocument;
}

async function checkLazyChunks(origin, locale, references, seen = new Set()) {
  let lazy = 0;
  for (const reference of references) {
    if (seen.has(reference)) continue;
    seen.add(reference);
    const body = await fetchText(`${origin}/_next/${reference}`);
    const nested = assertLocaleReferences(body, locale, `${origin}/_next/${reference}`);
    lazy += nested.length;
    lazy += await checkLazyChunks(origin, locale, nested, seen);
  }
  return lazy;
}

const deployDir = mkdtempSync(path.join(tmpdir(), "palamedes-next-permutations-"));
const output = [];
let server;
let browser;
try {
  cpSync(standaloneDir, deployDir, { recursive: true, verbatimSymlinks: true });
  cpSync(path.join(distDir, "static"), path.join(deployDir, appDir, distName, "static"), {
    recursive: true,
  });

  const port = process.env.PORT ? Number(process.env.PORT) : await freePort();
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(deployDir, appDir, "server.js")], {
    cwd: tmpdir(),
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => output.push(chunk));
  server.stderr.on("data", (chunk) => output.push(chunk));
  await waitForServer(origin, server, output);

  let lazy = 0;
  for (const locale of LOCALES) {
    for (const route of ["", "/prerendered"]) {
      const references = await checkRoute(origin, locale, route);
      lazy += await checkLazyChunks(origin, locale, references);
    }
  }
  assert.notEqual(lazy, 0, "No served chunk copy named a lazily imported chunk copy");

  // Mixed locales in flight at once must not share a resolved locale.
  const concurrent = Array.from({ length: 24 }, (_, index) => {
    const locale = LOCALES[index % LOCALES.length];
    return checkRoute(origin, locale, index % 2 === 0 ? "" : "/prerendered");
  });
  await Promise.all(concurrent);

  // A real browser: hydration, German client text, a plural update on click,
  // the lazy chunk, and the chunk requests it makes.
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
  });
  const page = await browser.newPage();
  const requested = [];
  const errors = [];
  page.on("request", (request) => {
    const match = /\/_next\/(static\/chunks\/[\w.-]+\.js)/u.exec(request.url());
    if (match) requested.push(match[1]);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${origin}/de`, { waitUntil: "networkidle" });
  await page.getByTestId("client-ready").waitFor({ state: "attached" });
  const quantity = page.locator(".qty-label b");
  assert.equal(await quantity.textContent(), "1 Ticket");
  await page.getByRole("button", { name: "Mehr Tickets" }).click();
  assert.equal(await quantity.textContent(), "2 Tickets");
  await page.getByTestId("ticket-faq-toggle").click();
  await page.getByTestId("ticket-faq-content").waitFor();
  assert.equal(
    await page.locator('[data-testid="ticket-faq-content"] h3').textContent(),
    "Häufige Fragen",
  );
  assert.deepEqual(errors, [], "The browser reported errors");
  const requestedCopies = requested.filter((reference) => classify(reference) === "de");
  assert.ok(
    requestedCopies.length >= 2,
    `The browser requested too few German chunk copies: ${requested.join(", ")}`,
  );
  const foreign = requested.filter(
    (reference) => !["unrelated", "de"].includes(classify(reference)),
  );
  assert.deepEqual(foreign, [], "The browser requested neutral or foreign-locale chunks");

  console.log(
    `[next-catalog-permutations] ${variants.size} affected chunks with ${LOCALES.length} locale copies each; ${prerendered} prerendered artifacts, ${LOCALES.length * 2} routes, ${concurrent.length} concurrent requests, and a German browser session with ${requestedCopies.length} locale chunk copies requested, all without neutral or foreign-locale chunks`,
  );
} catch (error) {
  if (output.length > 0) console.error(`Standalone server output:\n${output.join("")}`);
  throw error;
} finally {
  await browser?.close();
  server?.kill();
  rmSync(deployDir, { recursive: true, force: true });
}
