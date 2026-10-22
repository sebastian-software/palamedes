// Read-only inventory for the existing gated Bunny deployment. Never persist
// full API responses: container environments and registry settings may be secret.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { BUNNYNET_API_KEY: key, BUNNY_DEMO_APP_ID: app } = process.env;
assert.ok(
  key && /^[a-zA-Z0-9-]+$/u.test(app ?? ""),
  "Configure the existing Bunny deployment environment.",
);
async function get(path) {
  const response = await fetch(`https://api.bunny.net/${path}`, {
    headers: { AccessKey: key },
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Bunny inventory ${path} returned HTTP ${response.status}`);
  return response.json();
}
const config = await get(`mc/apps/${app}`);
const containers = config.containerTemplates.map(
  ({ id, name, imageName, imageTag, imageDigest, endpoints }) => ({
    id,
    name,
    imageName,
    imageTag,
    imageDigest,
    endpoints,
  }),
);
const zones = await get("dnszone?page=1&perPage=1000");
const items = Array.isArray(zones) ? zones : zones.Items;
assert.ok(Array.isArray(items), "Expected a DNS zone list.");
const dns = [];
for (const zone of items.filter(({ Domain }) =>
  [
    "palamedes.dev",
    "palamedes-i18n.com",
    "palamedes-i18n.de",
    "palamedes-i18n.es",
    "palamedes-i18n.fr",
  ].includes(Domain),
)) {
  const detail = await get(`dnszone/${zone.Id}`);
  dns.push({
    id: zone.Id,
    domain: zone.Domain,
    records: detail.Records.filter(({ Name }) => Name.includes("examples")).map(
      ({ Id, Type, Name, Value, Ttl }) => ({ Id, Type, Name, Value, Ttl }),
    ),
  });
}
const endpoint = containers
  .flatMap(({ endpoints }) => endpoints)
  .find(({ displayName }) => displayName.includes("nextjs-cookie"));
const pullZone = endpoint?.pullZoneId ? await get(`pullzone/${endpoint.pullZoneId}`) : undefined;
const safeFields = [
  "Id",
  "Name",
  "OriginUrl",
  "ForwardHostHeader",
  "EnableCookies",
  "CacheControlMaxAgeOverride",
  "CacheControlPublicMaxAgeOverride",
  "OriginHostHeader",
  "EnableCacheSlice",
  "DisableCookies",
  "IgnoreQueryStrings",
  "CacheErrorResponses",
  "EnableQueryStringOrdering",
];
const safePullZone = pullZone && {
  ...Object.fromEntries(
    safeFields
      .filter((field) => Object.hasOwn(pullZone, field))
      .map((field) => [field, pullZone[field]]),
  ),
  Hostnames: pullZone.Hostnames.map(
    ({ Id, Value, HasCertificate, ForceSSL, IsSystemHostname }) => ({
      Id,
      Value,
      HasCertificate,
      ForceSSL,
      IsSystemHostname,
    }),
  ),
};
const overview = await get(`mc/apps/${app}/overview`);
const runtime = {
  status: overview.status,
  regions: overview.regions.map(({ region, status, pods }) => ({
    region,
    status,
    pods: pods.map(
      ({
        name,
        status,
        ramUsageBytes,
        cpuUsageCores,
        ephemeralStorageUsageBytes,
        containers: runningContainers,
      }) => ({
        name,
        status,
        ramUsageBytes,
        cpuUsageCores,
        ephemeralStorageUsageBytes,
        containers: runningContainers.map(
          ({ name, status, image, imageDisplay, numberOfRestarts }) => ({
            name,
            status,
            image,
            imageDisplay,
            numberOfRestarts,
          }),
        ),
      }),
    ),
  })),
};
const receipt = {
  app,
  inspectedAt: new Date().toISOString(),
  runtime,
  containers,
  dns,
  pullZone: safePullZone,
};
await mkdir("deployment-receipt", { recursive: true });
await writeFile(
  "deployment-receipt/hosting-inventory.json",
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(
  `Inspected ${containers.flatMap(({ endpoints }) => endpoints).length} endpoints and ${dns.length} relevant DNS zones. Sanitized inventory saved.`,
);
