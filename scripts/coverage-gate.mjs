#!/usr/bin/env node
/*
 * The single source for the two line-coverage floors CI enforces.
 *
 * Coverage used to be reported to an external service and gated nowhere, which
 * made it a number nobody owned: it could fall for a release and no run turned
 * red. The floors below are enforced by the repository's own CI instead:
 * `vitest.coverage.config.mts` reads the JavaScript floor into
 * `coverage.thresholds.lines`, and the Rust job passes the Rust floor to
 * `cargo llvm-cov report --fail-under-lines`.
 *
 * Each floor sits a couple of points under the coverage measured on `main` when
 * it was introduced, so ordinary movement stays quiet and a real drop still
 * fails the job. Raising a floor after coverage has genuinely improved is a
 * welcome edit here; lowering one to make a red run green is not.
 *
 * `node ./scripts/coverage-gate.mjs <javascript|rust>` prints the measured line
 * coverage against its floor and appends the same line to the GitHub run
 * summary, so the number is visible without downloading the artifact.
 * `--threshold` prints the floor alone, which is how the workflow hands it to
 * cargo-llvm-cov.
 */

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const COVERAGE_GATES = {
  javascript: {
    label: "JavaScript",
    // Measured on main at 2026-09-07: 83.76 % lines.
    threshold: 81,
    summaryFile: "coverage/javascript/coverage-summary.json",
    // Istanbul-shaped summary, written by the v8 provider's `json-summary`
    // reporter.
    linePercentage: (report) => report.total.lines.pct,
  },
  rust: {
    label: "Rust",
    // Measured on main at 2026-09-07: 84.07 % lines.
    threshold: 82,
    summaryFile: "coverage/rust/coverage-summary.json",
    // `llvm.coverage.json.export`, written by `cargo llvm-cov report --json
    // --summary-only`.
    linePercentage: (report) => report.data[0].totals.lines.percent,
  },
};

function measuredLineCoverage(gate) {
  let summary;

  try {
    summary = readFileSync(path.join(ROOT, gate.summaryFile), "utf8");
  } catch (error) {
    // The step that measures coverage is the gate; this one only reports, and
    // it runs even after an earlier step failed. A run that never got as far as
    // measuring has nothing to say, which is not a second failure.
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const percentage = gate.linePercentage(JSON.parse(summary));

  if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
    throw new TypeError(`${gate.summaryFile} carries no line-coverage percentage`);
  }

  return percentage;
}

function main(argv) {
  const [name, flag] = argv;
  const gate = COVERAGE_GATES[name];

  if (!gate || (flag !== undefined && flag !== "--threshold")) {
    throw new Error("usage: coverage-gate.mjs <javascript|rust> [--threshold]");
  }

  if (flag === "--threshold") {
    process.stdout.write(`${gate.threshold}\n`);
    return;
  }

  const percentage = measuredLineCoverage(gate);

  if (percentage === null) {
    console.warn(`coverage-gate: ${gate.summaryFile} is missing, nothing to report`);
    return;
  }

  const line = `Line coverage (${gate.label}): ${percentage.toFixed(2)}% (gate: ≥ ${gate.threshold}%)`;
  console.log(line);

  // The gate itself lives in the tool that measured the coverage, so this only
  // has to make the number visible, including on the run that just failed it.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`coverage-gate: ${error.message}`);
    process.exitCode = 1;
  }
}
