import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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
console.log(
  "Public Core/React/Solid/runtime artifacts are parser-free; ESM and CJS Core aliases execute the same contract.",
);
