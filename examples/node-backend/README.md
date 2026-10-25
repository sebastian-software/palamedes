# Node backend

A plain Node backend built with Vite, tsdown, or standalone Rolldown and `@palamedes/vite-plugin`. The plugin
compiles the `t` and `plural` macros and turns the PO catalogs into lazy
per-locale chunks. Express, Hono, and the Palamedes runtime are bundled too, so
`dist/` runs with plain `node` and needs no `node_modules`, sources, or catalogs.

The whole build integration is [`vite.config.ts`](./vite.config.ts),
[`tsdown.config.ts`](./tsdown.config.ts), or [`rolldown.config.mjs`](./rolldown.config.mjs).
tsdown and standalone Rolldown have no Vite environment, so their
configs pass `palamedes({ framework: "none", environment: "server" })`. The
only build-related source file is [`src/i18n.ts`](./src/i18n.ts), and it is the
same for every path: `defineNodeI18n` from `@palamedes/runtime/node` registers
runtime macros and loads catalogs compiled by `pmds catalog compile --target js`
when plain `node` or `tsc` output runs it, and the plugin resolves it to the
bundled catalog store in the Vite and tsdown builds.

English, German, Spanish, and French use the same CLI and HTTP paths.

The rest of `src/` and the PO catalogs don't depend on how the backend runs either.

```sh
pnpm --filter @palamedes/example-node-backend build
LANG=de_DE.UTF-8 node examples/node-backend/dist/cli.mjs show BK-1
node examples/node-backend/dist/cli.mjs show BK-2 --locale es --json
PORT=3000 node examples/node-backend/dist/express.mjs
PORT=3001 node examples/node-backend/dist/hono.mjs
curl -H 'Accept-Language: de-DE,de;q=0.9' http://127.0.0.1:3000/bookings/BK-1
```

With tsdown instead of Vite, the output goes to `dist-tsdown/`:

```sh
pnpm --filter @palamedes/example-node-backend build:tsdown
node examples/node-backend/dist-tsdown/cli.mjs show BK-1 --locale de
```

Standalone Rolldown uses the same plugin and application without an extra adapter:

```sh
pnpm --filter @palamedes/example-node-backend build:rolldown
node examples/node-backend/dist-rolldown/cli.mjs show BK-1 --locale de
```

Without a bundler:

```sh
pnpm --filter @palamedes/example-node-backend i18n  # .palamedes/macros.json and catalogs
node examples/node-backend/src/cli.ts show BK-1 --locale de
pnpm --filter @palamedes/example-node-backend build:tsc
node examples/node-backend/build/express-server.js
```

**CLI.** The locale comes from `--locale`, then the first nonempty value of
`LC_ALL`, `LC_MESSAGES`, and `LANG`. Encodings and modifiers are stripped, and
`C`, `POSIX`, or an unsupported environment value falls back to English. An
unsupported `--locale` is an error. Help and booking details exit 0; a missing
booking exits 1; invalid arguments or an unsupported `--locale` exit 2. With
`--json`, output and error codes stay the same in every locale.

**HTTP.** Each request negotiates `Accept-Language`, creates its own i18n
instance from the shared catalog store, and runs inside
`createServerI18nScope()`. Responses set `Content-Language`,
`Vary: Accept-Language`, and `Cache-Control: private, no-store`. A missing
booking returns 404. If a catalog chunk can't load, the response is a generic
500 `INTERNAL_ERROR`, and the next request retries the load.

## Deployment and verification

`pnpm test:node-backend` typechecks separately and runs the same CLI and HTTP
contracts against five execution paths. The bundled paths deploy only the output
directory: `dist/`, `dist-tsdown/`, or `dist-rolldown/`. All emitted chunks must
ship. They need no installed packages, source catalogs, or compiler.

Without a bundler, ship `src/` (native type stripping) or `build/` (`tsc`),
`.palamedes/macros.json`, `.palamedes/catalogs/`, and an ESM `package.json`
with the application's production dependencies. Keep the relative directory
layout: `src/i18n.ts` and `build/i18n.js` locate `.palamedes/` one level above.
Install `@palamedes/core`, `@palamedes/runtime`, Express, Hono, and
`@hono/node-server` from that production manifest. The deployment host needs no
TypeScript compiler, Palamedes compiler/native addon, YAML config, or PO files.
Native execution requires erasable TypeScript and application files outside
`node_modules`; this example is ESM, with explicit relative `.ts` imports that
`tsc` rewrites to `.js`.

The suite copies artifacts outside the repository into a path containing spaces.
For unbundled paths it packs the current workspace Core and Runtime, installs
them with the declared production frameworks, and checks that the installed
dependency tree contains no compiler or build tools. This avoids silently testing
an older published runtime during the v2 transition. CLI processes and both HTTP
servers execute only from that deployment, including failed catalog delivery and
recovery.

The bundle output contract is `cli.mjs`, `express.mjs`, `hono.mjs`, and one lazy
module per locale. Another build path runs it with
`NODE_BACKEND_DIST=<output dir> node --test test/backend.test.mjs`; the tsdown
and Rolldown runs set it through their `.env` files. Unbundled runs set
`NODE_BACKEND_ENTRIES` through `test/type-stripping.env` and `test/tsc.env`.

`test/development.test.mjs` verifies the development lifecycle in disposable
copies. After changing translated source, regenerate the manifest and catalogs;
after changing a PO file or catalog configuration, recompile the catalogs. Run
`tsc` again for emitted JavaScript, then restart the application. Existing process
catalogs are cached; these paths do not promise hot replacement. A stale manifest
fails with the regeneration command, and invalid ICU fails compilation and can
be repaired. Standalone Rolldown watch rebuilds after source, PO, and config
changes; restart Node to execute its new output:

```sh
pnpm --filter @palamedes/example-node-backend exec rolldown --config rolldown.config.mjs --watch
```

Every prebuilt path emits source maps. Run Node with `--enable-source-maps` to
report the authored TypeScript location; the development test checks an error
after an async service boundary under all five paths. Missing generated startup
artifacts fail before any localized output succeeds.

The local acceptance run used Node 24.22.0, TypeScript 7.0.2, Rolldown 1.2.14,
Vite 8.2.4, and tsdown 0.23.0. The dependency versions belong to
[`package.json`](./package.json) and the workspace lockfile; CI runs this suite
on the repository's Node/platform matrix. The supported contract is these two
integration paths, not arbitrary TypeScript syntax, CommonJS authoring, or a
compiler load hook.
