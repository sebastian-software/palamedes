import { getI18n } from "@palamedes/runtime"
import type { PalamedesI18n } from "@palamedes/core/compiled"

import { createTrans } from "./transShared"

export { Fragment, type TransProps } from "./transShared"

export const Trans = createTrans(() => getI18n<PalamedesI18n>())
