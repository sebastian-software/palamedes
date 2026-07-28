# ADR-020: Framework Selection Lives On The Plugins

**Status:** Accepted

## Context

Two runtime getters exist. `@palamedes/runtime` exports a plain `getI18n()`.
The framework subpaths wrap it: `@palamedes/react/runtime` bridges through
`useSyncExternalStore`, `@palamedes/solid/runtime` through a signal. Both make
inline `t` / `plural` output follow a live locale switch. `<Trans>` and friends
subscribe on their own and never needed either.

The macro transform therefore had a `runtimeModule` option defaulting to the
framework-agnostic `@palamedes/runtime`, and every app that wanted live
switching wrote the subpath by hand — seven of our own examples did.

MDX compilation then arrived with its own framework notion. Generated modules
call `getI18n()` directly for frontmatter, image alt text, and translated
attributes, so they must have the reactive runtime; `mdx.framework` in
`palamedes.yaml` selected it and defaulted to React.

That left two settings that look like one. Briefly the macro `runtimeModule`
was made a fallback for MDX, which put the two defaults in conflict: an app
pinning the macro target to `@palamedes/runtime` — the value our own README
showed — silently downgraded its MDX modules, and a live locale switch stopped
updating translated frontmatter with no error.

## Decision

Framework selection is a single `framework` option on the bundler plugins:

```ts
palamedes({ framework: "solid" })
```

It derives the macro transform's runtime module and seeds the MDX component
contract. `runtimeModule` remains as a narrow override for the macro path only,
and `mdx.framework` remains as a per-config override for MDX only.

It does not move into `palamedes.yaml`. Extraction produces byte-identical
messages for React and Solid — `MdxOptions::extraction_stamp()` deliberately
omits `framework` for exactly this reason — so the catalog config has no reason
to know. Sourcing it from the config would also force `@palamedes/next-plugin`
and `@palamedes/remix` to load a config on their macro path, which they do not
do today, reintroducing the configless-startup coupling we had just removed.

Defaults differ per plugin, because the safe assumption differs:

| Plugin                   | Default | Why                                                 |
| ------------------------ | ------- | --------------------------------------------------- |
| `@palamedes/vite-plugin` | `react` | React and Solid hosts; React is the common case     |
| `@palamedes/next-plugin` | `react` | Next.js is React by construction                    |
| `@palamedes/remix`       | `none`  | Remix 3 ships its own UI layer, no React dependency |

`"none"` selects the framework-agnostic runtime for projects that are neither.

## Consequences

Apps stop naming runtime module paths: all seven examples that did now say
`framework: "solid"` or nothing at all.

React and Next apps become reactive by default. This is a behavior change for
existing projects that relied on the neutral default, and is safe because the
React subpath resolves to a hook-free implementation under the `react-server`
condition.

Solid apps **must** set `framework: "solid"`. Under the previous neutral
default a Solid app that set nothing still worked; under a React default it
would pull React's runtime into the build. `examples/solidstart-cookie` was
exactly that case and is updated in this change.

The cost is one asymmetry: three plugins, two defaults. It is documented at
each option and pinned by tests, and it beats the alternative of either
breaking Remix or making every React app configure what Palamedes already
knows.
