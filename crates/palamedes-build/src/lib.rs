//! Cargo integration and standalone compilation for external Rust catalogs.
//!
//! Generated macros resolve source literals during Rust constant evaluation.
//! Application builds export a contract for later data-only translation updates.

mod catalogs;

use std::collections::BTreeSet;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use palamedes::{RuntimeMessageChoiceKind, RuntimeMessageNode};
use palamedes_i18n::{Instruction, PluralKind};
use proc_macro2::{TokenStream, TokenTree};

pub use catalogs::{CatalogContract, CatalogUpdate, MissingTranslation};
use catalogs::{PreparedCatalogs, Signature};

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
    fallback_locales: Vec<String>,
    fail_on_missing: bool,
    macro_name: String,
    module_path: String,
}

/// Generated application-build files and translation completeness diagnostics.
pub struct CompiledCatalogs {
    /// Rust schema and macro definitions; include this at module scope.
    pub rust_module: PathBuf,
    /// Source-free contract used to compile compatible updates independently.
    pub schema_file: PathBuf,
    /// One `<locale>.pmd.json` file for every requested output locale.
    pub catalog_directory: PathBuf,
    /// Missing or fuzzy translations resolved at build time.
    pub missing: Vec<MissingTranslation>,
}

impl CatalogBuilder {
    /// Read `<locale>.po` files from a caller-owned directory.
    pub fn new(directory: impl Into<PathBuf>, source_locale: impl Into<String>) -> Self {
        Self {
            directory: directory.into(),
            source_locale: source_locale.into(),
            locales: Vec::new(),
            fallback_locales: Vec::new(),
            fail_on_missing: false,
            macro_name: "translate".into(),
            module_path: "crate".into(),
        }
    }

    /// Select output locales. The source PO is always an input, even when not emitted.
    pub fn locales(mut self, locales: &[&str]) -> Self {
        self.locales = locales.iter().map(|locale| (*locale).to_owned()).collect();
        self
    }

    /// Resolve missing translations through this shared chain, then the source locale/message.
    pub fn fallback_locales(mut self, locales: &[&str]) -> Self {
        self.fallback_locales = locales.iter().map(|locale| (*locale).to_owned()).collect();
        self
    }

    /// Reject missing or fuzzy target translations even when a valid fallback exists.
    pub fn fail_on_missing(mut self, strict: bool) -> Self {
        self.fail_on_missing = strict;
        self
    }

    /// Name of the generated macro (a Rust identifier).
    pub fn macro_name(mut self, name: &str) -> Self {
        self.macro_name = name.into();
        self
    }

    /// Crate-relative module containing the generated definitions (default: `crate`).
    /// Set this when including messages.rs inside a module rather than at crate root.
    pub fn module_path(mut self, path: &str) -> Self {
        self.module_path = path.into();
        self
    }

    /// Compile inside Cargo's `OUT_DIR`, tracking inputs and reporting fallback use.
    pub fn build(self) -> BuildResult<CompiledCatalogs> {
        println!("cargo:rerun-if-changed={}", self.directory.display());
        let compiled = self.compile_to(Path::new(&std::env::var("OUT_DIR")?))?;
        for missing in &compiled.missing {
            println!(
                "cargo:warning={}: missing translation for {:?}; compiled fallback from {}",
                missing.locale, missing.message, missing.resolved_locale
            );
        }
        Ok(compiled)
    }

    /// Generate application definitions, an update contract, and language data.
    pub fn compile_to(self, output: &Path) -> BuildResult<CompiledCatalogs> {
        syn::parse_str::<syn::Ident>(&self.macro_name)?;
        syn::parse_str::<syn::Path>(&self.module_path)?;
        if self.module_path != "crate" && !self.module_path.starts_with("crate::") {
            return Err("generated module path must start with crate".into());
        }
        let prepared = catalogs::prepare(&self)?;
        let generated = generate_module(&self.macro_name, &self.module_path, &prepared);
        fs::create_dir_all(output)?;
        let catalog_directory = output.join("catalogs");
        prepared.write_catalogs(&catalog_directory)?;
        prepared.remove_stale_catalogs(&catalog_directory)?;
        let rust_module = output.join("messages.rs");
        fs::write(&rust_module, generated)?;
        let schema_file = output.join("schema.pmd.json");
        fs::write(&schema_file, serde_json::to_vec(&prepared.contract)?)?;
        Ok(CompiledCatalogs {
            rust_module,
            schema_file,
            catalog_directory,
            missing: prepared.missing,
        })
    }

    /// Compile only language files against an existing application's exported contract.
    ///
    /// All inputs are validated before output files are touched. This does not
    /// generate Rust code or invoke Cargo/rustc for the application.
    pub fn compile_updates(
        self,
        contract: &CatalogContract,
        output: &Path,
    ) -> BuildResult<CatalogUpdate> {
        contract.validate()?;
        let prepared = catalogs::prepare(&self)?;
        if prepared.contract != *contract {
            return Err("catalog update changes the application message contract; rebuild the application and export a matching schema".into());
        }
        let files = prepared.write_catalogs(output)?;
        Ok(CatalogUpdate {
            catalogs: files,
            missing: prepared.missing,
        })
    }
}

fn generate_module(name: &str, module_path: &str, prepared: &PreparedCatalogs) -> String {
    let fingerprint = &prepared.contract.fingerprint;
    let mut generated = format!(
        "pub const CATALOG_SCHEMA: ::palamedes_i18n::Schema = ::palamedes_i18n::Schema {{ fingerprint: {fingerprint:?}, messages: &[\n"
    );
    for spec in prepared.signature.values() {
        let id = &spec.id;
        generated.push_str(&format!(
            "::palamedes_i18n::MessageSpec {{ id: {id:?}, arguments: &{:?}, plural_arguments: &{:?}, literal: {} }},\n",
            spec.arguments.iter().collect::<Vec<_>>(),
            spec.plural_arguments.iter().collect::<Vec<_>>(),
            spec.literal
        ));
    }
    generated.push_str("] };\n");
    // The source table is used only during const evaluation. Each call site
    // expands a small lookup, rather than another copy of the entire catalog.
    let lookup = format!("__palamedes_{name}_signature");
    generated.push_str(&format!("pub(crate) const fn {lookup}(source: &str) -> (&'static str, &'static [&'static str], bool, &'static [&'static str]) {{\ntype Signature = (&'static str, &'static [&'static str], bool, &'static [&'static str]);\nconst MESSAGES: &[(&str, Signature)] = &[\n"));
    for (
        source,
        Signature {
            id,
            arguments,
            literal,
            plural_arguments,
        },
    ) in &prepared.signature
    {
        generated.push_str(&format!(
            "({source:?}, ({id:?}, &{:?}, {literal}, &{:?})),\n",
            arguments.iter().collect::<Vec<_>>(),
            plural_arguments.iter().collect::<Vec<_>>()
        ));
    }
    generated.push_str("];\nlet mut low = 0; let mut high = MESSAGES.len();\nwhile low < high { let mid = low + (high - low) / 2; let comparison = ::palamedes_i18n::source_cmp(source, MESSAGES[mid].0);\nif comparison == 0 { return MESSAGES[mid].1; }\nif comparison < 0 { high = mid; } else { low = mid + 1; }\n}\npanic!(\"source message is absent from compiled catalogs\")\n}\n");
    let lookup_path = format!("$crate{}::{lookup}", &module_path["crate".len()..]);
    generated.push_str(&format!("macro_rules! {name} {{\n(@signature $source:literal) => {{ const {{ {lookup_path}($source) }} }};\n"));
    generated.push_str(&format!("($catalog:expr, $source:literal $(,)?) => {{{{\nconst SIGNATURE: (&str, &[&str], bool, &[&str]) = {name}!(@signature $source);\nconst _: () = {{ ::palamedes_i18n::assert_arguments(SIGNATURE.1, &[]); assert!(SIGNATURE.2); }};\n($catalog).literal(SIGNATURE.0)\n}}}};\n"));
    generated.push_str(&format!("($catalog:expr, $source:literal, $($argument:ident = $value:expr),+ $(,)?) => {{{{\nconst SIGNATURE: (&str, &[&str], bool, &[&str]) = {name}!(@signature $source);\nconst _: () = {{ ::palamedes_i18n::assert_arguments(SIGNATURE.1, &[$(::std::stringify!($argument)),+]); assert!(!SIGNATURE.2); }};\n($catalog).render(SIGNATURE.0, &[$((::std::stringify!($argument), ::palamedes_i18n::format_argument::<{{ ::palamedes_i18n::is_plural_argument(SIGNATURE.3, ::std::stringify!($argument)) }}, _>(&$value)),)+])\n}}}};\n}}\n"));
    generated
}

fn lower(
    nodes: &[RuntimeMessageNode],
    arguments: &mut BTreeSet<String>,
) -> BuildResult<Vec<Instruction>> {
    let mut program = Vec::with_capacity(nodes.len());
    for node in nodes {
        let instruction = match node {
            RuntimeMessageNode::Text { value } | RuntimeMessageNode::Literal { value } => {
                Instruction::Text {
                    value: value.clone(),
                }
            }
            RuntimeMessageNode::Variable { name } => {
                check_argument(name)?;
                arguments.insert(name.clone());
                Instruction::Argument { name: name.clone() }
            }
            RuntimeMessageNode::Choice {
                variable,
                kind,
                offset,
                options,
            } => {
                check_argument(variable)?;
                arguments.insert(variable.clone());
                let options = options
                    .iter()
                    .map(|(selector, branch)| Ok((selector.clone(), lower(branch, arguments)?)))
                    .collect::<BuildResult<_>>()?;
                match kind {
                    RuntimeMessageChoiceKind::Select => Instruction::Select {
                        name: variable.clone(),
                        options,
                    },
                    RuntimeMessageChoiceKind::Plural | RuntimeMessageChoiceKind::Selectordinal => {
                        Instruction::Plural {
                            name: variable.clone(),
                            kind: match kind {
                                RuntimeMessageChoiceKind::Plural => PluralKind::Cardinal,
                                _ => PluralKind::Ordinal,
                            },
                            offset: offset.unwrap_or(0),
                            options,
                        }
                    }
                }
            }
            RuntimeMessageNode::Pound => Instruction::Pound,
            _ => {
                return Err(concat!(
                    "Rust catalogs support text, arguments, selects, and plurals; ",
                    "number/date/time formatting and rich text are unsupported"
                )
                .into());
            }
        };
        program.push(instruction);
    }
    Ok(program)
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
