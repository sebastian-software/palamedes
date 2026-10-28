import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, basename } from "node:path";

import { generateApiDocs } from "ardo/typedoc";

const repository = "https://github.com/sebastian-software/palamedes/blob/main";

export function normalizeApiPage(doc, label) {
  const title = doc.path === "index.md" ? `${label} API` : `${label}: ${doc.frontmatter.title}`;
  const summary = doc.frontmatter.description;
  const description =
    summary && summary !== "Auto-generated API documentation"
      ? `${summary} (${label})`
      : `Functions, types, and exports for ${title}.`;
  // Ardo renders the page title in ContentHeader. The generator's own H1
  // otherwise creates a second main heading, sometimes with different text.
  let fenced = false;
  let removedTitle = false;
  let content = doc.content
    .split("\n")
    .flatMap((line) => {
      if (/^\s*(```|~~~)/u.test(line)) fenced = !fenced;
      if (!fenced && line.startsWith("# ")) {
        if (!removedTitle) {
          removedTitle = true;
          return [];
        }
        return [`#${line}`];
      }
      return [line];
    })
    .join("\n");
  const firstParagraph = content.trimStart().split(/\n\s*\n/u, 1)[0];
  const normalize = (text) => text?.replaceAll(/\s+/gu, " ").replace(/\.$/u, "").trim();
  if (summary && normalize(firstParagraph) === normalize(summary)) {
    content = content.trimStart().slice(firstParagraph.length).trimStart();
  }
  return { ...doc, content, frontmatter: { ...doc.frontmatter, title, description } };
}

export function repairSourceLinks(content, entry, repoRoot) {
  const entryDirectory = dirname(entry).replaceAll("\\", "/");
  return content.replace(
    /\[([^\]]+)\]\(https:\/\/github\.com\/sebastian-software\/palamedes\/blob\/main\/([^\s)#]+)(#L\d+)?\)/gu,
    (_match, label, file, line = "") => {
      const raw = file.startsWith(`${entryDirectory}/`)
        ? file.slice(entryDirectory.length + 1)
        : file;
      const candidates = [file, `packages/${raw}`, `${entryDirectory}/${raw}`];
      const fromDeclaration = /\/dist\//u.test(file);
      const paths = fromDeclaration
        ? candidates.flatMap((candidate) => {
            const source = candidate.replace("/dist/", "/src/").replace(/\.d\.[cm]?ts$/u, ".ts");
            return [source, source.replace(/\.ts$/u, ".tsx")];
          })
        : candidates;
      const resolved = paths.find(
        (candidate) => !candidate.includes("/dist/") && existsSync(join(repoRoot, candidate)),
      );
      if (!resolved) throw new Error(`Cannot resolve generated API source ${file} for ${entry}`);
      const target = relative(repoRoot, join(repoRoot, resolved)).replaceAll("\\", "/");
      // Declaration line numbers do not describe the original source file.
      return `[${fromDeclaration ? "Source file" : label}](${repository}/${target}${fromDeclaration ? "" : line})`;
    },
  );
}

export function repairApiLinks(content, docs, out) {
  const routes = docs.map(({ path }) =>
    `/${out}/${path
      .replace(/\.md$/u, "")
      .replace(/(^|\/)index$/u, "")
      .replace(/\/$/u, "")}`.replace(/\/$/u, ""),
  );
  const known = new Set(routes);
  return content.replace(/\]\((\/[^\s)#]+)(#[^\s)]+)?\)/gu, (match, route, anchor = "") => {
    if (!route.startsWith(`/${out}/`) || known.has(route)) return match;
    const name = route.split("/").at(-1);
    const matches = routes.filter((candidate) => candidate.split("/").at(-1) === name);
    return matches.length === 1 ? `](${matches[0]}${anchor})` : match;
  });
}

async function writeDoc(directory, doc) {
  const output = join(directory, doc.path);
  await mkdir(dirname(output), { recursive: true });
  const frontmatter = Object.entries(doc.frontmatter)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  await writeFile(output, `---\n${frontmatter}\n---\n\n${doc.content.trim()}\n`);
}

export async function generatePackageApiReference(
  pkg,
  repoRoot,
  routesRoot,
  generate = generateApiDocs,
) {
  const root = `api-reference/${pkg.slug}`;
  const entries = pkg.entryPoints.map((entry, index) => ({
    source: entry,
    subpath: index === 0 ? null : basename(entry).replace(/\.[cm]?[jt]sx?$/u, ""),
  }));
  for (const { source, subpath } of entries) {
    const label = subpath ? `${pkg.label} / ${subpath}` : pkg.label;
    const out = subpath ? `${root}/modules/${subpath}` : root;
    // One entry at a time prevents Ardo from replacing module exports with
    // empty module shells. Each entry keeps its existing public module URL.
    const docs = await generate(
      {
        enabled: true,
        entryPoints: [join(repoRoot, source)],
        tsconfig: join(repoRoot, "site/tsconfig.typedoc.json"),
        out,
        excludePrivate: true,
        excludeProtected: true,
        excludeInternal: true,
        markdown: {
          sourceLinks: true,
          sourceBaseUrl: `${repository}/${relative(repoRoot, dirname(join(repoRoot, source))).replaceAll("\\", "/")}`,
        },
        sidebar: { title: label, collapsed: true, position: pkg.position },
      },
      routesRoot,
    );
    for (const doc of docs) {
      const normalized = normalizeApiPage(
        {
          ...doc,
          content: repairApiLinks(repairSourceLinks(doc.content, source, repoRoot), docs, out),
        },
        label,
      );
      if (doc.path === "index.md" && subpath === null && entries.length > 1) {
        const links = entries
          .slice(1)
          .map(({ subpath: name }) => `- [${name}](/${root}/modules/${name})`)
          .join("\n");
        normalized.content += `\n\n## Entry points\n\n${links}`;
      }
      await writeDoc(join(routesRoot, out), normalized);
    }
  }
  if (entries.length > 1) {
    // The former multi-entry generator exposed the main entry here. Preserve
    // the link while pointing readers at its complete, generated reference.
    await writeDoc(join(routesRoot, root), {
      path: "modules/index/index.md",
      frontmatter: {
        title: `${pkg.label}: main entry`,
        description: `Public API exports from the main ${pkg.label} entry point.`,
        sidebar: "leaf",
      },
      content: `[Open the ${pkg.label} API reference](/${root}).`,
    });
  }
}
