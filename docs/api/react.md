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

- `createClientCatalogBoundary(options)` for the document-fixed locale

The macro subpath `@palamedes/react/macro` exports compile-time macro
components:

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`

The transform rewrites `Trans` to `@palamedes/react/compiled`. That subpath
exports the compiled-message `Trans` adapter (including the `react-server`
condition) without importing Core's ICU parser. The package root remains the
full runtime-component compatibility surface.

## Runtime Components

Runtime components read the plain active runtime getter. They do not install
external-store subscriptions or update independently after an i18n-instance
replacement; changing locale requires a document navigation.

```tsx
import { Trans } from "@palamedes/react"
;<Trans id="footer" message="Powered by <0>Palamedes</0>" components={{ 0: <strong /> }} />
```

For authoring source strings, prefer macro imports from
`@palamedes/react/macro` so the build can extract and transform messages.

## Choice Components

`Plural`, `Select`, and `SelectOrdinal` take the branch text as props: plural
categories (`zero`, `one`, `two`, `few`, `many`, `other`) and exact matches
spelled `_0`, `_1`, … because a JSX attribute cannot start with `=`. Exact
matches are normalized to ICU `=N`, mirroring the macro transform. `other` is
required.

`Plural` and `SelectOrdinal` also accept `offset`, the ICU `offset:N` of the
synthesized pattern. Use it for "and N others" sentences where the number shown
is smaller than the number counted:

```tsx
<Plural value={attendees} offset={1} _0="nobody else" one="# other" other="# others" />
```

- exact `_N` / `=N` keys match the **raw** value, before the offset is
  subtracted
- plural categories select on `value - offset`
- `#` inside a branch renders `value - offset`

`offset` must be a non-negative safe integer; anything else throws a
`RangeError` rather than rendering a wrong count. `Select` has no numeric
operand and takes no `offset`.

The components render through the active i18n instance, so the synthesized ICU
pattern — including `offset:N` — is the source message a catalog entry can
override.

## Locale Switch Helpers

```ts
import { buildLocaleSwitchItems } from "@palamedes/react"

const items = buildLocaleSwitchItems({
  currentLocale: "de",
  labels: { de: "Deutsch", en: "English" },
  locales: ["en", "de"],
})
```

Initialize the client i18n before hydration when translated client components
render in the initial HTML. Prefer `createClientCatalogBoundary()` for compiled
catalog chunks; it owns the loading boundary and initializes the getter before
translated descendants hydrate.

## Client Catalog Boundaries

For the recommended document-reload model, create a boundary once in a
`"use client"` module:

```tsx
import { createClientCatalogBoundary } from "@palamedes/react/client"

type Locale = "en" | "de"

export const ClientCatalogBoundary = createClientCatalogBoundary<Locale>({
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
  resolveClientLocale: () => {
    const locale = document.documentElement.lang
    if (locale !== "en" && locale !== "de") throw new Error(`Unsupported locale: ${locale}`)
    return locale
  },
})
```

The active locale starts loading when the browser module evaluates. The
boundary suspends until it can initialize the shared parser-free i18n instance,
then renders descendants. Hook-free macro calls therefore have a valid getter
on their first hydration render. A different `locale` prop fails fast because
changing language requires document navigation.

Palamedes does not provide a live alternative. See
[`locale-strategies.md`](../locale-strategies.md#unsupported-root-key-escape-hatch)
for the unsupported root-key pattern and its cache-safety limitations.
