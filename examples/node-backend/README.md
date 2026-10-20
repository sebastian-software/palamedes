# Node backend

A plain Node backend built with Vite and `@palamedes/vite-plugin`. The plugin
compiles the `t` and `plural` macros and turns the PO catalogs into lazy
per-locale chunks. Express, Hono, and the Palamedes runtime are bundled too, so
`dist/` runs with plain `node` and needs no `node_modules`, sources, or catalogs.

The whole build integration is [`vite.config.ts`](./vite.config.ts). Application
code gets request-scoped i18n from `createViteServerI18n` in
[`src/i18n.ts`](./src/i18n.ts).

```sh
pnpm --filter @palamedes/example-node-backend build
LANG=de_DE.UTF-8 node examples/node-backend/dist/cli.mjs show BK-1
node examples/node-backend/dist/cli.mjs show BK-2 --locale es --json
PORT=3000 node examples/node-backend/dist/express.mjs
PORT=3001 node examples/node-backend/dist/hono.mjs
curl -H 'Accept-Language: de-DE,de;q=0.9' http://127.0.0.1:3000/bookings/BK-1
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
copy of `dist/` in an empty temporary directory.
