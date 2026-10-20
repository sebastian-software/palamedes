import http from "node:http";
import { afterEach, expect, it } from "vitest";
import { createReadinessServer, probe } from "./readiness.mjs";
const servers = [];
async function listen(server) {
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});
it("withholds readiness until every selected backend answers, including Vite", async () => {
  const states = new Map([
    ["one", true],
    ["vite-mdx", false],
  ]);
  let stopping = false;
  const origin = await listen(
    createReadinessServer(
      [...states.keys()].map((id) => ({ id })),
      { check: async ({ id }) => states.get(id), isStopping: () => stopping },
    ),
  );
  expect((await fetch(`${origin}/ready`)).status).toBe(503);
  states.set("vite-mdx", true);
  expect((await fetch(`${origin}/ready`)).status).toBe(200);
  stopping = true;
  expect((await fetch(`${origin}/ready`)).status).toBe(503);
  expect((await fetch(`${origin}/other`)).status).toBe(404);
});
it("probes the backend host/path and handles refusal, timeout, and failure status", async () => {
  const origin = await listen(
    http.createServer((req, res) => {
      if (req.url === "/hang") return;
      if (req.url === "/de" && req.headers.host === "de.demo.com") res.writeHead(200).end();
      else res.writeHead(503).end();
    }),
  );
  const port = Number(new URL(origin).port);
  expect(
    await probe({ port, smokeChecks: [{ path: "/de", headers: { host: "de.demo.com" } }] }),
  ).toBe(true);
  expect(await probe({ port, smokeChecks: [] })).toBe(false);
  expect(await probe({ port, smokeChecks: [{ path: "/hang" }] }, 30)).toBe(false);
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const closedPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  expect(await probe({ port: closedPort, smokeChecks: [] })).toBe(false);
});
it("coalesces overlapping readiness polls", async () => {
  let calls = 0;
  let release;
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const origin = await listen(
    createReadinessServer([{ id: "one" }], {
      check() {
        calls++;
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    }),
  );
  const first = fetch(`${origin}/ready`);
  await entered;
  const second = fetch(`${origin}/ready`);
  // Wait for the second request to reach the server without timing assumptions.
  await new Promise((resolve) => servers.at(-1).once("request", resolve));
  release(true);
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  expect(calls).toBe(1);
});
