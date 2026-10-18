import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildApplication } from "../tooling/build.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const modes = ["direct", "unbundled", "rolldown"];
const expected = {
  en: "Booking BK-1 is confirmed.",
  de: "Buchung BK-1 ist bestätigt.",
  es: "La reserva BK-1 está confirmada.",
};
const scratch = [];

export async function runProbe(mode, locale = "en", id = "BK-1", cwd = root) {
  const entry =
    mode === "direct"
      ? ["--import", "./tooling/register.mjs", "src/probe.ts"]
      : [`dist/${mode}/probe.js`];
  const { stdout } = await run(process.execPath, [...entry, locale, id], {
    cwd,
    timeout: 20_000,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  return JSON.parse(stdout);
}

before(async () => {
  await buildApplication("unbundled");
  await buildApplication("rolldown");
});
after(async () => {
  for (const directory of scratch) await rm(directory, { recursive: true, force: true });
});

for (const mode of modes) {
  test(`${mode}: generated catalogs and macros work through an asynchronous service`, async () => {
    for (const locale of Object.keys(expected)) {
      const booking = await runProbe(mode, locale);
      assert.equal(booking.message, expected[locale]);
      assert.equal(booking.code, "BOOKING_CONFIRMED");
      assert.equal(booking.amount, 149);
      assert.equal(booking.currency, "EUR");
      assert.equal(booking.startsAt, "2026-10-18T12:00:00Z");
      if (locale === "de") {
        assert.equal(booking.availability, "2 Plätze verfügbar");
        assert.match(booking.confirmation, /149,00.*18\. Oktober 2026/u);
      }
      assert.notEqual((await runProbe(mode, locale, "missing")).code, "BOOKING_CONFIRMED");
    }
    await assert.rejects(runProbe(mode, "unknown"), /Unsupported catalog locale/u);
  });
}

test("plain Node does not silently provide an unconfigured macro/catalog integration", async () => {
  await assert.rejects(
    run(process.execPath, ["src/probe.ts"], { cwd: root }),
    /ERR_MODULE_NOT_FOUND/u,
  );
});

for (const mode of ["unbundled", "rolldown"]) {
  test(`${mode}: deployed files run without source catalogs or compiler packages`, async () => {
    const deployed = await mkdtemp(path.join(os.tmpdir(), "palamedes-node-deployed-"));
    scratch.push(deployed);
    await cp(path.join(root, "dist", mode), deployed, { recursive: true });
    for (const name of ["core", "runtime"]) {
      const target = path.join(deployed, "node_modules/@palamedes", name);
      const source = path.resolve(root, "../../packages", name);
      await mkdir(target, { recursive: true });
      await cp(path.join(source, "dist"), path.join(target, "dist"), { recursive: true });
      await cp(path.join(source, "package.json"), path.join(target, "package.json"));
    }
    const { stdout } = await run(process.execPath, ["probe.js", "de"], {
      cwd: deployed,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    assert.equal(JSON.parse(stdout).message, expected.de);
    for (const file of await readdir(deployed, { recursive: true })) {
      if (file.startsWith(`node_modules${path.sep}`)) continue;
      if (!file.endsWith(".js") && !file.endsWith(".mjs")) continue;
      const source = await readFile(path.join(deployed, file), "utf8");
      assert.doesNotMatch(source, /@palamedes\/(?:core-node|transform)|@palamedes\/core\/macro/u);
    }
    if (mode === "unbundled") {
      const catalog = path.join(deployed, ".palamedes/de-0.mjs");
      const original = await readFile(catalog, "utf8");
      await rm(catalog);
      await assert.rejects(
        run(process.execPath, ["probe.js", "de"], { cwd: deployed }),
        /ERR_MODULE_NOT_FOUND/u,
      );
      await writeFile(catalog, original);
      const recovered = await run(process.execPath, ["probe.js", "de"], { cwd: deployed });
      assert.equal(JSON.parse(recovered.stdout).message, expected.de);
    }
  });
}

test("catalog edits and invalid ICU are observed on restart or rebuild", async () => {
  await mkdir(path.join(root, ".palamedes"), { recursive: true });
  const fixture = await mkdtemp(path.join(root, ".palamedes/rebuild-"));
  scratch.push(fixture);
  for (const name of ["src", "tooling", "package.json", "palamedes.yaml", "tsconfig.json"]) {
    await cp(path.join(root, name), path.join(fixture, name), { recursive: true });
  }
  const catalog = path.join(fixture, "src/locales/de.po");
  const original = await readFile(catalog, "utf8");
  await writeFile(
    catalog,
    original.replace(
      'msgstr "Buchung {id} ist bestätigt."',
      'msgstr "Reservierung {id} ist bestätigt."',
    ),
  );
  for (const mode of modes) {
    if (mode !== "direct") await buildApplication(mode, fixture);
    assert.equal(
      (await runProbe(mode, "de", "BK-1", fixture)).message,
      "Reservierung BK-1 ist bestätigt.",
    );
  }
  await writeFile(
    catalog,
    original.replace('msgstr "Buchung {id} ist bestätigt."', 'msgstr "Buchung {id"'),
  );
  await assert.rejects(runProbe("direct", "de", "BK-1", fixture), /ICU|parse|brace|argument/iu);
  for (const mode of ["unbundled", "rolldown"]) {
    await assert.rejects(buildApplication(mode, fixture), /ICU|parse|brace|argument/iu);
  }
  await writeFile(catalog, original);
  for (const mode of modes) {
    if (mode !== "direct") await buildApplication(mode, fixture);
    assert.equal((await runProbe(mode, "de", "BK-1", fixture)).message, expected.de);
  }
});
