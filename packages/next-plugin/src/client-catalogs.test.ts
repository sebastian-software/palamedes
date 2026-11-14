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
    vi.stubEnv("PALAMEDES_NEXT_CATALOG_BUILD", undefined);
    vi.stubEnv("PALAMEDES_NEXT_CATALOG_BASE", undefined);
    expect(await render("de")).toBeNull();
  });

  it("links the locale's catalog map, named by the build token, as a module preload", async () => {
    vi.stubEnv("PALAMEDES_NEXT_CATALOG_BUILD", "0123456789ab");
    vi.stubEnv("PALAMEDES_NEXT_CATALOG_BASE", "/cdn/_next/static/palamedes/");

    const element = await render("de-AT");
    expect(element?.type).toBe("link");
    expect(element?.props).toEqual({
      id: "palamedes-client-catalogs",
      rel: "modulepreload",
      href: "/cdn/_next/static/palamedes/catalogs.de-AT.0123456789ab.js",
    });
    // A locale that is not one path segment never reaches the URL.
    expect(await render("../de")).toBeNull();
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
      path.join(assets, "catalogs.de.0123456789ab.mjs"),
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
    const href = pathToFileURL(path.join(assets, "catalogs.de.0123456789ab.mjs")).href;
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

describe("clientCatalogMessages", () => {
  it("returns inlined messages and rejects the marker of a locale-neutral chunk", async () => {
    const helper = new URL("../client-catalog.mjs", import.meta.url).href;
    const { clientCatalogMessages } = (await import(helper)) as {
      clientCatalogMessages(value: unknown): unknown;
    };
    const messages = { a: "Hallo" };
    expect(clientCatalogMessages(messages)).toBe(messages);
    const payload = Buffer.from(JSON.stringify({ source: "src/a.tsx", ids: ["a"] })).toString(
      "base64url",
    );
    expect(() => clientCatalogMessages(`pmds-next:0123456789ab:${payload}`)).toThrow(
      /locale-neutral client chunk for src\/a\.tsx/u,
    );
  });
});
