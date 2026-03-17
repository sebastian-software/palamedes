# ADR-005: Universal `getI18n()` Runtime Model

**Status:** Accepted
**Date:** 2026-03-17

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

## Alternatives Considered

### 1. Separate client and server runtime APIs

Rejected because it complicates transform output and makes the mental model harder to teach.

### 2. Hook-shaped public runtime primitives

Rejected because the core problem is active-instance lookup, not component hook semantics.

### 3. Silent fallback behavior when no runtime is installed

Rejected because returning the wrong locale or stale runtime state is a correctness bug, not a recoverable convenience path.

## Consequences

- Transform output can standardize on a single runtime target.
- Framework adapters must install the active i18n instance correctly for their host environment.
- Server-side correctness depends on explicit request-local runtime setup.
- Palamedes stays closer to a portable runtime contract than to framework-specific runtime idioms.
