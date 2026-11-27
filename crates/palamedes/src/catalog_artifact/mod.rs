mod cache;
mod compile;
mod load;
mod resolve;
mod types;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use ferrocat::{
    CompileCatalogArtifactOptions, CompileCatalogArtifactReportOptions,
    CompileSelectedCatalogArtifactOptions, CompiledCatalogIdIndex, CompiledKeyStrategy,
    compile_catalog_artifact as ferrocat_compile_catalog_artifact,
    compile_catalog_artifact_report as ferrocat_compile_catalog_artifact_report,
    compile_catalog_artifact_selected as ferrocat_compile_catalog_artifact_selected,
};

use crate::error::{PalamedesError, PalamedesResult};
use crate::icu_text::RUNTIME_ICU_SYNTAX_POLICY;

pub use self::cache::CatalogCompilationCache;
use self::compile::{build_artifact_result, runtime_icu_options};
use self::load::LocaleCatalogs;
pub use self::load::parse_catalog_for_compile;
use self::resolve::{ferrocat_fallback_chain, prepare_compilation};
pub use self::types::{
    CatalogArtifactConfig, CatalogArtifactDiagnostic, CatalogArtifactDiagnosticSeverity,
    CatalogArtifactMissingMessage, CatalogArtifactRequest, CatalogArtifactResult,
    CatalogArtifactSelectedRequest, CatalogArtifactSourceKey, CatalogConfig, FallbackLocales,
    PalamedesCatalogFormat,
};

/// Returns whether `locale` is a safe locale identifier for catalog file paths
/// and compiled module filenames.
///
/// Allows ASCII letters, digits, `-`, `_`, and interior single `.` (such as
/// `en`, `de-DE`, `zh-Hans`, `en_US`, `pt.BR`) while rejecting empty values,
/// `.` / `..`, leading or trailing non-alphanumeric characters, consecutive
/// dots, NUL/control characters, and path separators.
#[must_use]
pub fn is_valid_locale(locale: &str) -> bool {
    let bytes = locale.as_bytes();
    if bytes.is_empty()
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes[bytes.len() - 1].is_ascii_alphanumeric()
        || locale.contains("..")
    {
        return false;
    }
    bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// Validates that a configured catalog path pattern is a relative path that
/// cannot escape its root directory.
///
/// # Errors
///
/// Returns a human-readable reason when the pattern is empty, contains control
/// characters, is absolute (POSIX root, UNC/backslash root, or Windows drive
/// prefix), contains `..` traversal segments, or names no path segment.
pub fn validate_catalog_path_pattern(catalog_path: &str) -> Result<(), &'static str> {
    if catalog_path.trim().is_empty() {
        return Err("catalog path must be non-empty");
    }
    if catalog_path.chars().any(char::is_control) {
        return Err("catalog path must not contain control characters");
    }
    if Path::new(catalog_path).is_absolute()
        || catalog_path.starts_with('/')
        || catalog_path.starts_with('\\')
        || has_windows_drive_prefix(catalog_path)
        || has_windows_drive_prefix(&catalog_path.replace("{locale}", "a"))
    {
        return Err("catalog path must be relative to the config directory");
    }
    if catalog_path.ends_with('/') || catalog_path.ends_with('\\') {
        return Err("catalog path must not end with a path separator");
    }
    let portable = catalog_path.replace('\\', "/");
    if portable.split('/').rfind(|segment| !segment.is_empty()) == Some(".") {
        return Err("catalog path must not end with a current-directory ('.') segment");
    }
    for segment in portable.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if has_windows_drive_prefix(segment)
            || has_windows_drive_prefix(&segment.replace("{locale}", "a"))
        {
            return Err("catalog path must not contain Windows drive prefixes");
        }
    }
    let mut has_normal = false;
    for component in Path::new(&portable).components() {
        match component {
            Component::Normal(part) => {
                if part
                    .to_str()
                    .is_some_and(crate::contained_fs::is_reserved_lock_segment)
                {
                    return Err("catalog path must not use the reserved '.pmds-lock' lock name");
                }
                has_normal = true;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("catalog path must not contain parent-directory ('..') segments");
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("catalog path must be relative to the config directory");
            }
        }
    }
    if !has_normal {
        return Err("catalog path must name a file path inside the config directory");
    }
    let normalized = normalize_relative_catalog_pattern(catalog_path);
    if Path::new(&normalized).is_absolute()
        || has_windows_drive_prefix(&normalized)
        || has_windows_drive_prefix(&normalized.replace("{locale}", "a"))
    {
        return Err("catalog path must be relative to the config directory");
    }
    Ok(())
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn normalize_relative_catalog_pattern(catalog_path: &str) -> String {
    catalog_path
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_lexical_path(path: &Path) -> PathBuf {
    let portable = path.to_string_lossy().replace('\\', "/");
    let portable_path = Path::new(&portable);
    let is_absolute = portable_path.is_absolute();
    let mut normalized = PathBuf::new();
    for component in portable_path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new(std::path::MAIN_SEPARATOR_STR)),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() && !is_absolute {
                    normalized.push("..");
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

/// Resolves a configured catalog pattern to its concrete storage file after
/// validating both `catalog_path` and `locale` against path traversal.
///
/// # Errors
///
/// Returns an error when `locale` is invalid, `catalog_path` is absolute or
/// contains `..`, or the normalized result escapes `root_dir`.
pub fn try_resolve_catalog_file_path(
    root_dir: &Path,
    catalog_path: &str,
    locale: &str,
    format: PalamedesCatalogFormat,
) -> PalamedesResult<PathBuf> {
    if !is_valid_locale(locale) {
        return Err(PalamedesError::InvalidCatalogLocale {
            locale: locale.to_owned(),
        });
    }
    validate_catalog_path_pattern(catalog_path).map_err(|reason| {
        PalamedesError::UnsafeCatalogPath {
            path: catalog_path.to_owned(),
            reason: reason.to_owned(),
        }
    })?;
    let expanded_pattern = catalog_path.replace("{locale}", locale);
    validate_catalog_path_pattern(&expanded_pattern).map_err(|reason| {
        PalamedesError::UnsafeCatalogPath {
            path: catalog_path.to_owned(),
            reason: reason.to_owned(),
        }
    })?;
    let resolved = resolve_catalog_file_path(root_dir, catalog_path, locale, format);
    let normalized_root = normalize_lexical_path(root_dir);
    let normalized_resolved = normalize_lexical_path(&resolved);
    if normalized_resolved == normalized_root || !normalized_resolved.starts_with(&normalized_root)
    {
        return Err(PalamedesError::UnsafeCatalogPath {
            path: catalog_path.to_owned(),
            reason: format!(
                "resolved catalog path escapes root directory {}",
                root_dir.display()
            ),
        });
    }
    Ok(resolved)
}

/// Verifies lexical and on-disk symlink containment of `target` inside `root_dir`.
///
/// Validates every lexical path component relative to `root_dir` first (even
/// when `root_dir` or intermediate directories do not exist yet), then walks
/// existing on-disk components to ensure no symlink redirects the path outside
/// `root_dir`.
///
/// # Errors
///
/// Returns [`PalamedesError::UnsafeCatalogPath`] when `target` is outside
/// `root_dir`, contains traversal components, traverses a dangling symlink, or
/// resolves via a symlink outside the canonical `root_dir`.
pub fn ensure_catalog_path_contained(root_dir: &Path, target: &Path) -> PalamedesResult<()> {
    let relative =
        target
            .strip_prefix(root_dir)
            .map_err(|_| PalamedesError::UnsafeCatalogPath {
                path: target.to_string_lossy().into_owned(),
                reason: format!("escapes root directory {}", root_dir.display()),
            })?;

    // Validate every lexical component before inspecting the filesystem so a
    // missing root or intermediate directory never hides a later `..` segment.
    let mut normal_segments = Vec::new();
    for component in relative.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => normal_segments.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(PalamedesError::UnsafeCatalogPath {
                    path: target.to_string_lossy().into_owned(),
                    reason: format!("escapes root directory {}", root_dir.display()),
                });
            }
        }
    }
    if normal_segments.is_empty() {
        return Err(PalamedesError::UnsafeCatalogPath {
            path: target.to_string_lossy().into_owned(),
            reason: format!(
                "must name a file inside root directory {}",
                root_dir.display()
            ),
        });
    }

    let anchor_root = if root_dir.as_os_str().is_empty() {
        Path::new(".")
    } else {
        root_dir
    };
    let canonical_root = match fs::canonicalize(anchor_root) {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(PalamedesError::UnsafeCatalogPath {
                path: target.to_string_lossy().into_owned(),
                reason: format!(
                    "could not resolve root directory {}: {error}",
                    root_dir.display()
                ),
            });
        }
    };
    let mut current = canonical_root.clone();
    for segment in normal_segments {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(_) => {
                let canonical = fs::canonicalize(&current).map_err(|error| {
                    PalamedesError::UnsafeCatalogPath {
                        path: target.to_string_lossy().into_owned(),
                        reason: format!(
                            "resolves through an invalid or dangling symlink at {}: {error}",
                            current.display()
                        ),
                    }
                })?;
                if !canonical.starts_with(&canonical_root) {
                    return Err(PalamedesError::UnsafeCatalogPath {
                        path: target.to_string_lossy().into_owned(),
                        reason: format!(
                            "escapes root directory {} via symlink {}",
                            canonical_root.display(),
                            current.display()
                        ),
                    });
                }
                current = canonical;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(PalamedesError::UnsafeCatalogPath {
                    path: target.to_string_lossy().into_owned(),
                    reason: format!("could not inspect {}: {error}", current.display()),
                });
            }
        }
    }
    Ok(())
}

/// Resolves a configured catalog pattern to its concrete storage file and
/// enforces both lexical and on-disk symlink containment inside `root_dir`.
///
/// # Errors
///
/// Returns an error when `locale` is invalid, `catalog_path` is absolute or
/// contains `..`, or any existing path component escapes `root_dir` via a
/// symlink.
pub fn resolve_contained_catalog_file_path(
    root_dir: &Path,
    catalog_path: &str,
    locale: &str,
    format: PalamedesCatalogFormat,
) -> PalamedesResult<PathBuf> {
    let resolved = try_resolve_catalog_file_path(root_dir, catalog_path, locale, format)?;
    ensure_catalog_path_contained(root_dir, &resolved)?;
    Ok(resolved)
}

/// Resolves a configured catalog pattern to its concrete storage file.
///
/// A matching storage extension already present in the configured pattern is
/// preserved for compatibility. Case variants and a trailing dot are replaced
/// with the canonical storage extension, matching the legacy path behavior.
/// Otherwise the format extension is appended to the expanded path, so dots in
/// locale names or logical catalog names remain part of the filename.
#[must_use]
pub fn resolve_catalog_file_path(
    root_dir: &Path,
    catalog_path: &str,
    locale: &str,
    format: PalamedesCatalogFormat,
) -> PathBuf {
    let portable_catalog_path = if catalog_path.starts_with('/')
        || catalog_path.starts_with('\\')
        || has_windows_drive_prefix(catalog_path)
    {
        catalog_path.replace('\\', "/")
    } else {
        let normalized = normalize_relative_catalog_pattern(catalog_path);
        if normalized.is_empty() {
            catalog_path.replace('\\', "/")
        } else {
            normalized
        }
    };
    let expanded = root_dir.join(portable_catalog_path.replace("{locale}", locale));
    let extension = format.extension();
    let configured_extension = Path::new(&portable_catalog_path)
        .extension()
        .and_then(|value| value.to_str());

    if configured_extension == Some(extension) {
        return expanded;
    }

    if configured_extension
        .is_some_and(|value| value.is_empty() || value.eq_ignore_ascii_case(extension))
    {
        return expanded.with_extension(extension);
    }

    let mut suffixed = expanded.into_os_string();
    suffixed.push(".");
    suffixed.push(extension);
    PathBuf::from(suffixed)
}

pub(crate) fn resolve_catalog_path(
    config: &CatalogArtifactConfig,
    catalog: &CatalogConfig,
    locale: &str,
) -> PalamedesResult<PathBuf> {
    try_resolve_catalog_file_path(
        Path::new(&config.root_dir),
        &catalog.path,
        locale,
        catalog.format,
    )
}

pub(super) struct PreparedCompilation {
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

/// Compiles a full catalog artifact together with source message identities
/// derived directly from Ferrocat's compilation provenance report.
///
/// Callers that need source identities for cross-catalog conflict diagnostics
/// (such as `pmds catalog compile --target js`) use this entry point without
/// adding hashing overhead to ordinary artifact builds or re-reading the
/// catalog from disk.
///
/// # Errors
///
/// Returns an error under the same conditions as [`compile_catalog_artifact`].
pub fn compile_catalog_artifact_with_source_keys(
    request: &CatalogArtifactRequest,
) -> PalamedesResult<(
    CatalogArtifactResult,
    BTreeMap<String, CatalogArtifactSourceKey>,
)> {
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
    let artifact_options =
        CompileCatalogArtifactOptions::new(&prepared.locale, &request.config.source_locale)
            .with_fallback_chain(&ferrocat_fallback_chain_refs)
            .with_key_strategy(CompiledKeyStrategy::FerrocatV1)
            .with_source_fallback(true)
            .with_icu_compatibility(true)
            .with_icu_options(icu_options);
    let report_options =
        CompileCatalogArtifactReportOptions::new(&prepared.locale, &request.config.source_locale)
            .with_options(artifact_options);

    let report = ferrocat_compile_catalog_artifact_report(&catalogs, &report_options)
        .map_err(PalamedesError::CompileCatalogArtifact)?;
    let source_keys = report
        .provenance
        .messages
        .into_iter()
        .map(|row| {
            (
                row.key,
                CatalogArtifactSourceKey::new(row.source_key.msgid, row.source_key.msgctxt),
            )
        })
        .collect();
    let artifact = build_artifact_result(
        report.artifact,
        prepared.watch_files,
        prepared.fallback_chain,
        request.config.pseudo_locale.as_deref(),
        &prepared.locale,
    )?;
    Ok((artifact, source_keys))
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
    let compiled_id_index = CompiledCatalogIdIndex::new_with_policy(
        &catalogs,
        CompiledKeyStrategy::FerrocatV1,
        RUNTIME_ICU_SYNTAX_POLICY,
    )
    .map_err(PalamedesError::BuildCompiledIdIndex)?;
    compile_selected_prepared(&prepared, &compiled_id_index, request)
}

/// Compiles selected runtime IDs while reusing an explicit catalog cache.
///
/// The cache is caller-owned and validates catalog content on every call.
/// This is intended for hosts that compile many independently selected module
/// sidecars from the same catalog set.
pub fn compile_catalog_artifact_selected_cached(
    cache: &CatalogCompilationCache,
    request: &CatalogArtifactSelectedRequest,
) -> PalamedesResult<CatalogArtifactResult> {
    cache.compile_selected(request)
}

/// Compiles selected runtime IDs without waiting for another cache build.
///
/// A caller that cannot block its current thread, such as the synchronous
/// Node export, uses this path when a matching async build is already in
/// flight. It may repeat the heavy preparation work, but it never parks on
/// the cache's worker completion Condvar.
pub fn compile_catalog_artifact_selected_cached_without_waiting(
    cache: &CatalogCompilationCache,
    request: &CatalogArtifactSelectedRequest,
) -> PalamedesResult<CatalogArtifactResult> {
    cache.compile_selected_without_waiting(request)
}

pub(super) fn compile_selected_prepared(
    prepared: &PreparedCompilation,
    compiled_id_index: &CompiledCatalogIdIndex,
    request: &CatalogArtifactSelectedRequest,
) -> PalamedesResult<CatalogArtifactResult> {
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
        ferrocat_compile_catalog_artifact_selected(&catalogs, compiled_id_index, &options)
            .map_err(PalamedesError::CompileSelectedCatalogArtifact)?;

    build_artifact_result(
        artifact,
        prepared.watch_files.clone(),
        prepared.fallback_chain.clone(),
        request.config.pseudo_locale.as_deref(),
        &prepared.locale,
    )
}
