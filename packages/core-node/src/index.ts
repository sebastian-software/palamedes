import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type {
  CatalogModuleCatalogConfig as GeneratedCatalogModuleCatalogConfig,
  CatalogModuleCompilationError as GeneratedCatalogModuleCompilationError,
  CatalogModuleConfig as GeneratedCatalogModuleConfig,
  CatalogModuleMissingTranslation as GeneratedCatalogModuleMissingTranslation,
  CatalogModuleRequest as GeneratedCatalogModuleRequest,
  CatalogModuleResult as GeneratedCatalogModuleResult,
  CatalogOrigin as GeneratedCatalogOrigin,
  CatalogParseRequest as GeneratedCatalogParseRequest,
  CatalogParseResult as GeneratedCatalogParseResult,
  CatalogUpdateMessage as GeneratedCatalogUpdateMessage,
  CatalogUpdateRequest as GeneratedCatalogUpdateRequest,
  CatalogUpdateResult as GeneratedCatalogUpdateResult,
  CatalogUpdateStats as GeneratedCatalogUpdateStats,
  NativeBindings as GeneratedNativeBindings,
  NativeExtractedMessage as GeneratedNativeExtractedMessage,
  NativeInfo as GeneratedNativeInfo,
  NativeTransformEdit as GeneratedNativeTransformEdit,
  NativeTransformOptions as GeneratedNativeTransformOptions,
  NativeTransformResult as GeneratedNativeTransformResult,
  ParsedCatalogMessage as GeneratedParsedCatalogMessage,
  ParsedPoFile as GeneratedParsedPoFile,
  ParsedPoItem as GeneratedParsedPoItem,
} from "./generated/palamedes-node-types"

export type NativeInfo = GeneratedNativeInfo
export type ParsedPoItem = GeneratedParsedPoItem
export type ParsedPoFile = GeneratedParsedPoFile
export type CatalogOrigin = GeneratedCatalogOrigin
export type CatalogUpdateMessage = GeneratedCatalogUpdateMessage
export type CatalogUpdateRequest = GeneratedCatalogUpdateRequest
export type CatalogUpdateStats = GeneratedCatalogUpdateStats
export type CatalogUpdateResult = GeneratedCatalogUpdateResult
export type CatalogParseRequest = GeneratedCatalogParseRequest
export type ParsedCatalogMessage = GeneratedParsedCatalogMessage
export type CatalogParseResult = GeneratedCatalogParseResult

export type NativeExtractedMessage =
  Omit<GeneratedNativeExtractedMessage, "origin"> & {
  origin: [filename: string, line: number, column?: number]
  }

export type NativeTransformOptions = GeneratedNativeTransformOptions
export type NativeTransformEdit = GeneratedNativeTransformEdit
export type NativeTransformResult = GeneratedNativeTransformResult
export type CatalogModuleCatalogConfig = GeneratedCatalogModuleCatalogConfig
export type CatalogModuleFallbackLocales =
  NonNullable<GeneratedCatalogModuleConfig["fallbackLocales"]>
export type CatalogModuleConfig = GeneratedCatalogModuleConfig
export type CatalogModuleMissingTranslation = GeneratedCatalogModuleMissingTranslation
export type CatalogModuleCompilationError = GeneratedCatalogModuleCompilationError
export type CatalogModuleResult = GeneratedCatalogModuleResult

type NativeBindings = GeneratedNativeBindings
type NativeCatalogModuleRequest = GeneratedCatalogModuleRequest

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
