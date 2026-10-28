# `@palamedes/core-node`

`@palamedes/core-node` is the JavaScript wrapper around the native Palamedes
core. Most apps use it indirectly through the CLI and plugins.

## Runtime Exports

- `getNativeInfo()`
- `parsePo(source)`
- `parseCatalog(request)`
- `updateCatalogFile(request)`
- `updateCatalogFileAsync(request, options?: AsyncTaskOptions)`
- `listTranslationCandidates(request)`
- `applyTranslationPatches(request)`
- `applyTranslationPatchesAsync(request, options?: AsyncTaskOptions)`
- `isTranslationPatchWriteError(error)`
- `auditCatalogs(config, options?)`
- `checkTranslationTargets(request)`
- `inspectCatalogMachineTranslations(config, options?)`
- `inspectCatalogMachineTranslationsAsync(config, options?, taskOptions?: AsyncTaskOptions)`
- `deriveMessageMetadata(message, context?)`
- `normalizeMessageMetadata(input)`
- `validateMessageMetadata(input)`
- `combineCatalogs(request)`
- `combineCatalogFiles(request)`
- `mergeCatalogsThreeWay(request)`
- `mergeCatalogFilesThreeWay(request)`
- `compileCatalogArtifact(config, resourcePath)`
- `compileCatalogArtifactAsync(config, resourcePath, options?: AsyncTaskOptions)`
- `compileCatalogArtifactSelected(config, resourcePath, compiledIds)`
- `compileCatalogArtifactSelectedAsync(config, resourcePath, compiledIds, options?: AsyncTaskOptions)`
- `compileCatalogModule(config, resourcePath, options)`
- `compileCatalogModuleAsync(config, resourcePath, options, taskOptions?: AsyncTaskOptions)`
- `renderCatalogModule(messages)`
- `extractMessagesNative(source, filename, mdxOptions?)`
- `analyzeSourceNative(source, filename, options?)`
- `analyzeMdxNative(source, filename, options?)`
- `extractCatalogMessagesFromFiles(request)`
- `extractCatalogMessagesFromFilesAsync(request, options?: AsyncTaskOptions)`
- `transformMacrosNative(source, filename, options?)`
- `assertNoRemovedPalamedesOptions(options, names)`
- `REMOVED_PALAMEDES_OPTION_MESSAGES`
- `AsyncTaskOptions`

`analyzeMdxNative` returns messages, structured diagnostics, generated
framework JSX, compiled message IDs, and a native source map from one semantic
analysis pass. See [MDX messages](../mdx.md).

`compileCatalogArtifact()` and `compileCatalogArtifactSelected()` include
runtime formatter diagnostics in their `diagnostics` arrays. Unsupported
formatter kinds such as `list`, `duration`, `ago`, and `name`, plus unsupported
styles on supported `number`, `date`, and `time` formatters, are errors.
The full API validates every message in the resolved catalog set. The selected
API validates only the requested compiled IDs; use the full API or
`auditCatalogs` for a whole-catalog audit. Artifact APIs retain structured
diagnostics for inspection, while module APIs reject an artifact containing an
error diagnostic.

`compileCatalogModule(config, resourcePath, options)` renders the compiled
catalog artifact as a JavaScript module. The locale is resolved from the
configured catalog path pattern. A matching storage suffix in a pattern such
as `{locale}/messages.po` is accepted without duplication, while logical dotted
names such as `{locale}/messages.v2` resolve to `{locale}/messages.v2.po`;
the caller-supplied `options.locale` is only a fallback when resolution is
unavailable, and the result reports the effective locale as `locale`. The
first-party Vite, Next, and Remix integrations use this function for `.po`
imports.

For event-loop-sensitive integrations, use the additive `Async` variants of
catalog update, translation patch, machine-metadata inspection, catalog artifact/module compilation, and
file extraction. Each call moves one owned operation to Node's shared libuv
worker pool and returns the same result or error shape in a promise. Vite and
Next await these APIs in their asynchronous plugin hooks. Remix's synchronous
module hook continues to use `compileCatalogModule()`.

Each async API accepts an optional task-options object with an `AbortSignal`:

```ts
await updateCatalogFileAsync(request, { signal: controller.signal });
```

If the signal is already aborted, the call rejects before it is scheduled. If
the native task is still waiting for a libuv worker, aborting the signal rejects
it with an `AbortError`. Native work that has already started runs to completion;
the signal does not interrupt the native operation. Bound concurrency in the
caller for bulk work; do not launch an unbounded promise fan-out. The pool is
shared with other Node filesystem and native work, and `UV_THREADPOOL_SIZE` is
the process-level pool control.

Concurrent `compileCatalogArtifactSelectedAsync()` calls that target the same
catalog and configuration are coordinated in JavaScript. Only the first cold
build enters the worker pool; concurrent followers wait for it, then use the
warmed native cache. If the first build fails, waiting callers retry one at a
time so cancellation or a selected-ID compilation error from one caller does
not reject another. Different catalogs remain concurrent.

This build coordination is process-wide. The CommonJS and ESM entry points,
and multiple copies of the package, share one coordinator through a
`globalThis` holder. The synchronous `compileCatalogArtifactSelected()` API
uses ready native cache entries, but if a matching async build is in flight it
compiles its request independently. This can duplicate cold-build work, but it
never waits on an in-flight worker-pool build or parks the Node.js event loop.
Event-loop-sensitive integrations should still use the async API for
concurrent builds.

Async catalog mutations targeting the same resolved file are serialized
process-wide, including calls across the CommonJS and ESM entry points and
across `updateCatalogFileAsync()` and `applyTranslationPatchesAsync()`.
Mutations of different files can still run concurrently. Separate Node.js
processes and concurrent synchronous mutations must coordinate access
themselves.

`renderCatalogModule(messages)` exposes the same native module generator for
custom integrations that already have a compiled message map. The TypeScript
compatibility helper delegates to this function; there is no second ICU parser
or code generator.

`listTranslationCandidates()` and `applyTranslationPatches()` form the native
translation-review workflow. Patches reject the same ICU compatibility errors
as `auditCatalogs()`, while allowing compatible target-language plural
categories. A failed catalog write can still include completed
per-file outcomes: identify that error with `isTranslationPatchWriteError()`
and read its `report`. See [Translation candidate patches](../translation-candidate-patches.md).

## Review proposed or stored target text

`checkTranslationTargets()` runs optional local review checks before writeback.
It accepts the same `TranslationValue` used by candidates and patches; Core renders
projected plurals, so callers do not need to serialize ICU themselves.

```ts
import { checkTranslationTargets, applyTranslationPatches } from "@palamedes/core-node";

// Carry each candidate's id and fingerprint into its completed patch.
const targetText = { boundaryWhitespace: true, metadataLeakage: true };
const reviews = checkTranslationTargets({ targets: patches, checks: targetText });
for (const review of reviews) {
  const bytes = Buffer.from(review.target);
  for (const warning of review.diagnostics) {
    console.log(
      review.id,
      warning.code,
      bytes.subarray(warning.span.start, warning.span.end).toString(),
    );
  }
}
// Apply only after the caller's review policy has accepted the proposals.
const result = applyTranslationPatches({ config, patches });
```

Both checks default to disabled. Enable the same checks for stored PO/FCL values
with `auditCatalogs(config, { checks: { targetText } })`. Both surfaces use the
same native detector and emit `warning` diagnostics:

- `target.boundary_whitespace`: leading or trailing Unicode whitespace introduced
  on a whole-message boundary where the source has none. A source boundary with
  intentional whitespace exempts that side. Internal spaces, ICU branch boundaries,
  rich-text fragments, and nonbreaking spaces before punctuation are left alone.
- `target.metadata_leakage`: additional native PO `#@ key:` markers in visible ICU
  literals. Ferrocat recognizes the metadata grammar, including custom keys. A
  source literal documenting a marker exempts the same key and occurrence count;
  documenting `lock` does not exempt a newly introduced `ai` marker. ICU formatter
  styles and unquoted plural `#` substitutions are not visible metadata literals.

Preflight returns one `TranslationTargetTextResult` per input with warnings, in
request order. Each result carries the candidate `id` (including its locale),
checked `target`, and `diagnostics`; identity and target text are stored once,
regardless of warning count. Inputs without warnings are omitted. Each warning
`span` is a half-open range of **UTF-8 bytes** in its result's `target`: the original
singular value, or Core's rendered ICU for a projected plural. For catalog audit,
`span` indexes the decoded stored target value. These are not PO/FCL file offsets
or JavaScript UTF-16 indexes. Metadata spans highlight the marker through its
colon, rather than its payload; the range starts at the hash and can include
ICU quoting within that header. Invalid source or rendered target ICU is left to existing syntax validation.
Rendering a projected plural can throw if a branch is malformed; a malformed
singular string instead produces no optional warnings. These checks do not
certify syntax or translation quality.

The preflight reads no catalogs and never writes, trims, clears review markers,
or rejects a patch. Audit is also read-only. Callers own their warning policy;
`applyTranslationPatches()` continues to enforce its existing validation contract.

## Inspect stored machine-translation claims

```ts
import { inspectCatalogMachineTranslationsAsync } from "@palamedes/core-node";

const result = await inspectCatalogMachineTranslationsAsync(config, { locales: ["de"] });
for (const catalog of result.catalogs) {
  for (const entry of catalog.details) {
    console.log(catalog.targetPath, entry.message, entry.context, entry.status);
  }
}
```

The synchronous `inspectCatalogMachineTranslations()` returns the same result.
Both read each selected PO/FCL catalog and its configured source catalog once,
without rewriting files. `locales` defaults to all configured non-source locales;
a missing source or requested target catalog rejects the call. Duplicate message
identities and parse failures also reject it.

Each `catalogs` section identifies the configured `catalog` pattern, resolved
`targetPath`, and `locale`. Its `current`, `stale`, `absent`, and `invalid` counters
count active target entries, including entries outside the source inventory.
`details` contains each entry's `message`, optional `context`, and lowercase
`status`. Obsolete entries are excluded. Sections follow configuration order and
sorted target locales; details use Ferrocat's deterministic identity order.

Ferrocat owns the canonical payload, versioned hash, and all four classifications:

- `current`: the stored lock matches the current effective translation.
- `stale`: the stored lock does not match the current effective translation.
- `absent`: no machine metadata survives in the parsed entry.
- `invalid`: retained machine metadata fails Ferrocat's validation, when detectable.

Malformed metadata can be rejected during parsing or discarded before review;
`invalid` is not a complete malformed-metadata detector. Inspection preserves
these native limits. A status establishes neither human/machine authorship nor
linguistic quality. The lock is also separate from candidate optimistic-concurrency
fingerprints. Subsequent extraction retains its existing stale-metadata cleanup;
inspection lets tooling see the stored claim before that write.

Rust tooling can call `palamedes::inspect_catalog_machine_translations()` and
consume the re-exported native `CatalogMachineTranslationReview` and
`CatalogMachineTranslationStatus` directly.

`assertNoRemovedPalamedesOptions(options, names)` throws the shared v2
migration error from `REMOVED_PALAMEDES_OPTION_MESSAGES` when `options` sets one
of the named removed options (`failOnCompileError`, `keepSourceFallbacks`,
`stripMessageField`, `messageSplitting`, `experimentalGraphSplitting`, or `cwd`)
to any value other than `undefined`. The first-party adapters call it during
setup. The catalog module APIs reject `failOnCompileError`. The transform API
rejects `keepSourceFallbacks` and `stripMessageField`, and the MDX APIs reject
`keepSourceFallbacks`; use `includeSourceMetadata` instead.

`analyzeSourceNative()` performs the source-level semantic analysis used by
linting and extraction, returning extracted messages and diagnostics in one
native pass.

## Stability

This package is useful for integration tests and custom tooling, but it is a
preview surface. Generated type details may change as the native boundary
evolves.

Use `@palamedes/cli`, `@palamedes/vite-plugin`, or `@palamedes/next-plugin`
when you do not need direct native access.
