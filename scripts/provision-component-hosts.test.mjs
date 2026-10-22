import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  COMPONENT_HOST_PLAN,
  assertEndpoint,
  dnsRecordPlan,
  endpointRequest,
  provisionComponentHosts,
} from "./provision-component-hosts.mjs";

it("only constructs HTTP CDN additions for the known component demo ports", () => {
  const entry = COMPONENT_HOST_PLAN.find(({ id }) => id === "vue-route");
  expect(endpointRequest(entry)).toEqual({
    displayName: "vue-route",
    cdn: { isSslEnabled: false, portMappings: [{ containerPort: 4091 }] },
  });
  expect(() => endpointRequest({ id: "nextjs-cookie", port: 4010 })).toThrow();
  expect(() =>
    assertEndpoint(entry, {
      type: "cdn",
      isSslEnabled: false,
      portMappings: [{ containerPort: 4080 }],
    }),
  ).toThrow("port conflict");
});
it("reuses matching CNAMEs and refuses to replace existing DNS data", () => {
  const zone = { Id: 1, Domain: "palamedes.dev", Records: [] };
  const host = "vue-cookie.examples.palamedes.dev";
  expect(dnsRecordPlan(host, "demo.b-cdn.net", [zone]).body).toEqual({
    Type: 2,
    Name: "vue-cookie.examples",
    Value: "demo.b-cdn.net",
    Ttl: 300,
    Accelerated: false,
  });
  zone.Records.push({ Id: 7, Type: 2, Name: "vue-cookie.examples", Value: "demo.b-cdn.net." });
  expect(dnsRecordPlan(host, "demo.b-cdn.net", [zone]).existing).toBe(7);
  expect(() => dnsRecordPlan(host, "different.b-cdn.net", [zone])).toThrow("refusing to overwrite");
  zone.Records[0].Type = 1;
  expect(() => dnsRecordPlan(host, "demo.b-cdn.net", [zone])).toThrow("not a CNAME");
  expect(() => dnsRecordPlan("other.example.com", "demo.b-cdn.net", [zone])).toThrow(
    "No configured DNS zone",
  );
});
it("keeps plan mode read-only and excludes API environments from its receipt", async () => {
  const receiptDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-host-plan-"));
  const domains = [
    "palamedes.dev",
    "palamedes-i18n.com",
    "palamedes-i18n.de",
    "palamedes-i18n.es",
    "palamedes-i18n.fr",
  ];
  const zones = domains.map((Domain, Id) => ({ Id, Domain, Records: [] }));
  const calls = [];
  try {
    await provisionComponentHosts({
      key: "test-key",
      app: "test-app",
      containerName: "palamedes-examples",
      apply: false,
      receiptDirectory,
      async fetchApi(url, options) {
        calls.push({ url, method: options.method });
        const data = url.endsWith("/overview")
          ? { status: "active", regions: [] }
          : url.endsWith("/mc/apps/test-app")
            ? {
                name: "palamedes-demos",
                containerTemplates: [
                  {
                    name: "palamedes-examples",
                    imageName: "palamedes-examples",
                    endpoints: [],
                    environmentVariables: [{ name: "SECRET", value: "must-not-be-saved" }],
                  },
                ],
              }
            : url.includes("dnszone?")
              ? { Items: zones }
              : zones.find(({ Id }) => url.endsWith(`/${Id}`));
        return new Response(JSON.stringify(data));
      },
    });
    expect(calls.every(({ method }) => method === "GET")).toBe(true);
    const receipt = await readFile(path.join(receiptDirectory, "component-hosts.json"), "utf8");
    expect(receipt).not.toContain("must-not-be-saved");
    expect(JSON.parse(receipt).results).toHaveLength(16);
  } finally {
    await rm(receiptDirectory, { recursive: true, force: true });
  }
});

for (const dnsReady of [true, false])
  it(`prepares every DNS record before waiting and ${dnsReady ? "then enables TLS" : "stops TLS on propagation failure"}`, async () => {
    const receiptDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-host-apply-"));
    const digest = `sha256:${"a".repeat(64)}`;
    const original = { id: "legacy", displayName: "nextjs-cookie" };
    const container = {
      id: "demo-container",
      name: "palamedes-examples",
      imageName: "palamedes-examples",
      imageDigest: digest,
      endpoints: [original],
    };
    const config = { name: "palamedes-demos", containerTemplates: [container] };
    const zones = [
      "palamedes.dev",
      ...["com", "de", "es", "fr"].map((tld) => `palamedes-i18n.${tld}`),
    ].map((Domain, Id) => ({ Id, Domain, Records: [] }));
    const pulls = new Map();
    const dnsRecords = new Map();
    let tlsCalls = 0;
    let clock = 0;
    try {
      const operation = provisionComponentHosts({
        key: "test-key",
        app: "test-app",
        containerName: container.name,
        revision: "b".repeat(40),
        digest,
        apply: true,
        receiptDirectory,
        now: () => clock,
        async wait() {
          clock += 600_001;
        },
        async resolveHost(host) {
          expect(dnsRecords.size).toBe(40);
          if (!dnsReady) throw new Error("cached wildcard response");
          return [`${dnsRecords.get(host)}.`];
        },
        async fetchApi(url, options) {
          const { pathname, searchParams } = new URL(url);
          const body = options.body && JSON.parse(options.body);
          let data;
          if (pathname.endsWith("/overview")) {
            data = {
              status: "active",
              regions: [
                {
                  pods: [
                    {
                      status: "ready",
                      containers: [{ name: container.name, image: `demo@${digest}` }],
                    },
                  ],
                },
              ],
            };
          } else if (pathname.endsWith("/mc/apps/test-app")) data = config;
          else if (pathname.endsWith("/endpoints")) {
            const pullZoneId = pulls.size + 1;
            const endpoint = {
              id: `endpoint-${pullZoneId}`,
              displayName: body.displayName,
              type: "cdn",
              isSslEnabled: false,
              portMappings: body.cdn.portMappings,
              pullZoneId,
            };
            container.endpoints.push(endpoint);
            pulls.set(pullZoneId, {
              Hostnames: [{ Value: `demo-${pullZoneId}.b-cdn.net`, IsSystemHostname: true }],
            });
            data = { id: endpoint.id };
          } else if (pathname === "/dnszone") data = { Items: zones };
          else if (/^\/dnszone\/\d+$/u.test(pathname))
            data = zones[Number(pathname.split("/").at(-1))];
          else if (pathname.endsWith("/records")) {
            const zone = zones[Number(pathname.split("/")[2])];
            data = { ...body, Id: dnsRecords.size + 1 };
            zone.Records.push(data);
            dnsRecords.set(`${body.Name}.${zone.Domain}`, body.Value);
          } else if (pathname === "/pullzone/loadFreeCertificate") {
            expect(dnsRecords.size).toBe(40);
            tlsCalls++;
            const host = searchParams.get("hostname");
            for (const pull of pulls.values()) {
              const entry = pull.Hostnames.find(({ Value }) => Value === host);
              if (entry) entry.HasCertificate = true;
            }
          } else if (/^\/pullzone\/\d+$/u.test(pathname))
            data = pulls.get(Number(pathname.split("/").at(-1)));
          else if (pathname.endsWith("/addHostname"))
            pulls
              .get(Number(pathname.split("/")[2]))
              .Hostnames.push({ Value: body.Hostname, HasCertificate: false });
          else if (pathname.endsWith("/setForceSSL")) expect(dnsReady).toBe(true);
          else throw new Error(`Unexpected API call: ${options.method} ${pathname}`);
          return new Response(data === undefined ? null : JSON.stringify(data));
        },
      });
      if (dnsReady) await operation;
      else await expect(operation).rejects.toThrow("cached wildcard response");
      expect(dnsRecords.size).toBe(40);
      expect(tlsCalls).toBe(dnsReady ? 40 : 0);
      expect(container.endpoints[0]).toEqual(original);
      const receipt = JSON.parse(
        await readFile(path.join(receiptDirectory, "component-hosts.json"), "utf8"),
      );
      expect(receipt.results).toHaveLength(16);
      expect(receipt.results.every(({ applied }) => applied === dnsReady)).toBe(true);
    } finally {
      await rm(receiptDirectory, { recursive: true, force: true });
    }
  });
