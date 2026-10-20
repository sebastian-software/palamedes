// Exercise the already-running production servers inside the built image.
// Reuse the source/CI smoke contracts; do not rebuild or start replacement apps.
import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout } from "node:timers/promises";

import { EXAMPLE_MATRIX } from "../example-matrix.mjs";

function request(port, check) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: check.path,
        headers: check.headers,
        timeout: 10_000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Container smoke request timed out")));
  });
}

for (const example of EXAMPLE_MATRIX) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const response = await request(example.port, example.smokeChecks[0] ?? { path: "/" });
      assert.equal(response.status, 200);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await setTimeout(500);
    }
  }
  for (const check of example.smokeChecks.length
    ? example.smokeChecks
    : [{ path: "/", substrings: ["<html"] }]) {
    const { status, body, headers } = await request(example.port, check);
    if (check.redirectTo) {
      assert.ok(status >= 300 && status < 400, `${example.id} redirect status`);
      assert.equal(
        new URL(headers.location, `http://127.0.0.1:${example.port}`).pathname,
        check.redirectTo,
      );
    } else assert.equal(status, 200, `${example.id} ${check.path} status`);
    if (check.htmlLang) {
      assert.equal(
        body.match(/<html\b[^>]*\blang=["']([^"']+)["']/iu)?.[1],
        check.htmlLang,
        `${example.id} ${check.path} language`,
      );
    }
    for (const text of check.substrings) {
      assert.ok(body.includes(text), `${example.id} ${check.path} missing ${JSON.stringify(text)}`);
    }
  }
  console.log(`[container:smoke] ${example.id}: ${example.smokeChecks.length} checks passed`);
}
