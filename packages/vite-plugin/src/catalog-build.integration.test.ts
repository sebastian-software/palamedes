import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

import { palamedes } from "./index";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

// Real `vite build` with the real native catalog compiler: nothing is mocked,
// so this proves a broken catalog reaches the host build as a failure.
describe("Palamedes catalog errors in a real Vite build", () => {
  it("builds a project whose catalogs are valid", async () => {
    const root = await createFixture("Hallo {name}");

    await expect(runBuild(root)).resolves.toBeDefined();
  });

  it("fails the build with the catalog error when a .po catalog has invalid ICU syntax", async () => {
    const root = await createFixture("Hallo {name");

    await expect(runBuild(root)).rejects.toThrow(
      /Failed to compile catalog for locale de at .*de\.po.*Final runtime message failed ICU validation.*Code: compile\.invalid_icu_message.*Source: Hello \{name\}/su,
    );
  });
});

function runBuild(root: string) {
  return build({
    configFile: false,
    envFile: false,
    logLevel: "silent",
    root,
    plugins: [palamedes({ configPath: path.join(root, "palamedes.yaml"), mdx: false })],
    build: {
      write: false,
      rollupOptions: {
        external: [/^@palamedes\//u],
        input: path.join(root, "entry.js"),
      },
    },
  });
}

async function createFixture(germanTranslation: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "palamedes-vite-catalog-")));
  fixtureDirectories.push(root);
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "palamedes.yaml"),
    "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [entry.js]\n",
  );
  await writeFile(
    path.join(root, "entry.js"),
    'import { messages } from "./locales/de.po";\nexport default messages;\n',
  );
  await mkdir(path.join(root, "locales"));
  for (const [locale, translation] of [
    ["en", "Hello {name}"],
    ["de", germanTranslation],
  ]) {
    await writeFile(
      path.join(root, `locales/${locale}.po`),
      `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\nmsgid "Hello {name}"\nmsgstr ${JSON.stringify(translation)}\n`,
    );
  }
  return root;
}
