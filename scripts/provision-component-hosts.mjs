// Scoped additions to the existing Bunny app. API contracts:
// https://api-mc.opsbunny.net/docs/public/swagger.json
// https://bunny.net/docs/api-reference/core/dns-zone/add-dns-record
import assert from "node:assert/strict";
import { resolveCname } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { COMPONENT_DEMOS } from "./component-demos.mjs";
import { selectDeployment } from "./demo-deployment.mjs";

export const COMPONENT_HOST_PLAN = selectDeployment(COMPONENT_DEMOS.map(({ id }) => id));
export function endpointRequest(entry) {
  assert.ok(COMPONENT_HOST_PLAN.some(({ id, port }) => id === entry.id && port === entry.port));
  return {
    displayName: entry.id,
    cdn: { isSslEnabled: false, portMappings: [{ containerPort: entry.port }] },
  };
}
export function assertEndpoint(entry, endpoint) {
  assert.equal(endpoint.type.toLowerCase(), "cdn", `${entry.id}: expected a CDN endpoint`);
  assert.equal(endpoint.isSslEnabled, false, `${entry.id}: the backend speaks HTTP`);
  assert.deepEqual(
    endpoint.portMappings.map(({ containerPort }) => containerPort),
    [entry.port],
    `${entry.id}: port conflict`,
  );
}
export function dnsRecordPlan(host, target, zones) {
  const zone = zones.find(({ Domain }) => host.endsWith(`.${Domain}`));
  assert.ok(zone, `No configured DNS zone for ${host}`);
  const name = host.slice(0, -(zone.Domain.length + 1));
  const existing = zone.Records.filter(({ Name }) => (Name ?? "").toLowerCase() === name);
  assert.ok(existing.length <= 1, `${host}: conflicting DNS records`);
  if (existing.length) {
    assert.equal(existing[0].Type, 2, `${host}: existing record is not a CNAME`);
    assert.equal(
      existing[0].Value.replace(/\.$/u, "").toLowerCase(),
      target,
      `${host}: refusing to overwrite a different target`,
    );
  }
  return {
    zoneId: zone.Id,
    existing: existing[0]?.Id,
    body: { Type: 2, Name: name, Value: target, Ttl: 300, Accelerated: false },
  };
}

export async function provisionComponentHosts({
  key,
  app,
  containerName,
  digest,
  revision,
  apply,
  fetchApi = fetch,
  receiptDirectory = "deployment-receipt",
}) {
  assert.ok(key && /^[a-zA-Z0-9-]+$/u.test(app ?? "") && containerName);
  const receipt = {
    app,
    container: containerName,
    apply,
    startedAt: new Date().toISOString(),
    results: [],
  };
  const save = async () => {
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(
      `${receiptDirectory}/component-hosts.json`,
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  };
  async function call(path, method = "GET", body) {
    const response = await fetchApi(`https://api.bunny.net/${path}`, {
      method,
      headers: { AccessKey: key, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    assert.ok(response.ok, `Bunny ${method} ${path} returned HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
  const root = `mc/apps/${app}`;
  const config = await call(root);
  assert.equal(config.name, "palamedes-demos");
  const containers = config.containerTemplates.filter(({ name }) => name === containerName);
  assert.equal(containers.length, 1);
  const container = containers[0];
  assert.equal(container.imageName, "palamedes-examples");
  const originalEndpoints = structuredClone(container.endpoints);
  const zoneList = await call("dnszone?page=1&perPage=1000");
  const domains = [
    "palamedes.dev",
    "palamedes-i18n.com",
    "palamedes-i18n.de",
    "palamedes-i18n.es",
    "palamedes-i18n.fr",
  ];
  const zones = [];
  for (const domain of domains) {
    const zone = zoneList.Items.find(({ Domain }) => Domain === domain);
    assert.ok(zone, `Expected existing DNS zone ${domain}`);
    zones.push(await call(`dnszone/${zone.Id}`));
  }
  // Preflight every known endpoint before the first write.
  for (const entry of COMPONENT_HOST_PLAN) {
    const existing = container.endpoints.find(({ displayName }) => displayName === entry.id);
    if (existing) {
      assertEndpoint(entry, existing);
      const pullZone = await call(`pullzone/${existing.pullZoneId}`);
      const target = pullZone.Hostnames.find(({ IsSystemHostname }) => IsSystemHostname)?.Value;
      assert.ok(target, `${entry.id}: no system hostname`);
      for (const host of entry.hosts) dnsRecordPlan(host, target, zones);
    } else {
      for (const host of entry.hosts) {
        const zone = zones.find(({ Domain }) => host.endsWith(`.${Domain}`));
        const name = host.slice(0, -(zone.Domain.length + 1));
        assert.ok(
          !zone.Records.some(({ Name }) => (Name ?? "").toLowerCase() === name),
          `${host}: DNS already exists without a matching component endpoint`,
        );
      }
    }
  }
  const overview = await call(`${root}/overview`);
  receipt.rollout = {
    status: overview.status,
    regions: overview.regions.map(({ region, status, pods }) => ({
      region,
      status,
      pods: pods.map(({ name, status, containers: runningContainers }) => ({
        name,
        status,
        containers: runningContainers.map(
          ({ name, status, image, imageDisplay, numberOfRestarts }) => ({
            name,
            status,
            image,
            imageDisplay,
            numberOfRestarts,
          }),
        ),
      })),
    })),
  };
  if (apply) {
    assert.match(digest ?? "", /^sha256:[a-f0-9]{64}$/u);
    assert.match(revision ?? "", /^[a-f0-9]{40}$/u);
    assert.equal(
      container.imageDigest,
      digest,
      "Deploy the verified 41-demo image before adding hosts",
    );
    assert.equal(overview.status, "active", "Wait for the image rollout to finish");
    const pods = overview.regions.flatMap(({ pods: regionPods }) => regionPods);
    assert.ok(
      pods.length > 0 && pods.every(({ status }) => status === "ready"),
      "All pods must be ready",
    );
    for (const pod of pods) {
      const running = pod.containers.find(({ name }) => name === containerName);
      assert.ok(
        running &&
          [running.image, running.imageDisplay].some(
            (image) => image?.includes(digest) || image?.includes(`sha-${revision}`),
          ),
        "A previous image is still running",
      );
    }
  }
  try {
    for (const entry of COMPONENT_HOST_PLAN) {
      const result = { id: entry.id, port: entry.port, hosts: entry.hosts, applied: false };
      receipt.results.push(result);
      if (!apply) {
        result.action = container.endpoints.some(({ displayName }) => displayName === entry.id)
          ? "verify existing"
          : "add endpoint and hosts";
        continue;
      }
      let endpoint = container.endpoints.find(({ displayName }) => displayName === entry.id);
      if (!endpoint) {
        const created = await call(
          `${root}/containers/${container.id}/endpoints`,
          "POST",
          endpointRequest(entry),
        );
        result.addedEndpointId = created.id;
        const refreshed = await call(root);
        endpoint = refreshed.containerTemplates
          .find(({ id }) => id === container.id)
          .endpoints.find(({ displayName }) => displayName === entry.id);
      }
      assert.ok(endpoint, `${entry.id}: endpoint was not returned after creation`);
      assertEndpoint(entry, endpoint);
      assert.match(String(endpoint.pullZoneId), /^\d+$/u);
      const pull = `pullzone/${endpoint.pullZoneId}`;
      const zone = await call(pull);
      const target = zone.Hostnames.find(({ IsSystemHostname }) => IsSystemHostname)?.Value;
      assert.match(target ?? "", /^[a-z0-9-]+\.b-cdn\.net$/u);
      result.endpointId = endpoint.id;
      result.pullZoneId = endpoint.pullZoneId;
      result.target = target;
      await save();
      // Only the newly owned component pull zones receive these demo settings.
      await call(pull, "POST", {
        CacheControlMaxAgeOverride: 0,
        CacheControlPublicMaxAgeOverride: -1,
        DisableCookies: false,
        AddHostHeader: true,
        OriginHostHeader: "",
        EnableSmartCache: false,
        IgnoreQueryStrings: false,
        FollowRedirects: false,
      });
      result.dns = [];
      for (const host of entry.hosts) {
        const record = dnsRecordPlan(host, target, zones);
        const dns = { host, zoneId: record.zoneId, existingRecordId: record.existing };
        result.dns.push(dns);
        if (!record.existing) {
          const created = await call(`dnszone/${record.zoneId}/records`, "PUT", record.body);
          dns.addedRecordId = created.Id;
          zones.find(({ Id }) => Id === record.zoneId).Records.push(created);
        }
        if (!zone.Hostnames.some(({ Value }) => Value === host))
          await call(`${pull}/addHostname`, "POST", { Hostname: host });
        await save();
        const deadline = Date.now() + 300_000;
        for (;;) {
          try {
            assert.ok(
              (await resolveCname(host)).some((value) => value.replace(/\.$/u, "") === target),
            );
            break;
          } catch (error) {
            if (Date.now() > deadline) throw error;
            await setTimeout(10_000);
          }
        }
        const current = await call(pull);
        if (!current.Hostnames.find(({ Value }) => Value === host)?.HasCertificate)
          await call(`pullzone/loadFreeCertificate?hostname=${encodeURIComponent(host)}`);
        await call(`${pull}/setForceSSL`, "POST", { Hostname: host, ForceSSL: true });
        dns.tlsRequested = true;
        await save();
      }
      result.applied = true;
      await save();
      console.log(`${entry.id}: endpoint and ${entry.hosts.length} HTTPS hostnames configured`);
    }
    if (apply) {
      const after = await call(root);
      const endpoints = after.containerTemplates.find(({ id }) => id === container.id).endpoints;
      for (const original of originalEndpoints)
        assert.deepEqual(
          endpoints.find(({ id }) => id === original.id),
          original,
          "An existing endpoint changed",
        );
    }
    receipt.finishedAt = new Date().toISOString();
  } finally {
    await save();
  }
  console.log(
    `${apply ? "Configured" : "Planned"} ${receipt.results.length} component demo endpoints. Public browser acceptance is still required.`,
  );
}

if (process.argv[1] === import.meta.filename)
  await provisionComponentHosts({
    key: process.env.BUNNYNET_API_KEY,
    app: process.env.BUNNY_DEMO_APP_ID,
    containerName: process.env.BUNNY_DEMO_CONTAINER,
    digest: process.env.IMAGE_DIGEST,
    revision: process.env.IMAGE_REVISION,
    apply: process.argv.includes("--apply"),
  });
