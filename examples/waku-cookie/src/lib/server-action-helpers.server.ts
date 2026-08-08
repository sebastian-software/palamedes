import { t } from "@palamedes/core/macro"

export function synchronousServerActionMessage(): string {
  return t`Synchronous server-action helper confirmed locale.`
}

export async function asynchronousServerActionMessage(): Promise<string> {
  await Promise.resolve()
  return t`Asynchronous server-action helper confirmed locale.`
}
