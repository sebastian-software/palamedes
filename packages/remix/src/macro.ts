import type { SelectProps } from "@palamedes/core"
import type {
  PluralMacroProps,
  SelectMacroProps,
  SelectOrdinalMacroProps,
} from "@palamedes/core/macro"
import type { Handle, RemixNode } from "remix/ui"

import type { TransProps } from "./transShared"

type MacroTransProps = Pick<TransProps, "message" | "context" | "comment"> & {
  children?: RemixNode
}

function throwMacroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/remix/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function Trans(_handle: Handle<MacroTransProps>): () => RemixNode {
  return throwMacroError()
}

export function Plural(_handle: Handle<PluralMacroProps>): () => RemixNode {
  return throwMacroError()
}

export function Select<const Props extends SelectProps>(
  _handle: Handle<SelectMacroProps<Props>>
): () => RemixNode {
  return throwMacroError()
}

export function SelectOrdinal(_handle: Handle<SelectOrdinalMacroProps>): () => RemixNode {
  return throwMacroError()
}
