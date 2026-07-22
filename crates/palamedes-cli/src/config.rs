use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use ::config as config_rs;
use palamedes::{CatalogArtifactConfig, CatalogConfig, FallbackLocales, PalamedesCatalogFormat};
use serde::Deserialize;
use thiserror::Error;

pub const CONFIG_FILENAME: &str = "palamedes.yaml";
pub const CONFIG_FILENAMES: &[&str] = &[
    CONFIG_FILENAME,
    "palamedes.yml",
    "palamedes.json",
    "palamedes.toml",
];

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Could not find a Palamedes config. Expected one of palamedes.yaml, palamedes.yml, palamedes.json, palamedes.toml.")]
    NotFound,
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
    pub locales: Vec<String>,
    pub source_locale: String,
    pub fallback_locales: Option<ConfigFallbackLocales>,
    pub pseudo_locale: Option<String>,
    pub catalogs: Vec<ConfigCatalog>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ConfigCatalog {
    pub path: String,
    #[serde(default)]
    pub format: PalamedesCatalogFormat,
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
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
    catalogs: Vec<ConfigCatalog>,
}

pub fn load_config(cwd: &Path, explicit_path: Option<&Path>) -> Result<LoadedConfig, ConfigError> {
    let config_path = resolve_config_path(cwd, explicit_path)?;
    let raw = config_rs::Config::builder()
        .add_source(config_rs::File::from(config_path.as_path()))
        .build()
        .and_then(config_rs::Config::try_deserialize::<RawConfig>)
        .map_err(|source| ConfigError::Parse {
            path: config_path.clone(),
            source: Box::new(source),
        })?;
    normalize_config(raw, config_path)
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
    loop {
        for name in CONFIG_FILENAMES {
            let candidate = current.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        let Some(parent) = current.parent() else {
            return Err(ConfigError::NotFound);
        };
        if parent == current {
            return Err(ConfigError::NotFound);
        }
        current = parent.to_path_buf();
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
        locales: raw.locales,
        source_locale: raw.source_locale,
        fallback_locales: raw.fallback_locales,
        pseudo_locale: raw.pseudo_locale,
        catalogs: raw.catalogs,
    })
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

    use super::{load_config, CONFIG_FILENAME};

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
        assert_eq!(config.catalogs[0].path, "src/locales/{locale}");
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
