#!/usr/bin/env node

import { program } from "commander"
import chalk from "chalk"
import { audit } from "./commands/audit"
import { extract } from "./commands/extract"

const VERSION = "0.0.1"

program
  .name("pmds")
  .description("Palamedes CLI for fast message extraction")
  .version(VERSION)

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
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`pmds (Palamedes) v${VERSION}`)
    console.log(chalk.gray("Fast i18n tooling for modern apps"))
  })

program.parse()
