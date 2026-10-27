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
- [ ] Confirm the target version supports the compiled adapter contract
- [ ] Let the adapter initialize `@palamedes/runtime` for the selected locale
- [ ] Add `palamedes.yaml`
- [ ] Rewrite Lingui macro imports to Palamedes macro imports
- [ ] Switch extraction to `pnpm exec pmds extract`
- [ ] Map explicit IDs to source text and context in every locale before removing them
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
import { t, plural, select, selectOrdinal } from "@palamedes/core/macro";
```

```tsx
import { Trans, Plural, Select, SelectOrdinal } from "@palamedes/react/macro";
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
import { i18n } from "@lingui/core";

function currentLocale() {
  return i18n.locale;
}
```

After:

```ts
import { getI18n } from "@palamedes/runtime";

function currentLocale() {
  return getI18n().locale;
}
```

Call `getI18n()` inside a function or component, not at module top level — at
import time there is no active i18n instance yet.

### 2. Explicit IDs

Before (Lingui):

```ts
t({ id: "checkout.cta", message: "Buy now" });
defineMessage({ id: "checkout.cta", message: "Buy now" });
```

After:

```ts
function checkoutButtonLabel() {
  return t({ message: "Buy now", context: "checkout button" });
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
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  plugins: [palamedes(), react()],
});
```

After for Next.js:

```js
import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes({});
```

## Recommended Migration Order

### 1. Get one app path working

Do not start by cleaning every edge case in the codebase.

Start by wiring:

- one framework adapter
- one adapter-owned runtime initialization path
- one extraction run
- one translated route or component

Use the [Vite/React first working translation guide](./first-working-translation.md)
or the [Next.js first-run guide](./nextjs-first-run.md) for that baseline. An agent
can use the [repository skill](./agent-skill.md) to inspect the app and follow the
matching setup and migration workflow.

These recipes describe the compiled v2 adapter contract. Check the installed
package exports and matching release documentation before applying them. A
repository manifest version or registry `latest` alone does not establish that
the contract is available; use a compatible release or an explicitly supplied
workspace/preview build. Preserve existing framework versions and locale policy.

### 2. Migrate runtime wiring

For the standard Vite, Next, Remix, Solid, Waku, and React Router paths,
remove app-owned runtime and catalog wiring. The adapter initializes the
parser-free runtime, derives compiled dependencies from translated module use,
and awaits the active locale before the module runs. Do not import locale
catalogs, maintain a locale loader map, or call `load()`/`activate()` from the
application. Locale selection and ordinary host error UI remain host policy.

For an explicit custom integration outside a supported adapter, use the
parser-free `/compiled` API and executable `CompiledCatalogMessages` contract;
raw ICU maps are not a runtime compatibility path. See the
[`@palamedes/core` API reference](./api/core.md#exports).

For Next.js 16 App Router Server Components on the Node runtime, use the
adapter's factory:

```ts
// src/lib/i18n.server.ts
import "server-only";
import { cache } from "react";
import { createNextServerI18n } from "@palamedes/next-plugin/server";
import { resolveLocale } from "./locale.server";

export const createActiveServerI18n = cache(async () =>
  createNextServerI18n({ locale: await resolveLocale() }),
);
```

`resolveLocale()` is the application's existing validated cookie, route,
account, or header policy. It reads the request without writing a preference.
The factory loads the compiled catalog and activates a fresh render-local
instance; the application does not call `load()` or activate an extra scope.

```tsx
// src/app/page.tsx
import { t } from "@palamedes/core/macro";
import { createActiveServerI18n } from "../lib/i18n.server";

function CheckoutTitle() {
  return <h1>{t`Checkout`}</h1>;
}

export default async function Page() {
  await createActiveServerI18n();
  return <CheckoutTitle />;
}
```

Initialize before translated helpers, metadata, or children run. Set document
`lang` from the same policy before Client Component entry evaluation. Server
Functions and Actions have separate request lifetimes: expose
`initializeServerFunctionI18n()` in `src/palamedes.server.ts`, resolve the locale
there, and await `createNextServerI18n({ locale })`. The plugin discovers this
entry; a React render cache does not initialize an action request.

Do not write locale cookies during initialization, render, or read-only actions.
An explicit preference change validates the locale and writes only when its
saved cookie value differs. A fallback locale without a valid cookie is not a
saved preference. Locale switches use full document navigation. Do not disable
unrelated cache revalidation to compensate for unwanted cookie writes.

Custom backend integrations have different ownership. Follow
[Palamedes in backend servers](./backend-servers.md) for request-local storage
and the low-level compiled API rather than adding that plumbing to a supported
framework adapter.

### 3. Remove explicit IDs

This is the most important semantic cleanup.

Palamedes treats:

- `message` as the source string
- `context` as the disambiguator
- `message + context` as the only public identity

Before changing catalog identities, save a recoverable source/catalog snapshot
and inventory each old ID, context, source message, origin, and translation in
every locale. Lingui PO formatter settings affect encoding: generated entries
may already use source text in `msgid`, while explicit entries may use an ID
with `js-lingui-explicit-id` annotations or as the formatter's default. Read the
actual config and source-locale catalog; translated text is not a source message.

Remap each explicit-ID entry to its verified source message and target context
in every locale, preserving translations, translator comments, flags, and
relevant metadata. Compare the migrated extraction identities, including named
placeholders, with this mapping before accepting the change. Framework-generated
annotations and source references can be regenerated; translation content must
survive. The example above changes identity to `Buy now` plus `checkout button`,
so its catalog entries must change with the source code.

If two IDs collapse to one identity, compare all translations. Use meaningful
contexts when the messages must remain distinct. Conflicting translations,
unknown source text, dynamic ID consumers, and external TMS contracts require a
migration decision; retain those entries until it is resolved. Do not silently
merge them or run `--force-clean` to remove the evidence. Update deferred
`msg`/`defineMessage` callers to invoke translation functions, rather than
passing the new function to `i18n._`.

### 4. Switch extraction and catalogs

Run extraction through Palamedes:

```bash
pnpm exec pmds extract
```

Run extraction after identity remapping and source import changes. Compare the
catalog diff with the snapshot and mapping, then extract again to verify
stability. Build and render the source locale and a translated locale, including
plural, interpolation, rich-text, and deferred-label cases. In Next.js, also
check client hydration and actions when the app uses them. Remove unused Lingui
runtime/config/dependencies only after the entire app and its CI/TMS paths have
been checked.

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
[Quoting and literal text](../packages/core/README.md#quoting-and-literal-text).

## Common Migration Errors

### "Catalog dependency failed before translated UI"

Cause:

- the adapter could not load the active locale's compiled fragment, or the
  document locale does not match the host's locale policy

Fix:

- keep the ordinary host error view independent of translated messages and
  offer a full document reload; verify that the adapter config covers the
  translated module and that `<html lang>` is set before the entry runs

Supported adapters initialize the client runtime and derive catalog
dependencies automatically. Do not add `setClientI18n`, direct locale imports,
or an application loader map to recover this failure.

### "No active server i18n instance" in a custom integration

Supported host adapters create the request-local scope and load the active
compiled catalog themselves. An explicit custom server integration must expose
its request-local instance through `@palamedes/runtime`; this is outside the
standard adapter path.

### Extraction works, but translations do not render

Cause:

- the translated source module is outside the configured catalog `include`
  pattern, or its document locale was not selected before entry evaluation

Fix:

- fix the catalog configuration and host locale policy; supported adapters
  derive and await the active compiled fragment before rendering

### Explicit `id` usage now fails

Cause:

- Palamedes no longer supports author-facing explicit IDs as a normal path

Fix:

- map catalog identities to source text and `context`, then remove explicit IDs
- replace deferred descriptors with translation functions and update their callers

## What Gets Better After The Move

- transforms, extraction, catalog updates, and audits move to a native core
- runtime assumptions get simpler
- catalog identity gets cleaner
- the work is easier to reason about when something breaks

That is why the migration is worth doing. The visible authoring surface stays
familiar, but the stack under it gets easier to understand and easier to trust.

## Next Steps

- [Set up or migrate with an agent skill](./agent-skill.md)
- [First working translation in 5 minutes](./first-working-translation.md)
- [Palamedes vs. Lingui](./comparison-with-lingui.md)
- [Proof, benchmarks, and current maturity](./proof-and-benchmarks.md)
