import { defineMessage, plural, t } from "@palamedes/core/macro"

export const simple = t`Simple hello`
export const generated = t`Hello ${name}`
export const plainDescriptor = t({ message: "Hello descriptor" })
export const contextual = defineMessage({
  message: "Context hello",
  context: "email.subject",
})
export const pluralMessage = plural(count, {
  one: "# item",
  other: "# items",
})
export const duplicateOne = t`Repeated origin`
