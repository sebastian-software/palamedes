import { existsSync } from "node:fs"
import path from "node:path"

import { spawnNative } from "./native.mjs"

const BUILT_IN_COMMANDS = new Set(["extract", "audit", "report", "catalog", "version"])

export async function runCli(argv, options = {}) {
  const nativeExecutable = options.nativeExecutable ?? resolveNativeExecutable()
  const runNative = options.runNative ?? spawnNative

  if (shouldDelegateDirectly(argv)) {
    return runNativeChecked(argv, { ...options, nativeExecutable, runNative })
  }

  let pluginResult
  try {
    const tryPlugin =
      options.tryRunPluginCommand ?? (await import("./plugin-host.mjs")).tryRunPluginCommand
    pluginResult = await tryPlugin(argv, {
      ...options,
      nativeExecutable,
      runNative,
    })
  } catch (error) {
    const stderr = options.io?.stderr ?? ((value) => process.stderr.write(value))
    stderr(`[error PLUGIN_HOST_FAILED] ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  if (pluginResult.handled) {
    return pluginResult.exitCode
  }
  return runNativeChecked(argv, { ...options, nativeExecutable, runNative })
}

function shouldDelegateDirectly(argv) {
  return argv.length === 0 || argv[0].startsWith("-") || BUILT_IN_COMMANDS.has(argv[0])
}

async function runNativeChecked(argv, options) {
  if (!options.nativeExecutable || !existsSync(options.nativeExecutable)) {
    const stderr = options.io?.stderr ?? ((value) => process.stderr.write(value))
    stderr("Palamedes CLI native binary was not installed for this platform.\n")
    return 1
  }
  try {
    return await options.runNative(argv, {
      cwd: options.cwd ?? process.cwd(),
      nativeExecutable: options.nativeExecutable,
    })
  } catch (error) {
    const stderr = options.io?.stderr ?? ((value) => process.stderr.write(value))
    stderr(
      `Could not run Palamedes native CLI: ${error instanceof Error ? error.message : String(error)}\n`
    )
    return 1
  }
}

function resolveNativeExecutable() {
  const packageDir = path.resolve(import.meta.dirname, "..")
  return path.join(
    packageDir,
    "bin",
    process.platform === "win32" ? "pmds-native.exe" : "pmds-native"
  )
}
