import path from "node:path"
import { access } from "node:fs/promises"
import { constants } from "node:fs"
import createJiti from "jiti"

export const CONFIG_FILENAMES = [
  "palamedes.config.ts",
  "palamedes.config.js",
  "palamedes.config.mjs",
  "palamedes.config.cjs",
] as const

export type PalamedesFallbackLocales = string[] | Record<string, string[]>
export type PalamedesSourceReferenceRoot = "git" | "lingui" | "config" | (string & {})

export type PalamedesCatalogConfig = {
  path: string
  include: string[]
  exclude?: string[]
}

export type PalamedesConfig = {
  locales: string[]
  sourceLocale: string
  fallbackLocales?: PalamedesFallbackLocales
  pseudoLocale?: string
  sourceReferenceRoot?: PalamedesSourceReferenceRoot
  catalogs: PalamedesCatalogConfig[]
}

export type LoadedPalamedesConfig = {
  configPath: string
  rootDir: string
  sourceReferenceRoot: string
} & Omit<PalamedesConfig, "sourceReferenceRoot">

export type LoadPalamedesConfigOptions = {
  cwd?: string
  configPath?: string
  skipValidation?: boolean
}

export function defineConfig(config: PalamedesConfig): PalamedesConfig {
  return config
}

export async function loadPalamedesConfig(
  options: LoadPalamedesConfigOptions = {}
): Promise<LoadedPalamedesConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const configPath = await resolveConfigPath(cwd, options.configPath)
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  })
  const loaded = jiti(configPath) as unknown
  const config = unwrapModule(loaded)

  if (!options.skipValidation) {
    validateConfig(config, configPath)
  }

  return normalizeConfig(config as PalamedesConfig, configPath)
}

export function resolveCatalogPath(
  config: Pick<LoadedPalamedesConfig, "rootDir">,
  catalogPath: string,
  locale: string
): string {
  return path.resolve(config.rootDir, catalogPath.replace("{locale}", locale))
}

export function resolveConfigPattern(
  config: Pick<LoadedPalamedesConfig, "rootDir">,
  pattern: string
): string {
  return path.resolve(config.rootDir, pattern)
}

export function expandFallbackLocales(
  locales: readonly string[],
  fallbackLocales?: PalamedesFallbackLocales
): Record<string, string[]> {
  if (!fallbackLocales) {
    return {}
  }

  if (Array.isArray(fallbackLocales)) {
    return locales.reduce<Record<string, string[]>>((acc, locale) => {
      const chain = fallbackLocales.filter((fallback) => fallback !== locale)
      if (chain.length > 0) {
        acc[locale] = [...chain]
      }
      return acc
    }, {})
  }

  return Object.fromEntries(
    Object.entries(fallbackLocales).map(([locale, chain]) => [
      locale,
      chain.filter((fallback) => fallback !== locale),
    ])
  )
}

async function resolveConfigPath(cwd: string, explicitPath?: string): Promise<string> {
  if (explicitPath) {
    const resolved = path.resolve(cwd, explicitPath)
    await assertFileExists(resolved)
    return resolved
  }

  let current = cwd

  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(current, name)
      if (await fileExists(candidate)) {
        return candidate
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  throw new Error(
    `Could not find a Palamedes config. Expected one of ${CONFIG_FILENAMES.join(", ")}.`
  )
}

function unwrapModule(loaded: unknown): unknown {
  if (
    loaded &&
    typeof loaded === "object" &&
    "default" in loaded &&
    (loaded as { default: unknown }).default !== undefined
  ) {
    return (loaded as { default: unknown }).default
  }

  return loaded
}

async function normalizeConfig(
  config: PalamedesConfig,
  configPath: string
): Promise<LoadedPalamedesConfig> {
  const rootDir = path.dirname(configPath)
  return {
    configPath,
    rootDir,
    locales: [...config.locales],
    sourceLocale: config.sourceLocale,
    ...(config.fallbackLocales !== undefined ? { fallbackLocales: config.fallbackLocales } : {}),
    ...(config.pseudoLocale !== undefined ? { pseudoLocale: config.pseudoLocale } : {}),
    sourceReferenceRoot: await resolveSourceReferenceRoot(config.sourceReferenceRoot, rootDir),
    catalogs: config.catalogs.map((catalog) => ({
      path: catalog.path,
      include: [...catalog.include],
      ...(catalog.exclude ? { exclude: [...catalog.exclude] } : {}),
    })),
  }
}

async function resolveSourceReferenceRoot(
  value: PalamedesSourceReferenceRoot | undefined,
  rootDir: string
): Promise<string> {
  if (value === undefined || value === "git") {
    return (await findGitRoot(rootDir)) ?? rootDir
  }

  if (value === "lingui" || value === "config") {
    return rootDir
  }

  return path.resolve(rootDir, value)
}

async function findGitRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir)

  while (true) {
    if (await fileExists(path.join(current, ".git"))) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

function validateConfig(config: unknown, configPath: string): asserts config is PalamedesConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Invalid Palamedes config in ${configPath}: expected an object export.`)
  }

  const record = config as Record<string, unknown>

  if (
    !Array.isArray(record.locales) ||
    record.locales.some((locale) => typeof locale !== "string")
  ) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "locales" must be an array of strings.`
    )
  }

  if (typeof record.sourceLocale !== "string" || record.sourceLocale.length === 0) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "sourceLocale" must be a non-empty string.`
    )
  }

  if (!record.locales.includes(record.sourceLocale)) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "sourceLocale" must be included in "locales".`
    )
  }

  if (!Array.isArray(record.catalogs)) {
    throw new TypeError(`Invalid Palamedes config in ${configPath}: "catalogs" must be an array.`)
  }

  if (record.pseudoLocale !== undefined && typeof record.pseudoLocale !== "string") {
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "pseudoLocale" must be a string when provided.`
    )
  }

  if (
    record.sourceReferenceRoot !== undefined &&
    (typeof record.sourceReferenceRoot !== "string" || record.sourceReferenceRoot.length === 0)
  ) {
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "sourceReferenceRoot" must be a non-empty string when provided.`
    )
  }

  validateFallbackLocales(record.fallbackLocales, configPath)

  for (const [index, catalog] of record.catalogs.entries()) {
    validateCatalog(catalog, configPath, index)
  }
}

function validateFallbackLocales(value: unknown, configPath: string): void {
  if (value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    if (value.some((locale) => typeof locale !== "string")) {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: "fallbackLocales" arrays must only contain strings.`
      )
    }
    return
  }

  if (value && typeof value === "object") {
    for (const [locale, fallbacks] of Object.entries(value as Record<string, unknown>)) {
      if (!Array.isArray(fallbacks) || fallbacks.some((fallback) => typeof fallback !== "string")) {
        throw new Error(
          `Invalid Palamedes config in ${configPath}: "fallbackLocales.${locale}" must be an array of strings.`
        )
      }
    }
    return
  }

  throw new Error(
    `Invalid Palamedes config in ${configPath}: "fallbackLocales" must be an array of strings or a record of string arrays.`
  )
}

function validateCatalog(catalog: unknown, configPath: string, index: number): void {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}]" must be an object.`
    )
  }

  const record = catalog as Record<string, unknown>

  if (typeof record.path !== "string" || record.path.length === 0) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].path" must be a non-empty string.`
    )
  }

  if (!Array.isArray(record.include) || record.include.some((value) => typeof value !== "string")) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].include" must be an array of strings.`
    )
  }

  if (
    record.exclude !== undefined &&
    (!Array.isArray(record.exclude) || record.exclude.some((value) => typeof value !== "string"))
  ) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].exclude" must be an array of strings when provided.`
    )
  }
}

async function assertFileExists(filePath: string): Promise<void> {
  if (!(await fileExists(filePath))) {
    throw new Error(`Could not find Palamedes config at ${filePath}.`)
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}
