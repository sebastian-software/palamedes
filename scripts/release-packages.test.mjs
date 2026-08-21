import assert from "node:assert/strict"
import test from "node:test"

import {
  dependencyOrderedWorkspacePackages,
  javascriptWorkspacePackages,
  publicWorkspacePackages,
} from "./release-packages.mjs"

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

function packageInfo(name, dependencies = {}) {
  return { name, manifest: { dependencies } }
}
