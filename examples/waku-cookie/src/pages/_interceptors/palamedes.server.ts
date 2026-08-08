import { createWakuI18nInterceptor } from "@palamedes/waku"

import { createRequestI18n } from "../../lib/i18n.server"

export default createWakuI18nInterceptor(createRequestI18n)
