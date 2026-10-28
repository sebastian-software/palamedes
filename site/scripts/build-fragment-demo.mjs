import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { loadPalamedesConfig } from "@palamedes/config";
import { compileCatalogArtifact, compileCatalogModule } from "@palamedes/core-node";
import { palamedes } from "@palamedes/vite-plugin";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(siteRoot, "fragment-demo");
const outDir = join(siteRoot, "public/fragment-demo");
const config = await loadPalamedesConfig({ projectRoot: root });
await build({
  configFile: false,
  root,
  base: "/fragment-demo/",
  plugins: [palamedes({ projectRoot: root, failOnMissing: true })],
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: { input: [join(root, "en.html"), join(root, "fr.html")] },
  },
});

const manifest = JSON.parse(await readFile(join(outDir, "palamedes-split-manifest.json"), "utf8"));
const artifactConfig = {
  rootDir: config.rootDir,
  locales: config.locales,
  sourceLocale: config.sourceLocale,
  catalogs: config.catalogs,
};
const views = ["overview", "projects", "billing"];
for (const locale of config.locales) {
  const { imports } = JSON.parse(await readFile(join(outDir, manifest.importMaps[locale]), "utf8"));
  assert.equal(
    Object.keys(imports).length,
    views.length,
    "Every view must have exactly one real fragment",
  );
  const fragments = await Promise.all(
    views.map(async (view) => {
      const key = createHash("sha256").update(`src/views/${view}.tsx`).digest("hex").slice(0, 12);
      const file = imports[`#pmds/${key}`]?.replace("/fragment-demo/", "");
      assert.ok(file, `Missing ${locale} fragment for ${view}`);
      const source = await readFile(join(outDir, file));
      const fragment = await import(pathToFileURL(join(outDir, file)).href);
      assert.equal(fragment.locale, locale);
      return { view, file, bytes: source.byteLength, ids: Object.keys(fragment.messages) };
    }),
  );
  const resourcePath = join(root, "locales", `${locale}.po`);
  const artifact = compileCatalogArtifact(artifactConfig, resourcePath);
  const whole = compileCatalogModule(artifactConfig, resourcePath, { locale, failOnMissing: true });
  const ids = new Set(fragments.flatMap((fragment) => fragment.ids));
  assert.deepEqual(
    [...ids].sort(),
    Object.keys(artifact.messages).sort(),
    "The reference and fragment union must contain the same messages",
  );
  const file = `whole.${locale}.js`;
  await writeFile(join(outDir, file), whole.code);
  await writeFile(
    join(outDir, `evidence.${locale}.json`),
    JSON.stringify({
      fragments,
      whole: { file, bytes: Buffer.byteLength(whole.code), messages: ids.size },
    }),
  );
}
console.log("fragment-demo: verified active-locale fragments and whole-catalog references");
