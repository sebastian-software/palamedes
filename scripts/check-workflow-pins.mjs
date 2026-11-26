import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";

// GitHub resolves a tag at run time, so a compromised or moved tag silently
// changes what CI executes. Every third-party action is therefore pinned to a
// full commit SHA with a version comment, and every static container image
// reference in workflows, composite actions, and Containerfiles/Dockerfiles is
// pinned to an immutable `@sha256:` digest.
const PINNED_ACTION_PATTERN = /^[^\s@]+@[0-9a-f]{40}$/u;
const PINNED_DIGEST_PATTERN = /@sha256:[0-9a-f]{64}$/u;
const EMBEDDED_VAR_PATTERN =
  /\$(?:\{(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?<bare>[A-Za-z_][A-Za-z0-9_]*))/gu;
const ENV_EXPRESSION_PATTERN =
  /\$\{\{\s*env(?:\.(?<dot>[A-Za-z_][A-Za-z0-9_]*)|\[(?:'(?<sq>[A-Za-z_][A-Za-z0-9_]*)'|"(?<dq>[A-Za-z_][A-Za-z0-9_]*)")\])\s*\}\}/gu;
const MATRIX_EXPRESSION_PATTERN =
  /\$\{\{\s*matrix(?<path>(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*\}\}/gu;
const SINGLE_MATRIX_EXPRESSION_PATTERN =
  /^\$\{\{\s*matrix(?<path>(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*\}\}$/u;
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
  "{",
  "(",
]);
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
const MAX_YAML_CONVERSION_STEPS = 20_000;
const MAX_MATRIX_ROWS = 256;
const MAX_MATRIX_WORK = 10_000;
const MAX_VAR_VALUES = 32;
const MAX_TOKEN_EXPANSIONS = 64;

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
const PODMAN_RUN_VALUE_FLAGS = new Set([
  ...DOCKER_RUN_VALUE_FLAGS,
  "--arch",
  "--authfile",
  "--blkio-weight-device",
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
  for (const entry of [...existing, ...incoming]) {
    const key = `${entry.line}:${entry.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
    if (merged.length >= MAX_VAR_VALUES) {
      break;
    }
  }
  return merged;
}

function joinVarMaps(maps) {
  const joined = new Map();
  for (const map of maps) {
    for (const [key, entries] of map) {
      joined.set(key, mergeVarEntries(joined.get(key) ?? [], entries));
    }
  }
  return joined;
}

function expandPatternCandidates(candidates, pattern, lookup) {
  let results = candidates;
  let guard = 0;

  while (guard < 16) {
    guard += 1;
    let expandedAny = false;
    const nextResults = [];
    const seen = new Set();

    for (const candidate of results) {
      pattern.lastIndex = 0;
      const match = pattern.exec(candidate.text);
      if (!match) {
        const key = `${candidate.line}:${candidate.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          nextResults.push(candidate);
        }
        continue;
      }

      const entries = lookup(match);
      if (!entries || entries.length === 0) {
        const key = `${candidate.line}:${candidate.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          nextResults.push(candidate);
        }
        continue;
      }

      expandedAny = true;
      const isWholeToken = match.index === 0 && match[0].length === candidate.text.length;
      const prefix = candidate.text.slice(0, match.index);
      const suffix = candidate.text.slice(match.index + match[0].length);

      for (const entry of entries) {
        const nextText = `${prefix}${entry.value}${suffix}`;
        const nextLine = isWholeToken ? entry.line : candidate.line;
        const key = `${nextLine}:${nextText}`;
        if (!seen.has(key) && nextResults.length < MAX_TOKEN_EXPANSIONS) {
          seen.add(key);
          nextResults.push({ text: nextText, line: nextLine });
        }
      }
    }

    results = nextResults;
    if (!expandedAny) {
      break;
    }
  }

  return results;
}

function resolveEnvExpressionCandidates(text, stepEnv, fallbackLine) {
  return expandPatternCandidates(
    [{ text, line: fallbackLine }],
    new RegExp(ENV_EXPRESSION_PATTERN.source, "u"),
    (match) => {
      const name = match.groups.dot ?? match.groups.sq ?? match.groups.dq;
      return stepEnv.get(name) ?? null;
    },
  );
}

// GitHub Actions evaluates `${{ env.* }}` against the immutable step `env`
// before bash runs, whereas `$VAR`/`${VAR}` reflect reachable shell assignments.
function resolveImageTokenCandidates(token, stepEnv, shellVars, fallbackLine) {
  const afterActionsEnv = resolveEnvExpressionCandidates(token, stepEnv, fallbackLine);
  return expandPatternCandidates(
    afterActionsEnv,
    new RegExp(EMBEDDED_VAR_PATTERN.source, "u"),
    (match) => {
      const name = match.groups.braced ?? match.groups.bare;
      return shellVars.get(name) ?? null;
    },
  );
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
  return token === "$GITHUB_ENV" || token === "${GITHUB_ENV}";
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
// preserving empty quoted arguments (`''` / `""`), tracking heredocs (while
// ignoring `<<<` here-strings and arithmetic `<<`), attaching unquoted and
// double-quoted command substitutions to their owning command, and emitting
// explicit subshell and conditional/case markers.
function lexShellScript(text, startLine) {
  const events = [];
  let tokens = [];
  let commandSubstitutions = [];
  let commandLine = startLine;
  let commandConditional = false;
  let nextConditional = false;
  let current = "";
  let tokenStarted = false;
  let quote = null;
  let escaping = false;
  let arithDepth = 0;
  let arrayParenDepth = 0;
  let line = startLine;
  const pendingHeredocs = [];

  const markTokenStart = () => {
    if (!tokenStarted && tokens.length === 0) {
      commandLine = line;
      commandConditional = nextConditional;
      nextConditional = false;
    }
    tokenStarted = true;
  };

  const flushToken = () => {
    if (tokenStarted) {
      if (tokens.length === 0) {
        commandLine = line;
      }
      tokens.push(current);
      current = "";
      tokenStarted = false;
    }
  };

  const flushCommand = () => {
    flushToken();
    if (tokens.length > 0 || commandSubstitutions.length > 0) {
      events.push({
        kind: "command",
        tokens,
        lineNumber: commandLine,
        conditional: commandConditional,
        substitutions: commandSubstitutions,
      });
      tokens = [];
      commandSubstitutions = [];
      commandConditional = false;
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
        continue;
      }
      const bodyText = bodyLines.join("\n");
      if (spec.executable) {
        events.push({ kind: "enter-subshell" });
        events.push(...lexShellScript(bodyText, bodyStartLine));
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
      }
    }
    return cursor;
  };

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];

    if (escaping) {
      escaping = false;
      if (ch === "\n") {
        line += 1;
        continue;
      }
      markTokenStart();
      current += ch;
      continue;
    }

    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote === "'") {
      if (ch === "\n") {
        line += 1;
      }
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === "$" && text[index + 1] === "(" && text[index + 2] !== "(") {
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
      if (ch === "`") {
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

    if (ch === "'" || ch === '"') {
      markTokenStart();
      quote = ch;
      continue;
    }

    // Command substitution `$(...)` outside single quotes.
    if (ch === "$" && text[index + 1] === "(" && text[index + 2] !== "(") {
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

    // Backtick command substitution `` `...` `` outside single quotes.
    if (ch === "`") {
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
        index += 1;
      } else if (text[index + 1] === "&") {
        tokens.push(">&");
        index += 1;
      } else {
        tokens.push(">");
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
        pendingHeredocs.push({
          delimiter,
          stripTabs,
          quoted: delimQuoted,
          executable: isShellInterpreterCommand(tokens),
          ownerTokens: tokens,
          conditional: commandConditional,
        });
      }
      index = cursor - 1;
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
        arrayParenDepth += 1;
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

function resolveMatrixPath(rowMap, segments) {
  let current = { kind: "map", value: rowMap };
  for (const segment of segments) {
    if (current?.kind !== "map" || !current.value.has(segment)) {
      return null;
    }
    current = current.value.get(segment);
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
      if (!right.value.has(k) || !matrixNodesEqual(v, right.value.get(k))) {
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
      if (!row.has(k) || !matrixNodesEqual(row.get(k), v)) {
        return false;
      }
    }
    return true;
  });
}

function extractJobMatrixRows(jobNode, filePath, problems) {
  const strategyNode = jobNode?.value?.get("strategy");
  const matrixNode = strategyNode?.kind === "map" ? strategyNode.value.get("matrix") : null;
  if (matrixNode?.kind !== "map") {
    return [];
  }

  const axes = [];
  const axisNames = new Set();
  const includeRows = [];
  const excludeRows = [];

  for (const [key, entryNode] of matrixNode.value) {
    if (key === "exclude") {
      if (entryNode?.kind === "seq") {
        for (const rowNode of entryNode.value) {
          if (rowNode?.kind === "map") {
            excludeRows.push(rowNode.value);
          }
        }
      }
      continue;
    }
    if (key === "include") {
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
      axisNames.add(key);
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
    const sharedAxisKeys = [...includeMap.keys()].filter((k) => axisNames.has(k));
    let matchedBase = false;
    if (rows.length > 0) {
      for (const row of rows) {
        if (sharedAxisKeys.every((k) => matrixNodesEqual(row.get(k), includeMap.get(k)))) {
          matchedBase = true;
          for (const [k, v] of includeMap) {
            if (!axisNames.has(k)) {
              row.set(k, v);
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

function extractShellDashCScript(tokens, cursor) {
  let sawDashC = false;
  for (let index = cursor + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--" || token === "-") {
      return sawDashC ? (tokens[index + 1] ?? null) : null;
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
    return sawDashC ? token : null;
  }
  return null;
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
    const format = stripped[1];
    if (format === "%s" || format === "%s\\n" || format === "%s\n") {
      return stripped.slice(2).join("\n").split(/\r?\n/u);
    }
    const expanded = format.replace(/\\n/gu, "\n");
    return expanded.split(/\r?\n/u);
  }

  return null;
}

function peelControlKeywords(tokens, frame) {
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
    if (keyword === "for" || keyword === "while" || keyword === "until") {
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
  depth = 0,
) {
  if (depth > MAX_SHELL_NESTING_DEPTH) {
    return;
  }

  const scopeStack = [{ vars: cloneVarMap(shellVars), branches: [] }];

  for (const event of lexShellScript(scriptText, startLine)) {
    if (event.kind === "enter-subshell") {
      scopeStack.push({ vars: cloneVarMap(scopeStack.at(-1).vars), branches: [] });
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

    if (event.kind === "github-env-heredoc") {
      const isConditional = frame.branches.length > 0 || event.conditional;
      for (const assignment of parseGithubEnvPayload(event.lines, event.startLine)) {
        const resolved = event.quoted
          ? resolveEnvExpressionCandidates(assignment.value, stepEnv, assignment.line)
          : resolveImageTokenCandidates(assignment.value, stepEnv, frame.vars, assignment.line);
        recordGithubEnvWrite(
          emittedGithubEnv,
          assignment.name,
          resolved.map((entry) => ({ value: entry.text, line: assignment.line })),
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
        depth + 1,
      );
    }

    if (event.tokens.length === 0 || event.tokens[0].startsWith("#")) {
      continue;
    }

    const tokens = peelControlKeywords(event.tokens, frame);
    if (tokens.length === 0 || tokens[0].startsWith("#")) {
      continue;
    }

    // Pure variable assignment (`image=rust:1.96-alpine` or `export IMAGE=node:24`).
    const assignStart = tokens[0] === "export" ? 1 : 0;
    if (
      assignStart < tokens.length &&
      tokens.slice(assignStart).every((token) => ENV_PREFIX_ASSIGNMENT_PATTERN.test(token))
    ) {
      for (const token of tokens.slice(assignStart)) {
        const match = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(token);
        if (match) {
          const resolved = resolveImageTokenCandidates(
            match.groups.value,
            stepEnv,
            frame.vars,
            lineNumber,
          ).map((entry) => ({ value: entry.text, line: lineNumber }));
          if (conditional) {
            frame.vars.set(
              match.groups.name,
              mergeVarEntries(frame.vars.get(match.groups.name) ?? [], resolved),
            );
          } else {
            frame.vars.set(match.groups.name, resolved);
          }
        }
      }
      continue;
    }

    // Keep argument-expansion scope (`frame.vars`) separate from the child
    // process environment (`commandVars`): prefix assignments like
    // `IMAGE=new docker pull "$IMAGE"` only change the child environment, while
    // the shell expands `"$IMAGE"` from `frame.vars`.
    const commandVars = cloneVarMap(frame.vars);
    let cursor = 0;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (SHELL_COMMAND_PREFIXES.has(token)) {
        cursor += 1;
        continue;
      }
      const prefixAssign = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(token);
      if (prefixAssign) {
        const resolved = resolveImageTokenCandidates(
          prefixAssign.groups.value,
          stepEnv,
          frame.vars,
          lineNumber,
        ).map((entry) => ({ value: entry.text, line: lineNumber }));
        commandVars.set(prefixAssign.groups.name, resolved);
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
        );
        recordGithubEnvWrite(
          emittedGithubEnv,
          assignment.name,
          resolved.map((entry) => ({ value: entry.text, line: lineNumber })),
          isConditional,
        );
      }
      continue;
    }

    if (SHELL_INTERPRETERS.has(path.basename(cli))) {
      const dashCScript = extractShellDashCScript(tokens, cursor);
      if (dashCScript) {
        inspectShellText(
          dashCScript,
          lineNumber,
          sourceLines,
          stepEnv,
          commandVars,
          matrixRows,
          filePath,
          problems,
          emittedGithubEnv,
          depth + 1,
        );
      }
      continue;
    }

    if (cli !== "docker" && cli !== "podman") {
      continue;
    }

    const globalValueFlags =
      cli === "podman" ? PODMAN_GLOBAL_VALUE_FLAGS : DOCKER_GLOBAL_VALUE_FLAGS;
    let argIndex = cursor + 1;
    while (argIndex < tokens.length) {
      const flag = tokens[argIndex];
      if (flag === ">" || flag === ">>" || flag === ">&" || flag === "<") {
        argIndex += 2;
        continue;
      }
      if (!flag.startsWith("-")) {
        break;
      }
      argIndex += !flag.includes("=") && globalValueFlags.has(flag) ? 2 : 1;
    }

    let subcommand = tokens[argIndex];
    if (subcommand === "image" && tokens[argIndex + 1] === "pull") {
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
      cli === "podman"
        ? subcommand === "pull"
          ? PODMAN_PULL_VALUE_FLAGS
          : PODMAN_RUN_VALUE_FLAGS
        : subcommand === "pull"
          ? DOCKER_PULL_VALUE_FLAGS
          : DOCKER_RUN_VALUE_FLAGS;
    let imageToken = null;

    for (let index = argIndex; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "--") {
        imageToken = tokens[index + 1] ?? null;
        break;
      }
      if (token === ">" || token === ">>" || token === ">&" || token === "<") {
        index += 1;
        continue;
      }
      if (
        /^\d+$/u.test(token) &&
        (tokens[index + 1] === ">" || tokens[index + 1] === ">>" || tokens[index + 1] === ">&")
      ) {
        index += 2;
        continue;
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
      imageToken = token;
      break;
    }

    if (!imageToken) {
      continue;
    }

    const fallbackLine = sourceLines
      ? (sourceLines.find((entry) => entry.text.includes(imageToken))?.lineNumber ?? lineNumber)
      : lineNumber;

    const varExpandedCandidates = resolveImageTokenCandidates(
      imageToken,
      stepEnv,
      frame.vars,
      fallbackLine,
    );
    const seenProblems = new Set();
    for (const varCandidate of varExpandedCandidates) {
      for (const candidate of expandMatrixReferences(
        varCandidate.text,
        matrixRows,
        varCandidate.line,
      )) {
        if (isDynamicReference(candidate.text)) {
          continue;
        }
        if (!isPinnedDigest(candidate.text)) {
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

function inspectShellRunScript(
  runNode,
  stepEnv,
  matrixRows,
  filePath,
  problems,
  emittedGithubEnv = null,
) {
  const scriptText =
    runNode.folded && Array.isArray(runNode.lines)
      ? runNode.value
      : Array.isArray(runNode.lines)
        ? runNode.lines.map((entry) => entry.text).join("\n")
        : String(runNode.value);
  const sourceLines = runNode.folded && Array.isArray(runNode.lines) ? runNode.lines : null;

  inspectShellText(
    scriptText,
    runNode.line,
    sourceLines,
    stepEnv,
    stepEnv,
    matrixRows,
    filePath,
    problems,
    emittedGithubEnv,
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
  for (const envCandidate of resolveEnvExpressionCandidates(rawRef, envMap, node.line)) {
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

function checkStepsList(stepsNode, baseEnv, matrixRows, filePath, problems) {
  if (stepsNode?.kind !== "seq") {
    return;
  }
  const runningEnv = cloneVarMap(baseEnv);
  for (const stepNode of stepsNode.value) {
    if (stepNode?.kind !== "map") {
      continue;
    }
    const stepEnv = extractEnvMap(stepNode.value.get("env"), runningEnv);
    const stepConditional = stepNode.value.has("if");
    const emittedGithubEnv = new Map();
    const runNode = stepNode.value.get("run");
    if (runNode?.kind === "scalar") {
      inspectShellRunScript(runNode, stepEnv, matrixRows, filePath, problems, emittedGithubEnv);
    }
    for (const [name, write] of emittedGithubEnv) {
      if (stepConditional || write.conditional || !runningEnv.has(name)) {
        runningEnv.set(name, mergeVarEntries(runningEnv.get(name) ?? [], write.entries));
      } else {
        runningEnv.set(name, write.entries);
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
      const usesNode = stepNode.value.get("uses");
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

  const topUses = doc.value.get("uses");
  if (topUses?.kind === "scalar") {
    usesNodes.push(topUses);
  }
  collectFromSteps(doc.value.get("steps"));

  const runsNode = doc.value.get("runs");
  if (runsNode?.kind === "map") {
    collectFromSteps(runsNode.value.get("steps"));
  }

  const jobsNode = doc.value.get("jobs");
  if (jobsNode?.kind === "map") {
    for (const jobNode of jobsNode.value.values()) {
      if (jobNode?.kind !== "map") {
        continue;
      }
      const jobUses = jobNode.value.get("uses");
      if (jobUses?.kind === "scalar") {
        usesNodes.push(jobUses);
      }
      collectFromSteps(jobNode.value.get("steps"));
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

export function unpinnedWorkflowContainerReferences(source, filePath = "<memory>") {
  const problems = [];
  const { doc, error } = parseWorkflowYaml(source);
  if (error) {
    problems.push(`${filePath}:${error.line}: ${error.message}`);
  }
  if (!doc) {
    return problems;
  }

  if (doc.kind === "seq") {
    checkStepsList(doc, new Map(), [], filePath, problems);
    return problems;
  }

  if (doc.kind !== "map") {
    return problems;
  }

  const workflowEnv = extractEnvMap(doc.value.get("env"), new Map());

  const checkContainerNode = (containerNode, envMap, matrixRows) => {
    if (!containerNode) {
      return;
    }
    if (containerNode.kind === "scalar") {
      checkImageField(containerNode, envMap, matrixRows, filePath, problems);
    } else if (containerNode.kind === "map") {
      checkImageField(containerNode.value.get("image"), envMap, matrixRows, filePath, problems);
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

  checkContainerNode(doc.value.get("container"), workflowEnv, []);
  checkServicesNode(doc.value.get("services"), workflowEnv, []);
  checkImageField(doc.value.get("image"), workflowEnv, [], filePath, problems);
  checkStepsList(doc.value.get("steps"), workflowEnv, [], filePath, problems);

  const runsNode = doc.value.get("runs");
  if (runsNode?.kind === "map") {
    checkImageField(runsNode.value.get("image"), workflowEnv, [], filePath, problems, {
      allowLocalDockerAction: true,
    });
    checkStepsList(runsNode.value.get("steps"), workflowEnv, [], filePath, problems);
  }

  const jobsNode = doc.value.get("jobs");
  if (jobsNode?.kind === "map") {
    for (const jobNode of jobsNode.value.values()) {
      if (jobNode?.kind !== "map") {
        continue;
      }
      const jobEnv = extractEnvMap(jobNode.value.get("env"), workflowEnv);
      const jobMatrixRows = extractJobMatrixRows(jobNode, filePath, problems);
      checkContainerNode(jobNode.value.get("container"), jobEnv, jobMatrixRows);
      checkServicesNode(jobNode.value.get("services"), jobEnv, jobMatrixRows);
      checkStepsList(jobNode.value.get("steps"), jobEnv, jobMatrixRows, filePath, problems);
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

export function unpinnedContainerfileReferences(source, filePath = "<memory>") {
  const problems = [];
  const rawLines = source.split(/\r?\n/u);
  const logicalLines = [];
  const pendingHeredocs = [];
  let inHeaderDirectives = true;

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
      continue;
    }
    if (trimmed.startsWith("#")) {
      if (inHeaderDirectives) {
        const syntaxMatch = /^#\s*syntax\s*=\s*(?<image>\S+)/iu.exec(trimmed);
        if (syntaxMatch) {
          const frontend = stripQuotes(syntaxMatch.groups.image);
          if (!isDynamicReference(frontend) && !isPinnedDigest(frontend)) {
            problems.push(`${filePath}:${index + 1}: ${frontend} is not pinned to a sha256 digest`);
          }
        }
      }
      continue;
    }
    inHeaderDirectives = false;
    const startLine = index + 1;
    let combined = trimmed;
    while (combined.endsWith("\\") && index + 1 < rawLines.length) {
      index += 1;
      const nextTrimmed = rawLines[index].trim();
      if (nextTrimmed.length === 0 || nextTrimmed.startsWith("#")) {
        continue;
      }
      combined = `${combined.slice(0, -1)} ${nextTrimmed}`;
    }
    if (combined.endsWith("\\")) {
      combined = combined.slice(0, -1).trimEnd();
    }
    pendingHeredocs.push(...extractDockerfileHeredocDelimiters(combined));
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
      continue;
    }

    if (/^RUN\s+/iu.test(text)) {
      const mergedArgs = new Map([...globalArgs, ...stageArgs]);
      for (const rawSource of extractRunMountSources(text)) {
        const sourceRef = resolveBuildArgs(rawSource, mergedArgs);
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
  }

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
