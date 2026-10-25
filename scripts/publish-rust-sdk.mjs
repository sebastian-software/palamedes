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

export function assertRustPublication(policy, packages, environment) {
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
  if (!environment.CARGO_REGISTRY_TOKEN) throw new Error("Missing CARGO_REGISTRY_TOKEN");
  if (!environment.PALAMEDES_CRATES_OWNER)
    throw new Error("Missing verified PALAMEDES_CRATES_OWNER login");
}

export function assertPublishedArchive(version, checksum, pkg) {
  if (version.yanked || version.checksum !== checksum) {
    throw new Error(`Already-published archive differs or is yanked: ${pkg.name}@${pkg.version}`);
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
    if (existing) {
      if (existing.crate?.repository !== RUST_SDK_REPOSITORY) {
        throw new Error(`Registry repository differs for ${pkg.name}`);
      }
      const owners = await registry(`https://crates.io/api/v1/crates/${pkg.name}/owners`);
      if (!owners?.users?.some((entry) => entry.login === owner)) {
        throw new Error(`${owner} is not a verified direct owner of ${pkg.name}`);
      }
    }
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
  if (process.argv.includes("--dry-run")) {
    // Staging is required before the first registry publication: Cargo cannot
    // dry-run the builder against prerequisites that do not exist on crates.io.
    const policy = readReleasePolicy();
    console.log(`Rust SDK dry run; publicationEnabled=${policy.publicationEnabled}. No uploads.`);
    await run(
      process.execPath,
      [resolve(dirname(fileURLToPath(import.meta.url)), "verify-rust-sdk.mjs")],
      { stdio: ["ignore", "pipe", "inherit"] },
    ).then((output) => process.stdout.write(output));
  } else if (process.argv.slice(2).length > 0) {
    throw new Error("Usage: node scripts/publish-rust-sdk.mjs [--dry-run]");
  } else {
    await publishRustSdk();
  }
}
