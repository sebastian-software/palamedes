import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"

const exampleDir = path.resolve(process.argv[2] ?? ".")
const nextDir = path.join(exampleDir, ".next")
const manifestPath = path.join(nextDir, "server/app/[locale]/page_client-reference-manifest.js")
const manifestSource = await readFile(manifestPath, "utf8")
const sandbox = { __RSC_MANIFEST: {} }
vm.runInNewContext(manifestSource, sandbox, { filename: manifestPath })

const routeManifest = sandbox.__RSC_MANIFEST["/[locale]/page"]
assert(routeManifest, "Missing /[locale]/page client reference manifest")

const initialEntryFiles = new Set(
  Object.values(routeManifest.entryJSFiles)
    .flat()
    .filter((file) => file.endsWith(".js"))
)
assert.notEqual(initialEntryFiles.size, 0, "The route must have initial client entry chunks")

const initialSource = (
  await Promise.all(
    [...initialEntryFiles].map((file) => readFile(path.join(nextDir, file), "utf8"))
  )
).join("\n")

const inactiveCatalogSentinels = [
  "Live lokalisiert mit Palamedes",
  "Localizado en vivo con Palamedes",
]
for (const sentinel of inactiveCatalogSentinels) {
  assert.equal(
    initialSource.includes(sentinel),
    false,
    `Inactive catalog sentinel is present in the initial route entry: ${sentinel}`
  )
}
assert.equal(
  initialSource.includes("__PALAMEDES_LOCALE__"),
  false,
  "The initial route entry must not contain the legacy inline-locale bootstrap"
)

const staticChunkDir = path.join(nextDir, "static/chunks")
const chunkFiles = (await readdir(staticChunkDir)).filter((file) => file.endsWith(".js"))
const catalogChunks = new Map()
for (const file of chunkFiles) {
  const source = await readFile(path.join(staticChunkDir, file), "utf8")
  for (const sentinel of inactiveCatalogSentinels) {
    if (source.includes(sentinel)) {
      catalogChunks.set(sentinel, file)
    }
  }
}

for (const sentinel of inactiveCatalogSentinels) {
  assert(
    catalogChunks.has(sentinel),
    `Expected a separate emitted catalog chunk containing: ${sentinel}`
  )
}
assert.equal(
  new Set(catalogChunks.values()).size,
  inactiveCatalogSentinels.length,
  "Each locale catalog must be emitted as its own client chunk"
)

console.log(
  `[next-catalog-bundle] ${initialEntryFiles.size} initial route chunks exclude inactive catalogs; separate chunks: ${[
    ...catalogChunks.values(),
  ].join(", ")}`
)
