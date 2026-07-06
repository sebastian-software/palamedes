import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as CoreNode from "@palamedes/core-node"

import { createPalamedesRemixLoadHook } from "./index"

const mocks = vi.hoisted(() => ({
  compileCatalogModule: vi.fn(),
  loadPalamedesConfigSync: vi.fn(),
}))

vi.mock("@palamedes/config", () => ({
  loadPalamedesConfigSync: mocks.loadPalamedesConfigSync,
}))

vi.mock("@palamedes/core-node", async (importOriginal) => ({
  ...(await importOriginal<typeof CoreNode>()),
  compileCatalogModule: mocks.compileCatalogModule,
}))

const loadContext = {
  conditions: ["node", "import"],
  format: "module",
  importAttributes: {},
}

describe("createPalamedesRemixLoadHook", () => {
  beforeEach(() => {
    mocks.loadPalamedesConfigSync.mockReturnValue({
      rootDir: "/repo",
      locales: ["en", "de"],
      sourceLocale: "en",
      pseudoLocale: undefined,
      fallbackLocales: undefined,
      catalogs: [{ path: "app/locales/{locale}", include: ["app"] }],
    })
    mocks.compileCatalogModule.mockReturnValue({
      code: 'export const messages={"greeting":"Hallo"};export default { messages };',
      warnings: [],
      watchFiles: ["/repo/app/locales/en.po"],
    })
  })

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

  it("compiles PO catalog imports without delegating to the default loader", () => {
    const load = createPalamedesRemixLoadHook()
    const nextLoad = vi.fn()

    const loaded = load(new URL("file:///repo/app/locales/de.po").href, loadContext, nextLoad)

    expect(nextLoad).not.toHaveBeenCalled()
    expect(loaded).toStrictEqual({
      format: "module",
      shortCircuit: true,
      source: 'export const messages={"greeting":"Hallo"};export default { messages };',
    })
    expect(mocks.loadPalamedesConfigSync).toHaveBeenCalledWith({
      configPath: undefined,
      cwd: "/repo/app/locales",
    })
    expect(mocks.compileCatalogModule).toHaveBeenCalledWith(
      expect.objectContaining({ rootDir: "/repo", sourceLocale: "en" }),
      "/repo/app/locales/de.po",
      expect.objectContaining({ locale: "de" })
    )
  })

  it("skips CommonJS files by default because runtime injection is ESM", () => {
    const source = 'import { t } from "@palamedes/core/macro"; export const label = t`Hello`'
    const load = createPalamedesRemixLoadHook()

    const loaded = load(new URL("file:///repo/app/legacy.cjs").href, loadContext, () => ({
      format: "commonjs",
      source,
    }))

    expect(loaded.source).toBe(source)
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
