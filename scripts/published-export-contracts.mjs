/*
 * A top-level `types` condition wins before TypeScript can select a nested
 * `require` condition. Keep declarations and runtime targets beside their
 * runtime format so CJS consumers resolve `.d.cts` and `.cjs`, even on
 * TypeScript versions that no longer diagnose requiring ESM declarations.
 */
export function assertDualExportsUseFormatSpecificTargets(packages) {
  const problems = []

  for (const { manifest } of packages) {
    for (const [subpath, condition] of Object.entries(manifest.exports ?? {})) {
      visitCondition(condition, subpath, false, manifest.name, problems)
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join("\n"))
  }
}

function visitCondition(condition, conditionPath, hasTypesAncestor, packageName, problems) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return

  const hasTypesCondition = hasTypesAncestor || Object.hasOwn(condition, "types")
  const hasDualRuntimeConditions =
    Object.hasOwn(condition, "import") && Object.hasOwn(condition, "require")

  if (hasDualRuntimeConditions) {
    if (hasTypesCondition) {
      problems.push(
        `${packageName} ${conditionPath} has a "types" condition that masks its import and require declarations.`
      )
    }
    assertFormatSpecificTargets(
      condition.import,
      "import",
      ".d.mts",
      ".mjs",
      packageName,
      conditionPath,
      problems
    )
    assertFormatSpecificTargets(
      condition.require,
      "require",
      ".d.cts",
      ".cjs",
      packageName,
      conditionPath,
      problems
    )
  }

  for (const [name, nestedCondition] of Object.entries(condition)) {
    if (name !== "types") {
      visitCondition(
        nestedCondition,
        `${conditionPath}.${name}`,
        hasTypesCondition,
        packageName,
        problems
      )
    }
  }
}

function assertFormatSpecificTargets(
  condition,
  mode,
  declarationExtension,
  runtimeExtension,
  packageName,
  conditionPath,
  problems
) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    problems.push(
      `${packageName} ${conditionPath}.${mode} must nest a ${declarationExtension} declaration and ${runtimeExtension} runtime target.`
    )
    return
  }

  if (typeof condition.types !== "string" || !condition.types.endsWith(declarationExtension)) {
    problems.push(
      `${packageName} ${conditionPath}.${mode}.types must reference a ${declarationExtension} declaration.`
    )
  }

  if (typeof condition.default !== "string" || !condition.default.endsWith(runtimeExtension)) {
    problems.push(
      `${packageName} ${conditionPath}.${mode}.default must reference a ${runtimeExtension} runtime target.`
    )
  }
}
