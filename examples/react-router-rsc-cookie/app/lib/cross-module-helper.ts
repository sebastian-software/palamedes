import "server-only"

import { t } from "@palamedes/core/macro"

export function crossModuleServerFunctionMessage() {
  return t`Cross-module helper confirmed locale.`
}
