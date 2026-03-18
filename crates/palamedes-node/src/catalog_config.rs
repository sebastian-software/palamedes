#![allow(clippy::type_complexity)]
// `napi-rs` needs this exact public union shape to generate the desired TS binding type.

use std::collections::HashMap;

use napi::bindgen_prelude::Either;
use napi_derive::napi;

#[napi(object)]
pub struct CatalogArtifactCatalogConfig {
    pub path: String,
    pub include: Vec<String>,
    pub exclude: Option<Vec<String>>,
}

#[napi(object)]
pub struct CatalogArtifactConfig {
    pub root_dir: String,
    pub locales: Vec<String>,
    pub source_locale: String,
    pub fallback_locales: Option<Either<Vec<String>, HashMap<String, Vec<String>>>>,
    pub pseudo_locale: Option<String>,
    pub catalogs: Vec<CatalogArtifactCatalogConfig>,
}

#[napi(object)]
pub struct CatalogArtifactRequest {
    pub config: CatalogArtifactConfig,
    pub resource_path: String,
}

#[napi(object)]
pub struct CatalogArtifactSelectedRequest {
    pub config: CatalogArtifactConfig,
    pub resource_path: String,
    pub compiled_ids: Vec<String>,
}

impl From<CatalogArtifactCatalogConfig> for palamedes::CatalogConfig {
    fn from(value: CatalogArtifactCatalogConfig) -> Self {
        let _ = value.include;
        let _ = value.exclude;
        Self { path: value.path }
    }
}

impl From<CatalogArtifactConfig> for palamedes::CatalogArtifactConfig {
    fn from(value: CatalogArtifactConfig) -> Self {
        let fallback_locales = value.fallback_locales.map(|fallbacks| match fallbacks {
            Either::A(shared) => palamedes::FallbackLocales::Shared(shared),
            Either::B(per_locale) => {
                palamedes::FallbackLocales::PerLocale(per_locale.into_iter().collect())
            }
        });

        Self {
            root_dir: value.root_dir,
            locales: value.locales,
            source_locale: value.source_locale,
            fallback_locales,
            pseudo_locale: value.pseudo_locale,
            catalogs: value
                .catalogs
                .into_iter()
                .map(palamedes::CatalogConfig::from)
                .collect(),
        }
    }
}

impl From<CatalogArtifactRequest> for palamedes::CatalogArtifactRequest {
    fn from(value: CatalogArtifactRequest) -> Self {
        Self {
            config: value.config.into(),
            resource_path: value.resource_path,
        }
    }
}

impl From<CatalogArtifactSelectedRequest> for palamedes::CatalogArtifactSelectedRequest {
    fn from(value: CatalogArtifactSelectedRequest) -> Self {
        Self {
            config: value.config.into(),
            resource_path: value.resource_path,
            compiled_ids: value.compiled_ids,
        }
    }
}
