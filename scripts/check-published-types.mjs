import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

const root = process.cwd()
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-published-types-"))
const scopeDirectory = path.join(fixtureRoot, "node_modules", "@palamedes")

/*
 * Published packages that carry no `types` field, with the reason each one is
 * outside this gate. Every other published package is linked and resolved
 * below, so adding a package to the release set adds it here automatically
 * instead of silently skipping it — that omission is how #637 shipped.
 */
const UNTYPED_PACKAGES = new Map([
  ["@palamedes/cli", "npm launcher for the pmds binary; no TypeScript surface"],
  ["@palamedes/cli-darwin-arm64", "prebuilt binary shim"],
  ["@palamedes/cli-linux-arm64-gnu", "prebuilt binary shim"],
  ["@palamedes/cli-linux-arm64-musl", "prebuilt binary shim"],
  ["@palamedes/cli-linux-x64-gnu", "prebuilt binary shim"],
  ["@palamedes/cli-linux-x64-musl", "prebuilt binary shim"],
  ["@palamedes/cli-win32-x64-msvc", "prebuilt binary shim"],
  ["@palamedes/core-node-darwin-arm64", "prebuilt native addon"],
  ["@palamedes/core-node-linux-arm64-gnu", "prebuilt native addon"],
  ["@palamedes/core-node-linux-arm64-musl", "prebuilt native addon"],
  ["@palamedes/core-node-linux-x64-gnu", "prebuilt native addon"],
  ["@palamedes/core-node-linux-x64-musl", "prebuilt native addon"],
  ["@palamedes/core-node-win32-x64-msvc", "prebuilt native addon"],
  ["create-palamedes", "scaffold placeholder; ships a bin only"],
  ["palamedes", "meta package; re-exports nothing itself"],
])

/** Export subpaths that resolve to bundler plugin files rather than modules. */
const UNTYPED_SUBPATHS = new Map([
  ["@palamedes/next-plugin", new Set(["./palamedes-loader", "./palamedes-po-loader"])],
])

function readPackages() {
  const packages = []
  for (const directory of readdirSync(path.join(root, "packages")).sort()) {
    const manifestPath = path.join(root, "packages", directory, "package.json")
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    } catch {
      continue
    }
    if (manifest.private) continue
    packages.push({ directory, manifest })
  }
  return packages
}

function typedSubpaths({ manifest }) {
  const skipped = UNTYPED_SUBPATHS.get(manifest.name) ?? new Set()
  return Object.entries(manifest.exports ?? { ".": {} })
    .filter(([subpath, condition]) => !skipped.has(subpath) && typeof condition === "object")
    .map(([subpath, condition]) => ({
      specifier: subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
      // A `require` condition promises a CommonJS consumer can resolve this
      // entry, so each one is checked from a `.cts` fixture as well.
      dual: JSON.stringify(condition).includes('"require"'),
    }))
}

function assertEveryPublishedPackageIsCovered(packages) {
  const problems = []
  for (const { manifest } of packages) {
    const excluded = UNTYPED_PACKAGES.has(manifest.name)
    if (manifest.types && excluded) {
      problems.push(
        `${manifest.name} declares "types" but is listed in UNTYPED_PACKAGES; remove the exclusion.`
      )
    }
    if (!manifest.types && !excluded) {
      problems.push(
        `${manifest.name} is published without "types" and is not listed in UNTYPED_PACKAGES; add it with a reason or ship declarations.`
      )
    }
  }
  for (const name of UNTYPED_PACKAGES.keys()) {
    if (!packages.some(({ manifest }) => manifest.name === name)) {
      problems.push(`UNTYPED_PACKAGES lists ${name}, which is no longer published.`)
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"))
  }
}

function exportTargets(condition, targets) {
  if (typeof condition === "string") {
    if (condition.startsWith("./")) targets.add(condition)
    return targets
  }
  if (Array.isArray(condition)) {
    for (const entry of condition) exportTargets(entry, targets)
    return targets
  }
  if (condition && typeof condition === "object") {
    for (const entry of Object.values(condition)) exportTargets(entry, targets)
  }
  return targets
}

/*
 * Type resolution stops at the first matching `types` condition, so it cannot
 * see that a `require` condition points at a build output that is never
 * emitted — the shape of #637. Check the advertised files instead. Scoped to
 * the typed packages: the platform-specific native shims only carry their
 * `.node` artifact on their own host, so they are verified by the publish
 * workflow instead. Requires `pnpm build` to have run.
 */
function assertExportTargetsExist(packages) {
  const problems = []
  for (const { directory, manifest } of packages) {
    const targets = exportTargets(manifest.exports ?? {}, new Set())
    for (const field of ["main", "module", "types"]) {
      if (typeof manifest[field] === "string") targets.add(manifest[field])
    }
    for (const target of [...targets].sort()) {
      if (existsSync(path.join(root, "packages", directory, target))) continue
      problems.push(
        `${manifest.name} advertises ${target}, which is missing after a build; drop the condition or emit the file.`
      )
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"))
  }
}

function linkPackage(name) {
  const packageDirectory = path.join(root, "packages", name)
  const fixturePackage = path.join(scopeDirectory, name)
  symlinkSync(packageDirectory, fixturePackage, process.platform === "win32" ? "junction" : "dir")
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => os.EOL,
  })
}

function checkProgram(fileName, compilerOptions) {
  const program = ts.createProgram([fileName], {
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    ...compilerOptions,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)

  if (diagnostics.length > 0) {
    throw new Error(formatDiagnostics(diagnostics))
  }
}

try {
  mkdirSync(scopeDirectory, { recursive: true })
  const packages = readPackages()
  assertEveryPublishedPackageIsCovered(packages)

  const typedPackages = packages.filter(({ manifest }) => manifest.types)
  assertExportTargetsExist(typedPackages)
  for (const { directory } of typedPackages) {
    linkPackage(directory)
  }

  /*
   * Every typed package resolves from a consumer, for every export subpath and
   * every module mode it advertises. This is the breadth pass; the hand-written
   * fixtures below additionally pin the call signatures teams depend on.
   */
  const entries = typedPackages.flatMap((entry) => typedSubpaths(entry))
  const resolutionEsmFixture = path.join(fixtureRoot, "resolution.mts")
  writeFileSync(
    resolutionEsmFixture,
    entries
      .map(
        ({ specifier }, index) =>
          `import type * as namespace${index} from ${JSON.stringify(specifier)}\nexport type Entry${index} = typeof namespace${index}\n`
      )
      .join("")
  )
  checkProgram(resolutionEsmFixture, {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })

  const resolutionCommonJsFixture = path.join(fixtureRoot, "resolution.cts")
  writeFileSync(
    resolutionCommonJsFixture,
    entries
      .filter(({ dual }) => dual)
      .map(
        ({ specifier }, index) =>
          `import namespace${index} = require(${JSON.stringify(specifier)})\nexport type Entry${index} = typeof namespace${index}\n`
      )
      .join("")
  )
  checkProgram(resolutionCommonJsFixture, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  })

  const esmFixture = path.join(fixtureRoot, "consumer.mts")
  writeFileSync(
    esmFixture,
    `import { plural, select, selectOrdinal, t } from "@palamedes/core/macro"
import palamedesLint, { configs as palamedesLintConfigs } from "@palamedes/eslint-plugin"
import withPalamedes from "@palamedes/next-plugin"
import { createWakuI18nInterceptor } from "@palamedes/waku"
import { createTanStackI18nRequestMiddleware } from "@palamedes/tanstack"
import vitePalamedes, { palamedes } from "@palamedes/vite-plugin"

export const lengths = [
  t\`Hello\`.length,
  plural(2, { one: "one", other: "other" }).length,
  select("a", { a: "A", other: "Other" }).length,
  selectOrdinal(2, { one: "first", other: "other" }).length,
]

export default withPalamedes({})
export const vitePlugins = [vitePalamedes(), palamedes()]
export const lintPlugin = palamedesLint
export const lintConfig = palamedesLintConfigs.recommended
export const wakuInterceptor = createWakuI18nInterceptor((request) => ({
  locale: request.headers.get("accept-language") ?? "en",
  _: () => "",
}))
export const tanstackMiddleware = createTanStackI18nRequestMiddleware((request) => ({
  locale: request.headers.get("accept-language") ?? "en",
  _: () => "",
}))
`
  )
  checkProgram(esmFixture, {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })

  const commonJsFixture = path.join(fixtureRoot, "consumer.cts")
  writeFileSync(
    commonJsFixture,
    `// @palamedes/tanstack is intentionally ESM-only and belongs in consumer.mts.
import nextPlugin = require("@palamedes/next-plugin")
import vitePlugin = require("@palamedes/vite-plugin")

export const config = nextPlugin.withPalamedes({})
export const vitePlugins = vitePlugin.palamedes()
`
  )
  checkProgram(commonJsFixture, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  })

  const legacyCommonJsFixture = path.join(fixtureRoot, "legacy-consumer.ts")
  writeFileSync(
    legacyCommonJsFixture,
    `import nextPlugin = require("@palamedes/next-plugin")
import vitePlugin = require("@palamedes/vite-plugin")

export const config = nextPlugin.withPalamedes({})
export const vitePlugins = vitePlugin.palamedes()
`
  )
  checkProgram(legacyCommonJsFixture, {
    ignoreDeprecations: "6.0",
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  })
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true })
}

console.log("Published TypeScript declarations support each package's advertised module consumers.")
