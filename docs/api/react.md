# `@palamedes/react`

`@palamedes/react` provides provider-free React runtime components, macro entry
points, and headless locale-switch helpers.

## Exports

- `Trans`
- `buildLocaleSwitchItems(options)`
- `Fragment`
- `TransProps`
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

The transform rewrites `Trans` to `@palamedes/react/compiled`. In v2, the
package root and the `/compiled` alias resolve to the same parser-free compiled
runtime (including the `react-server` condition). The alias remains useful for
explicit macro targets; it is not a parser-enabled compatibility mode. Hand-
written components that still depend on raw ICU parsing must migrate to compiled
messages.

## Runtime Components

Runtime components read the plain active runtime getter. They do not install
external-store subscriptions or update independently after an i18n-instance
replacement; changing locale requires a document navigation.

```tsx
import { Trans } from "@palamedes/react";
<Trans id="footer" message="Powered by <0>Palamedes</0>" components={{ 0: <strong /> }} />;
```

For authoring source strings, prefer macro imports from
`@palamedes/react/macro` so the build can extract and transform messages.

## Choice macros

`Plural`, `Select`, and `SelectOrdinal` are compile-time components. Import
them from `@palamedes/react/macro`; they are transformed into the parser-free
runtime before the application runs. The package root does not export choice
components or a runtime parser for hand-written choice trees.

Choice macros take branch text as props: plural categories (`zero`, `one`,
`two`, `few`, `many`, `other`) and exact matches spelled `_0`, `_1`, … because
a JSX attribute cannot start with `=`. Exact matches are normalized to ICU
`=N`, mirroring the macro transform. `other` is required.

`Plural` and `SelectOrdinal` also accept `offset`, the ICU `offset:N` of the
synthesized pattern. Use it for "and N others" sentences where the number shown
is smaller than the number counted:

```tsx
import { Plural } from "@palamedes/react/macro";

<Plural value={attendees} offset={1} _0="nobody else" one="# other" other="# others" />;
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
import { buildLocaleSwitchItems } from "@palamedes/react";

const items = buildLocaleSwitchItems({
  currentLocale: "de",
  labels: { de: "Deutsch", en: "English" },
  locales: ["en", "de"],
});
```

Supported host adapters initialize the client runtime and deliver compiled
active-locale dependencies automatically. `createClientCatalogBoundary()` is a
low-level custom React escape hatch for a host that owns an equivalent transport;
it is not required for the standard Vite or Next integration and should not be
used to add an application catalog loader map.

## Client Catalog Boundaries

For a custom React host that owns document reloads and compiled asset delivery,
create a boundary once in a `"use client"` module:

```tsx
import { createI18n } from "@palamedes/core/compiled";
import { createClientCatalogBoundary } from "@palamedes/react/client";

type Locale = "en" | "de";

export const ClientCatalogBoundary = createClientCatalogBoundary<Locale>({
  createI18n: () => createI18n({ timeZone: "Europe/Berlin" }),
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
  resolveClientLocale: () => {
    const locale = document.documentElement.lang;
    if (locale !== "en" && locale !== "de") throw new Error(`Unsupported locale: ${locale}`);
    return locale;
  },
});
```

The optional `createI18n` factory is used for both server rendering and client
hydration. Give the custom host's server factory the same options,
especially `timeZone`, whenever translated markup includes ICU dates or times.

The active locale starts loading when the browser module evaluates. The
boundary suspends until it can initialize the shared parser-free i18n instance,
then renders descendants. Hook-free macro calls therefore have a valid getter
on their first hydration render. A different `locale` prop fails fast because
changing language requires document navigation.

Palamedes does not provide a live alternative. See
[`locale-strategies.md`](../locale-strategies.md#unsupported-root-key-escape-hatch)
for the unsupported root-key pattern and its cache-safety limitations.
