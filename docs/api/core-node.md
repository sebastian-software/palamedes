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
- `AsyncTaskOptions`

`analyzeMdxNative` returns messages, structured diagnostics, generated
framework JSX, compiled message IDs, and a native source map from one semantic
analysis pass. See [MDX messages](../mdx.md).

`compileCatalogArtifact()` and `compileCatalogArtifactSelected()` include
runtime formatter diagnostics in their `diagnostics` arrays. Unsupported
formatter kinds such as `list`, `duration`, `ago`, and `name` are errors.
Unsupported styles on supported `number`, `date`, and `time` formatters are
warnings because the runtime falls back to default `Intl` formatting.

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
catalog update, translation patch, catalog artifact/module compilation, and
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

Selected-artifact calls that target the same catalog and configuration are
coordinated in JavaScript. Only the first cold build enters the worker pool;
concurrent followers wait for it, then use the warmed native cache. If the
first build fails, waiting callers retry one at a time so cancellation or a
selected-ID compilation error from one caller does not reject another.
Different catalogs remain concurrent.

`renderCatalogModule(messages)` exposes the same native module generator for
custom integrations that already have a compiled message map. The TypeScript
compatibility helper delegates to this function; there is no second ICU parser
or code generator.

`listTranslationCandidates()` and `applyTranslationPatches()` form the native
translation-review workflow. A failed catalog write can still include completed
per-file outcomes: identify that error with `isTranslationPatchWriteError()`
and read its `report`. See [Translation candidate patches](../translation-candidate-patches.md).

`analyzeSourceNative()` performs the source-level semantic analysis used by
linting and extraction, returning extracted messages and diagnostics in one
native pass.

## Stability

This package is useful for integration tests and custom tooling, but it is a
preview surface. Generated type details may change as the native boundary
evolves.

Use `@palamedes/cli`, `@palamedes/vite-plugin`, or `@palamedes/next-plugin`
when you do not need direct native access.
