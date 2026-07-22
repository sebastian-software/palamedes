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
const tools = ["Palamedes", "Lingui", "FormatJS", "i18next-parser", "i18next-cli"]
const comparedTools = tools.filter((tool) => tool !== "Palamedes")
const ratioFields = {
  Lingui: "lingui",
  FormatJS: "formatjs",
  "i18next-parser": "i18nextParser",
  "i18next-cli": "i18nextCli",
}

function parseSection(name) {
  const section = report.split(new RegExp(`^## ${name}$`, "m"))[1]
  if (!section) {
    fail(`could not find section "## ${name}" in ${reportPath}`)
  }
  const body = section.split(/^## /m)[0]
  const medians = {}
  for (const match of body.matchAll(
    /^\|\s+(Palamedes|Lingui|FormatJS|i18next-parser|i18next-cli)\s+\|\s+([\d.]+) ms\s+\|/gm
  )) {
    medians[match[1]] = Number(match[2])
  }
  const speedups = {}
  for (const match of body.matchAll(
    /^\|\s+Palamedes vs (Lingui|FormatJS|i18next-parser|i18next-cli)\s+\|\s+Palamedes\s+\|\s+([\d.]+)x\s+\|/gm
  )) {
    speedups[match[1]] = match[2]
  }
  if (
    Object.keys(medians).length !== tools.length ||
    Object.keys(speedups).length !== comparedTools.length
  ) {
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

function extractAssignedObjectBody(source, label) {
  const assignmentIndex = source.indexOf(label)
  if (assignmentIndex === -1) {
    return null
  }

  const openIndex = source.indexOf("{", assignmentIndex + label.length)
  if (openIndex === -1) {
    return null
  }

  let depth = 0
  let quote = null
  let inLineComment = false
  let inBlockComment = false
  let escaped = false

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (inLineComment) {
      if (char === "\n") inLineComment = false
      continue
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "/" && next === "/") {
      inLineComment = true
      index += 1
      continue
    }

    if (char === "/" && next === "*") {
      inBlockComment = true
      index += 1
      continue
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char
      continue
    }

    if (char === "{") {
      depth += 1
      continue
    }

    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return source.slice(openIndex + 1, index)
      }
    }
  }

  return null
}

function parseBenchSection(name) {
  const body = extractAssignedObjectBody(benchTs, `export const BENCH_${name}: BenchCorpus =`)
  if (!body) {
    fail(`could not find BENCH_${name} in ${benchTsPath}`)
  }
  const medians = {}
  for (const match of body.matchAll(
    /\{ tool: "(Palamedes|Lingui|FormatJS|i18next-parser|i18next-cli)", medianMs: ([\d.]+)/g
  )) {
    medians[match[1]] = Number(match[2])
  }
  const speedups = {}
  for (const [tool, field] of Object.entries(ratioFields)) {
    const match = body.match(new RegExp(`${field}: "([\\d.]+)×"`))
    if (match) speedups[tool] = match[1]
  }
  if (
    Object.keys(medians).length !== tools.length ||
    Object.keys(speedups).length !== comparedTools.length
  ) {
    fail(`could not parse medians/ratios from BENCH_${name} in ${benchTsPath}`)
  }
  return { medians, speedups }
}

function expect(label, condition) {
  if (!condition) {
    fail(`mismatch: ${label}`)
  }
}

const small = parseSection("Small")
const medium = parseSection("Medium")
const realistic = parseSection("Realistic")
const benchSmall = parseBenchSection("SMALL")
const benchMedium = parseBenchSection("MEDIUM")
const benchRealistic = parseBenchSection("REALISTIC")

const checks = []
for (const [profile, reported, hardcoded] of [
  ["small", small, benchSmall],
  ["medium", medium, benchMedium],
  ["realistic", realistic, benchRealistic],
]) {
  for (const tool of tools) {
    checks.push([`${profile} ${tool} median`, reported.medians[tool], hardcoded.medians[tool]])
  }
}

for (const [label, reported, hardcoded] of checks) {
  expect(`${label}: report says ${reported}, bench.ts says ${hardcoded}`, reported === hardcoded)
}

for (const [profile, reported, hardcoded] of [
  ["small", small, benchSmall],
  ["medium", medium, benchMedium],
  ["realistic", realistic, benchRealistic],
]) {
  for (const tool of comparedTools) {
    expect(
      `${profile} speedup vs ${tool} (${reported.speedups[tool]}x)`,
      reported.speedups[tool] === hardcoded.speedups[tool]
    )
  }
}

console.log("verify-site-bench-data: bench.ts matches latest.md")
