//! Locate Svelte's inline instance and module scripts without compiling markup.
//!
//! Markup expressions, attributes, comments, styles, and nested HTML scripts are
//! not extraction surfaces. OXC owns all JavaScript/TypeScript macro semantics.

use std::path::Path;

use oxc_span::SourceType;

use crate::component::ScriptBlock;
use crate::{PalamedesError, PalamedesResult};

pub(crate) fn is_svelte(filename: &str) -> bool {
    Path::new(filename)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svelte"))
}

pub(crate) fn script_blocks(source: &str, filename: &str) -> PalamedesResult<Vec<ScriptBlock>> {
    let mut scripts = Vec::new();
    let mut cursor = 0;
    let mut elements = 0_usize;
    let mut blocks = 0_usize;
    let mut seen = [false; 2];
    let bytes = source.as_bytes();
    while cursor < bytes.len() {
        if source[cursor..].starts_with("<!--") {
            cursor = source[cursor + 4..]
                .find("-->")
                .map_or(bytes.len(), |end| cursor + 4 + end + 3);
        } else if bytes[cursor] == b'{' {
            if bytes.get(cursor + 1) == Some(&b'#') {
                blocks += 1;
            } else if closing_block_end(source, cursor).is_some() {
                blocks = blocks.saturating_sub(1);
            }
            cursor = expression_end(source, cursor).ok_or_else(|| {
                component_error(
                    filename,
                    "Unclosed markup expression before a script block.",
                )
            })?;
        } else if bytes[cursor] == b'<' {
            let Some(tag) = tag_at(source, cursor) else {
                cursor += 1;
                continue;
            };
            cursor = tag.end;
            if tag.closing {
                elements = elements.saturating_sub(1);
                continue;
            }
            if matches!(tag.name, "script" | "style" | "textarea" | "title") && !tag.self_closing {
                let closing = format!("</{}", tag.name);
                let mut end = cursor;
                let close = loop {
                    let start = source[end..]
                        .find(&closing)
                        .map(|offset| end + offset)
                        .ok_or_else(|| {
                            component_error(filename, "Missing closing language-block tag.")
                        })?;
                    if let Some(close) = tag_at(source, start)
                        && close.closing
                        && close.name == tag.name
                    {
                        break (start, close.end);
                    }
                    end = start + closing.len();
                };
                cursor = close.1;
                if tag.name != "script" || elements != 0 || blocks != 0 {
                    continue;
                }
                let module = tag.attributes.iter().any(|(key, value)| {
                    *key == "module" || (*key == "context" && *value == "module")
                });
                if seen[usize::from(module)] {
                    return Err(component_error(
                        filename,
                        "A component can contain only one instance script and one module script.",
                    ));
                }
                seen[usize::from(module)] = true;
                if tag.attributes.iter().any(|(key, _)| *key == "src") {
                    return Err(component_error(
                        filename,
                        "Svelte macro scripts must contain inline code; external src is not supported.",
                    ));
                }
                let lang = tag
                    .attributes
                    .iter()
                    .find_map(|(key, value)| (*key == "lang").then_some(*value))
                    .unwrap_or("js");
                let source_type = match lang {
                    "js" | "javascript" => SourceType::mjs(),
                    "ts" | "typescript" => SourceType::ts(),
                    _ => {
                        let content = &source[tag.end..close.0];
                        if content.contains("@palamedes") || content.contains("i18n") {
                            return Err(component_error(
                                filename,
                                "Palamedes Svelte macros require a JavaScript or TypeScript script block (js or ts).",
                            ));
                        }
                        continue;
                    }
                };
                scripts.push(ScriptBlock {
                    range: tag.end..close.0,
                    source_type,
                    instance: !module,
                });
            } else if !tag.self_closing
                && !matches!(
                    tag.name,
                    "area"
                        | "base"
                        | "br"
                        | "col"
                        | "embed"
                        | "hr"
                        | "img"
                        | "input"
                        | "link"
                        | "meta"
                        | "param"
                        | "source"
                        | "track"
                        | "wbr"
                        | "!doctype"
                )
            {
                elements += 1;
            }
        } else {
            cursor += source[cursor..].chars().next().unwrap().len_utf8();
        }
    }
    Ok(scripts)
}

struct Tag<'a> {
    name: &'a str,
    end: usize,
    closing: bool,
    self_closing: bool,
    attributes: Vec<(&'a str, &'a str)>,
}

fn tag_at(source: &str, start: usize) -> Option<Tag<'_>> {
    let bytes = source.as_bytes();
    let mut cursor = start + 1;
    let closing = bytes.get(cursor) == Some(&b'/');
    cursor += usize::from(closing);
    let name_start = cursor;
    while bytes.get(cursor).is_some_and(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'!' | b'.')
    }) {
        cursor += 1;
    }
    if cursor == name_start {
        return None;
    }
    let name = &source[name_start..cursor];
    let mut attributes = Vec::new();
    loop {
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'>') || bytes.get(cursor..cursor + 2) == Some(b"/>") {
            let self_closing = bytes[cursor] == b'/';
            return Some(Tag {
                name,
                end: cursor + if self_closing { 2 } else { 1 },
                closing,
                self_closing,
                attributes,
            });
        }
        if bytes.get(cursor) == Some(&b'{') {
            cursor = expression_end(source, cursor)?;
            continue;
        }
        let key_start = cursor;
        while bytes
            .get(cursor)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(byte, b'=' | b'>' | b'/'))
        {
            cursor += 1;
        }
        if cursor == key_start {
            return None;
        }
        let key = &source[key_start..cursor];
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        let value = if bytes.get(cursor) == Some(&b'=') {
            cursor += 1;
            while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                cursor += 1;
            }
            let start = cursor;
            match bytes.get(cursor)? {
                b'\'' | b'"' => {
                    let quote = bytes[cursor];
                    cursor += 1;
                    let start = cursor;
                    while *bytes.get(cursor)? != quote {
                        cursor = if bytes[cursor] == b'{' {
                            expression_end(source, cursor)?
                        } else {
                            cursor + 1
                        };
                    }
                    let value = &source[start..cursor];
                    cursor += 1;
                    value
                }
                b'{' => {
                    cursor = expression_end(source, cursor)?;
                    &source[start..cursor]
                }
                _ => {
                    while bytes
                        .get(cursor)
                        .is_some_and(|byte| !byte.is_ascii_whitespace() && *byte != b'>')
                    {
                        cursor += 1;
                    }
                    &source[start..cursor]
                }
            }
        } else {
            ""
        };
        attributes.push((key, value));
    }
}

/// Skip a Svelte brace expression, including strings, nested templates, comments,
/// and regex literals. This locates language blocks only; it never extracts or
/// transforms JavaScript from the markup.
fn expression_end(source: &str, start: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    if let Some(end) = closing_block_end(source, start) {
        return Some(end);
    }
    let mut depth = 1;
    let mut cursor = start + 1;
    let mut regex_allowed = true;
    while let Some(&byte) = bytes.get(cursor) {
        match byte {
            b'\'' | b'"' => {
                cursor = string_end(bytes, cursor, byte)?;
                regex_allowed = false;
            }
            b'`' => {
                cursor += 1;
                loop {
                    match *bytes.get(cursor)? {
                        b'\\' => cursor += 2,
                        b'`' => {
                            cursor += 1;
                            break;
                        }
                        b'$' if bytes.get(cursor + 1) == Some(&b'{') => {
                            cursor = expression_end(source, cursor + 1)?;
                        }
                        _ => cursor += 1,
                    }
                }
                regex_allowed = false;
            }
            b'/' if bytes.get(cursor + 1) == Some(&b'/') => {
                cursor = source[cursor..]
                    .find('\n')
                    .map_or(bytes.len(), |end| cursor + end);
            }
            b'/' if bytes.get(cursor + 1) == Some(&b'*') => {
                cursor += 2 + source[cursor + 2..].find("*/")? + 2;
            }
            b'/' if regex_allowed => {
                cursor += 1;
                let mut class = false;
                loop {
                    match *bytes.get(cursor)? {
                        b'\\' => cursor += 2,
                        b'[' => {
                            class = true;
                            cursor += 1;
                        }
                        b']' => {
                            class = false;
                            cursor += 1;
                        }
                        b'/' if !class => {
                            cursor += 1;
                            break;
                        }
                        _ => cursor += 1,
                    }
                }
                regex_allowed = false;
            }
            b'{' => {
                depth += 1;
                cursor += 1;
                regex_allowed = true;
            }
            b'}' => {
                depth -= 1;
                cursor += 1;
                if depth == 0 {
                    return Some(cursor);
                }
                regex_allowed = false;
            }
            byte if byte.is_ascii_whitespace() => cursor += 1,
            byte if byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$') => {
                let word = cursor;
                while bytes
                    .get(cursor)
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
                {
                    cursor += 1;
                }
                regex_allowed = matches!(
                    &source[word..cursor],
                    "if" | "each"
                        | "key"
                        | "html"
                        | "return"
                        | "throw"
                        | "case"
                        | "typeof"
                        | "void"
                        | "delete"
                        | "yield"
                        | "await"
                        | "in"
                        | "of"
                );
            }
            _ => {
                regex_allowed = matches!(
                    byte,
                    b'(' | b'['
                        | b'='
                        | b','
                        | b':'
                        | b';'
                        | b'!'
                        | b'?'
                        | b'&'
                        | b'|'
                        | b'+'
                        | b'-'
                        | b'*'
                        | b'%'
                        | b'~'
                        | b'^'
                        | b'>'
                );
                cursor += 1;
            }
        }
    }
    None
}

// A slash at the start of an interpolation can also begin a regex literal.
// Recognize only actual Svelte closing directives before skipping JavaScript.
fn closing_block_end(source: &str, start: usize) -> Option<usize> {
    let tail = source.get(start..)?.strip_prefix("{/")?;
    let end = tail.find('}')?;
    matches!(
        tail[..end].trim(),
        "if" | "each" | "await" | "key" | "snippet"
    )
    .then_some(start + 2 + end + 1)
}

fn string_end(bytes: &[u8], start: usize, quote: u8) -> Option<usize> {
    let mut cursor = start + 1;
    loop {
        match *bytes.get(cursor)? {
            b'\\' => cursor += 2,
            byte if byte == quote => return Some(cursor + 1),
            _ => cursor += 1,
        }
    }
}

fn component_error(filename: &str, detail: &str) -> PalamedesError {
    PalamedesError::ParseModuleSource {
        filename: filename.to_owned(),
        messages: format!("{filename}: {detail}"),
    }
}

#[cfg(test)]
mod tests {
    use crate::{extract_messages, transform_macros};

    #[test]
    fn svelte_instance_macros_keep_original_spans_and_source_maps() {
        let source = "<p>😀</p><script lang='ts'>\nimport { t as text, plural } from '@palamedes/core/macro';\nconst name: string = 'Alex';\nconst title = text`Hello ${name}`;\nconst count = $derived(plural(2, {one:'# seat',other:'# seats'}));\n</script><h1>{title}</h1><style>h1{color:red}</style>";
        let messages = extract_messages(source, "View.svelte").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message, "Hello {name}");
        assert_eq!(messages[0].origin, ("View.svelte".into(), 4, None));
        let result = transform_macros(source, "View.svelte", None).unwrap();
        assert_eq!(result.compiled_ids.len(), 2);
        assert!(!result.code.contains("@palamedes/core/macro"));
        assert!(result.code.starts_with("<p>😀</p><script lang='ts'>"));
        assert!(
            result
                .code
                .ends_with("</script><h1>{title}</h1><style>h1{color:red}</style>")
        );
        assert_eq!(
            result.map.unwrap().sources_content,
            Some(vec![Some(source.into())])
        );
        let block = super::script_blocks(source, "View.svelte")
            .unwrap()
            .remove(0);
        assert!(
            result
                .edits
                .iter()
                .all(|edit| edit.start >= block.range.start && edit.end <= block.range.end)
        );
    }

    #[test]
    fn svelte_module_scope_is_distinct_from_instance_scope() {
        for attribute in ["module", "context='module'"] {
            let eager = format!(
                "<script {attribute}>import {{t}} from '@palamedes/core/macro'; const label=t`Too early`;</script>"
            );
            assert!(
                extract_messages(&eager, "View.svelte")
                    .unwrap_err()
                    .to_string()
                    .contains("inside a function")
            );
            assert!(
                transform_macros(&eager, "View.svelte", None)
                    .unwrap_err()
                    .to_string()
                    .contains("inside a function")
            );
            let valid = format!(
                "<script {attribute}>import {{t}} from '@palamedes/core/macro'; export function label() {{return t`Module`;}}</script><script>import {{t}} from '@palamedes/core/macro'; const label=t`Instance`;</script>"
            );
            assert_eq!(extract_messages(&valid, "View.svelte").unwrap().len(), 2);
            assert_eq!(
                transform_macros(&valid, "View.svelte", None)
                    .unwrap()
                    .compiled_ids
                    .len(),
                2
            );
        }
    }

    #[test]
    fn svelte_markup_and_styles_are_not_script_surfaces() {
        let source = r#"<!-- <script>import {t} from '@palamedes/core/macro'; const x=t`Comment`;</script> -->
<div><div></div><script>import {t} from '@palamedes/core/macro'; const x=t`Nested`;</script></div>
{`<script>fake()</script>${'😀'}`}
<div title={'<script>fake()</script>'} data-test="{'<script>fake()</script>'}"></div>
{#if /[}]/.test('}') }<p>Example</p>{/if}
<style>p::before{content:'<script>'}</style>
<script>import {t} from '@palamedes/core/macro'; const label=t`Real`; function shadow(t) { return t`Local`; }</script>
<p>{label}</p>"#;
        let messages = extract_messages(source, "View.svelte").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message, "Real");
        let result = transform_macros(source, "View.svelte", None).unwrap();
        assert_eq!(result.compiled_ids.len(), 1);
        assert!(result.code.contains("t`Comment`"));
        assert!(result.code.contains("t`Nested`"));
        assert!(result.code.contains("t`Local`"));
    }

    #[test]
    fn svelte_regex_interpolations_do_not_expose_script_lookalikes() {
        let source = r#"{/[}]/.test('<script>fake()</script>')}
{#if true}<p>{/[/]/.test('/')}</p>{/if}
<script>import {t} from '@palamedes/core/macro'; const title=t`Real`;</script>"#;
        assert_eq!(
            extract_messages(source, "View.svelte").unwrap()[0].message,
            "Real"
        );
        assert_eq!(
            transform_macros(source, "View.svelte", None)
                .unwrap()
                .compiled_ids
                .len(),
            1
        );
    }

    #[test]
    fn svelte_rejects_ambiguous_or_unsupported_blocks() {
        for source in [
            "<script>import {t} from '@palamedes/core/macro';",
            "<script></script><script></script>",
            "<script module></script><script context='module'></script>",
            "<script src='./messages.ts'></script>",
            "<script lang=coffee>import {t} from '@palamedes/core/macro'</script>",
        ] {
            assert!(extract_messages(source, "View.svelte").is_err(), "{source}");
            assert!(
                transform_macros(source, "View.svelte", None).is_err(),
                "{source}"
            );
        }
    }

    #[test]
    fn svelte_generated_getters_are_unique_across_both_scripts() {
        let source = "<script module>import {t as text} from '@palamedes/core/macro'; export function label(){return text`Module`;}</script><script>import {t} from '@palamedes/core/macro'; const title=t`Instance`;</script>";
        let output = transform_macros(source, "View.svelte", None).unwrap();
        assert!(
            output.code.contains("import { getI18n }"),
            "{}",
            output.code
        );
        assert!(
            output.code.contains("getI18n as __palamedesGetI18n"),
            "{}",
            output.code
        );
        assert_eq!(output.compiled_ids.len(), 2);
    }

    #[test]
    fn svelte_runtime_imports_avoid_other_script_bindings() {
        let source = "<script module>const getI18n=1; const __palamedesGetI18n=2;</script><script>import {t} from '@palamedes/core/macro'; const label=t`Open`;</script>";
        let result = transform_macros(source, "View.svelte", None).unwrap();
        assert!(
            result.code.contains("getI18n as __palamedesGetI18n2"),
            "{}",
            result.code
        );
    }
}
