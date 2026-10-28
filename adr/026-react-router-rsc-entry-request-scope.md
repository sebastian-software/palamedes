# ADR-026: No React Router RSC Adapter

**Status:** Accepted

**Last updated:** 2026-10-28

Palamedes does not ship an adapter for React Router's RSC mode. React Server
Components are covered through Next.js and Waku; React Router support covers
Framework Mode.

## Decision

Discontinue `@palamedes/react-router-rsc` with 2.0. The 1.x package stays on
npm but gets no further releases, and no v2 package provides a React Router RSC
entry point. React Router applications use Framework Mode without RSC, as
described in the [React Router Framework Mode guide](../docs/api/react-router.md).
Applications that need React Server Components use the Next.js or Waku
adapters. The [v2 migration guide](../docs/migration-v2.md#react-router-rsc)
describes both paths.

## Context

The 1.x adapter wrapped the `fetch()` method of React Router's custom
`entry.rsc.tsx` in a request-local `AsyncLocalStorage` scope, so Server
Functions saw the active locale before their arguments were evaluated. That
entry depends on `unstable_reactRouterRSC`, `unstable_matchRSCServerRequest`,
and the 0.x `@vitejs/plugin-rsc`. React Router states that its RSC APIs may
break in patch or minor releases.

Keeping the adapter meant pinning one exact upstream combination and rerunning
a dedicated production verifier for every React Router release, without any
path to a Stable contract. Next.js and Waku already exercise the same
request-scope model for React Server Components, and Framework Mode is where
React Router users need a supported adapter.

## Alternatives Considered

### Keep the adapter as Preview

Rejected. Preview still promises a maintained, verified integration. On an
upstream contract that may break in any release, that promise would cost a
version-pinned fixture and CI proof per upstream update and would compete with
the Framework Mode adapter for maintenance.

### Directive-aware Server Function transform

Rejected. It would initialize i18n at function-body entry, after parameter and
default evaluation, and would still depend on the same unstable RSC request
dispatch.

## Consequences

- The package, its production fixture, its verifier, and its CI step are
  removed from the repository and the v2 release set.
- 1.x users migrate to Framework Mode, or to Next.js or Waku for React Server
  Components. After 2.0 the npm package is deprecated with a pointer to the
  migration guide.
- The runtime request-scope model is unchanged. An RSC host still needs one
  request scope around its complete entry before Server Function dispatch, as
  the Next.js and Waku adapters provide.

## Validation And Review Triggers

Revisit this decision when React Router ships its RSC entry and request-matching
APIs without the `unstable_` prefix and `@vitejs/plugin-rsc` reaches a stable
release. A new adapter needs its own production fixture covering a real
client-to-server Server Function call, default parameters, concurrent locale
isolation, and post-action revalidation.
