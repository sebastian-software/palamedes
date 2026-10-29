import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  apiReferenceRoutes,
  validateApiReferenceRedirects,
  writeApiReferenceRedirects,
} from "./api-reference-redirects.mjs";
import { writeRedirectPages } from "./redirect-pages.mjs";

const siteRoot = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(
  await readFile(path.join(siteRoot, "api-reference-redirects.json"), "utf8"),
);
const moved = "/api-reference/core/modules/index/missingcompiledmessageerror";
const successor = "/api-reference/core/classes/missingcompiledmessageerror";
const currentRoutes = [...config.legacyRoutes.filter((route) => route !== moved), successor];

test("the published route list is sorted, unique, and covers every redirect", () => {
  const { legacyRoutes, redirects } = config;
  assert.ok(legacyRoutes.length >= 75);
  assert.deepEqual(legacyRoutes, [...new Set(legacyRoutes)].sort());
  for (const route of legacyRoutes) assert.match(route, /^\/api-reference(?:\/[a-z0-9-]+)*$/u);
  for (const source of Object.keys(redirects)) assert.ok(legacyRoutes.includes(source), source);
  assert.equal(redirects[moved], successor);
});

test("every published route needs a current page or a redirect to one", () => {
  const current = currentRoutes;
  validateApiReferenceRedirects(config, current);

  assert.throws(
    () => validateApiReferenceRedirects({ ...config, redirects: {} }, current),
    new RegExp(`neither a page nor a redirect:\\n${moved}`, "u"),
  );
  assert.throws(
    () => validateApiReferenceRedirects(config, [...current, moved]),
    /shadows a current page/u,
  );
  assert.throws(
    () =>
      validateApiReferenceRedirects(
        config,
        current.filter((route) => route !== successor),
      ),
    /must target a current page/u,
  );
  assert.throws(
    () =>
      validateApiReferenceRedirects(
        { ...config, redirects: { ...config.redirects, "/api-reference/new": "/api-reference" } },
        current,
      ),
    /not a published route/u,
  );
});

test("redirect pages are generated from the current routes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palamedes-api-redirects-"));
  try {
    const routesRoot = path.join(directory, "routes");
    const publicRoot = path.join(directory, "public");
    for (const route of currentRoutes) {
      const file = path.join(routesRoot, `${route.slice(1)}/index.md`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "---\n---\n");
    }
    await mkdir(path.join(publicRoot, "api-reference/stale"), { recursive: true });
    await writeFile(path.join(publicRoot, "api-reference/stale/index.html"), "old");

    assert.ok((await apiReferenceRoutes(routesRoot)).includes("/api-reference/core"));
    await writeApiReferenceRedirects(siteRoot, routesRoot, publicRoot);
    const page = await readFile(path.join(publicRoot, `${moved.slice(1)}/index.html`), "utf8");
    assert.match(page, new RegExp(`<meta http-equiv="refresh" content="0;url=${successor}">`, "u"));
    assert.match(
      page,
      new RegExp(`<link rel="canonical" href="https://palamedes.dev${successor}">`, "u"),
    );
    assert.match(page, new RegExp(`<a href="${successor}">`, "u"));
    assert.match(page, /<meta name="robots" content="noindex">/u);
    await assert.rejects(readFile(path.join(publicRoot, "api-reference/stale/index.html")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("redirect pages stay inside their section", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palamedes-redirects-"));
  const copy = { title: "Moved", message: "Moved.", linkText: "Open" };
  try {
    await assert.rejects(
      writeRedirectPages(directory, "decisions", { "/docs/x": "/decisions/y" }, copy),
      /must be a route under \/decisions\//u,
    );
    await assert.rejects(
      writeRedirectPages(directory, "decisions", { "/decisions/x": "https://example.com" }, copy),
      /must be a site route/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
