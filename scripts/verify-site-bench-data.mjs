/*
 * Guards site/app/data/bench.ts against silent drift from the checked-in
 * benchmark report. Parses the cold median tables, the warm lane, and the
 * speedup tables in benchmarks/e2e-workflow/results/latest.md and fails the
 * site build when the hardcoded constants no longer match, so updating the
 * report forces a conscious copy edit on the site.
 *
 * Speedup ratios come from the cold lane only. Warm numbers describe a
 * capability the compared tools do not have and must never reach a ratio, so
 * they are guarded separately: Palamedes warm against Palamedes cold, never
 * against another tool.
 *
 * The README quotes the realistic warm pair as well, so it is checked here
 * too — it is the most public surface of all and has no other guard.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const reportPath = join(repoRoot, "benchmarks/e2e-workflow/results/latest.md")
const benchTsPath = join(repoRoot, "site/app/data/bench.ts")
const readmePath = join(repoRoot, "README.md")

const report = readFileSync(reportPath, "utf8")
const benchTs = readFileSync(benchTsPath, "utf8")
const readme = readFileSync(readmePath, "utf8")
const tools = ["Palamedes", "Lingui", "React Intl", "i18next-cli"]
const comparedTools = tools.filter((tool) => tool !== "Palamedes")
const ratioFields = {
  Lingui: "lingui",
  "React Intl": "formatjs",
  "i18next-cli": "i18nextCli",
}

function parseSection(name) {
  const section = report.split(new RegExp(`^## ${name}$`, "m"))[1]
  if (!section) {
    fail(`could not find section "## ${name}" in ${reportPath}`)
  }
  /*
   * Only the cold lane feeds the site. The warm table repeats the same row
   * shape, so without this the last match would win and bench.ts would be
   * validated against warm medians — silently publishing cache-hit numbers as
   * the cross-tool comparison. See ADR-019.
   */
  const profileBody = section.split(/^## /m)[0]
  const coldStart = profileBody.indexOf("### Cold")
  if (coldStart === -1) {
    fail(`could not find a "### Cold" table in section "${name}" of ${reportPath}`)
  }
  const afterCold = profileBody.slice(coldStart + "### Cold".length)
  const warmStart = afterCold.indexOf("### Warm")
  const body = warmStart === -1 ? afterCold : afterCold.slice(0, warmStart)
  const medians = {}
  for (const match of body.matchAll(
    /^\|\s+(Palamedes|Lingui|React Intl|i18next-cli)\s+\|\s+([\d.]+) ms\s+\|/gm
  )) {
    medians[match[1]] = Number(match[2])
  }
  const speedups = {}
  for (const match of body.matchAll(
    /^\|\s+Palamedes vs (Lingui|React Intl|i18next-cli)\s+\|\s+Palamedes\s+\|\s+([\d.]+)x\s+\|/gm
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

/*
 * The warm counterpart of parseSection. Palamedes is the only row read here on
 * purpose: the other tools re-extract in full, so their warm medians repeat
 * their cold ones and quoting them would invite a comparison the lane does not
 * support.
 */
function parseWarmLane(name) {
  const section = report.split(new RegExp(`^## ${name}$`, "m"))[1]
  if (!section) {
    fail(`could not find section "## ${name}" in ${reportPath}`)
  }
  const profileBody = section.split(/^## /m)[0]
  const warmStart = profileBody.indexOf("### Warm")
  if (warmStart === -1) {
    fail(`could not find a "### Warm" table in section "${name}" of ${reportPath}`)
  }
  const body = profileBody.slice(warmStart)
  const median = body.match(/^\|\s+Palamedes\s+\|\s+([\d.]+) ms\s+\|/m)
  const touched = body.match(/after touching (\d+) source files/)
  if (!median || !touched) {
    fail(`could not parse the warm Palamedes median from section "${name}" of ${reportPath}`)
  }
  return { medianMs: Number(median[1]), touchedFiles: Number(touched[1]) }
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
    /\{ tool: "(Palamedes|Lingui|React Intl|i18next-cli)", medianMs: ([\d.]+)/g
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

function parseBenchWarm(name) {
  const body = extractAssignedObjectBody(benchTs, `export const BENCH_${name}_WARM: BenchWarm =`)
  if (!body) {
    fail(`could not find BENCH_${name}_WARM in ${benchTsPath}`)
  }
  const values = {}
  for (const field of ["touchedFiles", "coldMs", "warmMs"]) {
    const match = body.match(new RegExp(`${field}: ([\\d.]+)`))
    if (!match) {
      fail(`could not parse ${field} from BENCH_${name}_WARM in ${benchTsPath}`)
    }
    values[field] = Number(match[1])
  }
  return values
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

/*
 * Warm lane. Each constant is pinned to both report numbers it quotes: the
 * warm median it advertises and the cold median it is shown against, so a
 * re-record can never leave a warm figure paired with a stale cold one.
 */
for (const [profile, section, constant] of [
  ["small", "Small", "SMALL"],
  ["medium", "Medium", "MEDIUM"],
  ["realistic", "Realistic", "REALISTIC"],
]) {
  const reportedWarm = parseWarmLane(section)
  const reportedCold = parseSection(section).medians.Palamedes
  const hardcoded = parseBenchWarm(constant)
  expect(
    `${profile} warm median: report says ${reportedWarm.medianMs}, bench.ts says ${hardcoded.warmMs}`,
    reportedWarm.medianMs === hardcoded.warmMs
  )
  expect(
    `${profile} warm-lane cold reference: report says ${reportedCold}, bench.ts says ${hardcoded.coldMs}`,
    reportedCold === hardcoded.coldMs
  )
  expect(
    `${profile} touched files: report says ${reportedWarm.touchedFiles}, bench.ts says ${hardcoded.touchedFiles}`,
    reportedWarm.touchedFiles === hardcoded.touchedFiles
  )
}

/*
 * The README quotes the realistic warm pair in prose. It has no build step of
 * its own, so the tokens are checked literally here. Whitespace is collapsed
 * first because the README is hard-wrapped: a token may straddle a line break,
 * and reflowing a paragraph must not read as drift.
 */
const realisticWarm = parseBenchWarm("REALISTIC")
const readmeText = readme.replace(/\s+/gu, " ")
for (const [label, token] of [
  ["realistic cold median", `\`${realisticWarm.coldMs.toFixed(2)} ms\``],
  ["realistic warm median", `\`${realisticWarm.warmMs.toFixed(2)} ms\``],
  ["touched files", `\`${realisticWarm.touchedFiles}\` source files`],
]) {
  expect(`README is missing the ${label} ${token} quoted by bench.ts`, readmeText.includes(token))
}

console.log("verify-site-bench-data: bench.ts and README match latest.md")
