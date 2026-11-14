import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { packWorkspaceDependencies } from "./pack-workspace-dependencies.mjs";

/** Install the existing Waku fixture from archives outside the workspace. */
export function createPackedWakuConsumer(root) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-waku-dev-packed-"));
  const cleanup = () => rmSync(fixtureRoot, { recursive: true, force: true });
  try {
    const source = path.join(root, "examples/waku-cookie");
    const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    // Type checking and the CLI aren't needed by the development server. Keep
    // the actual host and bundler versions from the supported example.
    for (const name of [
      "@palamedes/cli",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "typescript",
    ])
      delete dependencies[name];
    const localNames = Object.entries(dependencies)
      .filter(([, range]) => range.startsWith("workspace:"))
      .map(([name]) => name);
    for (const name of Object.keys(dependencies)) {
      if (localNames.includes(name)) continue;
      dependencies[name] = JSON.parse(
        readFileSync(path.join(source, "node_modules", name, "package.json"), "utf8"),
      ).version;
    }
    const { packageManager } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const archiveDir = path.join(fixtureRoot, "archives");
    mkdirSync(archiveDir);
    // The demo UI is a private, unversioned workspace package. Give its copied
    // build a fixture-only version so pnpm can archive it without editing the
    // workspace manifest or linking its source into the consumer.
    const demoUiSource = path.join(root, "packages/example-ui");
    const demoUi = path.join(fixtureRoot, "example-ui");
    mkdirSync(demoUi);
    for (const entry of ["dist", "styles"]) {
      cpSync(path.join(demoUiSource, entry), path.join(demoUi, entry), { recursive: true });
    }
    const demoUiManifest = JSON.parse(
      readFileSync(path.join(demoUiSource, "package.json"), "utf8"),
    );
    writeFileSync(
      path.join(demoUi, "package.json"),
      JSON.stringify({ ...demoUiManifest, version: "0.0.0" }),
    );
    const overrides = packWorkspaceDependencies(
      localNames.map((name) =>
        name === "@palamedes/example-ui"
          ? demoUi
          : path.join(root, "packages", name.slice("@palamedes/".length)),
      ),
      archiveDir,
    );
    for (const name of localNames) dependencies[name] = overrides[name];

    const directory = path.join(fixtureRoot, "consumer");
    mkdirSync(directory);
    for (const entry of ["src", "palamedes.yaml", "waku.config.ts"]) {
      cpSync(path.join(source, entry), path.join(directory, entry), { recursive: true });
    }
    writeFileSync(
      path.join(directory, "package.json"),
      `${JSON.stringify({ name: "waku-packed-dev-consumer", private: true, type: "module", packageManager, dependencies }, null, 2)}\n`,
    );
    writeFileSync(path.join(directory, "pnpm-workspace.yaml"), JSON.stringify({ overrides }));

    // Two copies of the same page exercise real Waku client navigation without
    // creating a second set of messages or changing the maintained demo.
    writeFileSync(
      path.join(directory, "src/pages/packed-proof.tsx"),
      'export { default, getConfig } from "./index";\n',
    );
    writeFileSync(
      path.join(directory, "src/pages/_layout.tsx"),
      `import type { ReactNode } from "react";
import { Link } from "waku/router/client";
export default function Layout({ children }: { children: ReactNode }) {
  return <main className="page-shell">
    <nav><Link to="/packed-proof" data-testid="packed-next">Next page</Link>
    <Link to="/" data-testid="packed-home">Home</Link></nav>
    {children}
  </main>;
}
`,
    );
    execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["install", "--ignore-scripts"],
      {
        cwd: directory,
        env: { ...process.env, CI: "true" },
        shell: process.platform === "win32",
        stdio: "inherit",
      },
    );

    // pnpm's links must resolve into this independent installation, including
    // transitive native packages. A workspace link would invalidate the proof.
    const lockfile = readFileSync(path.join(directory, "pnpm-lock.yaml"), "utf8");
    assert.doesNotMatch(lockfile, /(?:workspace:|link:)/u);
    const installedRoot = realpathSync(path.join(directory, "node_modules"));
    for (const entry of readdirSync(path.join(installedRoot, ".pnpm"))) {
      const scope = path.join(installedRoot, ".pnpm", entry, "node_modules/@palamedes");
      if (!existsSync(scope)) continue;
      for (const name of readdirSync(scope)) {
        const resolved = realpathSync(path.join(scope, name));
        assert(
          resolved.startsWith(`${installedRoot}${path.sep}`),
          `${name} escaped the packed installation`,
        );
      }
    }
    console.log(
      `Waku packed development: installed ${Object.keys(overrides).length} fresh archives without workspace links`,
    );
    return { directory, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
