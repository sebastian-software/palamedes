//! Cargo integration for external, parser-free Rust catalogs.
//!
//! The build emits macro definitions and a schema into `OUT_DIR`. Rust itself
//! expands calls to those macros. No translation text is emitted as Rust code.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use palamedes::{
    CatalogArtifactConfig, CatalogArtifactRequest, CatalogConfig, PalamedesCatalogFormat,
    RuntimeCompiledMessage, RuntimeMessageChoiceKind, RuntimeMessageNode, compile_catalog_artifact,
    compile_runtime_catalog_messages, parse_po,
};
use palamedes_i18n::{CatalogArtifact, FORMAT_VERSION, Instruction, Message};
use proc_macro2::{TokenStream, TokenTree};
use sha2::{Digest, Sha256};

type BuildResult<T> = Result<T, Box<dyn Error>>;

struct Invocation {
    message: syn::LitStr,
}

impl syn::parse::Parse for Invocation {
    fn parse(input: syn::parse::ParseStream<'_>) -> syn::Result<Self> {
        if !input.peek(syn::LitStr) {
            let _: syn::Expr = input.parse()?;
            let _: syn::Token![,] = input.parse()?;
        }
        let message = input.parse()?;
        while !input.is_empty() {
            let _: syn::Token![,] = input.parse()?;
            if input.is_empty() {
                break;
            }
            let _: syn::Ident = input.parse()?;
            let _: syn::Token![=] = input.parse()?;
            let _: syn::Expr = input.parse()?;
        }
        Ok(Self { message })
    }
}

/// A source-first message discovered in an explicitly named translation macro.
#[derive(Debug, PartialEq, Eq)]
pub struct SourceMessage {
    /// The literal source message, not a compiled key.
    pub message: String,
    /// One-based line in the input Rust file.
    pub line: usize,
}

/// Extract literal messages from Rust token trees, including attribute tokens.
///
/// Comments and ordinary strings are not scanned as source. This supports
/// `tr!("message", ...)` and `translate!(catalog, "message", ...)`. A dynamic
/// source message fails extraction rather than silently disappearing.
pub fn extract_messages(source: &str, macro_name: &str) -> BuildResult<Vec<SourceMessage>> {
    fn walk(stream: TokenStream, name: &str, output: &mut Vec<SourceMessage>) -> BuildResult<()> {
        let tokens: Vec<_> = stream.into_iter().collect();
        for (index, token) in tokens.iter().enumerate() {
            if let TokenTree::Ident(ident) = token
                && ident == name
                && matches!(tokens.get(index + 1), Some(TokenTree::Punct(p)) if p.as_char() == '!')
                && let Some(TokenTree::Group(group)) = tokens.get(index + 2)
            {
                let invocation: Invocation = syn::parse2(group.stream()).map_err(|_| {
                    format!(
                        "{name}! requires a literal source message at line {}",
                        ident.span().start().line
                    )
                })?;
                output.push(SourceMessage {
                    message: invocation.message.value(),
                    line: ident.span().start().line,
                });
            }
            if let TokenTree::Group(group) = token {
                walk(group.stream(), name, output)?;
            }
        }
        Ok(())
    }
    let mut messages = Vec::new();
    walk(source.parse()?, macro_name, &mut messages)?;
    Ok(messages)
}

/// Compile a family of PO catalogs into external Rust artifacts.
pub struct CatalogBuilder {
    directory: PathBuf,
    source_locale: String,
    locales: Vec<String>,
    macro_name: String,
}

/// Generated files. Install `catalog_directory` alongside the application.
pub struct CompiledCatalogs {
    /// Rust schema and macro definitions; include this at module scope.
    pub rust_module: PathBuf,
    /// One `<locale>.pmd.json` file for every requested locale.
    pub catalog_directory: PathBuf,
}

impl CatalogBuilder {
    /// Read `<locale>.po` files from a caller-owned directory.
    pub fn new(directory: impl Into<PathBuf>, source_locale: impl Into<String>) -> Self {
        Self {
            directory: directory.into(),
            source_locale: source_locale.into(),
            locales: Vec::new(),
            macro_name: "translate".into(),
        }
    }

    /// Select the locales to compile. The source locale must be included.
    pub fn locales(mut self, locales: &[&str]) -> Self {
        self.locales = locales.iter().map(|locale| (*locale).to_owned()).collect();
        self
    }

    /// Name of the generated macro (a Rust identifier).
    pub fn macro_name(mut self, name: &str) -> Self {
        self.macro_name = name.into();
        self
    }

    /// Compile into Cargo's `OUT_DIR` and register catalog change tracking.
    pub fn build(self) -> BuildResult<CompiledCatalogs> {
        println!("cargo:rerun-if-changed={}", self.directory.display());
        self.compile_to(Path::new(&std::env::var("OUT_DIR")?))
    }

    /// Compile into an explicit output directory, useful for other build hosts.
    pub fn compile_to(self, output: &Path) -> BuildResult<CompiledCatalogs> {
        syn::parse_str::<syn::Ident>(&self.macro_name)?;
        if self.locales.is_empty()
            || !self.locales.contains(&self.source_locale)
            || self.locales.iter().collect::<BTreeSet<_>>().len() != self.locales.len()
        {
            return Err("locales must be unique and include the source locale".into());
        }
        for locale in &self.locales {
            if locale.is_empty()
                || !locale
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            {
                return Err(format!("invalid catalog locale: {locale}").into());
            }
        }
        let root = fs::canonicalize(&self.directory)?;
        let mut catalogs = BTreeMap::new();
        for locale in &self.locales {
            let parsed = parse_po(&fs::read_to_string(root.join(format!("{locale}.po")))?)?;
            let mut messages = BTreeMap::new();
            for item in parsed
                .items
                .into_iter()
                .filter(|item| !item.obsolete && !item.msgid.is_empty())
            {
                if item.msgctxt.is_some()
                    || item.msgid_plural.is_some()
                    || item.flags.contains_key("fuzzy")
                {
                    return Err(format!(
                        "{locale}: Rust catalogs require reviewed, context-free ICU messages"
                    )
                    .into());
                }
                if item.msgstr.first().is_none_or(String::is_empty) {
                    return Err(
                        format!("{locale}: missing translation for {:?}", item.msgid).into(),
                    );
                }
                if messages.insert(item.msgid.clone(), ()).is_some() {
                    return Err(format!("{locale}: duplicate source {:?}", item.msgid).into());
                }
            }
            catalogs.insert(locale.clone(), messages);
        }
        let sources = &catalogs[&self.source_locale];
        if sources.is_empty()
            || catalogs
                .values()
                .any(|catalog| catalog.keys().ne(sources.keys()))
        {
            return Err("Rust catalogs must have the same nonempty message inventory".into());
        }
        let mut artifacts = BTreeMap::new();
        let mut signature: BTreeMap<String, (String, BTreeSet<String>, bool)> = BTreeMap::new();
        for locale in &self.locales {
            let artifact = compile_catalog_artifact(&CatalogArtifactRequest {
                config: CatalogArtifactConfig {
                    root_dir: root.to_string_lossy().into_owned(),
                    locales: self.locales.clone(),
                    source_locale: self.source_locale.clone(),
                    fallback_locales: None,
                    pseudo_locale: None,
                    catalogs: vec![CatalogConfig {
                        path: "{locale}".into(),
                        format: PalamedesCatalogFormat::Po,
                    }],
                },
                resource_path: root
                    .join(format!("{locale}.po"))
                    .to_string_lossy()
                    .into_owned(),
            })?;
            let lowered = compile_runtime_catalog_messages(&artifact.messages);
            let mut messages = BTreeMap::new();
            for source in sources.keys() {
                let id = ferrocat::compiled_key_with_policy(
                    source,
                    None,
                    ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
                );
                let mut arguments = BTreeSet::new();
                let message = match lowered.get(&id) {
                    None => Message::Literal(artifact.messages[&id].clone()),
                    Some(RuntimeCompiledMessage::Nodes(nodes)) => {
                        let program = lower(nodes, &mut arguments)
                            .map_err(|error| format!("{locale}, {source:?}: {error}"))?;
                        if arguments.is_empty() {
                            Message::Literal(
                                program
                                    .into_iter()
                                    .map(|instruction| match instruction {
                                        Instruction::Text { value } => value,
                                        _ => unreachable!("no arguments means only text"),
                                    })
                                    .collect(),
                            )
                        } else {
                            Message::Program(program)
                        }
                    }
                    Some(RuntimeCompiledMessage::Lazy) => {
                        return Err(format!("{locale}: invalid ICU for {source:?}").into());
                    }
                };
                let literal = matches!(message, Message::Literal(_));
                if let Some((_, expected, expected_literal)) = signature.get(source) {
                    if expected != &arguments || *expected_literal != literal {
                        return Err(format!("{locale}: placeholder mismatch for {source:?}").into());
                    }
                } else {
                    signature.insert(source.clone(), (id.clone(), arguments, literal));
                }
                messages.insert(id, message);
            }
            artifacts.insert(locale, messages);
        }
        let contract: BTreeMap<_, _> = signature
            .values()
            .map(|(id, arguments, literal)| (id, (arguments, literal)))
            .collect();
        let fingerprint: String = Sha256::digest(serde_json::to_vec(&contract)?)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let mut generated = format!(
            "pub const CATALOG_SCHEMA: ::palamedes_i18n::Schema = ::palamedes_i18n::Schema {{ fingerprint: {fingerprint:?}, messages: &[\n"
        );
        for (id, arguments, literal) in signature.values() {
            generated.push_str(&format!("::palamedes_i18n::MessageSpec {{ id: {id:?}, arguments: &{:?}, literal: {literal} }},\n", arguments.iter().collect::<Vec<_>>()));
        }
        generated.push_str("] };\n");
        generated.push_str(&format!(
            "macro_rules! {} {{\n(@signature $source:literal) => {{ const {{\n",
            self.macro_name
        ));
        for (index, (source, (id, arguments, literal))) in signature.iter().enumerate() {
            if index > 0 {
                generated.push_str("else ");
            }
            generated.push_str(&format!("if ::palamedes_i18n::source_eq($source, {source:?}) {{ ({id:?}, &{:?} as &[&str], {literal}) }}\n", arguments.iter().collect::<Vec<_>>()));
        }
        generated.push_str(
            "else { panic!(\"source message is absent from compiled catalogs\") }\n} };\n",
        );
        generated.push_str(&format!(
            "($catalog:expr, $source:literal $(,)?) => {{{{\nconst SIGNATURE: (&str, &[&str], bool) = {}!(@signature $source);\nconst _: () = {{ ::palamedes_i18n::assert_arguments(SIGNATURE.1, &[]); assert!(SIGNATURE.2); }};\n($catalog).literal(SIGNATURE.0)\n}}}};\n", self.macro_name
        ));
        generated.push_str(&format!(
            "($catalog:expr, $source:literal, $($argument:ident = $value:expr),+ $(,)?) => {{{{\nconst SIGNATURE: (&str, &[&str], bool) = {}!(@signature $source);\nconst _: () = {{ ::palamedes_i18n::assert_arguments(SIGNATURE.1, &[$(::std::stringify!($argument)),+]); assert!(!SIGNATURE.2); }};\n($catalog).render(SIGNATURE.0, &[$((::std::stringify!($argument), ::std::format!(\"{{}}\", $value)),)+])\n}}}};\n}}\n", self.macro_name
        ));
        let catalog_directory = output.join("catalogs");
        fs::create_dir_all(&catalog_directory)?;
        for entry in fs::read_dir(&catalog_directory)? {
            let entry = entry?;
            if entry.file_type()?.is_file()
                && entry.file_name().to_string_lossy().ends_with(".pmd.json")
            {
                fs::remove_file(entry.path())?;
            }
        }
        for (locale, messages) in artifacts {
            let artifact = CatalogArtifact {
                version: FORMAT_VERSION,
                fingerprint: fingerprint.clone(),
                locale: locale.clone(),
                messages,
            };
            fs::write(
                catalog_directory.join(format!("{locale}.pmd.json")),
                serde_json::to_vec(&artifact)?,
            )?;
        }
        let rust_module = output.join("messages.rs");
        fs::write(&rust_module, generated)?;
        Ok(CompiledCatalogs {
            rust_module,
            catalog_directory,
        })
    }
}

fn lower(
    nodes: &[RuntimeMessageNode],
    arguments: &mut BTreeSet<String>,
) -> BuildResult<Vec<Instruction>> {
    nodes.iter().map(|node| Ok(match node {
        RuntimeMessageNode::Text { value } | RuntimeMessageNode::Literal { value } => Instruction::Text { value: value.clone() },
        RuntimeMessageNode::Variable { name } => { check_argument(name)?; arguments.insert(name.clone()); Instruction::Argument { name: name.clone() } }
        RuntimeMessageNode::Choice { variable, kind: RuntimeMessageChoiceKind::Select, options, .. } => {
            check_argument(variable)?;
            arguments.insert(variable.clone());
            Instruction::Select { name: variable.clone(), options: options.iter().map(|(selector, branch)| Ok((selector.clone(), lower(branch, arguments)?))).collect::<BuildResult<_>>()? }
        }
        _ => return Err("Rust catalogs currently support text, arguments, and string selects; plural, number/date/time formatting, and rich text are unsupported".into()),
    })).collect()
}

fn check_argument(name: &str) -> BuildResult<()> {
    syn::parse_str::<syn::Ident>(name).map_err(|_| format!("invalid Rust placeholder: {name}"))?;
    if name == "__palamedes_catalog" {
        return Err("placeholder name __palamedes_catalog is reserved by the Rust macro".into());
    }
    Ok(())
}

impl CompiledCatalogs {
    /// Copy only this build's artifacts into a caller-selected installation directory.
    pub fn install_to(&self, directory: &Path) -> BuildResult<()> {
        fs::create_dir_all(directory)?;
        for entry in fs::read_dir(&self.catalog_directory)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                fs::copy(entry.path(), directory.join(entry.file_name()))?;
            }
        }
        Ok(())
    }
}
