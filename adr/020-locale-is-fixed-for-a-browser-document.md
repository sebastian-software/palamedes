# ADR-020: Locale Is Fixed for a Browser Document

**Status:** Accepted

## Context

Locale selection is request and bootstrap state. Applications resolve it before
translated UI renders and normally keep it stable for the user's session.

Changing the locale safely inside a running document is a whole-application
concern. Module state, memoized `Intl` formatters, data and query caches, browser
stores, and third-party components may all contain locale-derived values. A
framework subscription can update translated components, but it cannot verify
or invalidate those other values. Partial updates can therefore produce a
mixed-language document.

Palamedes exposes the active instance through the plain `getI18n()` getter.
Keeping locale access independent of framework reactivity makes the same
primitive usable in render functions, helpers, callbacks, actions, and event
handlers.

## Decision

A locale is immutable for the lifetime of a browser document.

- Applications resolve the locale before or during document bootstrap and
  install one active client instance before translated UI hydrates.
- Macro transforms and framework runtime components use the plain, hook-free
  `getI18n()` from `@palamedes/runtime`.
- `framework` selects only the component contract for generated MDX.
- `createClientCatalogBoundary()` owns one document-fixed locale. It starts the
  active catalog import at module evaluation, initializes the parser-free client
  instance before translated descendants hydrate, and rejects a different
  locale for the same document.
- Locale controls persist or encode the new locale and then perform a full
  document navigation.
- Palamedes does not provide a reactive locale subscription or a live-switching
  contract.

Neither framework nor locale lifecycle moves into `palamedes.yaml`. Extraction
produces identical messages for all UI frameworks, and request locale selection
belongs to the host application.

## Application-Owned Remount

An application that deliberately needs an in-document switch may activate a new
client instance before mounting its complete localized application beneath a
root keyed with `key={locale}`. This is an application-owned integration, not a
Palamedes runtime feature.

A framework key resets only the subtree it owns. Module singletons, query
caches, browser state, external stores, and third-party components can remain
stale. Applications choosing this path own those invalidations and should use a
document navigation when they cannot prove the boundary is complete.

## Consequences

Transformed `t` and `plural` calls are ordinary getter calls and are valid
anywhere after runtime initialization, without React hook or Solid signal
dependencies.

The client hot path has no locale subscription overhead. One active compiled
catalog remains split behind its own client chunk and executes without browser
ICU parsing.

A locale change restarts framework and non-framework state together. The tradeoff
is a document navigation with its associated state reset, data loading, and loss
of transient UI state.
