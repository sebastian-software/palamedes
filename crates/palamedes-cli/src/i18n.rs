//! External, build-compiled CLI messages. No embedded catalogs or ICU parsing.

use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Language {
    #[default]
    English,
    German,
    Spanish,
}

static LANGUAGE: OnceLock<Language> = OnceLock::new();
static CATALOG: OnceLock<palamedes_i18n::Catalog> = OnceLock::new();

pub fn initialize() -> Result<(), Box<dyn std::error::Error>> {
    let values = ["PALAMEDES_UI_LOCALE", "LC_ALL", "LC_MESSAGES", "LANG"].map(|name| {
        std::env::var_os(name).map(|value| value.into_string().unwrap_or_else(|_| "\0".to_owned()))
    });
    let language = select_language(values.iter().map(Option::as_deref));
    let locale = match language {
        Language::English => "en",
        Language::German => "de",
        Language::Spanish => "es",
    };
    let directory =
        match std::env::var_os("PALAMEDES_UI_CATALOG_DIR").filter(|value| !value.is_empty()) {
            Some(directory) => std::path::PathBuf::from(directory),
            None => {
                let executable = std::fs::canonicalize(std::env::current_exe()?)?;
                executable
                    .parent()
                    .ok_or("CLI executable has no parent directory")?
                    .join("pmds-locales")
            }
        };
    let catalog = palamedes_i18n::Catalog::load(
        directory.join(format!("{locale}.pmd.json")),
        locale,
        CATALOG_SCHEMA,
    )?;
    let _ = CATALOG.set(catalog);
    let _ = LANGUAGE.set(language);
    Ok(())
}

fn select_language<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Language {
    let Some(value) = values
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
    else {
        return Language::English;
    };
    let tag = value.split(['.', '@']).next().unwrap_or_default();
    let mut parts = tag.split(['-', '_']);
    let language = parts.next().unwrap_or_default();
    let region = parts.next();
    if parts.next().is_some()
        || region.is_some_and(|part| {
            !(part.len() == 2 && part.chars().all(|c| c.is_ascii_alphabetic())
                || part.len() == 3 && part.chars().all(|c| c.is_ascii_digit()))
        })
    {
        return Language::English;
    }
    match language.to_ascii_lowercase().as_str() {
        "de" => Language::German,
        "es" => Language::Spanish,
        _ => Language::English,
    }
}

pub fn language() -> Language {
    LANGUAGE.get().copied().unwrap_or_default()
}

pub fn catalog() -> &'static palamedes_i18n::Catalog {
    #[cfg(test)]
    return CATALOG.get_or_init(|| {
        palamedes_i18n::Catalog::load(
            concat!(env!("OUT_DIR"), "/catalogs/en.pmd.json"),
            "en",
            CATALOG_SCHEMA,
        )
        .expect("load external unit-test catalog")
    });
    #[cfg(not(test))]
    CATALOG
        .get()
        .expect("CLI catalog loaded before argument parsing")
}

include!(concat!(env!("OUT_DIR"), "/messages.rs"));

macro_rules! tr {
    ($($tokens:tt)*) => {
        translate!(crate::i18n::catalog(), $($tokens)*).expect("validated CLI catalog and arguments")
    };
}

#[cfg(test)]
mod tests {
    use super::{Language, select_language};

    #[test]
    fn posix_priority_normalization_and_default_are_deterministic() {
        for (values, expected) in [
            (
                [None, Some("de_DE.UTF-8@euro"), Some("es_ES"), None],
                Language::German,
            ),
            (
                [Some("es-MX"), Some("de_DE"), None, None],
                Language::Spanish,
            ),
            (
                [None, Some(""), Some("es_ES"), Some("de_DE")],
                Language::Spanish,
            ),
            (
                [None, Some("C.UTF-8"), Some("de_DE"), None],
                Language::English,
            ),
            (
                [None, Some("POSIX"), Some("de_DE"), None],
                Language::English,
            ),
            (
                [None, Some("fr_FR"), Some("de_DE"), None],
                Language::English,
            ),
            ([None, Some("de_!"), Some("es_ES"), None], Language::English),
            ([None, None, None, None], Language::English),
        ] {
            assert_eq!(select_language(values), expected);
        }
    }
}
