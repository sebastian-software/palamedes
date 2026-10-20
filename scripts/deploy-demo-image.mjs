// Called only by an explicit main-branch workflow deployment. No provisioning or DNS changes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const {
  BUNNYNET_API_KEY: key,
  BUNNY_DEMO_APP_ID: app,
  BUNNY_DEMO_CONTAINER: container,
  IMAGE_DIGEST: digest,
  IMAGE_REVISION: revision,
} = process.env;
assert.ok(
  key && /^[a-zA-Z0-9-]+$/u.test(app ?? "") && container,
  "Configure the Bunny environment secret and app/container variables.",
);
assert.match(digest ?? "", /^sha256:[a-f0-9]{64}$/u);
assert.match(revision ?? "", /^[a-f0-9]{40}$/u);
const root = `https://api.bunny.net/mc/apps/${app}`;
async function call(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { AccessKey: key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Bunny API returned HTTP ${response.status}`);
  return response;
}
const config = await (await call(root)).json();
const matches = config.containerTemplates.filter((entry) => entry.name === container);
assert.equal(matches.length, 1, "Expected one configured demo container.");
const previous = matches[0];
assert.match(previous.id, /^[a-zA-Z0-9-]+$/u);
await mkdir("deployment-receipt", { recursive: true });
// Preserve only image fields, never the API response's environment/secrets.
const receipt = {
  app,
  container,
  previous: {
    imageName: previous.imageName,
    imageTag: previous.imageTag,
    imageDigest: previous.imageDigest,
  },
  next: {
    imageName: "ghcr.io/sebastian-software/palamedes-examples",
    imageTag: `sha-${revision}`,
    imageDigest: digest,
  },
  submitted: false,
};
await writeFile("deployment-receipt/image.json", JSON.stringify(receipt, null, 2));
await call(`${root}/containers/${previous.id}`, {
  method: "PATCH",
  body: JSON.stringify({ id: previous.id, ...receipt.next }),
});
receipt.submitted = true;
receipt.submittedAt = new Date().toISOString();
await writeFile("deployment-receipt/image.json", JSON.stringify(receipt, null, 2));
console.log(
  "Image update submitted. Confirm rollout health in Bunny before running verify-hosts; submission is not a live verification.",
);
