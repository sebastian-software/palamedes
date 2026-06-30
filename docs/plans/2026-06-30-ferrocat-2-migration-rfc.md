# RFC: Ferrocat 2.0 Migration

**Status:** Active plan
**Date:** 2026-06-30
**Owner:** Palamedes maintainers

## Summary

Palamedes should migrate from Ferrocat `1.3.1` to Ferrocat `2.0.0` as a
product migration, not as a minimal compatibility patch.

The recommended direction is to make Ferrocat Catalog Lines (FCL) a public
opt-in storage format while keeping gettext PO as the default catalog format.
That means `.po` remains the shortest path for existing users and docs, but
FCL becomes an explicitly supported storage option across the Rust core, CLI,
N-API boundary, TypeScript wrapper, tests, and documentation.

Primary sources:

- [ferrocat 2.0.0](https://crates.io/crates/ferrocat/2.0.0)
- [ferrocat-po 2.0.0](https://crates.io/crates/ferrocat-po/2.0.0)
- [ferrocat v2 compare](https://github.com/sebastian-software/ferrocat/compare/ferrocat-v1.3.2...ferrocat-v2.0.0)
- [ferrocat-po v2 compare](https://github.com/sebastian-software/ferrocat/compare/ferrocat-po-v1.3.2...ferrocat-po-v2.0.0)

Compatibility probe:

- A scratch migration against `origin/main` found that, after the mechanical
  Ferrocat 2.0 API adaptations, `cargo check --workspace --locked` passes.
- The main risk is therefore API and product-shape correctness, not unknown
  compiler breakage.

## Goals

- Upgrade `ferrocat`, `ferrocat-po`, and `ferrocat-icu` to `2.0.0`.
- Update `FERROCAT_VERSION`, `Cargo.lock`, and native type output.
- Replace public `ndjson` / `Ndjson` catalog file format surfaces with
  `fcl` / `Fcl`.
- Keep PO as the default catalog format.
- Add a catalog storage abstraction so configured catalogs can resolve as PO or
  FCL.
- Expose FCL as an opt-in public format for extraction, audit, compilation,
  merge, and host APIs.
- Align Palamedes' public catalog data model with Ferrocat 2.0 origins and
  machine metadata.
- Preserve source extraction locations for diagnostics without serializing
  synthetic line numbers into catalogs.

## Non-Goals

- Do not make FCL the default catalog format in this migration.
- Do not add an NDJSON compatibility shim. Existing public NDJSON surfaces
  should become FCL surfaces.
- Do not mirror Ferrocat's full low-level API in Palamedes.
- Do not turn this plan into a durable ADR yet.
- Do not change runtime compiled message identity beyond what the storage
  format migration requires.

## Architectural Position

ADR-006 remains the foundation: Ferrocat owns generic catalog and ICU
semantics, while Palamedes owns product-shaped orchestration, framework
integration, config, source extraction, and runtime module generation.

FCL support fits ADR-006 because it is a Ferrocat catalog-storage concern.
Palamedes should expose it only through Palamedes-shaped workflows:

- configured catalog storage format
- CLI extraction and merge behavior
- artifact compilation and audit
- N-API and TypeScript workflow APIs
- docs and examples

FCL storage policy and machine lock / AI provenance may later deserve an ADR
if they become durable product policy. For now, this document should stay under
`docs/plans` as an active implementation plan.

## Recommended Product Decision

Adopt FCL as an explicit supported storage format.

PO remains default:

```yaml
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

FCL is opt-in:

```yaml
catalogs:
  - path: src/locales/{locale}
    format: fcl
    include: [src]
```

The path remains extensionless in config. Palamedes resolves the extension from
the configured storage format:

| Storage format | Config value | File extension | Ferrocat mode |
| -------------- | ------------ | -------------- | ------------- |
| PO             | `po`         | `.po`          | `IcuPo`       |
| FCL            | `fcl`        | `.fcl`         | `IcuFcl`      |

## Breaking Changes to Absorb

| Area | Ferrocat 1.x / current Palamedes | Ferrocat 2.0 direction | Palamedes migration |
| ---- | -------------------------------- | ---------------------- | ------------------- |
| Catalog format enum | `Po`, `Ndjson` | `Po`, `Fcl` | Replace public `ndjson` / `Ndjson` with `fcl` / `Fcl`; no shim. |
| Catalog mode | PO hardcoded in many paths | FCL has first-class mode | Resolve `CatalogMode::IcuPo` or `CatalogMode::IcuFcl` from storage format. |
| Origins | `file` plus optional line | `file` plus optional `scope` | Serialize origins as `file#scope`; expose parsed origins as `{ file, scope? }`. |
| Line numbers | Render option could include line numbers | line-number serialization removed | Keep extraction line data for diagnostics only; stop writing catalog line numbers. |
| Machine metadata | `MachineTranslationMetadata { model, modified, confidence, hash }` | `MachineMetadata { lock, ai? }` | Expose `machine`; expose AI confidence as `0..1`, not percent. |
| Obsolete state | boolean-ish public usage | `CatalogMessage.obsolete` is optional metadata | Treat parsed obsolete as `message.obsolete.is_some()`. |
| Fuzzy audit | high-level `fuzzy_flags` check | removed from high-level audit checks | Remove high-level audit support; keep raw PO fuzzy reporting where PO flags are parsed directly. |
| Vector types | plain `Vec` in several call sites | `SmallVec` / `PoVec` internally | Convert explicitly at the Palamedes boundary. |
| Obsolete metadata | immediate mark/delete | supports obsolete metadata such as `obsolete-since` | Add explicit age-based cleanup option later in this migration; preserve `--clean` as immediate delete. |

## Public API Shape

### Rust Core

Introduce a Palamedes storage enum instead of leaking path-extension decisions
through all call sites:

```rust
pub enum CatalogStorageFormat {
    Po,
    Fcl,
}
```

`CatalogConfig` should become:

```rust
pub struct CatalogConfig {
    pub path: String,
    pub format: CatalogStorageFormat,
}
```

Default format is `Po`.

Public file-format APIs used by combine operations should expose:

```rust
pub enum CatalogFileFormat {
    Po,
    Fcl,
}
```

This is a breaking replacement for `Ndjson`, not a compatibility alias.

### Origins

Keep two concepts separate:

```rust
pub struct CatalogUpdateOrigin {
    pub file: String,
    pub line: u32,
    pub scope: Option<String>,
}

pub struct CatalogOrigin {
    pub file: String,
    pub scope: Option<String>,
}
```

`CatalogUpdateOrigin` is extraction-facing and keeps line data for diagnostics,
sorting, and developer feedback.

`CatalogOrigin` is parsed-catalog-facing and reflects what is stored in the
catalog after Ferrocat 2.0: `file#scope`, not synthetic source line numbers.

When projecting extracted messages into Ferrocat update input:

- `file` maps to Ferrocat origin `file`
- `scope` maps to Ferrocat origin `scope`
- `line` is not serialized into the catalog

### Machine Metadata

Replace Palamedes' old high-level machine translation type with Ferrocat 2.0's
model:

```rust
pub struct MachineMetadata {
    pub lock: String,
    pub ai: Option<AiProvenance>,
}

pub struct AiProvenance {
    pub model: String,
    pub confidence: Option<f32>,
}
```

Rules:

- `confidence` is a unit interval value from `0.0` to `1.0`.
- Do not expose a percent-scale `confidence`.
- Preserve valid machine metadata on catalog updates.
- Drop stale machine metadata when the lock no longer matches the current
  translation payload.
- Rename public parsed-message field from `machineTranslation` to `machine`.

### Obsolete Metadata

Preserve current behavior:

- default extraction marks obsolete entries
- `--clean` deletes obsolete entries immediately

Add a deliberate cleanup path for Ferrocat 2.0 obsolete metadata:

- support `obsolete-since`
- add an explicit update / CLI option for age-based cleanup
- do not overload `--clean`; it remains immediate delete

Proposed CLI name:

```bash
pmds extract --clean-obsolete-older-than 90d
```

The exact duration syntax can be decided during implementation, but the option
must be explicit and test-covered.

## Implementation Plan

### 1. Rust Dependency and Core API Pass

- Upgrade `ferrocat`, `ferrocat-po`, and `ferrocat-icu` to `2.0.0`.
- Update `FERROCAT_VERSION` to `2.0.0`.
- Run the lockfile update.
- Replace removed imports and type names.
- Convert `SmallVec` / `PoVec` values into Palamedes public `Vec` values at the
  API boundary.
- Replace `CatalogMessage.obsolete` boolean assumptions with
  `CatalogMessage.obsolete.is_some()`.
- Replace `message.machine_translation` with `message.machine`.
- Remove `include_line_numbers` usage.
- Add the new parsed `CatalogOrigin { file, scope? }` type.
- Keep extraction-origin line data internal to extraction/update request paths.

### 2. Catalog Storage Abstraction

- Add `CatalogStorageFormat` to Rust core catalog config.
- Default the storage format to PO.
- Resolve configured catalog files with `.po` or `.fcl` based on format.
- Choose `CatalogMode::IcuPo` or `CatalogMode::IcuFcl` from the resolved format.
- Apply this consistently to:
  - catalog artifact compilation
  - selected artifact compilation
  - extraction catalog updates
  - catalog parsing
  - audit loading
  - report paths where supported

Report handling needs special care because current report logic reads raw PO
flags for fuzzy counts. The migration should either:

- keep fuzzy counts as a PO-only report feature and document that FCL reports do
  not expose fuzzy counts, or
- add a format-aware report reader that can derive translated / missing counts
  through Ferrocat normalized parsed catalogs while keeping PO-only fuzzy counts.

The second option is preferred because it keeps `pmds report` useful for FCL.

### 3. CLI Migration

Update `pmds` behavior:

- config accepts `catalogs[].format: po | fcl`
- `pmds extract` writes `.po` by default and `.fcl` when configured
- `pmds audit` reads configured PO and FCL catalogs
- `pmds report` resolves configured PO and FCL paths
- `pmds catalog merge --format=fcl` is supported
- `.fcl` extension inference works for merge input and output paths
- `--format=ndjson` is removed

Update merge docs from NDJSON to FCL:

```gitattributes
*.po merge=palamedes-catalog
*.fcl merge=palamedes-catalog-fcl
```

```bash
git config merge.palamedes-catalog.driver \
  'pmds catalog merge --format=po --conflict-strategy=use-first --output %A %A %B'
git config merge.palamedes-catalog-fcl.driver \
  'pmds catalog merge --format=fcl --conflict-strategy=use-first --output %A %A %B'
```

### 4. N-API and TypeScript Migration

Regenerate and then review native type output.

N-API enum:

```ts
export type CatalogFileFormat = "Po" | "Fcl"
```

Public TypeScript wrapper:

```ts
export type CatalogFileFormat = "po" | "fcl"
```

TypeScript and N-API surfaces must also change:

- add catalog config `format?: "po" | "fcl"`
- split update origins from parsed catalog origins
- expose parsed origins as `{ file: string; scope?: string }`
- expose update origins as `{ file: string; line: number; scope?: string }`
- rename machine metadata to `machine`
- expose `MachineMetadata { lock, ai? }`
- expose AI confidence as `number` in `0..1`
- remove `fuzzyFlags` from high-level audit check options
- keep raw PO fuzzy reporting where Palamedes still parses PO flags directly

### 5. Documentation

Update:

- `README.md`
- `docs/cli.md`
- `docs/api/config.md`
- `packages/cli/README.md`
- TypeScript package API docs if generated output is checked in

Documentation should say:

- PO remains default
- FCL is opt-in
- NDJSON has been removed from Palamedes public APIs
- merge-driver examples use `.po` and `.fcl`
- `--clean` deletes immediately
- age-based obsolete cleanup is an explicit option if implemented in this
  migration

### 6. Tests

Add focused tests before relying on broad gates:

- PO remains the default when config omits `format`
- configured `format: fcl` writes `.fcl`
- FCL extraction round trip
- FCL audit round trip
- FCL compile round trip
- FCL merge round trip
- `.fcl` merge format inference
- `CatalogFileFormat` no longer accepts NDJSON
- origins serialize as `file#scope`
- parsed catalog origins expose `{ file, scope? }`
- source extraction still keeps line data for diagnostics and stable sorting
- machine `lock` round trip
- AI provenance round trip
- AI confidence remains `0..1`
- stale machine metadata is dropped
- `--clean` still immediately deletes obsolete entries
- `obsolete-since` metadata round trip
- age-based obsolete cleanup, if included in this migration
- raw PO fuzzy report behavior remains covered
- high-level audit no longer exposes `fuzzyFlags`

## Validation Plan

Rust:

```bash
cargo fmt --all --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

Native / TypeScript:

```bash
pnpm build
pnpm test
pnpm check-types
pnpm lint
pnpm format:check
```

Type generation:

- regenerate native TypeScript bindings after Rust N-API changes
- review the generated diff manually
- ensure generated native enum output is `"Po" | "Fcl"`
- ensure public wrapper output is `"po" | "fcl"`

## Rollout Strategy

1. Land the Rust dependency and compile-only API migration with PO behavior
   preserved.
2. Add `CatalogStorageFormat` and format-aware catalog resolution.
3. Add FCL through extraction, audit, compile, parse, and merge.
4. Update N-API and TypeScript wrappers.
5. Replace docs and examples.
6. Add obsolete metadata cleanup support if the first five steps remain small
   enough to review safely; otherwise split it into a follow-up PR.
7. Run the full validation matrix before publishing.

## Risks and Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| FCL support becomes a leaky Ferrocat mirror | Keep public APIs workflow-shaped and config-driven. |
| Existing PO users see behavior drift | Test PO default paths before FCL-specific tests. |
| Parsed origins lose useful diagnostic data | Keep extraction line/column data in extraction diagnostics and update requests; only parsed catalog origins drop line numbers. |
| Machine metadata semantics are misunderstood | Rename the public field to `machine` and document `lock` / `ai` separately from translation content. |
| Fuzzy audit removal looks like a regression | Preserve raw PO fuzzy reporting in `pmds report`; remove only the high-level Ferrocat audit toggle. |
| Obsolete cleanup policy becomes implicit | Keep `--clean` unchanged and make age-based cleanup an explicit option. |
| TypeScript generated and wrapper types drift | Regenerate native types and keep wrapper conversion tests for `po` / `fcl`. |

## Open Questions

- Should `scope` be derived from message context by default, or should it stay
  empty until Palamedes has a product-level scope concept?
- Should `pmds report` expose `fuzzy: 0` for FCL, omit fuzzy data, or mark it as
  not applicable in JSON output?
- What duration syntax should age-based obsolete cleanup use: `90d`, ISO-8601
  durations, or a numeric day count?
- Should FCL examples live beside PO examples in first-run docs, or only in
  advanced CLI/config docs until adoption is proven?

## Acceptance Criteria

- `ferrocat`, `ferrocat-po`, and `ferrocat-icu` resolve to `2.0.0`.
- `FERROCAT_VERSION` reports `2.0.0`.
- Public Palamedes APIs expose `fcl` / `Fcl`, not `ndjson` / `Ndjson`.
- Configured catalogs default to PO and can opt into FCL.
- CLI merge supports `--format=fcl` and `.fcl` inference.
- Extraction, audit, compile, parse, and merge work for FCL.
- Parsed origins expose `{ file, scope? }`.
- Source extraction still retains line data for diagnostics and stable output.
- Machine metadata exposes `MachineMetadata { lock, ai? }`.
- AI confidence is represented as `0..1`.
- `fuzzyFlags` is removed from high-level audit options.
- Raw PO fuzzy report behavior remains intact.
- Obsolete metadata behavior is deliberate and tested.
- Full Rust and TypeScript validation passes.
