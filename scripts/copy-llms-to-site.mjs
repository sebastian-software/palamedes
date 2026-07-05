/*
 * Copies the repo-root llms.txt and llms-full.txt into the built site output
 * so they serve at https://palamedes.dev/llms.txt per the llms.txt
 * convention. The repo root stays the single source of truth.
 */

import { copyFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const clientDir = join(repoRoot, "site/build/client")

if (!existsSync(clientDir)) {
  console.error("copy-llms-to-site: site/build/client does not exist — run the site build first")
  process.exit(1)
}

for (const file of ["llms.txt", "llms-full.txt"]) {
  copyFileSync(join(repoRoot, file), join(clientDir, file))
  console.log(`copy-llms-to-site: ${file} -> site/build/client/${file}`)
}
