# ADR-023: Generated Production Runtime Is Parser-Free

**Status:** Accepted
**Date:** 2026-08-02

## Context

ADR-022 moved generated messages from runtime-parsed ICU strings to executable
functions. Generated applications still imported the public package roots,
however, so the lazy parser for hand-written catalogs remained reachable from
the production module graph even when no generated message used it.

The parser is valuable compatibility code, but it should not be part of the
standard browser cost for applications that compile their catalogs and macros.

## Decision

Palamedes exposes explicit `compiled` entrypoints for the generated production
path:

- `@palamedes/core/compiled`
- `@palamedes/react/compiled`
- `@palamedes/solid/compiled`

Generated catalog modules import their ABI from `@palamedes/core/compiled`.
Macro transforms and generated MDX modules import `Trans` from the matching
framework `compiled` entrypoint. These entrypoints depend only on the compiled
message engine and Intl formatters; they do not import the ICU parser.

The package roots remain the compatibility entrypoints. They continue to
support hand-written ICU string catalogs, `parseMessagePattern()`, and direct
`getMessageNodes()` access. Custom transform or MDX module overrides remain
honored and therefore own their chosen runtime boundary.

The parser-free Core factory rejects an unbranded string catalog when it is
loaded. A generated lazy fallback caused by invalid or unsupported ICU reports
the error through `onError` and returns the raw fallback. Normal generated
messages never use this path.

## Alternatives Considered

### 1. Rely only on tree-shaking at the package root

Rejected because the compatibility factory closes over the parser and keeps it
reachable. A separate leaf entrypoint makes the dependency boundary explicit
and verifiable across bundlers.

### 2. Remove the parser from the package root

Rejected because it would break hand-written and runtime-loaded ICU catalogs.
The compatibility behavior remains useful when applications deliberately opt
out of build-time compilation.

### 3. Publish a separate runtime package

Rejected because the ABI belongs to Core and the framework adapters already
have stable package identities. Subpath exports express the distinction without
adding another package or version boundary.

## Consequences

- Generated production builds do not ship the ICU parser by default.
- Hand-written ICU catalogs must import `createI18n` from `@palamedes/core`.
- Applications using generated catalogs can import `createI18n` and catalog
  types from `@palamedes/core/compiled` to keep the parser unreachable.
- Directly authored `Trans` imports may continue using package roots; generated
  transforms select the compiled entry automatically.
- `pnpm benchmark:runtime-browser` builds the real Vite MDX example, rejects
  known parser signatures, and reports raw, gzip, and Brotli JavaScript sizes.
