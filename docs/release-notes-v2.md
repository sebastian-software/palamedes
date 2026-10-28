# Palamedes 2.0 release notes

**Draft for the planned 2.0 release.** These notes describe the implementation
on `main`. Publication remains held; they do not announce an available release.

The migration and representative integration verification are complete.
TanStack Start with React and Solid 2 Start Mode with Nitro are checked demos
and executable integration tests. TanStack Solid Start is outside the v2 scope.
The [v2 acceptance issue](https://github.com/sebastian-software/palamedes/issues/1204)
tracks final release verification and publication; see
[Contributing](../CONTRIBUTING.md#releases) for the release gates.

Palamedes 2.0 makes translation delivery part of the framework integration.
You still write messages next to your code and keep translations in catalogs.
The adapter connects those messages to the application, while the runtime
executes translations that have already been compiled.

Earlier releases already supported compiled messages and automatic loading in
several integrations. V2 makes that the standard contract across supported
hosts and removes the older runtime that interpreted ICU strings while the
application was running.

## Less catalog plumbing in application code

The standard framework setup no longer needs hand-written catalog imports,
locale-to-loader maps, serialized translation payloads, or catalog-specific
boundaries. You choose the language and provide normal framework error UI;
the adapter handles translation delivery.

Browser code loads compiled translation dependencies for the active document
language before translated modules execute. Later navigation and lazy modules
can bring in additional fragments as needed. Bundlers can combine multiple
fragments into one asset.

This contract covers Next.js, Vite with React or Solid, React Router Framework
Mode, Remix, TanStack Start, and Waku. The Waku, Remix, and React Router
adapters are Stable in 2.0; the [stability tiers](./stability.md#stability-tiers)
list the tested upstream versions.

React Router Framework Mode gets a new adapter package, `@palamedes/react-router`.
A root route middleware runs every loader, action, and document render in the
request's i18n scope, and its server entry injects the catalog import map. The
application keeps only its locale policy; loaders and actions no longer need a
scope wrapper. The [React Router Framework Mode guide](./api/react-router.md)
shows the setup from the checked examples.

For Next.js, automatic browser splitting is now the default. Remove
`messageSplitting`; any value is rejected rather than selecting the old path.
The plugin discovers `palamedes.server.*` for Server Function initialization,
so the standard setup does not need an opt-in flag. Applications still supply
the initializer and their request locale policy. The
[Next.js guide](./api/next-plugin.md) covers the server factory and entry module.

## One compiled runtime in development and production

Package roots and existing `compiled` subpaths now use the same parser-free
application runtime. ICU remains an authoring format in catalogs; the compiler
turns it into executable messages before the application uses it.

For application code, this means moving raw string catalogs and direct runtime
choice components to the compiled workflow. Keep authoring plurals, selects,
interpolation, and rich text through macros. Dynamic values still work; the
message text and choice structure must be discoverable during compilation.

Existing `compiled` imports remain compatible aliases. They are no longer a
separate runtime mode that application authors have to choose.

## Server requests share catalog content

Server adapters load the active language on demand and reuse its immutable
compiled catalog within a process. A new request gets its own locale, time
zone, and callbacks while referencing shared message content.

This avoids rebuilding a complete message lookup map for every request and
keeps concurrent requests in different languages isolated. Server delivery can
use a complete active-language catalog; browser fragment loading does not
require every server request to use module-level splitting.

The sharing is local to a process and catalog generation. Separate workers
can retain separate copies, and a long-lived process can retain languages it
has used. The [server catalog benchmark](../benchmarks/server-catalog/README.md)
measures that ownership with fixtures; it is not a production memory guarantee.

## Translation failures become visible

Invalid or unsupported ICU now fails compilation in both development and
production. No option turns those errors into warnings: the adapters reject
the removed `failOnCompileError` option with a migration error.

A missing translation is still allowed by default: the compiler resolves the
configured fallback languages and ultimately the source message, then compiles
the result. Use `failOnMissing` when translation completeness must be enforced.

A missing runtime entry, unavailable catalog dependency, or formatter failure
is different. V2 propagates the error to the host instead of reporting a
successful render with source patterns or internal message keys. `onMissing`
and `onError` observe failures; they do not supply replacement output.

Provide ordinary error UI that works without translations from the failed
catalog. Recovery may require a new document because a failed module import
can remain cached. Initial loading and lazy navigation follow the same failure
contract.

## Build and setup improvements

Building Palamedes from Rust source now requires Rust 1.96 or newer. This
supports Ferralk 1.1 for both source traversal and catalog pattern matching.
Extglobs, POSIX classes, and empty brace alternatives now use Ferralk's native
semantics; Windows patterns use `/` separators and `\` escapes. Review the
[source-pattern migration examples](./ferralk-adoption.md) before extraction.
Prebuilt npm native packages do not require a local Rust toolchain.

- **Next.js fragment inputs:** selected fragments use a small adapter resource
  instead of repeatedly using the full PO file as bundler input. The fix covers
  Turbopack and webpack and keeps fragment loader inputs small while preserving
  native catalog compilation.
- **Vite transforms:** modules without relevant macro imports are filtered
  before reaching the JavaScript transform hooks, avoiding unnecessary work.
- **Locale cookie examples:** request initialization and read-only actions
  resolve the language without writing a preference cookie. Explicit locale
  changes skip an unchanged cookie value and navigate to a new document.
  Applications retain responsibility for their own cookie and revalidation
  behavior.
- **Explicit language domains and SEO links:** `defineLocaleControls` from
  `@palamedes/core/locale` adds the opt-in `hosts.mode: "domain"` strategy,
  which maps complete hostnames such as `mein-produkt.de` without locale path
  prefixes. `seoLinks()` returns canonical, language-alternate, and
  `x-default` link descriptors. Existing TLD and route host-map setups keep
  working unchanged; see [Locale strategies](./locale-strategies.md#domain-strategy).
- **Agent-assisted adoption:** the repository includes a
  [Palamedes skill](../skills/palamedes/SKILL.md) for Next.js App Router,
  Vite/React, and Lingui migration. It preserves existing locale policy and
  translations and verifies rendered output against a compatible target.

## Native checks for agent workflows

`pmds lint` accepts explicit source files for quick feedback after edits:

```bash
pnpm exec pmds lint src/view.tsx src/actions.ts --json --fail-on warning
```

Omit files for the full configured source check. Both paths use the same native
rules, project policy, suppression directives, deterministic JSON, and exit
codes. Targeted runs retain other files in the shared extraction/lint cache.

`@palamedes/eslint-plugin` is removed from the v2 release set. Replace its host
configuration and suppression comments using the
[lint migration steps](./migration-v2.md#replace-the-lint-adapter). Native source
analysis and its Node binding remain available. Editor adapters and an LSP are
outside the v2 scope.

## Why this is a major release

V2 removes a supported execution model, changes how failures are handled, and
gives messages with literal braces new IDs. Applications that relied on raw
runtime catalogs, parser APIs, or silent fallbacks need changes before
upgrading. The Vite, Solid, Waku, and Remix adapters also raise their peer
ranges.

| Existing v1 integration                                                                  | What to change for v2                                                                                       |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Load ICU string maps directly into the runtime                                           | Use adapter delivery or explicitly generated compiled catalogs for a custom integration.                    |
| Import runtime parser APIs or direct choice components                                   | Move message authoring to macros; use build-time tooling for catalog inspection.                            |
| Maintain client catalog maps, boundaries, or serialized ICU bootstrap data               | Replace that plumbing with the host adapter's standard setup.                                               |
| Catch translation failures and return source text or an empty catalog                    | Let failures reach ordinary, catalog-independent error UI.                                                  |
| Disable Next.js message splitting                                                        | Remove `messageSplitting` and use automatic delivery.                                                       |
| Set `failOnCompileError`, `keepSourceFallbacks`, or an adapter `cwd`                     | Remove `failOnCompileError`; rename the others to `includeSourceMetadata` and `projectRoot`.                |
| Reuse generated v1 catalogs or a custom runtime implementation                           | Regenerate artifacts and create instances with `createI18n()`; the renderer is internal.                    |
| Use the React Router RSC adapter                                                         | Move to React Router Framework Mode, or to Next.js or Waku for RSC; the adapter is discontinued.            |
| Write literal braces in `<Trans>` children, MDX text, or `t` templates                   | Run `pmds extract` and translate the new entries; braces are now literal text with a new `msgid`.           |
| Run Vite 7 or older, an earlier Solid 2 release candidate, or a Remix 3 prerelease       | Upgrade to Vite 8, `solid-js@^2.0.0-rc.16`, and `remix@^3.0.0`; `@palamedes/waku` needs `waku@^1.0.0-rc.4`. |
| Import generated-code or renderer helpers from `@palamedes/runtime` or `@palamedes/core` | Remove the imports; they moved to the Internal `/internal` subpaths that supported adapters emit.           |

The [v2 migration guide](./migration-v2.md) lists the exact removed APIs and
replacements. Update coupled Palamedes packages together and verify the
framework's supported versions before migrating.

## What stays familiar

Message identity remains based on source text and context, so existing
translations keep their IDs. Messages with literal braces are the exception:
they get a new `msgid` and need translating again (see the
[literal brace migration](./migration-v2.md#literal-braces-in-authored-text-get-new-message-ids)).
PO and FCL remain catalog formats, subject to host-specific delivery support:
automatic Next.js graph delivery currently requires PO.

Locale selection remains application policy. Cookie, route, subdomain, and TLD
strategies continue to have checked examples. The browser language is fixed
for a document, so switching language navigates to a new document rather than
replacing catalogs in place.

## Preparing an application for the upgrade

1. Inventory raw runtime catalogs, legacy imports, and application-owned
   translation delivery code using the migration guide.
2. Keep source catalogs and existing translations; regenerate compiled
   artifacts with the v2 toolchain.
3. Follow the checked setup for your framework and preserve locale selection
   precedence. Keep locale resolution read-only.
4. Verify a source language and a translated language through server rendering,
   hydration, interaction, and navigation where applicable. Include separate
   Server Action requests when the application uses them.
5. Test a required catalog failure and the recovery UI, then run the
   application's normal checks and production build.

## Verification behind the changes

The [catalog delivery evidence](../benchmarks/catalog-delivery/README.md)
records the coordinated v2 verification: 25 smoke examples, 22 regular browser
hosts, and Next.js request-scope checks with both Turbopack and webpack. Representative failure tests cover initial and
lazy delivery and recovery; the report identifies the locale strategies tested
for each scenario.

The report identifies the checked revisions and measurement limits. Use those
fixture results alongside a production build and browser checks of your own
application.

## Independent updates and optional CLI usage reporting

The native CLI uses the shared app-tracking client for update notices and optional
usage reporting. Reporting stays off until consent. `pmds telemetry enable`
displays the notice; `--accept telemetry-v1` enables it. Inspect the effective
policy and queued data with `status` and `preview`, stop with `disable`, and
request deletion with `delete`. Previous version-service reporting is not consent.

Counts distinguish CLI tools and catalog operations. They contain no command
arguments, content, paths, raw repository URLs, or plugin names. An optional
SHA-256 repository identifier lets equivalent clones count as one project. This
is pseudonymous opt-in measurement, not a count of people or all adoption.
Build integrations and embedded Rust/Node APIs do not report automatically.

Update notices work without telemetry consent. See the [telemetry guide](./telemetry.md)
for controls and limits. A release must verify the production telemetry service
before enabling network reporting in published artifacts.
