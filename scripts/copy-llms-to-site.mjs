/*
 * Copies the repo-root llms.txt and llms-full.txt into the built site output
 * so they serve at https://palamedes.dev/llms.txt per the llms.txt
 * convention. The repo root stays the single source of truth.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const clientDir = join(repoRoot, "site/build/client")

if (!existsSync(clientDir)) {
  console.error("copy-llms-to-site: site/build/client does not exist — run the site build first")
  process.exit(1)
}

for (const file of ["llms.txt", "llms-full.txt"]) {
  const source = readFileSync(join(repoRoot, file), "utf8")
  writeFileSync(join(clientDir, file), rewriteHostedRoutes(source), "utf8")
  console.log(`copy-llms-to-site: ${file} -> site/build/client/${file}`)
}

function rewriteHostedRoutes(content) {
  return content
    .replaceAll(/\/docs\/([^)`\s]+?)\.md/g, "/docs/$1")
    .replaceAll(/\/docs\/api\/README/g, "/docs/api")
    .replaceAll(/\/docs\/example-screenshots\/README/g, "/docs/example-screenshots")
    .replaceAll(/\/adr\/([^)`\s]+?)\.md/g, "/decisions/$1")
}
