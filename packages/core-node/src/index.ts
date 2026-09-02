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
  CatalogThreeWayMergeRequest as GeneratedCatalogThreeWayMergeRequest,
  CatalogFileThreeWayMergeRequest as GeneratedCatalogFileThreeWayMergeRequest,
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
  NativeMdxAnalysisResult as GeneratedNativeMdxAnalysisResult,
  NativeMdxDiagnostic as GeneratedNativeMdxDiagnostic,
  NativeMdxFramework as GeneratedNativeMdxFramework,
  NativeMdxOptions as GeneratedNativeMdxOptions,
  NativeMdxSourceRange as GeneratedNativeMdxSourceRange,
  NativeSourceAnalysisResult as GeneratedNativeSourceAnalysisResult,
  NativeSourceAnalysisOptions as GeneratedNativeSourceAnalysisOptions,
  NativeSourceDiagnostic as GeneratedNativeSourceDiagnostic,
  NativeSourceRange as GeneratedNativeSourceRange,
  NativeSourceRuleOptions as GeneratedNativeSourceRuleOptions,
  NativeTransformEdit as GeneratedNativeTransformEdit,
  NativeTransformOptions as GeneratedNativeTransformOptions,
  NativeTransformResult as GeneratedNativeTransformResult,
  NativeTransformSourceMap as GeneratedNativeTransformSourceMap,
  ParsedCatalogMessage as GeneratedParsedCatalogMessage,
  ParsedPoFile as GeneratedParsedPoFile,
  ParsedPoItem as GeneratedParsedPoItem,
  TranslationCandidate as GeneratedTranslationCandidate,
  TranslationCandidateId as GeneratedTranslationCandidateId,
  TranslationCandidateRequest as GeneratedTranslationCandidateRequest,
  TranslationCandidateResult as GeneratedTranslationCandidateResult,
  TranslationPatch as GeneratedTranslationPatch,
  TranslationPatchOutcome as GeneratedTranslationPatchOutcome,
  TranslationPatchRequest as GeneratedTranslationPatchRequest,
  TranslationPatchResult as GeneratedTranslationPatchResult,
  TranslationValue as GeneratedTranslationValue,
} from "./generated/palamedes-node-types"

import {
  coordinateInitialCatalogBuild,
  selectedCatalogBuildKey,
} from "./catalogCompilationCoordinator"
import { serializeCatalogMutation, translationPatchTargetPaths } from "./catalogMutationQueue"
import { loadNativeBindings, prepareNativeArgument, snapshotNativeArgument } from "./native-loader"

export type NativeInfo = GeneratedNativeInfo
export type AsyncTaskOptions = {
  /** Cancel the native task while it is still waiting for a libuv worker. */
  signal?: AbortSignal
}
export type ParsedPoItem = GeneratedParsedPoItem
export type ParsedPoFile = GeneratedParsedPoFile
export type CatalogOrigin = GeneratedCatalogOrigin
export type CatalogUpdateMessage = GeneratedCatalogUpdateMessage
export type CatalogUpdateStats = GeneratedCatalogUpdateStats
export type ExtractCatalogFileFailure = GeneratedExtractCatalogFileFailure
export type ExtractCatalogMessagesRequest = Omit<GeneratedExtractCatalogMessagesRequest, "mdx"> & {
  mdx?: MdxOptions
}
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
export type TranslationCandidateId = GeneratedTranslationCandidateId
export type TranslationPluralKind = "cardinal" | "ordinal"
export type TranslationValue =
  | { kind: "singular"; value: string }
  | {
      kind: "plural"
      variable: string
      pluralKind: TranslationPluralKind
      offset: number
      values: Record<string, string>
    }
export type TranslationWorkflowOrigin = {
  file: string
  scope?: string
}
export type TranslationReviewState = {
  translated: boolean
  fuzzy: boolean
  obsolete: boolean
}
export type TranslationCandidate = Omit<
  GeneratedTranslationCandidate,
  "format" | "source" | "translation" | "origins"
> & {
  format: CatalogConfigFormat
  source: TranslationValue
  translation: TranslationValue
  origins: TranslationWorkflowOrigin[]
}
export type TranslationWorkflowDiagnostic = {
  code: string
  message: string
  id?: TranslationCandidateId
  catalogPath?: string
  locale?: string
}
export type TranslationCandidateRequest = {
  config: CatalogArtifactConfig
  locales?: string[]
  targets?: TranslationCandidateId[]
  maxOrigins?: number
}
export type TranslationCandidateResult = {
  candidates: TranslationCandidate[]
  diagnostics: TranslationWorkflowDiagnostic[]
}
export type TranslationMachineProvenance = {
  ai?: {
    model: string
    confidence?: number
  }
}
export type TranslationPatch = {
  id: TranslationCandidateId
  fingerprint: string
  translation: TranslationValue
  machine?: TranslationMachineProvenance
}
export type TranslationPatchRequest = {
  config: CatalogArtifactConfig
  patches: TranslationPatch[]
  po?: PoOutputOptions
}
export type TranslationPatchOutcomeStatus = "applied" | "unchanged" | "rejected" | "notApplied"
export type TranslationPatchOutcome = Omit<GeneratedTranslationPatchOutcome, "status"> & {
  status: TranslationPatchOutcomeStatus
}
export type TranslationPatchResult = Omit<
  GeneratedTranslationPatchResult,
  "outcomes" | "diagnostics"
> & {
  outcomes: TranslationPatchOutcome[]
  diagnostics: TranslationWorkflowDiagnostic[]
}
export const TRANSLATION_PATCH_WRITE_ERROR_CODE = "ERR_PALAMEDES_TRANSLATION_PATCH_WRITE"
export const TRANSLATION_PATCH_WRITE_ERROR_MESSAGE =
  "Failed to replace a translation catalog; completed per-file outcomes are available in error.report."
export type TranslationPatchWriteError = Error & {
  code: typeof TRANSLATION_PATCH_WRITE_ERROR_CODE
  cause: Error
  report: TranslationPatchResult
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
export type CatalogThreeWayMergeRequest = {
  ancestor: CatalogCombineInput
  ours: CatalogCombineInput
  theirs: CatalogCombineInput
  format: CatalogFileFormat
  sourceLocale: string
  locale?: string
  conflictStrategy?: CatalogConflictStrategy
  po?: PoOutputOptions
}
export type CatalogConfigFormat = CatalogFileFormat
export type PoLineBreaks = "auto" | "off"
export type PoOutputOptions = {
  lineBreaks?: PoLineBreaks
}
export type CatalogUpdateRequest = Omit<GeneratedCatalogUpdateRequest, "format" | "po"> & {
  format?: CatalogConfigFormat
  po?: PoOutputOptions
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
  po?: PoOutputOptions
}
export type CatalogFileCombineResult = Omit<
  GeneratedCatalogFileCombineResult,
  "format" | "diagnostics"
> & {
  format: CatalogFileFormat
  diagnostics: CatalogDiagnostic[]
}
export type CatalogFileThreeWayMergeRequest = {
  ancestorPath: string
  oursPath: string
  theirsPath: string
  outputPath: string
  format?: CatalogFileFormat
  sourceLocale: string
  locale?: string
  conflictStrategy?: CatalogConflictStrategy
  po?: PoOutputOptions
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

export type NativeExtractedMessageOrigin = [filename: string, line: number, column?: number] & {
  scope?: string
}

export type NativeExtractedMessage = Omit<GeneratedNativeExtractedMessage, "origin"> & {
  origin: NativeExtractedMessageOrigin
}

export type MdxFramework = "react" | "solid"
export type MdxOptions = Omit<GeneratedNativeMdxOptions, "framework"> & {
  framework?: MdxFramework
}
export type MdxSourceRange = GeneratedNativeMdxSourceRange
export type MdxDiagnostic = GeneratedNativeMdxDiagnostic
export type MdxAnalysisResult = Omit<GeneratedNativeMdxAnalysisResult, "messages"> & {
  messages: NativeExtractedMessage[]
}

export type SourceRange = GeneratedNativeSourceRange
export type SourceDiagnosticSeverity = "error" | "warning" | "info"
export type SourceDiagnostic = Omit<GeneratedNativeSourceDiagnostic, "severity"> & {
  severity: SourceDiagnosticSeverity
}
export type SourceAnalysisResult = Omit<
  GeneratedNativeSourceAnalysisResult,
  "messages" | "diagnostics"
> & {
  messages: NativeExtractedMessage[]
  diagnostics: SourceDiagnostic[]
}
export type SourceRuleLevel = "off" | "info" | "warning" | "error"
export type SourceRuleOptions = Omit<
  GeneratedNativeSourceRuleOptions,
  "placeholderOnly" | "emptyComponentOnly" | "preferTransInJsx"
> & {
  placeholderOnly?: SourceRuleLevel
  emptyComponentOnly?: SourceRuleLevel
  preferTransInJsx?: SourceRuleLevel
}
export type SourceAnalysisOptions = Omit<GeneratedNativeSourceAnalysisOptions, "mdx" | "rules"> & {
  mdx?: MdxOptions
  rules?: SourceRuleOptions
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
type NativeCatalogThreeWayMergeRequest = GeneratedCatalogThreeWayMergeRequest
type NativeCatalogFileThreeWayMergeRequest = GeneratedCatalogFileThreeWayMergeRequest
type NativeCatalogArtifactRequest = GeneratedCatalogArtifactRequest
type NativeCatalogArtifactSelectedRequest = GeneratedCatalogArtifactSelectedRequest
type NativeCatalogModuleRequest = GeneratedCatalogModuleRequest
type NativeCatalogUpdateRequest = GeneratedCatalogUpdateRequest
type NativeCatalogParseRequest = GeneratedCatalogParseRequest
type NativeTranslationCandidateRequest = GeneratedTranslationCandidateRequest
type NativeTranslationPatchRequest = GeneratedTranslationPatchRequest

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

// Exhaustive by construction: a severity added on the Rust side widens the
// generated union and turns this switch into a type error, which is the whole
// reason the boundary carries an enum rather than a bare string.
function mapNativeSourceDiagnosticSeverity(
  severity: GeneratedNativeSourceDiagnostic["severity"]
): SourceDiagnosticSeverity {
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
  return fromNativeCatalogUpdateResult(
    native.updateCatalogFile(toNativeUpdateRequest("updateCatalogFile", request))
  )
}

/** Run the catalog read/update/write cycle on Node's shared libuv worker pool. */
export async function updateCatalogFileAsync(
  request: CatalogUpdateRequest,
  options?: AsyncTaskOptions
): Promise<CatalogUpdateResult> {
  const nativeRequest = toNativeUpdateRequest("updateCatalogFileAsync", request)
  const result = await serializeCatalogMutation([nativeRequest.targetPath], () =>
    startAbortableNativeTask(options, (signal) =>
      native.updateCatalogFileAsync(nativeRequest, signal)
    )
  )
  return fromNativeCatalogUpdateResult(result)
}

function fromNativeCatalogUpdateResult(result: GeneratedCatalogUpdateResult): CatalogUpdateResult {
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

export function listTranslationCandidates(
  request: TranslationCandidateRequest
): TranslationCandidateResult {
  const nativeRequest: NativeTranslationCandidateRequest = {
    config: toNativeArtifactConfig(request.config),
    locales: request.locales,
    targets: request.targets,
    maxOrigins: request.maxOrigins,
  }
  const result: GeneratedTranslationCandidateResult =
    native.listTranslationCandidates(nativeRequest)
  return {
    candidates: result.candidates.map(fromNativeTranslationCandidate),
    diagnostics: result.diagnostics,
  }
}

export function applyTranslationPatches(request: TranslationPatchRequest): TranslationPatchResult {
  const nativeRequest = toNativeTranslationPatchRequest("applyTranslationPatches", request)
  try {
    const result: GeneratedTranslationPatchResult = native.applyTranslationPatches(nativeRequest)
    return fromNativeTranslationPatchResult(result)
  } catch (error) {
    throw mapTranslationPatchError(error)
  }
}

/** Run translation patch validation and catalog replacement on the libuv worker pool. */
export async function applyTranslationPatchesAsync(
  request: TranslationPatchRequest,
  options?: AsyncTaskOptions
): Promise<TranslationPatchResult> {
  const nativeRequest = toNativeTranslationPatchRequest("applyTranslationPatchesAsync", request)
  try {
    const result = await serializeCatalogMutation(translationPatchTargetPaths(nativeRequest), () =>
      startAbortableNativeTask(options, (signal) =>
        native.applyTranslationPatchesAsync(nativeRequest, signal)
      )
    )
    return fromNativeTranslationPatchResult(result)
  } catch (error) {
    throw mapTranslationPatchError(error)
  }
}

function toNativeTranslationPatchRequest(
  operation: string,
  request: TranslationPatchRequest
): NativeTranslationPatchRequest {
  const source = snapshotNativeArgument(operation, request)
  return prepareNativeArgument(operation, {
    config: toOwnedNativeArtifactConfig(source.config),
    patches: source.patches.map(toNativeTranslationPatch),
    po: toNativePoOptions(source.po),
  })
}

function mapTranslationPatchError(error: unknown): unknown {
  if (isNativeTranslationPatchWriteError(error)) {
    const writeError = error as unknown as TranslationPatchWriteError
    writeError.report = fromNativeTranslationPatchResult(error.report)
  }
  return error
}

export function isTranslationPatchWriteError(error: unknown): error is TranslationPatchWriteError {
  const candidate = error as { code?: unknown }
  return (
    error instanceof Error &&
    candidate.code === TRANSLATION_PATCH_WRITE_ERROR_CODE &&
    "report" in error
  )
}

type NativeTranslationPatchWriteError = Error & {
  code: typeof TRANSLATION_PATCH_WRITE_ERROR_CODE
  report: GeneratedTranslationPatchResult
}

function isNativeTranslationPatchWriteError(
  error: unknown
): error is NativeTranslationPatchWriteError {
  const candidate = error as { code?: unknown }
  return (
    error instanceof Error &&
    candidate.code === TRANSLATION_PATCH_WRITE_ERROR_CODE &&
    "report" in error
  )
}

function fromNativeTranslationPatchResult(
  result: GeneratedTranslationPatchResult
): TranslationPatchResult {
  return {
    ...result,
    outcomes: result.outcomes.map((outcome) => ({
      ...outcome,
      status: fromNativeTranslationPatchOutcomeStatus(outcome.status),
    })),
    diagnostics: result.diagnostics,
  }
}

function fromNativeTranslationCandidate(
  candidate: GeneratedTranslationCandidate
): TranslationCandidate {
  return {
    ...candidate,
    format: fromNativeFileFormat(candidate.format),
    source: fromNativeTranslationValue(candidate.source),
    translation: fromNativeTranslationValue(candidate.translation),
  }
}

function fromNativeTranslationValue(value: GeneratedTranslationValue): TranslationValue {
  switch (value.kind) {
    case "Singular": {
      if (value.value === undefined) {
        throw new TypeError("Native singular translation value is missing `value`.")
      }
      return { kind: "singular", value: value.value }
    }
    case "Plural": {
      if (
        value.variable === undefined ||
        value.pluralKind === undefined ||
        value.offset === undefined ||
        value.values === undefined
      ) {
        throw new TypeError("Native plural translation value is incomplete.")
      }
      return {
        kind: "plural",
        variable: value.variable,
        pluralKind: value.pluralKind === "Cardinal" ? "cardinal" : "ordinal",
        offset: value.offset,
        values: value.values,
      }
    }
  }
}

function toNativeTranslationPatch(patch: TranslationPatch): GeneratedTranslationPatch {
  const id = patch.id
  const machine = patch.machine
  const ai = machine?.ai
  return {
    id: {
      catalog: id.catalog,
      locale: id.locale,
      message: id.message,
      context: id.context,
    },
    fingerprint: patch.fingerprint,
    translation: toNativeTranslationValue(patch.translation),
    machine: machine
      ? {
          ai: ai
            ? {
                model: ai.model,
                confidence: ai.confidence,
              }
            : undefined,
        }
      : undefined,
  }
}

function toNativeTranslationValue(value: TranslationValue): GeneratedTranslationValue {
  switch (value.kind) {
    case "singular": {
      return { kind: "Singular", value: value.value }
    }
    case "plural": {
      return {
        kind: "Plural",
        variable: value.variable,
        pluralKind: value.pluralKind === "cardinal" ? "Cardinal" : "Ordinal",
        offset: value.offset,
        values: { ...value.values },
      }
    }
  }
}

function fromNativeTranslationPatchOutcomeStatus(
  status: GeneratedTranslationPatchOutcome["status"]
): TranslationPatchOutcomeStatus {
  switch (status) {
    case "Applied":
      return "applied"
    case "Unchanged":
      return "unchanged"
    case "Rejected":
      return "rejected"
    case "NotApplied":
      return "notApplied"
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
  const result = native.combineCatalogs(toNativeCombineRequest("combineCatalogs", request))
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

export function mergeCatalogsThreeWay(request: CatalogThreeWayMergeRequest): CatalogCombineResult {
  const result = native.mergeCatalogsThreeWay(toNativeThreeWayMergeRequest(request))
  return {
    ...result,
    diagnostics: mapCatalogDiagnostics(result.diagnostics),
  }
}

export function mergeCatalogFilesThreeWay(
  request: CatalogFileThreeWayMergeRequest
): CatalogFileCombineResult {
  const result = native.mergeCatalogFilesThreeWay(toNativeFileThreeWayMergeRequest(request))
  return {
    ...result,
    format: fromNativeFileFormat(result.format),
    diagnostics: mapCatalogDiagnostics(result.diagnostics),
  }
}

function toNativeCombineRequest(
  operation: string,
  request: CatalogCombineRequest
): NativeCatalogCombineRequest {
  const source = snapshotNativeArgument(operation, request)
  const conflictStrategy = source.conflictStrategy
  const selection = source.selection
  return prepareNativeArgument(operation, {
    inputs: source.inputs.map((input) => ({ content: input.content, label: input.label })),
    sourceLocale: source.sourceLocale,
    locale: source.locale,
    conflictStrategy: conflictStrategy ? toNativeConflictStrategy(conflictStrategy) : undefined,
    selection: selection ? toOwnedNativeSelection(selection) : undefined,
    includeObsolete: source.includeObsolete,
  })
}

function toNativeThreeWayMergeRequest(
  request: CatalogThreeWayMergeRequest
): NativeCatalogThreeWayMergeRequest {
  return {
    ancestor: request.ancestor,
    ours: request.ours,
    theirs: request.theirs,
    format: toNativeFileFormat(request.format),
    sourceLocale: request.sourceLocale,
    locale: request.locale,
    conflictStrategy: request.conflictStrategy
      ? toNativeConflictStrategy(request.conflictStrategy)
      : undefined,
    po: toNativePoOptions(request.po),
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
    po: toNativePoOptions(request.po),
  }
}

function toNativeFileThreeWayMergeRequest(
  request: CatalogFileThreeWayMergeRequest
): NativeCatalogFileThreeWayMergeRequest {
  return {
    ancestorPath: request.ancestorPath,
    oursPath: request.oursPath,
    theirsPath: request.theirsPath,
    outputPath: request.outputPath,
    format: request.format ? toNativeFileFormat(request.format) : undefined,
    sourceLocale: request.sourceLocale,
    locale: request.locale,
    conflictStrategy: request.conflictStrategy
      ? toNativeConflictStrategy(request.conflictStrategy)
      : undefined,
    po: toNativePoOptions(request.po),
  }
}

function toNativePoOptions(po: PoOutputOptions | undefined): NativeCatalogUpdateRequest["po"] {
  if (!po) {
    return undefined
  }
  const lineBreaks = po.lineBreaks
  return {
    lineBreaks: lineBreaks ? toNativePoLineBreaks(lineBreaks) : undefined,
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

function toNativeUpdateRequest(
  operation: string,
  request: CatalogUpdateRequest
): NativeCatalogUpdateRequest {
  const source = snapshotNativeArgument(operation, request)
  const format = source.format
  return prepareNativeArgument(operation, {
    targetPath: source.targetPath,
    locale: source.locale,
    sourceLocale: source.sourceLocale,
    clean: source.clean,
    forceClean: source.forceClean,
    format: format ? toNativeConfigFormat(format) : undefined,
    po: toNativePoOptions(source.po),
    messages: source.messages.map((message) => {
      const placeholders = message.placeholders
      return {
        message: message.message,
        context: message.context,
        placeholders: placeholders
          ? Object.fromEntries(
              Object.entries(placeholders).map(([name, values]) => [name, [...values]])
            )
          : undefined,
        extractedComments: [...message.extractedComments],
        origins: message.origins.map((origin) => ({
          file: origin.file,
          line: origin.line,
          scope: origin.scope,
        })),
      }
    }),
  })
}

function toNativePoLineBreaks(
  lineBreaks: PoLineBreaks
): NonNullable<NonNullable<NativeCatalogUpdateRequest["po"]>["lineBreaks"]> {
  switch (lineBreaks) {
    case "auto": {
      return "Auto"
    }
    case "off": {
      return "Off"
    }
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

function toOwnedNativeArtifactConfig(
  config: CatalogArtifactConfig
): GeneratedCatalogArtifactConfig {
  const fallbackLocales = config.fallbackLocales
  return {
    rootDir: config.rootDir,
    locales: [...config.locales],
    sourceLocale: config.sourceLocale,
    fallbackLocales: Array.isArray(fallbackLocales)
      ? [...fallbackLocales]
      : fallbackLocales
        ? Object.fromEntries(
            Object.entries(fallbackLocales).map(([locale, fallbacks]) => [locale, [...fallbacks]])
          )
        : undefined,
    pseudoLocale: config.pseudoLocale,
    catalogs: config.catalogs.map((catalog) => {
      const format = catalog.format
      const include = catalog.include
      const exclude = catalog.exclude
      return {
        path: catalog.path,
        format: format ? toNativeConfigFormat(format) : undefined,
        include: include ? [...include] : undefined,
        exclude: exclude ? [...exclude] : undefined,
      }
    }),
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

function toOwnedNativeSelection(
  selection: CatalogCombineSelection
): NonNullable<NativeCatalogCombineRequest["selection"]> {
  const nativeSelection = toNativeSelection(selection)
  return typeof nativeSelection === "object" ? { ...nativeSelection } : nativeSelection
}

function mapCatalogDiagnostics(diagnostics: GeneratedCatalogDiagnostic[]): CatalogDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    severity: mapNativeDiagnosticSeverity(diagnostic.severity),
  }))
}

function fromNativeCatalogArtifactResult(
  result: GeneratedCatalogArtifactResult
): CatalogArtifactResult {
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
    config: toNativeArtifactConfig(config),
    resourcePath,
  }
  return fromNativeCatalogArtifactResult(native.compileCatalogArtifact(request))
}

/** Compile a full catalog artifact on Node's shared libuv worker pool. */
export async function compileCatalogArtifactAsync(
  config: CatalogArtifactConfig,
  resourcePath: string,
  options?: AsyncTaskOptions
): Promise<CatalogArtifactResult> {
  const request: NativeCatalogArtifactRequest = {
    config: toNativeArtifactConfig(config),
    resourcePath,
  }
  return fromNativeCatalogArtifactResult(
    await startAbortableNativeTask(options, (signal) =>
      native.compileCatalogArtifactAsync(request, signal)
    )
  )
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
  return fromNativeCatalogArtifactResult(native.compileCatalogArtifactSelected(request))
}

/** Compile selected runtime IDs on Node's shared libuv worker pool. */
export async function compileCatalogArtifactSelectedAsync(
  config: CatalogArtifactConfig,
  resourcePath: string,
  compiledIds: string[],
  options?: AsyncTaskOptions
): Promise<CatalogArtifactResult> {
  const request: NativeCatalogArtifactSelectedRequest = {
    config: toOwnedNativeArtifactConfig(config),
    resourcePath,
    compiledIds: [...compiledIds],
  }
  const key = selectedCatalogBuildKey(request.config, request.resourcePath)
  return coordinateInitialCatalogBuild(key, async () =>
    fromNativeCatalogArtifactResult(
      await startAbortableNativeTask(options, (signal) =>
        native.compileCatalogArtifactSelectedAsync(request, signal)
      )
    )
  )
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

/** Compile and render a catalog module on Node's shared libuv worker pool. */
export async function compileCatalogModuleAsync(
  config: CatalogArtifactConfig,
  resourcePath: string,
  options: CatalogModuleOptions,
  taskOptions?: AsyncTaskOptions
): Promise<CatalogModuleResult> {
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
  return startAbortableNativeTask(taskOptions, (signal) =>
    native.compileCatalogModuleAsync(request, signal)
  )
}

/** Render an already-compiled message map through the canonical native generator. */
export function renderCatalogModule(messages: Record<string, string>): string {
  return native.renderCatalogModule(messages)
}

function mapExtractedMessages(
  messages: GeneratedNativeExtractedMessage[]
): NativeExtractedMessage[] {
  return messages.map((message) => {
    const origin: NativeExtractedMessageOrigin = [
      message.origin.filename,
      message.origin.line,
      message.origin.column,
    ]
    origin.scope = message.origin.scope

    return {
      ...message,
      origin,
    }
  })
}

export function extractMessagesNative(
  source: string,
  filename: string,
  options?: MdxOptions
): NativeExtractedMessage[] {
  return mapExtractedMessages(native.extractMessages(source, filename, toNativeMdxOptions(options)))
}

export function analyzeSourceNative(
  source: string,
  filename: string,
  options?: SourceAnalysisOptions
): SourceAnalysisResult {
  const nativeOptions: GeneratedNativeSourceAnalysisOptions | undefined = options
    ? {
        ...options,
        mdx: toNativeMdxOptions(options.mdx),
      }
    : undefined
  const result = native.analyzeSource(source, filename, nativeOptions)
  return {
    ...result,
    messages: mapExtractedMessages(result.messages),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      severity: mapNativeSourceDiagnosticSeverity(diagnostic.severity),
    })),
  }
}

export function analyzeMdxNative(
  source: string,
  filename: string,
  options?: MdxOptions
): MdxAnalysisResult {
  const result = native.analyzeMdx(source, filename, toNativeMdxOptions(options))
  return {
    ...result,
    messages: mapExtractedMessages(result.messages),
  }
}

function toNativeMdxOptions(options?: MdxOptions): GeneratedNativeMdxOptions | undefined {
  if (!options) {
    return undefined
  }
  const framework: GeneratedNativeMdxFramework | undefined =
    options?.framework === "solid" ? "Solid" : options?.framework === "react" ? "React" : undefined
  return {
    ...options,
    framework,
  }
}

export function extractCatalogMessagesFromFiles(
  request: ExtractCatalogMessagesRequest
): ExtractCatalogMessagesResult {
  return native.extractCatalogMessagesFromFiles({
    ...request,
    mdx: toNativeMdxOptions(request.mdx),
  })
}

/** Read and extract source files on Node's shared libuv worker pool. */
export async function extractCatalogMessagesFromFilesAsync(
  request: ExtractCatalogMessagesRequest,
  options?: AsyncTaskOptions
): Promise<ExtractCatalogMessagesResult> {
  return startAbortableNativeTask(options, (signal) =>
    native.extractCatalogMessagesFromFilesAsync(
      {
        ...request,
        mdx: toNativeMdxOptions(request.mdx),
      },
      signal
    )
  )
}

function startAbortableNativeTask<TResult>(
  options: AsyncTaskOptions | undefined,
  operation: (signal: AbortSignal | undefined) => Promise<TResult>
): Promise<TResult> {
  options?.signal?.throwIfAborted()
  return operation(options?.signal)
}

export function transformMacrosNative(
  source: string,
  filename: string,
  options?: NativeTransformOptions
): NativeTransformResult {
  return native.transformMacros(source, filename, options)
}
