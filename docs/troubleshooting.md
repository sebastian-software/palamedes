# Troubleshooting

This page collects the setup failures that usually happen before an app has a
stable Palamedes workflow. It is organized by symptom so the exact error string
can lead here.

## Macro Import Runs At Runtime

Error:

```text
The macro you imported from @palamedes/core/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs.
```

or:

```text
The macro you imported from "@palamedes/core/macro" is being executed outside the context of compilation.
```

Cause:

The macro import reached runtime. Palamedes macros are authoring syntax; the
Vite or Next.js plugin must rewrite them before the app executes.

Fix:

- Add `@palamedes/vite-plugin` or `@palamedes/next-plugin` to the app build.
- Keep macro imports static. Do not dynamically import macro packages.
- In Vite, put `palamedes()` in `plugins`.
- In Next.js, wrap the config with `withPalamedes(...)`.

## `getI18n()` Has No Client Instance

Error:

```text
No active client i18n instance. Initialize @palamedes/runtime with setClientI18n() before translated code runs.
```

Cause:

Transformed code calls `getI18n()`, but no client i18n instance was registered
before translated UI rendered.

Fix:

The standard framework adapters register the client instance and load the
active locale's compiled catalog before translated modules run. Application
code does not call `setClientI18n()` on that path.

A custom integration without an adapter registers the instance itself, after
loading a compiled catalog module such as the output of
`pmds catalog compile --target js --output generated`:

```ts
import { createI18n } from "@palamedes/core";
import { setClientI18n } from "@palamedes/runtime";
import { messages } from "./generated/de.mjs";

const i18n = createI18n({ locale: "de" });
i18n.load("de", messages);
setClientI18n(i18n);
```

## `getI18n()` Has No Server Instance

Error:

```text
No active server i18n instance. Configure @palamedes/runtime with setServerI18nGetter() before translated code runs.
```

Cause:

Server-rendered translated code ran before the request-local i18n instance was
available.

Fix:

- For Next.js App Router Server Components, use a server-only module with
  `createNextServerI18nScope()` from `@palamedes/next-plugin/server`.
- Create the server scope once at module level.
- Activate the request-local i18n instance before downstream Server Components
  render translated code.
- Keep both Next and generic server scope subpaths out of Client Components and
  Edge runtime code because they use Node server APIs.

Direct server runtimes can register the getter explicitly:

```ts
import { setServerI18nGetter } from "@palamedes/runtime";

setServerI18nGetter(() => getRequestScopedI18n());
```

## `.po` Import Fails

Symptom:

The app cannot import a `.po` file, or the bundler reports an unknown file type.

Cause:

The Palamedes plugin is not registered, is disabled, or the file is imported in
a build path that does not run through the plugin.

Fix:

- Confirm the app build uses `@palamedes/vite-plugin` or
  `@palamedes/next-plugin`.
- Keep `.po` files under the catalog path configured in `palamedes.yaml`.
- Check whether the import is needed. The standard framework adapters load the
  active locale's compiled catalog themselves; application code does not
  import `.po` files on that path.
- Run `pnpm exec pmds extract` after adding new messages so catalogs exist.

## `failOnMissing` Breaks The Build

Error:

```text
Failed to compile catalog for locale de!

Missing N translation(s):
...
```

Cause:

The active catalog is missing translations, or has entries marked `fuzzy`, and
the plugin was configured with `failOnMissing: true`. Fuzzy entries count as
missing and compile through the fallback chain.

Fix:

- Add the missing translations to the locale catalog.
- Review fuzzy entries and remove their `fuzzy` marker once they are correct.
- Run `pnpm exec pmds extract` after changing source messages.
- Run `pnpm exec pmds audit --fail-on error` to inspect catalog diagnostics.
- If the locale is a generated pseudo-locale, set `pseudo-locale` in
  `palamedes.yaml`; plugin integrations skip missing-translation failures
  for that locale.

## Invalid ICU Breaks The Build

Symptom:

The plugin reports catalog compilation diagnostics for ICU syntax, placeholder,
or metadata problems.

Cause:

The catalog contains a translation that cannot compile safely into a runtime
artifact.

Fix:

- Read the diagnostic for the source message and locale.
- Compare the translated ICU placeholders with the source message.
- Re-run `pnpm exec pmds audit --fail-on error` locally after editing the
  catalog.
- Invalid and unsupported ICU is always fatal in Palamedes v2. No option
  downgrades it to a warning; the removed `failOnCompileError` option is
  rejected (see [Removed v1 Option Is Rejected](#removed-v1-option-is-rejected)).

## Native Binding Fails To Load

Error:

```text
No Palamedes native bindings package is available for platform/arch.
```

or:

```text
Failed to load Palamedes native bindings from @palamedes/core-node-...
```

Cause:

`@palamedes/core-node` could not resolve or load the optional native package for
the current platform.

Fix:

- Confirm the install used a package manager mode that installs optional
  dependencies.
- Reinstall from a clean lockfile if the optional package was pruned.
- Check [Platform support](./platform-support.md) for the published native
  targets, unsupported Node processes, and the matching recovery path.
- If running in Alpine or another musl Linux environment, confirm the package
  manager kept the `linux-x64-musl` optional dependency instead of pruning
  optional packages.

## Translation Exists But Source Text Renders

Symptom:

Translated UI shows the source-locale text even though the target catalog
appears to contain a translation.

Cause:

Missing or empty target translations compile to a fallback: the configured
fallback locales and finally the source message. The page renders without an
error. Either the entry the code uses has no translation, or the page runs a
different locale.

Fix:

- Check whether the message uses `context`; Palamedes identifies messages by
  `message + context`, so a context mismatch is a different catalog entry.
- Check the document's `<html lang>`. Browser catalog delivery loads the
  catalog for that locale.
- Set `failOnMissing: true` in the plugin options to fail the build on a
  missing translation instead of compiling a fallback.

## `MissingCompiledMessageError`

Error:

```text
A required compiled message is unavailable. Reload the application or contact its maintainer.
```

The thrown error's `name` is `MissingCompiledMessageError`.

Cause:

`_()`, `Trans`, or another compiled lookup asked the active i18n instance for a
message ID that no catalog loaded for the active locale contains. V2 has no
runtime fallback to source text. Missing translations do not cause this error;
the compiler already replaced them with a fallback.

Fix:

- Read the error's `id` and `locale` properties. When the plugin option
  `includeSourceMetadata: true` is set, `metadata.message` also contains the
  authored message.
- With a standard framework adapter, make sure the running code and its
  compiled catalogs come from the same build, then reload the document.
- In a custom integration, regenerate the catalog modules after source messages
  change, then call `i18n.load(locale, messages)` and `i18n.activate(locale)`
  before translated code runs.
- Handle the error in the host's ordinary error view, without translated
  messages. `onMissing` observes the failure but cannot replace the output.

## Catalog Fails To Load In The Browser

Symptom:

A translated page shows the host's error view instead of its content. The
Remix default view says "Something went wrong" and offers Reload and Home. In
Vite development, the console reports:

```text
Palamedes catalog dependency failed
```

Cause:

The browser could not load or evaluate the compiled catalog for the document
locale. The adapter stops the modules that depend on it instead of rendering
them without translations. The Vite error keeps the original failure as its
`cause`.

Fix:

- Inspect the failed catalog request in the browser's network panel.
- Check `<html lang>`. The Vite browser entry throws
  `Unsupported document catalog locale.` when it is not a configured locale.
- In Remix, route `registry.serve(request)` and
  `remixI18n.serveClientCatalogAsset(request)` before `assetServer.fetch(request)`.
  Catalog modules are served under `/assets/__palamedes/catalog/<locale>.js` by
  default.
- Offer a full document reload as the recovery action, and keep the error view
  free of translated messages. See the
  [Vite](./api/vite-plugin.md), [Next.js](./api/next-plugin.md), and
  [Remix](./api/remix.md#client-catalog-assets) guides for host error handling.

## Removed v1 Option Is Rejected

Error, depending on the option:

```text
Palamedes v2 removed failOnCompileError: invalid ICU always fails compilation. Remove the option; use failOnMissing for translation completeness.
Palamedes v2 renamed keepSourceFallbacks to includeSourceMetadata: it only adds diagnostic source metadata. Rename the option; the default stays false.
Palamedes v2 removed messageSplitting: compiled catalogs are delivered automatically. Remove the option.
Palamedes v2 removed experimentalGraphSplitting: compiled catalogs are delivered automatically through an import map. Remove the option, including any localeBinding setting.
Palamedes v2 removed the withPalamedes() cwd option. Use projectRoot instead.
```

A config file with the old MDX key reports:

```text
Invalid Palamedes config in <path>: Palamedes v2 renamed mdx.keep-source-fallbacks to mdx.include-source-metadata: it only adds diagnostic source metadata. Rename the key; the default stays false.
```

Cause:

A v1 option is still set. The Vite, Next.js, and Remix adapters, the
low-level transform, and `@palamedes/core-node` reject these options with any
value, including `false`, during setup or on first use. Config loaders and
`pmds` reject the old MDX key in every spelling.

Fix:

| Option                                     | Fix                                                              |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `failOnCompileError`                       | Remove it. Use `failOnMissing` for translation completeness.     |
| `keepSourceFallbacks`                      | Rename it to `includeSourceMetadata`. The default stays `false`. |
| `mdx.keep-source-fallbacks` (config files) | Rename it to `mdx.include-source-metadata`.                      |
| `messageSplitting` (Next.js)               | Remove it. Delivery is automatic.                                |
| `experimentalGraphSplitting` (Vite)        | Remove it, including `{ localeBinding }`. Delivery is automatic. |
| `cwd` (Next.js `withPalamedes()`)          | Rename it to `projectRoot`.                                      |

See the [v2 migration guide](./migration-v2.md#replace-removed-apis).

## Extraction Finds Nothing

Symptom:

`pnpm exec pmds extract` completes with no messages written, or the catalog file
remains empty after extraction.

Cause:

The extractor scans the configured `catalogs[].include` paths and supported
macro imports. Files outside those paths, dynamic macro imports, or plain
strings are not extracted.

Fix:

- Check `palamedes.yaml` and expand `catalogs[].include` if needed.
- Use supported macro imports from `@palamedes/core/macro`,
  `@palamedes/react/macro`, or `@palamedes/solid/macro`.
- Run `pnpm exec pmds extract --clean` after deleting or moving many messages.
- Prefer `context` for disambiguation instead of explicit author-facing IDs.
