import path from "node:path";

export function packedFilePathsFromJson(output, packageName) {
  let result;
  try {
    result = JSON.parse(output);
  } catch (error) {
    throw new Error(`npm pack returned invalid JSON for ${packageName}.`, { cause: error });
  }

  // npm 11 returns an array; npm 12 keys the same entries by package name.
  let entry;
  if (Array.isArray(result) && result.length === 1) {
    [entry] = result;
  } else if (
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.keys(result).length === 1 &&
    Object.hasOwn(result, packageName)
  ) {
    entry = result[packageName];
  }

  if (entry?.name !== packageName || !Array.isArray(entry.files)) {
    throw new Error(
      `npm pack must return exactly one package named ${packageName} with a files array.`,
    );
  }

  const files = new Set();
  for (const file of entry.files) {
    const filePath = file?.path;
    if (
      typeof filePath !== "string" ||
      filePath.length === 0 ||
      path.posix.isAbsolute(filePath) ||
      path.win32.isAbsolute(filePath) ||
      filePath.includes("\\") ||
      filePath.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(`npm pack returned an invalid file path for ${packageName}.`);
    }
    files.add(filePath);
  }
  return files;
}
