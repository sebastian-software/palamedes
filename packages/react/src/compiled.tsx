"use client"

import { getI18n as useI18n } from "./runtime"
import { createCompiledTrans } from "./compiledShared"

export { Fragment, type CompiledTransProps as TransProps } from "./compiledShared"

export const Trans = createCompiledTrans(useI18n)
