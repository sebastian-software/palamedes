# Migrating the application runtime to Palamedes v2

V2 uses compiled messages on server and client, including development. The
package roots and existing `compiled` subpaths share one implementation. This
is a coordinated major transition; publication remains held while the host
integration slices and final release verification are completed under #1204.
This guide covers the runtime changes in #1206; host-specific delivery migration
will be completed with their integration slices before release readiness.

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
