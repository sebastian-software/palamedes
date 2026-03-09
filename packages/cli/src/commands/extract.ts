import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import chalk from "chalk"
import { glob } from "glob"
import { watch } from "chokidar"
import { getConfig, type LinguiConfig, type CatalogConfig } from "@lingui/conf"
import { oxcExtractor } from "@palamedes/extractor"
import type { ExtractedMessage } from "@lingui/conf"
import {
  parsePo,
  stringifyPo,
  catalogToItems,
  itemsToCatalog,
  createDefaultHeaders,
  mergeCatalogs,
  type Catalog,
  type SourceReference,
} from "pofile-ts"

interface ExtractOptions {
  config?: string
  watch?: boolean
  clean?: boolean
  verbose?: boolean
}

export async function extract(options: ExtractOptions): Promise<void> {
  const config = getConfig({ configPath: options.config })

  if (options.verbose) {
    console.log(chalk.gray("Config loaded:"), config.locales)
  }

  if (options.watch) {
    await runWatchMode(config, options)
  } else {
    await runExtraction(config, options)
  }
}

async function runExtraction(config: LinguiConfig, options: ExtractOptions): Promise<void> {
  const startTime = Date.now()
  let totalMessages = 0
  let totalFiles = 0

  for (const catalog of config.catalogs) {
    const { messages, fileCount } = await extractFromCatalog(catalog, config, options)
    totalMessages += Object.keys(messages).length
    totalFiles += fileCount

    // Write catalogs for each locale
    for (const locale of config.locales) {
      await writeCatalog(catalog, locale, messages, config, options)
    }
  }

  const duration = Date.now() - startTime
  console.log(
    chalk.green("✓"),
    `Extracted ${chalk.bold(totalMessages)} messages from ${chalk.bold(totalFiles)} files`,
    chalk.gray(`(${duration}ms)`)
  )
}

async function extractFromCatalog(
  catalog: CatalogConfig,
  config: LinguiConfig,
  options: ExtractOptions
): Promise<{ messages: Catalog; fileCount: number }> {
  const messages: Catalog = {}
  const rootDir = config.rootDir || process.cwd()

  // Get source files - convert directory patterns to glob patterns
  const includePatterns = catalog.include.map((pattern) => {
    const resolved = pattern.replace("<rootDir>", rootDir)
    // If pattern doesn't have glob chars or extension, treat as directory
    if (!resolved.includes("*") && !resolved.includes(".")) {
      return `${resolved}/**/*.{js,jsx,ts,tsx}`
    }
    return resolved
  })
  const excludePatterns = catalog.exclude?.map((pattern) =>
    pattern.replace("<rootDir>", rootDir)
  ) || ["**/node_modules/**"]

  const files = await glob(includePatterns, {
    ignore: excludePatterns,
    absolute: true,
    nodir: true,
  })

  if (options.verbose) {
    console.log(chalk.gray(`Found ${files.length} files to extract from`))
  }

  for (const file of files) {
    try {
      const code = await readFile(file, "utf-8")
      const relativePath = path.relative(rootDir, file)

      await oxcExtractor.extract(
        file,
        code,
        (msg: ExtractedMessage) => {
          // Use explicit ID if provided, otherwise use message as key (standard PO behavior)
          const key = msg.id || msg.message || ""
          if (!key) {
            return
          }

          if (!messages[key]) {
            messages[key] = {
              // For explicit IDs, store the message separately
              // For message-as-key, message field is optional
              message: msg.id ? msg.message : undefined,
              translation: "",
              context: msg.context,
              extractedComments: msg.comment ? [msg.comment] : [],
              origins: [],
            }
          }

          // Add origin
          if (msg.origin) {
            const origin: SourceReference = {
              file: relativePath,
              line: msg.origin[1],
            }
            messages[key].origins = messages[key].origins || []
            messages[key].origins.push(origin)
          }
        },
        { linguiConfig: config }
      )
    } catch (error) {
      if (options.verbose) {
        console.warn(chalk.yellow("Warning:"), `Failed to extract from ${file}:`, error)
      }
    }
  }

  return { messages, fileCount: files.length }
}

async function writeCatalog(
  catalog: CatalogConfig,
  locale: string,
  extractedMessages: Catalog,
  config: LinguiConfig,
  options: ExtractOptions
): Promise<void> {
  const rootDir = config.rootDir || process.cwd()
  const catalogPath = catalog.path
    .replace("<rootDir>", rootDir)
    .replace("{locale}", locale)
  const poPath = `${catalogPath}.po`

  // Load existing catalog if it exists
  let existingCatalog: Catalog = {}
  if (existsSync(poPath)) {
    try {
      const content = await readFile(poPath, "utf-8")
      const poFile = parsePo(content)
      existingCatalog = itemsToCatalog(poFile.items)
    } catch {
      // Ignore parse errors, start fresh
    }
  }

  // Merge: extracted messages take precedence, but preserve translations from existing
  // Note: mergeCatalogs preserves translations from 'updates' (second arg) that match keys in 'base'
  const mergedCatalog = mergeCatalogs(extractedMessages, existingCatalog)

  // If cleaning, remove obsolete entries
  if (options.clean) {
    for (const [id, entry] of Object.entries(mergedCatalog)) {
      if (entry.obsolete) {
        delete mergedCatalog[id]
      }
    }
  }

  // Ensure directory exists
  const dir = path.dirname(poPath)
  await mkdir(dir, { recursive: true })

  // Convert to PO and serialize
  const items = catalogToItems(mergedCatalog, {
    includeOrigins: true,
    includeLineNumbers: true,
  })

  const headers = createDefaultHeaders({
    language: locale,
    generator: "palamedes",
  })

  const content = stringifyPo({ headers, items })
  await writeFile(poPath, content)

  if (options.verbose) {
    console.log(chalk.gray(`  → ${poPath}`))
  }
}

async function runWatchMode(config: LinguiConfig, options: ExtractOptions): Promise<void> {
  console.log(chalk.cyan("Watching for changes..."))

  // Initial extraction
  await runExtraction(config, options)

  // Watch for changes
  const rootDir = config.rootDir || process.cwd()
  const watchPatterns = config.catalogs.flatMap((catalog) =>
    catalog.include.map((pattern) => pattern.replace("<rootDir>", rootDir))
  )

  const watcher = watch(watchPatterns, {
    ignored: ["**/node_modules/**", "**/*.po"],
    persistent: true,
  })

  watcher.on("change", async (file) => {
    console.log(chalk.gray(`File changed: ${file}`))
    await runExtraction(config, options)
  })

  watcher.on("add", async (file) => {
    console.log(chalk.gray(`File added: ${file}`))
    await runExtraction(config, options)
  })

  // Keep process running
  process.on("SIGINT", () => {
    watcher.close()
    process.exit(0)
  })
}
