import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, normalizePath, type ViteDevServer } from "vite";

import type * as CoreNodeModule from "@palamedes/core-node";
import type * as TransformModule from "@palamedes/transform";

const mocks = vi.hoisted(() => ({
  analyzeMdxNative: vi.fn(),
  transformPalamedesMacros: vi.fn(),
}));

// Keep Vite, its filter evaluation, and the Palamedes hooks real. Only replace
// native compilation so these tests isolate hook dispatch and module IDs.
vi.mock("@palamedes/core-node", async (importOriginal) => ({
  ...(await importOriginal<typeof CoreNodeModule>()),
  analyzeMdxNative: mocks.analyzeMdxNative,
}));

vi.mock("@palamedes/transform", async (importOriginal) => ({
  ...(await importOriginal<typeof TransformModule>()),
  transformPalamedesMacros: mocks.transformPalamedesMacros,
}));

import { palamedes, type PalamedesPluginOptions } from "./index";

let root: string;
let server: ViteDevServer | undefined;
const macroSource = 'import { t } from "@palamedes/core/macro"; export const greeting = t`Hello`;';

beforeEach(async () => {
  server = undefined;
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-filter-")));
  await writeFile(
    path.join(root, "palamedes.yaml"),
    "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [.]\n",
  );
  mocks.transformPalamedesMacros.mockReset().mockReturnValue({
    code: "export const compiledMacro = true;",
    hasChanged: true,
    compiledIds: [],
    map: null,
  });
  mocks.analyzeMdxNative.mockReset().mockReturnValue({
    code: "export const compiledMdx = true;",
    compiledIds: [],
    diagnostics: [],
    map: null,
  });
});

afterEach(async () => {
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

async function startServer(options: PalamedesPluginOptions = {}) {
  const plugins = palamedes({ configPath: path.join(root, "palamedes.yaml"), ...options });
  const hook = plugins.find((plugin) => plugin.name === "palamedes:transform")?.transform;
  if (!hook || typeof hook === "function") {
    throw new TypeError("Expected an object-form macro transform hook");
  }
  const handler = vi.spyOn(hook, "handler");
  server = await createServer({
    configFile: false,
    envFile: false,
    root,
    cacheDir: path.join(root, "cache"),
    logLevel: "silent",
    plugins,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  return handler;
}

describe("transform filters in the Vite dev server", () => {
  it.each(["", "?review=1", "?review=1&scope=node_modules"])(
    "transforms macro modules with suffix %j using their clean file path",
    async (suffix) => {
      await writeFile(path.join(root, "page.ts"), macroSource);
      await startServer({ mdx: false });

      const result = await server!.transformRequest(`/page.ts${suffix}`);

      expect(result?.code).toContain("compiledMacro");
      expect(mocks.transformPalamedesMacros).toHaveBeenCalledWith(
        macroSource,
        normalizePath(path.join(root, "page.ts")),
        expect.any(Object),
      );
    },
  );

  it.each(["", "?review=1", "?review=1&scope=node_modules"])(
    "compiles MDX modules with suffix %j using their clean file path",
    async (suffix) => {
      await writeFile(path.join(root, "page.mdx"), "# Hello\n");
      await startServer();

      const result = await server!.transformRequest(`/page.mdx${suffix}`);

      expect(result?.code).toContain("compiledMdx");
      expect(mocks.analyzeMdxNative).toHaveBeenCalledWith(
        "# Hello\n",
        normalizePath(path.join(root, "page.mdx")),
        expect.any(Object),
      );
    },
  );

  it("does not call the macro hook for a module without macro references", async () => {
    await writeFile(path.join(root, "plain.ts"), "export const value = 42;");
    const handler = await startServer({ mdx: false });

    await server!.transformRequest("/plain.ts?review=1");

    expect(handler).not.toHaveBeenCalled();
    expect(mocks.transformPalamedesMacros).not.toHaveBeenCalled();
  });

  it("still applies configured exclusions to the clean file path", async () => {
    await writeFile(
      path.join(root, "excluded.ts"),
      "// @palamedes/core/macro\nexport const ignored = true;",
    );
    await startServer({ mdx: false, exclude: /excluded/ });

    await server!.transformRequest("/excluded.ts?review=1");

    expect(mocks.transformPalamedesMacros).not.toHaveBeenCalled();
  });

  it.each([{ include: "**/*.custom" }, { include: null }, { include: [] }])(
    "preserves custom or unrestricted include patterns $include for query modules",
    async ({ include }) => {
      await writeFile(path.join(root, "page.custom"), macroSource);
      await startServer({ include });

      const result = await server!.transformRequest("/page.custom?review=1");

      expect(result?.code).toContain("compiledMacro");
      expect(mocks.transformPalamedesMacros).toHaveBeenCalledOnce();
    },
  );
});
