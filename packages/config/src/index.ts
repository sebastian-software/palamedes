import path from "node:path"
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { access } from "node:fs/promises"
import createJiti from "jiti"
import picomatch from "picomatch"
import { parse as parseToml } from "smol-toml"
import { parse as parseYaml } from "yaml"

export const CONFIG_FILENAMES = [
  "palamedes.yaml",
  "palamedes.yml",
  "palamedes.json",
  "palamedes.toml",
  "palamedes.config.ts",
  "palamedes.config.js",
  "palamedes.config.mjs",
  "palamedes.config.cjs",
] as const

export type PalamedesFallbackLocales = string[] | Record<string, string[]>
export type PalamedesSourceReferenceRoot = "git" | "lingui" | "config" | (string & {})

export type PalamedesPoOutputOptions = {
  lineBreaks?: "auto" | "off"
}

export type PalamedesCatalogConfig = {
  path: string
  format?: "po" | "fcl"
  po?: PalamedesPoOutputOptions
  include: string[]
  exclude?: string[]
}

export type PalamedesMdxConfig = {
  framework?: "react" | "solid"
  translatableAttributes?: string[]
  frontMatterFields?: string[]
  transModule?: string
  runtimeModule?: string
  ignoreDirective?: string
}

export type PalamedesSourceRuleLevel = "off" | "info" | "warning" | "error"

export type PalamedesLintConfig = {
  rules?: {
    placeholderOnly?: PalamedesSourceRuleLevel
    emptyComponentOnly?: PalamedesSourceRuleLevel
    preferTransInJsx?: PalamedesSourceRuleLevel
  }
}

export type PalamedesPluginDeclaration = string | readonly [specifier: string, options: unknown]

export type PalamedesConfig = {
  locales: string[]
  sourceLocale: string
  fallbackLocales?: PalamedesFallbackLocales
  pseudoLocale?: string
  sourceReferenceRoot?: PalamedesSourceReferenceRoot
  referenceScopes?: boolean
  mdx?: PalamedesMdxConfig
  lint?: PalamedesLintConfig
  catalogs: PalamedesCatalogConfig[]
  plugins?: PalamedesPluginDeclaration[]
}

type PalamedesDataConfig = {
  locales?: unknown
  "source-locale"?: unknown
  source_locale?: unknown
  "fallback-locales"?: unknown
  fallback_locales?: unknown
  "pseudo-locale"?: unknown
  pseudo_locale?: unknown
  "source-reference-root"?: unknown
  source_reference_root?: unknown
  "reference-scopes"?: unknown
  reference_scopes?: unknown
  mdx?: unknown
  lint?: unknown
  catalogs?: unknown
  plugins?: unknown
}

export type LoadedPalamedesConfig = {
  configPath: string
  rootDir: string
  sourceReferenceRoot: string
  referenceScopes: boolean
} & Omit<PalamedesConfig, "sourceReferenceRoot" | "referenceScopes">

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
  const config = await loadConfigFile(configPath)

  if (!options.skipValidation) {
    validateConfig(config, configPath)
  }

  return normalizeConfig(config as PalamedesConfig, configPath)
}

export function loadPalamedesConfigSync(
  options: LoadPalamedesConfigOptions = {}
): LoadedPalamedesConfig {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const configPath = resolveConfigPathSync(cwd, options.configPath)
  const config = loadConfigFileSync(configPath)

  if (!options.skipValidation) {
    validateConfig(config, configPath)
  }

  return normalizeConfigSync(config as PalamedesConfig, configPath)
}

async function loadConfigFile(configPath: string): Promise<unknown> {
  if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
    return normalizeDataConfig(
      parseYaml(await readFile(configPath, "utf8")) as PalamedesDataConfig,
      configPath
    )
  }

  if (configPath.endsWith(".json")) {
    return normalizeDataConfig(
      JSON.parse(await readFile(configPath, "utf8")) as PalamedesDataConfig,
      configPath
    )
  }

  if (configPath.endsWith(".toml")) {
    return normalizeDataConfig(
      parseToml(await readFile(configPath, "utf8")) as PalamedesDataConfig,
      configPath
    )
  }

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  })
  return unwrapModule(jiti(configPath) as unknown)
}

function loadConfigFileSync(configPath: string): unknown {
  if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
    return normalizeDataConfig(
      parseYaml(readFileSync(configPath, "utf8")) as PalamedesDataConfig,
      configPath
    )
  }

  if (configPath.endsWith(".json")) {
    return normalizeDataConfig(
      JSON.parse(readFileSync(configPath, "utf8")) as PalamedesDataConfig,
      configPath
    )
  }

  if (configPath.endsWith(".toml")) {
    return normalizeDataConfig(
      parseToml(readFileSync(configPath, "utf8")) as PalamedesDataConfig,
      configPath
    )
  }

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  })
  return unwrapModule(jiti(configPath) as unknown)
}

const CAMEL_CASE_DATA_KEYS: [string, string][] = [
  ["sourceLocale", "source-locale"],
  ["fallbackLocales", "fallback-locales"],
  ["pseudoLocale", "pseudo-locale"],
  ["sourceReferenceRoot", "source-reference-root"],
  ["referenceScopes", "reference-scopes"],
]

/*
 * Data configs are kebab-case (with snake_case aliases). Lingui-style
 * camelCase spellings of known keys used to be dropped silently — changing
 * pseudo-locale exclusion, fallback chains, and origin-path style without a
 * trace. Reject them with a hint instead.
 */
function rejectCamelCaseDataKeys(config: PalamedesDataConfig, configPath: string): void {
  for (const [camel, kebab] of CAMEL_CASE_DATA_KEYS) {
    if (camel in config) {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: unknown key "${camel}". Data configs use kebab-case: "${kebab}".`
      )
    }
  }
}

function normalizeDataConfig(config: PalamedesDataConfig, configPath: string): PalamedesConfig {
  rejectCamelCaseDataKeys(config, configPath)
  const fallbackLocales = getConfigValue(config, "fallback-locales", "fallback_locales")
  const pseudoLocale = getConfigValue(config, "pseudo-locale", "pseudo_locale")
  const sourceReferenceRoot = getConfigValue(
    config,
    "source-reference-root",
    "source_reference_root"
  )
  const referenceScopes = getConfigValue(config, "reference-scopes", "reference_scopes")
  const mdx = config.mdx === undefined ? undefined : normalizeMdxDataConfig(config.mdx, configPath)
  const lint =
    config.lint === undefined ? undefined : normalizeLintDataConfig(config.lint, configPath)

  return {
    locales: config.locales as string[],
    sourceLocale: getConfigValue(config, "source-locale", "source_locale") as string,
    ...(fallbackLocales !== undefined
      ? { fallbackLocales: fallbackLocales as PalamedesFallbackLocales }
      : {}),
    ...(pseudoLocale !== undefined ? { pseudoLocale: pseudoLocale as string } : {}),
    ...(sourceReferenceRoot !== undefined
      ? { sourceReferenceRoot: sourceReferenceRoot as PalamedesSourceReferenceRoot }
      : {}),
    ...(referenceScopes !== undefined ? { referenceScopes: referenceScopes as boolean } : {}),
    ...(mdx !== undefined ? { mdx } : {}),
    ...(lint !== undefined ? { lint } : {}),
    catalogs: normalizeDataCatalogs(config.catalogs, configPath) as PalamedesCatalogConfig[],
    ...(config.plugins !== undefined
      ? { plugins: config.plugins as PalamedesPluginDeclaration[] }
      : {}),
  }
}

function normalizeDataCatalogs(value: unknown, configPath: string): unknown {
  if (!Array.isArray(value)) {
    return value
  }
  return value.map((catalog, index) => {
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
      return catalog
    }
    const record = catalog as Record<string, unknown>
    if (record.po === undefined) {
      return catalog
    }
    return {
      ...record,
      po: normalizePoDataConfig(record.po, configPath, index),
    }
  })
}

function normalizePoDataConfig(
  value: unknown,
  configPath: string,
  catalogIndex: number
): PalamedesPoOutputOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value as PalamedesPoOutputOptions
  }
  const record = value as Record<string, unknown>
  for (const [camel, kebab] of [["lineBreaks", "line-breaks"]]) {
    if (camel in record) {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: unknown key "catalogs[${catalogIndex}].po.${camel}". Data configs use kebab-case: "catalogs[${catalogIndex}].po.${kebab}".`
      )
    }
  }
  const knownKeys = new Set(["line-breaks", "line_breaks"])
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: unknown key "catalogs[${catalogIndex}].po.${key}".`
      )
    }
  }
  const lineBreaks = record["line-breaks"] ?? record.line_breaks
  return lineBreaks === undefined ? {} : { lineBreaks: normalizeLineBreaksDataValue(lineBreaks) }
}

/*
 * YAML 1.1 parsers read a bare `off` as the boolean `false`. The `yaml` package
 * follows YAML 1.2 and keeps it a string, but TOML and JSON configs can carry a
 * real boolean here, and so can any 1.1 tooling upstream of us. Map it back
 * rather than reporting "must be \"auto\" or \"off\"" for a config that reads
 * exactly like the documented one.
 */
function normalizeLineBreaksDataValue(value: unknown): PalamedesPoOutputOptions["lineBreaks"] {
  if (value === false) {
    return "off"
  }
  return value as PalamedesPoOutputOptions["lineBreaks"]
}

function normalizeMdxDataConfig(value: unknown, configPath: string): PalamedesMdxConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid Palamedes config in ${configPath}: "mdx" must be an object.`)
  }
  const record = value as Record<string, unknown>
  for (const [camel, kebab] of [
    ["translatableAttributes", "translatable-attributes"],
    ["frontMatterFields", "front-matter-fields"],
    ["transModule", "trans-module"],
    ["runtimeModule", "runtime-module"],
    ["ignoreDirective", "ignore-directive"],
  ]) {
    if (camel in record) {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: unknown key "mdx.${camel}". Data configs use kebab-case: "mdx.${kebab}".`
      )
    }
  }
  const read = (kebab: string, snake: string) => record[kebab] ?? record[snake]
  const framework = record.framework
  const translatableAttributes = read("translatable-attributes", "translatable_attributes")
  const frontMatterFields = read("front-matter-fields", "front_matter_fields")
  const transModule = read("trans-module", "trans_module")
  const runtimeModule = read("runtime-module", "runtime_module")
  const ignoreDirective = read("ignore-directive", "ignore_directive")

  return {
    ...(framework !== undefined ? { framework: framework as "react" | "solid" } : {}),
    ...(translatableAttributes !== undefined
      ? { translatableAttributes: translatableAttributes as string[] }
      : {}),
    ...(frontMatterFields !== undefined
      ? { frontMatterFields: frontMatterFields as string[] }
      : {}),
    ...(transModule !== undefined ? { transModule: transModule as string } : {}),
    ...(runtimeModule !== undefined ? { runtimeModule: runtimeModule as string } : {}),
    ...(ignoreDirective !== undefined ? { ignoreDirective: ignoreDirective as string } : {}),
  }
}

function normalizeLintDataConfig(value: unknown, configPath: string): PalamedesLintConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid Palamedes config in ${configPath}: "lint" must be an object.`)
  }
  const lint = value as Record<string, unknown>
  const rules = lint.rules
  if (rules === undefined) {
    return {}
  }
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "lint.rules" must be an object.`
    )
  }
  const record = rules as Record<string, unknown>
  for (const [camel, kebab] of [
    ["placeholderOnly", "placeholder-only"],
    ["emptyComponentOnly", "empty-component-only"],
    ["preferTransInJsx", "prefer-trans-in-jsx"],
  ]) {
    if (camel in record) {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: unknown key "lint.rules.${camel}". Data configs use kebab-case: "lint.rules.${kebab}".`
      )
    }
  }
  return {
    rules: {
      ...(record["placeholder-only"] !== undefined
        ? { placeholderOnly: record["placeholder-only"] as PalamedesSourceRuleLevel }
        : {}),
      ...(record["empty-component-only"] !== undefined
        ? { emptyComponentOnly: record["empty-component-only"] as PalamedesSourceRuleLevel }
        : {}),
      ...(record["prefer-trans-in-jsx"] !== undefined
        ? { preferTransInJsx: record["prefer-trans-in-jsx"] as PalamedesSourceRuleLevel }
        : {}),
    },
  }
}

function getConfigValue(
  config: PalamedesDataConfig,
  canonicalKey: keyof PalamedesDataConfig,
  legacyKey: keyof PalamedesDataConfig
): unknown {
  return config[canonicalKey] ?? config[legacyKey]
}

export function resolveCatalogPath(
  config: Pick<LoadedPalamedesConfig, "rootDir">,
  catalogPath: string,
  locale: string
): string {
  // Every placeholder occurrence, matching the Rust resolver's `str::replace`
  // and the Next loader; a path may name the locale in a directory and a file.
  return path.resolve(config.rootDir, catalogPath.replaceAll("{locale}", locale))
}

export function resolveConfigPattern(
  config: Pick<LoadedPalamedesConfig, "rootDir">,
  pattern: string
): string {
  return path.resolve(config.rootDir, pattern)
}

function canonicalCatalogPath(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

function normalizeCatalogPath(value: string): string {
  return value.replaceAll("\\", "/")
}

function catalogSourcePattern(
  rootDir: string,
  pattern: string,
  expandBareDirectory: boolean
): string {
  const absolute = path.resolve(rootDir, pattern)
  if (expandBareDirectory) {
    try {
      if (statSync(absolute).isDirectory()) {
        return `${normalizeCatalogPath(absolute)}/**/*.{js,jsx,ts,tsx,mdx}`
      }
    } catch {
      // Keep non-existent paths and explicit glob patterns unchanged.
    }
  }
  return normalizeCatalogPath(absolute)
}

/**
 * Whether a source file belongs to a configured catalog.
 *
 * This is shared by the Vite and Next integrations. Dot-prefixed source path
 * segments intentionally match, matching Vite's historic filter behaviour.
 */
export function catalogMatchesSource(
  config: Pick<LoadedPalamedesConfig, "rootDir">,
  catalog: PalamedesCatalogConfig,
  sourcePath: string
): boolean {
  const rootDir = canonicalCatalogPath(config.rootDir)
  const source = normalizeCatalogPath(canonicalCatalogPath(sourcePath))
  const include = catalog.include.map((pattern) => catalogSourcePattern(rootDir, pattern, true))
  const exclude = (catalog.exclude ?? ["**/node_modules/**"]).map((pattern) =>
    catalogSourcePattern(rootDir, pattern, false)
  )
  const options = { dot: true }

  return (
    include.some((pattern) => picomatch.isMatch(source, pattern, options)) &&
    !exclude.some((pattern) => picomatch.isMatch(source, pattern, options))
  )
}

/** Resolve a configured catalog to its locale-specific on-disk resource path. */
export function catalogResourcePath(
  config: Pick<LoadedPalamedesConfig, "rootDir">,
  catalog: PalamedesCatalogConfig,
  locale: string
): string {
  const extension = catalog.format ?? "po"
  const configuredPath = resolveCatalogPath(config, catalog.path, locale)
  const parsed = path.parse(configuredPath)
  return path.format({ dir: parsed.dir, name: parsed.name, ext: `.${extension}` })
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

function resolveConfigPathSync(cwd: string, explicitPath?: string): string {
  if (explicitPath) {
    const resolved = path.resolve(cwd, explicitPath)
    assertFileExistsSync(resolved)
    return resolved
  }

  let current = cwd

  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(current, name)
      if (fileExistsSync(candidate)) {
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
    referenceScopes: config.referenceScopes ?? true,
    ...(config.mdx ? { mdx: cloneMdxConfig(config.mdx) } : {}),
    ...(config.lint ? { lint: cloneLintConfig(config.lint) } : {}),
    catalogs: config.catalogs.map((catalog) => ({
      path: catalog.path,
      ...(catalog.format !== undefined ? { format: catalog.format } : {}),
      ...(catalog.po !== undefined ? { po: { ...catalog.po } } : {}),
      include: [...catalog.include],
      ...(catalog.exclude ? { exclude: [...catalog.exclude] } : {}),
    })),
    ...(config.plugins ? { plugins: clonePluginDeclarations(config.plugins) } : {}),
  }
}

function normalizeConfigSync(config: PalamedesConfig, configPath: string): LoadedPalamedesConfig {
  const rootDir = path.dirname(configPath)
  return {
    configPath,
    rootDir,
    locales: [...config.locales],
    sourceLocale: config.sourceLocale,
    ...(config.fallbackLocales !== undefined ? { fallbackLocales: config.fallbackLocales } : {}),
    ...(config.pseudoLocale !== undefined ? { pseudoLocale: config.pseudoLocale } : {}),
    sourceReferenceRoot: resolveSourceReferenceRootSync(config.sourceReferenceRoot, rootDir),
    referenceScopes: config.referenceScopes ?? true,
    ...(config.mdx ? { mdx: cloneMdxConfig(config.mdx) } : {}),
    ...(config.lint ? { lint: cloneLintConfig(config.lint) } : {}),
    catalogs: config.catalogs.map((catalog) => ({
      path: catalog.path,
      ...(catalog.format !== undefined ? { format: catalog.format } : {}),
      ...(catalog.po !== undefined ? { po: { ...catalog.po } } : {}),
      include: [...catalog.include],
      ...(catalog.exclude ? { exclude: [...catalog.exclude] } : {}),
    })),
    ...(config.plugins ? { plugins: clonePluginDeclarations(config.plugins) } : {}),
  }
}

function cloneMdxConfig(config: PalamedesMdxConfig): PalamedesMdxConfig {
  return {
    ...config,
    ...(config.translatableAttributes
      ? { translatableAttributes: [...config.translatableAttributes] }
      : {}),
    ...(config.frontMatterFields ? { frontMatterFields: [...config.frontMatterFields] } : {}),
  }
}

function cloneLintConfig(config: PalamedesLintConfig): PalamedesLintConfig {
  return {
    ...config,
    ...(config.rules ? { rules: { ...config.rules } } : {}),
  }
}

function clonePluginDeclarations(
  plugins: readonly PalamedesPluginDeclaration[]
): PalamedesPluginDeclaration[] {
  return plugins.map((plugin) => (typeof plugin === "string" ? plugin : [plugin[0], plugin[1]]))
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

function resolveSourceReferenceRootSync(
  value: PalamedesSourceReferenceRoot | undefined,
  rootDir: string
): string {
  if (value === undefined || value === "git") {
    return findGitRootSync(rootDir) ?? rootDir
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

function findGitRootSync(startDir: string): string | undefined {
  let current = path.resolve(startDir)

  while (true) {
    if (fileExistsSync(path.join(current, ".git"))) {
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

  // Documented behavior: a pseudo-locale outside `locales` is ignored. Make
  // the ignore visible instead of silent.
  if (typeof record.pseudoLocale === "string" && !record.locales.includes(record.pseudoLocale)) {
    console.warn(
      `Palamedes config ${configPath}: "pseudoLocale" (${record.pseudoLocale}) is not included in "locales" and will be ignored.`
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

  if (record.referenceScopes !== undefined && typeof record.referenceScopes !== "boolean") {
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "referenceScopes" must be a boolean when provided.`
    )
  }

  validateMdx(record.mdx, configPath)
  validateLint(record.lint, configPath)
  validateFallbackLocales(record.fallbackLocales, configPath, record.locales as string[])
  validatePlugins(record.plugins, configPath)

  for (const [index, catalog] of record.catalogs.entries()) {
    validateCatalog(catalog, configPath, index)
  }
}

function validateMdx(value: unknown, configPath: string): void {
  if (value === undefined) {
    return
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid Palamedes config in ${configPath}: "mdx" must be an object.`)
  }
  const record = value as Record<string, unknown>
  if (
    record.framework !== undefined &&
    record.framework !== "react" &&
    record.framework !== "solid"
  ) {
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "mdx.framework" must be "react" or "solid".`
    )
  }
  for (const field of ["translatableAttributes", "frontMatterFields"] as const) {
    const values = record[field]
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.some((entry) => typeof entry !== "string" || entry.trim().length === 0))
    ) {
      throw new TypeError(
        `Invalid Palamedes config in ${configPath}: "mdx.${field}" must be an array of non-empty strings.`
      )
    }
  }
  for (const field of ["transModule", "runtimeModule", "ignoreDirective"] as const) {
    const fieldValue = record[field]
    if (
      fieldValue !== undefined &&
      (typeof fieldValue !== "string" || fieldValue.trim().length === 0)
    ) {
      throw new TypeError(
        `Invalid Palamedes config in ${configPath}: "mdx.${field}" must be a non-empty string.`
      )
    }
  }
}

function validateLint(value: unknown, configPath: string): void {
  if (value === undefined) {
    return
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid Palamedes config in ${configPath}: "lint" must be an object.`)
  }
  const rules = (value as Record<string, unknown>).rules
  if (rules === undefined) {
    return
  }
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "lint.rules" must be an object.`
    )
  }
  const record = rules as Record<string, unknown>
  for (const field of ["placeholderOnly", "emptyComponentOnly", "preferTransInJsx"] as const) {
    const level = record[field]
    if (level !== undefined && !["off", "info", "warning", "error"].includes(level as string)) {
      throw new TypeError(
        `Invalid Palamedes config in ${configPath}: "lint.rules.${field}" must be "off", "info", "warning", or "error".`
      )
    }
  }
}

function validatePlugins(value: unknown, configPath: string): void {
  if (value === undefined) {
    return
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`Invalid Palamedes config in ${configPath}: "plugins" must be an array.`)
  }

  for (const [index, declaration] of value.entries()) {
    if (typeof declaration === "string" && declaration.trim().length > 0) {
      continue
    }
    if (
      Array.isArray(declaration) &&
      declaration.length === 2 &&
      typeof declaration[0] === "string" &&
      declaration[0].trim().length > 0
    ) {
      continue
    }
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "plugins[${index}]" must be a non-empty package specifier or [specifier, options].`
    )
  }
}

function validateFallbackLocales(value: unknown, configPath: string, locales: string[]): void {
  if (value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    if (value.some((locale) => typeof locale !== "string")) {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: "fallbackLocales" arrays must only contain strings.`
      )
    }
    for (const fallback of value as string[]) {
      if (!locales.includes(fallback)) {
        throw new Error(
          `Invalid Palamedes config in ${configPath}: "fallbackLocales" entry "${fallback}" must be included in "locales".`
        )
      }
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
      if (locale !== "default" && !locales.includes(locale)) {
        throw new Error(
          `Invalid Palamedes config in ${configPath}: "fallbackLocales" key "${locale}" must be "default" or included in "locales".`
        )
      }
      for (const fallback of fallbacks as string[]) {
        if (!locales.includes(fallback)) {
          throw new Error(
            `Invalid Palamedes config in ${configPath}: "fallbackLocales.${locale}" entry "${fallback}" must be included in "locales".`
          )
        }
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

  if (record.format !== undefined && record.format !== "po" && record.format !== "fcl") {
    if (record.format === "ndjson") {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: "catalogs[${index}].format" value "ndjson" is no longer supported; use "fcl" for Ferrocat Catalog Lines.`
      )
    }
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].format" must be "po" or "fcl" when provided.`
    )
  }

  validatePoOutputOptions(record.po, record.format, configPath, index)

  if (
    record.exclude !== undefined &&
    (!Array.isArray(record.exclude) || record.exclude.some((value) => typeof value !== "string"))
  ) {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].exclude" must be an array of strings when provided.`
    )
  }
}

function validatePoOutputOptions(
  value: unknown,
  format: unknown,
  configPath: string,
  index: number
): void {
  if (value === undefined) {
    return
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].po" must be an object.`
    )
  }
  if (format === "fcl") {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].po" can only be used when the catalog format is "po".`
    )
  }
  const po = value as Record<string, unknown>
  for (const key of Object.keys(po)) {
    if (key !== "lineBreaks") {
      throw new Error(
        `Invalid Palamedes config in ${configPath}: unknown key "catalogs[${index}].po.${key}".`
      )
    }
  }
  if (po.lineBreaks !== undefined && po.lineBreaks !== "auto" && po.lineBreaks !== "off") {
    throw new Error(
      `Invalid Palamedes config in ${configPath}: "catalogs[${index}].po.lineBreaks" must be "auto" or "off" when provided.`
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

function assertFileExistsSync(filePath: string): void {
  if (!fileExistsSync(filePath)) {
    throw new Error(`Could not find Palamedes config at ${filePath}.`)
  }
}

function fileExistsSync(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}
