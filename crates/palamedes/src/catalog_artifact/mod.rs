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

use self::compile::build_artifact_result;
use self::load::LocaleCatalogs;
use self::resolve::{ferrocat_fallback_chain, prepare_compilation};
pub use self::types::{
    CatalogArtifactConfig, CatalogArtifactDiagnostic, CatalogArtifactDiagnosticSeverity,
    CatalogArtifactMissingMessage, CatalogArtifactRequest, CatalogArtifactResult,
    CatalogArtifactSelectedRequest, CatalogArtifactSourceKey, CatalogConfig, FallbackLocales,
};

struct PreparedCompilation {
    locale: String,
    fallback_chain: Vec<String>,
    watch_files: Vec<PathBuf>,
    loaded: LocaleCatalogs,
}

/// Compiles a host-neutral catalog artifact for the requested locale.
pub fn compile_catalog_artifact(
    request: CatalogArtifactRequest,
) -> PalamedesResult<CatalogArtifactResult> {
    let prepared = prepare_compilation(&request.config, &request.resource_path)?;
    let catalogs = prepared.loaded.values().collect::<Vec<_>>();
    let ferrocat_fallback_chain = ferrocat_fallback_chain(
        &prepared.fallback_chain,
        &prepared.locale,
        &request.config.source_locale,
    );
    let artifact = ferrocat_compile_catalog_artifact(
        &catalogs,
        &CompileCatalogArtifactOptions {
            requested_locale: &prepared.locale,
            source_locale: &request.config.source_locale,
            fallback_chain: &ferrocat_fallback_chain,
            key_strategy: CompiledKeyStrategy::FerrocatV1,
            source_fallback: true,
            strict_icu: false,
        },
    )
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
pub fn compile_catalog_artifact_selected(
    request: CatalogArtifactSelectedRequest,
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
    let artifact = ferrocat_compile_catalog_artifact_selected(
        &catalogs,
        &compiled_id_index,
        &CompileSelectedCatalogArtifactOptions {
            requested_locale: &prepared.locale,
            source_locale: &request.config.source_locale,
            fallback_chain: &ferrocat_fallback_chain,
            key_strategy: CompiledKeyStrategy::FerrocatV1,
            source_fallback: true,
            strict_icu: false,
            compiled_ids: &request.compiled_ids,
        },
    )
    .map_err(PalamedesError::CompileSelectedCatalogArtifact)?;

    build_artifact_result(
        artifact,
        prepared.watch_files,
        prepared.fallback_chain,
        request.config.pseudo_locale.as_deref(),
        &prepared.locale,
    )
}
