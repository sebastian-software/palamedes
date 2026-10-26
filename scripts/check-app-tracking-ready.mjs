import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const origin = "https://sebastian-app-tracking.b-cdn.net";

async function json(response) {
  assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:;|$)/u);
  assert.ok(response.body, "Missing service response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= 2048, "Oversized service response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Availability preflight only: these unauthenticated requests must be rejected
// before storage. Deployment-owned synthetic tests prove actual ingestion/deletion.
export async function checkAppTrackingReady(fetcher = fetch) {
  const get = await fetcher(`${origin}/v1/versions/palamedes/github/stable`, {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(get.status, 200, "Palamedes version route is unavailable");
  const version = await json(get);
  assert.equal(version.schema_version, 1);
  assert.equal(version.tool_id, "palamedes");
  assert.equal(version.distribution, "github");
  assert.equal(typeof version.latest_version, "string");
  // A synthetic UUID, no credential or consent, and no report data. None of
  // these probes can register an identity or add usage to the database.
  for (const [method, path] of [
    ["PUT", "/v1/installations/00000000-0000-7000-8000-000000000001"],
    ["POST", "/v1/usage-batches"],
    ["DELETE", "/v1/installations/00000000-0000-7000-8000-000000000001"],
  ]) {
    const response = await fetcher(`${origin}${path}`, {
      method,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "App-Tracking-Tool": "palamedes",
        ...(method === "DELETE" ? {} : { "Content-Type": "application/json" }),
      },
      ...(method === "DELETE" ? {} : { body: "{}" }),
    });
    assert.equal(response.status, 401, "Production telemetry routes are not ready");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.notEqual(response.headers.get("cdn-cache")?.toUpperCase(), "HIT");
    assert.deepEqual(await json(response), { schema_version: 1, error: { code: "unauthorized" } });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await checkAppTrackingReady();
    console.log(
      "Palamedes version and uncached telemetry routes are available; no reports were sent.",
    );
  } catch {
    console.error(
      "app-tracking is not ready for Palamedes publication; complete app-tracking #11 first.",
    );
    process.exitCode = 1;
  }
}
