//! Rust message rendering from external, build-compiled catalogs.
//!
//! No catalogs, source-message fallback, or ICU parser are embedded here.
//! `palamedes-build` generates the schema and author-facing translation macro.

mod arguments;
mod plural;

pub use arguments::{MacroArgument, ParsePluralNumberError, PluralNumber, format_argument};

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Version of the external instruction format. Not an ICU or PO input format.
pub const FORMAT_VERSION: u32 = 2;

/// Internal compile-time support for generated macros, including raw literals.
#[doc(hidden)]
pub const fn source_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    let mut index = 0;
    while index < left.len() {
        if left[index] != right[index] {
            return false;
        }
        index += 1;
    }
    true
}

/// Internal const argument-kind lookup used by generated macros.
#[doc(hidden)]
pub const fn is_plural_argument(arguments: &[&str], name: &str) -> bool {
    let mut index = 0;
    while index < arguments.len() {
        if source_eq(arguments[index], name) {
            return true;
        }
        index += 1;
    }
    false
}

/// Internal lexicographic comparison used by generated const binary searches.
#[doc(hidden)]
pub const fn source_cmp(left: &str, right: &str) -> i8 {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut index = 0;
    while index < left.len() && index < right.len() {
        if left[index] < right[index] {
            return -1;
        }
        if left[index] > right[index] {
            return 1;
        }
        index += 1;
    }
    if left.len() < right.len() {
        -1
    } else if left.len() > right.len() {
        1
    } else {
        0
    }
}

/// Internal compile-time argument validation for generated translation calls.
#[doc(hidden)]
pub const fn assert_arguments(expected: &[&str], supplied: &[&str]) {
    assert!(
        expected.len() == supplied.len(),
        "translation argument count mismatch"
    );
    let mut index = 0;
    while index < supplied.len() {
        let mut matched = false;
        let mut candidate = 0;
        while candidate < expected.len() {
            if source_eq(supplied[index], expected[candidate]) {
                matched = true;
            }
            candidate += 1;
        }
        assert!(matched, "unknown translation argument");
        let mut previous = 0;
        while previous < index {
            assert!(
                !source_eq(supplied[index], supplied[previous]),
                "duplicate translation argument"
            );
            previous += 1;
        }
        index += 1;
    }
}

/// Build-generated identity and argument contract for a catalog family.
#[derive(Clone, Copy, Debug)]
pub struct Schema {
    /// Fingerprint of the message identities and their argument sets.
    pub fingerprint: &'static str,
    /// Required messages. Contains internal IDs, never source text.
    pub messages: &'static [MessageSpec],
}

/// Build-generated signature of one message.
#[derive(Debug)]
pub struct MessageSpec {
    /// Internal compiled lookup key.
    pub id: &'static str,
    /// Named arguments, sorted for deterministic comparison.
    pub arguments: &'static [&'static str],
    /// Arguments that the source message requires to be numeric plural operands.
    pub plural_arguments: &'static [&'static str],
    /// Whether this message is safe to borrow as literal text.
    pub literal: bool,
}

/// Serializable compiler output. Applications load it through [`Catalog`].
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogArtifact {
    /// Instruction format version.
    pub version: u32,
    /// Application message contract fingerprint.
    pub fingerprint: String,
    /// Locale that this artifact renders.
    pub locale: String,
    /// Exactly one compiled representation per message.
    pub messages: BTreeMap<String, Message>,
}

/// A compiled literal or message program, never an unparsed ICU pattern.
#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Message {
    /// Text which is already fully compiled.
    Literal(String),
    /// Build-lowered operations evaluated by the Rust runtime.
    Program(Vec<Instruction>),
}

/// The supported Rust instruction set. Unsupported ICU fails at build time.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Instruction {
    /// Append literal text, including already-resolved ICU quoting.
    Text { value: String },
    /// Append a named argument without interpreting its contents.
    Argument { name: String },
    /// Select a string branch, using `other` when no branch matches.
    Select {
        name: String,
        options: BTreeMap<String, Vec<Instruction>>,
    },
    /// Select an exact numeric branch before applying the locale's CLDR rules.
    Plural {
        name: String,
        kind: PluralKind,
        offset: u32,
        options: BTreeMap<String, Vec<Instruction>>,
    },
    /// Append the innermost plural's offset-adjusted value as plain decimal text.
    Pound,
}

/// CLDR rule family used by a compiled plural instruction.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluralKind {
    /// Quantity categories, such as one file versus several files.
    Cardinal,
    /// Position categories, such as first, second, and third.
    Ordinal,
}

/// Load or rendering errors. Hosts choose how to present them.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// External artifact could not be read.
    #[error("could not read catalog {path}: {source}")]
    Io {
        path: std::path::PathBuf,
        source: std::io::Error,
    },
    /// Artifact is not valid compiled catalog data.
    #[error("invalid compiled catalog: {0}")]
    Decode(#[from] serde_json::Error),
    /// A file was read but decoding or validation failed.
    #[error("could not load compiled catalog {path}: {source}")]
    Load {
        path: std::path::PathBuf,
        #[source]
        source: Box<Error>,
    },
    /// The producer uses a different instruction format.
    #[error("compiled catalog format version mismatch: expected {expected}, found {actual}")]
    FormatVersion { expected: u32, actual: u32 },
    /// The file belongs to another locale.
    #[error("compiled catalog locale mismatch: expected {expected}, found {actual}")]
    Locale { expected: String, actual: String },
    /// The file was compiled against a different application contract.
    #[error("compiled catalog contract fingerprint mismatch: expected {expected}, found {actual}")]
    Contract { expected: String, actual: String },
    /// Message inventory or arguments are incompatible.
    #[error("incompatible compiled catalog: {0}")]
    Incompatible(String),
    /// A lookup was not part of the catalog contract.
    #[error("compiled catalog does not contain message {0}")]
    MissingMessage(String),
    /// Render arguments do not match the compiled message contract.
    #[error("invalid arguments for compiled message {0}")]
    Arguments(String),
    /// A plural value or offset arithmetic exceeds the supported decimal domain.
    #[error(
        "invalid plural argument {name}: {value:?}; expected a plain decimal with at most 18 fractional digits and an i128 coefficient, including after offset subtraction"
    )]
    PluralArgument { name: String, value: String },
    /// The selected locale cannot provide the required plural rules.
    #[error("could not load plural rules for locale {locale}: {details}")]
    PluralRules { locale: String, details: String },
}

/// An owned, validated catalog for one explicit locale.
///
/// Independent catalogs can be shared across threads or used per request.
/// Loading never probes another locale or substitutes source text.
#[derive(Debug)]
pub struct Catalog {
    artifact: CatalogArtifact,
    specifications: BTreeMap<&'static str, &'static MessageSpec>,
    plural_rules: plural::Rules,
}

impl Catalog {
    /// Decode and validate external bytes against the program's schema.
    pub fn from_bytes(bytes: &[u8], locale: &str, schema: Schema) -> Result<Self, Error> {
        let artifact: CatalogArtifact = serde_json::from_slice(bytes)?;
        if artifact.version != FORMAT_VERSION {
            return Err(Error::FormatVersion {
                expected: FORMAT_VERSION,
                actual: artifact.version,
            });
        }
        if artifact.locale != locale {
            return Err(Error::Locale {
                expected: locale.into(),
                actual: artifact.locale,
            });
        }
        if artifact.fingerprint != schema.fingerprint {
            return Err(Error::Contract {
                expected: schema.fingerprint.into(),
                actual: artifact.fingerprint,
            });
        }
        if artifact.messages.len() != schema.messages.len() {
            return Err(Error::Incompatible("message inventory mismatch".into()));
        }
        let mut plural_kinds = BTreeSet::new();
        for spec in schema.messages {
            let message = artifact
                .messages
                .get(spec.id)
                .ok_or_else(|| Error::MissingMessage(spec.id.into()))?;
            let mut arguments = BTreeSet::new();
            match message {
                Message::Literal(_) if spec.literal => {}
                Message::Program(program) if !spec.literal => {
                    validate(program, &mut arguments, &mut plural_kinds, false)?
                }
                _ => {
                    return Err(Error::Incompatible(format!(
                        "message kind mismatch: {}",
                        spec.id
                    )));
                }
            }
            if arguments.into_iter().ne(spec.arguments.iter().copied()) {
                return Err(Error::Incompatible(format!(
                    "argument mismatch: {}",
                    spec.id
                )));
            }
            if spec
                .plural_arguments
                .iter()
                .any(|name| !spec.arguments.contains(name))
            {
                return Err(Error::Incompatible(format!(
                    "invalid plural signature: {}",
                    spec.id
                )));
            }
            if let Message::Program(program) = message
                && plural_arguments(program)
                    .iter()
                    .any(|name| !spec.plural_arguments.contains(name))
            {
                return Err(Error::Incompatible(format!(
                    "plural argument kind mismatch: {}",
                    spec.id
                )));
            }
        }
        let specifications: BTreeMap<_, _> = schema
            .messages
            .iter()
            .map(|message| (message.id, message))
            .collect();
        if specifications.len() != schema.messages.len() {
            return Err(Error::Incompatible(
                "duplicate schema message identity".into(),
            ));
        }
        let plural_rules = plural::Rules::new(locale, &plural_kinds)?;
        Ok(Self {
            artifact,
            specifications,
            plural_rules,
        })
    }

    /// Load from a caller-selected file. Relative paths are relative to its CWD.
    pub fn load(path: impl AsRef<Path>, locale: &str, schema: Schema) -> Result<Self, Error> {
        let path = path.as_ref();
        let bytes = std::fs::read(path).map_err(|source| Error::Io {
            path: path.to_owned(),
            source,
        })?;
        Self::from_bytes(&bytes, locale, schema).map_err(|source| Error::Load {
            path: path.to_owned(),
            source: Box::new(source),
        })
    }

    /// The locale actually loaded. No ambient process-global state is used.
    pub fn locale(&self) -> &str {
        &self.artifact.locale
    }

    /// Borrow an already-compiled constant string.
    pub fn literal(&self, id: &str) -> Result<&str, Error> {
        match self.artifact.messages.get(id) {
            Some(Message::Literal(value)) => Ok(value),
            Some(_) => Err(Error::Arguments(id.into())),
            None => Err(Error::MissingMessage(id.into())),
        }
    }

    /// Render with named display values. Argument text is never parsed as ICU.
    pub fn render(&self, id: &str, values: &[(&str, String)]) -> Result<String, Error> {
        let spec = self
            .specifications
            .get(id)
            .ok_or_else(|| Error::MissingMessage(id.into()))?;
        let arguments: BTreeMap<_, _> = values
            .iter()
            .map(|(name, value)| (*name, value.as_str()))
            .collect();
        if arguments.len() != values.len()
            || arguments.keys().copied().ne(spec.arguments.iter().copied())
        {
            return Err(Error::Arguments(id.into()));
        }
        match &self.artifact.messages[id] {
            Message::Literal(value) => Ok(value.clone()),
            Message::Program(program) => {
                let mut output = String::new();
                execute(program, &arguments, &self.plural_rules, &mut output, None)?;
                Ok(output)
            }
        }
    }
}

/// Internal compiler support: validate the prepared instruction contract.
#[doc(hidden)]
pub fn validate_program(program: &[Instruction]) -> Result<(), Error> {
    validate(program, &mut BTreeSet::new(), &mut BTreeSet::new(), false)
}

/// Internal compiler support: collect numeric requirements, including nested choices.
#[doc(hidden)]
pub fn plural_arguments(program: &[Instruction]) -> BTreeSet<&str> {
    let mut arguments = BTreeSet::new();
    for instruction in program {
        match instruction {
            Instruction::Select { options, .. } | Instruction::Plural { options, .. } => {
                if let Instruction::Plural { name, .. } = instruction {
                    arguments.insert(name.as_str());
                }
                for branch in options.values() {
                    arguments.extend(plural_arguments(branch));
                }
            }
            _ => {}
        }
    }
    arguments
}

fn validate<'a>(
    program: &'a [Instruction],
    arguments: &mut BTreeSet<&'a str>,
    plural_kinds: &mut BTreeSet<PluralKind>,
    in_plural: bool,
) -> Result<(), Error> {
    for instruction in program {
        match instruction {
            Instruction::Text { .. } => {}
            Instruction::Argument { name } => {
                arguments.insert(name);
            }
            Instruction::Select { name, options } => {
                arguments.insert(name);
                if !options.contains_key("other") {
                    return Err(Error::Incompatible(
                        "select requires an other branch".into(),
                    ));
                }
                for branch in options.values() {
                    validate(branch, arguments, plural_kinds, in_plural)?;
                }
            }
            Instruction::Plural {
                name,
                kind,
                options,
                ..
            } => {
                arguments.insert(name);
                plural_kinds.insert(*kind);
                plural::validate_options(options)?;
                for branch in options.values() {
                    validate(branch, arguments, plural_kinds, true)?;
                }
            }
            Instruction::Pound if !in_plural => {
                return Err(Error::Incompatible(
                    "pound instruction requires an enclosing plural".into(),
                ));
            }
            Instruction::Pound => {}
        }
    }
    Ok(())
}

fn execute(
    program: &[Instruction],
    values: &BTreeMap<&str, &str>,
    rules: &plural::Rules,
    output: &mut String,
    pound: Option<&str>,
) -> Result<(), Error> {
    for instruction in program {
        match instruction {
            Instruction::Text { value } => output.push_str(value),
            Instruction::Argument { name } => output.push_str(values[name.as_str()]),
            Instruction::Select { name, options } => {
                let branch = options
                    .get(values[name.as_str()])
                    .unwrap_or(&options["other"]);
                execute(branch, values, rules, output, pound)?;
            }
            Instruction::Plural {
                name,
                kind,
                offset,
                options,
            } => {
                let value = values[name.as_str()];
                let invalid = || Error::PluralArgument {
                    name: name.clone(),
                    value: value.into(),
                };
                let number = plural::Number::parse(value).ok_or_else(invalid)?;
                let adjusted = number.subtract(*offset).ok_or_else(invalid)?;
                let exact = options.iter().find_map(|(selector, branch)| {
                    let selector = selector.strip_prefix('=')?;
                    (plural::Number::parse(selector)?.identity() == number.identity())
                        .then_some(branch)
                });
                let branch = exact.unwrap_or_else(|| {
                    options
                        .get(rules.category(*kind, adjusted))
                        .unwrap_or(&options["other"])
                });
                let adjusted = adjusted.decimal().to_string();
                execute(branch, values, rules, output, Some(&adjusted))?;
            }
            Instruction::Pound => {
                output.push_str(pound.expect("plural context validated before rendering"))
            }
        }
    }
    Ok(())
}
