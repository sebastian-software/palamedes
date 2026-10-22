export type DemoLocale = "en" | "de" | "es" | "fr";
export type DemoStrategy = "cookie" | "route" | "subdomain" | "tld" | "query";

/** Application-owned locale selection, shared by the four component demos.
 * Keep this function self-contained: the Vite demos serialize it into the
 * blocking bootstrap script that runs before any translated modules load.
 */
export function createDemoLocalePolicy(
  input: URL,
  cookie = "",
  languages = "en",
  requestedStrategy?: string,
) {
  const url = new URL(input);
  const locales = new Set<DemoLocale>(["en", "de", "es", "fr"]);
  const supported = (value: string | undefined): value is DemoLocale =>
    locales.has(value as DemoLocale);
  const inferred = url.hostname.includes(".palamedes-i18n.")
    ? "tld"
    : url.hostname.match(/-(cookie|route|subdomain)\.examples\.palamedes\.dev$/u)?.[1];
  const strategy = (requestedStrategy ?? inferred ?? "query") as DemoStrategy;
  if (!["cookie", "route", "subdomain", "tld", "query"].includes(strategy)) {
    throw new Error(`Unknown demo locale strategy: ${strategy}`);
  }
  const preferred = languages
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return {
        locale: tag.toLowerCase().split("-")[0],
        q: quality ? Number(quality.trim().slice(2)) : 1,
      };
    })
    .filter(({ locale: preference, q }) => supported(preference) && q > 0 && q <= 1)
    .sort((a, b) => b.q - a.q)[0]?.locale as DemoLocale | undefined;
  const saved = cookie.match(/(?:^|;\s*)locale=([^;]*)/u)?.[1];
  const pathLocale = url.pathname.split("/")[1];
  const selected =
    strategy === "query"
      ? (url.searchParams.get("locale") ?? undefined)
      : strategy === "cookie"
        ? supported(saved)
          ? saved
          : preferred
        : strategy === "route"
          ? supported(pathLocale)
            ? pathLocale
            : preferred
          : strategy === "subdomain"
            ? url.hostname.split(".")[0]
            : url.hostname.endsWith(".com")
              ? "en"
              : url.hostname.split(".").at(-1);
  const locale: DemoLocale = supported(selected) ? selected : "en";
  function href(nextLocale: string = locale, pathname?: string) {
    if (!supported(nextLocale)) throw new Error(`Unsupported demo locale: ${nextLocale}`);
    const target = new URL(url);
    const contentPath =
      pathname ??
      (strategy === "route" && supported(pathLocale)
        ? url.pathname.replace(/^\/(en|de|es|fr)(?=\/|$)/u, "") || "/"
        : url.pathname);
    target.pathname =
      strategy === "route"
        ? `/${nextLocale}${contentPath === "/" ? "" : contentPath}`
        : contentPath;
    if (strategy === "query") target.searchParams.set("locale", nextLocale);
    else target.searchParams.delete("locale");
    if (strategy === "subdomain") target.hostname = target.hostname.replace(/^[^.]+/u, nextLocale);
    if (strategy === "tld")
      target.hostname = target.hostname.replace(
        /\.[^.]+$/u,
        nextLocale === "en" ? ".com" : `.${nextLocale}`,
      );
    return target.href;
  }
  return {
    locale,
    strategy,
    href,
    redirect: strategy === "route" && !supported(pathLocale) ? href(locale) : undefined,
  };
}

/** A language switch starts a new document (ADR-007). */
export function switchDemoLocale(nextLocale: string) {
  const policy = createDemoLocalePolicy(
    new URL(location.href),
    document.cookie,
    navigator.languages.join(","),
  );
  if (policy.strategy === "cookie") {
    document.cookie = `locale=${nextLocale}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  location.assign(policy.href(nextLocale));
}
