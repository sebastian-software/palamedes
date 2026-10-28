import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

import { palamedes } from "./index";

const directories: string[] = [];
let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("development message sidecars", () => {
  it("refreshes a locale fragment when a module starts using another translated message", async () => {
    const root = await createFixture();
    const labelPath = path.join(root, "label.ts");
    server = await createServer({
      configFile: false,
      envFile: false,
      logLevel: "silent",
      root,
      cacheDir: path.join(root, ".vite"),
      plugins: [
        palamedes({ configPath: path.join(root, "palamedes.yaml"), mdx: false }),
        {
          name: "external-palamedes-packages",
          resolveId(id) {
            if (id.startsWith("@palamedes/")) return { id, external: true };
          },
        },
      ],
      optimizeDeps: { noDiscovery: true },
      server: {
        middlewareMode: true,
        hmr: false,
        watch: {
          usePolling: true,
          interval: 20,
          awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
        },
      },
    });

    const initial = await server.transformRequest("/label.ts");
    const key = /palamedes:messages\/([0-9a-f]{12})/u.exec(initial?.code ?? "")?.[1];
    if (!key) throw new Error("Expected a message sidecar import");
    const sidecarUrl = `\0palamedes:messages/${key}`;
    const fragmentUrl = `${sidecarUrl}/de`;
    await server.transformRequest(sidecarUrl);
    const before = await server.transformRequest(fragmentUrl);
    expect(before?.code).toContain("Hallo");
    expect(before?.code).not.toContain("Abbrechen");

    server.watcher.add(labelPath);
    await expect
      .poll(() => server?.watcher.getWatched()[root], { timeout: 5000 })
      .toContain("label.ts");
    const module = await server.moduleGraph.getModuleByUrl("/label.ts");
    if (!module) throw new Error("Expected the label module in Vite's graph");
    const previous = module.lastInvalidationTimestamp;
    await writeFile(
      labelPath,
      'import { t } from "@palamedes/core/macro";\nexport const labels = () => [t`Hello`, t`Cancel`];\n',
    );
    await expect
      .poll(() => module.lastInvalidationTimestamp, { timeout: 5000 })
      .toBeGreaterThan(previous);

    // Request order follows the browser: edited module, sidecar, fragment.
    const updated = await server.transformRequest("/label.ts");
    const sidecar = await server.transformRequest(sidecarUrl);
    const after = await server.transformRequest(fragmentUrl);
    expect(after?.code).toContain("Hallo");
    expect(after?.code).toContain("Abbrechen");
    // HMR timestamps on both imports keep the browser from reusing the
    // sidecar and fragment it evaluated before the edit.
    expect(updated?.code).toMatch(
      new RegExp(`/@id/__x00__palamedes:messages/${key}\\?t=\\d+`, "u"),
    );
    expect(sidecar?.code).toMatch(
      new RegExp(`/@id/__x00__palamedes:messages/${key}/de\\?t=\\d+`, "u"),
    );
  });
});

async function createFixture(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "palamedes-sidecar-dev-")));
  directories.push(root);
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "label.ts"),
    'import { t } from "@palamedes/core/macro";\nexport const labels = () => [t`Hello`];\n',
  );
  await mkdir(path.join(root, "locales"));
  await writeFile(
    path.join(root, "palamedes.yaml"),
    "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [label.ts]\n",
  );
  const translations = { en: ["Hello", "Cancel"], de: ["Hallo", "Abbrechen"] };
  for (const [locale, [hello, cancel]] of Object.entries(translations)) {
    await writeFile(
      path.join(root, `locales/${locale}.po`),
      `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\n` +
        `msgid "Hello"\nmsgstr "${hello}"\n\nmsgid "Cancel"\nmsgstr "${cancel}"\n`,
    );
  }
  return root;
}
