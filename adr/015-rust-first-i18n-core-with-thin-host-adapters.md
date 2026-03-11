# ADR-015: Rust-First i18n Core with Thin Host Adapters

**Status:** Accepted
**Date:** 2026-03-12

### Context

Palamedes already relies heavily on Rust-backed building blocks:

- OXC for parsing and transform-heavy work
- native Palamedes core logic for extraction and macro transformation
- Rust-backed PO handling through the surrounding `pofile` ecosystem

At the same time, the remaining architecture is still split across Rust and TypeScript in a way that keeps key semantic work in the host layer:

- runtime ownership still depends on `@lingui/core`
- config loading still depends on `@lingui/conf`
- `.po` loading and message compilation in the framework adapters still depend on `@lingui/cli/api`

That split has several costs:

- the i18n domain model is not fully owned by Palamedes
- semantic logic is still duplicated across native and TypeScript layers
- Rust/JS boundaries risk becoming chatty or JSON-heavy
- Palamedes remains closer to a JavaScript toolchain with native helpers than to a portable native i18n core

The project goal is not to recreate the whole Lingui ecosystem. The goal is to own the pieces Palamedes actually needs, keep the hot and semantically rich path inside Rust, and leave TypeScript as the host integration layer.

### Decision

Palamedes will adopt a Rust-first architecture for its i18n core and keep TypeScript limited to thin host adapters.

The architectural rule is:

- **Rust owns domain logic**
- **TypeScript owns host integration**

#### Rust responsibilities

Rust is the primary home for:

- macro transformation
- message extraction
- PO parsing and related catalog operations
- fallback and source-locale resolution
- message compilation
- plugin-facing compiled catalog output when generating that output in Rust reduces boundary churn
- other semantic i18n operations that are portable across hosts

#### TypeScript responsibilities

TypeScript remains the primary home for:

- config discovery and loading from the host project
- Vite integration
- Next.js integration
- file watching and HMR wiring
- CLI UX and filesystem orchestration
- adapting host requests into coarse native operations

#### Boundary rule

Rust/TypeScript boundaries must remain coarse-grained.

Preferred pattern:

- one coarse native call for one meaningful domain operation

Examples:

- transform one source file
- extract one source file
- load and compile one catalog request

Avoid:

- fine-grained helper calls across N-API
- large intermediate JSON structures when Rust can produce the final semantic result directly
- rebuilding the same semantic pipeline in TypeScript after native processing

### Non-Goals

Palamedes does **not** aim to:

- recreate the full Lingui package surface
- replace external integration surfaces that Palamedes does not currently need internally
- move bundler-specific integration code into Rust
- turn file watching, framework hooks, or other host-specific orchestration into native concerns

This architecture is intentionally lean. Only the Lingui-owned surfaces still referenced internally should be replaced.

### Initial Replacement Scope

The currently relevant internal Lingui surfaces are:

- `@lingui/core`
- `@lingui/conf`
- `@lingui/cli/api`

These should be replaced in a Palamedes-native way without broadening scope into a full ecosystem rewrite.

### Rationale

- Palamedes already has most of the important raw ingredients for a native-first i18n stack.
- Keeping semantic work in Rust reduces repeated implementation effort and lowers Rust/JS boundary costs.
- A Rust-first core keeps future non-JavaScript uses plausible without having to redesign the core later.
- TypeScript remains valuable where the host ecosystem is inherently JavaScript-centric: config discovery, bundler APIs, file watching, and CLI ergonomics.
- Lean ownership is better than broad emulation. Palamedes should own what it needs, not mirror every external package boundary.

### Consequences

- The Palamedes core should be treated as the main i18n engine, not as an optimization layer beneath a TypeScript-first design.
- Framework packages should increasingly become adapters over a native core instead of carrying semantic logic themselves.
- Runtime, config, and `.po` loading paths should move toward Palamedes-owned implementations.
- Future work should prefer extending native coarse-grained APIs over layering additional TypeScript semantics on top.
- Public roadmap and implementation work should be organized around capability ownership, not around one-to-one Lingui package replacement.

### Follow-Up

- define the Palamedes-owned runtime core that replaces the current `@lingui/core` dependency
- define a lean host-side config loading story that replaces `@lingui/conf`
- replace the current Lingui-based `.po` loading and compilation path in Vite and Next.js
- migrate examples, docs, CLI, and tests toward the Palamedes-first stack
