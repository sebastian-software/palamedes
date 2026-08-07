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
                    !is_object_or_enum_annotation(attribute) && !has_catch_unwind_option(attribute)
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
        assert!(!has_catch_unwind_option(&attributes[0].1));
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

    #[test]
    fn napi_option_scan_ignores_string_and_comment_collisions() {
        let unguarded_attributes = [
            format!("#[{}]", r#"napi(js_name = "catch_unwind")"#),
            format!("#[{}]", r#"napi(ts_return_type = "catch_unwind")"#),
            format!("#[{}]", r##"napi(ts_return_type = r#"catch_unwind"#)"##),
            format!("#[{}]", "napi(\njs_name = \"exported\", // catch_unwind\n)"),
            format!("#[{}]", "napi(/* catch_unwind */ js_name = \"exported\")"),
        ];

        assert!(unguarded_attributes
            .iter()
            .all(|attribute| !has_catch_unwind_option(attribute)));
    }

    #[test]
    fn napi_option_scan_recognizes_multiline_catch_unwind_option() {
        let attribute = format!(
            "#[{}]",
            "napi(\njs_name = \"exported\",\n// Keep panics inside the N-API boundary.\ncatch_unwind,\nts_return_type = \"string\"\n)"
        );

        assert!(has_catch_unwind_option(&attribute));
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
        matches!(
            napi_option_names(attribute).first().copied(),
            Some("object" | "string_enum")
        )
    }

    fn has_catch_unwind_option(attribute: &str) -> bool {
        napi_option_names(attribute)
            .into_iter()
            .any(|option| option == "catch_unwind")
    }

    fn napi_option_names(attribute: &str) -> Vec<&str> {
        let Some(options) = attribute
            .strip_prefix("#[napi(")
            .and_then(|attribute| attribute.strip_suffix(")]"))
        else {
            return Vec::new();
        };

        top_level_options(options)
            .into_iter()
            .filter_map(leading_identifier)
            .collect()
    }

    fn top_level_options(options: &str) -> Vec<&str> {
        let bytes = options.as_bytes();
        let mut segments = Vec::new();
        let mut start = 0;
        let mut index = 0;
        let mut depth = 0_usize;

        while index < bytes.len() {
            match bytes[index] {
                b'/' if bytes.get(index + 1) == Some(&b'/') => {
                    index = skip_line_comment(bytes, index + 2);
                }
                b'/' if bytes.get(index + 1) == Some(&b'*') => {
                    index = skip_block_comment(bytes, index + 2);
                }
                b'"' => index = skip_quoted_string(bytes, index + 1),
                b'r' => {
                    if let Some(next) = skip_raw_string(bytes, index) {
                        index = next;
                    } else {
                        index += 1;
                    }
                }
                b'(' | b'[' | b'{' => {
                    depth += 1;
                    index += 1;
                }
                b')' | b']' | b'}' => {
                    depth = depth.saturating_sub(1);
                    index += 1;
                }
                b',' if depth == 0 => {
                    segments.push(&options[start..index]);
                    start = index + 1;
                    index += 1;
                }
                _ => index += 1,
            }
        }

        segments.push(&options[start..]);
        segments
    }

    fn leading_identifier(option: &str) -> Option<&str> {
        let bytes = option.as_bytes();
        let mut index = 0;

        loop {
            while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
                index += 1;
            }
            match (bytes.get(index), bytes.get(index + 1)) {
                (Some(b'/'), Some(b'/')) => index = skip_line_comment(bytes, index + 2),
                (Some(b'/'), Some(b'*')) => index = skip_block_comment(bytes, index + 2),
                _ => break,
            }
        }

        let start = index;
        if !bytes
            .get(index)
            .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_')
        {
            return None;
        }
        index += 1;
        while bytes
            .get(index)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        {
            index += 1;
        }
        Some(&option[start..index])
    }

    fn skip_line_comment(bytes: &[u8], mut index: usize) -> usize {
        while bytes.get(index).is_some_and(|byte| *byte != b'\n') {
            index += 1;
        }
        index
    }

    fn skip_block_comment(bytes: &[u8], mut index: usize) -> usize {
        let mut depth = 1;
        while index < bytes.len() {
            match (bytes.get(index), bytes.get(index + 1)) {
                (Some(b'/'), Some(b'*')) => {
                    depth += 1;
                    index += 2;
                }
                (Some(b'*'), Some(b'/')) => {
                    depth -= 1;
                    index += 2;
                    if depth == 0 {
                        break;
                    }
                }
                _ => index += 1,
            }
        }
        index
    }

    fn skip_quoted_string(bytes: &[u8], mut index: usize) -> usize {
        while index < bytes.len() {
            match bytes[index] {
                b'\\' => index += 2,
                b'"' => return index + 1,
                _ => index += 1,
            }
        }
        index
    }

    fn skip_raw_string(bytes: &[u8], index: usize) -> Option<usize> {
        let mut quote = index + 1;
        while bytes.get(quote) == Some(&b'#') {
            quote += 1;
        }
        if bytes.get(quote) != Some(&b'"') {
            return None;
        }

        let hashes = quote - index - 1;
        let mut cursor = quote + 1;
        while cursor < bytes.len() {
            if bytes[cursor] == b'"'
                && bytes
                    .get(cursor + 1..cursor + hashes + 1)
                    .is_some_and(|suffix| suffix.iter().all(|byte| *byte == b'#'))
            {
                return Some(cursor + hashes + 1);
            }
            cursor += 1;
        }
        Some(cursor)
    }
}
