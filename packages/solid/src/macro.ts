import type { SelectProps } from "@palamedes/core"
import type {
  PluralMacroProps,
  SelectMacroProps,
  SelectOrdinalMacroProps,
} from "@palamedes/core/macro"
import type { Element } from "solid-js"

type MacroTransProps = {
  message?: string
  context?: string
  comment?: string
  children?: Element
}

function macroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/solid/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function Trans(_props: MacroTransProps): Element {
  return macroError()
}

export function Plural(_props: PluralMacroProps): Element {
  return macroError()
}

export function Select<const Props extends SelectProps>(_props: SelectMacroProps<Props>): Element {
  return macroError()
}

export function SelectOrdinal(_props: SelectOrdinalMacroProps): Element {
  return macroError()
}
