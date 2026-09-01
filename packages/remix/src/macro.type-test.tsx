/** @jsxImportSource remix/ui */
import { Plural, Select, SelectOrdinal, Trans } from "./macro"

const name = "Ada"

export const richMessage = (
  <Trans>
    Hello <strong class="name">{name}</strong>
  </Trans>
)
export const choices = [
  <Plural key="plural" value={2} one="# item" other="# items" />,
  <Select key="select" value="female" female="She" other="They" />,
  <SelectOrdinal key="ordinal" value={3} one="#st" other="#th" />,
]

// @ts-expect-error Remix choice macro branches must be strings.
export const invalidSelect = <Select value="female" female={1} other="They" />
