# ADR-017: Typed N-API Boundary with Workflow-First Native Operations

**Status:** Accepted

**Last updated:** 2026-10-16

The Node boundary passes typed workflow requests and offers synchronous and asynchronous execution for host lifecycles.

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

Synchronous calls remain available for synchronous host hooks. Event-loop-sensitive
integrations use the additive `Async` catalog and file-extraction operations.
Each async call moves one owned operation to Node's shared libuv worker pool;
Vite and Next await those operations, while synchronous hooks retain the
synchronous API.

Callers bound bulk concurrency. An abort signal can cancel a queued task but
cannot interrupt native work that has started. The wrapper coordinates cold
selected-catalog builds and serializes async mutations to the same resolved
file within a process. These mechanisms preserve typed workflow boundaries;
they do not create a second semantic implementation. The exact API and
concurrency contract lives in the [Node API reference](../docs/api/core-node.md).

Each native export represents a meaningful product operation. Distinct
transform, extraction, update, and compilation workflows remain composable
without exposing transport-oriented helpers.

## Context

Palamedes uses a Rust-first core, but the Node integration layer still defines a meaningful architectural boundary. That boundary needs to be efficient, predictable, and easy to reason about over time.

A JSON transport layer would add several costs:

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
- Node callers choose the synchronous or async operation to match the host
  lifecycle and keep blocking work off latency-sensitive event-loop paths.
