// Cold-builds the generated app in both client catalog delivery modes and
// prints build time, peak RSS, and emitted file counts.
//
//   node benchmarks/next-client-catalogs/measure.mjs [--runs 2]
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), ".app");
const { values } = parseArgs({ options: { runs: { type: "string", default: "2" } } });

function count(directory, predicate) {
  try {
    return readdirSync(directory, { recursive: true }).filter((file) => predicate(String(file)))
      .length;
  } catch {
    return 0;
  }
}

const rows = [];
for (let run = 0; run < Number(values.runs); run += 1) {
  for (const mode of ["graph", "assets"]) {
    rmSync(path.join(app, ".next"), { recursive: true, force: true });
    const started = performance.now();
    // macOS /usr/bin/time -l reports the peak RSS of the largest process.
    const result = spawnSync("/usr/bin/time", ["-l", "./node_modules/.bin/next", "build"], {
      cwd: app,
      env: {
        ...process.env,
        PALAMEDES_NEXT_CATALOG_ASSETS: mode === "assets" ? "1" : "0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const seconds = (performance.now() - started) / 1000;
    const output = `${result.stdout}\n${result.stderr}`.replaceAll(ANSI_ESCAPE, "");
    if (result.status !== 0) {
      console.error(output.slice(-4000));
      throw new Error(`${mode} build failed`);
    }
    const compiled = output.match(/Compiled successfully in ([\d.]+)\s*(ms|s)/u);
    const rss = Number(output.match(/(\d+)\s+maximum resident set size/u)?.[1] ?? 0);
    rows.push({
      run: run + 1,
      mode,
      totalSeconds: seconds.toFixed(1),
      compileSeconds: compiled
        ? (Number(compiled[1]) / (compiled[2] === "ms" ? 1000 : 1)).toFixed(1)
        : "?",
      peakRssGiB: (rss / 1024 ** 3).toFixed(2),
      clientChunks: count(path.join(app, ".next/static/chunks"), (file) => file.endsWith(".js")),
      messageAssets: count(path.join(app, ".next/static/palamedes"), (file) =>
        file.endsWith(".js"),
      ),
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
}
console.table(rows);
