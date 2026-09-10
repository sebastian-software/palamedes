/** Bounded formatter storage with a direct bucket for the most recent locale. */
export function createLocaleFormatterCache<TKey, TFormatter>(
  create: (locale: string | undefined, key: TKey) => TFormatter,
  limit = 64,
): (locale: string | undefined, key: TKey) => TFormatter {
  const locales = new Map<string | undefined, Map<TKey, TFormatter>>();
  const entries = new Map<TFormatter, { locale: string | undefined; key: TKey }>();
  let activeLocale: string | undefined;
  let activeBucket: Map<TKey, TFormatter> | undefined;

  return (locale, key) => {
    let bucket = locale === activeLocale ? activeBucket : locales.get(locale);
    const cached = bucket?.get(key);
    if (cached !== undefined) {
      activeLocale = locale;
      activeBucket = bucket;
      return cached;
    }

    // Construct first: a failed Intl constructor must not leave empty buckets.
    const formatter = create(locale, key);
    if (bucket === undefined) {
      bucket = new Map();
      locales.set(locale, bucket);
    }
    bucket.set(key, formatter);
    entries.set(formatter, { locale, key });
    if (entries.size > limit) {
      const oldest = entries.entries().next().value!;
      entries.delete(oldest[0]);
      const entry = oldest[1];
      const oldestBucket = locales.get(entry.locale)!;
      oldestBucket.delete(entry.key);
      if (oldestBucket.size === 0) locales.delete(entry.locale);
    }
    activeLocale = locale;
    activeBucket = bucket;
    return formatter;
  };
}
