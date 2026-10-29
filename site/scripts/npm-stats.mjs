async function fetchJson(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  return response.json();
}

/*
 * Package names are reserved on npm with 0.0.0 placeholders before their first
 * release. A placeholder is not a release, so it is never shown as a version.
 */
function isPlaceholderVersion(version) {
  return /^0\.0\.0(?:[-+].*)?$/u.test(version);
}

export async function fetchNpmPackageStats(
  name,
  { fetchImpl = fetch, timeoutMs = 5000, warn = console.warn } = {},
) {
  const encodedName = encodeURIComponent(name);
  const [registryResult, downloadsResult] = await Promise.allSettled([
    fetchJson(fetchImpl, `https://registry.npmjs.org/${encodedName}/latest`, timeoutMs),
    fetchJson(
      fetchImpl,
      `https://api.npmjs.org/downloads/point/last-month/${encodedName}`,
      timeoutMs,
    ),
  ]);

  if (registryResult.status === "rejected") {
    warn(
      `prebuild-content: npm registry snapshot unavailable for ${name}: ${registryResult.reason}`,
    );
  }
  if (downloadsResult.status === "rejected") {
    warn(
      `prebuild-content: npm download snapshot unavailable for ${name}: ${downloadsResult.reason}`,
    );
  }

  const registry = registryResult.status === "fulfilled" ? registryResult.value : null;
  const downloads = downloadsResult.status === "fulfilled" ? downloadsResult.value : null;

  const registryVersion = typeof registry?.version === "string" ? registry.version : null;
  const placeholder = registryVersion != null && isPlaceholderVersion(registryVersion);

  return {
    name,
    version: placeholder ? null : registryVersion,
    // false: npm only holds a name-reservation placeholder; null: unknown.
    released: registryVersion == null ? null : !placeholder,
    monthlyDownloads: Number.isFinite(downloads?.downloads) ? downloads.downloads : null,
    period: downloads?.start && downloads?.end ? `${downloads.start}/${downloads.end}` : null,
    source: registry && downloads ? "npm" : registry || downloads ? "npm-partial" : "unavailable",
  };
}
