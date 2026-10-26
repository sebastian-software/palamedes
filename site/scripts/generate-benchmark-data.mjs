import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadBlacksmithBenchData } from "../../scripts/blacksmith-bench-data.mjs";
import { reactBenchmarkVersions } from "../../scripts/benchmark-tool-versions.mjs";
import { loadFrameworkBenchData } from "../../scripts/framework-bench-data.mjs";

// Site tests need these imports even when no documentation or native build ran.
// Keep their projection shared with the full site prebuild.
export async function writeBenchmarkData(repoRoot) {
  const report = JSON.parse(
    await readFile(join(repoRoot, "benchmarks/e2e-workflow/results/latest.json"), "utf8"),
  );
  const versions = reactBenchmarkVersions(report);
  const frameworks = await loadFrameworkBenchData(repoRoot);
  const platforms = await loadBlacksmithBenchData(repoRoot);
  const output = join(repoRoot, "site/app/data/generated");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "benchmark-versions.json"), `${JSON.stringify(versions)}\n`);
  await writeFile(join(output, "framework-bench.json"), `${JSON.stringify(frameworks, null, 2)}\n`);
  await writeFile(join(output, "blacksmith-bench.json"), `${JSON.stringify(platforms)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await writeBenchmarkData(resolve(import.meta.dirname, "../.."));
}
