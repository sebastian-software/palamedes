import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { ESLint } from "eslint"

import plugin from "./index"
import {
  createAnalysisCoordinator,
  nativeFailureLocationToUtf16Index,
  parseNativeFailureLocation,
  utf8ByteOffsetToUtf16Index,
} from "./analysis"

function eslintFor(rules: Record<string, "warn" | "error">): ESLint {
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{js,jsx}"],
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { palamedes: plugin },
        rules,
      },
    ],
  })
}

describe("native Palamedes lint adapter", () => {
  it("maps UTF-8 byte offsets to JavaScript UTF-16 indices", () => {
    const source = "😀éa"
    expect(utf8ByteOffsetToUtf16Index(source, 0)).toBe(0)
    expect(utf8ByteOffsetToUtf16Index(source, 4)).toBe(2)
    expect(utf8ByteOffsetToUtf16Index(source, 6)).toBe(3)
    expect(utf8ByteOffsetToUtf16Index(source, 7)).toBe(4)
  })

  it("shares one native analysis across rule facades and invalidates on edits", () => {
    const analyze = vi.fn(() => ({ diagnostics: [] }))
    const coordinator = createAnalysisCoordinator(analyze)
    const source = "import { t } from '@palamedes/core/macro'"

    coordinator.analyzeContext({ filename: "view.tsx", sourceCode: { text: source } })
    coordinator.analyzeContext({ filename: "view.tsx", sourceCode: { text: source } })
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(coordinator.nativeCallCount()).toBe(1)

    coordinator.analyzeContext({
      filename: "view.tsx",
      sourceCode: { text: `${source}\nexport const edited = true` },
    })
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it("claims a cached native failure once per SourceCode identity", () => {
    const analyze = vi.fn(() => {
      throw new Error("Translation macro `t` must be used inside a function at view.tsx:2:1.")
    })
    const coordinator = createAnalysisCoordinator(analyze)
    const firstParse = { text: "import { t } from '@palamedes/core/macro'\nconst value = t`Hello`" }

    expect(
      coordinator.takeUnreportedFailure({ filename: "view.tsx", sourceCode: firstParse })
    ).toMatchObject({
      message: expect.stringContaining("must be used inside a function"),
      location: { line: 2, column: 1 },
    })
    expect(
      coordinator.takeUnreportedFailure({ filename: "view.tsx", sourceCode: firstParse })
    ).toBeUndefined()

    const reparsed = { text: firstParse.text }
    expect(
      coordinator.takeUnreportedFailure({ filename: "view.tsx", sourceCode: reparsed })
    ).toMatchObject({ location: { line: 2, column: 1 } })
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it("does not carry a failed parse into a later successful source", () => {
    const analyze = vi.fn((source: string) => {
      if (source === "broken") {
        throw new Error("Parse error: malformed native parser output")
      }
      return { diagnostics: [] }
    })
    const coordinator = createAnalysisCoordinator(analyze)

    expect(
      coordinator.takeUnreportedFailure({ filename: "view.tsx", sourceCode: { text: "broken" } })
    ).toMatchObject({ message: "Parse error: malformed native parser output" })
    expect(
      coordinator.takeUnreportedFailure({ filename: "view.tsx", sourceCode: { text: "fixed" } })
    ).toBeUndefined()
    expect(
      coordinator.analyzeContext({ filename: "view.tsx", sourceCode: { text: "fixed" } })
        .diagnostics
    ).toStrictEqual([])
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it("uses only native location templates and converts Unicode coordinates", () => {
    expect(
      parseNativeFailureLocation(
        "Unsupported `t` macro usage at C:\\repo:with:colon\\view.tsx:2:3: invalid descriptor\nkeep this detail"
      )
    ).toStrictEqual({ line: 2, column: 3 })
    expect(
      parseNativeFailureLocation(
        "Translation macro `t` must be used inside a function at /repo/view.tsx:1:1. Wrap it."
      )
    ).toStrictEqual({ line: 1, column: 1 })
    expect(
      parseNativeFailureLocation("detail C:\\repo\\view.tsx:2:3 is not a native location")
    ).toBeUndefined()
    expect(parseNativeFailureLocation("Location: view.tsx:1:0.")).toBeUndefined()
    expect(nativeFailureLocationToUtf16Index("😀x\ntext", { line: 1, column: 2 })).toBe(2)
    expect(nativeFailureLocationToUtf16Index("😀x", { line: 1, column: 0 })).toBeUndefined()
    expect(nativeFailureLocationToUtf16Index("x", { line: 2, column: 1 })).toBeUndefined()
  })

  it.each([
    {
      name: "dynamic descriptor",
      source: `import { t } from "@palamedes/core/macro"
function View() { return t({ message }) }`,
      line: 2,
      column: 26,
    },
    {
      name: "macro outside a function",
      source: `import { t } from "@palamedes/core/macro"
const message = t\`Hello\``,
      line: 2,
      column: 17,
    },
  ])(
    "reports one native $name failure through enabled ESLint facades",
    async ({ source, line, column }) => {
      const [result] = await eslintFor({
        "palamedes/no-placeholder-only-message": "warn",
        "palamedes/no-empty-component-only-message": "warn",
        "palamedes/prefer-trans-in-jsx": "warn",
      }).lintText(source, { filePath: "view.jsx" })

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toMatchObject({
        ruleId: "palamedes/no-placeholder-only-message",
        line,
        column,
        message: expect.stringContaining("Palamedes native analysis failed"),
      })
    }
  )

  it.each(["react", "solid"])(
    "reports aliased %s macros through separate ESLint rule names at the exact Unicode range",
    async (framework) => {
      const source = `import { t as translate } from "@palamedes/${framework}/macro"
function View({ status }) {
  return <p>🙂{translate\`${"${status}"}\`}</p>
}`
      const [result] = await eslintFor({
        "palamedes/no-placeholder-only-message": "warn",
        "palamedes/prefer-trans-in-jsx": "warn",
      }).lintText(source, { filePath: `view-${framework}.jsx` })

      expect(result.errorCount).toBe(0)
      expect(result.warningCount).toBe(2)
      expect(result.messages.map((message) => message.ruleId).sort()).toStrictEqual([
        "palamedes/no-placeholder-only-message",
        "palamedes/prefer-trans-in-jsx",
      ])
      const line = source.split("\n")[2]
      const expectedColumn = line.indexOf("translate") + 1
      for (const message of result.messages) {
        expect(message.line).toBe(3)
        expect(message.column).toBe(expectedColumn)
      }
    }
  )

  it("uses ESLint's own code-specific inline directives", async () => {
    const source = `import { t } from "@palamedes/core/macro"
function View({ status }) {
  // eslint-disable-next-line palamedes/no-placeholder-only-message
  return <p>{t\`${"${status}"}\`}</p>
}`
    const [result] = await eslintFor({
      "palamedes/no-placeholder-only-message": "warn",
      "palamedes/prefer-trans-in-jsx": "warn",
    }).lintText(source, { filePath: "view.jsx" })

    expect(result.messages.map((message) => message.ruleId)).toStrictEqual([
      "palamedes/prefer-trans-in-jsx",
    ])
  })

  it("runs the built plugin through Oxlint with native diagnostics and suppressions", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "palamedes-oxlint-adapter-"))
    try {
      const pluginPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url))
      const sourcePath = path.join(directory, "view.tsx")
      const configPath = path.join(directory, ".oxlintrc.json")
      writeFileSync(
        sourcePath,
        `import { t } from "@palamedes/react/macro"
function View({ status }: { status: string }) {
  // oxlint-disable-next-line palamedes/no-placeholder-only-message
  return <p>{t\`${"${status}"}\`}</p>
}`
      )
      writeFileSync(
        configPath,
        JSON.stringify({
          categories: { correctness: "off" },
          plugins: [],
          jsPlugins: [{ name: "palamedes", specifier: pluginPath }],
          rules: {
            "palamedes/no-placeholder-only-message": "warn",
            "palamedes/prefer-trans-in-jsx": "warn",
          },
        })
      )

      const require = createRequire(import.meta.url)
      const oxlintEntry = require.resolve("oxlint")
      const oxlintBin = path.resolve(path.dirname(oxlintEntry), "../bin/oxlint")
      const run = spawnSync(
        process.execPath,
        [oxlintBin, "--config", configPath, "--format", "json", "--threads", "1", sourcePath],
        { cwd: directory, encoding: "utf8" }
      )

      expect(run).toMatchObject({ status: 0 })
      const output = JSON.parse(run.stdout) as {
        diagnostics: Array<{
          code: string
          labels: Array<{ span: { line: number; column: number } }>
        }>
      }
      expect(output.diagnostics).toHaveLength(1)
      expect(output.diagnostics[0].code).toBe("palamedes(prefer-trans-in-jsx)")
      expect(output.diagnostics[0].labels[0].span).toMatchObject({ line: 4, column: 14 })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("reports one native authoring failure through Oxlint at its native location", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "palamedes-oxlint-native-failure-"))
    try {
      const pluginPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url))
      const sourcePath = path.join(directory, "view.jsx")
      const configPath = path.join(directory, ".oxlintrc.json")
      writeFileSync(
        sourcePath,
        `import { t } from "@palamedes/core/macro"
function View() { return t({ message }) }`
      )
      writeFileSync(
        configPath,
        JSON.stringify({
          categories: { correctness: "off" },
          jsPlugins: [{ name: "palamedes", specifier: pluginPath }],
          rules: {
            "palamedes/no-placeholder-only-message": "warn",
            "palamedes/no-empty-component-only-message": "warn",
            "palamedes/prefer-trans-in-jsx": "warn",
          },
        })
      )

      const require = createRequire(import.meta.url)
      const oxlintEntry = require.resolve("oxlint")
      const oxlintBin = path.resolve(path.dirname(oxlintEntry), "../bin/oxlint")
      const run = spawnSync(
        process.execPath,
        [oxlintBin, "--config", configPath, "--format", "json", "--threads", "1", sourcePath],
        { cwd: directory, encoding: "utf8" }
      )

      expect(run).toMatchObject({ status: 0 })
      const output = JSON.parse(run.stdout) as {
        diagnostics: Array<{
          code: string
          labels: Array<{ span: { line: number; column: number } }>
          message: string
        }>
      }
      expect(output.diagnostics).toHaveLength(1)
      expect(output.diagnostics[0]).toMatchObject({
        code: "palamedes(no-placeholder-only-message)",
        message: expect.stringContaining("Palamedes native analysis failed"),
      })
      expect(output.diagnostics[0].labels[0].span).toMatchObject({ line: 2, column: 26 })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("loads the CommonJS build and emits both module formats", () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url))
    const commonJs = createRequire(import.meta.url)(path.join(packageRoot, "dist/index.cjs")) as {
      rules: Record<string, unknown>
    }
    expect(Object.keys(commonJs.rules)).toContain("prefer-trans-in-jsx")
    expect(readFileSync(path.join(packageRoot, "dist/index.mjs"), "utf8")).toContain(
      "prefer-trans-in-jsx"
    )
  })
})
