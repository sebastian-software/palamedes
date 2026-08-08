import "server-only"

import { t } from "@palamedes/core/macro"

export function synchronousServerFunctionMessage() {
  return t`Synchronous helper confirmed locale.`
}

export async function asynchronousServerFunctionMessage() {
  await Promise.resolve()
  return t`Asynchronous helper confirmed locale.`
}
