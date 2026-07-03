import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type {
  CatalogAuditCheckOptions as GeneratedCatalogAuditCheckOptions,
  CatalogAuditDiagnostic as GeneratedCatalogAuditDiagnostic,
  CatalogAuditRequest as GeneratedCatalogAuditRequest,
  CatalogAuditResult as GeneratedCatalogAuditResult,
  CatalogAuditSummary as GeneratedCatalogAuditSummary,
  CatalogFileCombineRequest as GeneratedCatalogFileCombineRequest,
  CatalogFileCombineResult as GeneratedCatalogFileCombineResult,
  CatalogCombineRequest as GeneratedCatalogCombineRequest,
  CatalogCombineResult as GeneratedCatalogCombineResult,
  CatalogArtifactCatalogConfig as GeneratedCatalogArtifactCatalogConfig,
  CatalogArtifactConfig as GeneratedCatalogArtifactConfig,
  CatalogArtifactDiagnostic as GeneratedCatalogArtifactDiagnostic,
  CatalogArtifactMissingMessage as GeneratedCatalogArtifactMissingMessage,
  CatalogArtifactRequest as GeneratedCatalogArtifactRequest,
  CatalogArtifactResult as GeneratedCatalogArtifactResult,
  CatalogArtifactSelectedRequest as GeneratedCatalogArtifactSelectedRequest,
  CatalogArtifactSourceKey as GeneratedCatalogArtifactSourceKey,
  CatalogModuleRequest as GeneratedCatalogModuleRequest,
  CatalogModuleResult as GeneratedCatalogModuleResult,
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
  MachineMetadata as GeneratedMachineMetadata,
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
export type CatalogUpdateStats = GeneratedCatalogUpdateStats
export type ExtractCatalogFileFailure = GeneratedExtractCatalogFileFailure
export type ExtractCatalogMessagesRequest = GeneratedExtractCatalogMessagesRequest
export type ExtractCatalogMessagesResult = GeneratedExtractCatalogMessagesResult
export type ParsedCatalogMessage = GeneratedParsedCatalogMessage
export type MachineMetadata = GeneratedMachineMetadata
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
export type CatalogConflictStrategy = "useFirst" | "useLast" | "error"
export type CatalogCombineSelection = "all" | "unique" | { moreThan: number } | { lessThan: number }
export type CatalogCombineRequest = {
  inputs: CatalogCombineInput[]
  sourceLocale: string
  locale?: string
  conflictStrategy?: CatalogConflictStrategy
  selection?: CatalogCombineSelection
  includeObsolete?: boolean
}
export type CatalogCombineResult = Omit<GeneratedCatalogCombineResult, "diagnostics"> & {
  diagnostics: CatalogDiagnostic[]
}
export type CatalogFileFormat = "po" | "fcl"
export type CatalogConfigFormat = CatalogFileFormat
export type CatalogUpdateRequest = Omit<GeneratedCatalogUpdateRequest, "format"> & {
  format?: CatalogConfigFormat
}
export type CatalogParseRequest = Omit<GeneratedCatalogParseRequest, "format"> & {
  format?: CatalogConfigFormat
}
export type CatalogFileCombineRequest = {
  inputPaths: string[]
  outputPath: string
  format?: CatalogFileFormat
  sourceLocale: string
  locale?: string
  conflictStrategy?: CatalogConflictStrategy
}
export type CatalogFileCombineResult = Omit<
  GeneratedCatalogFileCombineResult,
  "format" | "diagnostics"
> & {
  format: CatalogFileFormat
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
export type CatalogArtifactCatalogConfig = Omit<GeneratedCatalogArtifactCatalogConfig, "format"> & {
  format?: CatalogConfigFormat
}
export type CatalogArtifactConfig = Omit<GeneratedCatalogArtifactConfig, "catalogs"> & {
  catalogs: CatalogArtifactCatalogConfig[]
}
export type CatalogArtifactResult = Omit<GeneratedCatalogArtifactResult, "diagnostics"> & {
  diagnostics: CatalogArtifactDiagnostic[]
}
export type CatalogModuleOptions = {
  locale: string
  pseudoLocale?: string
  failOnMissing?: boolean
  failOnCompileError?: boolean
  missingFailureHint?: string
  compileFailureHint?: string
  diagnosticsWarningHint?: string
}
export type CatalogModuleResult = GeneratedCatalogModuleResult

type NativeBindings = GeneratedNativeBindings
type NativeCatalogAuditRequest = GeneratedCatalogAuditRequest
type NativeCatalogCombineRequest = GeneratedCatalogCombineRequest
type NativeCatalogFileCombineRequest = GeneratedCatalogFileCombineRequest
type NativeCatalogArtifactRequest = GeneratedCatalogArtifactRequest
type NativeCatalogArtifactSelectedRequest = GeneratedCatalogArtifactSelectedRequest
type NativeCatalogModuleRequest = GeneratedCatalogModuleRequest
type NativeCatalogUpdateRequest = GeneratedCatalogUpdateRequest
type NativeCatalogParseRequest = GeneratedCatalogParseRequest

function detectLinuxLibc(): "gnu" | "musl" | null {
  if (process.platform !== "linux") {
    return null
  }

  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] }
    | undefined
  const header = report?.header
  const glibcVersion = header?.glibcVersionRuntime

  if (typeof glibcVersion === "string" && glibcVersion.length > 0) {
    return "gnu"
  }

  const sharedObjects = Array.isArray(report?.sharedObjects) ? report.sharedObjects : []

  if (sharedObjects.some((sharedObject) => sharedObject.includes("musl"))) {
    return "musl"
  }

  if (
    sharedObjects.some(
      (sharedObject) => sharedObject.includes("libc.so.6") || sharedObject.includes("ld-linux")
    )
  ) {
    return "gnu"
  }

  return null
}

const SUPPORTED_NATIVE_PACKAGES = [
  "@palamedes/core-node-darwin-arm64",
  "@palamedes/core-node-linux-arm64-gnu",
  "@palamedes/core-node-linux-x64-gnu",
  "@palamedes/core-node-linux-x64-musl",
  "@palamedes/core-node-win32-x64-msvc",
] as const

function getPlatformTriple(): string {
  const libc = detectLinuxLibc()
  return libc
    ? `${process.platform}-${process.arch}-${libc}`
    : `${process.platform}-${process.arch}`
}

function getNativePackageName(): string {
  const linuxLibc = detectLinuxLibc()

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@palamedes/core-node-darwin-arm64"
  }

  if (process.platform === "linux" && process.arch === "x64" && linuxLibc === "gnu") {
    return "@palamedes/core-node-linux-x64-gnu"
  }

  if (process.platform === "linux" && process.arch === "x64" && linuxLibc === "musl") {
    return "@palamedes/core-node-linux-x64-musl"
  }

  if (process.platform === "linux" && process.arch === "arm64" && linuxLibc === "gnu") {
    return "@palamedes/core-node-linux-arm64-gnu"
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "@palamedes/core-node-win32-x64-msvc"
  }

  throw new Error(
    `No Palamedes native bindings package is available for ${getPlatformTriple()}. Supported packages: ${SUPPORTED_NATIVE_PACKAGES.join(", ")}. If you need to build from source, run \`cargo build --workspace\` in the Palamedes repository.`
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
  const result = native.updateCatalogFile(toNativeUpdateRequest(request))
  return {
    ...result,
    diagnostics: mapCatalogDiagnostics(result.diagnostics),
  }
}

export function parseCatalog(request: CatalogParseRequest): CatalogParseResult {
  const result = native.parseCatalog(toNativeParseRequest(request))
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
    config: toNativeArtifactConfig(config),
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

export function combineCatalogFiles(request: CatalogFileCombineRequest): CatalogFileCombineResult {
  const result = native.combineCatalogFiles(toNativeFileCombineRequest(request))
  return {
    ...result,
    format: fromNativeFileFormat(result.format),
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
  strategy: CatalogConflictStrategy
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

function toNativeFileCombineRequest(
  request: CatalogFileCombineRequest
): NativeCatalogFileCombineRequest {
  return {
    inputPaths: request.inputPaths,
    outputPath: request.outputPath,
    format: request.format ? toNativeFileFormat(request.format) : undefined,
    sourceLocale: request.sourceLocale,
    locale: request.locale,
    conflictStrategy: request.conflictStrategy
      ? toNativeConflictStrategy(request.conflictStrategy)
      : undefined,
  }
}

function toNativeFileFormat(
  format: CatalogFileFormat
): NonNullable<NativeCatalogFileCombineRequest["format"]> {
  switch (format) {
    case "po": {
      return "Po"
    }
    case "fcl": {
      return "Fcl"
    }
  }
}

function toNativeConfigFormat(
  format: CatalogConfigFormat
): NonNullable<GeneratedCatalogArtifactCatalogConfig["format"]> {
  return toNativeFileFormat(format)
}

function toNativeUpdateRequest(request: CatalogUpdateRequest): NativeCatalogUpdateRequest {
  return {
    ...request,
    format: request.format ? toNativeConfigFormat(request.format) : undefined,
  }
}

function toNativeParseRequest(request: CatalogParseRequest): NativeCatalogParseRequest {
  return {
    ...request,
    format: request.format ? toNativeConfigFormat(request.format) : undefined,
  }
}

function toNativeArtifactConfig(config: CatalogArtifactConfig): GeneratedCatalogArtifactConfig {
  return {
    ...config,
    catalogs: config.catalogs.map((catalog) => ({
      ...catalog,
      format: catalog.format ? toNativeConfigFormat(catalog.format) : undefined,
    })),
  }
}

function fromNativeFileFormat(
  format: GeneratedCatalogFileCombineResult["format"]
): CatalogFileFormat {
  switch (format) {
    case "Po": {
      return "po"
    }
    case "Fcl": {
      return "fcl"
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
    config: toNativeArtifactConfig(config),
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
    config: toNativeArtifactConfig(config),
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

export function compileCatalogModule(
  config: CatalogArtifactConfig,
  resourcePath: string,
  options: CatalogModuleOptions
): CatalogModuleResult {
  const request: NativeCatalogModuleRequest = {
    config: toNativeArtifactConfig(config),
    resourcePath,
    locale: options.locale,
    pseudoLocale: options.pseudoLocale,
    failOnMissing: options.failOnMissing ?? false,
    failOnCompileError: options.failOnCompileError ?? false,
    missingFailureHint: options.missingFailureHint,
    compileFailureHint: options.compileFailureHint,
    diagnosticsWarningHint: options.diagnosticsWarningHint,
  }
  return native.compileCatalogModule(request)
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
