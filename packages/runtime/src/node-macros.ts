import { readFileSync } from "node:fs";

import type { MessageValues } from "@palamedes/core";

import { getI18n } from "./index";

/**
 * Lookup data written by `pmds extract --runtime-manifest`. The manifest
 * carries compiled keys, so the runtime never hashes or parses (ADR-006).
 */
export type RuntimeMacroManifest = {
  version: 1;
  templates: { strings: (string | null)[]; key: string; values: string[] }[];
  descriptors: { message: string; context?: string; key: string }[];
  choices: {
    kind: "plural" | "select" | "selectOrdinal";
    options: Record<string, string>;
    value: string;
    key: string;
  }[];
};

type TemplateEntry = RuntimeMacroManifest["templates"][number];
type ChoiceKind = RuntimeMacroManifest["choices"][number]["kind"];

const RUNTIME_MACROS_KEY = Symbol.for("palamedes.runtimeMacros");

function choiceSignature(kind: string, options: object): string {
  const entries = Object.entries(options)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => [name, String(value)]);
  return JSON.stringify([kind, entries]);
}

function missingEntry(macro: string, shape: string): never {
  throw new Error(
    `The runtime macro manifest has no entry for ${macro} ${shape}. Run pmds extract --runtime-manifest after changing translated source code.`,
  );
}

/**
 * Executes `t`, `plural`, `select`, and `selectOrdinal` from
 * `@palamedes/core/macro` at runtime through the active i18n instance.
 *
 * Call this once per process, before translated code runs; a second call
 * throws instead of replacing the manifest other modules rely on. It is meant
 * for Node code that runs without a bundler (native type stripping, plain
 * `tsc` output, scripts, and tests). Bundled code compiles macros away and
 * must not register runtime macros.
 */
export function registerRuntimeMacros(manifest: RuntimeMacroManifest | URL | string): void {
  if ((globalThis as Record<symbol, unknown>)[RUNTIME_MACROS_KEY] !== undefined) {
    throw new Error(
      "Runtime macros are already registered in this process. Call registerRuntimeMacros() once, with the manifest that covers all translated code.",
    );
  }
  const data: RuntimeMacroManifest =
    typeof manifest === "string" || manifest instanceof URL
      ? JSON.parse(readFileSync(manifest, "utf8"))
      : manifest;
  if (data.version !== 1) {
    throw new Error(`Unsupported runtime macro manifest version: ${String(data.version)}.`);
  }

  const templatesByText = new Map(
    data.templates.map((entry) => [JSON.stringify(entry.strings), entry]),
  );
  const templates = new WeakMap<TemplateStringsArray, TemplateEntry>();
  const descriptors = new Map(
    data.descriptors.map((entry) => [
      JSON.stringify([entry.message, entry.context ?? null]),
      entry,
    ]),
  );
  const choices = new Map(
    data.choices.map((entry) => [choiceSignature(entry.kind, entry.options), entry]),
  );

  function template(strings: TemplateStringsArray, values: unknown[]): string {
    let entry = templates.get(strings);
    if (!entry) {
      entry =
        templatesByText.get(JSON.stringify(strings)) ?? missingEntry("t", JSON.stringify(strings));
      templates.set(strings, entry);
    }
    if (entry.values.length === 0) return getI18n()._(entry.key);
    const named: Record<string, unknown> = {};
    entry.values.forEach((name, index) => {
      named[name] = values[index];
    });
    return getI18n()._(entry.key, named);
  }

  function choice(kind: ChoiceKind, value: unknown, options: object): string {
    const signature = choiceSignature(kind, options);
    const entry = choices.get(signature) ?? missingEntry(kind, signature);
    return getI18n()._(entry.key, { [entry.value]: value });
  }

  (globalThis as Record<symbol, unknown>)[RUNTIME_MACROS_KEY] = {
    t(first: unknown, ...rest: unknown[]): string {
      if (Array.isArray(first) && "raw" in first) {
        return template(first as unknown as TemplateStringsArray, rest);
      }
      const descriptor = first as { message: string; context?: string };
      const signature = JSON.stringify([descriptor.message, descriptor.context ?? null]);
      const entry = descriptors.get(signature) ?? missingEntry("t", signature);
      return getI18n()._(entry.key, rest[0] as MessageValues | undefined);
    },
    plural: (value: unknown, options: object) => choice("plural", value, options),
    select: (value: unknown, options: object) => choice("select", value, options),
    selectOrdinal: (value: unknown, options: object) => choice("selectOrdinal", value, options),
  };
}
