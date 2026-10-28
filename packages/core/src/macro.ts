import type { PluralProps, SelectOrdinalProps, SelectProps } from "./choice";

export type {
  ChoiceMacroMetadata,
  PluralMacroProps,
  PluralProps,
  SelectMacroProps,
  SelectOrdinalMacroProps,
  SelectOrdinalProps,
  SelectProps,
} from "./choice";

type MessageDescriptor = {
  message: string;
  context?: string;
  comment?: string;
};

type MacroValues = Record<string, unknown>;
// JSX choice components use `_N` because `=N` is not a valid JSX attribute
// name. The JavaScript macros accept both spellings, though, so preserve the
// documented `=N` exact-branch syntax for object literals.
type PluralOptions = Omit<PluralProps, "value"> & Record<`=${number}`, string>;
type SelectOptions<Options extends { other: string } & Omit<SelectProps, "value">> = Options &
  Record<keyof Options, string>;
type SelectOrdinalOptions = Omit<SelectOrdinalProps, "value"> & Record<`=${number}`, string>;

function throwMacroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/core/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs.",
  );
}

/**
 * Opt-in runtime execution for unbundled Node code (ADR-006).
 *
 * `registerRuntimeMacros()` from `@palamedes/runtime/node-macros` publishes an
 * implementation under this global symbol, so the ESM and CJS builds of this
 * module see the same registration. Without it, every macro keeps throwing.
 */
type RuntimeMacros = {
  t(...args: unknown[]): string;
  plural(value: unknown, options: object): string;
  select(value: unknown, options: object): string;
  selectOrdinal(value: unknown, options: object): string;
};

const RUNTIME_MACROS_KEY = Symbol.for("palamedes.runtimeMacros");

function runtimeMacros(): RuntimeMacros {
  const runtime = (globalThis as Record<symbol, RuntimeMacros | undefined>)[RUNTIME_MACROS_KEY];
  return runtime ?? throwMacroError();
}

export function t(strings: TemplateStringsArray, ...values: unknown[]): string;
export function t(descriptor: MessageDescriptor, values?: MacroValues): string;
export function t(
  ...args:
    | [strings: TemplateStringsArray, ...values: unknown[]]
    | [descriptor: MessageDescriptor, values?: MacroValues]
): string {
  return runtimeMacros().t(...args);
}

export function plural(value: string | number, options: PluralOptions): string {
  return runtimeMacros().plural(value, options);
}

export function select<const Options extends { other: string } & Omit<SelectProps, "value">>(
  value: string | number,
  options: SelectOptions<Options>,
): string {
  return runtimeMacros().select(value, options);
}

export function selectOrdinal(value: string | number, options: SelectOrdinalOptions): string {
  return runtimeMacros().selectOrdinal(value, options);
}
