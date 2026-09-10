import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { renderCatalogModule } from "../packages/core-node/dist/index.mjs";

// Compare production builds, using one native-generated catalog in fresh pages.
// Usage: node scripts/benchmark-core-runtime.mjs [baseline-core-dist-directory]
const currentDist = path.resolve(fileURLToPath(new URL("../packages/core/dist/", import.meta.url)));
const variants = process.argv[2]
  ? [
      ["baseline", path.resolve(process.argv[2])],
      ["current", currentDist],
    ]
  : [["current", currentDist]];
const messageCount = 30_000;
const runs = 9;
const warmup = 10_000;
const iterations = 300_000;
const patterns = Object.fromEntries(
  Array.from({ length: messageCount }, (_, index) => [
    `m${index}`,
    index % 3 === 0
      ? `Message ${index}`
      : index % 3 === 1
        ? `Hello {name}, message ${index}`
        : `{count, plural, one {# item ${index}} other {# items ${index}}}`,
  ]),
);
patterns.integer = "{amount, number, integer}";
patterns.percent = "{amount, number, percent}";
patterns.currency = "{amount, number, ::currency/EUR}";
const catalogSource = renderCatalogModule(patterns).replaceAll(
  '"@palamedes/core/compiled"',
  '"/runtime/compiled.mjs"',
);
assert(!catalogSource.includes("@palamedes/core/compiled"));
const browser = await chromium.launch();
const samples = Object.fromEntries(variants.map(([name]) => [name, []]));

try {
  for (let run = 0; run < runs; run += 1) {
    // Alternate order to reduce systematic temperature / scheduling bias.
    for (const [name, directory] of run % 2 === 0 ? variants : [...variants].reverse()) {
      const context = await browser.newContext();
      try {
        await context.route("http://palamedes-benchmark.test/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === "/") {
            await route.fulfill({
              contentType: "text/html",
              body: "<!doctype html><title>Core runtime benchmark</title>",
            });
          } else if (pathname === "/catalog.mjs") {
            await route.fulfill({ contentType: "text/javascript", body: catalogSource });
          } else if (pathname.startsWith("/runtime/")) {
            const filename = path.resolve(directory, pathname.slice("/runtime/".length));
            assert(filename.startsWith(`${directory}${path.sep}`));
            await route.fulfill({ contentType: "text/javascript", body: await readFile(filename) });
          } else {
            await route.abort();
          }
        });
        const page = await context.newPage();
        await page.goto("http://palamedes-benchmark.test/");
        await page.evaluate(async () => {
          const runtime = await import("/runtime/compiled.mjs");
          const { messages } = await import("/catalog.mjs");
          // Retain the source catalog as real ESM applications do. The measured
          // heap delta isolates the instance's additional storage, not payload.
          globalThis.fixture = { messages, i18n: runtime.createI18n({ locale: "en" }) };
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send("HeapProfiler.collectGarbage");
        const before = await cdp.send("Runtime.getHeapUsage");
        const loadMs = await page.evaluate(() => {
          const { i18n, messages } = globalThis.fixture;
          const start = performance.now();
          i18n.load("en", messages);
          return performance.now() - start;
        });
        await cdp.send("HeapProfiler.collectGarbage");
        const after = await cdp.send("Runtime.getHeapUsage");
        const result = await page.evaluate(
          ({ warmup, iterations }) => {
            const { i18n } = globalThis.fixture;
            const values = { name: "Ada", count: 2, amount: 1234.5 };
            const probe = [i18n._("m0"), i18n._("m1", values), i18n._("m2", values)];
            const measurements = {};
            for (const [kind, offset] of [
              ["constant", 0],
              ["interpolation", 1],
              ["plural", 2],
              ["mixedNumber", 3],
            ]) {
              const ids =
                offset === 3
                  ? ["integer", "percent", "currency"]
                  : Array.from({ length: 1000 }, (_, index) => `m${index * 3 + offset}`);
              const render = () => {
                let checksum = 0;
                for (let index = 0; index < iterations; index += 1) {
                  const id = ids[index % ids.length];
                  checksum += (offset === 0 ? i18n._(id) : i18n._(id, values)).length;
                }
                return checksum;
              };
              for (let index = 0; index < warmup; index += 1) {
                const id = ids[index % ids.length];
                if (offset === 0) i18n._(id);
                else i18n._(id, values);
              }
              const start = performance.now();
              const checksum = render();
              measurements[kind] = { ms: performance.now() - start, checksum };
            }
            return { probe, measurements };
          },
          { warmup, iterations },
        );
        assert.deepEqual(result.probe, ["Message 0", "Hello Ada, message 1", "2 items 2"]);
        samples[name].push({
          loadMs,
          retainedBytes: after.usedSize - before.usedSize,
          ...result.measurements,
        });
      } finally {
        await context.close();
      }
    }
  }
  const reference = samples[variants[0][0]][0];
  for (const sample of Object.values(samples).flat()) {
    for (const kind of ["constant", "interpolation", "plural", "mixedNumber"]) {
      assert.equal(sample[kind].checksum, reference[kind].checksum);
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    Object.entries(samples).map(([name, entries]) => [
      name,
      {
        loadMs: median(entries.map((entry) => entry.loadMs)),
        retainedBytes: median(entries.map((entry) => entry.retainedBytes)),
        ...Object.fromEntries(
          ["constant", "interpolation", "plural", "mixedNumber"].map((kind) => [
            `${kind}Ms`,
            median(entries.map((entry) => entry[kind].ms)),
          ]),
        ),
      },
    ]),
  );
  console.log(
    JSON.stringify(
      {
        environment: {
          browser: browser.version(),
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: os.cpus()[0]?.model,
        },
        messageCount: Object.keys(patterns).length,
        runs,
        warmup,
        iterations,
        summary,
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
