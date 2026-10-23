# Framework catalog-update workflows

This extension of the E2E workflow suite exercises Vue single-file components,
Svelte components, and Solid TSX. It imports the existing deterministic message
inventory and profile definitions from the parent benchmark. Its dependencies
and lockfile are isolated so comparator compilers cannot change the application's
or the original benchmark's peer dependency resolutions.

## Run

Complete the repository prerequisites in `CONTRIBUTING.md`, including the root
`pnpm install --frozen-lockfile`. The root commands install this subproject's
pinned dependencies and run the matrix:

```sh
pnpm benchmark:framework-workflow
pnpm benchmark:framework-workflow:quick
```

The runner builds the release CLI before measurements and uses Cargo's reported
executable and UI catalog directory. A fresh source checkout therefore does not
need a separately packaged `pmds-locales` directory. GNU gettext's `msgmerge`,
`msginit`, and `msgattrib` must be installed for vue3-gettext; all its subprocess
costs remain inside the measured extraction command.

After installing this subproject, narrower runs are available from the root:

```sh
pnpm --dir benchmarks/e2e-workflow/frameworks validate
pnpm --dir benchmarks/e2e-workflow/frameworks test
pnpm --dir benchmarks/e2e-workflow/frameworks diagnose:intlayer
pnpm --dir benchmarks/e2e-workflow/frameworks benchmark --profile small --framework svelte --tools palamedes,wuchale
pnpm --dir benchmarks/e2e-workflow/frameworks benchmark --validate-only --profile smoke --tools intlayer --strict --keep-temp
```

`--profile` accepts `smoke`, `small`, `medium`, `large`, and `realistic`.
`--framework` and `--tools` accept comma-separated selections. `--warmup` defaults
to 3 and `--runs` to 7. `--pmds-bin` selects an already built and correctly
packaged CLI; the normal CLI environment overrides remain available. `--keep-temp`
retains the generated projects and catalogs for inspection.

The runner records non-equivalent Intlayer results without timings and continues
the matrix. `--strict` returns a nonzero exit status when any selected candidate
is ineligible. Configuration errors, process failures, and regressions in other
candidates always fail the run. No vendor code or catalog merge is patched.

`diagnose:intlayer` performs a separate, untimed roundtrip with both
`.content.json` and `.content.ts` dictionaries in all three frameworks. It uses
TypeScript AST positions to seed the generated TypeScript source, then inspects
Intlayer's own built unmerged dictionaries. In the pinned 9.7.0 fixture, both
formats retain removed entries. TypeScript preserves the unchanged translations;
JSON additionally loses the interpolated translations. These are separate
format-specific observations, not a claim about every Intlayer workflow.

## Matrix and authoring

| Tool         | Vue                         | Svelte                                  | Solid                                             | Authoring                                                                |
| ------------ | --------------------------- | --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Palamedes    | Yes                         | Yes                                     | Yes                                               | `t({ message }, values)` in SFC script blocks or TSX expressions         |
| Lingui 6.6   | Official Vue extractor      | Community `lingui-for-svelte` extractor | Official `@lingui/solid` configuration and macros | Vue message descriptors; native `Trans` component macros in Svelte/Solid |
| i18next-cli  | Community `i18next-cli-vue` | Community `i18next-cli-plugin-svelte`   | Built-in TSX parser                               | Natural-language keys with native interpolation syntax                   |
| vue3-gettext | Yes                         | —                                       | —                                                 | `$gettext` in `.vue` templates; native `%{name}` interpolation           |
| Wuchale      | —                           | Official Svelte adapter                 | Official JSX adapter in Solid mode                | Implicitly extracted markup with real `{name}` expressions               |
| Intlayer     | Vue compiler                | Svelte compiler                         | TSX compiler                                      | Implicitly extracted markup; multilingual JSON dictionaries              |

SFC macro placement follows the supported Palamedes demo pattern: script-block
macros with ordinary template bindings. Vue i18next calls also live in script
blocks, because its `{{name}}` interpolation delimiter cannot be embedded inside
Vue's `{{ ... }}` template expression delimiter. The comparison permits idiomatic
source shapes; it does not claim byte-identical parsing work. Each lane records
the actual source bytes, file count, and source SHA-256.

Solid comparator adapters are pinned to their supported Solid 1.9 line. This
benchmark proves extraction behavior, not Solid 2 compatibility, runtime
reactivity, application builds, or SSR behavior.

## Workload and correctness

The shared corpus contains unchanged, changed, new, and removed source messages.
Message indices 0–14 modulo 100 use one named interpolation; the receipt records
the actual interpolation count. Like the original workflow benchmark, this does
not cover plurals, rich text, or context disambiguation.

1. Render the baseline source inventory and run each tool's real extractor.
2. Check both initial locale catalogs, then seed distinct German translations.
   Tool-generated identities, metadata and references are preserved.
3. Render the current inventory. Existing messages retain their original
   component and order; new messages are appended. Component-local dictionaries
   therefore do not lose translations because of artificial fixture reshuffling.
4. Reset catalogs and tool state, run extraction/update, and check the result.

The gate checks both locale inventories, missing/duplicate/stale entries, and
every unchanged German translation. Native `%{name}`, `{{name}}`, and indexed
`{0}` placeholders normalize only for this one-variable correctness comparison.
Changed source text retained under a stable identifier is counted separately.
The application sources must remain unchanged. Every timed sample repeats these
checks outside the timer; an incorrect result never earns a reported timing.

The `realistic` profile uses the parent's marked/unmarked file counts and line
budgets, with equivalent numeric application logic in every framework. Unmarked
components still have to be scanned. Internal numeric filler avoids introducing
additional user-facing text for the implicit extractors; this corpus does not
measure false-positive detection on arbitrary application strings.

## Timed boundary

Cold measurements include source discovery, CLI startup, parsing, extraction,
catalog merge, and output writes. Tool order rotates between rounds and runs
are serial. Warmup invocations are still cold-state invocations: every run starts
from the same catalogs and cleared local caches.

Fixture generation, initial extraction, translation seeding, native builds,
dependency installation, environment probes, and correctness checks are outside
the timer. The OS page cache is not flushed. There is no warm/incremental lane.

vue3-gettext's fuzzy matching is disabled so a changed source identity does not
silently inherit a previous translation. Its normal GNU catalog-update processes
still run and are timed.

Wuchale's normal CLI also transforms components in memory and compiles catalogs.
Intlayer additionally builds dictionaries and project artifacts; its external
format command is configured as a shell no-op, whose invocation cost remains
included. These are `extract-update-compile` workflows. Other lanes are
`extract-update`. No speedup ratios are generated across these different scopes.
No application bundling or runtime rendering is included.

## Evidence

The [latest checked report](../results/frameworks/latest.md) and its
[raw samples](../results/frameworks/latest.json) live in `../results/frameworks/`, separate from the original suite's
website-backed `latest` result. JSON retains all samples in observation order,
median/min/max/MAD, revision and dirty state, machine information, package
versions, corpus parameters, source hashes, and semantic receipts. Validation-only
runs produce timestamped reports without replacing `latest`.

The checked reports record which pinned Intlayer configurations fail the common
catalog contract. Reproduce them with the strict command above and inspect the
retained project; a passing extraction or process exit alone does not establish
translation preservation or stale-entry removal.

Results are local evidence. Background activity, OS page cache, and thermal/power
state are not controlled. A small profile does not establish large-project
performance. Benchmark dependencies are private tooling and are not shipped in
Palamedes browser packages.
