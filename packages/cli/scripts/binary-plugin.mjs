import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

import { PALAMEDES_PLUGIN_API_VERSION } from "../plugin-api.mjs"

export const PALAMEDES_BINARY_PLUGIN_PROTOCOL_VERSION = 1

// Script binaries keep the fixture and local-dev story cross-platform: a
// pluginBinary ending in .js/.mjs/.cjs is spawned through the current Node
// executable instead of directly.
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"])

const HOST_VERSION = createRequire(import.meta.url)("../package.json").version

export function resolveBinaryPlugin(specifier, configPath) {
  const configDir = path.dirname(configPath)
  const packageDir = locatePackageDir(specifier, configPath, configDir)
  if (packageDir) {
    const declared = readPackageManifest(packageDir)?.palamedes?.pluginBinary
    if (typeof declared !== "string" || declared.length === 0) {
      return
    }
    return { specifier, binaryPath: path.resolve(packageDir, declared) }
  }
  if (isPathSpecifier(specifier)) {
    const resolved = path.resolve(configDir, specifier)
    if (isFile(resolved) && !SCRIPT_EXTENSIONS.has(path.extname(resolved))) {
      return { specifier, binaryPath: resolved }
    }
  }
  return
}

export async function loadBinaryPlugin(resolved, context = {}) {
  const invocation = await invokeBinary(resolved, describeRequest(), context)
  if (invocation.exitCode !== 0) {
    throw protocolError(resolved, `describe failed with exit code ${invocation.exitCode}`)
  }
  const manifests = invocation.events.filter((event) => event.event === "manifest")
  if (manifests.length !== 1) {
    throw protocolError(resolved, "describe must emit exactly one manifest event")
  }
  const manifest = manifests[0]
  if (manifest.protocolVersion !== PALAMEDES_BINARY_PLUGIN_PROTOCOL_VERSION) {
    throw codedError(
      "PLUGIN_PROTOCOL_INCOMPATIBLE",
      `Binary plugin "${resolved.specifier}" requires binary plugin protocol ${String(manifest.protocolVersion)}; this CLI supports ${PALAMEDES_BINARY_PLUGIN_PROTOCOL_VERSION}.`
    )
  }
  if (
    !manifest.commands ||
    typeof manifest.commands !== "object" ||
    Array.isArray(manifest.commands)
  ) {
    throw protocolError(resolved, "manifest must declare a commands object")
  }

  const commands = {}
  for (const [commandName, declaration] of Object.entries(manifest.commands)) {
    commands[commandName] = {
      ...(typeof declaration?.description === "string"
        ? { description: declaration.description }
        : {}),
      run: (payload) => runBinaryCommand(resolved, commandName, payload, context),
    }
  }
  return { name: manifest.name, apiVersion: PALAMEDES_PLUGIN_API_VERSION, commands }
}

async function runBinaryCommand(resolved, commandName, payload, context) {
  const request = {
    palamedesBinaryPluginProtocol: PALAMEDES_BINARY_PLUGIN_PROTOCOL_VERSION,
    hostVersion: HOST_VERSION,
    kind: "run",
    command: commandName,
    args: payload.args,
    options: payload.options ?? null,
    json: payload.json,
    interactive: payload.interactive,
    config: payload.host.config,
    catalogs: payload.host.catalogs(),
  }
  const invocation = await invokeBinary(resolved, request, context, payload.signal)
  if (payload.signal?.aborted) {
    throw payload.signal.reason
  }

  const outputs = []
  let result
  for (const event of invocation.events) {
    if (event.event === "diagnostic") {
      payload.host.reportDiagnostic({
        severity: event.severity,
        message: event.message,
        ...(event.code ? { code: event.code } : {}),
        ...(Object.hasOwn(event, "details") ? { details: event.details } : {}),
      })
    } else if (event.event === "output") {
      outputs.push(String(event.text ?? ""))
    } else if (event.event === "result") {
      if (result) {
        throw protocolError(resolved, "run must emit at most one result event")
      }
      result = event
    } else {
      throw protocolError(resolved, `unknown event "${String(event.event)}"`)
    }
  }

  if (!result) {
    return {
      exitCode: invocation.exitCode === 0 ? 1 : invocation.exitCode,
      diagnostics: [
        {
          severity: "error",
          code: "PLUGIN_BINARY_PROTOCOL",
          message: `Binary plugin "${resolved.specifier}" exited with code ${invocation.exitCode} without emitting a result event.`,
        },
      ],
    }
  }

  const text = [...outputs, ...(result.text !== undefined ? [String(result.text)] : [])].join("\n")
  return {
    ...(text.length > 0 ? { text } : {}),
    ...(Object.hasOwn(result, "data") ? { data: result.data } : {}),
    ...(Object.hasOwn(result, "exitCode") ? { exitCode: result.exitCode } : {}),
  }
}

function describeRequest() {
  return {
    palamedesBinaryPluginProtocol: PALAMEDES_BINARY_PLUGIN_PROTOCOL_VERSION,
    hostVersion: HOST_VERSION,
    kind: "describe",
  }
}

async function invokeBinary(resolved, request, context = {}, signal) {
  if (signal?.aborted) {
    throw signal.reason
  }
  const isScript = SCRIPT_EXTENSIONS.has(path.extname(resolved.binaryPath))
  const executable = isScript ? process.execPath : resolved.binaryPath
  const executableArgs = isScript ? [resolved.binaryPath] : []

  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, executableArgs, {
      cwd: context.cwd,
      env: {
        ...process.env,
        ...(context.nativeExecutable ? { PALAMEDES_NATIVE: context.nativeExecutable } : {}),
      },
      stdio: ["pipe", "pipe", "inherit"],
    })
    let stdout = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    const onAbort = () => child.kill(signal?.reason?.signal ?? "SIGTERM")
    const cleanup = () => signal?.removeEventListener("abort", onAbort)
    signal?.addEventListener("abort", onAbort, { once: true })
    child.once("error", (error) => {
      cleanup()
      reject(
        codedError(
          "PLUGIN_BINARY_SPAWN_FAILED",
          `Could not run binary plugin "${resolved.specifier}": ${error.message}`
        )
      )
    })
    child.once("exit", (code, exitSignal) => {
      cleanup()
      const exitCode = exitSignal
        ? exitSignal === "SIGINT"
          ? 130
          : exitSignal === "SIGTERM"
            ? 143
            : 1
        : (code ?? 1)
      try {
        resolvePromise({ exitCode, events: parseEvents(stdout, resolved) })
      } catch (error) {
        reject(error)
      }
    })
    // The child may exit before consuming its request; a closed pipe must not
    // surface as an unrelated stream error.
    child.stdin.on("error", () => {})
    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}

function parseEvents(stdout, resolved) {
  const events = []
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw protocolError(resolved, `invalid JSON event line: ${line}`)
    }
    if (!event || typeof event !== "object" || typeof event.event !== "string") {
      throw protocolError(resolved, `event lines must be objects with an "event" kind`)
    }
    events.push(event)
  }
  return events
}

function locatePackageDir(specifier, configPath, configDir) {
  if (isPathSpecifier(specifier)) {
    const resolved = path.resolve(configDir, specifier)
    return isFile(path.join(resolved, "package.json")) ? resolved : undefined
  }
  const packageSegments = bareSpecifierSegments(specifier)
  if (!packageSegments) {
    return
  }
  const require = createRequire(configPath)
  for (const candidateRoot of require.resolve.paths(specifier) ?? []) {
    const candidate = path.join(candidateRoot, ...packageSegments)
    if (isFile(path.join(candidate, "package.json"))) {
      return candidate
    }
  }
  return
}

function bareSpecifierSegments(specifier) {
  const segments = specifier.split("/")
  if (specifier.startsWith("@")) {
    return segments.length === 2 ? segments : undefined
  }
  return segments.length === 1 ? segments : undefined
}

function readPackageManifest(packageDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"))
  } catch {
    return
  }
}

function isPathSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../") || path.isAbsolute(specifier)
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function protocolError(resolved, detail) {
  return codedError(
    "PLUGIN_BINARY_PROTOCOL",
    `Binary plugin "${resolved.specifier}" violated the binary plugin protocol: ${detail}.`
  )
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
