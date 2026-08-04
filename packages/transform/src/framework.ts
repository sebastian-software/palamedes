/**
 * Framework selection shared by the bundler plugins.
 *
 * Which UI framework an app uses is a compilation concern, not a catalog one:
 * extracted messages are identical for React and Solid, so `palamedes.yaml`
 * deliberately says nothing about it. The plugins own the choice instead, and
 * derive framework-dependent component defaults from this single option.
 * Locale is fixed for the lifetime of a document. Macro calls always use the
 * framework-neutral, hook-free runtime getter.
 */

/**
 * UI framework a Palamedes plugin compiles for.
 *
 * This selects component and MDX compilation contracts only.
 */
export type PalamedesFramework = "react" | "solid" | "none"

/**
 * Resolve the module the macro transform imports the runtime getter from.
 *
 * An explicit `runtimeModule` always wins, preserving advanced custom bindings.
 */
export function resolveMacroRuntimeModule(runtimeModule?: string): string {
  return runtimeModule ?? "@palamedes/runtime"
}

/**
 * Framework value to hand to MDX compilation, or `undefined` when the plugin
 * is not compiling for a UI framework and MDX should keep its own default.
 */
export function mdxFrameworkFor(framework: PalamedesFramework): "react" | "solid" | undefined {
  return framework === "none" ? undefined : framework
}
