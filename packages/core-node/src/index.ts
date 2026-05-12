import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type {
  CatalogAuditCheckOptions as GeneratedCatalogAuditCheckOptions,
  CatalogAuditDiagnostic as GeneratedCatalogAuditDiagnostic,
  CatalogAuditRequest as GeneratedCatalogAuditRequest,
  CatalogAuditResult as GeneratedCatalogAuditResult,
  CatalogAuditSummary as GeneratedCatalogAuditSummary,
  CatalogArtifactConfig as GeneratedCatalogArtifactConfig,
  CatalogArtifactDiagnostic as GeneratedCatalogArtifactDiagnostic,
  CatalogArtifactMissingMessage as GeneratedCatalogArtifactMissingMessage,
  CatalogArtifactRequest as GeneratedCatalogArtifactRequest,
  CatalogArtifactResult as GeneratedCatalogArtifactResult,
  CatalogArtifactSelectedRequest as GeneratedCatalogArtifactSelectedRequest,
  CatalogArtifactSourceKey as GeneratedCatalogArtifactSourceKey,
  CatalogOrigin as GeneratedCatalogOrigin,
  CatalogParseRequest as GeneratedCatalogParseRequest,
  CatalogParseResult as GeneratedCatalogParseResult,
  CatalogUpdateMessage as GeneratedCatalogUpdateMessage,
  CatalogUpdateRequest as GeneratedCatalogUpdateRequest,
  CatalogUpdateResult as GeneratedCatalogUpdateResult,
  CatalogUpdateStats as GeneratedCatalogUpdateStats,
  MessageArgumentFormatMetadata as GeneratedMessageArgumentFormatMetadata,
  MessageArgumentKind as GeneratedMessageArgumentKind,
  MessageArgumentMetadata as GeneratedMessageArgumentMetadata,
  MessageFormatStyleKind as GeneratedMessageFormatStyleKind,
  MessageMetadataInput as GeneratedMessageMetadataInput,
  MessageOriginMetadata as GeneratedMessageOriginMetadata,
  MessageSelectorKind as GeneratedMessageSelectorKind,
  MessageSelectorMetadata as GeneratedMessageSelectorMetadata,
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
export type CatalogAuditCheckOptions = GeneratedCatalogAuditCheckOptions
export type CatalogAuditSummary = GeneratedCatalogAuditSummary
export type CatalogDiagnosticSeverity = "info" | "warning" | "error"
export type CatalogAuditDiagnostic =
  Omit<GeneratedCatalogAuditDiagnostic, "severity"> & {
  severity: CatalogDiagnosticSeverity
  }
export type CatalogAuditResult =
  Omit<GeneratedCatalogAuditResult, "diagnostics"> & {
  diagnostics: CatalogAuditDiagnostic[]
  }
export interface CatalogAuditOptions {
  locales?: string[]
  checks?: CatalogAuditCheckOptions
  metadata?: MessageMetadataInput[]
}
export type MessageMetadataInput = GeneratedMessageMetadataInput
export type MessageOriginMetadata = GeneratedMessageOriginMetadata
export type MessageArgumentKind = GeneratedMessageArgumentKind
export type MessageArgumentMetadata = GeneratedMessageArgumentMetadata
export type MessageArgumentFormatMetadata = GeneratedMessageArgumentFormatMetadata
export type MessageFormatStyleKind = GeneratedMessageFormatStyleKind
export type MessageSelectorKind = GeneratedMessageSelectorKind
export type MessageSelectorMetadata = GeneratedMessageSelectorMetadata

export type NativeExtractedMessage =
  Omit<GeneratedNativeExtractedMessage, "origin"> & {
  origin: [filename: string, line: number, column?: number]
  }

export type NativeTransformOptions = GeneratedNativeTransformOptions
export type NativeTransformEdit = GeneratedNativeTransformEdit
export type NativeTransformResult = GeneratedNativeTransformResult
export type CatalogArtifactSourceKey = GeneratedCatalogArtifactSourceKey
export type CatalogArtifactMissingMessage = GeneratedCatalogArtifactMissingMessage
export type CatalogArtifactDiagnosticSeverity = "info" | "warning" | "error"
export type CatalogArtifactDiagnostic =
  Omit<GeneratedCatalogArtifactDiagnostic, "severity"> & {
  severity: CatalogArtifactDiagnosticSeverity
  }
export type CatalogArtifactFallbackLocales =
  NonNullable<GeneratedCatalogArtifactConfig["fallbackLocales"]>
export type CatalogArtifactConfig = GeneratedCatalogArtifactConfig
export type CatalogArtifactResult =
  Omit<GeneratedCatalogArtifactResult, "diagnostics"> & {
  diagnostics: CatalogArtifactDiagnostic[]
  }

type NativeBindings = GeneratedNativeBindings
type NativeCatalogAuditRequest = GeneratedCatalogAuditRequest
type NativeCatalogArtifactRequest = GeneratedCatalogArtifactRequest
type NativeCatalogArtifactSelectedRequest = GeneratedCatalogArtifactSelectedRequest

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

function mapNativeDiagnosticSeverity(
  severity: GeneratedCatalogArtifactDiagnostic["severity"] | GeneratedCatalogAuditDiagnostic["severity"]
): CatalogDiagnosticSeverity {
  switch (severity) {
    case "Info":
      return "info"
    case "Warning":
      return "warning"
    case "Error":
      return "error"
  }
}

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

export function auditCatalogs(
  config: CatalogArtifactConfig,
  options: CatalogAuditOptions = {}
): CatalogAuditResult {
  const request: NativeCatalogAuditRequest = {
    config,
    locales: options.locales,
    checks: options.checks,
    metadata: options.metadata,
  }
  const result = native.auditCatalogs(request)

  return {
    ...result,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      severity: mapNativeDiagnosticSeverity(diagnostic.severity),
    })),
  }
}

export function compileCatalogArtifact(
  config: CatalogArtifactConfig,
  resourcePath: string
): CatalogArtifactResult {
  const request: NativeCatalogArtifactRequest = {
    config,
    resourcePath,
  }
  const result = native.compileCatalogArtifact(request)

  return {
    ...result,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      severity: mapNativeDiagnosticSeverity(diagnostic.severity),
    })),
  }
}

export function compileCatalogArtifactSelected(
  config: CatalogArtifactConfig,
  resourcePath: string,
  compiledIds: string[]
): CatalogArtifactResult {
  const request: NativeCatalogArtifactSelectedRequest = {
    config,
    resourcePath,
    compiledIds,
  }
  const result = native.compileCatalogArtifactSelected(request)

  return {
    ...result,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      severity: mapNativeDiagnosticSeverity(diagnostic.severity),
    })),
  }
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
