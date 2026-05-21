// This file is generated from crates/palamedes-node via napi-rs typegen.
// Do not edit by hand. Run `pnpm --filter @palamedes/core-node generate-native-types`.

export interface CatalogOrigin {
  file: string;
  line: number;
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
}
export interface ParsedCatalogMessage {
  message: string;
  context?: string;
  comments: Array<string>;
  origins: Array<CatalogOrigin>;
  obsolete: boolean;
  machineTranslation?: MachineTranslationMetadata;
}
export interface MachineTranslationMetadata {
  model: string;
  modified?: string;
  confidence?: number;
  hash: string;
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
export type CatalogCombineConflictStrategy = "UseFirst" | "UseLast" | "Error"
export type CatalogCombineSelectionName = "All" | "Unique"
export interface CatalogCombineSelectionThreshold {
  moreThan?: number;
  lessThan?: number;
}
export interface CatalogCombineRequest {
  inputs: Array<CatalogCombineInput>;
  sourceLocale: string;
  locale?: string;
  conflictStrategy?: CatalogCombineConflictStrategy;
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
export type CatalogMergeFormat = "Po" | "Json"
export type CatalogMergeStrategy = "UseFirst"
export interface CatalogMergeRequest {
  inputPaths: Array<string>;
  outputPath: string;
  format?: CatalogMergeFormat;
  sourceLocale: string;
  locale?: string;
  strategy?: CatalogMergeStrategy;
}
export interface CatalogMergeResult {
  outputPath: string;
  format: CatalogMergeFormat;
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
  fuzzyFlags?: boolean;
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
export interface CatalogArtifactCatalogConfig {
  path: string;
  include: Array<string>;
  exclude?: Array<string>;
}
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
}
export interface NativeExtractedMessage {
  message: string;
  comment?: string;
  context?: string;
  placeholders?: Record<string, string>;
  origin: ExtractedMessageOrigin;
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
  mergeCatalogFiles(request: CatalogMergeRequest): CatalogMergeResult;
  compileCatalogArtifact(request: CatalogArtifactRequest): CatalogArtifactResult;
  compileCatalogArtifactSelected(request: CatalogArtifactSelectedRequest): CatalogArtifactResult;
  extractMessages(source: string, filename: string): Array<NativeExtractedMessage>;
  getNativeInfo(): NativeInfo;
  parsePo(source: string): ParsedPoFile;
  transformMacros(source: string, filename: string, options?: NativeTransformOptions | undefined | null): NativeTransformResult;
}
