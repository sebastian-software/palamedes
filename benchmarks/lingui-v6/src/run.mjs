import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { transformAsync } from "@babel/core"
import linguiMacro from "@lingui/babel-plugin-lingui-macro"
import { createCompiledCatalog } from "@lingui/cli/api"
import {
  extractFromFileWithBabel,
  getBabelParserOptions,
} from "@lingui/cli/api/extractors/babel"
import { makeConfig } from "@lingui/conf"
import { formatter as createPoFormatter } from "@lingui/format-po"
import { transform as transformSwc } from "@swc/core"
import {
  compileCatalogArtifact,
  extractMessagesNative,
  getNativeInfo,
  transformMacrosNative,
} from "@palamedes/core-node"

import {
  createMessageKey,
  createSyntheticProfile,
  DEFAULT_SEED,
  PROFILE_DEFINITIONS,
} from "./corpus.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const benchmarkRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(benchmarkRoot, "..", "..")
const resultsDir = path.join(benchmarkRoot, "results")
const poFormatter = createPoFormatter({ origins: false, lineNumbers: false })
const linguiSwcPluginPath = path.join(
  benchmarkRoot,
  "node_modules",
  "@lingui",
  "swc-plugin",
  "target",
  "wasm32-wasip1",
  "release",
  "lingui_macro_plugin.wasm"
)
const TRACK_LABELS = {
  "macro-transform-babel": "Macro Transform (Babel)",
  "macro-transform-swc": "Macro Transform (SWC)",
  extract: "Extract",
  "compile-from-catalog": "Compile from Catalog",
}
const PALAMEDES_SHARED_MACRO_BASELINE_NOTE =
  "Palamedes has a single native macro transform path, so the same measured baseline is intentionally reported against both Lingui transform lanes."
const EXAMPLE_FIXTURE_FILES = [
  path.join(repoRoot, "benchmarks", "proof-fixtures", "src", "client-app.tsx"),
  path.join(repoRoot, "benchmarks", "proof-fixtures", "src", "client-entry.tsx"),
  path.join(repoRoot, "benchmarks", "proof-fixtures", "src", "server-page.tsx"),
  path.join(repoRoot, "benchmarks", "proof-fixtures", "src", "counter-widget.tsx"),
  path.join(repoRoot, "benchmarks", "proof-fixtures", "src", "locale-switcher.tsx"),
]
const EXAMPLE_COMPILE_TARGETS = [
  {
    name: "ferrocat-first-test",
    rootDir: path.join(repoRoot, "packages", "cli", "src", "commands", "fixtures", "ferrocat-first-test"),
    resourcePath: path.join(
      repoRoot,
      "packages",
      "cli",
      "src",
      "commands",
      "fixtures",
      "ferrocat-first-test",
      "src",
      "locales",
      "de.po"
    ),
    locales: ["en", "de"],
  },
]

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const nativeInfo = getNativeInfo()
  const versions = await readVersions(nativeInfo)
  const environment = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    generatedAt: new Date().toISOString(),
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-lingui-v6-"))

  try {
    const smokeChecks = await runSmokeChecks()
    const profileReports = []
    const flatResults = []
    const comparisons = []

    for (const profileName of args.profiles) {
      const corpus = await createSyntheticProfile({
        profileName,
        rootDir: tempRoot,
        seed: args.seed,
      })
      const linguiConfig = buildLinguiConfig(corpus.rootDir)
      const compileConfig = buildPalamedesCompileConfig(corpus.rootDir, corpus.locales, corpus.sourceLocale)

      const validation = await validateSyntheticProfile(corpus, linguiConfig, compileConfig)

      if (args.validateOnly) {
        profileReports.push({
          profile: profileName,
          corpus: summarizeCorpus(corpus),
          validation,
          tracks: {},
          comparisons: [],
        })
        continue
      }

      const transformPalamedes = await benchmarkTrack(
        () => runPalamedesTransform(corpus),
        args.warmup,
        args.runs
      )
      const transformLinguiBabel = await benchmarkTrack(
        () => runLinguiTransformBabel(corpus, linguiConfig),
        args.warmup,
        args.runs
      )
      const transformLinguiSwc = await benchmarkTrack(
        () => runLinguiTransformSwc(corpus),
        args.warmup,
        args.runs
      )

      const extractPalamedes = await benchmarkTrack(
        () => runPalamedesExtract(corpus),
        args.warmup,
        args.runs
      )
      const extractLingui = await benchmarkTrack(
        () => runLinguiExtract(corpus, linguiConfig),
        args.warmup,
        args.runs
      )

      const compilePalamedes = await benchmarkTrack(
        () => runPalamedesCompile(corpus, compileConfig),
        args.warmup,
        args.runs
      )
      const compileLingui = await benchmarkTrack(
        () => runLinguiCompile(corpus),
        args.warmup,
        args.runs
      )

      const runsForProfile = [
        toResultEntry({
          tool: "palamedes",
          version: versions.palamedes.core,
          engineVersion: versions.palamedes.engine,
          track: "macro-transform-babel",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: transformPalamedes,
          note: PALAMEDES_SHARED_MACRO_BASELINE_NOTE,
        }),
        toResultEntry({
          tool: "lingui",
          version: versions.lingui.babelMacroPlugin,
          engineVersion: versions.tooling.babelCore,
          track: "macro-transform-babel",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: transformLinguiBabel,
        }),
        toResultEntry({
          tool: "palamedes",
          version: versions.palamedes.core,
          engineVersion: versions.palamedes.engine,
          track: "macro-transform-swc",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: transformPalamedes,
          note: PALAMEDES_SHARED_MACRO_BASELINE_NOTE,
        }),
        toResultEntry({
          tool: "lingui",
          version: versions.lingui.swcPlugin,
          engineVersion: versions.tooling.swcCore,
          track: "macro-transform-swc",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: transformLinguiSwc,
        }),
        toResultEntry({
          tool: "palamedes",
          version: versions.palamedes.core,
          engineVersion: versions.palamedes.engine,
          track: "extract",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: extractPalamedes,
        }),
        toResultEntry({
          tool: "lingui",
          version: versions.lingui.cli,
          engineVersion: versions.tooling.babelCore,
          track: "extract",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: extractLingui,
        }),
        toResultEntry({
          tool: "palamedes",
          version: versions.palamedes.core,
          engineVersion: versions.palamedes.engine,
          track: "compile-from-catalog",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: compilePalamedes,
          catalogBytes: corpus.localeFiles.de.bytes,
          locale: "de",
        }),
        toResultEntry({
          tool: "lingui",
          version: versions.lingui.cli,
          engineVersion: versions.lingui.formatPo,
          track: "compile-from-catalog",
          profile: profileName,
          corpus,
          warmup: args.warmup,
          runs: args.runs,
          measurement: compileLingui,
          catalogBytes: corpus.localeFiles.de.bytes,
          locale: "de",
        }),
      ]

      const trackComparisons = [
        createComparison(profileName, "macro-transform-babel", transformPalamedes, transformLinguiBabel),
        createComparison(profileName, "macro-transform-swc", transformPalamedes, transformLinguiSwc),
        createComparison(profileName, "extract", extractPalamedes, extractLingui),
        createComparison(profileName, "compile-from-catalog", compilePalamedes, compileLingui),
      ]

      flatResults.push(...runsForProfile)
      comparisons.push(...trackComparisons)
      profileReports.push({
        profile: profileName,
        corpus: summarizeCorpus(corpus),
        validation,
        tracks: {
          macroTransformBabel: {
            palamedes: summarizeMeasurement(transformPalamedes),
            lingui: summarizeMeasurement(transformLinguiBabel),
          },
          macroTransformSwc: {
            palamedes: summarizeMeasurement(transformPalamedes),
            lingui: summarizeMeasurement(transformLinguiSwc),
          },
          extract: {
            palamedes: summarizeMeasurement(extractPalamedes),
            lingui: summarizeMeasurement(extractLingui),
          },
          compileFromCatalog: {
            palamedes: summarizeMeasurement(compilePalamedes),
            lingui: summarizeMeasurement(compileLingui),
          },
        },
        comparisons: trackComparisons,
      })
    }

    const report = {
      schemaVersion: 2,
      benchmark: "palamedes-vs-lingui-v6-preview",
      generatedAt: environment.generatedAt,
      machineLocal: true,
      seed: args.seed,
      warmup: args.warmup,
      runs: args.runs,
      validateOnly: args.validateOnly,
      environment,
      versions,
      trackDefinitions: createTrackDefinitions(),
      smokeChecks,
      profiles: profileReports,
      results: flatResults,
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
    warmup: readNumberArg(argv, "warmup", 5),
    runs: readNumberArg(argv, "runs", 15),
    seed: readNumberArg(argv, "seed", DEFAULT_SEED),
    profiles: readProfiles(argv),
    validateOnly: argv.includes("--validate-only"),
    keepTemp: argv.includes("--keep-temp"),
  }
}

function readProfiles(argv) {
  const index = argv.indexOf("--profile")
  if (index === -1) {
    return Object.keys(PROFILE_DEFINITIONS)
  }

  const value = argv[index + 1]
  if (!value || value === "all") {
    return Object.keys(PROFILE_DEFINITIONS)
  }

  return value.split(",").map((profile) => profile.trim()).filter(Boolean)
}

function readNumberArg(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) {
    return fallback
  }

  const value = Number(argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

async function readVersions(nativeInfo) {
  const [
    babelCore,
    swcCore,
    linguiCli,
    linguiMacro,
    linguiSwc,
    linguiFormatPo,
    benchmarkPackage,
  ] = await Promise.all([
    readJson(path.join(benchmarkRoot, "node_modules", "@babel", "core", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "@swc", "core", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "@lingui", "cli", "package.json")),
    readJson(
      path.join(
        benchmarkRoot,
        "node_modules",
        "@lingui",
        "babel-plugin-lingui-macro",
        "package.json"
      )
    ),
    readJson(path.join(benchmarkRoot, "node_modules", "@lingui", "swc-plugin", "package.json")),
    readJson(path.join(benchmarkRoot, "node_modules", "@lingui", "format-po", "package.json")),
    readJson(path.join(benchmarkRoot, "package.json")),
  ])

  return {
    benchmarkPackage: benchmarkPackage.name,
    palamedes: {
      engine: nativeInfo.palamedesVersion,
      ferrocat: nativeInfo.ferrocatVersion,
      core: nativeInfo.palamedesVersion,
    },
    tooling: {
      babelCore: babelCore.version,
      swcCore: swcCore.version,
    },
    lingui: {
      cli: linguiCli.version,
      babelMacroPlugin: linguiMacro.version,
      swcPlugin: linguiSwc.version,
      formatPo: linguiFormatPo.version,
    },
  }
}

function buildLinguiConfig(rootDir) {
  return makeConfig(
    {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      format: poFormatter,
      catalogs: [
        {
          path: "src/locales/{locale}",
          include: ["src/generated"],
        },
      ],
    },
    { skipValidation: true }
  )
}

function buildPalamedesCompileConfig(rootDir, locales, sourceLocale) {
  return {
    rootDir,
    locales,
    sourceLocale,
    catalogs: [
      {
        path: "src/locales/{locale}",
        include: ["src/generated"],
      },
    ],
  }
}

function createTrackDefinitions() {
  return [
    {
      track: "macro-transform-babel",
      label: formatTrackLabel("macro-transform-babel"),
      palamedesPath: "single native macro transform path",
      comparatorPath: "Lingui Babel macro plugin",
      note: PALAMEDES_SHARED_MACRO_BASELINE_NOTE,
    },
    {
      track: "macro-transform-swc",
      label: formatTrackLabel("macro-transform-swc"),
      palamedesPath: "single native macro transform path",
      comparatorPath: "Lingui SWC plugin",
      note: PALAMEDES_SHARED_MACRO_BASELINE_NOTE,
    },
    {
      track: "extract",
      label: formatTrackLabel("extract"),
      palamedesPath: "native source extraction",
      comparatorPath: "Lingui Babel extractor",
    },
    {
      track: "compile-from-catalog",
      label: formatTrackLabel("compile-from-catalog"),
      palamedesPath: "catalog artifact assembly",
      comparatorPath: "PO parse plus compiled catalog payload",
    },
  ]
}

async function runSmokeChecks() {
  const config = makeConfig(
    {
      rootDir: repoRoot,
      locales: ["en", "de", "es"],
      sourceLocale: "en",
      catalogs: [
        {
          path: "examples/shared/{locale}",
          include: ["benchmarks/proof-fixtures/src"],
        },
      ],
    },
    { skipValidation: true }
  )

  const files = await Promise.all(
    EXAMPLE_FIXTURE_FILES.map(async (filename) => ({
      filename,
      source: await readFile(filename, "utf8"),
    }))
  )
  const palamedesTransform = await runPalamedesTransform(files)
  const linguiTransformBabel = await runLinguiTransformBabel(files, config)
  const linguiTransformSwc = await runLinguiTransformSwc(files)
  const palamedesExtract = await runPalamedesExtract(files)
  const linguiExtract = await runLinguiExtract(files, config)
  const palamedesKeys = normalizePalamedesMessages(palamedesExtract.messages)
  const linguiKeys = normalizeLinguiMessages(linguiExtract.messages)

  assertKeySetsMatch("example extract", palamedesKeys, linguiKeys)

  const compileTargets = []
  for (const target of EXAMPLE_COMPILE_TARGETS) {
    const palamedesResult = compileCatalogArtifact(
      {
        rootDir: target.rootDir,
        locales: target.locales,
        sourceLocale: "en",
        catalogs: [
          {
            path: "src/locales/{locale}",
            include: ["src"],
          },
        ],
      },
      target.resourcePath
    )
    const linguiResult = await compileLinguiPoFile(target.resourcePath, "de")

    compileTargets.push({
      name: target.name,
      palamedesMessages: Object.keys(palamedesResult.messages).length,
      palamedesDiagnostics: palamedesResult.diagnostics.length,
      linguiMessages: linguiResult.messageCount,
      linguiErrors: linguiResult.errorCount,
    })
  }

  return {
    exampleFileCount: files.length,
    transform: {
      palamedesFiles: palamedesTransform.fileCount,
      linguiBabelFiles: linguiTransformBabel.fileCount,
      linguiSwcFiles: linguiTransformSwc.fileCount,
    },
    extract: {
      palamedesMessages: palamedesKeys.length,
      linguiMessages: linguiKeys.length,
    },
    compile: compileTargets,
  }
}

async function validateSyntheticProfile(corpus, linguiConfig, compileConfig) {
  const transformPalamedes = await runPalamedesTransform(corpus)
  const transformLinguiBabel = await runLinguiTransformBabel(corpus, linguiConfig)
  const transformLinguiSwc = await runLinguiTransformSwc(corpus)

  if (transformPalamedes.fileCount !== corpus.fileCount) {
    throw new Error(`Palamedes transform validated ${transformPalamedes.fileCount} files, expected ${corpus.fileCount}`)
  }
  if (transformLinguiBabel.fileCount !== corpus.fileCount) {
    throw new Error(
      `Lingui Babel transform validated ${transformLinguiBabel.fileCount} files, expected ${corpus.fileCount}`
    )
  }
  if (transformLinguiSwc.fileCount !== corpus.fileCount) {
    throw new Error(
      `Lingui SWC transform validated ${transformLinguiSwc.fileCount} files, expected ${corpus.fileCount}`
    )
  }

  const expectedKeys = corpus.manifest
    .map((entry) => createMessageKey(entry.message, entry.context))
    .sort()
  const palamedesExtract = await runPalamedesExtract(corpus)
  const linguiExtract = await runLinguiExtract(corpus, linguiConfig)
  const palamedesKeys = normalizePalamedesMessages(palamedesExtract.messages)
  const linguiKeys = normalizeLinguiMessages(linguiExtract.messages)

  assertKeySetsMatch(`${corpus.profileName} expected vs palamedes`, expectedKeys, palamedesKeys)
  assertKeySetsMatch(`${corpus.profileName} expected vs lingui`, expectedKeys, linguiKeys)
  assertKeySetsMatch(`${corpus.profileName} palamedes vs lingui`, palamedesKeys, linguiKeys)

  const palamedesCompile = await runPalamedesCompile(corpus, compileConfig)
  const linguiCompile = await runLinguiCompile(corpus)

  if (palamedesCompile.diagnosticCount !== 0) {
    throw new Error(`Palamedes compile reported ${palamedesCompile.diagnosticCount} diagnostics`)
  }
  if (palamedesCompile.messageCount !== corpus.messageCount) {
    throw new Error(
      `Palamedes compile produced ${palamedesCompile.messageCount} messages, expected ${corpus.messageCount}`
    )
  }
  if (linguiCompile.errorCount !== 0) {
    throw new Error(`Lingui compile reported ${linguiCompile.errorCount} errors`)
  }
  if (linguiCompile.messageCount !== corpus.messageCount) {
    throw new Error(
      `Lingui compile produced ${linguiCompile.messageCount} messages, expected ${corpus.messageCount}`
    )
  }

  return {
    transform: {
      palamedesFiles: transformPalamedes.fileCount,
      linguiBabelFiles: transformLinguiBabel.fileCount,
      linguiSwcFiles: transformLinguiSwc.fileCount,
    },
    extract: {
      expectedMessages: expectedKeys.length,
      palamedesMessages: palamedesKeys.length,
      linguiMessages: linguiKeys.length,
    },
    compile: {
      expectedMessages: corpus.messageCount,
      palamedesMessages: palamedesCompile.messageCount,
      linguiMessages: linguiCompile.messageCount,
    },
  }
}

async function benchmarkTrack(fn, warmup, runs) {
  for (let index = 0; index < warmup; index += 1) {
    await fn()
  }

  const samplesMs = []
  let lastOutcome = null

  for (let index = 0; index < runs; index += 1) {
    const startedAt = process.hrtime.bigint()
    lastOutcome = await fn()
    const finishedAt = process.hrtime.bigint()
    samplesMs.push(Number(finishedAt - startedAt) / 1_000_000)
  }

  samplesMs.sort((left, right) => left - right)

  return {
    medianMs: samplesMs[Math.floor(samplesMs.length / 2)],
    samplesMs,
    lastOutcome,
  }
}

async function runPalamedesTransform(corpus) {
  const files = toFileList(corpus)
  let outputBytes = 0

  for (const file of files) {
    const result = transformMacrosNative(file.source, file.filename)
    outputBytes += Buffer.byteLength(result.code)
  }

  return {
    fileCount: files.length,
    outputBytes,
  }
}

async function runLinguiTransformBabel(corpus, linguiConfig) {
  const files = toFileList(corpus)
  let outputBytes = 0

  for (const file of files) {
    const result = await transformAsync(file.source, {
      filename: file.filename,
      babelrc: false,
      configFile: false,
      parserOpts: {
        plugins: getBabelParserOptions(file.filename, linguiConfig.extractorParserOptions),
      },
      plugins: [[linguiMacro, { linguiConfig }]],
      generatorOpts: {
        comments: false,
        compact: true,
        minified: true,
      },
    })

    outputBytes += Buffer.byteLength(result.code ?? "")
  }

  return {
    fileCount: files.length,
    outputBytes,
  }
}

async function runLinguiTransformSwc(corpus) {
  const files = toFileList(corpus)
  let outputBytes = 0

  for (const file of files) {
    const result = await transformSwc(file.source, {
      filename: file.filename,
      swcrc: false,
      sourceMaps: false,
      minify: true,
      module: {
        type: "es6",
      },
      jsc: {
        target: "es2022",
        parser: getSwcParserOptions(file.filename),
        experimental: {
          plugins: [[linguiSwcPluginPath, {}]],
        },
      },
    })

    outputBytes += Buffer.byteLength(result.code ?? "")
  }

  return {
    fileCount: files.length,
    outputBytes,
  }
}

async function runPalamedesExtract(corpus) {
  const files = toFileList(corpus)
  const messages = []

  for (const file of files) {
    messages.push(...extractMessagesNative(file.source, file.filename))
  }

  return {
    fileCount: files.length,
    messages,
  }
}

async function runLinguiExtract(corpus, linguiConfig) {
  const files = toFileList(corpus)
  const messages = []

  for (const file of files) {
    await extractFromFileWithBabel(
      file.filename,
      file.source,
      (message) => messages.push(message),
      { linguiConfig },
      { plugins: getBabelParserOptions(file.filename, linguiConfig.extractorParserOptions) }
    )
  }

  return {
    fileCount: files.length,
    messages,
  }
}

async function runPalamedesCompile(corpus, compileConfig) {
  const result = compileCatalogArtifact(compileConfig, corpus.localeFiles.de.filename)

  return {
    messageCount: Object.keys(result.messages).length,
    diagnosticCount: result.diagnostics.length,
    outputBytes: Buffer.byteLength(JSON.stringify(result.messages)),
  }
}

async function runLinguiCompile(corpus) {
  return compileLinguiPoFile(corpus.localeFiles.de.filename, "de")
}

async function compileLinguiPoFile(filename, locale) {
  const source = await readFile(filename, "utf8")
  const catalog = await poFormatter.parse(source, {
    locale,
    sourceLocale: "en",
    filename,
  })
  const messages = Object.fromEntries(
    Object.entries(catalog).map(([id, entry]) => [id, entry.translation || entry.message || ""])
  )
  const result = createCompiledCatalog(locale, messages, { namespace: "json" })
  const parsed = JSON.parse(result.source)

  return {
    messageCount: Object.keys(parsed.messages ?? {}).length,
    errorCount: result.errors.length,
    outputBytes: Buffer.byteLength(result.source),
  }
}

function normalizePalamedesMessages(messages) {
  return [...new Set(messages.map((message) => createMessageKey(message.message, message.context)))].sort()
}

function normalizeLinguiMessages(messages) {
  return [...new Set(messages.map((message) => createMessageKey(message.message, message.context)))].sort()
}

function assertKeySetsMatch(label, expected, actual) {
  if (expected.length !== actual.length) {
    throw new Error(`${label}: expected ${expected.length} messages, received ${actual.length}`)
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new Error(
        `${label}: first mismatch at index ${index}: expected "${expected[index]}", received "${actual[index]}"`
      )
    }
  }
}

function toResultEntry({
  tool,
  version,
  engineVersion,
  track,
  profile,
  corpus,
  warmup,
  runs,
  measurement,
  catalogBytes,
  locale,
  note,
}) {
  return {
    tool,
    version,
    engineVersion,
    track,
    profile,
    fileCount: corpus.fileCount,
    messageCount: corpus.messageCount,
    sourceBytes: corpus.sourceBytes,
    catalogBytes,
    warmup,
    runs,
    medianMs: measurement.medianMs,
    rawSamplesMs: measurement.samplesMs,
    outputBytes: measurement.lastOutcome?.outputBytes,
    locale,
    note,
  }
}

function createComparison(profile, track, palamedes, lingui) {
  const palamedesMedianMs = palamedes.medianMs
  const linguiMedianMs = lingui.medianMs
  const fasterTool = palamedesMedianMs <= linguiMedianMs ? "palamedes" : "lingui"

  return {
    profile,
    track,
    fasterTool,
    speedupFactor: fasterTool === "palamedes"
      ? linguiMedianMs / palamedesMedianMs
      : palamedesMedianMs / linguiMedianMs,
    palamedesMedianMs,
    linguiMedianMs,
  }
}

function getSwcParserOptions(filename) {
  const extension = path.extname(filename)

  if (extension === ".ts" || extension === ".tsx") {
    return {
      syntax: "typescript",
      tsx: extension === ".tsx",
      decorators: false,
      dynamicImport: true,
    }
  }

  return {
    syntax: "ecmascript",
    jsx: extension === ".jsx" || extension === ".tsx",
    decorators: false,
    dynamicImport: true,
  }
}

function summarizeMeasurement(measurement) {
  return {
    medianMs: measurement.medianMs,
    samplesMs: measurement.samplesMs,
    lastOutcome: summarizeOutcome(measurement.lastOutcome),
  }
}

function summarizeOutcome(outcome) {
  if (!outcome) {
    return null
  }

  const summary = {}

  for (const key of ["fileCount", "messageCount", "diagnosticCount", "errorCount", "outputBytes"]) {
    if (outcome[key] !== undefined) {
      summary[key] = outcome[key]
    }
  }

  if (outcome.messages) {
    summary.messageCount = outcome.messages.length
  }

  return summary
}

function summarizeCorpus(corpus) {
  return {
    fileCount: corpus.fileCount,
    messageCount: corpus.messageCount,
    sourceBytes: corpus.sourceBytes,
    localeBytes: Object.fromEntries(
      Object.entries(corpus.localeFiles).map(([locale, file]) => [locale, file.bytes])
    ),
  }
}

async function writeOutputs(report) {
  await mkdir(resultsDir, { recursive: true })

  const stamp = report.generatedAt.replace(/[:.]/g, "-")
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
    "# Palamedes vs. Lingui v6 Preview Benchmark",
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
    `- Palamedes core: ${report.versions.palamedes.core}`,
    `- Ferrocat: ${report.versions.palamedes.ferrocat}`,
    `- Babel core: ${report.versions.tooling.babelCore}`,
    `- SWC core: ${report.versions.tooling.swcCore}`,
    `- Lingui CLI: ${report.versions.lingui.cli}`,
    `- Lingui Babel macro plugin: ${report.versions.lingui.babelMacroPlugin}`,
    `- Lingui SWC plugin: ${report.versions.lingui.swcPlugin}`,
    `- Lingui format-po: ${report.versions.lingui.formatPo}`,
    "",
    "## Track Definitions",
    "",
  ]

  for (const definition of report.trackDefinitions) {
    lines.push(
      `- ${definition.label}: Palamedes ${definition.palamedesPath}; comparator ${definition.comparatorPath}`
    )
    if (definition.note) {
      lines.push(`  Note: ${definition.note}`)
    }
  }

  lines.push(
    "",
    "## Smoke Checks",
    "",
    `- Example files checked: ${report.smokeChecks.exampleFileCount}`,
    `- Example transform parity: palamedes=${report.smokeChecks.transform.palamedesFiles}, lingui-babel=${report.smokeChecks.transform.linguiBabelFiles}, lingui-swc=${report.smokeChecks.transform.linguiSwcFiles}`,
    `- Example extract parity: ${report.smokeChecks.extract.palamedesMessages} messages`,
    ""
  )

  for (const compileTarget of report.smokeChecks.compile) {
    lines.push(
      `- Example compile ${compileTarget.name}: palamedes=${compileTarget.palamedesMessages} messages, lingui=${compileTarget.linguiMessages} messages`
    )
  }

  for (const profile of report.profiles) {
    lines.push("")
    lines.push(`## ${capitalize(profile.profile)}`)
    lines.push("")
    lines.push(
      `- Corpus: ${profile.corpus.fileCount} files, ${profile.corpus.messageCount} messages, ${profile.corpus.sourceBytes} source bytes`
    )
    lines.push(
      `- Validation: transform palamedes=${profile.validation.transform.palamedesFiles}, lingui-babel=${profile.validation.transform.linguiBabelFiles}, lingui-swc=${profile.validation.transform.linguiSwcFiles}; extract=${profile.validation.extract.expectedMessages}; compile=${profile.validation.compile.expectedMessages}`
    )
    lines.push("")

    if (!profile.comparisons.length) {
      lines.push("Validation-only run. No timings captured.")
      continue
    }

    lines.push("| Track | Palamedes median | Lingui median | Faster | Speedup |")
    lines.push("| --- | ---: | ---: | --- | ---: |")

    for (const comparison of profile.comparisons) {
      lines.push(
        `| ${formatTrackLabel(comparison.track)} | ${formatMs(comparison.palamedesMedianMs)} | ${formatMs(comparison.linguiMedianMs)} | ${comparison.fasterTool} | ${comparison.speedupFactor.toFixed(2)}x |`
      )
    }
  }

  lines.push("")
  lines.push("## Notes")
  lines.push("")
  lines.push(`- ${PALAMEDES_SHARED_MACRO_BASELINE_NOTE}`)
  lines.push("- Results are machine-local and should not be treated as universal cross-machine claims.")
  lines.push("- Build-system integration, watch mode, and catalog update are intentionally excluded from this head-to-head comparison.")
  lines.push("- Raw samples are stored in the accompanying JSON output.")
  if (report.validateOnly) {
    lines.push("- Validate-only runs write timestamped outputs but do not replace the latest full benchmark result.")
  }

  return lines.join("\n")
}

function printConsoleSummary(report, outputPaths) {
  console.log("# Palamedes vs. Lingui v6 Preview")
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Results: ${outputPaths.primaryJson}`)

  for (const profile of report.profiles) {
    if (!profile.comparisons.length) {
      console.log(`- ${profile.profile}: validation only`)
      continue
    }

    for (const comparison of profile.comparisons) {
      console.log(
        `- ${profile.profile} / ${formatTrackLabel(comparison.track)}: palamedes ${formatMs(comparison.palamedesMedianMs)} vs lingui ${formatMs(comparison.linguiMedianMs)} (${comparison.fasterTool} ${comparison.speedupFactor.toFixed(2)}x)`
      )
    }
  }
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function formatTrackLabel(track) {
  return TRACK_LABELS[track] ?? track
}

function toFileList(input) {
  return Array.isArray(input) ? input : input.files
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
