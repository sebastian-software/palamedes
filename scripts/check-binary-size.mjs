#!/usr/bin/env node
/*
 * Guards the size of the shipped native artifacts.
 *
 * Palamedes ships the CLI and core-node addon for six platforms, so a
 * dependency that bakes data into either artifact multiplies across all of
 * them. That is easy to add without noticing: linking a full Unicode collator
 * once cost 1.3 MB and only came to light because someone measured by hand.
 *
 * The gate uses a ceiling rather than failing on every difference from the
 * reference baseline. Exact sizes differ between toolchain patch releases,
 * linkers and platforms, so a zero-tolerance comparison would report growth
 * that is not there. A ceiling with headroom stays quiet through ordinary
 * change and still catches the jump worth catching. Raising it is a deliberate
 * edit, which is the point.
 */

import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { rustArtifactFileName } from "./build-native-lib.mjs"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const BUDGETS = [
  {
    label: "pmds (release)",
    crate: "palamedes-cli",
    artifact: { name: "pmds", kind: "executable" },
    baseline: {
      label: "@palamedes/cli-linux-x64-gnu@1.17.3",
      bytes: 8_022_504,
    },
    maxBytes: 9_500_000,
  },
  {
    label: "core-node addon (release)",
    crate: "palamedes-node",
    artifact: { name: "palamedes_node", kind: "cdylib" },
    // The published Linux x64 GNU v1.17.3 addon is 7,057,176 B. A 7.8 MB
    // ceiling leaves 742,824 B (10.5 %) for normal linker/toolchain movement
    // while still rejecting the megabyte-class growth this gate targets.
    baseline: {
      label: "@palamedes/core-node-linux-x64-gnu@1.17.3",
      bytes: 7_057_176,
    },
    maxBytes: 7_800_000,
  },
]

export const formatBytes = (bytes) =>
  `${(bytes / 1_000_000).toFixed(2)} MB (${bytes.toLocaleString("en-US")} B)`

export function releaseArtifactPath(budget, platform = process.platform) {
  return path.join("target", "release", rustArtifactFileName({ ...budget.artifact, platform }))
}

export function evaluateBinarySize(budget, size) {
  return {
    budget,
    size,
    baselineDelta: size - budget.baseline.bytes,
    headroom: budget.maxBytes - size,
  }
}

export function formatBinarySizeResult(result, binaryPath) {
  const { budget, size, baselineDelta, headroom } = result
  const baselineComparison =
    baselineDelta >= 0
      ? `${formatBytes(baselineDelta)} above`
      : `${formatBytes(-baselineDelta)} below`

  if (headroom < 0) {
    return (
      `${budget.label}: ${formatBytes(size)} exceeds the budget of ${formatBytes(budget.maxBytes)} by ${formatBytes(-headroom)}.\n` +
      `Baseline ${budget.baseline.label}: ${formatBytes(budget.baseline.bytes)}; the measured artifact is ${baselineComparison} that baseline.\n` +
      `Artifact: ${binaryPath}\n` +
      `Either shrink it, or raise maxBytes in scripts/check-binary-size.mjs and say why in the commit.`
    )
  }

  const used = ((size / budget.maxBytes) * 100).toFixed(1)
  return (
    `${budget.label}: ${formatBytes(size)} of ${formatBytes(budget.maxBytes)} (${used} %), ${formatBytes(headroom)} to spare.\n` +
    `Baseline ${budget.baseline.label}: ${formatBytes(budget.baseline.bytes)}; the measured artifact is ${baselineComparison} that baseline.`
  )
}

export function checkBinarySizes({
  platform = process.platform,
  execute = execFileSync,
  stat = statSync,
  output = console,
} = {}) {
  let failed = false

  for (const budget of BUDGETS) {
    try {
      execute("cargo", ["build", "--release", "--locked", "-p", budget.crate], {
        cwd: ROOT,
        stdio: "inherit",
      })
    } catch (error) {
      failed = true
      output.error(
        `${budget.label}: failed to build Rust crate ${budget.crate}; this artifact could not be measured.\n` +
          `Cause: ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }

    const relativeBinaryPath = releaseArtifactPath(budget, platform)
    const binaryPath = path.join(ROOT, relativeBinaryPath)
    let size
    try {
      size = stat(binaryPath).size
    } catch (error) {
      failed = true
      output.error(
        `${budget.label}: cargo built ${budget.crate}, but the expected ${budget.artifact.kind} was not found at ${relativeBinaryPath} for ${platform}.\n` +
          `Cause: ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }

    const result = evaluateBinarySize(budget, size)
    const message = formatBinarySizeResult(result, relativeBinaryPath)
    if (result.headroom < 0) {
      failed = true
      output.error(message)
    } else {
      output.log(message)
    }
  }

  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = checkBinarySizes()
}
