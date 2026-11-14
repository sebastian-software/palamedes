// Compare ADR-030 assets with ADR-031 permutations on the SAME route example.
// Builds and checks both production outputs, relocates standalone servers,
// then alternates paired cold/warm browser visits. Timings come from the page,
// not Playwright polling. See README.md for the measured boundaries and limits.
//
// node benchmarks/next-client-catalogs/runtime.mjs [--runs 20] [--warmups 2]
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const example = path.join(root, "examples/nextjs-route");
const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "20" },
    warmups: { type: "string", default: "2" },
    output: { type: "string", default: path.join(here, "results/latest.json") },
  },
});
const runs = Number(values.runs);
const warmups = Number(values.warmups);
assert.ok(Number.isInteger(runs) && runs >= 2 && runs <= 100, "Use 2–100 paired runs");
assert.ok(Number.isInteger(warmups) && warmups >= 0 && warmups <= 10, "Use 0–10 warmups");

const modes = ["assets", "permutations"];
const profiles = [
  { name: "loopback", latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  {
    name: "100ms-10Mbps",
    latency: 100,
    downloadThroughput: 10_000_000 / 8,
    uploadThroughput: 1_000_000 / 8,
  },
];
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sourceHash = createHash("sha256");
for (const directory of [
  "examples/nextjs-route",
  "packages/next-plugin",
  "packages/core",
  "packages/core-node",
  "packages/runtime",
  "packages/react",
  "packages/transform",
  "packages/config",
  "packages/example-ui",
  "crates",
  "src",
  "Cargo.lock",
  "pnpm-lock.yaml",
]) {
  const files = git("ls-files", directory).split("\n").filter(Boolean);
  for (const file of files) sourceHash.update(file).update(await readFile(path.join(root, file)));
}
const provenance = {
  sourceCommit: git("rev-parse", "HEAD"),
  worktreeDirty: git("status", "--porcelain") !== "",
  sourceSha256: sourceHash.digest("hex"),
  harnessSha256: createHash("sha256")
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex"),
  node: process.version,
  next: JSON.parse(await readFile(path.join(example, "node_modules/next/package.json"))).version,
  react: JSON.parse(await readFile(path.join(example, "node_modules/react/package.json"))).version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length,
  memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
  ci: process.env.CI === "true",
};

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")}: exit ${code}`)),
    );
  });
}

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

const temporary = await mkdtemp(path.join(os.tmpdir(), "palamedes-catalog-runtime-"));
const servers = [];
let browser;

async function start(mode) {
  await run("pnpm", ["--dir", "examples/nextjs-route", `build:catalog-${mode}`], {
    PALAMEDES_NEXT_CATALOG_PERMUTATIONS: mode === "permutations" ? "1" : undefined,
    PALAMEDES_NEXT_CATALOG_ASSETS: "1",
  });
  const dist = path.join(example, ".next");
  const required = JSON.parse(await readFile(path.join(dist, "required-server-files.json")));
  const appDir = path.relative(required.config.outputFileTracingRoot, example);
  const deployment = path.join(temporary, mode);
  await cp(path.join(dist, "standalone"), deployment, { recursive: true, verbatimSymlinks: true });
  await cp(path.join(dist, "static"), path.join(deployment, appDir, ".next/static"), {
    recursive: true,
  });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, [path.join(deployment, appDir, "server.js")], {
    cwd: temporary,
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  servers.push({ mode, origin, child });
  const deadline = Date.now() + 30_000;
  while (!output.includes("Ready")) {
    assert.ok(child.exitCode === null && Date.now() < deadline, output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Warm Next's server/module/catalog caches before measuring browser caches.
  for (let index = 0; index < 3; index += 1) {
    const response = await fetch(`${origin}/de`);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  const chunkFiles = await readdir(path.join(dist, "static/chunks"));
  return { mode, origin, emittedChunks: chunkFiles.filter((file) => file.endsWith(".js")).length };
}

// Observe real translated interaction. The existing ClientReady marker can
// appear before a translated boundary has hydrated, so click as soon as React
// mounts it and time the resulting translated plural update (including replay).
function instrument() {
  const timings = { readyMarkerMs: null, interactiveMs: null, lazyStartMs: null, lazyEndMs: null };
  window.__palamedesBenchmark = timings;
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const icon = document.createElement("link");
      icon.rel = "icon";
      icon.href = "data:,";
      document.head.append(icon);
    },
    { once: true },
  );
  document.addEventListener(
    "click",
    (event) => {
      if (event.target.closest?.('[data-testid="ticket-faq-toggle"]'))
        timings.lazyStartMs = performance.now();
    },
    true,
  );
  new MutationObserver(() => {
    if (timings.readyMarkerMs === null && document.querySelector('[data-testid="client-ready"]')) {
      timings.readyMarkerMs = performance.now();
      document.querySelector('button[aria-label="Mehr Tickets"]').click();
    }
    if (
      timings.interactiveMs === null &&
      document.querySelector(".qty-label b")?.textContent === "2 Tickets"
    ) {
      timings.interactiveMs = performance.now();
    }
    if (
      timings.lazyStartMs !== null &&
      timings.lazyEndMs === null &&
      document.querySelector('[data-testid="ticket-faq-content"] h3')
    ) {
      timings.lazyEndMs = performance.now();
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
}

async function visit(page, server, cache) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  const onConsole = (message) => {
    if (message.type() === "error") errors.push(message.text());
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  try {
    const response = await page.goto(`${server.origin}/de`, { waitUntil: "domcontentloaded" });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.__palamedesBenchmark.interactiveMs !== null);
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator(".qty-label b").textContent(), "2 Tickets");
    const initial = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/_next/"))
        .map((entry) => ({
          path: new URL(entry.name).pathname,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
        }));
      return {
        ...window.__palamedesBenchmark,
        ttfbMs: navigation.responseStart,
        fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        documentBytes: navigation.transferSize,
        resources,
      };
    });
    assert.equal(typeof initial.fcpMs, "number", "The browser recorded no first contentful paint");
    await page.evaluate(() => document.querySelector('[data-testid="ticket-faq-toggle"]').click());
    await page.waitForFunction(() => window.__palamedesBenchmark.lazyEndMs !== null);
    assert.equal(
      await page.locator('[data-testid="ticket-faq-content"] h3').textContent(),
      "Häufige Fragen",
    );
    const lazy = await page.evaluate(() => {
      const { lazyStartMs, lazyEndMs } = window.__palamedesBenchmark;
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/_next/") && entry.startTime >= lazyStartMs)
        .map((entry) => ({
          path: new URL(entry.name).pathname,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
        }));
      return {
        lazyMs: lazyEndMs - lazyStartMs,
        lazyNetworkMs:
          Math.max(lazyStartMs, ...resources.map((entry) => entry.responseEnd)) - lazyStartMs,
        lazyResources: resources,
      };
    });
    assert.deepEqual(errors, [], `${server.mode} ${cache}: browser errors`);
    const catalogs = initial.resources.filter((entry) => entry.path.includes("/static/palamedes/"));
    const variants = initial.resources.filter((entry) =>
      /\.(en|es|fr)-[0-9a-f]{8}\.js$/u.test(entry.path),
    );
    assert.equal(variants.length, 0, "A German visit downloaded another locale's chunk");
    assert.equal(catalogs.length > 0, server.mode === "assets");
    return {
      cache,
      ...initial,
      interactiveAfterTtfbMs: initial.interactiveMs - initial.ttfbMs,
      ...lazy,
      initialStaticBytes: initial.resources.reduce((total, entry) => total + entry.transferSize, 0),
      catalogRequests: catalogs.length,
      initialStaticRequests: initial.resources.length,
      cachedStaticResources: initial.resources.filter(
        (entry) => entry.transferSize === 0 && entry.encodedBodySize > 0,
      ).length,
    };
  } finally {
    page.off("pageerror", onError);
    page.off("console", onConsole);
  }
}

async function pairVisit(server, profile) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "de-DE",
    serviceWorkers: "block",
  });
  try {
    await context.addInitScript(instrument);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: profile.latency,
      downloadThroughput: profile.downloadThroughput,
      uploadThroughput: profile.uploadThroughput,
    });
    // No routing interception: Playwright routing would disable HTTP caching.
    return [await visit(page, server, "cold"), await visit(page, server, "warm")];
  } finally {
    await context.close();
  }
}

function percentile(numbers, fraction) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}

function summarize(samples) {
  return profiles.flatMap((profile) =>
    ["cold", "warm"].flatMap((cache) => {
      const rows = samples.filter((row) => row.profile === profile.name && row.cache === cache);
      return [
        "interactiveMs",
        "interactiveAfterTtfbMs",
        "lazyMs",
        "lazyNetworkMs",
        "fcpMs",
        "ttfbMs",
        "initialStaticBytes",
        "catalogRequests",
        "cachedStaticResources",
      ].map((metric) => {
        const asset = rows.filter((row) => row.mode === "assets");
        const permutation = rows.filter((row) => row.mode === "permutations");
        const differences = asset.map(
          (row) =>
            row[metric] - permutation.find((candidate) => candidate.pair === row.pair)[metric],
        );
        const stats = (items) => ({
          median: percentile(items, 0.5),
          p25: percentile(items, 0.25),
          p75: percentile(items, 0.75),
        });
        return {
          profile: profile.name,
          cache,
          metric,
          assets: stats(asset.map((row) => row[metric])),
          permutations: stats(permutation.map((row) => row[metric])),
          pairedSavings: stats(differences),
        };
      });
    }),
  );
}

function markdown(report) {
  const rows = report.summary.filter((row) =>
    ["interactiveMs", "lazyMs", "lazyNetworkMs", "initialStaticBytes"].includes(row.metric),
  );
  const table = rows
    .map(
      (row) =>
        `| ${row.profile} | ${row.cache} | ${row.metric} | ${row.assets.median.toFixed(1)} | ${row.permutations.median.toFixed(1)} | ${row.pairedSavings.median.toFixed(1)} (${row.pairedSavings.p25.toFixed(1)}–${row.pairedSavings.p75.toFixed(1)}) |`,
    )
    .join("\n");
  return `# Next client catalog runtime comparison

Generated by \`runtime.mjs\`. ${runs} measured pairs per profile; ${warmups} warmup pairs excluded.

Source: \`${report.environment.sourceCommit}\`; dirty: ${report.environment.worktreeDirty}. Next ${report.environment.next}, Chromium ${report.environment.chromium}.

Positive savings mean permutations were faster or transferred fewer bytes. Values are medians; the final column shows the IQR of paired differences.

| Network | Cache | Metric | Assets | Permutations | Paired saving (p25–p75) |
| --- | --- | --- | ---: | ---: | ---: |
${table}

These are local example measurements with warmed Node servers, not CDN, production, server cold-start, or general application results. See ../README.md and latest.json for boundaries, environment and raw samples.
`;
}

try {
  const outputs = [];
  for (const mode of modes) outputs.push(await start(mode));
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
  });
  const samples = [];
  for (const profile of profiles) {
    for (let pair = -warmups; pair < runs; pair += 1) {
      const order = pair % 2 === 0 ? outputs : [...outputs].reverse();
      for (const server of order) {
        const visits = await pairVisit(server, profile);
        if (pair >= 0)
          samples.push(
            ...visits.map((visit) => ({
              pair,
              mode: server.mode,
              profile: profile.name,
              ...visit,
            })),
          );
      }
      console.log(
        `[catalog-runtime] ${profile.name}: ${pair < 0 ? `warmup ${pair + warmups + 1}` : `pair ${pair + 1}/${runs}`}`,
      );
    }
  }
  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    environment: {
      ...provenance,
      chromium: browser.version(),
      executable: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath(),
    },
    method: {
      runs,
      warmups,
      profiles,
      modeOrder: "alternating paired AB/BA",
      serverCache: "warmed",
      browserCache: "fresh context, then full navigation in same context",
      viewport: "1280x900",
      route: "/de",
      cpuThrottling: 1,
    },
    outputs,
    summary: summarize(samples),
    samples,
  };
  const output = path.resolve(values.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(output.replace(/\.json$/u, ".md"), markdown(report));
  console.log(markdown(report));
} finally {
  await browser?.close();
  for (const { child } of servers) {
    if (child.exitCode !== null) continue;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
