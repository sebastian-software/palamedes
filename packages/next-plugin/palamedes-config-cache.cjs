"use strict"

const { createHash } = require("node:crypto")
const { readFileSync } = require("node:fs")

const configCache = new Map()

function loadConfigCachedSync(configPath, loadConfig, cwd) {
  const cacheKey = getCacheKey(configPath, cwd)
  const cached = getCachedConfig(cacheKey)
  if (cached) {
    return cached
  }

  const config = loadConfig({ configPath, cwd })
  cacheConfig(cacheKey, config)
  return config
}

async function loadConfigCached(configPath, loadConfig, cwd) {
  const cacheKey = getCacheKey(configPath, cwd)
  const cached = getCachedConfig(cacheKey)
  if (cached) {
    return cached
  }

  const config = await loadConfig({ configPath, cwd })
  cacheConfig(cacheKey, config)
  return config
}

function getCacheKey(configPath, cwd) {
  return JSON.stringify([configPath ?? "", cwd ?? process.cwd()])
}

function getCachedConfig(cacheKey) {
  const cached = configCache.get(cacheKey)
  if (!cached) {
    return null
  }

  try {
    return digestConfig(cached.config.configPath) === cached.digest ? cached.config : null
  } catch {
    // Config moved, changed, or is not readable; reload it below.
    return null
  }
}

function cacheConfig(cacheKey, config) {
  try {
    configCache.set(cacheKey, {
      config,
      digest: digestConfig(config.configPath),
    })
  } catch {
    // Tests and virtual configs may not have a readable config file.
  }
}

function digestConfig(configPath) {
  return createHash("sha256").update(readFileSync(configPath)).digest("hex")
}

function clearConfigCache() {
  configCache.clear()
}

module.exports = {
  clearConfigCache,
  loadConfigCached,
  loadConfigCachedSync,
}
