import { setTimeout as delay } from "node:timers/promises"

export const NATIVE_TARBALL_MIN_UNPACKED_SIZE = 1_000_000
export const REGISTRY_VERIFICATION_TIMEOUT_MS = 5 * 60_000
export const REGISTRY_VERIFICATION_RETRY_MS = 15_000

export function nativeTarballFailure(packageInfo, unpackedSize) {
  if (!packageInfo.nativeArtifact) {
    return null
  }

  const size = Number(unpackedSize)
  if (Number.isFinite(size) && size >= NATIVE_TARBALL_MIN_UNPACKED_SIZE) {
    return null
  }

  return `${packageInfo.name}@${packageInfo.version} has native artifact ${packageInfo.nativeArtifact}, but its npm tarball is only ${String(unpackedSize)} bytes unpacked (expected at least ${NATIVE_TARBALL_MIN_UNPACKED_SIZE}).`
}

export async function waitForRegistryEntries(
  entries,
  {
    lookup,
    now = Date.now,
    onRetry = () => {},
    retryDelayMs = REGISTRY_VERIFICATION_RETRY_MS,
    sleep = delay,
    timeoutMs = REGISTRY_VERIFICATION_TIMEOUT_MS,
  } = {}
) {
  if (typeof lookup !== "function") {
    throw new TypeError("Registry verification requires a lookup function.")
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("Registry verification timeout must be a non-negative number.")
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) {
    throw new RangeError("Registry verification retry delay must be a positive number.")
  }

  const pending = new Map()
  for (const entry of entries) {
    if (pending.has(entry.spec)) {
      throw new Error(`Duplicate registry verification entry ${entry.spec}.`)
    }
    pending.set(entry.spec, { ...entry, lookup: undefined })
  }

  const found = []
  const deadline = now() + timeoutMs
  let attempt = 0

  while (pending.size > 0) {
    attempt += 1

    for (const [spec, entry] of pending) {
      const lookupResult = await lookup(entry)
      const checkedEntry = { ...entry, lookup: lookupResult }

      if (lookupResult.state === "found") {
        pending.delete(spec)
        found.push(checkedEntry)
      } else {
        pending.set(spec, checkedEntry)
      }
    }

    if (pending.size === 0) {
      break
    }

    const remainingMs = deadline - now()
    if (remainingMs <= 0) {
      break
    }

    const delayMs = Math.min(retryDelayMs, remainingMs)
    await onRetry([...pending.values()], { attempt, delayMs, remainingMs })
    await sleep(delayMs)
  }

  return { found, unresolved: [...pending.values()] }
}
