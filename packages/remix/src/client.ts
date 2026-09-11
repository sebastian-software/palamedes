import {
  createI18n,
  defineCompiledCatalog,
  isCompiledCatalog,
  type CatalogMessages,
  type CompiledCatalogMessages,
  type PalamedesI18n,
} from "@palamedes/core";
import { isServerEnvironment, loadRegisteredMessages, setClientI18n } from "@palamedes/runtime";

export const REMIX_I18N_BOOTSTRAP_ID = "palamedes-i18n-bootstrap";

const initializedDocuments = new WeakMap<
  RemixI18nBootstrapDocument,
  { catalogVersion: string; i18n: PalamedesI18n; locale: string }
>();

export type RemixI18nBootstrap<TLocale extends string = string> = {
  locale: TLocale;
  catalogVersion: string;
  messages: CatalogMessages | CompiledCatalogMessages;
};

export type RemixI18nBootstrapDocument = {
  documentElement: {
    lang: string;
  };
  getElementById(id: string): {
    content?: {
      textContent: string | null;
    };
  } | null;
};

export type ReadRemixI18nBootstrapOptions = {
  document?: RemixI18nBootstrapDocument;
  elementId?: string;
};

export type InitializeRemixClientI18nOptions<
  TLocale extends string,
  T extends PalamedesI18n,
> = ReadRemixI18nBootstrapOptions & {
  createI18n: () => T;
  bootstrap?: unknown;
};

export type RemixClientCatalogModule<TLocale extends string = string> = {
  locale: TLocale;
  catalogVersion: string;
  messages: CompiledCatalogMessages;
};

export type InitializeRemixClientI18nAsyncOptions<
  TLocale extends string,
  T extends PalamedesI18n,
> = Omit<InitializeRemixClientI18nOptions<TLocale, T>, "bootstrap"> & {
  catalogUrl?: string;
  loadCatalog?: () => Promise<unknown>;
  catalog?: unknown;
};

/**
 * Read and validate the inert catalog payload emitted by the Remix server
 * integration. The payload contains no executable script and never imports a
 * `.po` file in the browser.
 */
export function readRemixI18nBootstrap<TLocale extends string = string>(
  options: ReadRemixI18nBootstrapOptions = {},
): RemixI18nBootstrap<TLocale> {
  const document = options.document ?? getBrowserDocument();
  if (!document) {
    throw new Error(
      "Palamedes Remix client bootstrap requires a browser document or an explicit document option.",
    );
  }

  const elementId = options.elementId ?? REMIX_I18N_BOOTSTRAP_ID;
  const element = document.getElementById(elementId);
  if (!element?.content) {
    throw new Error(
      `Palamedes Remix client bootstrap could not find a <template id="${elementId}"> payload. Render it with remixI18n.renderClientBootstrap(locale) before the browser entry runs.`,
    );
  }

  const source = element.content.textContent;
  if (!source?.trim()) {
    throw new Error(`Palamedes Remix client bootstrap payload "${elementId}" is empty.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Palamedes Remix client bootstrap payload "${elementId}" is not valid JSON.`, {
      cause: error,
    });
  }

  return validateBootstrap<TLocale>(parsed);
}

/**
 * Install the document's locale and catalog before browser-rendered translated
 * modules execute. Locale changes intentionally require a full document
 * navigation so the server and browser cannot disagree about the active
 * catalog.
 */
export function initializeRemixClientI18n<TLocale extends string, T extends PalamedesI18n>(
  options: InitializeRemixClientI18nOptions<TLocale, T>,
): T {
  if (isServerEnvironment()) {
    throw new Error(
      "Palamedes Remix client bootstrap can only run in a browser environment. Render the server catalog with createRemixI18nServer instead.",
    );
  }

  const document = options.document ?? getBrowserDocument();
  const bootstrap =
    options.bootstrap === undefined
      ? readRemixI18nBootstrap<TLocale>({
          document,
          elementId: options.elementId,
        })
      : validateBootstrap<TLocale>(options.bootstrap);

  const documentLocale = document?.documentElement.lang;
  if (documentLocale === "") {
    throw new Error(
      `Palamedes Remix client bootstrap cannot verify locale "${bootstrap.locale}" because the document has no <html lang> attribute. Render <html lang={locale}> in the server document.`,
    );
  }
  if (documentLocale !== undefined && documentLocale !== bootstrap.locale) {
    throw new Error(
      `Palamedes Remix client bootstrap locale "${bootstrap.locale}" does not match document locale "${documentLocale}". Perform a full document navigation when changing locale.`,
    );
  }

  const initialized = document ? initializedDocuments.get(document) : undefined;
  if (initialized) {
    if (
      initialized.locale !== bootstrap.locale ||
      initialized.catalogVersion !== bootstrap.catalogVersion
    ) {
      throw new Error(
        `Palamedes Remix client bootstrap cannot replace catalog "${initialized.catalogVersion}" for locale "${initialized.locale}" with catalog "${bootstrap.catalogVersion}" for locale "${bootstrap.locale}" in the same document. Perform a full document navigation.`,
      );
    }
    return initialized.i18n as T;
  }

  if (!isCompiledCatalog(bootstrap.messages)) {
    throw new TypeError(
      `Palamedes Remix client bootstrap for locale "${bootstrap.locale}" contains an inert serialized ICU catalog. The parser-free runtime requires an executable compiled catalog asset; migrate this host to the Remix asset pipeline described by issue #1214.`,
    );
  }

  let i18n: T;
  try {
    i18n = options.createI18n();
    i18n.load(bootstrap.locale, bootstrap.messages);
    i18n.activate(bootstrap.locale);
  } catch (error) {
    throw new Error(
      `Palamedes Remix client bootstrap could not install compiled catalog "${bootstrap.catalogVersion}" for locale "${bootstrap.locale}". Verify the executable catalog asset and its generated runtime.`,
      { cause: error },
    );
  }

  const installed = setClientI18n(i18n);
  if (document) {
    initializedDocuments.set(document, {
      catalogVersion: bootstrap.catalogVersion,
      i18n: installed,
      locale: bootstrap.locale,
    });
  }
  return installed;
}

/** Load and install an adapter-owned executable catalog ESM asset. */
export async function initializeRemixClientI18nAsync<
  TLocale extends string,
  T extends PalamedesI18n,
>(options: InitializeRemixClientI18nAsyncOptions<TLocale, T>): Promise<T> {
  if (isServerEnvironment()) {
    throw new Error("Palamedes Remix client catalog assets can only run in a browser environment.");
  }

  let loaded: unknown;
  try {
    if (options.catalog !== undefined) {
      loaded = options.catalog;
    } else if (options.loadCatalog) {
      loaded = await options.loadCatalog();
    } else if (options.catalogUrl) {
      loaded = await import(/* @vite-ignore */ options.catalogUrl);
    } else {
      throw new TypeError(
        "Provide catalogUrl, loadCatalog, or catalog from remixI18n.renderClientCatalog(locale).",
      );
    }
  } catch (error) {
    throw new Error("Palamedes Remix executable catalog asset could not be loaded.", {
      cause: error,
    });
  }

  const module = validateCatalogModule<TLocale>(loaded);
  const initialized = initializeRemixClientI18n({
    ...options,
    bootstrap: module,
  });
  await loadRegisteredMessages(initialized, module.locale);
  return initialized;
}

/** Start an application entry after the document's executable catalog is ready.
 * The optional error markup belongs to the host and must not depend on translations.
 */
export async function startRemixClient(
  loadEntry: () => Promise<unknown>,
  options: { errorHtml?: string } = {},
): Promise<void> {
  let failed = false;
  const renderFailure = async (): Promise<void> => {
    if (failed) return;
    failed = true;
    if (!document.body) {
      await new Promise<void>((resolve) =>
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }),
      );
    }
    const template = document.createElement("template");
    template.innerHTML =
      options.errorHtml ??
      '<main role="alert"><h1>Something went wrong</h1><p>Please reload the page to try again.</p><button type="button" data-palamedes-reload>Reload</button><a href="/">Home</a></main>';
    document.body.replaceChildren(template.content.cloneNode(true));
    document
      .querySelector("[data-palamedes-reload]")
      ?.addEventListener("click", () => window.location.reload());
  };
  window.addEventListener("palamedes:catalog-error", () => {
    void renderFailure();
  });
  try {
    const catalogLink = document.querySelector<HTMLLinkElement>(
      "link[data-palamedes-catalog-locale]",
    );
    if (!catalogLink) throw new Error("Palamedes Remix document catalog is missing.");
    await initializeRemixClientI18nAsync({ createI18n, catalogUrl: catalogLink.href });
    await loadEntry();
  } catch {
    await renderFailure();
  }
}

function validateCatalogModule<TLocale extends string>(
  value: unknown,
): RemixClientCatalogModule<TLocale> {
  const candidate =
    isPlainObject(value) && isPlainObject(value.default) ? { ...value, ...value.default } : value;
  if (!isPlainObject(candidate)) {
    throw new TypeError("Palamedes Remix executable catalog asset must export an object.");
  }
  if (typeof candidate.locale !== "string" || candidate.locale.length === 0) {
    throw new TypeError("Palamedes Remix executable catalog asset has no locale export.");
  }
  if (typeof candidate.catalogVersion !== "string" || candidate.catalogVersion.length === 0) {
    throw new TypeError("Palamedes Remix executable catalog asset has no catalogVersion export.");
  }
  const fragmentRegistry =
    (isPlainObject(value) && value.fragmentRegistry === true) ||
    candidate.fragmentRegistry === true;
  const messages =
    fragmentRegistry &&
    isPlainObject(candidate.messages) &&
    Object.keys(candidate.messages).length === 0
      ? defineCompiledCatalog({})
      : candidate.messages;
  if (!isCompiledCatalog(messages)) {
    throw new TypeError(
      `Palamedes Remix executable catalog asset for locale "${candidate.locale}" does not contain a compiled catalog.`,
    );
  }
  return {
    locale: candidate.locale as TLocale,
    catalogVersion: candidate.catalogVersion,
    messages,
  };
}

function validateBootstrap<TLocale extends string>(value: unknown): RemixI18nBootstrap<TLocale> {
  if (!isPlainObject(value)) {
    throw invalidBootstrap("expected an object");
  }

  if (typeof value.locale !== "string" || value.locale.length === 0) {
    throw invalidBootstrap('"locale" must be a non-empty string');
  }
  if (typeof value.catalogVersion !== "string" || value.catalogVersion.length === 0) {
    throw invalidBootstrap('"catalogVersion" must be a non-empty string');
  }
  if (!isPlainObject(value.messages)) {
    throw invalidBootstrap('"messages" must be an object containing ICU strings');
  }

  if (isCompiledCatalog(value.messages)) {
    return {
      locale: value.locale as TLocale,
      catalogVersion: value.catalogVersion,
      messages: value.messages,
    };
  }

  const messages: CatalogMessages = Object.create(null) as CatalogMessages;
  for (const [id, message] of Object.entries(value.messages)) {
    if (typeof message !== "string") {
      throw invalidBootstrap(`message "${id}" must be an ICU string`);
    }
    messages[id] = message;
  }

  return {
    locale: value.locale as TLocale,
    catalogVersion: value.catalogVersion,
    messages,
  };
}

function invalidBootstrap(detail: string): TypeError {
  return new TypeError(`Invalid Palamedes Remix client bootstrap: ${detail}.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getBrowserDocument(): RemixI18nBootstrapDocument | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document as unknown as RemixI18nBootstrapDocument;
}
