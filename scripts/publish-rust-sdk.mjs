import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publicationAllowed, readReleasePolicy } from "./release-policy.mjs";
import {
  archivePath,
  readArchiveContents,
  registryJson,
  RUST_SDK_REPOSITORY,
  run,
  sdkMetadata,
  sha256,
  waitForRegistryVersion,
} from "./rust-sdk-packages.mjs";

// Release policy and manifest guards. These need neither credentials nor the
// registry, so the preflight and the publisher share them.
export function assertRustReleaseManifests(policy, packages) {
  if (!publicationAllowed(policy, packages[0].version))
    throw new Error(`Release hold: ${policy.reason}`);
  if (new Set(packages.map((pkg) => pkg.version)).size !== 1) {
    throw new Error("Rust SDK versions must match");
  }
  for (const pkg of packages) {
    if (!pkg.publish?.includes("crates-io")) {
      throw new Error(
        `${pkg.name} must explicitly allow crates-io in the reviewed release-enablement change`,
      );
    }
  }
}

export function assertRustPublication(policy, packages, environment) {
  assertRustReleaseManifests(policy, packages);
  if (!environment.CARGO_REGISTRY_TOKEN) throw new Error("Missing CARGO_REGISTRY_TOKEN");
  if (!environment.PALAMEDES_CRATES_OWNER)
    throw new Error("Missing verified PALAMEDES_CRATES_OWNER login");
}

// An existing crate must belong to this repository and list the configured
// login as a direct owner before anything is uploaded to it.
export async function assertRegisteredCrate(pkg, existing, owner, registry) {
  if (existing.crate?.repository !== RUST_SDK_REPOSITORY) {
    throw new Error(`Registry repository differs for ${pkg.name}`);
  }
  const owners = await registry(`https://crates.io/api/v1/crates/${pkg.name}/owners`);
  if (!owners?.users?.some((entry) => entry.login === owner)) {
    throw new Error(`${owner} is not a verified direct owner of ${pkg.name}`);
  }
}

// Runs before any npm or crates.io upload. It checks everything the Cargo lane
// can know without uploading: the release policy, the `publish` allowlists,
// the configured owner, that every crate already exists on crates.io (trusted
// publishing cannot create a crate), its repository and ownership, and that
// the release version is not yanked. A real release also requires the OIDC
// token exchange to have succeeded; `dryRun` skips that, and reports instead
// of enforcing the policy and allowlists while the release hold is in place.
export async function preflightRustSdk(
  root = process.cwd(),
  environment = process.env,
  {
    metadata = sdkMetadata,
    policy = readReleasePolicy,
    registry = registryJson,
    dryRun = false,
    log = console.log,
  } = {},
) {
  const packages = await metadata(root);
  const releasePolicy = policy(root);
  if (dryRun && !releasePolicy.publicationEnabled) {
    log(`Release hold: ${releasePolicy.reason}`);
    log("The dry run skips the policy and crates-io allowlist checks while the hold is in place.");
  } else {
    assertRustReleaseManifests(releasePolicy, packages);
  }
  if (!dryRun && environment.PALAMEDES_CRATES_TOKEN_ISSUED !== "true") {
    throw new Error("crates.io did not issue a trusted publishing token for this workflow");
  }
  const owner = environment.PALAMEDES_CRATES_OWNER;
  if (!owner) throw new Error("Missing verified PALAMEDES_CRATES_OWNER login");

  for (const pkg of packages) {
    const existing = await registry(`https://crates.io/api/v1/crates/${pkg.name}`);
    if (!existing) {
      throw new Error(
        `${pkg.name} does not exist on crates.io; trusted publishing cannot create a crate`,
      );
    }
    await assertRegisteredCrate(pkg, existing, owner, registry);
    const published = await registry(`https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}`);
    if (published?.version?.yanked) {
      throw new Error(`${pkg.name}@${pkg.version} is yanked on crates.io`);
    }
    log(
      `${pkg.name}@${pkg.version}: owned by ${owner}, ${
        published ? "already published; the lane compares its archive" : "ready to publish"
      }`,
    );
  }
}

export function assertPublishedArchive(version, checksum, pkg) {
  if (version.yanked) {
    throw new Error(`Already-published version is yanked: ${pkg.name}@${pkg.version}`);
  }
  if (version.checksum !== checksum) {
    throw new Error(
      `Already-published archive differs: ${pkg.name}@${pkg.version}. ` +
        "Cargo records the source commit in .cargo_vcs_info.json, so even a commit outside the crate can change its checksum. " +
        "Retry the original release revision with an identical archive, or release a new coordinated version if changes are required. " +
        "See CONTRIBUTING.md#recovering-a-partial-release.",
    );
  }
}

export async function publishRustSdk(
  root = process.cwd(),
  environment = process.env,
  {
    metadata = sdkMetadata,
    policy = readReleasePolicy,
    registry = registryJson,
    execute = run,
    checksumOf = sha256,
    wait = waitForRegistryVersion,
  } = {},
) {
  const packages = await metadata(root);
  assertRustPublication(policy(root), packages, environment);
  const owner = environment.PALAMEDES_CRATES_OWNER;
  const target = resolve(root, "target/rust-sdk-publish");
  for (const pkg of packages) {
    const existing = await registry(`https://crates.io/api/v1/crates/${pkg.name}`);
    if (existing) await assertRegisteredCrate(pkg, existing, owner, registry);
    // Dependencies become visible before packaging the dependent builder. Cargo
    // performs its own archive verification again; no verification bypass exists.
    await execute(
      "cargo",
      ["package", "-p", pkg.name, "--locked", "--registry", "crates-io", "--target-dir", target],
      {
        cwd: root,
      },
    );
    const archive = archivePath(target, pkg);
    await readArchiveContents(archive, pkg, execute);
    const checksum = await checksumOf(archive);
    const published = await registry(`https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}`);
    if (published) {
      assertPublishedArchive(published.version, checksum, pkg);
      console.log(`${pkg.name}@${pkg.version} already has the exact archive; skipping upload`);
    } else {
      await execute(
        "cargo",
        ["publish", "-p", pkg.name, "--locked", "--registry", "crates-io", "--target-dir", target],
        {
          cwd: root,
          env: environment,
        },
      );
      const owners = await registry(`https://crates.io/api/v1/crates/${pkg.name}/owners`);
      if (!owners?.users?.some((entry) => entry.login === owner)) {
        throw new Error(
          `Published ${pkg.name}, but ${owner} is not a verified direct owner; stop before publishing dependents`,
        );
      }
    }
    await wait(pkg, checksum);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (
    args[0] === "--preflight" &&
    args.length <= 2 &&
    (args.length === 1 || args[1] === "--dry-run")
  ) {
    await preflightRustSdk(process.cwd(), process.env, { dryRun: args[1] === "--dry-run" });
  } else if (args.length === 1 && args[0] === "--dry-run") {
    // Staging is required before the first registry publication: Cargo cannot
    // dry-run the builder against prerequisites that do not exist on crates.io.
    const policy = readReleasePolicy();
    console.log(`Rust SDK dry run; publicationEnabled=${policy.publicationEnabled}. No uploads.`);
    await run(
      process.execPath,
      [resolve(dirname(fileURLToPath(import.meta.url)), "verify-rust-sdk.mjs")],
      { stdio: ["ignore", "pipe", "inherit"] },
    ).then((output) => process.stdout.write(output));
  } else if (args.length > 0) {
    throw new Error(
      "Usage: node scripts/publish-rust-sdk.mjs [--dry-run | --preflight [--dry-run]]",
    );
  } else {
    await publishRustSdk();
  }
}
