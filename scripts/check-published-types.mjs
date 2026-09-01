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
import { assertDualExportsUseFormatSpecificTargets } from "./published-export-contracts.mjs"
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

const SOURCE_FALLBACK_POLICY_TARGETS = [
  {
    file: "adr/004-internal-compiled-lookup-keys.md",
    snippets: [
      "Low-level transforms generate compact runtime calls without embedding the authored source message by default.",
      "First-party host adapters override that low-level default and preserve source fallbacks in both development and production",
      "Set `keepSourceFallbacks: false` for compact, hash-only output when bundle size or embedding authored source text is a concern.",
    ],
  },
  {
    file: "CHANGELOG.md",
    snippets: [
      "First-party host adapters preserve inline source-message fallbacks in macro and MDX output by default in both development and production.",
      "Set `keepSourceFallbacks: false` for compact, hash-only output when bundle size or embedding authored source text is a concern.",
      "The low-level transform retains its stripped default (`keepSourceFallbacks: false`)",
    ],
  },
  {
    file: "crates/palamedes/src/transform/mod.rs",
    snippets: [
      "The native transform itself strips source fallbacks by default (`None` resolves to `false`).",
      "First-party host adapters set this to `true` in every environment unless explicitly configured with `keepSourceFallbacks: false`",
      "for compact, hash-only output when bundle size or embedding authored source text is a concern.",
    ],
  },
]

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

  for (const { file, snippets } of SOURCE_FALLBACK_POLICY_TARGETS) {
    const policyText = readFileSync(path.join(root, file), "utf8")
      .replace(/^\s*\/\/\/\s?/gmu, "")
      .replace(/\s+/gu, " ")
      .trim()
    for (const snippet of snippets) {
      if (!policyText.includes(snippet)) {
        problems.push(`${file} has drifted from the source-fallback policy: missing ${snippet}`)
      }
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
  assertDualExportsUseFormatSpecificTargets(typedPackages)
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
import { Select as RuntimeSelect } from "@palamedes/react"
import { Plural, Select, SelectOrdinal, Trans } from "@palamedes/react/macro"
import {
  Plural as SolidPlural,
  Select as SolidSelect,
  SelectOrdinal as SolidSelectOrdinal,
  Trans as SolidTrans,
} from "@palamedes/solid/macro"
import palamedesLint, { configs as palamedesLintConfigs } from "@palamedes/eslint-plugin"
import withPalamedes from "@palamedes/next-plugin"
import { createWakuI18nInterceptor } from "@palamedes/waku"
import { createTanStackI18nRequestMiddleware } from "@palamedes/tanstack"
import vitePalamedes, { palamedes } from "@palamedes/vite-plugin"

export const lengths = [
  t\`Hello\`.length,
  t({ message: "Hello {name}", context: "greeting" }, { name: "Ada" }).length,
  plural(2, { one: "one", other: "other" }).length,
  plural(0, { "=0": "none", other: "other" }).length,
  select("a", { a: "A", other: "Other" }).length,
  selectOrdinal(2, { one: "first", other: "other" }).length,
]

// @ts-expect-error Core Select macro branches must be strings.
select("a", { a: 1, other: "Other" })
// @ts-expect-error Core Select macro branches cannot be undefined.
select("a", { a: undefined, other: "Other" })
// @ts-expect-error Core Select macro requires its fallback branch.
select("a", { a: "A" })

export const macroProps = [
  { message: "Hello", context: "greeting", comment: "Shown first", children: "Hello" } satisfies Parameters<typeof Trans>[0],
  { value: 2, one: "one", other: "other", context: "cart", comment: "Item count" } satisfies Parameters<typeof Plural>[0],
  { value: 2, one: "first", other: "other", context: "rank" } satisfies Parameters<typeof SelectOrdinal>[0],
  { message: "Hello", context: "greeting", children: "Hello" } satisfies Parameters<typeof SolidTrans>[0],
  { value: 2, one: "one", other: "other", context: "cart" } satisfies Parameters<typeof SolidPlural>[0],
  { value: 2, one: "first", other: "other", comment: "Rank" } satisfies Parameters<typeof SolidSelectOrdinal>[0],
]

Select({ value: "a", a: "A", other: "Other", context: "navigation", comment: "Choice" })
Select({ value: 2, two: "Two", other: "Other" })
SolidSelect({ value: "a", a: "A", other: "Other", context: "navigation", comment: "Choice" })
RuntimeSelect({ value: "female", female: "She", other: "They" })
// @ts-expect-error React Select macro branches must be strings.
Select({ value: "a", a: 1, other: "Other" })
// @ts-expect-error React Select macro branches cannot be undefined.
Select({ value: "a", a: undefined, other: "Other" })
// @ts-expect-error React runtime Select branches must be strings.
RuntimeSelect({ value: "a", a: 1, other: "Other" })
// @ts-expect-error React runtime Select branches cannot be undefined.
RuntimeSelect({ value: "a", a: undefined, other: "Other" })

// @ts-expect-error Choice macros require their fallback branch.
const missingPluralFallback: Parameters<typeof Plural>[0] = { value: 2, one: "one" }
// @ts-expect-error Authored Trans macros cannot provide explicit ids.
const invalidTransId: Parameters<typeof Trans>[0] = { id: "hello", children: "Hello" }
// @ts-expect-error Authored Trans macro values are derived by the transform.
const invalidTransValues: Parameters<typeof Trans>[0] = { message: "Hello", values: { name: "Ada" } }
// @ts-expect-error Authored Trans macro components are derived by the transform.
const invalidTransComponents: Parameters<typeof Trans>[0] = { message: "Hello", components: {} }
// @ts-expect-error Choice macros cannot provide explicit ids.
const invalidPluralId: Parameters<typeof Plural>[0] = { id: "items", value: 2, other: "other" }
// @ts-expect-error Select macros cannot provide explicit ids.
Select({ id: "choice", value: "a", a: "A", other: "Other" })
// @ts-expect-error Select macro messages are derived from their branches.
Select({ message: "Choice", value: "a", a: "A", other: "Other" })
// @ts-expect-error Solid Select macro branches must be strings.
SolidSelect({ value: "a", a: 1, other: "Other" })
// @ts-expect-error Solid Trans macros cannot provide transform-generated values.
const invalidSolidTransValues: Parameters<typeof SolidTrans>[0] = { message: "Hello", values: {} }
// @ts-expect-error t only accepts a tagged template or message descriptor.
t("Hello")

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
import coreMacro = require("@palamedes/core/macro")
import reactRuntime = require("@palamedes/react")
import reactMacro = require("@palamedes/react/macro")
import nextPlugin = require("@palamedes/next-plugin")
import vitePlugin = require("@palamedes/vite-plugin")

export const selectLengths = [
  coreMacro.select("a", { a: "A", other: "Other" }).length,
  reactRuntime.Select({ value: "female", female: "She", other: "They" }),
  reactMacro.Select({ value: "a", a: "A", other: "Other" }),
]
// @ts-expect-error Core Select macro branches must be strings in CommonJS too.
coreMacro.select("a", { a: 1, other: "Other" })
// @ts-expect-error Core Select macro branches cannot be undefined in CommonJS either.
coreMacro.select("a", { a: undefined, other: "Other" })
// @ts-expect-error Core Select macro requires its fallback branch in CommonJS too.
coreMacro.select("a", { a: "A" })
// @ts-expect-error React Select macro branches must be strings in CommonJS too.
reactMacro.Select({ value: "a", a: 1, other: "Other" })
// @ts-expect-error React Select macro branches cannot be undefined in CommonJS either.
reactMacro.Select({ value: "a", a: undefined, other: "Other" })
// @ts-expect-error React runtime Select branches must be strings in CommonJS too.
reactRuntime.Select({ value: "a", a: 1, other: "Other" })
// @ts-expect-error React runtime Select branches cannot be undefined in CommonJS either.
reactRuntime.Select({ value: "a", a: undefined, other: "Other" })

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
