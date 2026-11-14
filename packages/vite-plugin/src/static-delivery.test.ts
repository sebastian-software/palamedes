import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createStaticViteCatalogBootstrap } from "./delivery";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true })));
});
const hash = (source: string) => `sha256-${createHash("sha256").update(source).digest("base64")}`;

it("delays explicitly approved inline startup until the selected map is installed", async () => {
  const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "pmds-static-"));
  directories.push(clientDirectory);
  await writeFile(
    path.join(clientDirectory, "palamedes-split-manifest.json"),
    JSON.stringify({
      locales: ["en", "de"],
      importMaps: { en: "en.json", de: "de.json" },
      chunkImports: {},
    }),
  );
  await writeFile(
    path.join(clientDirectory, "en.json"),
    JSON.stringify({
      imports: { "#pmds/abc123abc123": "/assets/palamedes-m-abc123abc123.en-12345678.js" },
    }),
  );
  await writeFile(
    path.join(clientDirectory, "de.json"),
    JSON.stringify({
      imports: { "#pmds/abc123abc123": "/assets/palamedes-m-abc123abc123.de-12345678.js" },
    }),
  );
  const scriptLimits = { maxCount: 10, maxElementBytes: 4096, maxTotalBytes: 8192 };
  const classic = "<script>window.context = {};</script>";
  const startup = '<script type="module" async>import "./route.js";</script>';
  const html = `<html lang="en"><head><link rel="modulepreload" href="/assets/route.js"></head><body>${classic}${startup}</body></html>`;
  const result = createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
    html,
    scriptLimits,
    locale: { kind: "fallback", policyModule: "/assets/locale.js" },
    allowedScripts: [hash(classic), hash(startup)],
  });
  expect(result.html).not.toContain(startup);
  expect(result.html).not.toContain('rel="modulepreload"');
  expect(result.html).toContain(result.bootstrap.fileName);
  expect(result.bootstrap.source).toContain("./route.js");
  expect(result.cspHashes).toContain(hash('import "./route.js";'));
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html: html.replace("</body>", "<script>alert(1)</script></body>"),
      scriptLimits,
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).toThrow(/script/i);
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html,
      scriptLimits: { ...scriptLimits, maxCount: 1 },
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).toThrow(/count limit/i);
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html,
      scriptLimits: { ...scriptLimits, maxElementBytes: 1 },
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).toThrow(/byte limit/i);
  const deferred = '<script defer src="/assets/classic.js"></script>';
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html: html.replace("</body>", `${deferred}</body>`),
      scriptLimits,
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup), hash(deferred)],
    }),
  ).toThrow(/deferred classic scripts/i);
  const remote = '<script type="module" src="https://evil.example/app.js"></script>';
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html: html.replace(startup, remote),
      scriptLimits,
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(remote)],
    }),
  ).toThrow(/local/i);
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html: html.replace("window.context = {};", "window.context = {};alert(1);"),
      scriptLimits,
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).toThrow(/script/i);
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html,
      scriptLimits,
      locale: { kind: "fallback", policyModule: "https://evil.example/policy.js" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).toThrow(/local/i);
  await writeFile(
    path.join(clientDirectory, "en.json"),
    JSON.stringify({
      imports: { "#pmds/abc123abc123": "/assets/palamedes-m-000000000000.en-12345678.js" },
    }),
  );
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html,
      scriptLimits,
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).not.toThrow(); // Several sidecars may share a generated group asset.
  await writeFile(
    path.join(clientDirectory, "en.json"),
    JSON.stringify({
      imports: { "#pmds/abc123abc123": "/assets/palamedes-m-000000000000.de-12345678.js" },
    }),
  );
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html,
      scriptLimits,
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).toThrow(/invalid binding/i);
  await writeFile(
    path.join(clientDirectory, "palamedes-split-manifest.json"),
    JSON.stringify({ locales: ["en.US"], importMaps: { "en.US": "en.json" }, chunkImports: {} }),
  );
  await writeFile(
    path.join(clientDirectory, "en.json"),
    JSON.stringify({
      imports: { "#pmds/abc123abc123": "/assets/palamedes-m-000000000000.en.US-12345678.js" },
    }),
  );
  expect(() =>
    createStaticViteCatalogBootstrap({ clientDirectory }).transformDocument({
      html,
      scriptLimits,
      locale: { kind: "document" },
      allowedScripts: [hash(classic), hash(startup)],
    }),
  ).not.toThrow();
});
