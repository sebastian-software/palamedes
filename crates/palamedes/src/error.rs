use std::path::PathBuf;

use thiserror::Error;

/// Shared result type for the Rust core.
pub type PalamedesResult<T> = Result<T, PalamedesError>;

/// Error type for the Rust core.
#[derive(Debug, Error)]
pub enum PalamedesError {
    /// The low-level PO parser rejected the input.
    #[error(transparent)]
    ParsePo(#[from] ferrocat::ParseError),
    /// A higher-level `ferrocat` catalog API failed.
    #[error(transparent)]
    CatalogApi(#[from] ferrocat::ApiError),
    /// Reading a file from disk failed.
    #[error("Failed to read {path}: {source}")]
    ReadFile {
        /// Path that was read.
        path: PathBuf,
        #[source]
        /// Underlying filesystem error.
        source: std::io::Error,
    },
    /// A configured catalog glob/path could not be compiled to a matcher.
    #[error("Invalid catalog path pattern {pattern}: {source}")]
    InvalidCatalogPathPattern {
        /// Original catalog path pattern from configuration.
        pattern: String,
        #[source]
        /// Regex compilation error.
        source: regex::Error,
    },
    /// The requested resource path did not expose a locale placeholder value.
    #[error("Could not resolve locale from {resource_path}")]
    CouldNotResolveLocale {
        /// Resource path used for locale extraction.
        resource_path: PathBuf,
    },
    /// The requested locale was derived successfully but is not configured.
    #[error(
        "Resolved locale {locale} for {resource_path} is not listed in palamedes.config locales."
    )]
    ResolvedLocaleNotConfigured {
        /// Locale derived from the resource path.
        locale: String,
        /// Resource path used for resolution.
        resource_path: PathBuf,
    },
    /// No configured catalog path matched the requested resource.
    #[error("Requested resource {resource_path} is not matched to any configured catalog path.")]
    ResourceNotMatchedToCatalogPath {
        /// Resource path requested by the host.
        resource_path: PathBuf,
    },
    /// The primary catalog file does not exist.
    #[error("Catalog file not found: {path}")]
    CatalogFileNotFound {
        /// Missing catalog file path.
        path: PathBuf,
    },
    /// A locale could not be inferred from a catalog file path.
    #[error("Could not infer locale for {path}")]
    CouldNotInferLocale {
        /// Catalog file path that failed locale inference.
        path: PathBuf,
    },
    /// Parsing a catalog file into the semantic catalog model failed.
    #[error("Failed to parse {path}: {source}")]
    ParseCatalog {
        /// Path of the catalog file being parsed.
        path: PathBuf,
        #[source]
        /// Underlying parse or semantic error.
        source: ferrocat::ApiError,
    },
    /// Normalizing a parsed catalog into keyed form failed.
    #[error("Failed to normalize {path}: {source}")]
    NormalizeCatalog {
        /// Path of the catalog file being normalized.
        path: PathBuf,
        #[source]
        /// Underlying normalization error.
        source: ferrocat::ApiError,
    },
    /// Compiling a full catalog artifact failed.
    #[error("Failed to compile catalog artifact: {0}")]
    CompileCatalogArtifact(ferrocat::ApiError),
    /// Building the compiled-ID index failed.
    #[error("Failed to build compiled ID index: {0}")]
    BuildCompiledIdIndex(ferrocat::ApiError),
    /// Compiling a selected catalog artifact failed.
    #[error("Failed to compile selected catalog artifact: {0}")]
    CompileSelectedCatalogArtifact(ferrocat::ApiError),
    /// Catalog updates require non-empty messages.
    #[error("Catalog messages must not be empty")]
    EmptyCatalogMessage,
    /// Parsing source text into an AST failed.
    #[error("Parse error: {messages}")]
    ParseSource {
        /// Joined parser diagnostics.
        messages: String,
    },
    /// Parsing a specific module failed.
    #[error("Parse error in {filename}: {messages}")]
    ParseModuleSource {
        /// Module filename presented to the parser.
        filename: String,
        /// Joined parser diagnostics.
        messages: String,
    },
    /// Explicit author-facing message IDs are no longer supported.
    #[error(
        "Explicit message ids are no longer supported. Remove `id` and rely on message/context instead."
    )]
    ExplicitMessageIdsUnsupported,
}
