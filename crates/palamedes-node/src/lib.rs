mod catalog;
mod catalog_config;
mod extract;
mod mdx;
mod po;
mod shared;
mod source;
mod transform;

pub use self::catalog::*;
pub use self::extract::*;
pub use self::mdx::*;
pub use self::po::*;
pub use self::source::*;
pub use self::transform::*;

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    #[test]
    fn every_function_napi_export_enables_panic_catching() {
        let source_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");

        for module in rust_source_modules(&source_dir) {
            let source = fs::read_to_string(&module).expect("read Rust source module");
            let unguarded_exports = napi_attributes(&source)
                .into_iter()
                .filter(|(_, attribute)| {
                    !is_object_or_enum_annotation(attribute) && !attribute.contains("catch_unwind")
                })
                .map(|(line, _)| line)
                .collect::<Vec<_>>();

            assert!(
                unguarded_exports.is_empty(),
                "{} has function-level #[napi] exports without catch_unwind at lines {unguarded_exports:?}",
                module.display()
            );
        }
    }

    #[test]
    fn napi_attribute_scan_detects_function_options() {
        let source = format!(
            "#[{}]\npub fn exported() {{}}",
            "napi(js_name = \"exported\")"
        );
        let attributes = napi_attributes(&source);

        assert_eq!(
            attributes,
            vec![(1, "#[napi(js_name = \"exported\")]".to_owned())]
        );
        assert!(!is_object_or_enum_annotation(&attributes[0].1));
    }

    #[test]
    fn napi_attribute_scan_excludes_object_and_enum_annotations() {
        let source = format!(
            "#[{}]\npub struct Object {{}}\n#[{}]\npub enum Enum {{ Value }}",
            "napi(object)", "napi(string_enum)"
        );
        let attributes = napi_attributes(&source);

        assert!(attributes
            .iter()
            .all(|(_, attribute)| is_object_or_enum_annotation(attribute)));
    }

    fn rust_source_modules(dir: &Path) -> Vec<PathBuf> {
        let mut modules = Vec::new();

        for entry in fs::read_dir(dir).expect("read Rust source directory") {
            let path = entry.expect("read Rust source entry").path();
            if path.is_dir() {
                modules.extend(rust_source_modules(&path));
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                modules.push(path);
            }
        }

        modules.sort();
        modules
    }

    fn napi_attributes(source: &str) -> Vec<(usize, String)> {
        let mut attributes = Vec::new();
        let mut lines = source.lines().enumerate();

        while let Some((index, line)) = lines.next() {
            let trimmed = line.trim_start();
            if !(trimmed == "#[napi]" || trimmed.starts_with("#[napi(")) {
                continue;
            }

            let mut attribute = trimmed.to_owned();
            while !attribute.trim_end().ends_with(']') {
                let Some((_, continuation)) = lines.next() else {
                    break;
                };
                attribute.push('\n');
                attribute.push_str(continuation.trim());
            }
            attributes.push((index + 1, attribute));
        }

        attributes
    }

    fn is_object_or_enum_annotation(attribute: &str) -> bool {
        let normalized = attribute
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        normalized.starts_with("#[napi(object") || normalized.starts_with("#[napi(string_enum")
    }
}
