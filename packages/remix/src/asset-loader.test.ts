import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { createAssetServer } from "remix/assets"
import { afterEach, describe, expect, it } from "vitest"

import { createPalamedesRemixAssetLoader, PALEMEDES_REMIX_ASSET_PACKAGES } from "./index"

const assetLoadContext = {
  conditions: ["browser", "import", "module", "default"],
  format: "module",
  importAttributes: {},
  moduleUrl: "/assets/app/public/module.js",
}

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe("createPalamedesRemixAssetLoader", () => {
  it("allows every package required by transformed and bootstrapped browser modules", () => {
    expect(PALEMEDES_REMIX_ASSET_PACKAGES).toStrictEqual([
      "@palamedes/core",
      "@palamedes/runtime",
      "@palamedes/remix",
    ])
  })

  it.each([
    [
      "TypeScript",
      "greeting.ts",
      [
        'import { t } from "@palamedes/core/macro"',
        "export function greeting(name: string): string {",
        "  return t`Hello ${name}`",
        "}",
      ].join("\n"),
    ],
    [
      "JavaScript",
      "greeting.js",
      [
        'import { t } from "@palamedes/core/macro"',
        "export function greeting(name) {",
        "  return t`Hello ${name}`",
        "}",
      ].join("\n"),
    ],
  ])(
    "transforms %s browser modules after Remix compilation",
    async (_language, fileName, source) => {
      const fixture = createAssetFixture(fileName, source)
      const assetServer = createAssetServer({
        rootDir: fixture.rootDir,
        basePath: "/assets",
        allowFiles: ["app/**/public/**"],
        allowPackages: [...PALEMEDES_REMIX_ASSET_PACKAGES],
        watch: false,
        scripts: { loaders: [createPalamedesRemixAssetLoader()] },
      })

      try {
        const response = await assetServer.fetch(
          new Request(`http://example.test/assets/app/public/${fileName}`)
        )
        expect(response?.status).toBe(200)
        const compiled = await response?.text()

        expect(compiled).toContain("getI18n()._(")
        expect(compiled).not.toContain("@palamedes/core/macro")
        expect(compiled).not.toContain('from "@palamedes/runtime"')
        expect(compiled).toMatch(/from ["']\/assets\/npm\/%40palamedes\/runtime\//u)
        if (fileName.endsWith(".ts")) {
          expect(compiled).not.toContain("name: string")
        }
      } finally {
        await assetServer.close()
      }
    }
  )

  it("wraps transform errors with the browser module path", () => {
    const loader = createPalamedesRemixAssetLoader()
    const url = pathToFileURL("/repo/app/public/broken.ts").href

    expect(() =>
      loader(url, assetLoadContext, () => ({
        format: "module",
        source: [
          'import { t } from "@palamedes/core/macro"',
          "export function greeting() {",
          '  return t({ id: "explicit", message: "Hello" })',
          "}",
        ].join("\n"),
      }))
    ).toThrow(
      /Failed to transform Palamedes macros in \/repo\/app\/public\/broken\.ts:.*Explicit message ids/u
    )
  })

  it("targets the Remix UI compiled runtime for lowered rich messages", () => {
    const loader = createPalamedesRemixAssetLoader()
    const loaded = loader(pathToFileURL("/repo/app/public/rich.js").href, assetLoadContext, () => ({
      format: "module",
      source: [
        'import { Trans as Message } from "@palamedes/remix/macro"',
        'import { jsxs } from "remix/ui/jsx-runtime"',
        'export const view = jsxs(Message, { children: ["Hello ", name] })',
      ].join("\n"),
    }))

    expect(String(loaded.source)).toContain('import { Trans } from "@palamedes/remix/compiled"')
    expect(String(loaded.source)).toContain('jsxs(Trans, { id: "')
    expect(String(loaded.source)).not.toContain("@palamedes/remix/macro")
  })

  it("honors browser-specific include and exclude filters", () => {
    const source = [
      'import { t } from "@palamedes/core/macro"',
      "export function greeting() { return t`Hello` }",
    ].join("\n")
    const loader = createPalamedesRemixAssetLoader({
      include: /[/\\]public[/\\].*\.js$/u,
      exclude: /[/\\]public[/\\]excluded[/\\]/u,
    })
    const load = (filePath: string) =>
      loader(pathToFileURL(filePath).href, assetLoadContext, () => ({
        format: "module",
        source,
      }))

    expect(String(load("/repo/app/public/included.js").source)).toContain("getI18n()._(")
    expect(load("/repo/app/private/not-included.js").source).toBe(source)
    expect(load("/repo/app/public/excluded/skip.js").source).toBe(source)
  })
})

function createAssetFixture(fileName: string, source: string): { rootDir: string } {
  const rootDir = mkdtempSync(path.join(tmpdir(), "palamedes-remix-assets-"))
  tempDirectories.push(rootDir)
  const publicDirectory = path.join(rootDir, "app", "public")
  const palamedesPackages = path.join(rootDir, "node_modules", "@palamedes")
  const corePath = path.resolve(import.meta.dirname, "../..", "core")
  const runtimePath = path.resolve(import.meta.dirname, "../..", "runtime")
  const installedCorePath = path.join(palamedesPackages, "core")
  const installedRuntimePath = path.join(palamedesPackages, "runtime")
  const installedRemixIntegrationPath = path.join(palamedesPackages, "remix")
  mkdirSync(publicDirectory, { recursive: true })
  mkdirSync(installedCorePath, { recursive: true })
  mkdirSync(installedRuntimePath, { recursive: true })
  mkdirSync(installedRemixIntegrationPath, { recursive: true })
  writeFileSync(path.join(publicDirectory, fileName), source)
  copyFileSync(path.join(corePath, "package.json"), path.join(installedCorePath, "package.json"))
  cpSync(path.join(corePath, "dist"), path.join(installedCorePath, "dist"), {
    recursive: true,
  })
  copyFileSync(
    path.join(runtimePath, "package.json"),
    path.join(installedRuntimePath, "package.json")
  )
  cpSync(path.join(runtimePath, "dist"), path.join(installedRuntimePath, "dist"), {
    recursive: true,
  })
  writeFileSync(
    path.join(installedRemixIntegrationPath, "package.json"),
    JSON.stringify({
      name: "@palamedes/remix",
      type: "module",
      exports: { "./compiled": "./compiled.js" },
    })
  )
  return { rootDir }
}
