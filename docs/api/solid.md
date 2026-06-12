# `@palamedes/solid`

`@palamedes/solid` mirrors the React package for Solid applications.

## Exports

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`
- `buildLocaleSwitchItems(options)`

The client subpath `@palamedes/solid/client` exports:

- `createClientLocaleEffect(localeAccessor, sync)`

The macro subpath `@palamedes/solid/macro` exports compile-time macro
components:

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`

## Runtime Components

Runtime components read the active i18n instance through
`@palamedes/runtime`.

```tsx
import { Trans } from "@palamedes/solid"
;<Trans id="title" message="Welcome to Palamedes" />
```

For source authoring, prefer macro imports from `@palamedes/solid/macro`.

## Client Locale Effect

```ts
import { createClientLocaleEffect } from "@palamedes/solid/client"

createClientLocaleEffect(() => props.locale, syncClientI18n)
```

The sync function may return a promise. Routing, cookies, and loading UI stay in
the host app.
