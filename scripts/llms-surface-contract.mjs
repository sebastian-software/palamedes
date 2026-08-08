/*
 * `llms.txt` and `llms-full.txt` are edited context, not generated reference.
 * This contract says which discovered public surfaces each audience covers:
 * the concise file covers the workflow features called out below, while the
 * full file covers every built-in command and non-platform published package.
 * Keep an intentional inventory here when a public API is added or removed.
 */

export const compactCommandInventory = [
  "pmds extract",
  "pmds lint",
  "pmds catalog merge",
  "pmds catalog merge-driver",
]

export const compactPackageInventory = [
  "@palamedes/cli",
  "@palamedes/core-node",
  "@palamedes/eslint-plugin",
]

// Every public package is intentionally enumerated. Platform binaries remain
// discoverable through their parent package in the full context, while an
// unexpected package name still fails the inventory check.
export const publishedPackageInventory = [
  "@palamedes/cli",
  "@palamedes/config",
  "@palamedes/core",
  "@palamedes/core-node",
  "@palamedes/eslint-plugin",
  "@palamedes/extractor",
  "@palamedes/next-plugin",
  "@palamedes/react",
  "@palamedes/remix",
  "@palamedes/runtime",
  "@palamedes/solid",
  "@palamedes/transform",
  "@palamedes/vite-plugin",
  "@palamedes/waku",
  "create-palamedes",
  "palamedes",
]

export const platformPackageParents = ["@palamedes/cli", "@palamedes/core-node"]

export const platformPackageInventory = [
  "@palamedes/cli-darwin-arm64",
  "@palamedes/cli-linux-arm64-gnu",
  "@palamedes/cli-linux-x64-gnu",
  "@palamedes/cli-linux-x64-musl",
  "@palamedes/cli-win32-x64-msvc",
  "@palamedes/core-node-darwin-arm64",
  "@palamedes/core-node-linux-arm64-gnu",
  "@palamedes/core-node-linux-x64-gnu",
  "@palamedes/core-node-linux-x64-musl",
  "@palamedes/core-node-win32-x64-msvc",
]

// The candidate/patch API is a deliberately bounded public workflow. The
// checker also discovers all matching exports, so additions need both an
// inventory decision and full-context coverage.
export const translationApiInventory = [
  "applyTranslationPatches",
  "listTranslationCandidates",
  "TranslationCandidate",
  "TranslationCandidateId",
  "TranslationCandidateRequest",
  "TranslationCandidateResult",
  "TranslationPatch",
  "TranslationPatchOutcome",
  "TranslationPatchOutcomeStatus",
  "TranslationPatchRequest",
  "TranslationPatchResult",
  "TranslationPatchWriteError",
]

export const translationPatchOutcomeInventory = ["applied", "unchanged", "rejected", "notApplied"]

export const compactTranslationApiInventory = [
  "listTranslationCandidates",
  "applyTranslationPatches",
  "TranslationPatch",
  "fingerprint",
]

export const featureNarrative = {
  lint: ["non-mutating", "MDX"],
  eslintAdapter: ["Preview", "ESLint/Oxlint", "pmds lint"],
  extractCheck: ["pmds extract --check --json", "--no-cache"],
  mergeDriver: ["deletion-aware", "three-way merge"],
  binaryPlugins: ["binary-only", "binary plugin protocol"],
}
