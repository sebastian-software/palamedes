import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isMissingFromRegistry,
  javascriptWorkspacePackages,
  packedManifestProblems,
  publicWorkspacePackages,
} from "./release-packages.mjs";

const root = process.cwd();
// On Windows the package manager binaries resolve to `pnpm.cmd`/`npm.cmd`.
// Node refuses to spawn `.cmd`/`.bat` files without a shell (CVE-2024-27980),
// so run through the shell there; POSIX keeps the direct, unquoted spawn.
const useShell = process.platform === "win32";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allJavaScript = args.includes("--all-js");
const packageName = args.find((arg) => !arg.startsWith("--"));
const prereleaseTag = process.env.PALAMEDES_NPM_PRERELEASE_TAG?.trim() || "next";

if (allJavaScript) {
  if (packageName) {
    console.error("Usage: node ./scripts/publish-package-if-needed.mjs --all-js [--dry-run]");
    process.exit(1);
  }
  process.exit(publishAllJavaScriptPackages());
}

if (!packageName) {
  console.error(
    "Usage: node ./scripts/publish-package-if-needed.mjs <package-name> [--dry-run] | --all-js [--dry-run]",
  );
  process.exit(1);
}

const workspacePackage = findWorkspacePackage(packageName);
const packageJson = workspacePackage.packageJson;
const packageSpec = `${packageName}@${packageJson.version}`;
const publishTagArgs = npmPublishTagArgs(packageJson.version);
const viewResult = spawnSync(command("pnpm"), ["view", packageSpec, "version"], {
  cwd: root,
  encoding: "utf8",
  shell: useShell,
});

if (viewResult.error) {
  console.error(viewResult.error);
  process.exit(1);
}

if (viewResult.status === 0) {
  if (!dryRun) {
    console.log(`${packageSpec} is already published; skipping.`);
    process.exit(0);
  }
  console.log(`${packageSpec} is already published; the dry run still packs it.`);
} else {
  const viewOutput = `${viewResult.stdout ?? ""}\n${viewResult.stderr ?? ""}`;
  if (!isMissingPackageVersion(viewOutput)) {
    process.stdout.write(viewResult.stdout ?? "");
    process.stderr.write(viewResult.stderr ?? "");
    process.exit(viewResult.status ?? 1);
  }
  if (dryRun) {
    const tagDescription =
      publishTagArgs.length > 0 ? ` with npm dist-tag ${publishTagArgs[1]}` : "";
    console.log(`${packageSpec} is not published yet; dry-run would publish${tagDescription}.`);
  }
}

if (dryRun) {
  // Native packages are published with npm from their own directory, carry no
  // workspace references, and get their artifact checks in publish-native.
  process.exit(isNativeArtifactPackage(packageJson) ? 0 : verifyPackedManifest());
}

const publishResult = isNativeArtifactPackage(packageJson)
  ? spawnSync(
      command("npm"),
      ["publish", workspacePackage.directory, "--access", "public", ...publishTagArgs],
      {
        cwd: root,
        stdio: "inherit",
        shell: useShell,
      },
    )
  : spawnSync(
      command("pnpm"),
      [
        // Filter by directory, not by name: the private workspace root is also
        // named `palamedes`, so a name filter selects two projects.
        "--filter",
        workspacePackage.filter,
        "publish",
        "--access",
        "public",
        "--no-git-checks",
        ...publishTagArgs,
      ],
      {
        cwd: root,
        stdio: "inherit",
        shell: useShell,
      },
    );

if (publishResult.error) {
  console.error(publishResult.error);
  process.exit(1);
}

process.exit(publishResult.status ?? 1);

// Packs the package the way `pnpm publish` does and checks the manifest that
// consumers would receive, so a dry run proves the workspace rewrites without
// uploading anything.
function verifyPackedManifest() {
  const destination = mkdtempSync(path.join(os.tmpdir(), "palamedes-pack-"));
  try {
    const packResult = spawnSync(command("pnpm"), ["pack", "--pack-destination", destination], {
      cwd: workspacePackage.directory,
      encoding: "utf8",
      shell: useShell,
    });
    if (packResult.error || packResult.status !== 0) {
      process.stdout.write(packResult.stdout ?? "");
      process.stderr.write(packResult.stderr ?? "");
      console.error(packResult.error ?? `pnpm pack failed for ${packageSpec}.`);
      return 1;
    }

    const tarballs = readdirSync(destination).filter((file) => file.endsWith(".tgz"));
    if (tarballs.length !== 1) {
      console.error(`Expected one tarball for ${packageSpec}, found ${tarballs.length}.`);
      return 1;
    }
    const manifestResult = spawnSync(
      "tar",
      ["-xzOf", path.join(destination, tarballs[0]), "package/package.json"],
      { encoding: "utf8" },
    );
    if (manifestResult.error || manifestResult.status !== 0) {
      process.stderr.write(manifestResult.stderr ?? "");
      console.error(manifestResult.error ?? `Could not read the packed ${packageSpec} manifest.`);
      return 1;
    }

    const packedManifest = JSON.parse(manifestResult.stdout);
    const workspaceVersions = new Map(
      publicWorkspacePackages(root).map((packageInfo) => [packageInfo.name, packageInfo.version]),
    );
    const problems = packedManifestProblems(packageJson, packedManifest, workspaceVersions);
    if (problems.length > 0) {
      console.error(`${packageSpec} packs an invalid release manifest:`);
      for (const problem of problems) console.error(`  ${problem}`);
      return 1;
    }

    const rewritten = ["dependencies", "optionalDependencies", "peerDependencies"].flatMap(
      (field) =>
        Object.entries(packageJson[field] ?? {})
          .filter(([, specifier]) => String(specifier).startsWith("workspace:"))
          .map(([name]) => `${name}@${packedManifest[field][name]}`),
    );
    console.log(
      `${packageSpec} packs a valid release manifest${
        rewritten.length > 0 ? ` (${rewritten.join(", ")})` : ""
      }.`,
    );
    return 0;
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function publishAllJavaScriptPackages() {
  const script = process.argv[1];
  const childArgs = dryRun ? ["--dry-run"] : [];

  for (const packageInfo of javascriptWorkspacePackages(root)) {
    const result = spawnSync(process.execPath, [script, packageInfo.name, ...childArgs], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) {
      console.error(result.error);
      console.error(`JavaScript package publishing failed at ${packageInfo.name}; aborting.`);
      return 1;
    }

    if (result.status !== 0) {
      console.error(`JavaScript package publishing failed at ${packageInfo.name}; aborting.`);
      return result.status ?? 1;
    }
  }

  return 0;
}

function npmPublishTagArgs(version) {
  if (!isPrereleaseVersion(version)) {
    return [];
  }

  if (prereleaseTag === "latest") {
    console.error("Refusing to publish a prerelease with npm dist-tag latest.");
    process.exit(1);
  }

  return ["--tag", prereleaseTag];
}

function isPrereleaseVersion(version) {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version);
}

function findWorkspacePackage(name) {
  for (const directory of readdirSync(path.join(root, "packages"))) {
    const packageJsonPath = path.join(root, "packages", directory, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (packageJson.name === name) {
      return {
        directory: path.join(root, "packages", directory),
        // pnpm filter paths stay POSIX-style on every host.
        filter: `./packages/${directory}`,
        packageJson,
      };
    }
  }

  console.error(`${name} is not a workspace package.`);
  process.exit(1);
}

function isMissingPackageVersion(output) {
  return isMissingFromRegistry(output);
}

function isNativeArtifactPackage(packageJson) {
  return (
    typeof packageJson.name === "string" &&
    (packageJson.name.startsWith("@palamedes/core-node-") ||
      packageJson.name.startsWith("@palamedes/cli-")) &&
    Array.isArray(packageJson.os) &&
    Array.isArray(packageJson.cpu)
  );
}
