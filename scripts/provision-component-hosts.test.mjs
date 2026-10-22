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
