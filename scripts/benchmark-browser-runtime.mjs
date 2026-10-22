import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const reportPath = path.join(root, "benchmarks/browser-runtime/results.json");
const profiles = ["core", "react", "solid", "remix"];
const externals = ["react", "react/jsx-runtime", "solid-js", "@solidjs/web", "remix/component"];
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sizes = (code) => ({
  raw: Buffer.byteLength(code),
  gzip: gzipSync(code, { level: 9 }).byteLength,
  brotli: brotliCompressSync(code, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength,
});

// Hash source inputs, not generated dist directories. A fresh package build is
// required before measuring. The report separately retains every bundled input.
const inputPaths = [
  ...profiles.flatMap((id) =>
    git(
      "ls-files",
      `packages/${id}/src`,
      `packages/${id}/build.config.ts`,
      `packages/${id}/package.json`,
    ).split("\n"),
  ),
  ...git(
    "ls-files",
    "packages/runtime/src",
    "packages/runtime/build.config.ts",
    "packages/runtime/package.json",
  ).split("\n"),
  "Cargo.lock",
  "pnpm-lock.yaml",
  "scripts/benchmark-browser-runtime.mjs",
  ...profiles.map((id) => `benchmarks/browser-runtime/${id}.mjs`),
  ...profiles.map((id) => `benchmarks/browser-runtime/${id}-client.mjs`),
  "benchmarks/browser-runtime/catalog-only.mjs",
  "proof/sveltekit-ssr/locales/en.po",
].sort();
const sourceHash = createHash("sha256");
for (const filename of inputPaths) {
  sourceHash
    .update(filename)
    .update("\0")
    .update(await readFile(path.join(root, filename)))
    .update("\0");
}
const sourceSha256 = sourceHash.digest("hex");

if (process.argv.includes("--verify-report")) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, 2);
  assert.equal(
    report.sourceSha256,
    sourceSha256,
    "Browser runtime report is stale; rebuild packages and run pnpm benchmark:browser-runtime --write",
  );
  assert.deepEqual(
    report.profiles.map(({ id }) => id),
    profiles,
  );
  assert.deepEqual(
    report.treeShakenProfiles.map(({ id }) => id),
    profiles,
  );
  assert.deepEqual(report.diagnostics.catalogOnly.exports, ["defineCompiledCatalog"]);
  assert.deepEqual(report.diagnostics.catalogOnly.retainedIntl, []);
  for (const profile of [
    ...report.profiles,
    ...report.treeShakenProfiles,
    report.diagnostics.catalogOnly,
    report.catalog,
  ]) {
    assert(
      profile.bytes.raw > profile.bytes.gzip &&
        profile.bytes.gzip > profile.bytes.brotli &&
        profile.bytes.brotli > 0,
    );
    assert.match(profile.sha256, /^[a-f0-9]{64}$/u);
  }
  console.log("Browser runtime report matches its source inputs.");
} else {
  const { chromium } = await import("@playwright/test");
  const { compileCatalogArtifact, renderCatalogModule } =
    await import("../packages/core-node/dist/index.mjs");
  const viteRequire = createRequire(
    new URL("../packages/vite-plugin/package.json", import.meta.url),
  );
  const { build, version: viteVersion } = await import(viteRequire.resolve("vite"));
  const alias = [
    "core/compiled",
    "core/locale",
    "runtime",
    "react/compiled",
    "solid/compiled",
    "remix/compiled",
  ].map((id) => {
    const [pkg, entry = "index"] = id.split("/");
    return {
      find: `@palamedes/${id}`,
      replacement: path.join(root, "packages", pkg, "dist", `${entry}.mjs`),
    };
  });
  const assets = new Map();
  async function bundle(entry, { external = externals, source } = {}) {
    if (source !== undefined)
      entry = path.join(root, "benchmarks/browser-runtime", `${entry.replaceAll(":", "-")}.mjs`);
    const result = await build({
      configFile: false,
      root,
      logLevel: "error",
      define: { "process.env.NODE_ENV": '"production"' },
      resolve: { alias, conditions: ["browser"] },
      plugins:
        source === undefined
          ? []
          : [
              {
                name: "runtime-footprint-fixture",
                resolveId(id) {
                  if (id === entry) return `\0${entry}`;
                },
                load(id) {
                  if (id === `\0${entry}`) return source;
                },
              },
            ],
      build: {
        write: false,
        minify: "oxc",
        target: "es2022",
        sourcemap: false,
        lib: { entry, formats: ["es"], fileName: "runtime" },
        rolldownOptions: { external, output: { codeSplitting: false } },
      },
    });
    const output = Array.isArray(result) ? result[0].output : result.output;
    const chunks = output.filter((output) => output.type === "chunk");
    assert.equal(chunks.length, 1, "Account for every emitted JavaScript chunk");
    return chunks[0];
  }

  async function measure(id, filename) {
    const entry = path.join(root, `benchmarks/browser-runtime/${filename}.mjs`);
    const chunk = await bundle(entry);
    assert.equal(
      (await bundle(entry)).code,
      chunk.code,
      `${filename}: repeated builds must be byte-identical`,
    );
    const modules = Object.keys(chunk.modules)
      .map((filename) => path.relative(root, filename))
      .sort();
    assert(
      modules.every((filename) =>
        /^(?:packages\/(?:core|runtime|react|solid|remix)\/dist\/|benchmarks\/browser-runtime\/)/u.test(
          filename,
        ),
      ),
      `${id}: unexpected bundled dependency: ${modules.join(", ")}`,
    );
    assert(
      !/IntlMessageFormat|@formatjs|palamedes-node|\.node\b|@palamedes\/(?:transform|vite-plugin|core-node)/u.test(
        chunk.code,
      ),
      `${id}: build tools or ICU parser reached the browser`,
    );
    assets.set(`/${filename}.js`, chunk.code);
    return {
      id,
      bytes: sizes(chunk.code),
      sha256: sha256(chunk.code),
      exports: chunk.exports.sort(),
      imports: chunk.imports.sort(),
      retainedIntl: ["NumberFormat", "DateTimeFormat", "PluralRules"].filter((name) =>
        chunk.code.includes(`Intl.${name}`),
      ),
      modules: await Promise.all(
        modules.map(async (filename) => ({
          path: filename,
          sha256: sha256(await readFile(path.join(root, filename))),
        })),
      ),
    };
  }
  const measurements = [];
  const treeShakenMeasurements = [];
  for (const id of profiles) {
    measurements.push(await measure(id, id));
    const client = await measure(id, `${id}-client`);
    assert.deepEqual(
      client.exports,
      [
        "createI18n",
        "defineCompiledCatalog",
        "getI18n",
        "initializeClientI18n",
        ...(id === "core" ? [] : ["Trans"]),
      ].sort(),
    );
    assert(
      client.bytes.raw < measurements.at(-1).bytes.raw,
      `${id}: unused exports must be removed`,
    );
    treeShakenMeasurements.push(client);
  }
  const catalogOnly = await measure("catalog-only", "catalog-only");
  assert.deepEqual(catalogOnly.exports, ["defineCompiledCatalog"]);
  assert.deepEqual(catalogOnly.retainedIntl, [], "Catalog branding must not retain Intl helpers");

  const catalogPath = "proof/sveltekit-ssr/locales/en.po";
  const artifact = compileCatalogArtifact(
    {
      rootDir: path.join(root, "proof/sveltekit-ssr"),
      locales: ["en", "de", "fr", "es"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}", format: "po" }],
    },
    path.join(root, catalogPath),
  );
  assert.equal(artifact.diagnostics.length, 0);
  assert.equal(artifact.missing.length, 0);
  const messages = artifact.messages;
  const ids = Object.fromEntries(Object.entries(messages).map(([id, message]) => [message, id]));
  const catalog = await bundle("virtual:booking-catalog", {
    external: ["@palamedes/core/compiled"],
    source: renderCatalogModule(messages),
  });
  assert.deepEqual(catalog.imports, ["@palamedes/core/compiled"]);
  assets.set("/catalog.js", catalog.code);

  // Framework code is only supplied to the correctness probe, never counted in
  // Palamedes bytes. Catalogs import the measured profile itself, so no second
  // Core entry can hide a missing dependency in a client profile.
  const importMap = {};
  for (const [index, id] of externals.entries()) {
    if (!measurements.some((profile) => profile.imports.includes(id))) continue;
    const resolver = createRequire(
      new URL(
        `../packages/${id === "remix/component" ? "remix" : id.startsWith("react") ? "react" : "solid"}/package.json`,
        import.meta.url,
      ),
    );
    const resolved = resolver.resolve(id);
    const source = id.startsWith("react")
      ? `import runtime from ${JSON.stringify(resolved)}; export const { ${Object.keys(resolver(id))
          .filter((name) => name !== "default")
          .join(", ")} } = runtime;`
      : `export * from ${JSON.stringify(resolved)};`;
    const vendor = await bundle(`virtual:vendor-${index}`, { external: [], source });
    importMap[id] = `/vendor-${index}.js`;
    assets.set(importMap[id], vendor.code);
  }
  const browser = await chromium.launch();
  try {
    for (const filename of profiles.flatMap((id) => [id, `${id}-client`])) {
      const id = filename.replace(/-client$/u, "");
      const context = await browser.newContext();
      try {
        const errors = [];
        await context.route("http://runtime-footprint.test/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === "/")
            return route.fulfill({
              contentType: "text/html",
              body: `<!doctype html><html lang="en"><script type="importmap">${JSON.stringify({ imports: { ...importMap, "@palamedes/core/compiled": `/${filename}.js` } })}</script></html>`,
            });
          assert(assets.has(pathname), `Unexpected browser request: ${pathname}`);
          await route.fulfill({ contentType: "text/javascript", body: assets.get(pathname) });
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("http://runtime-footprint.test/");
        const probe = await page.evaluate(
          async ({ profile, filename, ids }) => {
            const runtime = await import(`/${filename}.js`);
            const { messages: compiled } = await import("/catalog.js");
            const i18n = runtime.initializeClientI18n("en", () =>
              runtime.createI18n({ timeZone: "Europe/Berlin" }),
            );
            i18n.load("en", compiled);
            return {
              text: runtime.getI18n()._(ids["Add to cart"]),
              plural: i18n._(ids["{seats, plural, one {# seat left} other {# seats left}}"], {
                seats: 2,
              }),
              number: i18n._(ids["{count, number}"], { count: 1234 }),
              date: i18n._(ids["{when, date, medium}"], { when: new Date("2026-10-22T12:00:00Z") }),
              renderer: profile === "core" || typeof runtime.Trans === "function",
            };
          },
          { profile: id, filename, ids },
        );
        assert.deepEqual(probe, {
          text: "Add to cart",
          plural: "2 seats left",
          number: "1,234",
          date: "Oct 22, 2026",
          renderer: true,
        });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
    const report = {
      schemaVersion: 2,
      measuredAt: new Date().toISOString(),
      sourceCommit: git("rev-parse", "HEAD"),
      worktreeDirty: git("status", "--porcelain").length > 0,
      sourceSha256,
      environment: {
        node: process.version,
        vite: viteVersion,
        rolldown: createRequire(viteRequire.resolve("vite/package.json"))("rolldown/package.json")
          .version,
        browser: browser.version(),
        platform: process.platform,
        arch: process.arch,
      },
      methodology: {
        target: "es2022",
        minifier: "oxc",
        gzipLevel: 9,
        brotliQuality: 11,
        repeatedBuilds: 2,
        scope:
          "All exports of compiled core + universal runtime, plus the selected compiled UI entry. Framework peers, host bootstrap, application code, catalogs, and Intl polyfills are excluded.",
        treeShakenScope:
          "Named client imports only: createI18n, defineCompiledCatalog, getI18n, initializeClientI18n, and Trans for UI profiles. Unused registration, server binding, reset, locale-switch, and standalone formatter exports can be removed. The complete default string runtime remains reachable through createI18n.",
      },
      profiles: measurements,
      treeShakenProfiles: treeShakenMeasurements,
      diagnostics: { catalogOnly },
      catalog: {
        source: catalogPath,
        locale: "en",
        messages: Object.keys(messages).length,
        bytes: sizes(catalog.code),
        sha256: sha256(catalog.code),
        scope:
          "Complete booking demo source-locale catalog; compiled core is external and counted in runtime profiles. Not a per-message estimate or a route payload.",
      },
    };
    if (process.argv.includes("--write")) {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      execFileSync("pnpm", ["exec", "oxfmt", "--write", reportPath], {
        cwd: root,
        stdio: "ignore",
      });
    } else {
      const previous = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(previous.sourceSha256, sourceSha256);
      assert.deepEqual(previous.profiles, report.profiles);
      assert.deepEqual(previous.treeShakenProfiles, report.treeShakenProfiles);
      assert.deepEqual(previous.diagnostics, report.diagnostics);
      assert.deepEqual(previous.catalog, report.catalog);
    }
    console.log(
      JSON.stringify(
        {
          profiles: measurements.map(({ id, bytes }) => ({ id, ...bytes })),
          treeShakenProfiles: treeShakenMeasurements.map(({ id, bytes, retainedIntl }) => ({
            id,
            ...bytes,
            retainedIntl,
          })),
          diagnostics: { catalogOnly },
          catalog: report.catalog,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
