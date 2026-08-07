import { t } from "@palamedes/core/macro"

export function synchronousServerFunctionMessage(): string {
  return t`Synchronous server helper confirmed locale.`
}

export async function asynchronousServerFunctionMessage(): Promise<string> {
  await Promise.resolve()
  return t`Asynchronous server helper confirmed locale.`
}
