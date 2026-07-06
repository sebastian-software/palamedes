---
date: "2026-07-05"
---

# From Lingui to Palamedes without changing how authoring feels

The easiest Palamedes migration story is not "throw away how your team writes
messages."

It is closer to this: keep the familiar macro-shaped authoring model, then move
the machinery underneath to a smaller, stricter foundation.

## What stays familiar

Palamedes keeps messages close to the code. You still write translated UI where
the UI happens:

```tsx
import { Trans } from "@palamedes/react/macro"

export function CheckoutTitle() {
  return <Trans>Checkout</Trans>
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
Next.js, TanStack Start, SolidStart, Waku, and React Router all exercise
different rendering assumptions, but they do not get separate translation
semantics.

## A practical migration path

Start with one app path, not the whole codebase:

1. Add `palamedes.yaml`.
2. Install the scoped Palamedes packages for your framework.
3. Register the active i18n instance through `@palamedes/runtime`.
4. Rewrite one route or component to Palamedes macro imports.
5. Run `pmds extract`.
6. Load one translated `.po` catalog and verify the rendered result.

The full checklist lives in
[`docs/migrate-from-lingui.md`](../../migrate-from-lingui.md), and the shortest
copy-paste baseline is
[`docs/first-working-translation.md`](../../first-working-translation.md).

The migration pitch is intentionally modest: keep the authoring habit, remove
the layers that made the system harder to explain.
