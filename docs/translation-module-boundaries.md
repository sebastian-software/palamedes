# Translation Module Boundaries

This document turns the translation workflow surface into concrete first modules and types for a Rust-first implementation.

It is not the hosted translation product contract. It is the local semantic substrate that a higher-order product can build on.

## Purpose

The existing workflow-surface document explains what belongs in Core at a high level. This document names the first implementable modules so a Rust port does not have to invent the structure from scratch.

## First Core modules

### `translation_candidates`

Responsibilities:

- select missing entries
- select targeted entries for re-run
- preserve source-locale and normal catalog semantics
- expose stable candidate identity for downstream retry and reporting

Primary type:

- `TranslationCandidate`

Suggested fields:

- `id`
- `locale`
- `source_text`
- `message_context`
- `comments`
- `origin_hints`

### `terminology`

Responsibilities:

- load glossary entries
- load protected terms
- normalize legacy and rich glossary forms
- select the relevant glossary subset for a batch

Primary types:

- `GlossaryEntry`
- `ProtectedTerm`

Suggested `GlossaryEntry` fields:

- `source`
- `preferred`
- `banned`
- `notes`
- `preserve_in_english`

Suggested `ProtectedTerm` fields:

- `value`
- optional `notes`
- optional `scopes`

### `qa`

Responsibilities:

- evaluate translated candidates
- emit deterministic issues
- classify retryable vs. review-only signals
- avoid known false positives around placeholders and inert literals

Primary type:

- `QaIssue`

Suggested fields:

- `code`
- `message`
- `severity`
- `retryable`
- `entry_id`

The issue model should be expressive enough to cover:

- structural problems
- terminology/protected-term issues
- review signals such as stale metadata

### `po_metadata`

Responsibilities:

- parse compact `#. AI ...` lines
- format metadata back into PO-safe form
- generate short translation hashes
- detect stale metadata

Primary type:

- `AiMetadata`

Suggested fields:

- `version`
- `model`
- `confidence`
- `status`
- `date`
- `hash`
- `issues`
- `risk_tags`

### `reports`

Responsibilities:

- represent flagged entries
- represent unresolved entries
- aggregate counts and top issue classes

Primary type:

- `TranslationReport`

Suggested fields:

- `locale`
- `translated_count`
- `retried_count`
- `unresolved_count`
- `flagged_items`
- `issue_counts`

### `workflow`

Responsibilities:

- batch-shaping helpers
- bounded orchestration primitives where host-neutral
- retry-oriented decision support

This module should stop short of auth, HTTP transport, or billing concerns.

## Type surface to preserve

The first public or semi-public Core surface should include:

- `TranslationCandidate`
- `GlossaryEntry`
- `ProtectedTerm`
- `QaIssue`
- `AiMetadata`
- `TranslationReport`

The purpose is not to freeze every field forever. The purpose is to prevent the rewrite from losing the current behavioral seams.

## Boundary rules

These modules belong in Core only while they remain:

- host-neutral
- local-workflow oriented
- independent of account or provider concerns

The following stay outside Core:

- remote translation execution
- auth and login
- provider/model routing
- billing and entitlement logic
- product-tier policy packs

## Relationship to the higher-order product

The higher-order product should be able to compose these Core modules into:

- project discovery
- request building
- remote translation calls
- retry coordination
- incremental writeback
- report emission

without re-implementing the semantic logic in a separate stack.
