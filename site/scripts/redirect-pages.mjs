import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const routePattern = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u;

export function redirectPage(destination, { title, message, linkText }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${destination}">
<link rel="canonical" href="https://palamedes.dev${destination}">
<title>${title} | Palamedes</title>
</head>
<body><p>${message} <a href="${destination}">${linkText}</a>.</p></body>
</html>
`;
}

/*
 * Static meta-refresh pages keep moved public URLs working without JavaScript
 * or host-specific redirect rules. They live in an ignored directory under
 * `public/`, so they are copied into the build but never become routes, and
 * the generated sitemap lists only the current pages.
 */
export async function writeRedirectPages(publicRoot, section, redirects, copy) {
  const output = join(publicRoot, section);
  // This directory contains only generated compatibility pages, never sources.
  await rm(output, { recursive: true, force: true });
  for (const [source, destination] of Object.entries(redirects)) {
    if (!routePattern.test(source) || !source.startsWith(`/${section}/`)) {
      throw new Error(`Redirect source must be a route under /${section}/: ${source}`);
    }
    if (!routePattern.test(destination)) {
      throw new Error(`Redirect destination must be a site route: ${source} -> ${destination}`);
    }
    const directory = join(publicRoot, source.slice(1));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), redirectPage(destination, copy));
  }
}
