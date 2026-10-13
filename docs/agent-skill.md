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
Use $palamedes to set up translations in this Next.js App Router app.
Keep the existing account and cookie locale policy, and verify English and German.
```

```text
Use $palamedes to migrate this Vite/React app from Lingui.
Preserve every PO translation and context. Report conflicting ID mappings
before removing entries, and run the relevant extraction and build checks.
```

Client invocation syntax can differ; the skill name is `palamedes`.

## Compatibility and scope

These workflows describe the **compiled v2 adapter contract**. A repository
manifest may still carry an older version during a coordinated release hold.
Do not assume that installing registry `latest` supplies these capabilities.
The agent checks package exports/types and release documentation first. Use a
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
