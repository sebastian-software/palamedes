# Ferrocat Alignment Design

Date: 2026-03-13

## Goal

Align Palamedes with a strict Rust-first ownership model:

- `ferrocat` is the only source of general gettext, PO, ICU, catalog, reference, header, plural, and message-ID semantics.
- `palamedes` keeps only Palamedes-specific product logic and OXC-based source processing.
- TypeScript remains a host integration layer and must not carry PO or catalog semantics.

This design is intentionally workflow-oriented and follows YAGNI:

- prefer a few coarse native operations over many low-level wrappers
- avoid exposing APIs in Palamedes that typical Palamedes users do not need
- only add new Rust surface area when a real Palamedes workflow requires it

## Current Problem

Palamedes already moved much of its hot path into Rust, but the ownership boundary is still inconsistent.

Today:

- general PO and catalog semantics still exist in TypeScript in [extract.ts](/Users/sebastian/Workspace/business/palamedes/packages/cli/src/commands/extract.ts)
- Palamedes Rust still depends directly on `pofile` instead of `ferrocat`
- `@palamedes/core-node` exposes only part of the native surface, which leaves the CLI using `pofile-ts`
- `getCatalogModule(...)` mixes host-neutral catalog semantics with Palamedes-specific loader orchestration

That leaves three undesirable outcomes:

- semantic ownership is split across Rust and TypeScript
- Palamedes still signals a TypeScript-first PO pipeline in parts of the repo
- the migration path toward a clear `ferrocat` + `palamedes` boundary remains implicit

## Decision

Adopt the following boundary:

### `ferrocat` owns

- PO parsing and serialization
- default headers
- references and origin formatting/parsing
- catalog item conversion
- catalog merge semantics
- ICU parsing and validation
- gettext-to-ICU normalization
- plural logic
- message-ID generation
- general catalog compilation primitives

### `palamedes` Rust owns

- OXC-based extraction
- OXC-based macro transformation
- Palamedes-specific catalog loading and bundler-facing workflows
- coarse workflow operations needed by the CLI, Vite, or Next.js integrations when those operations are not good general-purpose `ferrocat` APIs

### TypeScript owns

- config discovery and loading
- filesystem traversal and watch wiring
- bundler integration
- CLI UX and reporting
- calling coarse native operations

TypeScript must not own PO or catalog semantics.

## Non-Goals

- Mirroring the full `ferrocat` API from Palamedes
- Preserving existing Palamedes internal API shape for compatibility reasons
- Adding low-level JS wrappers preemptively "just in case"
- Publishing Palamedes APIs that normal Palamedes users do not need

## Gap Analysis

## 1. CLI extraction still owns PO/catalog semantics in TypeScript

The extraction command in [extract.ts](/Users/sebastian/Workspace/business/palamedes/packages/cli/src/commands/extract.ts) still does all of the following in TypeScript:

- parse existing `.po` files
- convert PO items to catalog structures
- merge extracted and existing catalogs
- create headers
- serialize back to PO

This violates the target ownership model.

### Required change

Replace the current TypeScript-side PO update flow with one coarse Rust operation.

Recommended direction:

- add a Palamedes-native workflow operation for extraction output handling
- keep the operation workflow-oriented rather than exposing a bag of low-level helpers

Candidate shape:

- `updateCatalog(request)` for one locale/catalog
- or `runExtraction(request)` for one configured extraction run

The recommended default is the smallest workflow-shaped operation that lets Palamedes remove all PO/catalog semantics from TypeScript.

## 2. Palamedes Rust still imports `pofile`

Palamedes Rust currently imports `pofile` directly in:

- [lib.rs](/Users/sebastian/Workspace/business/palamedes/crates/palamedes/src/lib.rs)
- [catalog_module.rs](/Users/sebastian/Workspace/business/palamedes/crates/palamedes/src/catalog_module.rs)

This should be renamed to `ferrocat` and treated as the canonical semantic dependency.

### Required change

- switch the Rust dependency from `pofile` to `ferrocat`
- update imports and naming throughout the Rust crates
- remove or rename `POFILE_VERSION` and `pofileVersion` so the surfaced metadata no longer refers to the old crate name

## 3. `@palamedes/core-node` is not shaped for the migration

The wrapper in [packages/core-node/src/index.ts](/Users/sebastian/Workspace/business/palamedes/packages/core-node/src/index.ts) currently exposes:

- native info
- message ID generation
- PO parse
- catalog module loading
- extraction
- transform

That is enough for some current flows, but not enough to eliminate all TypeScript-side semantic work.

### Required change

Do not expand `@palamedes/core-node` into a full `ferrocat` mirror.

Instead:

- expose only what Palamedes workflows actually need
- prefer one new coarse Palamedes-native workflow operation over several low-level wrappers
- keep low-level wrappers only where Palamedes already has a real package-level need

This preserves a small public surface while keeping semantics in Rust.

## 4. `getCatalogModule(...)` mixes host-neutral and product-specific concerns

The native catalog loader in [catalog_module.rs](/Users/sebastian/Workspace/business/palamedes/crates/palamedes/src/catalog_module.rs) currently combines:

- catalog parsing
- gettext-to-ICU normalization
- diagnostics generation
- fallback chain selection
- pseudo-locale handling
- config/resource matching
- watch file collection
- ESM module code generation

Some of that is general catalog domain logic. Some is clearly Palamedes-specific host orchestration.

### Required change

Split the logic by ownership rather than by current file boundaries.

Keep in Palamedes:

- matching a requested `.po` path against Palamedes config
- collecting watch files for Vite/Next.js
- returning Palamedes module code shape
- any output format tied to the Palamedes runtime contract

Move to Ferrocat only if the operation is host-neutral:

- generic catalog fallback-chain resolution
- generic diagnostics data structures for compilation and validation
- general-purpose catalog preparation/compilation primitives

Do not force this split all at once. Only move pieces to `ferrocat` when they form a real reusable semantic boundary.

## 5. Unused TypeScript dependencies still imply the wrong design

`pofile-ts` is still declared in:

- [packages/cli/package.json](/Users/sebastian/Workspace/business/palamedes/packages/cli/package.json)
- [packages/extractor/package.json](/Users/sebastian/Workspace/business/palamedes/packages/extractor/package.json)
- [packages/transform/package.json](/Users/sebastian/Workspace/business/palamedes/packages/transform/package.json)

But only the CLI currently uses it directly.

### Required change

- remove `pofile-ts` from extractor and transform immediately
- remove it from CLI once the workflow-oriented native replacement exists

## Recommended Migration Plan

## Phase 1: Establish the ownership boundary

1. Rename Palamedes Rust dependencies from `pofile` to `ferrocat`.
2. Remove obsolete naming such as `POFILE_VERSION` from surfaced metadata.
3. Remove unused `pofile-ts` dependencies from non-CLI packages.

Outcome:

- the repository reflects the intended semantic dependency
- dead dependency references stop signaling the wrong architecture

## Phase 2: Replace CLI TypeScript semantics with one coarse Rust workflow

1. Design one Palamedes-native extraction output operation in Rust.
2. Make that operation responsible for:
   - reading existing PO when needed
   - merging extracted messages
   - preserving translations
   - creating default headers
   - serializing final PO output
3. Reduce the CLI to:
   - discover files
   - parse source files
   - call extraction
   - call the workflow operation
   - write logs and handle watch mode

Outcome:

- no PO/catalog semantics remain in TypeScript for extraction

## Phase 3: Re-evaluate `getCatalogModule(...)`

1. Identify which parts are genuinely Palamedes-specific.
2. Keep Palamedes-specific loader orchestration in Palamedes.
3. Extract only host-neutral semantics to `ferrocat` if Palamedes proves a real need for reusable generic APIs.

Outcome:

- no premature generalization
- only genuine shared semantics move into `ferrocat`

## Phase 4: Tighten the Node boundary

1. Keep `@palamedes/core-node` small and workflow-driven.
2. Add only the native entry points Palamedes packages actually need.
3. Avoid 1:1 forwarding of broad low-level `ferrocat` APIs.

Outcome:

- Palamedes exposes a focused package surface
- Rust remains the only semantic engine

## Ferrocat Follow-Up Candidates

These should become issues only if Palamedes hits an actual reusable need.

### Candidate A: host-neutral catalog diagnostics

If Palamedes needs structured compile/validation diagnostics in multiple workflows, it may be worth defining a stable diagnostics model in `ferrocat`.

### Candidate B: generic fallback-chain resolution

If fallback resolution proves reusable outside Palamedes resource-path logic, `ferrocat` could own a host-neutral locale-chain helper.

### Candidate C: generic extracted-catalog application

If "apply extracted messages onto an existing catalog and serialize result" is broadly useful beyond Palamedes, it may belong in `ferrocat`. If it stays product-workflow-shaped, it should remain in Palamedes.

## Validation

The migration should be considered complete when:

- Palamedes TypeScript no longer implements PO or catalog semantics
- Palamedes Rust no longer depends on `pofile`
- `pofile-ts` is fully removed from the repo
- `@palamedes/core-node` stays small and workflow-oriented
- extraction, Vite, and Next.js continue to work through coarse native operations

## Success Criteria

- `ferrocat` is the only source of general i18n/catalog semantics
- Palamedes exposes only product-relevant APIs
- TypeScript acts only as host integration glue
- new native APIs are added only when a concrete workflow needs them
- no speculative low-level wrapper layer is introduced
