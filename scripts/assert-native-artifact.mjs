import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const packageDirectory = process.cwd()
const packageJsonPath = path.join(packageDirectory, "package.json")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const artifacts = nativeArtifacts(packageJson)

if (artifacts.length === 0) {
  throw new Error(
    `${packageJson.name ?? packageDirectory} is not a native platform package with a publishable artifact.`
  )
}

const missing = artifacts.filter((artifact) => !isRegularFile(path.join(packageDirectory, artifact)))

if (missing.length > 0) {
  throw new Error(
    `Refusing to publish ${packageJson.name}: missing native artifact(s): ${missing.join(", ")}. ` +
      "Build the package for its target before publishing."
  )
}

console.log(`${packageJson.name}: native artifact guard passed (${artifacts.join(", ")}).`)

export function nativeArtifacts(packageJson) {
  if (typeof packageJson.bin === "object" && packageJson.bin !== null) {
    return Object.values(packageJson.bin).filter((value) => typeof value === "string")
  }

  return typeof packageJson.main === "string" && packageJson.main.endsWith(".node")
    ? [packageJson.main]
    : []
}

function isRegularFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile()
}
