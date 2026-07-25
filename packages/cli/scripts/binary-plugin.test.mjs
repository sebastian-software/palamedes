import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { resolveBinaryPlugin } from "./binary-plugin.mjs"
import { tryRunPluginCommand } from "./plugin-host.mjs"

const fixtureRoot = path.resolve(import.meta.dirname, "../fixtures/plugin-project")
const fixtureConfigPath = path.join(fixtureRoot, "palamedes.config.mjs")

test("binary plugins register manifest commands and answer through the JSON envelope", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["binary", "inspect", "--json", "one", "two"], {
    io,
    loadConfig: async () => loadedConfig([["./binary-plugin", { policy: "strict" }]]),
    installSignalHandlers: false,
    nativeExecutable: "/fixture/pmds-native",
  })

  assert.deepEqual(result, { handled: true, exitCode: 0 })
  assert.equal(io.stderrText(), "")
  const output = JSON.parse(io.stdoutText())
  assert.equal(output.ok, true)
  assert.equal(output.plugin, "binary")
  assert.equal(output.command, "inspect")
  assert.deepEqual(output.result.args, ["one", "two"])
  assert.deepEqual(output.result.options, { policy: "strict" })
  assert.equal(output.result.rootDir, fixtureRoot)
  assert.deepEqual(output.result.locales, ["en", "de"])
  assert.equal(output.result.native, "/fixture/pmds-native")
  assert.equal(output.result.json, true)
  assert.equal(output.result.interactive, false)
  assert.deepEqual(output.diagnostics, [
    {
      severity: "info",
      code: "BINARY_INSPECTED",
      message: "Inspected 1 catalog definitions.",
    },
  ])
})

test("binary plugin output and result text use the stable text contract", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["binary", "inspect"], {
    io,
    loadConfig: async () => loadedConfig(["./binary-plugin"]),
    installSignalHandlers: false,
    interactive: false,
  })

  assert.deepEqual(result, { handled: true, exitCode: 0 })
  assert.equal(io.stdoutText(), "inspecting\ndone\n")
  assert.equal(io.stderrText(), "[info BINARY_INSPECTED] Inspected 1 catalog definitions.\n")
})

test("binary plugin failure results keep their diagnostics and exit code", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["binary", "fail", "--json"], {
    io,
    loadConfig: async () => loadedConfig(["./binary-plugin"]),
    installSignalHandlers: false,
  })

  assert.deepEqual(result, { handled: true, exitCode: 9 })
  const output = JSON.parse(io.stdoutText())
  assert.equal(output.ok, false)
  assert.equal(output.exitCode, 9)
  assert.deepEqual(output.diagnostics, [
    {
      severity: "error",
      code: "BINARY_FAILED",
      message: "Binary workflow failed.",
    },
  ])
})

test("a binary plugin exiting without a result falls back to its process exit code", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["binary", "crash"], {
    io,
    loadConfig: async () => loadedConfig(["./binary-plugin"]),
    installSignalHandlers: false,
  })

  assert.deepEqual(result, { handled: true, exitCode: 5 })
  assert.match(
    io.stderrText(),
    /PLUGIN_BINARY_PROTOCOL.*exited with code 5 without emitting a result event/u
  )
})

test("incompatible binary plugin protocol versions fail clearly", async () => {
  const io = captureIo()
  const result = await tryRunPluginCommand(["future", "sync"], {
    io,
    loadConfig: async () => loadedConfig(["./binary-plugin-future"]),
    installSignalHandlers: false,
  })

  assert.equal(result.exitCode, 1)
  assert.match(
    io.stderrText(),
    /PLUGIN_PROTOCOL_INCOMPATIBLE.*requires binary plugin protocol 2.*supports 1/u
  )
})

test("binary and ESM plugins share one registry with collision detection", async (t) => {
  await t.test("both kinds dispatch from the same configuration", async () => {
    const plugins = [["./example-plugin.mjs", { greeting: "hello" }], "./binary-plugin"]
    const esmIo = captureIo()
    const esmResult = await tryRunPluginCommand(["example", "inspect"], {
      io: esmIo,
      loadConfig: async () => loadedConfig(plugins),
      installSignalHandlers: false,
    })
    assert.equal(esmResult.exitCode, 0)
    assert.match(esmIo.stdoutText(), /hello from/u)

    const binaryIo = captureIo()
    const binaryResult = await tryRunPluginCommand(["binary", "inspect"], {
      io: binaryIo,
      loadConfig: async () => loadedConfig(plugins),
      installSignalHandlers: false,
    })
    assert.equal(binaryResult.exitCode, 0)
    assert.match(binaryIo.stdoutText(), /inspecting/u)
  })

  await t.test("duplicate namespaces across kinds are rejected", async () => {
    const io = captureIo()
    const result = await tryRunPluginCommand(["binary", "inspect"], {
      io,
      loadConfig: async () => loadedConfig(["./binary-plugin", "./binary-plugin"]),
      installSignalHandlers: false,
    })
    assert.equal(result.exitCode, 1)
    assert.match(io.stderrText(), /PLUGIN_NAMESPACE_COLLISION.*Multiple configured plugins/u)
  })
})

test("binary plugin resolution only claims packages that declare pluginBinary", () => {
  const resolved = resolveBinaryPlugin("./binary-plugin", fixtureConfigPath)
  assert.equal(resolved.binaryPath, path.join(fixtureRoot, "binary-plugin", "plugin.mjs"))

  assert.equal(resolveBinaryPlugin("./example-plugin.mjs", fixtureConfigPath), undefined)
  assert.equal(
    resolveBinaryPlugin("palamedes-import-only-plugin-fixture", fixtureConfigPath),
    undefined
  )
  assert.equal(resolveBinaryPlugin("./does-not-exist", fixtureConfigPath), undefined)
})

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
