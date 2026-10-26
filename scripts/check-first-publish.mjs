// npm trusted publishing cannot mint a token for a package that has no
// published version yet, so the first release of a new package always fails
// with a 404 on PUT. That failure used to surface in the middle of the publish
// loop, after the native packages had already gone out, leaving the registry
// with a half-shipped release set. This preflight runs before anything is
// published and reports every package that needs a manual first publish at
// once, so the maintainer handles them in one pass instead of discovering them
// one 404 at a time.
//
// A dry run publishes nothing, so it passes `--warn-only`: blocking it would
// make a newly added platform package impossible to build-verify before its
// first publish, which is exactly when the verification matters most.
import { publicWorkspacePackages, registryLookup } from "./release-packages.mjs";

const warnOnly = process.argv.includes("--warn-only");
const packages = publicWorkspacePackages();
const unpublished = [];
const failures = [];

for (const packageInfo of packages) {
  const lookup = registryLookup(packageInfo.name, "name");

  if (lookup.state === "missing") {
    unpublished.push(packageInfo);
  } else if (lookup.state === "error") {
    failures.push({ name: packageInfo.name, detail: lookup.detail });
  }
}

if (failures.length > 0) {
  console.error("Could not determine the registry state for every package:");
  for (const failure of failures) {
    console.error(`  ${failure.name}: ${failure.detail}`);
  }
  process.exit(1);
}

if (unpublished.length === 0) {
  console.log(
    `All ${packages.length} public package names exist on the registry. Trusted-publisher configuration and publish permissions are not verified by this name-only check.`,
  );
  process.exit(0);
}

console.error(
  `${unpublished.length} package(s) have never been published, so this release would fail partway through:`,
);
for (const packageInfo of unpublished) {
  console.error(`  ${packageInfo.name} (${packageInfo.directory})`);
}
console.error("");
console.error("Publish each one manually once, then let CI take over:");
console.error("");
console.error("  pnpm install --frozen-lockfile");
for (const packageInfo of unpublished) {
  console.error(`  pnpm -r --filter "./${packageInfo.directory}..." build`);
}
for (const packageInfo of unpublished) {
  console.error(
    `  pnpm --filter ./${packageInfo.directory} publish --access public --no-git-checks`,
  );
}
console.error("");
console.error(
  "Then verify a trusted publisher for each package on npmjs.com (repository sebastian-software/palamedes, workflow publish.yml, no environment, direct npm publish allowed). Run the upload-free dry run on the reviewed revision; actual publication remains subject to the coordinated release policy and authorization.",
);

if (warnOnly) {
  console.error("");
  console.error(
    `::warning title=First-publish setup required::${unpublished.length} package(s) need a manual bootstrap publish and npm trusted-publisher configuration before a release can succeed.`,
  );
  console.error("Reported only: this run does not publish anything.");
  process.exit(0);
}

process.exit(1);
