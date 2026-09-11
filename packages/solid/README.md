# @palamedes/solid

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fsolid?logo=npm)](https://www.npmjs.com/package/@palamedes/solid)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-0f172a.svg)](https://github.com/sebastian-software/palamedes#license)

Use this package when your Solid app wants translated JSX that feels native to
Solid: the parser-free `Trans` runtime component, compile-time `Plural`,
`Select`, and `SelectOrdinal` macros, plus a small headless helper layer for
locale-aware UI.

Palamedes keeps the runtime model provider-free. Transformed code resolves the
active i18n instance through `getI18n()` from
[`@palamedes/runtime`](https://github.com/sebastian-software/palamedes/tree/main/packages/runtime),
so your Solid app only needs to register the active client or server instance
before translated code runs.

This package is part of the verified Solid story in the example matrix. It
shares the same catalog model, runtime semantics, and Vite plugin path as the
React integrations while swapping only the JSX adapter layer.

The current adapter targets Solid 2, starting with `2.0.0-rc.3`. Solid 1 is no
longer part of the supported surface.

> **Breaking minor release at `1.18.0`:** `@palamedes/solid` moved from Solid 1
> to Solid 2 while Palamedes packages continued their lockstep `1.x` releases.
> A dependency range such as `^1.17.3` can therefore upgrade a Solid 1 app to a
> Solid 2 adapter and lose Solid 1 compatibility. If your app must stay on
> Solid 1, pin `@palamedes/solid` to the last Solid 1-compatible release,
> `1.17.3`, and keep the matching Solid 1 compiler setup. To use a newer
> adapter, migrate the app and its compiler/tooling to Solid 2 first, then use
> `@palamedes/solid` `1.18.0` or newer.

## Install

```bash
pnpm add @palamedes/core @palamedes/solid @palamedes/runtime solid-js@^2.0.0-rc.3
pnpm add -D @palamedes/cli @palamedes/config @palamedes/vite-plugin @solidjs/vite-plugin
```

## Example

```tsx
import { Trans } from "@palamedes/solid/macro";

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

When the Palamedes transform runs, macro imports are rewritten to runtime
imports from `@palamedes/solid/compiled`. In v2, the package root and the
`/compiled` alias share the same parser-free compiled runtime; the alias is an
explicit macro target, not a parser-enabled mode. Rich JSX children are
transformed to numeric component slots in the message, for example
`<0>Palamedes</0>`, while the Solid wrapper is passed separately. Hand-written
components that depend on raw ICU parsing must migrate to compiled messages. Rich component slots use Solid 2
`FlowComponent<{}, Element>` functions and receive their nested content through
`props.children`.

## Runtime and macro entry points

The package root exports the parser-free runtime `Trans` and the headless
locale-switch helpers. Macro-transformed JSX renders through that runtime and
reads the active i18n instance.

`Plural`, `Select`, and `SelectOrdinal` are compile-time components. Import
them from `@palamedes/solid/macro`; the transform lowers them to the parser-free
runtime before the application runs. The package root does not export choice
components or a runtime parser for hand-written choice trees:

```tsx
import { Plural } from "@palamedes/solid/macro";

export function AttendeeCount(props: { count: () => number }) {
  return <Plural value={props.count()} one="# attendee" other="# attendees" />;
}
```

Choice macros accept plural categories (`zero` … `other`), exact matches
written as `_0`/`_1`/… (normalized to ICU `=N`), and `offset`. Invalid option
props and option text with unbalanced braces are rejected during compilation.

`offset` maps to ICU `offset:N` and covers "and N others" sentences, where the
number shown is smaller than the number counted:

```tsx
import { Plural } from "@palamedes/solid/macro";

<Plural value={attendees()} offset={1} _0="nobody else" one="# other" other="# others" />;
```

Exact `_N` keys match the raw value; plural categories select on
`value - offset`, and `#` renders `value - offset`. It must be a non-negative
safe integer. `Select` has no numeric operand and takes no `offset`.

## Headless Frontend Helpers

This package also exposes small Solid-native helpers that stay deliberately
headless:

- `buildLocaleSwitchItems({ locales, currentLocale, labels, testIdPrefix? })`
- `LocaleSwitchItem<TLocale>`

They do not own routing, styling, cookie policy, or server decisions. They only
cover the stable frontend primitives that repeat across apps:

- building render-ready locale switch models for links, buttons, or forms

```tsx
import { buildLocaleSwitchItems } from "@palamedes/solid";

function LocaleToolbar(props: { locale: "en" | "de" }) {
  const items = () =>
    buildLocaleSwitchItems({
      locales: ["en", "de"] as const,
      currentLocale: props.locale,
      labels: { en: "English", de: "Deutsch" },
    });

  return (
    <nav>
      {items().map((item) => (
        <a data-testid={item.testId} href={`/${item.locale}`}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
```

Locale links deliberately navigate the document. Components and macros read the
plain runtime getter and do not subscribe to in-document locale replacement.

## SSR and split catalogs

For SSR applications, configure the Vite plugin with compiled graph delivery
and install `createSolidCatalogDeliveryMiddleware` before the framework's
HTML middleware. It injects the active-locale import map, waits for the
initial catalog fragments before importing the Solid client entry, and leaves
the host's ordinary error UI responsible for lazy route failures:

```ts
import path from "node:path";
import { createSolidCatalogDeliveryMiddleware } from "@palamedes/solid/server";
import { createViteServerI18n } from "@palamedes/vite-plugin/server";

const catalogDelivery = createSolidCatalogDeliveryMiddleware({
  clientDirectory: path.resolve(process.cwd(), ".output/public"),
  resolveLocale: (request) => resolveLocale(request),
  nonce: (request) => serverRequestContext(request).cspNonce,
});

const i18n = await createViteServerI18n({ locale });
return serverI18nScope.run(i18n, () => next());
```

`createViteServerI18n` owns the lazy server catalog store and keeps request
state isolated while sharing compiled catalog content between requests. The
delivery middleware's default initial error document contains only a reload
and home link; pass trusted `errorHtml` when the host needs a different
catalog-free document. Here `serverRequestContext` represents the host's
request-scoped context containing a server-generated nonce; do not derive it
from an arbitrary client-supplied header. The adapter's `nonce` applies only
to its own import map and readiness/bootstrap delivery tags. Solid's
`HydrationScript` and `renderToStream` own framework hydration scripts; pass
the host request nonce to those Solid APIs as well when the document uses a
nonce-based CSP. Avoid
importing `.po` files, the parser, or a catalog virtual module in application
code; author messages with `@palamedes/solid/macro` and
`@palamedes/core/macro` so the compiler emits compiled-only runtime calls.

## Related Docs

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Example matrix](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
- [Proof and benchmarks](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — Rust-native developer tools that keep the APIs the ecosystem already knows.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) · [ferriki](https://github.com/sebastian-software/ferriki) · [ferromark](https://sebastian-software.github.io/ferromark/) · [ferrolex](https://github.com/sebastian-software/ferrolex) · [ferrocat](https://ferrocat.dev) · [ferrovia](https://github.com/sebastian-software/ferrovia) · [ferralk](https://github.com/sebastian-software/ferralk) · [ferrugo](https://github.com/sebastian-software/ferrugo).
<!-- ferramenta-family:end -->

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software
