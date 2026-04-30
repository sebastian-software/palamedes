export function useClientLocale<TLocale>(
  locale: TLocale,
  sync: (locale: TLocale) => unknown
): void {
  void sync(locale)
}
