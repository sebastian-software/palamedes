import assert from "node:assert/strict"
import test from "node:test"

import {
  dependencyOrderedWorkspacePackages,
  isMissingFromRegistry,
  javascriptWorkspacePackages,
  publicWorkspacePackages,
} from "./release-packages.mjs"

test("recognizes current npm missing-version diagnostics without hiding other registry errors", () => {
  assert.equal(
    isMissingFromRegistry(`npm error code E404
npm error 404 No match found for version 1.23.0`),
    true
  )
  assert.equal(
    isMissingFromRegistry("npm error code E401\nnpm error Incorrect or missing password."),
    false
  )
})

test("derives JavaScript publish packages from the public workspace scan", () => {
  const publicPackages = publicWorkspacePackages()
  const javascriptPackages = javascriptWorkspacePackages()

  const publicJavaScriptPackages = publicPackages.filter(
    (packageInfo) => !packageInfo.nativeArtifact
  )

  assert.deepEqual(javascriptPackages, dependencyOrderedWorkspacePackages(publicJavaScriptPackages))
  assert.ok(javascriptPackages.some((packageInfo) => packageInfo.name === "@palamedes/waku"))
  assert.ok(javascriptPackages.some((packageInfo) => packageInfo.name === "@palamedes/tanstack"))
  assert.ok(javascriptPackages.every((packageInfo) => !packageInfo.nativeArtifact))

  const publishIndex = new Map(
    javascriptPackages.map((packageInfo, index) => [packageInfo.name, index])
  )
  for (const packageInfo of javascriptPackages) {
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependency, version] of Object.entries(packageInfo.manifest[field] ?? {})) {
        if (
          typeof version === "string" &&
          version.startsWith("workspace:") &&
          publishIndex.has(dependency)
        ) {
          assert.ok(
            publishIndex.get(dependency) < publishIndex.get(packageInfo.name),
            `${dependency} must publish before ${packageInfo.name}`
          )
        }
      }
    }
  }
})

test("orders internal dependencies before dependents with stable independent packages", () => {
  const packages = [
    packageInfo("@example/dependent", { "@example/runtime": "workspace:^" }),
    packageInfo("@example/runtime"),
    packageInfo("@example/independent"),
  ]

  assert.deepEqual(
    dependencyOrderedWorkspacePackages(packages).map((packageInfo) => packageInfo.name),
    ["@example/independent", "@example/runtime", "@example/dependent"]
  )
})

test("rejects workspace dependency cycles instead of returning an unsafe publish order", () => {
  const packages = [
    packageInfo("@example/a", { "@example/b": "workspace:^" }),
    packageInfo("@example/b", { "@example/a": "workspace:^" }),
  ]

  assert.throws(
    () => dependencyOrderedWorkspacePackages(packages),
    /dependency cycle detected among @example\/a, @example\/b/u
  )
})

test("keeps acyclic peer dependencies as publish-order hints", () => {
  const packages = [
    packageInfo(
      "@example/adapter",
      {},
      { peerDependencies: { "@example/runtime": "workspace:^" } }
    ),
    packageInfo("@example/runtime"),
  ]

  assert.deepEqual(
    dependencyOrderedWorkspacePackages(packages).map((packageInfo) => packageInfo.name),
    ["@example/runtime", "@example/adapter"]
  )
})

test("drops only peer ordering hints that would close a dependency cycle", () => {
  const packages = [
    packageInfo("@example/a", {}, { peerDependencies: { "@example/b": "workspace:^" } }),
    packageInfo("@example/b", {}, { peerDependencies: { "@example/a": "workspace:^" } }),
    packageInfo("@example/c", { "@example/a": "workspace:^" }),
  ]
  const warnings = []

  assert.deepEqual(
    dependencyOrderedWorkspacePackages(packages, { warn: (warning) => warnings.push(warning) }).map(
      (packageInfo) => packageInfo.name
    ),
    ["@example/b", "@example/a", "@example/c"]
  )
  assert.deepEqual(warnings, [
    "Ignoring workspace peer dependency publish-order hint @example/a -> @example/b because it would create a cycle.",
  ])
})

test("still rejects cycles made only from hard optional dependencies", () => {
  const packages = [
    packageInfo("@example/a", {}, { optionalDependencies: { "@example/b": "workspace:^" } }),
    packageInfo("@example/b", {}, { optionalDependencies: { "@example/a": "workspace:^" } }),
  ]

  assert.throws(
    () => dependencyOrderedWorkspacePackages(packages),
    /dependency cycle detected among @example\/a, @example\/b/u
  )
})

function packageInfo(name, dependencies = {}, manifest = {}) {
  return { name, manifest: { ...manifest, dependencies } }
}
