import { describe, expect, it } from "vitest"

import { withPalamedes } from "./index"

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
})
