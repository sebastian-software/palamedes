import { getI18n } from "@palamedes/runtime"

import { createRuntimeComponents } from "./shared"

export {
  buildLocaleSwitchItems,
  type BuildLocaleSwitchItemsOptions,
  type LocaleSwitchItem,
} from "@palamedes/core/locale"
export {
  Fragment,
  type PluralProps,
  type SelectOrdinalProps,
  type SelectProps,
  type TransProps,
} from "./shared"

export const { Plural, Select, SelectOrdinal, Trans } = createRuntimeComponents(getI18n)
