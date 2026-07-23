use oxc_allocator::Allocator;
use oxc_ast::ast::Statement;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Moves a macro test fixture into a synthetic function while keeping imports
/// at module scope and preserving the original macro line numbers.
pub(crate) fn scope_macro_test_source(source: &str, filename: &str) -> String {
    if ![
        "@palamedes/core/macro",
        "@palamedes/react/macro",
        "@palamedes/solid/macro",
    ]
    .iter()
    .any(|macro_module| source.contains(macro_module))
    {
        return source.to_string();
    }

    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return source.to_string();
    }

    let Some(import_end) = parsed
        .program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::ImportDeclaration(import) => Some(import.span.end as usize),
            _ => None,
        })
        .max()
    else {
        return source.to_string();
    };

    let mut scoped = String::with_capacity(source.len() + 48);
    scoped.push_str(&source[..import_end]);
    scoped.push_str("; function __palamedes_test_scope() {");
    scoped.push_str(&source[import_end..]);
    scoped.push_str("\n}");
    scoped
}

#[test]
fn scopes_fixtures_after_multiline_imports() {
    let source = r#"import {
  plural,
  t,
} from "@palamedes/core/macro"
const message = t`Hello`
"#;

    let scoped = scope_macro_test_source(source, "test.ts");

    assert!(scoped.contains("from \"@palamedes/core/macro\"; function __palamedes_test_scope() {"));

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &scoped, SourceType::ts()).parse();
    assert!(parsed.diagnostics.is_empty());
}
