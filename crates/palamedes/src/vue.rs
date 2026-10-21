//! Vue's top-level language blocks, without compiling its template language.
//!
//! Both extraction and transformation parse the same inline scripts with OXC.
//! Masking everything else preserves UTF-8 spans; diagnostics and edits still
//! use the original SFC, including Unicode before a script on the same line.

use std::borrow::Cow;
use std::ops::Range;
use std::path::Path;

use oxc_span::SourceType;

use crate::{PalamedesError, PalamedesResult};

pub(crate) struct ScriptBlock {
    pub range: Range<usize>,
    pub source_type: SourceType,
    pub setup: bool,
}

pub(crate) fn is_vue(filename: &str) -> bool {
    Path::new(filename)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("vue"))
}

pub(crate) fn masked_source<'a>(source: &'a str, range: &Range<usize>) -> Cow<'a, str> {
    if range.start == 0 && range.end == source.len() {
        return Cow::Borrowed(source);
    }
    let mut bytes = source.as_bytes().to_vec();
    for (index, byte) in bytes.iter_mut().enumerate() {
        if !range.contains(&index) && !matches!(byte, b'\n' | b'\r') {
            *byte = b' ';
        }
    }
    // Replaced regions contain only ASCII; the retained range follows tag
    // boundaries, so it contains complete UTF-8 code points.
    Cow::Owned(String::from_utf8(bytes).expect("masked SFC is valid UTF-8"))
}

struct Tag<'a> {
    name: &'a str,
    end: usize,
    closing: bool,
    self_closing: bool,
    attributes: Vec<(&'a str, &'a str)>,
}

impl Tag<'_> {
    fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find_map(|(key, value)| (*key == name).then_some(*value))
    }
}

/// Locate top-level `<script>` and `<script setup>` blocks. Templates can
/// contain nested templates; styles, custom blocks, and non-HTML templates
/// are raw text in Vue's SFC grammar. A script-looking tag in those blocks or
/// in a comment must never become an extraction surface.
pub(crate) fn script_blocks(source: &str, filename: &str) -> PalamedesResult<Vec<ScriptBlock>> {
    let mut scripts = Vec::new();
    let mut cursor = 0;
    let mut seen_script = [false; 2];
    while let Some(start) = next_tag(source, &mut cursor) {
        let Some(tag) = parse_tag(source, start) else {
            continue;
        };
        cursor = tag.end;
        if tag.closing || tag.self_closing {
            continue;
        }
        let raw =
            tag.name != "template" || tag.attribute("lang").is_some_and(|lang| lang != "html");
        let end = block_end(source, &tag, raw)
            .ok_or_else(|| sfc_error(filename, "Missing closing language-block tag."))?;
        cursor = end.end;
        if tag.name != "script" {
            continue;
        }
        let setup = usize::from(tag.attribute("setup").is_some());
        if seen_script[setup] {
            return Err(sfc_error(
                filename,
                "An SFC can contain only one script block of each kind (normal and setup).",
            ));
        }
        seen_script[setup] = true;
        if tag.attribute("src").is_some() {
            if !source[tag.end..end.start].trim().is_empty() {
                return Err(sfc_error(
                    filename,
                    "A script with src cannot also contain inline code.",
                ));
            }
            continue;
        }
        let source_type = match tag.attribute("lang").unwrap_or("js") {
            "js" => SourceType::mjs(),
            "jsx" => SourceType::jsx(),
            "ts" => SourceType::ts(),
            "tsx" => SourceType::tsx(),
            _ => {
                let content = &source[tag.end..end.start];
                if content.contains("@palamedes") || content.contains("i18n") {
                    return Err(sfc_error(
                        filename,
                        "Palamedes Vue macros require a JavaScript or TypeScript script block (js, jsx, ts, or tsx).",
                    ));
                }
                continue;
            }
        };
        scripts.push(ScriptBlock {
            range: tag.end..end.start,
            source_type,
            setup: setup == 1,
        });
    }
    Ok(scripts)
}

struct BlockEnd {
    start: usize,
    end: usize,
}

fn block_end(source: &str, opening: &Tag<'_>, raw: bool) -> Option<BlockEnd> {
    let mut cursor = opening.end;
    let mut depth = 0;
    loop {
        let start = if raw {
            let offset = source[cursor..].find("</")?;
            cursor += offset + 2;
            cursor - 2
        } else {
            next_tag(source, &mut cursor)?
        };
        let Some(tag) = parse_tag(source, start) else {
            continue;
        };
        cursor = tag.end;
        if tag.name != opening.name {
            if !raw
                && !tag.closing
                && !tag.self_closing
                && matches!(tag.name, "textarea" | "title" | "script" | "style")
            {
                cursor = block_end(source, &tag, true)?.end;
            }
            continue;
        }
        if tag.closing {
            if depth == 0 {
                return Some(BlockEnd {
                    start,
                    end: tag.end,
                });
            }
            depth -= 1;
        } else if !raw && !tag.self_closing {
            depth += 1;
        }
    }
}

fn next_tag(source: &str, cursor: &mut usize) -> Option<usize> {
    loop {
        let start = *cursor + source[*cursor..].find('<')?;
        if let Some(interpolation) = source[*cursor..start].find("{{") {
            let content = *cursor + interpolation + 2;
            *cursor = content + source[content..].find("}}")? + 2;
            continue;
        }
        *cursor = start + 1;
        if source[start..].starts_with("<!--") {
            *cursor = start + 4 + source[start + 4..].find("-->")? + 3;
        } else {
            return Some(start);
        }
    }
}

fn parse_tag(source: &str, start: usize) -> Option<Tag<'_>> {
    let bytes = source.as_bytes();
    let mut cursor = start + 1;
    let closing = bytes.get(cursor) == Some(&b'/');
    cursor += usize::from(closing);
    let name_start = cursor;
    while bytes
        .get(cursor)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
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
        match bytes.get(cursor)? {
            b'>' => {
                return Some(Tag {
                    name,
                    end: cursor + 1,
                    closing,
                    self_closing: false,
                    attributes,
                });
            }
            b'/' if bytes.get(cursor + 1) == Some(&b'>') => {
                return Some(Tag {
                    name,
                    end: cursor + 2,
                    closing,
                    self_closing: true,
                    attributes,
                });
            }
            _ => {}
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
            match *bytes.get(cursor)? {
                quote @ (b'\'' | b'"') => {
                    cursor += 1;
                    let value_start = cursor;
                    while *bytes.get(cursor)? != quote {
                        cursor += 1;
                    }
                    let value = &source[value_start..cursor];
                    cursor += 1;
                    value
                }
                _ => {
                    let value_start = cursor;
                    while bytes
                        .get(cursor)
                        .is_some_and(|byte| !byte.is_ascii_whitespace() && *byte != b'>')
                    {
                        cursor += 1;
                    }
                    &source[value_start..cursor]
                }
            }
        } else {
            ""
        };
        attributes.push((key, value));
    }
}

fn sfc_error(filename: &str, detail: &str) -> PalamedesError {
    PalamedesError::ParseModuleSource {
        filename: filename.to_owned(),
        messages: format!("{filename}: {detail}"),
    }
}

#[cfg(test)]
mod tests {
    use crate::{extract_messages, transform_macros};

    #[test]
    fn vue_setup_uses_the_shared_macro_semantics_and_original_locations() {
        let source = "<template>😀</template><script setup lang='ts'>\nimport { t as text, plural } from '@palamedes/core/macro';\nconst name: string = 'Alex';\nconst greeting = text`Hello ${name}`;\nconst count = () => plural(2, {one:'# seat', other:'# seats'});\n</script><style scoped>.x { color: red; }</style>";
        let messages = extract_messages(source, "View.vue").expect("extract setup");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message, "Hello {name}");
        assert_eq!(messages[0].origin, ("View.vue".into(), 4, None));
        let result = transform_macros(source, "View.vue", None).expect("transform setup");
        assert!(result.has_changed);
        assert_eq!(result.compiled_ids.len(), 2);
        assert!(!result.code.contains("@palamedes/core/macro"));
        assert!(
            result
                .code
                .starts_with("<template>😀</template><script setup lang='ts'>")
        );
        assert!(
            result
                .code
                .ends_with("</script><style scoped>.x { color: red; }</style>")
        );
        assert_eq!(
            result.map.expect("SFC map").sources_content,
            Some(vec![Some(source.into())])
        );
        let script = super::script_blocks(source, "View.vue").unwrap().remove(0);
        assert!(
            result
                .edits
                .iter()
                .all(|edit| edit.start >= script.range.start && edit.end <= script.range.end)
        );
    }

    #[test]
    fn vue_ignores_script_lookalikes_in_comments_templates_and_custom_blocks() {
        let source = r#"<!-- <script>import { t } from '@palamedes/core/macro'; const x = t`Comment`;</script> -->
<template><template v-if="a > b"><span title="<script>">Text</span></template><!-- </template> --></template>
<docs><script>import {t} from '@palamedes/core/macro'; const x = t`Docs`;</script></docs>
<style>.x::before { content: '<script>'; }</style>
<script setup>import {t} from '@palamedes/core/macro'; const x = t`Real`;</script>"#;
        let messages = extract_messages(source, "View.vue").unwrap();
        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            ["Real"]
        );
        let output = transform_macros(source, "View.vue", None).unwrap();
        assert_eq!(output.compiled_ids.len(), 1);
        assert!(output.code.contains("t`Comment`"));
        assert!(output.code.contains("t`Docs`"));
    }

    #[test]
    fn vue_normal_script_keeps_module_scope_validation_and_both_blocks_work() {
        let eager =
            "<script>import {t} from '@palamedes/core/macro'; const x = t`Too early`;</script>";
        assert!(
            extract_messages(eager, "View.vue")
                .unwrap_err()
                .to_string()
                .contains("inside a function")
        );
        assert!(
            transform_macros(eager, "View.vue", None)
                .unwrap_err()
                .to_string()
                .contains("inside a function")
        );
        let source = "<script lang=ts>import {t} from '@palamedes/core/macro'; export function label() {return t`Normal`;}</script>\n<script setup lang=ts>import {t as text} from '@palamedes/core/macro'; const x = text`Setup`;</script>";
        assert_eq!(extract_messages(source, "View.vue").unwrap().len(), 2);
        let result = transform_macros(source, "View.vue", None).unwrap();
        assert_eq!(result.compiled_ids.len(), 2);
        assert!(!result.code.contains("@palamedes/core/macro"));
    }

    #[test]
    fn vue_macro_resolution_respects_shadowing_and_preserves_unicode_columns() {
        let source = "<template>😀</template><script setup>import {t} from '@palamedes/core/macro'; /* note */ const x = t`Real`; function shadow(t) { return t`Local`; }</script>";
        let message = extract_messages(source, "View.vue").unwrap().remove(0);
        assert_eq!(message.message, "Real");
        let offset = source.find("/* note */").unwrap();
        let analysis = crate::analyze_source(source, "View.vue").unwrap();
        assert_eq!(
            analysis.comments[0].range.column,
            source[..offset].chars().count() + 1
        );
        let result = transform_macros(source, "View.vue", None).unwrap();
        assert!(result.code.contains("return t`Local`"));
        assert_eq!(result.compiled_ids.len(), 1);
    }

    #[test]
    fn vue_rejects_incomplete_duplicate_and_unsupported_script_blocks() {
        for source in [
            "<script setup>import {t} from '@palamedes/core/macro'; const x=t`Missing`;",
            "<script setup></script><script setup></script>",
            "<script lang=coffee>import {t} from '@palamedes/core/macro'</script>",
        ] {
            assert!(extract_messages(source, "View.vue").is_err(), "{source}");
            assert!(
                transform_macros(source, "View.vue", None).is_err(),
                "{source}"
            );
        }
    }

    #[test]
    fn vue_runtime_imports_avoid_bindings_in_the_other_script() {
        let source = "<script>const getI18n = 1; const __palamedesGetI18n = 2; export default {};</script><script setup>import {t} from '@palamedes/core/macro'; const label = t`Open`;</script>";
        let output = transform_macros(source, "View.vue", None).unwrap();
        assert!(
            output.code.contains("getI18n as __palamedesGetI18n2"),
            "{}",
            output.code
        );
        assert!(output.code.contains("__palamedesGetI18n2()._("));
    }

    #[test]
    fn vue_template_strings_and_raw_text_do_not_change_block_boundaries() {
        let source = "<template>{{ '<template>' }}<textarea></template><script>fake()</script></textarea></template><script setup>import {t} from '@palamedes/core/macro'; const label=t`Real`;</script>";
        assert_eq!(
            extract_messages(source, "View.vue").unwrap()[0].message,
            "Real"
        );
        assert_eq!(
            transform_macros(source, "View.vue", None)
                .unwrap()
                .compiled_ids
                .len(),
            1
        );
    }
}
