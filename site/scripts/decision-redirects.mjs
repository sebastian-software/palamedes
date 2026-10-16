import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function validateDecisionRedirects(redirects, canonicalSlugs) {
  if (!redirects || typeof redirects !== "object" || Array.isArray(redirects)) {
    throw new Error("Decision redirects must be an object of old slugs to current slugs");
  }
  const canonical = new Set(canonicalSlugs);
  for (const [source, target] of Object.entries(redirects)) {
    if (
      !/^\d{3}-[a-z0-9-]+$/u.test(source) ||
      typeof target !== "string" ||
      !/^\d{3}-[a-z0-9-]+$/u.test(target)
    ) {
      throw new Error(`Invalid decision redirect: ${source}`);
    }
    if (canonical.has(source)) {
      throw new Error(`Decision redirect shadows a current record: ${source}`);
    }
    if (!canonical.has(target)) {
      throw new Error(`Decision redirect must target a current record: ${source} -> ${target}`);
    }
  }
}

export async function writeDecisionRedirects(repoRoot, publicRoot) {
  const redirects = JSON.parse(
    await readFile(join(repoRoot, "site/decision-redirects.json"), "utf8"),
  );
  const canonical = (await readdir(join(repoRoot, "adr")))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3));
  validateDecisionRedirects(redirects, canonical);

  // This directory contains only generated compatibility pages, never ADR sources.
  const output = join(publicRoot, "decisions");
  await rm(output, { recursive: true, force: true });
  for (const [source, target] of Object.entries(redirects)) {
    const destination = `/decisions/${target}`;
    const directory = join(output, source);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "index.html"),
      `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${destination}">
<link rel="canonical" href="https://palamedes.dev${destination}">
<title>Decision moved | Palamedes</title>
</head>
<body><p>This decision has moved. <a href="${destination}">Read the current decision</a>.</p></body>
</html>
`,
    );
  }
}
