mod compile;
mod load;
mod resolve;
mod types;

#[cfg(test)]
mod tests;

use std::path::PathBuf;

use ferrocat::{
    compile_catalog_artifact as ferrocat_compile_catalog_artifact,
    compile_catalog_artifact_selected as ferrocat_compile_catalog_artifact_selected,
    CompileCatalogArtifactOptions, CompileSelectedCatalogArtifactOptions, CompiledCatalogIdIndex,
    CompiledKeyStrategy,
};

use crate::error::{PalamedesError, PalamedesResult};

use self::compile::{build_artifact_result, runtime_icu_options};
use self::load::LocaleCatalogs;
use self::resolve::{ferrocat_fallback_chain, prepare_compilation};
pub use self::types::{
    CatalogArtifactConfig, CatalogArtifactDiagnostic, CatalogArtifactDiagnosticSeverity,
    CatalogArtifactMissingMessage, CatalogArtifactRequest, CatalogArtifactResult,
    CatalogArtifactSelectedRequest, CatalogArtifactSourceKey, CatalogConfig, FallbackLocales,
    PalamedesCatalogFormat,
};

struct PreparedCompilation {
    locale: String,
    fallback_chain: Vec<String>,
    watch_files: Vec<PathBuf>,
    loaded: LocaleCatalogs,
}

/// Compiles a host-neutral catalog artifact for the requested locale.
///
/// # Errors
///
/// Returns an error when Palamedes cannot resolve the request to configured
/// catalog files, when any catalog file cannot be loaded, or when Ferrocat
/// fails to compile the effective artifact.
pub fn compile_catalog_artifact(
    request: &CatalogArtifactRequest,
) -> PalamedesResult<CatalogArtifactResult> {
    let prepared = prepare_compilation(&request.config, &request.resource_path)?;
    let catalogs = prepared.loaded.values().collect::<Vec<_>>();
    let ferrocat_fallback_chain = ferrocat_fallback_chain(
        &prepared.fallback_chain,
        &prepared.locale,
        &request.config.source_locale,
    );
    let ferrocat_fallback_chain_refs = ferrocat_fallback_chain
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let icu_options = runtime_icu_options();
    let options =
        CompileCatalogArtifactOptions::new(&prepared.locale, &request.config.source_locale)
            .with_fallback_chain(&ferrocat_fallback_chain_refs)
            .with_key_strategy(CompiledKeyStrategy::FerrocatV1)
            .with_source_fallback(true)
            .with_icu_compatibility(true)
            .with_icu_options(icu_options);

    let artifact = ferrocat_compile_catalog_artifact(&catalogs, &options)
        .map_err(PalamedesError::CompileCatalogArtifact)?;

    build_artifact_result(
        artifact,
        prepared.watch_files,
        prepared.fallback_chain,
        request.config.pseudo_locale.as_deref(),
        &prepared.locale,
    )
}

/// Compiles a selected subset of runtime IDs for the requested locale.
///
/// # Errors
///
/// Returns an error when Palamedes cannot resolve the request to configured
/// catalog files, when the compiled-ID index cannot be built, or when Ferrocat
/// fails to compile the selected artifact.
pub fn compile_catalog_artifact_selected(
    request: &CatalogArtifactSelectedRequest,
) -> PalamedesResult<CatalogArtifactResult> {
    let prepared = prepare_compilation(&request.config, &request.resource_path)?;
    let catalogs = prepared.loaded.values().collect::<Vec<_>>();
    let compiled_id_index = CompiledCatalogIdIndex::new(&catalogs, CompiledKeyStrategy::FerrocatV1)
        .map_err(PalamedesError::BuildCompiledIdIndex)?;
    let ferrocat_fallback_chain = ferrocat_fallback_chain(
        &prepared.fallback_chain,
        &prepared.locale,
        &request.config.source_locale,
    );
    let ferrocat_fallback_chain_refs = ferrocat_fallback_chain
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let icu_options = runtime_icu_options();
    let artifact_options =
        CompileCatalogArtifactOptions::new(&prepared.locale, &request.config.source_locale)
            .with_fallback_chain(&ferrocat_fallback_chain_refs)
            .with_key_strategy(CompiledKeyStrategy::FerrocatV1)
            .with_source_fallback(true)
            .with_icu_compatibility(true)
            .with_icu_options(icu_options);
    let compiled_id_refs = request
        .compiled_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let options = CompileSelectedCatalogArtifactOptions::new(
        &prepared.locale,
        &request.config.source_locale,
        &compiled_id_refs,
    )
    .with_options(artifact_options);

    let artifact =
        ferrocat_compile_catalog_artifact_selected(&catalogs, &compiled_id_index, &options)
            .map_err(PalamedesError::CompileSelectedCatalogArtifact)?;

    build_artifact_result(
        artifact,
        prepared.watch_files,
        prepared.fallback_chain,
        request.config.pseudo_locale.as_deref(),
        &prepared.locale,
    )
}
