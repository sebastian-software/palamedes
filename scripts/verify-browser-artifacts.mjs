import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const forbidden = ["[palamedes:icu-parser]", "parseMessagePattern", "renderNodesToString"];
export function assertParserFree(source, identity) {
  for (const marker of forbidden)
    assert.ok(
      !source.includes(marker),
      `${identity} contains the application ICU parser: ${marker}`,
    );
}

/** Inspect the complete emitted browser graph, including unused lazy chunks. */
export async function verifyBrowserArtifacts(example) {
  // Remix serves its generated graph through its asset API. The browser probe
  // below checks those actual responses instead of inventing a build directory.
  if (example.framework === "remix") return;
  const outputs = {
    nextjs: ".next/static",
    tanstack: "dist/client",
    waku: "dist/public",
    solid: ".output/public",
    "react-router": "build/client",
    "react-router-rsc": "build/client",
    vite: "dist",
  };
  assert.ok(outputs[example.framework], `Unknown artifact layout: ${example.framework}`);
  const directory = path.join(example.cwd, outputs[example.framework]);
  const files = (await readdir(directory, { recursive: true })).filter((file) =>
    /\.(?:m?js|cjs)$/.test(file),
  );
  assert.ok(files.length, `No browser JavaScript emitted for ${example.id}`);
  let decodedBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const source = await readFile(path.join(directory, file));
    assertParserFree(source.toString("utf8"), `${example.id}/${file}`);
    decodedBytes += source.byteLength;
    gzipBytes += gzipSync(source).byteLength;
  }
  console.log(
    `[v2-artifacts] ${JSON.stringify({ example: example.id, files: files.length, decodedBytes, gzipBytes, scope: "complete emitted graph, all locales and lazy chunks" })}`,
  );
}

/** Count actual successful JS responses during the ordinary host browser proof. */
export function observeBrowserArtifacts(page, example) {
  const pending = [];
  page.on("response", (response) => {
    if (!response.ok() || !/javascript/.test(response.headers()["content-type"] ?? "")) return;
    // Attach a rejection handler immediately; report read failures at the
    // awaited verification point, before the browser is closed.
    pending.push(
      response.body().then(
        (body) => ({ url: response.url(), body }),
        (error) => ({ error }),
      ),
    );
  });
  return async () => {
    const responses = await Promise.all(pending);
    assert.ok(responses.length, `${example.id} did not fetch browser JavaScript`);
    let decodedBytes = 0;
    let catalogBytes = 0;
    const modules = new Set();
    for (const response of responses) {
      if (response.error) throw response.error;
      assertParserFree(response.body.toString("utf8"), response.url);
      decodedBytes += response.body.byteLength;
      if (/palamedes-m-|catalog-fragments|\/catalog\//.test(response.url))
        catalogBytes += response.body.byteLength;
      modules.add(response.url);
    }
    console.log(
      `[v2-network] ${JSON.stringify({ example: example.id, responses: responses.length, uniqueModuleUrls: modules.size, decodedBytes, catalogBytes, scope: "observed host interaction and locale navigation; decoded response bodies" })}`,
    );
  };
}
