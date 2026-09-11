# ADR-022: Generated Catalogs Use Executable Message Functions

**Status:** Accepted
**Date:** 2026-08-01
**Revised:** 2026-09-11

## Context

Generated catalogs previously exposed only ICU strings, so the browser parsed
each dynamic message on first use. Attaching a second map of pre-parsed nodes
would remove parsing, but it would duplicate every dynamic message key and keep
an AST interpreter in the browser hot path.

Palamedes needs one generated representation that handles plain strings,
variables, formatters, plurals, selects, and rich-text tags across the Core,
React, and Solid renderers. Palamedes' supported application model is message
authoring through macros and supported extraction, translation in source
catalogs, and compilation before execution. Runtime interpretation of
uncompiled ICU catalogs is not a separate supported application model.

## Decision

Generated catalog modules export one branded message map:

- constant messages are string values
- dynamic messages are executable functions

This representation is the public runtime contract on both server and client.
ICU parsing belongs to authoring, validation, and compilation, not application
message rendering. Generated code must not defer unsupported or invalid ICU
to a runtime parser. Invalid ICU and ICU constructs outside the supported
compiler/runtime subset are fatal compilation errors in both development and
production, for source messages and translations alike. Diagnostics identify
the affected catalog, locale, and source message. No adapter option may downgrade
these failures to successful compilation or emit a lazy-parser substitute.

A missing translation is not an invalid message. By default, compilation
resolves it through the configured fallback locale chain and ultimately the
source message, then compiles that result using the same message representation.
Variables, plurals, and rich text retain their compiled semantics without a
runtime parser. The missing target-locale translation remains observable in
diagnostics; `failOnMissing` may enforce translation completeness even when a
valid fallback exists. Invalid or unsupported fallback messages still fail
compilation under the rule above.

This build-time translation fallback is distinct from failure to deliver a
compiled fragment at runtime. Failed delivery and unexpected missing compiled
entries must reach host error handling rather than render substitute source
text or internal keys, as specified in ADR-004. Concrete adapter integration
and recovery mechanics are described in [ADR-008](008-framework-adapter-architecture.md)
and the [v2 migration guide](../docs/migration-v2.md).

Message functions receive the lookup values and a small renderer interface.
They call named operations such as `value`, `number`, `plural`, `tag`, and
`join`; they do not return framework-specific values directly. Plural and
select branch functions and branch tables are hoisted to module scope so they
are allocated once rather than once per render.

Core, React, and Solid provide renderer implementations for their result types.
The same function therefore produces a string, React nodes, or Solid nodes.
Generated modules contain no parallel string/AST maps.

The catalog brand identifies generated catalog maps, including their constant
strings. Constant strings in a compiled catalog are already compiled literal
messages; they are not ICU patterns to interpret at runtime. Applications must
preserve the generated catalog contract when loading complete catalogs or
fragments. Uncompiled ICU maps are not an alternative runtime input.

Ferrocat remains the Rust-side ICU parser. The Rust core lowers its AST into a
host-neutral message program, and the Node host boundary renders safe JavaScript
module source in accordance with ADR-011.

The native renderer is the single catalog-module generator. The public
TypeScript `renderCatalogModule()` compatibility helper delegates to that
renderer instead of parsing ICU and maintaining a second JavaScript generator.

## Alternatives Considered

### 1. Parallel string and pre-parsed-node maps

Rejected because it duplicates keys and dynamic message data, allocates AST
objects during module evaluation, and retains an interpreter in every runtime
renderer.

### 2. Replace message strings with serialized AST values

Rejected because it still requires runtime interpretation and makes even
constant messages structured data.

### 3. Generate framework-specific functions

Rejected because it would duplicate compiler semantics across Core, React, and
Solid. The renderer parameter keeps one compiler output portable across hosts.

### 4. Retain runtime support for uncompiled ICU catalogs

Rejected because it adds a second execution model outside Palamedes' intended
extraction, translation, and compilation workflow. Earlier revisions retained
this compatibility path; the September 2026 decision replaces that policy for
both server and client. Small applications can load a complete compiled catalog
without needing a runtime parser.

## Consequences

- Generated dynamic messages execute directly without server or client ICU parsing or
  AST traversal.
- Generated catalog values are `string | CompiledMessage`; consumers must not
  assume every generated value is JSON-serializable.
- Runtime parser and parsed-node inspection APIs must be audited and migrated
  out of the public application runtime contract. Build-time tooling may still
  parse ICU and inspect its representation.
- The compiler owns safe JavaScript expression generation, including escaped
  literals, computed object keys, nested choices, and plural-pound semantics.
- Custom integrations loading generated modules must declare
  `@palamedes/core` as a direct runtime dependency because the module imports
  `defineCompiledCatalog()` from its `compiled` entrypoint.
- Runtime and bundle benchmarks must cover both payload size and first-render
  execution before the representation is considered stable.
- ADR-023 applies the parser-free contract to the complete public application
  runtime, including package-root imports.

## Implementation status

The compiled representation and its first-party host integrations are
implemented. Catalog module compilation rejects invalid or unsupported
messages instead of generating a lazy-parser fallback, and Core, React,
Solid, Next, Vite, and Remix use the same executable catalog contract. The
request-scope integrations use the same generated representation through their
adapter-owned delivery paths.

The [catalog-delivery evidence report](../benchmarks/catalog-delivery/README.md)
records the parser-free artifact, browser delivery, and server reuse checks.
The migration rules and exact replacements are maintained in the
[v2 migration guide](../docs/migration-v2.md).
