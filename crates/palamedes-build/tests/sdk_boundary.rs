//! `palamedes-build` may use only the SemVer-covered `palamedes::sdk` module.
//!
//! Everything else in the `palamedes` crate is toolchain-internal and hidden
//! from its docs. A published builder that reached past `sdk` could break
//! when a compatible `palamedes` release changes those internals. The `sdk`
//! module in turn must not expose Ferrocat types, so a Ferrocat upgrade
//! cannot break its SemVer contract.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use proc_macro2::{TokenStream, TokenTree};
use quote::ToTokens;

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
    use palamedes::sdk::{
        CompiledCatalog, Error, MissingMessage, ParsedCatalog, RuntimeCompiledMessage,
        RuntimeCompiledMessages, RuntimeMessageChoiceKind, RuntimeMessageFormat,
        RuntimeMessageNode, compile_catalog, compile_runtime_catalog_messages, parse_catalog,
    };

    let english: ParsedCatalog = parse_catalog(
        "msgid \"{mode, select, a {A} other {B}}\"\nmsgstr \"{mode, select, a {A} other {B}}\"\n\
         msgid \"{when, date}\"\nmsgstr \"{when, date}\"\n",
        "en",
        "en",
    )
    .unwrap();
    let german = parse_catalog(
        "msgid \"{when, date}\"\nmsgstr \"{when, date}\"\n",
        "de",
        "en",
    )
    .unwrap();
    let compiled: CompiledCatalog = compile_catalog(&[&english, &german], "de", "en", &[]).unwrap();
    assert_eq!(compiled.messages.len(), 2);
    let [
        MissingMessage {
            resolved_locale, ..
        },
    ] = compiled.missing.as_slice()
    else {
        panic!("the untranslated select falls back: {:?}", compiled.missing);
    };
    assert_eq!(resolved_locale.as_deref(), Some("en"));

    let programs: RuntimeCompiledMessages = compile_runtime_catalog_messages(&compiled.messages);
    let kinds: Vec<_> = programs
        .values()
        .map(|program| match program {
            RuntimeCompiledMessage::Nodes(nodes) => match &nodes[0] {
                RuntimeMessageNode::Choice {
                    kind: RuntimeMessageChoiceKind::Select,
                    ..
                } => "select",
                RuntimeMessageNode::Formatted {
                    format: RuntimeMessageFormat::Date,
                    ..
                } => "date",
                other => panic!("unexpected node {other:?}"),
            },
            RuntimeCompiledMessage::Lazy => panic!("valid ICU lowers to nodes"),
        })
        .collect();
    assert_eq!(kinds.len(), 2);

    let error: Error = parse_catalog("not a PO line\n", "en", "en").unwrap_err();
    assert!(!error.to_string().is_empty());
    let error = compile_catalog(&[&english], "de", "en", &[]).unwrap_err();
    assert!(!error.to_string().is_empty());
}

/// Source files that define the public API of `palamedes::sdk`: the module
/// itself plus every core module it re-exports from.
fn sdk_sources() -> Option<Vec<PathBuf>> {
    let core = Path::new(env!("CARGO_MANIFEST_DIR")).join("../palamedes/src");
    let sdk = core.join("sdk.rs");
    if !sdk.exists() {
        // A packaged palamedes-build has no core sources next to it. Inside
        // the workspace the file must exist, or this check would go silent.
        assert!(
            !Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../Cargo.toml")
                .exists(),
            "missing {}",
            sdk.display()
        );
        return None;
    }
    let file = syn::parse_file(&fs::read_to_string(&sdk).unwrap()).unwrap();
    let mut sources = vec![sdk];
    for item in &file.items {
        if let syn::Item::Use(item) = item
            && matches!(item.vis, syn::Visibility::Public(_))
            && let syn::UseTree::Path(root) = &item.tree
            && root.ident == "crate"
            && let syn::UseTree::Path(module) = &*root.tree
        {
            let flat = core.join(format!("{}.rs", module.ident));
            sources.push(if flat.exists() {
                flat
            } else {
                core.join(module.ident.to_string()).join("mod.rs")
            });
        }
    }
    Some(sources)
}

/// Names that a file imports from Ferrocat crates.
fn ferrocat_imports(tree: &syn::UseTree, in_ferrocat: bool, names: &mut BTreeSet<String>) {
    match tree {
        syn::UseTree::Path(path) => {
            let inside = in_ferrocat || path.ident.to_string().starts_with("ferrocat");
            ferrocat_imports(&path.tree, inside, names);
        }
        syn::UseTree::Name(name) if in_ferrocat => {
            names.insert(name.ident.to_string());
        }
        syn::UseTree::Rename(rename) if in_ferrocat => {
            names.insert(rename.rename.to_string());
        }
        syn::UseTree::Glob(_) if in_ferrocat => {
            panic!("glob imports from Ferrocat hide which names the sdk uses");
        }
        syn::UseTree::Group(group) => {
            for tree in &group.items {
                ferrocat_imports(tree, in_ferrocat, names);
            }
        }
        _ => {}
    }
}

fn public(visibility: &syn::Visibility) -> bool {
    matches!(visibility, syn::Visibility::Public(_))
}

/// Tokens of everything a caller can name: public signatures, public
/// fields, enum payloads, aliases, re-exports, and trait implementations.
fn public_api_tokens(file: &syn::File) -> TokenStream {
    let mut tokens = TokenStream::new();
    for item in &file.items {
        match item {
            syn::Item::Fn(item) if public(&item.vis) => item.sig.to_tokens(&mut tokens),
            syn::Item::Struct(item) if public(&item.vis) => {
                item.generics.to_tokens(&mut tokens);
                for field in item.fields.iter().filter(|field| public(&field.vis)) {
                    field.ty.to_tokens(&mut tokens);
                }
            }
            syn::Item::Enum(item) if public(&item.vis) => {
                item.generics.to_tokens(&mut tokens);
                for variant in &item.variants {
                    variant.fields.to_tokens(&mut tokens);
                }
            }
            syn::Item::Type(item) if public(&item.vis) => item.ty.to_tokens(&mut tokens),
            syn::Item::Const(item) if public(&item.vis) => item.ty.to_tokens(&mut tokens),
            syn::Item::Use(item) if public(&item.vis) => item.tree.to_tokens(&mut tokens),
            syn::Item::Impl(item) => {
                if let Some((_, path, _)) = &item.trait_ {
                    item.generics.to_tokens(&mut tokens);
                    path.to_tokens(&mut tokens);
                    item.self_ty.to_tokens(&mut tokens);
                    for member in &item.items {
                        if let syn::ImplItem::Type(alias) = member {
                            alias.ty.to_tokens(&mut tokens);
                        }
                    }
                } else {
                    for member in &item.items {
                        if let syn::ImplItem::Fn(function) = member
                            && public(&function.vis)
                        {
                            function.sig.to_tokens(&mut tokens);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    tokens
}

fn ferrocat_names(stream: TokenStream, imports: &BTreeSet<String>, found: &mut Vec<String>) {
    for token in stream {
        match token {
            TokenTree::Ident(ident) => {
                let name = ident.to_string();
                if name.starts_with("ferrocat") || imports.contains(&name) {
                    found.push(name);
                }
            }
            TokenTree::Group(group) => ferrocat_names(group.stream(), imports, found),
            _ => {}
        }
    }
}

#[test]
fn the_sdk_public_api_names_no_ferrocat_types() {
    let Some(sources) = sdk_sources() else {
        return;
    };
    assert!(
        sources.len() > 1,
        "the sdk re-exports core modules: {sources:?}"
    );
    let mut violations = Vec::new();
    for path in &sources {
        let file = syn::parse_file(&fs::read_to_string(path).unwrap()).unwrap();
        let mut imports = BTreeSet::new();
        for item in &file.items {
            if let syn::Item::Use(item) = item {
                ferrocat_imports(&item.tree, false, &mut imports);
            }
        }
        let mut found = Vec::new();
        ferrocat_names(public_api_tokens(&file), &imports, &mut found);
        if !found.is_empty() {
            violations.push(format!("{}: {found:?}", path.display()));
        }
    }
    assert!(
        violations.is_empty(),
        "palamedes::sdk must not expose Ferrocat types: {violations:?}"
    );
}
