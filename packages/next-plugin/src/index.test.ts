import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import { withPalamedes } from "./index"

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  if (originalArgv) {
    process.argv = originalArgv
    originalArgv = undefined
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

const tempDirs: string[] = []
let originalArgv: string[] | undefined

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
  it("matches ESM and CommonJS TypeScript and JavaScript extensions with the shared default", () => {
    const rule = getRules(withPalamedes())["*"] as RuleItem
    const include = (
      conditionList(rule).find(
        (condition) => typeof condition === "object" && condition !== null && "path" in condition
      ) as { path: RegExp }
    ).path

    for (const file of [
      "page.ts",
      "page.tsx",
      "page.js",
      "page.jsx",
      "page.mjs",
      "page.cjs",
      "page.mts",
      "page.cts",
    ]) {
      expect(include.test(file)).toBe(true)
    }
    expect(include.test("page.css")).toBe(false)
  })

  it("uses the Next CLI project directory instead of the monorepo working directory", async () => {
    const monorepoRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-project-root-"))
    tempDirs.push(monorepoRoot)
    const appRoot = path.join(monorepoRoot, "apps", "web")
    await mkdir(path.join(appRoot, "src"), { recursive: true })
    await Promise.all([
      writeFile(path.join(monorepoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n"),
      writeFile(path.join(monorepoRoot, "palamedes.yaml"), "locales: [en]\n"),
      writeFile(path.join(appRoot, "palamedes.yaml"), "locales: [de]\n"),
      writeFile(
        path.join(monorepoRoot, "palamedes.server.ts"),
        "export async function initializeServerFunctionI18n() {}\n"
      ),
      writeFile(
        path.join(appRoot, "src", "palamedes.server.ts"),
        "export async function initializeServerFunctionI18n() {}\n"
      ),
    ])
    vi.spyOn(process, "cwd").mockReturnValue(monorepoRoot)
    originalArgv = process.argv
    process.argv = [
      "node",
      "/workspace/node_modules/next/dist/bin/next",
      "dev",
      "-p",
      "4000",
      "apps/web",
    ]

    const config = withPalamedes({}, { serverFunctions: true })
    const transformRule = getRules(config)["*"] as RuleItem[]
    const poRule = getRules(config)["*.po"] as RuleItem

    expect(config.turbopack?.resolveAlias).toMatchObject({
      [serverEntryModule]: "./src/palamedes.server.ts",
    })
    expect(transformRule[0]?.loaders?.[0]?.options).toMatchObject({ cwd: appRoot })
    expect(poRule.loaders?.[0]?.options).toMatchObject({ cwd: appRoot })
    expect(config.turbopack?.root).toBe(monorepoRoot)
    expect(config.outputFileTracingRoot).toBe(monorepoRoot)
  })

  it("ignores unrelated host argv verbs when resolving the project root", () => {
    useNextExampleProject()
    originalArgv = process.argv
    process.argv = ["node", "server.js", "start", "preview"]

    const config = withPalamedes()
    const transformRule = getRules(config)["*"] as RuleItem
    const poRule = getRules(config)["*.po"] as RuleItem

    expect(transformRule.loaders?.[0]?.options).toMatchObject({ cwd: nextExampleRoot })
    expect(poRule.loaders?.[0]?.options).toMatchObject({ cwd: nextExampleRoot })
  })

  it("derives the app root from the config evaluation stack after Next consumes its CLI directory", async () => {
    const monorepoRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-config-stack-"))
    tempDirs.push(monorepoRoot)
    const appRoot = path.join(monorepoRoot, "apps", "web")
    await mkdir(path.join(appRoot, "src"), { recursive: true })
    await Promise.all([
      writeFile(path.join(monorepoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n"),
      writeFile(path.join(monorepoRoot, "palamedes.yaml"), "locales: [en]\n"),
      writeFile(path.join(appRoot, "palamedes.yaml"), "locales: [de]\n"),
      writeFile(
        path.join(monorepoRoot, "palamedes.server.ts"),
        "export async function initializeServerFunctionI18n() {}\n"
      ),
      writeFile(
        path.join(appRoot, "src", "palamedes.server.ts"),
        "export async function initializeServerFunctionI18n() {}\n"
      ),
    ])
    vi.spyOn(process, "cwd").mockReturnValue(monorepoRoot)
    originalArgv = process.argv
    process.argv = ["node", "next"]

    // Simulate the loaded config module's stack frame after Next consumes the CLI directory.
    // eslint-disable-next-line no-new-func
    const loadNextConfig = new Function(
      "withPalamedes",
      `return () => withPalamedes({}, { serverFunctions: true })\n//# sourceURL=${path.join(appRoot, "next.config.mjs")}`
    ) as (configure: typeof withPalamedes) => () => ReturnType<typeof withPalamedes>
    const config = loadNextConfig(withPalamedes)()
    const transformRule = getRules(config)["*"] as RuleItem[]
    const poRule = getRules(config)["*.po"] as RuleItem

    expect(config.turbopack?.resolveAlias).toMatchObject({
      [serverEntryModule]: "./src/palamedes.server.ts",
    })
    expect(transformRule[0]?.loaders?.[0]?.options).toMatchObject({ cwd: appRoot })
    expect(poRule.loaders?.[0]?.options).toMatchObject({ cwd: appRoot })
    expect(config.turbopack?.root).toBe(monorepoRoot)
  })

  it("normalizes projectRoot once for config paths, loaders, and workspace detection", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-project-option-"))
    tempDirs.push(projectRoot)
    const workspaceRoot = path.dirname(projectRoot)

    const config = withPalamedes(
      {},
      {
        projectRoot,
        configPath: "config/palamedes.yaml",
        workspaceRoot,
      }
    )
    const transformRule = getRules(config)["*"] as RuleItem
    const poRule = getRules(config)["*.po"] as RuleItem
    const expectedConfigPath = path.join(projectRoot, "config", "palamedes.yaml")

    expect(transformRule.loaders?.[0]?.options).toMatchObject({
      cwd: projectRoot,
      configPath: expectedConfigPath,
    })
    expect(poRule.loaders?.[0]?.options).toMatchObject({
      cwd: projectRoot,
      configPath: expectedConfigPath,
    })
    expect(config.turbopack?.root).toBe(workspaceRoot)
  })

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
    ["production", true, true],
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

  it("lets keepSourceFallbacks opt out of the Next default", () => {
    vi.stubEnv("NODE_ENV", "production")
    const config = withPalamedes({}, { keepSourceFallbacks: false })

    const rule = getRules(config)["*"] as RuleItem
    expect(rule.loaders?.[0]?.options).toMatchObject({ keepSourceFallbacks: false })
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

  it.each([
    ["development", "throw"],
    ["production", "degrade"],
  ] as const)(
    "enables graph-split client bootstrapping with %s fragment failures set to %s in the Turbopack browser graph",
    (mode, clientFragmentFailureMode) => {
      vi.stubEnv("NODE_ENV", mode)
      const configuredRules = getRules(withPalamedes({}, { messageSplitting: true }))[
        "*"
      ] as RuleItem[]
      const browserRule = configuredRules.find((candidate) =>
        conditionList(candidate).includes("browser")
      )
      const serverRule = configuredRules.find((candidate) =>
        conditionList(candidate).some(
          (condition) =>
            typeof condition === "object" &&
            condition !== null &&
            "not" in condition &&
            condition.not === "browser"
        )
      )

      expect(browserRule?.loaders?.[0]?.options).toMatchObject({
        clientMessageSplitting: true,
        clientFragmentFailureMode,
      })
      expect(serverRule?.loaders?.[0]?.options).not.toHaveProperty("clientMessageSplitting")
      expect(serverRule?.loaders?.[0]?.options).not.toHaveProperty("serverMessageSplitting")
    }
  )

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

type WebpackTestConfig = {
  experiments?: { topLevelAwait?: boolean }
  module: { rules: WebpackRule[] }
  output?: { environment?: { asyncFunction?: boolean } }
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
  it("uses the shared bundler extension default", () => {
    const transformRule = collectWebpackRules(withPalamedes()).find((rule) =>
      rule.use?.[0]?.loader.includes("palamedes-loader")
    )

    for (const file of ["page.ts", "page.tsx", "page.js", "page.jsx", "page.mjs", "page.cjs"]) {
      expect(transformRule?.test?.test(file)).toBe(true)
    }
    expect(transformRule?.test?.test("page.css")).toBe(false)
  })

  it("re-resolves config and Server Function modules from Next's webpack project directory", async () => {
    const monorepoRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-webpack-project-root-"))
    tempDirs.push(monorepoRoot)
    const appRoot = path.join(monorepoRoot, "apps", "web")
    await mkdir(path.join(appRoot, "src"), { recursive: true })
    await Promise.all([
      writeFile(
        path.join(monorepoRoot, "palamedes.server.ts"),
        "export async function initializeServerFunctionI18n() {}\n"
      ),
      writeFile(
        path.join(appRoot, "src", "palamedes.server.ts"),
        "export async function initializeServerFunctionI18n() {}\n"
      ),
    ])
    vi.spyOn(process, "cwd").mockReturnValue(monorepoRoot)
    originalArgv = process.argv
    process.argv = ["node", "vitest"]

    const configured = withPalamedes(
      {},
      {
        configPath: "config/palamedes.yaml",
        serverFunctions: true,
      }
    )
    const webpack = configured.webpack as unknown as (
      config: {
        module: { rules: WebpackRule[] }
        resolve: { alias: Record<string, string> }
      },
      context: Record<string, unknown>
    ) => unknown
    const webpackConfig = { module: { rules: [] as WebpackRule[] }, resolve: { alias: {} } }

    webpack(webpackConfig, { dir: appRoot, isServer: true })

    const transformRule = webpackConfig.module.rules.find((rule) =>
      rule.use?.[0]?.loader.includes("palamedes-loader")
    )
    const poRule = webpackConfig.module.rules.find((rule) =>
      rule.use?.[0]?.loader.includes("palamedes-po-loader")
    )
    expect(transformRule?.use?.[0]?.options).toMatchObject({
      configPath: path.join(appRoot, "config", "palamedes.yaml"),
      cwd: appRoot,
      serverFunctions: {
        initializerModule: serverInitializerModule,
        initializerExport: "initializeServerFunctionI18n",
      },
      serverMessageSplitting: true,
    })
    expect(poRule?.use?.[0]?.options).toMatchObject({
      configPath: path.join(appRoot, "config", "palamedes.yaml"),
      cwd: appRoot,
    })
    expect(webpackConfig.resolve.alias).toMatchObject({
      [serverEntryModule]: path.join(appRoot, "src", "palamedes.server.ts"),
    })
  })

  it("uses Next's project directory for webpack loader options", () => {
    const projectRoot = path.join(nextExampleRoot, "webpack-context-root")
    const rules = collectWebpackRules(withPalamedes(), { dir: projectRoot })
    const transformRule = rules.find((rule) => rule.use?.[0]?.loader.includes("palamedes-loader"))
    const poRule = rules.find((rule) => rule.use?.[0]?.loader.includes("palamedes-po-loader"))

    expect(transformRule?.use?.[0]?.options).toMatchObject({ cwd: projectRoot })
    expect(poRule?.use?.[0]?.options).toMatchObject({ cwd: projectRoot })
  })

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

  it.each([
    ["development", "throw"],
    ["production", "degrade"],
  ] as const)(
    "enables graph-split client bootstrapping with %s fragment failures set to %s in the webpack client compiler",
    (mode, clientFragmentFailureMode) => {
      vi.stubEnv("NODE_ENV", mode)
      const configured = withPalamedes({}, { messageSplitting: true })
      const clientRule = collectWebpackRules(configured, { isServer: false }).find((rule) =>
        rule.use?.[0]?.loader.includes("palamedes-loader")
      )
      const serverRule = collectWebpackRules(configured, { isServer: true }).find((rule) =>
        rule.use?.[0]?.loader.includes("palamedes-loader")
      )

      expect(clientRule?.use?.[0]?.options).toMatchObject({
        clientMessageSplitting: true,
        clientFragmentFailureMode,
      })
      expect(serverRule?.use?.[0]?.options).not.toHaveProperty("clientMessageSplitting")
    }
  )

  it("enables webpack async modules only for graph-split client builds", () => {
    const configured = withPalamedes({}, { messageSplitting: true })
    const webpack = configured.webpack as unknown as (
      config: WebpackTestConfig,
      context: Record<string, unknown>
    ) => WebpackTestConfig
    const clientConfig = webpack({ module: { rules: [] } }, { isServer: false })
    const serverConfig = webpack({ module: { rules: [] } }, { isServer: true })

    expect(clientConfig.experiments?.topLevelAwait).toBe(true)
    expect(clientConfig.output?.environment?.asyncFunction).toBe(true)
    expect(serverConfig.experiments).toBeUndefined()
    expect(serverConfig.output).toBeUndefined()
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
