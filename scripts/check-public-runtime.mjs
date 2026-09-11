import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const forbidden = [
  "[palamedes:icu-parser]",
  "parseMessagePattern",
  "getMessageNodes",
  "renderNodesToString",
];
for (const name of ["core", "react", "solid", "runtime", "remix"]) {
  const directory = new URL(`../packages/${name}/dist/`, import.meta.url);
  for (const entry of await readdir(directory, { recursive: true })) {
    if (!/\.(mjs|cjs)$/.test(entry)) continue;
    const source = await readFile(new URL(entry.replaceAll("\\", "/"), directory), "utf8");
    for (const symbol of forbidden)
      assert.ok(!source.includes(symbol), `${name}/dist/${entry} includes ${symbol}`);
  }
}

for (const format of ["mjs", "cjs"]) {
  const load = async (entry) => {
    const url = new URL(`../packages/core/dist/${entry}.${format}`, import.meta.url);
    return format === "mjs" ? import(url.href) : require(fileURLToPath(url));
  };
  const [root, compiled] = await Promise.all([load("index"), load("compiled")]);
  assert.equal(root.createI18n, compiled.createI18n);
  assert.deepEqual(Object.keys(root).sort(), Object.keys(compiled).sort());
  const runtime = root.createI18n();
  assert.throws(() => runtime.load("en", { greeting: "Hello {name}" }), /Compile ICU/);
  runtime.load(
    "en",
    root.defineCompiledCatalog({
      greeting: (values, renderer) => renderer.join("Hello ", renderer.value(values, "name")),
    }),
  );
  assert.equal(runtime._("greeting", { name: "Ada" }), "Hello Ada");
  assert.throws(
    () => runtime._("private-key", {}, { message: "Source {name}" }),
    root.MissingCompiledMessageError,
  );
  for (const removed of ["parsePattern", "getMessage", "getMessageNodes", "reportError"])
    assert.ok(!(removed in runtime));
}
// Exercise the published Remix module formats, not only their declarations.
// This catches ESM-only resolution APIs accidentally emitted as undefined in CJS.
const fixture = await mkdtemp(path.join(tmpdir(), "palamedes-runtime-contract-"));
try {
  await mkdir(path.join(fixture, "locales"));
  await writeFile(
    path.join(fixture, "palamedes.yaml"),
    "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
  );
  await writeFile(
    path.join(fixture, "locales/en.po"),
    'msgid ""\nmsgstr ""\n"Language: en\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hello {name}"\nmsgstr "Hello {name}"\n',
  );
  for (const format of ["mjs", "cjs"]) {
    const load = async (name, entry = "index") => {
      const url = new URL(`../packages/${name}/dist/${entry}.${format}`, import.meta.url);
      return format === "mjs" ? import(url.href) : require(fileURLToPath(url));
    };
    const [remix, core] = await Promise.all([load("remix"), load("core")]);
    const registry = remix.createPalamedesRemixCatalogAssetRegistry({ cwd: fixture, watch: false });
    try {
      const messages = await registry.load("en");
      assert.ok(core.isCompiledCatalog(messages));
      assert.equal(await registry.load("en"), messages);
      const i18n = core.createI18n({ locale: "en" });
      i18n.load("en", messages);
      const keys = Object.keys(messages);
      assert.equal(keys.length, 1);
      assert.equal(i18n._(keys[0], { name: "Ada" }), "Hello Ada");
    } finally {
      registry.close?.();
    }
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log(
  "Public application artifacts are parser-free; ESM/CJS Core aliases and native Remix catalog imports execute the same contract.",
);
