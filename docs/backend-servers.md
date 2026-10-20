# Palamedes In Backend Servers

Palamedes is not limited to React frameworks.

The same steady runtime model also works in regular request/response servers.
That matters when translations need to appear in emails, API-rendered HTML,
server actions, or small backend services that sit next to the frontend.

If transformed code can resolve the active i18n instance through
`@palamedes/runtime`, the same model also works in backend applications such as:

- Express
- Hono
- Fastify-style Node servers
- custom Node HTTP servers

The important requirement is not the framework name. It is that your server can
expose a **request-local** i18n instance before translated code runs.

## The Runtime Rule

Palamedes-transformed code calls `getI18n()` from `@palamedes/runtime`.

On the server, that means you must register a getter:

```ts
import { setServerI18nGetter } from "@palamedes/runtime";

setServerI18nGetter(() => getRequestScopedI18n());
```

In backend servers, the cleanest way to do that is `AsyncLocalStorage`.

## Canonical Node Pattern

```ts
import {
  createI18n,
  defineCompiledCatalog,
  type CompiledCatalogMessages,
} from "@palamedes/core/compiled";
import { createServerI18nScope } from "@palamedes/runtime/server";

type Locale = "en" | "de";

const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: defineCompiledCatalog({ "Welcome to Palamedes": "Welcome to Palamedes" }),
  de: defineCompiledCatalog({ "Welcome to Palamedes": "Willkommen bei Palamedes" }),
};

const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>();

function createRequestI18n(locale: Locale) {
  const i18n = createI18n({ locale });
  i18n.load(locale, CATALOGS[locale]);
  return i18n;
}
```

For each incoming request:

1. determine the locale from `Accept-Language`, cookies, session, or user profile
2. create an i18n instance, load that locale's catalog, and activate it
3. run the request inside `serverI18n.run(i18n, ...)`

`createServerI18nScope()` is the Node `AsyncLocalStorage` implementation and
registers the runtime getter once. It gives transformed code and ordinary
runtime helpers inside the request path access to the correct server-local
instance.

The examples below deliberately use `getI18n()._(...)` rather than a macro.
That is a plain Node runtime call, so no Vite, SWC, or Babel transform is needed.
To use macros in a backend, build it with a bundler or, without one, register
runtime macros. Both are described next.

## Macros In A Bundled Backend

Build the backend with Vite and `@palamedes/vite-plugin`, the same plugin the UI
adapters use. A server build compiles the macros, and
`createBundledServerI18n` from `@palamedes/runtime/server/bundled` loads the
active locale's compiled catalog for each request or CLI run:

```ts
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";

const i18n = await createBundledServerI18n({ locale: "de", timeZone: "UTC" });
```

Application code depends only on `@palamedes/runtime`; the plugin, a build-time
dependency, supplies the `virtual:palamedes/server-catalogs` module behind that
import. Outside a Palamedes build the import fails to resolve, and an
unsupported locale or a failed chunk rejects rather than falling back to source
text. `createViteServerI18n` from `@palamedes/vite-plugin/server` remains as an
alias of the same function. Configure the build:

```ts
import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [palamedes({ framework: "none" })],
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: "node22",
    rolldownOptions: { input: { server: "src/server.ts" } },
  },
});
```

`ssr.noExternal: true` bundles the server framework and the Palamedes runtime,
so you deploy `dist/` and run it with plain `node`. The compiler packages and PO
catalogs stay on the build machine. Each locale's catalog becomes a lazy chunk.
If a chunk fails to load, the request fails, and the next request tries again.
For unbundled output, set `output.preserveModules` in `rolldownOptions`.

[`examples/node-backend`](https://github.com/sebastian-software/palamedes/tree/main/examples/node-backend)
shows Express, Hono, and a localized CLI built this way. The same application
code also runs without a bundler; see
[One Setup For Every Build](#one-setup-for-every-build).

Ways to run backend code with macros:

| Setup                                | Status                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| Vite build                           | Supported through `@palamedes/vite-plugin`                |
| Standalone Rolldown                  | Not yet: the plugin relies on Vite's server environment   |
| Direct Node or plain `tsc`           | Supported through runtime macros and precompiled catalogs |
| Node load hooks, `tsc` preprocessing | Not supported: they need the compiler on the runtime host |

## Macros Without A Bundler

Node code that runs without a bundler (native type stripping, plain `tsc`
output, scripts, tests) can keep using the `t`, `plural`, `select`, and
`selectOrdinal` macros. Two generated files replace the compiler transform:

```bash
pmds extract --runtime-manifest .palamedes/macros.json
pmds catalog compile --target js --output .palamedes/catalogs
```

Register the manifest once at startup and load the compiled catalog for each
request. [`defineNodeI18n`](#one-setup-for-every-build) does both and also
works in a bundle; the lower-level calls are:

```ts
import { createI18n } from "@palamedes/core";
import { registerRuntimeMacros } from "@palamedes/runtime/node-macros";

const generated = new URL("../.palamedes/", import.meta.url);
registerRuntimeMacros(new URL("macros.json", generated));

async function createRequestI18n(locale: "en" | "de") {
  const { messages } = await import(new URL(`catalogs/${locale}.mjs`, generated).href);
  const i18n = createI18n({ locale });
  i18n.load(locale, messages);
  return i18n;
}
```

- The manifest maps each call's static text to its compiled key and placeholder
  names, so the runtime neither hashes nor parses. Rerun both commands after
  changing translated code; `pmds extract --check --runtime-manifest <path>`
  fails when the manifest is stale.
- Calls that look identical at runtime but compile to different messages, and
  choice branches that interpolate values, are extraction errors.
- An unknown call or a missing catalog throws to the host. Nothing renders
  source text or internal keys.
- Register once per process; a second registration throws. Without
  registration the macros keep throwing, so a bundled app that is missing its
  plugin still fails loudly. Bundled code must not register runtime macros.
- JSX macros need the compiler.

## One Setup For Every Build

Code that runs both bundled and unbundled doesn't need two i18n modules.
`defineNodeI18n` from `@palamedes/runtime/node` covers both:

```ts
import { defineNodeI18n } from "@palamedes/runtime/node";

const createI18n = defineNodeI18n({
  generated: new URL("../.palamedes/", import.meta.url),
});

const i18n = await createI18n({ locale: "de", timeZone: "UTC" });
```

Without a bundler, `defineNodeI18n` registers `macros.json` from the
`generated` directory and loads `catalogs/<locale>.mjs` through a shared
catalog store. A locale without a compiled catalog module rejects. In a server
build, `@palamedes/vite-plugin` resolves `@palamedes/runtime/node` to the
bundled catalog store from `@palamedes/runtime/server/bundled` instead. The
bundle then contains no runtime-macro code, and `generated` is ignored. Call
`defineNodeI18n` once per process; each call to the returned function creates
a fresh instance.

In `examples/node-backend`, `src/i18n.ts` is this module and needs no build
configuration beyond `palamedes({ framework: "none" })`. The booking service,
CLI, Express, and Hono code doesn't depend on the build, and one test suite
runs against the Vite bundle, plain `node` type stripping, and plain `tsc`
output.

## Hono Example

Hono is a strong fit for this pattern because it keeps the request flow small
and explicit while still running on Node.js.

```ts
import { Hono } from "hono";
import {
  createI18n,
  defineCompiledCatalog,
  type CompiledCatalogMessages,
} from "@palamedes/core/compiled";
import { defineLocaleControls } from "@palamedes/core/locale";
import { getI18n } from "@palamedes/runtime";
import { createServerI18nScope } from "@palamedes/runtime/server";

type Locale = "en" | "de";
const app = new Hono();
const localeControls = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
});
const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: defineCompiledCatalog({ "Welcome to Palamedes": "Welcome to Palamedes" }),
  de: defineCompiledCatalog({ "Welcome to Palamedes": "Willkommen bei Palamedes" }),
};
const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>();

app.use(async (c, next) => {
  const locale = localeControls.preferredLocale(c.req.header("accept-language")) as Locale;
  const i18n = createI18n({ locale });
  i18n.load(locale, CATALOGS[locale]);

  await serverI18n.run(i18n, next);
});

app.get("/", (c) => {
  return c.text(getI18n()._("Welcome to Palamedes"));
});
```

This same pattern also works when the locale comes from:

- a signed cookie
- a session record
- a database-backed user profile
- a route segment or hostname

## Express Example

```ts
import express from "express";
import {
  createI18n,
  defineCompiledCatalog,
  type CompiledCatalogMessages,
} from "@palamedes/core/compiled";
import { defineLocaleControls } from "@palamedes/core/locale";
import { getI18n } from "@palamedes/runtime";
import { createServerI18nScope } from "@palamedes/runtime/server";

type Locale = "en" | "de";
const app = express();
const localeControls = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
});
const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: defineCompiledCatalog({ "Welcome to Palamedes": "Welcome to Palamedes" }),
  de: defineCompiledCatalog({ "Welcome to Palamedes": "Willkommen bei Palamedes" }),
};
const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>();

app.use((req, res, next) => {
  const locale = localeControls.preferredLocale(req.header("accept-language")) as Locale;
  const i18n = createI18n({ locale });
  i18n.load(locale, CATALOGS[locale]);

  serverI18n.run(i18n, next);
});

app.get("/", (req, res) => {
  res.send(getI18n()._("Welcome to Palamedes"));
});
```

## Where Locale Can Come From

Palamedes does not force a single backend locale strategy.

Common backend sources are:

- `Accept-Language`
- request cookies
- user session data
- stored user profile locale
- route or subdomain conventions

The important rule is only this:

determine the locale before translated code runs, then expose the matching i18n
instance through the runtime getter.

## What This Means For The Product Story

This matters for positioning because Palamedes covers more than frontend
framework tooling.

The same runtime model already covers:

- server-side code inside React frameworks
- request-local logic in backend applications
- APIs or HTML responses that need locale-aware output

That makes the cross-framework story stronger: the model is not tied only to UI
render trees. It also fits classic request/response servers.

## Related Docs

- [Root README](https://github.com/sebastian-software/palamedes/blob/main/README.md)
- [First working translation in 5 minutes](./first-working-translation.md)
- [Migration from Lingui](./migrate-from-lingui.md)
- [Example matrix](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
