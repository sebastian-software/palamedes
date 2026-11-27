//! Cargo integration and standalone compilation for external Rust catalogs.
//!
//! Generated macros resolve source literals during Rust constant evaluation.
//! Application builds export a contract for later data-only translation updates.
//!
//! # Compatibility
//!
//! The public API follows SemVer. Every fallible function returns [`Error`],
//! which is `#[non_exhaustive]`, so new failure kinds can arrive in minor
//! releases. It is `Send + Sync + 'static` and chains I/O and compiler causes
//! through [`std::error::Error::source`].

mod catalogs;
mod error;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use palamedes::sdk::{RuntimeMessageChoiceKind, RuntimeMessageNode};
use palamedes_i18n::{Instruction, PluralKind};
use proc_macro2::{TokenStream, TokenTree};

pub use catalogs::{CatalogContract, CatalogUpdate, MissingTranslation};
use catalogs::{PreparedCatalogs, Signature};
pub use error::Error;

type BuildResult<T> = Result<T, Error>;

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

const MAX_TOKEN_NESTING_DEPTH: usize = 128;
const MAX_MESSAGE_NESTING_DEPTH: usize = 64;

/// Extract literal messages from Rust token trees, including attribute tokens.
///
/// Comments and ordinary strings are not scanned as source. This supports
/// `tr!("message", ...)` and `translate!(catalog, "message", ...)`. A dynamic
/// source message fails extraction rather than silently disappearing.
pub fn extract_messages(source: &str, macro_name: &str) -> BuildResult<Vec<SourceMessage>> {
    fn walk(
        stream: TokenStream,
        name: &str,
        depth: usize,
        output: &mut Vec<SourceMessage>,
    ) -> BuildResult<()> {
        if depth > MAX_TOKEN_NESTING_DEPTH {
            return Err(Error::NestingTooDeep {
                max_depth: MAX_TOKEN_NESTING_DEPTH,
            });
        }
        let tokens: Vec<_> = stream.into_iter().collect();
        for (index, token) in tokens.iter().enumerate() {
            if let TokenTree::Ident(ident) = token
                && ident == name
                && matches!(tokens.get(index + 1), Some(TokenTree::Punct(p)) if p.as_char() == '!')
                && let Some(TokenTree::Group(group)) = tokens.get(index + 2)
            {
                let invocation: Invocation =
                    syn::parse2(group.stream()).map_err(|_| Error::DynamicMessage {
                        macro_name: name.to_owned(),
                        line: ident.span().start().line,
                    })?;
                output.push(SourceMessage {
                    message: invocation.message.value(),
                    line: ident.span().start().line,
                });
            }
            if let TokenTree::Group(group) = token {
                walk(group.stream(), name, depth + 1, output)?;
            }
        }
        Ok(())
    }
    let tokens = syn::parse_str::<TokenStream>(source).map_err(|source| Error::RustSource {
        source: Box::new(source),
    })?;
    let mut messages = Vec::new();
    walk(tokens, macro_name, 0, &mut messages)?;
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
        validate_directory(&self.directory)?;
        println!("cargo:rerun-if-changed={}", self.directory.display());
        let output = std::env::var("OUT_DIR").map_err(|source| Error::OutDir { source })?;
        let compiled = self.compile_to(Path::new(&output))?;
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
        let macro_name = validate_macro_name(&self.macro_name)?;
        let module_path = normalize_module_path(&self.module_path)?;
        let prepared = catalogs::prepare(&self)?;
        let generated = generate_module(&macro_name, &module_path, &prepared);
        fs::create_dir_all(output).map_err(Error::io(output))?;
        let catalog_directory = output.join("catalogs");
        prepared.write_catalogs(&catalog_directory)?;
        prepared.remove_stale_catalogs(&catalog_directory)?;
        let rust_module = output.join("messages.rs");
        catalogs::atomic_write_file(&rust_module, generated.as_bytes())?;
        let schema_file = output.join("schema.pmd.json");
        let schema = serde_json::to_vec(&prepared.contract).map_err(Error::serialize)?;
        catalogs::atomic_write_file(&schema_file, &schema)?;
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
            return Err(Error::ContractMismatch);
        }
        let files = prepared.write_catalogs(output)?;
        Ok(CatalogUpdate {
            catalogs: files,
            missing: prepared.missing,
        })
    }
}

fn validate_directory(directory: &Path) -> BuildResult<()> {
    if directory
        .as_os_str()
        .as_encoded_bytes()
        .iter()
        .any(|&byte| matches!(byte, b'\r' | b'\n'))
    {
        return Err(Error::InvalidDirectoryPath {
            path: directory.to_path_buf(),
        });
    }
    Ok(())
}

fn validate_macro_name(name: &str) -> BuildResult<String> {
    let ident = syn::parse_str::<syn::Ident>(name).map_err(|_| Error::InvalidMacroName {
        name: name.to_owned(),
    })?;
    let normalized = ident.to_string();
    if normalized.starts_with("r#") || normalized != name {
        return Err(Error::InvalidMacroName {
            name: name.to_owned(),
        });
    }
    Ok(normalized)
}

fn normalize_module_path(path: &str) -> BuildResult<String> {
    let parsed = syn::parse_str::<syn::Path>(path).map_err(|_| Error::InvalidModulePath {
        path: path.to_owned(),
    })?;
    if parsed.leading_colon.is_some() {
        return Err(Error::InvalidModulePath {
            path: path.to_owned(),
        });
    }
    let mut segments = parsed.segments.iter();
    let Some(first) = segments.next() else {
        return Err(Error::InvalidModulePath {
            path: path.to_owned(),
        });
    };
    if first.ident != "crate" || !first.arguments.is_empty() {
        return Err(Error::InvalidModulePath {
            path: path.to_owned(),
        });
    }
    let mut normalized = String::from("crate");
    for segment in segments {
        if !segment.arguments.is_empty() {
            return Err(Error::InvalidModulePath {
                path: path.to_owned(),
            });
        }
        let ident = segment.ident.to_string();
        if syn::parse_str::<syn::Ident>(&ident).is_err() {
            return Err(Error::InvalidModulePath {
                path: path.to_owned(),
            });
        }
        normalized.push_str("::");
        normalized.push_str(&ident);
    }
    Ok(normalized)
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

/// Lower runtime nodes to Rust instructions. Errors are reasons; the caller
/// adds the locale and source message.
fn lower(
    nodes: &[RuntimeMessageNode],
    arguments: &mut BTreeSet<String>,
) -> Result<Vec<Instruction>, String> {
    lower_with_depth(nodes, arguments, 0)
}

fn lower_with_depth(
    nodes: &[RuntimeMessageNode],
    arguments: &mut BTreeSet<String>,
    depth: usize,
) -> Result<Vec<Instruction>, String> {
    if depth > MAX_MESSAGE_NESTING_DEPTH {
        return Err(format!(
            "message nesting exceeds the maximum depth of {MAX_MESSAGE_NESTING_DEPTH}"
        ));
    }
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
                    .map(|(selector, branch)| {
                        Ok((
                            selector.clone(),
                            lower_with_depth(branch, arguments, depth + 1)?,
                        ))
                    })
                    .collect::<Result<_, String>>()?;
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

fn check_argument(name: &str) -> Result<(), String> {
    syn::parse_str::<syn::Ident>(name).map_err(|_| format!("invalid Rust placeholder: {name}"))?;
    if name == "__palamedes_catalog" {
        return Err("placeholder name __palamedes_catalog is reserved by the Rust macro".into());
    }
    Ok(())
}

impl CompiledCatalogs {
    /// Copy only this build's artifacts into a caller-selected installation directory.
    pub fn install_to(&self, directory: &Path) -> BuildResult<()> {
        fs::create_dir_all(directory).map_err(Error::io(directory))?;
        let source = &self.catalog_directory;
        for entry in fs::read_dir(source).map_err(Error::io(source))? {
            let entry = entry.map_err(Error::io(source))?;
            let path = entry.path();
            if entry.file_type().map_err(Error::io(&path))?.is_file() {
                let target = directory.join(entry.file_name());
                let source_mode = {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        Some(
                            fs::metadata(&path)
                                .map_err(Error::io(&path))?
                                .permissions()
                                .mode()
                                & 0o777,
                        )
                    }
                    #[cfg(not(unix))]
                    {
                        None
                    }
                };
                let bytes = fs::read(&path).map_err(Error::io(&path))?;
                catalogs::atomic_write_file_with_new_mode(&target, &bytes, source_mode)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use palamedes::sdk::{RuntimeMessageChoiceKind, RuntimeMessageNode};

    use super::{
        CatalogBuilder, Error, MAX_MESSAGE_NESTING_DEPTH, MAX_TOKEN_NESTING_DEPTH,
        extract_messages, lower,
    };

    #[test]
    fn extract_messages_rejects_excessively_nested_tokens() {
        let depth = MAX_TOKEN_NESTING_DEPTH + 2;
        let source = format!("{}tr!(\"Hello\"){}", "{".repeat(depth), "}".repeat(depth));
        let error = extract_messages(&source, "tr").expect_err("deep token nesting must error");
        assert!(
            matches!(error, Error::NestingTooDeep { max_depth } if max_depth == MAX_TOKEN_NESTING_DEPTH),
            "expected NestingTooDeep, got: {error}"
        );
    }

    #[test]
    fn lower_rejects_excessively_nested_choices() {
        let mut nodes = vec![RuntimeMessageNode::Text {
            value: "leaf".to_owned(),
        }];
        for _ in 0..=MAX_MESSAGE_NESTING_DEPTH {
            nodes = vec![RuntimeMessageNode::Choice {
                variable: "kind".to_owned(),
                kind: RuntimeMessageChoiceKind::Select,
                offset: None,
                options: BTreeMap::from([("other".to_owned(), nodes)]),
            }];
        }
        let mut arguments = BTreeSet::new();
        let error = lower(&nodes, &mut arguments).expect_err("deep message nesting must error");
        assert!(error.contains("maximum depth"), "unexpected error: {error}");
    }

    #[cfg(unix)]
    #[test]
    fn compile_to_and_install_to_preserve_existing_permissions_and_umask() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let po_dir = dir.path().join("locales");
        let out_dir = dir.path().join("out");
        let install_dir = dir.path().join("installed");
        std::fs::create_dir_all(&po_dir).expect("create po dir");
        std::fs::create_dir_all(&out_dir).expect("create out dir");
        std::fs::write(
            po_dir.join("en.po"),
            "msgid \"\"\nmsgstr \"\"\n\"Language: en\\n\"\n\nmsgid \"Hello\"\nmsgstr \"Hello\"\n",
        )
        .expect("write en.po");

        let baseline = out_dir.join("baseline.txt");
        std::fs::write(&baseline, "x").expect("write baseline");
        let expected_umask_mode = std::fs::metadata(&baseline)
            .expect("baseline meta")
            .permissions()
            .mode()
            & 0o777;

        let compiled = CatalogBuilder::new(&po_dir, "en")
            .locales(&["en"])
            .compile_to(&out_dir)
            .expect("compile_to succeeds");
        for path in [&compiled.rust_module, &compiled.schema_file] {
            let mode = std::fs::metadata(path).expect("meta").permissions().mode() & 0o777;
            assert_eq!(mode, expected_umask_mode, "{}", path.display());
        }

        // Preserve custom existing permissions on recompile.
        std::fs::set_permissions(
            &compiled.rust_module,
            std::fs::Permissions::from_mode(0o640),
        )
        .expect("chmod messages.rs");
        std::fs::set_permissions(
            &compiled.schema_file,
            std::fs::Permissions::from_mode(0o600),
        )
        .expect("chmod schema.pmd.json");
        let recompiled = CatalogBuilder::new(&po_dir, "en")
            .locales(&["en"])
            .compile_to(&out_dir)
            .expect("recompile succeeds");
        assert_eq!(
            std::fs::metadata(&recompiled.rust_module)
                .expect("meta")
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        assert_eq!(
            std::fs::metadata(&recompiled.schema_file)
                .expect("meta")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        // install_to respects umask on new files and preserves existing target permissions.
        recompiled.install_to(&install_dir).expect("install_to");
        let installed = install_dir.join("en.pmd.json");
        assert_eq!(
            std::fs::metadata(&installed)
                .expect("meta")
                .permissions()
                .mode()
                & 0o777,
            expected_umask_mode
        );
        std::fs::set_permissions(&installed, std::fs::Permissions::from_mode(0o640))
            .expect("chmod installed");
        recompiled.install_to(&install_dir).expect("reinstall_to");
        assert_eq!(
            std::fs::metadata(&installed)
                .expect("meta")
                .permissions()
                .mode()
                & 0o777,
            0o640
        );

        // Private source catalogs must not be widened when installed to a fresh target.
        let private_source = recompiled.catalog_directory.join("en.pmd.json");
        std::fs::set_permissions(&private_source, std::fs::Permissions::from_mode(0o600))
            .expect("chmod private source");
        let fresh_install_dir = dir.path().join("private-installed");
        recompiled
            .install_to(&fresh_install_dir)
            .expect("install private catalog");
        assert_eq!(
            std::fs::metadata(fresh_install_dir.join("en.pmd.json"))
                .expect("private installed meta")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
