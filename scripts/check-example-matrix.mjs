import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  EXAMPLE_MATRIX,
  FOCUSED_EXAMPLES,
  LOCALE_STRATEGIES,
  ROOT,
  SERVER_EXAMPLES,
  SERVER_FRAMEWORKS,
  selectBrowserExamples,
  selectExamples,
  selectScreenshotExamples,
} from "./example-matrix.mjs";
import { assertExampleMatrix } from "./example-matrix-guard.mjs";

const MATRIX_COUNT = EXAMPLE_MATRIX.length;
const EXAMPLE_COUNT = MATRIX_COUNT + FOCUSED_EXAMPLES.length;
const BROWSER_COUNT = selectBrowserExamples({}).length;
const SCREENSHOT_COUNT = selectScreenshotExamples({}).length;

/*
 * `examples/` holds one directory more than the verification matrix, because
 * the focused React Router RSC fixture has its own verifier. Prose that names
 * a bare "25 examples" therefore reads as wrong against a directory listing,
 * which is exactly how the counts went stale (#1155). Every count-bearing
 * sentence below is generated from the matrix, so adding an example fails this
 * check instead of leaving a stale number in the documentation.
 */
const DOCUMENTED_COUNTS = [
  [
    "README.md",
    [
      `those ${MATRIX_COUNT} make up the verification matrix`,
      `make ${BROWSER_COUNT} browser-capable examples`,
      `\`examples/\` holds ${EXAMPLE_COUNT} apps`,
      `All ${MATRIX_COUNT} examples of the verification matrix`,
      `the ${SCREENSHOT_COUNT} UI-adapter examples`,
    ],
  ],
  [
    "examples/README.md",
    [
      `all ${MATRIX_COUNT} matrix examples`,
      `\`examples/\` holds ${EXAMPLE_COUNT} apps`,
      `the ${MATRIX_COUNT} of the verification matrix`,
      `outside the ${MATRIX_COUNT}-app locale-strategy matrix`,
      `complete ${MATRIX_COUNT}-example matrix`,
      `its ${BROWSER_COUNT} browser-capable examples`,
    ],
  ],
  ["docs/example-screenshots/README.md", [`All ${MATRIX_COUNT} matrix examples`]],
  ["docs/proof-and-benchmarks.md", [`all ${MATRIX_COUNT} examples of the verification matrix`]],
  [
    "docs/operations/run-examples-container.md",
    [`all ${MATRIX_COUNT} Palamedes matrix example apps`, `all ${MATRIX_COUNT} matrix servers`],
  ],
  [
    "Containerfile",
    [
      `Run all ${MATRIX_COUNT} Palamedes matrix example apps`,
      `Run all ${MATRIX_COUNT} matrix example servers`,
    ],
  ],
];

function normalizeProse(text) {
  return text.replaceAll(/\s+/gu, " ");
}

/*
 * The site build derives its stat tiles from the same two exports, so an
 * examples directory that drifts from them would publish a number nothing in
 * the repository can produce.
 */
export function assertExampleDirectories(directories) {
  const expected = new Set([...EXAMPLE_MATRIX.map((example) => example.id), ...FOCUSED_EXAMPLES]);
  assert.deepEqual(
    [...directories].sort(),
    [...expected].sort(),
    "examples/ must contain exactly the matrix examples plus the focused fixtures",
  );
  assert.equal(expected.size, EXAMPLE_COUNT, "matrix ids and focused fixture ids must not overlap");
}

export function assertDocumentedCounts(read) {
  for (const [file, phrases] of DOCUMENTED_COUNTS) {
    const prose = normalizeProse(read(file));
    for (const phrase of phrases) {
      assert.ok(
        prose.includes(normalizeProse(phrase)),
        `${file} must state the count derived from the example matrix: "${phrase}"`,
      );
    }
  }
}

function axisSlugs(source, name) {
  const body = source.match(
    new RegExp(`export const ${name}:[\\s\\S]+?= \\[([\\s\\S]+?)\\n\\]`, "u"),
  )?.[1];
  assert.ok(body, `site matrix must export ${name}`);
  return [...body.matchAll(/slug: "([^"]+)"/gu)].map((match) => match[1]).sort();
}

export function assertSiteMatrixAxes(source) {
  assert.deepEqual(
    axisSlugs(source, "FRAMEWORKS"),
    [...SERVER_FRAMEWORKS].sort(),
    "site framework axes must match the canonical example matrix",
  );
  assert.deepEqual(
    axisSlugs(source, "STRATEGIES"),
    [...LOCALE_STRATEGIES].sort(),
    "site strategy axes must match the canonical example matrix",
  );
}

assertExampleMatrix(EXAMPLE_MATRIX);
assertSiteMatrixAxes(readFileSync(path.join(ROOT, "site/app/data/matrix.ts"), "utf8"));
assertExampleDirectories(
  readdirSync(path.join(ROOT, "examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
assertDocumentedCounts((file) => readFileSync(path.join(ROOT, file), "utf8"));

if (
  SERVER_EXAMPLES.length !== 24 ||
  SERVER_FRAMEWORKS.length !== 6 ||
  LOCALE_STRATEGIES.length !== 4
) {
  throw new Error("canonical server matrix exports must remain six families by four strategies");
}
if (selectExamples({ framework: "vite", strategy: "client" }).length !== 1) {
  throw new Error("the Vite selector must return the single client-only proof");
}
if (
  selectBrowserExamples({}).length !== 22 ||
  selectBrowserExamples({ framework: "remix" }).length !== 1
) {
  throw new Error("the browser selector must include Vite and the focused Remix cookie proof");
}
if (
  selectScreenshotExamples({}).length !== 20 ||
  selectScreenshotExamples({ framework: "vite" }).length !== 0 ||
  selectScreenshotExamples({ framework: "remix" }).length !== 0
) {
  throw new Error("the screenshot selector must include only the UI-adapter matrix");
}

console.log(
  `Example matrix verified: ${MATRIX_COUNT} smoke examples; ${BROWSER_COUNT} browser examples; ` +
    `${SERVER_FRAMEWORKS.length} server families × ${LOCALE_STRATEGIES.length} strategies + Vite MDX; ` +
    `${EXAMPLE_COUNT} directories including ${FOCUSED_EXAMPLES.length} focused fixture.`,
);
