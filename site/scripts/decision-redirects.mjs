import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { writeRedirectPages } from "./redirect-pages.mjs";

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

  await writeRedirectPages(
    publicRoot,
    "decisions",
    Object.fromEntries(
      Object.entries(redirects).map(([source, target]) => [
        `/decisions/${source}`,
        `/decisions/${target}`,
      ]),
    ),
    {
      title: "Decision moved",
      message: "This decision has moved.",
      linkText: "Read the current decision",
    },
  );
}
