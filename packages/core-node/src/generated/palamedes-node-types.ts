// This file is generated from crates/palamedes-node via napi-rs typegen.
// Do not edit by hand. Run `pnpm --filter @palamedes/core-node generate-native-types`.

export interface CatalogOrigin {
  file: string;
  line: number;
}
export interface CatalogUpdateMessage {
  message: string;
  context?: string;
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
  diagnostics: Array<string>;
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
}
export interface CatalogParseResult {
  locale?: string;
  headers: Record<string, string>;
  messages: Array<ParsedCatalogMessage>;
  diagnostics: Array<string>;
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
export interface NativeTransformResult {
  code: string;
  hasChanged: boolean;
  compiledIds: Array<string>;
  edits: Array<NativeTransformEdit>;
  prependText?: string;
}

export interface NativeBindings {
  updateCatalogFile(request: CatalogUpdateRequest): CatalogUpdateResult;
  parseCatalog(request: CatalogParseRequest): CatalogParseResult;
  compileCatalogArtifact(request: CatalogArtifactRequest): CatalogArtifactResult;
  compileCatalogArtifactSelected(request: CatalogArtifactSelectedRequest): CatalogArtifactResult;
  extractMessages(source: string, filename: string): Array<NativeExtractedMessage>;
  getNativeInfo(): NativeInfo;
  parsePo(source: string): ParsedPoFile;
  transformMacros(source: string, filename: string, options?: NativeTransformOptions | undefined | null): NativeTransformResult;
}
