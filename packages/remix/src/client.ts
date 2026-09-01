import type { CatalogMessages, PalamedesI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

export const REMIX_I18N_BOOTSTRAP_ID = "palamedes-i18n-bootstrap"

const initializedDocuments = new WeakMap<
  RemixI18nBootstrapDocument,
  { catalogVersion: string; i18n: PalamedesI18n; locale: string }
>()

export type RemixI18nBootstrap<TLocale extends string = string> = {
  locale: TLocale
  catalogVersion: string
  messages: CatalogMessages
}

export type RemixI18nBootstrapDocument = {
  documentElement: {
    lang: string
  }
  getElementById(id: string): {
    content?: {
      textContent: string | null
    }
  } | null
}

export type ReadRemixI18nBootstrapOptions = {
  document?: RemixI18nBootstrapDocument
  elementId?: string
}

export type InitializeRemixClientI18nOptions<
  TLocale extends string,
  T extends PalamedesI18n,
> = ReadRemixI18nBootstrapOptions & {
  createI18n: () => T
  bootstrap?: unknown
}

/**
 * Read and validate the inert catalog payload emitted by the Remix server
 * integration. The payload contains no executable script and never imports a
 * `.po` file in the browser.
 */
export function readRemixI18nBootstrap<TLocale extends string = string>(
  options: ReadRemixI18nBootstrapOptions = {}
): RemixI18nBootstrap<TLocale> {
  const document = options.document ?? getBrowserDocument()
  if (!document) {
    throw new Error(
      "Palamedes Remix client bootstrap requires a browser document or an explicit document option."
    )
  }

  const elementId = options.elementId ?? REMIX_I18N_BOOTSTRAP_ID
  const element = document.getElementById(elementId)
  if (!element?.content) {
    throw new Error(
      `Palamedes Remix client bootstrap could not find a <template id="${elementId}"> payload. Render it with remixI18n.renderClientBootstrap(locale) before the browser entry runs.`
    )
  }

  const source = element.content.textContent
  if (!source?.trim()) {
    throw new Error(`Palamedes Remix client bootstrap payload "${elementId}" is empty.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(`Palamedes Remix client bootstrap payload "${elementId}" is not valid JSON.`, {
      cause: error,
    })
  }

  return validateBootstrap<TLocale>(parsed)
}

/**
 * Install the document's locale and catalog before browser-rendered translated
 * modules execute. Locale changes intentionally require a full document
 * navigation so the server and browser cannot disagree about the active
 * catalog.
 */
export function initializeRemixClientI18n<TLocale extends string, T extends PalamedesI18n>(
  options: InitializeRemixClientI18nOptions<TLocale, T>
): T {
  const document = options.document ?? getBrowserDocument()
  const bootstrap =
    options.bootstrap === undefined
      ? readRemixI18nBootstrap<TLocale>({
          document,
          elementId: options.elementId,
        })
      : validateBootstrap<TLocale>(options.bootstrap)

  const documentLocale = document?.documentElement.lang
  if (documentLocale !== undefined && documentLocale !== bootstrap.locale) {
    throw new Error(
      `Palamedes Remix client bootstrap locale "${bootstrap.locale}" does not match document locale "${documentLocale}". Perform a full document navigation when changing locale.`
    )
  }

  const initialized = document ? initializedDocuments.get(document) : undefined
  if (initialized) {
    if (
      initialized.locale !== bootstrap.locale ||
      initialized.catalogVersion !== bootstrap.catalogVersion
    ) {
      throw new Error(
        `Palamedes Remix client bootstrap cannot replace catalog "${initialized.catalogVersion}" for locale "${initialized.locale}" with catalog "${bootstrap.catalogVersion}" for locale "${bootstrap.locale}" in the same document. Perform a full document navigation.`
      )
    }
    return initialized.i18n as T
  }

  let i18n: T
  try {
    i18n = options.createI18n()
    i18n.load(bootstrap.locale, bootstrap.messages)
    i18n.activate(bootstrap.locale)
  } catch (error) {
    throw new Error(
      `Palamedes Remix client bootstrap could not install catalog "${bootstrap.catalogVersion}" for locale "${bootstrap.locale}". Use the parser-capable @palamedes/core createI18n() with serialized ICU string catalogs.`,
      { cause: error }
    )
  }

  const installed = setClientI18n(i18n)
  if (document) {
    initializedDocuments.set(document, {
      catalogVersion: bootstrap.catalogVersion,
      i18n: installed,
      locale: bootstrap.locale,
    })
  }
  return installed
}

function validateBootstrap<TLocale extends string>(value: unknown): RemixI18nBootstrap<TLocale> {
  if (!isPlainObject(value)) {
    throw invalidBootstrap("expected an object")
  }

  if (typeof value.locale !== "string" || value.locale.length === 0) {
    throw invalidBootstrap('"locale" must be a non-empty string')
  }
  if (typeof value.catalogVersion !== "string" || value.catalogVersion.length === 0) {
    throw invalidBootstrap('"catalogVersion" must be a non-empty string')
  }
  if (!isPlainObject(value.messages)) {
    throw invalidBootstrap('"messages" must be an object containing ICU strings')
  }

  const messages: CatalogMessages = Object.create(null) as CatalogMessages
  for (const [id, message] of Object.entries(value.messages)) {
    if (typeof message !== "string") {
      throw invalidBootstrap(`message "${id}" must be an ICU string`)
    }
    messages[id] = message
  }

  return {
    locale: value.locale as TLocale,
    catalogVersion: value.catalogVersion,
    messages,
  }
}

function invalidBootstrap(detail: string): TypeError {
  return new TypeError(`Invalid Palamedes Remix client bootstrap: ${detail}.`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function getBrowserDocument(): RemixI18nBootstrapDocument | undefined {
  if (typeof document === "undefined") {
    return undefined
  }
  return document as unknown as RemixI18nBootstrapDocument
}
