import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const fixtures = path.join(root, "scripts/fixtures/adoption-skill");

// Execute the file examples from the installed skill bundle, not copied recipes.
export function recipeFiles(reference) {
  const markdown = readFileSync(path.join(root, "skills/palamedes/references", reference), "utf8");
  const files = new Map();
  for (const match of markdown.matchAll(/```(?:js|ts|tsx|yaml)\n(?<code>[\s\S]*?)\n```/gu)) {
    const code = match.groups.code;
    const filename = /^(?:\/\/|#) (?<filename>[^\n]+)\n/u.exec(code)?.groups.filename;
    if (!filename) throw new Error(`Missing file annotation in ${reference}`);
    if (path.isAbsolute(filename) || filename.split("/").includes("..")) {
      throw new Error(`Invalid recipe path: ${filename}`);
    }
    if (files.has(filename)) throw new Error(`Duplicate recipe file: ${filename}`);
    files.set(filename, `${code}\n`);
  }
  if (!files.size) throw new Error(`No executable examples in ${reference}`);
  return files;
}

export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.[jt]sx?$/u.test(filename) ? [filename] : [];
  });
}

export function writeFixtureFile(directory, filename, content) {
  const target = path.join(directory, filename);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export function createFixture(host, migration = false) {
  const parent = path.join(root, "coverage/adoption-skill");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, `${host}-${migration ? "migration" : "setup"}-`));
  cpSync(path.join(fixtures, host), directory, { recursive: true });
  const reference = host === "nextjs" ? "nextjs.md" : "vite-react.md";
  for (const [filename, code] of recipeFiles(reference)) {
    // Adapt the config recipe to the consumer's existing options and plugins.
    if (filename === "next.config.mjs" || filename === "vite.config.ts") {
      const original = readFileSync(path.join(directory, filename), "utf8");
      const originalName =
        host === "nextjs" ? "next.config.original.mjs" : "vite.config.original.ts";
      writeFixtureFile(directory, originalName, original);
      const adapted =
        host === "nextjs"
          ? code.replace("withPalamedes({})", "withPalamedes(originalConfig)")
          : code
              .replace('import react from "@vitejs/plugin-react";\n', "")
              .replace(
                "plugins: [palamedes(), react()],",
                "...originalConfig,\n  plugins: [palamedes(), ...originalConfig.plugins],",
              );
      writeFixtureFile(
        directory,
        filename,
        `import originalConfig from "./${originalName}";\n${adapted}`,
      );
    } else writeFixtureFile(directory, filename, code);
  }
  const dependencyHost = host === "nextjs" ? "nextjs-cookie" : "vite-mdx";
  symlinkSync(
    path.join(root, "examples", dependencyHost, "node_modules"),
    path.join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  if (migration) {
    cpSync(path.join(fixtures, "lingui/migrated/src"), path.join(directory, "src"), {
      recursive: true,
    });
    for (const locale of ["en", "de"]) {
      const filename = `src/locales/${locale}.po`;
      const existing = readFileSync(path.join(directory, filename), "utf8");
      writeFixtureFile(
        directory,
        filename,
        `${existing}\nmsgid "Welcome to Palamedes"\nmsgstr "${locale === "de" ? "Willkommen bei Palamedes" : "Welcome to Palamedes"}"\n`,
      );
    }
    const filename = host === "nextjs" ? "src/app/page.tsx" : "src/App.tsx";
    const code = readFileSync(path.join(directory, filename), "utf8");
    const importPath = host === "nextjs" ? "../Offers" : "./Offers";
    writeFixtureFile(
      directory,
      filename,
      `import { Offers } from "${importPath}";\n${code.replace("<h1>", '<main><Offers count={2} name="Ada" /><h1>').replace("</h1>", "</h1></main>")}`,
    );
  }
  const manifestPath = path.join(directory, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const name of [
    "core",
    "react",
    "runtime",
    host === "nextjs" ? "next-plugin" : "vite-plugin",
  ]) {
    manifest.dependencies[`@palamedes/${name}`] = "workspace:*";
  }
  if (host === "nextjs") manifest.dependencies["server-only"] = "0.0.1";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

export function extractFixture(directory) {
  execFileSync(path.join(root, "packages/cli/bin/pmds"), ["extract"], {
    cwd: directory,
    env: { ...process.env, PALAMEDES_UPDATE_CHECK: "0" },
    stdio: "pipe",
  });
}
