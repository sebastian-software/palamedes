# ADR-004: Generated Catalogs Use Executable Message Functions

**Status:** Accepted

**Last updated:** 2026-10-19

Generated catalogs contain literal strings and executable message functions shared by Core, React, and Solid.

## Decision

Generated catalog modules export one branded message map:

- constant messages are string values
- dynamic messages are executable functions

This representation is the JavaScript runtime contract on both server and client.
ICU parsing belongs to authoring, validation, and compilation, not application
message rendering. Generated code must not defer unsupported or invalid ICU
to a runtime parser. Invalid ICU and ICU constructs outside the supported
compiler/runtime subset are fatal compilation errors in both development and
production, for source messages and translations alike. Diagnostics identify
the affected catalog, locale, and source message. No adapter option may downgrade
these failures to successful compilation or emit a lazy-parser substitute.

A missing translation is not an invalid message. By default, compilation
resolves it through the configured fallback locale chain and ultimately the
source message, then compiles that result using the same message representation.
Variables, plurals, and rich text retain their compiled semantics without a
runtime parser. The missing target-locale translation remains observable in
diagnostics; `failOnMissing` may enforce translation completeness even when a
valid fallback exists. Invalid or unsupported fallback messages still fail
compilation under the rule above.

This build-time translation fallback is distinct from failure to deliver a
compiled fragment at runtime. Failed delivery and unexpected missing compiled
entries must reach host error handling rather than render substitute source
text or internal keys, as specified in ADR-020. Concrete adapter integration
and recovery mechanics are described in [ADR-008](008-framework-adapter-architecture.md)
and the [v2 migration guide](../docs/migration-v2.md).

Message functions receive the lookup values and a small renderer interface.
They call named operations such as `value`, `number`, `plural`, `tag`, and
`join`; they do not return framework-specific values directly. Plural and
select branch functions and branch tables are hoisted to module scope so they
are allocated once rather than once per render.

Core, React, and Solid provide renderer implementations for their result types.
The same function therefore produces a string, React nodes, or Solid nodes.
Generated modules contain no parallel string/AST maps.

The catalog brand identifies generated catalog maps, including their constant
strings. Constant strings in a compiled catalog are already compiled literal
messages; they are not ICU patterns to interpret at runtime. Applications must
preserve the generated catalog contract when loading complete catalogs or
fragments. Uncompiled ICU maps are not an alternative runtime input.

Ferrocat remains the Rust-side ICU parser. The Rust core lowers its AST into a
host-neutral message program, and the Node host boundary renders safe JavaScript
module source in accordance with ADR-019.

The native renderer is the single catalog-module generator. The public
TypeScript `renderCatalogModule()` compatibility helper delegates to that
renderer instead of parsing ICU and maintaining a second JavaScript generator.

### External Rust catalogs

Rust applications use externally delivered compiled instruction data. They do
not embed a mandatory language, including English. Cargo build integration
generates source-first macro definitions and a message schema; Rust itself
expands the calls into internal-ID lookups. The same semantic compiler lowers
catalogs into a Rust-specific data artifact, and a small parser-free runtime
validates and evaluates those instructions. Application hosts own delivery and
locale selection. Missing or incompatible assets reach host error handling.

This deliberately differs from the JavaScript executable-module ABI: native
Rust functions cannot be delivered as ordinary portable data files. Keeping
translations external avoids recompiling or growing every executable for each
language. The cost is a versioned instruction format and a Rust evaluator.
PO and ICU parsing still happen only at build time. This does not introduce an
AST-map alternative to the existing JavaScript ABI.

Rust compilation follows the same build-time fallback default: missing or fuzzy
target translations resolve through the configured chain and source locale/message.
The compiler reports those resolutions; `fail_on_missing(true)` opts into strict
completeness. The native `pmds` UI explicitly enables strictness for its core
languages. These are compiler policies; failed runtime catalog delivery still
never substitutes a source message or another language.

An application build exports a source-free message contract and fingerprint.
`pmds catalog compile --target rust` compiles PO updates against that contract
without invoking the application build. It validates all inputs and compatibility
before replacing selected language files. Changed message identities, argument
signatures, or literal/program shape require a matching application build.

The experimental Rust target has an explicit compiler/runtime subset. It rejects
unsupported constructs at compilation rather than interpreting ICU at runtime.
Integration and current limits belong in the [Rust applications guide](../docs/rust-applications.md).

## Context

Raw ICU strings require parsing during execution. A parallel map of pre-parsed
nodes would avoid that parse but duplicate dynamic message keys and retain an
AST interpreter. One executable representation avoids both costs.

Palamedes needs one generated representation that handles plain strings,
variables, formatters, plurals, selects, and rich-text tags across the Core,
React, and Solid renderers. Palamedes' supported application model is message
authoring through macros and supported extraction, translation in source
catalogs, and compilation before execution. Runtime interpretation of
uncompiled ICU catalogs is not a separate supported application model.

## Alternatives Considered

### 1. Parallel string and pre-parsed-node maps

Rejected because it duplicates keys and dynamic message data, allocates AST
objects during module evaluation, and retains an interpreter in every runtime
renderer.

### 2. Replace message strings with serialized AST values

Rejected for JavaScript because it still requires runtime interpretation and makes even
constant messages structured data.

### 3. Generate framework-specific functions

Rejected because it would duplicate compiler semantics across Core, React, and
Solid. The renderer parameter keeps one compiler output portable across hosts.

### 4. Retain runtime support for uncompiled ICU catalogs

Rejected because it adds a second execution model outside Palamedes' intended
extraction, translation, and compilation workflow. Small applications can load a complete compiled catalog
without needing a runtime parser.

## Consequences

- Generated dynamic messages execute directly without server or client ICU parsing or
  AST traversal.
- Generated catalog values are `string | CompiledMessage`; consumers must not
  assume every generated value is JSON-serializable.
- Runtime parser and parsed-node inspection APIs stay outside the public
  application runtime contract. Build-time tooling may still
  parse ICU and inspect its representation.
- The compiler owns safe JavaScript expression generation, including escaped
  literals, computed object keys, nested choices, and plural-pound semantics.
- Custom integrations loading generated modules must declare
  `@palamedes/core` as a direct runtime dependency because the module imports
  `defineCompiledCatalog()` from its `compiled` entrypoint.
- Runtime and bundle benchmarks must cover both payload size and first-render
  execution when the generated representation changes.
- ADR-005 applies the parser-free contract to the complete public application
  runtime, including package-root imports.

## Validation

The [catalog-delivery evidence report](../benchmarks/catalog-delivery/README.md)
records parser-free artifacts, browser delivery, server catalog reuse, and host
failure checks. The [v2 migration guide](../docs/migration-v2.md) owns legacy
API replacements; release status belongs in the release policy and tracker.
