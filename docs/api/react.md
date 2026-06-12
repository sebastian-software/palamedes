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

The client subpath `@palamedes/react/client` exports:

- `useClientLocale(locale, sync)`

The macro subpath `@palamedes/react/macro` exports compile-time macro
components:

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`

## Runtime Components

Runtime components read the active i18n instance through
`@palamedes/runtime`.

```tsx
import { Trans } from "@palamedes/react"

<Trans
  id="footer"
  message="Powered by <0>Palamedes</0>"
  components={{ 0: <strong /> }}
/>
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

`useClientLocale(locale, sync)` calls `sync(locale)` from a client component.
The sync function may return a promise; the hook intentionally does not own
loading UI or routing policy.
