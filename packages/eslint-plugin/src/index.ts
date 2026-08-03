import { eslintCompatPlugin, type Context, type Rule } from "@oxlint/plugins"
import type { ESLint } from "eslint"

import {
  createAnalysisCoordinator,
  mightContainPalamedesSource,
  utf8ByteOffsetToUtf16Index,
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
          const result = analysis.analyzeContext({
            filename,
            sourceCode: context.sourceCode,
          })
          if (result.failure) {
            context.report({
              loc: {
                start: { line: 1, column: 0 },
                end: { line: 1, column: Math.min(1, context.sourceCode.text.length) },
              },
              message: `Palamedes native analysis failed: ${result.failure}`,
            })
            return
          }

          for (const diagnostic of result.diagnostics) {
            if (diagnostic.code !== code) continue
            const start = utf8ByteOffsetToUtf16Index(
              context.sourceCode.text,
              diagnostic.primary.start
            )
            const end = utf8ByteOffsetToUtf16Index(context.sourceCode.text, diagnostic.primary.end)
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
