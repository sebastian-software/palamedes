import http from "node:http";

// Poll only loopback backends, using their first existing smoke contract's host/path.
export function probe(example, timeout = 3000) {
  const check = example.smokeChecks[0] ?? { path: "/" };
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port: example.port,
        path: check.path,
        headers: check.headers,
        timeout,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode >= 200 && response.statusCode < 400);
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => request.destroy());
  });
}

export function createReadinessServer(examples, { check = probe, isStopping = () => false } = {}) {
  // A single in-flight poll prevents health clients from multiplying backend work.
  let pending;
  return http.createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/ready") {
      response.writeHead(404).end();
      return;
    }
    pending ??= Promise.all(
      examples.map(async (example) => ({ id: example.id, ready: await check(example) })),
    ).finally(() => {
      pending = undefined;
    });
    try {
      const results = await pending;
      const ready = !isStopping() && results.every((entry) => entry.ready);
      response.writeHead(ready ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ready, examples: results }));
    } catch {
      response.writeHead(503, { "cache-control": "no-store" }).end();
    }
  });
}
