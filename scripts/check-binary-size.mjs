#!/usr/bin/env node
/*
 * Guards the size of the shipped CLI binary.
 *
 * Palamedes ships prebuilt binaries for five platforms, so a dependency that
 * bakes data into the executable multiplies across all of them. That is easy to
 * add without noticing: linking a full Unicode collator once cost 1.3 MB and
 * only came to light because someone measured by hand.
 *
 * This is a ceiling rather than a comparison against a stored baseline. Exact
 * sizes differ between toolchain patch releases, linkers and platforms, so a
 * recorded number would drift and report growth that is not there. A ceiling
 * with headroom stays quiet through ordinary change and still catches the jump
 * worth catching. Raising it is a deliberate edit, which is the point.
 */

import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

const BUDGETS = [
  {
    label: "pmds (release)",
    crate: "palamedes-cli",
    binary: path.join("target", "release", "pmds"),
    maxBytes: 9_500_000,
  },
]

const format = (bytes) =>
  `${(bytes / 1_000_000).toFixed(2)} MB (${bytes.toLocaleString("en-US")} B)`

let failed = false

for (const budget of BUDGETS) {
  execFileSync("cargo", ["build", "--release", "--locked", "-p", budget.crate], {
    cwd: ROOT,
    stdio: "inherit",
  })

  const binaryPath = path.join(ROOT, budget.binary)
  const { size } = statSync(binaryPath)
  const headroom = budget.maxBytes - size

  if (headroom < 0) {
    failed = true
    console.error(
      `${budget.label}: ${format(size)} exceeds the budget of ${format(budget.maxBytes)} by ${format(-headroom)}.\n` +
        `Either shrink it, or raise maxBytes in scripts/check-binary-size.mjs and say why in the commit.`
    )
    continue
  }

  const used = ((size / budget.maxBytes) * 100).toFixed(1)
  console.log(
    `${budget.label}: ${format(size)} of ${format(budget.maxBytes)} (${used} %), ${format(headroom)} to spare.`
  )
}

process.exit(failed ? 1 : 0)
