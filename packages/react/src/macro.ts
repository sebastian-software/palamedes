import type { PluralProps, SelectOrdinalProps, SelectProps } from "@palamedes/core"
import type { ReactNode } from "react"

import type { TransProps } from "./transShared"

type MacroTransProps = TransProps & {
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

export function Plural(_props: PluralProps): ReactNode {
  return throwMacroError()
}

export function Select(_props: SelectProps): ReactNode {
  return throwMacroError()
}

export function SelectOrdinal(_props: SelectOrdinalProps): ReactNode {
  return throwMacroError()
}
