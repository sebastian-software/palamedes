"use strict"

const { createHash } = require("node:crypto")
const { realpathSync, statSync } = require("node:fs")
const path = require("node:path")
const { decode, encode } = require("@jridgewell/sourcemap-codec")
const { loadPalamedesConfigSync } = require("@palamedes/config")
const { transformPalamedesMacros } = require("@palamedes/transform")
const picomatch = require("picomatch")

const SELECTED_MESSAGES_QUERY = "palamedes-selected"
const configCache = new Map()

function canonicalPath(value) {
  try {
    return realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

function normalizePath(value) {
  return value.split(path.sep).join("/")
}

function loadConfigCached(configPath) {
  const key = configPath ?? ""
  const cached = configCache.get(key)
  if (cached) {
    try {
      if (statSync(cached.config.configPath).mtimeMs === cached.mtimeMs) {
        return cached.config
      }
    } catch {
      // Config moved, changed, or is not stat-able; reload it below.
    }
  }

  const config = loadPalamedesConfigSync({ configPath })
  try {
    configCache.set(key, {
      config,
      mtimeMs: statSync(config.configPath).mtimeMs,
    })
  } catch {
    // Tests and virtual configs may not have a stat-able config file.
  }
  return config
}

function catalogMatchesSource(config, catalog, sourcePath) {
  // Keep catalog include/exclude matching in sync with catalogMatchesSource in
  // packages/vite-plugin/src/index.ts.
  const rootDir = canonicalPath(config.rootDir)
  const source = normalizePath(canonicalPath(sourcePath))
  const include = catalog.include.map((pattern) => {
    const absolute = path.resolve(rootDir, pattern)
    try {
      if (statSync(absolute).isDirectory()) {
        return `${normalizePath(absolute)}/**/*.{js,jsx,ts,tsx,mdx}`
      }
    } catch {
      // Keep non-existent paths and explicit glob patterns unchanged.
    }
    return normalizePath(absolute)
  })
  const exclude = (catalog.exclude ?? ["**/node_modules/**"]).map((pattern) =>
    normalizePath(path.resolve(rootDir, pattern))
  )

  return (
    include.some((pattern) => picomatch.isMatch(source, pattern)) &&
    !exclude.some((pattern) => picomatch.isMatch(source, pattern))
  )
}

function catalogResourcePath(config, catalog, locale) {
  const extension = catalog.format ?? "po"
  if (extension !== "po") {
    throw new Error(
      `Palamedes Next message splitting currently supports PO catalogs only. Catalog ${catalog.path} uses format ${extension}.`
    )
  }
  const configuredPath = path.resolve(config.rootDir, catalog.path.replace("{locale}", locale))
  const parsed = path.parse(configuredPath)
  return path.format({ dir: parsed.dir, name: parsed.name, ext: `.${extension}` })
}

function selectedMessageImports(config, sourcePath, compiledIds) {
  const catalogs = config.catalogs.filter((catalog) =>
    catalogMatchesSource(config, catalog, sourcePath)
  )
  if (catalogs.length === 0) {
    return null
  }

  const selection = Buffer.from(JSON.stringify(compiledIds)).toString("base64url")
  return catalogs.map((catalog) =>
    config.locales.map((locale) => {
      const resourcePath = catalogResourcePath(config, catalog, locale)
      return {
        locale,
        specifier: `${relativeImport(sourcePath, resourcePath)}?${SELECTED_MESSAGES_QUERY}=${selection}`,
      }
    })
  )
}

function clientMessageBootstrap(config, sourcePath, compiledIds) {
  const importsByCatalog = selectedMessageImports(config, sourcePath, compiledIds)
  if (!importsByCatalog) {
    return null
  }

  const loaderGroups = importsByCatalog.map((imports) => {
    const loaders = imports
      .map(
        ({ locale, specifier }) =>
          `${JSON.stringify(locale)}: () => import(${JSON.stringify(specifier)})`
      )
      .join(", ")
    return `{ ${loaders} }`
  })
  const supportedLocales = config.locales.map((locale) => JSON.stringify(locale)).join(", ")
  const modulePath = normalizePath(
    path.relative(canonicalPath(config.rootDir), canonicalPath(sourcePath))
  )
  const identifier = `__pmds_${createHash("sha256").update(modulePath).digest("hex").slice(0, 12)}`

  return (
    `const ${identifier}_locale = document.documentElement.lang;\n` +
    `const ${identifier}_loaderGroups = [${loaderGroups.join(", ")}];\n` +
    `const ${identifier}_activeLoaders = ${identifier}_loaderGroups.map((loaders) => loaders[${identifier}_locale]);\n` +
    `if (${identifier}_activeLoaders.some((loader) => loader === undefined)) {\n` +
    `  throw new Error(\`Palamedes client graph bootstrap does not support document locale "\${${identifier}_locale}". Configured locales: ${supportedLocales}.\`);\n` +
    `}\n` +
    `const ${identifier}_modules = await Promise.all([\n` +
    `  import("@palamedes/core/compiled"),\n` +
    `  import("@palamedes/runtime"),\n` +
    `  ...${identifier}_activeLoaders.map((load) => load()),\n` +
    `]);\n` +
    `const ${identifier}_i18n = ${identifier}_modules[1].initializeClientI18n(\n` +
    `  ${identifier}_locale,\n` +
    `  ${identifier}_modules[0].createI18n,\n` +
    `);\n` +
    `for (const { messages } of ${identifier}_modules.slice(2)) {\n` +
    `  ${identifier}_i18n.load(${identifier}_locale, messages);\n` +
    `}\n`
  )
}

function skipTrivia(code, index) {
  let current = index
  let sawLineTerminator = false

  while (current < code.length) {
    const character = code[current]
    if (character === "\r" || character === "\n") {
      sawLineTerminator = true
      current += 1
      continue
    }
    if (/\s/u.test(character)) {
      current += 1
      continue
    }
    if (code.startsWith("//", current)) {
      const lineEnd = code.indexOf("\n", current + 2)
      if (lineEnd === -1) {
        return { index: code.length, sawLineTerminator }
      }
      sawLineTerminator = true
      current = lineEnd + 1
      continue
    }
    if (code.startsWith("/*", current)) {
      const commentEnd = code.indexOf("*/", current + 2)
      if (commentEnd === -1) {
        return { index: code.length, sawLineTerminator }
      }
      const comment = code.slice(current, commentEnd + 2)
      if (/\r|\n/u.test(comment)) {
        sawLineTerminator = true
      }
      current = commentEnd + 2
      continue
    }
    break
  }

  return { index: current, sawLineTerminator }
}

function directivePrologueEnd(code) {
  let current = code.charCodeAt(0) === 0xfe_ff ? 1 : 0
  if (code.startsWith("#!", current)) {
    const lineEnd = code.indexOf("\n", current + 2)
    current = lineEnd === -1 ? code.length : lineEnd + 1
  }

  let end = current
  while (current < code.length) {
    const beforeDirective = skipTrivia(code, current)
    const quote = code[beforeDirective.index]
    if (quote !== '"' && quote !== "'") {
      break
    }

    let stringEnd = beforeDirective.index + 1
    while (stringEnd < code.length) {
      if (code[stringEnd] === "\\") {
        stringEnd += 2
        continue
      }
      if (code[stringEnd] === quote) {
        break
      }
      stringEnd += 1
    }
    if (stringEnd >= code.length) {
      break
    }

    const afterString = skipTrivia(code, stringEnd + 1)
    if (code[afterString.index] === ";") {
      const afterSemicolon = skipTrivia(code, afterString.index + 1)
      end = afterSemicolon.index
      current = afterSemicolon.index
      continue
    }
    if (afterString.index === code.length || afterString.sawLineTerminator) {
      end = afterString.index
      current = afterString.index
      continue
    }
    break
  }

  return end
}

function offsetSourceMapForInsertion(sourceMap, insertionOffset, insertion) {
  if (!sourceMap || typeof sourceMap !== "object" || typeof sourceMap.mappings !== "string") {
    return sourceMap
  }
  if (sourceMap.mappings === "" || insertion.length === 0) {
    return sourceMap
  }

  const prefix = insertionOffset.source
  const insertionLine = prefix.split("\n").length - 1
  const insertionColumn = prefix.length - prefix.lastIndexOf("\n") - 1
  const addedLines = insertion.split("\n").length - 1
  const finalLineLength = insertion.length - insertion.lastIndexOf("\n") - 1
  const mappings = decode(sourceMap.mappings)
  const shifted = Array.from({ length: mappings.length + addedLines }, () => [])

  for (const [lineIndex, segments] of mappings.entries()) {
    for (const segment of segments) {
      if (lineIndex < insertionLine) {
        shifted[lineIndex].push(segment)
        continue
      }
      if (lineIndex > insertionLine) {
        shifted[lineIndex + addedLines].push(segment)
        continue
      }
      if (segment[0] < insertionColumn) {
        shifted[lineIndex].push(segment)
        continue
      }

      const shiftedSegment = [...segment]
      if (addedLines === 0) {
        shiftedSegment[0] += insertion.length
        shifted[lineIndex].push(shiftedSegment)
      } else {
        shiftedSegment[0] = finalLineLength + segment[0] - insertionColumn
        shifted[lineIndex + addedLines].push(shiftedSegment)
      }
    }
  }

  return { ...sourceMap, mappings: encode(shifted) }
}

function prependClientMessageBootstrap(code, bootstrap) {
  const insertionIndex = directivePrologueEnd(code)
  const prefix = code.slice(0, insertionIndex)
  const insertion = `${prefix.length > 0 && !prefix.endsWith("\n") ? "\n" : ""}${bootstrap}`

  return {
    code: `${prefix}${insertion}${code.slice(insertionIndex)}`,
    insertion: { source: prefix, value: insertion },
  }
}

function relativeImport(fromFile, targetFile) {
  let relative = normalizePath(path.relative(path.dirname(fromFile), targetFile))
  if (!relative.startsWith(".")) {
    relative = `./${relative}`
  }
  return relative
}

function messageLoaderRegistration(config, sourcePath, compiledIds) {
  const importsByCatalog = selectedMessageImports(config, sourcePath, compiledIds)
  if (!importsByCatalog) {
    return null
  }

  const modulePath = normalizePath(
    path.relative(canonicalPath(config.rootDir), canonicalPath(sourcePath))
  )
  const moduleKey = createHash("sha256").update(modulePath).digest("hex").slice(0, 12)
  const registrations = importsByCatalog.map((imports, catalogIndex) => {
    const loaders = imports
      .map(
        ({ locale, specifier }) =>
          `${JSON.stringify(locale)}: () => import(${JSON.stringify(specifier)}).then(({ messages }) => messages)`
      )
      .join(", ")
    return `registerMessageLoaders(${JSON.stringify(`${moduleKey}:${catalogIndex}`)}, { ${loaders} });`
  })

  return (
    `\nimport { registerMessageLoaders } from "@palamedes/runtime";\n` +
    `${registrations.join("\n")}\n`
  )
}

module.exports = function palamedesLoader(source, inputSourceMap) {
  const callback = this.async ? this.async() : null
  const options = typeof this.getOptions === "function" ? this.getOptions() : {}
  let result

  try {
    result = transformPalamedesMacros(String(source), this.resourcePath, {
      runtimeModule: options.runtimeModule,
      keepSourceFallbacks: options.keepSourceFallbacks,
      stripNonEssentialProps: options.stripNonEssentialProps,
      serverFunctions: options.serverFunctions,
      sourceMap: this.sourceMap,
    })
  } catch (error) {
    if (callback) {
      callback(error)
      return
    }
    throw error
  }

  const serverMessageSplitting = options.serverMessageSplitting === true
  const clientMessageSplitting = options.clientMessageSplitting === true
  if ((!serverMessageSplitting && !clientMessageSplitting) || !result.compiledIds?.length) {
    if (callback) {
      callback(null, result.code, result.map ?? inputSourceMap ?? null)
      return
    }
    return result.code
  }

  try {
    const config = loadConfigCached(options.configPath)
    if (typeof this.addDependency === "function" && config.configPath) {
      this.addDependency(config.configPath)
    }
    const registration = serverMessageSplitting
      ? messageLoaderRegistration(config, this.resourcePath, result.compiledIds)
      : clientMessageBootstrap(config, this.resourcePath, result.compiledIds)
    let code = result.code
    let sourceMap = result.map ?? inputSourceMap ?? null
    if (registration) {
      if (clientMessageSplitting) {
        const output = prependClientMessageBootstrap(code, registration)
        code = output.code
        sourceMap = offsetSourceMapForInsertion(sourceMap, output.insertion, output.insertion.value)
      } else {
        code += registration
      }
    } else if (typeof this.emitWarning === "function") {
      this.emitWarning(
        new Error(
          `Palamedes ${serverMessageSplitting ? "Server Function" : "client graph"} message splitting: ${this.resourcePath} uses messages but is not included in any configured catalog.`
        )
      )
    }
    if (callback) {
      callback(null, code, sourceMap)
      return
    }
    return code
  } catch (error) {
    if (callback) {
      callback(error)
      return
    }
    throw error
  }
}
