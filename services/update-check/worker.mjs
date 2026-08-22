const REQUEST_BODY_LIMIT = 1024
const VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const TOKEN_PATTERN = /^[a-z0-9_][a-z0-9_.-]{0,63}$/u
const PAYLOAD_KEYS = ["arch", "ci", "os", "version"]

export default {
  async fetch(request, environment) {
    const url = new URL(request.url)
    if (url.pathname !== "/check") return response(404, { error: "not_found" })
    if (request.method !== "POST") {
      return response(405, { error: "method_not_allowed" }, { Allow: "POST" })
    }
    if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
      return response(415, { error: "unsupported_media_type" })
    }

    const latestVersion = environment.LATEST_VERSION
    if (!isVersion(latestVersion) || !environment.UPDATE_CHECKS?.writeDataPoint) {
      return response(503, { error: "latest_version_unavailable" })
    }

    const payload = await readPayload(request)
    if (!isPayload(payload)) return response(400, { error: "invalid_request" })

    // Deliberately no request headers, client IP, user agent, URL, timestamp,
    // command, filesystem value, or generated identifier enters the dataset.
    try {
      environment.UPDATE_CHECKS.writeDataPoint({
        blobs: [payload.version, payload.os, payload.arch, payload.ci ? "ci" : "local"],
        doubles: [1],
      })
    } catch {
      return response(503, { error: "analytics_unavailable" })
    }

    return response(200, { latestVersion })
  },
}

async function readPayload(request) {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > REQUEST_BODY_LIMIT) return null
  if (!request.body) return null

  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > REQUEST_BODY_LIMIT) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const body = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
  } catch {
    return null
  }
}

function isPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  return (
    keys.length === PAYLOAD_KEYS.length &&
    keys.every((key, index) => key === PAYLOAD_KEYS[index]) &&
    isVersion(value.version) &&
    typeof value.os === "string" &&
    TOKEN_PATTERN.test(value.os) &&
    typeof value.arch === "string" &&
    TOKEN_PATTERN.test(value.arch) &&
    typeof value.ci === "boolean"
  )
}

function isVersion(value) {
  if (typeof value !== "string" || value.length > 128 || !VERSION_PATTERN.test(value)) {
    return false
  }
  const withoutBuild = value.split("+", 1)[0]
  const separator = withoutBuild.indexOf("-")
  if (separator === -1) return true
  return withoutBuild
    .slice(separator + 1)
    .split(".")
    .every(
      (identifier) =>
        !/^\d+$/u.test(identifier) || identifier === "0" || !identifier.startsWith("0")
    )
}

function response(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  })
}
