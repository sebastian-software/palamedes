import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import ts from "typescript"
import { publicWorkspacePackages } from "./release-packages.mjs"

const root = process.cwd()
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-published-types-"))
const scopeDirectory = path.join(fixtureRoot, "node_modules", "@palamedes")
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"

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

const SOURCE_FALLBACK_DOC_TARGETS = [
  {
    packageDirectory: "packages/vite-plugin",
    docs: "docs/api/vite-plugin.md",
  },
  {
    packageDirectory: "packages/next-plugin",
    docs: "docs/api/next-plugin.md",
  },
  {
    packageDirectory: "packages/remix",
    docs: "docs/api/remix.md",
  },
]

const SOURCE_FALLBACK_TSDOC_PATTERN =
  /Defaults to `true` in every environment\.[\s\S]*Set to `false` for compact,[\s\S]*bundle size or embedding authored source text/u

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

/*
 * A top-level `types` condition wins before TypeScript can select a nested
 * `require` condition. Keep declarations beside their runtime format so CJS
 * consumers resolve `.d.cts` even on TypeScript versions that reject requiring
 * an ESM declaration file. This is checked structurally rather than relying on
 * the workspace TypeScript version, which changed that diagnostic in 5.8.
 */
function assertDualExportsUseFormatSpecificDeclarations(packages) {
  const problems = []

  for (const { manifest } of packages) {
    for (const [subpath, condition] of Object.entries(manifest.exports ?? {})) {
      visitCondition(condition, subpath, false, manifest.name, problems)
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join("\n"))
  }
}

function visitCondition(condition, conditionPath, hasTypesAncestor, packageName, problems) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return

  const hasTypesCondition = hasTypesAncestor || Object.hasOwn(condition, "types")
  const hasDualRuntimeConditions =
    Object.hasOwn(condition, "import") && Object.hasOwn(condition, "require")

  if (hasDualRuntimeConditions) {
    if (hasTypesCondition) {
      problems.push(
        `${packageName} ${conditionPath} has a "types" condition that masks its import and require declarations.`
      )
    }
    assertFormatSpecificDeclaration(
      condition.import,
      "import",
      ".d.mts",
      packageName,
      conditionPath,
      problems
    )
    assertFormatSpecificDeclaration(
      condition.require,
      "require",
      ".d.cts",
      packageName,
      conditionPath,
      problems
    )
  }

  for (const [name, nestedCondition] of Object.entries(condition)) {
    if (name !== "types") {
      visitCondition(
        nestedCondition,
        `${conditionPath}.${name}`,
        hasTypesCondition,
        packageName,
        problems
      )
    }
  }
}

function assertFormatSpecificDeclaration(
  condition,
  mode,
  extension,
  packageName,
  conditionPath,
  problems
) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    problems.push(
      `${packageName} ${conditionPath}.${mode} must nest a ${extension} declaration beside its runtime target.`
    )
    return
  }

  if (typeof condition.types !== "string" || !condition.types.endsWith(extension)) {
    problems.push(
      `${packageName} ${conditionPath}.${mode}.types must reference a ${extension} declaration.`
    )
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

function advertisedTargets(manifest) {
  const targets = exportTargets(manifest.exports ?? {}, new Set())
  for (const field of ["main", "module", "types"]) {
    if (typeof manifest[field] === "string") targets.add(manifest[field])
  }
  return [...targets].sort()
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
    for (const target of advertisedTargets(manifest)) {
      if (existsSync(path.join(root, directory, target))) continue
      problems.push(
        `${manifest.name} advertises ${target}, which is missing after a build; drop the condition or emit the file.`
      )
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"))
  }
}

function assertDeclarationTargetsArePacked(packages) {
  const problems = []
  for (const { directory, manifest } of packages) {
    const packedFiles = packedFilePaths(path.join(root, directory))
    for (const target of advertisedTargets(manifest)) {
      if (!/\.d\.(?:cts|mts|ts)$/u.test(target)) continue
      if (packedFiles.has(target.slice(2))) continue
      problems.push(`${manifest.name} advertises ${target}, but npm pack excludes it.`)
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"))
  }
}

/**
 * Adapter defaults are user-facing behavior, including the comments copied to
 * published declarations. Pin both declaration formats and the canonical API
 * docs so a runtime-default change cannot leave editor help behind again.
 */
function assertSourceFallbackDefaultDocumentation() {
  const problems = []

  for (const { packageDirectory, docs } of SOURCE_FALLBACK_DOC_TARGETS) {
    const declarationFiles = ["index.d.ts", "index.d.mts", "index.d.cts"].map((file) =>
      path.join(root, packageDirectory, "dist", file)
    )

    for (const file of [
      path.join(root, packageDirectory, "src", "index.ts"),
      ...declarationFiles,
    ]) {
      if (!existsSync(file)) {
        problems.push(`${path.relative(root, file)} is missing after a build.`)
        continue
      }
      const text = readFileSync(file, "utf8")
      const optionIndex = text.indexOf("keepSourceFallbacks?: boolean")
      const docStart = text.lastIndexOf("/**", optionIndex)
      const docEnd = text.indexOf("*/", docStart)
      if (optionIndex === -1 || docStart === -1 || docEnd < docStart || docEnd > optionIndex) {
        problems.push(
          `${path.relative(root, file)} has no public TSDoc immediately before keepSourceFallbacks.`
        )
        continue
      }
      const optionDocs = text.slice(docStart, docEnd)
      if (!SOURCE_FALLBACK_TSDOC_PATTERN.test(optionDocs)) {
        problems.push(
          `${path.relative(root, file)} does not document the all-environments default and compact/source-exposure opt-out.`
        )
      }
    }

    const docsText = readFileSync(path.join(root, docs), "utf8")
    if (!docsText.includes("- `keepSourceFallbacks`: `true`")) {
      problems.push(`${docs} does not document the default as true.`)
    }
    if (!docsText.includes("`keepSourceFallbacks: false`")) {
      problems.push(`${docs} does not document the explicit compact/hash-only opt-out.`)
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join("\n"))
  }
}

function packedFilePaths(packageDirectory) {
  const result = spawnSync(npmCommand, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: path.join(fixtureRoot, "npm-cache") },
    shell: process.platform === "win32",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`npm pack failed in ${packageDirectory}:\n${result.stderr}`)
  }

  const [{ files }] = JSON.parse(result.stdout)
  return new Set(files.map(({ path: filePath }) => filePath))
}

function linkPackage(name) {
  const packageDirectory = path.join(root, name)
  const fixturePackage = path.join(scopeDirectory, path.basename(name))
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
  const packages = publicWorkspacePackages(root)
  assertEveryPublishedPackageIsCovered(packages)

  const typedPackages = packages.filter(({ manifest }) => manifest.types)
  assertDualExportsUseFormatSpecificDeclarations(typedPackages)
  assertExportTargetsExist(typedPackages)
  assertDeclarationTargetsArePacked(typedPackages)
  assertSourceFallbackDefaultDocumentation()
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
