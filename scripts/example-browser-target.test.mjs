import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExternalBrowserTarget } from "./example-browser-target.mjs";

const cookie = [{ example: { id: "remix-cookie" } }];

describe("external browser proof target", () => {
  it("keeps the normal local verification plan when no target is supplied", () => {
    expect(resolveExternalBrowserTarget(["--id", "remix-cookie"], cookie)).toBeUndefined();
  });

  it("normalizes a final HTTPS origin and permits loopback rehearsal", () => {
    expect(resolveExternalBrowserTarget(["--base-url", "https://demo.example/"], cookie)).toBe(
      "https://demo.example",
    );
    expect(resolveExternalBrowserTarget(["--base-url=https://demo.example/"], cookie)).toBe(
      "https://demo.example",
    );
    for (const origin of ["http://127.0.0.1:4060", "http://localhost:4060", "http://[::1]:4060"]) {
      expect(resolveExternalBrowserTarget(["--base-url", origin], cookie)).toBe(origin);
    }
  });

  it.each(["cookie", "route", "subdomain", "tld"])("accepts the hosted %s contract", (strategy) => {
    expect(
      resolveExternalBrowserTarget(
        ["--base-url", "https://en.demo.com"],
        [{ example: { id: `remix-${strategy}` } }],
      ),
    ).toBe("https://en.demo.com");
  });

  it("rejects host strategies without their canonical entry locale", () => {
    expect(() =>
      resolveExternalBrowserTarget(
        ["--base-url", "https://de.demo.example"],
        [{ example: { id: "remix-subdomain" } }],
      ),
    ).toThrow(/en\./);
    expect(() =>
      resolveExternalBrowserTarget(
        ["--base-url", "https://demo.de"],
        [{ example: { id: "remix-tld" } }],
      ),
    ).toThrow(/\.com/);
  });

  it.each([
    "http://demo.example",
    "file:///tmp/demo",
    "https://user:secret@demo.example",
    "https://demo.example/app",
    "https://demo.example?locale=de",
    "https://demo.example#app",
  ])("rejects an origin that would weaken or misroute the hosted proof: %s", (origin) => {
    expect(() => resolveExternalBrowserTarget(["--base-url", origin], cookie)).toThrow();
  });

  it("requires one explicit Remix target rather than silently testing another app", () => {
    for (const plan of [[], [{ example: { id: "waku-cookie" } }], [...cookie, ...cookie]]) {
      expect(() =>
        resolveExternalBrowserTarget(["--base-url", "https://demo.example"], plan),
      ).toThrow(/exactly one --id remix-cookie/);
    }
    expect(() => resolveExternalBrowserTarget(["--base-url"], cookie)).toThrow(
      /requires an origin/,
    );
    expect(() => resolveExternalBrowserTarget(["--base-url="], cookie)).toThrow(
      /requires an origin/,
    );
    expect(() => resolveExternalBrowserTarget(["--base-url", "--id"], cookie)).toThrow(
      /requires an origin/,
    );
    expect(() =>
      resolveExternalBrowserTarget(
        ["--base-url", "https://one.example", "--base-url", "https://two.example"],
        cookie,
      ),
    ).toThrow(/exactly once/);
  });

  // The executable shim exercises the POSIX process boundary; target checks also run on Windows.
  it.skipIf(process.platform === "win32").each([
    ["cookie", "https://deployed.example"],
    ["route", "https://deployed.example"],
    ["subdomain", "https://en.deployed.example"],
    ["tld", "https://deployed.com"],
  ])("runs the external %s contract without starting a local app", (strategy, origin) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "palamedes-host-runner-"));
    const receipt = path.join(directory, "receipt.json");
    const executable = path.join(directory, "pnpm");
    try {
      writeFileSync(
        executable,
        `#!${process.execPath}\n` +
          `const fs = require("node:fs");\n` +
          `fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({\n` +
          `  args: process.argv.slice(2),\n` +
          `  id: process.env.PALAMEDES_VERIFY_EXAMPLE_ID,\n` +
          `  baseUrl: process.env.PALAMEDES_VERIFY_BASE_URL,\n` +
          `  framework: process.env.PALAMEDES_VERIFY_FRAMEWORK,\n` +
          `  strategy: process.env.PALAMEDES_VERIFY_STRATEGY,\n` +
          `  subdomainUrl: process.env.PALAMEDES_VERIFY_SUBDOMAIN_URL,\n` +
          `  tldUrl: process.env.PALAMEDES_VERIFY_TLD_URL\n` +
          `}));\n`,
      );
      chmodSync(executable, 0o755);
      execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL("verify-examples-browser.mjs", import.meta.url)),
          "--id",
          `remix-${strategy}`,
          "--base-url",
          `${origin}/`,
        ],
        {
          env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` },
          timeout: 5000,
          stdio: "pipe",
        },
      );
      expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
        args: [
          "exec",
          "vitest",
          "--config",
          "vitest.examples.config.mjs",
          "--run",
          "tests/examples-browser/examples.browser.test.js",
        ],
        id: `remix-${strategy}`,
        baseUrl: origin,
        framework: "remix",
        strategy,
        subdomainUrl: strategy === "subdomain" ? `${origin}/` : "",
        tldUrl: strategy === "tld" ? `${origin}/` : "",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
