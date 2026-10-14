import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { transformPalamedesMacros } from "@palamedes/transform";
import { afterEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const loader = require("../palamedes-fragment-loader.cjs") as (this: object) => void;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "palamedes-next-fragment-")));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "locales"));
  const configPath = path.join(root, "palamedes.yaml");
  await writeFile(
    configPath,
    "locales: [en, de]\nsource-locale: en\nfallback-locales: [en]\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n",
  );
  const header = (locale: string) =>
    `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Language: ${locale}\\n"\n\n`;
  const sourceMessages =
    'msgid "Greeting"\nmsgstr "Greeting"\n\nmsgid "Fallback label"\nmsgstr "Source fallback"\n\nmsgid "Unused label"\nmsgstr "Unused label"\n';
  await writeFile(path.join(root, "locales/en.po"), header("en") + sourceMessages);
  await writeFile(
    path.join(root, "locales/de.po"),
    `${header(
      "de",
    )}msgid "Greeting"\nmsgstr "German greeting"\n\nmsgid "Fallback label"\nmsgstr ""\n\nmsgid "Unused label"\nmsgstr "Unused German label"\n`,
  );
  const transformed = transformPalamedesMacros(
    'import { t } from "@palamedes/core/macro"; export function labels() { return [t`Greeting`, t`Fallback label`]; }',
    path.join(root, "src/client.ts"),
  );
  return { root, configPath, compiledIds: transformed.compiledIds, header, sourceMessages };
}

function compile(root: string, query: string) {
  const dependencies: string[] = [];
  const resourcePath = require.resolve("@palamedes/next-plugin/catalog-fragment");
  const context = {
    resourcePath,
    resourceQuery: query,
    getOptions: () => ({ cwd: root, failOnCompileError: true }),
    addDependency: (dependency: string) => dependencies.push(dependency),
    emitWarning() {},
  };
  return new Promise<{ code: string; dependencies: string[] }>((resolve, reject) => {
    Object.defineProperty(context, "async", {
      value: () => (error: unknown, code: string) => {
        expect(context.resourcePath).toBe(resourcePath);
        if (error) reject(error);
        else resolve({ code, dependencies });
      },
    });
    loader.call(context);
  });
}

it("delivers selected translations and source fallbacks, and invalidates edited dependencies", async () => {
  const { root, configPath, compiledIds, header, sourceMessages } = await fixture();
  expect(compiledIds).toHaveLength(2);
  const parameters = new URLSearchParams({
    "palamedes-catalog": "locales/de.po",
    "palamedes-selected": Buffer.from(JSON.stringify(compiledIds)).toString("base64url"),
  });
  const first = await compile(root, `?${parameters}`);
  expect(first.code).toContain("German greeting");
  expect(first.code).toContain("Source fallback");
  expect(first.code).not.toContain("Unused German label");
  expect(first.dependencies).toEqual(
    expect.arrayContaining([
      configPath,
      path.join(root, "locales/en.po"),
      path.join(root, "locales/de.po"),
    ]),
  );

  await writeFile(
    path.join(root, "locales/en.po"),
    header("en") + sourceMessages.replace("Source fallback", "Edited fallback"),
  );
  const changed = await compile(root, `?${parameters}`);
  expect(changed.code).toContain("Edited fallback");
  expect(changed.code).not.toContain("Source fallback");
});

it("rejects a missing selection and resources outside the configured catalog set", async () => {
  const { root, compiledIds } = await fixture();
  await expect(compile(root, "?palamedes-catalog=locales/de.po")).rejects.toThrow(
    "Invalid Palamedes catalog fragment query",
  );
  const parameters = new URLSearchParams({
    "palamedes-catalog": "../unconfigured.po",
    "palamedes-selected": Buffer.from(JSON.stringify(compiledIds)).toString("base64url"),
  });
  await expect(compile(root, `?${parameters}`)).rejects.toThrow("configured catalog");
});
