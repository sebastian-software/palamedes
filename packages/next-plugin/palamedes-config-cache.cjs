"use strict"

const { createHash } = require("node:crypto")
const { readFileSync } = require("node:fs")

const configCache = new Map()

function loadConfigCachedSync(configPath, loadConfig) {
  const cached = getCachedConfig(configPath)
  if (cached) {
    return cached
  }

  const config = loadConfig({ configPath })
  cacheConfig(configPath, config)
  return config
}

async function loadConfigCached(configPath, loadConfig) {
  const cached = getCachedConfig(configPath)
  if (cached) {
    return cached
  }

  const config = await loadConfig({ configPath })
  cacheConfig(configPath, config)
  return config
}

function getCachedConfig(configPath) {
  const cached = configCache.get(configPath ?? "")
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

function cacheConfig(configPath, config) {
  try {
    configCache.set(configPath ?? "", {
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
