import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { performance } from "node:perf_hooks"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../..")

if (process.argv[2] === "--control-worker") {
  const sourceRoot = process.argv[3]
  let findings = 0
  for (const filename of sourceFiles(sourceRoot)) {
    const source = readFileSync(filename, "utf8")
    findings += source.match(/\b(?:t|translate)`[^`]*\$\{[^}]+\}[^`]*`/g)?.length ?? 0
  }
  console.log(findings)
  process.exit(0)
}

const options = parseOptions(process.argv.slice(2))
const directory = mkdtempSync(path.join(tmpdir(), "palamedes-lint-adapter-benchmark-"))

try {
  const sourceRoot = path.join(directory, "src")
  mkdirSync(sourceRoot)
  generateCorpus(sourceRoot, options.files, options.messagesPerFile)

  const pluginPath = path.join(packageRoot, "dist", "index.mjs")
  const eslintConfig = path.join(directory, "eslint.config.mjs")
  const oxlintConfig = path.join(directory, ".oxlintrc.json")
  const palamedesConfig = path.join(directory, "palamedes.yaml")

  writeFileSync(
    palamedesConfig,
    `locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n`
  )
  writeFileSync(
    eslintConfig,
    `import palamedes from ${JSON.stringify(pathToFileURL(pluginPath).href)}\n\nexport default [{\n  files: ["src/**/*.jsx"],\n  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },\n  plugins: { palamedes },\n  rules: {\n    "palamedes/no-placeholder-only-message": "warn",\n    "palamedes/prefer-trans-in-jsx": "warn",\n  },\n}]\n`
  )
  writeFileSync(
    oxlintConfig,
    JSON.stringify({
      categories: { correctness: "off" },
      plugins: [],
      jsPlugins: [{ name: "palamedes", specifier: pluginPath }],
      rules: {
        "palamedes/no-placeholder-only-message": "warn",
        "palamedes/prefer-trans-in-jsx": "warn",
      },
    })
  )

  const require = createRequire(import.meta.url)
  const eslintEntry = require.resolve("eslint")
  const eslintBin = path.resolve(path.dirname(eslintEntry), "../bin/eslint.js")
  const oxlintEntry = require.resolve("oxlint")
  const oxlintBin = path.resolve(path.dirname(oxlintEntry), "../bin/oxlint")
  const pmds = resolvePmds(options.pmds)

  const cases = [
    {
      name: "pmds lint",
      command: pmds,
      coldArgs: ["lint", "--config", palamedesConfig, "--json", "--fail-on", "error", "--no-cache"],
      warmArgs: ["lint", "--config", palamedesConfig, "--json", "--fail-on", "error"],
      seedWarmCache: true,
    },
    {
      name: "ESLint adapter",
      command: process.execPath,
      coldArgs: [eslintBin, "--config", eslintConfig, "--format", "json", "src/**/*.jsx"],
    },
    {
      name: "Oxlint adapter",
      command: process.execPath,
      coldArgs: [
        oxlintBin,
        "--config",
        oxlintConfig,
        "--format",
        "json",
        "--threads",
        "1",
        sourceRoot,
      ],
    },
    {
      name: "parser-free JS lower bound",
      command: process.execPath,
      coldArgs: [fileURLToPath(import.meta.url), "--control-worker", sourceRoot],
    },
  ]

  const rows = []
  for (const benchmarkCase of cases) {
    const cold = runMeasured(benchmarkCase.command, benchmarkCase.coldArgs, directory)
    const warmArgs = benchmarkCase.warmArgs ?? benchmarkCase.coldArgs
    if (benchmarkCase.seedWarmCache) {
      runMeasured(benchmarkCase.command, warmArgs, directory)
    }
    const warm = Array.from({ length: options.runs }, () =>
      runMeasured(benchmarkCase.command, warmArgs, directory)
    )
    rows.push({
      name: benchmarkCase.name,
      coldMs: cold.elapsedMs,
      warmMs: median(warm.map((sample) => sample.elapsedMs)),
      maxRssMb: Math.max(cold.maxRssMb ?? 0, ...warm.map((sample) => sample.maxRssMb ?? 0)),
    })
  }

  console.log(
    `Corpus: ${options.files} JSX files, ${options.messagesPerFile} placeholder-only messages/file (${options.files * options.messagesPerFile} messages)`
  )
  console.log(`Runtime: ${process.version}, ${process.platform}/${process.arch}`)
  console.log(`Warm result: median of ${options.runs} fresh-process runs`)
  console.log("")
  console.log("| Path | Cold wall time | Warm median | Peak RSS |")
  console.log("| --- | ---: | ---: | ---: |")
  for (const row of rows) {
    const rss = row.maxRssMb > 0 ? `${row.maxRssMb.toFixed(1)} MiB` : "n/a"
    console.log(
      `| ${row.name} | ${row.coldMs.toFixed(1)} ms | ${row.warmMs.toFixed(1)} ms | ${rss} |`
    )
  }
  console.log("")
  console.log(
    "Cold is the first process after fixture generation. Warm retains process startup for realistic CLI usage; pmds additionally uses its persistent source-analysis cache."
  )
  console.log(
    "The parser-free JS row only reads files and matches tagged templates. It is a lower bound, not a correctness-equivalent implementation."
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}

function parseOptions(args) {
  const options = { files: 250, messagesPerFile: 8, runs: 5, pmds: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === "--") continue
    if (value === "--files") options.files = positiveInteger(args[++index], value)
    else if (value === "--messages-per-file") {
      options.messagesPerFile = positiveInteger(args[++index], value)
    } else if (value === "--runs") options.runs = positiveInteger(args[++index], value)
    else if (value === "--pmds") options.pmds = path.resolve(args[++index])
    else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

function positiveInteger(value, option) {
  const number = Number.parseInt(value ?? "", 10)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${option} expects a positive integer`)
  }
  return number
}

function generateCorpus(sourceRoot, fileCount, messagesPerFile) {
  for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
    const valueNames = Array.from({ length: messagesPerFile }, (_, index) => `value${index}`)
    const messages = Array.from(
      { length: messagesPerFile },
      (_, messageIndex) => `      <p>{translate\`\${value${messageIndex}}\`}</p>`
    ).join("\n")
    writeFileSync(
      path.join(sourceRoot, `view-${fileIndex}.jsx`),
      `import { t as translate } from "@palamedes/react/macro"\n\nexport function View${fileIndex}({ ${valueNames.join(", ")} }) {\n  return (\n    <section>\n${messages}\n    </section>\n  )\n}\n`
    )
  }
}

function resolvePmds(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.PALAMEDES_CLI,
    path.join(repoRoot, "target", "release", executableName("pmds")),
    path.join(repoRoot, "target", "debug", executableName("pmds")),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      // Try the next local binary candidate.
    }
  }
  throw new Error("No pmds binary found; build it or pass --pmds /absolute/path/to/pmds")
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name
}

function runMeasured(command, args, cwd) {
  const timer = memoryTimer(command, args)
  const startedAt = performance.now()
  let result = spawnSync(timer.command, timer.args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
  let elapsedMs = performance.now() - startedAt
  let maxRssMb = parseMaxRss(result.stderr)
  if (result.status !== 0 && timer.command !== command && maxRssMb === undefined) {
    const fallbackStartedAt = performance.now()
    result = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    })
    elapsedMs = performance.now() - fallbackStartedAt
    maxRssMb = undefined
  }
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed (${result.status ?? result.signal}):\n${result.stdout}\n${result.stderr}`
    )
  }
  return { elapsedMs, maxRssMb }
}

function memoryTimer(command, args) {
  if (process.platform === "darwin") {
    return { command: "/usr/bin/time", args: ["-l", command, ...args] }
  }
  if (process.platform === "linux") {
    return { command: "/usr/bin/time", args: ["-v", command, ...args] }
  }
  return { command, args }
}

function parseMaxRss(stderr) {
  const mac = stderr.match(/(\d+)\s+maximum resident set size/)
  if (mac) return Number(mac[1]) / 1024 / 1024
  const linux = stderr.match(/Maximum resident set size \(kbytes\):\s+(\d+)/)
  if (linux) return Number(linux[1]) / 1024
  return
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(filename) : filename.endsWith(".jsx") ? [filename] : []
  })
}
