import { createRequire } from "node:module"
import path from "node:path"
import { performance } from "node:perf_hooks"

const [addonPath, rootDir, mode] = process.argv.slice(2)
if (!addonPath || !rootDir) {
  throw new Error("Expected the test-support addon path and fixture root.")
}

const require = createRequire(import.meta.url)
const addon = require(addonPath)
const resourcePath = path.join(rootDir, "locales", "de", "messages.po")
const injectedDelayMs = 500
const intervalMs = 10
const minimumTickCount = 3
const maximumTickGapMs = injectedDelayMs / 2
const request = {
  config: {
    rootDir,
    locales: ["en", "de"],
    sourceLocale: "en",
    catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
  },
  resourcePath,
}

let settled = false
const startedAt = performance.now()
const tickTimes = []
const interval = setInterval(() => tickTimes.push(performance.now()), intervalMs)

try {
  const pending =
    mode === "--blocking-control"
      ? blockingCatalogPromise(injectedDelayMs)
      : addon.compileCatalogArtifactWithDelayForTestSupport(request, injectedDelayMs)
  const tracked = pending.then((result) => {
    settled = true
    return result
  })

  await Promise.resolve()
  if (settled) {
    throw new Error("Native catalog work settled before the event-loop microtask barrier.")
  }

  const result = await tracked
  const settledAt = performance.now()
  const timeline = [startedAt, ...tickTimes, settledAt]
  const maximumObservedGapMs = Math.max(
    ...timeline.slice(1).map((timestamp, index) => timestamp - timeline[index])
  )

  if (tickTimes.length < minimumTickCount) {
    throw new Error(
      `Event loop produced only ${tickTimes.length} timer ticks during native catalog work; expected at least ${minimumTickCount}.`
    )
  }
  if (maximumObservedGapMs >= maximumTickGapMs) {
    throw new Error(
      `Event-loop timer gap reached ${maximumObservedGapMs.toFixed(1)}ms; expected less than ${maximumTickGapMs}ms during native catalog work.`
    )
  }

  if (!Object.values(result.messages).includes("Hallo")) {
    throw new Error("The delayed async task did not execute catalog compilation.")
  }
} finally {
  clearInterval(interval)
}

function blockingCatalogPromise(delayMs) {
  const blocker = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  Atomics.wait(blocker, 0, 0, delayMs)
  return new Promise((resolve) => {
    setImmediate(() => resolve({ messages: { greeting: "Hallo" } }))
  })
}
