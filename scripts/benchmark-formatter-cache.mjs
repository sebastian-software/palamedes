import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { renderCatalogModule } from "../packages/core-node/dist/index.mjs";

// Usage: node scripts/benchmark-formatter-cache.mjs name=/absolute/core/dist ...
const variants = process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  assert(separator > 0, "Pass name=/absolute/core/dist for each variant");
  return [argument.slice(0, separator), path.resolve(argument.slice(separator + 1))];
});
assert(variants.length > 0);
assert.equal(new Set(variants.map(([name]) => name)).size, variants.length);
const formats = ["::currency/EUR", "integer", "percent", undefined, "::currency/USD"];
const row = formats
  .map((style, index) => `{v${index}, number${style ? `, ${style}` : ""}}`)
  .join(" | ");
const patterns = Object.fromEntries(
  formats.map((style, index) => [`c${index}`, `{amount, number${style ? `, ${style}` : ""}}`]),
);
patterns.row = row;
patterns.plural = "{count, plural, one {# item} other {# items}}";
const catalog = renderCatalogModule(patterns).replaceAll(
  '"@palamedes/core/compiled"',
  '"/runtime/compiled.mjs"',
);
const runs = 9;
const iterations = 300_000;
const warmup = 10_000;
const samples = Object.fromEntries(variants.map(([name]) => [name, []]));
const browser = await chromium.launch();
try {
  for (let run = 0; run < runs; run += 1) {
    // Rotate the first variant and reverse alternate rounds to spread ordering effects.
    const order = [
      ...variants.slice(run % variants.length),
      ...variants.slice(0, run % variants.length),
    ];
    if (run % 2) order.reverse();
    for (const [name, directory] of order) {
      const context = await browser.newContext();
      try {
        await context.route("http://palamedes-benchmark.test/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === "/")
            return route.fulfill({
              contentType: "text/html",
              body: "<!doctype html><title>Formatter cache</title>",
            });
          if (pathname === "/catalog.mjs")
            return route.fulfill({ contentType: "text/javascript", body: catalog });
          assert(pathname.startsWith("/runtime/"));
          const filename = path.resolve(directory, pathname.slice("/runtime/".length));
          assert(filename.startsWith(`${directory}${path.sep}`));
          await route.fulfill({ contentType: "text/javascript", body: await readFile(filename) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("http://palamedes-benchmark.test/");
        const result = await page.evaluate(
          async ({ iterations, warmup }) => {
            const { createI18n } = await import("/runtime/compiled.mjs");
            const { messages } = await import("/catalog.mjs");
            const locales = ["en-US", "de-DE", "fr-FR"];
            const instances = locales.map((locale) => {
              const i18n = createI18n({ locale });
              i18n.load(locale, messages);
              return i18n;
            });
            const options = [
              { style: "currency", currency: "EUR" },
              { maximumFractionDigits: 0 },
              { style: "percent" },
              {},
              { style: "currency", currency: "USD" },
            ];
            const ids = ["c0", "c1", "c2", "c3", "c4"];
            const rows = Array.from({ length: 1000 }, (_, index) => {
              const amount = (((index * 7919) % 100_003) - 50_000) / 37;
              return {
                amount,
                count: index % 7,
                v0: amount,
                v1: amount,
                v2: amount / 100,
                v3: amount * 3,
                v4: amount * 1.1,
              };
            });
            const cells = rows.map((values) =>
              ids.map((_id, column) => ({ amount: values[`v${column}`] })),
            );
            // Fixed shuffle: identical input for every variant, no RNG in measured loops.
            const shuffled = Array.from({ length: 5000 }, (_, index) => index % 5);
            let seed = 8_675_309;
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
              seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
              const other = seed % (index + 1);
              [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
            }
            const probes = [];
            for (let localeIndex = 0; localeIndex < locales.length; localeIndex += 1) {
              const expectedFormatters = options.map(
                (option) => new Intl.NumberFormat(locales[localeIndex], option),
              );
              for (const index of [0, 17, 999]) {
                const values = rows[index];
                for (let column = 0; column < ids.length; column += 1) {
                  probes.push([
                    instances[localeIndex]._(ids[column], cells[index][column]),
                    expectedFormatters[column].format(cells[index][column].amount),
                  ]);
                }
                probes.push([
                  instances[localeIndex]._("row", values),
                  expectedFormatters
                    .map((formatter, column) => formatter.format(values[`v${column}`]))
                    .join(" | "),
                ]);
              }
            }
            const workloads = {
              repeatedCurrency(index) {
                return instances[0]._("c0", rows[index % rows.length]);
              },
              tableCells(index) {
                return instances[0]._(
                  ids[index % 5],
                  cells[Math.floor(index / 5) % rows.length][index % 5],
                );
              },
              shuffledCells(index) {
                return instances[0]._(
                  ids[shuffled[index % shuffled.length]],
                  cells[Math.floor(index / 5) % rows.length][shuffled[index % shuffled.length]],
                );
              },
              tableRows(index) {
                return instances[0]._("row", rows[index % rows.length]);
              },
              alternatingLocales(index) {
                return instances[index % 3]._(
                  ids[index % 5],
                  cells[Math.floor(index / 5) % rows.length][index % 5],
                );
              },
              plural(index) {
                return instances[0]._("plural", rows[index % rows.length]);
              },
            };
            const measurements = {};
            for (const [workload, render] of Object.entries(workloads)) {
              const calls = workload === "tableRows" ? iterations / 5 : iterations;
              for (let index = 0; index < warmup; index += 1) render(index);
              let checksum = 0;
              const start = performance.now();
              for (let index = 0; index < calls; index += 1) checksum += render(index).length;
              measurements[workload] = { ms: performance.now() - start, checksum, calls };
            }
            return { probes, measurements };
          },
          { iterations, warmup },
        );
        for (const [actual, expected] of result.probes) assert.equal(actual, expected);
        assert.deepEqual(errors, []);
        samples[name].push(result.measurements);
      } finally {
        await context.close();
      }
    }
  }
  const reference = samples[variants[0][0]][0];
  for (const entries of Object.values(samples)) {
    for (const sample of entries) {
      for (const workload of Object.keys(reference))
        assert.equal(sample[workload].checksum, reference[workload].checksum);
    }
  }
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    Object.entries(samples).map(([name, entries]) => [
      name,
      Object.fromEntries(
        Object.keys(reference).map((workload) => [
          workload,
          median(entries.map((entry) => entry[workload].ms)),
        ]),
      ),
    ]),
  );
  // Separate lookup-only controls: no Intl.format, catalog, or renderer work.
  const lookupSamples = [];
  for (let run = 0; run < runs; run += 1) {
    const page = await browser.newPage();
    try {
      lookupSamples.push(
        await page.evaluate((round) => {
          const locale = "en-US";
          const styles = ["::currency/EUR", "integer", "percent", "", "::currency/USD"];
          const keys = styles.map((style) => `${locale}\0${style}`);
          const flat = new Map(keys.map((key, index) => [key, index + 1]));
          const bucket = new Map(styles.map((style, index) => [style, index + 1]));
          const locales = new Map([[locale, bucket]]);
          const cases = [
            ["compositeKey", (index) => flat.get(`${locale}\0${styles[index % 5]}`)],
            ["precomputedCompositeKey", (index) => flat.get(keys[index % 5])],
            ["nestedMaps", (index) => locales.get(locale).get(styles[index % 5])],
            ["selectedLocaleBucket", (index) => bucket.get(styles[index % 5])],
          ];
          const ordered = [
            ...cases.slice(round % cases.length),
            ...cases.slice(0, round % cases.length),
          ];
          if (round % 2) ordered.reverse();
          const measurements = {};
          for (const [name, lookup] of ordered) {
            for (let index = 0; index < 100_000; index += 1) lookup(index);
            let checksum = 0;
            const start = performance.now();
            for (let index = 0; index < 3_000_000; index += 1) checksum += lookup(index);
            measurements[name] = { ms: performance.now() - start, checksum };
          }
          return measurements;
        }, run),
      );
    } finally {
      await page.close();
    }
  }
  for (const sample of lookupSamples) {
    for (const entry of Object.values(sample)) assert.equal(entry.checksum, 9_000_000);
  }
  const lookupSummary = Object.fromEntries(
    Object.keys(lookupSamples[0]).map((name) => [
      name,
      median(lookupSamples.map((sample) => sample[name].ms)),
    ]),
  );
  console.log(
    JSON.stringify(
      {
        environment: {
          browser: browser.version(),
          node: process.version,
          cpu: os.cpus()[0]?.model,
          platform: process.platform,
          arch: process.arch,
        },
        runs,
        iterations,
        warmup,
        summary,
        samples,
        lookupControls: {
          iterations: 3_000_000,
          warmup: 100_000,
          summary: lookupSummary,
          samples: lookupSamples,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
