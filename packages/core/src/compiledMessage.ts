import {
  formatMessageArgument,
  replacePoundPlaceholders,
  requireChoiceNumericValue,
  selectPluralCategory,
  stringifyValue,
} from "./runtimeFormat";

export type MessageValues = Record<string, unknown>;

export type CompiledMessage = <TResult>(
  values: MessageValues,
  runtime: CompiledMessageRuntime<TResult>,
) => TResult;

export type CompiledMessageBranch = <TResult>(
  values: MessageValues,
  runtime: CompiledMessageRuntime<TResult>,
  pluralValue?: number,
) => TResult;

export type CompiledMessageBranches = Record<string, CompiledMessageBranch>;

export type CompiledMessageRuntime<TResult> = {
  join: (...parts: Array<string | TResult>) => TResult;
  value: (values: MessageValues, name: string) => TResult;
  number: (values: MessageValues, name: string, style?: string) => TResult;
  date: (values: MessageValues, name: string, style?: string) => TResult;
  time: (values: MessageValues, name: string, style?: string) => TResult;
  select: (
    values: MessageValues,
    name: string,
    branches: CompiledMessageBranches,
    pluralValue?: number,
  ) => TResult;
  plural: (
    values: MessageValues,
    name: string,
    offset: number,
    kind: "plural" | "selectordinal",
    branches: CompiledMessageBranches,
  ) => TResult;
  pound: (pluralValue: number) => TResult;
  literal: (value: string) => TResult;
  tag: (name: string, children: TResult) => TResult;
};

export type CatalogMessage = string | CompiledMessage;
export type CatalogMessages = Record<string, string>;

declare const COMPILED_CATALOG_TYPE: unique symbol;

type CompiledCatalogBrand = {
  readonly [COMPILED_CATALOG_TYPE]: true;
};

export type CompiledCatalogMessages = Record<string, CatalogMessage> & CompiledCatalogBrand;
export type LoadableCatalogMessages = CatalogMessages | CompiledCatalogMessages;

const COMPILED_CATALOG_SYMBOL = Symbol.for("@palamedes/core/compiled-catalog");
const COMPILED_CATALOG_REGISTRY_SYMBOL = Symbol.for("@palamedes/core/compiled-catalog-registry/v2");

const globalCatalogState = globalThis as typeof globalThis &
  Record<symbol, WeakSet<object> | undefined>;
const COMPILED_CATALOG_REGISTRY =
  globalCatalogState[COMPILED_CATALOG_REGISTRY_SYMBOL] ?? new WeakSet<object>();
globalCatalogState[COMPILED_CATALOG_REGISTRY_SYMBOL] = COMPILED_CATALOG_REGISTRY;

/** Marks generated strings as constants; function entries are executable messages. */
export function defineCompiledCatalog<TMessages extends Record<string, CatalogMessage>>(
  messages: TMessages,
): TMessages & CompiledCatalogBrand {
  const snapshot: Record<string, CatalogMessage> = Object.create(null);
  for (const id of Object.keys(messages)) {
    const value = messages[id];
    if (typeof value !== "string" && typeof value !== "function") {
      throw new TypeError(`Invalid compiled catalog entry ${JSON.stringify(id)}.`);
    }
    snapshot[id] = value;
  }
  Object.defineProperty(snapshot, COMPILED_CATALOG_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  Object.freeze(snapshot);
  COMPILED_CATALOG_REGISTRY.add(snapshot);
  return snapshot as TMessages & CompiledCatalogBrand;
}

export function isCompiledCatalog(messages: unknown): messages is CompiledCatalogMessages {
  return (
    typeof messages === "object" &&
    messages !== null &&
    COMPILED_CATALOG_REGISTRY.has(messages) &&
    (messages as LoadableCatalogMessages & Record<symbol, boolean | undefined>)[
      COMPILED_CATALOG_SYMBOL
    ] === true
  );
}

export type ExecutableMessageRenderer<TResult> = {
  join: (...parts: Array<string | TResult>) => TResult;
  value: (value: unknown) => TResult;
  number: (value: unknown, style?: string) => TResult;
  date: (value: unknown, style?: string) => TResult;
  time: (value: unknown, style?: string) => TResult;
  pound: (pluralValue: number) => TResult;
  literal: (value: string) => TResult;
  tag: (name: string, children: TResult) => TResult;
};

/** Adds shared select/plural execution to a host-specific result renderer. */
export function createCompiledMessageRuntime<TResult>(
  locale: string,
  renderer: ExecutableMessageRenderer<TResult>,
): CompiledMessageRuntime<TResult> {
  const runtime: CompiledMessageRuntime<TResult> = {
    ...renderer,
    value(values, name) {
      return renderer.value(requireValue(values, name));
    },
    number(values, name, style) {
      return renderer.number(requireValue(values, name), style);
    },
    date(values, name, style) {
      return renderer.date(requireValue(values, name), style);
    },
    time(values, name, style) {
      return renderer.time(requireValue(values, name), style);
    },
    select(values, name, branches, pluralValue) {
      const value = requireValue(values, name);
      const exact = value == null ? undefined : getBranch(branches, String(value));
      return runBranch(exact ?? getBranch(branches, "other"), values, runtime, pluralValue);
    },
    plural(values, name, offset, kind, branches) {
      const numericValue = requireChoiceNumericValue(name, kind, requireValue(values, name));
      const operand = numericValue - offset;
      const exact = getBranch(branches, `=${numericValue}`);
      if (exact !== undefined) {
        return runBranch(exact, values, runtime, operand);
      }
      const category = selectPluralCategory(operand, locale, kind);
      return runBranch(
        getBranch(branches, category) ?? getBranch(branches, "other"),
        values,
        runtime,
        operand,
      );
    },
  };
  return runtime;
}

export function createStringMessageRuntime(
  locale: string,
  timeZone?: string,
): CompiledMessageRuntime<string> {
  return createCompiledMessageRuntime(locale, {
    join(...parts) {
      return parts.join("");
    },
    value: stringifyValue,
    number(value, style) {
      return formatMessageArgument("number", value, style, locale);
    },
    date(value, style) {
      return formatMessageArgument("date", value, style, locale, timeZone);
    },
    time(value, style) {
      return formatMessageArgument("time", value, style, locale, timeZone);
    },
    pound(value) {
      return replacePoundPlaceholders("#", value, locale);
    },
    literal(value) {
      return value;
    },
    tag(_name, children) {
      return children;
    },
  });
}

function getBranch(
  branches: CompiledMessageBranches,
  key: string,
): CompiledMessageBranch | undefined {
  return Object.hasOwn(branches, key) ? branches[key] : undefined;
}

function runBranch<TResult>(
  branch: CompiledMessageBranch | undefined,
  values: MessageValues,
  runtime: CompiledMessageRuntime<TResult>,
  pluralValue?: number,
): TResult {
  if (branch === undefined) throw new Error("Compiled choice has no matching or other branch.");
  return branch<TResult>(values, runtime, pluralValue);
}

function requireValue(values: MessageValues, name: string): unknown {
  if (!Object.hasOwn(values, name))
    throw new Error(`Missing compiled message value ${JSON.stringify(name)}.`);
  return values[name];
}
