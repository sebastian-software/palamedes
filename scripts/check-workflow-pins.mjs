import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";

// GitHub resolves a tag at run time, so a compromised or moved tag silently
// changes what CI executes. Every third-party action is therefore pinned to a
// full commit SHA with a version comment, and every static container image
// reference in workflows, composite actions, and Containerfiles/Dockerfiles is
// pinned to an immutable `@sha256:` digest.
const PINNED_ACTION_PATTERN = /^[^\s@]+@[0-9a-f]{40}$/u;
const PINNED_DIGEST_PATTERN = /@sha256:[0-9a-f]{64}$/u;
const LOCAL_IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const EMBEDDED_VAR_PATTERN =
  /\$(?:\{(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?<bare>[A-Za-z_][A-Za-z0-9_]*))/gu;
const PWSH_ENV_VAR_PATTERN =
  /\$(?:\{env:(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}|env:(?<bare>[A-Za-z_][A-Za-z0-9_]*))/giu;
const CMD_VAR_PATTERN = /%(?<name>[A-Za-z_][A-Za-z0-9_]*)%/gu;
const PWSH_ASSIGN_LHS_PATTERN =
  /^\$(?:(?<envPrefix>env:)?(?:script:|global:|local:)?(?<bare>[A-Za-z_][A-Za-z0-9_]*)|\{(?<envPrefixBraced>env:)?(?:script:|global:|local:)?(?<braced>[A-Za-z_][A-Za-z0-9_]*)\})$/iu;
const PWSH_INLINE_ASSIGN_PATTERN =
  /^\$(?:(?<envPrefix>env:)?(?:script:|global:|local:)?(?<bare>[A-Za-z_][A-Za-z0-9_]*)|\{(?<envPrefixBraced>env:)?(?:script:|global:|local:)?(?<braced>[A-Za-z_][A-Za-z0-9_]*)\})=(?<value>.*)$/iu;
const ENV_EXPRESSION_PATTERN =
  /\$\{\{\s*env(?:\.(?<dot>[A-Za-z_][A-Za-z0-9_]*)|\[(?:'(?<sq>[A-Za-z_][A-Za-z0-9_]*)'|"(?<dq>[A-Za-z_][A-Za-z0-9_]*)")\])\s*\}\}/giu;
const INPUTS_EXPRESSION_PATTERN =
  /\$\{\{\s*inputs(?:\.(?<dot>[A-Za-z0-9_-]+)|\[(?:'(?<sq>[^']+)'|"(?<dq>[^"]+)")\])\s*\}\}/giu;
const MATRIX_EXPRESSION_PATTERN =
  /\$\{\{\s*matrix(?<path>(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*\}\}/giu;
const BUILDKIT_TARGET_PLATFORM_ARGS = new Set([
  "TARGETPLATFORM",
  "TARGETOS",
  "TARGETARCH",
  "TARGETVARIANT",
]);
const BUILDKIT_AUTOMATIC_PLATFORM_ARGS = new Set([
  ...BUILDKIT_TARGET_PLATFORM_ARGS,
  "BUILDPLATFORM",
  "BUILDOS",
  "BUILDARCH",
  "BUILDVARIANT",
]);
const SINGLE_MATRIX_EXPRESSION_PATTERN =
  /^\$\{\{\s*matrix(?<path>(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*\}\}$/iu;
const MATRIX_SEGMENT_PATTERN = /\.([A-Za-z0-9_-]+)|\[(?:'([^']+)'|"([^"]+)")\]/gu;
const ENV_PREFIX_ASSIGNMENT_PATTERN = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/u;
const SHELL_INTERPRETERS = new Set(["sh", "bash", "ash", "dash", "zsh", "ksh"]);
const SHELL_COMMAND_PREFIXES = new Set([
  "if",
  "elif",
  "else",
  "then",
  "do",
  "while",
  "until",
  "!",
  "time",
  "exec",
  "command",
  "builtin",
  "nohup",
  "sudo",
  "env",
  "timeout",
  "{",
  "(",
]);
const CONTAINER_FILENAME_PATTERN =
  /^(?:Containerfile|Dockerfile)(?:\..+)?$|\.(?:Containerfile|Dockerfile)$/iu;
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
const MAX_YAML_CONVERSION_STEPS = 20_000;
const MAX_MATRIX_ROWS = 256;
const MAX_MATRIX_WORK = 10_000;
const MAX_VAR_VALUES = 32;
const MAX_TOKEN_EXPANSIONS = 64;
const MAX_WORKING_DIRS_PER_ROW = 32;
const MAX_LOCAL_CALL_DEPTH = 10;

const DOCKER_GLOBAL_VALUE_FLAGS = new Set([
  "--config",
  "-c",
  "--context",
  "-H",
  "--host",
  "-l",
  "--log-level",
  "--tlscacert",
  "--tlscert",
  "--tlskey",
]);
const DOCKER_BUILDX_GLOBAL_VALUE_FLAGS = new Set(["--builder"]);
const DOCKER_BUILDX_CREATE_VALUE_FLAGS = new Set([
  "--buildkitd-config",
  "--buildkitd-flags",
  "--config",
  "--driver",
  "--driver-opt",
  "--name",
  "--node",
  "--platform",
]);
const PODMAN_GLOBAL_VALUE_FLAGS = new Set([
  ...DOCKER_GLOBAL_VALUE_FLAGS,
  "--cdi-spec-dir",
  "--cgroup-manager",
  "--conmon",
  "--connection",
  "--events-backend",
  "--hooks-dir",
  "--identity",
  "--imagestore",
  "--module",
  "--network-cmd-path",
  "--network-config-dir",
  "--out",
  "--root",
  "--runroot",
  "--runtime",
  "--runtime-flag",
  "--secret",
  "--storage-driver",
  "--storage-opt",
  "--tmpdir",
  "--url",
  "--volumepath",
]);
const BUILDAH_GLOBAL_VALUE_FLAGS = new Set([
  "--cdi-config-dir",
  "--cgroup-manager",
  "--default-mounts-file",
  "--hooks-dir",
  "--imagestore",
  "--log-level",
  "--module",
  "--registries-conf",
  "--registries-conf-dir",
  "--root",
  "--runroot",
  "--short-name-alias-conf",
  "--storage-driver",
  "--storage-opt",
  "--userns-gid-map",
  "--userns-uid-map",
]);
const DOCKER_PULL_VALUE_FLAGS = new Set(["--platform"]);
const PODMAN_PULL_VALUE_FLAGS = new Set([
  ...DOCKER_PULL_VALUE_FLAGS,
  "--arch",
  "--authfile",
  "--cert-dir",
  "--creds",
  "--decryption-key",
  "--os",
  "--policy",
  "--retry",
  "--retry-delay",
  "--variant",
]);
const DOCKER_RUN_VALUE_FLAGS = new Set([
  "-a",
  "--attach",
  "--add-host",
  "--annotation",
  "--blkio-weight",
  "--blkio-weight-device",
  "--cap-add",
  "--cap-drop",
  "--cgroup-parent",
  "--cgroupns",
  "--cidfile",
  "--cpu-count",
  "--cpu-percent",
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
  "--dns-opt",
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
  "--io-maxbandwidth",
  "--io-maxiops",
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
const PODMAN_RUN_VALUE_FLAGS = new Set([
  ...DOCKER_RUN_VALUE_FLAGS,
  "--arch",
  "--authfile",
  "--cert-dir",
  "--cgroup-conf",
  "--cgroups",
  "--chrootdirs",
  "--conmon-pidfile",
  "--creds",
  "--decryption-key",
  "--env-merge",
  "--gidmap",
  "--group-entry",
  "--health-log-destination",
  "--health-max-log-count",
  "--health-max-log-size",
  "--health-on-failure",
  "--health-startup-cmd",
  "--health-startup-interval",
  "--health-startup-retries",
  "--health-startup-success",
  "--health-startup-timeout",
  "--hostuser",
  "--image-volume",
  "--init-ctr",
  "--init-path",
  "--os",
  "--passwd-entry",
  "--personality",
  "--pod",
  "--pod-id-file",
  "--preserve-fd",
  "--preserve-fds",
  "--rdt-class",
  "--requires",
  "--retry",
  "--retry-delay",
  "--sdnotify",
  "--seccomp-policy",
  "--secret",
  "--shm-size-systemd",
  "--subgidname",
  "--subuidname",
  "--systemd",
  "--timeout",
  "--tz",
  "--uidmap",
  "--umask",
  "--unsetenv",
  "--variant",
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

function isPinnedDigest(imageReference) {
  return PINNED_DIGEST_PATTERN.test(imageReference);
}

function isDynamicReference(value, shellMode = "posix") {
  if (value.includes("${{") || value.includes("$")) {
    return true;
  }
  if (shellMode === "cmd" && /%[A-Za-z_][A-Za-z0-9_]*%/u.test(value)) {
    return true;
  }
  return false;
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

function getMapField(mapNode, key) {
  if (mapNode?.kind !== "map") {
    return null;
  }
  if (mapNode.value.has(key)) {
    return mapNode.value.get(key);
  }
  const lower = key.toLowerCase();
  for (const [entryKey, entryValue] of mapNode.value) {
    if (entryKey.toLowerCase() === lower) {
      return entryValue;
    }
  }
  return null;
}

function normalizeShellMode(shellValue) {
  if (!shellValue) {
    return "posix";
  }
  const trimmed = String(shellValue).trim();
  if (/^(?:pwsh|powershell)(?:\.exe)?(?:\s|$)/iu.test(trimmed)) {
    return "pwsh";
  }
  if (/^cmd(?:\.exe)?(?:\s|$)/iu.test(trimmed)) {
    return "cmd";
  }
  return "posix";
}

function isWindowsRunnerLabel(label) {
  return /^windows(?:[-.\s]|$)/iu.test(label.trim());
}

function classifyRunnerOsFromLabel(label) {
  const trimmed = label.trim().toLowerCase();
  if (/^windows(?:[-.\s]|$)/u.test(trimmed)) {
    return "Windows";
  }
  if (/^(?:macos|osx)(?:[-.\s]|$)/u.test(trimmed)) {
    return "macOS";
  }
  if (/^(?:ubuntu|linux)(?:[-.\s]|$)/u.test(trimmed)) {
    return "Linux";
  }
  return null;
}

function resolveRunnerOsForMatrixRow(runsOnNode, jobEnv, row) {
  if (!runsOnNode) {
    return null;
  }
  const singleRowList = row ? [row] : [];
  const expandNode = (labelNode) => {
    if (labelNode?.kind !== "scalar") {
      return [];
    }
    const raw = String(labelNode.value).trim();
    const labels = [];
    for (const envCandidate of resolveEnvExpressionCandidates(raw, jobEnv, labelNode.line)
      .candidates) {
      for (const candidate of expandMatrixReferences(
        envCandidate.text,
        singleRowList,
        envCandidate.line,
      )) {
        if (candidate.text.trim()) {
          labels.push(candidate.text.trim());
        }
      }
    }
    return labels;
  };

  let labelsNode = runsOnNode;
  if (runsOnNode.kind === "map") {
    labelsNode = getMapField(runsOnNode, "labels");
  }

  const labels = [];
  if (labelsNode?.kind === "scalar") {
    labels.push(...expandNode(labelsNode));
  } else if (labelsNode?.kind === "seq") {
    for (const item of labelsNode.value) {
      labels.push(...expandNode(item));
    }
  }

  for (const label of labels) {
    if (isWindowsRunnerLabel(label)) {
      return "Windows";
    }
  }
  for (const label of labels) {
    const os = classifyRunnerOsFromLabel(label);
    if (os) {
      return os;
    }
  }
  return null;
}

function resolveRunnerShellContexts(jobNode, jobEnv, jobMatrixRows) {
  const runsOnNode = getMapField(jobNode, "runs-on");
  if (!runsOnNode) {
    return [];
  }
  const rows = jobMatrixRows.length > 0 ? jobMatrixRows : [null];
  return rows.map((row) => {
    const runnerOs = resolveRunnerOsForMatrixRow(runsOnNode, jobEnv, row);
    return {
      row,
      runnerOs,
      defaultShell: runnerOs === "Windows" ? "pwsh" : "posix",
    };
  });
}

function evaluateStepIfClause(clause, context) {
  const trimmed = clause
    .trim()
    .replace(/^\$\{\{\s*/u, "")
    .replace(/\s*\}\}$/u, "")
    .trim();

  const eqMatch =
    /^(?<lhs>runner\.os|matrix(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*(?<op>==|!=)\s*(?:'(?<sq>[^']*)'|"(?<dq>[^"]*)")$/iu.exec(
      trimmed,
    );
  if (eqMatch) {
    const expected = (eqMatch.groups.sq ?? eqMatch.groups.dq ?? "").toLowerCase();
    let actual = null;
    if (eqMatch.groups.lhs.toLowerCase() === "runner.os") {
      actual = context.runnerOs;
    } else if (context.row) {
      const pathSuffix = eqMatch.groups.lhs.slice("matrix".length);
      actual = resolveMatrixPath(context.row, parseMatrixPathSegments(pathSuffix))?.value ?? null;
    }
    if (actual === null) {
      return null;
    }
    const equal = actual.toLowerCase() === expected;
    return eqMatch.groups.op === "==" ? equal : !equal;
  }

  const fnMatch =
    /^(?<neg>!)?\s*(?<fn>startsWith|contains)\(\s*(?<lhs>runner\.os|matrix(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*,\s*(?:'(?<sq>[^']*)'|"(?<dq>[^"]*)")\s*\)$/iu.exec(
      trimmed,
    );
  if (fnMatch) {
    const needle = (fnMatch.groups.sq ?? fnMatch.groups.dq ?? "").toLowerCase();
    let actual = null;
    if (fnMatch.groups.lhs.toLowerCase() === "runner.os") {
      actual = context.runnerOs;
    } else if (context.row) {
      const pathSuffix = fnMatch.groups.lhs.slice("matrix".length);
      actual = resolveMatrixPath(context.row, parseMatrixPathSegments(pathSuffix))?.value ?? null;
    }
    if (actual === null) {
      return null;
    }
    const lowerActual = actual.toLowerCase();
    const matched =
      fnMatch.groups.fn.toLowerCase() === "startswith"
        ? lowerActual.startsWith(needle)
        : lowerActual.includes(needle);
    return fnMatch.groups.neg ? !matched : matched;
  }

  return null;
}

function filterRunnerContextsForStep(stepIfNode, runnerContexts) {
  if (!stepIfNode || stepIfNode.kind !== "scalar" || runnerContexts.length === 0) {
    return runnerContexts;
  }
  const rawIf = String(stepIfNode.value).trim();
  if (!rawIf || rawIf.includes("||")) {
    return runnerContexts;
  }
  const clauses = rawIf.split("&&");
  return runnerContexts.filter((context) =>
    clauses.every((clause) => {
      const verdict = evaluateStepIfClause(clause, context);
      return verdict === null ? true : verdict;
    }),
  );
}

function lookupVarEntries(varMap, name, caseInsensitive = false) {
  if (varMap.has(name)) {
    return varMap.get(name);
  }
  if (!caseInsensitive) {
    return null;
  }
  const lower = name.toLowerCase();
  for (const [key, entries] of varMap) {
    if (key.toLowerCase() === lower) {
      return entries;
    }
  }
  return null;
}

function setVarEntries(varMap, name, entries, { caseInsensitive = false, merge = false } = {}) {
  let targetKey = name;
  if (caseInsensitive && !varMap.has(name)) {
    const lower = name.toLowerCase();
    for (const key of varMap.keys()) {
      if (key.toLowerCase() === lower) {
        targetKey = key;
        break;
      }
    }
  }
  if (merge) {
    const existing = varMap.has(targetKey)
      ? varMap.get(targetKey)
      : [{ value: "", line: 0, unset: true }];
    varMap.set(targetKey, mergeVarEntries(existing, entries));
  } else {
    varMap.set(targetKey, entries);
  }
}

function extractDefaultShell(node) {
  const defaultsNode = getMapField(node, "defaults");
  const runDefaults = getMapField(defaultsNode, "run");
  const shellNode = getMapField(runDefaults, "shell");
  return shellNode?.kind === "scalar" ? String(shellNode.value).trim() : null;
}

function extractDefaultWorkingDirectory(node) {
  const defaultsNode = getMapField(node, "defaults");
  const runDefaults = getMapField(defaultsNode, "run");
  const workingDirNode = getMapField(runDefaults, "working-directory");
  return workingDirNode?.kind === "scalar" ? String(workingDirNode.value).trim() : null;
}

function formatPortableRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function cloneVarMap(varMap) {
  const copy = new Map();
  for (const [key, entries] of varMap) {
    copy.set(key, [...entries]);
  }
  return copy;
}

function mergeVarEntries(existing, incoming) {
  const merged = [];
  const seen = new Set();
  let truncatedLine = null;
  let hasUnset = false;
  for (const entry of [...existing, ...incoming]) {
    if (entry.truncated) {
      truncatedLine ??= entry.line;
      continue;
    }
    if (entry.unset) {
      hasUnset = true;
      continue;
    }
    const key = `${entry.line}:${entry.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (merged.length >= MAX_VAR_VALUES) {
      truncatedLine ??= entry.line;
      continue;
    }
    merged.push(entry);
  }
  if (hasUnset) {
    merged.push({ value: "", line: 0, unset: true });
  }
  if (truncatedLine !== null) {
    merged.push({ value: "", line: truncatedLine, truncated: true });
  }
  return merged;
}

function joinVarMaps(maps) {
  const joined = new Map();
  if (maps.length === 0) {
    return joined;
  }
  const allKeys = new Set();
  for (const map of maps) {
    for (const key of map.keys()) {
      allKeys.add(key);
    }
  }
  for (const key of allKeys) {
    let merged = [];
    let maybeUnset = false;
    for (const map of maps) {
      if (!map.has(key)) {
        maybeUnset = true;
      } else {
        merged = mergeVarEntries(merged, map.get(key));
      }
    }
    if (maybeUnset) {
      merged = mergeVarEntries(merged, [{ value: "", line: 0, unset: true }]);
    }
    joined.set(key, merged);
  }
  return joined;
}

function candidatesToVarEntries({ candidates, truncated }, assignLine) {
  const entries = candidates.map((entry) => ({ value: entry.text, line: assignLine }));
  if (truncated) {
    entries.push({ value: "", line: assignLine, truncated: true });
  }
  return entries;
}

function expandPatternCandidates(candidates, pattern, lookup, initialTruncated = false) {
  const globalFlags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  let results = candidates;
  let truncated = initialTruncated;

  for (let depth = 0; depth < 8; depth += 1) {
    let expandedAny = false;
    const nextResults = [];
    const seen = new Set();

    const pushFinal = (text, line) => {
      const key = `${line}:${text}`;
      if (seen.has(key)) {
        return;
      }
      if (nextResults.length >= MAX_TOKEN_EXPANSIONS) {
        truncated = true;
        return;
      }
      seen.add(key);
      nextResults.push({ text, line });
    };

    for (const candidate of results) {
      const matcher = new RegExp(pattern.source, globalFlags);
      let builders = [{ text: "", line: candidate.line }];
      let cursor = 0;
      let match;

      while ((match = matcher.exec(candidate.text)) !== null) {
        const literal = candidate.text.slice(cursor, match.index);
        cursor = match.index + match[0].length;
        const entries = lookup(match);

        if (!entries || entries.length === 0) {
          for (const builder of builders) {
            builder.text += literal + match[0];
          }
          continue;
        }

        expandedAny = true;
        const isWholeToken = match.index === 0 && match[0].length === candidate.text.length;
        const nextBuilders = [];
        const seenBuilder = new Set();
        for (const builder of builders) {
          for (const entry of entries) {
            if (entry.truncated) {
              truncated = true;
              continue;
            }
            if (entry.unset) {
              continue;
            }
            const nextText = `${builder.text}${literal}${entry.value}`;
            const nextLine = isWholeToken ? entry.line : builder.line;
            const bKey = `${nextLine}:${nextText}`;
            if (seenBuilder.has(bKey)) {
              continue;
            }
            if (nextBuilders.length >= MAX_TOKEN_EXPANSIONS) {
              truncated = true;
              continue;
            }
            seenBuilder.add(bKey);
            nextBuilders.push({ text: nextText, line: nextLine });
          }
        }
        builders = nextBuilders;
        if (builders.length === 0) {
          break;
        }
      }

      const tail = candidate.text.slice(cursor);
      for (const builder of builders) {
        pushFinal(`${builder.text}${tail}`, builder.line);
      }
    }

    results = nextResults;
    if (!expandedAny) {
      break;
    }
    if (depth === 7) {
      for (const candidate of results) {
        const checkMatcher = new RegExp(pattern.source, globalFlags);
        let remaining;
        while ((remaining = checkMatcher.exec(candidate.text)) !== null) {
          const entries = lookup(remaining);
          if (entries && entries.length > 0) {
            truncated = true;
            break;
          }
        }
        if (truncated) {
          break;
        }
      }
    }
  }

  return { candidates: results, truncated };
}

function resolveEnvExpressionCandidates(text, stepEnv, fallbackLine) {
  return expandPatternCandidates(
    [{ text, line: fallbackLine }],
    new RegExp(ENV_EXPRESSION_PATTERN.source, "iu"),
    (match) => {
      const name = match.groups.dot ?? match.groups.sq ?? match.groups.dq;
      return lookupVarEntries(stepEnv, name, true);
    },
  );
}

function findNextShellParamExpansion(text, startIndex = 0) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] !== "$") {
      continue;
    }
    if (text[index + 1] === "{" && text[index + 2] !== "{") {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === "{") {
          depth += 1;
        } else if (text[cursor] === "}") {
          depth -= 1;
        }
        cursor += 1;
      }
      if (depth === 0) {
        const inner = text.slice(index + 2, cursor - 1);
        const exprMatch =
          /^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:(?<op>:-|:=|:\+|-|=|\+)(?<word>.*))?$/su.exec(inner);
        if (exprMatch) {
          return {
            start: index,
            end: cursor,
            name: exprMatch.groups.name,
            op: exprMatch.groups.op ?? null,
            word: exprMatch.groups.word ?? "",
          };
        }
      }
      continue;
    }
    const bareMatch = /^(?<bare>[A-Za-z_][A-Za-z0-9_]*)/u.exec(text.slice(index + 1));
    if (bareMatch) {
      const name = bareMatch.groups.bare;
      return {
        start: index,
        end: index + 1 + name.length,
        name,
        op: null,
        word: "",
      };
    }
  }
  return null;
}

function expandShellParamCandidates(candidates, shellVars, caseInsensitive, initialTruncated) {
  let results = candidates;
  let truncated = initialTruncated;

  for (let depth = 0; depth < 8; depth += 1) {
    let expandedAny = false;
    const nextResults = [];
    const seen = new Set();

    const pushCandidate = (text, line) => {
      const key = `${line}:${text}`;
      if (seen.has(key)) {
        return;
      }
      if (nextResults.length >= MAX_TOKEN_EXPANSIONS) {
        truncated = true;
        return;
      }
      seen.add(key);
      nextResults.push({ text, line });
    };

    for (const candidate of results) {
      let builders = [{ text: "", line: candidate.line }];
      let cursor = 0;
      let expr;

      while ((expr = findNextShellParamExpansion(candidate.text, cursor)) !== null) {
        const literal = candidate.text.slice(cursor, expr.start);
        const rawMatch = candidate.text.slice(expr.start, expr.end);
        cursor = expr.end;
        const entries = lookupVarEntries(shellVars, expr.name, caseInsensitive);
        const isWholeToken = expr.start === 0 && expr.end === candidate.text.length;

        const appendToBuilders = (alternatives) => {
          const nextBuilders = [];
          const seenBuilder = new Set();
          for (const builder of builders) {
            for (const alt of alternatives) {
              const nextText = `${builder.text}${literal}${alt.text}`;
              const nextLine = alt.line ?? builder.line;
              const bKey = `${nextLine}:${nextText}`;
              if (seenBuilder.has(bKey)) {
                continue;
              }
              if (nextBuilders.length >= MAX_TOKEN_EXPANSIONS) {
                truncated = true;
                continue;
              }
              seenBuilder.add(bKey);
              nextBuilders.push({ text: nextText, line: nextLine });
            }
          }
          builders = nextBuilders;
        };

        if (!expr.op) {
          if (!entries || entries.length === 0) {
            appendToBuilders([{ text: rawMatch, line: null }]);
            continue;
          }
          expandedAny = true;
          const alts = [];
          for (const entry of entries) {
            if (entry.truncated) {
              truncated = true;
              continue;
            }
            if (entry.unset) {
              alts.push({ text: "", line: null });
              continue;
            }
            alts.push({
              text: entry.value,
              line: isWholeToken ? entry.line : null,
            });
          }
          appendToBuilders(alts);
          if (builders.length === 0) {
            break;
          }
          continue;
        }

        // Parameter expansion with default/alternate operator (`:-`, `-`, `:=`, `=`, `:+`, `+`).
        expandedAny = true;
        const isDefaultOp =
          expr.op === ":-" || expr.op === "-" || expr.op === ":=" || expr.op === "=";
        const checksEmpty = expr.op.startsWith(":");
        const alts = [];

        if (isDefaultOp) {
          if (!entries || entries.length === 0) {
            alts.push({ text: expr.word, line: null });
          } else {
            let needsFallback = false;
            for (const entry of entries) {
              if (entry.truncated) {
                truncated = true;
                continue;
              }
              if (entry.unset) {
                needsFallback = true;
                continue;
              }
              if (isDynamicReference(entry.value)) {
                needsFallback = true;
                alts.push({ text: entry.value, line: isWholeToken ? entry.line : null });
              } else if (checksEmpty && entry.value.length === 0) {
                needsFallback = true;
              } else {
                alts.push({ text: entry.value, line: isWholeToken ? entry.line : null });
              }
            }
            if (needsFallback) {
              alts.push({ text: expr.word, line: null });
            }
          }
        } else if (!entries || entries.length === 0) {
          // Alternate value (`:+` / `+`): use `word` when set (and non-empty for `:+`).
          alts.push({ text: "", line: null });
        } else {
          let sawSet = false;
          let sawUnsetOrEmpty = false;
          for (const entry of entries) {
            if (entry.truncated) {
              truncated = true;
              continue;
            }
            if (entry.unset) {
              sawUnsetOrEmpty = true;
              continue;
            }
            if (isDynamicReference(entry.value)) {
              sawSet = true;
              sawUnsetOrEmpty = true;
            } else if (checksEmpty && entry.value.length === 0) {
              sawUnsetOrEmpty = true;
            } else {
              sawSet = true;
            }
          }
          if (sawSet) {
            alts.push({ text: expr.word, line: null });
          }
          if (sawUnsetOrEmpty) {
            alts.push({ text: "", line: null });
          }
        }
        appendToBuilders(alts);
        if (builders.length === 0) {
          break;
        }
      }

      const tail = candidate.text.slice(cursor);
      for (const builder of builders) {
        pushCandidate(`${builder.text}${tail}`, builder.line);
      }
    }

    results = nextResults;
    if (!expandedAny) {
      break;
    }
    if (depth === 7) {
      for (const candidate of results) {
        let scanCursor = 0;
        let remaining;
        while ((remaining = findNextShellParamExpansion(candidate.text, scanCursor)) !== null) {
          scanCursor = remaining.end;
          const entries = lookupVarEntries(shellVars, remaining.name, caseInsensitive);
          if (remaining.op || (entries && entries.length > 0)) {
            truncated = true;
            break;
          }
        }
        if (truncated) {
          break;
        }
      }
    }
  }

  return { candidates: results, truncated };
}

// GitHub Actions evaluates `${{ env.* }}` against the immutable step `env`
// before the shell runs, whereas `$VAR`/`${VAR}` (including `${VAR:-default}`),
// PowerShell `$env:VAR` vs local `$var`, and cmd `%VAR%` reflect reachable
// shell assignments in their respective namespaces.
function resolveImageTokenCandidates(token, stepEnv, shellVars, fallbackLine, shellMode = "posix") {
  let current = resolveEnvExpressionCandidates(token, stepEnv, fallbackLine);
  if (shellMode === "cmd") {
    return expandPatternCandidates(
      current.candidates,
      new RegExp(CMD_VAR_PATTERN.source, "u"),
      (match) => lookupVarEntries(shellVars, match.groups.name, true),
      current.truncated,
    );
  }
  if (shellMode === "pwsh") {
    current = expandPatternCandidates(
      current.candidates,
      new RegExp(PWSH_ENV_VAR_PATTERN.source, "iu"),
      (match) => {
        const name = match.groups.braced ?? match.groups.bare;
        return lookupVarEntries(shellVars, `env:${name}`, true);
      },
      current.truncated,
    );
    return expandPatternCandidates(
      current.candidates,
      new RegExp(EMBEDDED_VAR_PATTERN.source, "u"),
      (match) => {
        const name = match.groups.braced ?? match.groups.bare;
        return lookupVarEntries(shellVars, name, true);
      },
      current.truncated,
    );
  }
  return expandShellParamCandidates(current.candidates, shellVars, false, current.truncated);
}

function hasUnquotedComment(line) {
  let quote = null;
  let escaping = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote === '"') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && line[index + 1] === "'") {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (index === 0 || /\s/u.test(line[index - 1]))) {
      return true;
    }
  }
  return false;
}

// --- YAML AST parsing via `yaml` with memoized, bounded alias resolution -----

function dedentYamlSnippet(source) {
  const rawLines = source.split(/\r?\n/u);
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    minIndent = Math.min(minIndent, indent);
    if (minIndent === 0) {
      return source;
    }
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return source;
  }
  return rawLines
    .map((line) => (line.length >= minIndent ? line.slice(minIndent) : line.trimStart()))
    .join("\n");
}

function isMergeKey(keyNode) {
  if (!isScalar(keyNode)) {
    return false;
  }
  return (
    keyNode.value === "<<" ||
    (typeof keyNode.value === "symbol" && keyNode.value.description === "<<")
  );
}

function nodeStartLine(node, lineCounter) {
  if (Array.isArray(node?.range) && typeof node.range[0] === "number") {
    return lineCounter.linePos(node.range[0]).line;
  }
  return 1;
}

function convertYamlNode(node, doc, lineCounter, rawLines, state) {
  if (!node || state.budgetExceeded) {
    return null;
  }
  state.steps += 1;
  if (state.steps > MAX_YAML_CONVERSION_STEPS) {
    state.budgetExceeded = true;
    state.budgetLine = nodeStartLine(node, lineCounter);
    return null;
  }
  if (isAlias(node)) {
    const target = node.resolve(doc);
    if (!target || state.visiting.has(target)) {
      return null;
    }
    if (state.memo.has(target)) {
      return state.memo.get(target);
    }
    return convertYamlNode(target, doc, lineCounter, rawLines, state);
  }
  if (state.memo.has(node)) {
    return state.memo.get(node);
  }

  state.visiting.add(node);
  let converted = null;

  if (isMap(node)) {
    const map = new Map();
    const deferredMerges = [];
    for (const pair of node.items) {
      if (state.budgetExceeded) {
        break;
      }
      if (isMergeKey(pair.key)) {
        const mergedVal = convertYamlNode(pair.value, doc, lineCounter, rawLines, state);
        if (mergedVal?.kind === "map") {
          deferredMerges.push(mergedVal);
        } else if (mergedVal?.kind === "seq") {
          for (const entry of mergedVal.value) {
            if (entry?.kind === "map") {
              deferredMerges.push(entry);
            }
          }
        }
        continue;
      }
      if (!isScalar(pair.key)) {
        continue;
      }
      const key = String(pair.key.value);
      const val = convertYamlNode(pair.value, doc, lineCounter, rawLines, state);
      map.set(
        key,
        val ?? { kind: "scalar", value: "", line: nodeStartLine(pair.key, lineCounter) },
      );
    }
    for (const sourceMap of deferredMerges) {
      for (const [key, val] of sourceMap.value) {
        if (!map.has(key)) {
          map.set(key, val);
        }
      }
    }
    converted = { kind: "map", value: map, line: nodeStartLine(node, lineCounter) };
  } else if (isSeq(node)) {
    const items = [];
    for (const item of node.items) {
      if (state.budgetExceeded) {
        break;
      }
      const itemNode = convertYamlNode(item, doc, lineCounter, rawLines, state);
      if (itemNode) {
        items.push(itemNode);
      }
    }
    converted = { kind: "seq", value: items, line: nodeStartLine(node, lineCounter) };
  } else if (isScalar(node)) {
    const startLine = nodeStartLine(node, lineCounter);
    const value = node.value === null || node.value === undefined ? "" : String(node.value);
    const scalar = {
      kind: "scalar",
      value,
      line: startLine,
      comment: node.comment ?? null,
    };

    if (
      (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") &&
      Array.isArray(node.range)
    ) {
      const startPos = lineCounter.linePos(node.range[0]);
      const endOffset = Math.max(node.range[0], node.range[1] - 1);
      const endPos = lineCounter.linePos(endOffset);
      const bodyRaw = [];
      let contentIndent = Number.POSITIVE_INFINITY;
      for (let lineNo = startPos.line + 1; lineNo <= endPos.line; lineNo += 1) {
        const raw = rawLines[lineNo - 1] ?? "";
        if (raw.trim().length > 0) {
          contentIndent = Math.min(contentIndent, raw.length - raw.trimStart().length);
        }
        bodyRaw.push({ raw, lineNumber: lineNo });
      }
      const stripIndent = Number.isFinite(contentIndent) ? contentIndent : 0;
      const bodyLines = bodyRaw.map(({ raw, lineNumber }) => ({
        text: raw.length >= stripIndent ? raw.slice(stripIndent) : raw.trimStart(),
        lineNumber,
      }));
      while (bodyLines.length > 0 && bodyLines.at(-1).text.trim() === "") {
        bodyLines.pop();
      }
      scalar.lines = bodyLines;
      scalar.folded = node.type === "BLOCK_FOLDED";
      if (bodyLines.length > 0) {
        scalar.line = bodyLines[0].lineNumber;
      }
    }

    converted = scalar;
  }

  state.visiting.delete(node);
  if (converted) {
    state.memo.set(node, converted);
  }
  return converted;
}

function parseWorkflowYaml(source) {
  const normalized = dedentYamlSnippet(source);
  const rawLines = normalized.split(/\r?\n/u);
  const lineCounter = new LineCounter();
  const doc = parseDocument(normalized, { lineCounter, merge: true });
  const state = {
    steps: 0,
    budgetExceeded: false,
    budgetLine: 1,
    visiting: new Set(),
    memo: new Map(),
  };
  const ast = convertYamlNode(doc.contents, doc, lineCounter, rawLines, state);

  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    const line = first.linePos?.[0]?.line ?? 1;
    return {
      doc: ast,
      error: { line, message: `failed to parse workflow YAML: ${first.message.split("\n")[0]}` },
    };
  }

  if (state.budgetExceeded) {
    return {
      doc: null,
      error: {
        line: state.budgetLine,
        message: "YAML alias expansion exceeded safety budget; refusing to skip pin checks",
      },
    };
  }

  return { doc: ast, error: null };
}

// --- Whole-script shell lexer (multiline quotes, heredocs, subshells) --------

function isShellInterpreterCommand(tokens) {
  let cursor = 0;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (SHELL_COMMAND_PREFIXES.has(token) || ENV_PREFIX_ASSIGNMENT_PATTERN.test(token)) {
      cursor += 1;
      continue;
    }
    break;
  }
  const cmd = tokens[cursor];
  if (!cmd) {
    return false;
  }
  return SHELL_INTERPRETERS.has(path.basename(cmd));
}

const MAX_SHELL_NESTING_DEPTH = 8;
const COMMAND_SUBSTITUTION_PLACEHOLDER = "${__CMD_SUB__}";

function scanDollarCommandSubstitution(text, startIndex, startLine) {
  let depth = 1;
  let cursor = startIndex + 2;
  let innerQuote = null;
  let innerEscape = false;
  let line = startLine;

  while (cursor < text.length && depth > 0) {
    const ich = text[cursor];
    if (ich === "\n") {
      line += 1;
    }
    if (innerEscape) {
      innerEscape = false;
      cursor += 1;
      continue;
    }
    if (ich === "\\" && innerQuote !== "'") {
      innerEscape = true;
      cursor += 1;
      continue;
    }
    if (innerQuote) {
      if (ich === innerQuote) {
        innerQuote = null;
      }
      cursor += 1;
      continue;
    }
    if (ich === "'" || ich === '"') {
      innerQuote = ich;
      cursor += 1;
      continue;
    }
    if (ich === "(") {
      depth += 1;
    } else if (ich === ")") {
      depth -= 1;
    }
    cursor += 1;
  }

  if (depth !== 0) {
    return null;
  }

  return {
    innerText: text.slice(startIndex + 2, cursor - 1),
    endIndex: cursor - 1,
    endLine: line,
  };
}

function scanBacktickSubstitution(text, startIndex, startLine, inDoubleQuotes) {
  let cursor = startIndex + 1;
  let btEscape = false;
  let line = startLine;

  while (cursor < text.length) {
    const bch = text[cursor];
    if (bch === "\n") {
      line += 1;
    }
    if (btEscape) {
      btEscape = false;
      cursor += 1;
      continue;
    }
    if (bch === "\\") {
      btEscape = true;
      cursor += 1;
      continue;
    }
    if (bch === "`") {
      const raw = text.slice(startIndex + 1, cursor);
      const innerText = inDoubleQuotes
        ? raw.replace(/\\([$`\\"])/gu, "$1")
        : raw.replace(/\\([$`\\])/gu, "$1");
      return {
        innerText,
        endIndex: cursor,
        endLine: line,
      };
    }
    cursor += 1;
  }

  return null;
}

// Unquoted data heredocs (`cat <<EOF`) still expand `$(...)` and `` `...` ``
// (treating `'` and `"` as literal characters, not shell quotes).
function extractUnquotedHeredocSubstitutions(bodyText, startLine) {
  const substitutions = [];
  let escaping = false;
  let line = startLine;

  for (let index = 0; index < bodyText.length; index += 1) {
    const ch = bodyText[index];
    if (ch === "\n") {
      line += 1;
      escaping = false;
      continue;
    }
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (ch === "$" && bodyText[index + 1] === "(" && bodyText[index + 2] !== "(") {
      const subStartLine = line;
      const scanned = scanDollarCommandSubstitution(bodyText, index, line);
      if (scanned) {
        substitutions.push({ text: scanned.innerText, lineNumber: subStartLine });
        index = scanned.endIndex;
        line = scanned.endLine;
      }
      continue;
    }
    if (ch === "`") {
      const subStartLine = line;
      const scanned = scanBacktickSubstitution(bodyText, index, line, false);
      if (scanned) {
        substitutions.push({ text: scanned.innerText, lineNumber: subStartLine });
        index = scanned.endIndex;
        line = scanned.endLine;
      }
    }
  }

  return substitutions;
}

function isGithubEnvTarget(token) {
  return (
    token === "$GITHUB_ENV" ||
    token === "${GITHUB_ENV}" ||
    /^\$(?:env:GITHUB_ENV|\{env:GITHUB_ENV\})$/iu.test(token ?? "") ||
    /^%GITHUB_ENV%$/iu.test(token ?? "")
  );
}

function isRedirectionOperator(token) {
  return (
    token === ">" ||
    token === ">>" ||
    token === ">&" ||
    token === "<" ||
    token === "<>" ||
    token === "<&"
  );
}

function consumeShellRedirection(tokens, index, stdinRedirectTargets = null) {
  const token = tokens[index];
  if (isRedirectionOperator(token)) {
    if (token === "<" && stdinRedirectTargets && tokens[index + 1] !== undefined) {
      stdinRedirectTargets.push(tokens[index + 1]);
    }
    return 2;
  }
  if (/^\d+$/u.test(token ?? "") && isRedirectionOperator(tokens[index + 1])) {
    if (
      token === "0" &&
      tokens[index + 1] === "<" &&
      stdinRedirectTargets &&
      tokens[index + 2] !== undefined
    ) {
      stdinRedirectTargets.push(tokens[index + 2]);
    }
    return 3;
  }
  return 0;
}

function resolveContainerBuildCommand(
  tokens,
  normalizedCli,
  argIndex,
  stdinRedirectTargets = null,
) {
  const subcommand = tokens[argIndex];
  if (normalizedCli === "buildah") {
    if (subcommand === "bud" || subcommand === "build") {
      return { kind: "build", argStart: argIndex + 1 };
    }
    return null;
  }

  if (subcommand === "bake") {
    return { kind: "bake", argStart: argIndex + 1 };
  }
  if (subcommand === "build") {
    return { kind: "build", argStart: argIndex + 1 };
  }
  if (subcommand === "image" || subcommand === "builder") {
    let nestedSubIndex = argIndex + 1;
    while (nestedSubIndex < tokens.length) {
      const redirConsumed = consumeShellRedirection(tokens, nestedSubIndex, stdinRedirectTargets);
      if (redirConsumed > 0) {
        nestedSubIndex += redirConsumed;
        continue;
      }
      break;
    }
    if (tokens[nestedSubIndex] === "build") {
      return { kind: "build", argStart: nestedSubIndex + 1 };
    }
    return null;
  }
  if (subcommand === "buildx") {
    let buildxIndex = argIndex + 1;
    while (buildxIndex < tokens.length) {
      const redirConsumed = consumeShellRedirection(tokens, buildxIndex, stdinRedirectTargets);
      if (redirConsumed > 0) {
        buildxIndex += redirConsumed;
        continue;
      }
      const flag = tokens[buildxIndex];
      if (!flag.startsWith("-") || flag === "--") {
        break;
      }
      buildxIndex += flagConsumesNextArg(flag, DOCKER_BUILDX_GLOBAL_VALUE_FLAGS) ? 2 : 1;
    }
    const buildxSubcommand = tokens[buildxIndex];
    if (buildxSubcommand === "bake") {
      return { kind: "bake", argStart: buildxIndex + 1 };
    }
    if (buildxSubcommand === "build") {
      return { kind: "build", argStart: buildxIndex + 1 };
    }
    if (buildxSubcommand === "create") {
      return { kind: "buildx-create", argStart: buildxIndex + 1 };
    }
  }
  return null;
}

function parseShortBuildFlagBundle(token, nextToken) {
  if (!token.startsWith("-") || token.startsWith("--") || token.length <= 2) {
    return null;
  }
  for (let index = 1; index < token.length; index += 1) {
    const ch = token[index];
    if (ch === "f") {
      if (index === token.length - 1) {
        return { file: nextToken ?? null, consumedNext: true };
      }
      if (token[index + 1] === "=") {
        return { file: token.slice(index + 2), consumedNext: false };
      }
      return { file: token.slice(index + 1), consumedNext: false };
    }
    if (DOCKER_BUILD_VALUE_FLAGS.has(`-${ch}`)) {
      return { file: null, consumedNext: index === token.length - 1 };
    }
  }
  return { file: null, consumedNext: false };
}

function isArchiveOrBinaryFile(filePath) {
  if (/\.(?:tar(?:\.(?:gz|bz2|xz|zst))?|tgz|tbz2|txz|tzst)$/iu.test(filePath)) {
    return true;
  }
  let fd;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(512);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return true;
    }
    if (bytesRead >= 3 && buffer[0] === 0x42 && buffer[1] === 0x5a && buffer[2] === 0x68) {
      return true;
    }
    if (
      bytesRead >= 6 &&
      buffer[0] === 0xfd &&
      buffer[1] === 0x37 &&
      buffer[2] === 0x7a &&
      buffer[3] === 0x58 &&
      buffer[4] === 0x5a &&
      buffer[5] === 0x00
    ) {
      return true;
    }
    if (
      bytesRead >= 4 &&
      buffer[0] === 0x28 &&
      buffer[1] === 0xb5 &&
      buffer[2] === 0x2f &&
      buffer[3] === 0xfd
    ) {
      return true;
    }
    if (bytesRead >= 262 && buffer.subarray(257, 262).toString("ascii") === "ustar") {
      return true;
    }
    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0x00) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

const SUDO_VALUE_FLAGS = new Set([
  "-C",
  "--close-from",
  "-D",
  "--chdir",
  "-g",
  "--group",
  "-h",
  "--host",
  "-p",
  "--prompt",
  "-R",
  "--chroot",
  "-r",
  "--role",
  "-T",
  "--command-timeout",
  "-t",
  "--type",
  "-U",
  "--other-user",
  "-u",
  "--user",
]);
const ENV_VALUE_FLAGS = new Set([
  "-C",
  "--chdir",
  "-S",
  "--split-string",
  "-u",
  "--unset",
  "--block-signal",
  "--default-signal",
  "--ignore-signal",
]);
const EXEC_VALUE_FLAGS = new Set(["-a"]);
const TIMEOUT_VALUE_FLAGS = new Set(["-k", "--kill-after", "-s", "--signal"]);

function isRemoteBuildContext(ctxText) {
  return (
    /^(?:https?|git|ssh|docker-image|container-image):\/\//iu.test(ctxText) ||
    /^(?:git@|github\.com\/|target:|\{\{defaultContext\}\}#)/iu.test(ctxText)
  );
}

function extractDriverOptImages(rawText) {
  const parts = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < rawText.length; index += 1) {
    const ch = rawText[index];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  const images = [];
  for (const rawPart of parts) {
    const part = stripQuotes(rawPart.trim());
    const match = /^image=(?<image>.*)$/iu.exec(part);
    if (match) {
      images.push(stripQuotes(match.groups.image));
    }
  }
  return images;
}

function advanceWrapperPrefix(
  tokens,
  cursor,
  stdinRedirectTargets = null,
  wrapperChdirs = null,
  wrapperEnvChanges = null,
) {
  const token = tokens[cursor];
  if (!SHELL_COMMAND_PREFIXES.has(token)) {
    return null;
  }
  const normalized = token.toLowerCase();
  let next = cursor + 1;

  if (normalized === "command") {
    let inspectIndex = next;
    while (inspectIndex < tokens.length) {
      const redirConsumed = consumeShellRedirection(tokens, inspectIndex, stdinRedirectTargets);
      if (redirConsumed > 0) {
        inspectIndex += redirConsumed;
        continue;
      }
      const flag = tokens[inspectIndex];
      if (flag === "--") {
        inspectIndex += 1;
        break;
      }
      if (!flag.startsWith("-") || flag === "-") {
        break;
      }
      // `command -v` / `command -V` only prints command resolution and does not execute it.
      if (!flag.startsWith("--") && (flag.includes("v") || flag.includes("V"))) {
        return null;
      }
      inspectIndex += 1;
    }
    return inspectIndex;
  }

  if (normalized === "timeout") {
    while (next < tokens.length) {
      const redirConsumed = consumeShellRedirection(tokens, next, stdinRedirectTargets);
      if (redirConsumed > 0) {
        next += redirConsumed;
        continue;
      }
      const flag = tokens[next];
      if (flag === "--") {
        next += 1;
        break;
      }
      if (!flag.startsWith("-") || flag === "-") {
        break;
      }
      next += flagConsumesNextArg(flag, TIMEOUT_VALUE_FLAGS) ? 2 : 1;
    }
    // Skip the mandatory DURATION operand (e.g. `30s`, `5m`, `10`).
    if (next < tokens.length) {
      next += 1;
    }
    return next;
  }

  let valueFlags = null;
  let chdirShortFlag = null;
  if (normalized === "sudo") {
    valueFlags = SUDO_VALUE_FLAGS;
    chdirShortFlag = "D";
  } else if (normalized === "env") {
    valueFlags = ENV_VALUE_FLAGS;
    chdirShortFlag = "C";
  } else if (normalized === "exec") {
    valueFlags = EXEC_VALUE_FLAGS;
  } else if (normalized === "time") {
    valueFlags = new Set();
  }

  if (valueFlags !== null) {
    while (next < tokens.length) {
      const redirConsumed = consumeShellRedirection(tokens, next, stdinRedirectTargets);
      if (redirConsumed > 0) {
        next += redirConsumed;
        continue;
      }
      const flag = tokens[next];
      if (flag === "--") {
        next += 1;
        break;
      }
      if (normalized === "env" && flag === "-") {
        if (wrapperEnvChanges) {
          wrapperEnvChanges.clear = true;
        }
        next += 1;
        continue;
      }
      if (!flag.startsWith("-") || flag === "-") {
        break;
      }
      if (normalized === "env" && wrapperEnvChanges) {
        if (flag === "-i" || flag === "--ignore-environment") {
          wrapperEnvChanges.clear = true;
          next += 1;
          continue;
        }
        if (flag === "-u" || flag === "--unset") {
          if (tokens[next + 1] !== undefined) {
            wrapperEnvChanges.unset.add(tokens[next + 1]);
          }
          next += 2;
          continue;
        }
        if (flag.startsWith("--unset=")) {
          wrapperEnvChanges.unset.add(flag.slice("--unset=".length));
          next += 1;
          continue;
        }
      }
      if (chdirShortFlag && (wrapperChdirs || (normalized === "env" && wrapperEnvChanges))) {
        if (flag === `-${chdirShortFlag}` || flag === "--chdir") {
          if (wrapperChdirs && tokens[next + 1] !== undefined) {
            wrapperChdirs.push(tokens[next + 1]);
          }
          next += 2;
          continue;
        }
        if (flag.startsWith("--chdir=")) {
          if (wrapperChdirs) {
            wrapperChdirs.push(flag.slice("--chdir=".length));
          }
          next += 1;
          continue;
        }
        if (flag.startsWith(`-${chdirShortFlag}=`)) {
          if (wrapperChdirs) {
            wrapperChdirs.push(flag.slice(3));
          }
          next += 1;
          continue;
        }
        if (!flag.startsWith("--") && flag.length > 2) {
          let consumedNext = false;
          for (let idx = 1; idx < flag.length; idx += 1) {
            const ch = flag[idx];
            if (normalized === "env" && wrapperEnvChanges && ch === "i") {
              wrapperEnvChanges.clear = true;
              continue;
            }
            if (normalized === "env" && wrapperEnvChanges && ch === "u") {
              if (idx === flag.length - 1) {
                if (tokens[next + 1] !== undefined) {
                  wrapperEnvChanges.unset.add(tokens[next + 1]);
                }
                consumedNext = true;
              } else {
                const rest = flag.slice(idx + 1);
                wrapperEnvChanges.unset.add(rest.startsWith("=") ? rest.slice(1) : rest);
              }
              break;
            }
            if (ch === chdirShortFlag) {
              if (idx === flag.length - 1) {
                if (wrapperChdirs && tokens[next + 1] !== undefined) {
                  wrapperChdirs.push(tokens[next + 1]);
                }
                consumedNext = true;
              } else if (wrapperChdirs) {
                const rest = flag.slice(idx + 1);
                wrapperChdirs.push(rest.startsWith("=") ? rest.slice(1) : rest);
              }
              break;
            }
            if (valueFlags.has(`-${ch}`)) {
              consumedNext = idx === flag.length - 1;
              break;
            }
          }
          next += consumedNext ? 2 : 1;
          continue;
        }
      }
      next += flagConsumesNextArg(flag, valueFlags) ? 2 : 1;
    }
  }

  return next;
}

function isStdinContainerBuildCommand(tokens) {
  let cursor = 0;
  while (cursor < tokens.length) {
    const redirConsumed = consumeShellRedirection(tokens, cursor);
    if (redirConsumed > 0) {
      cursor += redirConsumed;
      continue;
    }
    const afterWrapper = advanceWrapperPrefix(tokens, cursor);
    if (afterWrapper !== null) {
      cursor = afterWrapper;
      continue;
    }
    if (ENV_PREFIX_ASSIGNMENT_PATTERN.test(tokens[cursor])) {
      cursor += 1;
      continue;
    }
    break;
  }
  const normalizedCli = normalizeExecutableName(tokens[cursor]);
  if (normalizedCli !== "docker" && normalizedCli !== "podman" && normalizedCli !== "buildah") {
    return false;
  }
  const globalValueFlags =
    normalizedCli === "buildah"
      ? BUILDAH_GLOBAL_VALUE_FLAGS
      : normalizedCli === "podman"
        ? PODMAN_GLOBAL_VALUE_FLAGS
        : DOCKER_GLOBAL_VALUE_FLAGS;
  let argIndex = cursor + 1;
  while (argIndex < tokens.length) {
    const redirConsumed = consumeShellRedirection(tokens, argIndex);
    if (redirConsumed > 0) {
      argIndex += redirConsumed;
      continue;
    }
    const flag = tokens[argIndex];
    if (!flag.startsWith("-")) {
      break;
    }
    argIndex += flagConsumesNextArg(flag, globalValueFlags) ? 2 : 1;
  }
  const buildCommand = resolveContainerBuildCommand(tokens, normalizedCli, argIndex);
  if (buildCommand?.kind !== "build") {
    return false;
  }
  const buildValueFlags =
    normalizedCli === "podman" || normalizedCli === "buildah"
      ? PODMAN_BUILD_VALUE_FLAGS
      : DOCKER_BUILD_VALUE_FLAGS;
  let hasStdinFile = false;
  let hasExplicitFile = false;
  let contextArg = null;
  for (let index = buildCommand.argStart; index < tokens.length; index += 1) {
    const redirConsumed = consumeShellRedirection(tokens, index);
    if (redirConsumed > 0) {
      index += redirConsumed - 1;
      continue;
    }
    const token = tokens[index];
    if (token === "--") {
      for (let restIndex = index + 1; restIndex < tokens.length; restIndex += 1) {
        const restRedir = consumeShellRedirection(tokens, restIndex);
        if (restRedir > 0) {
          restIndex += restRedir - 1;
          continue;
        }
        contextArg = tokens[restIndex] ?? contextArg;
        break;
      }
      break;
    }
    if (token === "-f" || token === "--file") {
      if (tokens[index + 1] === "-") {
        hasStdinFile = true;
      } else if (tokens[index + 1]) {
        hasExplicitFile = true;
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--file=")) {
      const value = token.slice("--file=".length);
      if (value === "-") {
        hasStdinFile = true;
      } else if (value) {
        hasExplicitFile = true;
      }
      continue;
    }
    const shortBundle = parseShortBuildFlagBundle(token, tokens[index + 1]);
    if (shortBundle) {
      if (shortBundle.file === "-") {
        hasStdinFile = true;
      } else if (shortBundle.file) {
        hasExplicitFile = true;
      }
      if (shortBundle.consumedNext) {
        index += 1;
      }
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      if (flagConsumesNextArg(token, buildValueFlags)) {
        index += 1;
      }
      continue;
    }
    if (contextArg === null) {
      contextArg = token;
    }
  }
  return hasStdinFile || (!hasExplicitFile && contextArg === "-");
}

function redirectsToGithubEnv(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    if ((tokens[index] === ">" || tokens[index] === ">>") && isGithubEnvTarget(tokens[index + 1])) {
      return true;
    }
  }
  const commandIndex = tokens.findIndex(
    (token) => !SHELL_COMMAND_PREFIXES.has(token) && !ENV_PREFIX_ASSIGNMENT_PATTERN.test(token),
  );
  if (commandIndex !== -1 && path.basename(tokens[commandIndex]) === "tee") {
    return tokens.slice(commandIndex + 1).some((token) => isGithubEnvTarget(token));
  }
  return false;
}

// Lex an entire shell script preserving quotes across physical newlines,
// preserving empty quoted arguments (`''` / `""`), honoring shell-specific line
// continuations (`\` in POSIX, `` ` `` in PowerShell, `^` in cmd), tracking
// heredocs (while ignoring `<<<` here-strings and arithmetic `<<`), attaching
// unquoted and double-quoted command substitutions to their owning command, and
// emitting explicit subshell and conditional/case markers.
function lexShellScript(text, startLine, shellMode = "posix") {
  const events = [];
  let tokens = [];
  let tokenSingleQuoted = [];
  let tokenQuoted = [];
  let tokenEscapedDollarOffsets = [];
  let commandSubstitutions = [];
  let commandLine = startLine;
  let commandConditional = false;
  let commandHasStdinHeredoc = false;
  let nextConditional = false;
  let current = "";
  let currentEscapedDollarOffsets = [];
  let tokenStarted = false;
  let currentHasUnquotedOrDoubleQuoted = false;
  let currentSawSingleQuote = false;
  let currentSawAnyQuote = false;
  let quote = null;
  let escaping = false;
  let arithDepth = 0;
  let arrayParenDepth = 0;
  let arrayQuote = null;
  let arrayEscaping = false;
  let line = startLine;
  const pendingHeredocs = [];
  const isPwsh = shellMode === "pwsh";
  const isCmd = shellMode === "cmd";

  const markTokenStart = ({ singleQuoted = false, quoted = false } = {}) => {
    if (!tokenStarted && tokens.length === 0) {
      commandLine = line;
      commandConditional = nextConditional;
      nextConditional = false;
    }
    tokenStarted = true;
    if (quoted) {
      currentSawAnyQuote = true;
    }
    if (singleQuoted) {
      currentSawSingleQuote = true;
    } else {
      currentHasUnquotedOrDoubleQuoted = true;
    }
  };

  const flushToken = () => {
    if (tokenStarted) {
      if (tokens.length === 0) {
        commandLine = line;
      }
      tokens.push(current);
      tokenSingleQuoted.push(currentSawSingleQuote && !currentHasUnquotedOrDoubleQuoted);
      tokenQuoted.push(currentSawAnyQuote);
      tokenEscapedDollarOffsets.push(currentEscapedDollarOffsets);
      current = "";
      currentEscapedDollarOffsets = [];
      tokenStarted = false;
      currentHasUnquotedOrDoubleQuoted = false;
      currentSawSingleQuote = false;
      currentSawAnyQuote = false;
    }
  };

  const flushCommand = () => {
    flushToken();
    if (tokens.length > 0 || commandSubstitutions.length > 0) {
      events.push({
        kind: "command",
        tokens,
        tokenSingleQuoted,
        tokenQuoted,
        tokenEscapedDollarOffsets,
        lineNumber: commandLine,
        conditional: commandConditional,
        hasStdinHeredoc: commandHasStdinHeredoc,
        substitutions: commandSubstitutions,
      });
      tokens = [];
      tokenSingleQuoted = [];
      tokenQuoted = [];
      tokenEscapedDollarOffsets = [];
      commandSubstitutions = [];
      commandConditional = false;
      commandHasStdinHeredoc = false;
    }
  };

  const consumeHeredocBodies = (startIndex) => {
    let cursor = startIndex;
    while (pendingHeredocs.length > 0 && cursor < text.length) {
      const spec = pendingHeredocs.shift();
      const bodyStartLine = line;
      const bodyLines = [];
      while (cursor < text.length) {
        const nl = text.indexOf("\n", cursor);
        const rawLine = nl === -1 ? text.slice(cursor) : text.slice(cursor, nl);
        cursor = nl === -1 ? text.length : nl + 1;
        if (nl !== -1) {
          line += 1;
        }
        const candidate = spec.stripTabs ? rawLine.replace(/^\t+/u, "") : rawLine;
        if (candidate === spec.delimiter) {
          break;
        }
        bodyLines.push(rawLine);
      }
      if (bodyLines.length === 0) {
        if (!spec.executable && spec.isStdinFd && isStdinContainerBuildCommand(spec.ownerTokens)) {
          events.push({
            kind: "stdin-containerfile-heredoc",
            lines: [],
            startLine: bodyStartLine,
            quoted: spec.quoted,
            conditional: spec.conditional,
          });
        }
        continue;
      }
      const bodyText = bodyLines.join("\n");
      if (spec.executable) {
        events.push({ kind: "enter-subshell" });
        events.push(...lexShellScript(bodyText, bodyStartLine, "posix"));
        events.push({ kind: "exit-subshell" });
      } else {
        if (!spec.quoted) {
          const heredocSubs = extractUnquotedHeredocSubstitutions(bodyText, bodyStartLine);
          if (heredocSubs.length > 0) {
            events.push({
              kind: "command",
              tokens: [],
              lineNumber: bodyStartLine,
              conditional: spec.conditional,
              substitutions: heredocSubs,
            });
          }
        }
        if (redirectsToGithubEnv(spec.ownerTokens)) {
          events.push({
            kind: "github-env-heredoc",
            lines: bodyLines,
            startLine: bodyStartLine,
            quoted: spec.quoted,
            conditional: spec.conditional,
          });
        }
        if (spec.isStdinFd && isStdinContainerBuildCommand(spec.ownerTokens)) {
          events.push({
            kind: "stdin-containerfile-heredoc",
            lines: bodyLines,
            startLine: bodyStartLine,
            quoted: spec.quoted,
            conditional: spec.conditional,
          });
        }
      }
    }
    return cursor;
  };

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];

    if (arrayParenDepth > 0) {
      if (ch === "\n") {
        line += 1;
      }
      if (arrayEscaping) {
        arrayEscaping = false;
        current += ch;
        continue;
      }
      if (!isPwsh && !isCmd && ch === "\\" && arrayQuote !== "'") {
        arrayEscaping = true;
        current += ch;
        continue;
      }
      if (arrayQuote) {
        if (ch === arrayQuote) {
          arrayQuote = null;
        }
        current += ch;
        continue;
      }
      if (ch === "'" || ch === '"') {
        arrayQuote = ch;
        current += ch;
        continue;
      }
      if (ch === "(") {
        arrayParenDepth += 1;
        current += ch;
        continue;
      }
      if (ch === ")") {
        arrayParenDepth -= 1;
        current += ch;
        continue;
      }
      current += ch;
      continue;
    }

    if (escaping) {
      escaping = false;
      if (ch === "\n") {
        line += 1;
        continue;
      }
      markTokenStart();
      if (ch === "$") {
        currentEscapedDollarOffsets.push(current.length);
      }
      current += ch;
      continue;
    }

    if (!isPwsh && !isCmd && ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (isPwsh && ch === "`" && quote !== "'") {
      // PowerShell line continuation: backtick followed by optional horizontal
      // whitespace and a newline joins the next line into the current command.
      let cursor = index + 1;
      while (
        cursor < text.length &&
        (text[cursor] === " " || text[cursor] === "\t" || text[cursor] === "\r")
      ) {
        cursor += 1;
      }
      if (text[cursor] === "\n") {
        line += 1;
        index = cursor;
        continue;
      }
      escaping = true;
      continue;
    }

    if (isCmd && ch === "^" && !quote) {
      let cursor = index + 1;
      if (text[cursor] === "\r") {
        cursor += 1;
      }
      if (text[cursor] === "\n") {
        line += 1;
        index = cursor;
        continue;
      }
    }

    if (quote === "'") {
      if (ch === "\n") {
        line += 1;
      }
      if (ch === "'") {
        if (isPwsh && text[index + 1] === "'") {
          current += "'";
          index += 1;
        } else {
          quote = null;
        }
      } else {
        if (ch === "$") {
          currentEscapedDollarOffsets.push(current.length);
        }
        current += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (!isCmd && ch === "$" && text[index + 1] === "(" && text[index + 2] !== "(") {
        const subStartLine = line;
        const scanned = scanDollarCommandSubstitution(text, index, line);
        if (scanned) {
          commandSubstitutions.push({ text: scanned.innerText, lineNumber: subStartLine });
          current += COMMAND_SUBSTITUTION_PLACEHOLDER;
          index = scanned.endIndex;
          line = scanned.endLine;
          continue;
        }
      }
      if (!isPwsh && !isCmd && ch === "`") {
        const subStartLine = line;
        const scanned = scanBacktickSubstitution(text, index, line, true);
        if (scanned) {
          commandSubstitutions.push({ text: scanned.innerText, lineNumber: subStartLine });
          current += COMMAND_SUBSTITUTION_PLACEHOLDER;
          index = scanned.endIndex;
          line = scanned.endLine;
          continue;
        }
      }
      if (ch === "\n") {
        line += 1;
      }
      if (ch === '"') {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (arithDepth > 0) {
      if (ch === "\n") {
        line += 1;
      } else if (ch === "(" && text[index + 1] === "(") {
        arithDepth += 1;
        current += "((";
        index += 1;
        continue;
      } else if (ch === ")" && text[index + 1] === ")") {
        arithDepth -= 1;
        current += "))";
        index += 1;
        continue;
      }
      current += ch;
      continue;
    }

    // PowerShell block comments `<# ... #>`.
    if (isPwsh && !tokenStarted && ch === "<" && text[index + 1] === "#") {
      const closeIndex = text.indexOf("#>", index + 2);
      if (closeIndex !== -1) {
        for (let cursor = index + 2; cursor < closeIndex; cursor += 1) {
          if (text[cursor] === "\n") {
            line += 1;
          }
        }
        index = closeIndex + 1;
        continue;
      }
    }

    if (ch === "'" || ch === '"') {
      markTokenStart({ singleQuoted: ch === "'", quoted: true });
      quote = ch;
      continue;
    }

    // Command substitution `$(...)` outside single quotes.
    if (!isCmd && ch === "$" && text[index + 1] === "(" && text[index + 2] !== "(") {
      markTokenStart();
      const subStartLine = line;
      const scanned = scanDollarCommandSubstitution(text, index, line);
      if (scanned) {
        commandSubstitutions.push({ text: scanned.innerText, lineNumber: subStartLine });
        current += COMMAND_SUBSTITUTION_PLACEHOLDER;
        index = scanned.endIndex;
        line = scanned.endLine;
        continue;
      }
    }

    // Backtick command substitution `` `...` `` in POSIX shells only.
    if (!isPwsh && !isCmd && ch === "`") {
      markTokenStart();
      const subStartLine = line;
      const scanned = scanBacktickSubstitution(text, index, line, false);
      if (scanned) {
        commandSubstitutions.push({ text: scanned.innerText, lineNumber: subStartLine });
        current += COMMAND_SUBSTITUTION_PLACEHOLDER;
        index = scanned.endIndex;
        line = scanned.endLine;
        continue;
      }
    }

    // Arithmetic expansion `$((...))` or arithmetic command `((...))`.
    if (ch === "$" && text[index + 1] === "(" && text[index + 2] === "(") {
      markTokenStart();
      arithDepth += 1;
      current += "$((";
      index += 2;
      continue;
    }
    if (ch === "(" && text[index + 1] === "(" && !tokenStarted) {
      markTokenStart();
      arithDepth += 1;
      current += "((";
      index += 1;
      continue;
    }

    // Keep GitHub Actions `${{ ... }}` expressions intact as a single token.
    if (ch === "$" && text[index + 1] === "{" && text[index + 2] === "{") {
      const closeIndex = text.indexOf("}}", index + 3);
      if (closeIndex !== -1) {
        markTokenStart();
        const expr = text.slice(index, closeIndex + 2);
        for (const ec of expr) {
          if (ec === "\n") {
            line += 1;
          }
        }
        current += expr;
        index = closeIndex + 1;
        continue;
      }
    }

    // POSIX shell comments start with an unquoted `#` at a token boundary.
    if (ch === "#" && !tokenStarted) {
      flushCommand();
      while (index < text.length && text[index] !== "\n") {
        index += 1;
      }
      if (text[index] === "\n") {
        line += 1;
        nextConditional = false;
        if (pendingHeredocs.length > 0) {
          index = consumeHeredocBodies(index + 1) - 1;
        }
      }
      continue;
    }

    // Output redirection `>` / `>>` / `>&` as distinct tokens so attached targets
    // like `>>"$GITHUB_ENV"` or `>/tmp/log` split cleanly.
    if (ch === ">") {
      flushToken();
      if (tokens.length === 0) {
        commandLine = line;
        commandConditional = nextConditional;
        nextConditional = false;
      }
      if (text[index + 1] === ">") {
        tokens.push(">>");
        tokenSingleQuoted.push(false);
        tokenQuoted.push(false);
        index += 1;
      } else if (text[index + 1] === "&") {
        tokens.push(">&");
        tokenSingleQuoted.push(false);
        tokenQuoted.push(false);
        index += 1;
      } else {
        tokens.push(">");
        tokenSingleQuoted.push(false);
        tokenQuoted.push(false);
      }
      continue;
    }

    // Heredoc redirect `<<` / `<<-` (never `<<<` here-string, never inside arithmetic).
    if (ch === "<" && text[index + 1] === "<") {
      if (text[index + 2] === "<") {
        flushToken();
        index += 2;
        continue;
      }
      flushToken();
      let cursor = index + 2;
      let stripTabs = false;
      if (text[cursor] === "-") {
        stripTabs = true;
        cursor += 1;
      }
      while (cursor < text.length && /[ \t]/u.test(text[cursor])) {
        cursor += 1;
      }
      let delimiter = "";
      let delimQuote = null;
      let delimQuoted = false;
      let delimEscaping = false;
      while (cursor < text.length) {
        const dch = text[cursor];
        if (delimEscaping) {
          delimiter += dch;
          delimEscaping = false;
          cursor += 1;
          continue;
        }
        if (dch === "\\" && delimQuote !== "'") {
          delimEscaping = true;
          delimQuoted = true;
          cursor += 1;
          continue;
        }
        if (delimQuote) {
          if (dch === delimQuote) {
            delimQuote = null;
          } else {
            delimiter += dch;
          }
          cursor += 1;
          continue;
        }
        if (dch === "'" || dch === '"') {
          delimQuote = dch;
          delimQuoted = true;
          cursor += 1;
          continue;
        }
        if (/[\s;&|<>()]/u.test(dch)) {
          break;
        }
        delimiter += dch;
        cursor += 1;
      }
      if (delimiter.length > 0) {
        const prevToken = tokens.at(-1);
        const isStdinFd = !(/^\d+$/u.test(prevToken ?? "") && prevToken !== "0");
        if (isStdinFd) {
          commandHasStdinHeredoc = true;
        }
        pendingHeredocs.push({
          delimiter,
          stripTabs,
          quoted: delimQuoted,
          isStdinFd,
          executable: isShellInterpreterCommand(tokens),
          ownerTokens: tokens,
          conditional: commandConditional,
        });
      }
      index = cursor - 1;
      continue;
    }

    // Input redirection `<` / `<&` / `<>` as distinct tokens so attached targets
    // like `<ci/build.recipe` or `0<file` split cleanly.
    if (!isPwsh && ch === "<") {
      flushToken();
      if (tokens.length === 0) {
        commandLine = line;
        commandConditional = nextConditional;
        nextConditional = false;
      }
      if (text[index + 1] === "&") {
        tokens.push("<&");
        tokenSingleQuoted.push(false);
        tokenQuoted.push(false);
        index += 1;
      } else if (text[index + 1] === ">") {
        tokens.push("<>");
        tokenSingleQuoted.push(false);
        tokenQuoted.push(false);
        index += 1;
      } else {
        tokens.push("<");
        tokenSingleQuoted.push(false);
        tokenQuoted.push(false);
      }
      continue;
    }

    if (ch === "\n") {
      flushCommand();
      nextConditional = false;
      line += 1;
      if (pendingHeredocs.length > 0) {
        index = consumeHeredocBodies(index + 1) - 1;
      }
      continue;
    }

    if (ch === ";") {
      flushCommand();
      nextConditional = false;
      if (text[index + 1] === ";") {
        events.push({ kind: "case-end" });
        index += 1;
      }
      continue;
    }

    if (ch === "(") {
      if (current.endsWith("=")) {
        markTokenStart();
        arrayParenDepth = 1;
        arrayQuote = null;
        arrayEscaping = false;
        current += ch;
        continue;
      }
      if (current === "$") {
        current = "";
        tokenStarted = false;
        flushCommand();
        continue;
      }
      flushCommand();
      nextConditional = false;
      events.push({ kind: "enter-subshell" });
      continue;
    }

    if (ch === ")") {
      if (arrayParenDepth > 0) {
        arrayParenDepth -= 1;
        current += ch;
        continue;
      }
      // Treat an unquoted `)` as a subshell delimiter even when it immediately
      // follows a word (e.g. `(docker pull node:24@sha256:...)`).
      flushCommand();
      nextConditional = false;
      events.push({ kind: "exit-subshell" });
      continue;
    }

    if (ch === "&" || ch === "|") {
      flushCommand();
      if (text[index + 1] === ch) {
        nextConditional = true;
        index += 1;
      } else {
        nextConditional = false;
      }
      continue;
    }

    if (/[ \t\r]/u.test(ch)) {
      flushToken();
      continue;
    }

    markTokenStart();
    current += ch;
  }

  flushCommand();
  return events;
}

// --- Matrix row expansion with Actions `exclude` and `include` semantics -----

function parseMatrixPathSegments(pathSuffix) {
  const segments = [];
  for (const match of pathSuffix.matchAll(MATRIX_SEGMENT_PATTERN)) {
    segments.push(match[1] ?? match[2] ?? match[3]);
  }
  return segments;
}

function lookupCaseInsensitiveMapEntry(map, key) {
  if (map.has(key)) {
    return { key, value: map.get(key) };
  }
  const lower = key.toLowerCase();
  for (const [entryKey, entryValue] of map) {
    if (entryKey.toLowerCase() === lower) {
      return { key: entryKey, value: entryValue };
    }
  }
  return null;
}

function resolveMatrixPath(rowMap, segments) {
  let current = { kind: "map", value: rowMap };
  for (const segment of segments) {
    if (current?.kind !== "map") {
      return null;
    }
    const found = lookupCaseInsensitiveMapEntry(current.value, segment);
    if (!found) {
      return null;
    }
    current = found.value;
  }
  if (current?.kind === "scalar") {
    return { value: String(current.value), line: current.line };
  }
  return null;
}

function matrixNodesEqual(left, right) {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "scalar") {
    return String(left.value) === String(right.value);
  }
  if (left.kind === "seq") {
    return (
      left.value.length === right.value.length &&
      left.value.every((item, idx) => matrixNodesEqual(item, right.value[idx]))
    );
  }
  if (left.kind === "map") {
    if (left.value.size !== right.value.size) {
      return false;
    }
    for (const [k, v] of left.value) {
      const rightEntry = lookupCaseInsensitiveMapEntry(right.value, k);
      if (!rightEntry || !matrixNodesEqual(v, rightEntry.value)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function matchesExcludePartial(row, excludeRows) {
  return excludeRows.some((excludeMap) => {
    if (excludeMap.size === 0) {
      return false;
    }
    for (const [k, v] of excludeMap) {
      const found = lookupCaseInsensitiveMapEntry(row, k);
      if (!found || !matrixNodesEqual(found.value, v)) {
        return false;
      }
    }
    return true;
  });
}

function extractJobMatrixRows(jobNode, filePath, problems) {
  const strategyNode = getMapField(jobNode, "strategy");
  const matrixNode = getMapField(strategyNode, "matrix");
  if (matrixNode?.kind !== "map") {
    return [];
  }

  const axes = [];
  const axisNamesLower = new Set();
  const includeRows = [];
  const excludeRows = [];

  for (const [key, entryNode] of matrixNode.value) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "exclude") {
      if (entryNode?.kind === "seq") {
        for (const rowNode of entryNode.value) {
          if (rowNode?.kind === "map") {
            excludeRows.push(rowNode.value);
          }
        }
      }
      continue;
    }
    if (lowerKey === "include") {
      if (entryNode?.kind === "seq") {
        for (const rowNode of entryNode.value) {
          if (rowNode?.kind === "map") {
            includeRows.push(rowNode.value);
          }
        }
      }
      continue;
    }
    if (entryNode?.kind === "seq" && entryNode.value.length > 0) {
      axes.push([key, entryNode.value]);
      axisNamesLower.add(lowerKey);
    }
  }

  // Expand the Cartesian product while pruning excluded combinations as early as
  // possible; fail closed if more than MAX_MATRIX_ROWS surviving combinations
  // exist or exploration exceeds MAX_MATRIX_WORK.
  const rows = [];
  let work = 0;
  let truncated = false;

  if (axes.length > 0) {
    const expandAxis = (axisIndex, partialRow) => {
      const [axisKey, axisValues] = axes[axisIndex];
      const isLast = axisIndex + 1 === axes.length;
      for (const valueNode of axisValues) {
        work += 1;
        if (work > MAX_MATRIX_WORK) {
          truncated = true;
          return;
        }
        const nextRow = new Map(partialRow);
        nextRow.set(axisKey, valueNode);
        if (excludeRows.length > 0 && matchesExcludePartial(nextRow, excludeRows)) {
          continue;
        }
        if (isLast) {
          if (rows.length >= MAX_MATRIX_ROWS) {
            truncated = true;
            return;
          }
          rows.push(nextRow);
        } else {
          expandAxis(axisIndex + 1, nextRow);
          if (truncated) {
            return;
          }
        }
      }
    };
    expandAxis(0, new Map());
  }

  // Apply GitHub Actions `include`: merge non-axis properties into every
  // original base row matching all shared axis keys (including all original
  // rows when an include entry only introduces new keys); append as a new
  // standalone row only when no original base row matches.
  const standaloneIncludeRows = [];
  for (const includeMap of includeRows) {
    const sharedAxisKeys = [...includeMap.keys()].filter((k) =>
      axisNamesLower.has(k.toLowerCase()),
    );
    let matchedBase = false;
    if (rows.length > 0) {
      for (const row of rows) {
        if (
          sharedAxisKeys.every((k) => {
            const found = lookupCaseInsensitiveMapEntry(row, k);
            return found !== null && matrixNodesEqual(found.value, includeMap.get(k));
          })
        ) {
          matchedBase = true;
          for (const [k, v] of includeMap) {
            if (!axisNamesLower.has(k.toLowerCase())) {
              const existing = lookupCaseInsensitiveMapEntry(row, k);
              row.set(existing ? existing.key : k, v);
            }
          }
        }
      }
    }
    if (!matchedBase) {
      standaloneIncludeRows.push(new Map(includeMap));
    }
  }

  const allRows = [...rows, ...standaloneIncludeRows];
  if (truncated || allRows.length > MAX_MATRIX_ROWS) {
    problems.push(
      `${filePath}:${matrixNode.line}: matrix exceeds ${MAX_MATRIX_ROWS} combinations and cannot be verified exhaustively`,
    );
  }

  return allRows;
}

function expandMatrixReferences(rawText, matrixRows, fallbackLine) {
  const matches = [...rawText.matchAll(MATRIX_EXPRESSION_PATTERN)];
  if (matches.length === 0 || !matrixRows || matrixRows.length === 0) {
    return [{ text: rawText, line: fallbackLine }];
  }

  const singleMatrix = SINGLE_MATRIX_EXPRESSION_PATTERN.exec(rawText);
  const candidates = [];
  const seen = new Set();

  for (const row of matrixRows) {
    if (singleMatrix) {
      const resolved = resolveMatrixPath(row, parseMatrixPathSegments(singleMatrix.groups.path));
      if (!resolved) {
        continue;
      }
      const key = `${resolved.line}:${resolved.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ text: resolved.value, line: resolved.line });
      }
      continue;
    }

    let resolvedLine = fallbackLine;
    let matchedAny = false;
    const expanded = rawText.replace(
      MATRIX_EXPRESSION_PATTERN,
      (match, _p1, _offset, _str, groups) => {
        const resolved = resolveMatrixPath(row, parseMatrixPathSegments(groups.path));
        if (!resolved) {
          return match;
        }
        matchedAny = true;
        resolvedLine = resolved.line;
        return resolved.value;
      },
    );
    if (matchedAny) {
      const key = `${resolvedLine}:${expanded}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ text: expanded, line: resolvedLine });
      }
    }
  }

  return candidates.length > 0 ? candidates : [{ text: rawText, line: fallbackLine }];
}

function extractShellDashCScriptInfo(tokens, tokenSingleQuoted, tokenEscapedDollarOffsets, cursor) {
  let sawDashC = false;
  for (let index = cursor + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--" || token === "-") {
      if (!sawDashC || tokens[index + 1] === undefined) {
        return null;
      }
      return {
        script: tokens[index + 1],
        singleQuoted: Boolean(tokenSingleQuoted?.[index + 1]),
        escapedDollarOffsets: tokenEscapedDollarOffsets?.[index + 1] ?? [],
      };
    }
    if (token === "-o" || token === "+o" || token === "-O" || token === "+O") {
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      if (token === "--rcfile" || token === "--init-file") {
        index += 1;
      }
      continue;
    }
    if (/^-[A-Za-z]+$/u.test(token)) {
      if (token.includes("c")) {
        sawDashC = true;
      }
      if (token.endsWith("o") || token.endsWith("O")) {
        index += 1;
      }
      continue;
    }
    if (/^\+[A-Za-z]+$/u.test(token)) {
      continue;
    }
    return sawDashC
      ? {
          script: token,
          singleQuoted: Boolean(tokenSingleQuoted?.[index]),
          escapedDollarOffsets: tokenEscapedDollarOffsets?.[index] ?? [],
        }
      : null;
  }
  return null;
}

function expandParentDoubleQuotedScript(
  script,
  escapedDollarOffsets,
  stepEnv,
  parentVars,
  lineNumber,
  shellMode,
) {
  const ESCAPED_DOLLAR_SENTINEL = "\uE000";
  let masked = script;
  if (escapedDollarOffsets.length > 0) {
    const offsetSet = new Set(escapedDollarOffsets);
    let rebuilt = "";
    for (let index = 0; index < script.length; index += 1) {
      rebuilt +=
        script[index] === "$" && offsetSet.has(index) ? ESCAPED_DOLLAR_SENTINEL : script[index];
    }
    masked = rebuilt;
  }
  const expanded = resolveImageTokenCandidates(masked, stepEnv, parentVars, lineNumber, shellMode);
  return {
    truncated: expanded.truncated,
    candidates: expanded.candidates.map((candidate) => ({
      ...candidate,
      text: candidate.text.replaceAll(ESCAPED_DOLLAR_SENTINEL, "$"),
    })),
  };
}

function parseGithubEnvPayload(lines, startLine) {
  const assignments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = startLine + index;
    const heredocMatch = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)<<(?<delim>.+)$/u.exec(line);
    if (heredocMatch) {
      const valueLines = [];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor] !== heredocMatch.groups.delim) {
        valueLines.push(lines[cursor]);
        cursor += 1;
      }
      assignments.push({
        name: heredocMatch.groups.name,
        value: valueLines.join("\n"),
        line: lineNumber,
      });
      index = cursor;
      continue;
    }
    const assignMatch = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(line);
    if (assignMatch) {
      assignments.push({
        name: assignMatch.groups.name,
        value: assignMatch.groups.value,
        line: lineNumber,
      });
    }
  }
  return assignments;
}

function recordGithubEnvWrite(emittedGithubEnv, name, entries, conditional) {
  if (!emittedGithubEnv || entries.length === 0) {
    return;
  }
  const existing = emittedGithubEnv.get(name);
  if (!existing) {
    emittedGithubEnv.set(name, { entries: [...entries], conditional });
    return;
  }
  if (conditional) {
    emittedGithubEnv.set(name, {
      entries: mergeVarEntries(existing.entries, entries),
      conditional: existing.conditional,
    });
  } else {
    emittedGithubEnv.set(name, { entries: [...entries], conditional: false });
  }
}

function formatPrintfLines(format, args) {
  const chunks = [];
  let argIndex = 0;
  let guard = 0;

  while (guard < 64) {
    guard += 1;
    let out = "";
    let consumedInCycle = 0;

    for (let index = 0; index < format.length; index += 1) {
      const ch = format[index];
      if (ch === "\\" && index + 1 < format.length) {
        const next = format[index + 1];
        if (next === "n") {
          out += "\n";
        } else if (next === "r") {
          out += "\r";
        } else if (next === "t") {
          out += "\t";
        } else if (next === "\\") {
          out += "\\";
        } else {
          out += `\\${next}`;
        }
        index += 1;
        continue;
      }
      if (ch === "%") {
        const next = format[index + 1];
        if (next === "%") {
          out += "%";
          index += 1;
          continue;
        }
        if (next === "s") {
          out += args[argIndex] ?? "";
          argIndex += 1;
          consumedInCycle += 1;
          index += 1;
          continue;
        }
        // Unsupported format specifier (`%d`, `%q`, width/precision, etc.):
        // treat as unresolved instead of recording the format string verbatim.
        return null;
      }
      out += ch;
    }

    chunks.push(out);
    if (consumedInCycle === 0 || argIndex >= args.length) {
      break;
    }
  }

  return chunks.join("").split(/\r?\n/u);
}

function extractRedirectedWriteLines(tokens, startIndex) {
  const stripped = [];
  let targetsGithubEnv = false;
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === ">" || token === ">>" || token === ">&" || token === "<") {
      if ((token === ">" || token === ">>") && isGithubEnvTarget(tokens[index + 1])) {
        targetsGithubEnv = true;
      }
      index += 1;
      continue;
    }
    if (
      /^\d+$/u.test(token) &&
      (tokens[index + 1] === ">" || tokens[index + 1] === ">>" || tokens[index + 1] === ">&")
    ) {
      if (
        (tokens[index + 1] === ">" || tokens[index + 1] === ">>") &&
        isGithubEnvTarget(tokens[index + 2])
      ) {
        targetsGithubEnv = true;
      }
      index += 2;
      continue;
    }
    stripped.push(token);
  }

  if (!targetsGithubEnv || stripped.length === 0) {
    return null;
  }

  const cmd = path.basename(stripped[0]);
  if (cmd === "echo") {
    let argIndex = 1;
    while (argIndex < stripped.length && /^-[neE]+$/u.test(stripped[argIndex])) {
      argIndex += 1;
    }
    return stripped.slice(argIndex).join(" ").split(/\r?\n/u);
  }

  if (cmd === "printf" && stripped.length >= 2) {
    return formatPrintfLines(stripped[1], stripped.slice(2));
  }

  return null;
}

function peelControlKeywords(tokens, frame, lineNumber, stepEnv, shellMode) {
  let start = 0;
  while (start < tokens.length) {
    const keyword = tokens[start];
    if (keyword === "if") {
      frame.branches.push({
        kind: "if",
        entryVars: cloneVarMap(frame.vars),
        branchEndVars: [],
        hasElse: false,
      });
      start += 1;
      continue;
    }
    if (keyword === "then" || keyword === "do") {
      start += 1;
      continue;
    }
    if (keyword === "elif") {
      const top = frame.branches.at(-1);
      if (top?.kind === "if") {
        top.branchEndVars.push(cloneVarMap(frame.vars));
        frame.vars = cloneVarMap(top.entryVars);
      }
      start += 1;
      continue;
    }
    if (keyword === "else") {
      const top = frame.branches.at(-1);
      if (top?.kind === "if") {
        top.branchEndVars.push(cloneVarMap(frame.vars));
        top.hasElse = true;
        frame.vars = cloneVarMap(top.entryVars);
      }
      start += 1;
      continue;
    }
    if (keyword === "fi") {
      const top = frame.branches.at(-1);
      if (top?.kind === "if") {
        frame.branches.pop();
        top.branchEndVars.push(cloneVarMap(frame.vars));
        if (!top.hasElse) {
          top.branchEndVars.push(top.entryVars);
        }
        frame.vars = joinVarMaps(top.branchEndVars);
      }
      start += 1;
      continue;
    }
    if (keyword === "for") {
      frame.branches.push({
        kind: "loop",
        entryVars: cloneVarMap(frame.vars),
      });
      const varName = tokens[start + 1];
      if (varName && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(varName) && tokens[start + 2] === "in") {
        let entries = [];
        for (const operand of tokens.slice(start + 3)) {
          const expanded = resolveImageTokenCandidates(
            operand,
            stepEnv,
            frame.vars,
            lineNumber,
            shellMode,
          );
          entries = mergeVarEntries(entries, candidatesToVarEntries(expanded, lineNumber));
        }
        if (entries.length > 0) {
          frame.vars.set(varName, entries);
        }
        return [];
      }
      start += 1;
      continue;
    }
    if (keyword === "while" || keyword === "until") {
      frame.branches.push({
        kind: "loop",
        entryVars: cloneVarMap(frame.vars),
      });
      start += 1;
      continue;
    }
    if (keyword === "done") {
      const top = frame.branches.at(-1);
      if (top?.kind === "loop") {
        frame.branches.pop();
        frame.vars = joinVarMaps([top.entryVars, frame.vars]);
      }
      start += 1;
      continue;
    }
    if (keyword === "case") {
      frame.branches.push({
        kind: "case",
        entryVars: cloneVarMap(frame.vars),
        branchEndVars: [],
      });
      start += 1;
      continue;
    }
    if (keyword === "esac") {
      const top = frame.branches.at(-1);
      if (top?.kind === "case") {
        frame.branches.pop();
        top.branchEndVars.push(cloneVarMap(frame.vars), top.entryVars);
        frame.vars = joinVarMaps(top.branchEndVars);
      }
      start += 1;
      continue;
    }
    break;
  }
  return tokens.slice(start);
}

const DOCKER_BUILD_VALUE_FLAGS = new Set([
  "--add-host",
  "--allow",
  "--annotation",
  "--attest",
  "--build-arg",
  "--build-context",
  "--builder",
  "-c",
  "--cache-from",
  "--cache-to",
  "--cgroup-parent",
  "--cpu-period",
  "--cpu-quota",
  "--cpu-shares",
  "--cpuset-cpus",
  "--cpuset-mems",
  "-f",
  "--file",
  "--iidfile",
  "--isolation",
  "--label",
  "-m",
  "--memory",
  "--memory-swap",
  "--metadata-file",
  "--network",
  "-o",
  "--output",
  "--platform",
  "--progress",
  "--provenance",
  "--sbom",
  "--secret",
  "--shm-size",
  "--ssh",
  "-t",
  "--tag",
  "--target",
  "--ulimit",
  "-v",
  "--volume",
]);
const PODMAN_BUILD_VALUE_FLAGS = new Set([
  ...DOCKER_BUILD_VALUE_FLAGS,
  "--arch",
  "--authfile",
  "--cap-add",
  "--cap-drop",
  "--cert-dir",
  "--cpp-flag",
  "--creds",
  "--decryption-key",
  "--device",
  "--dns",
  "--dns-opt",
  "--dns-option",
  "--dns-search",
  "--env",
  "--format",
  "--from",
  "--gidmap",
  "--group-add",
  "--hooks-dir",
  "--identity-label",
  "--ignorefile",
  "--iidfile-raw",
  "--ipc",
  "--jobs",
  "--layer-label",
  "--logfile",
  "--manifest",
  "--os",
  "--pid",
  "--retry",
  "--retry-delay",
  "--runtime",
  "--runtime-flag",
  "--save-stages",
  "--sbom-image-output",
  "--sbom-image-purl-output",
  "--sbom-merge-strategy",
  "--sbom-output",
  "--sbom-purl-output",
  "--sbom-scanner-command",
  "--sbom-scanner-image",
  "--security-opt",
  "--sign-by",
  "--source-date-epoch",
  "--stage-labels",
  "--timestamp",
  "--uidmap",
  "--unsetannotation",
  "--unsetenv",
  "--unsetlabel",
  "--userns",
  "--userns-gid-map",
  "--userns-gid-map-group",
  "--userns-uid-map",
  "--userns-uid-map-user",
  "--uts",
  "--variant",
]);

const GITHUB_WORKSPACE_PREFIX_PATTERN =
  /^(?:\$\{\{\s*github\.workspace\s*\}\}|\$(?:\{GITHUB_WORKSPACE\}|GITHUB_WORKSPACE|\{env:GITHUB_WORKSPACE\}|env:GITHUB_WORKSPACE)|%GITHUB_WORKSPACE%)(?:[\\/]+(?<rest>.*)|$)/iu;
const GITHUB_ACTION_PATH_PREFIX_PATTERN =
  /^(?:\$\{\{\s*github\.action_path\s*\}\}|\$(?:\{GITHUB_ACTION_PATH\}|GITHUB_ACTION_PATH|\{env:GITHUB_ACTION_PATH\}|env:GITHUB_ACTION_PATH)|%GITHUB_ACTION_PATH%)(?:[\\/]+(?<rest>.*)|$)/iu;
const PWD_PREFIX_PATTERN = /^(?:\$(?:\{PWD\}|PWD))(?:[\\/]+(?<rest>.*)|$)/u;

function referencesUnresolvedInput(value) {
  return new RegExp(INPUTS_EXPRESSION_PATTERN.source, "iu").test(String(value ?? ""));
}

function resolveContainedPath(
  rawPath,
  baseDir,
  root,
  { windowsPath = false, actionDir = null } = {},
) {
  if (!root || !rawPath) {
    return null;
  }
  let trimmed = rawPath.trim();
  let effectiveBaseDir = baseDir;
  const resolvedRoot = path.resolve(root);

  const workspaceMatch = GITHUB_WORKSPACE_PREFIX_PATTERN.exec(trimmed);
  if (workspaceMatch) {
    trimmed = workspaceMatch.groups.rest ?? ".";
    effectiveBaseDir = resolvedRoot;
  } else {
    const actionMatch = actionDir !== null ? GITHUB_ACTION_PATH_PREFIX_PATTERN.exec(trimmed) : null;
    if (actionMatch) {
      trimmed = actionMatch.groups.rest ?? ".";
      effectiveBaseDir = path.resolve(actionDir);
    } else {
      const pwdMatch = PWD_PREFIX_PATTERN.exec(trimmed);
      if (pwdMatch) {
        trimmed = pwdMatch.groups.rest ?? ".";
      }
    }
  }

  if (!trimmed || trimmed === "-" || isDynamicReference(trimmed)) {
    return null;
  }
  if (windowsPath) {
    trimmed = trimmed.replaceAll("\\", "/");
    if (/^[A-Za-z]:/u.test(trimmed) || trimmed.startsWith("//")) {
      return null;
    }
  }
  const resolvedPath = path.resolve(effectiveBaseDir, trimmed);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolvedPath;
}

function normalizeCheckoutSubdir(rawPath, { windowsPath = false } = {}) {
  if (rawPath === undefined || rawPath === null) {
    return "";
  }
  let trimmed = String(rawPath).trim();
  if (!trimmed || trimmed === ".") {
    return "";
  }
  const workspaceMatch = GITHUB_WORKSPACE_PREFIX_PATTERN.exec(trimmed);
  if (workspaceMatch) {
    trimmed = workspaceMatch.groups.rest ?? "";
  }
  if (isDynamicReference(trimmed)) {
    return null;
  }
  trimmed = trimmed.replaceAll("\\", "/");
  if (
    (windowsPath && (/^[A-Za-z]:/u.test(trimmed) || trimmed.startsWith("//"))) ||
    trimmed.startsWith("/")
  ) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === ".") {
    return "";
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  return normalized.replace(/\/+$/u, "");
}

function resolveWorkspaceRelativePath(
  rawPath,
  currentWsRelDir,
  { windowsPath = false, actionWsRelDir = null } = {},
) {
  if (!rawPath) {
    return null;
  }
  let trimmed = rawPath.trim();
  let effectiveBase = currentWsRelDir ?? "";

  const workspaceMatch = GITHUB_WORKSPACE_PREFIX_PATTERN.exec(trimmed);
  if (workspaceMatch) {
    trimmed = workspaceMatch.groups.rest ?? ".";
    effectiveBase = "";
  } else {
    const actionMatch =
      actionWsRelDir !== null ? GITHUB_ACTION_PATH_PREFIX_PATTERN.exec(trimmed) : null;
    if (actionMatch) {
      trimmed = actionMatch.groups.rest ?? ".";
      effectiveBase = actionWsRelDir;
    } else {
      const pwdMatch = PWD_PREFIX_PATTERN.exec(trimmed);
      if (pwdMatch) {
        trimmed = pwdMatch.groups.rest ?? ".";
      }
    }
  }

  if (!trimmed || trimmed === "-" || isDynamicReference(trimmed)) {
    return null;
  }
  if (windowsPath) {
    trimmed = trimmed.replaceAll("\\", "/");
    if (/^[A-Za-z]:/u.test(trimmed) || trimmed.startsWith("//")) {
      return null;
    }
  }
  if (trimmed.startsWith("/")) {
    return null;
  }
  const joined = effectiveBase ? `${effectiveBase}/${trimmed}` : trimmed;
  const normalized = path.posix.normalize(joined);
  if (normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  return normalized === "." ? "" : normalized.replace(/\/+$/u, "");
}

function mapWorkspacePathToRepo(wsRelPath, root, checkoutPrefix = "") {
  if (wsRelPath === null || wsRelPath === undefined || !root) {
    return null;
  }
  const resolvedRoot = path.resolve(root);
  if (!checkoutPrefix) {
    return wsRelPath ? path.resolve(resolvedRoot, wsRelPath) : resolvedRoot;
  }
  if (wsRelPath === checkoutPrefix) {
    return resolvedRoot;
  }
  if (wsRelPath.startsWith(`${checkoutPrefix}/`)) {
    const repoRel = wsRelPath.slice(checkoutPrefix.length + 1);
    return repoRel ? path.resolve(resolvedRoot, repoRel) : resolvedRoot;
  }
  return null;
}

function matchesWorkspacePrefix(wsRelPath, prefix) {
  return !prefix || wsRelPath === prefix || wsRelPath.startsWith(`${prefix}/`);
}

function resolveWorkspaceTargetsInRepo(
  wsRelPath,
  root,
  checkoutPrefixes = null,
  foreignPrefixes = null,
) {
  if (wsRelPath === null || wsRelPath === undefined || !root) {
    return [];
  }
  const results = [];
  const seen = new Set();
  const prefixes = checkoutPrefixes === null ? [""] : checkoutPrefixes;
  const blocked = foreignPrefixes ?? [];
  for (const prefix of prefixes) {
    if (!matchesWorkspacePrefix(wsRelPath, prefix)) {
      continue;
    }
    const shadowedByForeign = blocked.some(
      (foreignPrefix) =>
        matchesWorkspacePrefix(wsRelPath, foreignPrefix) && foreignPrefix.length >= prefix.length,
    );
    if (shadowedByForeign) {
      continue;
    }
    const mapped = mapWorkspacePathToRepo(wsRelPath, root, prefix);
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      results.push(mapped);
    }
  }
  return results;
}

function parseCsvMountFields(rawSpec) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < rawSpec.length; index += 1) {
    const ch = rawSpec[index];
    if (ch === '"') {
      if (inQuotes && rawSpec[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function extractRunMountImageSources(rawMountSpec) {
  let mountType = "";
  let source = "";
  for (const field of parseCsvMountFields(rawMountSpec)) {
    const eqIndex = field.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = stripQuotes(field.slice(0, eqIndex)).toLowerCase();
    const value = stripQuotes(field.slice(eqIndex + 1));
    if (key === "type") {
      mountType = value.toLowerCase();
    } else if (key === "source" || key === "src") {
      source = value;
    }
  }
  if (mountType === "image" && source) {
    return [source];
  }
  return [];
}

function findDefaultBuildFile(baseContext, defaultNames) {
  let entries;
  try {
    entries = new Set(readdirSync(baseContext));
  } catch {
    return null;
  }
  for (const defaultName of defaultNames) {
    if (entries.has(defaultName)) {
      return path.join(baseContext, defaultName);
    }
  }
  return null;
}

function recordExplicitBuildFile(
  rawPath,
  baseDir,
  root,
  explicitBuildFiles,
  { windowsPath = false } = {},
) {
  if (!explicitBuildFiles) {
    return null;
  }
  const resolvedPath = resolveContainedPath(rawPath, baseDir, root, { windowsPath });
  if (!resolvedPath || resolvedPath === path.resolve(root)) {
    return null;
  }
  explicitBuildFiles.add(resolvedPath);
  return resolvedPath;
}

function normalizeExecutableName(cli) {
  if (!cli) {
    return "";
  }
  const base = cli.split(/[\\/]/u).at(-1) ?? cli;
  return base.toLowerCase().replace(/\.exe$/u, "");
}

const BUILDAH_PULL_VALUE_FLAGS = new Set([
  "--arch",
  "--authfile",
  "--cert-dir",
  "--creds",
  "--decryption-key",
  "--os",
  "--platform",
  "--policy",
  "--retry",
  "--retry-delay",
  "--variant",
]);
const BUILDAH_FROM_VALUE_FLAGS = new Set([
  ...BUILDAH_PULL_VALUE_FLAGS,
  "--add-host",
  "--cap-add",
  "--cap-drop",
  "--cgroup-parent",
  "--cidfile",
  "--cni-plugin-path",
  "--cpu-period",
  "--cpu-quota",
  "--cpu-shares",
  "--cpuset-cpus",
  "--cpuset-mems",
  "--device",
  "--dns",
  "--dns-opt",
  "--dns-option",
  "--dns-search",
  "--format",
  "--gidmap",
  "--hooks-dir",
  "--ipc",
  "--isolation",
  "-m",
  "--memory",
  "--memory-swap",
  "--name",
  "--net",
  "--network",
  "--pid",
  "--pull",
  "--security-opt",
  "--shm-size",
  "--uidmap",
  "--ulimit",
  "--userns",
  "--uts",
  "-v",
  "--volume",
]);

function flagConsumesNextArg(token, valueFlags) {
  if (!token.startsWith("-") || token === "-" || token === "--" || token.includes("=")) {
    return false;
  }
  if (valueFlags.has(token)) {
    return true;
  }
  if (!token.startsWith("--") && token.length > 2) {
    // Bundled short flags (e.g. `-itv cache:/cache`): walk each short option;
    // a value-taking option consumes either the rest of the bundle (attached)
    // or the following token when it is the final character in the bundle.
    for (let index = 1; index < token.length; index += 1) {
      if (valueFlags.has(`-${token[index]}`)) {
        return index === token.length - 1;
      }
    }
  }
  return false;
}

function parseBuildkitPlatform(rawPlatform) {
  const trimmed = String(rawPlatform ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "local" || isDynamicReference(trimmed)) {
    return null;
  }
  const parts = trimmed.split("/");
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const [rawOs, rawArch, rawVariant = ""] = parts;
  if (
    !/^[A-Za-z0-9._-]+$/u.test(rawOs) ||
    !/^[A-Za-z0-9._-]+$/u.test(rawArch) ||
    (rawVariant && !/^[A-Za-z0-9._-]+$/u.test(rawVariant))
  ) {
    return null;
  }
  const os = rawOs.toLowerCase();
  const arch = rawArch.toLowerCase();
  const variant = arch === "arm64" && rawVariant.toLowerCase() === "v8" ? "" : rawVariant;
  const platform = variant ? `${os}/${arch}/${variant}` : `${os}/${arch}`;
  return {
    TARGETPLATFORM: platform,
    TARGETOS: os,
    TARGETARCH: arch,
    TARGETVARIANT: variant,
  };
}

function splitPlatformEntries(rawSpec) {
  const entries = [];
  for (const part of String(rawSpec ?? "").split(/[\r\n,]+/u)) {
    const trimmed = part.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      entries.push(trimmed);
    }
  }
  return entries;
}

function recordBuildInvocation(
  resolvedFilePath,
  buildArgsMap,
  namedContexts,
  sourceFile,
  sourceLine,
  buildInvocations,
  platforms = [],
) {
  if (!buildInvocations || !resolvedFilePath) {
    return;
  }
  buildInvocations.push({
    filePath: resolvedFilePath,
    buildArgs: buildArgsMap ?? new Map(),
    namedContexts: namedContexts ? new Set(namedContexts) : new Set(),
    platforms: Array.isArray(platforms) ? [...platforms] : [],
    sourceFile,
    sourceLine,
  });
}

function inspectBuildContextSpec(
  rawSpec,
  stepEnv,
  varMap,
  matrixRows,
  filePath,
  lineNumber,
  shellMode,
  problems,
  namedContexts,
) {
  const eqIndex = rawSpec.indexOf("=");
  if (eqIndex === -1) {
    return;
  }
  const name = rawSpec.slice(0, eqIndex).trim().toLowerCase();
  const rawValue = rawSpec.slice(eqIndex + 1).trim();
  if (!name || !rawValue) {
    return;
  }
  namedContexts.add(name);
  const expanded = resolveImageTokenCandidates(rawValue, stepEnv, varMap, lineNumber, shellMode);
  if (expanded.truncated) {
    problems.push(
      `${filePath}:${lineNumber}: ${rawValue} exceeds expansion limit and cannot be verified exhaustively`,
    );
  }
  for (const varCandidate of expanded.candidates) {
    for (const candidate of expandMatrixReferences(
      varCandidate.text,
      matrixRows,
      varCandidate.line,
    )) {
      const value = candidate.text.trim();
      const schemeMatch = /^(?:docker-image|container-image):\/\//iu.exec(value);
      if (!schemeMatch) {
        continue;
      }
      const imageRef = value.slice(schemeMatch[0].length);
      if (isDynamicReference(imageRef, shellMode)) {
        continue;
      }
      if (!isPinnedDigest(imageRef)) {
        problems.push(
          `${filePath}:${candidate.line}: ${imageRef} is not pinned to a sha256 digest`,
        );
      }
    }
  }
}

function checkBuildkitSyntaxOverride(entry, reportFile, reportLine, problems) {
  if (!entry) {
    return;
  }
  const values = Array.isArray(entry) ? entry : entry.values;
  const truncated = Array.isArray(entry) ? false : Boolean(entry.truncated);
  if (truncated) {
    problems.push(
      `${reportFile}:${reportLine}: BUILDKIT_SYNTAX exceeds build-arg expansion limit and cannot be verified exhaustively`,
    );
  }
  let reportedDynamic = false;
  for (const rawValue of values) {
    const value = stripQuotes(String(rawValue ?? ""));
    if (!value) {
      continue;
    }
    if (isDynamicReference(value)) {
      if (!reportedDynamic) {
        reportedDynamic = true;
        problems.push(
          `${reportFile}:${reportLine}: build-arg BUILDKIT_SYNTAX overrides BuildKit syntax frontend dynamically and cannot be verified`,
        );
      }
      continue;
    }
    if (!isPinnedDigest(value)) {
      problems.push(`${reportFile}:${reportLine}: ${value} is not pinned to a sha256 digest`);
    }
  }
}

function expandBuildArgSpec(
  rawSpec,
  stepEnv,
  varMap,
  commandVars,
  matrixRows,
  lineNumber,
  shellMode,
) {
  const eqIndex = rawSpec.indexOf("=");
  const name = eqIndex === -1 ? rawSpec.trim() : rawSpec.slice(0, eqIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    return null;
  }
  // Name-only `--build-arg BASE` reads `BASE` from Docker's child process
  // environment (`commandVars`), whereas explicit `--build-arg BASE=$value`
  // expands `$value` in the outer shell (`varMap`). When `BASE` is unset in the
  // child environment (e.g. an unexported shell-local variable), Docker passes
  // no override and keeps the Dockerfile default.
  const isNameOnly = eqIndex === -1;
  if (isNameOnly) {
    const envLookupName = shellMode === "pwsh" ? `env:${name}` : name;
    const exportedEntries = lookupVarEntries(
      commandVars,
      envLookupName,
      shellMode === "pwsh" || shellMode === "cmd",
    );
    if (!exportedEntries || exportedEntries.every((entry) => entry.unset)) {
      return null;
    }
  }
  const lookupVars = isNameOnly ? commandVars : varMap;
  const rawValue = isNameOnly
    ? shellMode === "pwsh"
      ? `$env:${name}`
      : shellMode === "cmd"
        ? `%${name}%`
        : `$${name}`
    : rawSpec.slice(eqIndex + 1);
  const expanded = resolveImageTokenCandidates(
    rawValue,
    stepEnv,
    lookupVars,
    lineNumber,
    shellMode,
  );
  const values = [];
  const seen = new Set();
  for (const varCandidate of expanded.candidates) {
    for (const candidate of expandMatrixReferences(
      varCandidate.text,
      matrixRows,
      varCandidate.line,
    )) {
      if (!seen.has(candidate.text)) {
        seen.add(candidate.text);
        values.push(candidate.text);
      }
    }
  }
  return {
    name,
    values: values.length > 0 ? values : [rawValue],
    truncated: expanded.truncated,
  };
}

function inspectShellText(
  scriptText,
  startLine,
  sourceLines,
  stepEnv,
  shellVars,
  matrixRows,
  filePath,
  problems,
  emittedGithubEnv = null,
  shellMode = "posix",
  depth = 0,
  buildFileContext = null,
) {
  if (depth > MAX_SHELL_NESTING_DEPTH) {
    return;
  }

  const cloneRowCwds = (rowCwds) => {
    const copy = new Map();
    for (const [key, dirs] of rowCwds) {
      copy.set(key, [...dirs]);
    }
    return copy;
  };
  const cloneRowDirStacks = (rowDirStacks) => {
    const copy = new Map();
    for (const [key, stack] of rowDirStacks) {
      copy.set(
        key,
        stack.map((dirs) => [...dirs]),
      );
    }
    return copy;
  };

  const initialRowCwds = buildFileContext?.rowCwds
    ? cloneRowCwds(buildFileContext.rowCwds)
    : new Map();
  if (initialRowCwds.size === 0 && buildFileContext?.workingDir) {
    const rowsForCwd = matrixRows.length > 0 ? matrixRows : [null];
    for (const row of rowsForCwd) {
      initialRowCwds.set(row, [buildFileContext.workingDir]);
    }
  }
  const initialRowDirStacks = buildFileContext?.rowDirStacks
    ? cloneRowDirStacks(buildFileContext.rowDirStacks)
    : new Map();
  const initialRowOldPwds = buildFileContext?.rowOldPwds
    ? cloneRowCwds(buildFileContext.rowOldPwds)
    : new Map();
  const initialRowCwdsTruncated = buildFileContext?.rowCwdsTruncated
    ? new Set(buildFileContext.rowCwdsTruncated)
    : new Set();
  const initialExportedVars = new Set(
    shellMode === "pwsh" ? [...stepEnv.keys()].map((key) => `env:${key}`) : stepEnv.keys(),
  );
  const cloneArrayMap = (arrayMap) => {
    const copy = new Map();
    for (const [key, entry] of arrayMap) {
      copy.set(key, {
        variants: entry.variants.map((list) => list.map((item) => ({ ...item }))),
        truncated: entry.truncated,
      });
    }
    return copy;
  };
  const scopeStack = [
    {
      vars: cloneVarMap(shellVars),
      arrays: new Map(),
      exportedVars: initialExportedVars,
      branches: [],
      rowCwds: initialRowCwds,
      rowDirStacks: initialRowDirStacks,
      rowOldPwds: initialRowOldPwds,
      rowCwdsTruncated: initialRowCwdsTruncated,
      pendingStdinBuilds: [],
    },
  ];
  const isWindowsShell = shellMode === "pwsh" || shellMode === "cmd";

  for (const event of lexShellScript(scriptText, startLine, shellMode)) {
    if (event.kind === "enter-subshell") {
      const parent = scopeStack.at(-1);
      scopeStack.push({
        vars: cloneVarMap(parent.vars),
        arrays: cloneArrayMap(parent.arrays),
        exportedVars: new Set(parent.exportedVars),
        branches: [],
        rowCwds: cloneRowCwds(parent.rowCwds),
        rowDirStacks: cloneRowDirStacks(parent.rowDirStacks),
        rowOldPwds: cloneRowCwds(parent.rowOldPwds),
        rowCwdsTruncated: new Set(parent.rowCwdsTruncated),
        pendingStdinBuilds: [],
      });
      continue;
    }
    if (event.kind === "exit-subshell") {
      if (scopeStack.length > 1) {
        scopeStack.pop();
      }
      continue;
    }

    const frame = scopeStack.at(-1);

    if (event.kind === "case-end") {
      const top = frame.branches.at(-1);
      if (top?.kind === "case") {
        top.branchEndVars.push(cloneVarMap(frame.vars));
        frame.vars = cloneVarMap(top.entryVars);
      }
      continue;
    }

    if (event.kind === "stdin-containerfile-heredoc") {
      const stdinBuild = frame.pendingStdinBuilds.shift() ?? null;
      const rawBody = event.lines.join("\n");
      const seenStdinProblems = new Set();
      const invocationList =
        stdinBuild?.invocations && stdinBuild.invocations.length > 0
          ? stdinBuild.invocations
          : [{ buildArgs: null, namedContexts: null, platforms: [], rowList: matrixRows }];

      for (const inv of invocationList) {
        const expandedBodies = event.quoted
          ? resolveEnvExpressionCandidates(rawBody, stepEnv, event.startLine)
          : resolveImageTokenCandidates(rawBody, stepEnv, frame.vars, event.startLine, shellMode);
        if (expandedBodies.truncated) {
          const limitMessage = `${filePath}:${event.startLine}: inline containerfile exceeds expansion limit and cannot be verified exhaustively`;
          if (!seenStdinProblems.has(limitMessage)) {
            seenStdinProblems.add(limitMessage);
            problems.push(limitMessage);
          }
        }
        const seenBodies = new Set();
        for (const bodyVarCandidate of expandedBodies.candidates) {
          for (const bodyCandidate of expandMatrixReferences(
            bodyVarCandidate.text,
            inv.rowList,
            event.startLine,
          )) {
            if (seenBodies.has(bodyCandidate.text)) {
              continue;
            }
            seenBodies.add(bodyCandidate.text);
            for (const message of unpinnedContainerfileReferences(bodyCandidate.text, filePath, {
              argOverrides: inv.buildArgs,
              namedContexts: inv.namedContexts,
              platforms: inv.platforms,
              sourceFile: filePath,
              sourceLine: stdinBuild?.lineNumber ?? event.startLine,
              startLineOffset: event.startLine - 1,
            })) {
              if (!seenStdinProblems.has(message)) {
                seenStdinProblems.add(message);
                problems.push(message);
              }
            }
          }
        }
      }
      continue;
    }

    if (event.kind === "github-env-heredoc") {
      const isConditional = frame.branches.length > 0 || event.conditional;
      for (const assignment of parseGithubEnvPayload(event.lines, event.startLine)) {
        const resolved = event.quoted
          ? resolveEnvExpressionCandidates(assignment.value, stepEnv, assignment.line)
          : resolveImageTokenCandidates(
              assignment.value,
              stepEnv,
              frame.vars,
              assignment.line,
              shellMode,
            );
        recordGithubEnvWrite(
          emittedGithubEnv,
          assignment.name,
          candidatesToVarEntries(resolved, assignment.line),
          isConditional,
        );
      }
      continue;
    }

    const { lineNumber, conditional, substitutions } = event;

    for (const nested of substitutions) {
      inspectShellText(
        nested.text,
        nested.lineNumber,
        sourceLines,
        stepEnv,
        frame.vars,
        matrixRows,
        filePath,
        problems,
        emittedGithubEnv,
        shellMode,
        depth + 1,
        buildFileContext
          ? {
              ...buildFileContext,
              rowCwds: cloneRowCwds(frame.rowCwds),
              rowDirStacks: cloneRowDirStacks(frame.rowDirStacks),
              rowOldPwds: cloneRowCwds(frame.rowOldPwds),
              rowCwdsTruncated: new Set(frame.rowCwdsTruncated),
            }
          : null,
      );
    }

    if (event.tokens.length === 0 || event.tokens[0].startsWith("#")) {
      continue;
    }

    const tokens = peelControlKeywords(event.tokens, frame, lineNumber, stepEnv, shellMode);
    const peeledCount = event.tokens.length - tokens.length;
    const peeledSingleQuoted = event.tokenSingleQuoted
      ? event.tokenSingleQuoted.slice(peeledCount)
      : [];
    const peeledQuoted = event.tokenQuoted ? event.tokenQuoted.slice(peeledCount) : [];
    const peeledEscapedDollarOffsets = event.tokenEscapedDollarOffsets
      ? event.tokenEscapedDollarOffsets.slice(peeledCount)
      : [];
    if (tokens.length === 0 || tokens[0].startsWith("#")) {
      continue;
    }

    // `unset VAR ...` clears tracked shell variables (or marks them possibly unset
    // when executed conditionally).
    if (tokens[0] === "unset" && tokens.length > 1) {
      let unsetFunctions = false;
      const unsetNames = [];
      for (const token of tokens.slice(1)) {
        if (token === "-f") {
          unsetFunctions = true;
          break;
        }
        if (token === "-v" || token === "--") {
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token)) {
          unsetNames.push(token);
        }
      }
      if (!unsetFunctions) {
        for (const name of unsetNames) {
          if (conditional) {
            const existing = frame.vars.has(name)
              ? frame.vars.get(name)
              : [{ value: "", line: 0, unset: true }];
            frame.vars.set(name, mergeVarEntries(existing, [{ value: "", line: 0, unset: true }]));
          } else {
            frame.vars.set(name, [{ value: "", line: 0, unset: true }]);
            frame.exportedVars.delete(name);
            frame.arrays.delete(name);
          }
        }
      }
      continue;
    }

    // PowerShell variable assignment (`$image = "node:24"`, `$env:IMAGE = ...`).
    // Keep `$env:NAME` in a separate namespace from local `$name`.
    if (shellMode === "pwsh") {
      let pwshKey = null;
      let pwshRawValue = null;
      if (tokens.length >= 3 && tokens[1] === "=") {
        const lhsMatch = PWSH_ASSIGN_LHS_PATTERN.exec(tokens[0]);
        if (lhsMatch) {
          const baseName = lhsMatch.groups.braced ?? lhsMatch.groups.bare;
          const isEnvVar = Boolean(lhsMatch.groups.envPrefix ?? lhsMatch.groups.envPrefixBraced);
          pwshKey = isEnvVar ? `env:${baseName}` : baseName;
          pwshRawValue = tokens.slice(2).join(" ");
        }
      } else if (tokens.length === 1) {
        const inlineMatch = PWSH_INLINE_ASSIGN_PATTERN.exec(tokens[0]);
        if (inlineMatch) {
          const baseName = inlineMatch.groups.braced ?? inlineMatch.groups.bare;
          const isEnvVar = Boolean(
            inlineMatch.groups.envPrefix ?? inlineMatch.groups.envPrefixBraced,
          );
          pwshKey = isEnvVar ? `env:${baseName}` : baseName;
          pwshRawValue = inlineMatch.groups.value;
        }
      }
      if (pwshKey !== null) {
        const resolved = candidatesToVarEntries(
          resolveImageTokenCandidates(pwshRawValue, stepEnv, frame.vars, lineNumber, shellMode),
          lineNumber,
        );
        setVarEntries(frame.vars, pwshKey, resolved, {
          caseInsensitive: true,
          merge: conditional,
        });
        if (pwshKey.startsWith("env:")) {
          frame.exportedVars.add(pwshKey);
        }
        continue;
      }
    }

    // Windows cmd variable assignment (`set IMAGE=node:24` or `set "IMAGE=node:24"`).
    if (shellMode === "cmd" && tokens[0].toLowerCase() === "set" && tokens.length >= 2) {
      if (!/^\/[ap]$/iu.test(tokens[1])) {
        const assignText = tokens.slice(1).join(" ");
        const match = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(assignText);
        if (match) {
          const resolved = candidatesToVarEntries(
            resolveImageTokenCandidates(
              match.groups.value,
              stepEnv,
              frame.vars,
              lineNumber,
              shellMode,
            ),
            lineNumber,
          );
          setVarEntries(frame.vars, match.groups.name, resolved, {
            caseInsensitive: true,
            merge: conditional,
          });
          frame.exportedVars.add(match.groups.name);
          continue;
        }
      }
    }

    // `export VAR` / `export VAR=value` marks variables as exported to child processes.
    if (tokens[0] === "export" && tokens.length > 1) {
      const exportOperands = tokens.slice(1).filter((token) => !token.startsWith("-"));
      if (
        exportOperands.length > 0 &&
        exportOperands.every(
          (token) =>
            ENV_PREFIX_ASSIGNMENT_PATTERN.test(token) || /^[A-Za-z_][A-Za-z0-9_]*$/u.test(token),
        )
      ) {
        for (const token of exportOperands) {
          const match = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(token);
          if (match) {
            const resolved = candidatesToVarEntries(
              resolveImageTokenCandidates(
                match.groups.value,
                stepEnv,
                frame.vars,
                lineNumber,
                shellMode,
              ),
              lineNumber,
            );
            frame.exportedVars.add(match.groups.name);
            if (conditional) {
              const existing = frame.vars.has(match.groups.name)
                ? frame.vars.get(match.groups.name)
                : [{ value: "", line: 0, unset: true }];
              frame.vars.set(match.groups.name, mergeVarEntries(existing, resolved));
            } else {
              frame.vars.set(match.groups.name, resolved);
            }
          } else {
            frame.exportedVars.add(token);
          }
        }
        continue;
      }
    }

    // Bash array assignment (`args=(--rm alpine:3.20)`, `args+=(...)`,
    // `declare -a args=(...)`, `local args=(...)`).
    const BASH_ARRAY_ASSIGN_PATTERN =
      /^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?<op>\+?=)\((?<body>[\s\S]*)\)$/u;
    const arrayAssignStart =
      tokens[0] === "declare" || tokens[0] === "local" || tokens[0] === "typeset"
        ? tokens.findIndex((tok, idx) => idx > 0 && !tok.startsWith("-"))
        : 0;
    if (
      shellMode === "posix" &&
      arrayAssignStart !== -1 &&
      arrayAssignStart < tokens.length &&
      tokens.slice(arrayAssignStart).every((token) => BASH_ARRAY_ASSIGN_PATTERN.test(token))
    ) {
      for (const token of tokens.slice(arrayAssignStart)) {
        const arrayMatch = BASH_ARRAY_ASSIGN_PATTERN.exec(token);
        if (!arrayMatch) {
          continue;
        }
        const { name, op, body } = arrayMatch.groups;
        const bodyEvents = lexShellScript(body, lineNumber, "posix");
        const rawElements = [];
        for (const bodyEvent of bodyEvents) {
          if (bodyEvent.kind !== "command") {
            continue;
          }
          for (let elemIdx = 0; elemIdx < bodyEvent.tokens.length; elemIdx += 1) {
            rawElements.push({
              text: bodyEvent.tokens[elemIdx],
              singleQuoted: Boolean(bodyEvent.tokenSingleQuoted?.[elemIdx]),
              line: bodyEvent.lineNumber,
            });
          }
        }
        let arrayTruncated = false;
        let expandedVariants = [[]];
        for (const elem of rawElements) {
          const elemExpanded = elem.singleQuoted
            ? { candidates: [{ text: elem.text, line: elem.line }], truncated: false }
            : resolveImageTokenCandidates(elem.text, stepEnv, frame.vars, elem.line, shellMode);
          if (elemExpanded.truncated) {
            arrayTruncated = true;
          }
          const nextVariants = [];
          for (const variant of expandedVariants) {
            for (const candidate of elemExpanded.candidates) {
              if (nextVariants.length >= MAX_VAR_VALUES) {
                arrayTruncated = true;
                break;
              }
              nextVariants.push([
                ...variant,
                { text: candidate.text, line: candidate.line, preExpanded: true },
              ]);
            }
          }
          expandedVariants = nextVariants;
        }
        const existingEntry = frame.arrays.get(name);
        const existingVariants =
          op === "+="
            ? (existingEntry?.variants ?? [[]])
            : conditional || frame.branches.length > 0
              ? (existingEntry?.variants ?? [[]])
              : [];
        if (existingEntry?.truncated && (op === "+=" || conditional || frame.branches.length > 0)) {
          arrayTruncated = true;
        }
        if (op === "+=") {
          const combined = [];
          for (const base of existingVariants) {
            for (const added of expandedVariants) {
              if (combined.length >= MAX_VAR_VALUES) {
                arrayTruncated = true;
                break;
              }
              combined.push([...base, ...added]);
            }
          }
          const merged =
            conditional || frame.branches.length > 0
              ? [...existingVariants, ...combined]
              : combined;
          if (merged.length > MAX_VAR_VALUES) {
            arrayTruncated = true;
          }
          frame.arrays.set(name, {
            variants: merged.slice(0, MAX_VAR_VALUES),
            truncated: arrayTruncated,
          });
        } else {
          const merged =
            conditional || frame.branches.length > 0
              ? [...existingVariants, ...expandedVariants]
              : expandedVariants;
          if (merged.length > MAX_VAR_VALUES) {
            arrayTruncated = true;
          }
          frame.arrays.set(name, {
            variants: merged.slice(0, MAX_VAR_VALUES),
            truncated: arrayTruncated,
          });
        }
      }
      continue;
    }

    // Scalar variable declaration builtins (`readonly IMAGE=...`,
    // `declare -r IMAGE=...`, `declare -x IMAGE=...`, `local IMAGE=...`).
    if (
      shellMode === "posix" &&
      (tokens[0] === "readonly" ||
        tokens[0] === "declare" ||
        tokens[0] === "local" ||
        tokens[0] === "typeset") &&
      tokens.length > 1
    ) {
      let skipDeclaration = false;
      let marksExported = false;
      const declOperands = [];
      let afterDoubleDash = false;
      for (const token of tokens.slice(1)) {
        if (!afterDoubleDash && token === "--") {
          afterDoubleDash = true;
          continue;
        }
        if (!afterDoubleDash && token.startsWith("-")) {
          if (token.includes("f") || token.includes("F") || token.includes("p")) {
            skipDeclaration = true;
            break;
          }
          if (token.includes("x")) {
            marksExported = true;
          }
          continue;
        }
        declOperands.push(token);
      }
      if (
        !skipDeclaration &&
        declOperands.length > 0 &&
        declOperands.every(
          (token) =>
            ENV_PREFIX_ASSIGNMENT_PATTERN.test(token) || /^[A-Za-z_][A-Za-z0-9_]*$/u.test(token),
        )
      ) {
        for (const token of declOperands) {
          const match = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(token);
          if (match) {
            const resolved = candidatesToVarEntries(
              resolveImageTokenCandidates(
                match.groups.value,
                stepEnv,
                frame.vars,
                lineNumber,
                shellMode,
              ),
              lineNumber,
            );
            if (marksExported) {
              frame.exportedVars.add(match.groups.name);
            }
            if (conditional) {
              const existing = frame.vars.has(match.groups.name)
                ? frame.vars.get(match.groups.name)
                : [{ value: "", line: 0, unset: true }];
              frame.vars.set(match.groups.name, mergeVarEntries(existing, resolved));
            } else {
              frame.vars.set(match.groups.name, resolved);
              frame.arrays.delete(match.groups.name);
            }
          } else if (marksExported) {
            frame.exportedVars.add(token);
          }
        }
        continue;
      }
    }

    // Pure shell-local variable assignment (`image=rust:1.96-alpine`).
    if (tokens.every((token) => ENV_PREFIX_ASSIGNMENT_PATTERN.test(token))) {
      for (const token of tokens) {
        const match = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(token);
        if (match) {
          const resolved = candidatesToVarEntries(
            resolveImageTokenCandidates(
              match.groups.value,
              stepEnv,
              frame.vars,
              lineNumber,
              shellMode,
            ),
            lineNumber,
          );
          if (conditional) {
            const existing = frame.vars.has(match.groups.name)
              ? frame.vars.get(match.groups.name)
              : [{ value: "", line: 0, unset: true }];
            frame.vars.set(match.groups.name, mergeVarEntries(existing, resolved));
          } else {
            frame.vars.set(match.groups.name, resolved);
            frame.arrays.delete(match.groups.name);
          }
        }
      }
      continue;
    }

    // Keep argument-expansion scope (`frame.vars`) separate from the child
    // process environment (`exportedCommandVars`): prefix assignments like
    // `IMAGE=new docker pull "$IMAGE"` only change the child environment, while
    // shell-local unexported assignments stay out of `exportedCommandVars`.
    const commandVars = cloneVarMap(frame.vars);
    const exportedCommandVars = new Map();
    for (const [key, entries] of frame.vars) {
      if (frame.exportedVars.has(key)) {
        exportedCommandVars.set(key, [...entries]);
      }
    }
    let childStepEnv = stepEnv;
    const stdinRedirectTargets = [];
    const wrapperChdirs = [];
    let cursor = 0;
    while (cursor < tokens.length) {
      const redirConsumed = consumeShellRedirection(tokens, cursor, stdinRedirectTargets);
      if (redirConsumed > 0) {
        cursor += redirConsumed;
        continue;
      }
      const wrapperEnvChanges = { clear: false, unset: new Set() };
      const afterWrapper = advanceWrapperPrefix(
        tokens,
        cursor,
        stdinRedirectTargets,
        wrapperChdirs,
        wrapperEnvChanges,
      );
      if (afterWrapper !== null) {
        if (wrapperEnvChanges.clear) {
          for (const key of exportedCommandVars.keys()) {
            exportedCommandVars.set(key, [{ value: "", line: 0, unset: true }]);
          }
          for (const key of stepEnv.keys()) {
            exportedCommandVars.set(key, [{ value: "", line: 0, unset: true }]);
          }
          childStepEnv = new Map();
        }
        for (const unsetKey of wrapperEnvChanges.unset) {
          exportedCommandVars.set(unsetKey, [{ value: "", line: 0, unset: true }]);
          if (childStepEnv === stepEnv) {
            childStepEnv = cloneVarMap(stepEnv);
          }
          childStepEnv.delete(unsetKey);
        }
        cursor = afterWrapper;
        continue;
      }
      const token = tokens[cursor];
      const prefixAssign = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(token);
      if (prefixAssign) {
        const resolved = candidatesToVarEntries(
          resolveImageTokenCandidates(
            prefixAssign.groups.value,
            stepEnv,
            frame.vars,
            lineNumber,
            shellMode,
          ),
          lineNumber,
        );
        commandVars.set(prefixAssign.groups.name, resolved);
        exportedCommandVars.set(prefixAssign.groups.name, resolved);
        cursor += 1;
        continue;
      }
      break;
    }

    const cli = tokens[cursor];
    if (!cli) {
      continue;
    }

    const githubEnvLines = extractRedirectedWriteLines(tokens, cursor);
    if (githubEnvLines) {
      const isConditional = frame.branches.length > 0 || conditional;
      for (const assignment of parseGithubEnvPayload(githubEnvLines, lineNumber)) {
        const resolved = resolveImageTokenCandidates(
          assignment.value,
          stepEnv,
          frame.vars,
          lineNumber,
          shellMode,
        );
        recordGithubEnvWrite(
          emittedGithubEnv,
          assignment.name,
          candidatesToVarEntries(resolved, lineNumber),
          isConditional,
        );
      }
      continue;
    }

    const normalizedCli = normalizeExecutableName(cli);
    if (
      buildFileContext &&
      (normalizedCli === "popd" || (shellMode === "pwsh" && normalizedCli === "pop-location"))
    ) {
      const rowsForCd = matrixRows.length > 0 ? matrixRows : [null];
      const preserveExisting = conditional || frame.branches.length > 0;
      for (const row of rowsForCd) {
        const stack = frame.rowDirStacks.get(row);
        if (!stack || stack.length === 0) {
          continue;
        }
        const currentDirs = frame.rowCwds.get(row) ?? [buildFileContext.workingDir];
        if (preserveExisting) {
          const topDirs = stack.at(-1);
          const mergedDirs = [...currentDirs];
          const seenDirs = new Set(mergedDirs);
          for (const dir of topDirs) {
            if (seenDirs.has(dir)) {
              continue;
            }
            if (mergedDirs.length >= MAX_WORKING_DIRS_PER_ROW) {
              frame.rowCwdsTruncated.add(row);
              continue;
            }
            seenDirs.add(dir);
            mergedDirs.push(dir);
          }
          frame.rowCwds.set(row, mergedDirs);
        } else {
          frame.rowOldPwds.set(row, [...currentDirs]);
          frame.rowCwds.set(row, stack.pop());
        }
      }
      continue;
    }

    if (
      buildFileContext &&
      (normalizedCli === "cd" ||
        normalizedCli === "pushd" ||
        (shellMode === "pwsh" &&
          (normalizedCli === "set-location" ||
            normalizedCli === "sl" ||
            normalizedCli === "chdir" ||
            normalizedCli === "push-location")))
    ) {
      const isPushd =
        normalizedCli === "pushd" || (shellMode === "pwsh" && normalizedCli === "push-location");
      let dirArg = null;
      for (let index = cursor + 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === "--") {
          dirArg = tokens[index + 1] ?? null;
          break;
        }
        if (token.startsWith("-") && token !== "-") {
          if (shellMode === "pwsh" && /^-(?:path|literalpath)$/iu.test(token)) {
            dirArg = tokens[index + 1] ?? null;
            break;
          }
          continue;
        }
        dirArg = token;
        break;
      }
      const rowsForCd = matrixRows.length > 0 ? matrixRows : [null];
      const preserveExisting = conditional || frame.branches.length > 0;
      if (isPushd && !dirArg) {
        for (const row of rowsForCd) {
          const stack = frame.rowDirStacks.get(row);
          if (!stack || stack.length === 0) {
            continue;
          }
          const currentDirs = frame.rowCwds.get(row) ?? [buildFileContext.workingDir];
          if (preserveExisting) {
            const topDirs = stack.at(-1);
            const mergedDirs = [...currentDirs];
            const seenDirs = new Set(mergedDirs);
            for (const dir of topDirs) {
              if (!seenDirs.has(dir) && mergedDirs.length < MAX_WORKING_DIRS_PER_ROW) {
                seenDirs.add(dir);
                mergedDirs.push(dir);
              }
            }
            frame.rowCwds.set(row, mergedDirs);
          } else {
            const topDirs = stack.pop();
            stack.push([...currentDirs]);
            frame.rowOldPwds.set(row, [...currentDirs]);
            frame.rowCwds.set(row, topDirs);
          }
        }
        continue;
      }
      if (!isPushd && dirArg === "-") {
        for (const row of rowsForCd) {
          const oldDirs = frame.rowOldPwds.get(row);
          if (!oldDirs || oldDirs.length === 0) {
            continue;
          }
          const currentDirs = frame.rowCwds.get(row) ?? [buildFileContext.workingDir];
          if (preserveExisting) {
            const mergedDirs = [...currentDirs];
            const seenDirs = new Set(mergedDirs);
            for (const dir of oldDirs) {
              if (!seenDirs.has(dir) && mergedDirs.length < MAX_WORKING_DIRS_PER_ROW) {
                seenDirs.add(dir);
                mergedDirs.push(dir);
              }
            }
            frame.rowCwds.set(row, mergedDirs);
          } else {
            frame.rowOldPwds.set(row, [...currentDirs]);
            frame.rowCwds.set(row, [...oldDirs]);
          }
        }
        continue;
      }
      if (dirArg && dirArg !== "-") {
        const expandedDir = resolveImageTokenCandidates(
          dirArg,
          stepEnv,
          frame.vars,
          lineNumber,
          shellMode,
        );
        for (const row of rowsForCd) {
          const rowList = row ? [row] : [];
          const currentDirs = frame.rowCwds.get(row) ?? [buildFileContext.workingDir];
          const nextDirs = preserveExisting ? [...currentDirs] : [];
          const seenDirs = new Set(nextDirs);
          for (const baseDir of currentDirs) {
            for (const varCandidate of expandedDir.candidates) {
              for (const candidate of expandMatrixReferences(
                varCandidate.text,
                rowList,
                varCandidate.line,
              )) {
                const resolved = resolveWorkspaceRelativePath(candidate.text, baseDir, {
                  windowsPath: isWindowsShell,
                  actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
                });
                if (resolved === null || seenDirs.has(resolved)) {
                  continue;
                }
                if (nextDirs.length >= MAX_WORKING_DIRS_PER_ROW) {
                  frame.rowCwdsTruncated.add(row);
                  continue;
                }
                seenDirs.add(resolved);
                nextDirs.push(resolved);
              }
            }
          }
          if (nextDirs.length > 0) {
            if (isPushd) {
              const stack = frame.rowDirStacks.get(row) ?? [];
              if (stack.length < 64) {
                stack.push([...currentDirs]);
              }
              frame.rowDirStacks.set(row, stack);
            }
            frame.rowOldPwds.set(row, [...currentDirs]);
            frame.rowCwds.set(row, nextDirs);
          }
        }
      }
      continue;
    }

    const resolveCommandWorkingDirs = (row) => {
      const baseDirs =
        frame.rowCwds.get(row) ??
        (buildFileContext &&
        buildFileContext.workingDir !== undefined &&
        buildFileContext.workingDir !== null
          ? [buildFileContext.workingDir]
          : []);
      if (wrapperChdirs.length === 0 || !buildFileContext || baseDirs.length === 0) {
        return { dirs: baseDirs, truncated: frame.rowCwdsTruncated.has(row) };
      }
      const rowList = row ? [row] : [];
      let currentDirs = [...baseDirs];
      let truncated = frame.rowCwdsTruncated.has(row);
      for (const rawChdir of wrapperChdirs) {
        const expandedDir = resolveImageTokenCandidates(
          rawChdir,
          stepEnv,
          frame.vars,
          lineNumber,
          shellMode,
        );
        const nextDirs = [];
        const seenDirs = new Set();
        for (const baseDir of currentDirs) {
          for (const varCandidate of expandedDir.candidates) {
            for (const candidate of expandMatrixReferences(
              varCandidate.text,
              rowList,
              varCandidate.line,
            )) {
              const resolved = resolveWorkspaceRelativePath(candidate.text, baseDir, {
                windowsPath: isWindowsShell,
                actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
              });
              if (resolved === null || seenDirs.has(resolved)) {
                continue;
              }
              if (nextDirs.length >= MAX_WORKING_DIRS_PER_ROW) {
                truncated = true;
                continue;
              }
              seenDirs.add(resolved);
              nextDirs.push(resolved);
            }
          }
        }
        if (nextDirs.length > 0) {
          currentDirs = nextDirs;
        }
      }
      return { dirs: currentDirs, truncated };
    };

    if (SHELL_INTERPRETERS.has(normalizedCli)) {
      const dashCInfo = extractShellDashCScriptInfo(
        tokens,
        peeledSingleQuoted,
        peeledEscapedDollarOffsets,
        cursor,
      );
      if (dashCInfo) {
        let childRowCwds = cloneRowCwds(frame.rowCwds);
        let childRowCwdsTruncated = new Set(frame.rowCwdsTruncated);
        if (wrapperChdirs.length > 0 && buildFileContext) {
          const rowsForChild = matrixRows.length > 0 ? matrixRows : [null];
          childRowCwds = new Map();
          childRowCwdsTruncated = new Set();
          for (const row of rowsForChild) {
            const resolved = resolveCommandWorkingDirs(row);
            childRowCwds.set(row, resolved.dirs);
            if (resolved.truncated) {
              childRowCwdsTruncated.add(row);
            }
          }
        }
        const childBuildContext = buildFileContext
          ? {
              ...buildFileContext,
              rowCwds: childRowCwds,
              rowCwdsTruncated: childRowCwdsTruncated,
            }
          : null;
        // Single-quoted `sh -c '...'` is passed verbatim to the child shell,
        // which sees only exported/prefixed variables. Double-quoted/unquoted
        // `sh -c "..."` is expanded first in the parent shell's environment
        // (before command-local prefix assignments take effect), then the
        // resulting script executes in the child shell's exported environment.
        let childScripts = [dashCInfo.script];
        if (!dashCInfo.singleQuoted) {
          const parentExpanded = expandParentDoubleQuotedScript(
            dashCInfo.script,
            dashCInfo.escapedDollarOffsets,
            stepEnv,
            frame.vars,
            lineNumber,
            shellMode,
          );
          if (parentExpanded.truncated) {
            problems.push(
              `${filePath}:${lineNumber}: ${dashCInfo.script} exceeds expansion limit and cannot be verified exhaustively`,
            );
          }
          childScripts = [...new Set(parentExpanded.candidates.map((candidate) => candidate.text))];
        }
        const seenChildProblems = new Set();
        for (const childScript of childScripts) {
          const scriptProblems = [];
          inspectShellText(
            childScript,
            lineNumber,
            sourceLines,
            childStepEnv,
            exportedCommandVars,
            matrixRows,
            filePath,
            scriptProblems,
            emittedGithubEnv,
            "posix",
            depth + 1,
            childBuildContext,
          );
          for (const message of scriptProblems) {
            if (!seenChildProblems.has(message)) {
              seenChildProblems.add(message);
              problems.push(message);
            }
          }
        }
      }
      continue;
    }

    if (normalizedCli !== "docker" && normalizedCli !== "podman" && normalizedCli !== "buildah") {
      continue;
    }

    const globalValueFlags =
      normalizedCli === "buildah"
        ? BUILDAH_GLOBAL_VALUE_FLAGS
        : normalizedCli === "podman"
          ? PODMAN_GLOBAL_VALUE_FLAGS
          : DOCKER_GLOBAL_VALUE_FLAGS;
    let argIndex = cursor + 1;
    while (argIndex < tokens.length) {
      const redirConsumed = consumeShellRedirection(tokens, argIndex, stdinRedirectTargets);
      if (redirConsumed > 0) {
        argIndex += redirConsumed;
        continue;
      }
      const flag = tokens[argIndex];
      if (!flag.startsWith("-")) {
        break;
      }
      argIndex += flagConsumesNextArg(flag, globalValueFlags) ? 2 : 1;
    }

    const buildCommand = resolveContainerBuildCommand(
      tokens,
      normalizedCli,
      argIndex,
      stdinRedirectTargets,
    );
    if (buildCommand?.kind === "bake") {
      problems.push(
        `${filePath}:${lineNumber}: ${normalizedCli} buildx bake target definitions cannot be verified statically for container image digests`,
      );
      continue;
    }
    if (buildCommand?.kind === "buildx-create") {
      let rawDriver = null;
      const rawDriverOpts = [];
      for (let index = buildCommand.argStart; index < tokens.length; index += 1) {
        const redirConsumed = consumeShellRedirection(tokens, index);
        if (redirConsumed > 0) {
          index += redirConsumed - 1;
          continue;
        }
        const token = tokens[index];
        if (token === "--") {
          break;
        }
        if (token === "--driver") {
          if (tokens[index + 1] !== undefined) {
            rawDriver = tokens[index + 1];
          }
          index += 1;
          continue;
        }
        if (token.startsWith("--driver=")) {
          rawDriver = token.slice("--driver=".length);
          continue;
        }
        if (token === "--driver-opt") {
          if (tokens[index + 1] !== undefined) {
            rawDriverOpts.push(tokens[index + 1]);
          }
          index += 1;
          continue;
        }
        if (token.startsWith("--driver-opt=")) {
          rawDriverOpts.push(token.slice("--driver-opt=".length));
          continue;
        }
        if (token.startsWith("-") && flagConsumesNextArg(token, DOCKER_BUILDX_CREATE_VALUE_FLAGS)) {
          index += 1;
        }
      }

      const createRows = matrixRows.length > 0 ? matrixRows : [null];
      const seenCreateProblems = new Set();
      const pushCreateProblem = (message) => {
        if (!seenCreateProblems.has(message)) {
          seenCreateProblems.add(message);
          problems.push(message);
        }
      };

      for (const row of createRows) {
        const rowList = row ? [row] : [];
        const driverCandidates = rawDriver
          ? resolveImageTokenCandidates(
              rawDriver,
              stepEnv,
              frame.vars,
              lineNumber,
              shellMode,
            ).candidates.flatMap((varCandidate) =>
              expandMatrixReferences(varCandidate.text, rowList, varCandidate.line),
            )
          : [{ text: "docker-container", line: lineNumber }];

        const usesContainerDriver = driverCandidates.some((candidate) => {
          const normalizedDriver = candidate.text.trim().toLowerCase();
          return (
            normalizedDriver === "" ||
            normalizedDriver === "docker-container" ||
            normalizedDriver === "kubernetes"
          );
        });
        if (!usesContainerDriver) {
          continue;
        }

        let effectiveImageCandidates = [];
        for (const rawOpt of rawDriverOpts) {
          const expandedOpt = resolveImageTokenCandidates(
            rawOpt,
            stepEnv,
            frame.vars,
            lineNumber,
            shellMode,
          );
          if (expandedOpt.truncated) {
            pushCreateProblem(
              `${filePath}:${lineNumber}: ${rawOpt} exceeds expansion limit and cannot be verified exhaustively`,
            );
          }
          const flagImages = [];
          for (const varCandidate of expandedOpt.candidates) {
            for (const candidate of expandMatrixReferences(
              varCandidate.text,
              rowList,
              varCandidate.line,
            )) {
              for (const imageRef of extractDriverOptImages(candidate.text)) {
                flagImages.push({
                  text: imageRef,
                  line: candidate.line,
                });
              }
            }
          }
          if (flagImages.length > 0) {
            effectiveImageCandidates = flagImages;
          }
        }

        if (effectiveImageCandidates.length === 0) {
          pushCreateProblem(
            `${filePath}:${lineNumber}: ${normalizedCli} buildx create uses unpinned default BuildKit image (pass --driver-opt image=...@sha256:...)`,
          );
          continue;
        }

        for (const imageCandidate of effectiveImageCandidates) {
          const imageRef = imageCandidate.text.trim();
          if (!imageRef) {
            pushCreateProblem(
              `${filePath}:${lineNumber}: ${normalizedCli} buildx create uses unpinned default BuildKit image (pass --driver-opt image=...@sha256:...)`,
            );
            continue;
          }
          if (!isDynamicReference(imageRef, shellMode) && !isPinnedDigest(imageRef)) {
            pushCreateProblem(
              `${filePath}:${imageCandidate.line}: ${imageRef} is not pinned to a sha256 digest`,
            );
          }
        }
      }
      continue;
    }
    if (buildCommand?.kind === "build") {
      const buildArgStart = buildCommand.argStart;
      const rawFiles = [];
      const rawBuildContexts = [];
      const rawBuildArgs = [];
      const rawPlatforms = [];
      const rawBuildImageOverrides = [];
      let contextArg = null;
      for (let index = buildArgStart; index < tokens.length; index += 1) {
        const redirConsumed = consumeShellRedirection(tokens, index, stdinRedirectTargets);
        if (redirConsumed > 0) {
          index += redirConsumed - 1;
          continue;
        }
        const token = tokens[index];
        if (token === "--") {
          for (let restIndex = index + 1; restIndex < tokens.length; restIndex += 1) {
            const restRedir = consumeShellRedirection(tokens, restIndex, stdinRedirectTargets);
            if (restRedir > 0) {
              restIndex += restRedir - 1;
              continue;
            }
            if (contextArg === null) {
              contextArg = tokens[restIndex];
            }
          }
          break;
        }
        if (token === "-f" || token === "--file") {
          if (tokens[index + 1]) {
            rawFiles.push(tokens[index + 1]);
          }
          index += 1;
          continue;
        }
        if (token.startsWith("--file=")) {
          rawFiles.push(token.slice("--file=".length));
          continue;
        }
        const shortBundle = parseShortBuildFlagBundle(token, tokens[index + 1]);
        if (shortBundle) {
          if (shortBundle.file) {
            rawFiles.push(shortBundle.file);
          }
          if (shortBundle.consumedNext) {
            index += 1;
          }
          continue;
        }
        if (token === "--build-context") {
          if (tokens[index + 1] !== undefined) {
            rawBuildContexts.push(tokens[index + 1]);
          }
          index += 1;
          continue;
        }
        if (token.startsWith("--build-context=")) {
          rawBuildContexts.push(token.slice("--build-context=".length));
          continue;
        }
        if (token === "--build-arg") {
          if (tokens[index + 1] !== undefined) {
            rawBuildArgs.push(tokens[index + 1]);
          }
          index += 1;
          continue;
        }
        if (token.startsWith("--build-arg=")) {
          rawBuildArgs.push(token.slice("--build-arg=".length));
          continue;
        }
        if (token === "--platform") {
          if (tokens[index + 1] !== undefined) {
            rawPlatforms.push(tokens[index + 1]);
          }
          index += 1;
          continue;
        }
        if (token.startsWith("--platform=")) {
          rawPlatforms.push(token.slice("--platform=".length));
          continue;
        }
        if (normalizedCli === "podman" || normalizedCli === "buildah") {
          if (token === "--from" || token === "--sbom-scanner-image") {
            if (tokens[index + 1] !== undefined) {
              rawBuildImageOverrides.push({ flag: token, rawValue: tokens[index + 1] });
            }
            index += 1;
            continue;
          }
          if (token.startsWith("--from=")) {
            rawBuildImageOverrides.push({
              flag: "--from",
              rawValue: token.slice("--from=".length),
            });
            continue;
          }
          if (token.startsWith("--sbom-scanner-image=")) {
            rawBuildImageOverrides.push({
              flag: "--sbom-scanner-image",
              rawValue: token.slice("--sbom-scanner-image=".length),
            });
            continue;
          }
        }
        if (token.startsWith("-") && token !== "-") {
          const buildValueFlags =
            normalizedCli === "podman" || normalizedCli === "buildah"
              ? PODMAN_BUILD_VALUE_FLAGS
              : DOCKER_BUILD_VALUE_FLAGS;
          if (flagConsumesNextArg(token, buildValueFlags)) {
            index += 1;
          }
          continue;
        }
        if (contextArg === null) {
          contextArg = token;
        }
      }

      const buildRows = matrixRows.length > 0 ? matrixRows : [null];
      const seenContextProblems = new Set();
      const seenSyntaxProblems = new Set();
      const seenStdinProblems = new Set();
      const pushStdinProblem = (message) => {
        if (!seenStdinProblems.has(message)) {
          seenStdinProblems.add(message);
          problems.push(message);
        }
      };
      const hasExplicitNonStdinFile = rawFiles.some((file) => file !== "-");
      const usesStdinFile = rawFiles.includes("-");
      const usesStdinContextArchive =
        contextArg === "-" && hasExplicitNonStdinFile && !usesStdinFile;
      const usesStdinDockerfile = usesStdinFile || (contextArg === "-" && !hasExplicitNonStdinFile);
      const hasStdinHeredoc = Boolean(event.hasStdinHeredoc);
      const hasStdinRedirect = stdinRedirectTargets.length > 0;
      const stdinInvocations = [];

      if (usesStdinContextArchive) {
        pushStdinProblem(
          `${filePath}:${lineNumber}: stdin build context archive cannot be verified statically`,
        );
      }

      for (const row of buildRows) {
        const rowList = row ? [row] : [];
        const namedContexts = new Set();
        const rowContextProblems = [];
        for (const rawBuildContext of rawBuildContexts) {
          inspectBuildContextSpec(
            rawBuildContext,
            stepEnv,
            frame.vars,
            rowList,
            filePath,
            lineNumber,
            shellMode,
            rowContextProblems,
            namedContexts,
          );
        }
        for (const message of rowContextProblems) {
          if (!seenContextProblems.has(message)) {
            seenContextProblems.add(message);
            problems.push(message);
          }
        }

        for (const { flag, rawValue } of rawBuildImageOverrides) {
          const expandedOverride = resolveImageTokenCandidates(
            rawValue,
            stepEnv,
            frame.vars,
            lineNumber,
            shellMode,
          );
          if (expandedOverride.truncated) {
            const limitMsg = `${filePath}:${lineNumber}: ${rawValue} exceeds expansion limit and cannot be verified exhaustively`;
            if (!seenContextProblems.has(limitMsg)) {
              seenContextProblems.add(limitMsg);
              problems.push(limitMsg);
            }
          }
          for (const varCandidate of expandedOverride.candidates) {
            for (const candidate of expandMatrixReferences(
              varCandidate.text,
              rowList,
              varCandidate.line,
            )) {
              const imageRef = candidate.text.trim();
              if (!imageRef || isDynamicReference(imageRef, shellMode)) {
                continue;
              }
              if (flag === "--from" && imageRef.toLowerCase() === "scratch") {
                continue;
              }
              if (!isPinnedDigest(imageRef)) {
                const msg = `${filePath}:${candidate.line}: ${imageRef} is not pinned to a sha256 digest`;
                if (!seenContextProblems.has(msg)) {
                  seenContextProblems.add(msg);
                  problems.push(msg);
                }
              }
            }
          }
        }

        const buildArgsMap = new Map();
        for (const rawBuildArg of rawBuildArgs) {
          const parsedArg = expandBuildArgSpec(
            rawBuildArg,
            stepEnv,
            frame.vars,
            exportedCommandVars,
            rowList,
            lineNumber,
            shellMode,
          );
          if (parsedArg) {
            buildArgsMap.set(parsedArg.name, {
              values: parsedArg.values,
              truncated: parsedArg.truncated,
            });
          }
        }

        if (buildArgsMap.has("BUILDKIT_SYNTAX")) {
          const rowSyntaxProblems = [];
          checkBuildkitSyntaxOverride(
            buildArgsMap.get("BUILDKIT_SYNTAX"),
            filePath,
            lineNumber,
            rowSyntaxProblems,
          );
          for (const message of rowSyntaxProblems) {
            if (!seenSyntaxProblems.has(message)) {
              seenSyntaxProblems.add(message);
              problems.push(message);
            }
          }
        }

        const buildPlatforms = [];
        const seenBuildPlatforms = new Set();
        for (const rawPlatform of rawPlatforms) {
          const expandedPlatform = resolveImageTokenCandidates(
            rawPlatform,
            stepEnv,
            frame.vars,
            lineNumber,
            shellMode,
          );
          for (const varCandidate of expandedPlatform.candidates) {
            for (const candidate of expandMatrixReferences(
              varCandidate.text,
              rowList,
              varCandidate.line,
            )) {
              for (const platformEntry of splitPlatformEntries(candidate.text)) {
                if (!seenBuildPlatforms.has(platformEntry)) {
                  seenBuildPlatforms.add(platformEntry);
                  buildPlatforms.push(platformEntry);
                }
              }
            }
          }
        }

        if (usesStdinContextArchive) {
          continue;
        }

        const { dirs: activeWorkingDirs, truncated: activeWorkingDirsTruncated } =
          resolveCommandWorkingDirs(row);

        if (usesStdinDockerfile) {
          if (hasStdinHeredoc) {
            stdinInvocations.push({
              buildArgs: buildArgsMap,
              namedContexts,
              platforms: buildPlatforms,
              rowList,
            });
          }
          if (hasStdinRedirect) {
            const rawStdinTarget = stdinRedirectTargets.at(-1);
            if (!buildFileContext || activeWorkingDirs.length === 0) {
              pushStdinProblem(
                `${filePath}:${lineNumber}: stdin containerfile input ${rawStdinTarget} cannot be verified statically`,
              );
            } else {
              if (activeWorkingDirsTruncated) {
                pushStdinProblem(
                  `${filePath}:${lineNumber}: working-directory expansion exceeds ${MAX_WORKING_DIRS_PER_ROW} paths and cannot be verified exhaustively`,
                );
              }
              const expandedStdin = resolveImageTokenCandidates(
                rawStdinTarget,
                stepEnv,
                frame.vars,
                lineNumber,
                shellMode,
              );
              if (expandedStdin.truncated) {
                pushStdinProblem(
                  `${filePath}:${lineNumber}: ${rawStdinTarget} exceeds expansion limit and cannot be verified exhaustively`,
                );
              }
              const resolvedStdinFiles = [];
              const seenStdinFiles = new Set();
              for (const activeWorkingDir of activeWorkingDirs) {
                for (const varCandidate of expandedStdin.candidates) {
                  for (const candidate of expandMatrixReferences(
                    varCandidate.text,
                    rowList,
                    varCandidate.line,
                  )) {
                    const wsRel = resolveWorkspaceRelativePath(candidate.text, activeWorkingDir, {
                      windowsPath: isWindowsShell,
                      actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
                    });
                    const mappedTargets = resolveWorkspaceTargetsInRepo(
                      wsRel,
                      buildFileContext.root,
                      buildFileContext.checkoutPrefixes,
                      buildFileContext.foreignCheckoutPrefixes,
                    ).filter((target) => target !== path.resolve(buildFileContext.root));
                    if (mappedTargets.length === 0) {
                      if (
                        buildFileContext.deferUnresolvedInputs &&
                        referencesUnresolvedInput(candidate.text)
                      ) {
                        continue;
                      }
                      pushStdinProblem(
                        `${filePath}:${lineNumber}: stdin containerfile input ${candidate.text} cannot be verified statically`,
                      );
                      continue;
                    }
                    for (const resolvedPath of mappedTargets) {
                      const targetProblems = [];
                      const safeFile = resolveSafeContainerFile(
                        resolvedPath,
                        buildFileContext.root,
                        targetProblems,
                      );
                      if (safeFile) {
                        if (isArchiveOrBinaryFile(safeFile)) {
                          pushStdinProblem(
                            `${filePath}:${lineNumber}: stdin build context archive ${candidate.text} cannot be verified statically`,
                          );
                          continue;
                        }
                        buildFileContext.explicitBuildFiles.add(resolvedPath);
                        if (!seenStdinFiles.has(resolvedPath)) {
                          seenStdinFiles.add(resolvedPath);
                          resolvedStdinFiles.push(resolvedPath);
                        }
                      } else if (targetProblems.length > 0) {
                        buildFileContext.explicitBuildFiles.add(resolvedPath);
                      } else {
                        pushStdinProblem(
                          `${filePath}:${lineNumber}: stdin containerfile input ${candidate.text} cannot be verified statically`,
                        );
                      }
                    }
                  }
                }
              }
              for (const targetFile of resolvedStdinFiles) {
                recordBuildInvocation(
                  targetFile,
                  buildArgsMap,
                  namedContexts,
                  filePath,
                  lineNumber,
                  buildFileContext.buildInvocations,
                  buildPlatforms,
                );
              }
            }
          } else if (!hasStdinHeredoc) {
            pushStdinProblem(
              `${filePath}:${lineNumber}: stdin containerfile input cannot be verified statically`,
            );
          }
          continue;
        }

        if (rawFiles.length === 0 && contextArg) {
          const expandedRemoteCheck = resolveImageTokenCandidates(
            contextArg,
            stepEnv,
            frame.vars,
            lineNumber,
            shellMode,
          );
          for (const varCandidate of expandedRemoteCheck.candidates) {
            for (const candidate of expandMatrixReferences(
              varCandidate.text,
              rowList,
              varCandidate.line,
            )) {
              const ctxText = candidate.text.trim();
              if (isRemoteBuildContext(ctxText)) {
                const remoteMsg = `${filePath}:${lineNumber}: build context ${ctxText} cannot be verified statically`;
                if (!seenContextProblems.has(remoteMsg)) {
                  seenContextProblems.add(remoteMsg);
                  problems.push(remoteMsg);
                }
              }
            }
          }
        }

        if (!buildFileContext || activeWorkingDirs.length === 0) {
          continue;
        }

        if (activeWorkingDirsTruncated) {
          problems.push(
            `${filePath}:${lineNumber}: working-directory expansion exceeds ${MAX_WORKING_DIRS_PER_ROW} paths and cannot be verified exhaustively`,
          );
        }

        const resolvedBuildFiles = [];
        const seenResolvedFiles = new Set();
        const pushResolvedFile = (resolved) => {
          if (resolved && !seenResolvedFiles.has(resolved)) {
            seenResolvedFiles.add(resolved);
            resolvedBuildFiles.push(resolved);
          }
        };

        for (const activeWorkingDir of activeWorkingDirs) {
          const dirResolvedFiles = [];
          for (const rawFile of rawFiles) {
            const expanded = resolveImageTokenCandidates(
              rawFile,
              stepEnv,
              frame.vars,
              lineNumber,
              shellMode,
            );
            if (expanded.truncated) {
              const limitMsg = `${filePath}:${lineNumber}: ${rawFile} exceeds expansion limit and cannot be verified exhaustively`;
              if (!seenContextProblems.has(limitMsg)) {
                seenContextProblems.add(limitMsg);
                problems.push(limitMsg);
              }
            }
            for (const varCandidate of expanded.candidates) {
              for (const candidate of expandMatrixReferences(
                varCandidate.text,
                rowList,
                varCandidate.line,
              )) {
                const wsRel = resolveWorkspaceRelativePath(candidate.text, activeWorkingDir, {
                  windowsPath: isWindowsShell,
                  actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
                });
                const mappedTargets = resolveWorkspaceTargetsInRepo(
                  wsRel,
                  buildFileContext.root,
                  buildFileContext.checkoutPrefixes,
                  buildFileContext.foreignCheckoutPrefixes,
                ).filter((target) => target !== path.resolve(buildFileContext.root));
                if (mappedTargets.length === 0) {
                  if (
                    buildFileContext.deferUnresolvedInputs &&
                    referencesUnresolvedInput(candidate.text)
                  ) {
                    continue;
                  }
                  const unverifiableMsg = `${filePath}:${lineNumber}: build file ${candidate.text} cannot be verified statically`;
                  if (!seenContextProblems.has(unverifiableMsg)) {
                    seenContextProblems.add(unverifiableMsg);
                    problems.push(unverifiableMsg);
                  }
                  continue;
                }
                for (const resolvedPath of mappedTargets) {
                  const targetProblems = [];
                  const safeFile = resolveSafeContainerFile(
                    resolvedPath,
                    buildFileContext.root,
                    targetProblems,
                  );
                  if (safeFile) {
                    buildFileContext.explicitBuildFiles.add(resolvedPath);
                    dirResolvedFiles.push(resolvedPath);
                    pushResolvedFile(resolvedPath);
                  } else if (targetProblems.length > 0) {
                    buildFileContext.explicitBuildFiles.add(resolvedPath);
                  } else {
                    const unverifiableMsg = `${filePath}:${lineNumber}: build file ${candidate.text} cannot be verified statically`;
                    if (!seenContextProblems.has(unverifiableMsg)) {
                      seenContextProblems.add(unverifiableMsg);
                      problems.push(unverifiableMsg);
                    }
                  }
                }
              }
            }
          }

          if (rawFiles.length === 0 && dirResolvedFiles.length === 0) {
            const contextDirs = [];
            const seenContextDirs = new Set();
            let hadRemoteContext = false;
            let hadUnresolvableContext = false;
            if (contextArg) {
              const expandedCtx = resolveImageTokenCandidates(
                contextArg,
                stepEnv,
                frame.vars,
                lineNumber,
                shellMode,
              );
              if (expandedCtx.truncated) {
                const limitMsg = `${filePath}:${lineNumber}: ${contextArg} exceeds expansion limit and cannot be verified exhaustively`;
                if (!seenContextProblems.has(limitMsg)) {
                  seenContextProblems.add(limitMsg);
                  problems.push(limitMsg);
                }
              }
              for (const varCandidate of expandedCtx.candidates) {
                for (const candidate of expandMatrixReferences(
                  varCandidate.text,
                  rowList,
                  varCandidate.line,
                )) {
                  const ctxText = candidate.text.trim();
                  if (isRemoteBuildContext(ctxText)) {
                    hadRemoteContext = true;
                    continue;
                  }
                  const wsCtx = resolveWorkspaceRelativePath(ctxText, activeWorkingDir, {
                    windowsPath: isWindowsShell,
                    actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
                  });
                  const mappedCtxs = resolveWorkspaceTargetsInRepo(
                    wsCtx,
                    buildFileContext.root,
                    buildFileContext.checkoutPrefixes,
                    buildFileContext.foreignCheckoutPrefixes,
                  );
                  if (mappedCtxs.length > 0) {
                    for (const resolvedCtx of mappedCtxs) {
                      if (!seenContextDirs.has(resolvedCtx)) {
                        seenContextDirs.add(resolvedCtx);
                        contextDirs.push(resolvedCtx);
                      }
                    }
                  } else if (ctxText) {
                    hadUnresolvableContext = true;
                    if (
                      buildFileContext.deferUnresolvedInputs &&
                      referencesUnresolvedInput(ctxText)
                    ) {
                      continue;
                    }
                    const unverifiableMsg = `${filePath}:${lineNumber}: build context ${ctxText} cannot be verified statically`;
                    if (!seenContextProblems.has(unverifiableMsg)) {
                      seenContextProblems.add(unverifiableMsg);
                      problems.push(unverifiableMsg);
                    }
                  }
                }
              }
            }
            if (
              !contextArg &&
              !hadRemoteContext &&
              !hadUnresolvableContext &&
              contextDirs.length === 0
            ) {
              for (const resolvedCtx of resolveWorkspaceTargetsInRepo(
                activeWorkingDir,
                buildFileContext.root,
                buildFileContext.checkoutPrefixes,
                buildFileContext.foreignCheckoutPrefixes,
              )) {
                if (!seenContextDirs.has(resolvedCtx)) {
                  seenContextDirs.add(resolvedCtx);
                  contextDirs.push(resolvedCtx);
                }
              }
            }
            const defaultNames =
              normalizedCli === "podman" || normalizedCli === "buildah"
                ? ["Containerfile", "Dockerfile", "dockerfile"]
                : ["Dockerfile", "dockerfile"];
            for (const baseContext of contextDirs) {
              const candidateFile = findDefaultBuildFile(baseContext, defaultNames);
              let foundDefault = false;
              if (candidateFile) {
                const targetProblems = [];
                const safeFile = resolveSafeContainerFile(
                  candidateFile,
                  buildFileContext.root,
                  targetProblems,
                );
                if (safeFile) {
                  buildFileContext.explicitBuildFiles.add(candidateFile);
                  pushResolvedFile(candidateFile);
                  foundDefault = true;
                } else if (targetProblems.length > 0) {
                  buildFileContext.explicitBuildFiles.add(candidateFile);
                  foundDefault = true;
                }
              }
              if (!foundDefault) {
                const expectedPath = formatPortableRelativePath(
                  buildFileContext.root,
                  path.join(baseContext, defaultNames[0]),
                );
                const unverifiableMsg = `${filePath}:${lineNumber}: default build file ${expectedPath} cannot be verified statically`;
                if (!seenContextProblems.has(unverifiableMsg)) {
                  seenContextProblems.add(unverifiableMsg);
                  problems.push(unverifiableMsg);
                }
              }
            }
          }
        }

        for (const targetFile of resolvedBuildFiles) {
          recordBuildInvocation(
            targetFile,
            buildArgsMap,
            namedContexts,
            filePath,
            lineNumber,
            buildFileContext.buildInvocations,
            buildPlatforms,
          );
        }
      }
      if (usesStdinDockerfile && hasStdinHeredoc) {
        frame.pendingStdinBuilds.push({ lineNumber, invocations: stdinInvocations });
      }
      continue;
    }

    let subcommand = tokens[argIndex];

    let allowScratchOperand = false;
    if (normalizedCli === "buildah") {
      if (subcommand === "pull") {
        argIndex += 1;
      } else if (subcommand === "from") {
        subcommand = "run";
        allowScratchOperand = true;
        argIndex += 1;
      } else {
        continue;
      }
    } else if (subcommand === "image" && tokens[argIndex + 1] === "pull") {
      subcommand = "pull";
      argIndex += 2;
    } else if (
      subcommand === "container" &&
      (tokens[argIndex + 1] === "run" || tokens[argIndex + 1] === "create")
    ) {
      subcommand = "run";
      argIndex += 2;
    } else if (subcommand === "pull" || subcommand === "run" || subcommand === "create") {
      subcommand = subcommand === "create" ? "run" : subcommand;
      argIndex += 1;
    } else {
      continue;
    }

    const valueFlags =
      normalizedCli === "buildah"
        ? subcommand === "pull"
          ? BUILDAH_PULL_VALUE_FLAGS
          : BUILDAH_FROM_VALUE_FLAGS
        : normalizedCli === "podman"
          ? subcommand === "pull"
            ? PODMAN_PULL_VALUE_FLAGS
            : PODMAN_RUN_VALUE_FLAGS
          : subcommand === "pull"
            ? DOCKER_PULL_VALUE_FLAGS
            : DOCKER_RUN_VALUE_FLAGS;
    const allowMultipleImages = normalizedCli === "podman" && subcommand === "pull";
    const seenProblems = new Set();

    // Expand statically known shell option variables (e.g. `opts="--rm"` or
    // `opts="--platform linux/amd64"`) and Bash arrays (`"${args[@]}"`) before
    // scanning flags so option tokens are consumed and array-supplied images
    // are validated rather than skipped.
    let argTokenVariants = [[]];
    let argExpansionTruncated = false;
    const unknownArrayTokens = [];
    const BASH_ARRAY_EXPANSION_PATTERN = /^\$\{(?<name>[A-Za-z_][A-Za-z0-9_]*)\[(?:@|\*)\]\}$/u;
    for (let index = argIndex; index < tokens.length; index += 1) {
      const token = tokens[index];
      const isSingleQuoted = Boolean(peeledSingleQuoted[index]);
      const isAnyQuoted = Boolean(peeledQuoted[index]);
      const arrayExpMatch = !isSingleQuoted ? BASH_ARRAY_EXPANSION_PATTERN.exec(token) : null;
      const isArrayExpansion =
        Boolean(arrayExpMatch) ||
        (token.startsWith("${") && (token.includes("[@]") || token.includes("[*]")));
      const fallbackLine = sourceLines
        ? (sourceLines.find((entry) => entry.text.includes(token))?.lineNumber ?? lineNumber)
        : lineNumber;
      const mayContainVar =
        !isSingleQuoted &&
        !isArrayExpansion &&
        (token.includes("$") || (shellMode === "cmd" && CMD_VAR_PATTERN.test(token)));
      CMD_VAR_PATTERN.lastIndex = 0;

      let expandedSlices = null;
      if (arrayExpMatch) {
        const knownArrayEntry = frame.arrays.get(arrayExpMatch.groups.name);
        if (knownArrayEntry && knownArrayEntry.variants.length > 0) {
          if (knownArrayEntry.truncated) {
            const limitMessage = `${filePath}:${fallbackLine}: ${token} exceeds expansion limit and cannot be verified exhaustively`;
            if (!seenProblems.has(limitMessage)) {
              seenProblems.add(limitMessage);
              problems.push(limitMessage);
            }
          }
          expandedSlices = knownArrayEntry.variants;
        } else {
          unknownArrayTokens.push(token);
        }
      } else if (mayContainVar) {
        const varExpanded = resolveImageTokenCandidates(
          token,
          stepEnv,
          frame.vars,
          fallbackLine,
          shellMode,
        );
        const affectsOptionParsing = varExpanded.candidates.some(
          (candidate) =>
            !isDynamicReference(candidate.text, shellMode) &&
            (candidate.text.startsWith("-") ||
              candidate.text.length === 0 ||
              (!isAnyQuoted && /\s/u.test(candidate.text))),
        );
        if (affectsOptionParsing) {
          if (varExpanded.truncated) {
            const limitMessage = `${filePath}:${fallbackLine}: ${token} exceeds expansion limit and cannot be verified exhaustively`;
            if (!seenProblems.has(limitMessage)) {
              seenProblems.add(limitMessage);
              problems.push(limitMessage);
            }
          }
          expandedSlices = [];
          const seenSliceKeys = new Set();
          for (const candidate of varExpanded.candidates) {
            const parts = isAnyQuoted
              ? [{ text: candidate.text, line: candidate.line, preExpanded: true }]
              : candidate.text.trim().length > 0
                ? candidate.text
                    .trim()
                    .split(/\s+/u)
                    .map((part) => ({ text: part, line: candidate.line, preExpanded: true }))
                : [];
            const key = parts.map((part) => `${part.line}:${part.text}`).join("\0");
            if (!seenSliceKeys.has(key)) {
              seenSliceKeys.add(key);
              expandedSlices.push(parts);
            }
          }
        }
      }

      if (expandedSlices) {
        const nextVariants = [];
        for (const existing of argTokenVariants) {
          for (const slice of expandedSlices) {
            if (nextVariants.length >= MAX_TOKEN_EXPANSIONS) {
              argExpansionTruncated = true;
              break;
            }
            nextVariants.push([...existing, ...slice]);
          }
          if (argExpansionTruncated) {
            break;
          }
        }
        argTokenVariants = nextVariants;
      } else {
        for (const existing of argTokenVariants) {
          existing.push({ text: token, line: fallbackLine, preExpanded: false });
        }
      }
    }

    if (argExpansionTruncated) {
      const limitMessage = `${filePath}:${lineNumber}: container command arguments exceed expansion limit and cannot be verified exhaustively`;
      if (!seenProblems.has(limitMessage)) {
        seenProblems.add(limitMessage);
        problems.push(limitMessage);
      }
    }

    const imageEntries = [];
    const seenImageEntries = new Set();
    const pushImageEntry = (entry) => {
      const key = `${entry.preExpanded ? "1" : "0"}:${entry.line}:${entry.text}`;
      if (!seenImageEntries.has(key)) {
        seenImageEntries.add(key);
        imageEntries.push(entry);
      }
    };
    const mountEntries = [];
    const seenMountEntries = new Set();
    const pushMountEntry = (entry) => {
      const key = `${entry.preExpanded ? "1" : "0"}:${entry.line}:${entry.text}`;
      if (!seenMountEntries.has(key)) {
        seenMountEntries.add(key);
        mountEntries.push(entry);
      }
    };

    for (const argList of argTokenVariants) {
      for (let index = 0; index < argList.length; index += 1) {
        const entry = argList[index];
        const token = entry.text;
        if (token === "--") {
          if (allowMultipleImages) {
            for (let restIndex = index + 1; restIndex < argList.length; restIndex += 1) {
              const restToken = argList[restIndex].text;
              if (
                restToken === ">" ||
                restToken === ">>" ||
                restToken === ">&" ||
                restToken === "<"
              ) {
                restIndex += 1;
                continue;
              }
              pushImageEntry(argList[restIndex]);
            }
          } else if (argList[index + 1] !== undefined) {
            pushImageEntry(argList[index + 1]);
          }
          break;
        }
        if (token === ">" || token === ">>" || token === ">&" || token === "<") {
          index += 1;
          continue;
        }
        if (
          /^\d+$/u.test(token) &&
          (argList[index + 1]?.text === ">" ||
            argList[index + 1]?.text === ">>" ||
            argList[index + 1]?.text === ">&")
        ) {
          index += 2;
          continue;
        }
        if (token.startsWith("${") && (token.includes("[@]") || token.includes("[*]"))) {
          continue;
        }
        if (subcommand === "run" && normalizedCli !== "buildah") {
          if (token === "--mount") {
            if (argList[index + 1] !== undefined) {
              pushMountEntry(argList[index + 1]);
            }
            index += 1;
            continue;
          }
          if (token.startsWith("--mount=")) {
            pushMountEntry({
              text: token.slice("--mount=".length),
              line: entry.line,
              preExpanded: entry.preExpanded,
            });
            continue;
          }
        }
        if (token.startsWith("-")) {
          if (flagConsumesNextArg(token, valueFlags)) {
            index += 1;
          }
          continue;
        }
        pushImageEntry(entry);
        if (!allowMultipleImages) {
          break;
        }
      }
    }

    const allowLocalImageId = subcommand === "run";
    for (const mountEntry of mountEntries) {
      const mountToken = mountEntry.text;
      const fallbackLine = mountEntry.line;
      const mountExpanded = mountEntry.preExpanded
        ? { candidates: [{ text: mountToken, line: fallbackLine }], truncated: false }
        : resolveImageTokenCandidates(mountToken, stepEnv, frame.vars, fallbackLine, shellMode);
      if (mountExpanded.truncated) {
        const limitMessage = `${filePath}:${fallbackLine}: ${mountToken} exceeds expansion limit and cannot be verified exhaustively`;
        if (!seenProblems.has(limitMessage)) {
          seenProblems.add(limitMessage);
          problems.push(limitMessage);
        }
      }
      for (const varCandidate of mountExpanded.candidates) {
        for (const candidate of expandMatrixReferences(
          varCandidate.text,
          matrixRows,
          varCandidate.line,
        )) {
          for (const mountImageRef of extractRunMountImageSources(candidate.text)) {
            if (!mountImageRef || isDynamicReference(mountImageRef, shellMode)) {
              continue;
            }
            const isValid =
              isPinnedDigest(mountImageRef) ||
              (allowLocalImageId && LOCAL_IMAGE_ID_PATTERN.test(mountImageRef));
            if (!isValid) {
              const message = `${filePath}:${candidate.line}: ${mountImageRef} is not pinned to a sha256 digest`;
              if (!seenProblems.has(message)) {
                seenProblems.add(message);
                problems.push(message);
              }
            }
          }
        }
      }
    }

    if (imageEntries.length === 0) {
      if (unknownArrayTokens.length > 0) {
        problems.push(
          `${filePath}:${lineNumber}: container image operand in ${unknownArrayTokens[0]} cannot be verified statically`,
        );
      }
      continue;
    }

    for (const imageEntry of imageEntries) {
      const imageToken = imageEntry.text;
      const fallbackLine = imageEntry.line;

      const varExpanded = imageEntry.preExpanded
        ? { candidates: [{ text: imageToken, line: fallbackLine }], truncated: false }
        : resolveImageTokenCandidates(imageToken, stepEnv, frame.vars, fallbackLine, shellMode);
      if (varExpanded.truncated) {
        const limitMessage = `${filePath}:${fallbackLine}: ${imageToken} exceeds expansion limit and cannot be verified exhaustively`;
        if (!seenProblems.has(limitMessage)) {
          seenProblems.add(limitMessage);
          problems.push(limitMessage);
        }
      }
      for (const varCandidate of varExpanded.candidates) {
        for (const candidate of expandMatrixReferences(
          varCandidate.text,
          matrixRows,
          varCandidate.line,
        )) {
          if (!candidate.text || isDynamicReference(candidate.text, shellMode)) {
            continue;
          }
          if (allowScratchOperand && candidate.text.toLowerCase() === "scratch") {
            continue;
          }
          const isValid =
            isPinnedDigest(candidate.text) ||
            (allowLocalImageId && LOCAL_IMAGE_ID_PATTERN.test(candidate.text));
          if (!isValid) {
            const message = `${filePath}:${candidate.line}: ${candidate.text} is not pinned to a sha256 digest`;
            if (!seenProblems.has(message)) {
              seenProblems.add(message);
              problems.push(message);
            }
          }
        }
      }
    }
  }
}

function inspectShellRunScript(
  runNode,
  stepEnv,
  matrixRows,
  filePath,
  problems,
  emittedGithubEnv = null,
  shellMode = "posix",
  buildFileContext = null,
) {
  const scriptText =
    runNode.folded && Array.isArray(runNode.lines)
      ? runNode.value
      : Array.isArray(runNode.lines)
        ? runNode.lines.map((entry) => entry.text).join("\n")
        : String(runNode.value);
  const sourceLines = runNode.folded && Array.isArray(runNode.lines) ? runNode.lines : null;

  let initialShellVars = stepEnv;
  if (shellMode === "pwsh") {
    initialShellVars = new Map();
    for (const [key, entries] of stepEnv) {
      initialShellVars.set(`env:${key}`, [...entries]);
    }
  }

  // GitHub Actions substitutes `${{ matrix.* }}` and `${{ env.* }}` expressions
  // into the `run:` script before the shell parses arguments. Expand statically
  // known expressions prior to lexing so values like `--platform linux/amd64`
  // or `--rm` tokenize as flags instead of being mistaken for the image operand.
  const hasMatrixExpr =
    matrixRows.length > 0 && new RegExp(MATRIX_EXPRESSION_PATTERN.source, "iu").test(scriptText);
  const hasEnvExpr =
    stepEnv.size > 0 && new RegExp(ENV_EXPRESSION_PATTERN.source, "iu").test(scriptText);
  if (hasMatrixExpr || hasEnvExpr) {
    const seenStepProblems = new Set();
    const perRunEmitted = [];
    const substituteMatrixForRow = (text, row) =>
      text.replace(MATRIX_EXPRESSION_PATTERN, (match, _p1, _offset, _str, groups) => {
        const resolved = resolveMatrixPath(row, parseMatrixPathSegments(groups.path));
        return resolved ? resolved.value : match;
      });

    const effectiveRows = hasMatrixExpr ? matrixRows : [null];
    for (const row of effectiveRows) {
      const rowScript = row ? substituteMatrixForRow(scriptText, row) : scriptText;
      const rowSourceLines =
        row && sourceLines
          ? sourceLines.map((entry) => ({
              ...entry,
              text: substituteMatrixForRow(entry.text, row),
            }))
          : sourceLines;

      let scriptVariants = [rowScript];
      if (hasEnvExpr && new RegExp(ENV_EXPRESSION_PATTERN.source, "iu").test(rowScript)) {
        const expandedEnv = resolveEnvExpressionCandidates(rowScript, stepEnv, runNode.line);
        if (expandedEnv.truncated) {
          const limitMessage = `${filePath}:${runNode.line}: run script env expression exceeds expansion limit and cannot be verified exhaustively`;
          if (!seenStepProblems.has(limitMessage)) {
            seenStepProblems.add(limitMessage);
            problems.push(limitMessage);
          }
        }
        scriptVariants = expandedEnv.candidates.map((candidate) => candidate.text);
      }

      for (const expandedScript of scriptVariants) {
        const rowProblems = [];
        const rowEmitted = emittedGithubEnv ? new Map() : null;
        inspectShellText(
          expandedScript,
          runNode.line,
          rowSourceLines,
          stepEnv,
          initialShellVars,
          row ? [row] : matrixRows,
          filePath,
          rowProblems,
          rowEmitted,
          shellMode,
          0,
          buildFileContext,
        );
        for (const problem of rowProblems) {
          if (!seenStepProblems.has(problem)) {
            problems.push(problem);
          }
        }
        for (const problem of rowProblems) {
          seenStepProblems.add(problem);
        }
        if (rowEmitted) {
          perRunEmitted.push(rowEmitted);
        }
      }
    }

    if (emittedGithubEnv && perRunEmitted.length > 0) {
      const allKeys = new Set();
      for (const rowMap of perRunEmitted) {
        for (const key of rowMap.keys()) {
          allKeys.add(key);
        }
      }
      for (const key of allKeys) {
        let mergedEntries = [];
        let conditionalAcrossRuns = false;
        for (const rowMap of perRunEmitted) {
          const record = rowMap.get(key);
          if (!record) {
            conditionalAcrossRuns = true;
            continue;
          }
          if (record.conditional) {
            conditionalAcrossRuns = true;
          }
          mergedEntries = mergeVarEntries(mergedEntries, record.entries);
        }
        if (mergedEntries.length > 0) {
          recordGithubEnvWrite(emittedGithubEnv, key, mergedEntries, conditionalAcrossRuns);
        }
      }
    }
    return;
  }

  inspectShellText(
    scriptText,
    runNode.line,
    sourceLines,
    stepEnv,
    initialShellVars,
    matrixRows,
    filePath,
    problems,
    emittedGithubEnv,
    shellMode,
    0,
    buildFileContext,
  );
}

function extractEnvMap(envNode, baseEnv) {
  const merged = cloneVarMap(baseEnv);
  if (envNode?.kind !== "map") {
    return merged;
  }
  for (const [key, valueNode] of envNode.value) {
    if (valueNode?.kind === "scalar") {
      merged.set(key, [{ value: String(valueNode.value), line: valueNode.line }]);
    }
  }
  return merged;
}

function checkImageField(
  node,
  envMap,
  matrixRows,
  filePath,
  problems,
  { allowLocalDockerAction = false } = {},
) {
  if (node?.kind !== "scalar") {
    return;
  }
  const rawRef = String(node.value).trim();
  const seenProblems = new Set();
  const envExpanded = resolveEnvExpressionCandidates(rawRef, envMap, node.line);
  if (envExpanded.truncated) {
    const limitMessage = `${filePath}:${node.line}: ${rawRef} exceeds expansion limit and cannot be verified exhaustively`;
    seenProblems.add(limitMessage);
    problems.push(limitMessage);
  }
  for (const envCandidate of envExpanded.candidates) {
    for (const candidate of expandMatrixReferences(
      envCandidate.text,
      matrixRows,
      envCandidate.line,
    )) {
      const imageRef = candidate.text.trim();
      if (!imageRef || isDynamicReference(imageRef)) {
        continue;
      }
      if (allowLocalDockerAction && isLocalDockerActionImage(imageRef)) {
        continue;
      }
      if (!isPinnedDigest(imageRef)) {
        const message = `${filePath}:${candidate.line}: ${imageRef} is not pinned to a sha256 digest`;
        if (!seenProblems.has(message)) {
          seenProblems.add(message);
          problems.push(message);
        }
      }
    }
  }
}

function resolveWorkingDirsForRow(
  stepWorkingDirNode,
  defaultWorkingDir,
  stepEnv,
  row,
  root,
  windowsPath = false,
  actionWsRelDir = null,
) {
  if (!root) {
    return [null];
  }
  const rawDir =
    stepWorkingDirNode?.kind === "scalar"
      ? String(stepWorkingDirNode.value).trim()
      : defaultWorkingDir;
  if (!rawDir) {
    return [""];
  }
  const line = stepWorkingDirNode?.line ?? 1;
  const rowList = row ? [row] : [];
  const dirs = [];
  const seen = new Set();
  for (const envCandidate of resolveEnvExpressionCandidates(rawDir, stepEnv, line).candidates) {
    for (const candidate of expandMatrixReferences(envCandidate.text, rowList, envCandidate.line)) {
      const resolved = resolveWorkspaceRelativePath(candidate.text, "", {
        windowsPath,
        actionWsRelDir,
      });
      if (resolved !== null && !seen.has(resolved)) {
        seen.add(resolved);
        dirs.push(resolved);
      }
    }
  }
  return dirs.length > 0 ? dirs : [""];
}

function resolveStepExecutionGroups(
  stepShellNode,
  explicitDefaultShell,
  stepWorkingDirNode,
  defaultWorkingDir,
  getRowStepEnv,
  applicableContexts,
  matrixRows,
  root,
  actionWsRelDir = null,
) {
  const expandShellTemplate = (template, fallbackLine, row, rowStepEnv) => {
    const rowList = row ? [row] : [];
    const modes = [];
    for (const envCandidate of resolveEnvExpressionCandidates(template, rowStepEnv, fallbackLine)
      .candidates) {
      for (const candidate of expandMatrixReferences(
        envCandidate.text,
        rowList,
        envCandidate.line,
      )) {
        modes.push(normalizeShellMode(candidate.text));
      }
    }
    return modes.length > 0 ? modes : ["posix"];
  };

  const groups = new Map();
  const contexts =
    applicableContexts.length > 0
      ? applicableContexts
      : matrixRows.length > 0
        ? matrixRows.map((row) => ({ row, runnerOs: null, defaultShell: "posix" }))
        : [{ row: null, runnerOs: null, defaultShell: "posix" }];

  for (const ctx of contexts) {
    const rowStepEnv = getRowStepEnv(ctx.row);
    let modes;
    if (stepShellNode?.kind === "scalar") {
      modes = expandShellTemplate(
        String(stepShellNode.value).trim(),
        stepShellNode.line,
        ctx.row,
        rowStepEnv,
      );
    } else if (explicitDefaultShell) {
      modes = expandShellTemplate(explicitDefaultShell, 1, ctx.row, rowStepEnv);
    } else {
      modes = [ctx.defaultShell];
    }
    const workingDirs = resolveWorkingDirsForRow(
      stepWorkingDirNode,
      defaultWorkingDir,
      rowStepEnv,
      ctx.row,
      root,
      ctx.runnerOs === "Windows",
      actionWsRelDir,
    );
    for (const mode of modes) {
      for (const workingDir of workingDirs) {
        const key = `${mode}\0${workingDir ?? ""}`;
        if (!groups.has(key)) {
          groups.set(key, { shellMode: mode, workingDir, rows: [] });
        }
        if (ctx.row !== null) {
          groups.get(key).rows.push(ctx.row);
        }
      }
    }
  }

  return [...groups.values()];
}

function checkStepsList(
  stepsNode,
  baseEnv,
  matrixRows,
  filePath,
  problems,
  explicitDefaultShell = null,
  runnerContexts = [],
  buildFileContext = null,
  defaultWorkingDir = null,
  emittedGithubEnv = null,
) {
  if (stepsNode?.kind !== "seq") {
    return;
  }
  const allRows = matrixRows.length > 0 ? matrixRows : [null];
  const rowRunningEnvs = new Map();
  const rowCheckoutPaths = new Map();
  const rowForeignCheckoutPaths = new Map();
  const rowHasExplicitCheckout = new Set();
  const rowWrittenEnvKeys = new Map();
  const initialCheckoutPrefixes =
    buildFileContext?.checkoutPrefixes !== undefined && buildFileContext?.checkoutPrefixes !== null
      ? [...buildFileContext.checkoutPrefixes]
      : [""];
  const initialForeignPrefixes = Array.isArray(buildFileContext?.foreignCheckoutPrefixes)
    ? [...buildFileContext.foreignCheckoutPrefixes]
    : [];
  for (const row of allRows) {
    rowRunningEnvs.set(row, cloneVarMap(baseEnv));
    rowCheckoutPaths.set(row, [...initialCheckoutPrefixes]);
    rowForeignCheckoutPaths.set(row, [...initialForeignPrefixes]);
    rowWrittenEnvKeys.set(row, new Map());
  }
  for (const stepNode of stepsNode.value) {
    if (stepNode?.kind !== "map") {
      continue;
    }
    const stepEnvNode = getMapField(stepNode, "env");
    const getRowStepEnv = (row) => extractEnvMap(stepEnvNode, rowRunningEnvs.get(row) ?? baseEnv);
    const getRowCheckoutPrefixes = (row) =>
      rowCheckoutPaths.get(row) ?? [...initialCheckoutPrefixes];
    const getRowForeignPrefixes = (row) =>
      rowForeignCheckoutPaths.get(row) ?? [...initialForeignPrefixes];
    const stepIfNode = getMapField(stepNode, "if");
    const stepConditional = stepIfNode !== null;
    const stepShellNode = getMapField(stepNode, "shell");
    const stepWorkingDirNode = getMapField(stepNode, "working-directory");
    const applicableContexts = filterRunnerContextsForStep(stepIfNode, runnerContexts);
    if (runnerContexts.length > 0 && applicableContexts.length === 0) {
      continue;
    }
    const applicableMatrixRows =
      applicableContexts.length > 0 && applicableContexts.every((ctx) => ctx.row !== null)
        ? applicableContexts.map((ctx) => ctx.row)
        : matrixRows;
    const perRowEmittedEnv = new Map();

    const usesNode = getMapField(stepNode, "uses");
    const withNode = getMapField(stepNode, "with");
    if (
      usesNode?.kind === "scalar" &&
      /^actions\/checkout@/iu.test(String(usesNode.value).trim())
    ) {
      const repoNode = getMapField(withNode, "repository");
      const refNode = getMapField(withNode, "ref");
      const pathNode = getMapField(withNode, "path");
      const checkoutRows = applicableMatrixRows.length > 0 ? applicableMatrixRows : [null];
      for (const row of checkoutRows) {
        const rowStepEnv = getRowStepEnv(row);
        const rowList = row ? [row] : [];
        let checksOutCurrentRepo = true;
        if (repoNode?.kind === "scalar") {
          const rawRepo = String(repoNode.value).trim();
          if (rawRepo) {
            const expandedRepos = resolveEnvExpressionCandidates(
              rawRepo,
              rowStepEnv,
              repoNode.line,
            ).candidates.flatMap((envCandidate) =>
              expandMatrixReferences(envCandidate.text, rowList, envCandidate.line),
            );
            checksOutCurrentRepo =
              expandedRepos.length > 0 &&
              expandedRepos.every((candidate) =>
                /^\$\{\{\s*github\.repository\s*\}\}$/iu.test(candidate.text.trim()),
              );
          }
        }
        let checksOutCurrentRef = true;
        if (refNode?.kind === "scalar") {
          const rawRef = String(refNode.value).trim();
          if (rawRef) {
            const expandedRefs = resolveEnvExpressionCandidates(
              rawRef,
              rowStepEnv,
              refNode.line,
            ).candidates.flatMap((envCandidate) =>
              expandMatrixReferences(envCandidate.text, rowList, envCandidate.line),
            );
            checksOutCurrentRef =
              expandedRefs.length > 0 &&
              expandedRefs.every((candidate) =>
                /^\$\{\{\s*github\.sha\s*\}\}$/iu.test(candidate.text.trim()),
              );
          }
        }
        const nextPrefixes = [];
        const seenNext = new Set();
        if (pathNode?.kind === "scalar" && String(pathNode.value).trim()) {
          const rawCheckoutPath = String(pathNode.value).trim();
          for (const envCandidate of resolveEnvExpressionCandidates(
            rawCheckoutPath,
            rowStepEnv,
            pathNode.line,
          ).candidates) {
            for (const candidate of expandMatrixReferences(
              envCandidate.text,
              rowList,
              envCandidate.line,
            )) {
              const normalizedPrefix = normalizeCheckoutSubdir(candidate.text);
              if (normalizedPrefix !== null && !seenNext.has(normalizedPrefix)) {
                seenNext.add(normalizedPrefix);
                nextPrefixes.push(normalizedPrefix);
              }
            }
          }
        } else {
          nextPrefixes.push("");
        }
        const existingPrefixes = getRowCheckoutPrefixes(row);
        const existingForeign = getRowForeignPrefixes(row);
        const isCurrentTreeCheckout = checksOutCurrentRepo && checksOutCurrentRef;
        if (isCurrentTreeCheckout) {
          if (nextPrefixes.length === 0) {
            if (!stepConditional && !rowHasExplicitCheckout.has(row)) {
              rowCheckoutPaths.set(row, []);
              rowHasExplicitCheckout.add(row);
            }
            continue;
          }
          if (!stepConditional && !rowHasExplicitCheckout.has(row)) {
            rowCheckoutPaths.set(row, nextPrefixes);
            rowHasExplicitCheckout.add(row);
          } else {
            const merged = [...existingPrefixes];
            const seenMerged = new Set(merged);
            for (const prefix of nextPrefixes) {
              if (!seenMerged.has(prefix)) {
                seenMerged.add(prefix);
                merged.push(prefix);
              }
            }
            rowCheckoutPaths.set(row, merged);
            if (!stepConditional) {
              rowHasExplicitCheckout.add(row);
            }
          }
          if (!stepConditional && existingForeign.length > 0) {
            rowForeignCheckoutPaths.set(
              row,
              existingForeign.filter(
                (foreignPrefix) =>
                  !nextPrefixes.some((prefix) => matchesWorkspacePrefix(foreignPrefix, prefix)),
              ),
            );
          }
        } else {
          const foreignTargets = nextPrefixes.length > 0 ? nextPrefixes : [""];
          const mergedForeign = [...existingForeign];
          const seenForeign = new Set(mergedForeign);
          for (const prefix of foreignTargets) {
            if (!seenForeign.has(prefix)) {
              seenForeign.add(prefix);
              mergedForeign.push(prefix);
            }
          }
          rowForeignCheckoutPaths.set(row, mergedForeign);
          if (!stepConditional) {
            if (!rowHasExplicitCheckout.has(row)) {
              rowCheckoutPaths.set(row, []);
              rowHasExplicitCheckout.add(row);
            } else {
              rowCheckoutPaths.set(
                row,
                existingPrefixes.filter(
                  (prefix) =>
                    !foreignTargets.some((foreignPrefix) =>
                      matchesWorkspacePrefix(prefix, foreignPrefix),
                    ),
                ),
              );
            }
          }
        }
      }
    } else if (
      usesNode?.kind === "scalar" &&
      /^docker\/bake-action@/iu.test(String(usesNode.value).trim())
    ) {
      problems.push(
        `${filePath}:${usesNode.line}: docker/bake-action target definitions cannot be verified statically for container image digests`,
      );
    } else if (
      usesNode?.kind === "scalar" &&
      /^docker\/setup-buildx-action@/iu.test(String(usesNode.value).trim())
    ) {
      const driverNode = getMapField(withNode, "driver");
      const driverOptsNode = getMapField(withNode, "driver-opts");
      const actionRows = applicableMatrixRows.length > 0 ? applicableMatrixRows : [null];
      const seenBuildxProblems = new Set();
      const pushBuildxProblem = (message) => {
        if (!seenBuildxProblems.has(message)) {
          seenBuildxProblems.add(message);
          problems.push(message);
        }
      };

      for (const row of actionRows) {
        const rowStepEnv = getRowStepEnv(row);
        const rowList = row ? [row] : [];
        const rawDriver = driverNode?.kind === "scalar" ? String(driverNode.value).trim() : "";
        const driverCandidates = rawDriver
          ? resolveEnvExpressionCandidates(
              rawDriver,
              rowStepEnv,
              driverNode.line,
            ).candidates.flatMap((envCandidate) =>
              expandMatrixReferences(envCandidate.text, rowList, envCandidate.line),
            )
          : [{ text: "docker-container", line: usesNode.line }];

        const usesContainerDriver = driverCandidates.some((candidate) => {
          const normalizedDriver = candidate.text.trim().toLowerCase();
          return (
            normalizedDriver === "" ||
            normalizedDriver === "docker-container" ||
            normalizedDriver === "kubernetes"
          );
        });
        if (!usesContainerDriver) {
          continue;
        }

        let effectiveImageCandidates = [];
        if (driverOptsNode?.kind === "scalar") {
          for (const rawLine of String(driverOptsNode.value).split(/\r?\n/u)) {
            const trimmedLine = rawLine.trim();
            if (!trimmedLine || trimmedLine.startsWith("#")) {
              continue;
            }
            const expandedOpt = resolveEnvExpressionCandidates(
              trimmedLine,
              rowStepEnv,
              driverOptsNode.line,
            );
            if (expandedOpt.truncated) {
              pushBuildxProblem(
                `${filePath}:${driverOptsNode.line}: ${trimmedLine} exceeds expansion limit and cannot be verified exhaustively`,
              );
            }
            const lineImages = [];
            for (const envCandidate of expandedOpt.candidates) {
              for (const candidate of expandMatrixReferences(
                envCandidate.text,
                rowList,
                envCandidate.line,
              )) {
                for (const imageRef of extractDriverOptImages(candidate.text)) {
                  lineImages.push({ text: imageRef, line: candidate.line });
                }
              }
            }
            if (lineImages.length > 0) {
              effectiveImageCandidates = lineImages;
            }
          }
        }

        if (effectiveImageCandidates.length === 0) {
          pushBuildxProblem(
            `${filePath}:${usesNode.line}: docker/setup-buildx-action uses unpinned default BuildKit image (pin driver-opts image=...@sha256:...)`,
          );
          continue;
        }

        for (const imageCandidate of effectiveImageCandidates) {
          const imageRef = imageCandidate.text.trim();
          if (!imageRef) {
            pushBuildxProblem(
              `${filePath}:${usesNode.line}: docker/setup-buildx-action uses unpinned default BuildKit image (pin driver-opts image=...@sha256:...)`,
            );
            continue;
          }
          if (!isDynamicReference(imageRef) && !isPinnedDigest(imageRef)) {
            pushBuildxProblem(
              `${filePath}:${imageCandidate.line}: ${imageRef} is not pinned to a sha256 digest`,
            );
          }
        }
      }
    } else if (
      usesNode?.kind === "scalar" &&
      /^docker\/build-push-action@/iu.test(String(usesNode.value).trim())
    ) {
      const fileNode = getMapField(withNode, "file");
      const contextNode = getMapField(withNode, "context");
      const buildArgsNode = getMapField(withNode, "build-args");
      const buildContextsNode = getMapField(withNode, "build-contexts");
      const platformsNode = getMapField(withNode, "platforms");
      const actionRows = applicableMatrixRows.length > 0 ? applicableMatrixRows : [null];
      const seenActionContextProblems = new Set();
      const seenActionSyntaxProblems = new Set();

      for (const row of actionRows) {
        const rowStepEnv = getRowStepEnv(row);
        const rowList = row ? [row] : [];
        const namedContexts = new Set();
        if (buildContextsNode?.kind === "scalar") {
          const contextProblems = [];
          for (const rawLine of String(buildContextsNode.value).split(/\r?\n/u)) {
            const trimmedLine = rawLine.trim();
            if (!trimmedLine || trimmedLine.startsWith("#")) {
              continue;
            }
            inspectBuildContextSpec(
              trimmedLine,
              rowStepEnv,
              rowStepEnv,
              rowList,
              filePath,
              buildContextsNode.line,
              "posix",
              contextProblems,
              namedContexts,
            );
          }
          for (const message of contextProblems) {
            if (!seenActionContextProblems.has(message)) {
              seenActionContextProblems.add(message);
              problems.push(message);
            }
          }
        }
        const actionBuildArgs = new Map();
        if (buildArgsNode?.kind === "scalar") {
          for (const rawLine of String(buildArgsNode.value).split(/\r?\n/u)) {
            const trimmedLine = rawLine.trim();
            if (!trimmedLine || trimmedLine.startsWith("#")) {
              continue;
            }
            const parsedArg = expandBuildArgSpec(
              trimmedLine,
              rowStepEnv,
              rowStepEnv,
              rowStepEnv,
              rowList,
              buildArgsNode.line,
              "posix",
            );
            if (parsedArg) {
              actionBuildArgs.set(parsedArg.name, {
                values: parsedArg.values,
                truncated: parsedArg.truncated,
              });
            }
          }
        }
        const actionPlatforms = [];
        const seenActionPlatforms = new Set();
        if (platformsNode?.kind === "scalar") {
          const expandedPlatforms = resolveEnvExpressionCandidates(
            String(platformsNode.value),
            rowStepEnv,
            platformsNode.line,
          );
          for (const envCandidate of expandedPlatforms.candidates) {
            for (const candidate of expandMatrixReferences(
              envCandidate.text,
              rowList,
              envCandidate.line,
            )) {
              for (const platformEntry of splitPlatformEntries(candidate.text)) {
                if (!seenActionPlatforms.has(platformEntry)) {
                  seenActionPlatforms.add(platformEntry);
                  actionPlatforms.push(platformEntry);
                }
              }
            }
          }
        }
        const invocationLine = buildArgsNode?.line ?? buildContextsNode?.line ?? usesNode.line;
        if (actionBuildArgs.has("BUILDKIT_SYNTAX")) {
          const actionSyntaxProblems = [];
          checkBuildkitSyntaxOverride(
            actionBuildArgs.get("BUILDKIT_SYNTAX"),
            filePath,
            invocationLine,
            actionSyntaxProblems,
          );
          for (const message of actionSyntaxProblems) {
            if (!seenActionSyntaxProblems.has(message)) {
              seenActionSyntaxProblems.add(message);
              problems.push(message);
            }
          }
        }
        if (!buildFileContext) {
          continue;
        }

        // Resolve build contexts before explicit/default files so Git contexts
        // (`{{defaultContext}}:subdir`) resolve `with.file` relative to their
        // subdirectory while local builds translate through the active checkout
        // path for the current repository.
        const rowCheckoutPrefixes = getRowCheckoutPrefixes(row);
        const rowForeignPrefixes = getRowForeignPrefixes(row);
        const resolvedContexts = [];
        const seenContexts = new Set();
        let hadExplicitContext = false;
        if (contextNode?.kind === "scalar") {
          const rawContext = String(contextNode.value).trim();
          if (rawContext) {
            hadExplicitContext = true;
            const expandedContext = resolveEnvExpressionCandidates(
              rawContext,
              rowStepEnv,
              contextNode.line,
            );
            if (expandedContext.truncated) {
              const limitMsg = `${filePath}:${contextNode.line}: ${rawContext} exceeds expansion limit and cannot be verified exhaustively`;
              if (!seenActionContextProblems.has(limitMsg)) {
                seenActionContextProblems.add(limitMsg);
                problems.push(limitMsg);
              }
            }
            for (const envCandidate of expandedContext.candidates) {
              for (const candidate of expandMatrixReferences(
                envCandidate.text,
                rowList,
                envCandidate.line,
              )) {
                const ctxText = candidate.text.trim();
                const defaultCtxMatch = /^\{\{defaultContext\}\}(?::(?<subdir>.*))?$/iu.exec(
                  ctxText,
                );
                if (defaultCtxMatch) {
                  const localPath = defaultCtxMatch.groups.subdir?.trim() || ".";
                  const resolvedDir = resolveContainedPath(
                    localPath,
                    buildFileContext.root,
                    buildFileContext.root,
                  );
                  if (resolvedDir) {
                    const ctxKey = `git\0${resolvedDir}`;
                    if (!seenContexts.has(ctxKey)) {
                      seenContexts.add(ctxKey);
                      resolvedContexts.push({ kind: "git", dir: resolvedDir });
                    }
                  } else if (ctxText) {
                    if (
                      buildFileContext.deferUnresolvedInputs &&
                      referencesUnresolvedInput(ctxText)
                    ) {
                      continue;
                    }
                    const unverifiableMsg = `${filePath}:${candidate.line}: build context ${ctxText} cannot be verified statically`;
                    if (!seenActionContextProblems.has(unverifiableMsg)) {
                      seenActionContextProblems.add(unverifiableMsg);
                      problems.push(unverifiableMsg);
                    }
                  }
                  continue;
                }
                if (isRemoteBuildContext(ctxText)) {
                  const unverifiableMsg = `${filePath}:${candidate.line}: build context ${ctxText} cannot be verified statically`;
                  if (!seenActionContextProblems.has(unverifiableMsg)) {
                    seenActionContextProblems.add(unverifiableMsg);
                    problems.push(unverifiableMsg);
                  }
                  continue;
                }
                const wsDir = resolveWorkspaceRelativePath(ctxText, "", {
                  actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
                });
                const mappedDirs = resolveWorkspaceTargetsInRepo(
                  wsDir,
                  buildFileContext.root,
                  rowCheckoutPrefixes,
                  rowForeignPrefixes,
                );
                if (mappedDirs.length > 0) {
                  for (const resolvedDir of mappedDirs) {
                    const ctxKey = `local\0${resolvedDir}`;
                    if (!seenContexts.has(ctxKey)) {
                      seenContexts.add(ctxKey);
                      resolvedContexts.push({ kind: "local", dir: resolvedDir });
                    }
                  }
                } else if (ctxText) {
                  if (
                    buildFileContext.deferUnresolvedInputs &&
                    referencesUnresolvedInput(ctxText)
                  ) {
                    continue;
                  }
                  const unverifiableMsg = `${filePath}:${candidate.line}: build context ${ctxText} cannot be verified statically`;
                  if (!seenActionContextProblems.has(unverifiableMsg)) {
                    seenActionContextProblems.add(unverifiableMsg);
                    problems.push(unverifiableMsg);
                  }
                }
              }
            }
          }
        }
        if (!hadExplicitContext) {
          resolvedContexts.push({ kind: "git", dir: path.resolve(buildFileContext.root) });
        }

        const resolvedActionFiles = [];
        const seenResolvedActionFiles = new Set();
        let hasExplicitActionFile = false;
        if (fileNode?.kind === "scalar") {
          const rawActionFile = String(fileNode.value).trim();
          if (rawActionFile) {
            hasExplicitActionFile = true;
            const expandedActionFile = resolveEnvExpressionCandidates(
              rawActionFile,
              rowStepEnv,
              fileNode.line,
            );
            if (expandedActionFile.truncated) {
              const limitMsg = `${filePath}:${fileNode.line}: ${rawActionFile} exceeds expansion limit and cannot be verified exhaustively`;
              if (!seenActionContextProblems.has(limitMsg)) {
                seenActionContextProblems.add(limitMsg);
                problems.push(limitMsg);
              }
            }
            const fileModes = [];
            const seenFileModes = new Set();
            for (const ctx of resolvedContexts) {
              const modeKey = ctx.kind === "git" ? `git\0${ctx.dir}` : "local";
              if (!seenFileModes.has(modeKey)) {
                seenFileModes.add(modeKey);
                fileModes.push(
                  ctx.kind === "git" ? { kind: "git", dir: ctx.dir } : { kind: "local" },
                );
              }
            }
            for (const fileMode of fileModes) {
              for (const envCandidate of expandedActionFile.candidates) {
                for (const candidate of expandMatrixReferences(
                  envCandidate.text,
                  rowList,
                  envCandidate.line,
                )) {
                  let mappedPaths;
                  if (fileMode.kind === "git") {
                    const resolvedPath = resolveContainedPath(
                      candidate.text,
                      fileMode.dir,
                      fileMode.dir,
                      { actionDir: buildFileContext.actionRepoDir ?? null },
                    );
                    mappedPaths =
                      resolvedPath && resolvedPath !== path.resolve(fileMode.dir)
                        ? [resolvedPath]
                        : [];
                  } else {
                    const wsFile = resolveWorkspaceRelativePath(candidate.text, "", {
                      actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
                    });
                    mappedPaths = resolveWorkspaceTargetsInRepo(
                      wsFile,
                      buildFileContext.root,
                      rowCheckoutPrefixes,
                      rowForeignPrefixes,
                    ).filter((target) => target !== path.resolve(buildFileContext.root));
                  }
                  if (mappedPaths.length === 0) {
                    if (
                      buildFileContext.deferUnresolvedInputs &&
                      referencesUnresolvedInput(candidate.text)
                    ) {
                      continue;
                    }
                    const unverifiableMsg = `${filePath}:${fileNode.line}: build file ${candidate.text} cannot be verified statically`;
                    if (!seenActionContextProblems.has(unverifiableMsg)) {
                      seenActionContextProblems.add(unverifiableMsg);
                      problems.push(unverifiableMsg);
                    }
                    continue;
                  }
                  for (const resolvedPath of mappedPaths) {
                    const targetProblems = [];
                    const safeFile = resolveSafeContainerFile(
                      resolvedPath,
                      buildFileContext.root,
                      targetProblems,
                    );
                    if (safeFile) {
                      buildFileContext.explicitBuildFiles.add(resolvedPath);
                      if (!seenResolvedActionFiles.has(resolvedPath)) {
                        seenResolvedActionFiles.add(resolvedPath);
                        resolvedActionFiles.push(resolvedPath);
                      }
                    } else if (targetProblems.length > 0) {
                      buildFileContext.explicitBuildFiles.add(resolvedPath);
                    } else {
                      const unverifiableMsg = `${filePath}:${fileNode.line}: build file ${candidate.text} cannot be verified statically`;
                      if (!seenActionContextProblems.has(unverifiableMsg)) {
                        seenActionContextProblems.add(unverifiableMsg);
                        problems.push(unverifiableMsg);
                      }
                    }
                  }
                }
              }
            }
          }
        }
        if (!hasExplicitActionFile && resolvedActionFiles.length === 0) {
          for (const ctx of resolvedContexts) {
            const candidateFile = findDefaultBuildFile(ctx.dir, ["Dockerfile", "dockerfile"]);
            let foundDefault = false;
            if (candidateFile) {
              const targetProblems = [];
              const safeFile = resolveSafeContainerFile(
                candidateFile,
                buildFileContext.root,
                targetProblems,
              );
              if (safeFile) {
                buildFileContext.explicitBuildFiles.add(candidateFile);
                if (!seenResolvedActionFiles.has(candidateFile)) {
                  seenResolvedActionFiles.add(candidateFile);
                  resolvedActionFiles.push(candidateFile);
                }
                foundDefault = true;
              } else if (targetProblems.length > 0) {
                buildFileContext.explicitBuildFiles.add(candidateFile);
                foundDefault = true;
              }
            }
            if (!foundDefault) {
              const expectedPath = formatPortableRelativePath(
                buildFileContext.root,
                path.join(ctx.dir, "Dockerfile"),
              );
              const unverifiableMsg = `${filePath}:${usesNode.line}: default build file ${expectedPath} cannot be verified statically`;
              if (!seenActionContextProblems.has(unverifiableMsg)) {
                seenActionContextProblems.add(unverifiableMsg);
                problems.push(unverifiableMsg);
              }
            }
          }
        }
        for (const targetFile of resolvedActionFiles) {
          recordBuildInvocation(
            targetFile,
            actionBuildArgs,
            namedContexts,
            filePath,
            invocationLine,
            buildFileContext.buildInvocations,
            actionPlatforms,
          );
        }
      }
    } else if (
      usesNode?.kind === "scalar" &&
      String(usesNode.value).trim().startsWith("./") &&
      buildFileContext?.root
    ) {
      const rawLocalUses = String(usesNode.value).trim();
      const actionRows = applicableMatrixRows.length > 0 ? applicableMatrixRows : [null];
      const seenCompositeProblems = new Set();
      const pushCompositeProblem = (message) => {
        if (!seenCompositeProblems.has(message)) {
          seenCompositeProblems.add(message);
          problems.push(message);
        }
      };

      for (const row of actionRows) {
        const rowStepEnv = getRowStepEnv(row);
        const rowList = row ? [row] : [];
        const rowCheckoutPrefixes = getRowCheckoutPrefixes(row);
        const rowForeignPrefixes = getRowForeignPrefixes(row);
        const usesCandidates = resolveEnvExpressionCandidates(
          rawLocalUses,
          rowStepEnv,
          usesNode.line,
        ).candidates.flatMap((envCandidate) =>
          expandMatrixReferences(envCandidate.text, rowList, envCandidate.line),
        );

        const resolvedActionFiles = [];
        const seenActionFiles = new Set();
        for (const usesCandidate of usesCandidates) {
          const localRef = usesCandidate.text.trim();
          if (!localRef.startsWith("./")) {
            continue;
          }
          const wsActionDir = resolveWorkspaceRelativePath(localRef, "", {
            actionWsRelDir: buildFileContext.actionWsRelDir ?? null,
          });
          const actionDirs = resolveWorkspaceTargetsInRepo(
            wsActionDir,
            buildFileContext.root,
            rowCheckoutPrefixes,
            rowForeignPrefixes,
          );
          if (actionDirs.length === 0) {
            if (buildFileContext.deferUnresolvedInputs && referencesUnresolvedInput(localRef)) {
              continue;
            }
            pushCompositeProblem(
              `${filePath}:${usesNode.line}: local action ${localRef} cannot be verified statically`,
            );
            continue;
          }
          let foundManifestOrError = false;
          for (const actionDir of actionDirs) {
            let foundYamlManifest = false;
            for (const manifestName of ["action.yml", "action.yaml"]) {
              const manifestPath = path.join(actionDir, manifestName);
              const targetProblems = [];
              const safeActionFile = resolveSafeContainerFile(
                manifestPath,
                buildFileContext.root,
                targetProblems,
              );
              if (safeActionFile) {
                foundYamlManifest = true;
                foundManifestOrError = true;
                if (!seenActionFiles.has(safeActionFile)) {
                  seenActionFiles.add(safeActionFile);
                  resolvedActionFiles.push(safeActionFile);
                }
                break;
              }
              if (targetProblems.length > 0) {
                foundYamlManifest = true;
                foundManifestOrError = true;
                for (const problem of targetProblems) {
                  pushCompositeProblem(problem);
                }
                break;
              }
            }
            if (!foundYamlManifest) {
              const dockerfilePath = findDefaultBuildFile(actionDir, ["Dockerfile", "dockerfile"]);
              if (dockerfilePath) {
                const targetProblems = [];
                const safeDockerfile = resolveSafeContainerFile(
                  dockerfilePath,
                  buildFileContext.root,
                  targetProblems,
                );
                if (safeDockerfile) {
                  foundManifestOrError = true;
                  buildFileContext.explicitBuildFiles.add(dockerfilePath);
                  recordBuildInvocation(
                    dockerfilePath,
                    new Map(),
                    new Set(),
                    filePath,
                    usesNode.line,
                    buildFileContext.buildInvocations,
                    [],
                  );
                } else if (targetProblems.length > 0) {
                  foundManifestOrError = true;
                  buildFileContext.explicitBuildFiles.add(dockerfilePath);
                }
              }
            }
          }
          if (!foundManifestOrError) {
            pushCompositeProblem(
              `${filePath}:${usesNode.line}: local action ${localRef} cannot be verified statically`,
            );
          }
        }

        if (resolvedActionFiles.length === 0) {
          continue;
        }

        const withEntries = [];
        if (withNode?.kind === "map") {
          for (const [inputKey, inputNode] of withNode.value) {
            if (inputNode?.kind !== "scalar") {
              continue;
            }
            const rawInput = String(inputNode.value);
            const expandedInput = resolveEnvExpressionCandidates(
              rawInput,
              rowStepEnv,
              inputNode.line,
            );
            if (expandedInput.truncated) {
              pushCompositeProblem(
                `${filePath}:${inputNode.line}: ${rawInput} exceeds expansion limit and cannot be verified exhaustively`,
              );
            }
            const values = [];
            const seenValues = new Set();
            for (const envCandidate of expandedInput.candidates) {
              for (const candidate of expandMatrixReferences(
                envCandidate.text,
                rowList,
                envCandidate.line,
              )) {
                if (!seenValues.has(candidate.text)) {
                  seenValues.add(candidate.text);
                  values.push({ value: candidate.text, line: candidate.line });
                }
              }
            }
            if (values.length > 0) {
              withEntries.push([inputKey.toLowerCase(), values]);
            }
          }
        }

        let inputCombinations = [new Map()];
        let inputComboTruncated = false;
        for (const [inputKey, values] of withEntries) {
          const nextCombos = [];
          for (const combo of inputCombinations) {
            for (const entry of values) {
              if (nextCombos.length >= MAX_TOKEN_EXPANSIONS) {
                inputComboTruncated = true;
                break;
              }
              const clone = new Map(combo);
              clone.set(inputKey, entry);
              nextCombos.push(clone);
            }
            if (inputComboTruncated) {
              break;
            }
          }
          inputCombinations = nextCombos;
        }
        if (inputComboTruncated) {
          pushCompositeProblem(
            `${filePath}:${usesNode.line}: composite action ${rawLocalUses} input combinations exceed expansion limit and cannot be verified exhaustively`,
          );
        }

        const activeCallStack = buildFileContext.actionCallStack ?? new Set();
        const checkedLocalActionPins = buildFileContext.checkedLocalActionPins ?? new Set();
        const rowActionEmits = [];
        for (const resolvedActionFile of resolvedActionFiles) {
          if (activeCallStack.has(resolvedActionFile)) {
            continue;
          }
          if (activeCallStack.size >= MAX_LOCAL_CALL_DEPTH) {
            pushCompositeProblem(
              `${filePath}:${usesNode.line}: local action ${rawLocalUses} exceeds maximum nesting depth (${MAX_LOCAL_CALL_DEPTH}) and cannot be verified`,
            );
            continue;
          }
          const nextCallStack = new Set(activeCallStack);
          nextCallStack.add(resolvedActionFile);
          const actionSource = readFileSync(resolvedActionFile, "utf8");
          const actionRelPath = formatPortableRelativePath(
            buildFileContext.root,
            resolvedActionFile,
          );
          if (!checkedLocalActionPins.has(resolvedActionFile)) {
            checkedLocalActionPins.add(resolvedActionFile);
            for (const pinProblem of unpinnedActionReferences(actionSource, actionRelPath)) {
              pushCompositeProblem(pinProblem);
            }
          }
          for (const inputOverrides of inputCombinations) {
            const actionEmittedEnv = new Map();
            for (const actionProblem of unpinnedWorkflowContainerReferences(
              actionSource,
              actionRelPath,
              {
                root: buildFileContext.root,
                explicitBuildFiles: buildFileContext.explicitBuildFiles,
                buildInvocations: buildFileContext.buildInvocations,
                inputOverrides,
                callerEnv: rowStepEnv,
                actionCallStack: nextCallStack,
                checkedLocalActionPins,
                checkoutPrefixes: rowCheckoutPrefixes,
                foreignCheckoutPrefixes: rowForeignPrefixes,
                emittedGithubEnv: actionEmittedEnv,
              },
            )) {
              pushCompositeProblem(actionProblem);
            }
            const remappedEmits = new Map();
            for (const [envName, writeRecord] of actionEmittedEnv) {
              remappedEmits.set(envName, {
                conditional: writeRecord.conditional,
                entries: writeRecord.entries.map((entry) => ({
                  ...entry,
                  line: usesNode.line,
                })),
              });
            }
            rowActionEmits.push(remappedEmits);
          }
        }
        if (rowActionEmits.some((emitted) => emitted.size > 0)) {
          const existingRowWrites = perRowEmittedEnv.get(row) ?? [];
          existingRowWrites.push(...rowActionEmits);
          perRowEmittedEnv.set(row, existingRowWrites);
        }
      }
    }

    const executionGroups = resolveStepExecutionGroups(
      stepShellNode,
      explicitDefaultShell,
      stepWorkingDirNode,
      defaultWorkingDir,
      getRowStepEnv,
      applicableContexts,
      applicableMatrixRows,
      buildFileContext?.root ?? null,
      buildFileContext?.actionWsRelDir ?? null,
    );

    const runNode = getMapField(stepNode, "run");
    if (runNode?.kind === "scalar") {
      const seenAcrossStepRuns = new Set();
      for (const { shellMode, workingDir, rows } of executionGroups) {
        const groupRows = rows.length > 0 ? rows : [null];
        for (const row of groupRows) {
          const rowStepEnv = getRowStepEnv(row);
          const groupBuildContext = buildFileContext
            ? {
                ...buildFileContext,
                workingDir,
                checkoutPrefixes: getRowCheckoutPrefixes(row),
                foreignCheckoutPrefixes: getRowForeignPrefixes(row),
              }
            : null;
          const rowProblems = [];
          const rowEmitted = new Map();
          inspectShellRunScript(
            runNode,
            rowStepEnv,
            row ? [row] : [],
            filePath,
            rowProblems,
            rowEmitted,
            shellMode,
            groupBuildContext,
          );
          for (const message of rowProblems) {
            if (!seenAcrossStepRuns.has(message)) {
              problems.push(message);
            }
          }
          for (const message of rowProblems) {
            seenAcrossStepRuns.add(message);
          }
          if (rowEmitted.size > 0) {
            const existingRowWrites = perRowEmittedEnv.get(row) ?? [];
            existingRowWrites.push(rowEmitted);
            perRowEmittedEnv.set(row, existingRowWrites);
          }
        }
      }
    }
    for (const [row, writeMaps] of perRowEmittedEnv) {
      const targetEnv = rowRunningEnvs.get(row);
      const writtenKeys = rowWrittenEnvKeys.get(row);
      if (!targetEnv) {
        continue;
      }
      const allWrittenNames = new Set();
      for (const writeMap of writeMaps) {
        for (const name of writeMap.keys()) {
          allWrittenNames.add(name);
        }
      }
      for (const name of allWrittenNames) {
        let mergedEntries = [];
        let conditionalAcrossGroups = stepConditional;
        for (const writeMap of writeMaps) {
          const write = writeMap.get(name);
          if (!write) {
            conditionalAcrossGroups = true;
            continue;
          }
          if (write.conditional) {
            conditionalAcrossGroups = true;
          }
          mergedEntries = mergeVarEntries(mergedEntries, write.entries);
        }
        if (mergedEntries.length === 0) {
          continue;
        }
        if (conditionalAcrossGroups) {
          const existing = targetEnv.has(name)
            ? targetEnv.get(name)
            : [{ value: "", line: 0, unset: true }];
          targetEnv.set(name, mergeVarEntries(existing, mergedEntries));
          if (writtenKeys && !writtenKeys.has(name)) {
            writtenKeys.set(name, { conditional: true });
          }
        } else {
          targetEnv.set(name, mergedEntries);
          if (writtenKeys) {
            writtenKeys.set(name, { conditional: false });
          }
        }
      }
    }
  }

  if (emittedGithubEnv) {
    for (const row of allRows) {
      const targetEnv = rowRunningEnvs.get(row);
      const writtenKeys = rowWrittenEnvKeys.get(row);
      if (!targetEnv || !writtenKeys) {
        continue;
      }
      for (const [name, meta] of writtenKeys) {
        const entries = (targetEnv.get(name) ?? []).filter((entry) => !entry.unset);
        if (entries.length > 0) {
          recordGithubEnvWrite(emittedGithubEnv, name, entries, meta.conditional);
        }
      }
    }
  }
}

// --- Public discovery and validation functions -------------------------------

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

function resolveSafeContainerFile(candidatePath, root, problems = null) {
  try {
    lstatSync(candidatePath);
  } catch {
    return null;
  }

  let realRoot;
  let realTarget;
  try {
    realRoot = realpathSync(root);
    realTarget = realpathSync(candidatePath);
  } catch {
    return null;
  }

  const relative = path.relative(realRoot, realTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    if (problems) {
      problems.push(
        `${formatPortableRelativePath(root, candidatePath)}:1: symlink target escapes repository root and cannot be verified`,
      );
    }
    return null;
  }

  try {
    return statSync(realTarget).isFile() ? path.resolve(root, relative) : null;
  } catch {
    return null;
  }
}

function collectContainerFilesFromFilesystem(directory, root = directory, problems = null) {
  const entries = [];

  for (const entry of readdirSync(directory)) {
    if (IGNORED_DIRECTORIES.has(entry) || (entry.startsWith(".") && entry !== ".github")) {
      continue;
    }

    const entryPath = path.join(directory, entry);
    const stats = lstatSync(entryPath);

    if (stats.isSymbolicLink()) {
      if (CONTAINER_FILENAME_PATTERN.test(entry)) {
        const resolved = resolveSafeContainerFile(entryPath, root, problems);
        if (resolved) {
          entries.push(resolved);
        }
      }
      continue;
    }

    if (stats.isDirectory()) {
      entries.push(...collectContainerFilesFromFilesystem(entryPath, root, problems));
      continue;
    }

    if (stats.isFile() && CONTAINER_FILENAME_PATTERN.test(entry)) {
      entries.push(entryPath);
    }
  }

  return entries.sort();
}

export function collectContainerFiles(root, problems = null) {
  const gitResult = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  if (gitResult.status === 0 && typeof gitResult.stdout === "string") {
    const entries = new Set();
    for (const relativePath of gitResult.stdout.split("\0")) {
      if (!relativePath || !CONTAINER_FILENAME_PATTERN.test(path.basename(relativePath))) {
        continue;
      }
      const fullPath = path.join(root, relativePath);
      const resolved = resolveSafeContainerFile(fullPath, root, problems);
      if (resolved) {
        entries.add(resolved);
      }
    }
    return [...entries].sort();
  }

  return collectContainerFilesFromFilesystem(root, root, problems);
}

function collectUsesNodes(doc) {
  const usesNodes = [];
  if (!doc) {
    return usesNodes;
  }

  const collectFromSteps = (stepsNode) => {
    if (stepsNode?.kind !== "seq") {
      return;
    }
    for (const stepNode of stepsNode.value) {
      if (stepNode?.kind !== "map") {
        continue;
      }
      const usesNode = getMapField(stepNode, "uses");
      if (usesNode?.kind === "scalar") {
        usesNodes.push(usesNode);
      }
    }
  };

  if (doc.kind === "seq") {
    collectFromSteps(doc);
    return usesNodes;
  }

  if (doc.kind !== "map") {
    return usesNodes;
  }

  const topUses = getMapField(doc, "uses");
  if (topUses?.kind === "scalar") {
    usesNodes.push(topUses);
  }
  collectFromSteps(getMapField(doc, "steps"));

  const runsNode = getMapField(doc, "runs");
  if (runsNode?.kind === "map") {
    collectFromSteps(getMapField(runsNode, "steps"));
  }

  const jobsNode = getMapField(doc, "jobs");
  if (jobsNode?.kind === "map") {
    for (const jobNode of jobsNode.value.values()) {
      if (jobNode?.kind !== "map") {
        continue;
      }
      const jobUses = getMapField(jobNode, "uses");
      if (jobUses?.kind === "scalar") {
        usesNodes.push(jobUses);
      }
      collectFromSteps(getMapField(jobNode, "steps"));
    }
  }

  return usesNodes;
}

export function unpinnedActionReferences(source, filePath = "<memory>") {
  const problems = [];
  const rawLines = source.split(/\r?\n/u);
  const { doc, error } = parseWorkflowYaml(source);

  if (error) {
    problems.push(`${filePath}:${error.line}: ${error.message}`);
  }

  for (const usesNode of collectUsesNodes(doc)) {
    const value = String(usesNode.value).trim();
    const location = `${filePath}:${usesNode.line}`;

    if (!value || value.startsWith("./")) {
      continue;
    }

    if (value.startsWith("docker://")) {
      if (!isPinnedDigest(value)) {
        problems.push(`${location}: ${value} is not pinned to a sha256 digest`);
      }
      continue;
    }

    if (!PINNED_ACTION_PATTERN.test(value)) {
      problems.push(`${location}: ${value} is not pinned to a full commit SHA`);
      continue;
    }

    const sourceLine = rawLines[usesNode.line - 1] ?? "";
    if (!usesNode.comment && !hasUnquotedComment(sourceLine)) {
      problems.push(`${location}: ${value} has no version comment`);
    }
  }

  return problems;
}

function extractActionInputDefaults(doc) {
  const defaults = new Map();
  const inputsNode = getMapField(doc, "inputs");
  if (inputsNode?.kind !== "map") {
    return defaults;
  }
  for (const [inputName, defNode] of inputsNode.value) {
    if (defNode?.kind !== "map") {
      continue;
    }
    const defaultNode = getMapField(defNode, "default");
    if (defaultNode?.kind === "scalar") {
      defaults.set(inputName.toLowerCase(), {
        value: String(defaultNode.value),
        line: defaultNode.line,
      });
    }
  }
  return defaults;
}

function substituteInputsInText(text, inputValues) {
  return String(text).replace(
    INPUTS_EXPRESSION_PATTERN,
    (match, _p1, _p2, _p3, _offset, _str, groups) => {
      const name = (groups.dot ?? groups.sq ?? groups.dq).toLowerCase();
      return inputValues.has(name) ? inputValues.get(name).value : match;
    },
  );
}

function substituteInputsInAstNode(node, inputValues, memo = new Map()) {
  if (!node || inputValues.size === 0) {
    return node;
  }
  if (memo.has(node)) {
    return memo.get(node);
  }
  if (node.kind === "scalar") {
    const nextValue = substituteInputsInText(node.value, inputValues);
    const nextLines = Array.isArray(node.lines)
      ? node.lines.map((entry) => ({
          ...entry,
          text: substituteInputsInText(entry.text, inputValues),
        }))
      : node.lines;
    const result = { ...node, value: nextValue, lines: nextLines };
    memo.set(node, result);
    return result;
  }
  if (node.kind === "seq") {
    const result = { ...node, value: [] };
    memo.set(node, result);
    for (const item of node.value) {
      result.value.push(substituteInputsInAstNode(item, inputValues, memo));
    }
    return result;
  }
  if (node.kind === "map") {
    const nextMap = new Map();
    const result = { ...node, value: nextMap };
    memo.set(node, result);
    for (const [key, val] of node.value) {
      nextMap.set(key, substituteInputsInAstNode(val, inputValues, memo));
    }
    return result;
  }
  return node;
}

function extractTriggerInputDefaults(doc, triggerName) {
  const defaults = new Map();
  const onNode = getMapField(doc, "on");
  if (onNode?.kind !== "map") {
    return defaults;
  }
  const triggerNode = getMapField(onNode, triggerName);
  if (triggerNode?.kind !== "map") {
    return defaults;
  }
  const inputsNode = getMapField(triggerNode, "inputs");
  if (inputsNode?.kind !== "map") {
    return defaults;
  }
  for (const [inputName, defNode] of inputsNode.value) {
    if (defNode?.kind !== "map") {
      continue;
    }
    const defaultNode = getMapField(defNode, "default");
    if (defaultNode?.kind === "scalar") {
      defaults.set(inputName.toLowerCase(), {
        value: String(defaultNode.value),
        line: defaultNode.line,
      });
    }
  }
  return defaults;
}

function expandWithInputCombinations(
  withNode,
  envMap,
  rowList,
  filePath,
  fallbackLine,
  pushProblem,
) {
  const withEntries = [];
  if (withNode?.kind === "map") {
    for (const [inputKey, inputNode] of withNode.value) {
      if (inputNode?.kind !== "scalar") {
        continue;
      }
      const rawInput = String(inputNode.value);
      const expandedInput = resolveEnvExpressionCandidates(rawInput, envMap, inputNode.line);
      if (expandedInput.truncated) {
        pushProblem(
          `${filePath}:${inputNode.line}: ${rawInput} exceeds expansion limit and cannot be verified exhaustively`,
        );
      }
      const values = [];
      const seenValues = new Set();
      for (const envCandidate of expandedInput.candidates) {
        for (const candidate of expandMatrixReferences(
          envCandidate.text,
          rowList,
          envCandidate.line,
        )) {
          if (!seenValues.has(candidate.text)) {
            seenValues.add(candidate.text);
            values.push({ value: candidate.text, line: candidate.line });
          }
        }
      }
      if (values.length > 0) {
        withEntries.push([inputKey.toLowerCase(), values]);
      }
    }
  }

  let combinations = [new Map()];
  let truncated = false;
  for (const [inputKey, values] of withEntries) {
    const nextCombos = [];
    for (const combo of combinations) {
      for (const entry of values) {
        if (nextCombos.length >= MAX_TOKEN_EXPANSIONS) {
          truncated = true;
          break;
        }
        const clone = new Map(combo);
        clone.set(inputKey, entry);
        nextCombos.push(clone);
      }
      if (truncated) {
        break;
      }
    }
    combinations = nextCombos;
  }
  if (truncated) {
    pushProblem(
      `${filePath}:${fallbackLine}: reusable workflow input combinations exceed expansion limit and cannot be verified exhaustively`,
    );
  }
  return combinations;
}

export function unpinnedWorkflowContainerReferences(
  source,
  filePath = "<memory>",
  {
    root = null,
    explicitBuildFiles = null,
    buildInvocations = null,
    inputOverrides = null,
    callerEnv = null,
    actionCallStack = null,
    checkedLocalActionPins = null,
    checkoutPrefixes = null,
    foreignCheckoutPrefixes = null,
    emittedGithubEnv = null,
  } = {},
) {
  const problems = [];
  const { doc, error } = parseWorkflowYaml(source);
  if (error) {
    problems.push(`${filePath}:${error.line}: ${error.message}`);
  }
  if (!doc) {
    return problems;
  }

  const initialCallStack = actionCallStack
    ? new Set(actionCallStack)
    : root
      ? new Set([path.resolve(root, filePath)])
      : new Set();

  const buildFileContext = root
    ? {
        root,
        workingDir: "",
        explicitBuildFiles: explicitBuildFiles ?? new Set(),
        buildInvocations,
        actionCallStack: initialCallStack,
        checkedLocalActionPins: checkedLocalActionPins ?? new Set(),
        checkoutPrefixes:
          checkoutPrefixes !== undefined && checkoutPrefixes !== null
            ? [...checkoutPrefixes]
            : [""],
        foreignCheckoutPrefixes: Array.isArray(foreignCheckoutPrefixes)
          ? [...foreignCheckoutPrefixes]
          : [],
      }
    : null;

  if (doc.kind === "seq") {
    checkStepsList(
      doc,
      new Map(),
      [],
      filePath,
      problems,
      null,
      [],
      buildFileContext,
      null,
      emittedGithubEnv,
    );
    return problems;
  }

  if (doc.kind !== "map") {
    return problems;
  }

  const workflowInputContexts = [];
  if (inputOverrides) {
    const mergedCallInputs = extractTriggerInputDefaults(doc, "workflow_call");
    for (const [key, entry] of inputOverrides) {
      mergedCallInputs.set(key.toLowerCase(), entry);
    }
    workflowInputContexts.push({ inputs: mergedCallInputs, deferUnresolvedInputs: false });
  } else {
    const onNode = getMapField(doc, "on");
    const hasWorkflowCallTrigger =
      onNode?.kind === "map" && getMapField(onNode, "workflow_call") !== null;
    const wfCallDefaults = extractTriggerInputDefaults(doc, "workflow_call");
    const wfDispatchDefaults = extractTriggerInputDefaults(doc, "workflow_dispatch");
    if (wfCallDefaults.size > 0 || hasWorkflowCallTrigger) {
      workflowInputContexts.push({ inputs: wfCallDefaults, deferUnresolvedInputs: true });
    }
    if (wfDispatchDefaults.size > 0) {
      workflowInputContexts.push({ inputs: wfDispatchDefaults, deferUnresolvedInputs: false });
    }
    if (workflowInputContexts.length === 0) {
      workflowInputContexts.push({ inputs: new Map(), deferUnresolvedInputs: false });
    }
  }

  const baseEnv = callerEnv ? cloneVarMap(callerEnv) : new Map();
  const workflowDefaultShell = extractDefaultShell(doc);
  const workflowDefaultWorkingDir = extractDefaultWorkingDirectory(doc);
  const runsNode = getMapField(doc, "runs");
  const seenDocProblems = new Set(problems);

  for (let ctxIndex = 0; ctxIndex < workflowInputContexts.length; ctxIndex += 1) {
    const { inputs: effectiveWorkflowInputs, deferUnresolvedInputs } =
      workflowInputContexts[ctxIndex];
    const ctxBuildFileContext = buildFileContext
      ? { ...buildFileContext, deferUnresolvedInputs }
      : null;
    const substitutionMemo = new Map();
    const applyWorkflowInputs = (node) =>
      effectiveWorkflowInputs.size > 0
        ? substituteInputsInAstNode(node, effectiveWorkflowInputs, substitutionMemo)
        : node;

    const ctxProblems = [];
    const workflowEnv = extractEnvMap(applyWorkflowInputs(getMapField(doc, "env")), baseEnv);

    const checkContainerNode = (containerNode, envMap, matrixRows) => {
      if (!containerNode) {
        return;
      }
      if (containerNode.kind === "scalar") {
        checkImageField(containerNode, envMap, matrixRows, filePath, ctxProblems);
      } else if (containerNode.kind === "map") {
        checkImageField(
          getMapField(containerNode, "image"),
          envMap,
          matrixRows,
          filePath,
          ctxProblems,
        );
      }
    };

    const checkServicesNode = (servicesNode, envMap, matrixRows) => {
      if (servicesNode?.kind !== "map") {
        return;
      }
      for (const serviceNode of servicesNode.value.values()) {
        checkContainerNode(serviceNode, envMap, matrixRows);
      }
    };

    checkContainerNode(applyWorkflowInputs(getMapField(doc, "container")), workflowEnv, []);
    checkServicesNode(applyWorkflowInputs(getMapField(doc, "services")), workflowEnv, []);
    checkImageField(
      applyWorkflowInputs(getMapField(doc, "image")),
      workflowEnv,
      [],
      filePath,
      ctxProblems,
    );
    checkStepsList(
      applyWorkflowInputs(getMapField(doc, "steps")),
      workflowEnv,
      [],
      filePath,
      ctxProblems,
      workflowDefaultShell,
      [],
      ctxBuildFileContext,
      workflowDefaultWorkingDir,
      emittedGithubEnv,
    );

    if (ctxIndex === 0 && runsNode?.kind === "map") {
      const effectiveInputs = extractActionInputDefaults(doc);
      if (inputOverrides) {
        for (const [key, entry] of inputOverrides) {
          effectiveInputs.set(key.toLowerCase(), entry);
        }
      }
      const actionMemo = new Map();
      const effectiveRunsNode =
        effectiveInputs.size > 0
          ? substituteInputsInAstNode(runsNode, effectiveInputs, actionMemo)
          : runsNode;
      const runsImageNode = getMapField(effectiveRunsNode, "image");
      checkImageField(runsImageNode, workflowEnv, [], filePath, ctxProblems, {
        allowLocalDockerAction: true,
      });
      if (buildFileContext && runsImageNode?.kind === "scalar") {
        const rawImage = String(runsImageNode.value).trim();
        if (isLocalDockerActionImage(rawImage)) {
          const actionDir = path.dirname(path.resolve(root, filePath));
          recordExplicitBuildFile(rawImage, actionDir, root, buildFileContext.explicitBuildFiles);
        }
      }
      let actionBuildContext = buildFileContext;
      if (buildFileContext) {
        const actionRepoDir = path.dirname(path.resolve(root, filePath));
        const relActionDir = path.posix.normalize(formatPortableRelativePath(root, actionRepoDir));
        const normalizedActionDir = relActionDir === "." ? "" : relActionDir;
        const primaryCheckout = buildFileContext.checkoutPrefixes?.[0] ?? "";
        const actionWsRelDir = primaryCheckout
          ? normalizedActionDir
            ? `${primaryCheckout}/${normalizedActionDir}`
            : primaryCheckout
          : normalizedActionDir;
        actionBuildContext = {
          ...buildFileContext,
          actionRepoDir,
          actionWsRelDir,
          deferUnresolvedInputs: !inputOverrides,
        };
      }
      checkStepsList(
        getMapField(effectiveRunsNode, "steps"),
        workflowEnv,
        [],
        filePath,
        ctxProblems,
        workflowDefaultShell,
        [],
        actionBuildContext,
        workflowDefaultWorkingDir,
        emittedGithubEnv,
      );
    }

    const jobsNode = applyWorkflowInputs(getMapField(doc, "jobs"));
    if (jobsNode?.kind === "map") {
      for (const jobNode of jobsNode.value.values()) {
        if (jobNode?.kind !== "map") {
          continue;
        }
        const jobEnv = extractEnvMap(getMapField(jobNode, "env"), workflowEnv);
        const jobMatrixRows = extractJobMatrixRows(jobNode, filePath, ctxProblems);
        const jobUsesNode = getMapField(jobNode, "uses");
        if (
          jobUsesNode?.kind === "scalar" &&
          String(jobUsesNode.value).trim().startsWith("./") &&
          ctxBuildFileContext?.root
        ) {
          const rawJobUses = String(jobUsesNode.value).trim();
          const jobWithNode = getMapField(jobNode, "with");
          const callRows = jobMatrixRows.length > 0 ? jobMatrixRows : [null];
          const seenCalleeProblems = new Set();
          const pushCalleeProblem = (message) => {
            if (!seenCalleeProblems.has(message)) {
              seenCalleeProblems.add(message);
              ctxProblems.push(message);
            }
          };
          const resolvedWorkflowPath = resolveContainedPath(
            rawJobUses,
            ctxBuildFileContext.root,
            ctxBuildFileContext.root,
          );
          if (!resolvedWorkflowPath) {
            if (
              ctxBuildFileContext.deferUnresolvedInputs &&
              referencesUnresolvedInput(rawJobUses)
            ) {
              continue;
            }
            pushCalleeProblem(
              `${filePath}:${jobUsesNode.line}: local reusable workflow ${rawJobUses} cannot be verified statically`,
            );
            continue;
          }
          const targetProblems = [];
          const safeWorkflowFile = resolveSafeContainerFile(
            resolvedWorkflowPath,
            ctxBuildFileContext.root,
            targetProblems,
          );
          for (const targetProblem of targetProblems) {
            pushCalleeProblem(targetProblem);
          }
          if (!safeWorkflowFile) {
            if (targetProblems.length === 0) {
              pushCalleeProblem(
                `${filePath}:${jobUsesNode.line}: local reusable workflow ${rawJobUses} cannot be verified statically`,
              );
            }
            continue;
          }
          const activeCallStack = ctxBuildFileContext.actionCallStack ?? new Set();
          if (activeCallStack.has(safeWorkflowFile)) {
            continue;
          }
          if (activeCallStack.size >= MAX_LOCAL_CALL_DEPTH) {
            pushCalleeProblem(
              `${filePath}:${jobUsesNode.line}: local reusable workflow ${rawJobUses} exceeds maximum nesting depth (${MAX_LOCAL_CALL_DEPTH}) and cannot be verified`,
            );
            continue;
          }
          const nextCallStack = new Set(activeCallStack);
          nextCallStack.add(safeWorkflowFile);
          const calleeSource = readFileSync(safeWorkflowFile, "utf8");
          const calleeRelPath = formatPortableRelativePath(
            ctxBuildFileContext.root,
            safeWorkflowFile,
          );
          const checkedLocalActionPins = ctxBuildFileContext.checkedLocalActionPins ?? new Set();
          if (!checkedLocalActionPins.has(safeWorkflowFile)) {
            checkedLocalActionPins.add(safeWorkflowFile);
            for (const pinProblem of unpinnedActionReferences(calleeSource, calleeRelPath)) {
              pushCalleeProblem(pinProblem);
            }
          }
          for (const row of callRows) {
            const rowList = row ? [row] : [];
            const calleeInputCombos = expandWithInputCombinations(
              jobWithNode,
              jobEnv,
              rowList,
              filePath,
              jobUsesNode.line,
              pushCalleeProblem,
            );
            for (const calleeInputOverrides of calleeInputCombos) {
              for (const calleeProblem of unpinnedWorkflowContainerReferences(
                calleeSource,
                calleeRelPath,
                {
                  root: ctxBuildFileContext.root,
                  explicitBuildFiles: ctxBuildFileContext.explicitBuildFiles,
                  buildInvocations: ctxBuildFileContext.buildInvocations,
                  inputOverrides: calleeInputOverrides,
                  actionCallStack: nextCallStack,
                  checkedLocalActionPins,
                },
              )) {
                pushCalleeProblem(calleeProblem);
              }
            }
          }
          continue;
        }
        const jobExplicitShell = extractDefaultShell(jobNode) ?? workflowDefaultShell;
        const jobDefaultWorkingDir =
          extractDefaultWorkingDirectory(jobNode) ?? workflowDefaultWorkingDir;
        const runnerContexts = resolveRunnerShellContexts(jobNode, jobEnv, jobMatrixRows);
        checkContainerNode(getMapField(jobNode, "container"), jobEnv, jobMatrixRows);
        checkServicesNode(getMapField(jobNode, "services"), jobEnv, jobMatrixRows);
        checkStepsList(
          getMapField(jobNode, "steps"),
          jobEnv,
          jobMatrixRows,
          filePath,
          ctxProblems,
          jobExplicitShell,
          runnerContexts,
          ctxBuildFileContext,
          jobDefaultWorkingDir,
        );
      }
    }

    for (const problem of ctxProblems) {
      if (!seenDocProblems.has(problem)) {
        problems.push(problem);
      }
    }
    for (const problem of ctxProblems) {
      seenDocProblems.add(problem);
    }
  }

  return problems;
}

// Resolve Dockerfile `$ARG`, `${ARG}`, `${ARG:-default}`, `${ARG-default}`,
// `${ARG:+alternate}`, and `${ARG+alternate}` expansions. Unset ARGs without a
// dynamic runtime override evaluate to the empty string per BuildKit semantics,
// while still distinguishing unset from empty for `-` / `+` operators.
function resolveBuildArgs(token, buildArgs, depth = 0, dynamicArgs = null) {
  if (depth > 8) {
    return token;
  }
  let output = "";
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== "$") {
      output += token[index];
      continue;
    }

    if (token[index + 1] === "{") {
      let braceDepth = 1;
      let cursor = index + 2;
      while (cursor < token.length && braceDepth > 0) {
        if (token[cursor] === "{") {
          braceDepth += 1;
        } else if (token[cursor] === "}") {
          braceDepth -= 1;
        }
        cursor += 1;
      }
      if (braceDepth === 0) {
        const inner = token.slice(index + 2, cursor - 1);
        const exprMatch =
          /^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:(?<op>:-|:\+|-|\+)(?<word>.*))?$/su.exec(inner);
        if (exprMatch) {
          const { name, op, word } = exprMatch.groups;
          const isDynamic = Boolean(dynamicArgs?.has(name));
          const isSet = buildArgs.has(name);
          const value = isSet ? buildArgs.get(name) : "";
          if (isDynamic) {
            output += token.slice(index, cursor);
          } else if (!op) {
            output += isSet ? value : "";
          } else if (op === ":-") {
            output +=
              isSet && value.length > 0
                ? value
                : resolveBuildArgs(word, buildArgs, depth + 1, dynamicArgs);
          } else if (op === "-") {
            output += isSet ? value : resolveBuildArgs(word, buildArgs, depth + 1, dynamicArgs);
          } else if (op === ":+") {
            output +=
              isSet && value.length > 0
                ? resolveBuildArgs(word, buildArgs, depth + 1, dynamicArgs)
                : "";
          } else if (op === "+") {
            output += isSet ? resolveBuildArgs(word, buildArgs, depth + 1, dynamicArgs) : "";
          }
          index = cursor - 1;
          continue;
        }
      }
    }

    const bareMatch = /^(?<bare>[A-Za-z_][A-Za-z0-9_]*)/u.exec(token.slice(index + 1));
    if (bareMatch) {
      const name = bareMatch.groups.bare;
      if (dynamicArgs?.has(name)) {
        output += `$${name}`;
      } else {
        output += buildArgs.has(name) ? buildArgs.get(name) : "";
      }
      index += name.length;
      continue;
    }

    output += token[index];
  }
  return output;
}

function extractDockerfileHeredocDelimiters(instructionText) {
  const delimiters = [];
  const headerMatch = /^(?:COPY|ADD|RUN)\s+(?<rest>.+)$/iu.exec(instructionText);
  if (!headerMatch) {
    return delimiters;
  }
  const rest = headerMatch.groups.rest.trimStart();
  // JSON exec form (`RUN ["sh", "-c", "..."]`) does not support Dockerfile heredocs.
  if (rest.startsWith("[")) {
    return delimiters;
  }

  let quote = null;
  let escaping = false;
  let arithDepth = 0;
  let atWordStart = true;

  for (let index = 0; index < rest.length; index += 1) {
    const ch = rest[index];
    if (escaping) {
      escaping = false;
      atWordStart = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      atWordStart = false;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      atWordStart = false;
      continue;
    }
    if (arithDepth > 0) {
      if (ch === "(" && rest[index + 1] === "(") {
        arithDepth += 1;
        index += 1;
      } else if (ch === ")" && rest[index + 1] === ")") {
        arithDepth -= 1;
        index += 1;
      }
      atWordStart = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      atWordStart = false;
      continue;
    }
    if (ch === "$" && rest[index + 1] === "(" && rest[index + 2] === "(") {
      arithDepth += 1;
      index += 2;
      atWordStart = false;
      continue;
    }
    if (ch === "(" && rest[index + 1] === "(" && atWordStart) {
      arithDepth += 1;
      index += 1;
      atWordStart = false;
      continue;
    }
    if (atWordStart && ch === "<" && rest[index + 1] === "<" && rest[index + 2] !== "<") {
      let cursor = index + 2;
      let stripTabs = false;
      if (rest[cursor] === "-") {
        stripTabs = true;
        cursor += 1;
      }
      // BuildKit Dockerfile heredocs require the delimiter immediately attached
      // to `<<` or `<<-` with no intervening whitespace.
      let delimiter = "";
      if (rest[cursor] === "'" || rest[cursor] === '"') {
        const delimQuote = rest[cursor];
        cursor += 1;
        const start = cursor;
        while (cursor < rest.length && rest[cursor] !== delimQuote) {
          cursor += 1;
        }
        if (
          cursor < rest.length &&
          rest[cursor] === delimQuote &&
          cursor > start &&
          (cursor + 1 === rest.length || /[\s;&|<>()]/u.test(rest[cursor + 1]))
        ) {
          delimiter = rest.slice(start, cursor);
          cursor += 1;
        }
      } else {
        const bareMatch = /^(?<bare>[A-Za-z_][A-Za-z0-9_.-]*)(?=$|[\s;&|<>()])/u.exec(
          rest.slice(cursor),
        );
        if (bareMatch) {
          delimiter = bareMatch.groups.bare;
          cursor += delimiter.length;
        }
      }
      if (delimiter.length > 0) {
        delimiters.push({ delimiter, stripTabs });
        index = cursor - 1;
        atWordStart = false;
        continue;
      }
    }
    atWordStart = /[\s;&|(]/u.test(ch);
  }

  return delimiters;
}

function parseDockerfileArgDeclarations(rest) {
  const declarations = [];
  let index = 0;
  while (index < rest.length) {
    while (index < rest.length && /\s/u.test(rest[index])) {
      index += 1;
    }
    if (index >= rest.length) {
      break;
    }
    let cursor = index;
    let quote = null;
    while (cursor < rest.length) {
      const ch = rest[cursor];
      if (quote) {
        if (ch === "\\" && quote === '"' && cursor + 1 < rest.length) {
          cursor += 2;
          continue;
        }
        if (ch === quote) {
          quote = null;
        }
        cursor += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cursor += 1;
        continue;
      }
      if (/\s/u.test(ch)) {
        break;
      }
      cursor += 1;
    }
    const token = rest.slice(index, cursor);
    index = cursor;
    const match = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:=(?<value>.*))?$/su.exec(token);
    if (match) {
      declarations.push({
        name: match.groups.name,
        value: match.groups.value,
      });
    }
  }
  return declarations;
}

function extractCopyFromSource(instructionText) {
  const match = /^(?:COPY|ADD)\s+(?<rest>.+)$/iu.exec(instructionText);
  if (!match) {
    return null;
  }
  const rest = match.groups.rest.trimStart();
  if (rest.startsWith("[")) {
    return null;
  }
  let index = 0;
  let fromSource = null;
  while (index < rest.length) {
    while (index < rest.length && /\s/u.test(rest[index])) {
      index += 1;
    }
    if (index >= rest.length || !rest.startsWith("--", index)) {
      break;
    }
    let cursor = index;
    let quote = null;
    while (cursor < rest.length) {
      const ch = rest[cursor];
      if (quote) {
        if (ch === quote) {
          quote = null;
        }
        cursor += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cursor += 1;
        continue;
      }
      if (/\s/u.test(ch)) {
        break;
      }
      cursor += 1;
    }
    const optionToken = rest.slice(index, cursor);
    index = cursor;
    if (optionToken === "--") {
      break;
    }
    if (optionToken.toLowerCase().startsWith("--from=")) {
      fromSource = stripQuotes(optionToken.slice("--from=".length));
    }
  }
  return fromSource;
}

function extractRunMountSources(runText) {
  const sources = [];
  const rest = runText.replace(/^RUN\s+/iu, "");
  const firstCommand = lexShellScript(rest, 1).find((event) => event.kind === "command");
  const tokens = firstCommand?.tokens ?? [];
  for (const token of tokens) {
    if (!token.startsWith("--")) {
      break;
    }
    if (!token.toLowerCase().startsWith("--mount=")) {
      continue;
    }
    const spec = token.slice("--mount=".length);
    for (const part of spec.split(",")) {
      const match = /^from=(?<source>.+)$/iu.exec(part.trim());
      if (match) {
        sources.push(stripQuotes(match.groups.source));
      }
    }
  }
  return sources;
}

function extractReferencedBuildArgNames(token, names = new Set(), depth = 0) {
  if (depth > 8) {
    return names;
  }
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== "$") {
      continue;
    }
    if (token[index + 1] === "{") {
      let braceDepth = 1;
      let cursor = index + 2;
      while (cursor < token.length && braceDepth > 0) {
        if (token[cursor] === "{") {
          braceDepth += 1;
        } else if (token[cursor] === "}") {
          braceDepth -= 1;
        }
        cursor += 1;
      }
      if (braceDepth === 0) {
        const inner = token.slice(index + 2, cursor - 1);
        const exprMatch =
          /^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:(?<op>:-|:\+|-|\+)(?<word>.*))?$/su.exec(inner);
        if (exprMatch) {
          names.add(exprMatch.groups.name);
          if (exprMatch.groups.word) {
            extractReferencedBuildArgNames(exprMatch.groups.word, names, depth + 1);
          }
          index = cursor - 1;
          continue;
        }
      }
    }
    const bareMatch = /^(?<bare>[A-Za-z_][A-Za-z0-9_]*)/u.exec(token.slice(index + 1));
    if (bareMatch) {
      names.add(bareMatch.groups.bare);
      index += bareMatch.groups.bare.length;
    }
  }
  return names;
}

export function unpinnedContainerfileReferences(
  source,
  filePath = "<memory>",
  {
    argOverrides = null,
    namedContexts = null,
    platforms = null,
    sourceFile = null,
    sourceLine = null,
    startLineOffset = 0,
  } = {},
) {
  const problems = [];
  const seenProblems = new Set();
  const pushProblem = (message) => {
    if (!seenProblems.has(message)) {
      seenProblems.add(message);
      problems.push(message);
    }
  };
  const rawLines = source.split(/\r?\n/u);
  const logicalLines = [];
  const pendingHeredocs = [];
  let inHeaderDirectives = true;
  let escapeChar = "\\";
  const seenDirectives = new Set();

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];

    if (pendingHeredocs.length > 0) {
      const current = pendingHeredocs[0];
      const candidate = current.stripTabs ? line.replace(/^\t+/u, "") : line;
      if (candidate === current.delimiter) {
        pendingHeredocs.shift();
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) {
      inHeaderDirectives = false;
      continue;
    }
    if (trimmed.startsWith("#")) {
      if (inHeaderDirectives) {
        const directiveMatch = /^#\s*(?<name>syntax|escape|check)\s*=\s*(?<value>.+)$/iu.exec(
          trimmed,
        );
        if (directiveMatch) {
          const directiveName = directiveMatch.groups.name.toLowerCase();
          const directiveValue = directiveMatch.groups.value.trim();
          if (seenDirectives.has(directiveName)) {
            inHeaderDirectives = false;
          } else {
            seenDirectives.add(directiveName);
            if (directiveName === "syntax") {
              const frontend = stripQuotes(directiveValue.split(/\s+/u)[0] ?? "");
              if (frontend && !isDynamicReference(frontend) && !isPinnedDigest(frontend)) {
                pushProblem(
                  `${filePath}:${index + 1 + startLineOffset}: ${frontend} is not pinned to a sha256 digest`,
                );
              }
            } else if (
              directiveName === "escape" &&
              (directiveValue === "\\" || directiveValue === "`")
            ) {
              escapeChar = directiveValue;
            }
          }
        } else {
          inHeaderDirectives = false;
        }
      }
      continue;
    }
    inHeaderDirectives = false;
    const startLine = index + 1 + startLineOffset;
    let combined = line.trimStart().trimEnd();
    while (combined.endsWith(escapeChar) && index + 1 < rawLines.length) {
      index += 1;
      const nextLine = rawLines[index].trimEnd();
      const nextTrimmed = nextLine.trimStart();
      if (nextTrimmed.length === 0 || nextTrimmed.startsWith("#")) {
        continue;
      }
      combined = `${combined.slice(0, -1)}${nextLine}`;
    }
    if (combined.endsWith(escapeChar)) {
      combined = combined.slice(0, -1).trimEnd();
    }
    pendingHeredocs.push(...extractDockerfileHeredocDelimiters(combined));
    logicalLines.push({ lineNumber: startLine, text: combined });
  }

  if (argOverrides?.has("BUILDKIT_SYNTAX")) {
    const syntaxProblems = [];
    checkBuildkitSyntaxOverride(
      argOverrides.get("BUILDKIT_SYNTAX"),
      sourceFile ?? filePath,
      sourceLine ?? 1,
      syntaxProblems,
    );
    for (const problem of syntaxProblems) {
      pushProblem(problem);
    }
  }

  const allStages = new Set();
  for (const { text } of logicalLines) {
    const fromMatch = /^FROM\s+(?<rest>.+)$/iu.exec(text);
    if (!fromMatch) {
      continue;
    }
    const tokens = fromMatch.groups.rest.trim().split(/\s+/u);
    let cursor = 0;
    while (cursor < tokens.length && tokens[cursor].startsWith("--")) {
      cursor += 1;
    }
    if (tokens[cursor + 1] && tokens[cursor + 1].toLowerCase() === "as" && tokens[cursor + 2]) {
      allStages.add(tokens[cursor + 2].toLowerCase());
    }
  }

  const platformBindingRuns = [];
  if (Array.isArray(platforms) && platforms.length > 0) {
    const seenPlatformKeys = new Set();
    let hadUnknownPlatform = false;
    for (const rawPlatform of platforms) {
      const parsed = parseBuildkitPlatform(rawPlatform);
      if (parsed) {
        if (!seenPlatformKeys.has(parsed.TARGETPLATFORM)) {
          seenPlatformKeys.add(parsed.TARGETPLATFORM);
          platformBindingRuns.push(parsed);
        }
      } else {
        hadUnknownPlatform = true;
      }
    }
    if (hadUnknownPlatform || platformBindingRuns.length === 0) {
      platformBindingRuns.push(null);
    }
  } else {
    platformBindingRuns.push(null);
  }

  const evaluateForPlatform = (platformBindings) => {
    const stages = new Set();
    const globalArgs = new Map();
    const globalAutomaticDynamicArgs = new Set(BUILDKIT_AUTOMATIC_PLATFORM_ARGS);
    if (platformBindings) {
      for (const [key, value] of Object.entries(platformBindings)) {
        globalArgs.set(key, { values: [value], truncated: false });
        globalAutomaticDynamicArgs.delete(key);
      }
    }
    let stageArgs = new Map();
    let stageAutomaticDynamicArgs = new Set();
    let seenFrom = false;
    const dynamicOverriddenArgs = new Set();

    const resolveBuildArgValues = (token, argsMap, activeDynamicArgs = dynamicOverriddenArgs) => {
      const referencedNames = extractReferencedBuildArgNames(token);
      const rawValues = new Map();
      const multiArgs = [];
      let truncated = false;

      for (const name of referencedNames) {
        if (!argsMap.has(name)) {
          continue;
        }
        const entry = argsMap.get(name);
        if (entry.truncated) {
          truncated = true;
        }
        if (entry.values.length > 0) {
          rawValues.set(name, entry.values[0]);
        }
        if (entry.values.length > 1) {
          multiArgs.push([name, entry.values]);
        }
      }

      if (multiArgs.length === 0) {
        return { values: [resolveBuildArgs(token, rawValues, 0, activeDynamicArgs)], truncated };
      }

      let combinations = [rawValues];
      for (const [name, values] of multiArgs) {
        const next = [];
        for (const combo of combinations) {
          for (const value of values) {
            if (next.length >= MAX_TOKEN_EXPANSIONS) {
              truncated = true;
              break;
            }
            const clone = new Map(combo);
            clone.set(name, value);
            next.push(clone);
          }
          if (truncated) {
            break;
          }
        }
        combinations = next;
      }

      const seen = new Set();
      const resolvedList = [];
      for (const combo of combinations) {
        const resolved = resolveBuildArgs(token, combo, 0, activeDynamicArgs);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          resolvedList.push(resolved);
        }
      }
      return { values: resolvedList, truncated };
    };

    const referencesDynamicOverride = (token) => {
      if (dynamicOverriddenArgs.size === 0) {
        return null;
      }
      const referenced = extractReferencedBuildArgNames(token);
      for (const argName of dynamicOverriddenArgs) {
        if (referenced.has(argName)) {
          return argName;
        }
      }
      return null;
    };

    for (const { lineNumber, text } of logicalLines) {
      const argMatch = /^ARG\s+(?<rest>.+)$/iu.exec(text);
      if (argMatch) {
        const targetArgs = seenFrom ? stageArgs : globalArgs;
        const targetAutoDynamic = seenFrom ? stageAutomaticDynamicArgs : globalAutomaticDynamicArgs;
        for (const declaration of parseDockerfileArgDeclarations(argMatch.groups.rest)) {
          const argName = declaration.name;
          if (argOverrides?.has(argName)) {
            const overrideEntry = argOverrides.get(argName);
            const overrideValues = Array.isArray(overrideEntry)
              ? overrideEntry
              : overrideEntry.values;
            const overrideTruncated = Array.isArray(overrideEntry)
              ? false
              : Boolean(overrideEntry.truncated);
            const staticOverrides = overrideValues.filter((val) => !isDynamicReference(val));
            if (overrideValues.some((val) => isDynamicReference(val))) {
              dynamicOverriddenArgs.add(argName);
            }
            if (staticOverrides.length > 0 || overrideTruncated) {
              targetArgs.set(argName, { values: staticOverrides, truncated: overrideTruncated });
              targetAutoDynamic.delete(argName);
            } else {
              targetArgs.delete(argName);
            }
          } else if (declaration.value !== undefined) {
            if (platformBindings && Object.hasOwn(platformBindings, argName)) {
              targetAutoDynamic.delete(argName);
              targetArgs.set(argName, { values: [platformBindings[argName]], truncated: false });
            } else {
              const mergedArgs = seenFrom ? new Map([...globalArgs, ...stageArgs]) : globalArgs;
              const activeDynamic = seenFrom
                ? new Set([...dynamicOverriddenArgs, ...stageAutomaticDynamicArgs])
                : new Set([...dynamicOverriddenArgs, ...globalAutomaticDynamicArgs]);
              targetAutoDynamic.delete(argName);
              targetArgs.set(
                argName,
                resolveBuildArgValues(stripQuotes(declaration.value), mergedArgs, activeDynamic),
              );
            }
          } else if (seenFrom) {
            if (globalArgs.has(argName)) {
              targetArgs.set(argName, globalArgs.get(argName));
              targetAutoDynamic.delete(argName);
            } else if (globalAutomaticDynamicArgs.has(argName)) {
              targetAutoDynamic.add(argName);
            }
          }
        }
        continue;
      }

      const fromMatch = /^FROM\s+(?<rest>.+)$/iu.exec(text);
      if (fromMatch) {
        seenFrom = true;
        stageArgs = new Map();
        stageAutomaticDynamicArgs = new Set();
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

        // Resolve against global ARGs (including any workflow `--build-arg`
        // overrides and BuildKit automatic platform ARGs) and check against
        // previously declared stages BEFORE registering the new stage alias.
        const dynamicOverrideName = referencesDynamicOverride(imageToken);
        if (dynamicOverrideName && sourceFile && sourceLine) {
          pushProblem(
            `${sourceFile}:${sourceLine}: build-arg ${dynamicOverrideName} overrides ${filePath}:${lineNumber} dynamically and cannot be verified`,
          );
        }
        const fromDynamicArgs = new Set([...dynamicOverriddenArgs, ...globalAutomaticDynamicArgs]);
        const expandedFrom = resolveBuildArgValues(imageToken, globalArgs, fromDynamicArgs);
        if (expandedFrom.truncated) {
          pushProblem(
            `${filePath}:${lineNumber}: ${imageToken} exceeds build-arg expansion limit and cannot be verified exhaustively`,
          );
        }
        for (const resolved of expandedFrom.values) {
          if (
            resolved.length > 0 &&
            resolved.toLowerCase() !== "scratch" &&
            !stages.has(resolved.toLowerCase()) &&
            !namedContexts?.has(resolved.toLowerCase()) &&
            !isDynamicReference(resolved) &&
            !isPinnedDigest(resolved)
          ) {
            pushProblem(`${filePath}:${lineNumber}: ${resolved} is not pinned to a sha256 digest`);
          }
        }

        if (stageAlias) {
          stages.add(stageAlias);
        }
        continue;
      }

      const onbuildMatch = /^ONBUILD\s+(?<nested>.+)$/iu.exec(text);
      const isOnbuild = Boolean(onbuildMatch);
      const effectiveText = onbuildMatch ? onbuildMatch.groups.nested.trimStart() : text;
      const isExternalOnbuildImage = (ref) =>
        ref.includes(":") || ref.includes("/") || ref.includes("@");

      const rawCopySource = extractCopyFromSource(effectiveText);
      if (rawCopySource) {
        if (isOnbuild) {
          if (
            rawCopySource.length > 0 &&
            !isDynamicReference(rawCopySource) &&
            isExternalOnbuildImage(rawCopySource) &&
            !isPinnedDigest(rawCopySource)
          ) {
            pushProblem(
              `${filePath}:${lineNumber}: ${rawCopySource} is not pinned to a sha256 digest`,
            );
          }
          continue;
        }
        const mergedArgs = new Map([...globalArgs, ...stageArgs]);
        const stageDynamicArgs = new Set([...dynamicOverriddenArgs, ...stageAutomaticDynamicArgs]);
        const dynamicOverrideName = referencesDynamicOverride(rawCopySource);
        if (dynamicOverrideName && sourceFile && sourceLine) {
          pushProblem(
            `${sourceFile}:${sourceLine}: build-arg ${dynamicOverrideName} overrides ${filePath}:${lineNumber} dynamically and cannot be verified`,
          );
        }
        const expandedCopy = resolveBuildArgValues(rawCopySource, mergedArgs, stageDynamicArgs);
        if (expandedCopy.truncated) {
          pushProblem(
            `${filePath}:${lineNumber}: ${rawCopySource} exceeds build-arg expansion limit and cannot be verified exhaustively`,
          );
        }
        for (const sourceRef of expandedCopy.values) {
          if (
            sourceRef.length === 0 ||
            /^\d+$/u.test(sourceRef) ||
            allStages.has(sourceRef.toLowerCase()) ||
            namedContexts?.has(sourceRef.toLowerCase()) ||
            isDynamicReference(sourceRef)
          ) {
            continue;
          }
          if (!isPinnedDigest(sourceRef)) {
            pushProblem(`${filePath}:${lineNumber}: ${sourceRef} is not pinned to a sha256 digest`);
          }
        }
        continue;
      }

      if (/^RUN\s+/iu.test(effectiveText)) {
        const mergedArgs = new Map([...globalArgs, ...stageArgs]);
        const stageDynamicArgs = new Set([...dynamicOverriddenArgs, ...stageAutomaticDynamicArgs]);
        for (const rawSource of extractRunMountSources(effectiveText)) {
          if (isOnbuild) {
            if (
              rawSource.length > 0 &&
              !isDynamicReference(rawSource) &&
              isExternalOnbuildImage(rawSource) &&
              !isPinnedDigest(rawSource)
            ) {
              pushProblem(
                `${filePath}:${lineNumber}: ${rawSource} is not pinned to a sha256 digest`,
              );
            }
            continue;
          }
          const dynamicOverrideName = referencesDynamicOverride(rawSource);
          if (dynamicOverrideName && sourceFile && sourceLine) {
            pushProblem(
              `${sourceFile}:${sourceLine}: build-arg ${dynamicOverrideName} overrides ${filePath}:${lineNumber} dynamically and cannot be verified`,
            );
          }
          const expandedMount = resolveBuildArgValues(rawSource, mergedArgs, stageDynamicArgs);
          if (expandedMount.truncated) {
            pushProblem(
              `${filePath}:${lineNumber}: ${rawSource} exceeds build-arg expansion limit and cannot be verified exhaustively`,
            );
          }
          for (const sourceRef of expandedMount.values) {
            if (
              sourceRef.length === 0 ||
              /^\d+$/u.test(sourceRef) ||
              allStages.has(sourceRef.toLowerCase()) ||
              namedContexts?.has(sourceRef.toLowerCase()) ||
              isDynamicReference(sourceRef)
            ) {
              continue;
            }
            if (!isPinnedDigest(sourceRef)) {
              pushProblem(
                `${filePath}:${lineNumber}: ${sourceRef} is not pinned to a sha256 digest`,
              );
            }
          }
        }
      }
    }
  };

  for (const platformBindings of platformBindingRuns) {
    evaluateForPlatform(platformBindings);
  }

  return problems;
}

export function checkWorkflowPins(root = process.cwd()) {
  const directories = [
    path.join(root, ".github", "workflows"),
    path.join(root, ".github", "actions"),
  ];
  const problems = [];
  const seenProblems = new Set();
  const pushProblem = (problem) => {
    if (!seenProblems.has(problem)) {
      seenProblems.add(problem);
      problems.push(problem);
    }
  };
  const explicitBuildFiles = new Set();
  const buildInvocations = [];
  const checkedLocalActionPins = new Set();
  let checked = 0;

  for (const directory of directories) {
    if (!existsSync(directory)) {
      continue;
    }
    for (const filePath of collectWorkflowFiles(directory)) {
      checked += 1;
      const source = readFileSync(filePath, "utf8");
      const relativePath = formatPortableRelativePath(root, filePath);
      checkedLocalActionPins.add(path.resolve(filePath));
      for (const problem of unpinnedActionReferences(source, relativePath)) {
        pushProblem(problem);
      }
      for (const problem of unpinnedWorkflowContainerReferences(source, relativePath, {
        root,
        explicitBuildFiles,
        buildInvocations,
        checkedLocalActionPins,
      })) {
        pushProblem(problem);
      }
    }
  }

  const symlinkProblems = [];

  const containerFileSet = new Set(
    collectContainerFiles(root, symlinkProblems).map((file) => path.resolve(file)),
  );
  for (const candidatePath of explicitBuildFiles) {
    const resolved = resolveSafeContainerFile(candidatePath, root, symlinkProblems);
    if (resolved) {
      containerFileSet.add(path.resolve(resolved));
    }
  }

  // Intersect named contexts across EVERY recorded invocation of a given build
  // file (including ordinary builds with no named contexts) so `FROM <ctx>` is
  // accepted in the standalone pass only when every invocation supplies `<ctx>`.
  const universalNamedContexts = new Map();
  const resolvedInvocations = [];
  for (const invocation of buildInvocations) {
    const resolvedFile = resolveSafeContainerFile(invocation.filePath, root, symlinkProblems);
    if (!resolvedFile) {
      continue;
    }
    const normalizedFile = path.resolve(resolvedFile);
    containerFileSet.add(normalizedFile);
    resolvedInvocations.push({ ...invocation, filePath: normalizedFile });
    if (!universalNamedContexts.has(normalizedFile)) {
      universalNamedContexts.set(normalizedFile, new Set(invocation.namedContexts));
    } else {
      const existing = universalNamedContexts.get(normalizedFile);
      for (const name of existing) {
        if (!invocation.namedContexts.has(name)) {
          existing.delete(name);
        }
      }
    }
  }

  for (const problem of symlinkProblems) {
    pushProblem(problem);
  }

  const containerFiles = [...containerFileSet].sort();
  for (const filePath of containerFiles) {
    const source = readFileSync(filePath, "utf8");
    const relativePath = formatPortableRelativePath(root, filePath);
    for (const problem of unpinnedContainerfileReferences(source, relativePath, {
      namedContexts: universalNamedContexts.get(filePath) ?? null,
    })) {
      pushProblem(problem);
    }
  }

  for (const invocation of resolvedInvocations) {
    if (invocation.buildArgs.size === 0 && invocation.platforms.length === 0) {
      continue;
    }
    const source = readFileSync(invocation.filePath, "utf8");
    const relativePath = formatPortableRelativePath(root, invocation.filePath);
    for (const problem of unpinnedContainerfileReferences(source, relativePath, {
      argOverrides: invocation.buildArgs,
      namedContexts: invocation.namedContexts,
      platforms: invocation.platforms,
      sourceFile: invocation.sourceFile,
      sourceLine: invocation.sourceLine,
    })) {
      pushProblem(problem);
    }
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
