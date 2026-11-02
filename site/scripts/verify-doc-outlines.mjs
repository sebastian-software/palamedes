import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Read the shipped HTML, including Ardo's native no-JavaScript disclosure.
export const OUTLINE_ROUTES = [
  "configuration",
  "api/vite-plugin",
  "api/remix",
  "rust-applications",
  "migration-v2",
];
export function verifyDocOutlines(clientDir) {
  for (const route of OUTLINE_ROUTES) {
    const html = readFileSync(join(clientDir, "docs", route, "index.html"), "utf8");
    const outline = html.match(
      /<details\b[^>]*>[\s\S]*?<summary\b[^>]*>Page outline<\/summary>[\s\S]*?<\/details>/u,
    )?.[0];
    assert.ok(outline, `${route}: native page outline is missing`);
    const targets = [...outline.matchAll(/href="#([^"#]+)"/gu)].map((match) => match[1]);
    assert.ok(targets.length > 5, `${route}: long guide has lost its outline links`);
    for (const id of targets)
      assert.ok(html.includes(`id="${id}"`), `${route}: missing heading ${id}`);
  }
  console.log(
    `Native Ardo outlines verified on ${OUTLINE_ROUTES.length} long guides, including no-JavaScript output.`,
  );
}
if (process.argv[1] === import.meta.filename)
  verifyDocOutlines(join(import.meta.dirname, "../build/client"));
