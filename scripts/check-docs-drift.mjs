/*
 * Guards the copy-paste surfaces that drift after a rename or a version pin:
 * READMEs, the llms files, docs/, and skills/.
 *
 * 1. Removed options. Every key in `REMOVED_PALAMEDES_OPTION_MESSAGES`
 *    (packages/core-node/src/removedOptions.ts) throws a migration error, so a
 *    guide must not set it. A mention is allowed in migration, troubleshooting,
 *    and changelog files, and in any paragraph, list item, table row, or code
 *    line that says the option was removed or renamed.
 * 2. Solid pins. Solid 2 is still published only as prereleases, so an
 *    unpinned `solid-js` resolves to Solid 1. Every install command that names
 *    a Solid package must pin the version from examples/solid-cookie.
 *
 *   node scripts/check-docs-drift.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REMOVED_OPTIONS_SOURCE = "packages/core-node/src/removedOptions.ts";
export const SOLID_PIN_SOURCE = "examples/solid-cookie/package.json";

/** Files whose job is to name removed options: migration, troubleshooting, changelogs. */
const MIGRATION_CONTEXT_FILES = [
  /^docs\/migration-v2\.md$/u,
  /^docs\/migrations\//u,
  /^docs\/release-notes-v\d+\.md$/u,
  /^docs\/troubleshooting\.md$/u,
  /^docs\/(?:plans|research)\//u,
  /(?:^|\/)CHANGELOG\.md$/u,
];

/** Words that mark a mention as migration guidance rather than a setting. */
const MIGRATION_VOCABULARY =
  /\b(?:removed|renamed|renames?|throws?|rejects?|rejected|migration|v1)\b/iu;

/**
 * Removed adapter options whose name is still valid on another API. `cwd`
 * remains a `loadPalamedesConfig()` option and a Node `child_process` option.
 * The pattern must match the section heading, or the code line itself.
 */
const STILL_VALID_ELSEWHERE = {
  cwd: /\bloadPalamedesConfig(?:Sync)?\b|\b(?:execFile|execFileSync|spawn|spawnSync|execSync)\b/u,
};

const SOLID_PACKAGES = ["solid-js", "@solidjs/web", "@solidjs/router", "@solidjs/vite-plugin"];

const INSTALL_COMMAND = /\b(?:pnpm add|pnpm install|npm install|npm i|yarn add|bun add)\b/u;

export function readRemovedOptionKeys(source) {
  const start = source.indexOf("REMOVED_PALAMEDES_OPTION_MESSAGES = {");
  const end = source.indexOf("} as const;", start);
  if (start === -1 || end === -1) {
    throw new Error(
      `${REMOVED_OPTIONS_SOURCE} no longer declares REMOVED_PALAMEDES_OPTION_MESSAGES`,
    );
  }
  const keys = [...source.slice(start, end).matchAll(/^\s+([A-Za-z_$][\w$]*):/gmu)].map(
    (match) => match[1],
  );
  if (keys.length === 0) throw new Error(`${REMOVED_OPTIONS_SOURCE} declares no removed options`);
  return keys;
}

export function readSolidPins(packageJson) {
  const manifest = JSON.parse(packageJson);
  const versions = { ...manifest.dependencies, ...manifest.devDependencies };
  const pins = {};
  for (const name of SOLID_PACKAGES) {
    const version = versions[name];
    if (!version) throw new Error(`${SOLID_PIN_SOURCE} does not declare ${name}`);
    if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(version)) {
      throw new Error(`${SOLID_PIN_SOURCE} must pin ${name} to an exact version, not ${version}`);
    }
    pins[name] = version;
  }
  return pins;
}

export function isMigrationContextFile(file) {
  return MIGRATION_CONTEXT_FILES.some((pattern) => pattern.test(file));
}

/**
 * Split Markdown into checkable blocks. Prose paragraphs, list items, table
 * rows, and headings are separate blocks; each fenced code line is its own
 * block. Every block records the nearest heading above it.
 */
export function markdownBlocks(text) {
  const blocks = [];
  let heading = "";
  let fence = null;
  let current = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const [index, line] of text.split("\n").entries()) {
    const lineNumber = index + 1;
    const fenceMarker = /^\s*(```|~~~)/u.exec(line);
    if (fence) {
      if (fenceMarker && fenceMarker[1] === fence) {
        fence = null;
        continue;
      }
      blocks.push({ kind: "code", text: line, line: lineNumber, heading });
      continue;
    }
    if (fenceMarker) {
      flush();
      fence = fenceMarker[1];
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (/^#{1,6}\s/u.test(line)) {
      flush();
      heading = line;
      blocks.push({ kind: "prose", text: line, line: lineNumber, heading });
      continue;
    }
    if (/^\s*\|/u.test(line)) {
      flush();
      blocks.push({ kind: "prose", text: line, line: lineNumber, heading });
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s/u.test(line)) flush();
    if (current) current.text += `\n${line}`;
    else current = { kind: "prose", text: line, line: lineNumber, heading };
  }
  flush();
  return blocks;
}

function keyPattern(key) {
  return new RegExp(`(?<![\\w.$-])${key.replace(/[$]/gu, "\\$&")}(?![\\w$(-])`, "u");
}

function usesKey(block, key) {
  if (block.kind === "code") {
    // An object property, a JSX attribute, or a shorthand property. A plain
    // variable such as `const cwd = root` is not an option.
    return new RegExp(
      `(?<![\\w.$-])${key}\\s*:(?!:)|(?<![\\w.$-])${key}=[{"']|[{,]\\s*${key}\\s*[,}]`,
      "u",
    ).test(block.text);
  }
  const pattern = keyPattern(key);
  return [...block.text.matchAll(/`([^`\n]+)`/gu)].some((span) => pattern.test(span[1]));
}

function lineOf(block, key) {
  if (block.kind === "code") return block.line;
  const offset = block.text.split("\n").findIndex((line) => line.includes(key));
  return block.line + Math.max(offset, 0);
}

export function findRemovedOptionUses(text, keys) {
  const findings = [];
  for (const block of markdownBlocks(text)) {
    for (const key of keys) {
      if (!usesKey(block, key)) continue;
      if (MIGRATION_VOCABULARY.test(block.text)) continue;
      // A prose block counts only under a heading for the other API, so a
      // sentence that merely mentions that API still has to stand on its own.
      const stillValid = STILL_VALID_ELSEWHERE[key];
      if (stillValid?.test(block.heading)) continue;
      if (stillValid && block.kind === "code" && stillValid.test(block.text)) continue;
      findings.push({ key, line: lineOf(block, key) });
    }
  }
  return findings;
}

export function findUnpinnedSolidInstalls(text, pins) {
  const findings = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!INSTALL_COMMAND.test(line)) continue;
    const tokens = line
      .slice(line.search(INSTALL_COMMAND))
      .split(/\s+/u)
      .map((token) => token.replace(/^[`"']+|[`"',;]+$/gu, ""));
    for (const token of tokens) {
      const name = token.startsWith("@")
        ? token.replace(/^(@[^/@]+\/[^@]+).*$/u, "$1")
        : token.split("@")[0];
      if (!(name in pins)) continue;
      const expected = `${name}@${pins[name]}`;
      if (token !== expected) findings.push({ line: index + 1, found: token, expected });
    }
  }
  return findings;
}

export function isDocsSurface(file) {
  return (
    /(?:^|\/)README\.md$/u.test(file) ||
    /^llms[^/]*\.txt$/u.test(file) ||
    /^docs\/.+\.md$/u.test(file) ||
    /^skills\/.+\.md$/u.test(file)
  );
}

export function listDocsSurfaces(cwd = root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter((file) => file && isDocsSurface(file));
}

export function checkDocsDrift({ files, read } = {}) {
  const readFile = read ?? ((file) => readFileSync(path.join(root, file), "utf8"));
  const keys = readRemovedOptionKeys(readFile(REMOVED_OPTIONS_SOURCE));
  const pins = readSolidPins(readFile(SOLID_PIN_SOURCE));
  const problems = [];
  for (const file of files ?? listDocsSurfaces()) {
    const text = readFile(file);
    if (!isMigrationContextFile(file)) {
      for (const { key, line } of findRemovedOptionUses(text, keys)) {
        problems.push(
          `${file}:${line} uses the removed option \`${key}\`, which throws a migration error (${REMOVED_OPTIONS_SOURCE}). Use its replacement, or say that it was removed or renamed.`,
        );
      }
    }
    for (const { line, found, expected } of findUnpinnedSolidInstalls(text, pins)) {
      problems.push(
        `${file}:${line} installs \`${found}\`; pin \`${expected}\` like ${SOLID_PIN_SOURCE}.`,
      );
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const problems = checkDocsDrift();
    if (problems.length > 0) {
      for (const problem of problems) console.error(`check-docs-drift: ${problem}`);
      process.exitCode = 1;
    } else {
      console.log("Docs use no removed options, and every Solid install is pinned.");
    }
  } catch (error) {
    console.error(`check-docs-drift: ${error.message}`);
    process.exitCode = 1;
  }
}
