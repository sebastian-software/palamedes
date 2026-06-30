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
- [ferrocat-cli 2.0.0](https://crates.io/crates/ferrocat-cli/2.0.0)
- [ferrocat v2 compare](https://github.com/sebastian-software/ferrocat/compare/ferrocat-v1.3.1...ferrocat-v2.0.0)
- [ferrocat-po v2 compare](https://github.com/sebastian-software/ferrocat/compare/ferrocat-po-v1.3.1...ferrocat-po-v2.0.0)

Version baseline: Palamedes currently pins `ferrocat` and `ferrocat-po` at
`1.3.1`. Upstream `1.3.2` tags exist, but this migration should be reviewed as
the real Palamedes dependency jump from `1.3.1` to `2.0.0`.

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
- Treat Ferrocat 2.0 as the catalog compatibility floor. Palamedes has no real
  external catalog users yet, so the implementation does not need to load,
  import, or preserve Ferrocat 1.x catalog content.
- Align Palamedes' public catalog data model with Ferrocat 2.0 origins and
  machine metadata.
- Preserve source extraction locations for diagnostics without serializing
  synthetic line numbers into catalogs.
- Decide the Palamedes release signal before implementation lands. Current
  Palamedes packages are `0.10.0`, so the default should be a breaking pre-1.0
  minor release with migration notes, not an automatic Palamedes `2.0.0`.

## Non-Goals

- Do not make FCL the default catalog format in this migration.
- Do not add an NDJSON compatibility shim. Existing public NDJSON surfaces
  should become FCL surfaces.
- Do not add Ferrocat 1.x catalog compatibility readers or best-effort loaders
  for old serialized catalog metadata.
- Do not mirror Ferrocat's full low-level API in Palamedes.
- Do not turn this plan into a durable ADR yet.
- Do not change runtime compiled message identity beyond what the storage
  format migration requires.
- Do not add reverse FCL-to-PO conversion in the initial migration. PO-to-FCL is
  the adoption workflow; an opt-out path needs a separate product decision.

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

## Relationship to ferrocat-cli

`ferrocat-cli` is now available as `ferrocat-cli` `2.0.0` on crates.io and
publishes a `ferrocat` binary.

The current Ferrocat CLI surface is useful, but intentionally narrower than the
Palamedes CLI surface:

- `ferrocat audit` audits explicitly supplied source and target catalogs.
- `--storage po|fcl` selects PO or FCL.
- `--format text|json` selects human-readable or structured output.
- Inputs are passed as `--source` and repeated `--target <locale=path>` values.
- It does not read `palamedes.yaml`.
- It does not run Palamedes extraction, report, compile, merge-driver, or
  PO-to-FCL conversion workflows.

This should shape the Palamedes migration in two ways:

- `pmds audit` remains the primary Palamedes command because it is config-aware
  and can stay aligned with Palamedes metadata, pseudo-locale, source-reference,
  and workflow conventions.
- Palamedes docs can mention `ferrocat audit` as an optional lower-level
  diagnostic tool for teams that want to inspect raw PO/FCL catalogs outside a
  Palamedes project.

Example optional raw-catalog audit:

```bash
cargo install ferrocat-cli --version 2.0.0
ferrocat audit \
  --source-locale en \
  --source src/locales/en.fcl \
  --target de=src/locales/de.fcl \
  --storage fcl \
  --format json
```

Do not make Palamedes depend on the external `ferrocat` binary for its own
implementation. Palamedes should continue to call Ferrocat libraries directly
through the Rust core so npm/native distribution remains self-contained.

## Compatibility Stance

Palamedes can be strict here. There are no real external Palamedes catalog users
yet, so the migration does not need a legacy content-loading story.

The implementation should:

- update checked-in fixtures, examples, generated snapshots, and docs to the new
  format model
- fail clearly on unsupported Ferrocat 1.x / NDJSON catalog inputs instead of
  silently coercing them
- keep PO as the default for newly generated Palamedes catalogs
- support PO and FCL only through Ferrocat 2.0 semantics
- avoid adding migration code whose only purpose is to read old Palamedes
  pre-release catalog output
- provide an explicit PO-to-FCL conversion path for supported current PO
  catalogs, because that is a real opt-in adoption workflow rather than a
  legacy loader

This keeps the migration smaller and makes review easier: any remaining
compatibility work must justify itself as an internal fixture/docs cleanup need,
not as a user-facing upgrade guarantee.

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

Palamedes always uses ICU semantics for PO catalogs. Ferrocat's `GettextPo`
mode remains a lower-level Ferrocat capability and is intentionally not exposed
through Palamedes config, CLI, N-API, or TypeScript surfaces in this migration.

## Breaking Changes to Absorb

| Area                   | Ferrocat 1.x / current Palamedes                                    | Ferrocat 2.0 direction                                                                                 | Palamedes migration                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalog format enum    | `Po`, `Ndjson`                                                      | `Po`, `Fcl`                                                                                            | Replace public `ndjson` / `Ndjson` with `fcl` / `Fcl`; no shim.                                                                                                    |
| Catalog mode           | PO hardcoded in many paths                                          | FCL has first-class mode                                                                               | Resolve `CatalogMode::IcuPo` or `CatalogMode::IcuFcl` from storage format.                                                                                         |
| PO semantics           | Palamedes treats PO as ICU-message PO                               | Ferrocat exposes both `IcuPo` and `GettextPo`                                                          | Keep Palamedes PO mapped to `IcuPo`; do not expose `GettextPo`.                                                                                                    |
| Legacy content loading | old pre-release Palamedes outputs may exist in fixtures or branches | Ferrocat 2.0 is the floor                                                                              | Update or delete old fixtures; do not implement v1 catalog readers.                                                                                                |
| Origins                | `file` plus optional line                                           | `file` plus optional `scope`                                                                           | Serialize origins as `file#scope`; expose parsed origins as `{ file, scope? }`.                                                                                    |
| Line numbers           | Render option could include line numbers                            | line-number serialization removed                                                                      | Keep extraction line data for diagnostics only; stop writing catalog line numbers.                                                                                 |
| Machine metadata       | `MachineTranslationMetadata { model, modified, confidence, hash }`  | `MachineMetadata { lock, ai? }`                                                                        | Expose `machine`; expose AI confidence as `0..1`, not percent.                                                                                                     |
| Obsolete state         | boolean-ish public usage                                            | `CatalogMessage.obsolete` is optional metadata                                                         | Treat parsed obsolete as `message.obsolete.is_some()`.                                                                                                             |
| Fuzzy audit/reporting  | high-level `fuzzy_flags` check and PO flag reporting                | fuzzy is not a catalog semantics concept, but raw PO flags are still parsed                            | Remove fuzzy audit and report semantics; use raw PO fuzzy detection only to reject unsupported conversion input before writing.                                    |
| Vector types           | plain `Vec` in several call sites                                   | `SmallVec` / `PoVec` internally                                                                        | Convert explicitly at the Palamedes boundary.                                                                                                                      |
| Obsolete metadata      | immediate mark/delete                                               | supports obsolete metadata such as `obsolete-since`; date-based cleanup keeps undated obsolete entries | Make `--clean` delete entries with `obsolete-since` at least 30 days old and keep undated obsolete entries; add `--force-clean` for deleting all obsolete entries. |
| Palamedes release      | all packages currently publish as `0.10.0`                          | public config, CLI, N-API, and TypeScript surfaces change                                              | Ship with explicit migration notes and release notes; choose the exact pre-1.0 minor or 1.0/2.0 vehicle before implementation.                                     |

## Public API Shape

### Rust Core

Introduce a Palamedes-owned storage enum instead of leaking path-extension
decisions through all call sites:

```rust
pub enum PalamedesCatalogFormat {
    Po,
    Fcl,
}
```

`CatalogConfig` should become:

```rust
pub struct CatalogConfig {
    pub path: String,
    pub format: PalamedesCatalogFormat,
}
```

Default format is `Po`.

Ferrocat 2.0 already exports `CatalogStorageFormat` and `CatalogFileFormat` from
`ferrocat-po`. Palamedes should wrap and map to those types internally, not
re-export them as Palamedes API contracts. The Palamedes-owned Rust names should
stay distinct so the N-API boundary does not confuse product config with
Ferrocat's lower-level storage types.

Public file-format APIs used by combine operations should expose a
Palamedes-owned enum:

```rust
pub enum PalamedesCatalogFileFormat {
    Po,
    Fcl,
}
```

This is a breaking replacement for `Ndjson`, not a compatibility alias. The
N-API and TypeScript package-facing names may remain `CatalogFileFormat` because
they live in the Palamedes package namespace, but conversion code must keep them
visibly separate from `ferrocat_po::CatalogFileFormat`.

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
`scope` should represent the named source container around a translation, such
as a component name, function name, or similar named authoring unit. It is not a
replacement for gettext context and should not be derived from `msgctxt` by
default. Ferrocat docs should clarify this contract separately; that follow-up
is tracked in [ferrocat#176](https://github.com/sebastian-software/ferrocat/issues/176).

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

Adopt age-based cleanup in this migration.

Rules:

- default extraction marks obsolete entries and records `obsolete-since`
- `--clean` deletes entries with `obsolete-since` at least 30 days old
- `--clean` keeps undated obsolete entries because Ferrocat's date-based cleanup
  cannot prove their age
- `--force-clean` deletes obsolete entries immediately, including undated ones
- the 30-day window is fixed for now, not configurable

This gives normal cleanup a safer default while still keeping an explicit
escape hatch for repositories that want immediate deletion.

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
- Remove or rewrite old fixtures that rely on Ferrocat 1.x serialized metadata
  instead of adding compatibility parsing.

### 2. Catalog Storage Abstraction

- Add `PalamedesCatalogFormat` to Rust core catalog config.
- Default the storage format to PO.
- Resolve configured catalog files with `.po` or `.fcl` based on format.
- Choose `CatalogMode::IcuPo` or `CatalogMode::IcuFcl` from the resolved format.
- Do not expose `CatalogMode::GettextPo` through Palamedes. If teams need
  gettext semantics later, that is a separate product surface.
- Apply this consistently to:
  - catalog artifact compilation
  - selected artifact compilation
  - extraction catalog updates
  - catalog parsing
  - audit loading
  - report paths where supported

Report handling needs a format-aware reader that derives translated and missing
counts through Ferrocat normalized parsed catalogs. Fuzzy should not be carried
forward as a high-level Palamedes report concept. It may still be detected from
raw PO parsing during conversion or audit entry-point validation so Palamedes can
reject unsupported fuzzy input before writing output.

### 3. CLI Migration

Update `pmds` behavior:

- config accepts `catalogs[].format: po | fcl`
- `pmds extract` writes `.po` by default and `.fcl` when configured
- `pmds extract --clean` removes dated obsolete entries that are at least 30
  days old and keeps undated obsolete entries
- `pmds extract --force-clean` removes all obsolete entries immediately
- `pmds audit` reads configured PO and FCL catalogs
- `pmds report` resolves configured PO and FCL paths
- `pmds catalog merge --format=fcl` is supported
- `.fcl` extension inference works for merge input and output paths
- `pmds catalog convert --to=fcl` converts supported PO catalogs to FCL while
  preserving translations
- `--format=ndjson` is removed
- configs with `format: ndjson` fail with a clear message such as:
  `format: ndjson is no longer supported; use format: fcl for Ferrocat Catalog Lines`
- pseudo-locale generation remains format-independent for PO and FCL catalogs

Add a catalog conversion workflow:

```bash
pmds catalog convert src/locales/de.po --to=fcl --output src/locales/de.fcl
pmds catalog convert --config palamedes.yaml --to=fcl
```

File mode converts one input catalog to one output catalog. Config mode converts
all configured catalog files for all configured locales from the current storage
format to the requested target format. Because Palamedes config paths are
extensionless, config mode can write `.fcl` files beside existing `.po` files
without deleting the originals.

Conversion rules:

- parse the source catalog through Ferrocat 2.0, not through a v1 compatibility
  reader
- preserve active source identities, target translations, contexts, plurals,
  comments, origins, obsolete metadata, and machine metadata where Ferrocat can
  represent them in the target format
- preserve source and target locale headers in the target format
- fail before writing output when the source contains fuzzy entries, because
  fuzzy is no longer a Palamedes/Ferrocat catalog semantics concept even though
  raw PO parsing can still detect the flag
- write atomically and leave the source catalog untouched
- print a summary of converted, skipped, and failed catalogs

Reverse FCL-to-PO conversion is intentionally out of scope for this migration.
If a team needs to move back from FCL to PO, that should be planned as a separate
workflow with its own data-loss expectations.

Config mode should print the required follow-up config change:

```yaml
catalogs:
  - path: src/locales/{locale}
    format: fcl
```

An automatic config rewrite can be added only if it can preserve the selected
config format well enough. It is not required for the initial migration command.

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
- remove raw PO fuzzy reporting from public Palamedes report semantics

### 5. Documentation

Update:

- `README.md`
- `docs/cli.md`
- `docs/api/config.md`
- `packages/cli/README.md`
- TypeScript package API docs if generated output is checked in

Documentation should say:

- PO remains default
- FCL is opt-in and worth using when teams want a canonical, generated,
  merge-friendly catalog format with cleaner machine-owned metadata
- `pmds audit` is the Palamedes-first audit command; `ferrocat audit` can be
  documented as an optional low-level raw-catalog diagnostic command
- NDJSON has been removed from Palamedes public APIs
- merge-driver examples use `.po` and `.fcl`
- `--clean` deletes dated obsolete entries older than the fixed 30-day window
- `--clean` keeps obsolete entries without `obsolete-since`
- `--force-clean` deletes obsolete entries immediately, including undated ones
- fuzzy is not part of the Palamedes/Ferrocat 2.0 catalog semantics model, but
  PO conversion can still reject raw fuzzy flags before writing output
- `pmds catalog convert --to=fcl` lets teams switch from PO to FCL while keeping
  their translations
- existing `format: ndjson` config should be changed to `format: fcl`

### 6. Tests

Add focused tests before relying on broad gates:

- PO remains the default when config omits `format`
- configured `format: fcl` writes `.fcl`
- FCL extraction round trip
- FCL audit round trip
- FCL compile round trip
- FCL merge round trip
- PO-to-FCL single-file conversion preserves translations, contexts, plurals,
  comments, origins, obsolete metadata, and machine metadata where representable
- PO-to-FCL config conversion writes `.fcl` files for all configured locales and
  leaves `.po` sources untouched
- PO-to-FCL conversion fails without writing output when the PO source contains
  fuzzy entries
- FCL-to-PO conversion is absent and documented as out of scope
- config `format: ndjson` fails with an error that suggests `format: fcl`
- pseudo-locale generation works with configured `format: fcl`
- `.fcl` merge format inference
- `CatalogFileFormat` no longer accepts NDJSON
- unsupported Ferrocat 1.x / NDJSON catalog inputs fail clearly where they enter
  Palamedes public workflows
- origins serialize as `file#scope`
- parsed catalog origins expose `{ file, scope? }`
- source extraction still keeps line data for diagnostics and stable sorting
- machine `lock` round trip
- AI provenance round trip
- AI confidence remains `0..1`
- stale machine metadata is dropped
- `--clean` deletes dated obsolete entries older than the fixed 30-day window
- `--clean` keeps undated obsolete entries
- `--force-clean` immediately deletes obsolete entries
- `--force-clean` deletes undated obsolete entries
- `obsolete-since` metadata round trip
- fixed 30-day obsolete cleanup
- raw PO fuzzy flags are not exposed through report behavior
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

Optional cross-check:

```bash
cargo install ferrocat-cli --version 2.0.0
ferrocat audit \
  --source-locale en \
  --source <source.fcl> \
  --target de=<target.fcl> \
  --storage fcl \
  --format json
```

This is a diagnostic comparison only. It must not replace Palamedes' own
config-aware test coverage.

## Rollout Strategy

1. Land the Rust dependency and compile-only API migration with current PO
   workflow behavior preserved for newly generated catalogs.
2. Add `PalamedesCatalogFormat` and format-aware catalog resolution.
3. Add FCL through extraction, audit, compile, parse, and merge.
4. Update N-API and TypeScript wrappers.
5. Add PO-to-FCL conversion for single files and configured catalog sets.
6. Replace docs, examples, fixtures, and generated snapshots that still reflect
   Ferrocat 1.x / NDJSON output.
7. Add fixed 30-day obsolete cleanup and immediate `--force-clean`.
8. Decide and document the Palamedes release vehicle, changelog entry, and
   migration notes before publishing.
9. Run the full validation matrix before publishing.

## Risks and Mitigations

| Risk                                                           | Mitigation                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FCL support becomes a leaky Ferrocat mirror                    | Keep public APIs workflow-shaped and config-driven.                                                                                                                             |
| Users are confused by `pmds audit` and `ferrocat audit`        | Document `pmds` as the project/config-aware workflow and `ferrocat` as an optional raw-catalog diagnostic.                                                                      |
| PO default behavior regresses while changing the storage layer | Test PO default paths before FCL-specific tests.                                                                                                                                |
| Legacy compatibility code bloats the migration                 | Treat Ferrocat 2.0 as the compatibility floor and update old fixtures instead of reading them.                                                                                  |
| FCL adoption is too hard for existing PO catalogs              | Provide explicit PO-to-FCL conversion that preserves translations without adding transparent legacy loading.                                                                    |
| Parsed origins lose useful diagnostic data                     | Keep extraction line/column data in extraction diagnostics and update requests; only parsed catalog origins drop line numbers.                                                  |
| Machine metadata semantics are misunderstood                   | Rename the public field to `machine` and document `lock` / `ai` separately from translation content.                                                                            |
| Fuzzy removal looks like a regression                          | Document that fuzzy is not high-level catalog semantics anymore, while conversion still rejects raw PO fuzzy flags before writing.                                              |
| Obsolete cleanup policy becomes implicit                       | Make `--clean` fixed 30-day cleanup for dated obsolete entries, document that undated obsolete entries are kept, and reserve `--force-clean` for deleting all obsolete entries. |
| TypeScript generated and wrapper types drift                   | Regenerate native types and keep wrapper conversion tests for `po` / `fcl`.                                                                                                     |
| Breaking changes are under-communicated                        | Follow `docs/stability.md`: publish migration notes and release notes even during pre-1.0.                                                                                      |

## Resolved Follow-Up Decisions

- `scope` means the named source container around a translation, such as a
  component or function. It is not derived from `msgctxt` by default.
- Palamedes-owned Rust format enums wrap Ferrocat types instead of re-exporting
  `ferrocat_po::CatalogStorageFormat` or `ferrocat_po::CatalogFileFormat`.
- Palamedes PO means `IcuPo`; `GettextPo` is intentionally not exposed.
- Fuzzy is removed from Palamedes audit and report semantics, but raw PO fuzzy
  flags can still be detected to reject unsupported conversion input.
- `--clean` is fixed 30-day obsolete cleanup for entries with `obsolete-since`
  and keeps undated obsolete entries.
- `--force-clean` is immediate obsolete cleanup, including undated obsolete
  entries.
- FCL should be marketed positively in docs, including its canonical,
  merge-friendly generated format and machine-metadata advantages, while PO
  remains the first-run default.
- PO-to-FCL conversion is in scope as an explicit adoption workflow.
- FCL-to-PO conversion is out of scope for the initial migration.
- Pseudo-locale generation must work the same way for PO and FCL catalogs.
- Palamedes does not automatically become `2.0.0`; the release vehicle must
  follow the pre-1.0 stability policy and include migration notes.

## Acceptance Criteria

- `ferrocat`, `ferrocat-po`, and `ferrocat-icu` resolve to `2.0.0`.
- `FERROCAT_VERSION` reports `2.0.0`.
- Public Palamedes APIs expose `fcl` / `Fcl`, not `ndjson` / `Ndjson`.
- Palamedes has no Ferrocat 1.x catalog loader or NDJSON compatibility shim.
- Configured catalogs default to PO and can opt into FCL.
- Palamedes PO maps to `IcuPo`; `GettextPo` is not exposed.
- Existing `format: ndjson` config fails with a diagnostic that suggests
  `format: fcl`.
- CLI merge supports `--format=fcl` and `.fcl` inference.
- CLI conversion supports single-file and config-wide PO-to-FCL migration while
  preserving translations.
- CLI does not expose reverse FCL-to-PO conversion in this migration.
- Extraction, audit, compile, parse, and merge work for FCL.
- Pseudo-locale generation works for FCL.
- Parsed origins expose `{ file, scope? }`.
- Source extraction still retains line data for diagnostics and stable output.
- Machine metadata exposes `MachineMetadata { lock, ai? }`.
- AI confidence is represented as `0..1`.
- `fuzzyFlags` is removed from high-level audit options.
- Raw PO fuzzy report behavior is removed.
- `--clean` performs fixed 30-day obsolete cleanup.
- `--clean` keeps undated obsolete entries.
- `--force-clean` performs immediate obsolete cleanup.
- `--force-clean` deletes undated obsolete entries.
- Obsolete metadata behavior is deliberate and tested in the first migration.
- The release includes migration notes and release notes for the breaking public
  surface changes.
- Full Rust and TypeScript validation passes.
