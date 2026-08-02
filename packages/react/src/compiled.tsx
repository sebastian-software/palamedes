"use client"

import { getI18n as useI18n } from "./runtime"
import { createTrans } from "./transShared"

export { Fragment, type TransProps } from "./transShared"

export const Trans = createTrans(useI18n)
