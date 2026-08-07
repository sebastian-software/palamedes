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

function verifyMergeDriverGuidance(read) {
  const command = "pmds catalog merge-driver %O %A %B %A --path %P --conflict-strategy=use-first"
  const surfaces = ["packages/cli/README.md", "llms.txt", "llms-full.txt"]
  for (const file of surfaces) {
    const text = read(file)
    if (/pmds catalog merge-driver %O %A %B %A --path %P --format(?:=|\s)/u.test(text)) {
      throw new Error(`${file} must not hard-code a merge-driver format`)
    }
    assertContains(text, command, `${file} merge-driver guidance`)
  }
}

export function checkLlmsSurface({ read, listDirectories } = {}) {
  const readFile = read ?? ((file) => readFileSync(path.join(process.cwd(), file), "utf8"))
  verifyPackages(readFile, listDirectories)
  verifyCli(readFile)
  verifyTranslationApi(readFile)
  verifyFeatureNarrative(readFile)
  verifyMergeDriverGuidance(readFile)
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
