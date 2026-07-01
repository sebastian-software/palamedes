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

The runtime subpath `@palamedes/solid/runtime` exports:

- `getI18n<T>()` — a reactive replacement for `@palamedes/runtime`'s `getI18n`

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

## Reactive Runtime And Live Switching

`Trans`, `Plural`, `Select`, and `SelectOrdinal` track the active client i18n, so
they follow a live (no-reload) locale switch out of the box.

Macro `t` / `plural` calls resolve through whichever `getI18n` the transform is
configured to import. To make them follow a live switch too, point the Palamedes
transform at Solid's reactive runtime:

```ts
// app.config.ts
palamedes({ runtimeModule: "@palamedes/solid/runtime" })
```

Reload-based apps do not need this. See `docs/locale-strategies.md` for the
reload-vs-live tradeoff and why reload is the recommended default.
