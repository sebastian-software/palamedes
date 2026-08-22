import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { NativeBindings, NativeInfo } from "./generated/palamedes-node-types"

const SUPPORTED_NATIVE_PACKAGES = [
  "@palamedes/core-node-darwin-arm64",
  "@palamedes/core-node-darwin-x64",
  "@palamedes/core-node-linux-arm64-gnu",
  "@palamedes/core-node-linux-arm64-musl",
  "@palamedes/core-node-linux-x64-gnu",
  "@palamedes/core-node-linux-x64-musl",
  "@palamedes/core-node-win32-x64-msvc",
  "@palamedes/core-node-win32-arm64-msvc",
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

type NativePlatform = {
  platform?: NodeJS.Platform
  arch?: string
  linuxLibc?: "gnu" | "musl" | null
}

export function resolveNativePackageName(options: NativePlatform = {}): string {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const linuxLibc = options.linuxLibc === undefined ? detectLinuxLibc() : options.linuxLibc

  if (platform === "darwin" && arch === "arm64") {
    return "@palamedes/core-node-darwin-arm64"
  }
  if (platform === "darwin" && arch === "x64") {
    return "@palamedes/core-node-darwin-x64"
  }
  if (platform === "linux" && arch === "x64" && linuxLibc === "gnu") {
    return "@palamedes/core-node-linux-x64-gnu"
  }
  if (platform === "linux" && arch === "x64" && linuxLibc === "musl") {
    return "@palamedes/core-node-linux-x64-musl"
  }
  if (platform === "linux" && arch === "arm64" && linuxLibc === "gnu") {
    return "@palamedes/core-node-linux-arm64-gnu"
  }
  if (platform === "linux" && arch === "arm64" && linuxLibc === "musl") {
    return "@palamedes/core-node-linux-arm64-musl"
  }
  if (platform === "win32" && arch === "x64") {
    return "@palamedes/core-node-win32-x64-msvc"
  }
  if (platform === "win32" && arch === "arm64") {
    return "@palamedes/core-node-win32-arm64-msvc"
  }

  throw new Error(
    `No Palamedes native bindings package is available for ${platform}-${arch}${linuxLibc ? `-${linuxLibc}` : ""}. Supported packages: ${SUPPORTED_NATIVE_PACKAGES.join(", ")}. If you need to build from source, run \`cargo build --workspace\` in the Palamedes repository.`
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
      if (index + 1 >= value.length) return false
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
  snapshotNativeArguments(operation, arguments_)
}

/**
 * Read, validate, and normalize arguments before the N-API boundary. The
 * binding receives only this snapshot, so an accessor or Proxy cannot return a
 * different string after it has passed Unicode validation.
 */
export function snapshotNativeArguments(operation: string, arguments_: unknown[]): unknown[] {
  const snapshots = new Map<object, unknown>()
  const result: unknown[] = Array.from({ length: arguments_.length })
  const pending: SnapshotTask[] = arguments_
    .map((value, index) => ({
      kind: "value" as const,
      value,
      path: { segment: `${operation}.argument[${index}]` },
      assign(snapshot: unknown) {
        result[index] = snapshot
      },
    }))
    .reverse()

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue

    if (current.kind === "property") {
      let propertyValue: unknown
      try {
        propertyValue = Reflect.get(current.source, current.key)
      } catch (error) {
        throw nativeBoundaryReadError(current.path, error)
      }
      pending.push({
        kind: "value",
        value: propertyValue,
        path: current.path,
        assign: current.assign,
      })
      continue
    }

    const { path: currentPath, value } = current

    if (typeof value === "string") {
      if (!isWellFormed(value)) {
        const field = formatNativeArgumentPath(currentPath)
        throw new TypeError(
          `Palamedes native boundary rejected malformed Unicode in ${field}; replace the unpaired UTF-16 surrogate before calling ${operation}.`
        )
      }
      current.assign(value)
      continue
    }
    if (value === null || typeof value !== "object") {
      current.assign(value)
      continue
    }

    const existingSnapshot = snapshots.get(value)
    if (existingSnapshot !== undefined) {
      current.assign(existingSnapshot)
      continue
    }

    const classification = classifySnapshotObject(value, currentPath)
    if (classification.kind === "map") {
      throw nativeBoundaryUnsupportedMapError(currentPath)
    }
    if (classification.kind === "array") {
      const arraySnapshot: unknown[] = []
      arraySnapshot.length = classification.length
      snapshots.set(value, arraySnapshot)
      current.assign(arraySnapshot)
      for (const key of enumerablePropertyNames(value, currentPath).reverse()) {
        const propertyPath = appendNativeArgumentPath(currentPath, arrayPropertyPath(key))
        assertWellFormedPropertyName(key, propertyPath)
        pending.push({
          kind: "property",
          source: value,
          key,
          path: propertyPath,
          assign(snapshotValue: unknown) {
            defineSnapshotProperty(arraySnapshot, key, snapshotValue)
          },
        })
      }
      continue
    }

    const recordSnapshot: Record<string, unknown> = {}
    snapshots.set(value, recordSnapshot)
    current.assign(recordSnapshot)
    for (const key of nativeVisiblePropertyNames(value, classification, currentPath).reverse()) {
      const propertyPath = appendNativeArgumentPath(currentPath, `.${key}`)
      assertWellFormedPropertyName(key, propertyPath)
      pending.push({
        kind: "property",
        source: value,
        key,
        path: propertyPath,
        assign(snapshotValue: unknown) {
          defineSnapshotProperty(recordSnapshot, key, snapshotValue)
        },
      })
    }
  }

  return result
}

type SnapshotTask =
  | {
      kind: "value"
      value: unknown
      path: NativeArgumentPath
      assign: (snapshot: unknown) => void
    }
  | {
      kind: "property"
      source: object
      key: string
      path: NativeArgumentPath
      assign: (snapshot: unknown) => void
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

function arrayPropertyPath(key: string): string {
  return /^(?:0|[1-9]\d*)$/u.test(key) ? `[${key}]` : `.${key}`
}

type SnapshotObjectClassification =
  | { kind: "array"; length: number }
  | { kind: "map" }
  | { kind: "record"; prototype: object | null }

function classifySnapshotObject(
  value: object,
  argumentPath: NativeArgumentPath
): SnapshotObjectClassification {
  try {
    if (Array.isArray(value)) {
      return { kind: "array", length: readArrayLength(value) }
    }

    const prototype = Object.getPrototypeOf(value)
    return isMapPrototype(prototype) ? { kind: "map" } : { kind: "record", prototype }
  } catch (error) {
    throw nativeBoundaryReadError(argumentPath, error)
  }
}

function readArrayLength(value: object): number {
  const length = Reflect.get(value, "length")
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError("Array length must be a non-negative safe integer.")
  }
  return length
}

function isMapPrototype(prototype: object | null): boolean {
  for (let current = prototype; current !== null; current = Object.getPrototypeOf(current)) {
    if (current === Map.prototype) return true
  }
  return false
}

/**
 * The property set the binding receives: own enumerable keys, plus getters
 * declared on the prototype chain. Class getters are non-enumerable, so
 * `Object.keys` alone would drop a class that computes its messages; every
 * other prototype member stays out, because a prototype method is a function
 * and functions do not cross the boundary. Own non-enumerable properties are
 * excluded for every record, class instance or plain object alike.
 */
function nativeVisiblePropertyNames(
  value: object,
  classification: SnapshotObjectClassification,
  argumentPath: NativeArgumentPath
): string[] {
  try {
    const names = Object.keys(value)
    if (
      classification.kind !== "record" ||
      classification.prototype === null ||
      classification.prototype === Object.prototype
    ) {
      return names
    }

    const seen = new Set(names)
    for (
      let prototype = classification.prototype;
      prototype !== null && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === "constructor" || seen.has(name)) continue
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
        if (typeof descriptor?.get !== "function") continue
        seen.add(name)
        names.push(name)
      }
    }
    return names
  } catch (error) {
    throw nativeBoundaryReadError(argumentPath, error)
  }
}

function enumerablePropertyNames(value: object, argumentPath: NativeArgumentPath): string[] {
  try {
    return Object.keys(value)
  } catch (error) {
    throw nativeBoundaryReadError(argumentPath, error)
  }
}

function defineSnapshotProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function assertWellFormedPropertyName(key: string, argumentPath: NativeArgumentPath): void {
  if (!isWellFormed(key)) {
    throw new TypeError(
      `Palamedes native boundary rejected malformed Unicode in ${formatNativeArgumentPath(argumentPath)}.<key>; replace the unpaired UTF-16 surrogate in the property name.`
    )
  }
}

/**
 * No native signature accepts a JS `Map`: the bindings build their maps from an
 * object's properties, so a `Map` would convert to an empty one and produce a
 * silently untranslated result. Reject it here instead.
 */
function nativeBoundaryUnsupportedMapError(argumentPath: NativeArgumentPath): TypeError {
  return new TypeError(
    `Palamedes native boundary rejected a Map in ${formatNativeArgumentPath(argumentPath)}; the native bindings read plain objects, so pass a record such as Object.fromEntries(map).`
  )
}

function nativeBoundaryReadError(argumentPath: NativeArgumentPath, cause: unknown): TypeError {
  return new TypeError(
    `Palamedes native boundary could not read ${formatNativeArgumentPath(argumentPath)}; accessors and Proxies must return a stable value.`,
    { cause }
  )
}

function guardNativeBindings(bindings: NativeBindings): NativeBindings {
  return new Proxy(bindings, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof property !== "string" || typeof value !== "function") {
        return value
      }
      return (...arguments_: unknown[]) =>
        Reflect.apply(value, target, snapshotNativeArguments(property, arguments_))
    },
  })
}

export function loadNativeBindings(options: LoadNativeBindingsOptions = {}): NativeBindings {
  const require = options.require ?? createRequire(import.meta.url)
  const packageDir =
    options.packageDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const nativePackageName = options.nativePackageName ?? resolveNativePackageName()
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
