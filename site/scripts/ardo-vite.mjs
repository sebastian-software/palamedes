import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Build tooling shares the Vite version owned by Ardo, just like the site CLI.
const requireFromArdo = createRequire(import.meta.resolve("ardo/vite"));
export const { build, createServer } = await import(
  pathToFileURL(requireFromArdo.resolve("vite")).href
);
