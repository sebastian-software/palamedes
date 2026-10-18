//! Private CLI code generation; this is not a general Rust application adapter.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fs;
use std::path::Path;

use palamedes::{
    CatalogArtifactConfig, CatalogArtifactRequest, CatalogConfig, PalamedesCatalogFormat,
    RuntimeCompiledMessage, RuntimeMessageNode, compile_catalog_artifact,
    compile_runtime_catalog_messages, parse_po,
};

pub fn generate() -> Result<(), Box<dyn Error>> {
    let directory = Path::new("locales");
    println!("cargo:rerun-if-changed=locales");
    let generated = render_catalogs(directory)?;
    fs::write(
        Path::new(&std::env::var("OUT_DIR")?).join("cli_messages.rs"),
        generated,
    )?;
    Ok(())
}

pub fn render_catalogs(directory: &Path) -> Result<String, Box<dyn Error>> {
    let mut catalogs = Vec::new();
    for locale in ["en", "de", "es"] {
        let source = fs::read_to_string(directory.join(format!("{locale}.po")))?;
        let parsed = parse_po(&source)?;
        let mut catalog = BTreeMap::new();
        for item in parsed.items.into_iter().filter(|item| !item.obsolete) {
            if item.msgid.is_empty() {
                continue;
            }
            if item.msgctxt.is_some()
                || item.msgid_plural.is_some()
                || item.flags.contains_key("fuzzy")
            {
                return Err(format!(
                    "{locale}: CLI messages must be reviewed, context-free ICU messages"
                )
                .into());
            }
            let translation = item
                .msgstr
                .first()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("{locale}: missing translation for {:?}", item.msgid))?;
            if catalog
                .insert(item.msgid.clone(), translation.clone())
                .is_some()
            {
                return Err(
                    format!("{locale}: duplicate CLI source message {:?}", item.msgid).into(),
                );
            }
        }
        catalogs.push(catalog);
    }
    if catalogs
        .iter()
        .any(|catalog| catalog.keys().ne(catalogs[0].keys()))
    {
        return Err("CLI locales must contain the same source messages".into());
    }
    let root = fs::canonicalize(directory)?;
    let compiled = ["en", "de", "es"]
        .map(|locale| {
            compile_catalog_artifact(&CatalogArtifactRequest {
                config: CatalogArtifactConfig {
                    root_dir: root.to_string_lossy().into_owned(),
                    locales: vec!["en".to_owned(), "de".to_owned(), "es".to_owned()],
                    source_locale: "en".to_owned(),
                    fallback_locales: None,
                    pseudo_locale: None,
                    catalogs: vec![CatalogConfig {
                        path: "{locale}".to_owned(),
                        format: PalamedesCatalogFormat::Po,
                    }],
                },
                resource_path: root
                    .join(format!("{locale}.po"))
                    .to_string_lossy()
                    .into_owned(),
            })
        })
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let mut generated = String::from("macro_rules! tr {\n");
    for source in catalogs[0].keys() {
        let id = ferrocat::compiled_key_with_policy(
            source,
            None,
            ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
        );
        let (_, arguments) = template(&compiled[0].messages[&id])?;
        let patterns = compiled
            .iter()
            .map(|catalog| {
                let (pattern, translated_arguments) = template(&catalog.messages[&id])?;
                if arguments != translated_arguments {
                    return Err(format!("CLI placeholder mismatch for {source:?}").into());
                }
                Ok(pattern)
            })
            .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
        generated.push_str(&format!("({source:?}"));
        for name in &arguments {
            generated.push_str(&format!(", {name} = ${name}:expr"));
        }
        generated.push_str(") => {{");
        if arguments.is_empty() {
            generated.push_str(&format!(
                "crate::i18n::choose({:?}, {:?}, {:?})",
                patterns[0], patterns[1], patterns[2]
            ));
        } else {
            generated.push_str("match crate::i18n::language() {");
            for (index, language) in ["English", "German", "Spanish"].iter().enumerate() {
                generated.push_str(&format!(
                    "crate::i18n::Language::{language} => format!({:?}",
                    patterns[index]
                ));
                for name in &arguments {
                    generated.push_str(&format!(", {name} = ${name}"));
                }
                generated.push_str("),");
            }
            generated.push('}');
        }
        generated.push_str("}};\n");
    }
    generated.push_str("}\n");
    Ok(generated)
}

fn template(pattern: &str) -> Result<(String, BTreeSet<String>), Box<dyn Error>> {
    let messages = BTreeMap::from([("message".to_owned(), pattern.to_owned())]);
    let compiled = compile_runtime_catalog_messages(&messages);
    let nodes = match compiled.get("message") {
        None => return Ok((pattern.to_owned(), BTreeSet::new())),
        Some(RuntimeCompiledMessage::Nodes(nodes)) => nodes,
        Some(RuntimeCompiledMessage::Lazy) => {
            return Err(format!("invalid CLI ICU: {pattern:?}").into());
        }
    };
    let mut result = String::new();
    let mut arguments = BTreeSet::new();
    for node in nodes {
        match node {
            RuntimeMessageNode::Text { value } | RuntimeMessageNode::Literal { value } => {
                result.push_str(&value.replace('{', "{{").replace('}', "}}"));
            }
            RuntimeMessageNode::Variable { name } => {
                if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                    || name.starts_with(|c: char| c.is_ascii_digit())
                {
                    return Err(format!("invalid CLI placeholder: {name}").into());
                }
                result.push_str(&format!("{{{name}}}"));
                arguments.insert(name.clone());
            }
            _ => {
                return Err(format!(
                    "CLI Rust generation only supports literals and arguments: {pattern:?}"
                )
                .into());
            }
        }
    }
    // Constant messages are returned directly, rather than through format!.
    if arguments.is_empty() {
        result = result.replace("{{", "{").replace("}}", "}");
    }
    Ok((result, arguments))
}
