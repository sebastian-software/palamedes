import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { publicWorkspacePackages } from "./release-packages.mjs";

const STABILITY_DOC = "docs/stability.md";
const SECTION_HEADING = "## Subpath Tiers";
const TIERS = new Set(["Stable", "Preview", "Internal", "Reserved"]);
const WILDCARD_ROW = /^Other `(@palamedes\/[^`]+)\/\*` subpaths$/u;

/**
 * Every public package subpath, such as `@palamedes/core/compiled`. Package
 * roots and `./package.json` are not subpaths: the package tier table above
 * the subpath table covers the roots.
 */
export function collectPackageSubpaths(packages) {
  const subpaths = [];
  const roots = new Set();
  for (const { name, manifest } of packages) {
    const exportsMap = manifest.exports;
    if (!exportsMap || typeof exportsMap !== "object" || Array.isArray(exportsMap)) continue;
    for (const key of Object.keys(exportsMap)) {
      if (key === ".") roots.add(name);
      else if (key.startsWith("./") && key !== "./package.json") {
        subpaths.push(`${name}${key.slice(1)}`);
      }
    }
  }
  return { roots, subpaths: subpaths.sort() };
}

/**
 * Parse the subpath tier table. A row names one or more code spans; a span
 * starting with `/` continues the package of the row's first span, so
 * `` `@palamedes/remix/server`, `/client` `` covers two subpaths. A row
 * spelled ``Other `@palamedes/x/*` subpaths`` covers every remaining subpath
 * of that package.
 */
export function parseSubpathTierTable(markdown) {
  const start = markdown.indexOf(`\n${SECTION_HEADING}\n`);
  if (start === -1) throw new Error(`${STABILITY_DOC} has no "${SECTION_HEADING}" section.`);
  const rest = markdown.slice(start + SECTION_HEADING.length + 2);
  const end = rest.search(/\n## /u);
  const section = end === -1 ? rest : rest.slice(0, end);

  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .slice(1, line.endsWith("|") ? -1 : undefined)
        .split("|")
        .map((cell) => cell.trim()),
    );
  if (rows.length < 2) throw new Error(`${STABILITY_DOC} "${SECTION_HEADING}" has no table.`);
  const [header, separator, ...body] = rows;
  if (header[0] !== "Subpath" || header[1] !== "Tier" || !/^-+$/u.test(separator[0] ?? "")) {
    throw new Error(`${STABILITY_DOC} subpath table must start with "| Subpath | Tier |".`);
  }

  const entries = [];
  const wildcards = [];
  for (const [surface, tier] of body) {
    if (!TIERS.has(tier)) {
      throw new Error(
        `${STABILITY_DOC} subpath row "${surface}" has tier "${tier}"; use one of ${[...TIERS].join(", ")}.`,
      );
    }
    const wildcard = surface.match(WILDCARD_ROW);
    if (wildcard) {
      wildcards.push({ packageName: wildcard[1], tier, surface });
      continue;
    }
    const spans = [...surface.matchAll(/`([^`]+)`/gu)].map(([, span]) => span);
    if (spans.length === 0) {
      throw new Error(`${STABILITY_DOC} subpath row "${surface}" names no package subpath.`);
    }
    const base = packageNameOf(spans[0]);
    for (const span of spans) {
      const specifier = span.startsWith("/") ? `${base}${span}` : span;
      entries.push({ specifier, tier, surface });
    }
  }
  return { entries, wildcards };
}

function packageNameOf(specifier) {
  const [scope, name] = specifier.split("/");
  return scope?.startsWith("@") ? `${scope}/${name}` : scope;
}

/** Compare the exports maps with the table in both directions. */
export function checkSubpathTiers({ packages, markdown }) {
  const { roots, subpaths } = collectPackageSubpaths(packages);
  const { entries, wildcards } = parseSubpathTierTable(markdown);
  const problems = [];

  const listed = new Map();
  for (const entry of entries) {
    if (listed.has(entry.specifier)) {
      problems.push(`${entry.specifier} is listed more than once.`);
    }
    listed.set(entry.specifier, entry);
  }

  const exported = new Set(subpaths);
  const coveredByWildcard = new Map(wildcards.map((wildcard) => [wildcard, 0]));
  for (const subpath of subpaths) {
    if (listed.has(subpath)) continue;
    const wildcard = wildcards.find(({ packageName }) => subpath.startsWith(`${packageName}/`));
    if (wildcard) {
      coveredByWildcard.set(wildcard, coveredByWildcard.get(wildcard) + 1);
      continue;
    }
    problems.push(`${subpath} is exported but has no row in the subpath tier table.`);
  }

  for (const { specifier } of entries) {
    const isRoot = specifier === packageNameOf(specifier);
    if (isRoot ? !roots.has(specifier) : !exported.has(specifier)) {
      problems.push(`${specifier} is listed in the subpath tier table but no package exports it.`);
    }
  }
  for (const [{ packageName }, count] of coveredByWildcard) {
    if (count === 0) {
      problems.push(`"Other ${packageName}/* subpaths" covers no exported subpath.`);
    }
  }
  return problems;
}

function main() {
  const root = process.cwd();
  const problems = checkSubpathTiers({
    packages: publicWorkspacePackages(root),
    markdown: readFileSync(path.join(root, STABILITY_DOC), "utf8"),
  });
  if (problems.length > 0) {
    const list = problems.map((problem) => `- ${problem}`).join("\n");
    console.error(
      `${STABILITY_DOC} "${SECTION_HEADING}" does not match the package exports maps:\n${list}`,
    );
    process.exit(1);
  }
  console.log(`Every public package subpath has a tier in ${STABILITY_DOC}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
