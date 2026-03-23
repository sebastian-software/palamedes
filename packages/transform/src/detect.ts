/**
 * Detection utilities to check if a file contains Palamedes macros
 */

import { PALAMEDES_MACRO_PACKAGES } from "./types"
import { walk } from "./ast"

interface ImportInfo {
  localName: string
  importedName: string
  source: string
}

/**
 * Quickly check if code might contain Palamedes macro imports.
 * This is a fast pre-check before parsing to avoid unnecessary work.
 */
export function mightContainPalamedesMacros(code: string): boolean {
  // Quick string check for any of our macro packages
  return PALAMEDES_MACRO_PACKAGES.some((pkg) => code.includes(pkg))
}

/**
 * Find all Palamedes macro imports in an AST
 */
export function findMacroImports(program: unknown): Map<string, ImportInfo> {
  const imports = new Map<string, ImportInfo>()

  walk(program, {
    enter(node) {
      if (!node || typeof node !== "object") {
        return
      }

      const record = node as Record<string, unknown>

      if (record.type !== "ImportDeclaration") {
        return
      }

      const source = (record.source as Record<string, unknown>)?.value as string | undefined

      if (!source || !PALAMEDES_MACRO_PACKAGES.some((pkg) => source === pkg)) {
        return
      }

      const specifiers = record.specifiers as Array<Record<string, unknown>> | undefined

      if (!specifiers) {
        return
      }

      for (const specifier of specifiers) {
        if (specifier.type === "ImportSpecifier") {
          const imported = specifier.imported as Record<string, unknown> | undefined
          const local = specifier.local as Record<string, unknown> | undefined

          const importedName = (imported?.name as string) ?? (local?.name as string)
          const localName = local?.name as string

          if (importedName && localName) {
            imports.set(localName, {
              localName,
              importedName,
              source,
            })
          }
        }
      }
    },
  })

  return imports
}


/**
 * Find the import declaration node for a given source
 */
export function findImportDeclaration(
  program: unknown,
  source: string
): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined

  walk(program, {
    enter(node) {
      if (!node || typeof node !== "object") {
        return
      }

      const record = node as Record<string, unknown>

      if (record.type === "ImportDeclaration") {
        const srcNode = record.source as Record<string, unknown> | undefined
        if (srcNode?.value === source) {
          found = record
          return true // stop walking
        }
      }
    },
  })

  return found
}
