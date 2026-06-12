import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createLargeCatalogFixture } from "../benchmarks/large-catalog/fixture.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const fixtureRoot = path.join(repoRoot, "benchmarks", "proof-fixtures")

const fixtureFiles = [
  path.join(fixtureRoot, "src", "client-app.tsx"),
  path.join(fixtureRoot, "src", "client-entry.tsx"),
  path.join(fixtureRoot, "src", "server-page.tsx"),
  path.join(fixtureRoot, "src", "counter-widget.tsx"),
  path.join(fixtureRoot, "src", "locale-switcher.tsx"),
]

const catalogShape = {
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
}

const coreNode = await import(
  pathToFileURL(path.join(repoRoot, "packages", "core-node", "dist", "index.mjs")).href
)

const {
  compileCatalogArtifact,
  extractMessagesNative,
  getNativeInfo,
  transformMacrosNative,
  updateCatalogFile,
} = coreNode

function parseArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

async function loadFixtures() {
  return Promise.all(
    fixtureFiles.map(async (filename) => ({
      filename,
      source: await readFile(filename, "utf8"),
    }))
  )
}

async function collectMessages(fixtures) {
  const deduped = new Map()

  for (const fixture of fixtures) {
    for (const message of extractMessagesNative(fixture.source, fixture.filename)) {
      const key = `${message.context ?? ""}\u0000${message.message}`
      if (!deduped.has(key)) {
        deduped.set(key, {
          message: message.message,
          context: message.context,
          extractedComments: message.comment ? [message.comment] : [],
          origins: [
            {
              file: message.origin[0],
              line: message.origin[1],
            },
          ],
        })
      }
    }
  }

  return [...deduped.values()]
}

async function benchmark(name, fn, warmup, runs) {
  let peakRssBytes = process.memoryUsage().rss

  for (let i = 0; i < warmup; i += 1) {
    await fn()
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
  }

  const samples = []

  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint()
    await fn()
    const end = process.hrtime.bigint()
    samples.push(Number(end - start) / 1_000_000)
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
  }

  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]

  return {
    name,
    medianMs: median,
    samplesMs: samples,
    peakRssBytes,
  }
}

async function writeCatalogs({ benchmarkLocaleDir, compileResourcePath, messages }) {
  updateCatalogFile({
    targetPath: path.join(benchmarkLocaleDir, "en.po"),
    locale: "en",
    sourceLocale: "en",
    clean: true,
    messages,
  })

  updateCatalogFile({
    targetPath: compileResourcePath,
    locale: "de",
    sourceLocale: "en",
    clean: true,
    messages,
  })
}

function printResults(results) {
  for (const result of results) {
    console.log(
      `- ${result.name}: median ${result.medianMs.toFixed(2)} ms; sampled peak RSS ${formatBytes(result.peakRssBytes)} (${result.samplesMs
        .map((value) => value.toFixed(2))
        .join(", ")})`
    )
  }
}

async function runLargeCatalogBenchmark({
  messageCount,
  sourceFileCount,
  warmup,
  runs,
  tempDir,
}) {
  if (messageCount <= 0) {
    return
  }

  const largeFixture = createLargeCatalogFixture({ messageCount, sourceFileCount })
  const benchmarkRoot = path.join(tempDir, "large-fixture")
  const benchmarkLocaleDir = path.join(benchmarkRoot, "src", "locales")
  const compileResourcePath = path.join(benchmarkLocaleDir, "de.po")
  const updateTargetPath = path.join(tempDir, "de-large-update.po")
  const totalBytes = largeFixture.fixtures.reduce((sum, fixture) => sum + fixture.source.length, 0)

  await mkdir(benchmarkLocaleDir, { recursive: true })
  await writeCatalogs({
    benchmarkLocaleDir,
    compileResourcePath,
    messages: largeFixture.messages,
  })

  const baselineCatalog = await readFile(compileResourcePath, "utf8")
  const catalogConfig = {
    ...catalogShape,
    rootDir: benchmarkRoot,
  }

  const transformResult = await benchmark(
    "large-transform",
    () => {
      for (const fixture of largeFixture.fixtures) {
        transformMacrosNative(fixture.source, fixture.filename)
      }
    },
    warmup,
    runs
  )

  const extractResult = await benchmark(
    "large-extract",
    () => {
      for (const fixture of largeFixture.fixtures) {
        extractMessagesNative(fixture.source, fixture.filename)
      }
    },
    warmup,
    runs
  )

  const updateResult = await benchmark(
    "large-catalog-update",
    async () => {
      await writeFile(updateTargetPath, baselineCatalog, "utf8")
      updateCatalogFile({
        targetPath: updateTargetPath,
        locale: "de",
        sourceLocale: "en",
        clean: false,
        messages: largeFixture.messages,
      })
    },
    warmup,
    runs
  )

  const artifactResult = await benchmark(
    "large-catalog-artifact-compile",
    async () => {
      compileCatalogArtifact(catalogConfig, compileResourcePath)
    },
    warmup,
    runs
  )

  console.log("")
  console.log("## Large Catalog Fixture")
  console.log("")
  console.log(
    `Generated: ${largeFixture.messageCount} messages across ${largeFixture.sourceFileCount} source files, ${totalBytes} source bytes`
  )
  console.log("Fixture generator: benchmarks/large-catalog/fixture.mjs")
  console.log("")
  printResults([
    transformResult,
    extractResult,
    updateResult,
    artifactResult,
  ])
}

async function main() {
  const warmup = parseArg("warmup", 3)
  const runs = parseArg("runs", 7)
  const largeMessages = parseArg("large-messages", 0)
  const largeSourceFiles = parseArg("large-source-files", 20)
  const fixtures = await loadFixtures()
  const messages = await collectMessages(fixtures)
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "palamedes-bench-"))
  const benchmarkRoot = path.join(tempDir, "fixture")
  const benchmarkLocaleDir = path.join(benchmarkRoot, "src", "locales")
  const compileResourcePath = path.join(benchmarkLocaleDir, "de.po")
  const updateTargetPath = path.join(tempDir, "de-update.po")

  await mkdir(benchmarkLocaleDir, { recursive: true })

  await writeCatalogs({
    benchmarkLocaleDir,
    compileResourcePath,
    messages,
  })

  const baselineCatalog = await readFile(compileResourcePath, "utf8")
  const catalogConfig = {
    ...catalogShape,
    rootDir: benchmarkRoot,
  }

  try {
    const transformResult = await benchmark(
      "transform",
      () => {
        for (const fixture of fixtures) {
          transformMacrosNative(fixture.source, fixture.filename)
        }
      },
      warmup,
      runs
    )

    const extractResult = await benchmark(
      "extract",
      () => {
        for (const fixture of fixtures) {
          extractMessagesNative(fixture.source, fixture.filename)
        }
      },
      warmup,
      runs
    )

    const updateResult = await benchmark(
      "catalog-update",
      async () => {
        await writeFile(updateTargetPath, baselineCatalog, "utf8")
        updateCatalogFile({
          targetPath: updateTargetPath,
          locale: "de",
          sourceLocale: "en",
          clean: false,
          messages,
        })
      },
      warmup,
      runs
    )

    const artifactResult = await benchmark(
      "catalog-artifact-compile",
      async () => {
        compileCatalogArtifact(catalogConfig, compileResourcePath)
      },
      warmup,
      runs
    )

    const nativeInfo = getNativeInfo()
    const totalBytes = fixtures.reduce((sum, fixture) => sum + fixture.source.length, 0)

    console.log("# Palamedes Benchmark Proof")
    console.log("")
    console.log(`Node: ${process.version}`)
    console.log(`Platform: ${process.platform}/${process.arch}`)
    console.log(`Palamedes core: ${nativeInfo.palamedesVersion}`)
    console.log(`Ferrocat: ${nativeInfo.ferrocatVersion}`)
    console.log(`Fixtures: ${fixtures.length} files, ${totalBytes} source bytes`)
    console.log(`Catalog messages for update: ${messages.length}`)
    console.log(`Large catalog messages: ${largeMessages > 0 ? largeMessages : "disabled"}`)
    console.log(`Warmup: ${warmup}`)
    console.log(`Runs: ${runs}`)
    console.log("")

    printResults([
      transformResult,
      extractResult,
      updateResult,
      artifactResult,
    ])

    await runLargeCatalogBenchmark({
      messageCount: largeMessages,
      sourceFileCount: largeSourceFiles,
      warmup,
      runs,
      tempDir,
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
