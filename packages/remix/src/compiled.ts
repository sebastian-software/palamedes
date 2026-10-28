import { getI18n } from "@palamedes/runtime";
import { Fragment } from "remix/component";

import { createTrans } from "./transShared";

export type { TransProps } from "./transShared";
export { Fragment };

/** Parser-free Remix UI component used by transformed rich-message macros. */
export const Trans = createTrans(() => getI18n());
