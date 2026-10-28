# @palamedes/react

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Freact?logo=npm)](https://www.npmjs.com/package/@palamedes/react)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-0f172a.svg)](https://github.com/sebastian-software/palamedes#license)

Provider-free React components, macro entry points, and headless frontend
primitives for Palamedes.

Use this package when your React app wants translated JSX that stays close to
the component, without making translation state another provider tree to manage.

## Installation

```bash
pnpm add @palamedes/core @palamedes/react
```

`@palamedes/core` is a direct runtime dependency of generated catalog modules,
which import `defineCompiledCatalog()` from its `compiled` entrypoint.

## Minimal Example

```tsx
import { Trans } from "@palamedes/react/macro";

export function Footer() {
  return (
    <footer>
      <Trans>
        Powered by <strong>Palamedes</strong>
      </Trans>
    </footer>
  );
}
```

All translated code reads the plain, hook-free `@palamedes/runtime` getter.
Locale changes load a new document; the package does not install React
subscriptions for in-document instance replacement.

Rich JSX children are transformed to numeric component slots in the message, for
example `<0>Palamedes</0>`, while the React component is passed separately.
The transform imports `Trans` from `@palamedes/react/compiled`. In v2, the
package root and the `/compiled` alias share the same parser-free compiled
runtime; the alias is an explicit macro target, not a parser-enabled mode.
Hand-written components that depend on raw ICU parsing must migrate to compiled
messages.

## Runtime and macro entry points

The package root exports the parser-free runtime `Trans`, React's `Fragment`,
and the headless locale-switch helpers. Macro-transformed JSX renders through
that runtime and reads the active i18n instance.

`Plural`, `Select`, and `SelectOrdinal` are compile-time components. Import
them from `@palamedes/react/macro`; the transform lowers them to the parser-free
runtime before the application runs. The package root does not export choice
components or a runtime parser for hand-written choice trees:

```tsx
import { Plural } from "@palamedes/react/macro";

export function AttendeeCount({ count }: { count: number }) {
  return <Plural value={count} one="# attendee" other="# attendees" />;
}
```

Choice macros accept plural categories (`zero` … `other`), exact matches
written as `_0`/`_1`/… (normalized to ICU `=N`), and `offset`. Invalid option
props and option text with unbalanced braces are rejected during compilation.

The package also re-exports React's `Fragment`: the macro transform emits
fragment-wrapped output and resolves `Fragment` from this package so
transformed modules need no extra `react` import.

## Headless Frontend Helpers

This package also exposes small, style-agnostic React helpers that the example
matrix uses directly:

- `buildLocaleSwitchItems({ locales, currentLocale, labels, testIdPrefix? })`
- `LocaleSwitchItem<TLocale>`

These helpers are intentionally headless. They do not own routing, form
submission, styling, or cookie policy. They only cover the stable frontend
primitives that repeat across apps:

- building render-ready locale switch models for buttons, links, or forms

```tsx
import { buildLocaleSwitchItems } from "@palamedes/react";

function LocaleToolbar({ locale }: { locale: "en" | "de" }) {
  const items = buildLocaleSwitchItems({
    locales: ["en", "de"] as const,
    currentLocale: locale,
    labels: { en: "English", de: "Deutsch" },
  });

  return (
    <nav>
      {items.map((item) => (
        <a key={item.locale} data-testid={item.testId} href={`/${item.locale}`}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
```

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — A family of Rust tools.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) — Oniguruma-compatible regex engine · [ferriki](https://github.com/sebastian-software/ferriki) — Shiki-compatible syntax highlighting · [ferromark](https://sebastian-software.github.io/ferromark/) — Markdown to HTML with a secure default and every GFM extension included. · [ferrolex](https://github.com/sebastian-software/ferrolex) — Spell checking for text and code · [ferrocat](https://ferrocat.dev) — Translation catalog engine · [ferrovia](https://github.com/sebastian-software/ferrovia) — SVGO-compatible SVG optimizer · [ferralk](https://github.com/sebastian-software/ferralk) — Glob matching and parallel filesystem walking · [ferrugo](https://github.com/sebastian-software/ferrugo) — PDF previews for untrusted files.
<!-- ferramenta-family:end -->

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software
