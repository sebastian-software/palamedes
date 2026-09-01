import type { SelectProps } from "@palamedes/core"
import type {
  PluralMacroProps,
  SelectMacroProps,
  SelectOrdinalMacroProps,
} from "@palamedes/core/macro"
import type { ReactNode } from "react"

type MacroTransProps = {
  message?: string
  context?: string
  comment?: string
  children?: ReactNode
}

function throwMacroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/react/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function Trans(_props: MacroTransProps): ReactNode {
  return throwMacroError()
}

export function Plural(_props: PluralMacroProps): ReactNode {
  return throwMacroError()
}

export function Select<const Props extends SelectProps>(
  _props: SelectMacroProps<Props>
): ReactNode {
  return throwMacroError()
}

export function SelectOrdinal(_props: SelectOrdinalMacroProps): ReactNode {
  return throwMacroError()
}
