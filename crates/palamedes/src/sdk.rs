//! Compiler entry points that `palamedes-build` uses to prepare Rust catalogs.
//!
//! This module is the only part of the `palamedes` crate covered by SemVer.
//! It parses and compiles PO catalogs for the Rust target and lowers the
//! compiled ICU messages into runtime programs, sharing that lowering and the
//! fuzzy-entry projection with the JavaScript target. Applications normally
//! depend on `palamedes-build` and `palamedes-i18n` instead of calling these
//! items directly.
//!
//! Every signature here uses Palamedes or standard library types only, so a
//! change of the underlying catalog library does not break this module.
//! The message enums are exhaustive: a new node or choice kind is a breaking
//! change and waits for a major release.
//!
//! ```rust
//! use palamedes::sdk::{
//!     RuntimeCompiledMessage, RuntimeMessageChoiceKind, RuntimeMessageNode, compile_catalog,
//!     compile_runtime_catalog_messages, parse_catalog,
//! };
//!
//! let source = "msgid \"{count, plural, one {# file} other {# files}}\"\n\
//!               msgstr \"{count, plural, one {# file} other {# files}}\"\n";
//! let english = parse_catalog(source, "en", "en")?;
//! let compiled = compile_catalog(&[&english], "en", "en", &[])?;
//! assert!(compiled.missing.is_empty());
//!
//! let programs = compile_runtime_catalog_messages(&compiled.messages);
//! let Some(RuntimeCompiledMessage::Nodes(nodes)) = programs.values().next() else {
//!     panic!("plural messages lower to runtime nodes");
//! };
//! assert!(matches!(
//!     &nodes[0],
//!     RuntimeMessageNode::Choice {
//!         kind: RuntimeMessageChoiceKind::Plural,
//!         ..
//!     }
//! ));
//! # Ok::<(), palamedes::sdk::Error>(())
//! ```

use std::collections::BTreeMap;
use std::fmt;

use ferrocat::{
    CompileCatalogArtifactIcuOptions, CompileCatalogArtifactOptions, CompiledKeyStrategy,
    IcuSyntaxPolicy, NormalizedParsedCatalog, ParseCatalogOptions,
};

pub use crate::runtime_message::{
    RuntimeCompiledMessage, RuntimeCompiledMessages, RuntimeMessageChoiceKind,
    RuntimeMessageFormat, RuntimeMessageNode, compile_runtime_catalog_messages,
};

/// A catalog could not be parsed or compiled.
///
/// The message describes the failure; [`std::error::Error::source`] returns
/// the underlying cause when there is one.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct Error(Box<dyn std::error::Error + Send + Sync + 'static>);

impl Error {
    fn new(error: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self(Box::new(error))
    }
}

/// One parsed PO catalog, ready for [`compile_catalog`].
///
/// Fuzzy translations are already cleared, so compilation resolves them
/// through the fallback chain like missing translations.
pub struct ParsedCatalog(NormalizedParsedCatalog);

impl fmt::Debug for ParsedCatalog {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ParsedCatalog")
            .field("messages", &self.0.message_count())
            .finish_non_exhaustive()
    }
}

/// Parse the PO `content` of one `locale` against the catalog family's
/// `source_locale`.
///
/// # Errors
///
/// Returns an error when the PO content cannot be parsed or contains
/// conflicting entries.
pub fn parse_catalog(
    content: &str,
    locale: &str,
    source_locale: &str,
) -> Result<ParsedCatalog, Error> {
    crate::catalog_artifact::parse_catalog_for_compile(
        ParseCatalogOptions::new(content, source_locale).with_locale(locale),
    )
    .map(ParsedCatalog)
    .map_err(Error::new)
}

/// Runtime messages compiled for one locale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledCatalog {
    /// Compiled ICU message per runtime key, after fallback resolution.
    pub messages: BTreeMap<String, String>,
    /// Messages that the requested locale did not translate.
    pub missing: Vec<MissingMessage>,
}

/// A message that was missing, empty, or fuzzy in the requested locale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingMessage {
    /// Runtime key of the message.
    pub key: String,
    /// Locale whose text was compiled instead, if any.
    pub resolved_locale: Option<String>,
}

/// Compile `locale` from parsed catalogs with the Rust target's policy.
///
/// `catalogs` must include the requested locale, each fallback locale, and
/// the source locale. Missing translations resolve through
/// `fallback_locales` in order, then the source message. Messages are keyed
/// by the runtime key of their source text, ICU is validated strictly, and
/// apostrophes follow the runtime's literal-apostrophe policy.
///
/// # Errors
///
/// Returns an error when a catalog is missing or a message has invalid ICU.
pub fn compile_catalog(
    catalogs: &[&ParsedCatalog],
    locale: &str,
    source_locale: &str,
    fallback_locales: &[&str],
) -> Result<CompiledCatalog, Error> {
    let options = CompileCatalogArtifactOptions::new(locale, source_locale)
        .with_fallback_chain(fallback_locales)
        .with_key_strategy(CompiledKeyStrategy::FerrocatV1)
        .with_source_fallback(true)
        .with_strict_icu(true)
        .with_icu_compatibility(true)
        .with_icu_options(
            CompileCatalogArtifactIcuOptions::new()
                .with_syntax_policy(IcuSyntaxPolicy::RuntimeLiteralApostrophes),
        );
    let catalogs: Vec<_> = catalogs.iter().map(|catalog| &catalog.0).collect();
    let artifact = ferrocat::compile_catalog_artifact(&catalogs, &options).map_err(Error::new)?;
    Ok(CompiledCatalog {
        messages: artifact.messages,
        missing: artifact
            .missing
            .into_iter()
            .map(|missing| MissingMessage {
                key: missing.key,
                resolved_locale: missing.resolved_locale,
            })
            .collect(),
    })
}
