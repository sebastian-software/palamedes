# ADR-020: Locale Is Fixed For A Browser Document

**Status:** Accepted

## Context

Palamedes originally exposed a plain `getI18n()` getter. During the 1.9–1.11
line, framework runtime subpaths added React external-store and Solid signal
subscriptions so inline macros could follow an in-document locale change. The
plugin `framework` option then selected those reactive runtimes implicitly.

That design made every transformed browser lookup framework-reactive, including
translations evaluated in helpers, callbacks, label factories, conditions, and
event handlers. React lookups became hook-shaped even though the authored API
was a normal getter.

The first large application migration exposed the mismatch. It also showed that
reactive translations do not make an application safe for live locale changes:
module caches, memoized `Intl` formatters, fetched data, and third-party
components can all retain the previous locale and produce a mixed-language UI.
Palamedes cannot enforce or validate that whole-application contract.

Locale selection normally happens during request/bootstrap and changes rarely.
A document navigation resets framework state and non-framework caches together,
which is the stronger and simpler invariant.

## Decision

A locale is immutable for the lifetime of a browser document.

- Macro transforms always import the plain, hook-free `getI18n()` from
  `@palamedes/runtime` unless an advanced custom `runtimeModule` is supplied.
- React and Solid runtime components read the same plain getter. They do not
  subscribe to client instance changes.
- `framework` selects only the component contract for generated MDX.
- The built-in reactive runtime subpaths, client subscription APIs, and locale
  synchronization hooks are removed.
- `createClientCatalogBoundary()` represents one document-fixed locale. It
  starts the active catalog import at client module evaluation, initializes one
  parser-free client instance before translated descendants hydrate, and throws
  when its locale prop differs from the document locale.
- Locale controls perform a full-document navigation after updating a cookie or
  selecting a locale URL.

Neither framework nor locale lifecycle moves into `palamedes.yaml`. Extraction
produces identical messages for all UI frameworks, and request locale selection
belongs to the host application.

## Unsupported Escape Hatch

An application may implement its own in-document restart by activating a new
client instance before mounting a complete localized subtree with
`key={locale}`. Palamedes does not provide a helper or reactivity contract for
this pattern.

A framework key resets only the subtree it owns. Module singletons, query
caches, browser state, external stores, and third-party components can remain
stale. Applications choosing this path own those invalidations and should use a
document navigation when they cannot prove the boundary is complete.

## Consequences

Transformed `t` and `plural` calls are ordinary getter calls again and are valid
in render functions, helpers, callbacks, route actions, and event handlers once
the runtime has been initialized.

The client hot path no longer installs `useSyncExternalStore` subscriptions or
Solid signal dependencies for translations. One active compiled catalog remains
split behind its own client chunk and executes without browser ICU parsing.

Removing the reactive APIs is intentionally a hard compatibility correction,
not a deprecation cycle. They were temporary additions, had no known production
consumer requiring the behavior, and the first large consumer demonstrated that
their implicit hook contract was unsafe.
