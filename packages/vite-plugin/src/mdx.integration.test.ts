import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import react from "@vitejs/plugin-react"
import { afterEach, describe, expect, it } from "vitest"
import { build } from "vite"
import solid from "vite-plugin-solid"

import { palamedes } from "./index"

const fixtureDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("Palamedes MDX Vite integration", () => {
  it("builds a configless project that does not import MDX", async () => {
    const root = await createFixture({ config: false })

    await expect(
      build({
        configFile: false,
        logLevel: "silent",
        plugins: [palamedes()],
        root,
        build: {
          write: false,
          rollupOptions: {
            input: path.join(root, "entry.js"),
          },
        },
      })
    ).resolves.toBeDefined()
  })

  it("applies failOnMissing to compiled MDX message IDs", async () => {
    const root = await createFixture({ missingTranslation: true })

    await expect(
      build({
        configFile: false,
        logLevel: "silent",
        plugins: [
          palamedes({
            configPath: path.join(root, "palamedes.yaml"),
            failOnMissing: true,
          }),
          react(),
        ],
        root,
        build: {
          write: false,
          rollupOptions: {
            external: [/^@palamedes\//u, /^react(?:\/|$)/u],
            input: path.join(root, "page.mdx"),
          },
        },
      })
    ).rejects.toThrow(/Missing 1 translation.*failOnMissing=true/s)
  })

  it.each(["react", "solid"] as const)(
    "builds a real Vite 8 %s MDX entry through the framework pipeline",
    async (framework) => {
      const root = await createFixture()
      const frameworkPlugin = framework === "react" ? react() : solid({ extensions: [".mdx"] })

      await expect(
        build({
          configFile: false,
          logLevel: "silent",
          plugins: [
            palamedes({
              configPath: path.join(root, "palamedes.yaml"),
              mdx: { framework },
            }),
            frameworkPlugin,
          ],
          root,
          build: {
            write: false,
            rollupOptions: {
              external: [/^@palamedes\//u, /^react(?:\/|$)/u, /^solid-js(?:\/|$)/u],
              input: path.join(root, "page.mdx"),
            },
          },
        })
      ).resolves.toBeDefined()
    }
  )
})

async function createFixture(options: { config?: boolean; missingTranslation?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-mdx-"))
  fixtureDirectories.push(root)
  if (options.config !== false) {
    await writeFile(
      path.join(root, "palamedes.yaml"),
      options.missingTranslation
        ? "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [.]\n"
        : "locales: [en]\nsource-locale: en\ncatalogs: []\n"
    )
  }
  if (options.missingTranslation) {
    const locales = path.join(root, "locales")
    await mkdir(locales, { recursive: true })
    await writeFile(
      path.join(locales, "en.po"),
      'msgid ""\nmsgstr ""\n"Language: en\\n"\n\nmsgid "Hello <0>world</0>."\nmsgstr ""\n'
    )
    await writeFile(
      path.join(locales, "de.po"),
      'msgid ""\nmsgstr ""\n"Language: de\\n"\n\nmsgid "Hello <0>world</0>."\nmsgstr ""\n'
    )
  }
  await writeFile(path.join(root, "entry.js"), "export const value = 1\n")
  await writeFile(path.join(root, "page.mdx"), "# Hello **world**.\n")
  return root
}
