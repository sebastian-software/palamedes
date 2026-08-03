import { execFileSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

import { resolvePlatformPackage } from "./platform.mjs"

const packageDir = path.resolve(import.meta.dirname, "..")
const repoRoot = path.resolve(packageDir, "../..")
let platformPackage
try {
  platformPackage = resolvePlatformPackage()
} catch (error) {
  console.warn(
    `${error instanceof Error ? error.message : String(error)} Skipping Palamedes CLI smoke test.`
  )
  process.exit(0)
}
const platformPackageDir = path.join(
  repoRoot,
  "packages",
  platformPackage.replace("@palamedes/", "")
)

execFileSync(process.execPath, [path.join(packageDir, "scripts", "build-native.mjs")], {
  cwd: platformPackageDir,
  stdio: "inherit",
})
execFileSync(process.execPath, [path.join(packageDir, "scripts", "build.mjs")], {
  cwd: packageDir,
  stdio: "inherit",
})
execFileSync("cargo", ["build", "--package", "palamedes-plugin", "--example", "inspect"], {
  cwd: repoRoot,
  stdio: "inherit",
})

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-cli-packed-"))

try {
  // Unpack the same npm tarballs the release job publishes into an isolated
  // node_modules tree. No lifecycle hook runs while constructing this fixture.
  const archiveDir = path.join(fixtureRoot, "archives")
  mkdirSync(archiveDir)
  const cliArchive = packPackage(packageDir, archiveDir)
  const nativeArchive = packPackage(platformPackageDir, archiveDir)
  const cliInstallDir = path.join(fixtureRoot, "node_modules", "@palamedes", "cli")
  const nativeInstallDir = path.join(fixtureRoot, "node_modules", ...platformPackage.split("/"))
  extractPackage(cliArchive, cliInstallDir)
  extractPackage(nativeArchive, nativeInstallDir)

  const installedManifest = JSON.parse(
    readFileSync(path.join(cliInstallDir, "package.json"), "utf8")
  )
  if (Object.hasOwn(installedManifest.scripts ?? {}, "postinstall")) {
    throw new Error("The packed @palamedes/cli package still declares a postinstall script.")
  }

  const copiedSidecar = path.join(
    cliInstallDir,
    "bin",
    process.platform === "win32" ? "pmds-native.exe" : "pmds-native"
  )
  if (existsSync(copiedSidecar)) {
    throw new Error("The packed @palamedes/cli package contains a copied native sidecar.")
  }

  const installedBin = path.join(cliInstallDir, "bin", "pmds")
  const installedCommand = process.platform === "win32" ? process.execPath : installedBin
  const versionArgs = process.platform === "win32" ? [installedBin, "version"] : ["version"]
  const flagArgs = process.platform === "win32" ? [installedBin, "--version"] : ["--version"]
  const versionOutput = execFileSync(installedCommand, versionArgs, {
    cwd: fixtureRoot,
    encoding: "utf8",
  })
  const flagOutput = execFileSync(installedCommand, flagArgs, {
    cwd: fixtureRoot,
    encoding: "utf8",
  })

  if (!versionOutput.includes("pmds (Palamedes)")) {
    throw new Error(`Unexpected packed pmds version output: ${versionOutput}`)
  }
  if (!/^pmds \d/u.test(flagOutput)) {
    throw new Error(`Unexpected packed pmds --version output: ${flagOutput}`)
  }

  const pluginPackageDir = path.join(fixtureRoot, "project", "node_modules", "@fixture", "acme")
  const pluginBinDir = path.join(pluginPackageDir, "bin")
  mkdirSync(pluginBinDir, { recursive: true })
  const pluginBinaryName = process.platform === "win32" ? "acme.exe" : "acme"
  const builtPlugin = path.join(
    repoRoot,
    "target",
    "debug",
    "examples",
    process.platform === "win32" ? "inspect.exe" : "inspect"
  )
  const installedPlugin = path.join(pluginBinDir, pluginBinaryName)
  copyFileSync(builtPlugin, installedPlugin)
  if (process.platform !== "win32") chmodSync(installedPlugin, 0o755)
  writeFileSync(
    path.join(pluginPackageDir, "package.json"),
    `${JSON.stringify({
      name: "@fixture/acme",
      private: true,
      palamedes: { pluginBinary: `./bin/${pluginBinaryName}` },
    })}\n`
  )
  const fixtureConfig = path.join(fixtureRoot, "project", "palamedes.yaml")
  writeFileSync(
    fixtureConfig,
    [
      "locales: [en, de]",
      "source-locale: en",
      "catalogs:",
      "  - path: locales/{locale}/messages",
      "    include: [src]",
      "plugins:",
      '  - ["@fixture/acme", { policy: strict }]',
      "",
    ].join("\n")
  )
  const pluginArgs = ["acme", "inspect", "--config", fixtureConfig, "--json", "smoke"]
  const pluginOutput = execFileSync(
    installedCommand,
    process.platform === "win32" ? [installedBin, ...pluginArgs] : pluginArgs,
    {
      cwd: path.dirname(fixtureConfig),
      encoding: "utf8",
    }
  )
  const pluginResult = JSON.parse(pluginOutput)
  if (!pluginResult.ok || pluginResult.result?.args?.[0] !== "smoke") {
    throw new Error(`Unexpected native pmds plugin output: ${pluginOutput}`)
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

const publicBin = path.join(packageDir, "bin", "pmds")
const command = process.platform === "win32" ? process.execPath : publicBin
const args = process.platform === "win32" ? [publicBin, "version"] : ["version"]
const output = execFileSync(command, args, {
  cwd: packageDir,
  encoding: "utf8",
})
const nativeBin = path.join(
  platformPackageDir,
  "bin",
  process.platform === "win32" ? "pmds.exe" : "pmds"
)
const nativeOutput = execFileSync(nativeBin, ["version"], {
  cwd: packageDir,
  encoding: "utf8",
})

if (!output.includes("pmds (Palamedes)")) {
  throw new Error(`Unexpected pmds version output: ${output}`)
}
if (output !== nativeOutput) {
  throw new Error("The npm wrapper changed built-in version output.")
}

function packPackage(packagePath, archiveDir) {
  const before = new Set(readdirSync(archiveDir))
  const packageManager = process.platform === "win32" ? "npm.cmd" : "npm"
  execFileSync(packageManager, ["pack", "--pack-destination", archiveDir], {
    cwd: packagePath,
    env: { ...process.env, npm_config_cache: path.join(archiveDir, "npm-cache") },
    shell: process.platform === "win32",
    stdio: "pipe",
  })
  const archiveName = readdirSync(archiveDir).find(
    (candidate) => candidate.endsWith(".tgz") && !before.has(candidate)
  )
  if (!archiveName) {
    throw new Error(`Packing ${packagePath} did not produce an archive.`)
  }
  return path.join(archiveDir, archiveName)
}

function extractPackage(archivePath, destination) {
  mkdirSync(destination, { recursive: true })
  execFileSync("tar", ["-xzf", archivePath, "-C", destination, "--strip-components", "1"], {
    stdio: "pipe",
  })
}
