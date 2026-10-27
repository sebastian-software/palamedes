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
    const packages = ["@palamedes/runtime", "@palamedes/vite-plugin", "@palamedes/waku"];
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
import { createViteServerI18n } from "@palamedes/vite-plugin/server";
export async function locale() { return (await createViteServerI18n({ locale: "de" })).locale; }
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
