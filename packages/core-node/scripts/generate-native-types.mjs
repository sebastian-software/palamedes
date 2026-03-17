import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(packageDir, "../..")
const outputPath = path.join(packageDir, "src/generated/palamedes-node-types.ts")
const mode = process.argv.includes("--check") ? "check" : "write"

function generateSource() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-napi-types-"))

  try {
    execFileSync("cargo", ["build", "--package", "palamedes-node"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NAPI_TYPE_DEF_TMP_FOLDER: tempRoot,
      },
      stdio: "pipe",
    })

    const typeDefPath = path.join(tempRoot, "palamedes-node")
    const lines = readFileSync(typeDefPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    const interfaces = []
    const methods = []

    for (const entry of lines) {
      if (entry.kind === "interface") {
        const body = String(entry.def)
          .split("\\n")
          .map((line) => `  ${line};`)
          .join("\n")
        interfaces.push(`export interface ${entry.name} {\n${body}\n}`)
        continue
      }

      if (entry.kind === "fn") {
        const match = /^function\s+([^(]+)\((.*)\):\s*(.+)$/.exec(String(entry.def))
        if (!match) {
          throw new Error(`Unsupported function type definition: ${entry.def}`)
        }

        const [, name, args, returnType] = match
        methods.push(`  ${name}(${args}): ${returnType};`)
      }
    }

    return [
      "// This file is generated from crates/palamedes-node via napi-rs typegen.",
      "// Do not edit by hand. Run `pnpm --filter @palamedes/core-node generate-native-types`.",
      "",
      ...interfaces,
      "",
      "export interface NativeBindings {",
      ...methods,
      "}",
      "",
    ].join("\n")
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

const source = generateSource()

if (mode === "check") {
  const existing = readFileSync(outputPath, "utf8")
  if (existing !== source) {
    console.error(
      "Generated native type declarations are out of date. Run `pnpm --filter @palamedes/core-node generate-native-types`."
    )
    process.exit(1)
  }
  process.exit(0)
}

mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, source)
