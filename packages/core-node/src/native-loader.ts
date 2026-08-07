import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { NativeBindings, NativeInfo } from "./generated/palamedes-node-types"

const SUPPORTED_NATIVE_PACKAGES = [
  "@palamedes/core-node-darwin-arm64",
  "@palamedes/core-node-linux-arm64-gnu",
  "@palamedes/core-node-linux-x64-gnu",
  "@palamedes/core-node-linux-x64-musl",
  "@palamedes/core-node-win32-x64-msvc",
] as const

function detectLinuxLibc(): "gnu" | "musl" | null {
  if (process.platform !== "linux") {
    return null
  }

  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] }
    | undefined
  const glibcVersion = report?.header?.glibcVersionRuntime

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

type ModuleLoader = (specifier: string) => unknown

export type LoadNativeBindingsOptions = {
  packageDir?: string
  nativePackageName?: string
  require?: ModuleLoader
}

function packageVersion(require: ModuleLoader, packageDir: string): string {
  const manifest = require(path.join(packageDir, "package.json")) as { version?: unknown }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`Unable to read the @palamedes/core-node version from ${packageDir}.`)
  }
  return manifest.version
}

export function assertNativeBindingVersion(
  wrapperVersion: string,
  nativePackageName: string,
  nativeInfo: NativeInfo
): void {
  const nativeVersion = nativeInfo.palamedesVersion
  if (nativeVersion === wrapperVersion) {
    return
  }

  throw new Error(
    `Palamedes native binding version mismatch: @palamedes/core-node@${wrapperVersion} loaded ${nativePackageName} with native version ${nativeVersion || "<missing>"}. Reinstall @palamedes/core-node so its exact optional platform dependency is refreshed, or install matching ${nativePackageName}@${wrapperVersion}.`
  )
}

function isWellFormed(value: string): boolean {
  const nativeIsWellFormed = (
    String.prototype as unknown as { isWellFormed?: (this: string) => boolean }
  ).isWellFormed
  if (typeof nativeIsWellFormed === "function") {
    return nativeIsWellFormed.call(value)
  }

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 55_296 && codeUnit <= 56_319) {
      const next = value.charCodeAt(index + 1)
      if (next < 56_320 || next > 57_343) return false
      index += 1
    } else if (codeUnit >= 56_320 && codeUnit <= 57_343) {
      return false
    }
  }
  return true
}

export function assertWellFormedNativeArguments(operation: string, arguments_: unknown[]): void {
  const seen = new WeakSet<object>()
  const pending = arguments_
    .map((value, index) => ({
      value,
      path: { segment: `${operation}.argument[${index}]` },
    }))
    .reverse()

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    const { path: currentPath, value } = current

    if (typeof value === "string") {
      if (!isWellFormed(value)) {
        const field = formatNativeArgumentPath(currentPath)
        throw new TypeError(
          `Palamedes native boundary rejected malformed Unicode in ${field}; replace the unpaired UTF-16 surrogate before calling ${operation}.`
        )
      }
      continue
    }
    if (value === null || typeof value !== "object" || seen.has(value)) {
      continue
    }

    seen.add(value)
    if (value instanceof Map) {
      const mapEntries = [...value.entries()]
      for (let index = mapEntries.length - 1; index >= 0; index -= 1) {
        const [key, entry] = mapEntries[index] ?? []
        pending.push({
          value: entry,
          path: appendNativeArgumentPath(currentPath, mapValuePath(key)),
        })
        pending.push({ value: key, path: appendNativeArgumentPath(currentPath, ".<key>") })
      }
      continue
    }
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: value[index],
          path: appendNativeArgumentPath(currentPath, `[${index}]`),
        })
      }
      continue
    }
    const objectEntries = Object.entries(value)
    for (let index = objectEntries.length - 1; index >= 0; index -= 1) {
      const [key, entry] = objectEntries[index] ?? []
      pending.push({ value: entry, path: appendNativeArgumentPath(currentPath, `.${key}`) })
      pending.push({ value: key, path: appendNativeArgumentPath(currentPath, ".<key>") })
    }
  }
}

type NativeArgumentPath = {
  parent?: NativeArgumentPath
  segment: string
}

function appendNativeArgumentPath(parent: NativeArgumentPath, segment: string): NativeArgumentPath {
  return { parent, segment }
}

function formatNativeArgumentPath(argumentPath: NativeArgumentPath): string {
  const segments: string[] = []
  for (
    let current: NativeArgumentPath | undefined = argumentPath;
    current;
    current = current.parent
  ) {
    segments.push(current.segment)
  }
  return segments.reverse().join("")
}

function mapValuePath(key: unknown): string {
  if (typeof key === "string") {
    return `.get(${key})`
  }
  return ".<map value>"
}

function guardNativeBindings(bindings: NativeBindings): NativeBindings {
  return new Proxy(bindings, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof property !== "string" || typeof value !== "function") {
        return value
      }
      return (...arguments_: unknown[]) => {
        assertWellFormedNativeArguments(property, arguments_)
        return Reflect.apply(value, target, arguments_)
      }
    },
  })
}

export function loadNativeBindings(options: LoadNativeBindingsOptions = {}): NativeBindings {
  const require = options.require ?? createRequire(import.meta.url)
  const packageDir =
    options.packageDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const nativePackageName = options.nativePackageName ?? getNativePackageName()
  let bindings: NativeBindings

  try {
    bindings = require(nativePackageName) as NativeBindings
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load Palamedes native bindings from ${nativePackageName} for ${getPlatformTriple()} in package ${packageDir}: ${message}. Supported packages: ${SUPPORTED_NATIVE_PACKAGES.join(", ")}.`,
      { cause: error }
    )
  }

  assertNativeBindingVersion(
    packageVersion(require, packageDir),
    nativePackageName,
    bindings.getNativeInfo()
  )
  return guardNativeBindings(bindings)
}
