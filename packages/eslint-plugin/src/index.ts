import { eslintCompatPlugin, type Context, type Rule } from "@oxlint/plugins"
import type { ESLint } from "eslint"

import {
  createAnalysisCoordinator,
  mightContainPalamedesSource,
  nativeFailureLocationToUtf16Index,
} from "./analysis"

type DiagnosticCode =
  | "pmds/no-placeholder-only-message"
  | "pmds/no-empty-component-only-message"
  | "pmds/prefer-trans-in-jsx"

type CompatibleContext = Context & {
  filename?: string
  getFilename?: () => string
  sourceCode: Context["sourceCode"] & {
    getLocFromIndex(index: number): { line: number; column: number }
  }
}

const analysis = createAnalysisCoordinator()

function createFacade(code: DiagnosticCode, description: string): Rule {
  return {
    meta: {
      type: "suggestion",
      docs: { description },
      schema: [],
    },
    createOnce(rawContext) {
      const context = rawContext as CompatibleContext
      return {
        before() {
          return mightContainPalamedesSource(context.sourceCode.text) ? undefined : false
        },
        Program() {
          const filename = context.filename ?? context.getFilename?.() ?? "<input>"
          const analysisContext = {
            filename,
            sourceCode: context.sourceCode,
          }
          const failure = analysis.takeUnreportedFailure(analysisContext)
          if (failure) {
            const failureStart = failure.location
              ? nativeFailureLocationToUtf16Index(context.sourceCode.text, failure.location)
              : undefined
            const start = failureStart ?? 0
            context.report({
              loc: {
                start: context.sourceCode.getLocFromIndex(start),
                end: context.sourceCode.getLocFromIndex(
                  nextCodePointIndex(context.sourceCode.text, start)
                ),
              },
              // ESLint-compatible rule APIs derive ruleId from the active
              // facade; the message makes clear this is not a rule finding.
              message: `Palamedes native analysis failed: ${failure.message}`,
            })
            return
          }

          const result = analysis.analyzeContext(analysisContext)

          for (const [diagnosticIndex, diagnostic] of result.diagnostics.entries()) {
            if (diagnostic.code !== code) continue
            const range = result.utf16PrimaryRanges[diagnosticIndex]
            if (!range) continue
            const { start, end } = range
            context.report({
              loc: {
                start: context.sourceCode.getLocFromIndex(start),
                end: context.sourceCode.getLocFromIndex(Math.max(start, end)),
              },
              message: `${diagnostic.message} ${diagnostic.help}`,
            })
          }
        },
      }
    },
  }
}

function nextCodePointIndex(source: string, index: number): number {
  const codePoint = source.codePointAt(index)
  return Math.min(source.length, index + (codePoint !== undefined && codePoint > 0xff_ff ? 2 : 1))
}

const rules = {
  "no-placeholder-only-message": createFacade(
    "pmds/no-placeholder-only-message",
    "Disallow Palamedes messages that contain placeholders but no translatable text."
  ),
  "no-empty-component-only-message": createFacade(
    "pmds/no-empty-component-only-message",
    "Disallow Palamedes messages that consist only of one empty component placeholder."
  ),
  "prefer-trans-in-jsx": createFacade(
    "pmds/prefer-trans-in-jsx",
    "Suggest Trans for translation calls in safe, directly renderable JSX positions."
  ),
}

const plugin = eslintCompatPlugin({
  meta: {
    name: "@palamedes/eslint-plugin",
  },
  rules,
}) as unknown as ESLint.Plugin

type PalamedesFlatConfig = {
  plugins: Record<string, ESLint.Plugin>
  rules: Record<string, "warn">
}

export const configs: Record<"recommended", PalamedesFlatConfig> = {
  recommended: {
    plugins: { palamedes: plugin },
    rules: {
      "palamedes/no-placeholder-only-message": "warn",
      "palamedes/prefer-trans-in-jsx": "warn",
    },
  },
}

Object.assign(plugin, { configs })

export { rules }
export default plugin
