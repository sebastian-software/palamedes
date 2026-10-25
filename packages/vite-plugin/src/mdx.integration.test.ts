import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import react from "@vitejs/plugin-react";
import solid from "@solidjs/vite-plugin";
import { afterEach, describe, expect, it } from "vitest";
import { build, createServer } from "vite";

import { palamedes } from "./index";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Palamedes MDX Vite integration", () => {
  it("builds a configless project that does not import MDX", async () => {
    const root = await createFixture({ config: false });

    await expect(
      build({
        configFile: false,
        logLevel: "silent",
        plugins: [palamedes()],
        root,
        build: {
          write: false,
          rollupOptions: {
            input: path.join(root, "entry.js"),
          },
        },
      }),
    ).resolves.toBeDefined();
  });

  it("applies failOnMissing to compiled MDX message IDs", async () => {
    const root = await createFixture({ missingTranslation: true });

    await expect(
      build({
        configFile: false,
        logLevel: "silent",
        plugins: [
          palamedes({
            configPath: path.join(root, "palamedes.yaml"),
            failOnMissing: true,
          }),
          react(),
        ],
        root,
        build: {
          write: false,
          rollupOptions: {
            external: [/^@palamedes\//u, /^react(?:\/|$)/u],
            input: path.join(root, "page.mdx"),
          },
        },
      }),
    ).rejects.toThrow(/Missing 1 translation.*failOnMissing=true/s);
  });

  it("rebuilds MDX after edits and recovers from a native parse error", async () => {
    const root = await createFixture();
    const pagePath = path.join(root, "page.mdx");
    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      root,
      plugins: [
        palamedes({ configPath: path.join(root, "palamedes.yaml"), keepSourceFallbacks: true }),
        {
          name: "external-mdx-runtime",
          resolveId(id) {
            if (/^(?:@palamedes\/|react(?:\/|$))/u.test(id)) return { id, external: true };
          },
        },
        react(),
      ],
      optimizeDeps: { noDiscovery: true },
      server: {
        middlewareMode: true,
        hmr: false,
        watch: {
          usePolling: true,
          interval: 20,
          // Keep rapid programmatic edits outside Chokidar's change throttle.
          awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
        },
      },
    });
    try {
      const initial = await server.transformRequest("/page.mdx");
      expect(initial?.code).toContain("Hello <0>world</0>.");
      expect(initial?.map).toMatchObject({
        sourcesContent: expect.arrayContaining(["# Hello **world**.\n"]),
      });
      server.watcher.add(pagePath);
      await expect
        .poll(() => server.watcher.getWatched()[root], { timeout: 5000 })
        .toContain("page.mdx");
      async function edit(source: string) {
        const module = await server.moduleGraph.getModuleByUrl("/page.mdx");
        if (!module) throw new Error("Expected the compiled MDX module in Vite's graph");
        const previous = module.lastInvalidationTimestamp;
        await writeFile(pagePath, source);
        // Vite awaits watch hooks before invalidation. Seeing the file event
        // alone can still race with its cached transform.
        await expect
          .poll(() => module.lastInvalidationTimestamp, { timeout: 5000 })
          .toBeGreaterThan(previous);
      }
      await edit("# Updated **world**.\n");
      const updated = await server.transformRequest("/page.mdx");
      expect(updated?.code).toContain("Updated <0>world</0>.");
      expect(updated?.code).not.toContain("Hello <0>world</0>.");
      await edit("# Good\n\nText {value +} after.\n");
      await expect(server.transformRequest("/page.mdx")).rejects.toThrow(
        /page\.mdx:3:.*InvalidExpression/su,
      );
      const recoveredSource =
        'import { t } from "@palamedes/core/macro"\n\nexport const label = () => t`Recovered macro`;\n\n# Recovered **world**.\n';
      await edit(recoveredSource);
      const recovered = await server.transformRequest("/page.mdx");
      expect(recovered?.code).toContain("Recovered <0>world</0>.");
      expect(recovered?.code).toContain("Recovered macro");
      expect(recovered?.code).not.toContain("@palamedes/core/macro");
      expect(recovered?.code).not.toContain("t`Recovered macro`");
      expect(recovered?.map).toMatchObject({
        sourcesContent: expect.arrayContaining([recoveredSource]),
      });
    } finally {
      await server.close();
    }
  }, 15_000);

  it.each(["react", "solid"] as const)(
    "builds a real Vite 8 %s MDX entry through the framework pipeline",
    async (framework) => {
      const root = await createFixture();
      const frameworkPlugin = framework === "react" ? react() : solid({ extensions: [".mdx"] });

      await expect(
        build({
          configFile: false,
          logLevel: "silent",
          plugins: [
            palamedes({
              configPath: path.join(root, "palamedes.yaml"),
              mdx: { framework },
            }),
            frameworkPlugin,
          ],
          root,
          build: {
            write: false,
            rollupOptions: {
              external: [/^@palamedes\//u, /^@solidjs\//u, /^react(?:\/|$)/u, /^solid-js(?:\/|$)/u],
              input: path.join(root, "page.mdx"),
            },
          },
        }),
      ).resolves.toBeDefined();
    },
  );
});

async function createFixture(options: { config?: boolean; missingTranslation?: boolean } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-mdx-")));
  fixtureDirectories.push(root);
  if (options.config !== false) {
    await writeFile(
      path.join(root, "palamedes.yaml"),
      options.missingTranslation
        ? "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [.]\n"
        : "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [.]\n",
    );
  }
  if (options.config !== false) {
    const locales = path.join(root, "locales");
    await mkdir(locales, { recursive: true });
    await writeFile(
      path.join(locales, "en.po"),
      'msgid ""\nmsgstr ""\n"Language: en\\n"\n\nmsgid "Hello <0>world</0>."\nmsgstr ""\n',
    );
    await writeFile(
      path.join(locales, "de.po"),
      'msgid ""\nmsgstr ""\n"Language: de\\n"\n\nmsgid "Hello <0>world</0>."\nmsgstr ""\n',
    );
  }
  await writeFile(path.join(root, "entry.js"), "export const value = 1\n");
  await writeFile(path.join(root, "page.mdx"), "# Hello **world**.\n");
  return root;
}
