// Explicitly invoked after provisioning; never changes DNS or starts local servers.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { selectDeployment } from "./demo-deployment.mjs";

const selection = process.argv.slice(2);
const plan = selectDeployment(selection.length ? selection : undefined);
await mkdir("hosted-verification", { recursive: true });
const receipt = {
  startedAt: new Date().toISOString(),
  revision: process.env.GITHUB_SHA,
  image: process.env.DEPLOYED_IMAGE,
  results: [],
};
try {
  for (const entry of plan) {
    const documents = [];
    try {
      if (entry.strategy === "route" && entry.rendering !== "client") {
        const response = await fetch(entry.origin, {
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });
        assert.ok(response.status >= 300 && response.status < 400, `${entry.origin} root redirect`);
        const location = response.headers.get("location");
        assert.ok(location, `${entry.origin} redirect location`);
        assert.equal(
          new URL(location, entry.origin).origin,
          entry.origin,
          "Route entry must preserve its public HTTPS origin",
        );
        documents.push({ url: entry.origin, status: response.status, location });
      }
      const locales =
        entry.strategy === "client"
          ? [null]
          : entry.strategy === "cookie"
            ? ["de", "en", "fr", "de"]
            : entry.strategy === "tld"
              ? ["en", "de", "es", "fr", "en"]
              : ["en", "de", "es", "fr", "en"];
      for (const locale of locales) {
        const url = new URL(entry.origin);
        if (entry.strategy === "route") url.pathname = `/${locale}`;
        if (entry.strategy === "subdomain")
          url.hostname = url.hostname.replace(/^en\./u, `${locale}.`);
        if (entry.strategy === "tld")
          url.hostname = url.hostname.replace(/\.com$/u, locale === "en" ? ".com" : `.${locale}`);
        const response = await fetch(url, {
          headers: { "accept-language": entry.strategy === "cookie" ? locale : "de" },
          signal: AbortSignal.timeout(30_000),
        });
        assert.equal(response.status, 200, `${url} HTTP status`);
        const html = await response.text();
        const lang = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/iu)?.[1];
        if (locale && entry.rendering !== "client")
          assert.equal(lang, locale, `${url} document language / CDN isolation`);
        documents.push({ url: url.href, status: response.status, lang });
      }
    } catch (error) {
      receipt.results.push({ ...entry, passed: false, documents, error: error.message });
      console.error(`${entry.id}: document check FAILED: ${error.message}`);
      continue;
    }
    const result = spawnSync(
      process.execPath,
      entry.rendering
        ? ["scripts/verify-component-demos.mjs", "--id", entry.id]
        : ["scripts/verify-examples-browser.mjs", "--id", entry.id, "--base-url", entry.origin],
      { encoding: "utf8", timeout: 15 * 60_000 },
    );
    await writeFile(
      `hosted-verification/${entry.id}.log`,
      (result.stdout ?? "") + (result.stderr ?? "") + (result.error?.message ?? ""),
    );
    const passed = !result.error && result.status === 0;
    receipt.results.push({ ...entry, passed, documents });
    console.log(`${entry.id}: ${passed ? "passed" : "FAILED"}`);
  }
  if (receipt.results.some((entry) => !entry.passed)) process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  await writeFile("hosted-verification/receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
}
