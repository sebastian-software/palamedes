//! Catalog source discovery and watch matching use Ferralk's walker dialect.
//! Includes select hidden paths and ordinary wildcards cross separators. The
//! same normalized absolute patterns feed traversal and watch-event matching.

use std::borrow::Cow;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use ferralk::ferralk_glob::{Pattern, PatternOptions, PatternSet, escape_str};
use ferralk::{ErrorPolicy, Verdict, Walker};

use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;

pub(crate) fn collect_source_files(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<Vec<PathBuf>, CliError> {
    let includes = normalized_include_patterns(catalog, config);
    let excludes = resolved_exclude_patterns(catalog, config);
    let include = build_pattern_set(&includes)?;
    let exclude = build_pattern_set(&excludes)?;
    if includes.is_empty() {
        return Ok(Vec::new());
    }
    let subtree_excludes = build_subtree_excludes(&excludes)?;
    let mut files = Vec::new();
    for root in walk_roots_for_patterns(&includes, &config.root_dir) {
        // Narrow literal roots preserve explicitly included directory symlinks.
        // Absolute PatternSet matching also handles config-wide excludes whose
        // wildcard lies above a root and cannot be passed to Walker::exclude.
        let result = Walker::new(root)
            .threads(discovery_threads(config))
            .error_policy(ErrorPolicy::Skip)
            .visit(|entry| {
                let path = entry.path();
                let excluded = matches_source_pattern(&exclude, path);
                if entry.is_dir() {
                    let bytes = source_path_bytes(path);
                    if subtree_excludes
                        .iter()
                        .any(|(root, full)| root.is_match(&bytes) && full.is_match(&bytes))
                    {
                        Verdict::Prune
                    } else {
                        Verdict::Skip
                    }
                } else if !excluded
                    && matches_source_pattern(&include, path)
                    && (!entry.is_symlink() || path.is_file())
                {
                    Verdict::Keep
                } else {
                    Verdict::Skip
                }
            })?;
        let (entries, _) = result.into_parts();
        files.extend(entries.into_iter().map(ferralk::WalkEntry::into_path));
    }
    sort_and_dedupe_paths(&mut files);
    Ok(files)
}

/// A terminal, unescaped `/**` covers descendants only when both the prefix
/// and full exclude match the directory. Ferralk uses the same two conditions
/// for subtree coverage. All syntax is compiled by the same native matcher.
fn build_subtree_excludes(patterns: &[String]) -> Result<Vec<(Pattern, Pattern)>, CliError> {
    patterns
        .iter()
        .filter_map(|pattern| {
            pattern
                .strip_suffix("/**")
                .filter(|root| {
                    root.bytes().rev().take_while(|byte| *byte == b'\\').count() % 2 == 0
                })
                .map(|root| {
                    Ok((
                        compile_source_pattern(root)?,
                        compile_source_pattern(pattern)?,
                    ))
                })
        })
        .collect()
}

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
) -> Result<PatternSet, CliError> {
    build_pattern_set(&normalized_include_patterns(catalog, config))
}

pub(super) fn build_exclude_set(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<PatternSet, CliError> {
    build_pattern_set(&resolved_exclude_patterns(catalog, config))
}

fn compile_source_pattern(pattern: &str) -> Result<Pattern, CliError> {
    Pattern::compile(pattern, PatternOptions::walker().match_hidden(true)).map_err(|source| {
        CliError::DiscoveryPattern {
            pattern: pattern.to_owned(),
            source,
        }
    })
}

fn build_pattern_set(patterns: &[String]) -> Result<PatternSet, CliError> {
    patterns
        .iter()
        .map(|pattern| compile_source_pattern(pattern))
        .collect()
}

fn source_path_bytes(path: &Path) -> Cow<'_, [u8]> {
    #[cfg(windows)]
    {
        Cow::Owned(path.to_string_lossy().replace('\\', "/").into_bytes())
    }
    #[cfg(not(windows))]
    {
        Cow::Borrowed(path.as_os_str().as_encoded_bytes())
    }
}

pub(super) fn matches_source_pattern(set: &PatternSet, path: &Path) -> bool {
    set.is_match(source_path_bytes(path))
}

pub(super) fn normalized_include_patterns(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Vec<String> {
    catalog
        .include
        .iter()
        .map(|pattern| {
            let resolved: PathBuf = config.resolve_pattern(pattern).components().collect();
            if resolved.is_dir() {
                // Keep parent components: `link/..` follows filesystem symlink
                // semantics and remains the spelling used by watch aliases.
                format!(
                    "{}/**/*.{{js,jsx,ts,tsx,mdx,vue,svelte}}",
                    escape_root_for_glob(&resolved)
                )
            } else {
                resolve_glob_pattern(config, pattern)
            }
        })
        .collect()
}

/// Only the root held by Palamedes is escaped; the configured suffix remains
/// Ferralk syntax. Patterns use `/` on every platform, with `\` for escapes.
fn resolve_glob_pattern(config: &LoadedConfig, pattern: &str) -> String {
    if Path::new(pattern).is_absolute() {
        return pattern.to_owned();
    }
    format!(
        "{}/{pattern}",
        escape_root_for_glob(&config.root_dir).trim_end_matches('/')
    )
}

fn escape_root_for_glob(root: &Path) -> String {
    let root: PathBuf = root.components().collect();
    let root = root.to_string_lossy();
    if cfg!(windows) {
        escape_str(&root.replace('\\', "/"))
    } else {
        escape_str(&root)
    }
}

pub(super) fn walk_roots_for_patterns(patterns: &[String], fallback: &Path) -> Vec<PathBuf> {
    let mut roots = BTreeSet::new();
    for pattern in patterns {
        let literal = literal_glob_prefix(pattern);
        let complete_component = literal.ends_with('/');
        let prefix = PathBuf::from(literal);
        let root = if complete_component {
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

/// Decode Ferralk escapes until the first wildcard, class, brace or extglob.
/// The prefix selects a walk/watch root, never decides whether a file matches.
fn literal_glob_prefix(pattern: &str) -> String {
    let mut prefix = String::new();
    let mut characters = pattern.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\\' {
            if let Some(literal) = characters.next() {
                prefix.push(literal);
            }
        } else if matches!(character, '*' | '?' | '[' | '{')
            || (matches!(character, '@' | '+' | '!') && characters.peek() == Some(&'('))
        {
            break;
        } else {
            prefix.push(character);
        }
    }
    prefix
}

fn resolved_exclude_patterns(catalog: &ConfigCatalog, config: &LoadedConfig) -> Vec<String> {
    if catalog.exclude.is_empty() {
        vec![resolve_glob_pattern(config, "**/node_modules/**")]
    } else {
        catalog
            .exclude
            .iter()
            .map(|pattern| resolve_glob_pattern(config, pattern))
            .collect()
    }
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

    #[cfg(unix)]
    #[test]
    fn treats_a_backslash_in_the_project_path_as_a_literal() {
        let root = project_with_sources("back\\slash-project", &["app/page.tsx"]);

        assert_eq!(discovered(&root), vec![root.join("app/page.tsx")]);
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
    fn absolute_and_overlapping_includes_are_sorted_and_deduplicated() {
        let root = project_with_sources(
            "absolute-overlapping[includes]",
            &["app/page.tsx", "app/nested/deep.tsx", "app/other.ts"],
        );
        let mut config = load_config(&root, None).expect("load config");
        config.catalogs[0].include = vec![
            format!("{}/*.tsx", super::escape_root_for_glob(&root.join("app"))),
            "app/nested".to_owned(),
            "app/page.tsx".to_owned(),
        ];

        assert_eq!(
            collect_source_files(&config.catalogs[0], &config).expect("collect sources"),
            vec![root.join("app/nested/deep.tsx"), root.join("app/page.tsx")]
        );
    }

    #[test]
    fn a_partial_component_prefix_never_becomes_a_directory_root() {
        let root = project_with_sources("colliding-prefix", &["app/fooa.tsx", "app/foob.tsx"]);
        fs::create_dir(root.join("app/foo")).expect("unrelated colliding directory");
        let mut config = load_config(&root, None).expect("config");
        for pattern in [
            "app/foo@(a|b).tsx".to_owned(),
            "app/foo*.tsx".to_owned(),
            format!(
                "{}/foo@(a|b).tsx",
                super::escape_root_for_glob(&root.join("app"))
            ),
        ] {
            config.catalogs[0].include = vec![pattern.clone()];
            assert_eq!(
                collect_source_files(&config.catalogs[0], &config).expect("sources"),
                vec![root.join("app/fooa.tsx"), root.join("app/foob.tsx")],
                "{pattern}"
            );
        }
    }

    #[test]
    fn custom_excludes_replace_the_default_and_filter_partial_patterns() {
        let root = project_with_sources(
            "custom-excludes",
            &[
                "app/page.tsx",
                "app/page.test.tsx",
                "app/generated/route.tsx",
                "app/.cache/generated/route.tsx",
                "app/node_modules/dep/index.ts",
            ],
        );
        let mut config = load_config(&root, None).expect("load config");
        config.catalogs[0].exclude = vec!["**/*.test.tsx".to_owned(), "**/generated/**".to_owned()];

        assert_eq!(
            collect_source_files(&config.catalogs[0], &config).expect("collect sources"),
            vec![
                root.join("app/node_modules/dep/index.ts"),
                root.join("app/page.tsx")
            ]
        );
    }

    #[test]
    fn leading_bang_and_escaped_brackets_remain_literal() {
        let root = project_with_sources(
            "literal-pattern-syntax",
            &["!app/page.tsx", "app/[draft].tsx", "app/d.tsx"],
        );
        let mut config = load_config(&root, None).expect("load config");
        config.catalogs[0].include = vec!["!app/*.tsx".to_owned(), r"app/\[draft\].tsx".to_owned()];

        assert_eq!(
            collect_source_files(&config.catalogs[0], &config).expect("collect sources"),
            vec![root.join("!app/page.tsx"), root.join("app/[draft].tsx")]
        );
    }

    #[test]
    fn invalid_include_and_exclude_patterns_report_the_rejected_glob() {
        let root = project_with_sources("invalid-source-pattern", &["app/page.tsx"]);
        for exclude in [false, true] {
            let mut config = load_config(&root, None).expect("load config");
            let patterns = if exclude {
                &mut config.catalogs[0].exclude
            } else {
                &mut config.catalogs[0].include
            };
            *patterns = vec!["app/[".to_owned()];
            let error =
                collect_source_files(&config.catalogs[0], &config).expect_err("invalid glob");
            match error {
                crate::error::CliError::DiscoveryPattern { pattern, source } => {
                    assert!(pattern.ends_with("app/["), "{pattern}");
                    assert_eq!(source.offset(), pattern.len() - 1);
                }
                other => panic!("expected a glob diagnostic, got {other}"),
            }
        }
    }

    #[test]
    fn missing_include_roots_produce_an_empty_source_set() {
        let root = project_with_sources("missing-source-root", &["app/page.tsx"]);
        let mut config = load_config(&root, None).expect("load config");
        config.catalogs[0].include = vec!["missing/nested/**/*.tsx".to_owned()];
        assert!(
            collect_source_files(&config.catalogs[0], &config)
                .expect("collect sources")
                .is_empty()
        );
    }

    #[test]
    fn discovers_outside_config_sources_from_relative_and_absolute_roots() {
        let fixture = tempfile::tempdir().expect("fixture");
        let root = fixture.path().join("web");
        fs::create_dir_all(&root).expect("create config root");
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [../shared]\n",
        )
        .expect("write config");
        let shared = fixture.path().join("shared[app]");
        fs::create_dir_all(shared.join(".generated")).expect("create external sources");
        fs::write(shared.join("page.tsx"), "").expect("source");
        fs::write(shared.join(".generated/route.tsx"), "").expect("hidden source");
        let mut config = load_config(&root, None).expect("load config");
        for include in [
            "../shared[app]".to_owned(),
            r"../shared\[app\]/**/*.tsx".to_owned(),
            format!("{}/**/*.tsx", super::escape_root_for_glob(&shared)),
        ] {
            config.catalogs[0].include = vec![include.clone()];
            let spelling = if Path::new(&include).is_absolute() {
                shared.clone()
            } else {
                root.join("../shared[app]")
            };
            let expected = vec![
                spelling.join(".generated/route.tsx"),
                spelling.join("page.tsx"),
            ];
            assert_eq!(
                collect_source_files(&config.catalogs[0], &config)
                    .expect("collect external sources"),
                expected,
                "{include}"
            );
        }
    }

    #[test]
    fn empty_includes_never_turn_into_an_unfiltered_walk() {
        let root = project_with_sources("empty-includes", &["app/page.tsx"]);
        let mut config = load_config(&root, None).expect("load config");
        config.catalogs[0].include.clear();
        assert!(
            collect_source_files(&config.catalogs[0], &config)
                .expect("empty sources")
                .is_empty()
        );
    }

    #[test]
    fn config_parent_segments_do_not_change_the_exclude_pattern_space() {
        let root = project_with_sources(
            "config-parent-segments",
            &["app/page.tsx", "app/node_modules/dep/index.tsx"],
        );
        let config = load_config(&root, Some(&root.join("app/../palamedes.yaml"))).expect("config");
        assert_eq!(
            collect_source_files(&config.catalogs[0], &config).expect("sources"),
            vec![config.root_dir.join("app/page.tsx")]
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_patterns_use_forward_slashes_and_backslashes_escape_syntax() {
        let root = project_with_sources(
            "windows-native-patterns",
            &["app/page.tsx", "app/nested/deep.tsx", "app/nested/skip.tsx"],
        );
        let mut config = load_config(&root, None).expect("load config");
        config.catalogs[0].include = vec!["app/*.tsx".to_owned()];
        config.catalogs[0].exclude = vec!["app/*/skip.tsx".to_owned()];
        assert_eq!(
            collect_source_files(&config.catalogs[0], &config).expect("collect sources"),
            vec![root.join("app/nested/deep.tsx"), root.join("app/page.tsx")],
        );
        config.catalogs[0].include = vec![r"app\*.tsx".to_owned()];
        assert!(
            collect_source_files(&config.catalogs[0], &config)
                .expect("escaped literal star")
                .is_empty()
        );
    }

    /// Characterization only: no timing threshold. Fixture setup is outside
    /// the samples; every collected path is checked against the same oracle.
    #[test]
    #[ignore = "run explicitly to compare source-discovery dependency versions"]
    fn measure_source_discovery() {
        use std::time::Instant;

        let fixture = tempfile::tempdir().expect("benchmark directory");
        let root = fixture.path();
        fs::write(root.join("palamedes.yaml"), "locales: [en, de]\nsource-locale: en\nextract-threads: 4\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [app]\n").expect("write config");
        let mut expected = Vec::new();
        for directory in 0..100 {
            for (subtree, selected) in [
                ("src", true),
                (".generated", true),
                ("node_modules/dep", false),
            ] {
                let directory = root.join(format!("app/feature-{directory}/{subtree}"));
                fs::create_dir_all(&directory).expect("create benchmark directory");
                for file in 0..30 {
                    let path = directory.join(format!("view-{file}.tsx"));
                    fs::write(&path, "export const message = 1;").expect("write benchmark source");
                    if selected {
                        expected.push(path);
                    }
                }
            }
        }
        super::sort_and_dedupe_paths(&mut expected);
        let config = load_config(root, None).expect("load config");
        for _ in 0..5 {
            assert_eq!(
                collect_source_files(&config.catalogs[0], &config).expect("warmup"),
                expected
            );
        }
        let mut samples = Vec::new();
        for _ in 0..30 {
            let start = Instant::now();
            let actual = collect_source_files(&config.catalogs[0], &config).expect("measurement");
            samples.push(start.elapsed().as_micros());
            assert_eq!(actual, expected);
        }
        println!(
            "source-discovery: files={}, micros={samples:?}",
            expected.len()
        );
    }

    #[test]
    fn native_pattern_syntax_selects_extglobs_posix_classes_and_empty_braces() {
        for (name, pattern, expanded, selected) in [
            (
                "extglob-include",
                "app/@(foo|bar).ts",
                &["app/foo.ts", "app/bar.ts"][..],
                &["app/foo.ts", "app/bar.ts"][..],
            ),
            (
                "posix-include",
                "app/[[:digit:]].ts",
                &["app/1.ts"][..],
                &["app/1.ts"][..],
            ),
            (
                "brace-include",
                "app/{,foo}.ts",
                &["app/.ts", "app/foo.ts"][..],
                &["app/.ts", "app/foo.ts"][..],
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

            let mut expected = selected
                .iter()
                .map(|relative| root.join(relative))
                .collect::<Vec<_>>();
            expected.sort();
            assert_eq!(discovered(&root), expected, "{pattern}");
        }
    }

    #[test]
    fn native_exclude_patterns_filter_extglobs_posix_classes_and_empty_braces() {
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
            let expected = vec![root.join("app/keeper.ts")];

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
    fn an_explicit_directory_symlink_is_a_source_root_without_following_nested_links() {
        let fixture = tempfile::tempdir().expect("fixture");
        let root = project_with_sources("explicit-symlink-root", &["app/page.tsx"]);
        fs::create_dir_all(fixture.path().join("nested")).expect("external directory");
        fs::write(fixture.path().join("page.tsx"), "").expect("external source");
        fs::write(fixture.path().join("nested/deep.tsx"), "").expect("nested source");
        std::os::unix::fs::symlink(fixture.path().join("nested"), fixture.path().join("alias"))
            .expect("nested directory link");
        std::os::unix::fs::symlink(fixture.path(), root.join("linked")).expect("source root link");
        let mut config = load_config(&root, None).expect("config");
        config.catalogs[0].include = vec!["linked".to_owned()];
        assert_eq!(
            collect_source_files(&config.catalogs[0], &config).expect("sources"),
            vec![
                root.join("linked/nested/deep.tsx"),
                root.join("linked/page.tsx")
            ]
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
    // whether it is pruned as a subtree or filtered as a file.
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
