# ADR-009: Typed N-API Boundary with Workflow-First Native Operations

**Status:** Accepted
**Date:** 2026-03-17

## Context

Palamedes uses a Rust-first core, but the Node integration layer still defines a meaningful architectural boundary. That boundary needs to be efficient, predictable, and easy to reason about over time.

An early JSON-string transport layer is acceptable for bootstrapping a native integration. It is often the fastest way to get a Rust and TypeScript boundary working while the data shapes are still moving.

It is not a good long-term architecture for Palamedes.

The JSON transport layer creates several costs:

- request objects are stringified in TypeScript
- payloads are parsed again in Rust
- Rust responses are serialized back to JSON
- the TypeScript wrapper parses them again into objects
- large workflow calls pay additional allocation and copy costs
- the boundary looks typed in TypeScript, but is still fundamentally string-based

At the same time, not every native export should become a tiny helper. A helper-heavy boundary increases the number of N-API crossings and encourages TypeScript orchestration to rebuild semantic workflows outside the core.

Palamedes needs a boundary that is both:

- typed at the native interface
- shaped around meaningful workflow operations instead of transport convenience

## Decision

Palamedes uses a typed N-API boundary for its Node integration surface.

JSON is not the architectural boundary format.

The boundary rules are:

- requests and responses cross the boundary as typed N-API values
- workflow-oriented native operations are the default
- small standalone utility operations are allowed when they are genuinely useful on their own
- a parallel JSON transport layer is not kept once typed operations exist

The preferred native workflow operations are:

- transform a module
- extract messages from a module
- update a catalog file
- parse a catalog
- build a catalog module

Standalone utilities may still exist when they are clearly useful outside a larger workflow. `parsePo()` is an example of an acceptable utility.

This does not mean Palamedes must collapse every operation into one giant "do everything" call. The rule is not "fewer functions at any cost." The rule is that each exported native function should represent a meaningful product operation, not a transport workaround.

## Alternatives Considered

### 1. Keep JSON as the native transport

Rejected because it preserves avoidable stringify/parse work on both sides of the boundary and keeps the real interface string-based.

### 2. Replace JSON with another serialization format such as MessagePack or Protobuf

Rejected because the main problem is not just payload size. The deeper issue is that Palamedes is crossing an in-process N-API boundary, not a network boundary. A binary serialization format would still keep an avoidable encode/decode layer where direct typed values are available.

### 3. Expose many small native helper functions

Rejected because it increases boundary chatter and makes it easier for TypeScript layers to rebuild semantic workflows outside the Rust core.

### 4. Collapse the entire product into a single mega-workflow

Rejected because it would overfit the current host integrations and make the API less composable than necessary. Palamedes still benefits from distinct workflow operations such as transform, extract, catalog update, and catalog compilation.

## Consequences

- The native Node bindings should export typed request and response objects instead of JSON strings.
- `@palamedes/core-node` should expose the same workflow-oriented surface without `JSON.parse` / `JSON.stringify` glue.
- The Rust core remains `napi`-free; the binding crate is responsible for N-API bridge types and conversion.
- Future performance work should first ask whether orchestration can remain inside an existing native workflow before adding new boundary crossings.
- New utilities should be added sparingly and only when they are useful outside a larger workflow.
