import path from "node:path";
import picomatch from "picomatch";

/**
 * Source filter accepted by every first-party adapter's `include` and
 * `exclude` options.
 *
 * A string is a glob. Relative globs resolve from the adapter's
 * `projectRoot`; absolute globs and globs that start with `**` match as
 * written. A RegExp is tested against the normalized absolute file path.
 * `null` and `undefined` mean "no pattern". This is the same contract as
 * Vite's `FilterPattern` and `createFilter()`.
 */
export type PalamedesFilterPattern =
  | string
  | RegExp
  | ReadonlyArray<string | RegExp>
  | null
  | undefined;

/** Options for {@link createPalamedesSourceFilter}. */
export type PalamedesSourceFilterOptions = {
  /** Directory that relative glob patterns resolve from. */
  projectRoot: string;
};

/** Return whether a module ID passes the configured `include`/`exclude` filter. */
export type PalamedesSourceFilter = (id: string) => boolean;

/**
 * Resolve an adapter's `projectRoot` option. Relative values resolve from the
 * current working directory; an unset value uses `fallback`.
 */
export function resolvePalamedesProjectRoot(
  projectRoot: string | undefined,
  fallback: string = process.cwd(),
): string {
  return path.resolve(projectRoot ?? fallback);
}

/**
 * Resolve an adapter's `configPath` option against its project root.
 *
 * Every adapter uses this rule: a relative `configPath` resolves from
 * `projectRoot`, and an absolute one stays as written. Returns `undefined`
 * when no config path is set, so callers keep automatic config discovery.
 */
export function resolvePalamedesConfigPath(
  projectRoot: string,
  configPath: string | undefined,
): string | undefined {
  if (configPath === undefined || configPath === "") {
    return undefined;
  }
  return path.resolve(projectRoot, configPath);
}

function toPatternList(pattern: PalamedesFilterPattern): ReadonlyArray<string | RegExp> {
  if (pattern == null) {
    return [];
  }
  return typeof pattern === "string" || pattern instanceof RegExp ? [pattern] : pattern;
}

function normalizeFilterPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function escapeGlobBase(value: string): string {
  return value.replace(/[-^$*+?.()|[\]{}]/g, "\\$&");
}

function globMatcherSource(pattern: string, projectRoot: string): string {
  if (path.isAbsolute(pattern) || pattern.startsWith("**")) {
    return normalizeFilterPath(pattern);
  }
  return path.posix.join(
    escapeGlobBase(normalizeFilterPath(projectRoot)),
    normalizeFilterPath(pattern),
  );
}

type Matcher = (id: string) => boolean;

function createMatcher(pattern: string | RegExp, projectRoot: string): Matcher {
  if (pattern instanceof RegExp) {
    return (id) => {
      pattern.lastIndex = 0;
      const matched = pattern.test(id);
      pattern.lastIndex = 0;
      return matched;
    };
  }
  return picomatch(globMatcherSource(pattern, projectRoot), { dot: true });
}

/**
 * Create the shared `include`/`exclude` source filter.
 *
 * IDs are normalized to forward slashes before matching. IDs that contain a
 * NUL byte (virtual modules) never match. An exclude match wins over an
 * include match, and an empty include list accepts every ID that is not
 * excluded.
 */
export function createPalamedesSourceFilter(
  include: PalamedesFilterPattern,
  exclude: PalamedesFilterPattern,
  options: PalamedesSourceFilterOptions,
): PalamedesSourceFilter {
  const projectRoot = path.resolve(options.projectRoot);
  const includeMatchers = toPatternList(include).map((pattern) =>
    createMatcher(pattern, projectRoot),
  );
  const excludeMatchers = toPatternList(exclude).map((pattern) =>
    createMatcher(pattern, projectRoot),
  );

  return (id) => {
    if (typeof id !== "string" || id.includes("\0")) {
      return false;
    }
    const normalized = normalizeFilterPath(id);
    if (excludeMatchers.some((matches) => matches(normalized))) {
      return false;
    }
    return includeMatchers.length === 0 || includeMatchers.some((matches) => matches(normalized));
  };
}
