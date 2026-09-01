# @palamedes/core

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcore?logo=npm)](https://www.npmjs.com/package/@palamedes/core)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

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

`createI18n` starts with `DEFAULT_LOCALE` (`"en"`) and accepts an optional
`locale` override plus hooks for production telemetry. The initial locale is
active immediately, including before its catalog is loaded. Missing active-locale
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

Pass `locale` when the instance should start in another locale:

```ts
const i18n = createI18n({ locale: "de" })
```

For server-rendered applications, set `timeZone` to the same IANA identifier on
the server and client. ICU `{when, date}` and `{when, time}` arguments then use
that zone instead of the host process or browser zone, preventing hydration
output from drifting across environments.

```ts
const i18n = createI18n({ locale: "en-US", timeZone: "Europe/Berlin" })
```

Date objects, timestamps, and ISO strings with a time represent instants and are
rendered in `timeZone`. Date-only ISO strings such as `"2026-06-12"` represent
civil calendar dates, so their year, month, and day stay the same in every
configured zone. Invalid or empty zone identifiers throw a `RangeError` while
creating the instance.

Use `pmds audit --fail-on error` in CI for checked-in catalogs, then wire these
hooks to observe runtime-loaded catalogs or fast-moving translation changes.
`getMessage(id, metadata)` uses the same missing-catalog lookup path as `_()`,
so `onMissing` also fires when callers ask for a raw pattern by id and the
active catalog does not contain that id. Since the initial locale is active
immediately, this includes lookups before the first `load()` or `activate()`
call. Apps that use source messages for the default locale without loading its
catalog should account for those events in their telemetry policy.

For authoring imports, use:

```ts
import { t } from "@palamedes/core/macro"
```

The macro entry exports `t`, `plural`, `select`, and `selectOrdinal`.
These eager macros must be used inside a function, method, or callback so they
run after the relevant i18n instance has been activated. The transformer and
extractor reject module-scope usage. Class field initializers do not count as
function scope; use a method or getter instead.

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

`defineLocaleControls` also binds deliberate-choice cookies, canonical URLs, and
suggestion decisions for the cookie, route, subdomain, and tld strategies. Under
the host strategies a locale switch changes the host, so `canonicalUrl()` and
`suggest()` return host-carrying URLs. Those are protocol-relative
(`//host/path`) by default — correct on http locally and https in production —
until the config pins a scheme:

```ts
const localeControls = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
  hosts: { mode: "subdomain" },
  protocol: "https",
})
```

Set `protocol` when the emitted URLs must be absolute, for example in canonical
link tags, `hreflang` alternates, or sitemaps. See
[Locale strategies](https://github.com/sebastian-software/palamedes/blob/main/docs/locale-strategies.md)
and the [core API reference](https://github.com/sebastian-software/palamedes/blob/main/docs/api/core.md#locale-controls).

`defineLocaleControls()` validates its configuration immediately, including a
non-empty unique locale set, the default locale, cookie names, `http`/`https`
protocols, and configured DNS hosts/TLD labels. Locale identifiers only need to
be DNS labels when the `subdomain` or `tld` strategy places them in a host.

## Runtime Formatting

Catalog modules generated by the Palamedes plugins are compiled during the
build. They export one message map: constant translations remain strings, while
dynamic translations are renderer-independent functions. Core, React, and
Solid execute those functions directly without browser ICU parsing or AST
interpretation. Plural/select branches are allocated once when the module
loads, not once per render.

Use the parser-free production entrypoint when the application loads only these
generated catalogs:

```ts
import { createI18n, type CompiledCatalogMessages } from "@palamedes/core/compiled"

declare module "*.po" {
  export const messages: CompiledCatalogMessages
}

const i18n = createI18n()
```

Generated catalog modules, transformed `Trans` components, and compiled MDX
select their matching `compiled` entrypoints automatically. The explicit Core
import above keeps the parser out of the application's own i18n factory too.

Hand-written string catalogs keep the bounded lazy parser and the same
`onError` fallback behavior through `createI18n` from `@palamedes/core`. The
parser-free factory rejects those unbranded catalogs at `load()` so an
accidental compatibility dependency cannot silently enlarge the browser
bundle. Generated catalogs are executable modules rather than JSON data: JSON
serialization intentionally omits their function entries.

The package-root instance also exposes an optional `parsePattern(pattern)`
adapter capability. It parses the argument as a raw ICU pattern without a
catalog lookup; the parser-free factory intentionally omits it.

Palamedes supports the common ICU argument types that product UIs usually need
inside translated sentences:

```ts
i18n._("Paid {amount, number, ::currency/EUR} on {when, date, medium} at {when, time, short}", {
  amount: 12.3,
  when: new Date(),
})
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

### Quoting And Literal Text

Apostrophes in source messages need no escaping. The macros and the extractor
escape them on the way into the catalog, so `t` messages such as `Ada's file`
and `don't panic` simply work. The one exception is a descriptor with a
string-literal `message` — `t({ message: "Hello {name}" })` — which is the
raw-ICU authoring surface: placeholders and ICU quoting are written literally
and nothing is auto-escaped there. The JSX `message` attribute
(`<Trans message="Hello {name}" />`) is that same raw-ICU surface, while
`<Trans>` children are authored text and are escaped.

The rules matter when a translator edits a `.po` file by hand, when a catalog
comes back from a TMS, or when a pattern is passed straight to
`formatMessagePattern()`. Palamedes implements ICU apostrophe quoting in its
lenient form:

- `''` is always a literal apostrophe — `Ada''s` renders `Ada's`.
- A single `'` opens a quoted literal **only** before `{`, `}`, or (inside a
  plural or selectordinal branch, where `#` is syntax) `#`. Text up to the
  closing `'` is literal.
- Everywhere else `'` is just an apostrophe, so `don't` and `l'été` render
  unchanged instead of swallowing the rest of the sentence.
- An unterminated quote auto-closes at the end of the pattern instead of
  throwing.

`'{'` is therefore how a message emits a literal brace:

```ts
i18n._("Write '{'name'}' to insert the user name", {})
// -> "Write {name} to insert the user name"
```

Quoted text is exposed as `MessageLiteralNode` in `getMessageNodes()`, so
custom renderers must handle that node type alongside `text`.

### Plural Offset

`plural` and `selectordinal` support ICU `offset:N` for "and N others"
sentences:

```ts
i18n._("{count, plural, offset:1 =0 {nobody else} one {# other} other {# others}}", { count: 3 })
// -> "2 others"
```

Exact `=N` keys match the raw value; plural categories select on
`value - offset`, and `#` renders `value - offset`. The macro spelling is
`plural(count, { offset: 1, … })`, and the React/Solid components take
`offset={1}`; all three compile to the ICU form above.

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
