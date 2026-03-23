import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

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
  for (let i = 0; i < warmup; i += 1) {
    await fn()
  }

  const samples = []

  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint()
    await fn()
    const end = process.hrtime.bigint()
    samples.push(Number(end - start) / 1_000_000)
  }

  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]

  return {
    name,
    medianMs: median,
    samplesMs: samples,
  }
}

async function main() {
  const warmup = parseArg("warmup", 3)
  const runs = parseArg("runs", 7)
  const fixtures = await loadFixtures()
  const messages = await collectMessages(fixtures)
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "palamedes-bench-"))
  const benchmarkRoot = path.join(tempDir, "fixture")
  const benchmarkLocaleDir = path.join(benchmarkRoot, "src", "locales")
  const compileResourcePath = path.join(benchmarkLocaleDir, "de.po")
  const updateTargetPath = path.join(tempDir, "de-update.po")

  await mkdir(benchmarkLocaleDir, { recursive: true })

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
    console.log(`Warmup: ${warmup}`)
    console.log(`Runs: ${runs}`)
    console.log("")

    for (const result of [
      transformResult,
      extractResult,
      updateResult,
      artifactResult,
    ]) {
      console.log(
        `- ${result.name}: median ${result.medianMs.toFixed(2)} ms (${result.samplesMs
          .map((value) => value.toFixed(2))
          .join(", ")})`
      )
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
