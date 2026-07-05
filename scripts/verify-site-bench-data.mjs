/*
 * Guards site/app/data/bench.ts against silent drift from the checked-in
 * benchmark report. Parses the Small/Medium median tables and the speedup
 * tables in benchmarks/e2e-workflow/results/latest.md and fails the site
 * build when the hardcoded constants no longer match, so updating the
 * report forces a conscious copy edit on the site.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const reportPath = join(repoRoot, "benchmarks/e2e-workflow/results/latest.md")
const benchTsPath = join(repoRoot, "site/app/data/bench.ts")

const report = readFileSync(reportPath, "utf8")
const benchTs = readFileSync(benchTsPath, "utf8")

function parseSection(name) {
  const section = report.split(new RegExp(`^## ${name}$`, "m"))[1]
  if (!section) {
    fail(`could not find section "## ${name}" in ${reportPath}`)
  }
  const body = section.split(/^## /m)[0]
  const medians = {}
  for (const match of body.matchAll(/^\| (Palamedes|Lingui|i18next-parser) \| ([\d.]+) ms \|/gm)) {
    medians[match[1]] = Number(match[2])
  }
  const speedups = {}
  for (const match of body.matchAll(
    /^\| Palamedes vs (Lingui|i18next-parser) \| Palamedes \| ([\d.]+)x \|/gm
  )) {
    speedups[match[1]] = match[2]
  }
  if (Object.keys(medians).length !== 3 || Object.keys(speedups).length !== 2) {
    fail(`could not parse medians/speedups from section "${name}" of ${reportPath}`)
  }
  return { medians, speedups }
}

function fail(message) {
  console.error(`verify-site-bench-data: ${message}`)
  console.error(
    "The benchmark report and site/app/data/bench.ts have diverged. " +
      "Update the constants in bench.ts (and any prose quoting them) to match the report."
  )
  process.exit(1)
}

function expect(label, condition) {
  if (!condition) {
    fail(`mismatch: ${label}`)
  }
}

const small = parseSection("Small")
const medium = parseSection("Medium")

const checks = [
  ["small Palamedes median", small.medians.Palamedes, /medianMs: 33\.53/.test(benchTs) && 33.53],
  ["small Lingui median", small.medians.Lingui, /medianMs: 657\b/.test(benchTs) && 657],
  [
    "small i18next median",
    small.medians["i18next-parser"],
    /medianMs: 477\.58/.test(benchTs) && 477.58,
  ],
  ["medium Palamedes median", medium.medians.Palamedes, /medianMs: 42\.92/.test(benchTs) && 42.92],
  ["medium Lingui median", medium.medians.Lingui, /medianMs: 728\.56/.test(benchTs) && 728.56],
  [
    "medium i18next median",
    medium.medians["i18next-parser"],
    /medianMs: 534\.15/.test(benchTs) && 534.15,
  ],
]

for (const [label, reported, hardcoded] of checks) {
  expect(`${label}: report says ${reported}, bench.ts says ${hardcoded}`, reported === hardcoded)
}

expect(
  `small speedup vs Lingui (${small.speedups.Lingui}x)`,
  benchTs.includes(`"${small.speedups.Lingui}×"`)
)
expect(
  `small speedup vs i18next (${small.speedups["i18next-parser"]}x)`,
  benchTs.includes(`"${small.speedups["i18next-parser"]}×"`)
)
expect(
  `medium speedup vs Lingui (${medium.speedups.Lingui}x)`,
  benchTs.includes(`"${medium.speedups.Lingui}×"`)
)
expect(
  `medium speedup vs i18next (${medium.speedups["i18next-parser"]}x)`,
  benchTs.includes(`"${medium.speedups["i18next-parser"]}×"`)
)

console.log("verify-site-bench-data: bench.ts matches latest.md")
