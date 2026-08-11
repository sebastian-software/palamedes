# ADR-011: Native Catalog Rendering Produces Bundler Modules

**Status:** Accepted
**Date:** 2026-03-17
**Revised:** 2026-08-11

## Context

Palamedes compiles configured catalogs into runtime lookup maps, while Vite and
Next consume generated JavaScript modules. A short-lived design put final module
rendering in each host adapter, but it duplicated escaping and generated-module
semantics at every adapter boundary.

The compiler already owns message lowering, JavaScript-safe literal escaping,
and the executable message-function representation described by ADR-022. Keeping
the final module renderer beside that lowering gives every host the same output
and diagnostics without asking adapters to maintain a second generator.

## Decision

The native catalog renderer is the canonical producer of executable catalog
modules.

The rules are:

- native catalog compilation returns generated module `code`, diagnostics, and
  watch metadata
- `RuntimeModuleRenderer` owns safe ESM generation, including JavaScript
  escaping and executable message-function lowering
- Vite and Next loaders consume the native `code`; they do not render catalog
  messages themselves
- the public TypeScript `renderCatalogModule()` compatibility helper delegates
  to the same native renderer

The intended stack is:

- Rust compiles configured PO or FCL catalogs and renders the runtime module
- `palamedes-node` exposes that result through typed N-API bindings
- Vite and Next adapters handle host integration around the returned module

## Alternatives Considered

### 1. Render catalog modules in every host adapter

Rejected because escaping and compiled-message lowering are compiler semantics,
not framework integration concerns. Separate renderers drifted and gave each
adapter a distinct correctness surface.

### 2. Keep a shared JavaScript renderer in the wrapper

Rejected because it would still duplicate the native compiler's lowered message
representation and make the wrapper a second compiler boundary.

## Consequences

- The compiler owns one generated-module format and its escaping guarantees.
- Host adapters stay thin and consume native module code.
- `renderCatalogModule()` remains compatible for JavaScript callers without
  reviving a second renderer.
- Catalog storage can evolve from PO-only to PO/FCL without changing the host
  rendering boundary.
