use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use palamedes::sdk::{
    RuntimeCompiledMessage, compile_catalog, compile_runtime_catalog_messages, parse_catalog,
};
use palamedes_i18n::{CatalogArtifact, FORMAT_VERSION, Instruction, Message};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{BuildResult, CatalogBuilder, Error, check_argument, lower};

/// An application's exported message contract. Contains no translated text.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogContract {
    version: u32,
    /// Source PO locale required when compiling updates.
    pub source_locale: String,
    pub(crate) fingerprint: String,
    pub(crate) messages: BTreeMap<String, ContractMessage>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ContractMessage {
    pub arguments: BTreeSet<String>,
    pub literal: bool,
}

impl CatalogContract {
    /// Load and validate an exported contract before compiling an update.
    pub fn load(path: impl AsRef<Path>) -> BuildResult<Self> {
        let path = path.as_ref();
        let bytes = fs::read(path).map_err(Error::io(path))?;
        let contract: Self =
            serde_json::from_slice(&bytes).map_err(|source| Error::DecodeContract {
                path: path.to_owned(),
                source,
            })?;
        contract.validate()?;
        Ok(contract)
    }

    pub(crate) fn validate(&self) -> BuildResult<()> {
        check_locale(&self.source_locale)?;
        if self.version != FORMAT_VERSION || self.messages.is_empty() {
            return Err(Error::invalid_contract(
                "unsupported version or no messages",
            ));
        }
        for (id, spec) in &self.messages {
            if id.is_empty() || spec.literal != spec.arguments.is_empty() {
                return Err(Error::invalid_contract("invalid message signature"));
            }
            for argument in &spec.arguments {
                check_argument(argument).map_err(Error::invalid_contract)?;
            }
        }
        if self.fingerprint != fingerprint(&self.messages)? {
            return Err(Error::invalid_contract(
                "fingerprint does not match its message contract",
            ));
        }
        Ok(())
    }
}

/// A target translation resolved through the build-time fallback policy.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingTranslation {
    /// Output locale whose translation is missing or fuzzy.
    pub locale: String,
    /// The source message.
    pub message: String,
    /// The message context (`msgctxt`) that tells apart equal source
    /// messages. Rust catalogs are context-free, so the JavaScript target of
    /// `pmds catalog compile` is the only producer that sets it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Locale whose text was compiled instead.
    pub resolved_locale: String,
}

/// A data-only catalog update and its completeness diagnostics.
#[derive(Debug, Serialize)]
pub struct CatalogUpdate {
    /// One written `<locale>.pmd.json` file per requested locale.
    pub catalogs: Vec<PathBuf>,
    /// Missing or fuzzy translations resolved through the fallback chain.
    pub missing: Vec<MissingTranslation>,
}

pub(crate) struct Signature {
    pub id: String,
    pub arguments: BTreeSet<String>,
    pub literal: bool,
    pub plural_arguments: BTreeSet<String>,
}

pub(crate) struct PreparedCatalogs {
    pub signature: BTreeMap<String, Signature>,
    pub contract: CatalogContract,
    artifacts: BTreeMap<String, CatalogArtifact>,
    pub missing: Vec<MissingTranslation>,
}

impl PreparedCatalogs {
    pub fn remove_stale_catalogs(&self, output: &Path) -> BuildResult<()> {
        let names: BTreeSet<_> = self
            .artifacts
            .keys()
            .map(|locale| format!("{locale}.pmd.json"))
            .collect();
        for entry in fs::read_dir(output).map_err(Error::io(output))? {
            let entry = entry.map_err(Error::io(output))?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().map_err(Error::io(&path))?.is_file()
                && name.ends_with(".pmd.json")
                && !names.contains(&name)
            {
                fs::remove_file(&path).map_err(Error::io(&path))?;
            }
        }
        Ok(())
    }

    pub fn write_catalogs(&self, output: &Path) -> BuildResult<Vec<PathBuf>> {
        // Prepare every byte before changing any existing language file.
        let serialized = self
            .artifacts
            .iter()
            .map(|(locale, artifact)| {
                Ok((
                    output.join(format!("{locale}.pmd.json")),
                    serde_json::to_vec(artifact).map_err(Error::serialize)?,
                ))
            })
            .collect::<BuildResult<Vec<_>>>()?;
        fs::create_dir_all(output).map_err(Error::io(output))?;
        let mut files = Vec::new();
        for (path, bytes) in serialized {
            // Readers see either the old file or the complete replacement.
            let mut builder = tempfile::Builder::new();
            builder.prefix(".pmd-");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // Match ordinary data-file creation while respecting umask.
                builder.permissions(fs::Permissions::from_mode(0o666));
            }
            let mut temporary = builder.tempfile_in(output).map_err(Error::io(output))?;
            if let Ok(metadata) = fs::metadata(&path) {
                temporary
                    .as_file()
                    .set_permissions(metadata.permissions())
                    .map_err(Error::io(temporary.path()))?;
            }
            std::io::Write::write_all(&mut temporary, &bytes)
                .map_err(Error::io(temporary.path()))?;
            temporary
                .persist(&path)
                .map_err(|error| Error::io(&path)(error.error))?;
            files.push(path);
        }
        Ok(files)
    }
}

pub(crate) fn prepare(builder: &CatalogBuilder) -> BuildResult<PreparedCatalogs> {
    if builder.locales.is_empty()
        || builder.locales.iter().collect::<BTreeSet<_>>().len() != builder.locales.len()
    {
        return Err(Error::InvalidLocales);
    }
    let mut inputs = builder.locales.clone();
    for locale in builder
        .fallback_locales
        .iter()
        .chain([&builder.source_locale])
    {
        if !inputs.contains(locale) {
            inputs.push(locale.clone());
        }
    }
    let root = fs::canonicalize(&builder.directory).map_err(Error::io(&builder.directory))?;
    let mut catalogs = BTreeMap::new();
    let mut normalized = BTreeMap::new();
    for locale in &inputs {
        check_locale(locale)?;
        let path = root.join(format!("{locale}.po"));
        let content = fs::read_to_string(&path).map_err(Error::io(&path))?;
        let parse_error = |source: Box<dyn std::error::Error + Send + Sync>| Error::ParsePo {
            locale: locale.clone(),
            source,
        };
        let invalid = |reason: String| Error::InvalidCatalog {
            locale: locale.clone(),
            reason,
        };
        let parsed = ferrocat::po::parse_po(&content).map_err(|error| parse_error(error.into()))?;
        let mut messages = BTreeMap::new();
        for item in parsed
            .items
            .iter()
            .filter(|item| !item.obsolete && !item.msgid.is_empty())
        {
            if item.msgctxt.is_some() || item.msgid_plural.is_some() {
                return Err(invalid(
                    "Rust catalogs require context-free ICU messages".into(),
                ));
            }
            let reviewed = !item.flags.iter().any(|flag| flag == "fuzzy")
                && item.msgstr.first().is_some_and(|value| !value.is_empty());
            if messages.insert(item.msgid.clone(), reviewed).is_some() {
                return Err(invalid(format!("duplicate source {:?}", item.msgid)));
            }
        }
        // The JavaScript target shares this projection, which clears fuzzy
        // values so the compiler resolves them through the fallback chain.
        let catalog = parse_catalog(&content, locale, &builder.source_locale)
            .map_err(|error| parse_error(error.into()))?;
        normalized.insert(locale.clone(), catalog);
        catalogs.insert(locale.clone(), messages);
    }
    let sources = &catalogs[&builder.source_locale];
    if sources.is_empty() {
        return Err(Error::InvalidCatalog {
            locale: builder.source_locale.clone(),
            reason: "source catalog must contain messages".into(),
        });
    }
    for (locale, messages) in &catalogs {
        if let Some(unknown) = messages
            .keys()
            .find(|source| !sources.contains_key(*source))
        {
            return Err(Error::InvalidCatalog {
                locale: locale.clone(),
                reason: format!("source {unknown:?} is absent from the source catalog"),
            });
        }
    }
    let source_messages: BTreeMap<_, _> = sources
        .keys()
        .map(|source| {
            (
                key(source),
                ferrocat::canonicalize_icu_with_policy(
                    source,
                    ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
                )
                .into_owned(),
            )
        })
        .collect();
    let source_programs = compile_runtime_catalog_messages(&source_messages);
    let mut signature = BTreeMap::new();
    let mut specifications = BTreeMap::new();
    for source in sources.keys() {
        let id = key(source);
        let (message, arguments, literal) =
            compile_message(&id, &source_messages, &source_programs).map_err(|reason| {
                Error::UnsupportedMessage {
                    locale: builder.source_locale.clone(),
                    message: source.clone(),
                    reason,
                }
            })?;
        specifications.insert(
            id.clone(),
            ContractMessage {
                arguments: arguments.clone(),
                literal,
            },
        );
        signature.insert(
            source.clone(),
            Signature {
                id,
                arguments,
                literal,
                plural_arguments: message_plural_arguments(&message),
            },
        );
    }
    let contract = CatalogContract {
        version: FORMAT_VERSION,
        source_locale: builder.source_locale.clone(),
        fingerprint: fingerprint(&specifications)?,
        messages: specifications,
    };
    let mut artifacts = BTreeMap::new();
    let mut missing = Vec::new();
    for locale in &builder.locales {
        let fallback_locales = builder
            .fallback_locales
            .iter()
            .map(String::as_str)
            .filter(|fallback| *fallback != locale && *fallback != builder.source_locale)
            .collect::<Vec<_>>();
        let artifact = compile_catalog(
            &normalized.values().collect::<Vec<_>>(),
            locale,
            &builder.source_locale,
            &fallback_locales,
        )
        .map_err(|error| Error::CompileCatalog {
            locale: locale.clone(),
            source: error.into(),
        })?;
        let programs = compile_runtime_catalog_messages(&artifact.messages);
        let mut messages = BTreeMap::new();
        for (source, spec) in &signature {
            let (message, arguments, literal) =
                compile_message(&spec.id, &artifact.messages, &programs).map_err(|reason| {
                    Error::UnsupportedMessage {
                        locale: locale.clone(),
                        message: source.clone(),
                        reason,
                    }
                })?;
            if arguments != spec.arguments || literal != spec.literal {
                return Err(Error::PlaceholderMismatch {
                    locale: locale.clone(),
                    message: source.clone(),
                });
            }
            if !message_plural_arguments(&message).is_subset(&spec.plural_arguments) {
                return Err(Error::PluralArgument {
                    locale: locale.clone(),
                    message: source.clone(),
                });
            }
            if locale != &builder.source_locale
                && !catalogs[locale].get(source).copied().unwrap_or(false)
            {
                let resolved_locale = artifact
                    .missing
                    .iter()
                    .find(|entry| entry.key == spec.id)
                    .and_then(|entry| entry.resolved_locale.clone())
                    .unwrap_or_else(|| builder.source_locale.clone());
                missing.push(MissingTranslation {
                    locale: locale.clone(),
                    message: source.clone(),
                    context: None,
                    resolved_locale,
                });
            }
            messages.insert(spec.id.clone(), message);
        }
        artifacts.insert(
            locale.clone(),
            CatalogArtifact {
                version: FORMAT_VERSION,
                fingerprint: contract.fingerprint.clone(),
                locale: locale.clone(),
                messages,
            },
        );
    }
    if builder.fail_on_missing
        && let Some(first) = missing.first()
    {
        return Err(Error::MissingTranslation {
            locale: first.locale.clone(),
            message: first.message.clone(),
        });
    }
    Ok(PreparedCatalogs {
        signature,
        contract,
        artifacts,
        missing,
    })
}

fn key(source: &str) -> String {
    ferrocat::compiled_key_with_policy(
        source,
        None,
        ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
    )
}

/// Compile one message. Errors are reasons; the caller adds the locale and
/// source message.
fn compile_message(
    id: &str,
    messages: &BTreeMap<String, String>,
    programs: &BTreeMap<String, RuntimeCompiledMessage>,
) -> Result<(Message, BTreeSet<String>, bool), String> {
    let mut arguments = BTreeSet::new();
    let message = match programs.get(id) {
        None => Message::Literal(
            messages
                .get(id)
                .ok_or_else(|| format!("compiled message missing: {id}"))?
                .clone(),
        ),
        Some(RuntimeCompiledMessage::Nodes(nodes)) => {
            let program = lower(nodes, &mut arguments)?;
            palamedes_i18n::validate_program(&program).map_err(|error| error.to_string())?;
            if arguments.is_empty() {
                Message::Literal(
                    program
                        .into_iter()
                        .map(|instruction| match instruction {
                            Instruction::Text { value } => value,
                            _ => unreachable!("argument-free program contains only text"),
                        })
                        .collect(),
                )
            } else {
                Message::Program(program)
            }
        }
        Some(RuntimeCompiledMessage::Lazy) => {
            return Err("invalid ICU".into());
        }
    };
    let literal = matches!(message, Message::Literal(_));
    Ok((message, arguments, literal))
}

fn fingerprint(messages: &BTreeMap<String, ContractMessage>) -> BuildResult<String> {
    // IDs hash the full source ICU, including numeric argument requirements.
    // Updates recompile that source PO before comparing the exported contract.
    let contract: BTreeMap<_, _> = messages
        .iter()
        .map(|(id, spec)| (id, (&spec.arguments, spec.literal)))
        .collect();
    Ok(
        Sha256::digest(serde_json::to_vec(&contract).map_err(Error::serialize)?)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

fn check_locale(locale: &str) -> BuildResult<()> {
    if locale.is_empty()
        || !locale
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(Error::InvalidLocale {
            locale: locale.to_owned(),
        });
    }
    Ok(())
}

fn message_plural_arguments(message: &Message) -> BTreeSet<String> {
    match message {
        Message::Literal(_) => BTreeSet::new(),
        Message::Program(program) => palamedes_i18n::plural_arguments(program)
            .into_iter()
            .map(str::to_owned)
            .collect(),
    }
}
