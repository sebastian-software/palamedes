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
    const cli = await runCli(mode, ["show", "BK-1"], { LANG: "de_DE.UTF-8" }, deployed, true);
    assert.equal(cli.code, 0, cli.stderr);
    assert.ok(cli.stdout.includes(expected.de));
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

async function runCli(mode, args, environment = {}, cwd = root, deployed = false) {
  const env = { ...process.env, NODE_OPTIONS: "" };
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]) delete env[name];
  Object.assign(env, environment);
  const entry = deployed
    ? ["cli.js"]
    : mode === "direct"
      ? ["--import", "./tooling/register.mjs", "src/cli.ts"]
      : [`dist/${mode}/cli.js`];
  try {
    return {
      ...(await run(process.execPath, [...entry, ...args], { cwd, env, timeout: 20_000 })),
      code: 0,
    };
  } catch (error) {
    return error;
  }
}

for (const mode of modes) {
  test(`${mode}: CLI selects environment locales and keeps machine output stable`, async () => {
    const cases = [
      [{ LC_ALL: "de_DE.UTF-8", LC_MESSAGES: "es_ES.UTF-8", LANG: "en_US" }, "de"],
      [{ LC_ALL: "", LC_MESSAGES: "es_ES.UTF-8", LANG: "de_DE" }, "es"],
      [{ LANG: "de_DE.UTF-8@euro" }, "de"],
      [{ LC_ALL: "C.UTF-8", LANG: "de_DE" }, "en"],
      [{ LC_ALL: "POSIX", LANG: "de_DE" }, "en"],
      [{ LC_ALL: "fr_FR.UTF-8", LANG: "de_DE" }, "en"],
      [{ LC_ALL: "invalid!", LANG: "de_DE" }, "en"],
      [{}, "en"],
    ];
    for (const [environment, locale] of cases) {
      const result = await runCli(mode, ["show", "BK-1"], environment);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.includes(expected[locale]), result.stdout);
    }
    const overridden = await runCli(mode, ["show", "BK-1", "--locale", "es-MX"], {
      LC_ALL: "de_DE",
    });
    assert.ok(overridden.stdout.includes(expected.es));
    const invalidOverride = await runCli(mode, ["show", "BK-1", "--locale", "???"], {
      LANG: "de_DE",
    });
    assert.ok(invalidOverride.stdout.includes(expected.en));
    const help = await runCli(mode, ["--help"], { LANG: "de_DE" });
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Eine Buchung nachschlagen\.\nshow <id> \[--locale/u);
    const missing = await runCli(mode, ["show", "missing"], { LANG: "de_DE" });
    assert.equal(missing.code, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /Buchung missing wurde nicht gefunden/u);
    const syntax = await runCli(mode, ["--unknown"], { LANG: "de_DE" });
    assert.equal(syntax.code, 2);
    assert.equal(syntax.stdout, "");
    assert.match(syntax.stderr, /Ungültige Argumente/u);
    const machine = await Promise.all(
      ["en_US", "de_DE", "es_ES"].map((LANG) => runCli(mode, ["show", "BK-1", "--json"], { LANG })),
    );
    assert.equal(machine[0].stdout, machine[1].stdout);
    assert.equal(machine[0].stdout, machine[2].stdout);
    assert.deepEqual(JSON.parse(machine[0].stdout), {
      code: "BOOKING_CONFIRMED",
      id: "BK-1",
      seats: 2,
      amount: 149,
      currency: "EUR",
      startsAt: "2026-10-18T12:00:00Z",
    });
    const machineError = await runCli(mode, ["show", "missing", "--json"], { LANG: "es_ES" });
    assert.equal(machineError.code, 1);
    assert.deepEqual(JSON.parse(machineError.stderr), { code: "BOOKING_NOT_FOUND" });
    const machineSyntax = await runCli(mode, ["--unknown", "--json"], { LANG: "es_ES" });
    assert.equal(machineSyntax.code, 2);
    assert.deepEqual(JSON.parse(machineSyntax.stderr), { code: "INVALID_ARGUMENTS" });
  });
}
