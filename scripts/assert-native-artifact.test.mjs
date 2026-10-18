import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("publishing a native CLI requires its external language assets", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "palamedes-catalog-guard-"));
  const script = path.join(import.meta.dirname, "assert-native-artifact.mjs");
  try {
    mkdirSync(path.join(fixture, "bin", "pmds-locales"), { recursive: true });
    writeFileSync(
      path.join(fixture, "package.json"),
      JSON.stringify({ name: "@palamedes/cli-fixture", bin: { pmds: "bin/pmds" } }),
    );
    writeFileSync(path.join(fixture, "bin", "pmds"), "fixture native binary");
    const run = () => spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /pmds-locales\/en\.pmd\.json/u);
    for (const locale of ["en", "de", "es"]) {
      writeFileSync(path.join(fixture, "bin", "pmds-locales", `${locale}.pmd.json`), "{}");
    }
    assert.equal(run().status, 0);
    rmSync(path.join(fixture, "bin", "pmds-locales", "es.pmd.json"));
    assert.notEqual(run().status, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
