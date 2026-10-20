import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const pmdsBin = path.join(root, "node_modules/@palamedes/cli/bin/pmds");
const tscBin = path.join(root, "node_modules/typescript/bin/tsc");
const temporary = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...options.env },
  });
  if (result.error) throw result.error;
  return result;
}

function pmds(args, cwd = root) {
  return run(process.execPath, [pmdsBin, ...args], { cwd });
}

function tempDir(name) {
  const directory = mkdtempSync(path.join(tmpdir(), `palamedes-${name}-`));
  temporary.push(directory);
  return directory;
}

function cli(entry, args, { cwd = root, env = {} } = {}) {
  return run(process.execPath, [entry, ...args], { cwd, env });
}

async function withServer(entry, cwd, callback) {
  const child = spawn(process.execPath, [entry], {
    cwd,
    env: { PATH: process.env.PATH, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const line = stdout.split("\n").find((value) => value.startsWith("{"));
        if (line) resolve(JSON.parse(line).port);
      });
      child.once("exit", (code) => reject(new Error(`server exited with ${code}: ${stderr}`)));
    });
    const request = async (id, acceptLanguage) => {
      const response = await fetch(`http://127.0.0.1:${port}/bookings/${id}`, {
        headers: { "Accept-Language": acceptLanguage },
      });
      return { response, body: await response.json() };
    };
    await callback(request, () => stderr);
  } finally {
    child.kill("SIGTERM");
  }
}

/** Only compiled output, generated data, and installed packages: no sources, no pmds. */
function deploy({ drop } = {}) {
  const target = tempDir("deploy");
  cpSync(path.join(root, "dist"), path.join(target, "dist"), { recursive: true });
  cpSync(path.join(root, ".palamedes/macros.json"), path.join(target, ".palamedes/macros.json"));
  cpSync(path.join(root, ".palamedes/catalogs"), path.join(target, ".palamedes/catalogs"), {
    recursive: true,
  });
  writeFileSync(path.join(target, "package.json"), JSON.stringify({ type: "module" }));
  symlinkSync(path.join(root, "node_modules"), path.join(target, "node_modules"), "junction");
  if (drop) rmSync(path.join(target, ".palamedes/catalogs", drop));
  return target;
}

before(() => {
  const extract = pmds(["extract", "--runtime-manifest", ".palamedes/macros.json"]);
  assert.equal(extract.status, 0, extract.stderr);
  const compile = pmds(["catalog", "compile", "--target", "js", "--output", ".palamedes/catalogs"]);
  assert.equal(compile.status, 0, compile.stderr);
  const tsc = run(process.execPath, [tscBin]);
  assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
});

after(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

const expected = {
  en: ["Booking details.", "Booking BK-1 is confirmed.", "2 seats available"],
  de: ["Buchungsdetails.", "Buchung BK-1 ist bestätigt.", "2 Plätze verfügbar"],
  es: ["Detalles de la reserva.", "La reserva BK-1 está confirmada.", "2 plazas disponibles"],
};

for (const [mode, entry] of [
  ["native type stripping", "src/cli.ts"],
  ["plain tsc output", "dist/cli.js"],
]) {
  describe(`CLI with ${mode}`, () => {
    for (const [locale, lines] of Object.entries(expected)) {
      it(`renders ${locale}`, () => {
        const result = cli(entry, ["show", "BK-1", "--locale", locale]);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.stdout.split("\n").slice(0, 3), lines);
      });
    }

    it("renders the singular branch", () => {
      const result = cli(entry, ["show", "BK-2", "--locale", "de"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^1 Platz verfügbar$/mu);
    });

    it("follows LC_ALL, LC_MESSAGES, then LANG and keeps exit codes", () => {
      const notFound = cli(entry, ["show", "BK-9"], {
        env: { LC_ALL: "", LC_MESSAGES: "es_ES.UTF-8", LANG: "de_DE.UTF-8" },
      });
      assert.equal(notFound.status, 1);
      assert.equal(notFound.stderr.trim(), "No se encontró la reserva BK-9.");

      const invalid = cli(entry, ["list"], { env: { LANG: "de_DE.UTF-8" } });
      assert.equal(invalid.status, 2);
      assert.equal(invalid.stderr.trim(), "Ungültige Argumente. Verwenden Sie --help.");

      const json = cli(entry, ["show", "BK-1", "--json"], { env: { LANG: "de_DE.UTF-8" } });
      assert.equal(json.status, 0);
      assert.deepEqual(JSON.parse(json.stdout), {
        code: "BOOKING_CONFIRMED",
        id: "BK-1",
        seats: 2,
        amount: 149,
        currency: "EUR",
        startsAt: "2026-10-18T12:00:00Z",
      });
    });
  });
}

describe("HTTP service", () => {
  it("keeps concurrent request locales apart", async () => {
    await withServer("src/server.ts", root, async (request) => {
      const locales = ["de", "es", "en", "de", "es", "en", "de", "es"];
      const results = await Promise.all(locales.map((locale) => request("BK-1", locale)));
      results.forEach(({ response, body }, index) => {
        const locale = locales[index];
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-language"), locale);
        assert.equal(response.headers.get("vary"), "Accept-Language");
        assert.equal(body.label, expected[locale][0]);
        assert.equal(body.message, expected[locale][1]);
      });
      const missing = await request("BK-9", "es");
      assert.equal(missing.response.status, 404);
      assert.equal(missing.body.message, "No se encontró la reserva BK-9.");
    });
  });

  it("reports a missing catalog as an error without source text and keeps other locales working", async () => {
    const target = deploy({ drop: "de.mjs" });
    await withServer("dist/server.js", target, async (request, stderr) => {
      const failed = await request("BK-1", "de");
      assert.equal(failed.response.status, 500);
      assert.deepEqual(failed.body, { code: "INTERNAL_ERROR" });
      assert.match(stderr(), /de\.mjs/u);
      const ok = await request("BK-1", "es");
      assert.equal(ok.response.status, 200);
      assert.equal(ok.body.message, expected.es[1]);
    });
  });
});

describe("deployment and failure modes", () => {
  it("runs the tsc output without sources or the Palamedes CLI", () => {
    const target = deploy();
    const result = cli("dist/cli.js", ["show", "BK-1", "--locale", "es"], { cwd: target });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split("\n")[1], expected.es[1]);
  });

  it("fails the CLI on a missing catalog instead of printing source text", () => {
    const target = deploy({ drop: "de.mjs" });
    const result = cli("dist/cli.js", ["show", "BK-1", "--locale", "de"], { cwd: target });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /Booking BK-1|Buchung/u);
  });

  it("keeps unregistered macros failing loudly", () => {
    const result = run(process.execPath, [
      "--input-type=module",
      "--eval",
      'import { t } from "@palamedes/core/macro"; t`Booking details.`;',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /being executed outside the compiler transform/u);
  });

  it("keeps catalogs and the manifest in sync with the sources", () => {
    const result = pmds(["extract", "--check", "--runtime-manifest", ".palamedes/macros.json"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

describe("extraction guards", () => {
  function project(files) {
    const directory = tempDir("guard");
    writeFileSync(
      path.join(directory, "palamedes.yaml"),
      "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n",
    );
    mkdirSync(path.join(directory, "src"));
    for (const [name, source] of Object.entries(files)) {
      writeFileSync(path.join(directory, "src", name), source);
    }
    return directory;
  }

  it("rejects calls that look identical at runtime but compile differently", () => {
    const directory = project({
      "a.ts":
        'import { t } from "@palamedes/core/macro";\nexport const a = (id: string) => t`Booking ${id}.`;\n',
      "b.ts":
        'import { t } from "@palamedes/core/macro";\nexport const b = (code: string) => t`Booking ${code}.`;\n',
    });
    const result = pmds(["extract", "--runtime-manifest", "macros.json"], directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Runtime macro collision: src\/a\.ts:2:34 and src\/b\.ts:2:36/u);
  });

  it("points nested macros to full sentences in extract and lint", () => {
    const directory = project({
      "files.ts":
        'import { plural, t } from "@palamedes/core/macro";\nexport const f = (count: number) => t`You have ${plural(count, { one: "# file", other: "# files" })} left.`;\n',
    });
    for (const args of [["extract"], ["lint"]]) {
      const result = pmds(args, directory);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stdout + result.stderr,
        /Nested `plural` macro at line 2, column 50 .*complete sentence/u,
      );
    }
  });
});
