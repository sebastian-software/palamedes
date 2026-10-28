use std::path::PathBuf;

/// A boxed error from a dependency whose type is not part of this crate's API.
type Source = Box<dyn std::error::Error + Send + Sync + 'static>;

/// Errors returned while extracting, compiling, or installing Rust catalogs.
///
/// New variants can appear in minor releases, so a `match` needs a wildcard
/// arm. Errors from the PO and ICU compiler are available through
/// [`std::error::Error::source`] without exposing that compiler's types.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A file or directory could not be read, written, or listed.
    #[error("could not access {}: {source}", path.display())]
    Io {
        /// The file or directory that failed.
        path: PathBuf,
        /// The operating-system error.
        source: std::io::Error,
    },
    /// [`CatalogBuilder::build`](crate::CatalogBuilder::build) ran outside a
    /// Cargo build script.
    #[error(
        "OUT_DIR is not available; call build() from a Cargo build script or use compile_to(): {source}"
    )]
    OutDir {
        /// Why the environment variable could not be read.
        source: std::env::VarError,
    },
    /// Rust source passed to [`extract_messages`](crate::extract_messages)
    /// could not be tokenized.
    #[error("could not tokenize Rust source: {source}")]
    RustSource {
        /// The tokenizer error.
        source: Source,
    },
    /// A translation macro call does not use a literal source message.
    #[error("{macro_name}! requires a literal source message at line {line}")]
    DynamicMessage {
        /// The macro name that was searched for.
        macro_name: String,
        /// One-based line of the macro call.
        line: usize,
    },
    /// The configured macro name is not a Rust identifier.
    #[error("generated macro name must be a Rust identifier: {name:?}")]
    InvalidMacroName {
        /// The rejected name.
        name: String,
    },
    /// The configured module path is not a Rust path starting with `crate`.
    #[error("generated module path must be a Rust path starting with crate: {path:?}")]
    InvalidModulePath {
        /// The rejected path.
        path: String,
    },
    /// No output locale was selected, or one was selected twice.
    #[error("output locales must be nonempty and unique")]
    InvalidLocales,
    /// A locale is empty or contains characters other than ASCII letters,
    /// digits, and `-`.
    #[error("invalid catalog locale: {locale}")]
    InvalidLocale {
        /// The rejected locale.
        locale: String,
    },
    /// A PO catalog could not be parsed.
    #[error("{locale}: invalid PO catalog: {source}")]
    ParsePo {
        /// Locale of the catalog.
        locale: String,
        /// The parser error.
        source: Source,
    },
    /// A PO catalog parsed, but its content cannot be compiled for Rust.
    #[error("{locale}: {reason}")]
    InvalidCatalog {
        /// Locale of the catalog.
        locale: String,
        /// What is wrong with the catalog.
        reason: String,
    },
    /// The catalog compiler rejected a catalog, for example because of
    /// invalid ICU syntax.
    #[error("{locale}: could not compile catalog: {source}")]
    CompileCatalog {
        /// Locale of the catalog.
        locale: String,
        /// The compiler error.
        source: Source,
    },
    /// A message uses syntax that Rust catalogs do not support.
    #[error("{locale}: {reason} in {message:?}")]
    UnsupportedMessage {
        /// Locale of the catalog.
        locale: String,
        /// The source message.
        message: String,
        /// What is unsupported.
        reason: String,
    },
    /// A translation uses different placeholders than its source message.
    #[error("{locale}: placeholder mismatch for {message:?}")]
    PlaceholderMismatch {
        /// Locale of the translation.
        locale: String,
        /// The source message.
        message: String,
    },
    /// A translation pluralizes an argument that the source message only
    /// displays, which would require a number from existing callers.
    #[error(
        "{locale}: translation introduces a plural for a nonnumeric source argument in {message:?}"
    )]
    PluralArgument {
        /// Locale of the translation.
        locale: String,
        /// The source message.
        message: String,
    },
    /// A translation is missing or fuzzy while `fail_on_missing` is set.
    #[error("{locale}: missing or fuzzy translation for {message:?} (fail_on_missing)")]
    MissingTranslation {
        /// Locale of the translation.
        locale: String,
        /// The source message.
        message: String,
    },
    /// The catalogs describe a different message contract than the exported
    /// schema, so the application needs a rebuild.
    #[error(
        "catalog update changes the application message contract; rebuild the application and export a matching schema"
    )]
    ContractMismatch,
    /// An exported schema file is not valid JSON for this format.
    #[error("invalid Rust catalog schema {}: {source}", path.display())]
    DecodeContract {
        /// The schema file.
        path: PathBuf,
        /// The decoding error.
        source: serde_json::Error,
    },
    /// An exported schema decoded, but its content is invalid or unsupported.
    #[error("invalid Rust catalog schema: {reason}")]
    InvalidContract {
        /// What is wrong with the schema.
        reason: String,
    },
    /// Compiled catalog data could not be serialized.
    #[error("could not serialize compiled catalog data: {source}")]
    Serialize {
        /// The serialization error.
        source: serde_json::Error,
    },
}

impl Error {
    pub(crate) fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> Self {
        let path = path.into();
        move |source| Self::Io { path, source }
    }

    pub(crate) fn invalid_contract(reason: impl Into<String>) -> Self {
        Self::InvalidContract {
            reason: reason.into(),
        }
    }

    pub(crate) fn serialize(source: serde_json::Error) -> Self {
        Self::Serialize { source }
    }
}
