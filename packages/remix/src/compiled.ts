import type { PalamedesI18n } from "@palamedes/core/compiled"
import { getI18n } from "@palamedes/runtime"
import { Fragment } from "remix/ui"

import { createTrans } from "./transShared"

export type { TransProps } from "./transShared"
export { Fragment }

/** Parser-free Remix UI component used by transformed rich-message macros. */
export const Trans = createTrans(() => getI18n<PalamedesI18n>())
