import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import {
  build,
  createServer,
  isRunnableDevEnvironment,
  resolveConfig,
  type InlineConfig,
  type ViteDevServer,
} from "vite";

import { palamedes } from "./index";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const directories: string[] = [];
let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("installed Palamedes server packages", () => {
  it("loads virtual server catalogs through installed packages in development", async () => {
    const root = await createFixture();
    server = await createServer({
      ...config(root),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const entry = await server.ssrLoadModule("/entry.ts");
    await expect(entry.locale()).resolves.toBe("de");
  });

  it("loads virtual server catalogs in additional server environments", async () => {
    // React Server Components run in a separate `rsc` environment. Vite maps
    // `ssr.noExternal` to the `ssr` environment only.
    const root = await createFixture();
    server = await createServer({
      ...config(root),
      environments: { rsc: { consumer: "server" } },
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const environment = server.environments.rsc;
    if (!isRunnableDevEnvironment(environment)) {
      throw new Error("Expected a runnable rsc environment");
    }
    const entry = await environment.runner.import("/entry.ts");
    await expect(entry.locale()).resolves.toBe("de");
  });

  it("shares the bundled Waku router store with an installed Waku adapter", async () => {
    // Waku development bundles `waku` in its `rsc` environment. An externalized
    // adapter would import Node's separate copy of `waku/router/server`, whose
    // request store the router never populates.
    const root = await createFixture();
    await createWakuRouterFixture(root);
    server = await createServer({
      ...config(root),
      environments: { rsc: { consumer: "server", resolve: { noExternal: ["waku"] } } },
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const environment = server.environments.rsc;
    if (!isRunnableDevEnvironment(environment)) {
      throw new Error("Expected a runnable rsc environment");
    }
    const entry = await environment.runner.import("/waku-entry.ts");
    await expect(entry.locale()).resolves.toBe("de");
  });

  it("loads server catalogs through an installed React Router adapter", async () => {
    // The adapter imports `@palamedes/runtime/server/bundled`, whose virtual
    // catalog import Node cannot resolve if Vite externalizes the adapter.
    const root = await createFixture();
    await createReactRouterFixture(root);
    server = await createServer({
      ...config(root),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const entry = await server.ssrLoadModule("/react-router-entry.ts");
    await expect(entry.locale()).resolves.toBe("de");
  });

  it("keeps React Router development delivery in the dev server under NODE_ENV=production", async () => {
    const root = await createFixture();
    await createReactRouterFixture(root);
    server = await createServer({
      ...config(root),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const entry = await server.ssrLoadModule("/react-router-document.ts");
    const html = await withNodeEnv("production", () => entry.render() as Promise<string>);
    expect(html).toContain("palamedes:catalogError");
    expect(html).not.toContain("importmap");
    expect(html).toContain('<html lang="de">');
  });

  it("delivers React Router production catalogs from a build served without NODE_ENV", async () => {
    const root = await createFixture();
    await createReactRouterFixture(root);
    await buildDeliveryServer(root, "react-router-document.ts", config(root));
    const html = renderBuiltServer(root);
    expect(html).toContain(PRODUCTION_IMPORT_MAP);
    expect(html).toContain('<html lang="de">');
  });

  it("keeps Waku development delivery in the dev server under NODE_ENV=production", async () => {
    const root = await createFixture();
    await createDeliveryFixture(root, "waku");
    server = await createServer({
      ...config(root),
      environments: { rsc: { consumer: "server" } },
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const environment = server.environments.rsc;
    if (!isRunnableDevEnvironment(environment)) {
      throw new Error("Expected a runnable rsc environment");
    }
    const entry = await environment.runner.import("/waku-document.ts");
    const html = await withNodeEnv("production", () => entry.render() as Promise<string>);
    expect(html).toContain("showPalamedesDevCatalogError");
    expect(html).not.toContain("importmap");
  });

  it("delivers Waku production catalogs from a build served without NODE_ENV", async () => {
    const root = await createFixture();
    await createDeliveryFixture(root, "waku");
    await buildDeliveryServer(root, "waku-document.ts", config(root));
    expect(renderBuiltServer(root)).toContain(PRODUCTION_IMPORT_MAP);
  });

  it("keeps Solid development delivery in the dev server under NODE_ENV=production", async () => {
    const root = await createFixture();
    await createDeliveryFixture(root, "solid");
    server = await createServer({
      ...solidConfig(root),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const entry = await server.ssrLoadModule("/solid-document.ts");
    const html = await withNodeEnv("production", () => entry.render() as Promise<string>);
    expect(html).toContain("showPalamedesDevCatalogError");
    expect(html).not.toContain("importmap");
  });

  it("delivers Solid production catalogs from a build served without NODE_ENV", async () => {
    const root = await createFixture();
    await createDeliveryFixture(root, "solid");
    await buildDeliveryServer(root, "solid-document.ts", solidConfig(root));
    expect(renderBuiltServer(root)).toContain(PRODUCTION_IMPORT_MAP);
  });

  it("builds an executable server without external virtual imports", async () => {
    const root = await createFixture();
    await build({
      ...config(root),
      build: {
        ssr: path.join(root, "entry.ts"),
        outDir: path.join(root, "dist"),
        rollupOptions: { output: { entryFileNames: "server.mjs" } },
      },
    });
    const moduleUrl = pathToFileURL(path.join(root, "dist/server.mjs")).href;
    const result = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const entry = await import(${JSON.stringify(moduleUrl)}); console.log(await entry.locale());`,
      ],
      { encoding: "utf8" },
    );
    expect(result.trim()).toBe("de");
  });

  it.each([
    { noExternal: true as const },
    { noExternal: "custom-package" },
    { noExternal: [/^custom-/u, "custom-package"] },
  ])("preserves the existing noExternal policy %j", async ({ noExternal }) => {
    const resolved = await resolveConfig(
      {
        configFile: false,
        envFile: false,
        logLevel: "silent",
        plugins: [palamedes({ mdx: false })],
        ssr: { noExternal },
      },
      "build",
    );
    if (noExternal === true) {
      expect(resolved.ssr.noExternal).toBe(true);
    } else {
      expect(resolved.ssr.noExternal).toEqual([
        ...(Array.isArray(noExternal) ? noExternal : [noExternal]),
        "@palamedes/runtime",
        "@palamedes/vite-plugin",
        "@palamedes/react-router",
        "@palamedes/waku",
      ]);
    }
  });

  it("extends every server environment and preserves its noExternal policy", async () => {
    const resolved = await resolveConfig(
      {
        configFile: false,
        envFile: false,
        logLevel: "silent",
        plugins: [palamedes({ mdx: false })],
        environments: {
          rsc: { consumer: "server", resolve: { noExternal: "custom-package" } },
          worker: { consumer: "server", resolve: { noExternal: true } },
          browser: { consumer: "client" },
        },
      },
      "build",
    );
    const packages = [
      "@palamedes/runtime",
      "@palamedes/vite-plugin",
      "@palamedes/react-router",
      "@palamedes/waku",
    ];
    expect(resolved.environments.ssr?.resolve.noExternal).toEqual(packages);
    expect(resolved.environments.rsc?.resolve.noExternal).toEqual(["custom-package", ...packages]);
    expect(resolved.environments.worker?.resolve.noExternal).toBe(true);
    expect(resolved.environments.client?.resolve.noExternal).toEqual([]);
    expect(resolved.environments.browser?.resolve.noExternal).toEqual([]);
  });
});

function config(root: string): InlineConfig {
  return {
    configFile: false,
    envFile: false,
    logLevel: "silent",
    root,
    cacheDir: path.join(root, ".vite"),
    plugins: [palamedes({ configPath: path.join(root, "palamedes.yaml"), mdx: false })],
  };
}

async function createFixture(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "palamedes-installed-ssr-")));
  directories.push(root);
  const scope = path.join(root, "node_modules/@palamedes");
  await mkdir(scope, { recursive: true });
  // Real directories reproduce npm installation; workspace symlinks bypass
  // Vite's default SSR externalization and would hide the regression.
  for (const name of ["runtime", "vite-plugin", "waku"]) {
    const target = path.join(scope, name);
    await mkdir(target);
    await cp(path.join(packageRoot, name, "package.json"), path.join(target, "package.json"));
    await cp(path.join(packageRoot, name, "dist"), path.join(target, "dist"), { recursive: true });
  }
  await symlink(path.join(packageRoot, "core"), path.join(scope, "core"), "junction");
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "entry.ts"),
    `
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
export async function locale() { return (await createBundledServerI18n({ locale: "de" })).locale; }
`,
  );
  await mkdir(path.join(root, "locales"));
  await writeFile(
    path.join(root, "palamedes.yaml"),
    "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [entry.ts]\n",
  );
  for (const locale of ["en", "de"]) {
    await writeFile(
      path.join(root, `locales/${locale}.po`),
      `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\nmsgid "Hello"\nmsgstr "${locale === "de" ? "Hallo" : "Hello"}"\n`,
    );
  }
  return root;
}

// Installs the React Router adapter's build next to its router and React peers.
async function createReactRouterFixture(root: string): Promise<void> {
  const adapterSource = path.join(packageRoot, "react-router");
  const adapter = path.join(root, "node_modules/@palamedes/react-router");
  await mkdir(adapter);
  await cp(path.join(adapterSource, "package.json"), path.join(adapter, "package.json"));
  await cp(path.join(adapterSource, "dist"), path.join(adapter, "dist"), { recursive: true });
  for (const name of ["react-router", "@react-router/node", "react", "react-dom", "isbot"]) {
    const target = path.join(root, "node_modules", name);
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(
      await realpath(path.join(adapterSource, "node_modules", name)),
      target,
      "junction",
    );
  }
  await writeFile(
    path.join(root, "react-router-entry.ts"),
    `
import { getI18n } from "@palamedes/runtime";
import { createReactRouterI18n } from "@palamedes/react-router";
import { RouterContextProvider } from "react-router";
const i18n = createReactRouterI18n({ resolveLocale: () => "de", catalogDelivery: false });
export function locale() {
  return i18n.run(new Request("https://example.test/"), new RouterContextProvider(), () =>
    getI18n().locale,
  );
}
`,
  );
  const clientDirectory = await createClientBuild(root);
  // No explicit `development`: the adapter decides from the Vite build.
  await writeFile(
    path.join(root, "react-router-document.ts"),
    `
import { createReactRouterI18n } from "@palamedes/react-router";
import { RouterContextProvider } from "react-router";
const i18n = createReactRouterI18n({
  resolveLocale: () => "de",
  catalogDelivery: { clientDirectory: ${JSON.stringify(clientDirectory)} },
});
export async function render(): Promise<string> {
  const transform = await i18n.createDocumentTransform(
    new Request("https://example.test/"),
    new RouterContextProvider(),
  );
  const chunks: string[] = [];
  transform.on("data", (chunk) => chunks.push(String(chunk)));
  const done = new Promise((resolve, reject) => {
    transform.once("end", resolve);
    transform.once("error", reject);
  });
  transform.end('<html lang="en"><head></head><body></body></html>');
  await done;
  return chunks.join("");
}
`,
  );
}

// Models the module-local request store of `waku/router/server`.
async function createWakuRouterFixture(root: string): Promise<void> {
  const waku = path.join(root, "node_modules/waku");
  await mkdir(path.join(waku, "router"), { recursive: true });
  await writeFile(
    path.join(waku, "package.json"),
    '{"name":"waku","type":"module","exports":{"./router/server":"./router/server.js"}}',
  );
  await writeFile(
    path.join(waku, "router/server.js"),
    `
import { AsyncLocalStorage } from "node:async_hooks";
const routerStorage = new AsyncLocalStorage();
export const runWithRouterStore = (req, fn) => routerStorage.run({ req }, fn);
export function unstable_getRequest() {
  const store = routerStorage.getStore();
  if (!store) throw new Error("Request is not available.");
  return store.req;
}
`,
  );
  await writeFile(
    path.join(root, "waku-entry.ts"),
    `
import { getI18n } from "@palamedes/runtime";
import { createWakuI18nInterceptor } from "@palamedes/waku";
import { runWithRouterStore } from "waku/router/server";
const interceptor = createWakuI18nInterceptor(() => ({ locale: "de", _: (message) => message }));
export function locale() {
  return runWithRouterStore(new Request("https://example.test/"), () =>
    interceptor(async () => getI18n().locale),
  );
}
`,
  );
}

// A fixture client build, as `vite build` writes it for a two-locale app.
async function createClientBuild(root: string): Promise<string> {
  const clientDirectory = path.join(root, "client");
  await mkdir(clientDirectory);
  await writeFile(
    path.join(clientDirectory, "palamedes-split-manifest.json"),
    JSON.stringify({
      locales: ["en", "de"],
      importMaps: { en: "palamedes-importmap.en.json", de: "palamedes-importmap.de.json" },
      chunkImports: {},
    }),
  );
  for (const locale of ["en", "de"]) {
    await writeFile(
      path.join(clientDirectory, `palamedes-importmap.${locale}.json`),
      JSON.stringify({ imports: { "#pmds/root": `/assets/root.${locale}.js` } }),
    );
  }
  return clientDirectory;
}

const PRODUCTION_IMPORT_MAP =
  '<script type="importmap">{"imports":{"#pmds/root":"/assets/root.de.js"}}</script>';

// Installs the Waku or Solid adapter build, plus a module that renders one
// document through its catalog delivery. The module sets no `development`
// option, so the adapter decides from the Vite build, and it creates the
// middleware per render, so a changed runtime NODE_ENV would be visible.
async function createDeliveryFixture(root: string, adapter: "waku" | "solid"): Promise<void> {
  const clientDirectory = await createClientBuild(root);
  const html = '<html lang="en"><head></head><body></body></html>';
  if (adapter === "solid") {
    const target = path.join(root, "node_modules/@palamedes/solid");
    await mkdir(target);
    await cp(path.join(packageRoot, "solid/package.json"), path.join(target, "package.json"));
    await cp(path.join(packageRoot, "solid/dist"), path.join(target, "dist"), { recursive: true });
    await writeFile(
      path.join(root, "solid-document.ts"),
      `
import { createSolidCatalogDeliveryMiddleware } from "@palamedes/solid/server";
export async function render(): Promise<string> {
  const middleware = createSolidCatalogDeliveryMiddleware({
    resolveLocale: () => "de",
    clientDirectory: ${JSON.stringify(clientDirectory)},
  });
  const response = await middleware(
    new Request("https://example.test/"),
    async () => new Response(${JSON.stringify(html)}, { headers: { "content-type": "text/html" } }),
  );
  return response.text();
}
`,
    );
    return;
  }
  await writeFile(
    path.join(root, "waku-document.ts"),
    `
import { createWakuCatalogDeliveryMiddleware } from "@palamedes/waku/server";
export async function render(): Promise<string> {
  const middleware = createWakuCatalogDeliveryMiddleware({
    resolveLocale: () => "de",
    clientDirectory: ${JSON.stringify(clientDirectory)},
  });
  const context = {
    req: { raw: new Request("https://example.test/") },
    res: new Response(${JSON.stringify(html)}, { headers: { "content-type": "text/html" } }),
  };
  await middleware(context, async () => {});
  return context.res.text();
}
`,
  );
}

// Solid's Vite plugin keeps the adapter in the server module graph; the
// Palamedes plugin does not list it, so the fixture does the same.
function solidConfig(root: string): InlineConfig {
  return { ...config(root), ssr: { noExternal: ["@palamedes/solid"] } };
}

// Runs `action` with a runtime NODE_ENV that differs from how Vite was started.
async function withNodeEnv<T>(value: string, action: () => Promise<T>): Promise<T> {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await action();
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
}

// `react-router build`, `waku build`, and `vite build` run Vite with
// NODE_ENV=production.
async function buildDeliveryServer(
  root: string,
  entry: string,
  inlineConfig: InlineConfig,
): Promise<void> {
  await withNodeEnv("production", () =>
    build({
      ...inlineConfig,
      build: {
        ssr: path.join(root, entry),
        outDir: path.join(root, "dist"),
        rollupOptions: { output: { entryFileNames: "server.mjs" } },
      },
    }),
  );
}

// Renders in a child process without NODE_ENV, as a custom server that starts
// a production build might.
function renderBuiltServer(root: string): string {
  const moduleUrl = pathToFileURL(path.join(root, "dist/server.mjs")).href;
  const { NODE_ENV: _omitted, ...environment } = process.env;
  return execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const entry = await import(${JSON.stringify(moduleUrl)}); console.log(await entry.render());`,
    ],
    { cwd: root, encoding: "utf8", env: environment },
  );
}
