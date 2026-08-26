//! Turning a catalog's include/exclude patterns into the set of source files
//! to extract from.
//!
//! Discovery uses [ferralk] for parallel traversal and `globset` for the
//! catalog's public pattern contract. Ferralk has a larger pattern language,
//! so walks start at the literal roots derived from includes, the established
//! `GlobSet`s decide which files survive on worker threads, and only a narrow,
//! equivalent subset of whole-subtree excludes is pushed down for pruning.
//!
//! [ferralk]: https://github.com/sebastian-software/ferralk

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use ferralk::{ErrorPolicy, Verdict, WalkOptions, Walker, WildcardMode};
use globset::{Glob, GlobSet, GlobSetBuilder};

use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;

pub(crate) fn collect_source_files(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<Vec<PathBuf>, CliError> {
    let include_patterns = normalized_include_patterns(catalog, config);
    let exclude_patterns = resolved_exclude_patterns(catalog, config);
    let include = build_glob_set(&include_patterns, "include")?;
    let exclude = build_glob_set(&exclude_patterns, "exclude")?;
    let mut files = Vec::new();

    for root in walk_roots_for_patterns(&include_patterns, &config.root_dir) {
        let mut walker = Walker::new(&root)
            .wildcard_mode(WildcardMode::SeparatorCrossing)
            .match_hidden(true)
            .threads(discovery_threads(config))
            // Recoverable traversal errors are dropped rather than reported,
            // as the `ignore` walk this replaced dropped its `Err` items.
            .error_policy(ErrorPolicy::Skip)
            .options(
                WalkOptions::default()
                    .files_only(true)
                    /*
                     * An unfollowed symlink is neither a listed directory nor
                     * necessarily a source file. Resolve its kind to preserve
                     * the old Path::is_file reading without following links.
                     */
                    .resolve_symlink_kind(true),
            );

        for pattern in safe_prune_patterns(&exclude_patterns, &root) {
            walker = walker
                .exclude(&pattern)
                .map_err(|source| CliError::DiscoveryPattern {
                    pattern: pattern.clone(),
                    source,
                })?;
        }

        // GlobSet remains authoritative and runs on the producing worker.
        // Ferralk may only remove a subtree after the helper below proved its
        // smaller dialect-independent pattern equivalent.
        let result = walker.visit(|entry| {
            if include.is_match(entry.path()) && !exclude.is_match(entry.path()) {
                Verdict::Keep
            } else {
                Verdict::Skip
            }
        })?;
        files.extend(result.entries().iter().map(|entry| entry.path().to_owned()));
    }

    sort_and_dedupe_paths(&mut files);
    Ok(files)
}

/// Whole-subtree excludes which ferralk may safely apply before `GlobSet`.
///
/// This deliberately accepts less than either glob engine: literal components
/// plus a complete `**` component, with `/**` at the end. Those patterns have
/// the same meaning in both engines. Braces, character classes, extglobs,
/// parent traversal, and partial wildcards remain per-file GlobSet checks, so
/// an optimization can never broaden an existing exclude.
fn safe_prune_patterns(patterns: &[String], root: &Path) -> Vec<String> {
    patterns
        .iter()
        .filter_map(|pattern| safe_prune_pattern(pattern, root))
        .collect()
}

fn safe_prune_pattern(pattern: &str, root: &Path) -> Option<String> {
    if root.components().any(|part| part == Component::ParentDir) {
        return None;
    }

    let components = Path::new(pattern).components().collect::<Vec<_>>();
    let first_double_star = components
        .iter()
        .position(|part| matches!(part, Component::Normal(value) if *value == "**"))?;
    if !matches!(components.last(), Some(Component::Normal(value)) if *value == "**") {
        return None;
    }
    if components.iter().any(|part| match part {
        Component::ParentDir => true,
        Component::Normal(value) if *value == "**" => false,
        Component::Normal(value) => value
            .to_string_lossy()
            .contains(['*', '?', '[', ']', '{', '}', '(', ')', '\\']),
        _ => false,
    }) {
        return None;
    }

    let literal_prefix =
        components[..first_double_star]
            .iter()
            .fold(PathBuf::new(), |mut path, part| {
                path.push(part.as_os_str());
                path
            });
    let mut relative = if literal_prefix.starts_with(root) {
        literal_prefix.strip_prefix(root).ok()?.to_path_buf()
    } else if root.starts_with(&literal_prefix) {
        PathBuf::new()
    } else {
        return None;
    };
    for part in &components[first_double_star..] {
        relative.push(part.as_os_str());
    }
    let pattern = relative.to_string_lossy();
    (!pattern.is_empty()).then(|| walker_pattern(&pattern))
}

/// Walker patterns use `/` on every platform and read `\` as an escape.
fn walker_pattern(pattern: &str) -> String {
    if cfg!(windows) {
        pattern.replace('\\', "/")
    } else {
        pattern.to_owned()
    }
}

/// Worker count for discovery: the configured extraction threads, else the
/// machine's parallelism. ferralk keeps small walks serial below its own size
/// floor, so this does not need a threshold of its own.
fn discovery_threads(config: &LoadedConfig) -> usize {
    config
        .extract_threads
        .or_else(|| std::thread::available_parallelism().ok().map(Into::into))
        .unwrap_or(1)
        .max(1)
}

/*
 * Path::cmp compares component-by-component and re-parses both paths on every
 * comparison, which made the former BTreeSet<PathBuf> collection the single
 * most expensive main-thread item after the catalog writes (~25% of
 * main-thread instructions on the realistic benchmark corpus). Sorting on a
 * cached byte key computes the ordering key once per path instead.
 *
 * On Unix the key maps the separator to 0x00, which is below every byte a
 * component can contain, so byte order on the mapped key equals component
 * order and the resulting file order — and with it catalog origin order — is
 * unchanged. Other platforms keep Path's own ordering.
 */
pub(crate) fn sort_and_dedupe_paths<P: AsRef<Path> + Ord>(paths: &mut Vec<P>) {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        paths.sort_by_cached_key(|path| {
            path.as_ref()
                .as_os_str()
                .as_bytes()
                .iter()
                .map(|&byte| if byte == b'/' { 0 } else { byte })
                .collect::<Vec<u8>>()
        });
    }
    #[cfg(not(unix))]
    paths.sort_unstable();
    paths.dedup_by(|left, right| left.as_ref() == right.as_ref());
}

pub(super) fn build_include_set(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<GlobSet, CliError> {
    build_glob_set(&normalized_include_patterns(catalog, config), "include")
}

pub(super) fn normalized_include_patterns(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Vec<String> {
    catalog
        .include
        .iter()
        .map(|pattern| {
            // Collapse `.`/`./` segments so dot paths resolve to a real
            // directory (`.` -> the config root) instead of a literal `/.`
            // fragment that silently matches no source files. Expand bare
            // directories to a recursive source glob; pass through anything
            // that already points at a file or contains glob syntax.
            let resolved: PathBuf = config.resolve_pattern(pattern).components().collect();
            if resolved.is_dir() {
                format!(
                    "{}/**/*.{{js,jsx,ts,tsx,mdx}}",
                    globset::escape(&resolved.to_string_lossy())
                )
            } else {
                resolve_glob_pattern(config, pattern)
            }
        })
        .collect()
}

/// Resolves a catalog glob without letting metacharacters in the project path
/// become part of the caller's pattern. The configured suffix remains a glob;
/// only the absolute root supplied by Palamedes is made literal.
fn resolve_glob_pattern(config: &LoadedConfig, pattern: &str) -> String {
    let escaped_root = globset::escape(&config.root_dir.to_string_lossy());
    PathBuf::from(escaped_root)
        .join(pattern)
        .to_string_lossy()
        .into_owned()
}

fn build_glob_set(patterns: &[String], label: &str) -> Result<GlobSet, CliError> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|source| CliError::GlobPattern {
            pattern: pattern.clone(),
            source,
        })?);
    }
    builder.build().map_err(|source| CliError::GlobPattern {
        pattern: label.to_owned(),
        source,
    })
}

pub(super) fn walk_roots_for_patterns(patterns: &[String], fallback: &Path) -> Vec<PathBuf> {
    let mut roots = BTreeSet::new();
    for pattern in patterns {
        let prefix = PathBuf::from(literal_glob_prefix(pattern));
        let root = if prefix.is_dir() {
            prefix
        } else {
            prefix
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| fallback.to_path_buf())
        };
        roots.insert(root);
    }
    if roots.is_empty() {
        roots.insert(fallback.to_path_buf());
    }
    roots.into_iter().collect()
}

/// Returns the filesystem prefix before the first glob operator. `globset`
/// represents escaped literal metacharacters as bracket expressions, so decode
/// those forms while looking for the first caller-supplied operator.
fn literal_glob_prefix(pattern: &str) -> String {
    let mut prefix = String::new();
    let mut remaining = pattern;
    while !remaining.is_empty() {
        let Some(character) = remaining.chars().next() else {
            break;
        };
        let escaped = match remaining.get(..3) {
            Some("[*]") => Some('*'),
            Some("[?]") => Some('?'),
            Some("[[]") => Some('['),
            Some("[]]") => Some(']'),
            Some("[{]") => Some('{'),
            Some("[}]") => Some('}'),
            _ => None,
        };
        if let Some(literal) = escaped {
            prefix.push(literal);
            remaining = &remaining[3..];
        } else if matches!(character, '*' | '?' | '[' | '{') {
            break;
        } else {
            prefix.push(character);
            remaining = &remaining[character.len_utf8()..];
        }
    }
    prefix
}

pub(super) fn build_exclude_set(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<GlobSet, CliError> {
    build_glob_set(&resolved_exclude_patterns(catalog, config), "exclude")
}

/// The exclude patterns as absolute path globs, in catalog order. Split out of
/// `build_exclude_set` because a walker that prunes during traversal needs the
/// patterns themselves, not only the compiled `GlobSet`.
pub(super) fn resolved_exclude_patterns(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Vec<String> {
    let excludes = if catalog.exclude.is_empty() {
        vec!["**/node_modules/**".to_owned()]
    } else {
        catalog.exclude.clone()
    };
    excludes
        .iter()
        .map(|pattern| resolve_glob_pattern(config, pattern))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::{collect_source_files, sort_and_dedupe_paths};
    use crate::commands::test_support::temp_dir;
    use crate::config::load_config;

    /// A project whose catalog covers `app/`, with the given source files
    /// written underneath it.
    fn project_with_sources(name: &str, relative_paths: &[&str]) -> PathBuf {
        let root = temp_dir(name);
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [app]\n",
        )
        .expect("write config");
        for relative in relative_paths {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().expect("source has a parent"))
                .expect("create source directory");
            fs::write(path, "export const message = 1;").expect("write source");
        }
        root
    }

    fn discovered(root: &Path) -> Vec<PathBuf> {
        let config = load_config(root, Some(&root.join("palamedes.yaml"))).expect("load config");
        collect_source_files(&config.catalogs[0], &config).expect("collect sources")
    }

    /*
     * Sources under a hidden directory are discoverable and have to stay that
     * way: generated route types land in `site/.react-router/`, and 179 of this
     * repository's own catalog files live there. A walker whose wildcards
     * refuse a leading period drops every one of them silently, and this suite
     * had no test that would have noticed -- which is the reason this one
     * exists and asserts the discovered list rather than a count.
     *
     * Since the includes moved onto the walker this test is load-bearing:
     * turning `Walker::match_hidden` off drops three of the four files below
     * and fails here, which is the whole reason it was written.
     */
    #[test]
    fn discovers_sources_under_hidden_directories() {
        let root = project_with_sources(
            "hidden-sources",
            &[
                "app/page.tsx",
                "app/.react-router/types/+routes.ts",
                "app/.hidden-source.ts",
                "app/nested/.generated/view.tsx",
            ],
        );

        assert_eq!(
            discovered(&root),
            vec![
                root.join("app/.hidden-source.ts"),
                root.join("app/.react-router/types/+routes.ts"),
                root.join("app/nested/.generated/view.tsx"),
                root.join("app/page.tsx"),
            ]
        );
    }

    #[test]
    fn treats_glob_metacharacters_in_the_project_path_as_literals() {
        for name in ["bracket[project]", "brace{project}"] {
            let root = project_with_sources(name, &["app/page.tsx", "app/nested/deep.tsx"]);

            assert_eq!(
                discovered(&root),
                vec![root.join("app/nested/deep.tsx"), root.join("app/page.tsx")],
                "{name}"
            );
        }
    }

    /*
     * A catalog pattern is a `globset` pattern, and `globset` as palamedes
     * builds it lets an ordinary wildcard cross a separator, so a single-star
     * include reaches a nested file. palamedes' own generated patterns are all
     * `**`-rooted and cannot tell the two readings apart -- only a hand-written
     * include like this one can, which is why the case is a fixture rather than
     * something the real trees would have caught.
     */
    /*
     * Windows spells a resolved catalog pattern with `\\`, which the walker
     * reads as an escape rather than a separator. The respelling has to happen
     * there and must not happen on Unix, where a backslash is a legal
     * character in a filename.
     */
    #[test]
    fn respells_walker_patterns_only_where_the_separator_is_a_backslash() {
        let windows_shape = r"C:\repo\app\**\*.tsx";
        assert_eq!(
            super::walker_pattern(windows_shape),
            if cfg!(windows) {
                "C:/repo/app/**/*.tsx"
            } else {
                windows_shape
            }
        );
        assert_eq!(super::walker_pattern("/repo/app/**"), "/repo/app/**");
    }

    #[test]
    fn only_equivalent_whole_subtree_patterns_are_pushed_down() {
        let root = temp_dir("safe-prune");
        let app = root.join("app");
        let default = format!("{}/**/node_modules/**", root.to_string_lossy());
        let custom = format!("{}/app/generated/**", root.to_string_lossy());

        assert_eq!(
            super::safe_prune_pattern(&default, &app).as_deref(),
            Some("**/node_modules/**")
        );
        assert_eq!(
            super::safe_prune_pattern(&custom, &app).as_deref(),
            Some("generated/**")
        );
        for unsafe_pattern in [
            format!("{}/**/@(foo|bar)/**", root.to_string_lossy()),
            format!("{}/**/[[:digit:]]/**", root.to_string_lossy()),
            format!("{}/**/{{,foo}}/**", root.to_string_lossy()),
            format!("{}/**/generated*/**", root.to_string_lossy()),
        ] {
            assert_eq!(super::safe_prune_pattern(&unsafe_pattern, &app), None);
        }
        assert_eq!(
            super::safe_prune_pattern(&default, &root.join("app/../api")),
            None
        );
    }

    #[test]
    fn a_single_star_include_reaches_nested_files() {
        let root = temp_dir("crossing-wildcard");
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: ['app/*.tsx']\n",
        )
        .expect("write config");
        for relative in ["app/page.tsx", "app/nested/deep.tsx", "app/skipped.ts"] {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().expect("source has a parent"))
                .expect("create source directory");
            fs::write(path, "export const message = 1;").expect("write source");
        }

        assert_eq!(
            discovered(&root),
            vec![root.join("app/nested/deep.tsx"), root.join("app/page.tsx")]
        );
    }

    #[test]
    fn ferralk_only_syntax_does_not_expand_include_patterns() {
        for (name, pattern, expanded, selected) in [
            (
                "extglob-include",
                "app/@(foo|bar).ts",
                &["app/foo.ts", "app/bar.ts"][..],
                &[][..],
            ),
            (
                "posix-include",
                "app/[[:digit:]].ts",
                &["app/1.ts"][..],
                &[][..],
            ),
            (
                "brace-include",
                "app/{,foo}.ts",
                &["app/.ts", "app/foo.ts"][..],
                &["app/foo.ts"][..],
            ),
        ] {
            let root = temp_dir(name);
            fs::write(
                root.join("palamedes.yaml"),
                format!(
                    "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{{locale}}/messages\n    include: ['{pattern}']\n"
                ),
            )
            .expect("write config");
            for relative in expanded {
                let path = root.join(relative);
                fs::create_dir_all(path.parent().expect("source has a parent"))
                    .expect("create source directory");
                fs::write(path, "export const message = 1;").expect("write source");
            }

            let expected = selected
                .iter()
                .map(|relative| root.join(relative))
                .collect::<Vec<_>>();
            assert_eq!(discovered(&root), expected, "{pattern}");
        }
    }

    #[test]
    fn ferralk_only_syntax_does_not_expand_exclude_patterns() {
        for (name, pattern, expanded) in [
            (
                "extglob-exclude",
                "app/@(foo|bar).ts",
                &["app/foo.ts", "app/bar.ts"][..],
            ),
            ("posix-exclude", "app/[[:digit:]].ts", &["app/1.ts"][..]),
            (
                "brace-exclude",
                "app/{,foo}.ts",
                &["app/.ts", "app/foo.ts"][..],
            ),
        ] {
            let mut sources = vec!["app/keeper.ts"];
            sources.extend_from_slice(expanded);
            let root = project_with_sources(name, &sources);
            fs::write(
                root.join("palamedes.yaml"),
                format!(
                    "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{{locale}}/messages\n    include: [app]\n    exclude: ['{pattern}']\n"
                ),
            )
            .expect("write config");
            let mut expected = sources
                .iter()
                .filter(|relative| match pattern {
                    "app/{,foo}.ts" => **relative != "app/foo.ts",
                    _ => true,
                })
                .map(|relative| root.join(relative))
                .collect::<Vec<_>>();
            expected.sort();

            assert_eq!(discovered(&root), expected, "{pattern}");
        }
    }

    /*
     * The three symlink cases. `WalkOptions::files_only` drops entries reported
     * as directories, and an unfollowed symlink reports `is_dir = false`, so all
     * three survive it, and only following the link tells them apart.
     *
     * All three hold through `resolve_symlink_kind`, which is why that option
     * is set rather than a filter written here. The two negative cases were
     * `#[ignore]`d while ferralk#89 was open and went green unchanged when it
     * landed.
     *
     * Unix-only: creating a symlink on Windows needs a privilege CI does not
     * grant.
     */
    #[cfg(unix)]
    #[test]
    fn includes_a_symlink_that_points_at_a_source_file() {
        let root = project_with_sources("symlink-to-file", &["app/page.tsx"]);
        std::os::unix::fs::symlink(root.join("app/page.tsx"), root.join("app/linked.tsx"))
            .expect("create symlink");

        assert_eq!(
            discovered(&root),
            vec![root.join("app/linked.tsx"), root.join("app/page.tsx")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn excludes_a_symlink_whose_target_is_missing() {
        let root = project_with_sources("broken-symlink", &["app/page.tsx"]);
        std::os::unix::fs::symlink(root.join("app/gone.tsx"), root.join("app/broken.tsx"))
            .expect("create symlink");

        assert_eq!(discovered(&root), vec![root.join("app/page.tsx")]);
    }

    /*
     * The link is named like a source and points at a directory. It is not a
     * source, and the directory behind it is not descended either -- the files
     * below are found through the real path instead, exactly once.
     */
    #[cfg(unix)]
    #[test]
    fn excludes_a_symlink_that_points_at_a_directory() {
        let root = project_with_sources(
            "symlink-to-directory",
            &["app/page.tsx", "app/nested/deep.tsx"],
        );
        std::os::unix::fs::symlink(root.join("app/nested"), root.join("app/linked.tsx"))
            .expect("create symlink");

        assert_eq!(
            discovered(&root),
            vec![root.join("app/nested/deep.tsx"), root.join("app/page.tsx")]
        );
    }

    // The counterpart: a hidden directory is not special to the *exclude*
    // either. A `node_modules` nested under a dot directory stays excluded,
    // whether the walker prunes it or the GlobSet rejects it per file.
    #[test]
    fn excludes_dependencies_nested_under_hidden_directories() {
        let root = project_with_sources(
            "hidden-dependencies",
            &[
                "app/page.tsx",
                "app/node_modules/dep/index.ts",
                "app/.cache/node_modules/dep/index.ts",
            ],
        );

        assert_eq!(discovered(&root), vec![root.join("app/page.tsx")]);
    }

    /*
     * The byte-key sort must reproduce Path::cmp's component order exactly,
     * including the case where a directory name is a prefix of a sibling's
     * ("app" vs "app-shared"): plain byte order on the unmapped path would put
     * "app-shared" first because '-' sorts below '/'.
     */
    #[test]
    fn sorts_in_component_order_and_dedupes() {
        let mut paths = vec![
            PathBuf::from("/repo/app-shared/x.ts"),
            PathBuf::from("/repo/app/y.ts"),
            PathBuf::from("/repo/app/y.ts"),
            PathBuf::from("/repo/app.ts"),
            PathBuf::from("/repo/app/b-c/d.ts"),
            PathBuf::from("/repo/app/b.ts"),
        ];
        let mut expected = paths.clone();
        expected.sort();
        expected.dedup();

        sort_and_dedupe_paths(&mut paths);

        assert_eq!(paths, expected);
    }
}
