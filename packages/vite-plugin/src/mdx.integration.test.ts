import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
  it.each(["react", "solid"] as const)(
    "builds a real %s MDX entry through the framework pipeline",
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

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-mdx-"))
  fixtureDirectories.push(root)
  await writeFile(
    path.join(root, "palamedes.yaml"),
    "locales: [en]\nsource-locale: en\ncatalogs: []\n"
  )
  await writeFile(path.join(root, "page.mdx"), "# Hello **world**.\n")
  return root
}
