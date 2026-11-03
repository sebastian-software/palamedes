import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "next/dist/server/node-environment.js";

let distDir: string;

beforeEach(async () => {
  distDir = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-client-catalogs-"));
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(distDir, { recursive: true, force: true });
});

describe("PalamedesClientCatalogs", () => {
  async function render(locale: string) {
    const { PalamedesClientCatalogs } = await import("./server");
    return PalamedesClientCatalogs({ locale });
  }

  it("renders nothing when the build keeps catalogs in the module graph", async () => {
    vi.stubEnv("PALAMEDES_NEXT_DIST_DIR", undefined);
    expect(await render("de")).toBeNull();
  });

  it("links the locale's catalog map as a module preload", async () => {
    await writeFile(
      path.join(distDir, "palamedes-client-catalogs.json"),
      JSON.stringify({ maps: { de: "/_next/static/palamedes/catalogs.de-0123abcd.js" } }),
    );
    vi.stubEnv("PALAMEDES_NEXT_DIST_DIR", path.relative(process.cwd(), distDir));

    const element = await render("de");
    expect(element?.type).toBe("link");
    expect(element?.props).toEqual({
      id: "palamedes-client-catalogs",
      rel: "modulepreload",
      href: "/_next/static/palamedes/catalogs.de-0123abcd.js",
    });
    expect(await render("constructor")).toBeNull();
    expect(await render("fr")).toBeNull();
  });
});

describe("loadClientCatalog", () => {
  const first = "0123456789ab";
  const second = "ba9876543210";
  const lone = "aaaaaaaaaaaa";

  async function setUpDocument(lang: string) {
    const assets = path.join(distDir, "palamedes");
    await mkdir(assets);
    await writeFile(
      path.join(assets, "catalogs.de-0123abcd.mjs"),
      `export default ${JSON.stringify({
        locale: "de",
        assets: { "group.de-1.mjs": `${first}${second}`, "lone.de-2.mjs": lone },
      })};\n`,
    );
    await writeFile(
      path.join(assets, "group.de-1.mjs"),
      'export const messages = { a: "Gruppe" };\n',
    );
    await writeFile(
      path.join(assets, "lone.de-2.mjs"),
      'export const messages = { b: "Allein" };\n',
    );
    const href = pathToFileURL(path.join(assets, "catalogs.de-0123abcd.mjs")).href;
    vi.stubGlobal("document", {
      readyState: "complete",
      documentElement: { lang },
      getElementById: (id: string) => (id === "palamedes-client-catalogs" ? { href } : null),
    });
    const helper = new URL("../client-catalog.mjs", import.meta.url).href;
    return import(helper) as Promise<{ loadClientCatalog(marker: string): Promise<unknown> }>;
  }

  it("resolves each module key to its asset through the locale map", async () => {
    const { loadClientCatalog } = await setUpDocument("de");
    await expect(loadClientCatalog(`pmds-next:${second}:e30`)).resolves.toEqual({ a: "Gruppe" });
    await expect(loadClientCatalog(`pmds-next:${lone}:e30`)).resolves.toEqual({ b: "Allein" });
    await expect(loadClientCatalog("pmds-next:ffffffffffff:e30")).rejects.toThrow(
      "(module key ffffffffffff)",
    );
  });

  it("rejects a map for another locale", async () => {
    const { loadClientCatalog } = await setUpDocument("fr");
    await expect(loadClientCatalog(`pmds-next:${first}:e30`)).rejects.toThrow(
      'is for locale "de", but the document locale is "fr"',
    );
  });
});
