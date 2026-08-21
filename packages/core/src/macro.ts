import type { PluralProps, SelectOrdinalProps, SelectProps } from "./choice"

type MessageDescriptor = {
  message: string
  context?: string
  comment?: string
}

type MacroValues = Record<string, unknown>
// JSX choice components use `_N` because `=N` is not a valid JSX attribute
// name. The JavaScript macros accept both spellings, though, so preserve the
// documented `=N` exact-branch syntax for object literals.
type PluralOptions = Omit<PluralProps, "value"> & Record<`=${number}`, string>
type SelectOptions<Options extends { other: string }> = Options & Record<keyof Options, string>
type SelectOrdinalOptions = Omit<SelectOrdinalProps, "value"> & Record<`=${number}`, string>

function throwMacroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/core/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function t(strings: TemplateStringsArray, ...values: unknown[]): string
export function t(descriptor: MessageDescriptor, values?: MacroValues): string
export function t(
  ..._args:
    | [strings: TemplateStringsArray, ...values: unknown[]]
    | [descriptor: MessageDescriptor, values?: MacroValues]
): string {
  return throwMacroError()
}

export function plural(value: string | number, options: PluralOptions): string {
  return throwMacroError()
}

export function select<const Options extends { other: string }>(
  value: string | number,
  options: SelectOptions<Options>
): string {
  return throwMacroError()
}

export function selectOrdinal(value: string | number, options: SelectOrdinalOptions): string {
  return throwMacroError()
}
