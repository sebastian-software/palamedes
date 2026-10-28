/*
 * Static half of the progressive outline verification: compares the generated
 * docs pages with the prebuild manifest, without a browser. CI runs it after
 * the site build so pull requests see outline regressions that the deploy-only
 * route verification would otherwise report after merge.
 *
 * Usage: node site/scripts/verify-progressive-outlines.mjs  (requires a prior site prebuild)
 */

import { join } from "node:path";

import { verifyGeneratedProgressiveOutlines } from "./progressive-outline.mjs";

const siteRoot = join(import.meta.dirname, "..");
const { docs, problems } = verifyGeneratedProgressiveOutlines({
  docsDir: join(siteRoot, "app/routes/docs"),
  dataDir: join(siteRoot, "app/data/generated"),
});

if (problems.length > 0) {
  for (const problem of problems) console.error(`  !! progressive docs outline: ${problem}`);
  process.exit(1);
}
console.log(
  `verify-progressive-outlines: ${docs.length} generated docs carry the expected outline`,
);
