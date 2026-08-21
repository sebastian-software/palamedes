import { describe, expect, it, vi } from "vitest"

import type * as PalamedesConfigModule from "@palamedes/config"
import type * as PalamedesCoreNodeModule from "@palamedes/core-node"
import type * as ViteModule from "vite"

const mocks = vi.hoisted(() => ({
  analyzeMdxNative: vi.fn(),
  loadPalamedesConfig: vi.fn(),
}))

vi.mock("vite", async (importOriginal) => ({
  ...(await importOriginal<typeof ViteModule>()),
  version: "7.4.0",
}))

vi.mock("@palamedes/config", async (importOriginal) => {
  const actual = await importOriginal<typeof PalamedesConfigModule>()
  return {
    ...actual,
    loadPalamedesConfig: mocks.loadPalamedesConfig,
  }
})

vi.mock("@palamedes/core-node", async (importOriginal) => ({
  ...(await importOriginal<typeof PalamedesCoreNodeModule>()),
  analyzeMdxNative: mocks.analyzeMdxNative,
}))

import { palamedes } from "./index"

function mdxTransform(options: Parameters<typeof palamedes>[0] = {}) {
  const transform = palamedes(options).find((plugin) => plugin.name === "palamedes:mdx")?.transform
  if (typeof transform !== "function") {
    throw new TypeError("Expected palamedes:mdx transform hook")
  }
  return transform
}

function mdxConfig(options: Parameters<typeof palamedes>[0] = {}) {
  const config = palamedes(options).find((plugin) => plugin.name === "palamedes:mdx")?.config
  if (typeof config !== "function") {
    throw new TypeError("Expected palamedes:mdx config hook")
  }
  return config
}

describe("React MDX compatibility with Rollup-based Vite", () => {
  it("does not pass Rolldown-only module types to Vite 7", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    })

    await expect(mdxConfig().call({} as any, {} as any, {} as any)).resolves.toBeUndefined()
  })

  it("stops React MDX on Vite 7 before generated JSX reaches Rollup", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    })
    const error = vi.fn((message: string) => {
      throw new Error(message)
    })

    await expect(
      mdxTransform().call({ addWatchFile() {}, error } as any, "# Welcome", "/repo/page.mdx")
    ).rejects.toThrow(
      "Palamedes React MDX compilation requires Vite 8 or newer because Vite 7's Rollup pipeline cannot parse generated JSX from .mdx files."
    )
    expect(mocks.analyzeMdxNative).not.toHaveBeenCalled()
  })

  it("keeps Solid MDX available on Vite 7 without React's module type", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    })
    mocks.analyzeMdxNative.mockReturnValue({
      code: "export default function Page() {}",
      compiledIds: [],
      diagnostics: [],
      map: null,
    })

    await expect(
      mdxTransform({ mdx: { framework: "solid" } }).call(
        { addWatchFile() {} } as any,
        "# Welcome",
        "/repo/page.mdx"
      )
    ).resolves.toEqual({ code: "export default function Page() {}", map: null })
  })

  it("does not add an MDX compiler when it is disabled", () => {
    expect(palamedes({ mdx: false }).some((plugin) => plugin.name === "palamedes:mdx")).toBe(false)
  })
})
