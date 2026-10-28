import { getI18n } from "@palamedes/runtime";

import { createTrans } from "./transShared";

export { Fragment, type TransProps } from "./transShared";

export const Trans = createTrans(() => getI18n());

export {
  buildLocaleSwitchItems,
  type BuildLocaleSwitchItemsOptions,
  type LocaleSwitchItem,
} from "@palamedes/core/locale";
