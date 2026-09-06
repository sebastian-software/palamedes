import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publicWorkspacePackages } from "./release-packages.mjs";

// Palamedes is dual licensed, so the texts live in LICENSE-MIT and
// LICENSE-APACHE. Neither name is picked up automatically: `pnpm publish` only
// embeds a workspace-root file matching `LICEN{S,C}E{,.*}`, and npm only
// force-includes `license{,.*}` from the package directory itself. Both texts
// are therefore copied into every publishable package and listed in its
// `files` entry.
export const LICENSE_FILES = ["LICENSE-APACHE", "LICENSE-MIT"];

export function copyLicenseFiles(packageDirectory, repositoryRoot) {
  for (const licenseFile of LICENSE_FILES) {
    copyFileSync(path.join(repositoryRoot, licenseFile), path.join(packageDirectory, licenseFile));
  }
}

export function missingLicenseFileEntries(manifest) {
  const files = manifest.files ?? [];
  return LICENSE_FILES.filter((licenseFile) => !files.includes(licenseFile));
}

export function syncPackageLicenses(repositoryRoot = process.cwd()) {
  const packages = publicWorkspacePackages(repositoryRoot);

  for (const packageInfo of packages) {
    const missing = missingLicenseFileEntries(packageInfo.manifest);

    if (missing.length > 0) {
      throw new Error(
        `${packageInfo.name} must list ${missing.join(" and ")} in "files"; otherwise the published package ships without its license text.`,
      );
    }

    copyLicenseFiles(path.join(repositoryRoot, packageInfo.directory), repositoryRoot);
  }

  return packages.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = syncPackageLicenses();
  console.log(`sync-package-licenses: ${count} packages carry both license texts`);
}
