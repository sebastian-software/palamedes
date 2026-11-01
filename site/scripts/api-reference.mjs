import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, basename } from "node:path";

import { generateDeclarationDocs } from "ardo/api";

const require = createRequire(import.meta.url);
const libFiles = [require.resolve("typescript/lib/lib.es2022.full.d.ts")];

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
  const normalize = (text) =>
    text?.replaceAll("`", "").replaceAll(/\s+/gu, " ").replace(/\.$/u, "").trim();
  if (summary && normalize(firstParagraph) === normalize(summary)) {
    content = content.trimStart().slice(firstParagraph.length).trimStart();
  }
  return { ...doc, content, frontmatter: { ...doc.frontmatter, title, description } };
}

function exportTargets(value) {
  return typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(exportTargets);
}

export function publicApiImportPath(manifest, declaration) {
  const entry = Object.entries(manifest.exports ?? {}).find(([, value]) =>
    exportTargets(value).includes(declaration),
  );
  if (!entry) throw new Error(`No public export in ${manifest.name} points to ${declaration}`);
  return manifest.name + (entry[0] === "." ? "" : entry[0].slice(1));
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
  generate = generateDeclarationDocs,
) {
  if (pkg.guide) {
    await writeDoc(join(routesRoot, "api-reference", pkg.slug), {
      path: "index.md",
      frontmatter: {
        title: `${pkg.label} reference`,
        description: "Commands, options, and workflows for the native Palamedes CLI.",
      },
      content: `The CLI provides the native \`pmds\` command rather than a JavaScript API.\n\n[Read the CLI reference](${pkg.guide}).`,
    });
    return;
  }
  const packageRoot = join(repoRoot, "packages", pkg.packageDir ?? pkg.slug);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const root = `api-reference/${pkg.slug}`;
  const entries = pkg.entryPoints.map((entry, index) => {
    const name = index === 0 ? null : basename(entry).replace(/\.[cm]?[jt]sx?$/u, "");
    // The former multi-entry generator published lowercase module URLs, for
    // example `/api-reference/transform/modules/catalogloader`. Keep them.
    return { source: entry, name, subpath: name?.toLowerCase() ?? null };
  });
  for (const { source, name, subpath } of entries) {
    const label = name ? `${pkg.label} / ${name}` : pkg.label;
    const out = subpath ? `${root}/modules/${subpath}` : root;
    // Reuse the checked declarations produced by the package build. This uses
    // Ardo's native OXC renderer without adding a nightly compiler to the repo.
    const stem = `./${relative(packageRoot, join(repoRoot, source.replace("/src/", "/dist/").replace(/\.tsx?$/u, ""))).replaceAll("\\", "/")}`;
    const declaration = Object.values(manifest.exports)
      .flatMap(exportTargets)
      .find(
        (file) => /\.d\.(?:mts|ts)$/u.test(file) && file.replace(/\.d\.(?:mts|ts)$/u, "") === stem,
      );
    if (!declaration) throw new Error(`No public declaration export for ${source}`);
    const importPath = publicApiImportPath(manifest, declaration);
    const result = await generate(
      {
        entryPoints: [join(packageRoot, declaration)],
        importPaths: [importPath],
        libFiles,
        packageRoot,
        out,
        title: `${label} API`,
      },
      routesRoot,
    );
    if (result.diagnostics?.length) {
      console.warn(
        `API reference keeps unexpanded type expressions for ${importPath}:\n${result.diagnostics.map(({ file, message }) => `${file}: ${message}`).join("\n")}`,
      );
    }
    const docs = result.pages;
    for (const doc of docs) {
      const normalized = normalizeApiPage(doc, label);
      if (doc.path === "index.md" && subpath === null && entries.length > 1) {
        const links = entries
          .slice(1)
          .map(({ name, subpath }) => `- [${name}](/${root}/modules/${subpath})`)
          .join("\n");
        normalized.content += `\n\n## Entry points\n\n${links}`;
      }
      normalized.content += `\n\n[Source entry on GitHub](${repository}/${source})`;
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
