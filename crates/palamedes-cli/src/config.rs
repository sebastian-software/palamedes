use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use ::config as config_rs;
use palamedes::{
    CatalogArtifactConfig, CatalogConfig, FallbackLocales, MdxOptions, PalamedesCatalogFormat,
    PoLineBreaks, PoOutputOptions,
};
use serde::Deserialize;
use thiserror::Error;

pub const CONFIG_FILENAME: &str = "palamedes.yaml";
pub const CONFIG_FILENAMES: &[&str] = &[
    CONFIG_FILENAME,
    "palamedes.yml",
    "palamedes.json",
    "palamedes.toml",
];

/// JS/TS config files the JS plugin loaders can read but the native CLI
/// cannot. Detected only to produce a specific error instead of the generic
/// "could not find a config".
const JS_CONFIG_FILENAMES: &[&str] = &[
    "palamedes.config.ts",
    "palamedes.config.js",
    "palamedes.config.mjs",
    "palamedes.config.cjs",
];

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Could not find a Palamedes config. Expected one of palamedes.yaml, palamedes.yml, palamedes.json, palamedes.toml.")]
    NotFound,
    #[error("Found {path}, but the native pmds CLI cannot load JavaScript/TypeScript configs. Create a palamedes.yaml (or .yml/.json/.toml) config for the CLI; the JS plugin loaders keep reading the existing file.")]
    JsConfigUnsupported { path: PathBuf },
    #[error("Palamedes config does not exist: {path}")]
    MissingExplicit { path: PathBuf },
    #[error("Could not parse Palamedes config {path}: {source}")]
    Parse {
        path: PathBuf,
        #[source]
        source: Box<config_rs::ConfigError>,
    },
    #[error("Invalid Palamedes config in {path}: {message}")]
    Invalid { path: PathBuf, message: String },
}

#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub config_path: PathBuf,
    pub root_dir: PathBuf,
    pub source_reference_root: PathBuf,
    pub reference_scopes: bool,
    pub locales: Vec<String>,
    pub source_locale: String,
    pub fallback_locales: Option<ConfigFallbackLocales>,
    pub pseudo_locale: Option<String>,
    pub catalogs: Vec<ConfigCatalog>,
    /// Shared MDX extraction and compilation semantics.
    pub mdx: MdxOptions,
    /// Worker threads for the parallel extraction pass; `None` uses the
    /// measured default in the core.
    pub extract_threads: Option<usize>,
    /// Whether extraction may reuse the on-disk cache.
    pub extract_cache: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ConfigCatalog {
    pub path: String,
    #[serde(default)]
    pub format: PalamedesCatalogFormat,
    #[serde(default)]
    pub po: Option<ConfigPoOutputOptions>,
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub struct ConfigPoOutputOptions {
    #[serde(default, alias = "line_breaks")]
    pub line_breaks: PoLineBreaks,
}

impl From<ConfigPoOutputOptions> for PoOutputOptions {
    fn from(value: ConfigPoOutputOptions) -> Self {
        Self {
            line_breaks: value.line_breaks,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ConfigFallbackLocales {
    Shared(Vec<String>),
    PerLocale(BTreeMap<String, Vec<String>>),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct RawConfig {
    locales: Vec<String>,
    #[serde(alias = "source_locale")]
    source_locale: String,
    #[serde(default, alias = "fallback_locales")]
    fallback_locales: Option<ConfigFallbackLocales>,
    #[serde(default, alias = "pseudo_locale")]
    pseudo_locale: Option<String>,
    #[serde(default, alias = "source_reference_root")]
    source_reference_root: Option<String>,
    #[serde(default, alias = "extract_threads")]
    extract_threads: Option<usize>,
    #[serde(default = "default_reference_scopes", alias = "reference_scopes")]
    reference_scopes: bool,
    #[serde(default = "default_true", alias = "extract_cache")]
    extract_cache: bool,
    #[serde(default)]
    mdx: MdxOptions,
    catalogs: Vec<ConfigCatalog>,
}

const fn default_true() -> bool {
    true
}

pub fn load_config(cwd: &Path, explicit_path: Option<&Path>) -> Result<LoadedConfig, ConfigError> {
    let config_path = resolve_config_path(cwd, explicit_path)?;
    let value = config_rs::Config::builder()
        .add_source(config_rs::File::from(config_path.as_path()))
        .build()
        .and_then(config_rs::Config::try_deserialize::<serde_json::Value>)
        .map_err(|source| ConfigError::Parse {
            path: config_path.clone(),
            source: Box::new(source),
        })?;
    check_top_level_keys(&value, &config_path)?;
    let raw: RawConfig = serde_json::from_value(value).map_err(|source| ConfigError::Invalid {
        path: config_path.clone(),
        message: source.to_string(),
    })?;
    normalize_config(raw, config_path)
}

/// Data configs are kebab-case (with snake_case aliases). Lingui-style
/// camelCase spellings of known keys used to be dropped silently — changing
/// pseudo-locale exclusion, fallback chains, and origin-path style without a
/// trace. Reject them loudly; merely unknown keys only warn.
fn check_top_level_keys(value: &serde_json::Value, path: &Path) -> Result<(), ConfigError> {
    let Some(map) = value.as_object() else {
        return Ok(());
    };
    for key in map.keys() {
        if let Some(kebab) = camel_case_key_hint(key) {
            return invalid(
                path,
                &format!(
                    "Unknown key \"{key}\". Palamedes data configs use kebab-case: \"{kebab}\"."
                ),
            );
        }
    }
    for key in unknown_top_level_keys(value) {
        eprintln!(
            "Warning: Ignoring unknown config key \"{key}\" in {}.",
            path.display()
        );
    }
    Ok(())
}

/// The kebab-case spelling a camelCase key should have used, when the key is a
/// known option under a Lingui-style name.
fn camel_case_key_hint(key: &str) -> Option<&'static str> {
    const CAMEL_CASE_KEYS: &[(&str, &str)] = &[
        ("sourceLocale", "source-locale"),
        ("fallbackLocales", "fallback-locales"),
        ("pseudoLocale", "pseudo-locale"),
        ("sourceReferenceRoot", "source-reference-root"),
        ("referenceScopes", "reference-scopes"),
        ("extractThreads", "extract-threads"),
        ("extractCache", "extract-cache"),
    ];

    CAMEL_CASE_KEYS
        .iter()
        .find(|(camel, _)| *camel == key)
        .map(|(_, kebab)| *kebab)
}

/// Top-level keys the loader does not deserialize, in config order.
///
/// Every key that is read anywhere — including `extract-threads` and
/// `extract-cache` — must be listed, or documented options warn as if they were
/// typos.
fn unknown_top_level_keys(value: &serde_json::Value) -> Vec<String> {
    const KNOWN_KEYS: &[&str] = &[
        "locales",
        "source-locale",
        "source_locale",
        "fallback-locales",
        "fallback_locales",
        "pseudo-locale",
        "pseudo_locale",
        "source-reference-root",
        "source_reference_root",
        "reference-scopes",
        "reference_scopes",
        "extract-threads",
        "extract_threads",
        "extract-cache",
        "extract_cache",
        "mdx",
        "catalogs",
        "plugins",
    ];

    let Some(map) = value.as_object() else {
        return Vec::new();
    };

    map.keys()
        .filter(|key| !KNOWN_KEYS.contains(&key.as_str()))
        .cloned()
        .collect()
}

impl LoadedConfig {
    pub fn artifact_config(&self) -> CatalogArtifactConfig {
        CatalogArtifactConfig {
            root_dir: self.root_dir.to_string_lossy().into_owned(),
            locales: self.locales.clone(),
            source_locale: self.source_locale.clone(),
            fallback_locales: self
                .fallback_locales
                .clone()
                .map(ConfigFallbackLocales::into_core),
            pseudo_locale: self.pseudo_locale.clone(),
            catalogs: self
                .catalogs
                .iter()
                .map(|catalog| CatalogConfig {
                    path: catalog.path.clone(),
                    format: catalog.format,
                })
                .collect(),
        }
    }

    pub fn resolve_catalog_path(&self, catalog_path: &str, locale: &str) -> PathBuf {
        self.root_dir.join(catalog_path.replace("{locale}", locale))
    }

    pub fn resolve_pattern(&self, pattern: &str) -> PathBuf {
        self.root_dir.join(pattern)
    }
}

impl ConfigFallbackLocales {
    fn into_core(self) -> FallbackLocales {
        match self {
            Self::Shared(value) => FallbackLocales::Shared(value),
            Self::PerLocale(value) => FallbackLocales::PerLocale(value),
        }
    }
}

fn resolve_config_path(cwd: &Path, explicit_path: Option<&Path>) -> Result<PathBuf, ConfigError> {
    let cwd = absolutize(cwd);
    if let Some(path) = explicit_path {
        let resolved = absolutize_from(&cwd, path);
        if resolved.is_file() {
            return Ok(resolved);
        }
        return Err(ConfigError::MissingExplicit { path: resolved });
    }

    let mut current = cwd;
    let mut js_config: Option<PathBuf> = None;
    loop {
        for name in CONFIG_FILENAMES {
            let candidate = current.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        if js_config.is_none() {
            for name in JS_CONFIG_FILENAMES {
                let candidate = current.join(name);
                if candidate.is_file() {
                    js_config = Some(candidate);
                    break;
                }
            }
        }

        let Some(parent) = current.parent() else {
            return Err(not_found(js_config));
        };
        if parent == current {
            return Err(not_found(js_config));
        }
        current = parent.to_path_buf();
    }
}

fn not_found(js_config: Option<PathBuf>) -> ConfigError {
    match js_config {
        Some(path) => ConfigError::JsConfigUnsupported { path },
        None => ConfigError::NotFound,
    }
}

fn normalize_config(raw: RawConfig, config_path: PathBuf) -> Result<LoadedConfig, ConfigError> {
    validate_config(&raw, &config_path)?;
    let root_dir = config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let source_reference_root =
        resolve_source_reference_root(raw.source_reference_root.as_deref(), &root_dir);

    Ok(LoadedConfig {
        config_path,
        root_dir,
        source_reference_root,
        reference_scopes: raw.reference_scopes,
        locales: raw.locales,
        source_locale: raw.source_locale,
        fallback_locales: raw.fallback_locales,
        pseudo_locale: raw.pseudo_locale,
        catalogs: raw.catalogs,
        mdx: raw.mdx,
        extract_threads: raw.extract_threads,
        extract_cache: raw.extract_cache,
    })
}

const fn default_reference_scopes() -> bool {
    true
}

fn validate_config(raw: &RawConfig, path: &Path) -> Result<(), ConfigError> {
    if raw.locales.is_empty() {
        return invalid(path, "\"locales\" must contain at least one locale.");
    }
    if raw.locales.iter().any(|locale| locale.trim().is_empty()) {
        return invalid(path, "\"locales\" must contain only non-empty strings.");
    }
    if raw.source_locale.trim().is_empty() {
        return invalid(path, "\"source-locale\" must be a non-empty string.");
    }
    if !raw
        .locales
        .iter()
        .any(|locale| locale == &raw.source_locale)
    {
        return invalid(path, "\"source-locale\" must be listed in \"locales\".");
    }
    if raw.catalogs.is_empty() {
        return invalid(path, "\"catalogs\" must contain at least one catalog.");
    }
    for (index, catalog) in raw.catalogs.iter().enumerate() {
        if catalog.format != PalamedesCatalogFormat::Po && catalog.po.is_some() {
            return invalid(
                path,
                &format!(
                    "\"catalogs[{index}].po\" can only be used when the catalog format is \"po\"."
                ),
            );
        }
    }
    if let Some(pseudo_locale) = &raw.pseudo_locale {
        // Documented behavior: a pseudo-locale outside `locales` is ignored.
        // Make the ignore visible instead of silent.
        if !raw.locales.iter().any(|locale| locale == pseudo_locale) {
            eprintln!(
                "Warning: \"pseudo-locale\" ({pseudo_locale}) is not listed in \"locales\" and will be ignored ({}).",
                path.display()
            );
        }
    }
    match &raw.fallback_locales {
        Some(ConfigFallbackLocales::Shared(fallbacks)) => {
            for fallback in fallbacks {
                if !raw.locales.iter().any(|locale| locale == fallback) {
                    return invalid(
                        path,
                        &format!(
                            "\"fallback-locales\" entry \"{fallback}\" must be listed in \"locales\"."
                        ),
                    );
                }
            }
        }
        Some(ConfigFallbackLocales::PerLocale(map)) => {
            for (key, fallbacks) in map {
                if key != "default" && !raw.locales.iter().any(|locale| locale == key) {
                    return invalid(
                        path,
                        &format!(
                            "\"fallback-locales\" key \"{key}\" must be \"default\" or listed in \"locales\"."
                        ),
                    );
                }
                for fallback in fallbacks {
                    if !raw.locales.iter().any(|locale| locale == fallback) {
                        return invalid(
                            path,
                            &format!(
                                "\"fallback-locales.{key}\" entry \"{fallback}\" must be listed in \"locales\"."
                            ),
                        );
                    }
                }
            }
        }
        None => {}
    }
    for (index, catalog) in raw.catalogs.iter().enumerate() {
        if catalog.path.trim().is_empty() {
            return invalid(
                path,
                &format!("\"catalogs[{index}].path\" must be non-empty."),
            );
        }
        if catalog.include.is_empty() {
            return invalid(
                path,
                &format!("\"catalogs[{index}].include\" must contain at least one pattern."),
            );
        }
    }
    if raw
        .mdx
        .translatable_attributes
        .iter()
        .chain(&raw.mdx.front_matter_fields)
        .any(|name| name.trim().is_empty())
    {
        return invalid(
            path,
            "\"mdx\" attribute and front-matter field names must be non-empty strings.",
        );
    }
    if raw.mdx.ignore_directive.trim().is_empty() {
        return invalid(path, "\"mdx.ignore-directive\" must be non-empty.");
    }
    for (field, value) in [
        ("trans-module", raw.mdx.trans_module.as_deref()),
        ("runtime-module", raw.mdx.runtime_module.as_deref()),
    ] {
        if value.is_some_and(|value| value.trim().is_empty()) {
            return invalid(path, &format!("\"mdx.{field}\" must be non-empty."));
        }
    }
    Ok(())
}

fn invalid<T>(path: &Path, message: &str) -> Result<T, ConfigError> {
    Err(ConfigError::Invalid {
        path: path.to_path_buf(),
        message: message.to_owned(),
    })
}

fn resolve_source_reference_root(value: Option<&str>, root_dir: &Path) -> PathBuf {
    match value {
        None | Some("git") => find_git_root(root_dir).unwrap_or_else(|| root_dir.to_path_buf()),
        Some("config") | Some("lingui") => root_dir.to_path_buf(),
        Some(custom) => absolutize_from(root_dir, Path::new(custom)),
    }
}

fn find_git_root(start_dir: &Path) -> Option<PathBuf> {
    let mut current = start_dir.to_path_buf();
    loop {
        if current.join(".git").exists() {
            return Some(current);
        }
        let parent = current.parent()?;
        if parent == current {
            return None;
        }
        current = parent.to_path_buf();
    }
}

fn absolutize(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn absolutize_from(base: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{load_config, unknown_top_level_keys, CONFIG_FILENAME};

    #[test]
    fn loads_yaml_config_and_defaults_references_to_git_root() {
        let repo = temp_dir("git-root");
        fs::create_dir(repo.join(".git")).expect("create git marker");
        let app = repo.join("apps/web");
        fs::create_dir_all(&app).expect("create app");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
"#,
        )
        .expect("write config");

        let config = load_config(&app, None).expect("load config");

        assert_eq!(config.root_dir, app);
        assert_eq!(config.source_reference_root, repo);
        assert!(config.reference_scopes);
        assert_eq!(config.catalogs[0].path, "src/locales/{locale}");
    }

    #[test]
    fn disables_reference_scopes_from_yaml_config() {
        let app = temp_dir("reference-scopes");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
reference-scopes: false
catalogs:
  - path: src/locales/{locale}
    include: [src]
"#,
        )
        .expect("write config");

        let config = load_config(&app, None).expect("load config");

        assert!(!config.reference_scopes);
    }

    #[test]
    fn loads_po_output_options_from_yaml_config() {
        let app = temp_dir("po-options");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
    po:
      line-breaks: "off"
"#,
        )
        .expect("write config");

        let config = load_config(&app, None).expect("load config");
        let po = config.catalogs[0].po.as_ref().expect("PO options");
        assert_eq!(po.line_breaks, palamedes::PoLineBreaks::Off);
    }

    /*
     * YAML 1.1 reads a bare `off` as the boolean `false`, YAML 1.2 keeps it a
     * string. The documented spelling is quoted for that reason, but configs
     * written before that are common enough that the bare form has to keep
     * working.
     */
    #[test]
    fn accepts_bare_and_quoted_off_for_line_breaks() {
        for (name, spelling) in [("po-off-bare", "off"), ("po-off-quoted", "\"off\"")] {
            let app = temp_dir(name);
            fs::write(
                app.join(CONFIG_FILENAME),
                format!(
                    r#"
locales: [en]
source-locale: en
catalogs:
  - path: src/locales/{{locale}}
    include: [src]
    po:
      line-breaks: {spelling}
"#
                ),
            )
            .expect("write config");

            let config = load_config(&app, None).expect("load config");
            let po = config.catalogs[0].po.as_ref().expect("PO options");
            assert_eq!(po.line_breaks, palamedes::PoLineBreaks::Off, "{name}");
        }
    }

    #[test]
    fn rejects_invalid_po_output_options() {
        for (name, catalog, expected) in [
            (
                "po-options-fcl",
                "format: fcl\n    po:\n      line-breaks: \"off\"",
                "can only be used when the catalog format is \"po\"",
            ),
            (
                "po-options-unknown-line-breaks",
                "po:\n      line-breaks: wrap",
                "expected `auto` or `off`",
            ),
            (
                "po-options-removed-order-by",
                "po:\n      order-by: collated",
                "order-by",
            ),
        ] {
            let app = temp_dir(name);
            fs::write(
                app.join(CONFIG_FILENAME),
                format!(
                    r#"
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{{locale}}
    include: [src]
    {catalog}
"#
                ),
            )
            .expect("write config");

            let error = load_config(&app, None).expect_err("invalid PO options");
            assert!(error.to_string().contains(expected), "got: {error}");
        }
    }

    #[test]
    fn rejects_camel_case_po_keys_in_data_config() {
        let app = temp_dir("po-options-camel-case");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
    po:
      lineBreaks: "off"
"#,
        )
        .expect("write config");

        let error = load_config(&app, None).expect_err("camelCase PO key must be rejected");
        let message = error.to_string();
        assert!(message.contains("lineBreaks"), "got: {message}");
        assert!(message.contains("line-breaks"), "got: {message}");
    }

    #[test]
    fn rejects_unknown_po_keys_in_data_config() {
        let app = temp_dir("po-options-unknown");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
    po:
      line-break: "off"
"#,
        )
        .expect("write config");

        let error = load_config(&app, None).expect_err("unknown PO key must be rejected");
        assert!(error.to_string().contains("line-break"), "got: {error}");
    }

    #[test]
    fn supports_config_relative_reference_roots() {
        let app = temp_dir("config-root");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
source-reference-root: config
catalogs:
  - path: src/locales/{locale}
    include: [src]
"#,
        )
        .expect("write config");

        let config = load_config(&app, None).expect("load config");

        assert_eq!(config.source_reference_root, app);
    }

    #[test]
    fn supports_toml_config_as_secondary_format() {
        let app = temp_dir("toml-config");
        fs::write(
            app.join("palamedes.toml"),
            r#"
locales = ["en", "de"]
source-locale = "en"
source-reference-root = "config"
reference_scopes = false

[[catalogs]]
path = "src/locales/{locale}"
include = ["src"]
"#,
        )
        .expect("write config");

        let config = load_config(&app, None).expect("load config");

        assert_eq!(config.config_path, app.join("palamedes.toml"));
        assert_eq!(config.source_locale, "en");
        assert_eq!(config.source_reference_root, app);
        assert!(!config.reference_scopes);
    }

    #[test]
    fn ignores_explicit_plugin_declarations_for_native_commands() {
        let app = temp_dir("plugin-config");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
plugins:
  - "@acme/palamedes-workflows"
  - ["./local-plugin.mjs", { mode: strict }]
"#,
        )
        .expect("write config");

        let config = load_config(&app, None).expect("load native config with plugins");

        assert_eq!(config.locales, ["en", "de"]);
        assert_eq!(config.catalogs.len(), 1);
    }

    #[test]
    fn reports_js_configs_with_a_specific_error() {
        let app = temp_dir("js-config");
        fs::write(app.join("palamedes.config.ts"), "export default {}\n").expect("write config");

        let error = load_config(&app, None).expect_err("js config must not load");

        let message = error.to_string();
        assert!(message.contains("palamedes.config.ts"), "got: {message}");
        assert!(message.contains("cannot load JavaScript"), "got: {message}");
    }

    #[test]
    fn rejects_camel_case_keys_with_a_kebab_case_hint() {
        let app = temp_dir("camel-config");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
pseudoLocale: de
catalogs:
  - path: src/locales/{locale}
    include: [src]
"#,
        )
        .expect("write config");

        let error = load_config(&app, None).expect_err("camelCase key must be rejected");

        let message = error.to_string();
        assert!(message.contains("pseudoLocale"), "got: {message}");
        assert!(message.contains("pseudo-locale"), "got: {message}");
    }

    #[test]
    fn accepts_documented_extraction_keys_without_warning() {
        for (threads_key, cache_key) in [
            ("extract-threads", "extract-cache"),
            ("extract_threads", "extract_cache"),
        ] {
            let value = serde_json::json!({
                "locales": ["en", "de"],
                "source-locale": "en",
                threads_key: 2,
                cache_key: false,
                "catalogs": [{ "path": "src/locales/{locale}", "include": ["src"] }],
            });

            assert!(
                unknown_top_level_keys(&value).is_empty(),
                "documented keys must not warn: {:?}",
                unknown_top_level_keys(&value)
            );
        }

        let value = serde_json::json!({ "locales": ["en"], "mystery": 1 });
        assert_eq!(unknown_top_level_keys(&value), vec!["mystery".to_owned()]);
    }

    #[test]
    fn rejects_camel_case_extraction_keys_with_a_kebab_case_hint() {
        for (camel, kebab, value) in [
            ("extractThreads", "extract-threads", "2"),
            ("extractCache", "extract-cache", "false"),
        ] {
            let app = temp_dir(&format!("camel-{camel}"));
            fs::write(
                app.join(CONFIG_FILENAME),
                format!(
                    r#"
locales: [en, de]
source-locale: en
{camel}: {value}
catalogs:
  - path: src/locales/{{locale}}
    include: [src]
"#
                ),
            )
            .expect("write config");

            let error = load_config(&app, None).expect_err("camelCase key must be rejected");
            let message = error.to_string();
            assert!(message.contains(camel), "got: {message}");
            assert!(message.contains(kebab), "got: {message}");
        }
    }

    #[test]
    fn validates_pseudo_locale_and_fallback_chains_against_locales() {
        let app = temp_dir("pseudo-config");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
pseudo-locale: xx
catalogs:
  - path: src/locales/{locale}
    include: [src]
"#,
        )
        .expect("write config");

        // Documented behavior: an unlisted pseudo-locale is ignored (with a
        // warning), so loading must still succeed.
        load_config(&app, None).expect("unlisted pseudo locale loads with a warning");

        let app = temp_dir("fallback-config");
        fs::write(
            app.join(CONFIG_FILENAME),
            r#"
locales: [en, de]
source-locale: en
fallback-locales:
  de: [fr]
catalogs:
  - path: src/locales/{locale}
    include: [src]
"#,
        )
        .expect("write config");

        let error = load_config(&app, None).expect_err("unknown fallback locale must be rejected");
        assert!(error.to_string().contains("\"fr\""), "got: {error}");
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("palamedes-cli-{name}-{id}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}
