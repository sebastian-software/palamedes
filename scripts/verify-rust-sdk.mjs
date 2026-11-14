// By default a loopback registry verifies the exact prepublication archives.
// --published-version checks the same consumer against crates.io and npm.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, copyFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  archivePath,
  assertArchiveContents,
  readArchiveContents,
  indexPath,
  RUST_SDK_PACKAGES,
  run,
  sdkMetadata,
  sha256,
  waitForRegistryVersion,
} from "./rust-sdk-packages.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
assert(
  args.length === 0 ||
    (args.length === 2 && args[0] === "--published-version" && /^\d+\.\d+\.\d+$/u.test(args[1])),
  "Usage: node scripts/verify-rust-sdk.mjs [--published-version <version>]",
);
const publishedVersion = args[1];
const target = resolve(
  root,
  publishedVersion
    ? `target/rust-sdk-published-proof/${publishedVersion}`
    : "target/rust-sdk-proof",
);
const packages = publishedVersion
  ? RUST_SDK_PACKAGES.map((name) => ({ name, version: publishedVersion }))
  : await sdkMetadata(root);
const entries = new Map();
const archives = new Map();
const proxyCache = new Map();
const environment = { ...process.env, CARGO_TARGET_DIR: target };
if (publishedVersion) {
  // Do not inherit registry replacements, patches, credentials or Cargo config.
  for (const key of Object.keys(environment)) {
    if (key.startsWith("CARGO_")) delete environment[key];
  }
  environment.CARGO_HOME = await mkdtemp(join(tmpdir(), "palamedes-sdk-cargo-home-"));
  environment.CARGO_TARGET_DIR = target;
  environment.RUSTUP_TOOLCHAIN = (
    await run("rustup", ["show", "active-toolchain"], { cwd: root })
  ).split(/\s/u)[0];
}
// Anonymous local staging must never receive a release credential.
delete environment.CARGO_REGISTRY_TOKEN;
delete environment.CARGO_REGISTRIES_CRATES_IO_TOKEN;
const server = createServer(async (request, response) => {
  try {
    assert(!request.headers.authorization, "Staging registry received a credential");
    const path = new URL(request.url, "http://localhost").pathname.slice(1);
    if (path === "config.json") {
      response.end(JSON.stringify({ dl: `${address}/crates/{crate}/{version}/download` }));
    } else if (path.startsWith("crates/")) {
      const [, name, version] = path.split("/");
      if (RUST_SDK_PACKAGES.includes(name)) {
        const archive = archives.get(`${name}@${version}`);
        if (!archive) response.writeHead(404).end();
        else response.end(await readFile(archive));
      } else {
        response
          .writeHead(302, {
            Location: `https://static.crates.io/crates/${name}/${name}-${version}.crate`,
          })
          .end();
      }
    } else if (RUST_SDK_PACKAGES.some((name) => path === indexPath(name))) {
      if (!entries.has(path)) response.writeHead(404).end();
      else response.end(`${JSON.stringify(entries.get(path))}\n`);
    } else {
      if (!proxyCache.has(path)) {
        const upstream = await fetch(`https://index.crates.io/${path}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!upstream.ok) {
          response.writeHead(upstream.status).end();
          return;
        }
        proxyCache.set(path, await upstream.text());
      }
      response.end(proxyCache.get(path));
    }
  } catch (error) {
    console.error(error.message);
    response.writeHead(502).end();
  }
});
if (!publishedVersion) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.listening ? `http://127.0.0.1:${server.address().port}` : undefined;
const config = publishedVersion
  ? []
  : [
      "--config",
      'source.crates-io.replace-with="sdk-staging"',
      "--config",
      `source.sdk-staging.registry="sparse+${address}/"`,
    ];
const cargo = (args, cwd = root) => run("cargo", [...args, ...config], { cwd, env: environment });
const receipts = [];
const extractedArchives = await mkdtemp(join(tmpdir(), "palamedes-sdk-archives-"));
try {
  for (const pkg of publishedVersion ? [] : packages) {
    console.log(`Packaging and verifying ${pkg.name}@${pkg.version}`);
    const listing = await cargo(["package", "-p", pkg.name, "--list", "--allow-dirty"]);
    const files = listing.trim().split("\n");
    assertArchiveContents(pkg.name, files);
    await cargo([
      "package",
      "-p",
      pkg.name,
      "--allow-dirty",
      "--locked",
      "--all-features",
      "-j",
      "2",
    ]);
    const archive = archivePath(target, pkg);
    const archiveFiles = await readArchiveContents(archive, pkg);
    assert.deepEqual(
      [...archiveFiles].sort(),
      [...files].sort(),
      `${pkg.name} archive differs from its file list`,
    );
    const checksum = await sha256(archive);
    archives.set(`${pkg.name}@${pkg.version}`, archive);
    entries.set(indexPath(pkg.name), {
      name: pkg.name,
      vers: pkg.version,
      deps: pkg.dependencies
        .filter((dep) => dep.kind !== "dev")
        .map((dep) => ({
          name: dep.rename ?? dep.name,
          req: dep.req,
          features: dep.features,
          optional: dep.optional,
          default_features: dep.uses_default_features,
          target: dep.target,
          kind: dep.kind ?? "normal",
          registry: null,
          ...(dep.rename ? { package: dep.name } : {}),
        })),
      cksum: checksum,
      features: pkg.features,
      yanked: false,
      rust_version: pkg.rust_version,
    });
    await run("tar", ["-xzf", archive, "-C", extractedArchives]);
    const extracted = join(extractedArchives, `${pkg.name}-${pkg.version}`);
    for (const license of ["LICENSE-MIT", "LICENSE-APACHE"]) {
      assert.equal(await sha256(join(extracted, license)), await sha256(join(root, license)));
    }
    await cargo([
      "doc",
      "--manifest-path",
      join(extracted, "Cargo.toml"),
      "--no-deps",
      "--locked",
      "--all-features",
    ]);
    receipts.push({
      name: pkg.name,
      version: pkg.version,
      checksum,
      files,
    });
  }

  // This project is outside both the repository and every workspace. Its only
  // Palamedes dependencies are exact registry versions, never paths or patches.
  const consumer = await mkdtemp(join(tmpdir(), "palamedes-sdk-consumer-"));
  await mkdir(join(consumer, "src"));
  await mkdir(join(consumer, "locales"));
  const version = packages[0].version;
  await writeFile(
    join(consumer, "Cargo.toml"),
    `[package]\nname="rust-sdk-registry-consumer"\nversion="0.0.0"\nedition="2024"\n[workspace]\n[dependencies]\npalamedes-i18n="=${version}"\n[build-dependencies]\npalamedes-build="=${version}"\npalamedes="=${version}"\n`,
  );
  await writeFile(
    join(consumer, "build.rs"),
    `fn main() -> Result<(), Box<dyn std::error::Error>> {\nlet compiled = palamedes_build::CatalogBuilder::new("locales", "en").locales(&["en", "de"]).build()?;\ncompiled.install_to(std::path::Path::new("distribution/translations"))?;\nstd::fs::copy(compiled.schema_file, "distribution/schema.pmd.json")?;\nOk(())\n}\n`,
  );
  await copyFile(
    join(root, "crates/palamedes-i18n/examples/cli/src/main.rs"),
    join(consumer, "src/main.rs"),
  );
  for (const locale of ["en", "de"]) {
    await copyFile(
      join(root, `crates/palamedes-i18n/examples/cli/locales/${locale}.po`),
      join(consumer, `locales/${locale}.po`),
    );
  }
  await cargo(["build", "--release", "-j", "2"], consumer);
  const metadata = JSON.parse(
    await cargo(["metadata", "--format-version", "1", "--locked"], consumer),
  );
  for (const name of RUST_SDK_PACKAGES) {
    const pkg = metadata.packages.find((entry) => entry.name === name);
    assert.equal(pkg?.version, version, `${name} resolved a different SDK version`);
    assert(pkg?.source?.startsWith("registry+"), `${name} did not resolve from a registry`);
    assert(!pkg.manifest_path.startsWith(root), `${name} fell back to the checkout`);
    if (publishedVersion) {
      assert.equal(pkg.source, "registry+https://github.com/rust-lang/crates.io-index");
      assert(pkg.manifest_path.startsWith(join(environment.CARGO_HOME, "registry", "src")));
      const registry = basename(dirname(dirname(pkg.manifest_path)));
      const checksum = await sha256(
        join(environment.CARGO_HOME, "registry/cache", registry, `${name}-${version}.crate`),
      );
      await waitForRegistryVersion(pkg, checksum);
      receipts.push({ name, version: pkg.version, source: pkg.source, checksum });
    }
  }
  if (publishedVersion) {
    for (const pkg of metadata.packages.filter((entry) => entry.id !== metadata.resolve.root)) {
      assert.equal(pkg.source, "registry+https://github.com/rust-lang/crates.io-index");
    }
  }
  const installed = await mkdtemp(join(tmpdir(), "palamedes-sdk-installed-"));
  const executable = join(installed, process.platform === "win32" ? "greeting.exe" : "greeting");
  await copyFile(
    join(
      target,
      "release",
      `rust-sdk-registry-consumer${process.platform === "win32" ? ".exe" : ""}`,
    ),
    executable,
  );
  const translations = join(installed, "translations");
  await mkdir(translations);
  const runApp = async (locale, count = "2") =>
    run(executable, [translations, locale, "Ada", count], {
      cwd: installed,
      env: { PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  for (const locale of ["en", "de"]) {
    await copyFile(
      join(consumer, `distribution/translations/${locale}.pmd.json`),
      join(translations, `${locale}.pmd.json`),
    );
  }
  assert.equal(await runApp("en"), "Hello Ada!\nPreview for Ada\n2 files\n");
  assert.equal(await runApp("de", "1"), "Hallo Ada!\nVorschau für Ada\n1 Datei\n");
  assert.equal(await runApp("de"), "Hallo Ada!\nVorschau für Ada\n2 Dateien\n");
  await assert.rejects(runApp("fr"), /fr\.pmd\.json/);
  const english = join(translations, "en.pmd.json");
  const englishBytes = await readFile(english);
  await unlink(english);
  await assert.rejects(runApp("en"), /en\.pmd\.json/);
  await writeFile(english, JSON.stringify({ ...JSON.parse(englishBytes), version: 999 }));
  await assert.rejects(runApp("en"), /format version mismatch.*999/);

  // Compile an actual PO edit through the native CLI against the exported v2
  // schema. The copied application is never rebuilt, and runs with empty PATH.
  const before = await sha256(executable);
  const schema = join(consumer, "distribution/schema.pmd.json");
  assert.equal(JSON.parse(await readFile(schema)).version, 2);
  const germanPo = join(consumer, "locales/de.po");
  await writeFile(germanPo, (await readFile(germanPo, "utf8")).replace("Hallo ", "Guten Tag "));
  let compiler;
  let uiCatalogs;
  let compilerPackage;
  if (publishedVersion) {
    const compilerRoot = await mkdtemp(join(tmpdir(), "palamedes-sdk-published-cli-"));
    await run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--prefix",
        compilerRoot,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry",
        "https://registry.npmjs.org",
        `@palamedes/cli@${publishedVersion}`,
      ],
      { cwd: compilerRoot, shell: process.platform === "win32" },
    );
    const wrapperRoot = join(compilerRoot, "node_modules/@palamedes/cli");
    const wrapper = JSON.parse(await readFile(join(wrapperRoot, "package.json"), "utf8"));
    assert.equal(wrapper.version, publishedVersion);
    const { resolveNativeExecutable } = await import(
      pathToFileURL(join(wrapperRoot, "scripts/platform.mjs")).href
    );
    compiler = resolveNativeExecutable();
    uiCatalogs = join(dirname(compiler), "pmds-locales");
    const native = JSON.parse(await readFile(join(dirname(compiler), "../package.json"), "utf8"));
    assert.equal(native.version, publishedVersion);
    compilerPackage = {
      name: native.name,
      version: native.version,
      checksum: await sha256(compiler),
    };
  } else {
    const buildOutput = await run(
      "cargo",
      ["build", "-p", "palamedes-cli", "--locked", "--message-format=json", "-j", "2"],
      { cwd: root, env: environment },
    );
    const messages = buildOutput
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    const binary = messages.find(
      (item) =>
        item.reason === "compiler-artifact" && item.target.name === "pmds" && item.executable,
    );
    const build = messages.find(
      (item) => item.reason === "build-script-executed" && item.package_id === binary.package_id,
    );
    compiler = join(installed, `pmds${process.platform === "win32" ? ".exe" : ""}`);
    uiCatalogs = join(installed, "pmds-locales");
    await copyFile(binary.executable, compiler);
    await mkdir(uiCatalogs);
    await copyFile(join(build.out_dir, "catalogs/en.pmd.json"), join(uiCatalogs, "en.pmd.json"));
  }
  await run(
    compiler,
    [
      "catalog",
      "compile",
      "--target",
      "rust",
      "--schema",
      schema,
      "--catalog-dir",
      join(consumer, "locales"),
      "--locale",
      "de",
      "--output",
      translations,
    ],
    {
      cwd: installed,
      env: {
        PATH: "",
        PALAMEDES_UI_CATALOG_DIR: uiCatalogs,
        PALAMEDES_UPDATE_CHECK: "0",
        PALAMEDES_TELEMETRY: "off",
        DO_NOT_TRACK: "1",
        APP_TRACKING_STATE_DIR: join(installed, "app-tracking-state"),
        LC_ALL: "en",
      },
    },
  );
  assert.equal(await runApp("de"), "Guten Tag Ada!\nVorschau für Ada\n2 Dateien\n");
  assert.equal(await sha256(executable), before);
  for (const text of ["Hello {name}!", "Hallo ", "{count, plural", "# Dateien"]) {
    assert(!(await readFile(executable)).includes(Buffer.from(text)), `Executable embeds ${text}`);
  }
  const receipt = {
    mode: publishedVersion ? "crates.io" : "staged-registry",
    platform: `${process.platform}/${process.arch}`,
    toolchain: publishedVersion
      ? (await run("rustc", ["--version"], { cwd: root, env: environment })).trim()
      : undefined,
    compilerPackage,
    packages: receipts,
    consumer,
    installed,
    executableChecksum: before,
    catalogFormat: 2,
    registryOnly: true,
    unchangedApplication: true,
  };
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Rust SDK ${receipt.mode} proof passed: ${join(target, "receipt.json")}`);
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
