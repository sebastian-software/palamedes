use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use pofile::{
    parse_po, validate_icu, Catalog, CatalogEntry, CatalogTranslation, GettextToIcuOptions,
    IcuParserOptions, ItemsToCatalogOptions, PoFile, gettext_to_icu, items_to_catalog,
};
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModuleRequest {
    pub config: CatalogModuleConfig,
    pub resource_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModuleConfig {
    pub root_dir: String,
    pub locales: Vec<String>,
    pub source_locale: String,
    pub fallback_locales: Option<FallbackLocales>,
    pub pseudo_locale: Option<String>,
    pub catalogs: Vec<CatalogConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum FallbackLocales {
    Shared(Vec<String>),
    PerLocale(BTreeMap<String, Vec<String>>),
}

#[derive(Debug, Deserialize)]
pub struct CatalogConfig {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModuleResult {
    pub code: String,
    pub watch_files: Vec<String>,
    pub missing: Vec<MissingTranslation>,
    pub errors: Vec<CompilationError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_locale_chain: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct MissingTranslation {
    pub id: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
pub struct CompilationError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedCatalogRequest {
    locale: String,
    primary_file: PathBuf,
}

type LocaleCatalogs = BTreeMap<String, Catalog>;

pub fn get_catalog_module_json(request_json: &str) -> Result<String, String> {
    let request = serde_json::from_str::<CatalogModuleRequest>(request_json)
        .map_err(|error| format!("Invalid catalog module request: {error}"))?;
    let result = get_catalog_module(request)?;
    serde_json::to_string(&result).map_err(|error| error.to_string())
}

fn get_catalog_module(request: CatalogModuleRequest) -> Result<CatalogModuleResult, String> {
    let resource_path = PathBuf::from(&request.resource_path);
    let root_dir = PathBuf::from(&request.config.root_dir);
    let resolved = resolve_catalog_request(&request.config, &resource_path)?;

    let fallback_chain = resolve_locale_chain(
        &request.config,
        &resolved.locale,
    );
    let watch_files = collect_watch_files(&root_dir, &resolved.primary_file, &request.config, &fallback_chain);
    let loaded = load_catalogs(&watch_files, &request.config)?;
    let source_catalog = loaded.get(&request.config.source_locale);
    let primary_catalog = loaded
        .get(&resolved.locale)
        .ok_or_else(|| format!("Missing catalog data for locale {}", resolved.locale))?;

    let mut keys = BTreeSet::new();
    keys.extend(primary_catalog.keys().cloned());
    if let Some(source_catalog) = source_catalog {
        keys.extend(source_catalog.keys().cloned());
    }

    let mut messages = BTreeMap::new();
    let mut missing = Vec::new();
    let mut errors = Vec::new();

    for key in keys {
        let locale_entry = primary_catalog.get(&key);
        let source_entry = source_catalog.and_then(|catalog| catalog.get(&key));

        let translation = select_translation(
            &loaded,
            &resolved.locale,
            &fallback_chain,
            &request.config.source_locale,
            &key,
        );

        let source_message = source_entry
            .and_then(source_locale_fallback)
            .or_else(|| locale_entry.and_then(|entry| entry.message.clone()))
            .unwrap_or_else(|| key.clone());

        if translation.is_none() && resolved.locale != request.config.source_locale {
            missing.push(MissingTranslation {
                id: key.clone(),
                source: source_message.clone(),
            });
        }

        let effective = translation.unwrap_or_else(|| source_message.clone());
        let effective = maybe_pseudolocalize(
            &effective,
            request.config.pseudo_locale.as_deref(),
            &resolved.locale,
        );

        let validation = validate_icu(
            &effective,
            IcuParserOptions {
                requires_other_clause: false,
                ..IcuParserOptions::default()
            },
        );
        if !validation.valid {
            for error in validation.errors {
                errors.push(CompilationError {
                    message: error.message,
                    id: Some(key.clone()),
                });
            }
        }

        messages.insert(key, effective);
    }

    Ok(CatalogModuleResult {
        code: build_catalog_module_code(&messages)?,
        watch_files: watch_files
            .into_iter()
            .map(|file| file.to_string_lossy().into_owned())
            .collect(),
        missing,
        errors,
        resolved_locale_chain: Some(fallback_chain),
    })
}

fn resolve_catalog_request(
    config: &CatalogModuleConfig,
    resource_path: &Path,
) -> Result<ResolvedCatalogRequest, String> {
    for catalog in &config.catalogs {
        let absolute_catalog_path = Path::new(&config.root_dir).join(&catalog.path);
        let absolute_po_path = absolute_catalog_path.with_extension("po");
        let pattern = normalize_path(&absolute_po_path);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = Regex::new(&format!("^{regex_pattern}$"))
            .map_err(|error| format!("Invalid catalog path pattern {}: {error}", catalog.path))?;
        let normalized_resource = normalize_path(resource_path);

        if let Some(captures) = matcher.captures(&normalized_resource) {
            let locale = captures
                .get(1)
                .map(|value| value.as_str().to_owned())
                .ok_or_else(|| format!("Could not resolve locale from {}", resource_path.display()))?;
            if !config.locales.iter().any(|configured| configured == &locale) {
                return Err(format!(
                    "Resolved locale {locale} for {} is not listed in palamedes.config locales.",
                    resource_path.display()
                ));
            }
            return Ok(ResolvedCatalogRequest {
                locale,
                primary_file: resource_path.to_path_buf(),
            });
        }
    }

    Err(format!(
        "Requested resource {} is not matched to any configured catalog path.",
        resource_path.display()
    ))
}

fn resolve_locale_chain(config: &CatalogModuleConfig, locale: &str) -> Vec<String> {
    let mut chain = Vec::new();
    chain.push(locale.to_owned());

    match &config.fallback_locales {
        Some(FallbackLocales::Shared(shared)) => {
            chain.extend(shared.iter().filter(|fallback| fallback.as_str() != locale).cloned());
        }
        Some(FallbackLocales::PerLocale(map)) => {
            if let Some(fallbacks) = map.get(locale) {
                chain.extend(fallbacks.iter().filter(|fallback| fallback.as_str() != locale).cloned());
            }
            if let Some(defaults) = map.get("default") {
                for fallback in defaults {
                    if fallback != locale && !chain.contains(fallback) {
                        chain.push(fallback.clone());
                    }
                }
            }
        }
        None => {}
    }

    if !chain.contains(&config.source_locale) {
        chain.push(config.source_locale.clone());
    }

    chain
}

fn collect_watch_files(
    root_dir: &Path,
    primary_file: &Path,
    config: &CatalogModuleConfig,
    locale_chain: &[String],
) -> Vec<PathBuf> {
    let mut files = vec![primary_file.to_path_buf()];

    for catalog in &config.catalogs {
        let absolute_catalog_path = root_dir.join(&catalog.path);
        let pattern = normalize_path(&absolute_catalog_path.with_extension("po"));
        let primary_pattern = normalize_path(primary_file);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = Regex::new(&format!("^{regex_pattern}$"));

        let Ok(matcher) = matcher else {
            continue;
        };

        if matcher.is_match(&primary_pattern) {
            for locale in locale_chain {
                let candidate = root_dir.join(catalog.path.replace("{locale}", locale)).with_extension("po");
                if !files.contains(&candidate) {
                    files.push(candidate);
                }
            }
            break;
        }
    }

    files
}

fn load_catalogs(
    files: &[PathBuf],
    config: &CatalogModuleConfig,
) -> Result<LocaleCatalogs, String> {
    let mut loaded = LocaleCatalogs::new();

    for file in files {
        if !file.exists() {
            if file == &files[0] {
                return Err(format!("Catalog file not found: {}", file.display()));
            }
            continue;
        }

        let locale = infer_locale_from_path(file, config)
            .ok_or_else(|| format!("Could not infer locale for {}", file.display()))?;
        let content = fs::read_to_string(file)
            .map_err(|error| format!("Failed to read {}: {error}", file.display()))?;
        let po = parse_po(&content);
        let normalized = normalize_po(po, &locale);
        let catalog = items_to_catalog(&normalized.items, ItemsToCatalogOptions::default())
            .map_err(|error| format!("Failed to parse references in {}: {error}", file.display()))?;
        loaded.insert(locale, catalog);
    }

    Ok(loaded)
}

fn infer_locale_from_path(path: &Path, config: &CatalogModuleConfig) -> Option<String> {
    let normalized_resource = normalize_path(path);
    for catalog in &config.catalogs {
        let absolute_catalog_path = Path::new(&config.root_dir).join(&catalog.path).with_extension("po");
        let pattern = normalize_path(&absolute_catalog_path);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = Regex::new(&format!("^{regex_pattern}$")).ok()?;
        if let Some(captures) = matcher.captures(&normalized_resource) {
            return captures.get(1).map(|value| value.as_str().to_owned());
        }
    }
    None
}

fn normalize_po(mut po: PoFile, locale: &str) -> PoFile {
    let options = GettextToIcuOptions::new(locale);
    for item in &mut po.items {
        if let Some(icu) = gettext_to_icu(item, &options) {
            item.msgstr = vec![icu];
            item.msgid_plural = Some(String::new());
        }
    }
    po
}

fn select_translation(
    loaded: &LocaleCatalogs,
    locale: &str,
    locale_chain: &[String],
    source_locale: &str,
    key: &str,
) -> Option<String> {
    if let Some(translation) = loaded.get(locale).and_then(|catalog| translation_for_key(catalog, key)) {
        return Some(translation);
    }

    for fallback in locale_chain {
        if fallback == locale || fallback == source_locale {
            continue;
        }
        if let Some(translation) = loaded
            .get(fallback)
            .and_then(|catalog| translation_for_key(catalog, key))
        {
            return Some(translation);
        }
    }

    if locale == source_locale {
        return loaded
            .get(source_locale)
            .and_then(|catalog| catalog.get(key))
            .and_then(source_locale_fallback);
    }

    None
}

fn translation_for_key(catalog: &Catalog, key: &str) -> Option<String> {
    catalog.get(key).and_then(|entry| match &entry.translation {
        Some(CatalogTranslation::Singular(text)) if !text.is_empty() => Some(text.clone()),
        Some(CatalogTranslation::Plural(texts)) => texts.iter().find(|text| !text.is_empty()).cloned(),
        _ => None,
    })
}

fn source_locale_fallback(entry: &CatalogEntry) -> Option<String> {
    translation_for_entry(entry).or_else(|| entry.message.clone())
}

fn translation_for_entry(entry: &CatalogEntry) -> Option<String> {
    match &entry.translation {
        Some(CatalogTranslation::Singular(text)) if !text.is_empty() => Some(text.clone()),
        Some(CatalogTranslation::Plural(texts)) => texts.iter().find(|text| !text.is_empty()).cloned(),
        _ => None,
    }
}

fn maybe_pseudolocalize(message: &str, pseudo_locale: Option<&str>, locale: &str) -> String {
    if pseudo_locale != Some(locale) {
        return message.to_owned();
    }

    message
        .chars()
        .map(|ch| match ch {
            'a' => 'á',
            'b' => 'ƀ',
            'c' => 'ç',
            'd' => 'ď',
            'e' => 'ē',
            'f' => 'ƒ',
            'g' => 'ğ',
            'h' => 'ħ',
            'i' => 'ī',
            'j' => 'ĵ',
            'k' => 'ķ',
            'l' => 'ľ',
            'm' => 'ɱ',
            'n' => 'ń',
            'o' => 'ō',
            'p' => 'ƥ',
            'q' => 'ʠ',
            'r' => 'ř',
            's' => 'ş',
            't' => 'ŧ',
            'u' => 'ū',
            'v' => 'ṽ',
            'w' => 'ŵ',
            'x' => 'ẋ',
            'y' => 'ŷ',
            'z' => 'ž',
            'A' => 'Å',
            'B' => 'ß',
            'C' => 'Ç',
            'D' => 'Đ',
            'E' => 'Ē',
            'F' => 'Ƒ',
            'G' => 'Ğ',
            'H' => 'Ħ',
            'I' => 'Ī',
            'J' => 'Ĵ',
            'K' => 'Ķ',
            'L' => 'Ŀ',
            'M' => 'Ṁ',
            'N' => 'Ń',
            'O' => 'Ø',
            'P' => 'Ƥ',
            'Q' => 'Ǫ',
            'R' => 'Ř',
            'S' => 'Š',
            'T' => 'Ŧ',
            'U' => 'Ū',
            'V' => 'Ṽ',
            'W' => 'Ŵ',
            'X' => 'Ẋ',
            'Y' => 'Ŷ',
            'Z' => 'Ž',
            other => other,
        })
        .collect()
}

fn build_catalog_module_code(messages: &BTreeMap<String, String>) -> Result<String, String> {
    let json = serde_json::to_string(messages).map_err(|error| error.to_string())?;
    let encoded = serde_json::to_string(&json).map_err(|error| error.to_string())?;
    Ok(format!(
        "export const messages=JSON.parse({encoded});export default {{ messages }};"
    ))
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::get_catalog_module_json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn builds_catalog_module_with_fallbacks() {
        let fixture = create_fixture_dir("catalog-module");
        let locale_dir = fixture.join("src/locales");
        fs::create_dir_all(&locale_dir).expect("locale dir");

        fs::write(
            locale_dir.join("en.po"),
            r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Hello"
msgstr ""

msgid "Only source"
msgstr ""
"#,
        )
        .expect("write en");

        fs::write(
            locale_dir.join("de.po"),
            r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello"
msgstr "Hallo"
"#,
        )
        .expect("write de");

        let request = serde_json::json!({
            "config": {
                "rootDir": fixture.to_string_lossy(),
                "locales": ["en", "de"],
                "sourceLocale": "en",
                "catalogs": [
                    {
                        "path": "src/locales/{locale}",
                        "include": ["src"]
                    }
                ]
            },
            "resourcePath": locale_dir.join("de.po").to_string_lossy()
        });

        let result = get_catalog_module_json(&request.to_string()).expect("catalog module json");
        assert!(result.contains("\"watchFiles\""));
        assert!(result.contains("Hallo"));
        assert!(result.contains("Only source"));
    }

    fn create_fixture_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("palamedes-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}
