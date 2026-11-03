import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { traceClientCatalogManifest } from "./client-catalog-trace";

describe("traceClientCatalogManifest", () => {
  let distDir: string;
  const readTrace = (file: string) => JSON.parse(readFileSync(path.join(distDir, file), "utf8"));
  const writeTrace = (file: string, contents: unknown) => {
    mkdirSync(path.dirname(path.join(distDir, file)), { recursive: true });
    writeFileSync(path.join(distDir, file), JSON.stringify(contents));
  };

  beforeEach(() => {
    distDir = mkdtempSync(path.join(tmpdir(), "palamedes-next-trace-"));
    writeFileSync(path.join(distDir, "palamedes-client-catalogs.json"), '{"locales":{}}');
  });

  afterEach(() => rmSync(distDir, { recursive: true, force: true }));

  const traceManifest = (hashSalt = "") =>
    traceClientCatalogManifest({
      distDir,
      manifestPath: path.join(distDir, "palamedes-client-catalogs.json"),
      hashSalt,
    });

  it("adds the manifest to every App Router and Pages Router server trace", async () => {
    writeTrace("server/app/[locale]/page.js.nft.json", {
      version: 1,
      files: ["../../chunks/ssr/a.js"],
      fileHashes: ["aaaa"],
      entryHash: "entry",
    });
    writeTrace("server/pages/legacy.js.nft.json", { version: 1, files: ["../chunks/b.js"] });
    writeTrace("server/middleware.js.nft.json", { version: 1, files: [] });

    expect(await traceManifest("salt")).toBe(2);

    const hash = createHash("sha256").update("salt").update("file:").update('{"locales":{}}');
    expect(readTrace("server/app/[locale]/page.js.nft.json")).toEqual({
      version: 1,
      files: ["../../chunks/ssr/a.js", "../../../palamedes-client-catalogs.json"],
      fileHashes: ["aaaa", hash.digest("hex")],
      entryHash: "entry",
    });
    expect(readTrace("server/pages/legacy.js.nft.json").files).toEqual([
      "../chunks/b.js",
      "../../palamedes-client-catalogs.json",
    ]);
    expect(readTrace("server/middleware.js.nft.json").files).toEqual([]);
  });

  it("updates the hash instead of listing the manifest twice", async () => {
    writeTrace("server/app/page.js.nft.json", {
      files: ["../../palamedes-client-catalogs.json"],
      fileHashes: ["stale"],
    });

    await traceManifest();

    const { files, fileHashes } = readTrace("server/app/page.js.nft.json");
    expect(files).toEqual(["../../palamedes-client-catalogs.json"]);
    expect(fileHashes).not.toEqual(["stale"]);
  });

  it("does nothing when the build emitted no server traces", async () => {
    expect(await traceManifest()).toBe(0);
  });
});
