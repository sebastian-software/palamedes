use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use ferrocat::{
    CompileCatalogArtifactIcuOptions, CompileCatalogArtifactOptions, CompiledKeyStrategy,
    ParseCatalogOptions,
};
use palamedes::{
    RuntimeCompiledMessage, compile_runtime_catalog_messages, parse_catalog_for_compile,
};
use palamedes_i18n::{CatalogArtifact, FORMAT_VERSION, Instruction, Message};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{BuildResult, CatalogBuilder, check_argument, lower};

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
        let contract: Self = serde_json::from_slice(&fs::read(path).map_err(|error| {
            format!(
                "could not read Rust catalog schema {}: {error}",
                path.display()
            )
        })?)
        .map_err(|error| format!("invalid Rust catalog schema {}: {error}", path.display()))?;
        contract.validate()?;
        Ok(contract)
    }

    pub(crate) fn validate(&self) -> BuildResult<()> {
        check_locale(&self.source_locale)?;
        if self.version != FORMAT_VERSION || self.messages.is_empty() {
            return Err("unsupported or empty Rust catalog schema".into());
        }
        for (id, spec) in &self.messages {
            if id.is_empty() || spec.literal != spec.arguments.is_empty() {
                return Err("invalid message signature in Rust catalog schema".into());
            }
            for argument in &spec.arguments {
                check_argument(argument)?;
            }
        }
        if self.fingerprint != fingerprint(&self.messages)? {
            return Err(
                "Rust catalog schema fingerprint does not match its message contract".into(),
            );
        }
        Ok(())
    }
}

/// A target translation resolved through the build-time fallback policy.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingTranslation {
    pub locale: String,
    pub message: String,
    pub resolved_locale: String,
}

/// A data-only catalog update and its completeness diagnostics.
#[derive(Debug, Serialize)]
pub struct CatalogUpdate {
    pub catalogs: Vec<PathBuf>,
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
        for entry in fs::read_dir(output)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type()?.is_file() && name.ends_with(".pmd.json") && !names.contains(&name)
            {
                fs::remove_file(entry.path())?;
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
                    serde_json::to_vec(artifact)?,
                ))
            })
            .collect::<BuildResult<Vec<_>>>()?;
        fs::create_dir_all(output)?;
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
            let mut temporary = builder.tempfile_in(output)?;
            if let Ok(metadata) = fs::metadata(&path) {
                temporary
                    .as_file()
                    .set_permissions(metadata.permissions())?;
            }
            std::io::Write::write_all(&mut temporary, &bytes)?;
            temporary.persist(&path)?;
            files.push(path);
        }
        Ok(files)
    }
}

pub(crate) fn prepare(builder: &CatalogBuilder) -> BuildResult<PreparedCatalogs> {
    if builder.locales.is_empty()
        || builder.locales.iter().collect::<BTreeSet<_>>().len() != builder.locales.len()
    {
        return Err("output locales must be nonempty and unique".into());
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
    let root = fs::canonicalize(&builder.directory)?;
    let mut catalogs = BTreeMap::new();
    let mut normalized = BTreeMap::new();
    for locale in &inputs {
        check_locale(locale)?;
        let path = root.join(format!("{locale}.po"));
        let content =
            fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
        let parsed = ferrocat::po::parse_po(&content)?;
        let mut messages = BTreeMap::new();
        for item in parsed
            .items
            .iter()
            .filter(|item| !item.obsolete && !item.msgid.is_empty())
        {
            if item.msgctxt.is_some() || item.msgid_plural.is_some() {
                return Err(
                    format!("{locale}: Rust catalogs require context-free ICU messages").into(),
                );
            }
            let reviewed = !item.flags.iter().any(|flag| flag == "fuzzy")
                && item.msgstr.first().is_some_and(|value| !value.is_empty());
            if messages.insert(item.msgid.clone(), reviewed).is_some() {
                return Err(format!("{locale}: duplicate source {:?}", item.msgid).into());
            }
        }
        // The JavaScript target shares this projection, which clears fuzzy
        // values so the compiler resolves them through the fallback chain.
        let catalog = parse_catalog_for_compile(
            ParseCatalogOptions::new(&content, &builder.source_locale).with_locale(locale),
        )?;
        normalized.insert(locale.clone(), catalog);
        catalogs.insert(locale.clone(), messages);
    }
    let sources = &catalogs[&builder.source_locale];
    if sources.is_empty() {
        return Err("source catalog must contain messages".into());
    }
    for (locale, messages) in &catalogs {
        if let Some(unknown) = messages
            .keys()
            .find(|source| !sources.contains_key(*source))
        {
            return Err(
                format!("{locale}: source {unknown:?} is absent from the source catalog").into(),
            );
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
            compile_message(&id, &source_messages, &source_programs)?;
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
        let options = CompileCatalogArtifactOptions::new(locale, &builder.source_locale)
            .with_fallback_chain(&fallback_locales)
            .with_key_strategy(CompiledKeyStrategy::FerrocatV1)
            .with_source_fallback(true)
            .with_strict_icu(true)
            .with_icu_compatibility(true)
            .with_icu_options(
                CompileCatalogArtifactIcuOptions::new()
                    .with_syntax_policy(ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes),
            );
        let artifact =
            ferrocat::compile_catalog_artifact(&normalized.values().collect::<Vec<_>>(), &options)?;
        let programs = compile_runtime_catalog_messages(&artifact.messages);
        let mut messages = BTreeMap::new();
        for (source, spec) in &signature {
            let (message, arguments, literal) =
                compile_message(&spec.id, &artifact.messages, &programs)?;
            if arguments != spec.arguments || literal != spec.literal {
                return Err(format!("{locale}: placeholder mismatch for {source:?}").into());
            }
            if !message_plural_arguments(&message).is_subset(&spec.plural_arguments) {
                return Err(format!("{locale}: translation introduces a plural for a nonnumeric source argument in {source:?}").into());
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
    if builder.fail_on_missing && !missing.is_empty() {
        let first = &missing[0];
        return Err(format!(
            "{}: missing or fuzzy translation for {:?} (fail_on_missing)",
            first.locale, first.message
        )
        .into());
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

fn compile_message(
    id: &str,
    messages: &BTreeMap<String, String>,
    programs: &BTreeMap<String, RuntimeCompiledMessage>,
) -> BuildResult<(Message, BTreeSet<String>, bool)> {
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
            palamedes_i18n::validate_program(&program)?;
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
            return Err(format!("invalid ICU for compiled message {id}").into());
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
    Ok(Sha256::digest(serde_json::to_vec(&contract)?)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn check_locale(locale: &str) -> BuildResult<()> {
    if locale.is_empty()
        || !locale
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(format!("invalid catalog locale: {locale}").into());
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
