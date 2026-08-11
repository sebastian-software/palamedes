import assert from "node:assert/strict"
import test from "node:test"

import { javascriptWorkspacePackages, publicWorkspacePackages } from "./release-packages.mjs"

test("derives JavaScript publish packages from the public workspace scan", () => {
  const publicPackages = publicWorkspacePackages()
  const javascriptPackages = javascriptWorkspacePackages()

  assert.deepEqual(
    javascriptPackages,
    publicPackages.filter((packageInfo) => !packageInfo.nativeArtifact)
  )
  assert.ok(javascriptPackages.some((packageInfo) => packageInfo.name === "@palamedes/waku"))
  assert.ok(javascriptPackages.some((packageInfo) => packageInfo.name === "@palamedes/tanstack"))
  assert.ok(javascriptPackages.every((packageInfo) => !packageInfo.nativeArtifact))
})
