import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NativeBindings, NativeInfo } from "./generated/palamedes-node-types";

const SUPPORTED_NATIVE_PACKAGES = [
  "@palamedes/core-node-darwin-arm64",
  "@palamedes/core-node-linux-arm64-gnu",
  "@palamedes/core-node-linux-arm64-musl",
  "@palamedes/core-node-linux-x64-gnu",
  "@palamedes/core-node-linux-x64-musl",
  "@palamedes/core-node-win32-x64-msvc",
] as const;

function detectLinuxLibc(): "gnu" | "musl" | null {
  if (process.platform !== "linux") {
    return null;
  }

  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] }
    | undefined;
  const glibcVersion = report?.header?.glibcVersionRuntime;

  if (typeof glibcVersion === "string" && glibcVersion.length > 0) {
    return "gnu";
  }

  const sharedObjects = Array.isArray(report?.sharedObjects) ? report.sharedObjects : [];
  if (sharedObjects.some((sharedObject) => sharedObject.includes("musl"))) {
    return "musl";
  }
  if (
    sharedObjects.some(
      (sharedObject) => sharedObject.includes("libc.so.6") || sharedObject.includes("ld-linux"),
    )
  ) {
    return "gnu";
  }

  return null;
}

function getPlatformTriple(): string {
  const libc = detectLinuxLibc();
  return libc
    ? `${process.platform}-${process.arch}-${libc}`
    : `${process.platform}-${process.arch}`;
}

function getNativePackageName(): string {
  const linuxLibc = detectLinuxLibc();

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@palamedes/core-node-darwin-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64" && linuxLibc === "gnu") {
    return "@palamedes/core-node-linux-x64-gnu";
  }
  if (process.platform === "linux" && process.arch === "x64" && linuxLibc === "musl") {
    return "@palamedes/core-node-linux-x64-musl";
  }
  if (process.platform === "linux" && process.arch === "arm64" && linuxLibc === "gnu") {
    return "@palamedes/core-node-linux-arm64-gnu";
  }
  if (process.platform === "linux" && process.arch === "arm64" && linuxLibc === "musl") {
    return "@palamedes/core-node-linux-arm64-musl";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "@palamedes/core-node-win32-x64-msvc";
  }

  throw new Error(
    `No Palamedes native bindings package is available for ${getPlatformTriple()}. Supported packages: ${SUPPORTED_NATIVE_PACKAGES.join(", ")}. If you need to build from source, run \`cargo build --workspace\` in the Palamedes repository.`,
  );
}

type ModuleLoader = (specifier: string) => unknown;

export type LoadNativeBindingsOptions = {
  packageDir?: string;
  nativePackageName?: string;
  require?: ModuleLoader;
};

function packageVersion(require: ModuleLoader, packageDir: string): string {
  const manifest = require(path.join(packageDir, "package.json")) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`Unable to read the @palamedes/core-node version from ${packageDir}.`);
  }
  return manifest.version;
}

export function assertNativeBindingVersion(
  wrapperVersion: string,
  nativePackageName: string,
  nativeInfo: NativeInfo,
): void {
  const nativeVersion = nativeInfo.palamedesVersion;
  if (nativeVersion === wrapperVersion) {
    return;
  }

  throw new Error(
    `Palamedes native binding version mismatch: @palamedes/core-node@${wrapperVersion} loaded ${nativePackageName} with native version ${nativeVersion || "<missing>"}. Reinstall @palamedes/core-node so its exact optional platform dependency is refreshed, or install matching ${nativePackageName}@${wrapperVersion}.`,
  );
}

function isWellFormed(value: string): boolean {
  const stringWithWellFormed = value as string & { isWellFormed?: () => boolean };
  if (typeof stringWithWellFormed.isWellFormed === "function") {
    return stringWithWellFormed.isWellFormed();
  }

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 55_296 && codeUnit <= 56_319) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 56_320 || next > 57_343) return false;
      index += 1;
    } else if (codeUnit >= 56_320 && codeUnit <= 57_343) {
      return false;
    }
  }
  return true;
}

const preparedNativeArguments = new WeakSet<object>();
const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const abortableNativeOperations = new Set([
  "updateCatalogFileAsync",
  "inspectCatalogMachineTranslationsAsync",
  "applyTranslationPatchesAsync",
  "compileCatalogArtifactAsync",
  "compileCatalogArtifactSelectedAsync",
  "compileCatalogModuleAsync",
  "extractCatalogMessagesFromFilesAsync",
]);

function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== "object" || !abortSignalAborted) {
    return false;
  }
  try {
    return typeof abortSignalAborted.call(value) === "boolean";
  } catch {
    return false;
  }
}

function isAbortSignalArgument(
  operation: string,
  index: number,
  value: unknown,
): value is AbortSignal {
  return index === 1 && abortableNativeOperations.has(operation) && isAbortSignal(value);
}

export function assertWellFormedNativeArguments(operation: string, arguments_: unknown[]): void {
  snapshotNativeArguments(operation, arguments_);
}

/**
 * Captures one wrapper input as stable, validated plain data before a wrapper
 * converts it into the native request shape.
 */
export function snapshotNativeArgument<T extends object>(
  operation: string,
  value: T,
  argumentIndex = 0,
): T {
  return snapshotSingleNativeArgument(operation, argumentIndex, value) as T;
}

export function validateNativeArgument(operation: string, value: unknown): void {
  validateStableNativeArguments(operation, [value]);
}

/**
 * Marks a wrapper-owned plain-data tree after validating its public source
 * without creating a second copy. The wrapper must own every nested object and
 * array in `value`; record prototypes and property descriptors enforce that
 * contract before native bindings may read the prepared tree directly.
 */
export function prepareNativeArgument<T extends object>(operation: string, value: T): T {
  validateNativeArgument(operation, value);
  return markPreparedNativeArgument(value);
}

/**
 * Trusts an already validated, wrapper-owned plain-data tree at the guarded
 * native boundary. Only use this for values derived exclusively from a
 * `snapshotNativeArgument` result and wrapper-introduced constants.
 */
export function markPreparedNativeArgument<T extends object>(value: T): T {
  preparedNativeArguments.add(value);
  return value;
}

type ValidationFrame = {
  source: object;
  isArray: boolean;
  keys: string[];
  nextIndex: number;
  activeKey: string | undefined;
};

function validateStableNativeArguments(operation: string, arguments_: unknown[]): void {
  const seen = new Set<object>();

  for (let argumentIndex = 0; argumentIndex < arguments_.length; argumentIndex += 1) {
    const rootValue = arguments_[argumentIndex];
    if (typeof rootValue === "string") {
      if (!isWellFormed(rootValue)) {
        throw malformedUnicodeError(`${operation}.argument[${argumentIndex}]`, operation);
      }
      continue;
    }
    if (rootValue === null || typeof rootValue !== "object" || seen.has(rootValue)) {
      continue;
    }

    const stack: ValidationFrame[] = [];
    const rootFrame = createValidationFrame(rootValue, seen, operation, argumentIndex, stack);
    stack.push(rootFrame);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.nextIndex >= frame.keys.length) {
        stack.pop();
        continue;
      }

      const key = frame.keys[frame.nextIndex]!;
      frame.nextIndex += 1;
      frame.activeKey = key;

      if (!isWellFormed(key)) {
        throw malformedPropertyNameError(formatFrameStackPath(operation, argumentIndex, stack));
      }

      const propertyValue = readPreparedDataProperty(
        frame.source,
        key,
        operation,
        argumentIndex,
        stack,
      );
      if (typeof propertyValue === "string") {
        if (!isWellFormed(propertyValue)) {
          throw malformedUnicodeError(
            formatFrameStackPath(operation, argumentIndex, stack),
            operation,
          );
        }
        continue;
      }
      if (propertyValue === null || typeof propertyValue !== "object" || seen.has(propertyValue)) {
        continue;
      }

      const childFrame = createValidationFrame(
        propertyValue,
        seen,
        operation,
        argumentIndex,
        stack,
      );
      stack.push(childFrame);
    }
  }
}

function createValidationFrame(
  value: object,
  seen: Set<object>,
  operation: string,
  argumentIndex: number,
  stack: readonly FramePathNode[],
): ValidationFrame {
  seen.add(value);
  const classification = classifySnapshotObject(value, operation, argumentIndex, stack);
  if (classification.kind === "map") {
    throw nativeBoundaryUnsupportedMapError(formatFrameStackPath(operation, argumentIndex, stack));
  }
  if (
    classification.kind === "record" &&
    classification.prototype !== null &&
    classification.prototype !== Object.prototype
  ) {
    throw nativeBoundaryReadError(
      formatFrameStackPath(operation, argumentIndex, stack),
      new TypeError("Prepared native argument records must be wrapper-owned plain data."),
    );
  }
  const isArray = classification.kind === "array";
  const keys = isArray
    ? enumerablePropertyNames(value, operation, argumentIndex, stack)
    : nativeVisiblePropertyNames(value, classification, operation, argumentIndex, stack);
  return {
    source: value,
    isArray,
    keys,
    nextIndex: 0,
    activeKey: undefined,
  };
}

function readPreparedDataProperty(
  value: object,
  key: string,
  operation: string,
  argumentIndex: number,
  stack: readonly FramePathNode[],
): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Prepared native arguments must contain only own data properties.");
    }
    return descriptor.value;
  } catch (error) {
    throw nativeBoundaryReadError(formatFrameStackPath(operation, argumentIndex, stack), error);
  }
}

/**
 * Read, validate, and normalize arguments before the N-API boundary. The
 * binding receives only this snapshot, so an accessor or Proxy cannot return a
 * different string after it has passed Unicode validation.
 */
export function snapshotNativeArguments(operation: string, arguments_: unknown[]): unknown[] {
  const length = arguments_.length;
  const result: unknown[] = Array.from({ length });
  let snapshots: Map<object, unknown> | undefined;
  let firstRootSource: object | undefined;
  let firstRootTarget: unknown;

  for (let argumentIndex = 0; argumentIndex < length; argumentIndex += 1) {
    const rootValue = arguments_[argumentIndex];
    if (typeof rootValue === "string") {
      if (!isWellFormed(rootValue)) {
        throw malformedUnicodeError(`${operation}.argument[${argumentIndex}]`, operation);
      }
      result[argumentIndex] = rootValue;
      continue;
    }
    if (rootValue === null || typeof rootValue !== "object") {
      result[argumentIndex] = rootValue;
      continue;
    }
    if (
      preparedNativeArguments.has(rootValue) ||
      isAbortSignalArgument(operation, argumentIndex, rootValue)
    ) {
      result[argumentIndex] = rootValue;
      continue;
    }

    if (snapshots !== undefined) {
      const existing = snapshots.get(rootValue);
      if (existing !== undefined) {
        result[argumentIndex] = existing;
        continue;
      }
    } else if (firstRootSource !== undefined) {
      if (rootValue === firstRootSource) {
        result[argumentIndex] = firstRootTarget;
        continue;
      }
      snapshots = new Map<object, unknown>();
      snapshots.set(firstRootSource, firstRootTarget);
    }

    const snapshotted = snapshotObjectGraph(operation, argumentIndex, rootValue, snapshots);
    snapshots = snapshotted.snapshots;
    if (firstRootSource === undefined) {
      firstRootSource = rootValue;
      firstRootTarget = snapshotted.target;
    }
    result[argumentIndex] = snapshotted.target;
  }

  return result;
}

function snapshotSingleNativeArgument(
  operation: string,
  argumentIndex: number,
  rootValue: unknown,
): unknown {
  if (typeof rootValue === "string") {
    if (!isWellFormed(rootValue)) {
      throw malformedUnicodeError(`${operation}.argument[${argumentIndex}]`, operation);
    }
    return rootValue;
  }
  if (rootValue === null || typeof rootValue !== "object") {
    return rootValue;
  }
  if (
    preparedNativeArguments.has(rootValue) ||
    isAbortSignalArgument(operation, argumentIndex, rootValue)
  ) {
    return rootValue;
  }

  return snapshotObjectGraph(operation, argumentIndex, rootValue, undefined).target;
}

type FramePathNode = {
  isArray: boolean;
  activeKey: string | undefined;
};

type SnapshotFrame = {
  source: object;
  target: unknown[] | Record<string, unknown>;
  isArray: boolean;
  dense: boolean;
  expectedLength: number;
  keys: string[];
  nextIndex: number;
  activeKey: string | undefined;
};

const EMPTY_FRAMES: readonly FramePathNode[] = [];

function snapshotObjectGraph(
  operation: string,
  argumentIndex: number,
  rootValue: object,
  existingSnapshots: Map<object, unknown> | undefined,
): { target: unknown; snapshots: Map<object, unknown> | undefined } {
  let snapshots = existingSnapshots;
  const rootFrame = createSnapshotFrame(rootValue, operation, argumentIndex, EMPTY_FRAMES);
  if (snapshots !== undefined) {
    snapshots.set(rootValue, rootFrame.target);
  }

  const stack: SnapshotFrame[] = [rootFrame];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.nextIndex >= frame.keys.length) {
      if (frame.isArray) {
        const arrayTarget = frame.target as unknown[];
        if (arrayTarget.length < frame.expectedLength) {
          arrayTarget.length = frame.expectedLength;
        }
      }
      stack.pop();
      continue;
    }

    const key = frame.keys[frame.nextIndex]!;
    frame.nextIndex += 1;
    frame.activeKey = key;

    let propertyValue: unknown;
    try {
      propertyValue = Reflect.get(frame.source, key);
    } catch (error) {
      throw nativeBoundaryReadError(formatFrameStackPath(operation, argumentIndex, stack), error);
    }

    if (typeof propertyValue === "string") {
      if (!isWellFormed(propertyValue)) {
        throw malformedUnicodeError(
          formatFrameStackPath(operation, argumentIndex, stack),
          operation,
        );
      }
      assignSnapshotProperty(frame, key, propertyValue);
      continue;
    }
    if (propertyValue === null || typeof propertyValue !== "object") {
      assignSnapshotProperty(frame, key, propertyValue);
      continue;
    }

    if (snapshots === undefined) {
      if (propertyValue === rootValue) {
        assignSnapshotProperty(frame, key, rootFrame.target);
        continue;
      }
      snapshots = new Map<object, unknown>();
      snapshots.set(rootValue, rootFrame.target);
    } else {
      const existingSnapshot = snapshots.get(propertyValue);
      if (existingSnapshot !== undefined) {
        assignSnapshotProperty(frame, key, existingSnapshot);
        continue;
      }
    }

    const childFrame = createSnapshotFrame(propertyValue, operation, argumentIndex, stack);
    snapshots.set(propertyValue, childFrame.target);
    assignSnapshotProperty(frame, key, childFrame.target);
    stack.push(childFrame);
  }

  return { target: rootFrame.target, snapshots };
}

function createSnapshotFrame(
  value: object,
  operation: string,
  argumentIndex: number,
  stack: readonly FramePathNode[],
): SnapshotFrame {
  const classification = classifySnapshotObject(value, operation, argumentIndex, stack);
  if (classification.kind === "map") {
    throw nativeBoundaryUnsupportedMapError(formatFrameStackPath(operation, argumentIndex, stack));
  }

  const isArray = classification.kind === "array";
  const keys = isArray
    ? enumerablePropertyNames(value, operation, argumentIndex, stack)
    : nativeVisiblePropertyNames(value, classification, operation, argumentIndex, stack);

  for (const key of keys) {
    if (!isWellFormed(key)) {
      throw malformedPropertyNameError(
        formatFrameStackPath(operation, argumentIndex, stack, isArray, key),
      );
    }
  }

  return {
    source: value,
    target: isArray ? [] : {},
    isArray,
    dense: isArray,
    expectedLength: isArray ? classification.length : 0,
    keys,
    nextIndex: 0,
    activeKey: undefined,
  };
}

function assignSnapshotProperty(frame: SnapshotFrame, key: string, value: unknown): void {
  if (frame.isArray) {
    const arrayTarget = frame.target as unknown[];
    if (frame.dense && parseArrayIndex(key) === arrayTarget.length) {
      arrayTarget.push(value);
      return;
    }
    frame.dense = false;
    if (key === "__proto__" || key === "length") {
      defineSnapshotProperty(arrayTarget, key, value);
    } else {
      (arrayTarget as unknown as Record<string, unknown>)[key] = value;
    }
    return;
  }

  const recordTarget = frame.target as Record<string, unknown>;
  if (key === "__proto__") {
    defineSnapshotProperty(recordTarget, key, value);
  } else {
    recordTarget[key] = value;
  }
}

function formatFrameStackPath(
  operation: string,
  argumentIndex: number,
  stack: readonly FramePathNode[],
  extraIsArray?: boolean,
  extraKey?: string,
): string {
  let formatted = `${operation}.argument[${argumentIndex}]`;
  for (const frame of stack) {
    if (frame.activeKey !== undefined) {
      formatted += frame.isArray ? arrayPropertyPath(frame.activeKey) : `.${frame.activeKey}`;
    }
  }
  if (extraKey !== undefined) {
    formatted += extraIsArray ? arrayPropertyPath(extraKey) : `.${extraKey}`;
  }
  return formatted;
}

function isNonNegativeIntegerKey(key: string): boolean {
  const length = key.length;
  if (length === 0) return false;
  const first = key.charCodeAt(0);
  if (length === 1) return first >= 48 && first <= 57;
  if (first < 49 || first > 57) return false;
  for (let index = 1; index < length; index += 1) {
    const code = key.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function parseArrayIndex(key: string): number {
  const length = key.length;
  if (length === 0 || length > 10) return -1;
  const first = key.charCodeAt(0);
  if (length === 1) {
    return first >= 48 && first <= 57 ? first - 48 : -1;
  }
  if (first < 49 || first > 57) return -1;
  let value = first - 48;
  for (let index = 1; index < length; index += 1) {
    const code = key.charCodeAt(index);
    if (code < 48 || code > 57) return -1;
    value = value * 10 + (code - 48);
  }
  return value <= 0xff_ff_ff_fe ? value : -1;
}

function arrayPropertyPath(key: string): string {
  return isNonNegativeIntegerKey(key) ? `[${key}]` : `.${key}`;
}

type SnapshotObjectClassification =
  | { kind: "array"; length: number }
  | { kind: "map" }
  | { kind: "record"; prototype: object | null };

function classifySnapshotObject(
  value: object,
  operation: string,
  argumentIndex: number,
  stack: readonly FramePathNode[],
): SnapshotObjectClassification {
  try {
    if (Array.isArray(value)) {
      return { kind: "array", length: readArrayLength(value) };
    }

    const prototype = Object.getPrototypeOf(value);
    return isMapPrototype(prototype) ? { kind: "map" } : { kind: "record", prototype };
  } catch (error) {
    throw nativeBoundaryReadError(formatFrameStackPath(operation, argumentIndex, stack), error);
  }
}

function readArrayLength(value: object): number {
  const length = Reflect.get(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError("Array length must be a non-negative safe integer.");
  }
  return length;
}

function isMapPrototype(prototype: object | null): boolean {
  for (let current = prototype; current !== null; current = Object.getPrototypeOf(current)) {
    if (current === Map.prototype) return true;
  }
  return false;
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
  operation: string,
  argumentIndex: number,
  stack: readonly FramePathNode[],
): string[] {
  try {
    const names = Object.keys(value);
    if (
      classification.kind !== "record" ||
      classification.prototype === null ||
      classification.prototype === Object.prototype
    ) {
      return names;
    }

    const seen = new Set(names);
    for (
      let prototype = classification.prototype;
      prototype !== null && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === "constructor" || seen.has(name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (typeof descriptor?.get !== "function") continue;
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  } catch (error) {
    throw nativeBoundaryReadError(formatFrameStackPath(operation, argumentIndex, stack), error);
  }
}

function enumerablePropertyNames(
  value: object,
  operation: string,
  argumentIndex: number,
  stack: readonly FramePathNode[],
): string[] {
  try {
    return Object.keys(value);
  } catch (error) {
    throw nativeBoundaryReadError(formatFrameStackPath(operation, argumentIndex, stack), error);
  }
}

function defineSnapshotProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function malformedUnicodeError(field: string, operation: string): TypeError {
  return new TypeError(
    `Palamedes native boundary rejected malformed Unicode in ${field}; replace the unpaired UTF-16 surrogate before calling ${operation}.`,
  );
}

function malformedPropertyNameError(field: string): TypeError {
  return new TypeError(
    `Palamedes native boundary rejected malformed Unicode in ${field}.<key>; replace the unpaired UTF-16 surrogate in the property name.`,
  );
}

/**
 * No native signature accepts a JS `Map`: the bindings build their maps from an
 * object's properties, so a `Map` would convert to an empty one and produce a
 * silently untranslated result. Reject it here instead.
 */
function nativeBoundaryUnsupportedMapError(field: string): TypeError {
  return new TypeError(
    `Palamedes native boundary rejected a Map in ${field}; the native bindings read plain objects, so pass a record such as Object.fromEntries(map).`,
  );
}

function nativeBoundaryReadError(field: string, cause: unknown): TypeError {
  return new TypeError(
    `Palamedes native boundary could not read ${field}; accessors and Proxies must return a stable value.`,
    { cause },
  );
}

function guardNativeBindings(bindings: NativeBindings): NativeBindings {
  const wrappedMethods = new Map<
    string,
    { original: (...args: unknown[]) => unknown; guarded: (...args: unknown[]) => unknown }
  >();
  return new Proxy(bindings, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }
      const original = value as (...args: unknown[]) => unknown;
      const cached = wrappedMethods.get(property);
      if (cached && cached.original === original) {
        return cached.guarded;
      }
      const guarded = (...arguments_: unknown[]) => {
        let prepared = true;
        for (let index = 0; index < arguments_.length; index += 1) {
          const argument = arguments_[index];
          if (
            argument !== null &&
            typeof argument === "object" &&
            !isAbortSignalArgument(property, index, argument) &&
            !preparedNativeArguments.has(argument)
          ) {
            prepared = false;
            break;
          }
        }
        if (!prepared) {
          return Reflect.apply(original, target, snapshotNativeArguments(property, arguments_));
        }
        for (let index = 0; index < arguments_.length; index += 1) {
          const argument = arguments_[index];
          if (typeof argument === "string" && !isWellFormed(argument)) {
            throw malformedUnicodeError(`${property}.argument[${index}]`, property);
          }
        }
        return Reflect.apply(original, target, arguments_);
      };
      wrappedMethods.set(property, { original, guarded });
      return guarded;
    },
  });
}

export function loadNativeBindings(options: LoadNativeBindingsOptions = {}): NativeBindings {
  const require = options.require ?? createRequire(import.meta.url);
  const packageDir =
    options.packageDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const nativePackageName = options.nativePackageName ?? getNativePackageName();
  let bindings: NativeBindings;

  try {
    bindings = require(nativePackageName) as NativeBindings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load Palamedes native bindings from ${nativePackageName} for ${getPlatformTriple()} in package ${packageDir}: ${message}. Supported packages: ${SUPPORTED_NATIVE_PACKAGES.join(", ")}.`,
      { cause: error },
    );
  }

  assertNativeBindingVersion(
    packageVersion(require, packageDir),
    nativePackageName,
    bindings.getNativeInfo(),
  );
  return guardNativeBindings(bindings);
}
