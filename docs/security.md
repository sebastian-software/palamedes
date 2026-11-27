# Security And Deployment Hardening

Palamedes runs across build-time compilers, native CLI workflows, SSR framework adapters, browser runtimes, and external Rust catalogs. Use this guide to configure host boundaries, cookies, Content Security Policy (CSP) nonces, catalog review policies, and CLI plugins safely in production.

## SSR Deployment Security Checklist

Before deploying a server-rendered Palamedes application to production, verify each boundary below:

- **Allowlist `requestHost` before calling locale helpers.** Never forward an unvalidated `Host` or `X-Forwarded-Host` header into `resolve()`, `canonicalUrl()`, `seoLinks()`, or `suggest()`.
- **Trust forwarding headers only behind a stripping reverse proxy.** Read `X-Forwarded-Host` and `X-Forwarded-Proto` only when your edge proxy strips client-supplied copies and replaces them.
- **Set an explicit HTTPS protocol for production URLs.** Configure `protocol: "https"` in `defineLocaleControls()` so canonical and `hreflang` URLs are absolute, and pass a fixed canonical build host during static prerendering.
- **Add `Secure` (and `HttpOnly` where applicable) to locale cookies on HTTPS.** `locales.serializeChoice()` omits `Secure` and `HttpOnly` so it works with `document.cookie` and local HTTP; append `; Secure` on HTTPS and set `HttpOnly; Secure` on server-managed locale cookies.
- **Generate a fresh CSP nonce per request on the server.** Never derive a CSP nonce from an arbitrary client-supplied header such as `x-csp-nonce`; share the server-generated nonce between the Palamedes adapter and the host framework renderer.
- **Keep custom `errorHtml` static and trusted.** Delivery adapters inject `errorHtml` through `<template>.innerHTML` on catalog load failure; never interpolate request data into it.
- **Treat `.po` and `.fcl` catalogs as code-equivalent build inputs.** Compiled JS catalogs execute as modules at runtime, so enforce code review and `pmds audit` on translation changes.
- **Treat configured `pmds` binary plugins as trusted local executables.** The binary plugin protocol is a compatibility boundary, not an OS sandbox; review `plugins:` entries in `palamedes.yaml` like build scripts.

## Trusted Proxies And Host Allowlisting

`@palamedes/core/locale` exposes pure URL and locale-resolution helpers (`resolve()`, `canonicalUrl()`, `seoLinks()`, and `suggest()`). They inspect whatever `requestHost` string the caller passes:

- In `subdomain` and `tld` modes, `canonicalUrl()`, `seoLinks()`, and `suggest()` derive destination URLs by replacing the leftmost (`subdomain`) or rightmost (`tld`) DNS label of `requestHost` and preserving a non-domain request port.
- In `map` mode, `canonicalUrl()` falls back to `requestHost` when a locale has no entry in `hosts.locales`.
- In `domain` mode, `canonicalUrl()` and `seoLinks()` always emit the configured `hosts.locales[locale]` hostname and never copy a request port, so `requestHost` is only compared against configured hosts.

If a server passes an unvalidated `Host` or `X-Forwarded-Host` header as `requestHost`, an attacker can inject a foreign hostname to:

- poison cached HTML (`<link rel="canonical">` and `hreflang` alternates from `seoLinks()`)
- turn locale-switch links or server redirects built from `canonicalUrl()` or `suggest()` into open redirects or phishing links
- spoof locale selection in host-based strategies

Always normalize and validate the incoming host against an explicit allowlist of canonical application hosts before calling locale controls:

```ts
const ALLOWED_HOSTS = new Set(["example.com", "de.example.com", "fr.example.com"]);
const CANONICAL_FALLBACK_HOST = "example.com";

export function trustedRequestHost(request: Request): string {
  // Read X-Forwarded-Host only when a trusted reverse proxy strips and rewrites it.
  const rawHost = request.headers.get("host")?.split(",")[0]?.trim().toLowerCase() ?? "";
  const hostname = rawHost.replace(/:\d+$/u, "");
  return ALLOWED_HOSTS.has(hostname) ? hostname : CANONICAL_FALLBACK_HOST;
}
```

Additional host and header hardening rules:

- **Strip and overwrite forwarding headers at the proxy.** If your server reads `X-Forwarded-Host` or `X-Forwarded-Proto`, configure the reverse proxy to discard client-sent values on every ingress request and reject direct origin access that bypasses the proxy.
- **Prefer `hosts.mode: "domain"` or explicit `hosts.locales` maps when hosts are fixed.** Fixed host maps prevent destination URLs from reflecting arbitrary request hostnames.
- **Pass a canonical build host when prerendering.** Static `subdomain` and `tld` builds should pass the production canonical host into `seoLinks()` and `canonicalUrl()` rather than a preview or CI hostname.
- **Keep `createChoiceHandoffUrl()` destinations allowlisted.** `createChoiceHandoffUrl()` enforces `http:` or `https:` schemes on `currentOrigin` and `url`, but host ownership stays the caller's responsibility.
- **Protect Next.js header-based client chunk selection.** When using `experimentalClientCatalogPermutations` with `@palamedes/next-plugin`, `bindClientCatalogPermutations()` defaults to `localeSource: "route-first"` so an untrusted `x-palamedes-locale` header cannot override a root `[locale]` segment or poison route-keyed caches. Whenever a Next.js app consults `x-palamedes-locale`, either strip and rewrite it in Proxy across every renderable route or verify it with `signClientCatalogLocaleHeader()`, `verifyClientCatalogLocaleHeader()`, and `headerSecret`. See [Client chunk permutations](./api/next-plugin.md#client-chunk-permutations-experimental).

## Cookie Attributes And HTTPS

`locales.serializeChoice(locale)` returns a `document.cookie`-compatible string with these exact attributes:

```text
<choiceCookie>=<locale>; Path=/; Max-Age=31536000; SameSite=Lax
```

It intentionally omits `Secure` and `HttpOnly` because browser code calls it directly for `document.cookie` writes (such as prerendered suggestion banners or pre-navigation choice persistence) and local development often runs over plain `http://localhost`.

For production HTTPS deployments:

- **Append `; Secure` on client-side choice cookies.** When writing from browser code, add `Secure` whenever the page is served over HTTPS:

  ```ts
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${locales.serializeChoice(locale)}${secure}`;
  ```

- **Set `Secure` and `HttpOnly` on server-managed locale cookies.** When the cookie strategy persists the authoritative locale cookie from a server `Set-Cookie` response header, include `Path=/; Max-Age=31536000; SameSite=Lax; Secure` on HTTPS. Add `HttpOnly` whenever client JavaScript does not need to read or write that cookie directly.
- **Keep locale resolution read-only.** Do not emit `Set-Cookie` headers during read-only `GET` renders or read-only server queries; persist explicit switches in dedicated mutation handlers and skip writes when the stored preference is unchanged.
- **Treat locale cookies as non-sensitive UI preferences.** `readChoice()` and cookie resolution validate values strictly against configured `locales` using exact string matching, and never grant authorization or session state.

## CSP Nonces And Script Delivery

Palamedes SSR catalog delivery adapters (`@palamedes/waku`, `@palamedes/solid`, `@palamedes/tanstack`, `@palamedes/react-router`, and `@palamedes/remix`) support strict nonce-based Content Security Policies without `unsafe-inline` or `unsafe-eval`.

Follow these rules when wiring CSP nonces:

- **Generate a fresh cryptographic nonce per request on the server.** Use a CSPRNG such as `randomBytes(16).toString("base64")` from `node:crypto`, store it in a request-scoped context (for example `AsyncLocalStorage` or the framework's server request context), and send it in the response `Content-Security-Policy` header.
- **Never derive a CSP nonce from an arbitrary client-supplied header.** Reading `request.headers.get("x-csp-nonce")` without a trusted edge proxy that unconditionally strips and regenerates that header lets an attacker supply a known nonce and execute injected inline scripts under the page's CSP.
- **Use the same request nonce for Palamedes and the host framework.** Palamedes adapters attach their `nonce` only to Palamedes-generated import-map and catalog-readiness `<script>` elements; they preserve existing framework nonces and never authorize arbitrary application or external scripts. Pass the same server-generated nonce to the host framework's own script APIs:
  - **Waku:** pass the request nonce to `createWakuCatalogDeliveryMiddleware({ nonce })` and call `unstable_setNonce(nonce)` from `waku/router/server` in a handler interceptor before rendering. See [`@palamedes/waku`](./api/waku.md#compiled-catalog-delivery).
  - **Solid 2 Start Mode:** pass the request nonce to `createSolidCatalogDeliveryMiddleware({ nonce })` and set `event.nonce` before `next()` (and pass `getRequestEvent()?.nonce` to `HydrationScript` in custom Documents). See [`@palamedes/solid`](./api/solid.md#verified-solid-2-setup).
  - **TanStack Start:** pass the request nonce to both TanStack Router's `ssr.nonce` and `catalogDelivery.nonce`. See [`@palamedes/tanstack`](./api/tanstack.md#csp-and-route-local-server-functions).
  - **React Router Framework Mode:** pass the request nonce via `createReactRouterI18n({ nonce })`; the adapter shares it across React's scripts, the import map, and the readiness script. See [`@palamedes/react-router`](./api/react-router.md#create-the-integration).
  - **Remix v3:** pass the request nonce to `renderClientEntry(entryPath, { assetServer, nonce })` (and `renderClientCatalog(locale, { nonce })` when used). See [`@palamedes/remix`](./api/remix.md).
- **Keep custom `errorHtml` static and trusted.** Delivery middleware embeds `errorHtml` in the readiness probe and renders it via `<template>.innerHTML` when an initial catalog fragment fails to load. Supply only static, trusted markup—never interpolate request headers, URLs, query parameters, or user data.
- **Pin exact script digests for post-build static HTML.** When using `createStaticViteCatalogBootstrap()` from `@palamedes/vite-plugin/delivery`, compute and allowlist the reviewed SHA digests of the emitted bootstrap scripts in your static host's CSP. See [`@palamedes/vite-plugin`](./api/vite-plugin.md#static-documents-generated-after-the-vite-build).

## Catalog Trust Model

### Compiled JavaScript Catalogs

Palamedes compiles `.po` and `.fcl` catalogs into **executable JavaScript message functions** rather than inert JSON strings (see [ADR-004](../adr/004-generated-catalogs-use-executable-message-functions.md)). Those compiled modules execute inside both Node.js SSR servers and users' browsers.

Treat `.po` and `.fcl` catalogs with the same trust boundary as source code:

- **Review translation updates like code.** Require pull-request review (for example via `CODEOWNERS` and protected branches) before merging catalog changes from external contributors or localization vendors.
- **Gate catalog changes in CI.** Run `pmds audit --fail-on warning` (and `pmds extract --check`) before building production artifacts so malformed ICU patterns, unexpected placeholders, or structural drift fail the build.
- **Keep precompiled Node catalog files immutable at runtime.** When using `pmds catalog compile --target js` and `defineNodeI18n()` (or `import()`), serve compiled `.mjs` files only from build-controlled, read-only directories. Never construct dynamic `import()` paths from unvalidated user input or allow runtime writes to the generated catalog directory.

### Runtime Output And Trans Escaping

- **String macros (`t`, `i18n._()`) return plain text, not HTML.** Standard JSX and framework text interpolation escapes rendered strings automatically. Never pass translated strings into raw-HTML sinks (`dangerouslySetInnerHTML`, `innerHTML`, or unescaped server HTML concatenation) unless you apply an explicit HTML sanitizer first.
- **`<Trans>` does not parse arbitrary HTML from catalogs.** During macro transformation, rich JSX children become indexed placeholder tags such as `<0>...</0>`. At runtime, `@palamedes/react`, `@palamedes/solid`, and `@palamedes/remix` only clone or invoke the explicit wrapper elements supplied in the `components` prop for matching tag names. Unknown tag names in a translation are not turned into DOM elements (only their text children render), and literal text and stringified variable values are emitted as framework text nodes.
- **Validate dynamic props passed to `<Trans>` wrappers and `values`.** While `<Trans>` escapes catalog text, application code still owns props on wrapper components (for example validating `href` schemes on `<a href={...}>` so `javascript:` URLs are never rendered) and must not pass untrusted framework elements into `values`.

### External Rust Catalogs

In Rust applications using `palamedes-build` and `palamedes-i18n`, external `<locale>.pmd.json` files hold declarative compiled rendering instructions rather than executable code. `Catalog::load()` and `Catalog::from_bytes()` reject unknown JSON fields (`#[serde(deny_unknown_fields)]`) and validate the instruction format version, locale tag, complete message inventory, argument signatures, and schema contract fingerprint before returning a `Catalog`.

Even with strict structural validation, external `.pmd.json` files control all displayed text in the application:

- **Load `.pmd.json` files only from trusted, write-protected directories** installed alongside the executable (or verified by your deployment packaging).
- **Allowlist locale identifiers before building catalog file paths.** Never join an untrusted user-supplied locale string directly into a filesystem path such as `directory.join(format!("{locale}.pmd.json"))` without validating it against a fixed list of supported locales to prevent path traversal (`../`).

## CLI Plugin Execution Trust Boundary

Third-party `pmds` CLI plugins are opt-in and must be listed explicitly under `plugins:` in `palamedes.yaml` (or `.yml`/`.json`/`.toml`). Installed packages are never auto-discovered, `PATH` is not searched, and built-in commands (`extract`, `lint`, `audit`, `report`, `catalog`, `version`, `telemetry`) do not load plugin code.

Once configured and invoked through `pmds <plugin> <command>`, however, a binary plugin runs as a **trusted local executable with the same filesystem, environment variable, and network permissions as `pmds` itself**:

- The [binary plugin protocol](./api/cli-binary-plugin.md) defines a structured stdio compatibility boundary and resource limits (5,000 ms `describe` timeout, optional `--plugin-timeout-ms`, and fixed stdout byte/event caps), **not** an OS security sandbox. See [ADR-015](../adr/015-cli-plugin-execution-boundary.md) and [ADR-025](../adr/025-binary-plugin-protocol.md).
- **Audit `plugins:` edits like build scripts.** Changes to `plugins:` in `palamedes.yaml` or to plugin package versions in lockfiles execute native code on developer machines and in CI.
- **Inspect untrusted repositories before running plugin commands.** Do not invoke `pmds <plugin> ...` inside untrusted checkouts from privileged shells or CI jobs with sensitive secrets in the environment.
- **Treat `.palamedes/plugin-manifests.json` as a local optimization cache.** The host validates executable path and file metadata/SHA-256 fingerprints before reusing cached manifests; pass `--refresh-plugin-manifests` (or remove `.palamedes/plugin-manifests.json`) when re-verifying plugins in shared workspaces.
- **Pin `--config` in automated Git merge-driver setups.** When running `pmds catalog merge-driver` in automated or shared Git environments, pass an explicit `--config` path to a trusted configuration instead of relying on upward config discovery in an untrusted worktree. See [Git merge driver](./cli.md#git-merge-driver).

## Vulnerability Reporting

To report a suspected vulnerability in Palamedes JavaScript packages, SSR adapters, native CLI binaries, or published Rust crates (`palamedes`, `palamedes-i18n`, `palamedes-build`), follow the private reporting and disclosure process in [SECURITY.md](../SECURITY.md).
