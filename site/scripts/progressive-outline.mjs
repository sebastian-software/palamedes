import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Shared rule for the generated progressive page outline. The site prebuild
 * uses it to decide which docs get an outline and records every decision in a
 * manifest. The deploy route verification re-counts the generated pages with
 * the same rule, so its expectation follows the content instead of a pinned
 * page total.
 */

/** Docs with more top-level (`##`) headings than this get a progressive outline. */
export const PROGRESSIVE_OUTLINE_THRESHOLD = 5;

/** File name of the outline manifest inside `site/app/data/generated/`. */
export const PROGRESSIVE_OUTLINE_MANIFEST = "progressive-outlines.json";

const OUTLINE_MARKER = 'className="pmds-progressive-outline"';

export function countTopLevelHeadings(content) {
  let fence = null;
  let count = 0;

  for (const line of content.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence == null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence == null && /^##(?!#)\s+\S/u.test(line)) count += 1;
  }

  return count;
}

export function usesProgressiveOutline(source, content) {
  return (
    source.startsWith("docs/") && countTopLevelHeadings(content) > PROGRESSIVE_OUTLINE_THRESHOLD
  );
}

/**
 * Compares the generated docs pages with the prebuild manifest. Every manifest
 * entry must match a page whose re-counted headings agree with the recorded
 * decision, every page above the threshold must carry the outline, no page
 * below it may, and at least one page must have one.
 *
 * @returns {{ docs: { entry: string, source: string }[], outlined: Set<string>, problems: string[] }}
 *   `docs` lists the generated pages that carry an outline (paths relative to
 *   `docsDir`, with forward slashes).
 */
export function checkProgressiveOutlines({ docsDir, manifest }) {
  const problems = [];
  if (manifest.threshold !== PROGRESSIVE_OUTLINE_THRESHOLD) {
    problems.push(
      `manifest threshold ${manifest.threshold} does not match ${PROGRESSIVE_OUTLINE_THRESHOLD}`,
    );
  }

  const generated = new Map(
    readdirSync(docsDir, { recursive: true })
      .filter((entry) => /\.mdx?$/u.test(entry))
      .map((entry) => [entry.replaceAll("\\", "/"), readFileSync(join(docsDir, entry), "utf8")]),
  );

  const outlined = new Set();
  for (const doc of manifest.docs) {
    const source = generated.get(doc.file);
    if (source == null) {
      problems.push(`manifest entry ${doc.file} has no generated page`);
      continue;
    }
    const headings = countTopLevelHeadings(stripFrontmatter(source));
    const expectsOutline = headings > PROGRESSIVE_OUTLINE_THRESHOLD;
    if (headings !== doc.headings || expectsOutline !== doc.outline) {
      problems.push(
        `${doc.file} has ${headings} top-level headings, but the manifest records ${doc.headings} (outline: ${doc.outline})`,
      );
    }
    if (expectsOutline) outlined.add(doc.file);
    const links = countOutlineLinks(source);
    if (links != null && links !== headings) {
      problems.push(`${doc.file} outline links ${links} of its ${headings} top-level headings`);
    }
  }

  const docs = [...generated]
    .filter(([, source]) => source.includes(OUTLINE_MARKER))
    .map(([entry, source]) => ({ entry, source }));
  const rendered = new Set(docs.map(({ entry }) => entry));

  const missing = [...outlined].filter((file) => !rendered.has(file));
  if (missing.length > 0) {
    problems.push(`long docs without a generated outline: ${missing.join(", ")}`);
  }
  const unexpected = [...rendered].filter((file) => !outlined.has(file));
  if (unexpected.length > 0) {
    problems.push(`outline on docs the manifest does not expect: ${unexpected.join(", ")}`);
  }
  if (outlined.size === 0) {
    problems.push("the prebuild gave no generated doc an outline");
  }

  return { docs, outlined, problems };
}

/*
 * Long guides that must keep their outline. They guard against the rule
 * silently changing in a way that still agrees with its own manifest.
 */
export const REQUIRED_OUTLINE_DOCS = [
  ["api/vite-plugin/index.md", "Vite component integration guide"],
  ["api/remix/index.md", "Remix API guide"],
  ["configuration.mdx", "configuration guide"],
  ["rust-applications.mdx", "Rust application guide"],
  ["migration-v2.mdx", "v2 migration guide"],
];

/**
 * Reads the prebuild manifest and checks it against the generated docs pages,
 * including the required long guides.
 *
 * @returns {{ docs: { entry: string, source: string }[], manifest: object | undefined, problems: string[] }}
 */
export function verifyGeneratedProgressiveOutlines({ docsDir, dataDir }) {
  const manifestPath = join(dataDir, PROGRESSIVE_OUTLINE_MANIFEST);
  if (!existsSync(manifestPath)) {
    return {
      docs: [],
      manifest: undefined,
      problems: [`the prebuild did not write ${PROGRESSIVE_OUTLINE_MANIFEST}`],
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { docs, outlined, problems } = checkProgressiveOutlines({ docsDir, manifest });
  for (const [file, label] of REQUIRED_OUTLINE_DOCS) {
    if (!outlined.has(file) || !docs.some(({ entry }) => entry === file)) {
      problems.push(`${label} (${file}) is missing its generated outline`);
    }
  }
  return { docs, manifest, problems };
}

function countOutlineLinks(source) {
  const start = source.indexOf(OUTLINE_MARKER);
  if (start === -1) return null;
  const end = source.indexOf("</section>", start);
  const section = end === -1 ? source.slice(start) : source.slice(start, end);
  return section.match(/<a href="#/gu)?.length ?? 0;
}

function stripFrontmatter(source) {
  return source.replace(/^---\n[\s\S]*?\n---\n/u, "");
}
