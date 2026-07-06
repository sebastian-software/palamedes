import { describe, expect, it } from "vitest"

import { createPalamedesRemixLoadHook } from "./index"

const loadContext = {
  conditions: ["node", "import"],
  format: "module",
  importAttributes: {},
}

describe("createPalamedesRemixLoadHook", () => {
  it("transforms Palamedes JS macros after the Remix loader returns source", () => {
    const load = createPalamedesRemixLoadHook()
    const oldMap = Buffer.from(JSON.stringify({ version: 3, mappings: "" }), "utf8").toString(
      "base64"
    )
    const loaded = load(new URL("file:///repo/app/routes/home.tsx").href, loadContext, () => ({
      format: "module",
      shortCircuit: true,
      source: [
        'import { t } from "@palamedes/core/macro"',
        "export function greeting(name) {",
        "  return t`Hello ${name} from Remix 3`",
        "}",
        `//# sourceMappingURL=data:application/json;base64,${oldMap}`,
      ].join("\n"),
    }))

    expect(String(loaded.source)).toContain('import { getI18n } from "@palamedes/runtime"')
    expect(String(loaded.source)).toContain("getI18n()._(")
    expect(String(loaded.source)).toContain("Hello ")
    expect(String(loaded.source)).not.toContain(oldMap)
    expect(String(loaded.source)).toMatch(
      /\/\/# sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+$/u
    )
  })

  it("delegates unchanged source when a module has no Palamedes macros", () => {
    const source = "export const value = 1"
    const load = createPalamedesRemixLoadHook()

    const loaded = load(new URL("file:///repo/app/routes/home.tsx").href, loadContext, () => ({
      format: "module",
      shortCircuit: true,
      source,
    }))

    expect(loaded.source).toBe(source)
  })

  it("skips non-file urls and node_modules", () => {
    const source = 'import { t } from "@palamedes/core/macro"; export const label = t`Hello`'
    const load = createPalamedesRemixLoadHook()

    const virtual = load("data:text/javascript,export{}", loadContext, () => ({
      format: "module",
      source,
    }))
    const dependency = load(
      new URL("file:///repo/node_modules/demo/index.ts").href,
      loadContext,
      () => ({
        format: "module",
        source,
      })
    )

    expect(virtual.source).toBe(source)
    expect(dependency.source).toBe(source)
  })

  it("does not exclude paths that only contain node_modules as a substring", () => {
    const source = 'import { t } from "@palamedes/core/macro"; export const label = t`Hello`'
    const load = createPalamedesRemixLoadHook()

    const loaded = load(
      new URL("file:///repo/my_node_modules_demo/index.ts").href,
      loadContext,
      () => ({
        format: "module",
        source,
      })
    )

    expect(String(loaded.source)).toContain("getI18n()._(")
  })
})
