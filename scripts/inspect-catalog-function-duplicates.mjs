import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { loadPalamedesConfigSync } from "../packages/config/dist/index.mjs";
import { compileCatalogArtifact, renderCatalogModule } from "../packages/core-node/dist/index.mjs";

// Opportunity check for module-local deduplication of identical emitted functions.
// Optional arguments select project roots, for example examples proof/svelte-vite.
// Compile through each project's configuration so fuzzy fallback and PO escaping
// match the production module renderer rather than interpreting raw PO strings.
const roots = process.argv.length > 2 ? process.argv.slice(2) : ["examples"];
const files = execFileSync("git", ["ls-files", "--", ...roots], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => file.endsWith(".po"));
const catalogs = [];
const configs = new Map();
for (const file of files) {
  const project = file.split("/").slice(0, 2).join("/");
  if (!configs.has(project))
    configs.set(project, loadPalamedesConfigSync({ projectRoot: project }));
  const artifact = compileCatalogArtifact(configs.get(project), path.resolve(file));
  assert.deepEqual(artifact.diagnostics, [], `${file}: catalog compilation must succeed`);
  const code = renderCatalogModule(artifact.messages);
  const source = ts.createSourceFile(
    "catalog.js",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const seen = new Set();
  let functions = 0;
  let duplicates = 0;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer || !ts.isArrowFunction(declaration.initializer)) continue;
      functions += 1;
      const expression = declaration.initializer.getText(source);
      if (seen.has(expression)) duplicates += 1;
      else seen.add(expression);
    }
  }
  catalogs.push({ file, messages: Object.keys(artifact.messages).length, functions, duplicates });
}
console.log(
  JSON.stringify(
    {
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      roots,
      summary: {
        catalogs: catalogs.length,
        messages: catalogs.reduce((total, entry) => total + entry.messages, 0),
        functions: catalogs.reduce((total, entry) => total + entry.functions, 0),
        duplicates: catalogs.reduce((total, entry) => total + entry.duplicates, 0),
      },
      catalogs,
    },
    null,
    2,
  ),
);
