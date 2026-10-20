# ADR-006: Universal `getI18n()` Runtime Model

**Status:** Accepted

**Last updated:** 2026-10-20

Application code reads the active runtime through one environment-independent getter.

## Decision

Palamedes uses a single runtime access primitive: `getI18n()`.

The model is:

- transformed code targets `getI18n()`
- runtime consumers may also use `getI18n()` directly when appropriate
- client and server differ in how the active instance is installed, not in the public runtime access primitive

Operationally:

- on the client, `getI18n()` resolves the active client-side instance
- on the server, `getI18n()` resolves the active request-local instance
- if no active instance exists, the runtime should fail loudly rather than returning an incorrect fallback

Palamedes does not adopt a split public model like:

- hook-shaped access for one environment
- direct runtime access for another environment

### Runtime macros for unbundled Node code

Bundled code compiles macros into `getI18n()` calls. Node code that runs
without a bundler (native type stripping, plain `tsc` output, scripts, tests)
may opt in with `registerRuntimeMacros()` from
`@palamedes/runtime/node-macros`. After registration, `t` (template and
descriptor), `plural`, `select`, and `selectOrdinal` from
`@palamedes/core/macro` render through the same `getI18n()` lookup, so
application code is identical on both paths. Without registration the macros
keep throwing, so a missing plugin in a bundled app still fails loudly.

At runtime a macro only sees static text and values, not placeholder names.
`pmds extract --runtime-manifest` therefore records, for every call, the
compiled key and placeholder names the transform would produce. The runtime
neither hashes nor parses: catalogs come from `pmds catalog compile --target js`
(ADR-005, ADR-019, ADR-020). Extraction rejects calls the runtime cannot tell
apart (same static text, different message) and shapes it cannot recover:
interpolated choice branches, interpolated descriptor messages, and
non-literal branches. JSX macros, Node load hooks, and `tsc` source
preprocessing are not supported.

## Context

A recurring source of complexity in JavaScript i18n tooling is splitting runtime access across multiple patterns:

- hook-like APIs for components
- direct runtime objects for non-component code
- separate client and server access paths

That tends to create several problems:

- users must choose between overlapping abstractions
- transform output becomes harder to standardize
- the runtime contract depends too much on framework-specific expectations
- server behavior becomes harder to explain and validate

Palamedes needs one runtime primitive that transformed code can target consistently.

## Alternatives Considered

### 1. Separate client and server runtime APIs

Rejected because it complicates transform output and makes the mental model harder to teach.

### 2. Hook-shaped public runtime primitives

Rejected because the core problem is active-instance lookup, not component hook semantics.

### 3. A JavaScript port of the compiled key, or the native addon at runtime

Rejected for unbundled execution. A second key implementation can drift from
Ferrocat, and a native addon on every production host undoes the small
runtime footprint. The extraction manifest already knows every call site.

### 4. A Node load hook or `tsc` source preprocessing

Rejected because both need the compiler on the runtime host or a parallel
source tree, and each host needs its own glue.

### 5. Silent fallback behavior when no runtime is installed

Rejected because returning the wrong locale or stale runtime state is a correctness bug, not a recoverable convenience path.

## Consequences

- Transform output can standardize on a single runtime target.
- Framework adapters must install the active i18n instance correctly for their host environment.
- Server-side correctness depends on explicit request-local runtime setup.
- Palamedes stays closer to a portable runtime contract than to framework-specific runtime idioms.
- Unbundled Node code needs two generated artifacts, the manifest and compiled catalog modules, and must regenerate them after changing translated source.
- Runtime macros cost one map lookup per call; templates are cached per `TemplateStringsArray`.
