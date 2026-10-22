# Svelte 5 + Vite proof

This private, browser-only proof renders the same Frontend Stage 2026 booking
demo as the framework examples and the Vue proof. It shares `EVENT` and the
stylesheet from `@palamedes/example-ui`. Translation macros live directly inside
`.svelte` component scripts; no external message helper modules are needed.

## Run

Follow the repository prerequisites in [CONTRIBUTING.md](../../CONTRIBUTING.md).
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @palamedes/vite-plugin... --filter @palamedes/cli... --filter @palamedes/example-ui --workspace-concurrency=1 build
pnpm --dir proof/svelte-vite install --frozen-lockfile
pnpm --dir proof/svelte-vite extract
pnpm --dir proof/svelte-vite test
pnpm --dir proof/svelte-vite dev
```

Open <http://127.0.0.1:4074/?locale=de>. If Chromium is missing, run
`pnpm --dir proof/svelte-vite exec playwright install chromium` before testing.

The nested workspace isolates Svelte 5.57.2, its Vite plugin 7.3.1, Vite 8.2.2,
and `svelte-check` 4.7.7 with TypeScript 6.0.3. These tools do not change the
production workspace dependency graph. Local `link:` dependencies test the
checked-out Palamedes implementation. Svelte and Vite types resolve from the
proof's installation.

## Author messages

```svelte
<script lang="ts">
import { plural, t } from "@palamedes/core/macro";

const title = t`Choose your tickets`;
let quantity = $state(1);
const label = $derived(plural(quantity, { one: "# ticket", other: "# tickets" }));
</script>

<h1>{title}</h1>
<button onclick={() => quantity++}>{label}</button>
```

Configure `plugins: [palamedes({ framework: "none", mdx: false }), svelte()]`,
with `svelte` from `@sveltejs/vite-plugin-svelte`. The native transform must run
before Svelte compiles the component.

The Rust core extracts and transforms macros in inline JS/TS instance scripts
and module scripts (`<script module>` or legacy `<script context="module">`).
Instance-level calls run per component, while module scripts retain Palamedes'
function-scope requirement. Import macros in the script block that uses them.
Unsupported macro script languages and duplicate scripts produce diagnostics.
The original component's markup, CSS, Unicode source locations, and source map
remain intact.

The native CLI discovers `.svelte` through `include: [src]`. The Vite adapter
routes its generated runtime import through the component's catalog dependency,
so the application needs no catalog imports or manual runtime setup.

## Verification

The browser suite exercises development and production in English, German,
French, and Spanish. It checks the shared layout, translated plurals, ticket
quantity and currency totals, cart action, and client runtime calls. The proof panel uses both module and instance script
macros in one component, exercising Svelte's shared import-binding namespace.

Only the three initial component fragments load at startup, all for the active
locale. Opening the lazy details component loads one additional fragment;
closing and reopening it reuses the module. Initial catalog failures show the
adapter error page. Lazy failures reach the local await-block error UI while
the ticket panel remains usable. The suite also checks native
`pmds extract --check`, unsupported-locale fallback, and mobile overflow.

Locale controls navigate to a new document and reset component state, following
[ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md). Svelte reactivity
updates ticket calculations within that document; it does not add reactive
locale switching to the Palamedes runtime.

Native regressions cover both script kinds, aliases, shadowing, cross-script
runtime-name collisions, source origins/maps, unsupported blocks, and script
lookalikes in markup expressions, HTML comments, attributes, styles, and nested
HTML scripts. The CLI regression verifies discovery, catalog references, and
source drift. CI runs the proof on Linux with Node 24.

## Limits

This is a **Preview**, separate from the supported server-framework example
matrix. Macros in markup expressions, automatic template-text extraction,
Svelte rich-text components, preprocessors beyond JS/TS, and catalog HMR are
outside this proof. Author translations in scripts and render their values or
functions in the markup.

The separate [SvelteKit SSR proof](../sveltekit-ssr/README.md) verifies server
rendering, hydration, the Node adapter, and request isolation. This Vite SPA
remains browser-only.
