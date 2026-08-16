# ADR-026: TypeScript Semantics over a Versioned Process Boundary

**Status:** Accepted for the semantic-facts spike
**Date:** 2026-08-16

## Context

Palamedes parses JavaScript and TypeScript with OXC, but OXC deliberately does
not reproduce the complete TypeScript checker. Translation tooling can benefit
from occurrence-specific actual, contextual, widened, apparent, and declared
types without making the Palamedes core depend on TypeScript's numeric flags or
checker object layout.

The TypeScript Semantic Kernel RFC defines a bounded, response-local graph and
exposes it through the TypeScript 7 asynchronous API. The producer owns checker
semantics, graph interning, recovery, and truncation. Palamedes needs a boundary
that keeps those responsibilities separate while still permitting an OXC node
to reference the exported graph.

## Decision

Palamedes consumes TypeScript semantic facts through TS7's framed JSON-RPC
process API. The Rust client follows the server's `initialize`, project-open
`updateSnapshot`, `getSemanticSnapshot`, `release`, project-close
`updateSnapshot`, and final `release` lifecycle and owns the child process when
it starts one. Cancellation uses `$/cancelRequest`, and explicit `close()`
releases standard input and waits for the process. A drop fallback kills and
asynchronously reaps an unclosed child.

The Rust wire model contains versioned protocol enums, response-local newtype
IDs, graph edges, completeness states, and source coordinates. It does not
mirror TypeScript numeric flags or expose compiler object identities. Decoding
accepts unknown object fields, capability names, and issue codes, while unknown
record and enum variants fail explicitly. Every response is validated for
schema and offset compatibility, duplicate IDs, entity-state coherence, budget
accounting, and referential integrity before consumers can use it.

IO and JSON-RPC framing stay in the process adapter. The client lifecycle is
generic over an injectable transport, so the decoder and orchestration tests do
not require a TS7 executable. OXC mapping and graph inspection consume the
validated model and remain deterministic, process-free core logic.

This decision implements the consumer boundary tracked by
[Semantic Kernel issue #14](https://github.com/swernerx/typescript-semantic-kernel/issues/14)
and [issue #15](https://github.com/swernerx/typescript-semantic-kernel/issues/15)
and follows
[RFC 0001](https://github.com/swernerx/typescript-semantic-kernel/blob/main/rfcs/0001-semantic-facts-kernel.md).

## Alternatives Considered

### Reimplement the TypeScript checker in Palamedes

Rejected. It would create a second semantic authority and turn checker parity
into an open-ended maintenance obligation unrelated to Palamedes' i18n core.

### Load TypeScript compiler internals through an in-process FFI boundary

Rejected. It would couple Rust ABI, memory ownership, cancellation, and crash
behavior to unstable compiler implementation details. The process protocol
already supplies a language-neutral compatibility boundary and failure
isolation.

### Persist snapshot-local IDs across requests

Rejected. IDs are deterministic only within one response. Persistence would
silently confuse entities after source or compiler changes. Consumers retain a
snapshot as one owned graph and rebuild side tables for each response.

## Consequences

- Process, protocol, cancellation, decode, validation, and project-selection
  failures remain distinguishable.
- Runs retain TS version, source revision, schema, capabilities, project,
  offset encoding, snapshot ID, and transport description for reproduction.
- Unknown compatible metadata can evolve without a Palamedes release; new
  semantic variants require an explicit compatibility update.
- Response-local graph sharing and cycles are preserved in owned Rust data.
- The first client is synchronous at the Rust API surface while speaking TS7's
  asynchronous protocol. Palamedes does not add an async runtime for one
  process boundary.
- A snapshot may use significant memory; graph budgets remain producer-owned
  and visible rather than being hidden by the consumer.

## Validation And Review Triggers

Canonical upstream fixtures cover sharing, cycles, type views, all entity
states, budget truncation, and recovery. Boundary tests use an injected
transport to prove lifecycle ordering and release behavior. Revisit this
decision if the semantic-facts schema becomes a stable external standard, TS7
offers a supported daemon/session reuse contract, evidence supports a native
Rust checker, or the end-to-end spike selects a different production boundary.
