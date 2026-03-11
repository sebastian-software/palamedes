import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

export interface NativeInfo {
  palamedesVersion: string
  pofileVersion: string
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

export interface NativeExtractedMessage {
  id: string
  message?: string
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

interface NativeBindings {
  getNativeInfoJson(): string
  generateMessageId(message: string, context?: string): string
  parsePoJson(source: string): string
  extractMessagesJson(source: string, filename: string): string
  transformMacrosJson(
    source: string,
    filename: string,
    optionsJson?: string
  ): string
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
  return JSON.parse(native.getNativeInfoJson()) as NativeInfo
}

export function generateMessageId(message: string, context?: string): string {
  return native.generateMessageId(message, context)
}

export function parsePo(source: string): ParsedPoFile {
  return JSON.parse(native.parsePoJson(source)) as ParsedPoFile
}

export function extractMessagesNative(
  source: string,
  filename: string
): NativeExtractedMessage[] {
  return JSON.parse(native.extractMessagesJson(source, filename)) as NativeExtractedMessage[]
}

export function transformMacrosNative(
  source: string,
  filename: string,
  options?: NativeTransformOptions
): NativeTransformResult {
  return JSON.parse(
    native.transformMacrosJson(
      source,
      filename,
      options ? JSON.stringify(options) : undefined
    )
  ) as NativeTransformResult
}
