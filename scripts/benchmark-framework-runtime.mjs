import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { renderCatalogModule } from "../packages/core-node/dist/index.mjs";

// Usage: node scripts/benchmark-framework-runtime.mjs baseline-directory
// baseline-directory contains react/ and solid/ production dist snapshots.
const root = fileURLToPath(new URL("../", import.meta.url));
const reactRequire = createRequire(new URL("../packages/react/package.json", import.meta.url));
const solidRequire = createRequire(new URL("../packages/solid/package.json", import.meta.url));
const viteRequire = createRequire(new URL("../packages/vite-plugin/package.json", import.meta.url));
const { build } = await import(viteRequire.resolve("vite"));
assert(process.argv[2], "Pass a directory containing baseline react/ and solid/ dist snapshots");
const baseline = path.resolve(process.argv[2]);
const temp = await mkdtemp(path.join(os.tmpdir(), "palamedes-framework-benchmark-"));
const variants = [];
const runs = 9;
const updates = 40;
const catalog = renderCatalogModule({
  row: "Hello <0>{name}</0>, {count, plural, one {# item} other {# items}}; ",
});

try {
  for (const framework of ["react", "solid"]) {
    for (const name of ["baseline", "current"]) {
      const directory =
        name === "baseline"
          ? path.join(baseline, framework)
          : path.join(root, "packages", framework, "dist");
      const outDir = path.join(temp, `${framework}-${name}`);
      await build({
        configFile: false,
        root,
        logLevel: "error",
        plugins: [
          {
            name: "benchmark-catalog",
            resolveId(id) {
              if (id === "virtual:catalog") return "\0catalog";
            },
            load(id) {
              if (id === "\0catalog") return catalog;
            },
          },
        ],
        resolve: {
          alias: [
            {
              find: /^@palamedes\/core\/compiled$/,
              replacement: path.join(root, "packages/core/dist/compiled.mjs"),
            },
            {
              find: /^@palamedes\/runtime$/,
              replacement: path.join(root, "packages/runtime/dist/index.mjs"),
            },
            {
              find: `@palamedes/${framework}/compiled`,
              replacement: path.join(directory, "compiled.mjs"),
            },
            { find: /^react$/, replacement: reactRequire.resolve("react") },
            { find: /^react-dom\/client$/, replacement: reactRequire.resolve("react-dom/client") },
            { find: /^react-dom$/, replacement: reactRequire.resolve("react-dom") },
            {
              find: /^solid-js$/,
              replacement: path.join(path.dirname(solidRequire.resolve("solid-js")), "solid.js"),
            },
            {
              find: /^@solidjs\/web$/,
              replacement: path.join(path.dirname(solidRequire.resolve("@solidjs/web")), "web.js"),
            },
          ],
        },
        build: {
          outDir,
          minify: true,
          rollupOptions: {
            input: path.join(root, "benchmarks/framework-runtime", `${framework}.mjs`),
            output: { entryFileNames: "app.js" },
          },
        },
      });
      variants.push({ framework, name, outDir });
    }
  }
  const browser = await chromium.launch();
  const samples = Object.fromEntries(
    variants.map(({ framework, name }) => [`${framework}-${name}`, []]),
  );
  try {
    for (let run = 0; run < runs; run += 1) {
      for (const { framework, name, outDir } of run % 2 === 0
        ? variants
        : [...variants].reverse()) {
        const context = await browser.newContext();
        try {
          await context.route("http://palamedes-benchmark.test/**", async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            if (pathname === "/")
              return route.fulfill({
                contentType: "text/html",
                body: '<!doctype html><script type="module" src="/app.js"></script>',
              });
            const filename = path.resolve(outDir, pathname.slice(1));
            assert(filename.startsWith(`${outDir}${path.sep}`));
            await route.fulfill({ contentType: "text/javascript", body: await readFile(filename) });
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto("http://palamedes-benchmark.test/");
          await page.waitForFunction(() => globalThis.benchmark !== undefined);
          const cdp = await context.newCDPSession(page);
          await cdp.send("HeapProfiler.collectGarbage");
          const before = await cdp.send("Runtime.getHeapUsage");
          const timing = await page.evaluate(async (updates) => {
            const app = globalThis.benchmark;
            const start = performance.now();
            app.mount();
            await Promise.resolve();
            const mountMs = performance.now() - start;
            for (let tick = 1; tick <= 5; tick += 1) {
              app.update(tick);
              await Promise.resolve();
            }
            const updateStart = performance.now();
            for (let tick = 6; tick < 6 + updates; tick += 1) {
              app.update(tick);
              await Promise.resolve();
            }
            return { mountMs, updatesMs: performance.now() - updateStart, probe: app.probe() };
          }, updates);
          const expected = Array.from(
            { length: 500 },
            (_, index) => `Hello Person ${index}, 1 item; `,
          ).join("");
          assert.deepEqual(timing.probe, { text: expected, tags: 500 });
          await cdp.send("HeapProfiler.collectGarbage");
          const mounted = await cdp.send("Runtime.getHeapUsage");
          await page.evaluate(async () => {
            globalThis.benchmark.unmount();
            // Let framework cleanup tasks finish before checking collection.
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          await cdp.send("HeapProfiler.collectGarbage");
          const after = await cdp.send("Runtime.getHeapUsage");
          const retainedComponent = await page.evaluate(() =>
            Number(globalThis.benchmark.retainedComponent?.() ?? false),
          );
          assert.deepEqual(errors, []);
          samples[`${framework}-${name}`].push({
            mountMs: timing.mountMs,
            updatesMs: timing.updatesMs,
            mountedBytes: mounted.usedSize - before.usedSize,
            afterUnmountBytes: after.usedSize - before.usedSize,
            retainedComponent,
          });
        } finally {
          await context.close();
        }
      }
    }
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const summary = Object.fromEntries(
      Object.entries(samples).map(([key, entries]) => [
        key,
        Object.fromEntries(
          Object.keys(entries[0]).map((metric) => [
            metric,
            median(entries.map((entry) => entry[metric])),
          ]),
        ),
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
          runs,
          updates,
          rows: 500,
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
} finally {
  await rm(temp, { recursive: true, force: true });
}
