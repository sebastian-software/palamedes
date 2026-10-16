# ADR-018: Generated TypeScript Types Derived from the Native Binding Surface

**Status:** Accepted

**Last updated:** 2026-10-16

The binding crate defines the JavaScript-visible contract from which wrapper types are generated.

## Decision

Generated TypeScript declarations derived from `palamedes-node` are the canonical source for Node boundary types.

The rules are:

- boundary type generation starts from the N-API binding crate, not the Rust core crate
- generated declarations are committed in the repository
- generated declarations are also validated in CI and local verification
- `@palamedes/core-node` should import and derive from those generated declarations instead of redefining boundary schemas by hand
- wrapper-specific reshapes are allowed, but they must be expressed as derived types from generated declarations

The intended shape of the stack is:

- `palamedes` defines Rust-core semantics
- `palamedes-node` defines the JS-visible native bridge
- generated declarations capture that bridge contract
- `@palamedes/core-node` re-exports or derives public wrapper types from the generated contract

## Context

A typed N-API boundary needs one source of truth for the shapes JavaScript
actually receives. Deriving declarations from another layer would make the
wrapper appear typed while permitting drift from the binding.

There are three plausible sources:

- the Rust core crate
- handwritten TypeScript interfaces in `@palamedes/core-node`
- the N-API binding crate that actually defines the JS-visible object layout

Only one of those is the real source of truth for the Node boundary: `palamedes-node`.

The Rust core crate is intentionally `napi`-free. It defines internal and product-facing Rust types, but it does not define the final JS-visible bridge shape.

Handwritten TypeScript interfaces inside `@palamedes/core-node` are also not the right source of truth. They are easy to drift out of sync, especially when request and response shapes evolve in Rust first.

The binding crate is the right source because it is where:

- N-API object names are decided
- field names are exposed to JavaScript
- unions and optional values are projected into JS-visible shapes
- the Node runtime actually crosses the boundary

The wrapper derives from that binding contract rather than duplicating it.

## Alternatives Considered

### 1. Keep handwritten TypeScript boundary interfaces in `@palamedes/core-node`

Rejected because they duplicate the actual native contract and create silent drift risk.

### 2. Derive TypeScript types directly from the Rust core crate

Rejected because the Rust core is not the N-API contract. The binding crate is.

### 3. Generate declarations only at build time and do not commit them

Rejected because it hides an important artifact behind build state and makes review and local reproducibility worse.

### 4. Expose only generated types with no wrapper derivation

Rejected because `@palamedes/core-node` may still intentionally provide a slightly more ergonomic surface in selected places.

## Consequences

- `packages/core-node/src/generated/` is a committed generated source directory.
- Changes in `palamedes-node` boundary types should be reflected by regeneration, not by manually editing duplicate TypeScript interfaces.
- `@palamedes/core-node` public types should be aliases or derived types wherever possible.
- Higher-level packages may still define their own public types, but should derive from `@palamedes/core-node` where the boundary shape is effectively the same.
- CI and local checks should fail when the committed generated declarations no longer match the binding crate.
