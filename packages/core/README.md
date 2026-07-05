# @palamedes/core

Palamedes-owned i18n instance creation and macro entry points.

Use this package when you want the app-facing runtime piece of Palamedes: create
an i18n instance, author messages with macros, and let the surrounding tooling
handle extraction and catalogs.

## Installation

```bash
pnpm add @palamedes/core
```

## Minimal Example

```ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()

setClientI18n(i18n)
```

## Runtime Fallback Hooks

`createI18n` accepts optional hooks for production telemetry. Missing active-locale
catalog entries still render the source message, but `onMissing` lets apps count
them. Malformed runtime patterns fall back to the source message instead of
throwing through the component tree, and `onError` receives the parse/format
failure.

```ts
const i18n = createI18n({
  onMissing({ id, locale }) {
    reportMetric("palamedes.missing", { id, locale })
  },
  onError({ id, locale, error }) {
    captureException(error, { tags: { id, locale } })
  },
})
```

Use `pmds audit --fail-on error` in CI for checked-in catalogs, then wire these
hooks to observe runtime-loaded catalogs or fast-moving translation changes.
`getMessage(id, descriptor)` uses the same missing-catalog lookup path as `_()`,
so `onMissing` also fires when callers ask for a raw pattern by id and the
active catalog does not contain that id.

For authoring imports, use:

```ts
import { t } from "@palamedes/core/macro"
```

The macro entry exports `t`, `msg`, `defineMessage`, `plural`, `select`, and
`selectOrdinal`.

## Locale Controls

Use `@palamedes/core/locale` for framework-agnostic locale resolution and
switch UI data:

```ts
import { defineLocaleControls } from "@palamedes/core/locale"

const localeControls = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
})

const locale = localeControls.preferredLocale(request.headers.get("accept-language"))
```

The subpath also exports `parseAcceptLanguage()`, `buildLocaleSwitchItems()`,
and their related types. React and Solid re-export the switch-item helper for
component packages.

## Runtime Formatting

Palamedes supports the common ICU argument types that product UIs usually need
inside translated sentences:

```ts
i18n._(
  {
    message: "Paid {amount, number, ::currency/EUR} on {when, date, medium} at {when, time, short}",
  },
  {
    amount: 12.3,
    when: new Date(),
  }
)
```

Supported runtime styles:

- `{value, number}` plus `percent`, `integer`, and `::currency/ISO_CODE`
- `{value, date, short|medium|long|full}`
- `{value, time, short|medium|long|full}`

Currency formatting must use the `::currency/ISO_CODE` skeleton form; bare
`currency/ISO_CODE` is outside the supported runtime subset.

Catalog artifact compilation reports unsupported formatter kinds such as `list`,
`duration`, `ago`, and `name` as errors because the runtime does not render
those kinds. Unsupported styles on `number`, `date`, and `time` are warnings:
the runtime falls back to the default `Intl` formatter for that argument type.
