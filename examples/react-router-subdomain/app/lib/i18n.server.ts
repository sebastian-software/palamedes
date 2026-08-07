import { createServerI18nScope } from "@palamedes/runtime/server"
import type { createExampleI18n } from "./i18n"

export const serverI18nScope = createServerI18nScope<ReturnType<typeof createExampleI18n>>()
