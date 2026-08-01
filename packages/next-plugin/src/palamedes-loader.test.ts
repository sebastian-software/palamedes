import { createRequire } from "node:module"
import Module from "node:module"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const loaderPath = "../palamedes-loader.cjs"
const moduleLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const originalLoad = moduleLoader._load
const transformPalamedesMacros = vi.fn()

beforeEach(() => {
  transformPalamedesMacros.mockReturnValue({
    code: "export const translated = true",
    map: null,
  })
  moduleLoader._load = (request, parent, isMain) => {
    if (request === "@palamedes/transform") {
      return { transformPalamedesMacros }
    }
    return originalLoad.call(Module, request, parent, isMain)
  }
})

afterEach(() => {
  moduleLoader._load = originalLoad
  vi.restoreAllMocks()
  delete require.cache[require.resolve(loaderPath)]
})

describe("palamedes-loader.cjs", () => {
  it("forwards the source fallback policy to the native transform", async () => {
    const output = await runLoader({
      runtimeModule: "@palamedes/react/runtime",
      keepSourceFallbacks: false,
      stripNonEssentialProps: true,
    })

    expect(output).toBe("export const translated = true")
    expect(transformPalamedesMacros).toHaveBeenCalledWith(
      expect.any(String),
      "/repo/src/page.tsx",
      expect.objectContaining({
        runtimeModule: "@palamedes/react/runtime",
        keepSourceFallbacks: false,
        stripNonEssentialProps: true,
      })
    )
  })
})

async function runLoader(options: Record<string, unknown>): Promise<string> {
  delete require.cache[require.resolve(loaderPath)]
  const loader = require(loaderPath) as (this: unknown, source: string) => void

  return new Promise<string>((resolve, reject) => {
    loader.call(
      {
        resourcePath: "/repo/src/page.tsx",
        sourceMap: true,
        getOptions() {
          return options
        },
        async() {
          return (error: Error | null, output?: string) => {
            if (error) {
              reject(error)
              return
            }
            resolve(output ?? "")
          }
        },
      },
      'import { t } from "@palamedes/core/macro"; export function label() { return t`Hello` }'
    )
  })
}
