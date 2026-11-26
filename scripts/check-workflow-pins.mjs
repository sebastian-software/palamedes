import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// GitHub resolves a tag at run time, so a compromised or moved tag silently
// changes what CI executes. Every third-party action is therefore pinned to a
// full commit SHA with a version comment, and every static container image
// reference in workflows, composite actions, and Containerfiles/Dockerfiles is
// pinned to an immutable `@sha256:` digest.
const USES_PATTERN = /^\s*(?:-\s+)?uses:\s*(?<value>\S+)(?<rest>.*)$/u;
const PINNED_ACTION_PATTERN = /^[^\s@]+@[0-9a-f]{40}$/u;
const PINNED_DIGEST_PATTERN = /@sha256:[0-9a-f]{64}$/u;
const YAML_CONTAINER_SHORTHAND_PATTERN =
  /^(?<indent>\s*)container:\s*(?<value>[^#\s][^#]*?)\s*(?:#.*)?$/u;
const YAML_IMAGE_PATTERN = /^(?<indent>\s*)(?:-\s+)?image:\s*(?<value>[^#\s][^#]*?)\s*(?:#.*)?$/u;
const YAML_KEY_PATTERN = /^(?<indent>\s*)(?:-\s+)?(?<key>[A-Za-z0-9_-]+):\s*(?<rest>.*)$/u;
const SHELL_ASSIGNMENT_PATTERN =
  /^\s*(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)=(?<raw>[^\s#].*)$/u;
const SHELL_VAR_REFERENCE_PATTERN =
  /^\$(?:\{(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?<bare>[A-Za-z_][A-Za-z0-9_]*))$/u;
const EMBEDDED_VAR_PATTERN =
  /\$(?:\{(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?<bare>[A-Za-z_][A-Za-z0-9_]*))/gu;
const ENV_PREFIX_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const CONTAINER_FILENAME_PATTERN =
  /^(?:Containerfile|Dockerfile)(?:\..+)?$|\.(?:Containerfile|Dockerfile)$/u;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".tanstack",
  "build",
  "dist",
  "node_modules",
  "target",
]);

const DOCKER_PULL_VALUE_FLAGS = new Set(["--platform"]);
const DOCKER_RUN_VALUE_FLAGS = new Set([
  "-a",
  "--attach",
  "--add-host",
  "--annotation",
  "--blkio-weight",
  "--cap-add",
  "--cap-drop",
  "--cgroup-parent",
  "--cgroupns",
  "--cidfile",
  "--cpu-period",
  "--cpu-quota",
  "--cpu-rt-period",
  "--cpu-rt-runtime",
  "-c",
  "--cpu-shares",
  "--cpus",
  "--cpuset-cpus",
  "--cpuset-mems",
  "--detach-keys",
  "--device",
  "--device-cgroup-rule",
  "--device-read-bps",
  "--device-read-iops",
  "--device-write-bps",
  "--device-write-iops",
  "--dns",
  "--dns-option",
  "--dns-search",
  "--domainname",
  "--entrypoint",
  "-e",
  "--env",
  "--env-file",
  "--expose",
  "--gpus",
  "--group-add",
  "--health-cmd",
  "--health-interval",
  "--health-retries",
  "--health-start-interval",
  "--health-start-period",
  "--health-timeout",
  "-h",
  "--hostname",
  "--ip",
  "--ip6",
  "--ipc",
  "--isolation",
  "--kernel-memory",
  "-l",
  "--label",
  "--label-file",
  "--link",
  "--link-local-ip",
  "--log-driver",
  "--log-opt",
  "--mac-address",
  "-m",
  "--memory",
  "--memory-reservation",
  "--memory-swap",
  "--memory-swappiness",
  "--mount",
  "--name",
  "--net",
  "--network",
  "--network-alias",
  "--oom-score-adj",
  "--pid",
  "--pids-limit",
  "--platform",
  "-p",
  "--publish",
  "--pull",
  "--restart",
  "--runtime",
  "--security-opt",
  "--shm-size",
  "--stop-signal",
  "--stop-timeout",
  "--storage-opt",
  "--sysctl",
  "--tmpfs",
  "--ulimit",
  "-u",
  "--user",
  "--userns",
  "--uts",
  "-v",
  "--volume",
  "--volume-driver",
  "--volumes-from",
  "-w",
  "--workdir",
]);

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Split a shell snippet into command token arrays on unquoted command separators
// (`&&`, `||`, `;`, `|`, `&`, newline) while preserving quoting.
function splitShellCommands(command) {
  const commands = [];
  let tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  const flushToken = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  const flushCommand = () => {
    flushToken();
    if (tokens.length > 0) {
      commands.push(tokens);
      tokens = [];
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === "\n" || ch === ";") {
      flushCommand();
      continue;
    }

    if (ch === "&" || ch === "|") {
      flushCommand();
      if (command[index + 1] === ch) {
        index += 1;
      }
      continue;
    }

    if (/\s/u.test(ch)) {
      flushToken();
      continue;
    }

    current += ch;
  }

  flushCommand();
  return commands;
}

function isPinnedDigest(imageReference) {
  return PINNED_DIGEST_PATTERN.test(imageReference);
}

function isDynamicReference(value) {
  return value.includes("${{") || value.includes("$");
}

function isLocalDockerActionImage(imageReference) {
  if (imageReference.startsWith("docker://")) {
    return false;
  }
  return (
    imageReference.startsWith("./") ||
    imageReference.startsWith("../") ||
    CONTAINER_FILENAME_PATTERN.test(path.basename(imageReference))
  );
}

function extractDockerCommandImages(command) {
  const images = [];

  for (const tokens of splitShellCommands(command)) {
    let cursor = 0;
    while (
      cursor < tokens.length &&
      (tokens[cursor] === "sudo" ||
        tokens[cursor] === "env" ||
        ENV_PREFIX_ASSIGNMENT_PATTERN.test(tokens[cursor]))
    ) {
      cursor += 1;
    }

    const cli = tokens[cursor];
    if (cli !== "docker" && cli !== "podman") {
      continue;
    }

    const subcommand = tokens[cursor + 1];
    if (subcommand !== "pull" && subcommand !== "run") {
      continue;
    }

    const valueFlags = subcommand === "pull" ? DOCKER_PULL_VALUE_FLAGS : DOCKER_RUN_VALUE_FLAGS;

    for (let index = cursor + 2; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "--") {
        if (tokens[index + 1]) {
          images.push(tokens[index + 1]);
        }
        break;
      }
      if (token.startsWith("${") && (token.includes("[@]") || token.includes("[*]"))) {
        continue;
      }
      if (token.startsWith("-")) {
        if (!token.includes("=") && valueFlags.has(token)) {
          index += 1;
        }
        continue;
      }
      images.push(token);
      break;
    }
  }

  return images;
}

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

function collectContainerFilesFromFilesystem(directory) {
  const entries = [];

  for (const entry of readdirSync(directory)) {
    if (IGNORED_DIRECTORIES.has(entry) || entry.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(directory, entry);
    const stats = lstatSync(entryPath);

    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      entries.push(...collectContainerFilesFromFilesystem(entryPath));
      continue;
    }

    if (stats.isFile() && CONTAINER_FILENAME_PATTERN.test(entry)) {
      entries.push(entryPath);
    }
  }

  return entries.sort();
}

export function collectContainerFiles(root) {
  const gitResult = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  if (gitResult.status === 0 && typeof gitResult.stdout === "string") {
    const entries = [];
    for (const relativePath of gitResult.stdout.split("\0")) {
      if (!relativePath || !CONTAINER_FILENAME_PATTERN.test(path.basename(relativePath))) {
        continue;
      }
      const fullPath = path.join(root, relativePath);
      if (!existsSync(fullPath)) {
        continue;
      }
      const stats = lstatSync(fullPath);
      if (!stats.isSymbolicLink() && stats.isFile()) {
        entries.push(fullPath);
      }
    }
    return entries.sort();
  }

  return collectContainerFilesFromFilesystem(root);
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

    if (value.startsWith("./")) {
      return;
    }

    if (value.startsWith("docker://")) {
      if (!isPinnedDigest(value)) {
        problems.push(`${location}: ${value} is not pinned to a sha256 digest`);
      }
      return;
    }

    if (!PINNED_ACTION_PATTERN.test(value)) {
      problems.push(`${location}: ${value} is not pinned to a full commit SHA`);
      return;
    }

    if (!rest.includes("#")) {
      problems.push(`${location}: ${value} has no version comment`);
    }
  });

  return problems;
}

export function unpinnedWorkflowContainerReferences(source, filePath = "<memory>") {
  const problems = [];
  const lines = source.split(/\r?\n/u);
  const stepVariables = new Map();
  const yamlContext = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^\s*-\s+(?:name|id|uses|run):/u.test(line)) {
      stepVariables.clear();
    }

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    while (yamlContext.length > 0 && yamlContext.at(-1).indent >= indent) {
      yamlContext.pop();
    }

    const containerShorthand = YAML_CONTAINER_SHORTHAND_PATTERN.exec(line);
    if (containerShorthand) {
      const imageRef = stripQuotes(containerShorthand.groups.value);
      if (!isDynamicReference(imageRef) && !isPinnedDigest(imageRef)) {
        problems.push(`${filePath}:${index + 1}: ${imageRef} is not pinned to a sha256 digest`);
      }
      continue;
    }

    const yamlImage = YAML_IMAGE_PATTERN.exec(line);
    if (yamlImage) {
      const imageRef = stripQuotes(yamlImage.groups.value);
      const inRunsSection = yamlContext.some((entry) => entry.key === "runs");
      if (
        (!inRunsSection || !isLocalDockerActionImage(imageRef)) &&
        !isDynamicReference(imageRef) &&
        !isPinnedDigest(imageRef)
      ) {
        problems.push(`${filePath}:${index + 1}: ${imageRef} is not pinned to a sha256 digest`);
      }
      continue;
    }

    // YAML folded scalar `run: >` joins indented lines with spaces without
    // trailing backslashes and may contain one or more docker/podman commands.
    const foldedRunMatch = /^(?<indent>\s*)(?:-\s+)?run:\s*>[+-]?\s*$/u.exec(line);
    if (foldedRunMatch) {
      const baseIndent = foldedRunMatch.groups.indent.length;
      const bodyLines = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        const nextTrimmed = nextLine.trim();
        const nextIndent = nextLine.length - nextLine.trimStart().length;
        if (nextTrimmed.length > 0 && nextIndent <= baseIndent) {
          break;
        }
        bodyLines.push({ text: nextTrimmed, lineNumber: cursor + 1 });
        cursor += 1;
      }
      const joined = bodyLines.map((entry) => entry.text).join(" ");
      for (const imageToken of extractDockerCommandImages(joined)) {
        const matchingLine =
          bodyLines.find((entry) => entry.text.includes(imageToken))?.lineNumber ?? index + 1;
        checkDockerImageToken(imageToken, matchingLine, stepVariables, filePath, problems);
      }
      index = cursor - 1;
      continue;
    }

    const keyMatch = YAML_KEY_PATTERN.exec(line);
    if (keyMatch && keyMatch.groups.rest.trim() === "") {
      yamlContext.push({ indent: keyMatch.groups.indent.length, key: keyMatch.groups.key });
    }

    const assignment = SHELL_ASSIGNMENT_PATTERN.exec(line);
    if (assignment && !trimmed.startsWith("run:") && !trimmed.includes(": ")) {
      const rawValue = assignment.groups.raw.replace(/\s+#.*$/u, "").trim();
      stepVariables.set(assignment.groups.name, {
        value: stripQuotes(rawValue),
        lineNumber: index + 1,
      });
      continue;
    }

    if (/\b(?:docker|podman)\s+(?:pull|run)\b/u.test(trimmed)) {
      const startLine = index + 1;
      let combined = trimmed;
      while (combined.endsWith("\\") && index + 1 < lines.length) {
        combined = `${combined.slice(0, -1)} ${lines[index + 1].trim()}`;
        index += 1;
      }
      const commandText = combined.replace(/^(?:-\s+)?run:\s*/u, "");
      for (const imageToken of extractDockerCommandImages(commandText)) {
        checkDockerImageToken(imageToken, startLine, stepVariables, filePath, problems);
      }
    }
  }

  return problems;
}

function checkDockerImageToken(imageToken, lineNumber, stepVariables, filePath, problems) {
  const varMatch = SHELL_VAR_REFERENCE_PATTERN.exec(imageToken);
  if (varMatch) {
    const varName = varMatch.groups.braced ?? varMatch.groups.bare;
    const assigned = stepVariables.get(varName);
    if (assigned && !isDynamicReference(assigned.value) && !isPinnedDigest(assigned.value)) {
      problems.push(
        `${filePath}:${assigned.lineNumber}: ${assigned.value} is not pinned to a sha256 digest`,
      );
    }
    return;
  }

  if (isDynamicReference(imageToken)) {
    return;
  }

  if (!isPinnedDigest(imageToken)) {
    problems.push(`${filePath}:${lineNumber}: ${imageToken} is not pinned to a sha256 digest`);
  }
}

export function unpinnedContainerfileReferences(source, filePath = "<memory>") {
  const problems = [];
  const rawLines = source.split(/\r?\n/u);
  const logicalLines = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const startLine = index + 1;
    let combined = trimmed;
    while (combined.endsWith("\\") && index + 1 < rawLines.length) {
      combined = `${combined.slice(0, -1)} ${rawLines[index + 1].trim()}`;
      index += 1;
    }
    logicalLines.push({ lineNumber: startLine, text: combined });
  }

  const stages = new Set();
  const globalArgs = new Map();
  let stageArgs = new Map();
  let seenFrom = false;

  for (const { lineNumber, text } of logicalLines) {
    const argMatch = /^ARG\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:=(?<value>.+))?$/iu.exec(text);
    if (argMatch) {
      const targetArgs = seenFrom ? stageArgs : globalArgs;
      if (argMatch.groups.value !== undefined) {
        const mergedArgs = seenFrom ? new Map([...globalArgs, ...stageArgs]) : globalArgs;
        targetArgs.set(
          argMatch.groups.name,
          resolveBuildArgs(stripQuotes(argMatch.groups.value), mergedArgs),
        );
      } else if (seenFrom && globalArgs.has(argMatch.groups.name)) {
        targetArgs.set(argMatch.groups.name, globalArgs.get(argMatch.groups.name));
      }
      continue;
    }

    const fromMatch = /^FROM\s+(?<rest>.+)$/iu.exec(text);
    if (fromMatch) {
      seenFrom = true;
      stageArgs = new Map();
      const tokens = fromMatch.groups.rest.trim().split(/\s+/u);
      let cursor = 0;
      while (cursor < tokens.length && tokens[cursor].startsWith("--")) {
        cursor += 1;
      }
      const imageToken = tokens[cursor];
      if (!imageToken) {
        continue;
      }

      const stageAlias =
        tokens[cursor + 1] && tokens[cursor + 1].toLowerCase() === "as" && tokens[cursor + 2]
          ? tokens[cursor + 2].toLowerCase()
          : null;

      // Resolve against global ARGs and check against previously declared stages
      // BEFORE registering the new stage alias so `FROM alpine AS alpine` fails.
      const resolved = resolveBuildArgs(imageToken, globalArgs);
      if (
        resolved.toLowerCase() !== "scratch" &&
        !stages.has(resolved.toLowerCase()) &&
        !isDynamicReference(resolved) &&
        !isPinnedDigest(resolved)
      ) {
        problems.push(`${filePath}:${lineNumber}: ${resolved} is not pinned to a sha256 digest`);
      }

      if (stageAlias) {
        stages.add(stageAlias);
      }
      continue;
    }

    const copyFromMatch = /^(?:COPY|ADD)\s+.*--from=(?<source>\S+)/iu.exec(text);
    if (copyFromMatch) {
      const mergedArgs = new Map([...globalArgs, ...stageArgs]);
      const sourceRef = resolveBuildArgs(stripQuotes(copyFromMatch.groups.source), mergedArgs);
      if (
        /^\d+$/u.test(sourceRef) ||
        stages.has(sourceRef.toLowerCase()) ||
        isDynamicReference(sourceRef)
      ) {
        continue;
      }
      if (!isPinnedDigest(sourceRef)) {
        problems.push(`${filePath}:${lineNumber}: ${sourceRef} is not pinned to a sha256 digest`);
      }
    }
  }

  return problems;
}

function resolveBuildArgs(token, buildArgs) {
  return token.replace(EMBEDDED_VAR_PATTERN, (match, _p1, _p2, _offset, _str, groups) => {
    const name = groups.braced ?? groups.bare;
    return buildArgs.has(name) ? buildArgs.get(name) : match;
  });
}

export function checkWorkflowPins(root = process.cwd()) {
  const directories = [
    path.join(root, ".github", "workflows"),
    path.join(root, ".github", "actions"),
  ];
  const problems = [];
  let checked = 0;

  for (const directory of directories) {
    if (!existsSync(directory)) {
      continue;
    }
    for (const filePath of collectWorkflowFiles(directory)) {
      checked += 1;
      const source = readFileSync(filePath, "utf8");
      const relativePath = path.relative(root, filePath);
      problems.push(
        ...unpinnedActionReferences(source, relativePath),
        ...unpinnedWorkflowContainerReferences(source, relativePath),
      );
    }
  }

  const containerFiles = collectContainerFiles(root);
  for (const filePath of containerFiles) {
    const source = readFileSync(filePath, "utf8");
    const relativePath = path.relative(root, filePath);
    problems.push(...unpinnedContainerfileReferences(source, relativePath));
  }

  return { checked, containerFilesChecked: containerFiles.length, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { checked, containerFilesChecked, problems } = checkWorkflowPins();

  if (problems.length > 0) {
    console.error("Workflow actions and container images must be pinned to immutable digests:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }

  console.log(
    `check-workflow-pins: ${checked} workflow files and ${containerFilesChecked} container files use pinned references`,
  );
}
