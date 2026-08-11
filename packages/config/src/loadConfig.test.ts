import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

import { afterEach, describe, expect, it } from "vitest"

import {
  catalogMatchesSource,
  catalogResourcePath,
  loadPalamedesConfig,
  loadPalamedesConfigSync,
  resolveCatalogPath,
} from "./index"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe("loadPalamedesConfig", () => {
  it("loads a palamedes.config.ts file from the current directory tree", async () => {
    const fixtureDir = await createTempDir()
    const nestedDir = path.join(fixtureDir, "apps", "web")

    await mkdir(nestedDir, { recursive: true })
    await writeFile(
      path.join(fixtureDir, "palamedes.config.ts"),
      `
        export default {
          locales: ["en", "de"],
          sourceLocale: "en",
          referenceScopes: false,
          catalogs: [
            {
              path: "src/locales/{locale}",
              include: ["src"],
            },
          ],
        }
      `
    )

    const config = await loadPalamedesConfig({ cwd: nestedDir })

    expect(config.rootDir).toBe(fixtureDir)
    expect(config.sourceLocale).toBe("en")
    expect(config.referenceScopes).toBe(false)
    expect(config.catalogs[0]?.path).toBe("src/locales/{locale}")
  })

  it("loads a palamedes.yaml file with native field names", async () => {
    const fixtureDir = await createTempDir()

    await writeFile(
      path.join(fixtureDir, "palamedes.yaml"),
      `
        locales: [en, de]
        source-locale: en
        source-reference-root: config
        reference-scopes: false
        catalogs:
          - path: src/locales/{locale}
            format: fcl
            include: [src]
            exclude: [src/generated]
        plugins:
          - "@acme/palamedes-workflows"
          - ["./local-plugin.mjs", { mode: strict }]
      `
    )

    const config = await loadPalamedesConfig({ cwd: fixtureDir })

    expect(config.rootDir).toBe(fixtureDir)
    expect(config.sourceLocale).toBe("en")
    expect(config.sourceReferenceRoot).toBe(fixtureDir)
    expect(config.referenceScopes).toBe(false)
    expect(config.catalogs[0]).toStrictEqual({
      path: "src/locales/{locale}",
      format: "fcl",
      include: ["src"],
      exclude: ["src/generated"],
    })
    expect(config.plugins).toStrictEqual([
      "@acme/palamedes-workflows",
      ["./local-plugin.mjs", { mode: "strict" }],
    ])
  })

  it("normalizes source lint rules from data configs", async () => {
    const fixtureDir = await createTempDir()
    await writeFile(
      path.join(fixtureDir, "palamedes.yaml"),
      `
        locales: [en]
        source-locale: en
        lint:
          rules:
            placeholder-only: error
            empty-component-only: warning
            prefer-trans-in-jsx: off
        catalogs:
          - path: src/locales/{locale}
            include: [src]
      `
    )

    const config = await loadPalamedesConfig({ cwd: fixtureDir })

    expect(config.lint).toStrictEqual({
      rules: {
        placeholderOnly: "error",
        emptyComponentOnly: "warning",
        preferTransInJsx: "off",
      },
    })
  })

  it("loads PO output options from JavaScript and data configs", async () => {
    const jsDir = await createTempDir()
    await writeFile(
      path.join(jsDir, "palamedes.config.ts"),
      `
        export default {
          locales: ["en"],
          sourceLocale: "en",
          catalogs: [{
            path: "src/locales/{locale}",
            include: ["src"],
            po: { lineBreaks: "off" },
          }],
        }
      `
    )

    const jsConfig = await loadPalamedesConfig({ cwd: jsDir })
    expect(jsConfig.catalogs[0]?.po).toStrictEqual({ lineBreaks: "off" })

    const dataDir = await createTempDir()
    await writeFile(
      path.join(dataDir, "palamedes.yaml"),
      `
        locales: [en]
        source-locale: en
        catalogs:
          - path: src/locales/{locale}
            include: [src]
            po:
              line-breaks: "off"
      `
    )

    const dataConfig = loadPalamedesConfigSync({ cwd: dataDir })
    expect(dataConfig.catalogs[0]?.po).toStrictEqual({ lineBreaks: "off" })
  })

  /*
   * The documented spelling is quoted, but a YAML 1.1 parser upstream — or a
   * TOML/JSON config — can hand us a real boolean here. Both must land on
   * "off" rather than tripping the value check.
   */
  it("accepts a boolean false for data-config line breaks", async () => {
    const dataDir = await createTempDir()
    await writeFile(
      path.join(dataDir, "palamedes.json"),
      JSON.stringify({
        locales: ["en"],
        "source-locale": "en",
        catalogs: [
          { path: "src/locales/{locale}", include: ["src"], po: { "line-breaks": false } },
        ],
      })
    )

    const config = loadPalamedesConfigSync({ cwd: dataDir })
    expect(config.catalogs[0]?.po).toStrictEqual({ lineBreaks: "off" })
  })

  it("rejects invalid PO output option combinations", async () => {
    for (const [name, catalog, expected] of [
      [
        "fcl",
        `format: "fcl", po: { lineBreaks: "off" }`,
        /po" can only be used when the catalog format is "po"/,
      ],
      [
        "removed-order-by",
        `po: { orderBy: "collated" }`,
        /unknown key "catalogs\[0\]\.po\.orderBy"/,
      ],
      ["bad-line-breaks", `po: { lineBreaks: "wrap" }`, /lineBreaks" must be "auto" or "off"/],
    ] as const) {
      const fixtureDir = await createTempDir()
      await writeFile(
        path.join(fixtureDir, `palamedes.config.${name}.ts`),
        `
          export default {
            locales: ["en"],
            sourceLocale: "en",
            catalogs: [{ path: "locales/{locale}", include: ["src"], ${catalog} }],
          }
        `
      )

      await expect(
        loadPalamedesConfig({
          cwd: fixtureDir,
          configPath: `palamedes.config.${name}.ts`,
        })
      ).rejects.toThrow(expected)
    }
  })

  it("rejects camelCase PO option keys in data configs", async () => {
    const fixtureDir = await createTempDir()
    await writeFile(
      path.join(fixtureDir, "palamedes.yaml"),
      `
        locales: [en]
        source-locale: en
        catalogs:
          - path: locales/{locale}
            include: [src]
            po:
              lineBreaks: "off"
      `
    )

    await expect(loadPalamedesConfig({ cwd: fixtureDir })).rejects.toThrow(
      /unknown key "catalogs\[0\]\.po\.lineBreaks".*"catalogs\[0\]\.po\.line-breaks"/
    )
  })

  it("rejects unknown PO option keys instead of silently dropping them", async () => {
    for (const [filename, content] of [
      [
        "palamedes.yaml",
        `
          locales: [en]
          source-locale: en
          catalogs:
            - path: locales/{locale}
              include: [src]
              po:
                line-break: "off"
        `,
      ],
      [
        "palamedes.config.ts",
        `
          export default {
            locales: ["en"],
            sourceLocale: "en",
            catalogs: [{
              path: "locales/{locale}",
              include: ["src"],
              po: { lineBreak: "off" },
            }],
          }
        `,
      ],
    ]) {
      const fixtureDir = await createTempDir()
      await writeFile(path.join(fixtureDir, filename), content)

      await expect(loadPalamedesConfig({ cwd: fixtureDir })).rejects.toThrow(
        /unknown key "catalogs\[0\]\.po\.line-?break"/i
      )
    }
  })

  it("normalizes and validates MDX data-config options", async () => {
    const fixtureDir = await createTempDir()

    await writeFile(
      path.join(fixtureDir, "palamedes.yaml"),
      `
        locales: [en, de]
        source-locale: en
        mdx:
          framework: solid
          translatable-attributes: [alt, title]
          front-matter-fields: [title, description]
          ignore-directive: no-translate
        catalogs:
          - path: src/locales/{locale}
            include: [src]
      `
    )

    const config = await loadPalamedesConfig({ cwd: fixtureDir })

    expect(config.mdx).toStrictEqual({
      framework: "solid",
      translatableAttributes: ["alt", "title"],
      frontMatterFields: ["title", "description"],
      ignoreDirective: "no-translate",
    })
  })

  it("loads a palamedes.yaml file synchronously with the same normalization", async () => {
    const fixtureDir = await createTempDir()

    await writeFile(
      path.join(fixtureDir, "palamedes.yaml"),
      `
        locales: [en, de]
        source-locale: en
        source-reference-root: config
        catalogs:
          - path: src/locales/{locale}
            include: [src]
      `
    )

    const config = loadPalamedesConfigSync({ cwd: fixtureDir })

    expect(config.rootDir).toBe(fixtureDir)
    expect(config.sourceLocale).toBe("en")
    expect(config.sourceReferenceRoot).toBe(fixtureDir)
    expect(config.referenceScopes).toBe(true)
    expect(config.catalogs[0]).toStrictEqual({
      path: "src/locales/{locale}",
      include: ["src"],
    })
  })

  it("rejects the removed ndjson catalog format with an FCL migration hint", async () => {
    const fixtureDir = await createTempDir()

    await writeFile(
      path.join(fixtureDir, "palamedes.yaml"),
      `
        locales: [en, de]
        source-locale: en
        catalogs:
          - path: src/locales/{locale}
            format: ndjson
            include: [src]
      `
    )

    await expect(loadPalamedesConfig({ cwd: fixtureDir })).rejects.toThrow(
      /"catalogs\[0\]\.format" value "ndjson" is no longer supported; use "fcl"/
    )
  })

  it("loads palamedes.toml as a secondary config format", async () => {
    const fixtureDir = await createTempDir()

    await writeFile(
      path.join(fixtureDir, "palamedes.toml"),
      `
        locales = ["en", "de"]
        source-locale = "en"
        source-reference-root = "config"
        reference_scopes = false

        [[catalogs]]
        path = "src/locales/{locale}"
        include = ["src"]
      `
    )

    const config = await loadPalamedesConfig({ cwd: fixtureDir })

    expect(config.configPath).toBe(path.join(fixtureDir, "palamedes.toml"))
    expect(config.sourceLocale).toBe("en")
    expect(config.sourceReferenceRoot).toBe(fixtureDir)
    expect(config.referenceScopes).toBe(false)
  })

  it("loads palamedes.json as a secondary config format", async () => {
    const fixtureDir = await createTempDir()

    await writeFile(
      path.join(fixtureDir, "palamedes.json"),
      JSON.stringify({
        locales: ["en", "de"],
        "source-locale": "en",
        "source-reference-root": "config",
        catalogs: [
          {
            path: "src/locales/{locale}",
            include: ["src"],
          },
        ],
      })
    )

    const config = await loadPalamedesConfig({ cwd: fixtureDir })

    expect(config.configPath).toBe(path.join(fixtureDir, "palamedes.json"))
    expect(config.sourceLocale).toBe("en")
    expect(config.sourceReferenceRoot).toBe(fixtureDir)
    expect(config.referenceScopes).toBe(true)
  })

  it("loads an explicitly provided config path synchronously", async () => {
    const fixtureDir = await createTempDir()
    const configPath = path.join(fixtureDir, "custom.config.ts")

    await writeFile(
      configPath,
      `
        export default {
          locales: ["en"],
          sourceLocale: "en",
          pseudoLocale: "pseudo",
          catalogs: [
            {
              path: "messages/{locale}",
              include: ["src"],
              exclude: ["src/ignore"],
            },
          ],
        }
      `
    )

    const config = loadPalamedesConfigSync({
      cwd: fixtureDir,
      configPath: "./custom.config.ts",
    })

    expect(config.configPath).toBe(configPath)
    expect(config.pseudoLocale).toBe("pseudo")
    expect(config.catalogs[0]?.exclude).toStrictEqual(["src/ignore"])
  })

  it("loads an explicitly provided config path", async () => {
    const fixtureDir = await createTempDir()
    const configPath = path.join(fixtureDir, "custom.config.ts")

    await writeFile(
      configPath,
      `
        export default {
          locales: ["en"],
          sourceLocale: "en",
          pseudoLocale: "pseudo",
          catalogs: [
            {
              path: "messages/{locale}",
              include: ["src"],
              exclude: ["src/ignore"],
            },
          ],
        }
      `
    )

    const config = await loadPalamedesConfig({
      cwd: fixtureDir,
      configPath: "./custom.config.ts",
    })

    expect(config.configPath).toBe(configPath)
    expect(config.pseudoLocale).toBe("pseudo")
    expect(config.catalogs[0]?.exclude).toStrictEqual(["src/ignore"])
  })

  it("uses the nearest git root as the default source reference root", async () => {
    const fixtureDir = await createTempDir()
    const appDir = path.join(fixtureDir, "apps", "web")

    await mkdir(path.join(fixtureDir, ".git"), { recursive: true })
    await mkdir(appDir, { recursive: true })
    await writeFile(
      path.join(appDir, "palamedes.config.ts"),
      `
        export default {
          locales: ["en"],
          sourceLocale: "en",
          catalogs: [
            {
              path: "locales/{locale}/messages",
              include: ["app"],
            },
          ],
        }
      `
    )

    const config = await loadPalamedesConfig({ cwd: appDir })

    expect(config.rootDir).toBe(appDir)
    expect(config.sourceReferenceRoot).toBe(fixtureDir)
  })

  it("supports Lingui-compatible config-root source references", async () => {
    const fixtureDir = await createTempDir()
    const appDir = path.join(fixtureDir, "apps", "web")

    await mkdir(path.join(fixtureDir, ".git"), { recursive: true })
    await mkdir(appDir, { recursive: true })
    await writeFile(
      path.join(appDir, "palamedes.config.ts"),
      `
        export default {
          locales: ["en"],
          sourceLocale: "en",
          sourceReferenceRoot: "lingui",
          catalogs: [
            {
              path: "locales/{locale}/messages",
              include: ["src"],
            },
          ],
        }
      `
    )

    const config = await loadPalamedesConfig({ cwd: appDir })

    expect(config.rootDir).toBe(appDir)
    expect(config.sourceReferenceRoot).toBe(appDir)
  })

  it("fails validation for invalid config shapes", async () => {
    const fixtureDir = await createTempDir()
    await writeFile(
      path.join(fixtureDir, "palamedes.config.js"),
      `
        module.exports = {
          locales: ["de"],
          sourceLocale: "en",
          catalogs: [],
        }
      `
    )

    await expect(loadPalamedesConfig({ cwd: fixtureDir })).rejects.toThrow(
      /"sourceLocale" must be included in "locales"/
    )
  })

  it("rejects a non-boolean referenceScopes value", async () => {
    const fixtureDir = await createTempDir()
    await writeFile(
      path.join(fixtureDir, "palamedes.config.js"),
      `
        module.exports = {
          locales: ["en"],
          sourceLocale: "en",
          referenceScopes: "false",
          catalogs: [],
        }
      `
    )

    await expect(loadPalamedesConfig({ cwd: fixtureDir })).rejects.toThrow(
      /"referenceScopes" must be a boolean/
    )
  })

  it("rejects malformed plugin declarations", async () => {
    const fixtureDir = await createTempDir()
    await writeFile(
      path.join(fixtureDir, "palamedes.config.mjs"),
      `
        export default {
          locales: ["en"],
          sourceLocale: "en",
          catalogs: [{ path: "locales/{locale}", include: ["src"] }],
          plugins: [["@acme/plugin"]],
        }
      `
    )

    await expect(loadPalamedesConfig({ cwd: fixtureDir })).rejects.toThrow(
      /"plugins\[0\]" must be a non-empty package specifier or \[specifier, options\]/
    )
  })
})

describe("resolveCatalogPath", () => {
  it("replaces every {locale} placeholder", () => {
    // The Rust resolver and the Next loader both replace all occurrences; a
    // path may name the locale in a directory and in the file name.
    expect(resolveCatalogPath({ rootDir: "/repo" }, "locales/{locale}/{locale}", "de")).toBe(
      path.resolve("/repo/locales/de/de")
    )
  })
})

describe("catalog source matching", () => {
  const config = { rootDir: "/repo" }
  const catalog = { path: "locales/{locale}", include: ["src/**/*.tsx"] }

  it("includes dot-prefixed source paths consistently", () => {
    expect(catalogMatchesSource(config, catalog, "/repo/src/.generated/page.tsx")).toBe(true)
  })

  it("applies the default node_modules exclusion", () => {
    expect(catalogMatchesSource(config, catalog, "/repo/src/node_modules/page.tsx")).toBe(false)
  })

  it("resolves the configured locale path through one implementation", () => {
    expect(catalogResourcePath(config, catalog, "de")).toBe(
      path.join(config.rootDir, "locales", "de.po")
    )
  })
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palamedes-config-"))
  tempDirs.push(dir)
  return dir
}
