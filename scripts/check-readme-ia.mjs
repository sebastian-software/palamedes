import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { javascriptWorkspacePackages } from "./release-packages.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = "README.md";
const GITHUB_BLOB_PREFIX = "https://github.com/sebastian-software/palamedes/blob/main/";

function fail(message) {
  throw new Error(`README information architecture: ${message}`);
}

function decodeMarkdownEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["quot", '"'],
  ]);

  return value.replaceAll(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/giu, (entity, name) => {
    if (name[0] !== "#") return named.get(name.toLowerCase()) ?? entity;
    const hex = name[1]?.toLowerCase() === "x";
    const radix = hex ? 16 : 10;
    const codePoint = Number.parseInt(name.slice(hex ? 2 : 1), radix);
    return Number.isSafeInteger(codePoint) && codePoint <= 1_114_111
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function isEscaped(value, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function protectMarkdownCodeSpans(value) {
  const spans = [];
  let protectedValue = "";
  let cursor = 0;

  while (cursor < value.length) {
    if (value[cursor] !== "`" || isEscaped(value, cursor)) {
      protectedValue += value[cursor];
      cursor += 1;
      continue;
    }

    let openerEnd = cursor;
    while (value[openerEnd] === "`") openerEnd += 1;
    const delimiterLength = openerEnd - cursor;
    let closingStart = -1;
    let search = openerEnd;

    while (search < value.length) {
      if (value[search] !== "`" || isEscaped(value, search)) {
        search += 1;
        continue;
      }
      let runEnd = search;
      while (value[runEnd] === "`") runEnd += 1;
      if (runEnd - search === delimiterLength) {
        closingStart = search;
        break;
      }
      search = runEnd;
    }

    if (closingStart === -1) {
      protectedValue += value.slice(cursor, openerEnd);
      cursor = openerEnd;
      continue;
    }

    let content = value.slice(openerEnd, closingStart).replaceAll(/\r?\n/gu, " ");
    if (content.startsWith(" ") && content.endsWith(" ") && /[^ ]/u.test(content)) {
      content = content.slice(1, -1);
    }
    const token = `\u{e000}${spans.length}\u{e001}`;
    spans.push([token, content]);
    protectedValue += token;
    cursor = closingStart + delimiterLength;
  }

  return {
    value: protectedValue,
    restore(rendered) {
      for (const [token, content] of spans) rendered = rendered.replaceAll(token, content);
      return rendered;
    },
  };
}

function renderedHeadingText(heading) {
  const codeSpans = protectMarkdownCodeSpans(heading);
  const rendered = decodeMarkdownEntities(codeSpans.value)
    .replaceAll(/<!--.*?-->/gu, "")
    .replaceAll(/!\[([^\]]*)\]\((?:\\.|[^)])*\)/gu, "$1")
    .replaceAll(/\[([^\]]+)\]\((?:\\.|[^)])*\)/gu, "$1")
    .replaceAll(/\[([^\]]+)\]\s*\[[^\]]*\]/gu, "$1")
    .replaceAll(/<((?:https?:\/\/|mailto:)[^>]+)>/giu, "$1")
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll(/(?<![\\\p{L}\p{M}\p{N}_])__([^_]+?)__(?![\p{L}\p{M}\p{N}_])/gu, "$1")
    .replaceAll(/(?<![\\\p{L}\p{M}\p{N}_])_([^_]+?)_(?![\p{L}\p{M}\p{N}_])/gu, "$1")
    .replaceAll(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu, "$1");
  return codeSpans.restore(rendered);
}

function headingSlug(heading) {
  return renderedHeadingText(heading)
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replaceAll(/\s+/gu, "-");
}

function markdownOutsideFences(markdown) {
  let openFence = null;

  return markdown.replace(/^.*(?:\r?\n|$)/gmu, (line) => {
    const content = line.replace(/\r?\n$/u, "");
    const fence = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);

    if (openFence) {
      const closing = content.match(/^ {0,3}(`+|~+)[ \t]*$/u);
      if (closing && closing[1][0] === openFence.marker && closing[1].length >= openFence.length) {
        openFence = null;
      }
      return line.replace(/[^\r\n]/gu, " ");
    }

    if (fence && (fence[1][0] !== "`" || !fence[2].includes("`"))) {
      openFence = { marker: fence[1][0], length: fence[1].length };
      return line.replace(/[^\r\n]/gu, " ");
    }

    return line;
  });
}

function markdownHeadings(markdown) {
  const visibleMarkdown = markdownOutsideFences(markdown);
  return [...visibleMarkdown.matchAll(/^ {0,3}(#{1,6})[ \t]+([^\r\n]+)$/gmu)].map((match) => ({
    level: match[1].length,
    heading: match[2].replace(/[ \t]+#+[ \t]*$/u, "").trimEnd(),
    index: match.index,
    length: match[0].length,
  }));
}

function secondLevelSections(markdown) {
  const headings = markdownHeadings(markdown).filter(({ level }) => level === 2);
  return headings.map((match, index) => ({
    heading: match.heading,
    index: match.index,
    body: markdown.slice(match.index + match.length, headings[index + 1]?.index ?? markdown.length),
  }));
}

function markdownLinks(markdown) {
  return [
    ...markdownOutsideFences(markdown).matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu),
  ].map(([, target]) => target);
}

function headingAnchors(markdown) {
  const anchors = new Set();

  for (const { heading } of markdownHeadings(markdown)) {
    const base = headingSlug(heading);
    let anchor = base;
    let suffix = 0;
    while (anchors.has(anchor)) {
      suffix += 1;
      anchor = `${base}-${suffix}`;
    }
    anchors.add(anchor);
  }

  return anchors;
}

function localTarget(target) {
  if (target.startsWith(GITHUB_BLOB_PREFIX)) {
    return target.slice(GITHUB_BLOB_PREFIX.length);
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(target) || target.startsWith("//")) return null;
  return target;
}

// mdtheme checks exact output; this contract also protects company branding.
function checkCompanyFrame(markdown) {
  const notice = "<!-- This file is generated by mdtheme. Edit README.md.src instead. -->";
  if (!markdown.startsWith(notice)) fail("missing the native generated-file notice");
  const badge = markdown.indexOf("Powered by Sebastian Software");
  const content = markdown.indexOf("# Palamedes");
  const company = markdown.lastIndexOf("logo-software.svg");
  if (content <= 0 || badge <= content || company <= badge) {
    fail("expected Sebastian Software badge and footer around project content");
  }
  if (/^## /mu.test(markdown.slice(company))) {
    fail("project sections must precede the company footer");
  }
  if (/ferramenta\.dev|More from Ferramenta/iu.test(markdown)) {
    fail("the root README must not include Ferramenta cross-promotion");
  }
  if (/<!-- (?:ferramenta-family|sebastian-software-branding):/u.test(markdown)) {
    fail("legacy generated markers must not coexist with native composition");
  }
}

function checkPackageBadges(markdown) {
  const reserved = new Set(["palamedes", "create-palamedes"]);
  const lines = markdownOutsideFences(markdown).split(/\r?\n/u);
  for (const { name, directory } of javascriptWorkspacePackages(root)) {
    if (reserved.has(name)) continue;
    const packageUrl = `https://www.npmjs.com/package/${name}`;
    const encodedName = encodeURIComponent(name);
    const row = lines.find((line) => line.startsWith(`| [\`${name}\`](${directory}/README.md) |`));
    if (!row) fail(`missing package README link: ${name}`);
    for (const metric of ["v", "dm"]) {
      if (!row.includes(`](https://img.shields.io/npm/${metric}/${encodedName})](${packageUrl})`)) {
        fail(`missing linked npm ${metric} badge: ${name}`);
      }
    }
  }
}

export function checkReadmeInformationArchitecture({ read, exists }) {
  const markdown = read(README);
  const sections = secondLevelSections(markdown);
  const byHeading = new Map();

  for (const section of sections) {
    if (byHeading.has(section.heading)) fail(`duplicate heading "${section.heading}"`);
    byHeading.set(section.heading, section);
  }

  for (const heading of ["Integrations", "Packages", "Documentation"]) {
    if (!byHeading.has(heading)) fail(`missing ${heading} section`);
  }
  for (const target of [
    "https://palamedes.dev",
    "https://palamedes.dev/frameworks",
    "https://palamedes.dev/proof",
    "https://palamedes.dev/docs/first-working-translation",
  ]) {
    if (!markdownLinks(markdown).includes(target)) fail(`missing website path: ${target}`);
  }

  checkCompanyFrame(markdown);
  checkPackageBadges(markdown);

  for (const target of markdownLinks(markdown)) {
    const local = localTarget(target);
    if (local === null) continue;
    const [path, fragment] = local.split("#", 2);
    if (!path) {
      if (fragment && !headingAnchors(markdown).has(fragment)) {
        fail(`link points to missing anchor: ${target}`);
      }
      continue;
    }

    const resolved = normalize(resolve(root, decodeURIComponent(path)));
    const outsideRoot = relative(root, resolved).startsWith("..");
    if (outsideRoot || !exists(resolved)) fail(`link points to missing repository path: ${target}`);
    if (fragment && !headingAnchors(read(path)).has(fragment)) {
      fail(`link points to missing anchor: ${target}`);
    }
  }
}

export function checkCheckedInReadme() {
  checkReadmeInformationArchitecture({
    read: (file) => readFileSync(join(root, file), "utf8"),
    exists: existsSync,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    checkCheckedInReadme();
    console.log("check-readme-ia: README navigation, package badges, links, and anchors are valid");
  } catch (error) {
    console.error(`check-readme-ia: ${error.message}`);
    process.exitCode = 1;
  }
}
