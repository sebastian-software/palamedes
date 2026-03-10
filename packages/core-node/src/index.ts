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

export interface NativeTransformResult {
  code: string
  hasChanged: boolean
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

function loadNativeBindings(): NativeBindings {
  const require = createRequire(import.meta.url)
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const bindingPath = path.join(packageDir, "palamedes-node.node")

  try {
    return require(bindingPath) as NativeBindings
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load Palamedes native bindings from ${bindingPath}: ${message}`
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
