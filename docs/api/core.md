# `@palamedes/core`

`@palamedes/core` owns the app-facing i18n instance and the macro entry point
package names.

## Exports

- `createI18n()`
- `formatMessagePattern(pattern, values, locale?)`
- `parseMessagePattern(pattern)`
- `parseAcceptLanguage(header)` from `@palamedes/core/locale`
- `buildLocaleSwitchItems(options)` from `@palamedes/core/locale`
- `defineLocaleControls(config)` from `@palamedes/core/locale`
- `MessageMetadata`
- `CatalogMessages`
- `PalamedesI18n`
- `CreateI18nOptions`
- `MissingMessageInfo`
- `MessageFormatErrorInfo`
- `MessageNode`
- `MessageChoiceNode`
- `MessageFormattedArgumentNode`
- `MessageTagNode`
- `MessageVariableNode`

## `createI18n()`

Creates an in-memory i18n instance. Optional telemetry hooks receive missing
message and runtime formatting failures without changing the source-message
fallback behavior.

```ts
import { createI18n } from "@palamedes/core"

const i18n = createI18n({
  onMissing(info) {
    reportMetric("palamedes.missing", info)
  },
  onError(info) {
    captureException(info.error)
  },
})
i18n.load("de", {
  "Hello {name}": "Hallo {name}",
})
i18n.activate("de")

const label = i18n._("Hello {name}", { name: "Ada" })
```

## `PalamedesI18n`

```ts
interface PalamedesI18n {
  locale?: string
  _(id: string, values?, metadata?): string
  load(locale: string, messages: CatalogMessages): void
  activate(locale: string): void
  getMessage(id: string, metadata?: MessageMetadata): string
}
```

`load()` merges messages into the locale catalog. `activate()` selects the
locale used by `_()` and `getMessage()`.

Fallback order for `getMessage(id, metadata)`:

1. active catalog entry for `id`
2. `metadata.message`
3. `id`

## `MessageMetadata`

```ts
interface MessageMetadata {
  message?: string
  context?: string
  comment?: string
}
```

The compiler emits this metadata alongside compact internal lookup ids so the
runtime can fall back to the source message and report useful diagnostics.
It is not a deferred authoring API. Author translations with `t` at the point
where they are evaluated.

## Locale Controls

`@palamedes/core/locale` exposes headless locale helpers used by the example
matrix and reusable in apps:

- `parseAcceptLanguage(header)`: parses and quality-sorts `Accept-Language`
  tags, including base-language fallbacks.
- `buildLocaleSwitchItems(options)`: builds UI-agnostic switch items with
  labels, active state, locale, and test ids.
- `defineLocaleControls(config)`: binds locale resolution, deliberate-choice
  cookies, canonical URLs, and suggestion decisions for cookie, route,
  subdomain, and tld strategies.

## Macro Entry Point

Macros are imported from `@palamedes/core/macro` and must be compiled by a
Palamedes plugin before runtime.

Supported macro names:

- `t`
- `plural`
- `select`
- `selectOrdinal`

## Runtime Formatting

`formatMessagePattern()` and `createI18n()._()` support the formatter subset
implemented by the Palamedes runtime:

- `{value, number}`
- `{value, number, percent}` and `{value, number, integer}`
- `{value, number, ::percent}`, `{value, number, ::integer}`, and
  `{value, number, ::currency/ISO}`
- `{value, date}` and `{value, time}`
- `{value, date, short|medium|long|full}`
- `{value, time, short|medium|long|full}`

Currency formatting must use the `::currency/ISO` skeleton form; bare
`currency/ISO` is outside the supported runtime subset.

Catalog artifact compilation reports `list`, `duration`, `ago`, `name`, and
other unsupported formatter kinds as errors. Unsupported styles on `number`,
`date`, and `time` are warnings because the runtime currently falls back to the
default `Intl` formatter for that argument type.
