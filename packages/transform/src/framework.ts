/**
 * Framework selection shared by the bundler plugins.
 *
 * Which UI framework an app uses is a compilation concern, not a catalog one:
 * extracted messages are identical for React and Solid, so `palamedes.yaml`
 * deliberately says nothing about it. The plugins own the choice instead, and
 * derive framework-dependent component defaults from this single option.
 * Locale switching is separate: most apps keep one locale for the lifetime of
 * a document and should not pay for framework subscriptions in every macro.
 */

/**
 * UI framework a Palamedes plugin compiles for.
 *
 * This selects component and MDX compilation contracts. It does not imply that
 * inline macros subscribe to live locale changes.
 */
export type PalamedesFramework = "react" | "solid" | "none"

/**
 * How an application changes locale in the browser.
 *
 * `"reload"` keeps transformed macro calls hook-free. `"live"` opts into the
 * selected framework's reactive runtime.
 */
export type PalamedesLocaleSwitching = "reload" | "live"

const FRAMEWORK_RUNTIME_MODULES: Record<PalamedesFramework, string> = {
  react: "@palamedes/react/runtime",
  solid: "@palamedes/solid/runtime",
  none: "@palamedes/runtime",
}

/**
 * Resolve the module the macro transform imports the runtime getter from.
 *
 * An explicit `runtimeModule` always wins, preserving advanced custom bindings.
 */
export function resolveMacroRuntimeModule(
  framework: PalamedesFramework,
  runtimeModule?: string,
  localeSwitching: PalamedesLocaleSwitching = "reload"
): string {
  if (runtimeModule) {
    return runtimeModule
  }
  if (localeSwitching === "reload") {
    return FRAMEWORK_RUNTIME_MODULES.none
  }
  if (framework === "none") {
    throw new Error(
      'Palamedes localeSwitching="live" requires framework="react" or framework="solid", unless runtimeModule is set explicitly.'
    )
  }
  return FRAMEWORK_RUNTIME_MODULES[framework]
}

/**
 * Framework value to hand to MDX compilation, or `undefined` when the plugin
 * is not compiling for a UI framework and MDX should keep its own default.
 */
export function mdxFrameworkFor(framework: PalamedesFramework): "react" | "solid" | undefined {
  return framework === "none" ? undefined : framework
}
