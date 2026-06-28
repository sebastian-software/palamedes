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

Transformed code calls `getI18n()`, but the browser runtime was not initialized
before translated UI rendered.

Fix:

Create the i18n instance during app startup and register it once:

```ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

Load and activate the active locale before rendering translated components.

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
  `@palamedes/runtime/server`.
- Create the server scope once at module level.
- Activate the request-local i18n instance before downstream Server Components
  render translated code.
- Keep `@palamedes/runtime/server` out of Client Components and Edge runtime
  code because it uses Node server APIs.

Direct server runtimes can register the getter explicitly:

```ts
import { setServerI18nGetter } from "@palamedes/runtime"

setServerI18nGetter(() => getRequestScopedI18n())
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
- In framework examples, prefer per-locale dynamic imports when only one active
  locale should be loaded into the client bundle.
- Run `pnpm exec pmds extract` after adding new messages so catalogs exist.

## `failOnMissing` Breaks The Build

Error:

```text
Failed to compile catalog for locale de!

Missing N translation(s):
...
```

Cause:

The active catalog is missing translations and the plugin was configured with
`failOnMissing: true`.

Fix:

- Add the missing translations to the locale catalog.
- Run `pnpm exec pmds extract` after changing source messages.
- Run `pnpm exec pmds audit --fail-on error` to inspect catalog diagnostics.
- If the locale is a generated pseudo-locale, set `pseudo-locale` in
  `palamedes.yaml`; plugin integrations skip missing-translation failures
  for that locale.

## `failOnCompileError` Breaks The Build

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
- Keep `failOnCompileError: true` in CI when catalogs are managed in the repo.

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
- Confirm the current platform is supported by the published native package
  list.
- If running in Alpine or another musl Linux environment, use a supported glibc
  image until a musl package is available.

## Translation Exists But Does Not Render

Symptom:

Translated UI renders the original source message or an empty string even
though the target catalog contains a translation.

Cause:

The source was extracted, but the active runtime instance did not load and
activate the compiled catalog for the active locale.

Fix:

- Import the `.po` module for the active locale.
- Call `i18n.load(locale, messages)` with the compiled catalog messages.
- Call `i18n.activate(locale)` before rendering translated UI.
- Check whether the message uses `context`; Palamedes identifies messages by
  `message + context`, so a context mismatch is a different catalog entry.

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
