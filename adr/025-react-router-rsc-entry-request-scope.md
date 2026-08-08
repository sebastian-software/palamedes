# ADR-025: React Router RSC Entry Request Scope

**Status:** Accepted
**Date:** 2026-08-08

## Context

React Router RSC Server Functions execute in an RSC request that is separate
from ordinary Framework Mode route actions. Palamedes needs one request-local
i18n initialization point that is active before a Server Function's arguments
and default parameters are evaluated and survives its async rendering and
revalidation work.

React Router 8.3.0's generated Framework Mode `entry.rsc.tsx` accepts the
original Fetch `Request` and invokes `unstable_matchRSCServerRequest` from its
default `fetch()` method. Its supported custom-entry convention permits
wrapping that default method. The RSC API is experimental and explicitly may
break in patch or minor releases.

## Decision

Publish the opt-in `@palamedes/react-router-rsc` package. Applications create
one request scope in `app/entry.rsc.tsx` and wrap React Router's default RSC
entry `fetch()` method. The resolver receives the original request and returns
a fresh, activated i18n instance. The package runs the complete default entry
inside `@palamedes/runtime/server`'s `AsyncLocalStorage` scope.

Support exactly the tested RSC Framework Mode contract: `@react-router/dev`
and `react-router` 8.3.0 plus `@vitejs/plugin-rsc` 0.5.32. Do not instrument
`"use server"` bodies for this integration. Do not claim RSC Data Mode support.

## Alternatives Considered

### Directive-aware Server Function transform

Rejected. It initializes at function-body entry, after parameter/default
evaluation. The runtime entry is earlier and covers the complete RSC and SSR
request without rewriting user source. Reusing the Next.js transform would
also require its eager-default safety diagnostic for no benefit on this path.

### Per-function initialization

Rejected. It duplicates locale and catalog policy throughout application code,
misses helpers before the initializer, and cannot cover default parameters.

## Consequences

- Direct macros and synchronous, asynchronous, and cross-module helpers read
  the active locale during Server Function dispatch, rendering, and streaming.
- Concurrent RSC and SSR graphs use isolated async contexts.
- Resolver/catalog failures are clear server failures and prevent dispatch.
- Vite's current graph-splitting manifest does not identify RSC Server Function
  module fragments. Applications load the active locale's server catalog in
  the resolver until upstream exposes a safe mapping.
- Node-compatible `AsyncLocalStorage` is required; Edge/Worker and detached
  async work remain unsupported without application-specific verification.

## Validation And Review Triggers

The production fixture builds and browser-verifies a real client-to-server
`"use server"` call, default parameter, helpers, concurrent locale isolation,
and post-action revalidation. Revisit this decision when React Router changes
custom RSC entry semantics, `unstable_matchRSCServerRequest`, the RSC request
dispatch order, or Vite exposes an RSC server fragment manifest.
