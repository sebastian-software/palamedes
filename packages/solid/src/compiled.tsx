import type { JSX } from "solid-js"

import type { PalamedesI18n } from "@palamedes/core/compiled"

import { getI18n } from "./runtime"
import { createTrans, type TransProps } from "./transShared"

export type { TransProps } from "./transShared"

const CompiledTrans = createTrans(() => getI18n<PalamedesI18n>())

/** Parser-free Trans component used by transformed production code. */
export function Trans(props: TransProps): JSX.Element {
  return CompiledTrans(props)
}
