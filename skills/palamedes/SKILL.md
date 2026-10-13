---
name: palamedes
description: Set up or verify Palamedes in a Next.js App Router or Vite/React application, or migrate its Lingui integration and PO catalogs to Palamedes. Use when adopting Palamedes, replacing Lingui macros and runtime wiring, or checking a Palamedes setup. Preserves application locale policy and existing translations.
license: MIT OR Apache-2.0
---

# Palamedes adoption

Deliver a working translation in the existing application, then verify the
source locale and at least one translated locale. Adapt the recipes to the
application; do not replace its configuration wholesale.

## Inspect and choose the route

Infer these parameters from the request and repository. Ask only for decisions
that the repository cannot answer:

| Parameter       | Values / evidence                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `mode`          | `setup`, `migrate`, or `verify`                                                                                   |
| `host`          | `nextjs-app-router` or `vite-react`; inspect dependencies, config, entry points, and rendering model              |
| `source`        | `none` or `lingui`; inspect macro imports, runtime calls, config, and catalog format                              |
| `target`        | Installed compatible release, or an explicitly supplied workspace/preview build                                   |
| `locale-policy` | Existing route, cookie, account, header, or static document policy; preserve its precedence and supported locales |

Read the package manifest, lockfile, host config, scripts, translated entry
points, and catalog samples before editing. Record the starting revision and
existing failing checks. Respect repository instructions and preserve unrelated
changes.

These recipes use the **compiled v2 adapter contract**. Repository manifests
can retain an older version while a coordinated release is held; a version
number alone does not prove capability. Check the target's package exports,
types, matching release documentation, native platform support, Node engines,
and host peer dependencies. For Next.js, confirm `withPalamedes` and
`createNextServerI18n` exist and the host is Next.js 16 App Router on Node.
For Vite, confirm `palamedes()` supports automatic compiled fragment delivery.
Do not assume registry `latest` implements the repository's current docs. If
the required contract is unavailable, report the gap and request a compatible
target; do not invent loaders, silently upgrade the framework, or change a
release policy. Pages Router, Edge, Vite SSR, and other hosts need their own
verified integration and are outside these recipes.

Load only the relevant references:

- Next.js: [references/nextjs.md](references/nextjs.md)
- Vite with React in the browser: [references/vite-react.md](references/vite-react.md)
- Lingui migration: also [references/from-lingui.md](references/from-lingui.md)

## Execute in checkpoints

1. Establish one representative route/component using the existing package
   manager and supported target. Preserve aliases, plugins, authentication,
   routing, headers, and deployment configuration.
2. For Lingui, inventory every macro/runtime form and map catalog identities
   **before extraction or deletion**. Apply the migration reference; an
   unresolved mapping blocks the destructive part of the migration.
3. Configure source locale, supported locales, catalog paths, and includes from
   the application. Use YAML/JSON/TOML for the native CLI, not executable config.
4. Wire the host adapter. It owns compiled catalog delivery and runtime setup.
   Do not add application-owned catalog imports/maps, `.po.d.ts`,
   `setClientI18n`, or `load()`/`activate()` calls to a standard adapter setup.
5. Extract, inspect catalog diffs, and preserve translations, contexts, comments,
   flags, and metadata. Run extraction again and investigate identity/content
   changes. Preserve ICU quoting and named placeholders.
6. Build and run the actual host. Verify source and translated output, not only
   extraction. Check existing plural/interpolation/rich-text cases. Next.js
   also needs server rendering, client hydration if present, and a separate
   Server Action request if the application has actions.

Locale resolution is read-only. Never write a preference cookie during render,
runtime initialization, a status check, or a read-only action. An explicit
locale change writes only when the validated saved preference differs and
uses a full document navigation. A fallback language is not necessarily a
saved preference. Do not disable unrelated revalidation to hide extra work.

Keep catalog/network failures visible to the host's ordinary error handling.
Do not catch them and return an empty catalog, source text, or internal keys as
successful localized output. Error UI must work without the failed catalog.

## Verify and hand off

Run the application's relevant extraction/lint, type, test, and production build
commands. Test locale switching, persistence, and read-only responses when those
flows exist. For Next.js, test concurrent requests for different locales if
request isolation is part of the app, and ensure read-only actions do not emit
`Set-Cookie` or locale-triggered revalidation. Inject a required catalog failure
when the host has a recovery boundary; confirm a usable error view and reload
recovery.

Remove Lingui dependencies/config/runtime code only after all uses and catalog
mappings have been accounted for. Preserve a recoverable catalog/source snapshot
until the migration checks pass. Do not use `--force-clean` to bypass uncertain
catalog mappings.

Report the chosen parameters and supported target, changed files, rendered
evidence for both locales, commands and results, and any unresolved mappings or
unsupported behavior. Distinguish checks actually run from recommended checks.
Publish or create a PR only when authorized by the user or repository workflow.
