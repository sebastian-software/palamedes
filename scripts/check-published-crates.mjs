// publish-cargo already waits for each crate's exact archive before it packages
// the next one. This sweep runs after every publish lane has finished and reads
// the public crates.io index again, so the release record rests on the registry
// state rather than on the publisher's exit status, as the npm sweep does.
import { sdkManifestVersions, waitForRegistryVersion } from "./rust-sdk-packages.mjs";

const packages = await sdkManifestVersions(process.cwd());
if (new Set(packages.map((pkg) => pkg.version)).size !== 1) {
  throw new Error("Rust SDK manifest versions must match the coordinated release version");
}

for (const pkg of packages) {
  await waitForRegistryVersion(pkg, null);
  console.log(`${pkg.name}@${pkg.version} ✓`);
}

console.log("");
console.log(`All ${packages.length} Rust SDK crates are on crates.io at ${packages[0].version}.`);
