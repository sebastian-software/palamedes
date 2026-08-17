async function fetchJson(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim())
  }
  return response.json()
}

export async function fetchNpmPackageStats(
  name,
  { fetchImpl = fetch, timeoutMs = 5000, warn = console.warn } = {}
) {
  const encodedName = encodeURIComponent(name)
  const [registryResult, downloadsResult] = await Promise.allSettled([
    fetchJson(fetchImpl, `https://registry.npmjs.org/${encodedName}/latest`, timeoutMs),
    fetchJson(
      fetchImpl,
      `https://api.npmjs.org/downloads/point/last-month/${encodedName}`,
      timeoutMs
    ),
  ])

  if (registryResult.status === "rejected") {
    warn(
      `prebuild-content: npm registry snapshot unavailable for ${name}: ${registryResult.reason}`
    )
  }
  if (downloadsResult.status === "rejected") {
    warn(
      `prebuild-content: npm download snapshot unavailable for ${name}: ${downloadsResult.reason}`
    )
  }

  const registry = registryResult.status === "fulfilled" ? registryResult.value : null
  const downloads = downloadsResult.status === "fulfilled" ? downloadsResult.value : null

  return {
    name,
    version: typeof registry?.version === "string" ? registry.version : null,
    monthlyDownloads: Number.isFinite(downloads?.downloads) ? downloads.downloads : null,
    period: downloads?.start && downloads?.end ? `${downloads.start}/${downloads.end}` : null,
    source: registry && downloads ? "npm" : registry || downloads ? "npm-partial" : "unavailable",
  }
}
