/** Returns a configured locale, or undefined when the tag is not supported. */
function matchLocale(tag: string, locales: readonly string[]): string | undefined {
  try {
    const canonical = Intl.getCanonicalLocales(tag)[0];
    return (
      locales.find((locale) => locale === canonical) ??
      locales.find((locale) => locale === canonical?.split("-")[0])
    );
  } catch {
    return undefined;
  }
}

/** POSIX precedence (LC_ALL > LC_MESSAGES > LANG) also gives Windows shells a default. */
export function selectEnvironmentLocale(
  environment: NodeJS.ProcessEnv,
  locales: readonly string[],
  defaultLocale: string,
): string {
  const raw = [environment.LC_ALL, environment.LC_MESSAGES, environment.LANG].find((value) =>
    value?.trim(),
  );
  const tag = raw?.trim().split(/[.@]/u)[0]?.replaceAll("_", "-");
  if (!tag || tag === "C" || tag === "POSIX") return defaultLocale;
  return matchLocale(tag, locales) ?? defaultLocale;
}

/** An explicit `--locale` must be supported; it never falls back silently. */
export function selectOverrideLocale(override: string, locales: readonly string[]) {
  return matchLocale(override.trim(), locales);
}
