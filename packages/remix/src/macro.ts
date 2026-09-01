import type { PluralProps, SelectOrdinalProps, SelectProps } from "@palamedes/core"
import type { Handle, RemixNode } from "remix/ui"

import type { TransProps } from "./transShared"

type MacroTransProps = TransProps & {
  children?: RemixNode
}
type MacroSelectProps<Props extends SelectProps> = Props &
  Record<Exclude<keyof Props, "value">, string>

function throwMacroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/remix/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function Trans(_handle: Handle<MacroTransProps>): () => RemixNode {
  return throwMacroError()
}

export function Plural(_handle: Handle<PluralProps>): () => RemixNode {
  return throwMacroError()
}

export function Select<const Props extends SelectProps>(
  _handle: Handle<MacroSelectProps<Props>>
): () => RemixNode {
  return throwMacroError()
}

export function SelectOrdinal(_handle: Handle<SelectOrdinalProps>): () => RemixNode {
  return throwMacroError()
}
