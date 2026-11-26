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
const SINGLE_ENV_EXPRESSION_PATTERN =
  /^\$\{\{\s*env(?:\.(?<dot>[A-Za-z_][A-Za-z0-9_]*)|\[(?:'(?<sq>[A-Za-z_][A-Za-z0-9_]*)'|"(?<dq>[A-Za-z_][A-Za-z0-9_]*)")\])\s*\}\}$/u;
const MATRIX_EXPRESSION_PATTERN =
  /\$\{\{\s*matrix(?<path>(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*\}\}/gu;
const SINGLE_MATRIX_EXPRESSION_PATTERN =
  /^\$\{\{\s*matrix(?<path>(?:\.[A-Za-z0-9_-]+|\[(?:'[^']+'|"[^"]+")\])+)\s*\}\}$/u;
const MATRIX_SEGMENT_PATTERN = /\.([A-Za-z0-9_-]+)|\[(?:'([^']+)'|"([^"]+)")\]/gu;
const ENV_PREFIX_ASSIGNMENT_PATTERN = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/u;
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

function resolveEnvExpressions(text, envMap) {
  return text.replace(ENV_EXPRESSION_PATTERN, (match, _p1, _p2, _p3, _offset, _str, groups) => {
    const name = groups.dot ?? groups.sq ?? groups.dq;
    return envMap.has(name) ? envMap.get(name).value : match;
  });
}

function resolveVars(token, vars) {
  const withEnv = resolveEnvExpressions(token, vars);
  return withEnv.replace(EMBEDDED_VAR_PATTERN, (match, _p1, _p2, _offset, _str, groups) => {
    const name = groups.braced ?? groups.bare;
    return vars.has(name) ? vars.get(name).value : match;
  });
}

function lookupSingleVarLine(token, vars, fallbackLine) {
  const envExpr = SINGLE_ENV_EXPRESSION_PATTERN.exec(token);
  if (envExpr) {
    const name = envExpr.groups.dot ?? envExpr.groups.sq ?? envExpr.groups.dq;
    return vars.get(name)?.line ?? fallbackLine;
  }
  const singleVar =
    /^\$(?:\{(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?<bare>[A-Za-z_][A-Za-z0-9_]*))$/u.exec(token);
  if (singleVar) {
    const name = singleVar.groups.braced ?? singleVar.groups.bare;
    return vars.get(name)?.line ?? fallbackLine;
  }
  return fallbackLine;
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

// --- YAML AST parsing via `yaml` with 1-based line numbers -------------------

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

function convertYamlNode(node, doc, lineCounter, rawLines, seen = new Set()) {
  if (!node) {
    return null;
  }
  if (isAlias(node)) {
    const target = node.resolve(doc);
    if (!target || seen.has(target)) {
      return null;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(target);
    return convertYamlNode(target, doc, lineCounter, rawLines, nextSeen);
  }
  if (isMap(node)) {
    const map = new Map();
    const deferredMerges = [];
    for (const pair of node.items) {
      if (isMergeKey(pair.key)) {
        const mergedVal = convertYamlNode(pair.value, doc, lineCounter, rawLines, seen);
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
      const val = convertYamlNode(pair.value, doc, lineCounter, rawLines, seen);
      map.set(
        key,
        val ?? { kind: "scalar", value: "", line: nodeStartLine(pair.key, lineCounter) },
      );
    }
    // Explicit keys take precedence over merged keys per YAML merge semantics.
    for (const sourceMap of deferredMerges) {
      for (const [key, val] of sourceMap.value) {
        if (!map.has(key)) {
          map.set(key, val);
        }
      }
    }
    return { kind: "map", value: map, line: nodeStartLine(node, lineCounter) };
  }
  if (isSeq(node)) {
    const items = [];
    for (const item of node.items) {
      const converted = convertYamlNode(item, doc, lineCounter, rawLines, seen);
      if (converted) {
        items.push(converted);
      }
    }
    return { kind: "seq", value: items, line: nodeStartLine(node, lineCounter) };
  }
  if (isScalar(node)) {
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

    return scalar;
  }
  return null;
}

function parseWorkflowYaml(source) {
  const normalized = dedentYamlSnippet(source);
  const rawLines = normalized.split(/\r?\n/u);
  const lineCounter = new LineCounter();
  const doc = parseDocument(normalized, { lineCounter, merge: true });

  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    const line = first.linePos?.[0]?.line ?? 1;
    return {
      doc: convertYamlNode(doc.contents, doc, lineCounter, rawLines),
      error: { line, message: `failed to parse workflow YAML: ${first.message.split("\n")[0]}` },
    };
  }

  return {
    doc: convertYamlNode(doc.contents, doc, lineCounter, rawLines),
    error: null,
  };
}

// --- Shell tokenization, heredocs, and command substitutions -----------------

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

    // Keep GitHub Actions `${{ ... }}` expressions intact as a single token so
    // spaces inside `${{ env.IMAGE }}` or `${{ matrix.platform.image }}` do
    // not split the image argument.
    if (ch === "$" && command[index + 1] === "{" && command[index + 2] === "{") {
      const closeIndex = command.indexOf("}}", index + 3);
      if (closeIndex !== -1) {
        current += command.slice(index, closeIndex + 2);
        index = closeIndex + 1;
        continue;
      }
    }

    // POSIX shell comments start with an unquoted `#` at a token boundary.
    if (ch === "#" && current.length === 0) {
      flushCommand();
      while (index < command.length && command[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (ch === "\n" || ch === ";") {
      flushCommand();
      continue;
    }

    if (ch === "(" && (current.length === 0 || current === "$")) {
      current = "";
      flushCommand();
      continue;
    }

    if (ch === ")" && current.length === 0) {
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

// Extract executable command substitutions `$(...)` and `` `...` `` from a
// shell line (both unquoted and inside double quotes; never inside single
// quotes or arithmetic `$((...))`).
function extractCommandSubstitutions(command) {
  const substitutions = [];
  let quote = null;
  let escaping = false;

  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];

    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      }
      continue;
    }
    if (ch === "'" && quote === null) {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (quote === null && ch === "#" && (index === 0 || /\s/u.test(command[index - 1]))) {
      break;
    }

    // `$(...)` (skipping arithmetic `$((...))`)
    if (ch === "$" && command[index + 1] === "(" && command[index + 2] !== "(") {
      let depth = 1;
      let cursor = index + 2;
      let innerQuote = null;
      let innerEscape = false;
      while (cursor < command.length && depth > 0) {
        const ich = command[cursor];
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
      if (depth === 0) {
        substitutions.push(command.slice(index + 2, cursor - 1));
        index = cursor - 1;
      }
      continue;
    }

    // Backtick substitution `` `...` ``
    if (ch === "`") {
      let cursor = index + 1;
      let btEscape = false;
      while (cursor < command.length) {
        const bch = command[cursor];
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
          break;
        }
        cursor += 1;
      }
      if (cursor < command.length && command[cursor] === "`") {
        substitutions.push(command.slice(index + 1, cursor));
        index = cursor;
      }
    }
  }

  return substitutions;
}

function extractHeredocDelimiters(line) {
  const delimiters = [];
  let quote = null;
  let escaping = false;

  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];

    if (escaping) {
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
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "#" && (index === 0 || /\s/u.test(line[index - 1]))) {
      break;
    }
    if (ch === "<" && line[index + 1] === "<") {
      // Consume Bash here-string `<<<` as a single operator so it is never
      // misread as a heredoc `<<` with no closing delimiter.
      if (line[index + 2] === "<") {
        index += 2;
        continue;
      }
      let cursor = index + 2;
      let stripTabs = false;
      if (line[cursor] === "-") {
        stripTabs = true;
        cursor += 1;
      }
      while (cursor < line.length && /[ \t]/u.test(line[cursor])) {
        cursor += 1;
      }
      let delimiter = "";
      let delimQuote = null;
      let delimEscaping = false;
      while (cursor < line.length) {
        const dch = line[cursor];
        if (delimEscaping) {
          delimiter += dch;
          delimEscaping = false;
          cursor += 1;
          continue;
        }
        if (dch === "\\" && delimQuote !== "'") {
          delimEscaping = true;
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
        delimiters.push({ delimiter, stripTabs });
      }
      index = cursor - 1;
    }
  }

  return delimiters;
}

function collectExecutableShellLines(entries) {
  const logicalLines = [];
  const pendingHeredocs = [];

  for (let index = 0; index < entries.length; index += 1) {
    const { text, lineNumber } = entries[index];

    if (pendingHeredocs.length > 0) {
      const current = pendingHeredocs[0];
      const candidate = current.stripTabs ? text.replace(/^\t+/u, "") : text;
      if (candidate === current.delimiter) {
        pendingHeredocs.shift();
      }
      continue;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const startLine = lineNumber;
    let combined = trimmed;
    while (combined.endsWith("\\") && index + 1 < entries.length) {
      combined = `${combined.slice(0, -1)} ${entries[index + 1].text.trim()}`;
      index += 1;
    }

    pendingHeredocs.push(...extractHeredocDelimiters(combined));
    logicalLines.push({ text: combined, lineNumber: startLine, sourceLines: null });
  }

  return logicalLines;
}

// --- Matrix row expansion (including nested object-valued axes & include) ----

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

function extractJobMatrixRows(jobNode) {
  const strategyNode = jobNode?.value?.get("strategy");
  const matrixNode = strategyNode?.kind === "map" ? strategyNode.value.get("matrix") : null;
  if (matrixNode?.kind !== "map") {
    return [];
  }

  const axes = [];
  const includeRows = [];

  for (const [key, entryNode] of matrixNode.value) {
    if (key === "exclude") {
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
    }
  }

  let rows = axes.length > 0 ? [new Map()] : [];
  for (const [axisKey, axisValues] of axes) {
    const next = [];
    for (const baseRow of rows) {
      for (const valueNode of axisValues) {
        const clone = new Map(baseRow);
        clone.set(axisKey, valueNode);
        next.push(clone);
        if (next.length >= 256) {
          break;
        }
      }
      if (next.length >= 256) {
        break;
      }
    }
    rows = next;
  }

  for (const includeMap of includeRows) {
    rows.push(includeMap);
  }

  return rows;
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

function inspectShellCommandText(
  text,
  lineNumber,
  sourceLines,
  vars,
  matrixRows,
  filePath,
  problems,
) {
  // Inspect executable command substitutions (`$(...)` and `` `...` ``) even
  // when nested inside shell variable assignments (`cid=$(docker run -d ...)`).
  for (const nested of extractCommandSubstitutions(text)) {
    inspectShellCommandText(
      nested,
      lineNumber,
      sourceLines,
      new Map(vars),
      matrixRows,
      filePath,
      problems,
    );
  }

  for (const tokens of splitShellCommands(text)) {
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
          vars.set(match.groups.name, {
            value: resolveVars(match.groups.value, vars),
            line: lineNumber,
          });
        }
      }
      continue;
    }

    const commandVars = new Map(vars);
    let cursor = 0;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (SHELL_COMMAND_PREFIXES.has(token)) {
        cursor += 1;
        continue;
      }
      const prefixAssign = ENV_PREFIX_ASSIGNMENT_PATTERN.exec(token);
      if (prefixAssign) {
        commandVars.set(prefixAssign.groups.name, {
          value: resolveVars(prefixAssign.groups.value, commandVars),
          line: lineNumber,
        });
        cursor += 1;
        continue;
      }
      break;
    }

    const cli = tokens[cursor];
    if (cli !== "docker" && cli !== "podman") {
      continue;
    }

    let argIndex = cursor + 1;
    while (argIndex < tokens.length && tokens[argIndex].startsWith("-")) {
      const flag = tokens[argIndex];
      argIndex += !flag.includes("=") && DOCKER_GLOBAL_VALUE_FLAGS.has(flag) ? 2 : 1;
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

    const valueFlags = subcommand === "pull" ? DOCKER_PULL_VALUE_FLAGS : DOCKER_RUN_VALUE_FLAGS;
    let imageToken = null;

    for (let index = argIndex; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "--") {
        imageToken = tokens[index + 1] ?? null;
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
      imageToken = token;
      break;
    }

    if (!imageToken) {
      continue;
    }

    const varLine = lookupSingleVarLine(imageToken, commandVars, lineNumber);
    const defaultLine =
      varLine !== lineNumber
        ? varLine
        : sourceLines
          ? (sourceLines.find((entry) => entry.text.includes(imageToken))?.lineNumber ?? lineNumber)
          : lineNumber;

    const resolvedWithVars = resolveVars(imageToken, commandVars);
    for (const candidate of expandMatrixReferences(resolvedWithVars, matrixRows, defaultLine)) {
      if (isDynamicReference(candidate.text)) {
        continue;
      }
      if (!isPinnedDigest(candidate.text)) {
        problems.push(
          `${filePath}:${candidate.line}: ${candidate.text} is not pinned to a sha256 digest`,
        );
      }
    }
  }
}

function inspectShellRunScript(runNode, inheritedEnv, matrixRows, filePath, problems) {
  const vars = new Map(inheritedEnv);

  const logicalLines =
    runNode.folded && Array.isArray(runNode.lines)
      ? [{ text: runNode.value, lineNumber: runNode.line, sourceLines: runNode.lines }]
      : Array.isArray(runNode.lines)
        ? collectExecutableShellLines(runNode.lines)
        : collectExecutableShellLines(
            String(runNode.value)
              .split(/\r?\n/u)
              .map((text, offset) => ({ text, lineNumber: runNode.line + offset })),
          );

  for (const { text, lineNumber, sourceLines } of logicalLines) {
    inspectShellCommandText(text, lineNumber, sourceLines, vars, matrixRows, filePath, problems);
  }
}

function extractEnvMap(envNode, baseEnv) {
  const merged = new Map(baseEnv);
  if (envNode?.kind !== "map") {
    return merged;
  }
  for (const [key, valueNode] of envNode.value) {
    if (valueNode?.kind === "scalar") {
      merged.set(key, { value: String(valueNode.value), line: valueNode.line });
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
  const envResolved = resolveEnvExpressions(rawRef, envMap);
  const envLine = lookupSingleVarLine(rawRef, envMap, node.line);

  for (const candidate of expandMatrixReferences(envResolved, matrixRows, envLine)) {
    const imageRef = candidate.text.trim();
    if (!imageRef || isDynamicReference(imageRef)) {
      continue;
    }
    if (allowLocalDockerAction && isLocalDockerActionImage(imageRef)) {
      continue;
    }
    if (!isPinnedDigest(imageRef)) {
      problems.push(`${filePath}:${candidate.line}: ${imageRef} is not pinned to a sha256 digest`);
    }
  }
}

function checkStepsList(stepsNode, baseEnv, matrixRows, filePath, problems) {
  if (stepsNode?.kind !== "seq") {
    return;
  }
  for (const stepNode of stepsNode.value) {
    if (stepNode?.kind !== "map") {
      continue;
    }
    const stepEnv = extractEnvMap(stepNode.value.get("env"), baseEnv);
    const runNode = stepNode.value.get("run");
    if (runNode?.kind === "scalar") {
      inspectShellRunScript(runNode, stepEnv, matrixRows, filePath, problems);
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
      const jobMatrixRows = extractJobMatrixRows(jobNode);
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

function extractRunMountSources(runText) {
  const sources = [];
  const rest = runText.replace(/^RUN\s+/iu, "");
  const tokens = splitShellCommands(rest)[0] ?? [];
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
  let inHeaderDirectives = true;

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
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
