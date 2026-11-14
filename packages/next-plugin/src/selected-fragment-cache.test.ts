import { loadPalamedesConfig } from "@palamedes/config";
import { compileCatalogArtifactSelectedAsync } from "@palamedes/core-node";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const sourceLoader = require("../palamedes-loader.cjs");
const catalogLoader = require("../palamedes-po-loader.cjs");
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("selected fragments retained by the bundler cache", () => {
  it("replays a removed message's fragment without weakening current selections", async () => {
    const fixture = await createFixture(["Keep", "Before"]);
    const oldQuery = await fragmentQuery(fixture);
    expect(await compileFragment(fixture, oldQuery)).toContain('"Before"');

    await writeMessages(fixture, ["Keep", "After"]);
    const currentQuery = await fragmentQuery(fixture);
    expect(currentQuery).not.toBe(oldQuery);

    // Persistent Turbopack caches can replay this task even though the current
    // module now imports currentQuery. Exercise real loaders and native APIs.
    const stale = await compileFragment(fixture, oldQuery);
    expect(stale).toContain('"Keep"');
    expect(stale).not.toContain('"Before"');
    expect(await compileFragment(fixture, currentQuery)).toContain('"After"');

    const parameters = new URLSearchParams(oldQuery);
    const oldIds = JSON.parse(
      Buffer.from(parameters.get("palamedes-selected")!, "base64url").toString(),
    );
    const config = await loadPalamedesConfig({ projectRoot: fixture });
    await expect(
      compileCatalogArtifactSelectedAsync(config, path.join(fixture, "locales/en.po"), oldIds),
    ).rejects.toThrow("unknown compiled ID");
    parameters.delete("palamedes-source");
    await expect(compileFragment(fixture, `?${parameters}`)).rejects.toThrow("unknown compiled ID");

    // A current source still selecting an absent catalog message must fail.
    await writeCatalog(fixture, ["Keep"]);
    await expect(compileFragment(fixture, currentQuery)).rejects.toThrow("unknown compiled ID");
  });

  it("replays a deleted module's fragment as an empty compiled catalog", async () => {
    const fixture = await createFixture(["Before"]);
    const oldQuery = await fragmentQuery(fixture);
    await rm(path.join(fixture, "src/messages.ts"));
    await writeCatalog(fixture, ["After"]);

    const code = await compileFragment(fixture, oldQuery);
    expect(code).not.toContain('"Before"');
    expect(code).not.toContain('"After"');
  });

  it("keeps malformed catalogs fatal when an obsolete task is replayed", async () => {
    const fixture = await createFixture(["Before"]);
    const oldQuery = await fragmentQuery(fixture);
    await writeMessages(fixture, ["After"]);
    await writeFile(path.join(fixture, "locales/en.po"), "not a PO catalog");

    await expect(compileFragment(fixture, oldQuery)).rejects.toThrow("unrecognized PO syntax");
  });

  it("does not let one obsolete importer hide another importer's missing message", async () => {
    const fixture = await createFixture(["Hello"]);
    const secondSource = path.join(fixture, "src/second.ts");
    await writeFile(secondSource, await readFile(path.join(fixture, "src/messages.ts"), "utf8"));
    const firstQuery = await fragmentQuery(fixture);
    const secondQuery = await fragmentQuery(fixture, "second.ts");
    // Equal selections now have one fragment identity per importing source.
    // This retains enough origin information to prove a task is obsolete.
    expect(firstQuery).not.toBe(secondQuery);

    await writeMessages(fixture, ["After"]);
    expect(await compileFragment(fixture, firstQuery)).not.toContain('"Hello"');
    await expect(compileFragment(fixture, secondQuery)).rejects.toThrow("unknown compiled ID");
  });

  it("keeps failOnMissing enforced for the current fragment", async () => {
    const fixture = await createFixture(["Hello"]);
    await writeFile(
      path.join(fixture, "palamedes.yaml"),
      "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n",
    );
    await writeFile(
      path.join(fixture, "locales/de.po"),
      'msgid ""\nmsgstr ""\n"Language: de\\n"\n',
    );
    const parameters = new URLSearchParams(await fragmentQuery(fixture));
    parameters.set("palamedes-catalog", "locales/de.po");

    await expect(compileFragment(fixture, `?${parameters}`, true)).rejects.toThrow(
      "Missing 1 translation(s)",
    );
  });
});

async function createFixture(messages: string[]) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "palamedes-next-fragment-cache-"));
  fixtures.push(fixture);
  await mkdir(path.join(fixture, "src"));
  await mkdir(path.join(fixture, "locales"));
  await writeFile(
    path.join(fixture, "palamedes.yaml"),
    "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n",
  );
  await writeMessages(fixture, messages);
  return fixture;
}

async function writeMessages(fixture: string, messages: string[]) {
  await writeFile(
    path.join(fixture, "src/messages.ts"),
    `import { t } from "@palamedes/core/macro";\nexport const labels = () => [${messages.map((message) => `t\`${message}\``).join(", ")}];`,
  );
  await writeCatalog(fixture, messages);
}

async function writeCatalog(fixture: string, messages: string[]) {
  await writeFile(
    path.join(fixture, "locales/en.po"),
    `msgid ""\nmsgstr ""\n"Language: en\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n\n${messages.map((message) => `msgid ${JSON.stringify(message)}\nmsgstr ""\n`).join("\n")}`,
  );
}

async function fragmentQuery(fixture: string, sourceName = "messages.ts") {
  const resourcePath = path.join(fixture, "src", sourceName);
  const source = await readFile(resourcePath, "utf8");
  const code = sourceLoader.call(
    {
      resourcePath,
      getOptions: () => ({ serverMessageSplitting: true, cwd: fixture }),
      addDependency() {},
    },
    source,
  ) as string;
  const specifier = [...code.matchAll(/import\(("[^"\n]+")\)/gu)]
    .map((match) => JSON.parse(match[1]!) as string)
    .find((value) => value.includes("palamedes-selected="));
  expect(specifier).toBeDefined();
  return `?${specifier!.split("?")[1]}`;
}

async function compileFragment(fixture: string, resourceQuery: string, failOnMissing = false) {
  return new Promise<string>((resolve, reject) => {
    catalogLoader.call({
      resourcePath: require.resolve("../catalog-fragment.cjs"),
      resourceQuery,
      getOptions: () => ({ cwd: fixture, failOnMissing }),
      addDependency() {},
      emitWarning() {},
      async: () => (error: Error | null, code: string) => (error ? reject(error) : resolve(code)),
    });
  });
}
