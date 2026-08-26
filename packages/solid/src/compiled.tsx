import type { Element } from "solid-js"

import type { PalamedesI18n } from "@palamedes/core/compiled"
import { getI18n } from "@palamedes/runtime"

import { createTrans, type TransProps } from "./transShared"

export type { TransProps } from "./transShared"

const CompiledTrans = createTrans(() => getI18n<PalamedesI18n>())

/** Parser-free Trans component used by transformed production code. */
export function Trans(props: TransProps): Element {
  return CompiledTrans(props)
}
