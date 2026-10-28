/**
 * Headless locale controls: resolution, the deliberate-choice cookie, and the
 * suggestion decision — all framework-agnostic and configurable. UI and router
 * navigation stay with the caller. See `docs/locale-strategies.md` for the
 * durable integration guidance.
 */

export type LocaleSource =
  | "accept-language"
  | "cookie"
  | "default"
  | "host"
  | "route"
  | "subdomain"
  | "tld";

/**
 * Host-based locale configuration.
 *
 * - `mode: "map"` (default): each locale maps to a full, canonical host, matched
 *   exactly against the request host. Used by the route examples as a validation
 *   signal on top of `/:locale/...`.
 * - `mode: "domain"`: a complete locale-to-host map is authoritative, without
 *   adding locale path prefixes. Hosts may use unrelated domain names.
 * - `mode: "subdomain"`: the leftmost DNS label of the request host *is* the
 *   locale (`de.example.com` -> `de`). Base-domain-independent, so it needs no
 *   per-locale host map and works unchanged across `lvh.me` and production.
 * - `mode: "tld"`: the top-level domain (the rightmost DNS label) determines the
 *   locale. Resolution is three-tiered: a TLD label that already *is* a supported
 *   locale is authoritative automatically (`example.de` -> `de`); a TLD whose
 *   label differs from the language code is authoritative only when listed in
 *   `tld` (`{ at: "de" }`); anything else (`.com`, the multilingual `.ch`, …) is
 *   deliberately not authoritative and falls back to Accept-Language/default.
 *   `defaultTld` names the outbound TLD used when switching to the default locale,
 *   which has no authoritative TLD of its own (`en` -> `.com`).
 */
export type HostLocaleConfig<TLocale extends string> = {
  mode?: "map" | "domain" | "subdomain" | "tld";
  locales?: Partial<Record<TLocale, string>>;
  defaultHost?: string | null;
  /**
   * `mode: "tld"` only. Explicit TLD-label -> locale overrides for country codes
   * whose label is not itself a supported locale code (e.g. `{ at: "de", uk: "en" }`).
   */
  tld?: Record<string, TLocale>;
  /**
   * `mode: "tld"` only. Outbound TLD label for the default locale, which has no
   * authoritative TLD of its own (e.g. `"com"` so `en` switches to `.com`).
   */
  defaultTld?: string;
};

/** A UI-agnostic suggestion that the rendered locale differs from the intent. */
export type LocaleSuggestion<TLocale extends string> = {
  currentLocale: TLocale;
  description: string;
  reason: "accept-language" | "host";
  recommendedLocale: TLocale;
  recommendedUrl: string;
};

export type LocaleControlsConfig<TLocale extends string> = {
  /** Supported locales; the first is not special, `defaultLocale` decides. */
  locales: readonly TLocale[];
  /** Fallback when nothing else resolves. */
  defaultLocale: TLocale;
  /** Display labels; defaults to `Intl.DisplayNames`, then the locale code. */
  labels?: Partial<Record<TLocale, string>>;
  /** Cookie names; default to `locale` and `locale-choice`. */
  cookies?: {
    locale?: string;
    choice?: string;
  };
  /** Optional host strategy (locale per host). */
  hosts?: HostLocaleConfig<TLocale>;
  /**
   * Scheme for host-carrying URLs from `canonicalUrl` and `suggest` (e.g.
   * `"https"`). Without it those URLs are protocol-relative (`//host/path`),
   * which stays correct on http (local) and https (deployed) alike.
   */
  protocol?: string;
};

/** Framework-neutral link descriptors suitable for document heads and sitemaps. */
export type LocaleSeoLink<TLocale extends string = string> =
  | { href: string; rel: "canonical"; hrefLang?: never }
  | { href: string; rel: "alternate"; hrefLang: TLocale | "x-default" };

export type LocaleSwitchItem<TLocale extends string = string> = {
  active: boolean;
  label: string;
  locale: TLocale;
  testId: string;
};

export type BuildLocaleSwitchItemsOptions<TLocale extends string> = {
  currentLocale: TLocale;
  labels?: Partial<Record<TLocale, string>>;
  locales: readonly TLocale[];
  testIdPrefix?: string;
};

const DEFAULT_LOCALE_COOKIE = "locale";
const DEFAULT_CHOICE_COOKIE = "locale-choice";
const DEFAULT_CHOICE_HANDOFF_PARAMETER = "__palamedes_locale_choice";
const CHOICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/;
const HTTP_PROTOCOL_PATTERN = /^https?:?$/i;
const DNS_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

// ---------------------------------------------------------------------------
// Config-free helpers
// ---------------------------------------------------------------------------

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const rawKey = segment.slice(0, separator);
    if (rawKey.trim() === name) {
      return segment.slice(separator + 1).trim();
    }
  }

  return null;
}

function languagePreferences(header: string | null | undefined) {
  return (header ?? "")
    .split(",")
    .map((entry) => {
      const [tag, ...params] = entry.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const quality = qParam ? Number(qParam.split("=")[1]) : 1;
      return {
        quality: Number.isFinite(quality) ? quality : 1,
        tag: tag.toLowerCase(),
      };
    })
    .filter(({ tag }) => tag.length > 0)
    .sort((left, right) => right.quality - left.quality);
}

/** Accept-Language tags sorted by quality, with base languages expanded. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  return languagePreferences(header)
    .filter(({ quality }) => quality > 0)
    .flatMap(({ tag }) => {
      const base = tag.split("-")[0];
      return base && base !== tag ? [tag, base] : [tag];
    });
}

function languageTag(tag: string): Intl.Locale | null {
  try {
    return new Intl.Locale(tag);
  } catch (error) {
    // Preferences are untrusted request data; malformed tags have no match.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * Add a locale choice to a URL when it targets a different origin. The caller
 * remains responsible for recording the choice and navigating. The source and
 * target URLs must use HTTP or HTTPS.
 */
export function createChoiceHandoffUrl(options: {
  url: string;
  locale: string;
  currentOrigin: string;
  parameterName?: string;
}): string {
  const parameter = options.parameterName ?? DEFAULT_CHOICE_HANDOFF_PARAMETER;
  const source = new URL(options.currentOrigin);
  if (source.protocol !== "http:" && source.protocol !== "https:") {
    throw new TypeError("createChoiceHandoffUrl: currentOrigin must use HTTP or HTTPS.");
  }

  const sourceOrigin = source.origin;
  const target = new URL(options.url, sourceOrigin);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new TypeError("createChoiceHandoffUrl: url must use HTTP or HTTPS.");
  }

  if (target.origin !== sourceOrigin) {
    target.searchParams.set(parameter, options.locale);
  }

  return target.href;
}

/**
 * Remove and validate a locale choice handoff from a search string. The caller
 * remains responsible for persisting the accepted choice and updating the URL.
 */
export function consumeChoiceHandoff<TLocale extends string>(options: {
  search?: string | null;
  currentLocale: TLocale;
  locales: readonly TLocale[];
  parameterName?: string;
}): { choice: TLocale | null; search: string } {
  const search = options.search ?? "";
  const parameter = options.parameterName ?? DEFAULT_CHOICE_HANDOFF_PARAMETER;
  const params = new URLSearchParams(search);
  const transferredLocales = params.getAll(parameter);

  if (transferredLocales.length === 0) {
    return { choice: null, search };
  }

  const hasSingleMatchingChoice =
    transferredLocales.length === 1 &&
    transferredLocales[0] === options.currentLocale &&
    options.locales.includes(options.currentLocale);

  params.delete(parameter);
  const remainingSearch = params.toString();

  return {
    choice: hasSingleMatchingChoice ? options.currentLocale : null,
    search: remainingSearch ? `?${remainingSearch}` : "",
  };
}

function stripPort(host: string | null | undefined): string | null {
  if (!host) {
    return null;
  }

  return host.replace(/:\d+$/, "");
}

function getPort(host: string | null | undefined): string | null {
  if (!host) {
    return null;
  }

  const match = host.match(/:(\d+)$/);
  return match?.[1] ?? null;
}

function resolveLabels<TLocale extends string>(
  locales: readonly TLocale[],
  overrides?: Partial<Record<TLocale, string>>,
): Record<TLocale, string> {
  const hasDisplayNames = typeof Intl.DisplayNames === "function";

  return Object.fromEntries(
    locales.map((locale) => {
      const override = overrides?.[locale];
      if (override) {
        return [locale, override];
      }

      if (hasDisplayNames) {
        const label = new Intl.DisplayNames([locale], { type: "language" }).of(locale);
        if (label) {
          return [locale, label];
        }
      }

      return [locale, locale];
    }),
  ) as Record<TLocale, string>;
}

/**
 * Build headless locale-switch items (locale, active, label, testId) to render
 * with any router. Re-exported by `@palamedes/react` / `@palamedes/solid`.
 */
export function buildLocaleSwitchItems<TLocale extends string>({
  currentLocale,
  labels,
  locales,
  testIdPrefix = "locale-switch",
}: BuildLocaleSwitchItemsOptions<TLocale>): Array<LocaleSwitchItem<TLocale>> {
  return locales.map((locale) => ({
    active: locale === currentLocale,
    label: labels?.[locale] ?? locale,
    locale,
    testId: `${testIdPrefix}-${locale}`,
  }));
}

// ---------------------------------------------------------------------------
// Bound controls
// ---------------------------------------------------------------------------

function isDnsLabel(value: string): boolean {
  return DNS_LABEL_PATTERN.test(value);
}

function isDnsHost(value: string): boolean {
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(value);
  if (!match) {
    return false;
  }

  const hostname = match[1];
  const port = match[2];
  if (!hostname || hostname.length > 253 || !hostname.split(".").every(isDnsLabel)) {
    return false;
  }

  return port === undefined || (Number(port) >= 1 && Number(port) <= 65_535);
}

function assertDomainHosts<TLocale extends string>(
  hosts: HostLocaleConfig<TLocale>,
  locales: readonly TLocale[],
): void {
  const seenHosts = new Set<string>();
  for (const locale of locales) {
    const host = hosts.locales?.[locale];
    if (!host) {
      throw new TypeError(
        `defineLocaleControls: hosts.locales.${locale} is required in domain mode.`,
      );
    }
    const normalized = stripPort(host)?.toLowerCase() ?? "";
    if (seenHosts.has(normalized)) {
      throw new TypeError("defineLocaleControls: domain hosts must identify distinct locales.");
    }
    seenHosts.add(normalized);
  }
}

function assertLocaleControlsConfig<TLocale extends string>(
  config: LocaleControlsConfig<TLocale>,
): void {
  if (!config || typeof config !== "object") {
    throw new TypeError("defineLocaleControls: config must be an object.");
  }

  if (!Array.isArray(config.locales) || config.locales.length === 0) {
    throw new TypeError("defineLocaleControls: locales must contain at least one locale.");
  }

  const localeSet = new Set<string>();
  for (const [index, locale] of config.locales.entries()) {
    if (typeof locale !== "string" || !COOKIE_VALUE_PATTERN.test(locale)) {
      throw new TypeError(
        `defineLocaleControls: locales[${index}] must be a non-empty, cookie-safe string.`,
      );
    }
    if (localeSet.has(locale)) {
      throw new TypeError(`defineLocaleControls: locales contains duplicate locale "${locale}".`);
    }
    localeSet.add(locale);
  }

  if (typeof config.defaultLocale !== "string" || !localeSet.has(config.defaultLocale)) {
    throw new TypeError("defineLocaleControls: defaultLocale must be included in locales.");
  }

  if (
    config.cookies !== undefined &&
    (!config.cookies || typeof config.cookies !== "object" || Array.isArray(config.cookies))
  ) {
    throw new TypeError("defineLocaleControls: cookies must be an object.");
  }
  const cookieNames = [
    ["cookies.locale", config.cookies?.locale],
    ["cookies.choice", config.cookies?.choice],
  ] as const;
  for (const [field, value] of cookieNames) {
    if (value !== undefined && (typeof value !== "string" || !COOKIE_NAME_PATTERN.test(value))) {
      throw new TypeError(`defineLocaleControls: ${field} must be a valid cookie name.`);
    }
  }

  if (
    config.protocol !== undefined &&
    (typeof config.protocol !== "string" || !HTTP_PROTOCOL_PATTERN.test(config.protocol))
  ) {
    throw new TypeError('defineLocaleControls: protocol must be "http" or "https".');
  }

  const hosts = config.hosts;
  if (hosts === undefined) {
    return;
  }
  if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) {
    throw new TypeError("defineLocaleControls: hosts must be an object.");
  }
  if (hosts.mode !== undefined && !["map", "domain", "subdomain", "tld"].includes(hosts.mode)) {
    throw new TypeError(
      'defineLocaleControls: hosts.mode must be "map", "domain", "subdomain", or "tld".',
    );
  }

  if (hosts.defaultHost !== undefined && hosts.defaultHost !== null) {
    if (typeof hosts.defaultHost !== "string" || !isDnsHost(hosts.defaultHost)) {
      throw new TypeError(
        "defineLocaleControls: hosts.defaultHost must be a DNS hostname with an optional port.",
      );
    }
  }

  if (hosts.locales !== undefined) {
    if (!hosts.locales || typeof hosts.locales !== "object" || Array.isArray(hosts.locales)) {
      throw new TypeError("defineLocaleControls: hosts.locales must be an object.");
    }
    for (const [locale, host] of Object.entries(hosts.locales)) {
      if (!localeSet.has(locale)) {
        throw new TypeError(
          `defineLocaleControls: hosts.locales contains unsupported locale "${locale}".`,
        );
      }
      if (typeof host !== "string" || !isDnsHost(host)) {
        throw new TypeError(
          `defineLocaleControls: hosts.locales.${locale} must be a DNS hostname with an optional port.`,
        );
      }
    }
  }

  if (hosts.mode === "domain") assertDomainHosts(hosts, config.locales);

  if (hosts.defaultTld !== undefined) {
    if (typeof hosts.defaultTld !== "string" || !isDnsLabel(hosts.defaultTld)) {
      throw new TypeError("defineLocaleControls: hosts.defaultTld must be a valid DNS label.");
    }
  }

  if (hosts.tld !== undefined) {
    if (!hosts.tld || typeof hosts.tld !== "object" || Array.isArray(hosts.tld)) {
      throw new TypeError("defineLocaleControls: hosts.tld must be an object.");
    }
    for (const [tld, locale] of Object.entries(hosts.tld)) {
      if (!isDnsLabel(tld)) {
        throw new TypeError(
          `defineLocaleControls: hosts.tld key "${tld}" must be a valid DNS label.`,
        );
      }
      if (typeof locale !== "string" || !localeSet.has(locale)) {
        throw new TypeError(
          `defineLocaleControls: hosts.tld.${tld} must reference a locale from locales.`,
        );
      }
    }
  }

  if (hosts.mode === "subdomain" || hosts.mode === "tld") {
    for (const locale of config.locales) {
      if (!isDnsLabel(locale)) {
        throw new TypeError(
          `defineLocaleControls: locale "${locale}" must be a valid DNS label for hosts.mode "${hosts.mode}".`,
        );
      }
    }
  }
}

function snapshotLocaleControlsConfig<TLocale extends string>(
  config: LocaleControlsConfig<TLocale>,
): LocaleControlsConfig<TLocale> {
  const hosts = config.hosts;
  return {
    ...config,
    locales: Object.freeze([...config.locales]),
    labels: config.labels ? { ...config.labels } : undefined,
    cookies: config.cookies ? { ...config.cookies } : undefined,
    hosts: hosts
      ? {
          ...hosts,
          locales: hosts.locales ? { ...hosts.locales } : undefined,
          tld: hosts.tld ? { ...hosts.tld } : undefined,
        }
      : undefined,
  };
}

export type LocaleControls<TLocale extends string> = {
  readonly locales: readonly TLocale[];
  readonly defaultLocale: TLocale;
  readonly labels: Record<TLocale, string>;

  isLocale(value: unknown): value is TLocale;
  normalizeLocale(value: unknown): TLocale;
  label(locale: TLocale): string;
  preferredLocale(acceptLanguageHeader: string | null | undefined): TLocale;

  /** Resolve the active locale for a request, per strategy. */
  resolve(options: {
    strategy: "cookie" | "route" | "domain" | "subdomain" | "tld";
    acceptLanguageHeader?: string | null;
    cookieHeader?: string | null;
    routeLocale?: string | null;
    requestHost?: string | null;
  }): { locale: TLocale; source: LocaleSource };

  /** The deliberate-choice cookie value, or null when unset/invalid. */
  readChoice(cookieHeader: string | null | undefined): TLocale | null;
  /** A `document.cookie` string recording a deliberate choice. */
  serializeChoice(locale: TLocale): string;

  /**
   * Suggest the browser's Accept-Language locale unless a recorded choice
   * confirms the current locale. Earlier choices for another locale do not
   * change the browser preference. Host mismatches are independent of intent.
   */
  suggest(options: {
    currentLocale: TLocale;
    acceptLanguageHeader?: string | null;
    cookieHeader?: string | null;
    pathname: string;
    requestHost?: string | null;
    search?: string | null;
  }): LocaleSuggestion<TLocale> | null;

  canonicalUrl(options: {
    locale: TLocale;
    pathname: string;
    requestHost?: string | null;
    search?: string | null;
  }): string;

  /** Canonical URL, configured language alternates, and an optional x-default. */
  seoLinks(options: {
    locale: TLocale;
    pathname: string;
    requestHost?: string | null;
    search?: string | null;
    /** Defaults to defaultLocale; false omits the x-default link. */
    xDefaultLocale?: TLocale | false;
  }): Array<LocaleSeoLink<TLocale>>;

  replaceLocaleInPath(pathname: string, locale: TLocale): string;
  extractLocaleFromPath(pathname: string): TLocale | null;

  switchItems(options: {
    currentLocale: TLocale;
    testIdPrefix?: string;
  }): Array<LocaleSwitchItem<TLocale>>;
};

export function defineLocaleControls<TLocale extends string>(
  config: LocaleControlsConfig<TLocale>,
): LocaleControls<TLocale> {
  assertLocaleControlsConfig(config);
  config = snapshotLocaleControlsConfig(config);
  const localeCookie = config.cookies?.locale ?? DEFAULT_LOCALE_COOKIE;
  const choiceCookie = config.cookies?.choice ?? DEFAULT_CHOICE_COOKIE;
  const labels = resolveLabels(config.locales, config.labels);

  const isLocale = (value: unknown): value is TLocale =>
    typeof value === "string" && config.locales.includes(value as TLocale);

  const normalizeLocale = (value: unknown): TLocale =>
    isLocale(value) ? value : config.defaultLocale;

  const label = (locale: TLocale): string => labels[locale];

  const languageLocales = config.locales.map((locale) => {
    const parsed = languageTag(locale);
    return { locale, parsed, maximized: parsed?.maximize() };
  });

  const preferredLocale = (header: string | null | undefined): TLocale => {
    const preferences = languagePreferences(header);
    const exclusions = preferences
      .filter(({ quality }) => quality === 0)
      .map(({ tag }) => {
        const parsed = languageTag(tag);
        return {
          tag: parsed?.baseName.toLowerCase() ?? tag,
          maximized: parsed?.maximize(),
        };
      });
    const unique = (matches: typeof languageLocales): TLocale | undefined =>
      matches.length === 1 ? matches[0]?.locale : undefined;

    for (const { tag, quality } of preferences) {
      if (quality <= 0) continue;
      const parsed = languageTag(tag);
      const canonicalTag = parsed?.baseName.toLowerCase() ?? tag;
      const available = languageLocales.filter(
        ({ locale, parsed: configured, maximized: supported }) => {
          const lower = configured?.baseName.toLowerCase() ?? locale.toLowerCase();
          const specificity =
            lower === canonicalTag || lower.startsWith(`${canonicalTag}-`)
              ? canonicalTag.split("-").length
              : 0;
          return exclusions.every(({ tag: excludedTag, maximized: excluded }) => {
            // A specific accepted range overrides a broader rejection, including
            // '*;q=0'. Inference cannot override an explicitly rejected locale.
            if (excludedTag === "*") return true;
            const matches =
              lower === excludedTag ||
              lower.startsWith(`${excludedTag}-`) ||
              (excluded && supported && excluded.baseName === supported.baseName);
            return !matches || specificity > excludedTag.split("-").length;
          });
        },
      );
      const exact = unique(available.filter(({ locale }) => locale.toLowerCase() === tag));
      if (exact) return exact;

      if (!parsed) continue;
      const canonical = unique(
        available.filter((candidate) => candidate.parsed?.baseName === parsed.baseName),
      );
      if (canonical) return canonical;

      // Likely subtags supply missing fields, but never replace an explicit
      // script. Use the host's CLDR data rather than a regional alias table.
      const maximized = parsed.maximize();
      const compatible = available.filter(
        (candidate) =>
          candidate.maximized?.language === maximized.language &&
          candidate.maximized.script === maximized.script,
      );
      const match =
        unique(
          compatible.filter((candidate) => candidate.maximized?.region === maximized.region),
        ) ??
        unique(compatible.filter((candidate) => candidate.parsed?.region === undefined)) ??
        unique(compatible);
      if (match) return match;
    }

    return config.defaultLocale;
  };

  const readChoice = (cookieHeader: string | null | undefined): TLocale | null => {
    const value = readCookie(cookieHeader, choiceCookie);
    return isLocale(value) ? value : null;
  };

  const readCookieLocale = (cookieHeader: string | null | undefined): TLocale | null => {
    const value = readCookie(cookieHeader, localeCookie);
    return isLocale(value) ? value : null;
  };

  const serializeChoice = (locale: TLocale): string =>
    `${choiceCookie}=${locale}; Path=/; Max-Age=${CHOICE_MAX_AGE_SECONDS}; SameSite=Lax`;

  /** The leftmost DNS label of the host, if it is a supported locale. */
  const extractSubdomainLocale = (requestHost: string | null | undefined): TLocale | null => {
    const firstLabel = stripPort(requestHost)?.split(".")[0]?.toLowerCase();
    return isLocale(firstLabel) ? (firstLabel as TLocale) : null;
  };

  /**
   * Return the host with its leftmost label set to `locale`: replace the label
   * when it is already a locale, otherwise prepend one. Mirrors
   * `replaceLocaleInPath` for the subdomain strategy.
   */
  const swapSubdomainLabel = (
    requestHost: string | null | undefined,
    locale: TLocale,
  ): string | null => {
    const stripped = stripPort(requestHost);
    if (!stripped) {
      return null;
    }

    const parts = stripped.split(".");
    if (parts.length > 0 && isLocale(parts[0]?.toLowerCase())) {
      parts[0] = locale;
    } else {
      parts.unshift(locale);
    }

    return parts.join(".");
  };

  /**
   * The locale for a host's top-level domain, three-tiered: the TLD label when it
   * is itself a supported locale (`example.de` -> `de`), else an explicit `tld`
   * override (`{ at: "de" }`), else null (fall back). A bare single-label host has
   * no TLD and yields null.
   */
  const extractTldLocale = (requestHost: string | null | undefined): TLocale | null => {
    const parts = stripPort(requestHost)?.split(".");
    if (!parts || parts.length < 2) {
      return null;
    }

    const tldLabel = parts[parts.length - 1]?.toLowerCase();
    if (!tldLabel) {
      return null;
    }

    if (isLocale(tldLabel)) {
      return tldLabel as TLocale;
    }

    const mapped = config.hosts?.tld?.[tldLabel];
    return isLocale(mapped) ? (mapped as TLocale) : null;
  };

  /** The outbound TLD label for a locale: its own code, or `defaultTld` for the
   * default locale (which has no authoritative TLD of its own). */
  const tldForLocale = (locale: TLocale): string => {
    if (locale === config.defaultLocale && config.hosts?.defaultTld) {
      return config.hosts.defaultTld;
    }

    return locale;
  };

  /**
   * Return the host with its rightmost label (the TLD) set to `locale`'s outbound
   * TLD. Mirrors `swapSubdomainLabel` for the tld strategy.
   */
  const swapTldLabel = (requestHost: string | null | undefined, locale: TLocale): string | null => {
    const stripped = stripPort(requestHost);
    if (!stripped) {
      return null;
    }

    const parts = stripped.split(".");
    if (parts.length < 2) {
      // A single-label host has no tld to swap; mirror the no-host path so
      // `canonicalUrl` falls back to a bare path instead of reflecting the host
      // unchanged for every locale.
      return null;
    }

    parts[parts.length - 1] = tldForLocale(locale);
    return parts.join(".");
  };

  const resolve = (options: {
    strategy: "cookie" | "route" | "domain" | "subdomain" | "tld";
    acceptLanguageHeader?: string | null;
    cookieHeader?: string | null;
    routeLocale?: string | null;
    requestHost?: string | null;
  }): { locale: TLocale; source: LocaleSource } => {
    switch (options.strategy) {
      case "route": {
        if (isLocale(options.routeLocale)) {
          return { locale: options.routeLocale, source: "route" };
        }
        break;
      }
      case "domain": {
        if (config.hosts?.mode !== "domain") {
          throw new TypeError(
            'defineLocaleControls: strategy "domain" requires hosts.mode "domain".',
          );
        }
        const hostLocale = resolveHostLocale(options.requestHost);
        if (hostLocale) return { locale: hostLocale, source: "host" };
        break;
      }
      case "subdomain": {
        const subdomainLocale = extractSubdomainLocale(options.requestHost);
        if (subdomainLocale) {
          return { locale: subdomainLocale, source: "subdomain" };
        }
        break;
      }
      case "tld": {
        const tldLocale = extractTldLocale(options.requestHost);
        if (tldLocale) {
          return { locale: tldLocale, source: "tld" };
        }
        break;
      }
      case "cookie": {
        const cookieLocale = readCookieLocale(options.cookieHeader);
        if (cookieLocale) {
          return { locale: cookieLocale, source: "cookie" };
        }
        break;
      }
    }

    const acceptLanguageLocale = preferredLocale(options.acceptLanguageHeader);
    return {
      locale: acceptLanguageLocale,
      source: acceptLanguageLocale === config.defaultLocale ? "default" : "accept-language",
    };
  };

  const replaceLocaleInPath = (pathname: string, locale: TLocale): string => {
    const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const segments = normalizedPathname.split("/").filter(Boolean);

    if (segments.length > 0 && isLocale(segments[0])) {
      segments[0] = locale;
    } else {
      segments.unshift(locale);
    }

    return `/${segments.join("/")}`;
  };

  const extractLocaleFromPath = (pathname: string): TLocale | null => {
    const firstSegment = pathname.split("/").filter(Boolean)[0];
    return isLocale(firstSegment) ? firstSegment : null;
  };

  const resolveHostLocale = (requestHost: string | null | undefined): TLocale | null => {
    if (!config.hosts) {
      return null;
    }

    if (config.hosts.mode === "subdomain") {
      return extractSubdomainLocale(requestHost);
    }

    if (config.hosts.mode === "tld") {
      return extractTldLocale(requestHost);
    }

    const normalizedHost = stripPort(requestHost)?.toLowerCase();
    if (!normalizedHost) {
      return null;
    }

    const hostLocales: Partial<Record<TLocale, string>> = config.hosts.locales ?? {};
    for (const locale of config.locales) {
      if (stripPort(hostLocales[locale])?.toLowerCase() === normalizedHost) {
        return locale;
      }
    }

    if (
      config.hosts.defaultHost &&
      normalizedHost === stripPort(config.hosts.defaultHost)?.toLowerCase()
    ) {
      return config.defaultLocale;
    }

    return null;
  };

  const getCanonicalHost = (locale: TLocale, fallbackHost?: string | null): string | null => {
    if (config.hosts?.mode === "subdomain") {
      return swapSubdomainLabel(fallbackHost, locale);
    }

    if (config.hosts?.mode === "tld") {
      return swapTldLabel(fallbackHost, locale);
    }

    if (config.hosts?.mode === "domain") {
      const host = config.hosts.locales?.[locale];
      if (!isLocale(locale) || !host) {
        throw new TypeError("defineLocaleControls: domain URLs require a configured locale host.");
      }
      return host;
    }

    return (
      config.hosts?.locales?.[locale] ??
      stripPort(fallbackHost) ??
      config.hosts?.defaultHost ??
      null
    );
  };

  const canonicalUrl = (options: {
    locale: TLocale;
    pathname: string;
    requestHost?: string | null;
    search?: string | null;
  }): string => {
    // Domain, subdomain, and TLD modes carry locale in the host; the existing
    // map mode remains an additional signal on top of locale-prefixed paths.
    const canonicalPath =
      config.hosts?.mode === "domain" ||
      config.hosts?.mode === "subdomain" ||
      config.hosts?.mode === "tld"
        ? options.pathname
        : replaceLocaleInPath(options.pathname, options.locale);
    const canonicalHost = config.hosts
      ? getCanonicalHost(options.locale, options.requestHost)
      : null;
    // Explicit domain destinations own their ports; a preview request must not
    // transfer its development port to a production domain.
    const requestPort = config.hosts?.mode === "domain" ? null : getPort(options.requestHost);

    if (!canonicalHost) {
      return `${canonicalPath}${options.search ?? ""}`;
    }

    const hostWithPort =
      requestPort && !canonicalHost.includes(":")
        ? `${canonicalHost}:${requestPort}`
        : canonicalHost;

    // Protocol-relative by default so an HTTPS page never links users to
    // http://; an explicit `protocol` config produces absolute URLs.
    const scheme = config.protocol ? `${config.protocol.replace(/:$/, "")}:` : "";
    return `${scheme}//${hostWithPort}${canonicalPath}${options.search ?? ""}`;
  };

  const seoLinks = (options: {
    locale: TLocale;
    pathname: string;
    requestHost?: string | null;
    search?: string | null;
    xDefaultLocale?: TLocale | false;
  }): Array<LocaleSeoLink<TLocale>> => {
    if (!isLocale(options.locale)) {
      throw new TypeError("defineLocaleControls: SEO locale must be configured.");
    }
    const xDefaultLocale = options.xDefaultLocale ?? config.defaultLocale;
    if (xDefaultLocale !== false && !isLocale(xDefaultLocale)) {
      throw new TypeError("defineLocaleControls: SEO xDefaultLocale must be configured or false.");
    }
    const links: Array<LocaleSeoLink<TLocale>> = [
      { href: canonicalUrl(options), rel: "canonical" },
      ...config.locales.map((locale): LocaleSeoLink<TLocale> => ({
        href: canonicalUrl({ ...options, locale }),
        hrefLang: locale,
        rel: "alternate",
      })),
    ];
    if (xDefaultLocale !== false) {
      links.push({
        href: canonicalUrl({ ...options, locale: xDefaultLocale }),
        hrefLang: "x-default",
        rel: "alternate",
      });
    }
    return links;
  };

  const suggest = (options: {
    currentLocale: TLocale;
    acceptLanguageHeader?: string | null;
    cookieHeader?: string | null;
    pathname: string;
    requestHost?: string | null;
    search?: string | null;
  }): LocaleSuggestion<TLocale> | null => {
    const hostLocale = resolveHostLocale(options.requestHost);

    if (hostLocale && hostLocale !== options.currentLocale) {
      return {
        currentLocale: options.currentLocale,
        description: `This host is mapped to ${label(hostLocale)} while the URL is rendering ${label(options.currentLocale)}.`,
        reason: "host",
        recommendedLocale: hostLocale,
        recommendedUrl: canonicalUrl({
          locale: hostLocale,
          pathname: options.pathname,
          requestHost: options.requestHost,
          search: options.search,
        }),
      };
    }

    const choice = readChoice(options.cookieHeader);
    const preferred = preferredLocale(options.acceptLanguageHeader);
    if (choice === options.currentLocale || preferred === options.currentLocale) {
      return null;
    }

    return {
      currentLocale: options.currentLocale,
      description: `You prefer ${label(preferred)}, but this page is currently rendering ${label(options.currentLocale)}.`,
      reason: "accept-language",
      recommendedLocale: preferred,
      recommendedUrl: canonicalUrl({
        locale: preferred,
        pathname: options.pathname,
        requestHost: options.requestHost,
        search: options.search,
      }),
    };
  };

  const switchItems = (options: {
    currentLocale: TLocale;
    testIdPrefix?: string;
  }): Array<LocaleSwitchItem<TLocale>> =>
    buildLocaleSwitchItems({
      currentLocale: options.currentLocale,
      labels,
      locales: config.locales,
      testIdPrefix: options.testIdPrefix,
    });

  return {
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    labels,
    isLocale,
    normalizeLocale,
    label,
    preferredLocale,
    resolve,
    readChoice,
    serializeChoice,
    suggest,
    canonicalUrl,
    seoLinks,
    replaceLocaleInPath,
    extractLocaleFromPath,
    switchItems,
  };
}
