import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";
import { compileCatalogArtifact } from "@palamedes/core-node";
import { createPalamedesRemixCatalogAssetRegistry } from "./index";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each([true, false])(
  "reports only conflicting fragment values (conflict=%s)",
  async (conflict) => {
    const root = mkdtempSync(path.join(tmpdir(), "palamedes-remix-conflicts-"));
    roots.push(root);
    mkdirSync(path.join(root, "app"));
    // Registration verifies the selection against the authored source on disk.
    for (const page of ["page", "other"]) {
      writeFileSync(
        path.join(root, "app", `${page}.ts`),
        'import { t } from "@palamedes/core/macro";\nexport const greeting = () => t`Hello`;\n',
      );
    }
    const po = (locale: string, value: string) =>
      `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hello"\nmsgstr "${value}"\n`;
    for (const catalog of ["first", "last"]) {
      mkdirSync(path.join(root, catalog));
      writeFileSync(path.join(root, catalog, "en.po"), po("en", "Hello"));
      writeFileSync(
        path.join(root, catalog, "de.po"),
        po("de", catalog === "last" && conflict ? "Guten Tag" : "Hallo"),
      );
    }
    writeFileSync(
      path.join(root, "palamedes.yaml"),
      `source-locale: en\nlocales: [en, de]\ncatalogs:\n  - path: first/{locale}\n    include: [app]\n  - path: last/{locale}\n    include: [app]\n`,
    );
    const compiled = compileCatalogArtifact(
      {
        rootDir: root,
        sourceLocale: "en",
        locales: ["en", "de"],
        catalogs: [{ path: "first/{locale}", include: ["app"] }],
      },
      path.join(root, "first/de.po"),
    );
    const ids = Object.keys(compiled.messages);
    expect(ids).toHaveLength(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createPalamedesRemixCatalogAssetRegistry({ projectRoot: root, watch: false });
    try {
      const first = registry.register(path.join(root, "app/page.ts"), ids);
      const second = registry.register(path.join(root, "app/other.ts"), ids);
      for (const key of [first, second, first]) {
        const response = registry.serve(
          new Request(`https://example.test${registry.sidecarUrl(key)}?fragment=1&locale=de`),
        );
        expect(response?.status).toBe(200);
        expect(await response!.text()).toContain(conflict ? "Guten Tag" : "Hallo");
      }
      expect(warn).toHaveBeenCalledTimes(conflict ? 1 : 0);
      if (conflict) expect(warn).toHaveBeenCalledWith(expect.stringContaining("last catalog wins"));
      registry.invalidate();
      registry.serve(
        new Request(`https://example.test${registry.sidecarUrl(first)}?fragment=1&locale=de`),
      );
      expect(warn).toHaveBeenCalledTimes(conflict ? 2 : 0);
    } finally {
      registry.close?.();
    }
  },
);
