# Migration from Lingui to Palamedes

Palamedes is easiest to understand as a steadier path for teams that already
like Lingui-style authoring. A migration can preserve familiar macro-style
authoring and existing PO catalogs.

The main changes are typically framework wiring, runtime access,
configuration, extraction, and imports—not a rewrite of every translated
component.

## Who This Migration Is For

Switch now if you want:

- faster transforms and extraction without a Babel-heavy path
- source-string-first catalogs with `message + context` identity
- one runtime model via `getI18n()`
- a calmer long-term foundation than Lingui's broader historical surface
- a repository-owned local workflow that remains useful without a managed service

Wait if you need:

- maximum compatibility with every older Lingui runtime or authoring path
- explicit author-facing `id` support to remain untouched
- a zero-opinion migration with no cleanup decisions

## Migration Checklist

- [ ] Replace Lingui framework integration with `@palamedes/vite-plugin` or `@palamedes/next-plugin`
- [ ] Add `@palamedes/runtime` and register the active i18n instance
- [ ] Add `palamedes.yaml`
- [ ] Rewrite Lingui macro imports to Palamedes macro imports
- [ ] Switch extraction to `pnpm exec pmds extract`
- [ ] Remove explicit authoring `id` usage
- [ ] Verify `.po` loading and runtime translations
- [ ] Verify one source locale and one non-source locale end to end
- [ ] Remove older accessor-specific runtime paths

## Breaking Changes At A Glance

| Topic             | Lingui-leaning code                                 | Palamedes target                                    |
| ----------------- | --------------------------------------------------- | --------------------------------------------------- |
| Runtime access    | Multiple historical access paths                    | `getI18n()`                                         |
| Message identity  | Public API may mix source strings and explicit `id` | `message + context` only                            |
| Extraction        | Lingui CLI / Babel-oriented flows                   | `pmds extract`                                      |
| Catalog semantics | Historically mixed stack responsibilities           | Source-first + `ferrocat`                           |
| Host integration  | Lingui adapters                                     | `@palamedes/vite-plugin` / `@palamedes/next-plugin` |

## What Usually Stays The Same

Most authoring patterns remain familiar, but the import sources must change.
The Palamedes transform recognizes Palamedes macro packages; Lingui macro
imports are left untouched.

```ts
import { t, plural, select, selectOrdinal } from "@palamedes/core/macro"
```

```tsx
import { Trans, Plural, Select, SelectOrdinal } from "@palamedes/react/macro"
```

Palamedes requires eager translation macros to live inside a function, method,
or callback. This applies to `t`, `plural`, `select`, `selectOrdinal`,
`<Plural>`, `<Select>`, and `<SelectOrdinal>` and prevents translation from
running while a module is loaded, before request- or render-local i18n
activation. `<Trans>` can remain at module scope because it resolves when the
component renders. Class field initializers do not satisfy the rule, even for
instance fields; migrate those calls to a method or getter.

That continuity is the point. The migration is primarily a tooling, catalog,
and runtime cleanup, not an authoring reset.

The result is Palamedes as the full local open-source toolchain. Palamedes+ is
planned as an optional managed layer for translation automation and
collaboration; it is not required for the migration or the local workflow.

## Before / After

### 1. Runtime access

Before:

```ts
// older context-specific runtime access path
```

After:

```ts
import { getI18n } from "@palamedes/runtime"

function currentLocale() {
  return getI18n().locale
}
```

Call `getI18n()` inside a function or component, not at module top level — at
import time there is no active i18n instance yet.

### 2. Explicit IDs

Before (Lingui):

```ts
t({ id: "checkout.cta", message: "Buy now" })
defineMessage({ id: "checkout.cta", message: "Buy now" })
```

After:

```ts
function checkoutButtonLabel() {
  return t({ message: "Buy now", context: "checkout button" })
}
```

Palamedes does not expose deferred message descriptors. Move former `msg` or
`defineMessage` declarations into a function or callback and translate with
`t` when the value is actually needed.

### 3. Framework integration

Before:

```ts
// Lingui-specific Vite or Next wiring
```

After for Vite:

```ts
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes()],
})
```

After for Next.js:

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
```

## Recommended Migration Order

### 1. Get one app path working

Do not start by cleaning every edge case in the codebase.

Start by wiring:

- one framework adapter
- one runtime registration path
- one extraction run
- one translated route or component

The [first working translation guide](./first-working-translation.md) is the best way to establish that baseline.

### 2. Migrate runtime wiring

Make the active i18n instance available through `@palamedes/runtime`.

Client-side:

```ts
import { createI18n } from "@palamedes/core/compiled"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

When the app loads generated `.po` catalogs, use the parser-free `/compiled`
entrypoint and its loader type. Keep the package-root factory only for an
intentional runtime-ICU compatibility path; see the
[`@palamedes/core` API reference](./api/core.md#exports).

```ts
// src/po.d.ts
declare module "*.po" {
  import type { CompiledCatalogMessages } from "@palamedes/core/compiled"

  export const messages: CompiledCatalogMessages
}
```

Server-side:

```ts
import { setServerI18nGetter } from "@palamedes/runtime"

setServerI18nGetter(() => getRequestScopedI18n())
```

For Next.js App Router Server Components on the Node runtime, prefer the
Next render-lifetime helper:

```ts
// src/lib/i18n.server.ts
import "server-only"

import { cache } from "react"
import { createNextServerI18nScope } from "@palamedes/next-plugin/server"
import type { PalamedesI18n } from "@palamedes/core"

export const serverI18n = createNextServerI18nScope<PalamedesI18n>()

const loadActiveServerI18n = cache(async () => {
  const locale = await resolveLocaleFromCookiesOrHeaders()
  const i18n = await loadI18n(locale)
  return { i18n, locale }
})

export async function createActiveServerI18n() {
  const active = await loadActiveServerI18n()
  serverI18n.activate(active.i18n)
  return active
}
```

```tsx
// app/page.tsx
import { t } from "@palamedes/core/macro"
import { createActiveServerI18n } from "@/lib/i18n.server"

function CheckoutTitle() {
  return <h1>{t`Checkout`}</h1>
}

export default async function Page() {
  await createActiveServerI18n()
  return <CheckoutTitle />
}
```

This follows the official RSC model: server-only modules prevent accidental
client imports, React `cache()` memoizes setup work within the current request,
and the Next adapter keeps the active instance bound through the RSC and Client
Component server-render passes, including suspension and resumption. Create one
scope at module level, activate a fresh instance per request, and do not register
a global server getter from every Server Component render.

For backend servers outside React frameworks, use the same runtime getter with
request-local storage. The Hono/Express pattern is documented here:

- [Palamedes in backend servers](./backend-servers.md)

### 3. Remove explicit IDs

This is the most important semantic cleanup.

Palamedes treats:

- `message` as the source string
- `context` as the disambiguator
- `message + context` as the only public identity

If your existing codebase still has explicit authoring IDs, remove them deliberately instead of expecting compatibility shims.

### 4. Switch extraction and catalogs

Run extraction through Palamedes:

```bash
pnpm exec pmds extract
```

That moves catalogs onto the source-first path and aligns updates, audits, and
ICU diagnostics with the current native core and `ferrocat`.

Existing translations carried over from Lingui or a TMS keep their ICU quoting.
Doubled apostrophes (`Ada''s`) render as a single `'`, and `'{'` still emits a
literal brace — this used to be a documented divergence in the Palamedes
runtime and is no longer one. Plain apostrophes in prose (`don't`, `client's`,
and `l'été`) stay unchanged in newly extracted PO identities. An apostrophe
immediately before generated ICU syntax is still escaped, so `` t`L'${title}` ``
is stored as `L''{title}` and the placeholder remains live at runtime.

When an existing PO catalog uses the other spelling solely because an older
Palamedes extractor doubled its natural apostrophes, `pmds extract` reuses the
unique matching `(msgid, msgctxt)` entry. Its translation, translator comments,
flags, and machine metadata survive, including with `--force-clean`, and
repeated extraction is stable. Exact identities always win; Palamedes does not
merge ambiguous entries or entries with different contexts. See
[Quoting and literal text](api/core.md#quoting-and-literal-text).

## Common Migration Errors

### "No active client i18n instance"

Cause:

- transformed code is running before `setClientI18n(...)`

Fix:

- register the active client instance during app startup before translated UI renders

### "No active server i18n instance"

Cause:

- server-side translated code runs before `setServerI18nGetter(...)`

Fix:

- expose the request-local i18n instance through `@palamedes/runtime`

### Extraction works, but translations do not render

Cause:

- catalogs exist, but the active locale has not loaded messages into the runtime instance

Fix:

- explicitly load and activate locale messages before rendering

### Explicit `id` usage now fails

Cause:

- Palamedes no longer supports author-facing explicit IDs as a normal path

Fix:

- move to source-string-first descriptors and use `context` when disambiguation is needed

## What Gets Better After The Move

- transforms, extraction, catalog updates, and audits move to a native core
- runtime assumptions get simpler
- catalog identity gets cleaner
- the work is easier to reason about when something breaks

That is why the migration is worth doing. The visible authoring surface stays
familiar, but the stack under it gets easier to understand and easier to trust.

## Next Steps

- [First working translation in 5 minutes](./first-working-translation.md)
- [Palamedes vs. Lingui](./comparison-with-lingui.md)
- [Proof, benchmarks, and current maturity](./proof-and-benchmarks.md)
