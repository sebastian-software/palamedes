import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { createIntegration, runtimeId } from "./integration.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

export async function buildApplication(mode, applicationRoot = root) {
  if (!["unbundled", "rolldown"].includes(mode)) throw new Error(`Unknown build path: ${mode}`);
  const integration = createIntegration(applicationRoot);
  const out = path.join(applicationRoot, "dist", mode);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  if (mode === "unbundled") {
    const prepared = path.join(applicationRoot, ".palamedes/prepared");
    await rm(prepared, { recursive: true, force: true });
    await mkdir(prepared, { recursive: true });
    for (const name of await readdir(path.join(applicationRoot, "src"))) {
      const source = path.join(applicationRoot, "src", name);
      if (!name.endsWith(".ts")) continue;
      await writeFile(
        path.join(prepared, name),
        name.endsWith(".d.ts") ? readFileSync(source, "utf8") : integration.transform(source).code,
      );
    }
    await writeFile(
      path.join(prepared, "tsconfig.json"),
      JSON.stringify({
        extends: "../../tsconfig.json",
        compilerOptions: { rootDir: ".", outDir: "../../dist/unbundled" },
        include: ["*.ts"],
      }),
    );
    const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin/tsc");
    execFileSync(process.execPath, [tsc, "-p", path.join(prepared, "tsconfig.json")], {
      cwd: applicationRoot,
      stdio: "inherit",
    });
    await mkdir(path.join(out, ".palamedes"), { recursive: true });
    for (const catalog of integration.catalogs) {
      await writeFile(
        path.join(out, ".palamedes", catalog.fileName),
        integration.compile(catalog).code,
      );
    }
    await writeFile(
      path.join(out, ".palamedes/server.mjs"),
      integration.runtimeSource((c) => `./${c.fileName}`),
    );
  } else {
    const prefix = "\0palamedes-node:";
    const bundle = await rolldown({
      input: path.join(applicationRoot, "src/probe.ts"),
      platform: "node",
      external: [/^@palamedes\/(?:core|runtime)(?:\/|$)/u],
      plugins: [
        {
          name: "palamedes-node-probe",
          buildStart() {
            for (const file of integration.configFiles) this.addWatchFile(file);
          },
          resolveId(id) {
            if (id === runtimeId) return `${prefix}runtime`;
            if (id.startsWith(prefix)) return id;
          },
          load(id) {
            if (id === `${prefix}runtime`)
              return integration.runtimeSource((c) => `${prefix}${c.fileName}`);
            const catalog = integration.catalogs.find((c) => id === `${prefix}${c.fileName}`);
            if (catalog) {
              const result = integration.compile(catalog);
              for (const file of result.watchFiles) this.addWatchFile(file);
              return result.code;
            }
          },
          transform: {
            filter: { id: /\/src\/.*\.ts$/u },
            handler(_code, id) {
              return integration.transform(id);
            },
          },
        },
      ],
    });
    try {
      await bundle.write({ dir: out, format: "esm", entryFileNames: "probe.js", sourcemap: true });
    } finally {
      await bundle.close();
    }
  }
  const manifest = JSON.parse(readFileSync(path.join(applicationRoot, "package.json"), "utf8"));
  await writeFile(
    path.join(out, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        imports: manifest.imports,
        dependencies: manifest.dependencies,
      },
      null,
      2,
    ),
  );
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildApplication("unbundled");
  await buildApplication("rolldown");
}
