// Checks the contract that out-of-graph client catalog delivery depends on:
// Next must keep each translated client module's `pmds-next:` marker literal
// intact in its emitted chunks, so the post-compile step can find it. Run it
// after a build with `experimentalClientCatalogAssets`; it fails loudly when a
// Next or Turbopack release starts rewriting or dropping those literals.
//
//   node scripts/check-next-client-catalog-assets.mjs <example-dir> [dist-dir]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const exampleDir = path.resolve(process.argv[2] ?? ".");
const distDir = path.join(exampleDir, process.argv[3] ?? ".next");
const exampleRequire = createRequire(path.join(exampleDir, "package.json"));
const { catalogMatchesSource, loadPalamedesConfig } = exampleRequire("@palamedes/config");
const { transformPalamedesMacros } = createRequire(
  exampleRequire.resolve("@palamedes/next-plugin/palamedes-loader"),
)("@palamedes/transform");

const config = await loadPalamedesConfig({ projectRoot: exampleDir });
const rootDir = realpathSync(config.rootDir);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// The same client modules the transform loader bootstraps: client boundaries
// with compiled messages inside a configured catalog.
const expected = new Map();
for (const file of sourceFiles(path.join(exampleDir, "src"))) {
  const source = readFileSync(file, "utf8");
  if (!/^\s*["']use client["']/u.test(source)) continue;
  if (!config.catalogs.some((catalog) => catalogMatchesSource(config, catalog, file))) continue;
  const { compiledIds } = transformPalamedesMacros(source, file, {});
  if (!compiledIds?.length) continue;
  const modulePath = path.relative(rootDir, realpathSync(file)).split(path.sep).join("/");
  expected.set(createHash("sha256").update(modulePath).digest("hex").slice(0, 12), modulePath);
}
assert.notEqual(expected.size, 0, "The example has no translated client modules to check");

const chunkSource = sourceFiles(path.join(distDir, "static/chunks"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const [key, modulePath] of expected) {
  assert.match(
    chunkSource,
    new RegExp(`["'\`]pmds-next:${key}:[\\w-]+["'\`]`, "u"),
    `The client chunks lost the catalog marker of ${modulePath}. The bundler rewrote or dropped the string literal that the post-compile step reads.`,
  );
}
assert.equal(
  /catalog-fragment\.cjs|palamedes-catalog=/u.test(chunkSource),
  false,
  "Asset delivery must not leave in-graph catalog fragments in the client chunks",
);

const manifestPath = path.join(distDir, "palamedes-client-catalogs.json");
assert.ok(existsSync(manifestPath), `Missing ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.deepEqual(Object.keys(manifest.locales).sort(), [...config.locales].sort());

let assets = 0;
for (const locale of config.locales) {
  const urls = new Set();
  for (const [key, modulePath] of expected) {
    const url = manifest.locales[locale][key];
    assert.ok(url, `The ${locale} manifest has no asset for ${modulePath}`);
    urls.add(url);
  }
  for (const url of urls) {
    const file = path.join(distDir, url.slice(url.indexOf("/_next/") + "/_next/".length));
    // Assets are browser ES modules; the example package is not "type": "module".
    const asset = await import(
      `data:text/javascript;base64,${readFileSync(file).toString("base64")}`
    );
    assert.equal(typeof asset.messages, "object", `${url} does not export messages`);
    assert.notEqual(Object.keys(asset.messages).length, 0, `${url} has no messages`);
  }
  assets += urls.size;
}

console.log(
  `[next-catalog-assets] ${expected.size} translated client modules kept their markers; ${assets} message assets across ${config.locales.length} locales`,
);
