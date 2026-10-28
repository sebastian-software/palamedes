/**
 * Migration errors for host options that Palamedes v2 removed or renamed.
 *
 * Every first-party adapter rejects these options through
 * `assertNoRemovedPalamedesOptions()`, so a JavaScript caller that still passes
 * one sees the same message on every surface.
 */
export const REMOVED_PALAMEDES_OPTION_MESSAGES = {
  failOnCompileError:
    "Palamedes v2 removed failOnCompileError: invalid ICU always fails compilation. Remove the option; use failOnMissing for translation completeness.",
  keepSourceFallbacks:
    "Palamedes v2 renamed keepSourceFallbacks to includeSourceMetadata: it only adds diagnostic source metadata. Rename the option; the default stays false.",
  stripMessageField:
    "Palamedes v2 removed stripMessageField: use includeSourceMetadata instead, with the inverse value. Remove the option; source metadata is already omitted by default.",
  messageSplitting:
    "Palamedes v2 removed messageSplitting: compiled catalogs are delivered automatically. Remove the option.",
  experimentalGraphSplitting:
    "Palamedes v2 removed experimentalGraphSplitting: compiled catalogs are delivered automatically through an import map. Remove the option, including any localeBinding setting.",
  cwd: "Palamedes v2 renamed cwd to projectRoot: relative configPath values and include/exclude globs resolve from it. Rename the option; the Vite plugin defaults it to Vite's root.",
} as const;

export type RemovedPalamedesOption = keyof typeof REMOVED_PALAMEDES_OPTION_MESSAGES;

/**
 * Throw the v2 migration error when `options` sets one of the named removed
 * options to any value other than `undefined`.
 */
export function assertNoRemovedPalamedesOptions(
  options: object | null | undefined,
  names: readonly RemovedPalamedesOption[],
): void {
  if (options == null) {
    return;
  }
  const record = options as Record<string, unknown>;
  for (const name of names) {
    if (record[name] !== undefined) {
      throw new Error(REMOVED_PALAMEDES_OPTION_MESSAGES[name]);
    }
  }
}
