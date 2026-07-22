import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { spawnNative } from "./native.mjs"
import { tryRunPluginCommand } from "./plugin-host.mjs"
import { runCli } from "./run.mjs"

const fixtureRoot = path.resolve(import.meta.dirname, "../fixtures/plugin-project")
const fixtureConfigPath = path.join(fixtureRoot, "palamedes.config.mjs")

test("fixture plugin registers a namespaced command with resolved config and catalogs", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(
    ["example", "inspect", "--json", "first", "--", "--json"],
    {
      io,
      loadConfig: async () => loadedConfig([["./example-plugin.mjs", { greeting: "hello" }]]),
      installSignalHandlers: false,
    }
  )

  assert.deepEqual(result, { handled: true, exitCode: 0 })
  assert.equal(io.stderrText(), "")
  const output = JSON.parse(io.stdoutText())
  assert.equal(output.ok, true)
  assert.equal(output.plugin, "example")
  assert.equal(output.command, "inspect")
  assert.deepEqual(output.result.args, ["first", "--json"])
  assert.deepEqual(output.result.catalogs[0].locales, [
    { locale: "en", path: path.join(fixtureRoot, "locales/en/messages") },
    { locale: "de", path: path.join(fixtureRoot, "locales/de/messages") },
  ])
})

test("plugin resolution accepts CommonJS package exports", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["commonjs", "ping"], {
    io,
    loadConfig: async () => loadedConfig(["./commonjs-plugin.cjs"]),
    installSignalHandlers: false,
  })

  assert.deepEqual(result, { handled: true, exitCode: 0 })
  assert.equal(io.stdoutText(), "pong\n")
})

test("plugin resolution accepts import-only ESM package exports", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["import-only", "ping"], {
    io,
    loadConfig: async () => loadedConfig(["palamedes-import-only-plugin-fixture"]),
    installSignalHandlers: false,
  })

  assert.deepEqual(result, { handled: true, exitCode: 0 })
  assert.equal(io.stdoutText(), "esm pong\n")
})

test("built-in commands bypass plugin config and preserve native exit codes", async () => {
  let pluginHostCalled = false
  let nativeArgs
  const result = await runCli(["report", "--json"], {
    nativeExecutable: fixtureConfigPath,
    async tryRunPluginCommand() {
      pluginHostCalled = true
      return { handled: false, exitCode: 0 }
    },
    async runNative(args) {
      nativeArgs = args
      return 7
    },
  })

  assert.equal(result, 7)
  assert.equal(pluginHostCalled, false)
  assert.deepEqual(nativeArgs, ["report", "--json"])
})

test("plugin text, diagnostics, and exit codes use a stable text contract", async () => {
  const io = captureIo()
  const result = await runWithPlugin(
    {
      name: "quality",
      apiVersion: 1,
      commands: {
        check: {
          run({ host }) {
            host.reportDiagnostic({
              severity: "warning",
              code: "QUALITY_STALE",
              message: "One catalog is stale.",
            })
            return { text: "Checked catalogs", exitCode: 3 }
          },
        },
      },
    },
    ["quality", "check"],
    { io }
  )

  assert.deepEqual(result, { handled: true, exitCode: 3 })
  assert.equal(io.stdoutText(), "Checked catalogs\n")
  assert.equal(io.stderrText(), "[warning QUALITY_STALE] One catalog is stale.\n")
})

test("plugin failures produce one machine-readable JSON envelope", async () => {
  const io = captureIo()
  const result = await runWithPlugin(
    {
      name: "failing",
      apiVersion: 1,
      commands: {
        sync: {
          run() {
            throw new Error("Remote workflow failed")
          },
        },
      },
    },
    ["failing", "sync", "--json"],
    { io }
  )

  assert.deepEqual(result, { handled: true, exitCode: 1 })
  assert.equal(io.stderrText(), "")
  assert.deepEqual(JSON.parse(io.stdoutText()), {
    ok: false,
    plugin: "failing",
    command: "sync",
    exitCode: 1,
    result: null,
    diagnostics: [
      {
        severity: "error",
        code: "PLUGIN_COMMAND_FAILED",
        message: "Remote workflow failed",
      },
    ],
  })
})

test("JSON commands are explicitly non-interactive", async () => {
  const io = captureIo()
  const result = await runWithPlugin(
    {
      name: "automation",
      apiVersion: 1,
      commands: {
        inspect: {
          run({ interactive }) {
            return { data: { interactive } }
          },
        },
      },
    },
    ["automation", "inspect", "--json"],
    { io, interactive: true }
  )

  assert.equal(result.exitCode, 0)
  assert.deepEqual(JSON.parse(io.stdoutText()).result, { interactive: false })
})

test("reserved plugin arguments fail through the same JSON contract", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["example", "inspect", "--config", "--json"], {
    io,
    installSignalHandlers: false,
  })

  assert.equal(result.exitCode, 1)
  const output = JSON.parse(io.stdoutText())
  assert.equal(output.diagnostics[0].code, "PLUGIN_ARGUMENT_INVALID")
  assert.match(output.diagnostics[0].message, /--config requires a path/u)
})

test("host API can run a built-in command without exposing native internals", async () => {
  let builtInInvocation
  const io = captureIo()
  const result = await runWithPlugin(
    {
      name: "workflow",
      apiVersion: 1,
      commands: {
        report: {
          async run({ host }) {
            const builtIn = await host.runBuiltIn(["report", "--json"])
            return { data: builtIn, exitCode: builtIn.exitCode }
          },
        },
      },
    },
    ["workflow", "report", "--json"],
    {
      io,
      async runNative(args, options) {
        builtInInvocation = { args, options }
        return 4
      },
      nativeExecutable: "/fixture/pmds-native",
    }
  )

  assert.equal(result.exitCode, 4)
  assert.deepEqual(builtInInvocation.args, ["report", "--json"])
  assert.equal(builtInInvocation.options.nativeExecutable, "/fixture/pmds-native")
  assert.equal(builtInInvocation.options.captureOutput, true)
  assert.deepEqual(JSON.parse(io.stdoutText()).result, { exitCode: 4 })
})

test("nested built-in output is captured inside the plugin JSON envelope", async () => {
  const io = captureIo()
  const result = await runWithPlugin(
    {
      name: "workflow",
      apiVersion: 1,
      commands: {
        report: {
          async run({ host }) {
            return { data: await host.runBuiltIn(["report", "--json"]) }
          },
        },
      },
    },
    ["workflow", "report", "--json"],
    {
      io,
      async runNative(_args, options) {
        assert.equal(options.captureOutput, true)
        return {
          exitCode: 0,
          stdout: '{"complete":true}\n',
          stderr: "native warning\n",
        }
      },
    }
  )

  assert.equal(result.exitCode, 0)
  assert.equal(io.stdoutText().trim().split("\n").length, 1)
  assert.deepEqual(JSON.parse(io.stdoutText()).result, {
    exitCode: 0,
    stdout: '{"complete":true}\n',
    stderr: "native warning\n",
  })
})

test("missing and incompatible plugins fail clearly", async (t) => {
  await t.test("missing package", async () => {
    const io = captureIo()
    const result = await tryRunPluginCommand(["missing", "sync"], {
      io,
      loadConfig: async () => loadedConfig(["@missing/palamedes-plugin"]),
      async importPlugin() {
        throw new Error("module not found")
      },
      installSignalHandlers: false,
    })
    assert.equal(result.exitCode, 1)
    assert.match(io.stderrText(), /PLUGIN_MISSING.*@missing\/palamedes-plugin.*module not found/u)
  })

  await t.test("incompatible API version", async () => {
    const io = captureIo()
    const result = await runWithPlugin(
      { name: "future", apiVersion: 2, commands: {} },
      ["future", "sync"],
      { io }
    )
    assert.equal(result.exitCode, 1)
    assert.match(io.stderrText(), /PLUGIN_API_INCOMPATIBLE.*supports 1/u)
  })
})

test("namespace collisions are rejected deterministically", async (t) => {
  await t.test("built-in collision", async () => {
    const io = captureIo()
    const result = await runWithPlugin(
      { name: "extract", apiVersion: 1, commands: {} },
      ["other", "sync"],
      { io }
    )
    assert.equal(result.exitCode, 1)
    assert.match(io.stderrText(), /PLUGIN_NAMESPACE_COLLISION.*built-in/u)
  })

  await t.test("duplicate plugin namespaces", async () => {
    const io = captureIo()
    const plugin = { name: "duplicate", apiVersion: 1, commands: {} }
    const result = await tryRunPluginCommand(["duplicate", "sync"], {
      io,
      loadConfig: async () => loadedConfig(["one", "two"]),
      importPlugin: async () => ({ default: plugin }),
      installSignalHandlers: false,
    })
    assert.equal(result.exitCode, 1)
    assert.match(io.stderrText(), /PLUGIN_NAMESPACE_COLLISION.*Multiple configured plugins/u)
  })
})

test("cancellation uses shell-compatible exit code 130", async () => {
  const io = captureIo()
  const abortController = new AbortController()
  abortController.abort({ signal: "SIGINT", exitCode: 130 })
  const result = await runWithPlugin(
    {
      name: "cancel",
      apiVersion: 1,
      commands: {
        wait: {
          run({ signal }) {
            throw signal.reason
          },
        },
      },
    },
    ["cancel", "wait", "--json"],
    { io, abortController }
  )

  assert.equal(result.exitCode, 130)
  assert.equal(JSON.parse(io.stdoutText()).diagnostics[0].code, "PLUGIN_CANCELLED")
})

test("a pre-aborted native invocation never starts work", async () => {
  const abortController = new AbortController()
  abortController.abort({ signal: "SIGINT", exitCode: 130 })

  const result = await spawnNative(["-e", "process.exit(99)"], {
    nativeExecutable: process.execPath,
    signal: abortController.signal,
  })

  assert.equal(result, 130)
})

test("unknown namespaces remain native CLI concerns", async () => {
  const result = await runWithPlugin(
    { name: "known", apiVersion: 1, commands: {} },
    ["unknown", "command"],
    { io: captureIo() }
  )
  assert.deepEqual(result, { handled: false, exitCode: 0 })
})

test("projects without configured plugins do not intercept commands", async () => {
  const result = await tryRunPluginCommand(["unknown", "command"], {
    io: captureIo(),
    loadConfig: async () => loadedConfig(undefined),
    installSignalHandlers: false,
  })

  assert.deepEqual(result, { handled: false, exitCode: 0 })
})

async function runWithPlugin(plugin, argv, options = {}) {
  return tryRunPluginCommand(argv, {
    loadConfig: async () => loadedConfig(["fixture-plugin"]),
    importPlugin: async () => ({ default: plugin }),
    installSignalHandlers: false,
    ...options,
  })
}

function loadedConfig(plugins) {
  return {
    configPath: fixtureConfigPath,
    rootDir: fixtureRoot,
    sourceReferenceRoot: fixtureRoot,
    locales: ["en", "de"],
    sourceLocale: "en",
    catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    plugins,
  }
}

function captureIo() {
  const stdout = []
  const stderr = []
  return {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
  }
}
