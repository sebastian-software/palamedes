import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import { withPalamedes } from "./index"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const nextExampleRoot = fileURLToPath(new URL("../../../examples/nextjs-cookie", import.meta.url))
const serverInitializerModule = "@palamedes/next-plugin/server-function-initializer"
const serverEntryModule = "@palamedes/next-plugin/server-function-entry"

function useNextExampleProject(): void {
  vi.spyOn(process, "cwd").mockReturnValue(nextExampleRoot)
}

type RuleItem = {
  condition?: unknown
  loaders?: { loader: string; options?: Record<string, unknown> }[]
  as?: string
}

function getRules(config: ReturnType<typeof withPalamedes>): Record<string, unknown> {
  return (config.turbopack?.rules ?? {}) as Record<string, unknown>
}

function conditionList(rule: RuleItem): unknown[] {
  return (rule.condition as { all: unknown[] }).all
}

describe("withPalamedes turbopack config", () => {
  it("uses the hook-free macro runtime", () => {
    const config = withPalamedes()

    const rule = getRules(config)["*"] as RuleItem
    expect(rule.loaders?.[0]?.options).toMatchObject({ runtimeModule: "@palamedes/runtime" })
  })

  it("lets an explicit runtime module override the default", () => {
    const config = withPalamedes({}, { runtimeModule: "@acme/custom-runtime" })

    const rule = getRules(config)["*"] as RuleItem
    expect(rule.loaders?.[0]?.options).toMatchObject({
      runtimeModule: "@acme/custom-runtime",
    })
  })

  it.each([
    ["development", true, false],
    ["production", false, true],
  ] as const)(
    "sets runtime fallback metadata for the %s Turbopack mode",
    (mode, expectedFallbacks, expectedMetadataStrip) => {
      vi.stubEnv("NODE_ENV", mode)
      const config = withPalamedes()

      const rule = getRules(config)["*"] as RuleItem
      expect(rule.loaders?.[0]?.options).toMatchObject({
        keepSourceFallbacks: expectedFallbacks,
        stripNonEssentialProps: expectedMetadataStrip,
      })
    }
  )

  it("lets keepSourceFallbacks override the Next mode default", () => {
    vi.stubEnv("NODE_ENV", "production")
    const config = withPalamedes({}, { keepSourceFallbacks: true })

    const rule = getRules(config)["*"] as RuleItem
    expect(rule.loaders?.[0]?.options).toMatchObject({ keepSourceFallbacks: true })
  })

  it("translates include/exclude options into the turbopack rule condition", () => {
    const include = /\.custom\.tsx?$/
    const exclude = /[/\\]vendored[/\\]/
    const config = withPalamedes({}, { include, exclude })

    const rule = getRules(config)["*"] as RuleItem
    const conditions = conditionList(rule)

    expect(conditions).toContainEqual({ path: include })
    expect(conditions).toContainEqual({ not: { path: exclude } })
  })

  it("matches all macro packages in the content pre-filter", () => {
    const config = withPalamedes()
    const rule = getRules(config)["*"] as RuleItem
    const content = (
      conditionList(rule).find(
        (condition) => typeof condition === "object" && condition !== null && "content" in condition
      ) as { content: RegExp }
    ).content

    expect(content.test('import { t } from "@palamedes/core/macro"')).toBe(true)
    expect(content.test('import { Trans } from "@palamedes/react/macro"')).toBe(true)
    expect(content.test('import { Trans } from "@palamedes/solid/macro"')).toBe(true)
    expect(content.test('import { t } from "other-i18n"')).toBe(false)
  })

  it("matches Server Function directives and forwards the initializer when configured", () => {
    useNextExampleProject()
    const config = withPalamedes({}, { serverFunctions: true })
    const configuredRules = getRules(config)["*"] as RuleItem[]
    const rule = configuredRules.find((candidate) =>
      conditionList(candidate).some(
        (condition) =>
          typeof condition === "object" &&
          condition !== null &&
          "not" in condition &&
          condition.not === "browser"
      )
    )!
    const content = (
      conditionList(rule).find(
        (condition) => typeof condition === "object" && condition !== null && "content" in condition
      ) as { content: RegExp }
    ).content

    expect(content.test('async function save() { "use server" }')).toBe(true)
    expect(rule.loaders?.[0]?.options).toMatchObject({
      serverFunctions: {
        initializerModule: serverInitializerModule,
        initializerExport: "initializeServerFunctionI18n",
      },
      serverMessageSplitting: true,
    })
    expect(config.turbopack?.resolveAlias).toMatchObject({
      [serverEntryModule]: "./src/palamedes.server.ts",
    })
  })

  it("keeps server message loaders out of the Turbopack browser graph", () => {
    useNextExampleProject()
    const configuredRules = getRules(withPalamedes({}, { serverFunctions: true }))[
      "*"
    ] as RuleItem[]
    const browserRule = configuredRules.find((candidate) =>
      conditionList(candidate).includes("browser")
    )

    expect(browserRule?.loaders?.[0]?.options).not.toHaveProperty("serverMessageSplitting")
  })

  it("requires the conventional Server Function entry module when enabled", () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join(nextExampleRoot, "missing"))

    expect(() => withPalamedes({}, { serverFunctions: true })).toThrow(
      "requires a palamedes.server module"
    )
  })

  it("appends to user-supplied turbopack rules instead of overwriting them", () => {
    const userRule = {
      condition: { path: /\.svg$/ },
      loaders: ["user-svg-loader"],
    }
    const config = withPalamedes({
      turbopack: {
        rules: {
          "*": userRule,
          "*.mdx": { loaders: ["user-mdx-loader"] },
        },
      },
    })

    const rules = getRules(config)
    expect(rules["*.mdx"]).toStrictEqual({ loaders: ["user-mdx-loader"] })

    const starRule = rules["*"] as unknown[]
    expect(Array.isArray(starRule)).toBe(true)
    expect(starRule[0]).toBe(userRule)
    expect((starRule[1] as RuleItem).loaders?.[0]?.loader).toContain("palamedes-loader")
  })

  it("registers the po loader rule unless disabled", () => {
    const enabled = getRules(withPalamedes())
    expect((enabled["*.po"] as RuleItem).as).toBe("*.js")

    const disabled = getRules(withPalamedes({}, { enablePoLoader: false }))
    expect(disabled["*.po"]).toBeUndefined()
  })

  it("wraps a user loader shorthand into a rule config before appending", () => {
    const config = withPalamedes({
      turbopack: {
        rules: {
          "*": ["user-loader-a", { loader: "user-loader-b", options: { flag: true } }],
        },
      },
    })

    const starRule = getRules(config)["*"] as RuleItem[]
    expect(starRule).toHaveLength(2)
    // The shorthand run keeps its order and becomes one equivalent rule config.
    expect(starRule[0]).toStrictEqual({
      loaders: ["user-loader-a", { loader: "user-loader-b", options: { flag: true } }],
    })
    expect(starRule[1]?.loaders?.[0]?.loader).toContain("palamedes-loader")
  })

  it("keeps rule configs and loader shorthand separate in a mixed list", () => {
    const ruleConfig = { condition: { path: /\.svg$/ }, loaders: ["user-svg-loader"] }
    const config = withPalamedes({
      turbopack: {
        rules: {
          "*": [ruleConfig, "trailing-loader"],
        },
      },
    })

    const starRule = getRules(config)["*"] as RuleItem[]
    expect(starRule).toHaveLength(3)
    expect(starRule[0]).toBe(ruleConfig)
    expect(starRule[1]).toStrictEqual({ loaders: ["trailing-loader"] })
    expect(starRule[2]?.loaders?.[0]?.loader).toContain("palamedes-loader")
  })
})

type WebpackRule = {
  test?: RegExp
  exclude?: RegExp
  type?: string
  use?: { loader: string; options?: Record<string, unknown> }[]
}

function collectWebpackRules(
  config: ReturnType<typeof withPalamedes>,
  context: Record<string, unknown> = {}
): WebpackRule[] {
  const rules: WebpackRule[] = []
  const webpack = config.webpack as (
    config: { module: { rules: WebpackRule[] } },
    context: unknown
  ) => unknown
  webpack({ module: { rules } }, context)
  return rules
}

describe("withPalamedes webpack config", () => {
  it("forwards Server Function instrumentation to webpack", () => {
    useNextExampleProject()
    const rules = collectWebpackRules(withPalamedes({}, { serverFunctions: true }), {
      isServer: true,
    })
    const transformRule = rules.find((rule) => rule.use?.[0]?.loader.includes("palamedes-loader"))

    expect(transformRule?.use?.[0]?.options).toMatchObject({
      serverFunctions: {
        initializerModule: serverInitializerModule,
        initializerExport: "initializeServerFunctionI18n",
      },
      serverMessageSplitting: true,
    })
  })

  it("keeps server message loaders out of the webpack client compiler", () => {
    useNextExampleProject()
    const rules = collectWebpackRules(withPalamedes({}, { serverFunctions: true }), {
      isServer: false,
    })
    const transformRule = rules.find((rule) => rule.use?.[0]?.loader.includes("palamedes-loader"))

    expect(transformRule?.use?.[0]?.options).not.toHaveProperty("serverMessageSplitting")
  })

  it("excludes node_modules from the po loader rule", () => {
    const poRule = collectWebpackRules(withPalamedes()).find((rule) =>
      rule.test?.source.includes("po")
    )

    expect(poRule).toBeDefined()
    expect(poRule?.exclude).toBeInstanceOf(RegExp)
    expect(poRule?.exclude?.test("/app/node_modules/some-dep/messages/de.po")).toBe(true)
    expect(poRule?.exclude?.test("/app/src/locales/de.po")).toBe(false)
  })

  it("omits the po loader rule when disabled", () => {
    const rules = collectWebpackRules(withPalamedes({}, { enablePoLoader: false }))
    expect(rules.some((rule) => rule.test?.source.includes("po"))).toBe(false)
  })
})
