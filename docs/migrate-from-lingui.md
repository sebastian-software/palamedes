# Migration from Lingui to Palamedes

Palamedes is easiest to understand as a cleaner tooling stack for teams that already like Lingui-style authoring.

Most migrations are not about rewriting every translation call. They are about switching framework integration, extraction, and runtime wiring to a stricter end state.

## Who This Migration Is For

Switch now if you want:

- faster transforms and extraction without a Babel-heavy path
- source-string-first catalogs with `message + context` identity
- one runtime model via `getI18n()`
- a cleaner long-term architecture than Lingui's broader historical surface
- the local foundation that managed translation workflows can build on later

Wait if you need:

- maximum compatibility with every older Lingui runtime or authoring path
- explicit author-facing `id` support to remain untouched
- a zero-opinion migration with no cleanup decisions

## Migration Checklist

- [ ] Replace Lingui framework integration with `@palamedes/vite-plugin` or `@palamedes/next-plugin`
- [ ] Add `@palamedes/runtime` and register the active i18n instance
- [ ] Add `palamedes.config.ts`
- [ ] Switch extraction to `pnpm exec pmds extract`
- [ ] Remove explicit authoring `id` usage
- [ ] Verify `.po` loading and runtime translations
- [ ] Verify one source locale and one non-source locale end to end
- [ ] Remove older accessor-specific runtime paths

## Breaking Changes At A Glance

| Topic | Lingui-leaning code | Palamedes target |
| --- | --- | --- |
| Runtime access | Multiple historical access paths | `getI18n()` |
| Message identity | Public API may mix source strings and explicit `id` | `message + context` only |
| Extraction | Lingui CLI / Babel-oriented flows | `pmds extract` |
| Catalog semantics | Historically mixed stack responsibilities | Source-first + `ferrocat` |
| Host integration | Lingui adapters | `@palamedes/vite-plugin` / `@palamedes/next-plugin` |

## What Usually Stays The Same

Most authoring patterns remain familiar:

```ts
import { t, msg, defineMessage, plural, select, selectOrdinal } from "@lingui/core/macro"
```

```tsx
import { Trans, Plural, Select, SelectOrdinal } from "@lingui/react/macro"
```

That continuity is the point. The migration is primarily a tooling and runtime cleanup, not an authoring reset.

It is also the path from "Lingui as the old base" to "Palamedes as the base, with optional managed translation on top later".

## Before / After

### 1. Runtime access

Before:

```ts
// older context-specific runtime access path
```

After:

```ts
import { getI18n } from "@palamedes/runtime"

const locale = getI18n().locale
```

### 2. Explicit IDs

Before:

```ts
t({ id: "checkout.cta", message: "Buy now" })
defineMessage({ id: "checkout.cta", message: "Buy now" })
```

After:

```ts
t({ message: "Buy now" })
defineMessage({ message: "Buy now", context: "checkout button" })
```

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

The [first working translation guide](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md) is the best way to establish that baseline.

### 2. Migrate runtime wiring

Make the active i18n instance available through `@palamedes/runtime`.

Client-side:

```ts
import { i18n } from "@lingui/core"
import { setClientI18n } from "@palamedes/runtime"

setClientI18n(i18n)
```

Server-side:

```ts
import { setServerI18nGetter } from "@palamedes/runtime"

setServerI18nGetter(() => getRequestScopedI18n())
```

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

That moves catalogs onto the source-first path and aligns updates with the current native core and `ferrocat`.

## Common Migration Errors

### “No active client i18n instance”

Cause:
- transformed code is running before `setClientI18n(...)`

Fix:
- register the active client instance during app startup before translated UI renders

### “No active server i18n instance”

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

- transforms and extraction move to a native core
- runtime assumptions get simpler
- catalog identity gets cleaner
- the hot path carries fewer historical branches

That is why the migration is worth doing. The visible authoring surface stays familiar, but the stack under it gets substantially cleaner.

## Next Steps

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Palamedes vs. Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/comparison-with-lingui.md)
- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
