import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

export interface NativeInfo {
  palamedesVersion: string
  ferrocatVersion: string
}

export interface ParsedPoItem {
  msgid: string
  msgctxt?: string
  references: string[]
  msgidPlural?: string
  msgstr: string[]
  comments: string[]
  extractedComments: string[]
  flags: Record<string, boolean>
  metadata: Record<string, string>
  obsolete: boolean
  nplurals: number
}

export interface ParsedPoFile {
  comments: string[]
  extractedComments: string[]
  headers: Record<string, string>
  headerOrder: string[]
  items: ParsedPoItem[]
}

export interface CatalogOrigin {
  file: string
  line: number
}

export interface CatalogUpdateMessage {
  message: string
  context?: string
  extractedComments: string[]
  origins: CatalogOrigin[]
}

export interface CatalogUpdateRequest {
  targetPath: string
  locale: string
  sourceLocale: string
  clean: boolean
  messages: CatalogUpdateMessage[]
}

export interface CatalogUpdateStats {
  total: number
  added: number
  changed: number
  unchanged: number
  obsoleteMarked: number
  obsoleteRemoved: number
}

export interface CatalogUpdateResult {
  created: boolean
  updated: boolean
  stats: CatalogUpdateStats
  diagnostics: string[]
}

export interface CatalogParseRequest {
  targetPath: string
  locale: string
  sourceLocale: string
}

export interface ParsedCatalogMessage {
  message: string
  context?: string
  comments: string[]
  origins: CatalogOrigin[]
  obsolete: boolean
}

export interface CatalogParseResult {
  locale?: string
  headers: Record<string, string>
  messages: ParsedCatalogMessage[]
  diagnostics: string[]
}

export interface NativeExtractedMessage {
  message: string
  comment?: string
  context?: string
  placeholders?: Record<string, string>
  origin: [filename: string, line: number, column?: number]
}

export interface NativeTransformOptions {
  runtimeModule?: string
  runtimeImportName?: string
  stripNonEssentialProps?: boolean
  stripMessageField?: boolean
}

export interface NativeTransformEdit {
  start: number
  end: number
  text: string
}

export interface NativeTransformResult {
  code: string
  hasChanged: boolean
  edits: NativeTransformEdit[]
  prependText?: string
}

export interface CatalogModuleCatalogConfig {
  path: string
  include: string[]
  exclude?: string[]
}

export type CatalogModuleFallbackLocales = string[] | Record<string, string[]>

export interface CatalogModuleConfig {
  rootDir: string
  locales: string[]
  sourceLocale: string
  fallbackLocales?: CatalogModuleFallbackLocales
  pseudoLocale?: string
  catalogs: CatalogModuleCatalogConfig[]
}

export interface CatalogModuleMissingTranslation {
  message: string
  context?: string
}

export interface CatalogModuleCompilationError {
  message: string
  context?: string
}

export interface CatalogModuleResult {
  code: string
  watchFiles: string[]
  missing: CatalogModuleMissingTranslation[]
  errors: CatalogModuleCompilationError[]
  resolvedLocaleChain?: string[]
}

interface NativeExtractedMessageOrigin {
  filename: string
  line: number
  column?: number
}

interface NativeBindingsExtractedMessage {
  message: string
  comment?: string
  context?: string
  placeholders?: Record<string, string>
  origin: NativeExtractedMessageOrigin
}

interface NativeCatalogModuleRequest {
  config: CatalogModuleConfig
  resourcePath: string
}

interface NativeBindings {
  getNativeInfo(): NativeInfo
  parsePo(source: string): ParsedPoFile
  updateCatalogFile(request: CatalogUpdateRequest): CatalogUpdateResult
  parseCatalog(request: CatalogParseRequest): CatalogParseResult
  getCatalogModule(request: NativeCatalogModuleRequest): CatalogModuleResult
  extractMessages(source: string, filename: string): NativeBindingsExtractedMessage[]
  transformMacros(
    source: string,
    filename: string,
    options?: NativeTransformOptions
  ): NativeTransformResult
}

function detectLinuxLibc(): "gnu" | "musl" | null {
  if (process.platform !== "linux") {
    return null
  }

  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined
  const glibcVersion = report?.header?.glibcVersionRuntime

  if (typeof glibcVersion === "string" && glibcVersion.length > 0) {
    return "gnu"
  }

  return "musl"
}

function getNativePackageName(): string {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@palamedes/core-node-darwin-arm64"
  }

  if (process.platform === "linux" && process.arch === "x64" && detectLinuxLibc() === "gnu") {
    return "@palamedes/core-node-linux-x64-gnu"
  }

  if (
    process.platform === "linux" &&
    process.arch === "arm64" &&
    detectLinuxLibc() === "gnu"
  ) {
    return "@palamedes/core-node-linux-arm64-gnu"
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "@palamedes/core-node-win32-x64-msvc"
  }

  throw new Error(
    `No Palamedes native bindings package is available for ${process.platform}/${process.arch}.`
  )
}

function loadNativeBindings(): NativeBindings {
  const require = createRequire(import.meta.url)
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const nativePackageName = getNativePackageName()

  try {
    return require(nativePackageName) as NativeBindings
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load Palamedes native bindings from ${nativePackageName} for package ${packageDir}: ${message}`
    )
  }
}

const native = loadNativeBindings()

export function getNativeInfo(): NativeInfo {
  return native.getNativeInfo()
}

export function parsePo(source: string): ParsedPoFile {
  return native.parsePo(source)
}

export function updateCatalogFile(request: CatalogUpdateRequest): CatalogUpdateResult {
  return native.updateCatalogFile(request)
}

export function parseCatalog(request: CatalogParseRequest): CatalogParseResult {
  return native.parseCatalog(request)
}

export function getCatalogModule(
  config: CatalogModuleConfig,
  resourcePath: string
): CatalogModuleResult {
  return native.getCatalogModule({
    config,
    resourcePath,
  })
}

export function extractMessagesNative(
  source: string,
  filename: string
): NativeExtractedMessage[] {
  return native.extractMessages(source, filename).map((message) => ({
    ...message,
    origin: [message.origin.filename, message.origin.line, message.origin.column],
  }))
}

export function transformMacrosNative(
  source: string,
  filename: string,
  options?: NativeTransformOptions
): NativeTransformResult {
  return native.transformMacros(source, filename, options)
}
