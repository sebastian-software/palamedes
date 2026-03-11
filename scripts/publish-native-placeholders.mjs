import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")
const versionArg = process.argv.find((arg) => arg.startsWith("--version="))
const version = versionArg ? versionArg.slice("--version=".length) : "0.0.1"

const packages = [
  {
    name: "@palamedes/core-node-darwin-arm64",
    description: "Bootstrap placeholder for Darwin arm64 native bindings",
    os: ["darwin"],
    cpu: ["arm64"],
  },
  {
    name: "@palamedes/core-node-linux-x64-gnu",
    description: "Bootstrap placeholder for Linux x64 glibc native bindings",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["glibc"],
  },
  {
    name: "@palamedes/core-node-linux-arm64-gnu",
    description: "Bootstrap placeholder for Linux arm64 glibc native bindings",
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["glibc"],
  },
  {
    name: "@palamedes/core-node-win32-x64-msvc",
    description: "Bootstrap placeholder for Windows x64 native bindings",
    os: ["win32"],
    cpu: ["x64"],
  },
]

const tempRoot = path.join(os.tmpdir(), "palamedes-native-bootstrap")
const npmCacheDir = path.join(tempRoot, ".npm-cache")
rmSync(tempRoot, { force: true, recursive: true })
mkdirSync(tempRoot, { recursive: true })
mkdirSync(npmCacheDir, { recursive: true })

for (const pkg of packages) {
  const pkgDir = path.join(tempRoot, pkg.name.replace("@palamedes/", ""))
  mkdirSync(pkgDir, { recursive: true })

  const packageJson = {
    name: pkg.name,
    version,
    description: pkg.description,
    license: "MIT",
    homepage: "https://github.com/sebastian-software/palamedes",
    repository: {
      type: "git",
      url: "git+https://github.com/sebastian-software/palamedes.git",
    },
    publishConfig: {
      access: "public",
    },
    main: "./index.js",
    files: ["README.md", "index.js"],
    os: pkg.os,
    cpu: pkg.cpu,
    ...(pkg.libc ? { libc: pkg.libc } : {}),
  }

  writeFileSync(
    path.join(pkgDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )

  writeFileSync(
    path.join(pkgDir, "README.md"),
    `# ${pkg.name}

Bootstrap placeholder package for Trusted Publisher setup.

This package exists only to reserve the npm package name and configure Trusted Publisher.
The first real native binary release is expected in a later version.
`
  )

  writeFileSync(
    path.join(pkgDir, "index.js"),
    `throw new Error(${JSON.stringify(
      `${pkg.name}@${version} is a bootstrap placeholder. Install a later version with real native binaries.`
    )})\n`
  )

  const command = dryRun
    ? ["pack", "--dry-run", "--json"]
    : ["publish", "--access", "public"]

  console.log(`\n==> ${pkg.name}`)
  console.log(`Directory: ${pkgDir}`)
  console.log(`Command: npm ${command.join(" ")}`)

  const result = spawnSync("npm", command, {
    cwd: pkgDir,
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
    stdio: "inherit",
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(`\nFinished. Placeholder packages were generated in ${tempRoot}`)
