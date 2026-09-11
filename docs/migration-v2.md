# Migrating the application runtime to Palamedes v2

V2 uses compiled messages on server and client, including development. The
package roots and existing `compiled` subpaths share one implementation. This
is a coordinated major transition; publication remains held while the host
integration slices and final release verification are completed under #1204.
This guide covers the runtime changes in #1206 and the shared migration rules
used by the host slices. Publication remains held until #1215's aggregate
verification proves every supported host's delivery, failure recovery,
published-artifact and release-policy contract.

## Compile catalogs before loading

A v1 application could pass ICU strings directly:

```ts
const i18n = createI18n();
i18n.load("de", { greeting: "Hallo {name}" });
```

A standalone/custom integration now loads the generated module:

```ts
import { createI18n } from "@palamedes/core";
import { messages } from "./generated/de.js";

const i18n = createI18n({ locale: "de" });
i18n.load("de", messages);
```

Generate that module through the existing catalog compiler, CLI or framework
plugin. `defineCompiledCatalog()` marks compiled constants/functions; it does
not compile an ICU string map. The standard framework path delegates loading
to its adapter, while locale selection remains application policy.

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

| Host                                   | Standard v2 migration                                                                         | Delivery contract                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Vite + React/Solid                     | Keep macro authoring; remove application catalog maps and legacy runtime imports.             | Adapter-owned active-locale dependencies and ordinary host error handling.                           |
| Next.js                                | Enable the adapter's compiled client path; migrate server/client setup to generated catalogs. | Optional graph splitting remains adapter-owned; request server catalogs are shared and immutable.    |
| Remix                                  | Replace serialized client bootstrap and `loadClientMessages` with the shared asset registry.  | Executable catalog assets/fragments load before translated entries; failures reach ordinary host UI. |
| TanStack Start, Waku, React Router RSC | Keep host-specific setup from the checked example and remove raw ICU runtime loading.         | Use the adapter's request scope and compiled delivery; do not add app-owned catalog transport.       |

Host-specific guides may expose lower-level hooks for custom servers, but the
checked standard examples are the evidence for the transparent path. Do not
claim a host migration is complete until its initial and lazy failure proof,
locale selection, recovery behavior, and published parser-free artifact check
pass.

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

## Replace removed APIs

| V1 API or option                                                              | V2 replacement                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@palamedes/core/compiled` and framework `compiled` imports                   | Compatible aliases; root imports are also parser-free.                                                                                          |
| `parseMessagePattern()`, `formatMessagePattern()`, `parsePattern()`           | Compile authoring catalogs before application execution; use macros for messages. No optional runtime parser mode exists.                       |
| `getMessage()`, `getMessageNodes()`, parsed-node types, `resolveChoice()`     | Use `_()` for text or `renderMessage()` with the compiled renderer ABI. Use catalog inspection/audit tooling for authoring diagnostics.         |
| `buildChoiceMessage()` and direct runtime `Plural`, `Select`, `SelectOrdinal` | Use the corresponding macro entrypoint and framework transform.                                                                                 |
| `reportError()` and `ReportedMessageError`                                    | Let `renderMessage()` propagate errors; observe through `onError`.                                                                              |
| `MessageMetadata.reportMissing`, `renderUncompiledPattern`                    | Removed; metadata only contains diagnostic source identity.                                                                                     |
| `keepSourceFallbacks`                                                         | Retained legacy spelling for including diagnostic source metadata. Neither value changes runtime failure behavior. `false` omits that metadata. |
| `failOnCompileError`                                                          | Remove it. Invalid/unsupported ICU always fails compilation; `failOnMissing` remains the separate translation-completeness policy.              |
| `CompiledMessageRuntime.pattern()`                                            | Regenerate v1 catalog artifacts. The v2 ABI contains executable operations only.                                                                |

The existing `CatalogMessages` string-map type can describe build-time data;
`load()` accepts only `CompiledCatalogMessages`. `CompiledPalamedesI18n` aliases
`PalamedesI18n`; custom runtimes must provide the required `renderMessage()`
capability. No parsed-node fallback is used for older custom instances.

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

Validate runtime packages with `pnpm check:runtime` after `pnpm build`, and run
the relevant framework tests after migrating the application's authoring and
catalog setup. Initial loading, hydration and later navigation failure recovery
remain part of each host integration's release proof.
