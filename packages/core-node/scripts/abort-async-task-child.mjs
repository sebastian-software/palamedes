import { createRequire } from "node:module"
import path from "node:path"

const [addonPath, rootDir] = process.argv.slice(2)
if (!addonPath || !rootDir) {
  throw new Error("Expected the test-support addon path and fixture root.")
}

const require = createRequire(import.meta.url)
const addon = require(addonPath)
const request = {
  config: {
    rootDir,
    locales: ["en", "de"],
    sourceLocale: "en",
    catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
  },
  resourcePath: path.join(rootDir, "locales", "de", "messages.po"),
}

// UV_THREADPOOL_SIZE=1 makes the delayed task occupy the only worker so the
// following public task is deterministically still queued when it is aborted.
const blocker = addon.compileCatalogArtifactWithDelayForTestSupport(request, 500)
const controller = new AbortController()
const queued = addon.compileCatalogArtifactAsync(request, controller.signal)
controller.abort()

try {
  await queued
  throw new Error("Expected the queued native task to be aborted.")
} catch (error) {
  if (error?.message !== "AbortError") {
    throw error
  }
}

await blocker

const runningController = new AbortController()
const running = addon.compileCatalogArtifactWithDelayForTestSupport(
  request,
  200,
  runningController.signal
)
await new Promise((resolve) => setTimeout(resolve, 50))
runningController.abort()
const completed = await running
if (!Object.values(completed.messages).includes("Hallo")) {
  throw new Error("Aborting an already-started native task prevented it from completing.")
}
