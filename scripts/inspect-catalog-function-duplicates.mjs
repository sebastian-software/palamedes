import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { parsePo, renderCatalogModule } from "../packages/core-node/dist/index.mjs";

// Opportunity check for module-local deduplication of identical emitted functions.
// Uses tracked example catalogs, excluding installed dependencies and build output.
const files = execFileSync("git", ["ls-files", "--", "examples/**/*.po"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const catalogs = [];
for (const file of files) {
  const items = parsePo(await readFile(file, "utf8")).items.filter((item) => !item.obsolete);
  const code = renderCatalogModule(
    Object.fromEntries(items.map((item, index) => [`m${index}`, item.msgstr[0] || item.msgid])),
  );
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
  catalogs.push({ file, messages: items.length, functions, duplicates });
}
console.log(
  JSON.stringify(
    {
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
