import * as React from "react"
import type { ReactNode } from "react"

import { buildChoiceMessage, parseMessagePattern } from "@palamedes/core"
import type {
  MessageMetadata,
  PalamedesI18n,
  PluralProps,
  SelectOrdinalProps,
  SelectProps,
} from "@palamedes/core"

import { createReactMessageRuntime, createTrans, renderI18nMessage } from "./transShared"

export { Fragment, type TransProps } from "./transShared"
export type { PluralProps, SelectOrdinalProps, SelectProps } from "@palamedes/core"

export function createRuntimeComponents(useI18n: () => PalamedesI18n) {
  const Trans = createTrans(useI18n, parseMessagePattern)

  /*
   * The choice components resolve through the i18n instance exactly like
   * Trans: the synthesized ICU pattern is the source message, the catalog can
   * override it (when an `id` mapping exists), and rendering shares the same
   * node pipeline. Formatting the source props directly — the previous
   * behavior — silently skipped translation entirely.
   */
  function renderChoice(
    i18n: PalamedesI18n,
    kind: "plural" | "select" | "selectordinal",
    value: string | number,
    choices: Record<string, string | number | undefined>,
    offset?: number
  ): ReactNode {
    const message = buildChoiceMessage("value", kind, choices, offset)
    const metadata: MessageMetadata = { message, reportMissing: false }
    const runtime = createReactMessageRuntime(i18n, {}, parseMessagePattern)
    return <>{renderI18nMessage(i18n, message, { value }, runtime, metadata)}</>
  }

  function Plural({ value, offset, ...choices }: PluralProps): ReactNode {
    return renderChoice(useI18n(), "plural", value, choices, offset)
  }

  function SelectOrdinal({ value, offset, ...choices }: SelectOrdinalProps): ReactNode {
    return renderChoice(useI18n(), "selectordinal", value, choices, offset)
  }

  function Select({ value, ...choices }: SelectProps): ReactNode {
    return renderChoice(useI18n(), "select", value, choices)
  }

  return { Plural, Select, SelectOrdinal, Trans }
}
