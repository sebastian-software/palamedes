import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// GitHub resolves a tag at run time, so a compromised or moved tag silently
// changes what CI executes. Every third-party action is therefore pinned to a
// full commit SHA and carries the human-readable version as a comment. Local
// composite actions (`./.github/actions/...`), reusable workflows in this
// repository, and container references are exempt.
const USES_PATTERN = /^\s*(?:-\s+)?uses:\s*(?<value>\S+)(?<rest>.*)$/u;
const PINNED_PATTERN = /^[^\s@]+@[0-9a-f]{40}$/u;

export function collectWorkflowFiles(directory) {
  const entries = [];

  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);

    if (statSync(entryPath).isDirectory()) {
      entries.push(...collectWorkflowFiles(entryPath));
      continue;
    }

    if (/\.ya?ml$/u.test(entry)) {
      entries.push(entryPath);
    }
  }

  return entries.sort();
}

export function unpinnedActionReferences(source, filePath = "<memory>") {
  const problems = [];

  source.split(/\r?\n/u).forEach((line, index) => {
    const match = USES_PATTERN.exec(line);

    if (!match) {
      return;
    }

    const { value, rest } = match.groups;
    const location = `${filePath}:${index + 1}`;

    if (value.startsWith("./") || value.startsWith("docker://")) {
      return;
    }

    if (!PINNED_PATTERN.test(value)) {
      problems.push(`${location}: ${value} is not pinned to a full commit SHA`);
      return;
    }

    if (!rest.includes("#")) {
      problems.push(`${location}: ${value} has no version comment`);
    }
  });

  return problems;
}

export function checkWorkflowPins(root = process.cwd()) {
  const directories = [
    path.join(root, ".github", "workflows"),
    path.join(root, ".github", "actions"),
  ];
  const problems = [];
  let checked = 0;

  for (const directory of directories) {
    for (const filePath of collectWorkflowFiles(directory)) {
      checked += 1;
      problems.push(
        ...unpinnedActionReferences(readFileSync(filePath, "utf8"), path.relative(root, filePath)),
      );
    }
  }

  return { checked, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { checked, problems } = checkWorkflowPins();

  if (problems.length > 0) {
    console.error("Workflow actions must be pinned to a full commit SHA with a version comment:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }

  console.log(`check-workflow-pins: ${checked} workflow files use pinned actions`);
}
