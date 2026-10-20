import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
const script = new URL("deploy-demo-image.mjs", import.meta.url).pathname;
it.each([200, 403])("records rollback metadata and waits for PATCH status %s", (status) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "demo-update-test-"));
  try {
    const fixture = path.join(root, "api.mjs");
    writeFileSync(
      fixture,
      `import assert from 'node:assert/strict';
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(options.headers.AccessKey, 'test-only-key');
        if (calls === 1) {
          assert.equal(url, 'https://api.bunny.net/mc/apps/app-id');
          return Response.json({containerTemplates: [{id: 'container-id', name: 'demos', imageDigest: 'old-digest', imageTag: 'old-tag', environment: {secret: 'must-not-be-saved'}}]});
        }
        assert.equal(url, 'https://api.bunny.net/mc/apps/app-id/containers/container-id');
        assert.equal(options.method, 'PATCH');
        assert.equal(JSON.parse(options.body).imageDigest, 'sha256:' + 'a'.repeat(64));
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response('', {status: ${status}});
      };`,
    );
    const run = () =>
      execFileSync(process.execPath, ["--import", fixture, script], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
        env: {
          ...process.env,
          BUNNYNET_API_KEY: "test-only-key",
          BUNNY_DEMO_APP_ID: "app-id",
          BUNNY_DEMO_CONTAINER: "demos",
          IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
          IMAGE_REVISION: "b".repeat(40),
        },
      });
    if (status === 200) expect(run()).toContain("submitted");
    else expect(run).toThrow();
    const contents = readFileSync(path.join(root, "deployment-receipt/image.json"), "utf8");
    expect(JSON.parse(contents).submitted).toBe(status === 200);
    expect(JSON.parse(contents).previous.imageDigest).toBe("old-digest");
    expect(contents).not.toContain("must-not-be-saved");
    expect(contents).not.toContain("test-only-key");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
