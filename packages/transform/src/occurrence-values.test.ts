import { compileFunction } from "node:vm";
import { createI18n, defineCompiledCatalog } from "@palamedes/core";
import { t } from "@palamedes/core/macro";
import { extractMessagesNative, renderCatalogModule } from "@palamedes/core-node";
import { resetI18nRuntime, setServerI18nGetter } from "@palamedes/runtime";
import { registerRuntimeMacros } from "@palamedes/runtime/node-macros";
import { afterEach, describe, expect, it } from "vitest";
import { transformPalamedesMacros } from "./transform";

function compiledRuntime(key: string, message: string) {
  const code = renderCatalogModule({ [key]: message })
    .replace(
      'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";',
      "",
    )
    .replace("export const messages=", "const messages=")
    .replace("export default { messages };", "return messages;");
  const catalog = compileFunction(code, ["__palamedesDefineCompiledCatalog"])(
    defineCompiledCatalog,
  );
  const i18n = createI18n({ locale: "en" });
  i18n.load("en", catalog);
  return i18n;
}

const setup = `
  let value = 1;
  const reads = [];
  function next() { reads.push(value); return value++; }
  const counter = { get value() { return next(); } };
  const name = "Ada";
`;

const templates = [
  {
    body: "t`Values: ${next()} and ${next()}`",
    message: "Values: {next} and {next_1}",
    strings: ["Values: ", " and ", ""],
    values: ["next", "next_1"],
    text: "Values: 1 and 2",
    reads: [1, 2],
  },
  {
    body: "t`Values: ${counter.value} and ${counter.value}`",
    message: "Values: {value} and {value_1}",
    strings: ["Values: ", " and ", ""],
    values: ["value", "value_1"],
    text: "Values: 1 and 2",
    reads: [1, 2],
  },
  {
    body: "t`Values: ${value}, ${next()}, ${value}`",
    message: "Values: {value}, {next}, {value_1}",
    strings: ["Values: ", ", ", ", ", ""],
    values: ["value", "next", "value_1"],
    text: "Values: 1, 1, 2",
    reads: [1],
  },
  {
    body: "t`Values: ${value}, ${counter.value}, ${value}`",
    message: "Values: {value}, {value_1}, {value_2}",
    strings: ["Values: ", ", ", ", ", ""],
    values: ["value", "value_1", "value_2"],
    text: "Values: 1, 1, 2",
    reads: [1],
  },
  {
    body: "t`Values: ${counter.value ?? 0} and ${counter.value ?? 0}`",
    message: "Values: {value} and {value_1}",
    strings: ["Values: ", " and ", ""],
    values: ["value", "value_1"],
    text: "Values: 1 and 2",
    reads: [1, 2],
  },
  {
    body: "t`Values: ${name} and ${name}`",
    message: "Values: {name} and {name}",
    strings: ["Values: ", " and ", ""],
    values: ["name", "name"],
    text: "Values: Ada and Ada",
    reads: [],
  },
];

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("palamedes.runtimeMacros")];
  resetI18nRuntime();
});

describe("macro expression evaluation", () => {
  it.each(templates)("preserves native and Node runtime values for $body", (fixture) => {
    const source = `import { t } from "@palamedes/core/macro";
      function run() { ${setup} const text = ${fixture.body}; return { text, reads }; }`;
    const extracted = extractMessagesNative(source, "occurrences.js");
    const transformed = transformPalamedesMacros(source, "occurrences.js");
    const key = transformed.compiledIds[0]!;
    const i18n = compiledRuntime(key, extracted[0]!.message);
    const code = transformed.code.replace(/^\s*import .*;$/gm, "");
    const bundled = compileFunction(`${code}\nreturn run();`, ["getI18n"])(() => i18n);
    expect(bundled).toEqual({ text: fixture.text, reads: fixture.reads });
    expect(extracted.map((entry) => entry.message)).toEqual([fixture.message]);

    // Rust's manifest tests verify these per-occurrence slots against extraction
    // and transformation. Exercise the real Node mapper and compiled renderer.
    registerRuntimeMacros({
      version: 1,
      templates: [{ strings: fixture.strings, values: fixture.values, key }],
      descriptors: [],
      choices: [],
    });
    setServerI18nGetter(() => i18n);
    const unbundled = compileFunction(
      `${setup} const text = ${fixture.body}; return { text, reads };`,
      ["t"],
    )(t);
    expect(unbundled).toEqual(bundled);
  });

  it.each([
    [
      "t({ message: `Values: ${next()} and ${next()}` })",
      "Values: {next} and {next_1}",
      "Values: 1 and 2",
      [1, 2],
    ],
    [
      "plural(next(), { one: `First ${counter.value ?? 0}`, other: `Later ${next()}` })",
      "{next, plural, one {First {value}} other {Later {next_1}}}",
      "First 2",
      [1, 2, 3],
    ],
  ])("preserves evaluation order in %s", (body, message, text, reads) => {
    const source = `import { t, plural } from "@palamedes/core/macro";
      function run() { ${setup} const text = ${body}; return { text, reads }; }`;
    expect(extractMessagesNative(source, "choices.js")[0]!.message).toBe(message);
    const transformed = transformPalamedesMacros(source, "choices.js");
    const i18n = compiledRuntime(transformed.compiledIds[0]!, message);
    const code = transformed.code.replace(/^\s*import .*;$/gm, "");
    expect(compileFunction(`${code}\nreturn run();`, ["getI18n"])(() => i18n)).toEqual({
      text,
      reads,
    });
  });

  it.each([
    [
      "<Trans>Values: {counter.value ?? 0} and {counter.value ?? 0}</Trans>",
      'render(Trans, { children: ["Values: ", counter.value ?? 0, " and ", counter.value ?? 0] })',
      "Values: {value} and {value_1}",
      "Values: 1 and 2",
      [1, 2],
    ],
    [
      "<Plural value={next()} one={`First ${counter.value ?? 0}`} other={`Later ${next()}`} />",
      "render(Plural, { value: next(), one: `First ${counter.value ?? 0}`, other: `Later ${next()}` })",
      "{next, plural, one {First {value}} other {Later {next_1}}}",
      "First 2",
      [1, 2, 3],
    ],
  ])(
    "keeps authored JSX and lowered JSX consistent for %s",
    (authored, lowered, message, text, reads) => {
      const imports = 'import { Trans, Plural } from "@palamedes/react/macro";';
      const source = `${imports} function run() { ${setup} return ${authored}; }`;
      expect(extractMessagesNative(source, "view.tsx")[0]!.message).toBe(message);
      const authoredResult = transformPalamedesMacros(source, "view.tsx");
      const loweredSource = `${imports}
      import { jsx as render } from "remix/component/jsx-runtime";
      function run() { ${setup} const text = ${lowered}; return { text, reads }; }`;
      const transformed = transformPalamedesMacros(loweredSource, "view.js");
      expect(transformed.compiledIds).toEqual(authoredResult.compiledIds);
      const i18n = compiledRuntime(transformed.compiledIds[0]!, message);
      const code = transformed.code.replace(/^\s*import .*;$/gm, "");
      const render = (
        _component: unknown,
        props: { id: string; values: Record<string, unknown> },
      ) => i18n._(props.id, props.values);
      expect(
        compileFunction(`${code}\nreturn run();`, ["render", "Trans", "getI18n"])(
          render,
          null,
          () => i18n,
        ),
      ).toEqual({
        text,
        reads,
      });
    },
  );
});
