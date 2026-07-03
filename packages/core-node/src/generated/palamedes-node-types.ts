// This file is generated from crates/palamedes-node via napi-rs typegen.
// Do not edit by hand. Run `pnpm --filter @palamedes/core-node generate-native-types`.

export interface CatalogOrigin {
  file: string;
  line: number;
  scope?: string;
}
export interface ParsedCatalogOrigin {
  file: string;
  scope?: string;
}
export interface CatalogUpdateMessage {
  message: string;
  context?: string;
  placeholders?: Record<string, Array<string>>;
  extractedComments: Array<string>;
  origins: Array<CatalogOrigin>;
}
export interface CatalogUpdateRequest {
  targetPath: string;
  locale: string;
  sourceLocale: string;
  clean: boolean;
  forceClean?: boolean;
  format?: CatalogConfigFormat;
  messages: Array<CatalogUpdateMessage>;
}
export interface CatalogUpdateStats {
  total: number;
  added: number;
  changed: number;
  unchanged: number;
  obsoleteMarked: number;
  obsoleteRemoved: number;
}
export interface CatalogUpdateResult {
  created: boolean;
  updated: boolean;
  stats: CatalogUpdateStats;
  diagnostics: Array<CatalogDiagnostic>;
}
export interface CatalogParseRequest {
  targetPath: string;
  locale: string;
  sourceLocale: string;
  format?: CatalogConfigFormat;
}
export interface ParsedCatalogMessage {
  message: string;
  context?: string;
  comments: Array<string>;
  origins: Array<ParsedCatalogOrigin>;
  obsolete: boolean;
  translated: boolean;
  machine?: MachineMetadata;
}
export interface MachineMetadata {
  lock: string;
  ai?: AiProvenance;
}
export interface AiProvenance {
  model: string;
  confidence?: number;
}
export interface CatalogParseResult {
  locale?: string;
  headers: Record<string, string>;
  messages: Array<ParsedCatalogMessage>;
  diagnostics: Array<CatalogDiagnostic>;
}
export interface CatalogCombineInput {
  content: string;
  label?: string;
}
export type CatalogConflictStrategy = "UseFirst" | "UseLast" | "Error"
export type CatalogCombineSelectionName = "All" | "Unique"
export interface CatalogCombineSelectionThreshold {
  moreThan?: number;
  lessThan?: number;
}
export interface CatalogCombineRequest {
  inputs: Array<CatalogCombineInput>;
  sourceLocale: string;
  locale?: string;
  conflictStrategy?: CatalogConflictStrategy;
  selection?: CatalogCombineSelectionName | CatalogCombineSelectionThreshold;
  includeObsolete?: boolean;
}
export interface CatalogCombineStats {
  inputs: number;
  definitions: number;
  selected: number;
  skipped: number;
  conflictsResolved: number;
  total: number;
}
export interface CatalogCombineResult {
  content: string;
  stats: CatalogCombineStats;
  diagnostics: Array<CatalogDiagnostic>;
}
export type CatalogFileFormat = "Po" | "Fcl"
export interface CatalogFileCombineRequest {
  inputPaths: Array<string>;
  outputPath: string;
  format?: CatalogFileFormat;
  sourceLocale: string;
  locale?: string;
  conflictStrategy?: CatalogConflictStrategy;
}
export interface CatalogFileCombineResult {
  outputPath: string;
  format: CatalogFileFormat;
  stats: CatalogCombineStats;
  diagnostics: Array<CatalogDiagnostic>;
}
export type CatalogDiagnosticSeverity = "Info" | "Warning" | "Error"
export interface CatalogDiagnosticSourceKey {
  message: string;
  context?: string;
}
export interface CatalogDiagnostic {
  severity: CatalogDiagnosticSeverity;
  code: string;
  message: string;
  sourceKey?: CatalogDiagnosticSourceKey;
}
export interface CatalogAuditCheckOptions {
  completeness?: boolean;
  extraMessages?: boolean;
  icuSyntax?: boolean;
  icuCompatibility?: boolean;
  semanticMetadata?: boolean;
  obsoleteEntries?: boolean;
}
export interface CatalogAuditRequest {
  config: CatalogArtifactConfig;
  locales?: Array<string>;
  checks?: CatalogAuditCheckOptions;
  metadata?: Array<MessageMetadataInput>;
}
export interface CatalogAuditSummary {
  sourceMessages: number;
  targetLocales: number;
  diagnostics: number;
  errors: number;
  warnings: number;
  infos: number;
}
export interface CatalogAuditDiagnostic {
  severity: CatalogDiagnosticSeverity;
  code: string;
  message: string;
  catalogPath: string;
  locale?: string;
  sourceKey?: CatalogDiagnosticSourceKey;
  name?: string;
}
export interface CatalogAuditResult {
  summary: CatalogAuditSummary;
  diagnostics: Array<CatalogAuditDiagnostic>;
}
export interface MessageMetadataInput {
  msgid: string;
  msgctxt?: string;
  description?: string;
  origin: Array<MessageOriginMetadata>;
  args?: Record<string, MessageArgumentKind | MessageArgumentMetadata>;
  tags?: Array<string>;
  selectors?: Record<string, MessageSelectorMetadata>;
}
export interface MessageMetadata {
  msgid: string;
  msgctxt?: string;
  description?: string;
  origin: Array<MessageOriginMetadata>;
  args: Record<string, MessageArgumentMetadata>;
  tags: Array<string>;
  selectors: Record<string, MessageSelectorMetadata>;
}
export interface MessageMetadataDiagnostic {
  severity: CatalogDiagnosticSeverity;
  code: string;
  message: string;
  name?: string;
}
export interface MessageMetadataValidationReport {
  diagnostics: Array<MessageMetadataDiagnostic>;
}
export interface MessageOriginMetadata {
  file?: string;
  line?: number;
  component?: string;
  route?: string;
}
export type MessageArgumentKind = "String" | "Number" | "Date" | "Time" | "Datetime" | "Boolean" | "Enum" | "List" | "Duration" | "RelativeTime" | "Name" | "Unknown"
export interface MessageArgumentMetadata {
  kind: MessageArgumentKind;
  role?: string;
  values: Array<string>;
  format?: MessageArgumentFormatMetadata;
}
export interface MessageArgumentFormatMetadata {
  style?: string;
  styleKind?: MessageFormatStyleKind;
}
export type MessageFormatStyleKind = "None" | "Predefined" | "Skeleton" | "Pattern"
export interface MessageSelectorMetadata {
  kind: MessageSelectorKind;
  cases: Array<string>;
  offset?: number;
}
export type MessageSelectorKind = "Select" | "Plural" | "Selectordinal"
export interface CatalogArtifactSourceKey {
  message: string;
  context?: string;
}
export type CatalogArtifactDiagnosticSeverity = "Info" | "Warning" | "Error"
export interface CatalogArtifactMissingMessage {
  compiledId: string;
  sourceKey: CatalogArtifactSourceKey;
  requestedLocale: string;
  resolvedLocale?: string;
}
export interface CatalogArtifactDiagnostic {
  severity: CatalogArtifactDiagnosticSeverity;
  code: string;
  message: string;
  compiledId: string;
  sourceKey: CatalogArtifactSourceKey;
  locale: string;
}
export interface CatalogArtifactResult {
  messages: Record<string, string>;
  watchFiles: Array<string>;
  missing: Array<CatalogArtifactMissingMessage>;
  diagnostics: Array<CatalogArtifactDiagnostic>;
  resolvedLocaleChain?: Array<string>;
}
export interface CatalogModuleRequest {
  config: CatalogArtifactConfig;
  resourcePath: string;
  locale: string;
  pseudoLocale?: string;
  failOnMissing?: boolean;
  failOnCompileError?: boolean;
  missingFailureHint?: string;
  compileFailureHint?: string;
  diagnosticsWarningHint?: string;
}
export interface CatalogModuleResult {
  code: string;
  warnings: Array<string>;
  watchFiles: Array<string>;
}
export interface CatalogArtifactCatalogConfig {
  path: string;
  format?: CatalogConfigFormat;
  include: Array<string>;
  exclude?: Array<string>;
}
export type CatalogConfigFormat = "Po" | "Fcl"
export interface CatalogArtifactConfig {
  rootDir: string;
  locales: Array<string>;
  sourceLocale: string;
  fallbackLocales?: Array<string> | Record<string, Array<string>>;
  pseudoLocale?: string;
  catalogs: Array<CatalogArtifactCatalogConfig>;
}
export interface CatalogArtifactRequest {
  config: CatalogArtifactConfig;
  resourcePath: string;
}
export interface CatalogArtifactSelectedRequest {
  config: CatalogArtifactConfig;
  resourcePath: string;
  compiledIds: Array<string>;
}
export interface ExtractedMessageOrigin {
  filename: string;
  line: number;
  column?: number;
  scope?: string;
}
export interface NativeExtractedMessage {
  message: string;
  comment?: string;
  context?: string;
  placeholders?: Record<string, string>;
  origin: ExtractedMessageOrigin;
}
export interface ExtractCatalogMessagesRequest {
  rootDir: string;
  files: Array<string>;
}
export interface ExtractCatalogFileFailure {
  path: string;
  message: string;
}
export interface ExtractCatalogMessagesResult {
  messages: Array<CatalogUpdateMessage>;
  fileCount: number;
  failedFiles: Array<ExtractCatalogFileFailure>;
}
export interface NativeInfo {
  palamedesVersion: string;
  ferrocatVersion: string;
}
export interface ParsedPoItem {
  msgid: string;
  msgctxt?: string;
  references: Array<string>;
  msgidPlural?: string;
  msgstr: Array<string>;
  comments: Array<string>;
  extractedComments: Array<string>;
  flags: Record<string, boolean>;
  metadata: Record<string, string>;
  obsolete: boolean;
  nplurals: number;
}
export interface ParsedPoFile {
  comments: Array<string>;
  extractedComments: Array<string>;
  headers: Record<string, string>;
  headerOrder: Array<string>;
  items: Array<ParsedPoItem>;
}
export interface NativeTransformOptions {
  runtimeModule?: string;
  runtimeImportName?: string;
  stripNonEssentialProps?: boolean;
  stripMessageField?: boolean;
}
export interface NativeTransformEdit {
  start: number;
  end: number;
  text: string;
}
export interface NativeTransformSourceMap {
  version: number;
  sources: Array<string>;
  sourcesContent?: Array<string | undefined | null>;
  names: Array<string>;
  mappings: string;
  file?: string;
}
export interface NativeTransformResult {
  code: string;
  hasChanged: boolean;
  compiledIds: Array<string>;
  edits: Array<NativeTransformEdit>;
  map?: NativeTransformSourceMap;
  prependText?: string;
}

export interface NativeBindings {
  updateCatalogFile(request: CatalogUpdateRequest): CatalogUpdateResult;
  parseCatalog(request: CatalogParseRequest): CatalogParseResult;
  auditCatalogs(request: CatalogAuditRequest): CatalogAuditResult;
  deriveMessageMetadata(message: string, context?: string | undefined | null): MessageMetadata;
  normalizeMessageMetadata(input: MessageMetadataInput): MessageMetadata;
  validateMessageMetadata(input: MessageMetadataInput): MessageMetadataValidationReport;
  combineCatalogs(request: CatalogCombineRequest): CatalogCombineResult;
  combineCatalogFiles(request: CatalogFileCombineRequest): CatalogFileCombineResult;
  compileCatalogArtifact(request: CatalogArtifactRequest): CatalogArtifactResult;
  compileCatalogModule(request: CatalogModuleRequest): CatalogModuleResult;
  compileCatalogArtifactSelected(request: CatalogArtifactSelectedRequest): CatalogArtifactResult;
  extractMessages(source: string, filename: string): Array<NativeExtractedMessage>;
  extractCatalogMessagesFromFiles(request: ExtractCatalogMessagesRequest): ExtractCatalogMessagesResult;
  getNativeInfo(): NativeInfo;
  parsePo(source: string): ParsedPoFile;
  transformMacros(source: string, filename: string, options?: NativeTransformOptions | undefined | null): NativeTransformResult;
}
