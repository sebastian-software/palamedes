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
- `@palamedes/solid/compiled`

Generated catalog modules import their ABI from `@palamedes/core/compiled`.
Macro transforms and generated MDX modules import `Trans` from the matching
framework `compiled` entrypoint. These entrypoints depend only on the compiled
message engine and Intl formatters; they do not import the ICU parser.

Package roots must converge on this same contract. Their current support for
uncompiled ICU catalogs, `parseMessagePattern()`, `parsePattern()`, and runtime
parsing through `getMessageNodes()` must be removed or moved to an appropriate
tooling boundary. Existing `compiled` subpaths should remain compatible aliases
to the same parser-free implementation; they are not a separate runtime mode.
Framework adapters select runtime imports automatically, so normal application
authors need not choose between runtime entrypoints. Exact legacy API
replacements are tracked in the
[active plan](../docs/plans/2026-09-11-compiled-runtime-and-catalog-delivery.md).
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
- `pnpm benchmark:runtime-browser` builds the real Vite MDX example, verifies a
  stable parser sentinel against the compatibility entry, rejects that sentinel
  in browser assets, and reports raw, gzip, and Brotli JavaScript sizes.
  This existing proof must evolve to cover the unified runtime contract.

## Implementation status

The current v2 migration has converged the Core, React, Solid, Next and Vite
application roots on the parser-free compiled runtime, with public ESM/CJS
checks guarding the absence of parser exports and browser parser code. The
host slices use the same compiled-only boundary: server adapters load complete
active-locale catalogs through shared immutable storage, while browser adapters
await the active locale's executable dependencies before translated modules
run. Catalog and formatter failures propagate to ordinary host error handling;
they are never converted into source-text output.

The old inert serialized ICU bootstrap remains available only as a validated
migration diagnostic and is rejected by the parser-free client. This ADR does
not claim that #1215's aggregate release gate is complete: host-specific
initial/lazy browser proofs, published-artifact checks, memory evidence and
release-policy verification remain required before the coordinated v2 release.
