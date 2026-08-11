import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  compactCommandInventory,
  compactPackageInventory,
  compactTranslationApiInventory,
  featureNarrative,
  platformPackageParents,
  platformPackageInventory,
  publishedPackageInventory,
  translationApiInventory,
  translationPatchOutcomeInventory,
} from "./llms-surface-contract.mjs"

const commandSources = {
  Extract: {
    command: "pmds extract",
    file: "crates/palamedes-cli/src/commands/extract/mod.rs",
    type: "ExtractOptions",
  },
  Lint: {
    command: "pmds lint",
    file: "crates/palamedes-cli/src/commands/lint.rs",
    type: "LintOptions",
  },
  Audit: {
    command: "pmds audit",
    file: "crates/palamedes-cli/src/commands/audit.rs",
    type: "AuditOptions",
  },
  Report: {
    command: "pmds report",
    file: "crates/palamedes-cli/src/commands/report.rs",
    type: "ReportOptions",
  },
  Catalog: {
    command: "pmds catalog",
    file: "crates/palamedes-cli/src/commands/catalog/mod.rs",
    type: "CatalogCommand",
  },
  Version: { command: "pmds version" },
}

const catalogCommandSources = {
  Merge: {
    command: "pmds catalog merge",
    file: "crates/palamedes-cli/src/commands/catalog/merge.rs",
    type: "MergeOptions",
  },
  MergeDriver: {
    command: "pmds catalog merge-driver",
    file: "crates/palamedes-cli/src/commands/catalog/merge.rs",
    type: "MergeDriverOptions",
  },
  Convert: {
    command: "pmds catalog convert",
    file: "crates/palamedes-cli/src/commands/catalog/convert.rs",
    type: "ConvertOptions",
  },
}

const adrInventory = [
  "001-project-scope-and-positioning",
  "002-rust-first-core-with-thin-host-adapters",
  "003-source-string-first-message-identity",
  "004-internal-compiled-lookup-keys",
  "005-universal-geti18n-runtime-model",
  "006-ferrocat-as-catalog-and-icu-foundation",
  "007-native-boundary-and-distribution",
  "008-framework-adapter-architecture",
  "009-typed-napi-boundary-with-workflow-first-native-operations",
  "010-generated-typescript-types-derived-from-the-native-binding-surface",
  "011-host-adapters-render-module-source-from-compiled-catalog-artifacts",
  "012-translation-augmentation-boundary",
  "013-bounded-parallel-extraction",
  "014-native-transform-source-maps",
  "015-runtime-formatter-subset-diagnostics",
  "016-native-cli-and-yaml-first-configuration",
  "017-cli-plugin-execution-boundary",
  "018-binary-plugin-protocol",
  "019-extraction-cache",
  "020-locale-is-fixed-for-a-browser-document",
  "021-shared-cross-repository-site-ui",
  "022-generated-catalogs-use-executable-message-functions",
  "023-generated-production-runtime-is-parser-free",
  "024-npm-launcher-is-a-packaging-bridge",
  "025-react-router-rsc-entry-request-scope",
]

export function normalize(text) {
  return text.replaceAll(/\s+/gu, " ").trim()
}

function assertContains(text, expected, label) {
  if (!normalize(text).includes(normalize(expected))) {
    throw new Error(`${label} is missing required surface: ${expected}`)
  }
}

function assertSameInventory(actual, expected, label) {
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  if (actualSorted.join("\n") !== expectedSorted.join("\n")) {
    throw new Error(
      `${label} changed; update the intentional LLMS inventory. Expected ${expectedSorted.join(", ")}; found ${actualSorted.join(", ")}`
    )
  }
}

function blockFor(text, startPattern) {
  const start = text.search(startPattern)
  if (start === -1) return ""
  const open = text.indexOf("{", start)
  if (open === -1) return ""
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1
    if (text[index] === "}") {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, index)
    }
  }
  return ""
}

function kebabCase(name) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase()
}

export function discoverClapOptions(source, type) {
  const body = blockFor(source, new RegExp(`pub struct ${type}\\b`, "u"))
  if (!body) throw new Error(`Could not discover Clap options for ${type}`)
  return [...body.matchAll(/#\[arg\(([^\]]*)\)\]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gu)]
    .filter(([, attributes]) => attributes.includes("long"))
    .map((match) => `--${kebabCase(match[2])}`)
}

function discoverEnumVariants(source, enumName) {
  const body = blockFor(source, new RegExp(`(?:pub )?enum ${enumName}\\b`, "u"))
  if (!body) throw new Error(`Could not discover ${enumName}`)
  return [
    ...body.matchAll(
      /^\s*(?:\/\/\/[^\n]*\n\s*)*(?:#\[[^\]]+\]\s*)*([A-Z][A-Za-z0-9_]*)\s*(?:\([^)]*\))?,/gmu
    ),
  ].map(([, variant]) => variant)
}

export function discoverCliInventory(read) {
  const rootCommands = discoverEnumVariants(
    read("crates/palamedes-cli/src/cli.rs"),
    "Command"
  ).filter((variant) => variant !== "Plugin")
  assertSameInventory(rootCommands, Object.keys(commandSources), "Built-in pmds command inventory")

  const commands = rootCommands.map((variant) => {
    const source = commandSources[variant]
    return {
      command: source.command,
      flags: source.file ? discoverClapOptions(read(source.file), source.type) : [],
    }
  })
  const catalogVariants = discoverEnumVariants(
    read("crates/palamedes-cli/src/commands/catalog/mod.rs"),
    "CatalogSubcommand"
  )
  assertSameInventory(
    catalogVariants,
    Object.keys(catalogCommandSources),
    "pmds catalog subcommand inventory"
  )
  for (const variant of catalogVariants) {
    const source = catalogCommandSources[variant]
    commands.push({
      command: source.command,
      flags: discoverClapOptions(read(source.file), source.type),
    })
  }
  return commands
}

export function discoverPublishedPackages(read, listDirectories = () => readdirSync("packages")) {
  const packages = []
  for (const directory of listDirectories()) {
    const manifestPath = `packages/${directory}/package.json`
    try {
      const manifest = JSON.parse(read(manifestPath))
      if (!manifest.private && manifest.name) packages.push({ manifestPath, name: manifest.name })
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  return packages
}

function platformParent(packageName) {
  if (!platformPackageInventory.includes(packageName)) return
  return platformPackageParents.find((parent) => packageName.startsWith(`${parent}-`))
}

export function discoverTranslationApi(source) {
  const names = [
    ...source.matchAll(
      /^export (?:type )?(Translation(?:Candidate|Patch)[A-Za-z0-9_]*)\b|^export function (listTranslationCandidates|applyTranslationPatches)\b/gmu
    ),
  ].map(([, typeName, functionName]) => typeName ?? functionName)
  const outcome = source.match(/export type TranslationPatchOutcomeStatus\s*=\s*([^\n;]+)/u)
  if (!outcome) throw new Error("Could not discover TranslationPatchOutcomeStatus")
  const outcomes = [...outcome[1].matchAll(/"([^"]+)"/gu)].map(([, value]) => value)
  return { names, outcomes }
}

function verifyPackages(read, listDirectories) {
  const packages = discoverPublishedPackages(read, listDirectories)
  const directPackages = packages
    .filter(({ name }) => !platformParent(name))
    .map(({ name }) => name)
  const platformPackages = packages
    .filter(({ name }) => platformParent(name))
    .map(({ name }) => name)
  assertSameInventory(directPackages, publishedPackageInventory, "Published package inventory")
  assertSameInventory(platformPackages, platformPackageInventory, "Platform package inventory")

  for (const { name } of packages) {
    const parent = platformParent(name)
    assertContains(read("llms-full.txt"), parent ?? name, "published packages: llms-full.txt")
  }
  for (const name of compactPackageInventory)
    assertContains(read("llms.txt"), name, "compact package inventory: llms.txt")
}

function verifyCli(read) {
  const commands = discoverCliInventory(read)
  const full = read("llms-full.txt")
  const cliDocs = read("docs/cli.md")
  for (const { command, flags } of commands) {
    assertContains(cliDocs, command, "CLI reference")
    assertContains(full, command, "complete CLI inventory: llms-full.txt")
    for (const flag of flags) {
      assertContains(cliDocs, flag, `CLI reference for ${command}`)
      assertContains(full, flag, `complete CLI option inventory: llms-full.txt`)
    }
  }
  for (const command of compactCommandInventory)
    assertContains(read("llms.txt"), command, "compact CLI inventory: llms.txt")
}

function verifyTranslationApi(read) {
  const { names, outcomes } = discoverTranslationApi(read("packages/core-node/src/index.ts"))
  assertSameInventory(names, translationApiInventory, "Translation candidate/patch API inventory")
  assertSameInventory(
    outcomes,
    translationPatchOutcomeInventory,
    "Translation patch outcome inventory"
  )
  const full = read("llms-full.txt")
  for (const name of names) assertContains(full, name, "translation API inventory: llms-full.txt")
  for (const outcome of outcomes)
    assertContains(full, outcome, "translation patch outcomes: llms-full.txt")
  for (const name of compactTranslationApiInventory) {
    assertContains(read("llms.txt"), name, "compact translation API inventory: llms.txt")
  }
}

function verifyFeatureNarrative(read) {
  const concise = read("llms.txt")
  const full = read("llms-full.txt")
  for (const [feature, terms] of Object.entries(featureNarrative)) {
    for (const document of [concise, full]) {
      for (const term of terms) assertContains(document, term, `${feature} context`)
    }
  }
}

function verifyAdrInventory(read) {
  const full = read("llms-full.txt")
  const adrSection = full.split("ADRs:\n", 2)[1]?.split("## Development commands\n", 2)[0]
  if (!adrSection) throw new Error("llms-full.txt is missing its ADR inventory")
  const documented = [...adrSection.matchAll(/^- `\/adr\/([\w-]+)\.md`$/gmu)].map(
    ([, filename]) => filename
  )
  assertSameInventory(documented, adrInventory, "LLMS ADR inventory")
}

function assertMatches(text, expression, expectedCount, label) {
  const matches = text.match(expression) ?? []
  if (matches.length !== expectedCount) {
    throw new Error(
      `${label} must contain ${expectedCount} matching surface${expectedCount === 1 ? "" : "s"}; found ${matches.length}`
    )
  }
}

function verifyCanonicalQuickstart(read) {
  const compiledRuntime = 'import { createI18n } from "@palamedes/core/compiled"'
  const compiledMessages = 'import type { CompiledCatalogMessages } from "@palamedes/core/compiled"'
  const documentSurfaces = [
    "README.md",
    "docs/first-working-translation.md",
    "llms.txt",
    "llms-full.txt",
    "docs/migrate-from-lingui.md",
  ]

  for (const file of documentSurfaces) {
    const text = read(file)
    assertContains(text, compiledRuntime, `${file} quickstart runtime`)
    assertContains(text, compiledMessages, `${file} quickstart .po declaration`)
  }

  const siteSteps = read("site/app/data/steps.ts")
  assertContains(siteSteps, compiledMessages, "site quickstart .po declaration")
  assertMatches(
    siteSteps,
    /import \{ createI18n \} from "@palamedes\/core\/compiled"/gu,
    4,
    "site quickstart compiled runtime imports"
  )

  for (const [file, text] of [
    ...documentSurfaces.map((file) => [file, read(file)]),
    ["site/app/data/steps.ts", siteSteps],
  ]) {
    if (text.includes('import { createI18n } from "@palamedes/core"')) {
      throw new Error(
        `${file} quickstart must use @palamedes/core/compiled for generated .po catalogs`
      )
    }
  }
}

function codeExamples(text) {
  const fenced = [...text.matchAll(/^```[^\r\n]*\r?\n([\s\S]*?)^```/gmu)].map(([, example]) => ({
    example,
    fenced: true,
  }))
  const withoutFencedExamples = text.replaceAll(/^```[^\r\n]*\r?\n[\s\S]*?^```/gmu, "")
  const inline = [...withoutFencedExamples.matchAll(/`([^`]*)`/gu)].map(([, example]) => ({
    example,
    fenced: false,
  }))
  return [...fenced, ...inline]
}

function hasShellContinuation(line) {
  const trimmed = line.trimEnd()
  let trailingBackslashes = 0
  for (let index = trimmed.length - 1; index >= 0 && trimmed[index] === "\\"; index -= 1) {
    trailingBackslashes += 1
  }
  return trailingBackslashes % 2 === 1
}

function logicalShellCommands(example) {
  const commands = []
  let command = ""
  for (const line of example.split(/\r?\n/u)) {
    const continued = hasShellContinuation(line)
    const part = continued ? line.trimEnd().slice(0, -1) : line
    command = command.length === 0 ? part : `${command} ${part.trimStart()}`
    if (!continued) {
      if (command.trim()) commands.push(command.trim())
      command = ""
    }
  }
  if (command.trim()) commands.push(command.trim())
  return commands
}

function mergeDriverCommands(text) {
  const commands = []
  for (const { example, fenced } of codeExamples(text)) {
    const candidates = fenced ? logicalShellCommands(example) : [example]
    for (const command of candidates) {
      if (!/\bpmds\s+catalog\s+merge-driver\b/u.test(command)) continue
      if (fenced || /(?:^|\s)(?:%[OABP]|--(?:format|path)\b)/u.test(command)) {
        commands.push(command)
      }
    }
  }
  return commands
}

function commandTokens(command) {
  return command.split(/\s+/u).map((token) => token.replace(/^["']+|["']+$/gu, ""))
}

function optionValues(tokens, name) {
  const option = `--${name}`
  const values = []
  for (const [index, token] of tokens.entries()) {
    if (token === option && tokens[index + 1]) values.push(tokens[index + 1])
    if (token.startsWith(`${option}=`)) values.push(token.slice(option.length + 1))
  }
  return values
}

function verifyMergeDriverGuidance(read) {
  const surfaces = ["packages/cli/README.md", "llms.txt", "llms-full.txt"]
  for (const file of surfaces) {
    const commands = mergeDriverCommands(read(file))
    if (commands.length === 0) throw new Error(`${file} is missing merge-driver guidance`)
    for (const command of commands) {
      const tokens = commandTokens(command)
      if (optionValues(tokens, "format").some((value) => /^(po|fcl)$/iu.test(value))) {
        throw new Error(`${file} must not hard-code a merge-driver format`)
      }
      if (optionValues(tokens, "path").every((value) => value !== "%P")) {
        throw new Error(`${file} merge-driver guidance must pass --path %P`)
      }
      const placeholders = tokens.filter((token) => ["%O", "%A", "%B"].includes(token))
      if (placeholders.join(" ") !== "%O %A %B %A") {
        throw new Error(`${file} merge-driver guidance must pass Git placeholders %O %A %B %A`)
      }
    }
  }
}

export function checkLlmsSurface({ read, listDirectories } = {}) {
  const readFile = read ?? ((file) => readFileSync(path.join(process.cwd(), file), "utf8"))
  verifyPackages(readFile, listDirectories)
  verifyCli(readFile)
  verifyTranslationApi(readFile)
  verifyFeatureNarrative(readFile)
  verifyAdrInventory(readFile)
  verifyMergeDriverGuidance(readFile)
  verifyCanonicalQuickstart(readFile)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    checkLlmsSurface()
    console.log("LLMS public-surface inventories are current.")
  } catch (error) {
    console.error(`check-llms-surface: ${error.message}`)
    process.exitCode = 1
  }
}
