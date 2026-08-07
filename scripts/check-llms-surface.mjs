import { readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { llmsFiles, llmsSurfaceContract } from "./llms-surface-contract.mjs"

export function normalize(text) {
  return text.replaceAll(/\s+/gu, " ").trim()
}

function sectionFor(text, heading) {
  const start = text.indexOf(heading)
  if (start === -1) return ""
  const nextHeading = text.indexOf("\n## ", start + heading.length)
  return text.slice(start, nextHeading === -1 ? undefined : nextHeading)
}

function assertContains(text, expected, label) {
  if (!normalize(text).includes(normalize(expected))) {
    throw new Error(`${label} is missing required surface: ${expected}`)
  }
}

function readManifest(read, manifestPath) {
  try {
    return JSON.parse(read(manifestPath))
  } catch (error) {
    throw new Error(`Could not read published package manifest ${manifestPath}: ${error.message}`, {
      cause: error,
    })
  }
}

function verifyAuthority(read, surface) {
  const { authority } = surface

  if (authority.package) {
    const manifest = readManifest(read, authority.package.manifest)
    if (manifest.private || manifest.name !== authority.package.name) {
      throw new Error(
        `${surface.id}: ${authority.package.manifest} does not publish ${authority.package.name}`
      )
    }
  }

  if (authority.documentation) {
    const documentation = read(authority.documentation.file)
    for (const marker of authority.documentation.markers) {
      assertContains(documentation, marker, `${surface.id}: ${authority.documentation.file}`)
    }
  }

  if (authority.api) {
    const api = read(authority.api.file)
    for (const exportedName of authority.api.exports) {
      assertContains(api, `export function ${exportedName}`, `${surface.id}: ${authority.api.file}`)
    }
  }

  if (authority.cli) {
    const cli = authority.cli
    const documentation = read(cli.documentation)
    const section = sectionFor(documentation, cli.heading)
    if (!section) {
      throw new Error(`${surface.id}: ${cli.documentation} is missing ${cli.heading}`)
    }
    assertContains(section, cli.command, `${surface.id}: ${cli.documentation}`)
    for (const flag of cli.flags) {
      assertContains(section, flag, `${surface.id}: ${cli.documentation}`)
    }

    const implementation = read(cli.implementation)
    for (const marker of cli.implementationMarkers) {
      assertContains(implementation, marker, `${surface.id}: ${cli.implementation}`)
    }
  }
}

function verifyDocuments(read, surface) {
  for (const file of llmsFiles) {
    const document = read(file)
    for (const requiredSurface of surface.documents[file]) {
      assertContains(document, requiredSurface, `${surface.id}: ${file}`)
    }
  }
}

export function checkLlmsSurface({ read } = {}) {
  const readFile = read ?? ((file) => readFileSync(path.join(process.cwd(), file), "utf8"))
  for (const surface of llmsSurfaceContract) {
    verifyAuthority(readFile, surface)
    verifyDocuments(readFile, surface)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    checkLlmsSurface()
    console.log(`LLMS surface is current across ${llmsSurfaceContract.length} contracts.`)
  } catch (error) {
    console.error(`check-llms-surface: ${error.message}`)
    process.exitCode = 1
  }
}
