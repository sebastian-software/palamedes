# ADR-022: Generated Catalogs Use Executable Message Functions

**Status:** Accepted
**Date:** 2026-08-01

## Context

Generated catalogs previously exposed only ICU strings, so the browser parsed
each dynamic message on first use. Attaching a second map of pre-parsed nodes
would remove parsing, but it would duplicate every dynamic message key and keep
an AST interpreter in the browser hot path.

Palamedes needs one generated representation that handles plain strings,
variables, formatters, plurals, selects, and rich-text tags across the Core,
React, and Solid renderers. Hand-written string catalogs must remain supported
without requiring a build step.

## Decision

Generated catalog modules export one branded message map:

- constant messages are string values
- dynamic messages are executable functions
- invalid or unsupported messages are functions that delegate to the existing
  lazy string parser, preserving diagnostics and fallback behavior

Message functions receive the lookup values and a small renderer interface.
They call named operations such as `value`, `number`, `plural`, `tag`, and
`join`; they do not return framework-specific values directly. Plural and
select branch functions and branch tables are hoisted to module scope so they
are allocated once rather than once per render.

Core, React, and Solid provide renderer implementations for their result types.
The same function therefore produces a string, React nodes, or Solid nodes.
Generated modules contain no parallel string/AST maps.

The catalog brand distinguishes generated constant strings from hand-written
ICU strings. An unbranded string catalog retains bounded lazy parsing. A copied
catalog loses the constant-string brand but remains correct; dynamic function
entries are still executable.

Ferrocat remains the Rust-side ICU parser. The Rust core lowers its AST into a
host-neutral message program, and the Node host boundary renders safe JavaScript
module source in accordance with ADR-011.

The native renderer is the single catalog-module generator. The public
TypeScript `renderCatalogModule()` compatibility helper delegates to that
renderer instead of parsing ICU and maintaining a second JavaScript generator.

## Alternatives Considered

### 1. Parallel string and pre-parsed-node maps

Rejected because it duplicates keys and dynamic message data, allocates AST
objects during module evaluation, and retains an interpreter in every runtime
renderer.

### 2. Replace message strings with serialized AST values

Rejected because it still requires runtime interpretation and makes even
constant messages structured data.

### 3. Generate framework-specific functions

Rejected because it would duplicate compiler semantics across Core, React, and
Solid. The renderer parameter keeps one compiler output portable across hosts.

### 4. Remove support for hand-written string catalogs

Rejected because small applications and runtime-loaded catalogs still benefit
from the existing lazy parser. Generated catalogs take the optimized path;
manual catalogs remain a supported fallback path.

## Consequences

- Generated dynamic messages execute directly without browser ICU parsing or
  AST traversal.
- Generated catalog values are `string | CompiledMessage`; consumers must not
  assume every generated value is JSON-serializable.
- Public `getMessageNodes()` remains available by parsing a reconstructed
  pattern on explicit calls, but first-party rendering neither parses ICU nor
  allocates nodes for compiled messages.
- The compiler owns safe JavaScript expression generation, including escaped
  literals, computed object keys, nested choices, and plural-pound semantics.
- Custom integrations loading generated modules must declare
  `@palamedes/core` as a direct runtime dependency because the module imports
  `defineCompiledCatalog()` from that package.
- Runtime and bundle benchmarks must cover both payload size and first-render
  execution before the representation is considered stable.
