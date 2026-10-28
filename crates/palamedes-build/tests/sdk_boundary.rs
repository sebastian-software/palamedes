//! `palamedes-build` may use only the SemVer-covered `palamedes::sdk` module.
//!
//! Everything else in the `palamedes` crate is toolchain-internal and hidden
//! from its docs. A published builder that reached past `sdk` could break
//! when a compatible `palamedes` release changes those internals.

use std::fs;
use std::path::Path;

use proc_macro2::{TokenStream, TokenTree};

fn core_paths(stream: TokenStream, file: &str, violations: &mut Vec<String>) {
    let tokens: Vec<_> = stream.into_iter().collect();
    for (index, token) in tokens.iter().enumerate() {
        match token {
            TokenTree::Ident(ident) if ident == "palamedes" => {
                let separator = matches!(
                    (tokens.get(index + 1), tokens.get(index + 2)),
                    (Some(TokenTree::Punct(first)), Some(TokenTree::Punct(second)))
                        if first.as_char() == ':' && second.as_char() == ':'
                );
                let into_sdk =
                    matches!(tokens.get(index + 3), Some(TokenTree::Ident(next)) if next == "sdk");
                if separator && !into_sdk {
                    violations.push(format!("{file}:{}", ident.span().start().line));
                }
            }
            TokenTree::Group(group) => core_paths(group.stream(), file, violations),
            _ => {}
        }
    }
}

#[test]
fn builder_sources_import_the_core_only_through_its_sdk_module() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut violations = Vec::new();
    let mut scanned = 0;
    for entry in fs::read_dir(&source).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|extension| extension == "rs") {
            let text = fs::read_to_string(&path).unwrap();
            let tokens: TokenStream = text.parse().unwrap();
            core_paths(tokens, &path.display().to_string(), &mut violations);
            scanned += 1;
        }
    }
    assert!(
        scanned > 0,
        "no builder sources found in {}",
        source.display()
    );
    assert!(
        violations.is_empty(),
        "palamedes-build must import the core through palamedes::sdk only: {violations:?}"
    );
}

#[test]
fn the_sdk_module_exposes_the_items_the_builder_compiles_against() {
    use std::collections::BTreeMap;

    use palamedes::sdk::{
        RuntimeCompiledMessage, RuntimeCompiledMessages, RuntimeMessageChoiceKind,
        RuntimeMessageFormat, RuntimeMessageNode, compile_runtime_catalog_messages,
        parse_catalog_for_compile,
    };

    let messages = BTreeMap::from([
        (
            "choice".to_owned(),
            "{mode, select, a {A} other {B}}".to_owned(),
        ),
        ("date".to_owned(), "{when, date}".to_owned()),
    ]);
    let programs: RuntimeCompiledMessages = compile_runtime_catalog_messages(&messages);
    let Some(RuntimeCompiledMessage::Nodes(nodes)) = programs.get("choice") else {
        panic!("select lowers to runtime nodes");
    };
    assert!(matches!(
        &nodes[0],
        RuntimeMessageNode::Choice {
            kind: RuntimeMessageChoiceKind::Select,
            ..
        }
    ));
    let Some(RuntimeCompiledMessage::Nodes(nodes)) = programs.get("date") else {
        panic!("date formatting lowers to runtime nodes");
    };
    assert!(matches!(
        &nodes[0],
        RuntimeMessageNode::Formatted {
            format: RuntimeMessageFormat::Date,
            ..
        }
    ));

    let catalog = parse_catalog_for_compile(
        ferrocat::ParseCatalogOptions::new("msgid \"Hello\"\nmsgstr \"Hallo\"\n", "en")
            .with_locale("de"),
    )
    .unwrap();
    assert_eq!(catalog.message_count(), 1);
    assert!(catalog.contains_parts("Hello", None));
}
