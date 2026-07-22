import path from "node:path"
import { pathToFileURL } from "node:url"

import { resolve as resolveImport } from "import-meta-resolve"

import { PALAMEDES_PLUGIN_API_VERSION } from "../plugin-api.mjs"
import { spawnNative } from "./native.mjs"

const BUILT_IN_NAMESPACES = new Set(["extract", "audit", "report", "catalog", "version"])
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/u

export async function tryRunPluginCommand(argv, options = {}) {
  const namespace = argv[0]
  if (!namespace || namespace.startsWith("-")) {
    return { handled: false, exitCode: 0 }
  }

  const io = options.io ?? defaultIo()
  let invocation
  try {
    invocation = parseInvocation(argv)
  } catch (error) {
    const fallbackInvocation = {
      namespace,
      commandName: argv[1],
      json: argv.includes("--json"),
    }
    return emitHostFailure(fallbackInvocation, io, "PLUGIN_ARGUMENT_INVALID", error)
  }
  const loadConfig = options.loadConfig ?? loadConfigFromPackage
  let config

  try {
    config = await loadConfig({
      cwd: options.cwd ?? process.cwd(),
      ...(invocation.configPath ? { configPath: invocation.configPath } : {}),
    })
  } catch (error) {
    if (!invocation.configPath && isConfigNotFound(error)) {
      return { handled: false, exitCode: 0 }
    }
    return emitHostFailure(invocation, io, "PLUGIN_CONFIG_FAILED", error)
  }

  if (!config.plugins || config.plugins.length === 0) {
    return { handled: false, exitCode: 0 }
  }

  let plugins
  try {
    plugins = await loadPlugins(config, options.importPlugin)
  } catch (error) {
    return emitHostFailure(invocation, io, error.code ?? "PLUGIN_LOAD_FAILED", error)
  }

  const loaded = plugins.get(namespace)
  if (!loaded) {
    return { handled: false, exitCode: 0 }
  }

  if (!invocation.commandName) {
    return emitHostFailure(
      invocation,
      io,
      "PLUGIN_COMMAND_REQUIRED",
      new Error(`Plugin namespace "${namespace}" requires a command name.`)
    )
  }

  const command = loaded.plugin.commands[invocation.commandName]
  if (!command) {
    const available = Object.keys(loaded.plugin.commands).sort().join(", ") || "none"
    return emitHostFailure(
      invocation,
      io,
      "PLUGIN_COMMAND_UNKNOWN",
      new Error(
        `Plugin "${namespace}" has no command "${invocation.commandName}". Available commands: ${available}.`
      )
    )
  }

  const diagnostics = []
  const abortController = options.abortController ?? new AbortController()
  const cleanupSignals = installSignalHandlers(abortController, options.installSignalHandlers)
  const runNative = options.runNative ?? spawnNative
  const nativeExecutable = options.nativeExecutable
  const host = createHost({
    config,
    diagnostics,
    abortController,
    runNative,
    nativeExecutable,
    cwd: options.cwd ?? process.cwd(),
    json: invocation.json,
  })

  try {
    const rawResult = await command.run({
      args: invocation.commandArgs,
      options: loaded.options,
      json: invocation.json,
      interactive: isInteractive(invocation, options.interactive),
      signal: abortController.signal,
      host,
    })
    if (abortController.signal.aborted) {
      const exitCode = abortExitCode(abortController.signal.reason)
      return emitHostFailure(
        invocation,
        io,
        "PLUGIN_CANCELLED",
        cancellationError(abortController.signal.reason),
        exitCode
      )
    }
    const result = normalizeResult(rawResult, diagnostics)
    emitResult(invocation, io, result)
    return { handled: true, exitCode: result.exitCode }
  } catch (error) {
    if (abortController.signal.aborted) {
      const exitCode = abortExitCode(abortController.signal.reason)
      return emitHostFailure(
        invocation,
        io,
        "PLUGIN_CANCELLED",
        cancellationError(abortController.signal.reason, error),
        exitCode
      )
    }
    return emitHostFailure(invocation, io, "PLUGIN_COMMAND_FAILED", error)
  } finally {
    cleanupSignals()
  }
}

export async function loadPlugins(config, importPlugin = importPluginFromConfig) {
  const registry = new Map()

  for (const declaration of config.plugins ?? []) {
    const [specifier, pluginOptions] = normalizeDeclaration(declaration)
    let imported
    try {
      imported = await importPlugin(specifier, config.configPath)
    } catch (error) {
      throw codedError(
        "PLUGIN_MISSING",
        `Could not load configured Palamedes plugin "${specifier}": ${errorMessage(error)}`
      )
    }

    const plugin = imported?.default ?? imported?.plugin ?? imported
    validatePlugin(plugin, specifier)

    if (registry.has(plugin.name)) {
      throw codedError(
        "PLUGIN_NAMESPACE_COLLISION",
        `Multiple configured plugins declare the namespace "${plugin.name}".`
      )
    }
    registry.set(plugin.name, { plugin, options: pluginOptions, specifier })
  }

  return registry
}

function parseInvocation(argv) {
  const commandArgs = []
  let configPath
  let json = false
  let passthrough = false

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index]
    if (passthrough) {
      commandArgs.push(value)
      continue
    }
    if (value === "--") {
      passthrough = true
      continue
    }
    if (value === "--json") {
      json = true
      continue
    }
    if (value === "--config" || value === "-c") {
      const next = argv[index + 1]
      if (!next || next.startsWith("-")) {
        throw new Error(`${value} requires a path.`)
      }
      configPath = next
      index += 1
      continue
    }
    if (value.startsWith("--config=")) {
      configPath = value.slice("--config=".length)
      if (!configPath) {
        throw new Error("--config requires a path.")
      }
      continue
    }
    commandArgs.push(value)
  }

  return {
    namespace: argv[0],
    commandName: argv[1],
    commandArgs,
    configPath,
    json,
  }
}

function createHost({
  config,
  diagnostics,
  abortController,
  runNative,
  nativeExecutable,
  cwd,
  json,
}) {
  return Object.freeze({
    apiVersion: PALAMEDES_PLUGIN_API_VERSION,
    config,
    catalogs() {
      return config.catalogs.map((catalog) => ({
        path: catalog.path,
        format: catalog.format ?? "po",
        include: [...catalog.include],
        exclude: [...(catalog.exclude ?? [])],
        locales: config.locales.map((locale) => ({
          locale,
          path: path.resolve(config.rootDir, catalog.path.replace("{locale}", locale)),
        })),
      }))
    },
    async runBuiltIn(args) {
      if (!Array.isArray(args) || args.length === 0 || !BUILT_IN_NAMESPACES.has(args[0])) {
        throw new Error(
          `runBuiltIn requires a built-in command (${[...BUILT_IN_NAMESPACES].join(", ")}).`
        )
      }
      const nativeResult = await runNative(args, {
        cwd,
        signal: abortController.signal,
        nativeExecutable,
        captureOutput: json,
      })
      if (typeof nativeResult === "number") {
        return { exitCode: nativeResult }
      }
      return {
        exitCode: nativeResult.exitCode,
        ...(nativeResult.stdout !== undefined ? { stdout: nativeResult.stdout } : {}),
        ...(nativeResult.stderr !== undefined ? { stderr: nativeResult.stderr } : {}),
      }
    },
    reportDiagnostic(diagnostic) {
      diagnostics.push(normalizeDiagnostic(diagnostic))
    },
  })
}

function validatePlugin(plugin, specifier) {
  if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
    throw codedError(
      "PLUGIN_INVALID",
      `Palamedes plugin "${specifier}" must export a plugin object.`
    )
  }
  if (typeof plugin.name !== "string" || !NAME_PATTERN.test(plugin.name)) {
    throw codedError(
      "PLUGIN_INVALID",
      `Palamedes plugin "${specifier}" must declare a lowercase kebab-case name.`
    )
  }
  if (BUILT_IN_NAMESPACES.has(plugin.name)) {
    throw codedError(
      "PLUGIN_NAMESPACE_COLLISION",
      `Plugin namespace "${plugin.name}" collides with a built-in pmds command.`
    )
  }
  if (plugin.apiVersion !== PALAMEDES_PLUGIN_API_VERSION) {
    throw codedError(
      "PLUGIN_API_INCOMPATIBLE",
      `Plugin "${plugin.name}" requires Palamedes plugin API ${String(plugin.apiVersion)}; this CLI supports ${PALAMEDES_PLUGIN_API_VERSION}.`
    )
  }
  if (!plugin.commands || typeof plugin.commands !== "object" || Array.isArray(plugin.commands)) {
    throw codedError("PLUGIN_INVALID", `Plugin "${plugin.name}" must declare a commands object.`)
  }
  for (const [name, command] of Object.entries(plugin.commands)) {
    if (!NAME_PATTERN.test(name) || !command || typeof command.run !== "function") {
      throw codedError(
        "PLUGIN_INVALID",
        `Plugin "${plugin.name}" command "${name}" must be lowercase kebab-case and provide run().`
      )
    }
  }
}

async function importPluginFromConfig(specifier, configPath) {
  const resolved = resolveImport(specifier, pathToFileURL(configPath).href)
  return import(resolved)
}

function normalizeDeclaration(declaration) {
  return typeof declaration === "string" ? [declaration, undefined] : declaration
}

function normalizeResult(rawResult, reportedDiagnostics) {
  let result
  if (rawResult === undefined) {
    result = {}
  } else if (typeof rawResult === "string") {
    result = { text: rawResult }
  } else if (isStructuredResult(rawResult)) {
    result = rawResult
  } else {
    result = { data: rawResult }
  }

  const diagnostics = [
    ...reportedDiagnostics,
    ...(result.diagnostics ?? []).map(normalizeDiagnostic),
  ]
  const defaultExitCode = diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0
  const exitCode = result.exitCode ?? defaultExitCode
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new Error("Plugin command exitCode must be an integer from 0 to 255.")
  }
  return {
    exitCode,
    ...(result.text !== undefined ? { text: String(result.text) } : {}),
    ...(Object.hasOwn(result, "data") ? { data: result.data } : {}),
    diagnostics,
  }
}

function isStructuredResult(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ["exitCode", "text", "data", "diagnostics"].some((key) => Object.hasOwn(value, key))
  )
}

function normalizeDiagnostic(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object") {
    throw new Error("Plugin diagnostics must be objects.")
  }
  if (!new Set(["info", "warning", "error"]).has(diagnostic.severity)) {
    throw new Error("Plugin diagnostic severity must be info, warning, or error.")
  }
  if (typeof diagnostic.message !== "string" || diagnostic.message.length === 0) {
    throw new Error("Plugin diagnostic message must be a non-empty string.")
  }
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.code ? { code: String(diagnostic.code) } : {}),
    ...(Object.hasOwn(diagnostic, "details") ? { details: diagnostic.details } : {}),
  }
}

function emitResult(invocation, io, result) {
  if (invocation.json) {
    io.stdout(
      `${JSON.stringify({
        ok: result.exitCode === 0,
        plugin: invocation.namespace,
        command: invocation.commandName,
        exitCode: result.exitCode,
        result: Object.hasOwn(result, "data") ? result.data : (result.text ?? null),
        diagnostics: result.diagnostics,
      })}\n`
    )
    return
  }

  if (result.text) {
    io.stdout(`${result.text}\n`)
  } else if (Object.hasOwn(result, "data")) {
    io.stdout(`${JSON.stringify(result.data, null, 2)}\n`)
  }
  for (const diagnostic of result.diagnostics) {
    io.stderr(`${formatDiagnostic(diagnostic)}\n`)
  }
}

function emitHostFailure(invocation, io, code, error, exitCode = 1) {
  const diagnostic = {
    severity: "error",
    code,
    message: errorMessage(error),
  }
  if (invocation.json) {
    io.stdout(
      `${JSON.stringify({
        ok: false,
        plugin: invocation.namespace,
        command: invocation.commandName ?? null,
        exitCode,
        result: null,
        diagnostics: [diagnostic],
      })}\n`
    )
  } else {
    io.stderr(`${formatDiagnostic(diagnostic)}\n`)
  }
  return { handled: true, exitCode }
}

function formatDiagnostic(diagnostic) {
  const code = diagnostic.code ? ` ${diagnostic.code}` : ""
  return `[${diagnostic.severity}${code}] ${diagnostic.message}`
}

function installSignalHandlers(abortController, enabled = true) {
  if (!enabled) return () => {}
  const onInterrupt = () => abortController.abort({ signal: "SIGINT", exitCode: 130 })
  const onTerminate = () => abortController.abort({ signal: "SIGTERM", exitCode: 143 })
  process.once("SIGINT", onInterrupt)
  process.once("SIGTERM", onTerminate)
  return () => {
    process.off("SIGINT", onInterrupt)
    process.off("SIGTERM", onTerminate)
  }
}

function abortExitCode(reason) {
  return Number.isInteger(reason?.exitCode) ? reason.exitCode : 130
}

function isInteractive(invocation, override) {
  if (invocation.json) return false
  if (override !== undefined) return Boolean(override)
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI)
}

function cancellationError(reason, fallback) {
  if (reason?.signal) {
    return new Error(`Plugin command cancelled by ${reason.signal}.`)
  }
  return fallback instanceof Error ? fallback : new Error("Plugin command cancelled.")
}

async function loadConfigFromPackage(options) {
  const { loadPalamedesConfig } = await import("@palamedes/config")
  return loadPalamedesConfig(options)
}

function isConfigNotFound(error) {
  return errorMessage(error).startsWith("Could not find a Palamedes config.")
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function defaultIo() {
  return {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  }
}
