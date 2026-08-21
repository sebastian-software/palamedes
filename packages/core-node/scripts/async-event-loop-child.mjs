import { createRequire } from "node:module"
import path from "node:path"

const [addonPath, rootDir] = process.argv.slice(2)
if (!addonPath || !rootDir) {
  throw new Error("Expected the test-support addon path and fixture root.")
}

const require = createRequire(import.meta.url)
const addon = require(addonPath)
const resourcePath = path.join(rootDir, "locales", "de", "messages.po")
const pending = addon.compileCatalogArtifactWithDelayForTestSupport(
  {
    config: {
      rootDir,
      locales: ["en", "de"],
      sourceLocale: "en",
      catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
    },
    resourcePath,
  },
  100
)

let settled = false
const tracked = pending.then((result) => {
  settled = true
  return result
})

await new Promise((resolve) => setTimeout(resolve, 0))
if (settled) {
  throw new Error("Native catalog work settled before the event-loop timer barrier.")
}

const result = await tracked
if (!Object.values(result.messages).includes("Hallo")) {
  throw new Error("The delayed async task did not execute catalog compilation.")
}
