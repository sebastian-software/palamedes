import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import PO from "pofile";

import { createMessageInventory, DEFAULT_SEED, PROFILE_DEFINITIONS } from "../../src/corpus.mjs";

export const benchmarkRoot = path.resolve(import.meta.dirname, "..");
export const FRAMEWORKS = ["vue", "svelte", "solid"];
export const FRAMEWORK_PROFILES = {
  smoke: { fileCount: 4, messagesPerFile: 8, changedCount: 3, newCount: 4, removedCount: 3 },
  ...PROFILE_DEFINITIONS,
};
export const TOOL_LABELS = {
  palamedes: "Palamedes",
  lingui: "Lingui",
  i18next: "i18next-cli",
  gettext: "vue3-gettext",
  wuchale: "Wuchale",
  intlayer: "Intlayer",
};

export function frameworkLanes(frameworks = FRAMEWORKS, tools = Object.keys(TOOL_LABELS)) {
  return frameworks.flatMap((framework) =>
    tools
      .filter((tool) => tool !== "gettext" || framework === "vue")
      .filter((tool) => tool !== "wuchale" || framework !== "vue")
      .map((tool) => ({
        id: `${framework}-${tool}`,
        framework,
        tool,
        scope: ["wuchale", "intlayer"].includes(tool) ? "extract-update-compile" : "extract-update",
      })),
  );
}

export function inventoryForProfile(profileName, seed = DEFAULT_SEED) {
  const profile = FRAMEWORK_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown framework profile: ${profileName}`);
  const inventory = createMessageInventory({
    messageCount: profile.messages ?? profile.fileCount * profile.messagesPerFile,
    profile,
    seed,
  });
  const sourceIndices = new Map();
  inventory.sourceMessages.forEach((entry, index) => {
    entry.sourceIndex = index;
    sourceIndices.set(entry.current, index);
    if (entry.previous) sourceIndices.set(entry.previous, index);
  });
  return {
    profile,
    ...inventory,
    baselineEntries: inventory.baselineMessages.map((current, index) => ({
      current,
      sourceIndex: sourceIndices.get(current) ?? inventory.sourceMessages.length + index,
    })),
  };
}

export function normalizeMessage(message) {
  // One named interpolation is shared by this corpus. Each library keeps its
  // own native placeholder syntax on disk; only the correctness check normalizes it.
  return message
    .replaceAll(/%\{\s*name\s*\}/gu, "{name}")
    .replaceAll(/\{\{\s*name\s*\}\}/gu, "{name}")
    .replaceAll("{0}", "{name}");
}

const quote = JSON.stringify;
const html = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function renderFrameworkComponent(
  { framework, tool },
  messages,
  fileIndex,
  targetLines = 0,
) {
  const imports = [];
  if (tool === "palamedes") imports.push('import { t } from "@palamedes/core/macro";');
  if (tool === "gettext")
    imports.push(
      'import { useGettext } from "vue3-gettext";',
      "const { $gettext } = useGettext();",
    );
  if (tool === "i18next") imports.push('import i18next from "i18next";');
  if (tool === "lingui") {
    imports.push(
      framework === "vue"
        ? 'import { i18n } from "@lingui/core";'
        : `import { Trans } from ${quote(framework === "svelte" ? "lingui-for-svelte/macro" : "@lingui/solid/macro")};`,
    );
  }
  // Palamedes' SFC integration transforms macros in script blocks; the
  // template uses normal framework bindings, as in the shipped demos.
  const scriptMacros =
    (tool === "palamedes" && framework !== "solid") || (tool === "i18next" && framework === "vue");
  const scriptMessages = scriptMacros
    ? [
        "const copy = [",
        ...messages.map(({ current }) =>
          tool === "palamedes"
            ? `t({ message: ${quote(current)} }, { name }),`
            : `i18next.t(${quote(current.replaceAll("{name}", "{{name}}"))}, { name }),`,
        ),
        "];",
      ]
    : [];
  const messageNodes = messages.map(({ current }, index) => {
    let expression;
    if (tool === "palamedes")
      expression = scriptMacros ? `copy[${index}]` : `t({ message: ${quote(current)} }, { name })`;
    if (tool === "gettext")
      expression = `$gettext(${quote(current.replaceAll("{name}", "%{name}"))}, { name })`;
    if (tool === "i18next")
      expression = scriptMacros
        ? `copy[${index}]`
        : `i18next.t(${quote(current.replaceAll("{name}", "{{name}}"))}, { name })`;
    if (tool === "lingui" && framework === "vue") {
      expression = `i18n._({ id: ${quote(current)}, message: ${quote(current)}, values: { name } })`;
    }
    if (expression)
      return `<p>${framework === "vue" ? `{{ ${expression} }}` : `{${expression}}`}</p>`;
    const content = html(current).replaceAll(
      "{name}",
      framework === "vue" ? "{{ name }}" : "{name}",
    );
    return tool === "lingui" ? `<p><Trans>${content}</Trans></p>` : `<p>${content}</p>`;
  });
  let lines;
  if (framework === "solid") {
    lines = [
      ...imports,
      `export function Fixture${fileIndex}(props: { name: string }) {`,
      "const name = props.name;",
      "return <section>",
      ...messageNodes,
      "</section>;",
      "}",
    ];
  } else {
    lines = [
      framework === "vue" ? '<script setup lang="ts">' : '<script lang="ts">',
      ...imports,
      framework === "vue"
        ? "const { name } = defineProps<{ name: string }>();"
        : "let { name }: { name: string } = $props();",
      ...scriptMessages,
      "</script>",
      ...(framework === "vue" ? ["<template>"] : []),
      "<section>",
      ...messageNodes,
      "</section>",
      ...(framework === "vue" ? ["</template>"] : []),
    ];
  }
  // Equivalent numeric application logic avoids adding translatable copy to
  // the implicit extractors. All lanes get the same filler and line budget.
  const filler = [];
  let unit = 0;
  while (lines.length + filler.length + 7 <= targetLines) {
    filler.push(
      `interface Row${unit} { id: number; weight: number }`,
      `function compute${unit}(value: number): Row${unit} {`,
      `  const id = (value * ${unit + 1} + ${fileIndex}) % 9973;`,
      "  const weight = Math.round(id / 100);",
      "  return { id, weight };",
      "}",
      "",
    );
    unit++;
  }
  while (lines.length + filler.length < targetLines) filler.push("// Application logic padding.");
  const insertion = framework === "solid" ? imports.length : 1 + imports.length;
  lines.splice(insertion, 0, ...filler);
  return `${lines.join("\n")}\n`;
}

export async function writeFrameworkSources(root, lane, entries, profile) {
  const sourceDir = path.join(root, "src/generated");
  await rm(sourceDir, { recursive: true, force: true });
  await mkdir(sourceDir, { recursive: true });
  const markedCount = profile.markedFiles ?? profile.fileCount;
  const buckets = Array.from({ length: markedCount }, () => []);
  entries.forEach((entry, index) =>
    buckets[(entry.sourceIndex ?? index) % markedCount].push(entry),
  );
  // Keep existing messages in their original components and relative order.
  // New copy is appended, so dictionary-local generated keys are not renamed
  // simply because the harness compacted a message array.
  for (const bucket of buckets)
    bucket.sort((a, b) => Number(a.state === "new") - Number(b.state === "new"));
  const all = [...buckets, ...Array.from({ length: profile.unmarkedFiles ?? 0 }, () => [])];
  const extension = lane.framework === "solid" ? "tsx" : lane.framework;
  let sourceBytes = 0;
  for (let start = 0; start < all.length; start += 64) {
    await Promise.all(
      all.slice(start, start + 64).map(async (messages, offset) => {
        const index = start + offset;
        const code = renderFrameworkComponent(
          lane,
          messages,
          index,
          index < markedCount ? profile.markedFileLines : profile.unmarkedFileLines,
        );
        sourceBytes += Buffer.byteLength(code);
        await writeFile(
          path.join(sourceDir, `Fixture${String(index).padStart(4, "0")}.${extension}`),
          code,
        );
      }),
    );
  }
  return { fileCount: all.length, sourceBytes };
}

export async function prepareFrameworkWorkspace(root, lane) {
  await mkdir(path.join(root, "src/locales"), { recursive: true });
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  // Package links let the real tools resolve their adapters from an isolated
  // fixture. Cache directories remain local, unlike a whole-node_modules link.
  for (const name of await readdir(path.join(benchmarkRoot, "node_modules"))) {
    if (name.startsWith(".")) continue;
    await symlink(
      path.join(benchmarkRoot, "node_modules", name),
      path.join(root, "node_modules", name),
      "dir",
    );
  }
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: lane.id,
        private: true,
        type: "module",
        dependencies: {
          [lane.framework === "solid" ? "solid-js" : lane.framework]: "*",
          [`${lane.framework}-intlayer`]: "9.7.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, "palamedes.yaml"),
    "locales: [en, de]\nsource-locale: en\nsource-reference-root: config\ncatalogs:\n  - path: src/locales/{locale}\n    include: [src/generated]\n",
  );
  let linguiImports = 'import { formatter } from "@lingui/format-po";\n';
  let linguiOptions = "";
  if (lane.framework === "vue") {
    linguiImports += 'import { createVueExtractor } from "@lingui/extractor-vue";\n';
    linguiOptions = "extractors: [createVueExtractor()],";
  } else if (lane.framework === "svelte") {
    linguiImports +=
      'import { svelteExtractor } from "lingui-for-svelte/extractor";\nimport { defineConfig } from "lingui-for-svelte/config";\n';
    linguiOptions = "extractors: [svelteExtractor],";
  } else {
    linguiImports += 'import { defineConfig } from "@lingui/solid/config";\n';
  }
  const wrap = lane.framework === "vue" ? ["", ""] : ["defineConfig(", ")"];
  await writeFile(
    path.join(root, "lingui.config.mjs"),
    `${linguiImports}\nexport default ${wrap[0]}{ locales: ['en', 'de'], sourceLocale: 'en', format: formatter({origins: false, lineNumbers: false}), catalogs: [{path: 'src/locales/{locale}', include: ['src/generated']}], ${linguiOptions} }${wrap[1]};\n`,
  );
  let i18nextImports = "";
  let plugins = "";
  if (lane.framework === "vue") {
    i18nextImports = 'import adapter from "i18next-cli-vue";\n';
    plugins = "plugins: [adapter({functions: ['i18next.t']})],";
  } else if (lane.framework === "svelte") {
    i18nextImports = 'import Adapter from "i18next-cli-plugin-svelte";\n';
    plugins = "plugins: [new Adapter()],";
  }
  await writeFile(
    path.join(root, "i18next.config.mjs"),
    `${i18nextImports}export default {locales: ['en','de'], ${plugins} extract: { input: ['src/generated/**/*.${lane.framework === "solid" ? "tsx" : lane.framework}'], output: 'src/locales/{{language}}/translation.json', primaryLanguage: 'en', defaultNS: 'translation', keySeparator: false, nsSeparator: false, sort: true, removeUnusedKeys: true}};\n`,
  );
  await writeFile(
    path.join(root, "gettext.config.js"),
    "export default {input: {path: './src/generated', include: ['**/*.vue']}, output: {path: './src/locales', locales: ['en','de'], fuzzyMatching: false}};\n",
  );
  if (lane.framework !== "vue") {
    await writeFile(
      path.join(root, "wuchale.config.mjs"),
      `import { defineConfig } from 'wuchale';\nimport { adapter } from '@wuchale/${lane.framework === "svelte" ? "svelte" : "jsx"}';\nexport default defineConfig({ locales: ['en','de'], localesDir: 'src/locales', adapters: {main: adapter({files: ['src/generated/**/*.${lane.framework === "solid" ? "tsx" : "svelte"}'], ${lane.framework === "solid" ? "loader: 'solidjs', variant: 'solidjs'," : ""}})} });\n`,
    );
  }
  await writeFile(
    path.join(root, "intlayer.config.mjs"),
    `export default {internationalization: {locales: ['en','de'], defaultLocale: 'en'}, content: {contentDir: ['src/locales'], formatCommand: ${quote(process.platform === "win32" ? "ver > nul" : "true")}}, compiler: {enabled: true, output: ({fileName}) => \`../locales/\${fileName}.content.json\`, saveComponents: false}, log: {mode: 'disabled'}};\n`,
  );
}

export async function filesUnder(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function intlayerTranslations(node) {
  if (typeof node === "string") return { en: node };
  if (node?.nodeType === "insertion") return intlayerTranslations(node.insertion);
  return node?.translation;
}

export async function readFrameworkCatalogs(root, lane) {
  const results = { en: [], de: [] };
  const files = await filesUnder(path.join(root, "src/locales"));
  if (lane.tool === "i18next") {
    for (const locale of ["en", "de"]) {
      const catalog = JSON.parse(
        await readFile(path.join(root, "src/locales", locale, "translation.json"), "utf8"),
      );
      results[locale] = Object.entries(catalog).map(([id, translation]) => ({
        source: normalizeMessage(id),
        translation: normalizeMessage(translation),
        id,
      }));
    }
  } else if (lane.tool === "intlayer") {
    for (const file of files.filter((file) => file.endsWith(".content.json"))) {
      const dictionary = JSON.parse(await readFile(file, "utf8"));
      for (const [key, node] of Object.entries(dictionary.content ?? {})) {
        const translations = intlayerTranslations(node);
        if (!translations || typeof translations.en !== "string")
          throw new Error(`Unexpected Intlayer node at ${file}/${key}: ${JSON.stringify(node)}`);
        for (const locale of ["en", "de"])
          results[locale].push({
            source: normalizeMessage(translations.en),
            translation: normalizeMessage(translations[locale] ?? ""),
            id: `${dictionary.key}/${key}`,
          });
      }
    }
  } else {
    for (const file of files.filter((file) => file.endsWith(".po"))) {
      // pofile attaches an obsolete entry's extracted comments to the previous
      // translation. Obsolete history is outside the active inventory check.
      const catalog = PO.parse(
        (await readFile(file, "utf8"))
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("#~"))
          .join("\n"),
      );
      const locale = catalog.headers.Language;
      if (!(locale in results)) throw new Error(`Unknown PO locale ${locale} in ${file}`);
      results[locale].push(
        ...catalog.items
          .filter((item) => !item.obsolete)
          .map((item) => ({
            source: normalizeMessage(item.msgid),
            translation: normalizeMessage(item.msgstr[0] ?? ""),
            id: item.msgid,
          })),
      );
    }
  }
  return results;
}

export async function seedFrameworkTranslations(root, lane) {
  const files = await filesUnder(path.join(root, "src/locales"));
  if (lane.tool === "i18next") {
    const file = path.join(root, "src/locales/de/translation.json");
    const catalog = JSON.parse(await readFile(file, "utf8"));
    for (const key of Object.keys(catalog)) catalog[key] = `[de] ${key}`;
    await writeFile(file, JSON.stringify(catalog, null, 2));
  } else if (lane.tool === "intlayer") {
    for (const file of files.filter((file) => file.endsWith(".content.json"))) {
      const dictionary = JSON.parse(await readFile(file, "utf8"));
      for (const [key, original] of Object.entries(dictionary.content)) {
        const node =
          typeof original === "string"
            ? { nodeType: "translation", translation: { en: original } }
            : original;
        const translations = intlayerTranslations(node);
        if (!translations?.en) throw new Error(`Unexpected Intlayer node in ${file}`);
        translations.de = `[de] ${translations.en}`;
        dictionary.content[key] = node;
      }
      await writeFile(file, JSON.stringify(dictionary, null, 2));
    }
  } else {
    for (const file of files.filter((file) => file.endsWith(".po"))) {
      const catalog = PO.parse(await readFile(file, "utf8"));
      for (const item of catalog.items)
        item.msgstr = [catalog.headers.Language === "de" ? `[de] ${item.msgid}` : item.msgid];
      await writeFile(file, catalog.toString());
    }
  }
  await cp(path.join(root, "src/locales"), path.join(root, ".baseline-locales"), {
    recursive: true,
  });
}

export async function resetFrameworkWorkspace(root) {
  await rm(path.join(root, "src/locales"), { recursive: true, force: true });
  await cp(path.join(root, ".baseline-locales"), path.join(root, "src/locales"), {
    recursive: true,
  });
  // Wuchale keeps caches and compiled artifacts beside its PO files. Loader
  // source files are setup, not cache, and remain in the baseline snapshot.
  for (const state of [
    ".palamedes",
    ".lingui",
    ".intlayer",
    "node_modules/.cache",
    "src/locales/.wuchale",
  ]) {
    await rm(path.join(root, state), { recursive: true, force: true });
  }
}

export function validateFrameworkCatalogs(catalogs, inventory, label) {
  const expected = inventory.sourceMessages.map((entry) => entry.current).sort();
  const expectedSet = new Set(expected);
  const unchanged = inventory.sourceMessages.filter((entry) => entry.state === "unchanged");
  const observed = {};
  const problems = [];
  for (const locale of ["en", "de"]) {
    const actual = catalogs[locale].map((entry) => entry.source).sort();
    const actualSet = new Set(actual);
    const missing = expected.filter((message) => !actualSet.has(message));
    const unexpected = actual.filter((message) => !expectedSet.has(message));
    const duplicates = actual.length - actualSet.size;
    observed[locale] = {
      total: actual.length,
      missingCount: missing.length,
      unexpectedCount: unexpected.length,
      duplicateCount: duplicates,
      missing: missing.slice(0, 3),
      unexpected: unexpected.slice(0, 3),
    };
    if (missing.length || unexpected.length || duplicates)
      problems.push(
        `${locale}: ${actual.length} messages, expected ${expected.length}; ${missing.length} missing, ${unexpected.length} unexpected, ${duplicates} duplicates`,
      );
  }
  const german = new Map(catalogs.de.map((entry) => [entry.source, entry.translation]));
  const lostTranslations = unchanged.filter(
    (entry) => german.get(entry.current) !== `[de] ${entry.current}`,
  );
  if (lostTranslations.length)
    problems.push(
      `${lostTranslations.length} existing translations lost, including ${JSON.stringify(lostTranslations[0].current)}`,
    );
  let retainedChangedTranslations = 0;
  for (const entry of inventory.sourceMessages.filter((entry) => entry.state === "changed")) {
    if (german.get(entry.current) === `[de] ${entry.previous}`) retainedChangedTranslations++;
  }
  const receipt = {
    activeMessagesPerLocale: expected.length,
    observed,
    expectedPreservedTranslations: unchanged.length,
    preservedTranslations: unchanged.length - lostTranslations.length,
    lostTranslations: lostTranslations
      .slice(0, 3)
      .map((entry) => ({ source: entry.current, translation: german.get(entry.current) ?? null })),
    retainedChangedTranslations,
  };
  if (problems.length) {
    const error = new Error(`${label}: ${problems.join("; ")}`);
    error.validation = receipt;
    throw error;
  }
  return receipt;
}
