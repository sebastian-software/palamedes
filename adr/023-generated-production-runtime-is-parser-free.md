# ADR-023: Public Application Runtime Is Parser-Free

**Status:** Accepted
**Date:** 2026-08-02
**Revised:** 2026-09-11

## Context

ADR-022 moved generated messages from runtime-parsed ICU strings to executable
functions. Generated applications still imported the public package roots,
however, so the lazy parser for hand-written catalogs remained reachable from
the production module graph even when no generated message used it.

Separate compiled entrypoints initially avoided that browser cost while keeping
runtime parsing at package roots. Palamedes now adopts one public application
runtime model: messages are compiled before execution on both server and client.
The compatibility path is migration work rather than a permanent product mode.

## Decision

All public application runtime entrypoints must be parser-free, on server and
client, in development and production. ICU parsing remains available to
authoring, validation, and compilation tooling; it is not an application runtime
capability. This contract also applies to first-party examples and adapters.

The existing parser-free implementation is exposed through:

- `@palamedes/core/compiled`
- `@palamedes/react/compiled`
- `@palamedes/remix/compiled`
- `@palamedes/solid/compiled`

Generated catalog modules import their ABI from `@palamedes/core/compiled`.
Macro transforms and generated MDX modules import `Trans` from the matching
framework `compiled` entrypoint. These entrypoints depend only on the compiled
message engine and Intl formatters; they do not import the ICU parser.

Package roots and existing `compiled` subpaths now resolve to the same
parser-free contract. `parseMessagePattern()`, `parsePattern()`, and runtime
parsing through `getMessageNodes()` belong to authoring and inspection tooling,
not the public application runtime. Framework adapters select runtime imports
automatically, so normal application authors need not choose between runtime
entrypoints. Exact legacy API replacements are documented in the
[v2 migration guide](../docs/migration-v2.md).
This contract ships as Palamedes v2 with migration guidance and without a
permanent legacy runtime mode. The published 1.x compatibility contract is not
retroactively changed by this accepted target.
Custom transform or MDX module overrides do not create a first-party guarantee
of support for runtime ICU parsing.

Within each framework, the package root and `compiled` entrypoint share one
framework-specific message renderer. The renderer executes compiled messages
without a parser injection or a parse-only runtime capability.

React and Solid retain separate renderers because their result types, element
cloning, wrapper-component behavior, and reactivity contracts differ. The
boundary is shared across entrypoints within a framework, not across
frameworks.

The existing parser-free Core factory rejects an unbranded string catalog when
it is loaded. Generated invalid or unsupported ICU must not delegate to a
runtime parser: invalid or unsupported ICU fails compilation in development and
production, as specified in ADR-022. Missing translations use the compiled
fallback locale or source message by default, with optional `failOnMissing`
enforcement. Runtime delivery failures and unexpected missing compiled entries
reach host error handling under ADR-004; raw source patterns and internal keys
must not become replacement message output.

Complete compiled catalogs and compiled fragments are both valid runtime
inputs. Parser removal does not require graph splitting or prohibit complete
active-locale catalogs on either server or client.

## Alternatives Considered

### 1. Rely only on tree-shaking at the package root

Rejected because the compatibility factory closes over the parser and keeps it
reachable. All application entrypoints must exclude the parser structurally;
the dependency boundary must be verifiable across bundlers.

### 2. Keep the parser at package roots as an optional compatibility mode

Rejected because the second execution model is outside the supported product
workflow and makes the runtime boundary depend on import choices. Earlier
revisions chose compatibility here. Reversing that choice requires an explicit
migration, delivered through the coordinated v2 release and migration guide.

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

## Implementation status

The current v2 implementation has converged the Core, React, Solid, Next, Vite,
Remix, TanStack, Waku, and React Router RSC paths on the parser-free compiled
runtime. Public ESM/CJS checks guard the absence of parser exports and browser
parser code. Server adapters load complete active-locale catalogs through
shared immutable storage, while browser adapters await the active locale's
executable dependencies before translated modules run. Catalog and formatter
failures propagate to ordinary host error handling; they are never converted
to source-text output.

Serialized ICU bootstraps and raw ICU maps are rejected at the v2 runtime
boundary. The parser marker used by the bundle checker is a test-only positive
control, not a compatibility sentinel shipped in an application artifact.
The [catalog-delivery evidence report](../benchmarks/catalog-delivery/README.md)
is the canonical record of the aggregate host checks.
