import type { PluralProps, SelectOrdinalProps, SelectProps } from "./choice"

type MessageDescriptor = {
  message: string
  context?: string
  comment?: string
}

type MacroValues = Record<string, unknown>
type PluralOptions = Omit<PluralProps, "value">
type SelectOptions = Omit<SelectProps, "value">
type SelectOrdinalOptions = Omit<SelectOrdinalProps, "value">

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

export function select(value: string | number, options: SelectOptions): string {
  return throwMacroError()
}

export function selectOrdinal(value: string | number, options: SelectOrdinalOptions): string {
  return throwMacroError()
}
