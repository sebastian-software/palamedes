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

For authoring imports, use:

```ts
import { t } from "@palamedes/core/macro"
```
