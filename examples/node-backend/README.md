# Node backend

A plain Node backend built with Vite or tsdown and `@palamedes/vite-plugin`. The plugin
compiles the `t` and `plural` macros and turns the PO catalogs into lazy
per-locale chunks. Express, Hono, and the Palamedes runtime are bundled too, so
`dist/` runs with plain `node` and needs no `node_modules`, sources, or catalogs.

The whole build integration is [`vite.config.ts`](./vite.config.ts) or
[`tsdown.config.ts`](./tsdown.config.ts). tsdown has no Vite environment, so its
config passes `palamedes({ framework: "none", environment: "server" })`. The
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

`pnpm test:node-backend` runs every scenario as a real child process against a
copy of `dist/` in an empty temporary directory. The suite only relies on the
output contract (`cli.mjs`, `express.mjs`, `hono.mjs`, one module per locale
catalog), so another build path runs it with
`NODE_BACKEND_DIST=<output dir> node --test test/backend.test.mjs`; the tsdown
run sets it through `test/tsdown.env`. The unbundled runs set `NODE_BACKEND_ENTRIES` through `test/type-stripping.env` and
`test/tsc.env`; they run in place against the installed packages and skip the
bundle-only check that `dist/` needs no `node_modules`.
