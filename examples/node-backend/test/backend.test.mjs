import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadPalamedesConfigSync } from "@palamedes/config";

// The suite only depends on the build output contract: cli.mjs, express.mjs,
// and hono.mjs, with each locale's catalog in its own module. Another build
// path reuses it with NODE_BACKEND_DIST=<its output directory>.
//
// Unbundled runtime macros (plain `node` type stripping or plain `tsc`
// output) set NODE_BACKEND_ENTRIES to a JSON map from cli, express, and hono
// to entry files. That code runs in place against the installed packages and
// loads its catalogs from .palamedes/catalogs.
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.resolve(root, process.env.NODE_BACKEND_DIST ?? "dist");
const unbundled = process.env.NODE_BACKEND_ENTRIES !== undefined;
const entries = unbundled
  ? JSON.parse(process.env.NODE_BACKEND_ENTRIES)
  : { cli: "cli.mjs", express: "express.mjs", hono: "hono.mjs" };
const confirmed = {
  en: "Booking BK-1 is confirmed.",
  de: "Buchung BK-1 ist bestätigt.",
  es: "La reserva BK-1 está confirmada.",
};
const labels = { en: "Booking details.", de: "Buchungsdetails.", es: "Detalles de la reserva." };
const seats = {
  en: ["2 seats available", "1 seat available"],
  de: ["2 Plätze verfügbar", "1 Platz verfügbar"],
  es: ["2 plazas disponibles", "1 plaza disponible"],
};
let deployed;

// Every bundled test runs the copied build output: no node_modules, sources, or PO catalogs.
before(async () => {
  if (unbundled) {
    deployed = root;
    return;
  }
  deployed = await mkdtemp(path.join(os.tmpdir(), "palamedes-node-backend-"));
  await cp(dist, deployed, { recursive: true });
});
after(() => (unbundled ? undefined : rm(deployed, { recursive: true, force: true })));

test("compiled catalogs carry no compiler", { skip: !unbundled }, async () => {
  const catalogs = path.join(root, ".palamedes/catalogs");
  for (const file of await readdir(catalogs)) {
    const source = await readFile(path.join(catalogs, file), "utf8");
    assert.doesNotMatch(source, /@palamedes\/(?:core-node|transform|config)/u, file);
  }
});

test(
  "the deployed bundle contains no compiler, macro, or source catalog",
  { skip: unbundled },
  async () => {
    const files = await readdir(deployed, { recursive: true });
    for (const entry of ["cli.mjs", "express.mjs", "hono.mjs"]) assert.ok(files.includes(entry));
    // No installed packages (they always carry a package.json) and no PO sources.
    assert.ok(!files.some((file) => /(?:^|[\\/])package\.json$|\.po$/u.test(file)));
    for (const file of files.filter((name) => name.endsWith(".mjs"))) {
      const source = await readFile(path.join(deployed, file), "utf8");
      assert.doesNotMatch(source, /@palamedes\/(?:core-node|transform|config|core\/macro)/u, file);
    }
  },
);

async function cli(args, environment = {}) {
  const env = { ...process.env, NODE_OPTIONS: "" };
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]) delete env[name];
  Object.assign(env, environment);
  try {
    const result = await run(process.execPath, [entries.cli, ...args], {
      cwd: deployed,
      env,
      timeout: 20_000,
    });
    return { ...result, code: 0 };
  } catch (error) {
    return error;
  }
}

test("supported and default locales match palamedes.yaml", async () => {
  const config = loadPalamedesConfigSync({ cwd: root });
  const unsupported = await cli(["--locale", "zz"]);
  assert.equal(unsupported.code, 2);
  assert.equal(
    unsupported.stderr.trim(),
    `Unsupported locale "zz". Use one of: ${config.locales.join(", ")}.`,
  );
  const help = await cli(["--help"]);
  assert.equal(help.stdout, (await cli(["--help", "--locale", config.sourceLocale])).stdout);
});

test("CLI follows --locale, then LC_ALL > LC_MESSAGES > LANG", async () => {
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
    const result = await cli(["show", "BK-1"], environment);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.includes(confirmed[locale]), result.stdout);
  }
  const overridden = await cli(["show", "BK-1", "--locale", "es-MX"], { LC_ALL: "de_DE" });
  assert.ok(overridden.stdout.includes(confirmed.es));
});

test("CLI renders singular and plural seat counts", async () => {
  for (const locale of ["en", "de", "es"]) {
    const [other, one] = seats[locale];
    assert.ok((await cli(["show", "BK-1", "--locale", locale])).stdout.includes(`\n${other}\n`));
    assert.ok((await cli(["show", "BK-2", "--locale", locale])).stdout.includes(`\n${one}\n`));
  }
});

test("CLI rejects an unsupported --locale with exit code 2", async () => {
  const invalid = await cli(["show", "BK-1", "--locale", "fr"], { LANG: "de_DE" });
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, "");
  assert.equal(
    invalid.stderr.trim(),
    'Nicht unterstützte Sprache "fr". Verwenden Sie eine von: en, de, es.',
  );
  const machine = await cli(["show", "BK-1", "--locale", "???", "--json"]);
  assert.equal(machine.code, 2);
  assert.deepEqual(JSON.parse(machine.stderr), { code: "UNSUPPORTED_LOCALE" });
});

test("CLI keeps exit codes and --json output stable across locales", async () => {
  const help = await cli(["--help"], { LANG: "de_DE" });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Eine Buchung nachschlagen\.\nshow <id> \[--locale/u);
  const missing = await cli(["show", "missing"], { LANG: "de_DE" });
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /Buchung missing wurde nicht gefunden/u);
  const syntax = await cli(["--unknown"], { LANG: "de_DE" });
  assert.equal(syntax.code, 2);
  assert.match(syntax.stderr, /Ungültige Argumente/u);
  const machine = await Promise.all(
    ["en_US", "de_DE", "es_ES"].map((LANG) => cli(["show", "BK-1", "--json"], { LANG })),
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
  const machineError = await cli(["show", "missing", "--json"], { LANG: "es_ES" });
  assert.equal(machineError.code, 1);
  assert.deepEqual(JSON.parse(machineError.stderr), { code: "BOOKING_NOT_FOUND" });
});

async function startServer(t, framework) {
  const child = spawn(process.execPath, [entries[framework]], {
    cwd: deployed,
    env: { ...process.env, PORT: "0", LANG: "de_DE.UTF-8", NODE_OPTIONS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  });
  const lines = createInterface({ input: child.stdout });
  try {
    const line = await Promise.race([
      once(lines, "line").then(([value]) => value),
      once(child, "exit").then(() => {
        throw new Error(`Server failed to start: ${stderr}`);
      }),
    ]);
    const base = `http://127.0.0.1:${JSON.parse(line).port}`;
    const get = (id, language) =>
      fetch(`${base}/bookings/${id}`, {
        headers: language ? { "Accept-Language": language } : {},
        signal: AbortSignal.timeout(5000),
      });
    return { get, stderr: () => stderr };
  } finally {
    lines.close();
  }
}

for (const framework of ["express", "hono"]) {
  test(`${framework}: concurrent requests keep their own locale`, async (t) => {
    const server = await startServer(t, framework);
    const cases = [
      ["de-DE,de;q=0.9,en;q=0.8", "de", "BK-1"],
      ["es-MX,en;q=0.5", "es", "BK-2"],
      ["en", "en", "BK-2"],
      ["fr,zh;q=0.5", "en", "BK-1"],
      [undefined, "en", "BK-1"],
    ];
    // Interleave locales on one process, including the first cold catalog loads.
    await Promise.all(
      Array.from({ length: 4 }, () => cases)
        .flat()
        .map(async ([header, locale, id]) => {
          const response = await server.get(id, header);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("content-language"), locale);
          assert.match(response.headers.get("vary"), /Accept-Language/iu);
          assert.equal(response.headers.get("cache-control"), "private, no-store");
          const booking = await response.json();
          assert.equal(booking.label, labels[locale]);
          assert.equal(booking.message, confirmed[locale].replace("BK-1", id));
          assert.equal(booking.availability, seats[locale][id === "BK-1" ? 0 : 1]);
        }),
    );
    const missing = await server.get("missing", "de");
    assert.equal(missing.status, 404);
    const error = await missing.json();
    assert.equal(error.code, "BOOKING_NOT_FOUND");
    assert.equal(error.message, "Buchung missing wurde nicht gefunden.");
    assert.equal(server.stderr(), "");
  });
}

for (const framework of ["express", "hono"]) {
  test(`${framework}: a missing catalog module returns a generic 500 and recovers`, async (t) => {
    const catalog = await findSpanishCatalog();
    const server = await startServer(t, framework);
    await rename(catalog, `${catalog}.moved`);
    try {
      const failed = await server.get("BK-1", "es");
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { code: "INTERNAL_ERROR" });
    } finally {
      await rename(`${catalog}.moved`, catalog);
    }
    const recovered = await server.get("BK-1", "es");
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).message, confirmed.es);
    assert.match(server.stderr(), /ERR_MODULE_NOT_FOUND/u);
  });
}

/** The one deployed module holding Spanish messages, found by content so any build layout works. */
async function findSpanishCatalog() {
  const directory = unbundled ? path.join(root, ".palamedes/catalogs") : deployed;
  const matches = [];
  for (const file of await readdir(directory, { recursive: true })) {
    if (!file.endsWith(".mjs")) continue;
    const source = await readFile(path.join(directory, file), "utf8");
    if (source.includes("está confirmada")) matches.push(file);
  }
  assert.equal(matches.length, 1, `expected one Spanish catalog module, found ${matches}`);
  assert.ok(!Object.values(entries).includes(matches[0]), "catalog must be lazy");
  return path.join(directory, matches[0]);
}
