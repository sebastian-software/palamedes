/**
 * Framework selection shared by the bundler plugins.
 *
 * Which UI framework an app uses is a compilation concern, not a catalog one:
 * extracted messages are identical for React and Solid, so `palamedes.yaml`
 * deliberately says nothing about it. The plugins own the choice instead, and
 * derive every framework-dependent default from this single option.
 */

/**
 * UI framework a Palamedes plugin compiles for.
 *
 * `"none"` keeps the framework-agnostic runtime. Inline `t` / `plural` then do
 * not follow a live locale switch — `<Trans>` and friends still do, because
 * they subscribe on their own.
 */
export type PalamedesFramework = "react" | "solid" | "none"

const FRAMEWORK_RUNTIME_MODULES: Record<PalamedesFramework, string> = {
  react: "@palamedes/react/runtime",
  solid: "@palamedes/solid/runtime",
  none: "@palamedes/runtime",
}

/**
 * Resolve the module the macro transform imports the runtime getter from.
 *
 * An explicit `runtimeModule` always wins, so existing configurations keep
 * working unchanged.
 */
export function resolveMacroRuntimeModule(
  framework: PalamedesFramework,
  runtimeModule?: string
): string {
  return runtimeModule ?? FRAMEWORK_RUNTIME_MODULES[framework]
}

/**
 * Framework value to hand to MDX compilation, or `undefined` when the plugin
 * is not compiling for a UI framework and MDX should keep its own default.
 */
export function mdxFrameworkFor(framework: PalamedesFramework): "react" | "solid" | undefined {
  return framework === "none" ? undefined : framework
}
