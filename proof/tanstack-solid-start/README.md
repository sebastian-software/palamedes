# TanStack Solid Start host proof

This candidate application targets `@palamedes/tanstack/solid` with TanStack
Solid Start and Router 2.0.0-rc.9, Solid and `@solidjs/web` 2.0.0-rc.16,
`@solidjs/vite-plugin` 3.0.0-next.50, and Vite 8.2.4.

**Blocked; not a supported host.** The original RC.9 core graph passes the
functional acceptance tests but pins server core 1.169.26, affected by
[GHSA-qx66-fv34-fjm8](https://github.com/advisories/GHSA-qx66-fv34-fjm8).
This workspace pins the first patched core, 1.169.39. Its audit passes, but
SSR fails because the Solid host's router core does not implement
`reserveStreamFastPath`. The [TanStack guide](../../docs/api/tanstack.md#verified-react-baseline-and-blocked-solid-candidate)
records the other incompatible core combinations tested. The acceptance suite
intentionally remains red until an upstream Solid release supports a patched
core. No compatibility shim or advisory exception is included.

This is separate from the working `examples/solid-*` Start Mode/Nitro apps.

The Solid entry exposes the same middleware API as the React entry. The Start
middleware activates a fresh request-local instance before page rendering or
Server Function dispatch. The shared compiled catalog store and document
transport belong to the adapter. Application components use `t` and `Trans`;
they contain no catalog imports, manifest handling, or manual browser loaders.

## Run

Follow [CONTRIBUTING.md](../../CONTRIBUTING.md), then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --dir proof/tanstack-solid-start install --frozen-lockfile
pnpm --dir proof/tanstack-solid-start test
pnpm --dir proof/tanstack-solid-start dev
```

Open <http://127.0.0.1:4076/>. English, German, and French are available through
explicit locale buttons, a saved cookie, or `Accept-Language` negotiation.
The buttons start a new document so the browser receives the selected locale's
import map. The Details link uses ordinary client navigation.

`pnpm --dir proof/tanstack-solid-start extract` refreshes source inventories.
The nested workspace keeps the prerelease host dependencies separate from the
maintained public demo matrix. The root package's development dependency exists
for declaration generation; consumers install only their selected optional host
peer. The Vite config inlines the linked adapter's server helpers, which import
a Vite virtual module. Its `PluginOption` assertion bridges the linked workspace
plugin's Vite types to this isolated workspace's Vite types.

## Evidence

With RC.9's original core graph, the production browser suite passed checks
for translated server output and document language, hydration without console errors, two concurrent locale contexts,
real Server Functions with cross-module helpers, lazy browser fragments,
client navigation, and explicit locale changes. Browser requests contain only
the active locale's catalog assets. Initial catalog delivery failure shows the
catalog-independent recovery document, whose Reload page link restores the
application. A missing server catalog returns 500; restoring it allows the next
request in the same process to succeed.

TanStack's Solid host must be built with its Start and Solid Vite plugins.
Importing its root directly in Node bypasses that pipeline and is not the host
verification path. The example follows the
[official Solid getting-started guide](https://tanstack.com/start/latest/docs/framework/solid/getting-started)
and the upstream RC.9 example's SSR-enabled Solid plugin setup.

The public React examples remain the four cookie, route, subdomain, and TLD
applications. This focused proof does not add another deployed demo family or
change the coordinated v2 publication hold.
