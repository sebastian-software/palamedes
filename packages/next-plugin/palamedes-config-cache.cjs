"use strict";

const { digestConfig: sharedDigestConfig } = require("@palamedes/config");

const configCache = new Map();

function loadConfigCachedSync(configPath, loadConfig, cwd) {
  const cacheKey = getCacheKey(configPath, cwd);
  const cached = getCachedConfig(cacheKey);
  if (cached) {
    return cached;
  }

  const config = loadConfig({ configPath, cwd });
  cacheConfig(cacheKey, config);
  return config;
}

async function loadConfigCached(configPath, loadConfig, cwd) {
  const cacheKey = getCacheKey(configPath, cwd);
  const cached = getCachedConfig(cacheKey);
  if (cached) {
    return cached;
  }

  const config = await loadConfig({ configPath, cwd });
  cacheConfig(cacheKey, config);
  return config;
}

function getCacheKey(configPath, cwd) {
  return JSON.stringify([configPath ?? "", cwd ?? process.cwd()]);
}

function getCachedConfig(cacheKey) {
  const cached = configCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  try {
    return sharedDigestConfig(cached.config) === cached.digest ? cached.config : null;
  } catch {
    // Config moved, changed, or is not readable; reload it below.
    return null;
  }
}

function cacheConfig(cacheKey, config) {
  try {
    configCache.set(cacheKey, {
      config,
      digest: sharedDigestConfig(config),
    });
  } catch {
    // Tests and virtual configs may not have a readable config file.
  }
}

function clearConfigCache() {
  configCache.clear();
}

module.exports = {
  clearConfigCache,
  loadConfigCached,
  loadConfigCachedSync,
};
