import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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

// --- Zero-dependency YAML parser with 1-based line tracking ------------------
// Handles the YAML 1.2 subset used by GitHub Actions workflows and actions:
// block/flow mappings & sequences, quoted/plain scalars, literal (`|`) and
// folded (`>`) block scalars, and inline comments.

function stripInlineComment(text) {
  let quote = null;
  let escaping = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
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
        if (quote === "'" && text[index + 1] === "'") {
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
    if (ch === "#" && (index === 0 || /\s/u.test(text[index - 1]))) {
      return text.slice(0, index).trimEnd();
    }
  }
  return text.trimEnd();
}

function decodeDoubleQuoted(raw) {
  let out = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const ch = raw[index];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    index += 1;
    const esc = raw[index];
    switch (esc) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "/":
        out += "/";
        break;
      default:
        out += esc ?? "";
        break;
    }
  }
  return out;
}

function decodeScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return decodeDoubleQuoted(trimmed);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function findMappingColon(text) {
  let quote = null;
  let escaping = false;
  let flowDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
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
        if (quote === "'" && text[index + 1] === "'") {
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
    if (ch === "{" || ch === "[") {
      flowDepth += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      flowDepth = Math.max(0, flowDepth - 1);
      continue;
    }
    if (
      flowDepth === 0 &&
      ch === ":" &&
      (index + 1 === text.length || /\s/u.test(text[index + 1]))
    ) {
      return index;
    }
  }

  return -1;
}

function splitFlowEntries(inner) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaping = false;
  let depth = 0;

  for (let index = 0; index < inner.length; index += 1) {
    const ch = inner[index];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote === '"') {
      current += ch;
      escaping = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (quote === "'" && inner[index + 1] === "'") {
          current += inner[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (depth === 0 && ch === ",") {
      if (current.trim().length > 0) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += ch;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

function stripYamlNodeProperties(raw) {
  let remaining = raw.trim();
  let anchor = null;

  for (;;) {
    const anchorMatch = /^&(?<name>[^\s,[\]{}]+)(?:\s+(?<rest>.*))?$/u.exec(remaining);
    if (anchorMatch) {
      anchor = anchorMatch.groups.name;
      remaining = (anchorMatch.groups.rest ?? "").trim();
      continue;
    }
    const tagMatch = /^![^\s,[\]{}]*(?:\s+(?<rest>.*))?$/u.exec(remaining);
    if (tagMatch) {
      remaining = (tagMatch.groups.rest ?? "").trim();
      continue;
    }
    break;
  }

  return { anchor, rest: remaining };
}

function mergeYamlMappingEntry(map, key, valueNode) {
  if (key === "<<") {
    const sources =
      valueNode?.kind === "map"
        ? [valueNode]
        : valueNode?.kind === "seq"
          ? valueNode.value.filter((item) => item?.kind === "map")
          : [];
    for (const source of sources) {
      for (const [sourceKey, sourceValue] of source.value) {
        if (!map.has(sourceKey)) {
          map.set(sourceKey, sourceValue);
        }
      }
    }
    return;
  }
  map.set(key, valueNode);
}

function parseFlowValue(raw, line, anchors = new Map()) {
  const { anchor, rest: trimmed } = stripYamlNodeProperties(stripInlineComment(raw));
  const aliasMatch = /^\*(?<name>[^\s,[\]{}]+)$/u.exec(trimmed);
  if (aliasMatch) {
    const target = anchors.get(aliasMatch.groups.name);
    if (target) {
      return target;
    }
    return { kind: "scalar", value: "", line };
  }

  let node;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const map = new Map();
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length > 0) {
      for (const entry of splitFlowEntries(inner)) {
        const colon = findMappingColon(entry);
        if (colon === -1) {
          continue;
        }
        const key = decodeScalar(entry.slice(0, colon));
        const rest = entry.slice(colon + 1).trim();
        mergeYamlMappingEntry(map, key, parseFlowValue(rest, line, anchors));
      }
    }
    node = { kind: "map", value: map, line };
  } else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const items = [];
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length > 0) {
      for (const entry of splitFlowEntries(inner)) {
        items.push(parseFlowValue(entry, line, anchors));
      }
    }
    node = { kind: "seq", value: items, line };
  } else {
    node = { kind: "scalar", value: decodeScalar(trimmed), line };
  }

  if (anchor) {
    anchors.set(anchor, node);
  }
  return node;
}

function parseYaml(source) {
  const rawLines = source.split(/\r?\n/u);
  const isTopLevelMarker = (line) =>
    line === "---" || line === "..." || /^%(?:YAML|TAG)\b/u.test(line);

  // Dedent snippet inputs (like indented fragments in unit tests) while keeping
  // original 1-based line numbers intact. Preserve indentation of `---`/`...`
  // inside block scalars so YAML heredocs inside `run: |` stay intact.
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || isTopLevelMarker(line)) {
      continue;
    }
    minIndent = Math.min(minIndent, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(minIndent)) {
    return { doc: null, error: null };
  }

  const lines = rawLines.map((line, index) => ({
    lineNumber: index + 1,
    text: line.length >= minIndent ? line.slice(minIndent) : line.trimStart(),
  }));

  const anchors = new Map();

  function nextNonEmpty(start) {
    let cursor = start;
    while (cursor < lines.length) {
      const trimmed = lines[cursor].text.trim();
      if (trimmed.length > 0 && !trimmed.startsWith("#")) {
        return cursor;
      }
      cursor += 1;
    }
    return lines.length;
  }

  function indentOf(index) {
    const text = lines[index].text;
    return text.length - text.trimStart().length;
  }

  function parseBlockScalar(headerLineIndex, parentIndent, style) {
    const isFolded = style.startsWith(">");
    const body = [];
    let cursor = headerLineIndex + 1;
    let contentIndent = null;

    while (cursor < lines.length) {
      const { text, lineNumber } = lines[cursor];
      if (text.trim().length === 0) {
        body.push({ text: "", lineNumber });
        cursor += 1;
        continue;
      }
      const lineIndent = text.length - text.trimStart().length;
      if (lineIndent <= parentIndent) {
        break;
      }
      if (contentIndent === null) {
        contentIndent = lineIndent;
      }
      body.push({
        text: text.length >= contentIndent ? text.slice(contentIndent) : text.trimStart(),
        lineNumber,
      });
      cursor += 1;
    }

    while (body.length > 0 && body.at(-1).text === "") {
      body.pop();
    }

    if (isFolded) {
      let folded = "";
      for (let idx = 0; idx < body.length; idx += 1) {
        const entry = body[idx];
        if (entry.text === "") {
          folded += "\n";
        } else {
          if (folded.length > 0 && !folded.endsWith("\n")) {
            folded += " ";
          }
          folded += entry.text;
        }
      }
      return {
        node: {
          kind: "scalar",
          value: folded,
          line: body[0]?.lineNumber ?? lines[headerLineIndex].lineNumber,
          lines: body,
          folded: true,
        },
        nextIndex: cursor,
      };
    }

    return {
      node: {
        kind: "scalar",
        value: body.map((entry) => entry.text).join("\n"),
        line: body[0]?.lineNumber ?? lines[headerLineIndex].lineNumber,
        lines: body,
        folded: false,
      },
      nextIndex: cursor,
    };
  }

  function parseNode(startIndex, expectedIndent) {
    const index = nextNonEmpty(startIndex);
    if (index >= lines.length) {
      return { node: null, nextIndex: index };
    }
    const lineIndent = indentOf(index);
    if (lineIndent < expectedIndent) {
      return { node: null, nextIndex: index };
    }
    const content = lines[index].text.slice(lineIndent);
    if (content === "-" || content.startsWith("- ")) {
      return parseSequence(index, lineIndent);
    }
    if (findMappingColon(content) !== -1) {
      return parseMapping(index, lineIndent);
    }
    return {
      node: parseFlowValue(content, lines[index].lineNumber, anchors),
      nextIndex: index + 1,
    };
  }

  function parseSequence(startIndex, seqIndent) {
    const items = [];
    let cursor = startIndex;

    while (cursor < lines.length) {
      cursor = nextNonEmpty(cursor);
      if (cursor >= lines.length) {
        break;
      }
      const lineIndent = indentOf(cursor);
      if (lineIndent !== seqIndent) {
        break;
      }
      const content = lines[cursor].text.slice(lineIndent);
      if (content !== "-" && !content.startsWith("- ")) {
        break;
      }
      const lineNumber = lines[cursor].lineNumber;
      const afterDash = content.slice(1).trimStart();
      const { anchor: itemAnchor, rest: itemRest } = stripYamlNodeProperties(
        stripInlineComment(afterDash),
      );

      if (itemRest.length === 0) {
        const child = parseNode(cursor + 1, seqIndent + 1);
        const childNode = child.node ?? { kind: "scalar", value: "", line: lineNumber };
        if (itemAnchor) {
          anchors.set(itemAnchor, childNode);
        }
        items.push(childNode);
        cursor = child.nextIndex;
        continue;
      }

      const inlineIndent = lineIndent + (content.length - afterDash.length);
      const colon = findMappingColon(afterDash);
      if (!itemAnchor && colon !== -1 && !afterDash.startsWith("{") && !afterDash.startsWith("[")) {
        // Inline mapping starting on the `- ` line (e.g. `- name: Build\n  run: ...`).
        const map = new Map();
        const parsedFirst = parseMappingEntry(cursor, afterDash, inlineIndent);
        mergeYamlMappingEntry(map, parsedFirst.key, parsedFirst.valueNode);
        cursor = parsedFirst.nextIndex;

        while (cursor < lines.length) {
          const next = nextNonEmpty(cursor);
          if (next >= lines.length) {
            cursor = next;
            break;
          }
          const nextIndent = indentOf(next);
          if (nextIndent !== inlineIndent) {
            cursor = next;
            break;
          }
          const nextContent = lines[next].text.slice(nextIndent);
          if (nextContent === "-" || nextContent.startsWith("- ")) {
            cursor = next;
            break;
          }
          if (findMappingColon(nextContent) === -1) {
            cursor = next + 1;
            continue;
          }
          const entry = parseMappingEntry(next, nextContent, inlineIndent);
          mergeYamlMappingEntry(map, entry.key, entry.valueNode);
          cursor = entry.nextIndex;
        }
        items.push({ kind: "map", value: map, line: lineNumber });
        continue;
      }

      if (/^[|>][+-]?\d*$/u.test(itemRest)) {
        const block = parseBlockScalar(cursor, seqIndent, itemRest);
        if (itemAnchor) {
          anchors.set(itemAnchor, block.node);
        }
        items.push(block.node);
        cursor = block.nextIndex;
        continue;
      }

      items.push(parseFlowValue(afterDash, lineNumber, anchors));
      cursor += 1;
    }

    return {
      node: { kind: "seq", value: items, line: lines[startIndex].lineNumber },
      nextIndex: cursor,
    };
  }

  function parseMappingEntry(lineIndex, content, entryIndent) {
    const colon = findMappingColon(content);
    const key = decodeScalar(content.slice(0, colon));
    const lineNumber = lines[lineIndex].lineNumber;
    const rawRest = content.slice(colon + 1).trim();
    const { anchor, rest: restWithoutComment } = stripYamlNodeProperties(
      stripInlineComment(rawRest),
    );

    const recordAnchor = (node) => {
      if (anchor) {
        anchors.set(anchor, node);
      }
      return node;
    };

    if (/^[|>][+-]?\d*$/u.test(restWithoutComment)) {
      const block = parseBlockScalar(lineIndex, entryIndent, restWithoutComment);
      return { key, valueNode: recordAnchor(block.node), nextIndex: block.nextIndex };
    }

    if (restWithoutComment.length === 0) {
      const next = nextNonEmpty(lineIndex + 1);
      if (next < lines.length) {
        const nextIndent = indentOf(next);
        const nextContent = lines[next].text.slice(nextIndent);
        // Allow block sequence indented at the same level as its mapping key.
        if (
          nextIndent > entryIndent ||
          (nextIndent === entryIndent && (nextContent === "-" || nextContent.startsWith("- ")))
        ) {
          const child = parseNode(next, nextIndent);
          return {
            key,
            valueNode: recordAnchor(child.node ?? { kind: "scalar", value: "", line: lineNumber }),
            nextIndex: child.nextIndex,
          };
        }
      }
      return {
        key,
        valueNode: recordAnchor({ kind: "scalar", value: "", line: lineNumber }),
        nextIndex: lineIndex + 1,
      };
    }

    // Handle multi-line flow mapping/sequence spanning lines if unclosed.
    let combined = restWithoutComment;
    let cursor = lineIndex + 1;
    if (
      (combined.startsWith("{") && !combined.endsWith("}")) ||
      (combined.startsWith("[") && !combined.endsWith("]"))
    ) {
      while (cursor < lines.length) {
        const nextText = stripInlineComment(lines[cursor].text.trim()).trim();
        combined = `${combined} ${nextText}`;
        cursor += 1;
        if (
          (combined.startsWith("{") && combined.endsWith("}")) ||
          (combined.startsWith("[") && combined.endsWith("]"))
        ) {
          break;
        }
      }
    } else if (
      !combined.startsWith('"') &&
      !combined.startsWith("'") &&
      !combined.startsWith("{") &&
      !combined.startsWith("[") &&
      !combined.startsWith("*")
    ) {
      // Multi-line plain scalar continuation indented deeper than key.
      while (cursor < lines.length) {
        const nextText = lines[cursor].text;
        if (nextText.trim().length === 0 || nextText.trimStart().startsWith("#")) {
          break;
        }
        const nextIndent = nextText.length - nextText.trimStart().length;
        if (nextIndent <= entryIndent) {
          break;
        }
        const nextTrimmed = stripInlineComment(nextText.trim()).trim();
        if (
          nextTrimmed === "-" ||
          nextTrimmed.startsWith("- ") ||
          findMappingColon(nextTrimmed) !== -1
        ) {
          break;
        }
        combined = `${combined} ${nextTrimmed}`;
        cursor += 1;
      }
    }

    return {
      key,
      valueNode: recordAnchor(parseFlowValue(combined, lineNumber, anchors)),
      nextIndex: cursor,
    };
  }

  function parseMapping(startIndex, mapIndent) {
    const map = new Map();
    let cursor = startIndex;

    while (cursor < lines.length) {
      cursor = nextNonEmpty(cursor);
      if (cursor >= lines.length) {
        break;
      }
      const lineIndent = indentOf(cursor);
      if (lineIndent !== mapIndent) {
        break;
      }
      const content = lines[cursor].text.slice(lineIndent);
      if (content === "-" || content.startsWith("- ") || findMappingColon(content) === -1) {
        break;
      }
      const entry = parseMappingEntry(cursor, content, mapIndent);
      mergeYamlMappingEntry(map, entry.key, entry.valueNode);
      cursor = entry.nextIndex;
    }

    return {
      node: { kind: "map", value: map, line: lines[startIndex].lineNumber },
      nextIndex: cursor,
    };
  }

  let startIndex = nextNonEmpty(0);
  while (startIndex < lines.length) {
    const trimmed = lines[startIndex].text.trim();
    if (trimmed === "---" || /^%(?:YAML|TAG)\b/u.test(trimmed)) {
      startIndex = nextNonEmpty(startIndex + 1);
      continue;
    }
    break;
  }

  if (startIndex >= lines.length || lines[startIndex].text.trim() === "...") {
    return { doc: null, error: null };
  }

  const parsed = parseNode(startIndex, 0);
  let trailing = nextNonEmpty(parsed.nextIndex);
  while (trailing < lines.length && lines[trailing].text.trim() === "...") {
    trailing = nextNonEmpty(trailing + 1);
  }

  if (trailing < lines.length) {
    return {
      doc: parsed.node,
      error: {
        line: lines[trailing].lineNumber,
        message: "unexpected trailing YAML content; refusing to skip pin checks",
      },
    };
  }

  return { doc: parsed.node, error: null };
}

// --- Shell tokenization & Docker/Podman extraction ---------------------------

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
    // spaces inside `${{ env.IMAGE }}` do not split the image argument.
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
    if (ch === "<" && line[index + 1] === "<" && line[index + 2] !== "<") {
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

function inspectShellRunScript(runNode, inheritedEnv, filePath, problems) {
  const vars = new Map(inheritedEnv);

  // Build executable shell lines with accurate line numbers, skipping heredoc bodies.
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

      const resolved = resolveVars(imageToken, commandVars);
      if (isDynamicReference(resolved)) {
        continue;
      }

      if (!isPinnedDigest(resolved)) {
        let reportLine = lookupSingleVarLine(imageToken, commandVars, lineNumber);
        if (reportLine === lineNumber && sourceLines) {
          reportLine =
            sourceLines.find((entry) => entry.text.includes(imageToken))?.lineNumber ?? lineNumber;
        }
        problems.push(`${filePath}:${reportLine}: ${resolved} is not pinned to a sha256 digest`);
      }
    }
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
  filePath,
  problems,
  { allowLocalDockerAction = false } = {},
) {
  if (node?.kind !== "scalar") {
    return;
  }
  const rawRef = String(node.value).trim();
  const imageRef = resolveEnvExpressions(rawRef, envMap);
  if (!imageRef || isDynamicReference(imageRef)) {
    return;
  }
  if (allowLocalDockerAction && isLocalDockerActionImage(imageRef)) {
    return;
  }
  if (!isPinnedDigest(imageRef)) {
    const reportLine = lookupSingleVarLine(rawRef, envMap, node.line);
    problems.push(`${filePath}:${reportLine}: ${imageRef} is not pinned to a sha256 digest`);
  }
}

function checkStepsList(stepsNode, baseEnv, filePath, problems) {
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
      inspectShellRunScript(runNode, stepEnv, filePath, problems);
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
  const { doc, error } = parseYaml(source);

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
    if (!hasUnquotedComment(sourceLine)) {
      problems.push(`${location}: ${value} has no version comment`);
    }
  }

  return problems;
}

export function unpinnedWorkflowContainerReferences(source, filePath = "<memory>") {
  const problems = [];
  const { doc, error } = parseYaml(source);
  if (error) {
    problems.push(`${filePath}:${error.line}: ${error.message}`);
  }
  if (!doc) {
    return problems;
  }

  if (doc.kind === "seq") {
    checkStepsList(doc, new Map(), filePath, problems);
    return problems;
  }

  if (doc.kind !== "map") {
    return problems;
  }

  const workflowEnv = extractEnvMap(doc.value.get("env"), new Map());

  // Support snippet inputs containing top-level `container`, `image`, `services`, or `steps`.
  const checkContainerNode = (containerNode, envMap) => {
    if (!containerNode) {
      return;
    }
    if (containerNode.kind === "scalar") {
      checkImageField(containerNode, envMap, filePath, problems);
    } else if (containerNode.kind === "map") {
      checkImageField(containerNode.value.get("image"), envMap, filePath, problems);
    }
  };

  const checkServicesNode = (servicesNode, envMap) => {
    if (servicesNode?.kind !== "map") {
      return;
    }
    for (const serviceNode of servicesNode.value.values()) {
      checkContainerNode(serviceNode, envMap);
    }
  };

  checkContainerNode(doc.value.get("container"), workflowEnv);
  checkServicesNode(doc.value.get("services"), workflowEnv);
  checkImageField(doc.value.get("image"), workflowEnv, filePath, problems);
  checkStepsList(doc.value.get("steps"), workflowEnv, filePath, problems);

  const runsNode = doc.value.get("runs");
  if (runsNode?.kind === "map") {
    checkImageField(runsNode.value.get("image"), workflowEnv, filePath, problems, {
      allowLocalDockerAction: true,
    });
    checkStepsList(runsNode.value.get("steps"), workflowEnv, filePath, problems);
  }

  const jobsNode = doc.value.get("jobs");
  if (jobsNode?.kind === "map") {
    for (const jobNode of jobsNode.value.values()) {
      if (jobNode?.kind !== "map") {
        continue;
      }
      const jobEnv = extractEnvMap(jobNode.value.get("env"), workflowEnv);
      checkContainerNode(jobNode.value.get("container"), jobEnv);
      checkServicesNode(jobNode.value.get("services"), jobEnv);
      checkStepsList(jobNode.value.get("steps"), jobEnv, filePath, problems);
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
  // Parse leading `--mount=...` (and any other `--flag` options) before the command.
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
