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
