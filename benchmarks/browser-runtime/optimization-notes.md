# Browser size optimization findings

The client profiles in [results.json](./results.json) measure selected imports
after tree-shaking. The full API references remain in the same report. These
are standalone runtime artifacts, not whole-application before/after deltas.

| Runtime | Full API gzip | Client imports gzip |
| ------- | ------------- | ------------------- |
| Core    | 4,343 bytes   | 3,474 bytes         |
| React   | 5,122 bytes   | 4,130 bytes         |
| Solid   | 4,835 bytes   | 3,852 bytes         |
| Remix   | 4,950 bytes   | 4,072 bytes         |

No production code change was needed to obtain these smaller artifacts. Unused
exports already disappear when the build only retains the selected client APIs.
The complete English booking catalog is measured separately.

## Optimizations already in place

[ADR-004](../../adr/004-generated-catalogs-use-executable-message-functions.md) and
[ADR-005](../../adr/005-generated-production-runtime-is-parser-free.md) describe the compiled
representation: static messages are strings, dynamic messages are executable
functions, and the browser does not parse ICU messages. The
[native renderer](../../crates/palamedes/src/catalog_module.rs) hoists branch
functions and tables to module scope and avoids a join for a single dynamic node.

The [earlier runtime experiments](../core-runtime/2026-09-10-experiments.md)
record formatter caching and allocation work. The
[framework experiments](../framework-runtime/README.md) cover direct join loops
and renderer reuse. These improve execution and allocations; their historical
timing results are not new size measurements.

## Where more bytes could disappear

The default `createI18n()` factory reaches all string-renderer operations through
one runtime object. Number, date/time, and plural helpers therefore remain in
every measured client profile, even if one application's messages use only a
subset. The catalog-only diagnostic is 424 bytes gzip and retains no Intl
constructor references: module-level dead-code elimination already works when
the default factory is absent. That diagnostic cannot perform message lookup
or replace the client runtime.

A promising next experiment is a capability-specific renderer assembled by the
build from statically imported operations. For example, a text-and-values
application could omit date/time and number style handling. The selection must
cover both Core's string renderer and any UI renderer retained by the application.
The compiler would
need to collect capabilities across all supported locales and lazy fragments,
including fallback messages. Measuring only the initial English route would
understate that requirement. The experiment needs production bundle comparisons,
browser output parity, and first-render/update measurements before adoption.

Precompiling number/date style descriptors is another candidate: the compiler
already sees those static strings. It could emit normalized options or compact
style identifiers. This may remove runtime normalization only if the selected
runtime also omits support for dynamic style strings. Extra generated options,
tables, or helper calls could outweigh the saving for small catalogs. Measure
the runtime and catalogs together across small and large fixtures, while keeping
locale, time-zone, cache behavior, and error semantics intact.

Shorter runtime method names are a lower-priority experiment. Names such as
`number`, `plural`, and `join` form part of the shared compiled catalog contract;
minification already shortens local variables and compression reduces repeated
property names. There is no measured net saving yet. Changing that contract or
adding aliases needs evidence across payload size and execution, rather than a
smaller-looking generated source file.

## Function deduplication: no current corpus saving

[catalog-functions.json](./catalog-functions.json) retains the current scan:
119 catalogs, 4,174 messages, 1,744 emitted functions, and zero exact duplicate
functions within a catalog module. The scanner now uses each project's native
artifact compiler so PO escaping and fuzzy/source fallback follow production.

Reproduce after `pnpm build`:

```sh
node scripts/inspect-catalog-function-duplicates.mjs examples proof/vue-vite proof/nuxt-ssr proof/svelte-vite proof/sveltekit-ssr > benchmarks/browser-runtime/catalog-functions.json
pnpm exec oxfmt --write benchmarks/browser-runtime/catalog-functions.json
```

The corpus repeats the shared booking demo across integrations. This is an exact
syntax check within modules, not a claim about all applications, semantic
equivalence, or sharing functions across separately loaded catalogs. Additional
compiler bookkeeping for this optimization is not justified by these fixtures.
