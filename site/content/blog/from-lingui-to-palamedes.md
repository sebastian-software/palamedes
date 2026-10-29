---
date: "2026-07-05"
excerpt: "A migration story for teams that want familiar macro-shaped authoring while moving the machinery underneath to a stricter source-string-first foundation."
readMinutes: 7
order: 60
title: "From Lingui to Palamedes without changing how authoring feels"
---

# From Lingui to Palamedes without changing how authoring feels

The easiest Palamedes migration story is not "throw away how your team writes
messages."

> **Updated for Palamedes 2.0 (2026-10-29):** In 2.0, the framework adapter
> initializes the runtime and delivers compiled catalogs for the active locale.
> Applications no longer register an i18n instance or load `.po` catalogs
> themselves, so the migration steps below now follow the 2.0 setup. The
> [2.0 release notes](../../../docs/release-notes-v2.md) and the
> [v2 migration guide](../../../docs/migration-v2.md) cover what changed.

It is closer to this: keep the familiar macro-shaped authoring model, then move
the machinery underneath to a smaller, stricter foundation.

## What stays familiar

Palamedes keeps messages close to the code. You still write translated UI where
the UI happens:

```tsx
import { Trans } from "@palamedes/react/macro";

export function CheckoutTitle() {
  return <Trans>Checkout</Trans>;
}
```

The important import change is explicit: Palamedes transforms Palamedes macro
packages, not Lingui macro packages. A migration must rewrite imports such as
`@lingui/core/macro` and `@lingui/react/macro` to the matching
`@palamedes/*/macro` entry points.

## What changes underneath

The cleanup is mostly below the visible authoring layer:

- runtime access centers on `getI18n()`
- source strings and optional context are the public identity
- `pmds extract` owns extraction
- `pmds audit` and `pmds report` make catalog health visible
- the same runtime model works across the verified example matrix

That narrower model is the reason Palamedes can keep framework adapters thin.
Next.js, TanStack Start, Solid, Waku, and React Router all exercise
different rendering assumptions, but they do not get separate translation
semantics.

## A practical migration path

Start with one app path, not the whole codebase:

1. Add `palamedes.yaml`.
2. Install the scoped Palamedes packages and add your framework's adapter, such
   as `@palamedes/vite-plugin` or `@palamedes/next-plugin`.
3. Let the adapter initialize the runtime and deliver catalogs: remove app-owned
   catalog imports, locale loader maps, and `load()` or `activate()` calls.
4. Rewrite one route or component to Palamedes macro imports.
5. Run `pmds extract`.
6. Translate one non-source locale in its `.po` catalog and verify the rendered
   result in the source locale and that locale.

The full checklist lives in
[`docs/migrate-from-lingui.md`](../../../docs/migrate-from-lingui.md), and the shortest
copy-paste baseline is
[`docs/first-working-translation.md`](../../../docs/first-working-translation.md).

The migration pitch is intentionally modest: keep the authoring habit, remove
the layers that made the system harder to explain.
