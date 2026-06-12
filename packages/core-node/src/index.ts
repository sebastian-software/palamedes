import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type {
  CatalogAuditCheckOptions as GeneratedCatalogAuditCheckOptions,
  CatalogAuditDiagnostic as GeneratedCatalogAuditDiagnostic,
  CatalogAuditRequest as GeneratedCatalogAuditRequest,
  CatalogAuditResult as GeneratedCatalogAuditResult,
  CatalogAuditSummary as GeneratedCatalogAuditSummary,
  CatalogCombineRequest as GeneratedCatalogCombineRequest,
  CatalogCombineResult as GeneratedCatalogCombineResult,
  CatalogMergeRequest as GeneratedCatalogMergeRequest,
  CatalogMergeResult as GeneratedCatalogMergeResult,
  CatalogArtifactConfig as GeneratedCatalogArtifactConfig,
  CatalogArtifactDiagnostic as GeneratedCatalogArtifactDiagnostic,
  CatalogArtifactMissingMessage as GeneratedCatalogArtifactMissingMessage,
  CatalogArtifactRequest as GeneratedCatalogArtifactRequest,
  CatalogArtifactResult as GeneratedCatalogArtifactResult,
  CatalogArtifactSelectedRequest as GeneratedCatalogArtifactSelectedRequest,
  CatalogArtifactSourceKey as GeneratedCatalogArtifactSourceKey,
  CatalogDiagnostic as GeneratedCatalogDiagnostic,
  CatalogOrigin as GeneratedCatalogOrigin,
  CatalogParseRequest as GeneratedCatalogParseRequest,
  CatalogParseResult as GeneratedCatalogParseResult,
  CatalogUpdateMessage as GeneratedCatalogUpdateMessage,
  CatalogUpdateRequest as GeneratedCatalogUpdateRequest,
  CatalogUpdateResult as GeneratedCatalogUpdateResult,
  CatalogUpdateStats as GeneratedCatalogUpdateStats,
  ExtractCatalogFileFailure as GeneratedExtractCatalogFileFailure,
  ExtractCatalogMessagesRequest as GeneratedExtractCatalogMessagesRequest,
  ExtractCatalogMessagesResult as GeneratedExtractCatalogMessagesResult,
  MessageArgumentFormatMetadata as GeneratedMessageArgumentFormatMetadata,
  MessageArgumentKind as GeneratedMessageArgumentKind,
  MessageArgumentMetadata as GeneratedMessageArgumentMetadata,
  MessageFormatStyleKind as GeneratedMessageFormatStyleKind,
  MessageMetadata as GeneratedMessageMetadata,
  MessageMetadataDiagnostic as GeneratedMessageMetadataDiagnostic,
  MessageMetadataInput as GeneratedMessageMetadataInput,
  MessageMetadataValidationReport as GeneratedMessageMetadataValidationReport,
  MessageOriginMetadata as GeneratedMessageOriginMetadata,
  MessageSelectorKind as GeneratedMessageSelectorKind,
  MessageSelectorMetadata as GeneratedMessageSelectorMetadata,
  MachineTranslationMetadata as GeneratedMachineTranslationMetadata,
  NativeBindings as GeneratedNativeBindings,
  NativeExtractedMessage as GeneratedNativeExtractedMessage,
  NativeInfo as GeneratedNativeInfo,
  NativeTransformEdit as GeneratedNativeTransformEdit,
  NativeTransformOptions as GeneratedNativeTransformOptions,
  NativeTransformResult as GeneratedNativeTransformResult,
  NativeTransformSourceMap as GeneratedNativeTransformSourceMap,
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
export type ExtractCatalogFileFailure = GeneratedExtractCatalogFileFailure
export type ExtractCatalogMessagesRequest = GeneratedExtractCatalogMessagesRequest
export type ExtractCatalogMessagesResult = GeneratedExtractCatalogMessagesResult
export type CatalogParseRequest = GeneratedCatalogParseRequest
export type ParsedCatalogMessage = GeneratedParsedCatalogMessage
export type MachineTranslationMetadata = GeneratedMachineTranslationMetadata
export type CatalogAuditCheckOptions = GeneratedCatalogAuditCheckOptions
export type CatalogAuditSummary = GeneratedCatalogAuditSummary
export type CatalogDiagnosticSeverity = "info" | "warning" | "error"
export type CatalogDiagnostic = Omit<GeneratedCatalogDiagnostic, "severity"> & {
  severity: CatalogDiagnosticSeverity
}
export type CatalogUpdateResult = Omit<GeneratedCatalogUpdateResult, "diagnostics"> & {
  diagnostics: CatalogDiagnostic[]
}
export type CatalogParseResult = Omit<GeneratedCatalogParseResult, "diagnostics"> & {
  diagnostics: CatalogDiagnostic[]
}
export type CatalogAuditDiagnostic = Omit<GeneratedCatalogAuditDiagnostic, "severity"> & {
  severity: CatalogDiagnosticSeverity
}
export type CatalogAuditResult = Omit<GeneratedCatalogAuditResult, "diagnostics"> & {
  diagnostics: CatalogAuditDiagnostic[]
}
export type CatalogCombineInput = {
  content: string
  label?: string
}
export type CatalogCombineConflictStrategy = "useFirst" | "useLast" | "error"
export type CatalogCombineSelection = "all" | "unique" | { moreThan: number } | { lessThan: number }
export type CatalogCombineRequest = {
  inputs: CatalogCombineInput[]
  sourceLocale: string
  locale?: string
  conflictStrategy?: CatalogCombineConflictStrategy
  selection?: CatalogCombineSelection
  includeObsolete?: boolean
}
export type CatalogCombineResult = Omit<GeneratedCatalogCombineResult, "diagnostics"> & {
  diagnostics: CatalogDiagnostic[]
}
export type CatalogMergeFormat = "po" | "json"
export type CatalogMergeStrategy = "useFirst"
export type CatalogMergeRequest = {
  inputPaths: string[]
  outputPath: string
  format?: CatalogMergeFormat
  sourceLocale: string
  locale?: string
  strategy?: CatalogMergeStrategy
}
export type CatalogMergeResult = Omit<GeneratedCatalogMergeResult, "format" | "diagnostics"> & {
  format: CatalogMergeFormat
  diagnostics: CatalogDiagnostic[]
}
export type CatalogAuditOptions = {
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
export type MessageMetadata = GeneratedMessageMetadata
export type MessageMetadataDiagnostic = Omit<GeneratedMessageMetadataDiagnostic, "severity"> & {
  severity: CatalogDiagnosticSeverity
}
export type MessageMetadataValidationReport = Omit<
  GeneratedMessageMetadataValidationReport,
  "diagnostics"
> & {
  diagnostics: MessageMetadataDiagnostic[]
}

export type NativeExtractedMessage = Omit<GeneratedNativeExtractedMessage, "origin"> & {
  origin: [filename: string, line: number, column?: number]
}

export type NativeTransformOptions = GeneratedNativeTransformOptions
export type NativeTransformEdit = GeneratedNativeTransformEdit
export type NativeTransformSourceMap = GeneratedNativeTransformSourceMap
export type NativeTransformResult = GeneratedNativeTransformResult
export type CatalogArtifactSourceKey = GeneratedCatalogArtifactSourceKey
export type CatalogArtifactMissingMessage = GeneratedCatalogArtifactMissingMessage
export type CatalogArtifactDiagnosticSeverity = "info" | "warning" | "error"
export type CatalogArtifactDiagnostic = Omit<GeneratedCatalogArtifactDiagnostic, "severity"> & {
  severity: CatalogArtifactDiagnosticSeverity
}
export type CatalogArtifactFallbackLocales = NonNullable<
  GeneratedCatalogArtifactConfig["fallbackLocales"]
>
export type CatalogArtifactConfig = GeneratedCatalogArtifactConfig
export type CatalogArtifactResult = Omit<GeneratedCatalogArtifactResult, "diagnostics"> & {
  diagnostics: CatalogArtifactDiagnostic[]
}

type NativeBindings = GeneratedNativeBindings
type NativeCatalogAuditRequest = GeneratedCatalogAuditRequest
type NativeCatalogCombineRequest = GeneratedCatalogCombineRequest
type NativeCatalogMergeRequest = GeneratedCatalogMergeRequest
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

const SUPPORTED_NATIVE_PACKAGES = [
  "@palamedes/core-node-darwin-arm64",
  "@palamedes/core-node-darwin-x64",
  "@palamedes/core-node-linux-arm64-gnu",
  "@palamedes/core-node-linux-arm64-musl",
  "@palamedes/core-node-linux-x64-gnu",
  "@palamedes/core-node-linux-x64-musl",
  "@palamedes/core-node-win32-arm64-msvc",
  "@palamedes/core-node-win32-x64-msvc",
] as const

function getPlatformTriple(): string {
  const libc = detectLinuxLibc()
  return libc
    ? `${process.platform}-${process.arch}-${libc}`
    : `${process.platform}-${process.arch}`
}

function getNativePackageName(): string {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@palamedes/core-node-darwin-arm64"
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "@palamedes/core-node-darwin-x64"
  }

  if (process.platform === "linux" && process.arch === "x64" && detectLinuxLibc() === "gnu") {
    return "@palamedes/core-node-linux-x64-gnu"
  }

  if (process.platform === "linux" && process.arch === "x64" && detectLinuxLibc() === "musl") {
    return "@palamedes/core-node-linux-x64-musl"
  }

  if (process.platform === "linux" && process.arch === "arm64" && detectLinuxLibc() === "gnu") {
    return "@palamedes/core-node-linux-arm64-gnu"
  }

  if (process.platform === "linux" && process.arch === "arm64" && detectLinuxLibc() === "musl") {
    return "@palamedes/core-node-linux-arm64-musl"
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "@palamedes/core-node-win32-x64-msvc"
  }

  if (process.platform === "win32" && process.arch === "arm64") {
    return "@palamedes/core-node-win32-arm64-msvc"
  }

  throw new Error(
    `No Palamedes native bindings package is available for ${getPlatformTriple()}. Supported packages: ${SUPPORTED_NATIVE_PACKAGES.join(", ")}. If you need to build from source, run \`cargo build --workspace\` in the Palamedes repository.`
  )
}

function loadNativeBindings(): NativeBindings {
  const require = createRequire(import.meta.url)
  const packageDir = path.resolve(import.meta.dirname, "..")
  const nativePackageName = getNativePackageName()

  try {
    return require(nativePackageName) as NativeBindings
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load Palamedes native bindings from ${nativePackageName} for ${getPlatformTriple()} in package ${packageDir}: ${message}. Supported packages: ${SUPPORTED_NATIVE_PACKAGES.join(", ")}.`,
      { cause: error }
    )
  }
}

const native = loadNativeBindings()

function mapNativeDiagnosticSeverity(
  severity:
    | GeneratedCatalogArtifactDiagnostic["severity"]
    | GeneratedCatalogAuditDiagnostic["severity"]
): CatalogDiagnosticSeverity {
  switch (severity) {
    case "Info": {
      return "info"
    }
    case "Warning": {
      return "warning"
    }
    case "Error": {
      return "error"
    }
  }
}

export function getNativeInfo(): NativeInfo {
  return native.getNativeInfo()
}

export function parsePo(source: string): ParsedPoFile {
  return native.parsePo(source)
}

export function updateCatalogFile(request: CatalogUpdateRequest): CatalogUpdateResult {
  const result = native.updateCatalogFile(request)
  return {
    ...result,
    diagnostics: mapCatalogDiagnostics(result.diagnostics),
  }
}

export function parseCatalog(request: CatalogParseRequest): CatalogParseResult {
  const result = native.parseCatalog(request)
  return {
    ...result,
    diagnostics: mapCatalogDiagnostics(result.diagnostics),
  }
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

export function deriveMessageMetadata(message: string, context?: string): MessageMetadata {
  return native.deriveMessageMetadata(message, context)
}

export function normalizeMessageMetadata(input: MessageMetadataInput): MessageMetadata {
  return native.normalizeMessageMetadata(input)
}

export function validateMessageMetadata(
  input: MessageMetadataInput
): MessageMetadataValidationReport {
  const result = native.validateMessageMetadata(input)
  return {
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      severity: mapNativeDiagnosticSeverity(diagnostic.severity),
    })),
  }
}

export function combineCatalogs(request: CatalogCombineRequest): CatalogCombineResult {
  const result = native.combineCatalogs(toNativeCombineRequest(request))
  return {
    ...result,
    diagnostics: mapCatalogDiagnostics(result.diagnostics),
  }
}

export function mergeCatalogFiles(request: CatalogMergeRequest): CatalogMergeResult {
  const result = native.mergeCatalogFiles(toNativeMergeRequest(request))
  return {
    ...result,
    format: fromNativeMergeFormat(result.format),
    diagnostics: mapCatalogDiagnostics(result.diagnostics),
  }
}

function toNativeCombineRequest(request: CatalogCombineRequest): NativeCatalogCombineRequest {
  return {
    inputs: request.inputs,
    sourceLocale: request.sourceLocale,
    locale: request.locale,
    conflictStrategy: request.conflictStrategy
      ? toNativeConflictStrategy(request.conflictStrategy)
      : undefined,
    selection: request.selection ? toNativeSelection(request.selection) : undefined,
    includeObsolete: request.includeObsolete,
  }
}

function toNativeConflictStrategy(
  strategy: CatalogCombineConflictStrategy
): NonNullable<NativeCatalogCombineRequest["conflictStrategy"]> {
  switch (strategy) {
    case "useFirst": {
      return "UseFirst"
    }
    case "useLast": {
      return "UseLast"
    }
    case "error": {
      return "Error"
    }
  }
}

function toNativeMergeRequest(request: CatalogMergeRequest): NativeCatalogMergeRequest {
  return {
    inputPaths: request.inputPaths,
    outputPath: request.outputPath,
    format: request.format ? toNativeMergeFormat(request.format) : undefined,
    sourceLocale: request.sourceLocale,
    locale: request.locale,
    strategy: request.strategy ? toNativeMergeStrategy(request.strategy) : undefined,
  }
}

function toNativeMergeFormat(
  format: CatalogMergeFormat
): NonNullable<NativeCatalogMergeRequest["format"]> {
  switch (format) {
    case "po": {
      return "Po"
    }
    case "json": {
      return "Json"
    }
  }
}

function fromNativeMergeFormat(format: GeneratedCatalogMergeResult["format"]): CatalogMergeFormat {
  switch (format) {
    case "Po": {
      return "po"
    }
    case "Json": {
      return "json"
    }
  }
}

function toNativeMergeStrategy(
  strategy: CatalogMergeStrategy
): NonNullable<NativeCatalogMergeRequest["strategy"]> {
  switch (strategy) {
    case "useFirst": {
      return "UseFirst"
    }
  }
}

function toNativeSelection(
  selection: CatalogCombineSelection
): NonNullable<NativeCatalogCombineRequest["selection"]> {
  if (selection === "all") {
    return "All"
  }
  if (selection === "unique") {
    return "Unique"
  }
  return selection
}

function mapCatalogDiagnostics(diagnostics: GeneratedCatalogDiagnostic[]): CatalogDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    severity: mapNativeDiagnosticSeverity(diagnostic.severity),
  }))
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

export function extractMessagesNative(source: string, filename: string): NativeExtractedMessage[] {
  return native.extractMessages(source, filename).map((message) => ({
    ...message,
    origin: [message.origin.filename, message.origin.line, message.origin.column],
  }))
}

export function extractCatalogMessagesFromFiles(
  request: ExtractCatalogMessagesRequest
): ExtractCatalogMessagesResult {
  return native.extractCatalogMessagesFromFiles(request)
}

export function transformMacrosNative(
  source: string,
  filename: string,
  options?: NativeTransformOptions
): NativeTransformResult {
  return native.transformMacros(source, filename, options)
}
