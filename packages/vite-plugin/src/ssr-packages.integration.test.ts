import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { build, createServer, resolveConfig, type InlineConfig, type ViteDevServer } from "vite";

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
      ]);
    }
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
  for (const name of ["runtime", "vite-plugin"]) {
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
