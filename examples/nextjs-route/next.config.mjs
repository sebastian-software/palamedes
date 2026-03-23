import path from "node:path"
import { fileURLToPath } from "node:url"
import { withPalamedes } from "@palamedes/next-plugin"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.join(projectRoot, "../..")

const nextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
}

export default withPalamedes(nextConfig)
