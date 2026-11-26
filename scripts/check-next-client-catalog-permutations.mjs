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
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

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

  // An unknown locale reaches the layout's notFound(): chunk selection falls
  // back to the source locale instead of failing before the app can answer.
  // Next answers the document with 404 and a Flight navigation with its
  // not-found payload under 200.
  for (const [headers, statuses] of [
    [{}, [404]],
    [{ RSC: "1" }, [200, 404]],
  ]) {
    const response = await fetch(`${origin}/zz`, { headers });
    assert.ok(statuses.includes(response.status), `/zz: HTTP ${response.status}`);
    assertLocaleReferences(await response.text(), "en", "/zz not-found response");
  }

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
  // This fixture has no favicon. Keep the browser's implicit request from
  // obscuring catalog failures; every other resource error still fails below.
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
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

// Production-build contract for optional catch-all `[[...locale]]` routes
// (ADR-031): verifies directly against real Next.js Turbopack output that
// `compiledRouteHasOptionalRootLocale()` classifies the route without falling
// back to the source tree, and that requesting `/` with a conflicting
// `x-palamedes-locale: de` header selects `en` chunks when the root layout sits
// inside `app/[[...locale]]/layout.tsx` and `de` chunks when the root layout
// sits above it in `app/layout.tsx`.
async function verifyOptionalRootLocaleOwnership() {
  const { compiledRouteHasOptionalRootLocale } = await import(
    new URL("../packages/next-plugin/dist/chunks/client-catalog-permutations.mjs", import.meta.url)
  );
  const nextBin = path.join(exampleDir, "node_modules/next/dist/bin/next");
  assert.ok(existsSync(nextBin), `Missing Next CLI at ${nextBin}`);

  for (const scenario of [
    { name: "layout-inside-optional", layoutAbove: false, expectedLocale: "en", nextConfig: {} },
    { name: "layout-above-optional", layoutAbove: true, expectedLocale: "de", nextConfig: {} },
    {
      name: "layout-above-optional-unminified-taint",
      layoutAbove: true,
      expectedLocale: "de",
      nextConfig: { experimental: { turbopackMinify: false, taint: true } },
    },
  ]) {
    // Create the fixture directly under `repoRoot` (outside `examples/nextjs-route`)
    // so Turbopack keeps `distDir` inside `outputFileTracingRoot` without
    // inheriting `examples/nextjs-route/src/middleware.ts`.
    const fixtureDir = mkdtempSync(path.join(repoRoot, `.palamedes-optional-${scenario.name}-`));
    let fixtureServer;
    const fixtureOutput = [];
    try {
      symlinkSync(
        path.join(exampleDir, "node_modules"),
        path.join(fixtureDir, "node_modules"),
        "junction",
      );
      mkdirSync(path.join(fixtureDir, "app/[[...locale]]"), { recursive: true });
      mkdirSync(path.join(fixtureDir, "locales"), { recursive: true });
      writeFileSync(
        path.join(fixtureDir, "package.json"),
        JSON.stringify({ name: `optional-locale-${scenario.name}`, private: true, type: "module" }),
      );
      writeFileSync(
        path.join(fixtureDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "react-jsx",
            plugins: [{ name: "next" }],
          },
          include: ["**/*.ts", "**/*.tsx"],
        }),
      );
      writeFileSync(
        path.join(fixtureDir, "palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
      );
      writeFileSync(path.join(fixtureDir, "locales/en.po"), 'msgid "Greeting"\nmsgstr "Hello"\n');
      writeFileSync(path.join(fixtureDir, "locales/de.po"), 'msgid "Greeting"\nmsgstr "Hallo"\n');
      writeFileSync(
        path.join(fixtureDir, "next.config.mjs"),
        `import { withPalamedes } from "@palamedes/next-plugin";
export default withPalamedes(
  ${JSON.stringify({ outputFileTracingRoot: repoRoot, ...scenario.nextConfig })},
  {
    experimentalClientCatalogPermutations: true,
    projectRoot: ${JSON.stringify(fixtureDir)},
    workspaceRoot: ${JSON.stringify(repoRoot)},
  },
);
`,
      );
      writeFileSync(
        path.join(fixtureDir, "instrumentation.ts"),
        `export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bindClientCatalogPermutations } = await import("@palamedes/next-plugin/server");
    bindClientCatalogPermutations({ dir: ${JSON.stringify(fixtureDir)} });
  }
}
`,
      );
      const layoutSource = `import type { ReactNode } from "react";
import { createNextServerI18n } from "@palamedes/next-plugin/server";
export default async function RootLayout({ children }: { children: ReactNode }) {
  await createNextServerI18n({ locale: ${JSON.stringify(scenario.expectedLocale)} });
  return (
    <html lang=${JSON.stringify(scenario.expectedLocale)}>
      <body>{children}</body>
    </html>
  );
}
`;
      writeFileSync(
        path.join(
          fixtureDir,
          scenario.layoutAbove ? "app/layout.tsx" : "app/[[...locale]]/layout.tsx",
        ),
        layoutSource,
      );
      writeFileSync(
        path.join(fixtureDir, "app/[[...locale]]/greeting.tsx"),
        `"use client";
import { t } from "@palamedes/core/macro";
export function Greeting() {
  return <p>{t\`Greeting\`}</p>;
}
`,
      );
      writeFileSync(
        path.join(fixtureDir, "app/[[...locale]]/page.tsx"),
        `import { Greeting } from "./greeting";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Greeting />;
}
`,
      );

      execFileSync(process.execPath, [nextBin, "build"], {
        cwd: fixtureDir,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "pipe",
      });

      const fixtureDist = path.join(fixtureDir, ".next");
      const manifestPath = path.join(
        fixtureDist,
        "server/app/[[...locale]]/page_client-reference-manifest.js",
      );
      assert.equal(
        compiledRouteHasOptionalRootLocale(fixtureDist, manifestPath),
        !scenario.layoutAbove,
        `${scenario.name}: compiledRouteHasOptionalRootLocale() must classify Next's compiled loaderTree directly without source-tree fallback`,
      );

      const fixtureVariants = new Map();
      for (const file of readdirSync(path.join(fixtureDist, "static/chunks"))) {
        const match = VARIANT_NAME.exec(file);
        if (!match || !["en", "de"].includes(match.groups.locale)) continue;
        const copies = fixtureVariants.get(match.groups.name) ?? new Map();
        copies.set(match.groups.locale, `static/chunks/${file}`);
        fixtureVariants.set(match.groups.name, copies);
      }
      assert.notEqual(fixtureVariants.size, 0, `${scenario.name}: no locale chunk variants built`);
      const fixtureNeutral = new Set(
        [...fixtureVariants.keys()].map((name) => `static/chunks/${name}.js`),
      );
      const classifyFixture = (reference) => {
        if (fixtureNeutral.has(reference)) return "neutral";
        const match = VARIANT_NAME.exec(path.posix.basename(reference));
        return match && fixtureVariants.has(match.groups.name) ? match.groups.locale : "unrelated";
      };

      const port = await freePort();
      const origin = `http://127.0.0.1:${port}`;
      fixtureServer = spawn(
        process.execPath,
        [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)],
        {
          cwd: fixtureDir,
          env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      fixtureServer.stdout.on("data", (chunk) => fixtureOutput.push(chunk));
      fixtureServer.stderr.on("data", (chunk) => fixtureOutput.push(chunk));
      await waitForServer(origin, fixtureServer, fixtureOutput);

      // Reject redirects so `/` is guaranteed to exercise the omitted
      // `[[...locale]]` segment rather than a middleware-redirected `/en` path.
      const response = await fetch(`${origin}/`, {
        headers: { "x-palamedes-locale": "de" },
        redirect: "manual",
      });
      assert.equal(
        response.status,
        200,
        `${scenario.name}: expected HTTP 200 without redirect on /, got ${response.status} (location: ${response.headers.get("location")})`,
      );
      const html = await response.text();
      const found = [...new Set(html.match(CHUNK_REFERENCE) ?? [])];
      const bad = found.filter(
        (reference) => !["unrelated", scenario.expectedLocale].includes(classifyFixture(reference)),
      );
      assert.deepEqual(
        bad,
        [],
        `${scenario.name}: / with x-palamedes-locale: de named ${bad.join(", ")} instead of ${scenario.expectedLocale}`,
      );
      const matched = found.filter(
        (reference) => classifyFixture(reference) === scenario.expectedLocale,
      );
      assert.notEqual(
        matched.length,
        0,
        `${scenario.name}: / with x-palamedes-locale: de named no ${scenario.expectedLocale} chunk copy`,
      );
    } catch (error) {
      if (fixtureOutput.length > 0) {
        console.error(`${scenario.name} server output:\n${fixtureOutput.join("")}`);
      }
      throw error;
    } finally {
      fixtureServer?.kill();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }
  console.log(
    "[next-catalog-permutations] optional [[...locale]] production fixtures verified both root-layout-inside (en) and root-layout-above (de) chunk selection",
  );
}

await verifyOptionalRootLocaleOwnership();
