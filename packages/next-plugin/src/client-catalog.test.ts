import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  var __pmds_test_asset_attempts: number | undefined;
}

type ClientCatalogModule = { loadClientCatalog(marker: string): Promise<Record<string, unknown>> };

// The helper ships as plain browser ESM without declarations.
const clientCatalogUrl = new URL("../client-catalog.mjs", import.meta.url).href;
const KEY = "0123456789ab";
const MARKER = `pmds-next:${KEY}:${Buffer.from(
  JSON.stringify({ source: "src/components/Greeting.tsx", ids: ["a"] }),
).toString("base64url")}`;

let assetDir: string;

// A DOM-less document: the map element, <html lang>, and the base URI that
// relative asset URLs resolve against.
function stubDocument(map: unknown, lang = "de") {
  vi.stubGlobal("document", {
    baseURI: pathToFileURL(`${assetDir}/`).href,
    documentElement: { lang },
    readyState: "complete",
    addEventListener: vi.fn(),
    getElementById: (id: string) =>
      id === "palamedes-client-catalogs" && map !== undefined
        ? { textContent: JSON.stringify(map) }
        : null,
  });
}

async function writeAsset(name: string, source: string) {
  const file = path.join(assetDir, name);
  await writeFile(file, source);
  return pathToFileURL(file).href;
}

// The module memoizes the document map, so each test loads a fresh copy.
async function loadModule(): Promise<ClientCatalogModule> {
  vi.resetModules();
  return (await import(clientCatalogUrl)) as ClientCatalogModule;
}

beforeEach(async () => {
  assetDir = await mkdtemp(path.join(os.tmpdir(), "pmds-client-catalog-"));
  globalThis.__pmds_test_asset_attempts = 0;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete globalThis.__pmds_test_asset_attempts;
  await rm(assetDir, { recursive: true, force: true });
});

describe("loadClientCatalog", () => {
  it("returns the messages of the module's asset", async () => {
    const url = await writeAsset("chunk.de.js", 'export const messages = { a: "Hallo" };');
    stubDocument({ locale: "de", assets: { [KEY]: url } });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).resolves.toEqual({ a: "Hallo" });
  });

  it("retries a failed import once under a distinct URL", async () => {
    // The first evaluation fails like a dropped request. Re-importing the same
    // URL would return that cached failure; the retry query avoids it.
    const url = await writeAsset(
      "flaky.de.js",
      `globalThis.__pmds_test_asset_attempts += 1;
if (globalThis.__pmds_test_asset_attempts === 1) throw new Error("dropped");
export const messages = { a: "Hallo" };`,
    );
    stubDocument({ locale: "de", assets: { [KEY]: url } });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).resolves.toEqual({ a: "Hallo" });
    expect(globalThis.__pmds_test_asset_attempts).toBe(2);
  });

  it("names the module and URL when the asset fails twice", async () => {
    const url = pathToFileURL(path.join(assetDir, "missing.de.js")).href;
    stubDocument({ locale: "de", assets: { [KEY]: url } });
    const { loadClientCatalog } = await loadModule();

    const failure = await loadClientCatalog(MARKER).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `Palamedes could not load the "de" messages of src/components/Greeting.tsx from ${url}, also after one retry. Check that .next/static/palamedes is served from the same build as the client chunks.`,
    );
    expect((failure as Error).cause).toBeInstanceOf(Error);
  });

  it("does not retry a module that has no asset in the map", async () => {
    stubDocument({ locale: "de", assets: {} });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).rejects.toThrow(
      `The Palamedes client catalog map has no "de" asset for src/components/Greeting.tsx (module key ${KEY}).`,
    );
  });

  it("falls back to the module key for a marker without a readable payload", async () => {
    stubDocument({ locale: "de", assets: {} });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(`pmds-next:${KEY}:%`)).rejects.toThrow(
      `has no "de" asset for ${KEY} (module key ${KEY})`,
    );
  });

  it("rejects a map rendered for another locale", async () => {
    stubDocument({ locale: "en", assets: {} }, "de");
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).rejects.toThrow(
      'The Palamedes client catalog map is for locale "en", but the document locale is "de".',
    );
  });

  it("rejects an asset that exports no messages without retrying", async () => {
    const url = await writeAsset(
      "empty.de.js",
      "globalThis.__pmds_test_asset_attempts += 1; export const other = 1;",
    );
    stubDocument({ locale: "de", assets: { [KEY]: url } });
    const { loadClientCatalog } = await loadModule();

    await expect(loadClientCatalog(MARKER)).rejects.toThrow(
      `${url} is not a Palamedes client catalog asset: it exports no messages.`,
    );
    expect(globalThis.__pmds_test_asset_attempts).toBe(1);
  });
});
