#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageDir, "../..")
const distCli = resolve(packageDir, "dist/cli.mjs")
const isWorkspacePackage = existsSync(resolve(workspaceRoot, "pnpm-workspace.yaml"))
const workspaceDependencyDists = [
  "@palamedes/config/dist/index.mjs",
  "@palamedes/core-node/dist/index.mjs",
  "@palamedes/extractor/dist/index.mjs",
].map((dependencyDist) => resolve(packageDir, "node_modules", dependencyDist))

const needsWorkspaceBuild =
  isWorkspacePackage &&
  (!existsSync(distCli) ||
    workspaceDependencyDists.some((dependencyDist) => !existsSync(dependencyDist)))

if (!existsSync(distCli) || needsWorkspaceBuild) {
  if (!isWorkspacePackage) {
    console.error(
      "@palamedes/cli is missing dist/cli.mjs. Reinstall the package or report a broken package release.",
    )
    process.exit(1)
  }

  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const buildCommand = ["--dir", workspaceRoot, "--filter", "@palamedes/cli...", "build"]

  // Workspace installs may link the bin before local package builds exist.
  const buildResult = spawnSync(pnpmCommand, buildCommand, {
    cwd: workspaceRoot,
    stdio: "inherit",
  })

  if (buildResult.error) {
    console.error("Failed to build @palamedes/cli before execution.")
    console.error(buildResult.error)
    process.exit(1)
  }

  if (buildResult.status !== 0 || !existsSync(distCli)) {
    process.exit(buildResult.status ?? 1)
  }
}

await import(pathToFileURL(distCli).href)
