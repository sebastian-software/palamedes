"use strict"

const { createHash } = require("node:crypto")
const { readFileSync, realpathSync, statSync } = require("node:fs")
const path = require("node:path")
const { decode, encode } = require("@jridgewell/sourcemap-codec")
const { loadPalamedesConfigSync } = require("@palamedes/config")
const { transformPalamedesMacros } = require("@palamedes/transform")
const picomatch = require("picomatch")
const { warnMissingAddDependency } = require("./palamedes-dev-warning.cjs")

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
      if (
        createHash("sha256").update(readFileSync(cached.config.configPath)).digest("hex") ===
        cached.digest
      ) {
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
      digest: createHash("sha256").update(readFileSync(config.configPath)).digest("hex"),
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
  const configuredPath = path.resolve(config.rootDir, catalog.path.replaceAll("{locale}", locale))
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

function clientMessageBootstrap(config, sourcePath, compiledIds, fragmentFailureMode) {
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
  const fragmentFailurePrefix = JSON.stringify(
    `Palamedes client graph message splitting failed to load a catalog fragment for ${modulePath} (`
  )
  const fragmentFailureSuffix = JSON.stringify("). Continuing without that fragment.")

  const imports =
    `const ${identifier}_modules = await Promise.all([\n` +
    `  import("@palamedes/core/compiled"),\n` +
    `  import("@palamedes/runtime"),\n` +
    `]);\n` +
    `let ${identifier}_existingI18n;\n` +
    `try {\n` +
    `  ${identifier}_existingI18n = ${identifier}_modules[1].getI18n();\n` +
    `} catch {\n` +
    `  // No client i18n has been installed yet.\n` +
    `}\n` +
    `const ${identifier}_locale = ${identifier}_existingI18n?.locale ?? document.documentElement.lang;\n`
  // Fragments are imported in parallel but registered in loader-group order, so
  // two catalogs carrying the same message id resolve to the same winner in
  // both failure modes. Degrading isolates a failure; it does not reorder.
  const reportFragmentFailure =
    `const ${identifier}_reportFragmentFailure = (error) => {\n` +
    `  try {\n` +
    `    console.error(\n` +
    `      ${fragmentFailurePrefix},\n` +
    `      ${identifier}_locale,\n` +
    `      ${fragmentFailureSuffix},\n` +
    `      error,\n` +
    `    );\n` +
    `  } catch {\n` +
    `    // Logging must not prevent the client graph from hydrating.\n` +
    `  }\n` +
    `};\n`
  const fragmentImports =
    fragmentFailureMode === "degrade"
      ? `${reportFragmentFailure}const ${identifier}_fragments = await Promise.all(${identifier}_activeLoaders.map(async (load) => {\n` +
        `  try {\n` +
        `    return await load();\n` +
        `  } catch (error) {\n` +
        `    ${identifier}_reportFragmentFailure(error);\n` +
        `    return null;\n` +
        `  }\n` +
        `}));\n`
      : `const ${identifier}_fragments = await Promise.all(${identifier}_activeLoaders.map((load) => load()));\n`

  const fragmentRegistration =
    fragmentFailureMode === "degrade"
      ? `for (const fragment of ${identifier}_fragments) {\n` +
        `  if (fragment === null) continue;\n` +
        `  try {\n` +
        `    ${identifier}_i18n.load(${identifier}_locale, fragment.messages);\n` +
        `  } catch (error) {\n` +
        `    ${identifier}_reportFragmentFailure(error);\n` +
        `  }\n` +
        `}\n`
      : `for (const fragment of ${identifier}_fragments) {\n` +
        `  const { messages } = fragment;\n` +
        `  ${identifier}_i18n.load(${identifier}_locale, messages);\n` +
        `}\n`

  const initialize = `const ${identifier}_i18n = ${identifier}_existingI18n ?? ${identifier}_modules[1].initializeClientI18n(
  ${identifier}_locale,
  ${identifier}_modules[0].createI18n,
);
`
  const unsupportedLocale = `new Error(\`Palamedes client graph bootstrap does not support document locale "\${${identifier}_locale}". Configured locales: ${supportedLocales}.\`)`
  const unsupportedLocaleHandling =
    fragmentFailureMode === "degrade"
      ? `try {\n  console.error(${unsupportedLocale});\n} catch {\n  // Logging must not prevent the client graph from hydrating.\n}\n`
      : `throw ${unsupportedLocale};\n`

  return `const ${identifier}_loaderGroups = [${loaderGroups.join(", ")}];
${imports}
const ${identifier}_activeLoaders = ${identifier}_loaderGroups.map((loaders) => loaders[${identifier}_locale]);
if (${identifier}_activeLoaders.some((loader) => loader === undefined)) {
  ${unsupportedLocaleHandling}}
else {
${initialize}${fragmentImports}${fragmentRegistration}}
`
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

function generatedPositionForText(text) {
  const line = text.split("\n").length - 1
  return { line, column: text.length - text.lastIndexOf("\n") - 1 }
}

function compareGeneratedPositions(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line
  }
  return left.column - right.column
}

function insertionMetrics(insertion) {
  const position = generatedPositionForText(insertion)
  return { addedLines: position.line, finalLineLength: position.column }
}

function shiftedGeneratedPosition(position, insertionPosition, insertion, metrics) {
  if (compareGeneratedPositions(position, insertionPosition) < 0) {
    return position
  }
  if (metrics.addedLines === 0) {
    return position.line === insertionPosition.line
      ? { line: position.line, column: position.column + insertion.length }
      : position
  }
  return {
    line: position.line + metrics.addedLines,
    column:
      position.line === insertionPosition.line
        ? metrics.finalLineLength + position.column - insertionPosition.column
        : position.column,
  }
}

function isGeneratedPosition(position) {
  return (
    position &&
    typeof position === "object" &&
    Number.isInteger(position.line) &&
    position.line >= 0 &&
    Number.isInteger(position.column) &&
    position.column >= 0
  )
}

function offsetFlatSourceMap(sourceMap, insertionPosition, insertion, metrics) {
  if (sourceMap.mappings === "") {
    return sourceMap
  }

  const mappings = decode(sourceMap.mappings)
  const shifted = Array.from({ length: mappings.length + metrics.addedLines }, () => [])

  for (const [lineIndex, segments] of mappings.entries()) {
    for (const segment of segments) {
      const position = shiftedGeneratedPosition(
        { line: lineIndex, column: segment[0] },
        insertionPosition,
        insertion,
        metrics
      )
      const shiftedSegment = [...segment]
      shiftedSegment[0] = position.column
      shifted[position.line].push(shiftedSegment)
    }
  }

  return { ...sourceMap, mappings: encode(shifted) }
}

function offsetIndexedSourceMap(sourceMap, insertionPosition, insertion, metrics) {
  const sections = sourceMap.sections
  if (!sections.every((section) => section && isGeneratedPosition(section.offset))) {
    return sourceMap
  }

  let activeSectionIndex = -1
  for (const [sectionIndex, section] of sections.entries()) {
    // A section starting exactly at the insertion belongs to the original body
    // and moves with it; only the preceding section can span the insertion.
    if (compareGeneratedPositions(section.offset, insertionPosition) < 0) {
      activeSectionIndex = sectionIndex
    }
  }

  let changed = false
  const shiftedSections = sections.map((section, sectionIndex) => {
    if (sectionIndex === activeSectionIndex) {
      const localInsertionPosition = {
        line: insertionPosition.line - section.offset.line,
        column:
          insertionPosition.line === section.offset.line
            ? insertionPosition.column - section.offset.column
            : insertionPosition.column,
      }
      const map = offsetSourceMapAtPosition(section.map, localInsertionPosition, insertion, metrics)
      if (map !== section.map) {
        changed = true
        return { ...section, map }
      }
      return section
    }

    if (compareGeneratedPositions(section.offset, insertionPosition) >= 0) {
      changed = true
      return {
        ...section,
        offset: shiftedGeneratedPosition(section.offset, insertionPosition, insertion, metrics),
      }
    }
    return section
  })

  return changed ? { ...sourceMap, sections: shiftedSections } : sourceMap
}

function offsetSourceMapAtPosition(sourceMap, insertionPosition, insertion, metrics) {
  if (!sourceMap || typeof sourceMap !== "object") {
    return sourceMap
  }
  if (typeof sourceMap.mappings === "string") {
    return offsetFlatSourceMap(sourceMap, insertionPosition, insertion, metrics)
  }
  if (Array.isArray(sourceMap.sections)) {
    return offsetIndexedSourceMap(sourceMap, insertionPosition, insertion, metrics)
  }
  return sourceMap
}

function offsetSourceMapForInsertion(sourceMap, insertionOffset, insertion) {
  if (insertion.length === 0) {
    return sourceMap
  }
  return offsetSourceMapAtPosition(
    sourceMap,
    generatedPositionForText(insertionOffset.source),
    insertion,
    insertionMetrics(insertion)
  )
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

function messageLoaderRegistration(config, sourcePath, compiledIds, clearUnmatchedRegistration) {
  const importsByCatalog = selectedMessageImports(config, sourcePath, compiledIds)
  const modulePath = normalizePath(
    path.relative(canonicalPath(config.rootDir), canonicalPath(sourcePath))
  )
  const moduleKey = createHash("sha256").update(modulePath).digest("hex").slice(0, 12)
  if (!importsByCatalog) {
    if (!clearUnmatchedRegistration) {
      return null
    }
    return {
      code:
        `\nimport { registerMessageLoaderGroup } from "@palamedes/runtime";\n` +
        `registerMessageLoaderGroup(${JSON.stringify(moduleKey)}, []);\n`,
      matchesCatalog: false,
    }
  }

  const registrations =
    compiledIds.length === 0
      ? []
      : importsByCatalog.map((imports) => {
          const loaders = imports
            .map(
              ({ locale, specifier }) =>
                `${JSON.stringify(locale)}: () => import(${JSON.stringify(specifier)}).then(({ messages }) => messages)`
            )
            .join(", ")
          return `{ ${loaders} }`
        })

  return {
    code:
      `\nimport { registerMessageLoaderGroup } from "@palamedes/runtime";\n` +
      `const __pmds_releaseMessageLoaders = registerMessageLoaderGroup(${JSON.stringify(moduleKey)}, [${registrations.join(", ")}]);\n` +
      `if (import.meta.webpackHot) import.meta.webpackHot.dispose(__pmds_releaseMessageLoaders);\n`,
    matchesCatalog: true,
  }
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
  const clearsServerRegistration = serverMessageSplitting && process.env.NODE_ENV !== "production"
  if (
    (!serverMessageSplitting && !clientMessageSplitting) ||
    !Array.isArray(result.compiledIds) ||
    (!result.compiledIds?.length && !clearsServerRegistration)
  ) {
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
    } else {
      warnMissingAddDependency(this)
    }
    const registration = serverMessageSplitting
      ? messageLoaderRegistration(
          config,
          this.resourcePath,
          result.compiledIds,
          clearsServerRegistration
        )
      : clientMessageBootstrap(
          config,
          this.resourcePath,
          result.compiledIds,
          options.clientFragmentFailureMode === "degrade" ? "degrade" : "throw"
        )
    let code = result.code
    let sourceMap = result.map ?? inputSourceMap ?? null
    if (registration) {
      const registrationCode = serverMessageSplitting ? registration.code : registration
      if (clientMessageSplitting) {
        const output = prependClientMessageBootstrap(code, registrationCode)
        code = output.code
        sourceMap = offsetSourceMapForInsertion(sourceMap, output.insertion, output.insertion.value)
      } else {
        code += registrationCode
      }
    }
    if (
      serverMessageSplitting &&
      result.compiledIds.length > 0 &&
      !registration?.matchesCatalog &&
      typeof this.emitWarning === "function"
    ) {
      this.emitWarning(
        new Error(
          `Palamedes Server Function message splitting: ${this.resourcePath} uses messages but is not included in any configured catalog.`
        )
      )
    } else if (!registration && typeof this.emitWarning === "function") {
      this.emitWarning(
        new Error(
          `Palamedes client graph message splitting: ${this.resourcePath} uses messages but is not included in any configured catalog.`
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
