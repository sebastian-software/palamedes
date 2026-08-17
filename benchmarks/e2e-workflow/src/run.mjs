import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { DEFAULT_SEED, PROFILE_DEFINITIONS, createWorkflowCorpus } from "./corpus.mjs"
import { runCommand } from "./exec.mjs"
import { parsePoMsgids } from "./po.mjs"

const __dirname = import.meta.dirname
const benchmarkRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(benchmarkRoot, "..", "..")
const resultsDir = path.join(benchmarkRoot, "results")
const PALAMEDES_TIMING_MARKER = "__PALAMEDES_TIMINGS__"

const TOOL_LABELS = {
  palamedes: "Palamedes",
  lingui: "Lingui",
  formatjs: "React Intl",
  fbtee: "fbtee",
  i18nextCli: "i18next-cli",
  gt: "General Translation",
}

const TOOL_ORDER = ["palamedes", "lingui", "formatjs", "fbtee", "i18nextCli", "gt"]
/*
 * Paths any measured tool may leave behind as reusable or generated state.
 * Only Palamedes writes a reusable cache today. fbtee's collector artifacts
 * are overwritten rather than read, but removing them pins cold runs to the
 * same empty pre-command state instead of leaving an incidental file behind.
 */
const TOOL_STATE_PATHS = [
  ".palamedes",
  ".lingui",
  "node_modules/.cache",
  ".enum_manifest.json",
  "source_strings.json",
]
// Files touched before each warm run, modelling a small edit.
const WARM_TOUCHED_FILES = 5

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
        toolPaths,
      })
      const validation = await validateCorpus(corpus, toolPaths)
      const profileResults = []

      if (!args.validateOnly) {
        for (const tool of TOOL_ORDER) {
          const measurement = await benchmarkTool({
            tool,
            corpus,
            toolPaths,
            warmup: args.warmup,
            runs: args.runs,
          })
          const result = toResultEntry({ tool, corpus, measurement, versions, args })

          const warmMeasurement = await benchmarkToolWarm({
            tool,
            corpus,
            toolPaths,
            warmup: args.warmup,
            runs: args.runs,
          })
          result.warm = {
            medianMs: warmMeasurement.medianMs,
            samplesMs: warmMeasurement.samplesMs,
            touchedFiles: warmMeasurement.touchedFiles,
            palamedesTiming: warmMeasurement.toolTimings.at(-1) ?? null,
          }

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
      schemaVersion: 2,
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
          "catalog files and tool caches are reset to the same baseline state before every cold warmup and measured run",
        semanticCheck:
          "active catalog messages are normalized after each tool run and compared with the generated current inventory",
        toolScopes: {
          formatjs:
            "source scan, extraction, content-hash ID generation, and one aggregated extracted-message JSON write; the React Intl extraction workflow does not update locale translation catalogs, so this lane covers less work than every other lane in the table",
          fbtee:
            "two-command local workflow: fbtee collect scans sources and writes source_strings.json, then fbtee prepare-translations merges/updates existing en/de JSON catalogs; both Node process startups are inside the timed boundary",
          gt: "source scan, extraction, content-hash keying, and merge/update of existing en/de catalogs; gtx-cli generate runs fully locally, seeds new entries with the source text, and drops removed entries immediately instead of marking them obsolete",
          otherTools:
            "source scan, extraction, merge/update of existing en/de catalogs, and catalog writes",
        },
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
    return ["small", "medium", "realistic"]
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
    formatjs: path.join(benchmarkRoot, "node_modules", ".bin", `formatjs${commandSuffix}`),
    fbtee: path.join(benchmarkRoot, "node_modules", ".bin", `fbtee${commandSuffix}`),
    i18nextCli: path.join(benchmarkRoot, "node_modules", ".bin", `i18next-cli${commandSuffix}`),
    gt: path.join(benchmarkRoot, "node_modules", ".bin", `gtx-cli${commandSuffix}`),
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
  const [
    formatjsCli,
    linguiCli,
    fbteeCli,
    fbteeRuntime,
    i18nextCli,
    gtxCli,
    gtReact,
    benchmarkPackage,
    palamedesVersion,
  ] = await Promise.all([
    readJson(path.join(benchmarkRoot, "node_modules", "@formatjs", "cli", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "@lingui", "cli", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "@nkzw", "fbtee-cli", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "fbtee", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "i18next-cli", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "gtx-cli", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "gt-react", "package.json")),
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
    formatjs: {
      cli: formatjsCli.version,
    },
    fbtee: {
      cli: fbteeCli.version,
      runtime: fbteeRuntime.version,
    },
    i18nextCli: {
      cli: i18nextCli.version,
    },
    gt: {
      cli: gtxCli.version,
      react: gtReact.version,
    },
  }
}

async function validateCorpus(corpus, toolPaths) {
  const tools = {}
  for (const tool of TOOL_ORDER) {
    await resetWorkspace(corpus.roots[tool])
    await runTool(tool, corpus.roots[tool], toolPaths)
    const activeMessagesByTarget = {}
    for (const target of validationTargets(tool)) {
      const activeMessages = await readActiveMessages(tool, corpus.roots[tool], target)
      assertMessageSet(
        `${corpus.profileName}/${tool}/${target}`,
        corpus.currentMessages,
        activeMessages
      )
      activeMessagesByTarget[target] = activeMessages.length
    }
    tools[tool] = {
      activeMessagesByTarget,
      ...(tool === "fbtee"
        ? { preservedTranslations: await readFbteePreservedTranslations(corpus) }
        : {}),
      ...(tool === "gt"
        ? { preservedTranslations: await readGtPreservedTranslations(corpus) }
        : {}),
    }
  }

  return {
    expectedActiveMessages: corpus.currentMessages.length,
    tools,
  }
}

async function readFbteePreservedTranslations(corpus) {
  const catalog = await readJson(path.join(corpus.roots.fbtee, "src", "locales", "de.json"))
  const preserved = Object.values(catalog.translations).filter((entry) =>
    entry.translations.some((variation) => variation.translation.startsWith("[de] "))
  ).length
  const expected = corpus.sourceMessageCount - corpus.changedCount - corpus.newCount

  if (preserved !== expected) {
    throw new Error(
      `${corpus.profileName}/fbtee: expected the merge to preserve ${expected} existing translations, found ${preserved}`
    )
  }

  return preserved
}

/*
 * General Translation keys its catalogs by a content hash it computes itself.
 * If that hash ever changes shape, every baseline key stops matching: the merge
 * would reseed each entry with source text, the lane would quietly stop doing
 * the catalog work it is timed against, and the message comparison above would
 * still pass. Counting surviving translations pins that down.
 */
async function readGtPreservedTranslations(corpus) {
  const catalog = await readJson(path.join(corpus.roots.gt, "src", "locales", "de.json"))
  const preserved = Object.values(catalog).filter((value) => value.startsWith("[de] ")).length
  const expected = corpus.sourceMessageCount - corpus.changedCount - corpus.newCount

  if (preserved !== expected) {
    throw new Error(
      `${corpus.profileName}/gt: expected the merge to preserve ${expected} existing translations, found ${preserved}`
    )
  }

  return preserved
}

/*
 * Warm lane: what a repeat run costs after a small edit.
 *
 * The workspace is cleared once, then one run populates whatever reusable state
 * the tool keeps. Every run after that resets only the catalogs and touches a
 * few source files, so each measured run re-does the same small amount of work.
 * Tools without any reusable state simply measure their normal full run here,
 * which is the honest answer for them — this lane reports a capability
 * difference, not a like-for-like speed difference, and its numbers are
 * deliberately kept out of the speedup table.
 */
async function benchmarkToolWarm({ tool, corpus, toolPaths, warmup, runs }) {
  const root = corpus.roots[tool]
  await resetWorkspace(root)
  await runTool(tool, root, toolPaths)

  let touchedFiles = 0
  for (let index = 0; index < warmup; index += 1) {
    await resetCatalogs(root)
    touchedFiles = await touchSources(root, WARM_TOUCHED_FILES)
    await runTool(tool, root, toolPaths)
  }

  const samplesMs = []
  const toolTimings = []
  let lastOutcome = null

  for (let index = 0; index < runs; index += 1) {
    await resetCatalogs(root)
    touchedFiles = await touchSources(root, WARM_TOUCHED_FILES)
    const startedAt = process.hrtime.bigint()
    lastOutcome = await runTool(tool, root, toolPaths)
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
    touchedFiles,
  }
}

async function benchmarkTool({ tool, corpus, toolPaths, warmup, runs }) {
  for (let index = 0; index < warmup; index += 1) {
    await resetWorkspace(corpus.roots[tool])
    await runTool(tool, corpus.roots[tool], toolPaths)
  }

  const samplesMs = []
  const toolTimings = []
  let lastOutcome = null

  for (let index = 0; index < runs; index += 1) {
    await resetWorkspace(corpus.roots[tool])
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

/*
 * Cold runs must start with no reusable state at all. The source corpus is
 * generated once per profile and never changes between runs, so any tool cache
 * left in the workspace would be hit by every run after the first and the
 * reported cold medians would silently become warm ones.
 */
async function resetWorkspace(rootDir) {
  await resetCatalogs(rootDir)
  for (const statePath of TOOL_STATE_PATHS) {
    await rm(path.join(rootDir, statePath), { recursive: true, force: true })
  }
}

/*
 * Models a developer saving files: mtime moves, content does not. That keeps
 * the expected message inventory identical — so the semantic validation still
 * applies — while invalidating exactly the cache entries a real edit would.
 */
async function touchSources(rootDir, count) {
  const generatedDir = path.join(rootDir, "src", "generated")
  const entries = await readdir(generatedDir, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort()
  const now = new Date()
  const touched = files.slice(0, count)
  for (const file of touched) {
    await utimes(file, now, now)
  }
  return touched.length
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
    case "formatjs": {
      return runCommand(
        toolPaths.formatjs,
        [
          "extract",
          "src/generated/**/*.{ts,tsx}",
          "--out-file",
          "src/locales/extracted.json",
          "--id-interpolation-pattern",
          "[sha512:contenthash:base64:6]",
        ],
        { cwd }
      )
    }
    case "fbtee": {
      const collected = await runCommand(
        toolPaths.fbtee,
        [
          "collect",
          "--src",
          "src/generated",
          "--out",
          "source_strings.json",
          "--include-default-strings=false",
          "--disable-babel-config",
        ],
        { cwd }
      )
      const prepared = await runCommand(
        toolPaths.fbtee,
        [
          "prepare-translations",
          "--source-strings",
          "source_strings.json",
          "--output-dir",
          "src/locales",
          "--locales",
          "en",
          "de",
        ],
        { cwd }
      )
      return {
        stdout: `${collected.stdout}${prepared.stdout}`,
        stderr: `${collected.stderr}${prepared.stderr}`,
      }
    }
    case "i18nextCli": {
      return runCommand(
        toolPaths.i18nextCli,
        ["extract", "--config", "i18next.config.mjs", "--sync-all", "--trust-derived", "--quiet"],
        { cwd }
      )
    }
    case "gt": {
      return runCommand(toolPaths.gt, ["generate", "--quiet"], { cwd })
    }
    default: {
      throw new Error(`Unknown tool: ${tool}`)
    }
  }
}

function parsePalamedesTiming(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(PALAMEDES_TIMING_MARKER))

  if (!line) return null
  return JSON.parse(line.slice(PALAMEDES_TIMING_MARKER.length))
}

async function readActiveMessages(tool, rootDir, locale) {
  if (tool === "formatjs") {
    const catalog = await readJson(path.join(rootDir, "src", "locales", "extracted.json"))
    return Object.values(catalog)
      .map((descriptor) => descriptor.defaultMessage)
      .sort()
  }

  if (tool === "i18nextCli") {
    const catalog = await readJson(path.join(rootDir, "src", "locales", locale, "translation.json"))
    return Object.keys(catalog).sort()
  }

  if (tool === "fbtee") {
    const sourceStrings = await readJson(path.join(rootDir, "source_strings.json"))
    const messagesByKey = new Map()
    for (const phrase of sourceStrings.phrases ?? []) {
      for (const [key, leaf] of Object.entries(phrase.hashToLeaf ?? {})) {
        messagesByKey.set(key, leaf.text)
      }
    }
    const catalog = await readJson(path.join(rootDir, "src", "locales", `${locale}.json`))
    return Object.keys(catalog.translations)
      .map((key) => messagesByKey.get(key) ?? `<key ${key} missing from source_strings.json>`)
      .sort()
  }

  /*
   * General Translation catalogs are keyed by content hash, so message identity
   * lives in the source catalog. Target catalogs hold translations under those
   * keys; mapping their keys back through the source catalog yields the message
   * set, which is the same check the PO lanes get from comparing msgids.
   */
  if (tool === "gt") {
    const source = await readJson(path.join(rootDir, "src", "locales", "en.json"))
    if (locale === "en") {
      return Object.values(source).sort()
    }
    const catalog = await readJson(path.join(rootDir, "src", "locales", `${locale}.json`))
    return Object.keys(catalog)
      .map((key) => source[key] ?? `<key ${key} missing from the source catalog>`)
      .sort()
  }

  const source = await readFile(path.join(rootDir, "src", "locales", `${locale}.po`), "utf8")
  return parsePoMsgids(source).sort()
}

function validationTargets(tool) {
  return tool === "formatjs" ? ["source"] : ["en", "de"]
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
  if (tool === "formatjs") return versions.formatjs.cli
  if (tool === "fbtee") return versions.fbtee.cli
  if (tool === "gt") return versions.gt.cli
  return versions.i18nextCli.cli
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
    "# End-to-End Extraction Workflow Benchmark",
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
    `- React Intl extraction CLI (@formatjs/cli): ${report.versions.formatjs.cli}`,
    `- fbtee CLI (@nkzw/fbtee-cli): ${report.versions.fbtee.cli} (corpus authored against fbtee ${report.versions.fbtee.runtime})`,
    `- i18next-cli: ${report.versions.i18nextCli.cli}`,
    `- General Translation CLI (gtx-cli): ${report.versions.gt.cli} (corpus authored against gt-react ${report.versions.gt.react})`,
    "",
    "## Methodology",
    "",
    `- Scope: ${report.methodology.scope}`,
    `- Corpus: ${report.methodology.corpus}`,
    `- Reset: ${report.methodology.reset}`,
    `- Semantic check: ${report.methodology.semanticCheck}`,
    `- React Intl scope: ${report.methodology.toolScopes.formatjs}`,
    `- fbtee scope: ${report.methodology.toolScopes.fbtee}`,
    `- General Translation scope: ${report.methodology.toolScopes.gt}`,
    `- Other tool scope: ${report.methodology.toolScopes.otherTools}`,
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
      `- Semantic validation: ${profile.validation.expectedActiveMessages} active messages per catalog target and tool`
    )

    if (profile.results.length === 0) {
      lines.push("- Validation-only run. No timings captured.")
      continue
    }

    lines.push("")
    lines.push("### Cold")
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

    const warmResults = profile.results.filter((result) => result.warm)
    if (warmResults.length > 0) {
      const touched = warmResults[0].warm.touchedFiles
      lines.push("")
      lines.push("### Warm")
      lines.push("")
      lines.push(
        `Repeat run after touching ${touched} source files, with catalogs reset but tool caches kept.`
      )
      lines.push("")
      lines.push(
        "This lane is **not** a like-for-like speed comparison and is deliberately excluded from the speedup table above. Palamedes reuses an extraction cache here; the other tools re-extract in full because they have no comparable local cache, so their warm and cold numbers are the same by design. Read it as a capability difference, not as a claim that the same work is done faster."
      )
      lines.push("")
      lines.push("| Tool | Median | Samples |")
      lines.push("| --- | ---: | --- |")
      for (const result of warmResults) {
        lines.push(
          `| ${TOOL_LABELS[result.tool]} | ${formatMs(result.warm.medianMs)} | ${result.warm.samplesMs
            .map(formatMs)
            .join(", ")} |`
        )
      }
    }
  }

  lines.push("")
  lines.push("## Notes")
  lines.push("")
  lines.push("- These are machine-local CLI workflow timings, not universal cross-machine claims.")
  lines.push(
    "- Cold runs clear every tool cache alongside the catalogs. The source corpus is generated once per profile and never changes, so a retained cache would be hit by every run after the first and would silently turn the cold medians into warm ones."
  )
  lines.push(
    "- The i18next-cli corpus uses natural-language keys so semantic comparison can normalize active messages; key-based application architectures may have different catalog shapes."
  )
  lines.push(
    "- **React Intl covers less work than every other lane.** `formatjs extract` writes one aggregated extracted-message JSON artifact and never reads or merges a locale catalog, so its median is not comparable to the catalog-update medians around it and must not be read as one."
  )
  lines.push(
    "- The fbtee lane times its official two-command local workflow: `fbtee collect` followed by `fbtee prepare-translations`. It updates en/de JSON catalogs like the full lanes, but pays two Node process startups and drops removed hash entries instead of retaining obsolete catalog history."
  )
  lines.push(
    "- The General Translation lane runs `gtx-cli generate`, which extracts and merges en/de catalogs entirely locally with no API key and no network access. It is General Translation's path for teams handling their own translations; General Translation's default workflow (`gtx-cli translate`) sends content to the General Translation API and is deliberately out of scope here."
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
  console.log("# End-to-End Extraction Workflow Benchmark")
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
