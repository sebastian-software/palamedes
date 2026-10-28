# Set up or migrate with an agent skill

The repository includes a portable [`palamedes` skill](https://github.com/sebastian-software/palamedes/tree/main/skills/palamedes)
for an AI coding agent working in your application. It covers:

- Next.js 16 App Router setup and verification on the Node runtime
- Vite with React setup and verification in the browser
- Lingui migration into either host, including macros, deferred labels, and PO identities

The skill detects the host, migration source, installed target, and locale
policy from the project. Its references keep the two host workflows separate
and share a catalog-preserving Lingui migration workflow.

## Install and invoke

Use a skill-capable agent's installation mechanism. For clients supported by the
Skills CLI, install from this repository:

```bash
npx skills add sebastian-software/palamedes --skill palamedes
```

You can also install the complete `skills/palamedes` directory using your
client's local skill mechanism. Keep `SKILL.md`, `references/`, and `agents/`
together; the references resolve inside the installed skill and do not require
a Palamedes repository checkout. Pin a reviewed repository revision when your
installation workflow supports it.

Example requests:

```text
Use the Palamedes skill to set up translations in this Next.js App Router app.
Keep the existing account and cookie locale policy, and verify English and German.
```

```text
Use the Palamedes skill to migrate this Vite/React app from Lingui.
Preserve every PO translation and context. Report conflicting ID mappings
before removing entries, and run the relevant extraction and build checks.
```

Plain language works in any agent that loads skills. Clients that also offer a
direct invocation use their own syntax, for example `$palamedes` in Codex or
`/palamedes` in Claude Code; the skill name is `palamedes`.

## Compatibility and scope

These workflows describe the **compiled v2 adapter contract**, which Palamedes
2.0.0 and later provide. A 1.x install does not have it. The agent checks
package exports/types and release documentation first. Use a
compatible release or an explicitly supplied workspace/preview target; an
unavailable contract is a reported compatibility gap, not permission to add
custom loaders or upgrade the framework silently.

The first scope excludes Pages Router, Edge, Vite SSR, and migration from other
i18n libraries. Other supported Palamedes adapters retain their existing
documentation and integration tests. Extend this skill with a verified host
reference and fixtures when adding another workflow.

## What the agent should deliver

Expect a small working translation, preserved application configuration and
locale precedence, reviewed catalog diffs, and rendered evidence for the source
locale and a translated locale. Next.js applications with Server Actions need
separate action initialization and read-only cookie checks. Setup does not write
locale preferences, and changing locale requires document navigation.

For Lingui, the agent inventories descriptors and ID consumers, maps IDs to
source text plus context in every locale, checks placeholder compatibility,
and retains translations, comments, flags, and metadata. It stops an ambiguous
mapping before deleting catalogs or dependencies. It runs extraction twice and
the application's relevant type, test, and production build commands, then
reports actual results and remaining limits.

## Check changes with `pmds`

Use the project's package manager and a compatible v2 CLI. After changing source
files, run the narrow check first:

```bash
pnpm exec pmds lint src/view.tsx src/actions.ts --json --fail-on warning
```

Arguments are literal files relative to the invocation directory. They replace
catalog discovery and bypass include/exclude patterns while retaining project
lint policy. Omit file arguments for the full configured source check before
handoff. Targeted runs preserve other entries in the shared extraction cache;
use `--no-cache` when cache writes are unwanted.

Use the checks for the concern they own:

| Change or question                                      | Check                                                 |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Source authoring after an edit                          | `pmds lint <files> --json --fail-on warning`          |
| All configured source authoring before handoff or in CI | `pmds lint --json --fail-on warning`                  |
| Catalog drift after extraction or before handoff        | `pmds extract --check --json --fail-on-empty-catalog` |
| Translation and ICU validity in catalogs                | `pmds audit --json --fail-on warning`                 |

Inspect stable diagnostic `code`, `file`, `primary` location, `message`, and
`help`, and check `failedFiles` as well as findings. Repair the source and rerun
the same command. Exit `0` means the requested policy passed; `4` is a completed
lint verdict with threshold or file-analysis failures; `1` is an operational
failure; `2` is invalid usage. Extraction drift uses `3`, and audit threshold
failure uses `5`. A failed check must not be reported as clean. Source checks do
not create or update catalogs; run normal extraction before its drift check
when a source edit changes messages. Keep the application's type, test, and
production build checks in the handoff.

## Repository validation

`pnpm test:adoption-skill` executes the bundled authoring recipes and migration
fixtures against the native extractor, catalog updater/compiler, and compiled
runtime. `pnpm verify:adoption-skill` builds and renders the Next.js and Vite
recipes in both locales. These checks require built workspace packages and the
native CLI; they test the repository preview target, not a released package.

Independent agent runs against the raw fixtures also test the workflow during
skill development. Automated recipe checks do not guarantee that every agent
will correctly migrate an arbitrary application's dynamic IDs or TMS contracts.

For manual setup, use the [Next.js first-run guide](./nextjs-first-run.md),
[Vite/React first-run guide](./first-working-translation.md), or
[Lingui migration guide](./migrate-from-lingui.md).
