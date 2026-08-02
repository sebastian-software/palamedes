import { getI18n } from "@palamedes/runtime"

import { createCompiledTrans } from "./compiledShared"

export { Fragment, type CompiledTransProps as TransProps } from "./compiledShared"

export const Trans = createCompiledTrans(getI18n)
