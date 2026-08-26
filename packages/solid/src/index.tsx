import type { Element } from "solid-js"

import { buildChoiceMessage, parseMessagePattern } from "@palamedes/core"
import type {
  MessageMetadata,
  PalamedesI18n,
  PluralProps,
  SelectOrdinalProps,
  SelectProps,
} from "@palamedes/core"
import { getI18n } from "@palamedes/runtime"

import {
  createSolidMessageRuntime,
  createTrans,
  renderI18nMessage,
  type TransProps,
} from "./transShared"

export {
  buildLocaleSwitchItems,
  type BuildLocaleSwitchItemsOptions,
  type LocaleSwitchItem,
} from "@palamedes/core/locale"

function getActiveI18n(): PalamedesI18n {
  return getI18n<PalamedesI18n>()
}

export type { TransProps } from "./transShared"

export type { PluralProps, SelectOrdinalProps, SelectProps } from "@palamedes/core"

const RuntimeTrans = createTrans(getActiveI18n, parseMessagePattern)

export function Trans(props: TransProps): Element {
  return RuntimeTrans(props)
}

/*
 * The choice components resolve through the i18n instance exactly like Trans:
 * the synthesized ICU pattern is the source message, the catalog can override
 * it (when an `id` mapping exists), and rendering shares the same node
 * pipeline. Formatting the source props directly — the previous behavior —
 * silently skipped translation entirely.
 */
function renderChoice(
  kind: "plural" | "select" | "selectordinal",
  value: string | number,
  choices: Record<string, string | number | undefined>,
  offset?: number
): Element {
  const i18n = getActiveI18n()
  const message = buildChoiceMessage("value", kind, choices, offset)
  const metadata: MessageMetadata = { message, reportMissing: false }
  const runtime = createSolidMessageRuntime(i18n, {}, parseMessagePattern)
  return renderI18nMessage(i18n, message, { value }, runtime, metadata)
}

export function Plural({ value, offset, ...choices }: PluralProps): Element {
  return renderChoice("plural", value, choices, offset)
}

export function SelectOrdinal({ value, offset, ...choices }: SelectOrdinalProps): Element {
  return renderChoice("selectordinal", value, choices, offset)
}

export function Select({ value, ...choices }: SelectProps): Element {
  return renderChoice("select", value, choices)
}
