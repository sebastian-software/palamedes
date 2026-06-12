# `@palamedes/core`

`@palamedes/core` owns the app-facing i18n instance and the macro entry point
package names.

## Exports

- `createI18n()`
- `formatMessagePattern(pattern, values, locale?)`
- `parseMessagePattern(pattern)`
- `MessageDescriptor`
- `CatalogMessages`
- `PalamedesI18n`
- `MessageNode`
- `MessageChoiceNode`
- `MessageTagNode`
- `MessageVariableNode`

## `createI18n()`

Creates an in-memory i18n instance.

```ts
import { createI18n } from "@palamedes/core"

const i18n = createI18n()
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
  _(idOrDescriptor, values?, descriptor?): string
  load(locale: string, messages: CatalogMessages): void
  activate(locale: string): void
  getMessage(id: string, descriptor?: MessageDescriptor): string
}
```

`load()` merges messages into the locale catalog. `activate()` selects the
locale used by `_()` and `getMessage()`.

Fallback order for `getMessage(id, descriptor)`:

1. active catalog entry for `id`
2. `descriptor.message`
3. `id`

## `MessageDescriptor`

```ts
interface MessageDescriptor {
  id?: string
  message?: string
  context?: string
  comment?: string
}
```

Palamedes source authoring is source-string-first. Use `context` when the same
source message needs different translations in different UI contexts.

## Macro Entry Point

Macros are imported from `@palamedes/core/macro` and must be compiled by a
Palamedes plugin before runtime.

Supported macro names:

- `t`
- `msg`
- `defineMessage`
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

Catalog artifact compilation reports `list`, `duration`, `ago`, `name`, and
other unsupported formatter kinds as errors. Unsupported styles on `number`,
`date`, and `time` are warnings because the runtime currently falls back to the
default `Intl` formatter for that argument type.
