# Translation Candidates and Patches

Palamedes Core exposes a provider-neutral boundary for finding local translation
work and writing completed translations back to repository-owned catalogs. The
API is available from Rust and through `@palamedes/core-node`.

It deliberately does not choose a translation provider, authenticate remote
requests, build prompts, or decide whether a translation is linguistically
acceptable. A CLI, editor, hosted workflow, or local script can own those
choices while sharing the same catalog semantics.

## Enumerating candidates

`listTranslationCandidates()` scans every configured non-source locale by
default and returns active entries whose target value is missing. Pass
`targets` to select exact translated, fuzzy, or obsolete entries for a re-run or
review instead.

The source locale is never a translation target, including when it is named in
an explicit locale request. Default enumeration skips a configured target whose
catalog has not been created yet and emits a `translation.missing_catalog`
diagnostic with `locale` and `catalogPath`; run `pmds extract` to create it.
An explicitly requested missing target remains a hard read error so a caller
cannot mistake an incomplete requested scope for an empty result.

Every candidate includes:

- a stable identity consisting of catalog scope, locale, source message, and
  optional context;
- a resolved target path and storage format;
- singular content or structured top-level ICU plural branches;
- extracted comments and a bounded origin list;
- translated, fuzzy, and obsolete state;
- native Ferrocat machine provenance when present; and
- a per-entry fingerprint for optimistic concurrency control.

The fingerprint covers the candidate's source, current target, complete origin
state, relevant metadata, and review state. The `maxOrigins` response limit
only affects the displayed origin list, never the fingerprint. An unrelated
entry can therefore be written in an earlier incremental batch without
invalidating the remaining candidates.

Fingerprint payload changes are versioned. When upgrading across a fingerprint
version, discard in-flight candidates and list them again before patching.

## Applying completed translations

`applyTranslationPatches()` validates the complete request before writing any
catalog. Unknown or ambiguous catalogs, unknown messages, duplicate identities,
stale fingerprints, shape mismatches, invalid ICU plural branches, and invalid
provenance are returned as structured diagnostics with the rejected patch
identity. A rejected validation batch leaves every original catalog unchanged.
Source-locale patch identities are likewise rejected as
`translation.source_locale`, before any catalog write.

On success, Palamedes preserves unrelated translations, comments, origins,
flags, obsolete entries, and PO headers. Each changed PO or FCL file is replaced
atomically through Ferrocat's format-aware writer. A batch spanning several
files has per-file atomicity; it is not a filesystem transaction across files.
If a later replacement fails, the call still returns a hard error. Rust callers
can recover the completed per-file outcomes from
`PalamedesError::translation_patch_result()`; remaining patches are reported as
`notApplied`. Node callers receive an `Error` with code
`ERR_PALAMEDES_TRANSLATION_PATCH_WRITE`; its `report` property is the completed
`TranslationPatchResult`, and its `cause` describes the failed catalog write.
This remains an error rather than a successful partial result.

A patch without `machine` provenance is an authored completion and clears the
entry's `fuzzy` marker, the way gettext tools do when a translator confirms a
guessed entry; without it a fuzzy entry could never be finished through the API
and stayed incomplete in coverage. A patch carrying `machine` provenance leaves
review flags as they were — it records `lock` and `ai` instead. Every other flag
is preserved in both cases, and setting review flags remains the caller's
responsibility.

## Provider-neutral TypeScript example

```ts
import {
  applyTranslationPatches,
  isTranslationPatchWriteError,
  listTranslationCandidates,
  type CatalogArtifactConfig,
  type TranslationPatch,
} from "@palamedes/core-node"

declare function completedSingular(source: string): string
declare function completedPluralBranch(selector: string, source: string): string

const config: CatalogArtifactConfig = {
  rootDir: process.cwd(),
  sourceLocale: "en",
  locales: ["en", "de"],
  catalogs: [
    {
      path: "src/locales/{locale}/messages",
      include: ["src"],
    },
  ],
}

const { candidates, diagnostics } = listTranslationCandidates({
  config,
  locales: ["de"],
  maxOrigins: 5,
})

if (diagnostics.length > 0) {
  throw new Error(diagnostics.map(({ message }) => message).join("\n"))
}

// A provider, translation memory, editor, or human review step can produce
// these completed values. Core only validates and persists them.
const patches: TranslationPatch[] = candidates.map((candidate) => ({
  id: candidate.id,
  fingerprint: candidate.fingerprint,
  translation:
    candidate.source.kind === "singular"
      ? { kind: "singular", value: completedSingular(candidate.source.value) }
      : {
          ...candidate.source,
          values: Object.fromEntries(
            Object.entries(candidate.source.values).map(([selector, source]) => [
              selector,
              completedPluralBranch(selector, source),
            ])
          ),
        },
}))

let result
try {
  result = applyTranslationPatches({ config, patches })
} catch (error) {
  if (isTranslationPatchWriteError(error)) {
    console.error(error.code, error.message, error.cause, error.report)
  }
  throw error
}

if (result.diagnostics.length > 0) {
  // Re-enumerate stale candidates before retrying them.
  console.error(result.diagnostics)
}
```

When a machine produced a value, a patch can add native provenance without
supplying its integrity lock. Core computes the lock from the completed value:

```ts
const patch: TranslationPatch = {
  id: candidate.id,
  fingerprint: candidate.fingerprint,
  translation: { kind: "singular", value: "Zur Kasse" },
  machine: {
    ai: { model: "example/model", confidence: 0.92 },
  },
}
```
