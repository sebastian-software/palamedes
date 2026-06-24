#!/usr/bin/env node

import { createRequire } from "node:module"

import { program } from "commander"
import chalk from "chalk"
import { audit } from "./commands/audit"
import { mergeCatalog } from "./commands/catalog"
import { extract } from "./commands/extract"
import { report } from "./commands/report"

const require = createRequire(import.meta.url)
const VERSION = require("../package.json").version as string

program.name("pmds").description("Palamedes CLI for fast message extraction").version(VERSION)

program
  .command("extract")
  .description("Extract messages from source files")
  .option("-c, --config <path>", "Path to palamedes.config.ts")
  .option("-w, --watch", "Watch for file changes")
  .option("--clean", "Remove obsolete messages from catalogs")
  .option("-v, --verbose", "Show verbose output")
  .action(async (options) => {
    try {
      await extract(options)
    } catch (error) {
      console.error(chalk.red("Error:"), error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program
  .command("audit")
  .description("Audit catalogs for translation and ICU authoring issues")
  .option("-c, --config <path>", "Path to palamedes.config.ts")
  .option("--locale <locale...>", "Only audit selected target locale(s)")
  .option("--json", "Print the machine-readable audit result as JSON")
  .option("--fail-on <level>", "Fail on error or warning diagnostics", "error")
  .action(async (options) => {
    try {
      await audit(options)
    } catch (error) {
      console.error(chalk.red("Error:"), error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program
  .command("report")
  .description("Report per-locale catalog translation completeness")
  .option("-c, --config <path>", "Path to palamedes.config.ts")
  .option(
    "--locale <locale...>",
    "Only report selected target locale(s); comma-separated values are supported"
  )
  .option("--json", "Print the machine-readable report as JSON")
  .option(
    "--fail-if-below <percent>",
    "Fail when any reported locale is below this translated percentage"
  )
  .action(async (options) => {
    try {
      await report(options)
    } catch (error) {
      console.error(chalk.red("Error:"), error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

const catalog = program.command("catalog").description("Work with Palamedes catalog files")

catalog
  .command("merge")
  .description("Merge two catalog files with semantic use-first behavior")
  .argument("<inputs...>", "Input catalog files in precedence order")
  .requiredOption("--output <path>", "Output catalog path")
  .option("-c, --config <path>", "Path to palamedes.config.ts")
  .option("--format <format>", "Catalog format: po or ndjson")
  .option("--conflict-strategy <strategy>", "Catalog conflict strategy", "use-first")
  .option("--source-locale <locale>", "Source locale for catalog semantics")
  .option("--locale <locale>", "Locale of the merged catalog")
  .action(async (inputs: string[], options) => {
    try {
      await mergeCatalog(inputs, options)
    } catch (error) {
      console.error(chalk.red("Error:"), error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`pmds (Palamedes) v${VERSION}`)
    console.log(chalk.gray("Fast i18n tooling for modern apps"))
  })

program.parse()
