# ADR-020: Framework Selection And Locale Switching Are Separate

**Status:** Accepted

## Context

`@palamedes/runtime` exports a plain `getI18n()`. Framework runtime subpaths
wrap it: `@palamedes/react/runtime` subscribes through
`useSyncExternalStore`, while `@palamedes/solid/runtime` reads a signal. These
bridges make inline `t` / `plural` output follow an in-document locale change.

Palamedes 1.9 made a plugin's `framework` option select both the MDX component
contract and the macro runtime. That removed manual module paths, but coupled
two independent decisions. Selecting React implicitly turned every transformed
`getI18n()` call in browser code into a hook, including calls in helpers,
callbacks, and codebases whose locale only changes through a document
navigation.

That default optimized for a comparatively rare operation. Live locale
switching is also a whole-application contract: non-React caches, memoized
formatters, fetched data, and third-party components must all be locale-aware.
Making macro calls reactive cannot guarantee that contract and can create a
misleading partially reactive UI.

Generated MDX still needs a framework component contract for rich messages,
but its direct runtime lookups do not need subscriptions when locale changes
reload the document.

## Decision

Framework selection remains a plugin option:

```ts
palamedes({ framework: "solid" })
```

It selects the React or Solid component contract for generated MDX. It does not
implicitly opt transformed runtime lookups into framework reactivity.

Locale switching is a separate option:

```ts
palamedes({ framework: "react", localeSwitching: "live" })
```

`localeSwitching` has two values:

- `"reload"` is the default and imports the plain `getI18n()` from
  `@palamedes/runtime` for macros and generated MDX runtime access.
- `"live"` imports the selected framework's reactive runtime. It requires
  `framework: "react"` or `framework: "solid"`.

An explicit macro `runtimeModule` remains an advanced escape hatch and wins
over both options. `mdx.runtimeModule` remains the independent MDX override.

Neither choice moves into `palamedes.yaml`. Extraction produces identical
messages for React and Solid, and locale switching is application runtime
policy rather than catalog data.

Framework defaults still differ per plugin:

| Plugin                   | Framework | Locale switching |
| ------------------------ | --------- | ---------------- |
| `@palamedes/vite-plugin` | `react`   | `reload`         |
| `@palamedes/next-plugin` | `react`   | `reload`         |
| `@palamedes/remix`       | `none`    | `reload`         |

## Consequences

The common path is hook-free again. A transformed macro is a normal getter
call and is valid in component helpers, event handlers, route actions, and
other non-hook contexts as long as the runtime has been initialized.

Applications that intentionally preserve the mounted tree across a locale
change must opt in with `localeSwitching: "live"` and keep every
locale-derived cache reactive or keyed by locale. The route examples that
exercise client-side locale navigation make that choice explicit.

Reload-oriented React applications can use
`createReloadClientCatalogBoundary()`. It begins loading the document locale at
client module evaluation, initializes the shared parser-free getter before
descendants hydrate, and rejects a locale prop that differs from the document.
`createClientCatalogBoundary()` remains available for commit-safe live locale
navigation and same-locale catalog revisions.

This changes the plugin default introduced in Palamedes 1.9. Applications that
depended on implicit live macro updates must add `localeSwitching: "live"`.
Applications that never supported live switching lose framework subscriptions
without changing their locale behavior.
