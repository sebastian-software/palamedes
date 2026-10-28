# ADR-005: Public Application Runtime Is Parser-Free

**Status:** Accepted

**Last updated:** 2026-10-28

Every public application entrypoint executes compiled messages without an ICU parser.

## Decision

All public application runtime entrypoints must be parser-free, on server and
client, in development and production. ICU parsing remains available to
authoring, validation, and compilation tooling; it is not an application runtime
capability. This contract also applies to first-party examples and adapters.

The compiled ABI is exposed through:

- `@palamedes/core/compiled`
- `@palamedes/react/compiled`
- `@palamedes/remix/compiled`
- `@palamedes/solid/compiled`

Generated catalog modules import their ABI from `@palamedes/core/compiled`.
Macro transforms and generated MDX modules import `Trans` from the matching
framework `compiled` entrypoint. These entrypoints depend only on the compiled
message engine and Intl formatters; they do not import the ICU parser.

This ABI, meaning the renderer interface (`CompiledMessageRuntime`,
`ExecutableMessageRenderer`) and the generated catalog format, is internal.
Generated catalogs and the first-party renderers change together with the
Palamedes packages, so the ABI is not an extension point for custom runtimes.
Applications create instances with `createI18n()`.

Package roots and `compiled` subpaths resolve to the same
parser-free contract. `parseMessagePattern()`, `parsePattern()`, and runtime
parsing through `getMessageNodes()` belong to authoring and inspection tooling,
not the public application runtime. Framework adapters select runtime imports
automatically, so normal application authors need not choose between runtime
entrypoints. Exact legacy API replacements are documented in the
[v2 migration guide](../docs/migration-v2.md).
Custom transform or MDX module overrides do not create a first-party guarantee
of support for runtime ICU parsing.

Within each framework, the package root and `compiled` entrypoint share one
framework-specific message renderer. The renderer executes compiled messages
without a parser injection or a parse-only runtime capability.

React and Solid retain separate renderers because their result types, element
cloning, wrapper-component behavior, and reactivity contracts differ. The
boundary is shared across entrypoints within a framework, not across
frameworks.

The Core factory rejects an unbranded string catalog when
it is loaded. Generated invalid or unsupported ICU must not delegate to a
runtime parser: invalid or unsupported ICU fails compilation in development and
production, as specified in ADR-004. Missing translations use the compiled
fallback locale or source message by default, with optional `failOnMissing`
enforcement. Runtime delivery failures and unexpected missing compiled entries
reach host error handling under ADR-020; raw source patterns and internal keys
must not become replacement message output.

Complete compiled catalogs and compiled fragments are both valid runtime
inputs. Parser removal does not require graph splitting or prohibit complete
active-locale catalogs on either server or client.

## Context

The Rust application runtime follows the same no-ICU-parser boundary. It loads
versioned compiled instruction data from external catalogs and evaluates that
data without parsing source message patterns. JSON artifact decoding is a
transport operation, not runtime ICU parsing. Its dependency graph excludes the
semantic compiler, OXC, Ferrocat, and the ICU parser. Build tooling owns those
dependencies; no language catalog is embedded as a runtime fallback.

Executable catalog functions remove parsing from individual message lookups,
but that alone does not guarantee a parser-free application graph. Every public
entrypoint must enforce the same compiled input contract so import choices
cannot silently change runtime semantics or payload costs.

## Alternatives Considered

### 1. Rely only on tree-shaking at the package root

Rejected because the compatibility factory closes over the parser and keeps it
reachable. All application entrypoints must exclude the parser structurally;
the dependency boundary must be verifiable across bundlers.

### 2. Keep the parser at package roots as an optional compatibility mode

Rejected because the second execution model is outside the supported product
workflow and makes the runtime boundary depend on import choices. Migration guidance covers removed APIs without keeping a second runtime mode.

### 3. Publish a separate runtime package

Rejected because the ABI belongs to Core and the framework adapters already
have stable package identities. Their roots and compatible subpath aliases can
expose one compiled implementation without another package or version boundary.

## Consequences

- The supported application runtime does not ship or execute an ICU parser,
  regardless of host or package-root versus subpath imports.
- Existing package-root consumers and raw-ICU component examples require
  migration to compiled messages.
- Host integrations must deliver compiled messages through adapter-owned
  assets or module dependencies. Serialized ICU maps are a migration boundary,
  not a supported application transport.
- Root and compiled entrypoints no longer maintain parallel copies of their
  framework's message walker and runtime adapter.
- Browser and published-runtime checks verify that generated application assets
  are parser-free. The bundle check's parser source fixture is a private
  positive control for that assertion; it is not an application compatibility
  entry or a runtime transport. Aggregate host evidence is recorded in the
  [catalog-delivery evidence report](../benchmarks/catalog-delivery/README.md).

## Validation

The [catalog-delivery evidence report](../benchmarks/catalog-delivery/README.md)
records parser-free artifacts, browser delivery, server catalog reuse, and host
failure checks. The [v2 migration guide](../docs/migration-v2.md) owns legacy
API replacements; release status belongs in the release policy and tracker.
