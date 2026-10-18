/** POSIX precedence also gives Windows shells a deterministic default. */
export function selectCliLocale(
  environment: NodeJS.ProcessEnv,
  override: string | undefined,
  locales: readonly string[],
  defaultLocale: string,
): string {
  const raw =
    override ??
    [environment.LC_ALL, environment.LC_MESSAGES, environment.LANG].find((value) => value?.trim());
  const tag = raw?.trim().split(/[.@]/u)[0]?.replaceAll("_", "-");
  if (!tag || tag === "C" || tag === "POSIX") return defaultLocale;
  try {
    const canonical = Intl.getCanonicalLocales(tag)[0];
    return (
      locales.find((locale) => locale === canonical) ??
      locales.find((locale) => locale === canonical?.split("-")[0]) ??
      defaultLocale
    );
  } catch {
    return defaultLocale;
  }
}
