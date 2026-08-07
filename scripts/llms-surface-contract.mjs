/*
 * The llms files are curated context, not generated API reference. This is the
 * deliberately small public surface that must be discoverable in both files.
 * Each authority entry is read from the implementation or published manifest;
 * each document entry describes the minimum useful context for that audience.
 */

export const llmsFiles = ["llms.txt", "llms-full.txt"]

export const llmsSurfaceContract = [
  {
    id: "source-lint",
    authority: {
      package: {
        manifest: "packages/cli/package.json",
        name: "@palamedes/cli",
      },
      cli: {
        command: "pmds lint",
        documentation: "docs/cli.md",
        heading: "## `pmds lint`",
        flags: ["--json", "--fail-on", "--no-cache"],
        implementation: "crates/palamedes-cli/src/cli.rs",
        implementationMarkers: ["Lint(LintOptions)"],
      },
    },
    documents: {
      "llms.txt": ["@palamedes/cli", "pmds lint", "non-mutating", "MDX"],
      "llms-full.txt": ["@palamedes/cli", "pmds lint", "non-mutating", "MDX", "--fail-on warning"],
    },
  },
  {
    id: "eslint-oxlint-adapter",
    authority: {
      package: {
        manifest: "packages/eslint-plugin/package.json",
        name: "@palamedes/eslint-plugin",
      },
      documentation: {
        file: "packages/eslint-plugin/README.md",
        markers: ["Preview", "Oxlint", "MDX is not supported"],
      },
    },
    documents: {
      "llms.txt": ["@palamedes/eslint-plugin", "Preview", "ESLint/Oxlint", "pmds lint"],
      "llms-full.txt": [
        "@palamedes/eslint-plugin",
        "Preview",
        "ESLint/Oxlint",
        "Oxlint's JavaScript plugin API is still alpha",
        "MDX",
        "pmds lint",
      ],
    },
  },
  {
    id: "translation-candidate-patches",
    authority: {
      package: {
        manifest: "packages/core-node/package.json",
        name: "@palamedes/core-node",
      },
      api: {
        file: "packages/core-node/src/index.ts",
        exports: ["listTranslationCandidates", "applyTranslationPatches"],
      },
    },
    documents: {
      "llms.txt": [
        "@palamedes/core-node",
        "listTranslationCandidates",
        "applyTranslationPatches",
        "fingerprint",
      ],
      "llms-full.txt": [
        "@palamedes/core-node",
        "listTranslationCandidates",
        "applyTranslationPatches",
        "fingerprint",
        "applied",
        "unchanged",
        "rejected",
      ],
    },
  },
  {
    id: "extraction-drift-check",
    authority: {
      cli: {
        command: "pmds extract",
        documentation: "docs/cli.md",
        heading: "## `pmds extract`",
        flags: ["--check", "--json", "--no-cache"],
        implementation: "crates/palamedes-cli/src/commands/extract/mod.rs",
        implementationMarkers: ["check: bool", "json: bool", "no_cache: bool"],
      },
    },
    documents: {
      "llms.txt": ["pmds extract --check --json", "catalog", "--no-cache"],
      "llms-full.txt": [
        "pmds extract --check --json",
        "without writing catalog files",
        "--no-cache",
        "cache",
      ],
    },
  },
  {
    id: "deletion-aware-merge-driver",
    authority: {
      cli: {
        command: "pmds catalog merge-driver",
        documentation: "docs/cli.md",
        heading: "## `pmds catalog merge`",
        flags: ["--base", "--path", "--operation"],
        implementation: "crates/palamedes-cli/src/commands/catalog/merge.rs",
        implementationMarkers: ["pub struct MergeDriverOptions", "GitMergeOperation"],
      },
    },
    documents: {
      "llms.txt": [
        "pmds catalog merge-driver %O %A %B %A --path %P",
        "deletion-aware",
        "three-way merge",
      ],
      "llms-full.txt": [
        "pmds catalog merge-driver %O %A %B %A --path %P",
        "deletion-aware three-way merge",
        "rebase",
        "use-first",
      ],
    },
  },
]
