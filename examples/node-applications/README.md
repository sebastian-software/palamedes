# Node application build paths

This private fixture probes the same compiled booking messages in three Node
execution paths. It is outside the browser/locale-routing matrix. The small
integration in `tooling/` uses existing Palamedes APIs; it is not a published
generic Node adapter.

From the repository root, install dependencies and run `pnpm build`, then:

```sh
pnpm --filter @palamedes/example-node-applications direct de
pnpm --filter @palamedes/example-node-applications build
node examples/node-applications/dist/unbundled/probe.js de
node examples/node-applications/dist/rolldown/probe.js de
pnpm --filter @palamedes/example-node-applications test
```

| Path                                    | Current result                                                                                                                             | Deployment requirement                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Native Node TypeScript                  | Conditional: works with the fixture's synchronous load hook. Plain type stripping alone cannot handle the virtual catalog entry or macros. | Source, source catalogs/configuration, native compiler/config/transform dependencies, and the hook are required on the executing host. |
| TypeScript to separate JavaScript files | Conditional: a preparation step transforms macros and creates executable catalog sidecars before normal `tsc`.                             | Ship the output directory, catalog sidecars, and Core/Runtime dependencies. No compiler or source catalogs are needed at runtime.      |
| Standalone Rolldown                     | Conditional: a private plugin composes the existing macro transform and canonical catalog compiler.                                        | Ship every emitted chunk and Core/Runtime dependencies. They are externalized; a single self-contained binary is not promised.         |

The tool versions are pinned in `package.json` and the workspace lockfile.
Initial local proof: Node 24.21.0, TypeScript 7.0.2, and Rolldown 1.2.6.
The fixture targets Node 22.22 or newer. The process suite is wired into the
full and platform CI gates; local results alone do not prove that range.

Application code imports `createNodeI18n` from the fixture's `#palamedes/node`
entry. The integration owns the configured catalog loaders and reuses the
server catalog store; the booking service contains ordinary macros. All
catalog compilation uses the canonical native compiler. Invalid ICU is fatal.

Direct execution loads catalogs lazily by locale. Rebuilding the ahead-of-time
paths compiles all configured locales and replaces their generated output.
Restart direct processes after source/catalog/config changes; this first slice
does not promise hot invalidation or a cross-platform watch command. Standalone
Rolldown watch invalidation and authored source-map diagnostics need further
proof before a general adapter can be promoted.

The process tests run each path in English, German, and Spanish. They also
copy production output into a temporary deployment containing only Core and
Runtime, verify that no compiler or macros are required, and exercise missing
catalog failure and recovery. These are executable compatibility probes, not
an expansion of the public supported-host matrix. Follow-up: issue #1270.

## CLI example

The `cli.ts` entry uses the same async booking service on all three paths:

```sh
LANG=de_DE.UTF-8 node --import ./examples/node-applications/tooling/register.mjs examples/node-applications/src/cli.ts show BK-1
LANG=es_ES.UTF-8 node examples/node-applications/dist/unbundled/cli.js --help
node examples/node-applications/dist/rolldown/cli.js show BK-1 --locale de --json
```

Language selection uses `--locale`, then the first nonempty environment value
in `LC_ALL`, `LC_MESSAGES`, `LANG` order. POSIX encodings/modifiers are removed
and underscores become language-tag hyphens. A supported base language handles
regional tags such as `de-DE`. `C`, `POSIX`, invalid or unsupported values, and
an absent environment fall back to the configured source locale. An unsupported
higher-precedence value does not fall through to a lower-precedence variable.
This also supplies a default for Windows shells without POSIX locale variables.

Human-readable help, booking details, and errors are localized. Commands and
flags stay fixed. Success/help use stdout and exit 0; missing bookings use
stderr and exit 1; argument errors use stderr and exit 2. `--json` keeps raw
values and field names stable across locales, including machine-readable errors.
Real child-process tests cover environment precedence, overrides, normalization,
fallback, help, output streams, exit codes, and isolated prebuilt deployments.

## REST examples

Express 5.2.1 and Hono 4.13.7 expose the same `GET /bookings/:id` endpoint;
Hono uses `@hono/node-server` 2.1.5. Each handler contains a macro and calls the
shared async service, which yields across an event-loop turn before translating.

```sh
PORT=3000 node --import ./examples/node-applications/tooling/register.mjs examples/node-applications/src/express-server.ts
PORT=3001 node examples/node-applications/dist/unbundled/hono-server.js
PORT=3002 node examples/node-applications/dist/rolldown/express.js
curl -H 'Accept-Language: de-DE,de;q=0.9,en;q=0.8' http://127.0.0.1:3000/bookings/BK-1
```

HTTP locale selection uses the existing `defineLocaleControls` negotiation
for `Accept-Language`, with the configured source locale as fallback. It is
independent of the CLI environment policy. Each request creates a fresh i18n
instance from the shared compiled catalog store and enters an AsyncLocalStorage
scope before invoking the handler. Successful responses return HTTP 200;
missing bookings return HTTP 404 with a stable code and localized message.
Responses carry `Content-Language`, `Vary: Accept-Language`, and private/no-store
cache headers. Catalog failures return HTTP 500 with `INTERNAL_ERROR` and log
diagnostics to stderr rather than returning compiler details to clients.

The real HTTP tests interleave three languages through both hosts on every
build path. They also start both prebuilt hosts from an offline, production-only
`pnpm deploy --legacy --prod` fixture containing no application source, catalogs,
or compiler packages. HTTP dependencies are externalized by Rolldown and must
be deployed alongside Core and Runtime. This repository deployment is a probe;
the generated output manifests are not a published application template.
