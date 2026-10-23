import assert from "node:assert/strict";

const FRAMEWORK_VERSION_KEYS = {
  palamedes: "palamedes",
  lingui: "@lingui/cli",
  i18next: "i18next-cli",
  gettext: "vue3-gettext",
  wuchale: "wuchale",
  intlayer: "intlayer-cli",
};

export function benchmarkToolVersion(versions, tool, framework = "react") {
  const recorded =
    framework === "react" ? versions[tool]?.cli : versions[FRAMEWORK_VERSION_KEYS[tool]];
  const match = recorded?.match(
    /^(?:pmds \(Palamedes\) v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\n|$)/u,
  );
  assert.ok(match, `Missing measured tool version for ${framework}/${tool}`);
  return match[1];
}

export function reactBenchmarkVersions(report) {
  const labels = {
    palamedes: "Palamedes",
    lingui: "Lingui",
    formatjs: "React Intl",
    fbtee: "fbtee",
    i18nextCli: "i18next-cli",
    gt: "General Translation",
  };
  return Object.fromEntries(
    Object.entries(labels).map(([tool, label]) => [
      label,
      benchmarkToolVersion(report.versions, tool),
    ]),
  );
}
