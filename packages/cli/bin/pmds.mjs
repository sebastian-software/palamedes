#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageDir, "../..")
const distCli = resolve(packageDir, "dist/cli.mjs")
const extractorDist = resolve(packageDir, "node_modules/@palamedes/extractor/dist/index.mjs")

if (!existsSync(distCli) || !existsSync(extractorDist)) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const isWorkspacePackage = existsSync(resolve(workspaceRoot, "pnpm-workspace.yaml"))
  const buildCommand = isWorkspacePackage
    ? ["--dir", workspaceRoot, "--filter", "@palamedes/cli...", "build"]
    : ["run", "build"]

  // Workspace installs may link the bin before local package builds exist.
  const buildResult = spawnSync(pnpmCommand, buildCommand, {
    cwd: isWorkspacePackage ? workspaceRoot : packageDir,
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
