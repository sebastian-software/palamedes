import { existsSync } from "node:fs"

import { spawnNative } from "./native.mjs"
import { resolveNativeExecutable } from "./platform.mjs"

const BUILT_IN_COMMANDS = new Set(["extract", "audit", "report", "catalog", "version"])

export async function runCli(argv, options = {}) {
  let nativeExecutable = options.nativeExecutable
  let nativeResolutionError
  if (nativeExecutable == null) {
    try {
      const resolveExecutable = options.resolveNativeExecutable ?? resolveNativeExecutable
      nativeExecutable = resolveExecutable()
    } catch (error) {
      nativeResolutionError = error
    }
  }
  const runNative = options.runNative ?? spawnNative

  if (shouldDelegateDirectly(argv)) {
    return runNativeChecked(argv, {
      ...options,
      nativeExecutable,
      nativeResolutionError,
      runNative,
    })
  }

  let pluginResult
  try {
    const tryPlugin =
      options.tryRunPluginCommand ?? (await import("./plugin-host.mjs")).tryRunPluginCommand
    pluginResult = await tryPlugin(argv, {
      ...options,
      nativeExecutable,
      nativeResolutionError,
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
  return runNativeChecked(argv, {
    ...options,
    nativeExecutable,
    nativeResolutionError,
    runNative,
  })
}

function shouldDelegateDirectly(argv) {
  return argv.length === 0 || argv[0].startsWith("-") || BUILT_IN_COMMANDS.has(argv[0])
}

async function runNativeChecked(argv, options) {
  if (options.nativeResolutionError) {
    const stderr = options.io?.stderr ?? ((value) => process.stderr.write(value))
    stderr(
      `${options.nativeResolutionError instanceof Error ? options.nativeResolutionError.message : String(options.nativeResolutionError)}\n`
    )
    return 1
  }
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
