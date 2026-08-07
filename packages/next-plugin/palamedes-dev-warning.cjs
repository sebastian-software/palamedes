"use strict"

const MISSING_ADD_DEPENDENCY_WARNING =
  "Palamedes message splitting cannot watch fallback catalogs or configuration changes because this loader host does not implement addDependency(). Restart the development server after editing those files."
const WARNING_STATE_KEY = Symbol.for("palamedes.nextPlugin.missingAddDependencyWarnings")

function warningTargets() {
  const state = globalThis[WARNING_STATE_KEY]
  if (state) return state

  const targets = new WeakSet()
  globalThis[WARNING_STATE_KEY] = targets
  return targets
}

function warnMissingAddDependency(loaderContext) {
  if (process.env.NODE_ENV === "production" || typeof loaderContext.addDependency === "function") {
    return
  }

  const target =
    loaderContext._compilation && typeof loaderContext._compilation === "object"
      ? loaderContext._compilation
      : globalThis
  const targets = warningTargets()
  if (targets.has(target)) return
  targets.add(target)

  if (typeof loaderContext.emitWarning === "function") {
    loaderContext.emitWarning(new Error(MISSING_ADD_DEPENDENCY_WARNING))
  } else {
    console.warn(MISSING_ADD_DEPENDENCY_WARNING)
  }
}

module.exports = { MISSING_ADD_DEPENDENCY_WARNING, warnMissingAddDependency }
