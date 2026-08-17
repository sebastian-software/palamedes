import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const assetDir = join(repoRoot, "site/public/icons/streamline/sharp-duo")
const manifest = readFileSync(join(repoRoot, "site/streamline-asset-manifest.md"), "utf8")

const entries = new Map(
  [...manifest.matchAll(/`([^`]+\.svg)`\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*`([a-f0-9]{64})`/gu)].map(
    ([, filename, date, hash]) => [filename, { date, hash }]
  )
)
const actual = readdirSync(assetDir)
  .filter((filename) => filename.endsWith(".svg"))
  .sort()

if (entries.size !== 8 || actual.length !== 8) {
  throw new Error(`expected 8 manifested Sharp Duo icons, got ${entries.size}/${actual.length}`)
}

for (const filename of actual) {
  const entry = entries.get(filename)
  if (!entry) throw new Error(`${filename} is not recorded in the Streamline manifest`)
  const bytes = readFileSync(join(assetDir, filename))
  const hash = createHash("sha256").update(bytes).digest("hex")
  if (hash !== entry.hash) {
    throw new Error(`${filename} hash drifted: manifest ${entry.hash}, actual ${hash}`)
  }
  if (!entry.date) throw new Error(`${filename} is missing its export date`)
}

for (const filename of entries.keys()) {
  if (!actual.includes(filename)) throw new Error(`${filename} is manifested but missing`)
}

const appSources = readdirSync(join(repoRoot, "site/app"), { recursive: true })
  .filter((path) => /\.(ts|tsx)$/u.test(path))
  .map((path) => readFileSync(join(repoRoot, "site/app", path), "utf8"))
  .join("\n")

if (/from\s+["']lucide-react["']/u.test(appSources)) {
  throw new Error("first-party site code still imports the Lucide interim icon set")
}
for (const filename of actual) {
  const slug = basename(filename, ".svg")
  if (!appSources.includes(slug)) throw new Error(`${filename} is committed but unused`)
}

const notices = readFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8")
if (!notices.includes("https://www.streamlinehq.com/") || !notices.includes("not licensed under")) {
  throw new Error("THIRD_PARTY_NOTICES.md is missing the Streamline attribution or MIT exclusion")
}
if (!appSources.includes("Icons by Streamline")) {
  throw new Error("the public site is missing its Streamline attribution link")
}

console.log("verify-site-streamline-assets: 8 licensed, hashed, attributed assets passed")
