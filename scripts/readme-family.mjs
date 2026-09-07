/*
 * Renders the `ferramenta-family` README block from the Ferramenta registry.
 *
 * The block is generated, never hand-written. `src/family.ts` in
 * sebastian-software/ferramenta is the single source of truth for the family's
 * members, their one-line jobs, and their links, so a renamed tool or a moved
 * docs URL changes in one place and every sibling README follows on its next
 * run instead of drifting apart.
 *
 *   pnpm readme:family        write the block into every README that carries one
 *   pnpm readme:family:check  exit 1 when a README drifted from the registry
 *
 * The repository README gets the `github` variant, a section with grouped
 * tables. The published packages get the `registry` variant: two plain-Markdown
 * lines, because npm renders package READMEs without the HTML the tables use.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { javascriptWorkspacePackages } from "./release-packages.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/*
 * The generator is the `ferramenta-readme` bin of `ferramenta-family`, which
 * ships inside the family repository and is consumed straight from Git until
 * the package is released to npm. Pin a commit and never a branch — a floating
 * ref would bless a different block on every run, so a check that passed
 * yesterday would say nothing about today. To adopt a registry change, bump
 * this SHA and run `pnpm readme:family`; the block is generated, so the diff
 * shows exactly what moved.
 */
const GENERATOR_COMMIT = "f6de99cd094d0fabbf0be23a9c0b5c074ff89976";
const GENERATOR = `github:sebastian-software/ferramenta#${GENERATOR_COMMIT}&path:/packages/family`;
const TOOL = "palamedes";

const START = "<!-- ferramenta-family:start -->";
const END = "<!-- ferramenta-family:end -->";
const LICENSE_HEADING = "\n## License\n";

// On Windows the package manager binary resolves to `pnpm.cmd`, which Node
// refuses to spawn without a shell (CVE-2024-27980). A shell then re-parses the
// arguments, and the generator specifier carries `#` and `&`, so quote them.
const useShell = process.platform === "win32";

/**
 * Every README that carries the family block, with the variant it carries.
 *
 * Platform packages are deliberately absent: the six `@palamedes/cli-*` and six
 * `@palamedes/core-node-*` manifests exist so npm can resolve one prebuilt
 * binary per host, nobody browses them, and `javascriptWorkspacePackages` is
 * the release pipeline's own name for "the packages people install".
 */
export function familyReadmeTargets(base = root) {
  return [
    { file: "README.md", variant: "github" },
    ...javascriptWorkspacePackages(base).map((workspacePackage) => ({
      file: `${workspacePackage.directory.split(path.sep).join("/")}/README.md`,
      variant: "registry",
    })),
  ];
}

export const generatorSpecifier = GENERATOR;

/*
 * Where a block goes when a README has none yet.
 *
 * The generator knows one placement rule: above the standards-owned
 * `sebastian-software-branding` section when there is one, and at the end of
 * the file otherwise. That is right for the repository README, which carries
 * the company footer. A package README ends in its `## License` section, so
 * appending would file the family under a licensing heading. Plant the empty
 * marker pair above that heading instead and let the generator fill it in —
 * placement stays this repository's decision, rendering stays the registry's.
 */
function ensureAnchor(file) {
  const filePath = path.join(root, file);
  const readme = readFileSync(filePath, "utf8");
  if (readme.includes(START) && readme.includes(END)) return;

  const license = readme.lastIndexOf(LICENSE_HEADING);
  if (license === -1) return;

  const head = readme.slice(0, license).trimEnd();
  const tail = readme.slice(license).trim();
  writeFileSync(filePath, `${head}\n\n${START}\n${END}\n\n${tail}\n`);
}

function quoteForShell(argument) {
  return useShell ? `"${argument}"` : argument;
}

function runGenerator(target, mode) {
  const args = [
    "dlx",
    GENERATOR,
    "--current",
    TOOL,
    "--variant",
    target.variant,
    `--${mode}`,
    target.file,
  ];
  const result = spawnSync("pnpm", args.map(quoteForShell), {
    cwd: root,
    encoding: "utf8",
    shell: useShell,
  });

  if (result.error) throw result.error;
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    ok: result.status === 0,
  };
}

const USAGE = [
  "Usage: node scripts/readme-family.mjs --write|--check",
  "",
  "  --write  insert or update the family block in every README that carries one",
  "  --check  exit 1 when a README block drifted from the pinned registry",
].join("\n");

function renderFamilyBlocks(mode) {
  const targets = familyReadmeTargets();
  const failures = [];

  for (const target of targets) {
    if (mode === "write" && target.variant === "registry") ensureAnchor(target.file);
    const { ok, output } = runGenerator(target, mode);
    if (ok) {
      if (mode === "write") console.log(output);
      continue;
    }
    failures.push(output || `${target.file}: the family block generator failed`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(
      `\n${failures.length} README block(s) drifted. Run \`pnpm readme:family\` to regenerate them.`,
    );
    return 1;
  }

  console.log(
    mode === "write"
      ? `readme-family: rendered ${targets.length} README family blocks from the pinned registry`
      : `readme-family: ${targets.length} README family blocks match the pinned registry`,
  );
  return 0;
}

function main(argv) {
  const write = argv.includes("--write");
  const check = argv.includes("--check");
  if (write === check) {
    console.error(USAGE);
    return 2;
  }
  return renderFamilyBlocks(write ? "write" : "check");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
