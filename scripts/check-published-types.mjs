import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

const root = process.cwd()
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-published-types-"))
const scopeDirectory = path.join(fixtureRoot, "node_modules", "@palamedes")

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
  linkPackage("core")
  linkPackage("next-plugin")

  const esmFixture = path.join(fixtureRoot, "consumer.mts")
  writeFileSync(
    esmFixture,
    `import { plural, select, selectOrdinal, t } from "@palamedes/core/macro"
import withPalamedes from "@palamedes/next-plugin"

export const lengths = [
  t\`Hello\`.length,
  plural(2, { one: "one", other: "other" }).length,
  select("a", { a: "A", other: "Other" }).length,
  selectOrdinal(2, { one: "first", other: "other" }).length,
]

export default withPalamedes({})
`
  )
  checkProgram(esmFixture, {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })

  const commonJsFixture = path.join(fixtureRoot, "consumer.cts")
  writeFileSync(
    commonJsFixture,
    `import nextPlugin = require("@palamedes/next-plugin")

export const config = nextPlugin.withPalamedes({})
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

export const config = nextPlugin.withPalamedes({})
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

console.log("Published TypeScript declarations support ESM and CommonJS consumers.")
