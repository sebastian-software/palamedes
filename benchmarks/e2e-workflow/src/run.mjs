import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { DEFAULT_SEED, PROFILE_DEFINITIONS, createWorkflowCorpus } from "./corpus.mjs"

const __dirname = import.meta.dirname
const benchmarkRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(benchmarkRoot, "..", "..")
const resultsDir = path.join(benchmarkRoot, "results")
const PALAMEDES_TIMING_MARKER = "__PALAMEDES_TIMINGS__"

const TOOL_LABELS = {
  palamedes: "Palamedes",
  lingui: "Lingui",
  i18next: "i18next-parser",
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const environment = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    generatedAt: new Date().toISOString(),
  }
  const toolPaths = await resolveToolPaths(args)
  const versions = await readVersions(toolPaths)
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-e2e-workflow-"))

  try {
    const profiles = []
    const results = []
    const comparisons = []

    for (const profileName of args.profiles) {
      const corpus = await createWorkflowCorpus({
        profileName,
        rootDir: tempRoot,
        seed: args.seed,
      })
      const validation = await validateCorpus(corpus, toolPaths)
      const profileResults = []

      if (!args.validateOnly) {
        for (const tool of ["palamedes", "lingui", "i18next"]) {
          const measurement = await benchmarkTool({
            tool,
            corpus,
            toolPaths,
            warmup: args.warmup,
            runs: args.runs,
          })
          const result = toResultEntry({ tool, corpus, measurement, versions, args })
          profileResults.push(result)
          results.push(result)
        }

        comparisons.push(...createComparisons(profileName, profileResults))
      }

      profiles.push({
        profile: profileName,
        corpus: summarizeCorpus(corpus),
        validation,
        results: profileResults,
      })
    }

    const report = {
      schemaVersion: 1,
      benchmark: "palamedes-e2e-extract-update-workflow",
      generatedAt: environment.generatedAt,
      machineLocal: true,
      seed: args.seed,
      warmup: args.warmup,
      runs: args.runs,
      validateOnly: args.validateOnly,
      environment,
      versions,
      methodology: {
        scope: "scan sources, extract messages, update catalogs, and write catalog files",
        corpus:
          "same generated logical message inventory rendered into each tool's idiomatic source shape",
        reset:
          "catalog files are reset to the same baseline state before every warmup and measured run",
        semanticCheck:
          "active catalog messages are normalized after each tool run and compared with the generated current inventory",
      },
      profiles,
      results,
      comparisons,
    }

    const outputPaths = await writeOutputs(report)
    printConsoleSummary(report, outputPaths)
  } finally {
    if (!args.keepTemp) {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }
}

function parseArgs(argv) {
  return {
    warmup: readNumberArg(argv, "warmup", 3),
    runs: readNumberArg(argv, "runs", 7),
    seed: readNumberArg(argv, "seed", DEFAULT_SEED),
    profiles: readProfiles(argv),
    validateOnly: argv.includes("--validate-only"),
    keepTemp: argv.includes("--keep-temp"),
    pmdsBin: readStringArg(argv, "pmds-bin", null),
  }
}

function readProfiles(argv) {
  const index = argv.indexOf("--profile")
  if (index === -1) {
    return ["small", "medium"]
  }

  const value = argv[index + 1]
  if (!value || value === "all") {
    return Object.keys(PROFILE_DEFINITIONS)
  }

  return value
    .split(",")
    .map((profile) => profile.trim())
    .filter(Boolean)
}

function readNumberArg(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

function readStringArg(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return argv[index + 1] ?? fallback
}

async function resolveToolPaths(args) {
  const commandSuffix = process.platform === "win32" ? ".cmd" : ""
  const binarySuffix = process.platform === "win32" ? ".exe" : ""
  const paths = {
    palamedes: args.pmdsBin ?? path.join(repoRoot, "target", "release", `pmds${binarySuffix}`),
    lingui: path.join(benchmarkRoot, "node_modules", ".bin", `lingui${commandSuffix}`),
    i18next: path.join(benchmarkRoot, "node_modules", ".bin", `i18next${commandSuffix}`),
  }

  for (const [tool, filename] of Object.entries(paths)) {
    await assertExecutable(tool, filename)
  }

  return paths
}

async function assertExecutable(tool, filename) {
  try {
    await stat(filename)
  } catch {
    throw new Error(
      `Missing ${TOOL_LABELS[tool]} executable at ${filename}. Run the repo-level benchmark script so dependencies and the release pmds binary are available.`
    )
  }
}

async function readVersions(toolPaths) {
  const [linguiCli, i18nextParser, benchmarkPackage, palamedesVersion] = await Promise.all([
    readJson(path.join(benchmarkRoot, "node_modules", "@lingui", "cli", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "i18next-parser", "package.json")),
    readJson(path.join(benchmarkRoot, "package.json")),
    readCommandVersion(toolPaths.palamedes, ["version"]),
  ])

  return {
    benchmarkPackage: benchmarkPackage.name,
    palamedes: {
      cli: palamedesVersion.split(/\r?\n/)[0].trim(),
    },
    lingui: {
      cli: linguiCli.version,
    },
    i18nextParser: {
      cli: i18nextParser.version,
    },
  }
}

async function validateCorpus(corpus, toolPaths) {
  const tools = {}
  const locales = ["en", "de"]

  for (const tool of ["palamedes", "lingui", "i18next"]) {
    await resetCatalogs(corpus.roots[tool])
    await runTool(tool, corpus.roots[tool], toolPaths)
    const activeMessagesByLocale = {}
    for (const locale of locales) {
      const activeMessages = await readActiveMessages(tool, corpus.roots[tool], locale)
      assertMessageSet(
        `${corpus.profileName}/${tool}/${locale}`,
        corpus.currentMessages,
        activeMessages
      )
      activeMessagesByLocale[locale] = activeMessages.length
    }
    tools[tool] = {
      activeMessagesByLocale,
    }
  }

  return {
    expectedActiveMessages: corpus.currentMessages.length,
    tools,
  }
}

async function benchmarkTool({ tool, corpus, toolPaths, warmup, runs }) {
  for (let index = 0; index < warmup; index += 1) {
    await resetCatalogs(corpus.roots[tool])
    await runTool(tool, corpus.roots[tool], toolPaths)
  }

  const samplesMs = []
  const toolTimings = []
  let lastOutcome = null

  for (let index = 0; index < runs; index += 1) {
    await resetCatalogs(corpus.roots[tool])
    const startedAt = process.hrtime.bigint()
    lastOutcome = await runTool(tool, corpus.roots[tool], toolPaths)
    const finishedAt = process.hrtime.bigint()
    samplesMs.push(Number(finishedAt - startedAt) / 1_000_000)
    if (lastOutcome.palamedesTiming) {
      toolTimings.push(lastOutcome.palamedesTiming)
    }
  }

  samplesMs.sort((left, right) => left - right)

  return {
    medianMs: samplesMs[Math.floor(samplesMs.length / 2)],
    samplesMs,
    lastOutcome,
    toolTimings,
  }
}

async function resetCatalogs(rootDir) {
  const localeDir = path.join(rootDir, "src", "locales")
  const baselineDir = path.join(rootDir, ".baseline-locales")
  await rm(localeDir, { recursive: true, force: true })
  await cp(baselineDir, localeDir, { recursive: true })
}

async function runTool(tool, cwd, toolPaths) {
  switch (tool) {
    case "palamedes": {
      const result = await runCommand(
        toolPaths.palamedes,
        ["extract", "--config", "palamedes.yaml"],
        {
          cwd,
          env: { PALAMEDES_TIMING_JSON: "1" },
        }
      )
      return {
        ...result,
        palamedesTiming: parsePalamedesTiming(result.stdout),
      }
    }
    case "lingui": {
      return runCommand(toolPaths.lingui, ["extract", "--config", "lingui.config.mjs"], { cwd })
    }
    case "i18next": {
      return runCommand(toolPaths.i18next, ["--config", "i18next-parser.config.cjs"], { cwd })
    }
    default: {
      throw new Error(`Unknown tool: ${tool}`)
    }
  }
}

async function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `${path.basename(command)} ${args.join(" ")} failed with ${signal ?? code}\n${stdout}\n${stderr}`
          )
        )
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function parsePalamedesTiming(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(PALAMEDES_TIMING_MARKER))

  if (!line) return null
  return JSON.parse(line.slice(PALAMEDES_TIMING_MARKER.length))
}

async function readActiveMessages(tool, rootDir, locale) {
  if (tool === "i18next") {
    const catalog = await readJson(path.join(rootDir, "src", "locales", locale, "translation.json"))
    return Object.keys(catalog).sort()
  }

  const source = await readFile(path.join(rootDir, "src", "locales", `${locale}.po`), "utf8")
  return parsePoMsgids(source).sort()
}

function parsePoMsgids(source) {
  const messages = []
  let obsolete = false

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("#~")) {
      obsolete = true
      continue
    }
    if (line.trim() === "") {
      obsolete = false
      continue
    }
    if (line.startsWith("msgid ") && !obsolete) {
      const value = unquotePo(line.slice("msgid ".length))
      if (value !== "") {
        messages.push(value)
      }
    }
  }

  return messages
}

function unquotePo(value) {
  return JSON.parse(value)
}

function assertMessageSet(label, expectedInput, actualInput) {
  const expected = [...expectedInput].sort()
  const actual = [...actualInput].sort()

  if (expected.length !== actual.length) {
    throw new Error(
      `${label}: expected ${expected.length} active messages, received ${actual.length}`
    )
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new Error(
        `${label}: first active-message mismatch at ${index}: expected ${JSON.stringify(expected[index])}, received ${JSON.stringify(actual[index])}`
      )
    }
  }
}

function toResultEntry({ tool, corpus, measurement, versions, args }) {
  return {
    tool,
    version: toolVersion(tool, versions),
    profile: corpus.profileName,
    fileCount: corpus.fileCount,
    sourceMessageCount: corpus.sourceMessageCount,
    baselineMessageCount: corpus.baselineMessageCount,
    changedCount: corpus.changedCount,
    newCount: corpus.newCount,
    removedCount: corpus.removedCount,
    sourceBytes: corpus.sourceBytes,
    warmup: args.warmup,
    runs: args.runs,
    medianMs: measurement.medianMs,
    rawSamplesMs: measurement.samplesMs,
    stdoutBytes: Buffer.byteLength(measurement.lastOutcome.stdout),
    stderrBytes: Buffer.byteLength(measurement.lastOutcome.stderr),
    palamedesTiming:
      measurement.toolTimings.length > 0
        ? medianPalamedesTiming(measurement.toolTimings)
        : undefined,
  }
}

function toolVersion(tool, versions) {
  if (tool === "palamedes") return versions.palamedes.cli
  if (tool === "lingui") return versions.lingui.cli
  return versions.i18nextParser.cli
}

function medianPalamedesTiming(timings) {
  const fields = ["totalMs", "globMs", "extractMs", "writeMs"]
  const result = {}

  for (const field of fields) {
    const values = timings.map((timing) => timing[field]).sort((left, right) => left - right)
    result[field] = values[Math.floor(values.length / 2)]
  }

  result.totalMessages = timings.at(-1)?.totalMessages
  result.totalFiles = timings.at(-1)?.totalFiles
  return result
}

function createComparisons(profileName, profileResults) {
  const palamedes = profileResults.find((result) => result.tool === "palamedes")

  return profileResults
    .filter((result) => result.tool !== "palamedes")
    .map((result) => {
      const fasterTool = palamedes.medianMs <= result.medianMs ? "palamedes" : result.tool
      return {
        profile: profileName,
        baselineTool: "palamedes",
        comparedTool: result.tool,
        fasterTool,
        palamedesMedianMs: palamedes.medianMs,
        comparedMedianMs: result.medianMs,
        speedupFactor:
          fasterTool === "palamedes"
            ? result.medianMs / palamedes.medianMs
            : palamedes.medianMs / result.medianMs,
      }
    })
}

function summarizeCorpus(corpus) {
  return {
    fileCount: corpus.fileCount,
    messagesPerFile: corpus.messagesPerFile,
    sourceMessageCount: corpus.sourceMessageCount,
    baselineMessageCount: corpus.baselineMessageCount,
    changedCount: corpus.changedCount,
    newCount: corpus.newCount,
    removedCount: corpus.removedCount,
    sourceBytes: corpus.sourceBytes,
  }
}

async function writeOutputs(report) {
  await mkdir(resultsDir, { recursive: true })

  const stamp = report.generatedAt.replaceAll(/[:.]/g, "-")
  const jsonFilename = path.join(resultsDir, `${stamp}.json`)
  const markdownFilename = path.join(resultsDir, `${stamp}.md`)
  const latestJson = path.join(resultsDir, "latest.json")
  const latestMarkdown = path.join(resultsDir, "latest.md")
  const json = JSON.stringify(report, null, 2)
  const markdown = renderMarkdown(report)

  await writeFile(jsonFilename, json, "utf8")
  await writeFile(markdownFilename, markdown, "utf8")

  if (!report.validateOnly) {
    await writeFile(latestJson, json, "utf8")
    await writeFile(latestMarkdown, markdown, "utf8")
  }

  return {
    jsonFilename,
    markdownFilename,
    latestJson: report.validateOnly ? null : latestJson,
    latestMarkdown: report.validateOnly ? null : latestMarkdown,
    primaryJson: report.validateOnly ? jsonFilename : latestJson,
    primaryMarkdown: report.validateOnly ? markdownFilename : latestMarkdown,
  }
}

function renderMarkdown(report) {
  const lines = [
    "# End-to-End Extract and Catalog Update Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    `Node: ${report.environment.nodeVersion}`,
    `Platform: ${report.environment.platform}/${report.environment.arch}`,
    `Seed: ${report.seed}`,
    `Warmup: ${report.warmup}`,
    `Runs: ${report.runs}`,
    `Machine-local: ${report.machineLocal ? "yes" : "no"}`,
    "",
    "## Versions",
    "",
    `- Palamedes CLI: ${report.versions.palamedes.cli}`,
    `- Lingui CLI: ${report.versions.lingui.cli}`,
    `- i18next-parser CLI: ${report.versions.i18nextParser.cli}`,
    "",
    "## Methodology",
    "",
    `- Scope: ${report.methodology.scope}`,
    `- Corpus: ${report.methodology.corpus}`,
    `- Reset: ${report.methodology.reset}`,
    `- Semantic check: ${report.methodology.semanticCheck}`,
  ]

  for (const profile of report.profiles) {
    lines.push("")
    lines.push(`## ${capitalize(profile.profile)}`)
    lines.push("")
    lines.push(
      `- Corpus: ${profile.corpus.fileCount} files, ${profile.corpus.sourceMessageCount} current messages, ${profile.corpus.baselineMessageCount} baseline messages`
    )
    lines.push(
      `- Inventory mix: ${profile.corpus.changedCount} changed, ${profile.corpus.newCount} new, ${profile.corpus.removedCount} removed`
    )
    lines.push(
      `- Semantic validation: ${profile.validation.expectedActiveMessages} active messages per locale and tool`
    )

    if (profile.results.length === 0) {
      lines.push("- Validation-only run. No timings captured.")
      continue
    }

    lines.push("")
    lines.push("| Tool | Median | Samples |")
    lines.push("| --- | ---: | --- |")
    for (const result of profile.results) {
      lines.push(
        `| ${TOOL_LABELS[result.tool]} | ${formatMs(result.medianMs)} | ${result.rawSamplesMs
          .map(formatMs)
          .join(", ")} |`
      )
    }

    const profileComparisons = report.comparisons.filter(
      (comparison) => comparison.profile === profile.profile
    )
    lines.push("")
    lines.push("| Comparison | Faster | Speedup |")
    lines.push("| --- | --- | ---: |")
    for (const comparison of profileComparisons) {
      lines.push(
        `| Palamedes vs ${TOOL_LABELS[comparison.comparedTool]} | ${TOOL_LABELS[comparison.fasterTool]} | ${comparison.speedupFactor.toFixed(2)}x |`
      )
    }
  }

  lines.push("")
  lines.push("## Notes")
  lines.push("")
  lines.push("- These are machine-local CLI workflow timings, not universal cross-machine claims.")
  lines.push(
    "- The i18next-parser corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes."
  )
  lines.push(
    "- The harness reports source-message equivalence after each run instead of assuming every parser extracts the same result."
  )
  lines.push(
    "- Raw samples and Palamedes timing breakdowns are stored in the accompanying JSON output."
  )
  if (report.validateOnly) {
    lines.push(
      "- Validate-only runs write timestamped outputs but do not replace the latest full benchmark result."
    )
  }

  return lines.join("\n")
}

function printConsoleSummary(report, outputPaths) {
  console.log("# End-to-End Extract and Catalog Update Benchmark")
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Results: ${outputPaths.primaryJson}`)

  for (const profile of report.profiles) {
    if (profile.results.length === 0) {
      console.log(`- ${profile.profile}: validation only`)
      continue
    }

    const results = profile.results
      .map((result) => `${TOOL_LABELS[result.tool]} ${formatMs(result.medianMs)}`)
      .join("; ")
    console.log(`- ${profile.profile}: ${results}`)
  }
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"))
}

async function readCommandVersion(command, args) {
  const result = await runCommand(command, args, { cwd: repoRoot })
  return result.stdout
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
