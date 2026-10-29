# Migrating the application runtime to Palamedes v2

V2 uses compiled messages on server and client, including development. The
package roots and existing `compiled` subpaths share one implementation. This
guide covers the coordinated major transition and its breaking changes.
For an overview of the improvements and their practical impact, read the
[Palamedes 2.0 release notes](./release-notes-v2.md).

Implementation and host verification are recorded in the
[catalog delivery evidence](../benchmarks/catalog-delivery/README.md).

## Check installation and tooling prerequisites

Update coupled Palamedes packages together and regenerate compiled artifacts
with the v2 toolchain. Keep the previous dependency lockfile and generated
artifacts together if you need to roll back to the previous application build;
v1 and v2 catalog artifacts are not interchangeable.

V2 also raises the peer ranges to the tested versions: `@palamedes/vite-plugin`
requires Vite 8, `@palamedes/solid` requires `solid-js@^2.0.0-rc.16`,
`@palamedes/waku` requires `waku@^1.0.0-rc.4`, and `@palamedes/remix` declares
`remix` as a required peer.

Prebuilt npm packages do not require Rust. Check the
[platform support table](./platform-support.md) for the Node.js floor and native
targets; Remix requires Node.js 24.3 or newer. Building from Rust source requires
Rust 1.96 or newer. The CLI now uses Ferralk's native pattern syntax, including
extglobs and POSIX classes; Windows patterns use `/` separators and `\` escapes.
Review [source-pattern migration](./ferralk-adoption.md#pattern-migration) before
running extraction with existing include/exclude patterns.

## Compile catalogs before loading

A v1 application could pass ICU strings directly:

```ts
const i18n = createI18n();
i18n.load("de", { greeting: "Hallo {name}" });
```

A standalone/custom integration now loads the generated module:

```ts
import { createI18n } from "@palamedes/core";
import { messages } from "./generated/de.mjs";

const i18n = createI18n({ locale: "de" });
i18n.load("de", messages);
```

Generate that module with
`pmds catalog compile --target js --output generated`, which writes one
`<locale>.mjs` file per locale. `defineCompiledCatalog()` marks compiled
constants/functions; it does not compile an ICU string map. The standard
framework path delegates loading to its adapter, while locale selection remains
application policy.

## Let the adapter own catalog delivery

The standard framework path is compiled-only from development through
production. Application modules author messages with macros; the host adapter
derives their dependencies, initializes the active locale, and loads the
generated executable catalog before translated code runs. Applications do not
maintain locale-to-catalog maps, serialized ICU payloads, catalog-specific
error boundaries, or import-map/manifest HTML plumbing for this path.

Server adapters use the shared server catalog store: the active locale is
compiled lazily, concurrent requests share one immutable catalog generation,
and request-local i18n state remains isolated. A catalog or formatter failure
propagates to the host's ordinary error handling; it must not be converted to
partially localized success or source-text output. Browser adapters request
only the active document locale and propagate initial and lazy dependency
failures to a catalog-independent error view with the host's recovery action.
Locale changes navigate to a new document so the server selection, `<html
lang>`, and executable browser catalog remain aligned.

Low-level custom integrations may load an explicitly generated
`CompiledCatalogMessages` module. That escape hatch is separate from the
standard host workflow and does not permit marking raw ICU maps with
`defineCompiledCatalog()`.

| Host                        | Standard v2 migration                                                                                        | Delivery contract                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Vite + React/Solid          | Keep macro authoring; remove application catalog maps and legacy runtime imports.                            | Adapter-owned active-locale dependencies; the removed graph-splitting option is rejected.                                          |
| Next.js                     | Keep the default automatic graph delivery; use the public server factory and remove client catalog plumbing. | Graph splitting is automatic; the removed `messageSplitting` option is rejected. Request server catalogs are shared and immutable. |
| Remix                       | Replace serialized client bootstrap and `loadClientMessages` with the shared asset registry.                 | Executable catalog assets/fragments load before translated entries; failures reach ordinary host UI.                               |
| TanStack Start, Waku        | Keep host-specific setup from the checked example and remove raw ICU runtime loading.                        | Use the adapter's request scope and compiled delivery; do not add app-owned catalog transport.                                     |
| React Router Framework Mode | Replace v1 hand-wiring with `@palamedes/react-router`: root middleware plus its server entry.                | The adapter owns request scopes and import-map delivery; the app keeps locale policy. See the [guide](./api/react-router.md).      |

Host-specific guides may expose lower-level hooks for custom servers, but the
checked standard examples are the evidence for the transparent path. Do not
claim a host migration is complete until its initial and lazy failure proof,
locale selection, recovery behavior, and published parser-free artifact check
pass.

### React Router Framework Mode

V2 adds the `@palamedes/react-router` adapter. The v1 examples enabled
`experimentalGraphSplitting: { localeBinding: "import-map" }`, imported every
locale's `.po` catalog into a server map, and read
`palamedes-split-manifest.json` to inject the import map with a hand-written
stream transform. Their `entry.client.tsx` initialized the browser instance
through `setClientI18n()`, and their loaders called the server scope's
`activate()`.

| v1 hand-wiring                                                               | v2 with `@palamedes/react-router`                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `experimentalGraphSplitting` in `palamedes()`                                | Remove the option; `palamedes()` delivers catalogs without it.                                                      |
| Server map of every locale's `.po` catalog, a server scope, a request helper | `createReactRouterI18n({ resolveLocale, i18nOptions })` in `app/lib/i18n.server.ts`; it loads the compiled catalog. |
| `activate()` or a `run()` wrapper in each loader and action                  | `export const middleware = [i18n.middleware]` in `app/root.tsx`; loaders and actions need no wrapper.               |
| Manifest reader and stream transform in `app/entry.server.tsx`               | `export default i18n.handleRequest` in `app/entry.server.tsx`.                                                      |
| `setClientI18n()` in `app/entry.client.tsx`                                  | Remove it; the plugin initializes the browser instance from `<html lang>`.                                          |

Code that already calls `createScopedI18nRunner()` or `createServerI18nScope()`
from `@palamedes/runtime/server` (both public in v1), or the v2 pre-release
`createViteCatalogDelivery()`, keeps working, but the adapter replaces all
three for this host. The
[React Router Framework Mode guide](./api/react-router.md) shows the
complete files.

### Adapter option names

V2 gives the same concept the same option name and shape in every server
adapter. Only the Remix `createI18n` option shipped in v1. The React Router,
TanStack server, Waku delivery, and Solid delivery APIs are new in v2, so the
other old names below matter only for code written against a v2 pre-release.
Renamed JavaScript options throw a migration error that names the
replacement.

| Concept                      | Previous name                                                                                       | V2 name and shape                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request `createI18n` options | TanStack `resolveOptions(request)` (second positional argument); Remix `createI18n: () => instance` | `i18nOptions`: `createI18n` options such as `{ timeZone }`, or `(request, locale) => options`. React Router already used it.                                               |
| TanStack factory arguments   | `createTanStackServerI18nRequestMiddleware(resolveLocale, resolveOptions?, { catalogDelivery })`    | `createTanStackServerI18nRequestMiddleware({ resolveLocale, i18nOptions, catalogDelivery, failureMessage })`, like `createReactRouterI18n()`.                              |
| CSP nonce                    | React Router: resolver only. TanStack, Waku, Solid: `string \| (request) => string`                 | `string \| (request, context) => string \| undefined` everywhere, resolved once per document. React Router, TanStack, and Waku pass their request context; Solid has none. |
| Client build directory       | Required in Waku and Solid                                                                          | Optional everywhere: `build/client` (React Router), `dist/client` (TanStack), `dist/public` (Waku), `.output/public` (Solid), from the working directory.                  |
| Custom manifest name         | React Router and TanStack only                                                                      | `manifestName` on every Vite-based adapter.                                                                                                                                |
| Initialization error message | React Router only                                                                                   | `failureMessage` on every adapter that creates or activates the request instance: React Router, TanStack, Waku's interceptor, and Remix.                                   |

Remix delivers catalogs through its own asset server, so it has no client
directory or manifest name, and `renderClientEntry()` takes the nonce string
for the document it renders. Waku and Solid have no `i18nOptions` because the
application creates the request instance itself, for example with
`createBundledServerI18n({ locale, timeZone })`.

### Stable Remix 3

`@palamedes/remix` 1.25 accepted `remix@^3.0.0-rc.1`, imported `remix/ui`, and
sent browser catalogs as a serialized ICU bootstrap: `loadClientMessages` on
`createRemixI18nServer()`, `renderClientBootstrap(locale)` in the document, and
`initializeRemixClientI18n()` in the browser entry. V2 changes this:

- The peer range is `remix@^3.0.0`; RC.1 and earlier prereleases are no longer
  supported. Replace `remix/ui` with `remix/component` in component, server,
  test, and JSX runtime imports, and in `jsxImportSource`. If the application
  uses component HMR, replace `remix/ui-hmr` with `remix/component-hmr` and
  `uiHmr()` with `componentHmr()`.
- Create one `createPalamedesRemixCatalogAssetRegistry()` and pass it to both
  `createPalamedesRemixAssetLoader({ catalogAssets: registry })` and
  `createRemixI18nServer({ catalogAssets: { registry } })`. With the registry,
  `loadMessages` is optional; remove `loadClientMessages`.
- Serve `registry.serve(request)` and `remixI18n.serveClientCatalogAsset(request)`
  before `assetServer.fetch(request)`.
- In the document, replace `renderClientBootstrap(locale)` with
  `remixI18n.renderClientCatalog(locale)` and
  `await remixI18n.renderClientEntry("app/public/client.tsx", { assetServer })`.
  The adapter's bootstrap initializes the locale, loads its catalog, and then
  imports the entry, so remove `initializeRemixClientI18n()` from the entry.
  Pass `nonce` when the page uses a script CSP.

V2 removes the serialized ICU bootstrap APIs; the
[removed APIs table](#replace-removed-apis) lists their replacements. Keep the
Node hook order (`remix/node-tsx`, then `@palamedes/remix/register`). See the
[Remix API guide](./api/remix.md#client-catalog-assets) and the checked
[Remix cookie example](../examples/remix-cookie).

### React Router RSC

V2 discontinues `@palamedes/react-router-rsc`. React Router's RSC mode is
still experimental upstream (`unstable_reactRouterRSC`,
`unstable_matchRSCServerRequest`, and the 0.x `@vitejs/plugin-rsc`), so
Palamedes no longer ships an adapter for it. The 1.x package stays on npm, but
it gets no further releases and does not work with v2 packages.

Choose one of these paths:

- To keep React Router, move the application to Framework Mode without RSC
  and follow the [React Router Framework Mode guide](./api/react-router.md)
  with the `@palamedes/react-router` adapter described
  [above](#react-router-framework-mode).
- To keep React Server Components, use Next.js with
  [`@palamedes/next-plugin`](./api/next-plugin.md) or Waku with
  [`@palamedes/waku`](./api/waku.md).

## Author rich text and choices with macros

Move direct ICU/choice components to the authoring entrypoint so extraction and
compilation can discover them. For example:

```tsx
// v1: interpreted choice props during rendering
import { Plural } from "@palamedes/react";
```

```tsx
// v2: the framework plugin transforms this into a compiled message lookup
import { Plural, Trans } from "@palamedes/react/macro";

export function Inbox({ count }: { count: number }) {
  return (
    <>
      <Plural value={count} one="# message" other="# messages" />
      <Trans>
        Hello <strong>friend</strong>
      </Trans>
    </>
  );
}
```

Use the corresponding `@palamedes/solid/macro` or `@palamedes/remix/macro`
entrypoint for those renderers. Runtime `Trans` remains the compiler target;
hand-authored raw ICU in its `message` prop is not a runtime fallback.
Dynamic values remain supported, but message text and choices must be
extractable rather than constructed during rendering.

### Literal braces in authored text get new message IDs

Braces in authored text are now literal text. This covers `<Trans>` children,
MDX text, and template literals in `t`, descriptors, and choice branches.
Extraction quotes them in the catalog, so `` t`Use {name}` `` becomes the
`msgid` `Use '{name}'` and renders `Use {name}`. In v1 the same text turned into
an ICU argument that the macro never supplied, so it rendered the wrong value or
threw at runtime.

Messages with literal braces therefore get a new `msgid`. The next
`pmds extract` marks the old entry obsolete and adds the new one, so translate
those entries again. Two related changes move IDs as well:

- A descriptor template such as ``t({ message: `Hello ${name}, {count} new` }, { count })``
  no longer reads `{count}` as an argument. Extraction, `pmds lint`, and the
  transform reject the unused `count` value with the same located error and
  point to the string form. Write raw ICU as a string message instead:
  `t({ message: "Hello {name}, {count} new" }, { name, count })`.
- A doubled apostrophe in authored text (`` t`It''s` ``) is stored in its
  shortest spelling, `It's`. Existing PO entries keep their old spelling and
  their translations.

A literal `<` before a letter, digit, or `/` reads as a rich-text tag, and ICU
quoting cannot escape it. Extraction and the transform now report it with its
source location. Add a space after `<`, pass the text as a placeholder value,
or use inline code in MDX. See
[Quoting and literal text](../packages/core/README.md#quoting-and-literal-text).

## Regenerate messages with repeated expressions

Each call, property read (including getters), or other non-identifier
interpolation now keeps its own placeholder and value. For example,
`` t`Values: ${next()} and ${next()}` `` extracts as `Values: {next} and {next_1}`
and evaluates `next()` twice, from left to right. In v1 both occurrences shared
`{next}`, so `next()` ran once.

A repeated bare identifier such as `${count}` (or `${(count)}`) still shares one
placeholder, as long as no other kind of expression appears between the two
occurrences. Any call, property read, or compound expression in between could
change the variable, so the later occurrence gets its own name. The rule is the
same for `t`, descriptors, choice macros, `<Trans>`, the JSX choice components,
and MDX. These messages get new IDs:

| Source                                                              | v1 message                                       | v2 message                                         |
| ------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| `` t`${user.name} invited ${user.name}` ``                          | `{name} invited {name}`                          | `{name} invited {name_1}`                          |
| `` t`${count} ${user.name} ${count}` ``                             | `{count} {name} {count}`                         | `{count} {name} {count_1}`                         |
| ``plural(items.length, { other: `${items.length} items` })``        | `{length, plural, other {{length} items}}`       | `{length, plural, other {{length_1} items}}`       |
| ``<Plural value={items.length} other={`${items.length} items`} />`` | `{length, plural, other {{length} items}}`       | `{length, plural, other {{length_1} items}}`       |
| ``select(role, { admin: `${user.name}!`, other: `${user.name}` })`` | `{role, select, admin {{name}!} other {{name}}}` | `{role, select, admin {{name}!} other {{name_1}}}` |
| MDX: `Hi {user.name}, bye {user.name}`                              | `Hi {name}, bye {name}`                          | `Hi {name}, bye {name_1}`                          |

Unchanged examples: `` t`${count} of ${count}` `` stays `{count} of {count}`,
and `<Trans>{count} new, <b>{count} unread</b></Trans>` stays
`{count} new, <0>{count} unread</0>`.

Values are evaluated in source order. A choice macro evaluates its value and
then the values of every branch, not only the branch it renders. `<Trans>` and
MDX pass `values` before `components`, so attributes on embedded elements, such
as `href={url()}`, run after every message value.

Run `pmds extract` and rebuild catalogs after upgrading. Review translations for
messages whose placeholder names changed; the previous entry becomes obsolete.
For unbundled Node applications, regenerate the runtime manifest with
`pmds extract --runtime-manifest ./runtime-macros.json` as well. The manifest
format remains version 1. Two `t` calls with the same static text but different
expression shapes, such as `` t`${name} invited ${name}` `` and
`` t`${user.name} invited ${user.name}` ``, now compile to different messages,
so manifest generation reports a `RuntimeMacroCollision` for them. Rename one
placeholder or reword one message.

## Replace removed APIs

Rows marked _v2 pre-release only_ name APIs that v1 never shipped; they matter
only for code written against a v2 pre-release.

| Previous API or option                                                                                                         | V2 replacement                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@palamedes/core/compiled` and framework `compiled` imports                                                                    | Compatible aliases; root imports are also parser-free.                                                                                                                                                                                                                                  |
| `parseMessagePattern()`, `formatMessagePattern()`, `parsePattern()`                                                            | Compile authoring catalogs before application execution; use macros for messages. No optional runtime parser mode exists.                                                                                                                                                               |
| `getMessage()`, `getMessageNodes()`, parsed-node types, `resolveChoice()`                                                      | Use `_()` for text and the framework `Trans` macro for rich text. Use catalog inspection/audit tooling for authoring diagnostics.                                                                                                                                                       |
| `buildChoiceMessage()` and direct runtime `Plural`, `Select`, `SelectOrdinal`                                                  | Use the corresponding macro entrypoint and framework transform.                                                                                                                                                                                                                         |
| `reportError()` and `ReportedMessageError`                                                                                     | Let rendering failures propagate; observe them through `onError`.                                                                                                                                                                                                                       |
| `MessageMetadata.reportMissing`, `renderUncompiledPattern`                                                                     | Removed; metadata only contains diagnostic source identity.                                                                                                                                                                                                                             |
| `keepSourceFallbacks` option and `mdx.keep-source-fallbacks` config key                                                        | Renamed to `includeSourceMetadata` (`mdx.include-source-metadata` in data configs) in the Vite, Next.js, and Remix adapters, the transform, and config. The default changed from `true` to `false`. `true` only adds diagnostic source metadata. The old name throws a migration error. |
| `experimentalGraphSplitting` (Vite, including `{ localeBinding }`), `messageSplitting` (Next.js)                               | Remove the option. Delivery is automatic; any value throws a migration error during plugin setup.                                                                                                                                                                                       |
| `stripMessageField` (transform)                                                                                                | Remove it. Use `includeSourceMetadata` with the inverse value; the default already omits source metadata. Any value throws a migration error.                                                                                                                                           |
| `cwd` (Vite `palamedes()`, Next.js `withPalamedes()`, `loadPalamedesConfig()`, `loadPalamedesConfigSync()`)                    | Renamed to `projectRoot`. Vite defaults it to Vite's resolved `root`; the config loaders default it to the working directory. `cwd` throws a migration error, as it does on the v2 pre-release `createPalamedesRemixCatalogAssetRegistry()`.                                            |
| Relative `configPath` resolved from `cwd` (Vite) or the imported catalog's directory (Remix)                                   | Every adapter resolves a relative `configPath` from `projectRoot`. Absolute paths are unchanged.                                                                                                                                                                                        |
| Adapter `include`/`exclude` as `RegExp` only (Next.js, Remix) or Vite `FilterPattern`                                          | Every adapter accepts a glob string, a RegExp, or an array of both. Relative globs resolve from `projectRoot` (Vite previously used the working directory); RegExps test the absolute file path.                                                                                        |
| `MdxSourceRange` from `@palamedes/core-node`                                                                                   | `SourceRange` from the same package, with the same `start`, `end`, `line`, and `column` fields.                                                                                                                                                                                         |
| Next.js `serverFunctions` (default `false`)                                                                                    | Enabled automatically when one `palamedes.server` module exists in the project root or `src`. `false` opts out; `true` makes a missing module an error.                                                                                                                                 |
| `failOnCompileError`                                                                                                           | Remove it. Invalid/unsupported ICU always fails compilation, and any value throws a migration error. `failOnMissing` remains the separate translation-completeness policy.                                                                                                              |
| `CompiledMessageRuntime.pattern()`                                                                                             | Regenerate v1 catalog artifacts. The compiled renderer interface is internal in v2 and has no `pattern()`.                                                                                                                                                                              |
| `createViteServerI18n()` from `@palamedes/vite-plugin/server` (v2 pre-release only)                                            | `createBundledServerI18n()` from `@palamedes/runtime/server/bundled`; same options (`BundledServerI18nOptions`). The `./server` subpath is removed.                                                                                                                                     |
| `@palamedes/vite-plugin/react-router` subpath (v2 pre-release only)                                                            | `createViteCatalogDelivery()` from `@palamedes/vite-plugin/delivery` (was `createReactRouterCatalogDelivery()`); the `ReactRouter*` types are named `Vite*` there.                                                                                                                      |
| Remix `loadClientMessages`, `createClientBootstrap()`                                                                          | Pass a shared `createPalamedesRemixCatalogAssetRegistry()` as `catalogAssets.registry`; the adapter serves executable catalog assets.                                                                                                                                                   |
| Remix `renderClientBootstrap()`                                                                                                | `remixI18n.renderClientCatalog(locale)` and `await remixI18n.renderClientEntry(entry, { assetServer })` in the document.                                                                                                                                                                |
| Remix `initializeRemixClientI18n()`, `readRemixI18nBootstrap()`                                                                | Remove it; the `renderClientEntry()` bootstrap initializes the browser. Custom hosts use `startRemixClient()` or `initializeRemixClientI18nAsync()`.                                                                                                                                    |
| Remix `REMIX_I18N_BOOTSTRAP_ID`, `RemixI18nBootstrap*` types                                                                   | Removed with the JSON bootstrap. `initializeRemixClientI18nAsync()` takes a `RemixClientDocument` as its `document` option.                                                                                                                                                             |
| TanStack `createTanStackServerI18nRequestMiddleware(resolveLocale, resolveOptions, { catalogDelivery })` (v2 pre-release only) | `createTanStackServerI18nRequestMiddleware({ resolveLocale, i18nOptions, catalogDelivery })`. `i18nOptions` receives `(request, locale)`. Positional arguments and `resolveOptions` throw a migration error.                                                                            |
| Remix `createRemixI18nServer({ createI18n: () => createI18n({ timeZone }) })`                                                  | `i18nOptions: { timeZone }`, or `i18nOptions: (request, locale) => options`, as in React Router and TanStack. The adapter creates the instance. `createI18n` throws a migration error.                                                                                                  |
| Remix `catalogVersion: ({ locale, messages }) => string`                                                                       | Pass a deployment version string, or omit it for the content digest of the delivered asset. The callback throws a migration error.                                                                                                                                                      |
| Remix `remixI18n.createI18n(locale)` (synchronous)                                                                             | Removed. Use `run()` or `middleware()`, which await the active catalog.                                                                                                                                                                                                                 |
| Remix `catalogAssets.config` typed as core-node `CatalogArtifactConfig`                                                        | Typed as `RemixCatalogAssetConfig` from `@palamedes/remix/server`; the accepted shape is unchanged.                                                                                                                                                                                     |
| Remix `run()` and `middleware()` rethrowing locale or catalog errors unchanged                                                 | They throw `failureMessage` (default `Palamedes Remix i18n initialization failed before the handler ran.`) with the original error as `cause`, like the other adapters.                                                                                                                 |
| `I18nInstance` with only `_` and `locale` required (`_()` returned `unknown`)                                                  | Now `PalamedesI18n`: `_()` returns `string`; `load()`, `activate()`, `renderMessage()` and `locale` are required. Use `createI18n()` instances. `setClientI18n()` throws when generated registrations exist and `load()` is missing.                                                    |
| Runtime `Trans` without `id`, or with `message` as the lookup key                                                              | `id` is required on runtime `Trans` props (React, Solid, Remix); `message` is diagnostic metadata only. Author with the `/macro` `Trans`; the transform injects `id`.                                                                                                                   |
| `PALEMEDES_REMIX_ASSET_PACKAGES`                                                                                               | `PALAMEDES_REMIX_ASSET_PACKAGES`.                                                                                                                                                                                                                                                       |
| `registerMessage*()`, `loadRegisteredMessages()`, `initializeClientI18n()` from `@palamedes/runtime`                           | Generated-code plumbing. Moved with `RegisteredMessages` and `RegisteredMessageLoader` to the Internal `@palamedes/runtime/internal` subpath. Supported adapters emit the new import; applications do not call these functions.                                                         |
| `formatMessageArgument()`, `replacePoundPlaceholders()`, `stringifyValue()`, `MessageFormat` (core)                            | Renderer helpers. Moved to the Internal `@palamedes/core/internal` subpath that the React, Solid, and Remix renderers use. Format values through compiled messages.                                                                                                                     |
| `createCompiledMessageRuntime()`, `ExecutableMessageRenderer` from `@palamedes/core` or `/compiled`                            | Moved to the Internal `@palamedes/core/internal` subpath with the other renderer helpers. Render rich text through the framework `Trans` macro; the root keeps `CompiledMessageRuntime` because `renderMessage()` names it.                                                             |
| `PluralProps`, `SelectProps`, `SelectOrdinalProps` from `@palamedes/core`                                                      | Import them from `@palamedes/core/macro`, next to the choice macro prop types.                                                                                                                                                                                                          |
| `createClientCatalogBoundary()` from `@palamedes/react/client`                                                                 | Removed with the subpath. The framework adapter delivers the active-locale catalog and initializes the client runtime; remove the boundary and its `loadCatalog` map.                                                                                                                   |
| Direct imports of the Next.js loader and server-function subpaths                                                              | These subpaths are Internal; `withPalamedes()` wires them into the build. Remove direct imports.                                                                                                                                                                                        |

The existing `CatalogMessages` string-map type can describe build-time data;
`load()` accepts only `CompiledCatalogMessages`. `CompiledPalamedesI18n` aliases
`PalamedesI18n`. Create instances with `createI18n()`. The compiled renderer
interface and the generated catalog format are internal: they change together
with the Palamedes packages, so v2 has no extension point for custom message
runtimes and no parsed-node fallback.

## Replace the lint adapter

`@palamedes/eslint-plugin` is removed from the v2 release set. Remove the package,
its import/plugin registration, and `palamedes/...` rules from ESLint or Oxlint
configuration. Keep the application's other lint rules.

Use the native CLI for Palamedes source checks:

```bash
# Fast feedback after an agent edits these files.
pnpm exec pmds lint src/view.tsx src/actions.ts --json --fail-on warning
# Full configured source check before handoff or in CI.
pnpm exec pmds lint --json --fail-on warning
```

Explicit paths are relative to the invocation directory and bypass catalog
include/exclude patterns. Project configuration still controls rule severity.
The CLI supports MDX, Vue scripts, and Svelte scripts as well as JS/TS/JSX/TSX.
Keep the native CLI and other coupled Palamedes packages on one release.

Replace `eslint-disable-next-line palamedes/<rule>` and
`oxlint-disable-next-line palamedes/<rule>` with
`palamedes-lint-disable-next-line pmds/<rule>`. For same-line exceptions use
`palamedes-lint-disable-line pmds/<rule>`. Preserve unrelated host directives.
Move Palamedes rule severity into the `lint` section of `palamedes.yaml`; host
rule configuration does not transfer automatically. To preserve the former
`configs.recommended` severity settings:

```yaml
lint:
  rules:
    placeholder-only: warning
    empty-component-only: off
    prefer-trans-in-jsx: warning
```

See the
[lint configuration](./configuration.md) and [CLI reference](./cli.md#pmds-lint).
There is no first-party editor adapter or LSP in v2.

## Handle failures through the host

Valid missing translations are resolved at compilation through the fallback
locale chain and ultimately the source message. Variables, rich text and
choices in that compiled fallback behave like translations. `failOnMissing`
can require a translation in the requested locale anyway.

Missing runtime entries are different: `_()` and `Trans` throw
`MissingCompiledMessageError`. Formatter execution errors also throw. Put
ordinary host error handling around the affected route or subtree and render
an error view that does not depend on the failed catalog. Do not display raw
exceptions or diagnostic IDs. Server callers should fail the operation rather
than return partially translated success.

`onMissing` receives `{ id, locale, metadata }`; `onError` receives those
fields plus `error`. They observe failures; returning or throwing from these
hooks cannot convert them into successful message rendering. The removed
`pattern`/`fallback` error fields no longer imply replacement output.

Set the same `timeZone` on server and client. Missing required message values,
invalid numeric/date formatter inputs and malformed compiled branch tables
propagate failures. Compiled literal strings, including empty strings, remain
valid and are never interpreted as ICU.

After migrating the application's authoring and catalog setup, run its
production build and its own tests. Check initial loading, hydration, and a
later navigation that loads new translated modules.
