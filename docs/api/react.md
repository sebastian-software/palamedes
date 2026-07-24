# `@palamedes/react`

`@palamedes/react` provides provider-free React runtime components, macro entry
points, and headless locale-switch helpers.

## Exports

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`
- `buildLocaleSwitchItems(options)`
- `Fragment`
- `TransProps`
- `PluralProps`
- `SelectProps`
- `SelectOrdinalProps`
- `BuildLocaleSwitchItemsOptions`
- `LocaleSwitchItem`

`Fragment` is re-exported from React for generated/runtime component rendering
paths that need the same import surface as other React helpers.

The locale-switch helper and related types are re-exported from
`@palamedes/core/locale`.

The client subpath `@palamedes/react/client` exports:

- `useClientLocale(locale, sync)`

The runtime subpath `@palamedes/react/runtime` exports:

- `getI18n<T>()` — a React-aware transform target backed by
  `useSyncExternalStore`

The macro subpath `@palamedes/react/macro` exports compile-time macro
components:

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`

## Runtime Components

Runtime components subscribe to the client activation snapshot and read the
active request-local instance during server rendering. They therefore update
independently when nested below `React.memo` components with unchanged props.

```tsx
import { Trans } from "@palamedes/react"
;<Trans id="footer" message="Powered by <0>Palamedes</0>" components={{ 0: <strong /> }} />
```

For authoring source strings, prefer macro imports from
`@palamedes/react/macro` so the build can extract and transform messages.

## Locale Switch Helpers

```ts
import { buildLocaleSwitchItems } from "@palamedes/react"

const items = buildLocaleSwitchItems({
  currentLocale: "de",
  labels: { de: "Deutsch", en: "English" },
  locales: ["en", "de"],
})
```

`useClientLocale(locale, sync)` never calls `sync` during server rendering.
After the client commits, it synchronizes the locale and subscribes to
`setClientI18n()` activations so translated descendants re-render.

Initialize the client i18n before hydration when translated client components
render in the initial HTML. The hook never invokes the sync callback during
render; this avoids external-store mutations during both SSR and client render
retries. The sync function may return a promise; the hook intentionally does
not own loading UI or routing policy.

## Reactive Macro Runtime

Macro `t` / `plural` calls use the transform's configured `runtimeModule`.
Point it at the React runtime when a client-side locale switch must update
memoized translated components:

```ts
palamedes({ runtimeModule: "@palamedes/react/runtime" })
```

The bridge observes the activation revision rather than only object identity, so
mutating and re-activating the same i18n instance still schedules a render. Under
the `react-server` condition, the subpath resolves to the hook-free
`@palamedes/runtime` getter so Server Components and server actions retain
request-local runtime behavior.

The reactive getter is a custom hook. Inline `t` / `plural` macros transformed
to this runtime must execute unconditionally during a function-component or
custom-hook render. For conditional translated output, render a child component
such as `<Trans>` in the branch instead of invoking an inline macro conditionally.
