//! Locate Svelte's inline instance and module scripts without compiling markup.
//!
//! Markup expressions, attributes, comments, styles, and nested HTML scripts are
//! not extraction surfaces. OXC owns all JavaScript/TypeScript macro semantics.
//! A macro called or referenced from markup is rejected with a located error
//! instead of silently surviving as a reference to an import the transform
//! removes.

use std::collections::HashMap;
use std::path::Path;

use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::component::ScriptBlock;
use crate::extract::MacroCollector;
use crate::source::display_filename;
use crate::translation_scope::source_location;
use crate::{PalamedesError, PalamedesResult};

pub(crate) fn is_svelte(filename: &str) -> bool {
    Path::new(filename)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svelte"))
}

pub(crate) fn script_blocks(source: &str, filename: &str) -> PalamedesResult<Vec<ScriptBlock>> {
    scan(source, filename).map(|scan| scan.scripts)
}

/// Reject a Palamedes macro called or referenced from Svelte markup, including
/// a bare value such as `{handler(t)}`.
///
/// Markup is not an extraction or transform surface, but the script transform
/// still removes the macro import. Without this check the component would
/// compile and then fail at runtime with a `ReferenceError`.
///
/// A name that markup binds itself shadows the import, so its uses are the
/// author's own: `{#each items as t}`, `{#snippet row(t)}`, `let:t`,
/// `{#await … then t}`, `{:catch t}`, and `{@const t = …}`. The check
/// approximates Svelte's scoping: a block or `let:` binding exempts the name in
/// all markup of the component, and an arrow or function parameter exempts it
/// within the same brace expression. A macro use outside the binding's real
/// scope that reuses a shadowed name therefore goes unreported; the check
/// prefers that rare miss over rejecting valid markup.
pub(crate) fn reject_markup_macro_uses(source: &str, filename: &str) -> PalamedesResult<()> {
    if !source.contains("/macro") {
        return Ok(());
    }
    let scan = scan(source, filename)?;
    if scan.expressions.is_empty() {
        return Ok(());
    }
    let macros = imported_macros(source, &scan.scripts);
    if macros.is_empty() {
        return Ok(());
    }
    let mut markup_bindings = scan.bindings;
    let mut references = Vec::new();
    let mut expression_references = Vec::new();
    let mut local = Vec::new();
    for &start in &scan.expressions {
        expression_references.clear();
        let Some(end) = expression_scan(source, start, &mut |word_start, word_end| {
            if macros.contains_key(&source[word_start..word_end])
                && is_reference_shape(source.as_bytes(), word_start, word_end)
            {
                expression_references.push(word_start..word_end);
            }
        }) else {
            continue;
        };
        local.clear();
        expression_bindings(
            &source[start + 1..end - 1],
            &mut local,
            &mut markup_bindings,
        );
        references.extend(
            expression_references
                .drain(..)
                .filter(|reference| !local.contains(&&source[reference.clone()])),
        );
    }
    let Some(reference) = references
        .into_iter()
        .filter(|reference| !markup_bindings.contains(&&source[reference.clone()]))
        .min_by_key(|reference| reference.start)
    else {
        return Ok(());
    };
    let macro_name = &macros[&source[reference.clone()]];
    let detail = if is_call_shape(source.as_bytes(), reference.end) {
        "Svelte markup is not a macro surface, so this call would be neither extracted nor transformed; move the macro call into the component <script> block and render the resulting value"
    } else {
        "Svelte markup is not a macro surface, and the transform removes the macro import, so this reference would throw a ReferenceError; call the macro in the component <script> block and pass the resulting value instead"
    };
    Err(PalamedesError::UnsupportedMacroSyntax {
        macro_name: macro_name.clone(),
        location: source_location(source, display_filename(filename), reference.start),
        detail: detail.to_owned(),
    })
}

/// Local macro import names from all component scripts, mapped to the public
/// macro name. Svelte exposes both instance and module imports to markup.
fn imported_macros(source: &str, scripts: &[ScriptBlock]) -> HashMap<String, String> {
    let mut macros = HashMap::new();
    for script in scripts {
        let allocator = Allocator::default();
        let masked = crate::component::masked_source(source, &script.range);
        let parsed = Parser::new(&allocator, &masked, script.source_type).parse();
        let mut collector = MacroCollector::new();
        collector.visit_program(&parsed.program);
        macros.extend(
            collector
                .imported_macros
                .into_iter()
                .map(|(local_name, imported)| (local_name, imported.imported_name)),
        );
    }
    macros
}

/// A plain identifier reference: a call, a tagged template, or a bare value
/// such as `{handler(t)}`. Member names (`obj.t`, `obj?.t`), object literal
/// keys (`{ t: 1 }`), and pieces of a longer non-ASCII identifier are not
/// references to the binding.
fn is_reference_shape(bytes: &[u8], word_start: usize, word_end: usize) -> bool {
    // The scanner splits words at non-ASCII bytes, so `tä` arrives as `t`.
    if bytes.get(word_end).is_some_and(|byte| *byte >= 0x80)
        || word_start
            .checked_sub(1)
            .is_some_and(|index| bytes[index] >= 0x80 || bytes[index].is_ascii_digit())
    {
        return false;
    }
    let before = bytes[..word_start]
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace());
    let is_member = before
        .is_some_and(|index| bytes[index] == b'.' && (index == 0 || bytes[index - 1] != b'.'));
    // A ternary branch (`a ? t : b`) follows `?`, so only a word after `{` or
    // `,` and before `:` reads as a key.
    let is_object_key = next_byte(bytes, word_end) == Some(b':')
        && before.is_some_and(|index| matches!(bytes[index], b'{' | b','));
    !is_member && !is_object_key
}

/// Whether the reference ending at `word_end` is called or tags a template.
fn is_call_shape(bytes: &[u8], word_end: usize) -> bool {
    matches!(next_byte(bytes, word_end), Some(b'`' | b'('))
}

/// The first non-whitespace byte at or after `index`.
fn next_byte(bytes: &[u8], index: usize) -> Option<u8> {
    bytes
        .get(index..)?
        .iter()
        .find(|byte| !byte.is_ascii_whitespace())
        .copied()
}

struct Scan<'a> {
    scripts: Vec<ScriptBlock>,
    /// Start offsets of markup and attribute brace expressions.
    expressions: Vec<usize>,
    /// Names bound by `let:` directives.
    bindings: Vec<&'a str>,
}

fn scan<'a>(source: &'a str, filename: &str) -> PalamedesResult<Scan<'a>> {
    let mut scripts = Vec::new();
    let mut expressions = Vec::new();
    let mut bindings = Vec::new();
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
            expressions.push(cursor);
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
            expressions.extend_from_slice(&tag.expressions);
            for (key, value) in &tag.attributes {
                if let Some(name) = key.strip_prefix("let:") {
                    bindings.push(name);
                    if let Some(pattern) = value
                        .strip_prefix('{')
                        .and_then(|value| value.strip_suffix('}'))
                    {
                        identifier_words(pattern, &mut bindings);
                    }
                }
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
                if matches!(tag.name, "textarea" | "title") {
                    // Svelte evaluates brace expressions in these raw-text
                    // elements, unlike script and style content.
                    let mut inner = tag.end;
                    while let Some(offset) = source[inner..close.0].find('{') {
                        let start = inner + offset;
                        expressions.push(start);
                        match expression_end(source, start) {
                            Some(end) if end <= close.0 => inner = end,
                            _ => break,
                        }
                    }
                }
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
    Ok(Scan {
        scripts,
        expressions,
        bindings,
    })
}

/// Collects the names a markup brace expression binds; `text` is the content
/// between its braces. Arrow and function parameters go to `local`, visible
/// within the expression; block, snippet, and `@const` bindings go to `block`,
/// visible to the enclosed markup.
///
/// The reading is lexical, without a JavaScript parser: every identifier in a
/// binding pattern or parameter list counts as bound, including property keys,
/// defaults, and type annotations. That over-approximation only suppresses
/// reports, and it keeps the check small in the shipped binaries.
fn expression_bindings<'a>(text: &'a str, local: &mut Vec<&'a str>, block: &mut Vec<&'a str>) {
    let text = text.trim();
    if let Some(rest) = text.strip_prefix("#each") {
        let (iterable, pattern) = split_top_level_word(rest, "as");
        parameter_names(iterable, local);
        if let Some(pattern) = pattern {
            identifier_words(strip_each_key(pattern), block);
        }
    } else if let Some(rest) = text.strip_prefix("#snippet") {
        // The snippet name and its parameters.
        identifier_words(rest, block);
    } else if let Some(rest) = text.strip_prefix("#await") {
        let (promise, then) = split_top_level_word(rest, "then");
        let (promise, pattern) = match then {
            Some(pattern) => (promise, Some(pattern)),
            None => split_top_level_word(promise, "catch"),
        };
        parameter_names(promise, local);
        if let Some(pattern) = pattern {
            identifier_words(pattern, block);
        }
    } else if let Some(pattern) = text
        .strip_prefix(":then")
        .or_else(|| text.strip_prefix(":catch"))
    {
        identifier_words(pattern, block);
    } else if let Some(rest) = text.strip_prefix("@const") {
        let (pattern, value) = rest.split_once('=').unwrap_or((rest, ""));
        identifier_words(pattern, block);
        parameter_names(value, local);
    } else {
        parameter_names(text, local);
    }
}

/// Identifiers in the parameter lists of arrow functions and function
/// expressions in `text`.
fn parameter_names<'a>(text: &'a str, names: &mut Vec<&'a str>) {
    let mut search = 0;
    while let Some(offset) = text[search..].find("=>") {
        let arrow = search + offset;
        search = arrow + 2;
        let before = text[..arrow].trim_end();
        let parameters = if before.ends_with(')') {
            matching_open_paren(before).map_or("", |open| &before[open..])
        } else {
            let start = before
                .char_indices()
                .rev()
                .find(|(_, character)| !is_identifier_char(*character))
                .map_or(0, |(index, character)| index + character.len_utf8());
            &before[start..]
        };
        identifier_words(parameters, names);
    }
    let mut search = 0;
    while let Some(offset) = text[search..].find("function") {
        let after = &text[search + offset..];
        search += offset + "function".len();
        if let Some(open) = after.find('(') {
            let close = after[open..]
                .find(')')
                .map_or(after.len(), |end| open + end);
            identifier_words(&after[open..close], names);
        }
    }
}

fn is_identifier_char(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '$')
}

/// Appends every identifier-like word in `text` to `names`.
fn identifier_words<'a>(text: &'a str, names: &mut Vec<&'a str>) {
    let mut start = None;
    for (index, character) in text.char_indices() {
        if is_identifier_char(character) {
            start.get_or_insert(index);
        } else if let Some(word_start) = start.take() {
            push_word(text, word_start, index, names);
        }
    }
    if let Some(word_start) = start {
        push_word(text, word_start, text.len(), names);
    }
}

fn push_word<'a>(text: &'a str, start: usize, end: usize, names: &mut Vec<&'a str>) {
    if !text.as_bytes()[start].is_ascii_digit() {
        names.push(&text[start..end]);
    }
}

/// Splits `text` at the last occurrence of `word` outside brackets, strings,
/// and identifiers; the second part is `None` when the word is absent.
fn split_top_level_word<'a>(text: &'a str, word: &str) -> (&'a str, Option<&'a str>) {
    let bytes = text.as_bytes();
    let mut depth = 0_usize;
    let mut quote = None;
    let mut found = None;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(open) = quote {
            if byte == b'\\' {
                index += 1;
            } else if byte == open {
                quote = None;
            }
        } else {
            match byte {
                b'\'' | b'"' | b'`' => quote = Some(byte),
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => depth = depth.saturating_sub(1),
                _ if depth == 0
                    && bytes[index..].starts_with(word.as_bytes())
                    && !is_word_byte(bytes.get(index.wrapping_sub(1)).copied())
                    && !is_word_byte(bytes.get(index + word.len()).copied()) =>
                {
                    found = Some(index);
                }
                _ => {}
            }
        }
        index += 1;
    }
    match found {
        Some(index) => (&text[..index], Some(&text[index + word.len()..])),
        None => (text, None),
    }
}

fn is_word_byte(byte: Option<u8>) -> bool {
    byte.is_some_and(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || byte >= 0x80
    })
}

/// Drops the `(key)` expression that may end an `{#each}` binding list. A
/// binding pattern itself never ends with `)`.
fn strip_each_key(pattern: &str) -> &str {
    let trimmed = pattern.trim_end();
    if !trimmed.ends_with(')') {
        return trimmed;
    }
    matching_open_paren(trimmed).map_or(trimmed, |open| &trimmed[..open])
}

/// The index of the `(` that matches the `)` ending `text`.
fn matching_open_paren(text: &str) -> Option<usize> {
    let mut depth = 0_usize;
    for (index, byte) in text.bytes().enumerate().rev() {
        match byte {
            b')' => depth += 1,
            b'(' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

struct Tag<'a> {
    name: &'a str,
    end: usize,
    closing: bool,
    self_closing: bool,
    attributes: Vec<(&'a str, &'a str)>,
    /// Start offsets of brace expressions in attributes.
    expressions: Vec<usize>,
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
    let mut expressions = Vec::new();
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
                expressions,
            });
        }
        if bytes.get(cursor) == Some(&b'{') {
            expressions.push(cursor);
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
                            expressions.push(cursor);
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
                    expressions.push(cursor);
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
    expression_scan(source, start, &mut |_, _| {})
}

/// [`expression_end`] that also reports the byte range of each identifier-like
/// word outside strings, template text, comments, and regex literals.
fn expression_scan(
    source: &str,
    start: usize,
    on_word: &mut dyn FnMut(usize, usize),
) -> Option<usize> {
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
                            cursor = expression_scan(source, cursor + 1, on_word)?;
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
                on_word(word, cursor);
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
    use crate::{PalamedesError, extract_messages, transform_macros};

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

    fn markup_macro_error(source: &str) -> (String, String) {
        let extracted = extract_messages(source, "View.svelte").unwrap_err();
        let transformed = transform_macros(source, "View.svelte", None).unwrap_err();
        assert_eq!(extracted.to_string(), transformed.to_string());
        match transformed {
            PalamedesError::UnsupportedMacroSyntax {
                macro_name,
                location,
                detail,
            } => {
                assert!(detail.contains("Svelte markup"), "{detail}");
                (macro_name, location)
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn svelte_markup_macro_calls_fail_with_a_located_error() {
        let script = "<script>\nimport { t, plural } from '@palamedes/core/macro';\nlet name = 'Alex';\nlet count = 2;\n</script>\n";
        let template = format!("{script}<p>{{t`Inline ${{name}}`}}</p>");
        assert_eq!(
            markup_macro_error(&template),
            ("t".to_owned(), "View.svelte:6:5".to_owned())
        );
        let choice = format!(
            "{script}<p>{{count}}</p>\n<p>{{plural(count, {{ one: '# seat', other: '# seats' }})}}</p>"
        );
        assert_eq!(
            markup_macro_error(&choice),
            ("plural".to_owned(), "View.svelte:7:5".to_owned())
        );

        for (markup, macro_name) in [
            ("<input placeholder={text`Search`}>", "t"),
            ("<input placeholder=\"{text `Search`}\">", "t"),
            ("<Card {...count(1)} />", "plural"),
            ("{#if ok}<span>{@html text`Bold`}</span>{/if}", "t"),
            (
                "<svelte:head><title>{text`Title`}</title></svelte:head>",
                "t",
            ),
            ("<p>{`${count(1)}`}</p>", "plural"),
        ] {
            let source = format!(
                "<script module>import {{ plural as count }} from '@palamedes/core/macro';</script><script>import {{ t as text }} from '@palamedes/core/macro';</script>{markup}"
            );
            let (name, location) = markup_macro_error(&source);
            assert_eq!(name, macro_name, "{markup}");
            assert!(location.starts_with("View.svelte:1:"), "{location}");
        }
    }

    #[test]
    fn svelte_markup_bare_macro_references_fail_with_a_located_error() {
        let script = "<script>\nimport { t, plural } from '@palamedes/core/macro';\nimport { handler, fn } from './handlers';\nlet ok = true;\n</script>\n";
        for (markup, macro_name, column) in [
            ("<p>{handler(t)}</p>", "t", 13),
            ("<p>{fn(plural)}</p>", "plural", 8),
            ("<p>{ok ? t : null}</p>", "t", 10),
            ("<p>{[ok, t]}</p>", "t", 10),
            ("<p>{fn({ t })}</p>", "t", 10),
            ("<p>{fn({ ...plural })}</p>", "plural", 13),
            ("<Card {t} />", "t", 8),
            ("<button onclick={t}>x</button>", "t", 18),
            ("<p>{`${handler(t)}`}</p>", "t", 16),
        ] {
            let (name, location) = markup_macro_error(&format!("{script}{markup}"));
            assert_eq!(name, macro_name, "{markup}");
            assert_eq!(location, format!("View.svelte:6:{column}"), "{markup}");
            let error = transform_macros(&format!("{script}{markup}"), "View.svelte", None)
                .unwrap_err()
                .to_string();
            assert!(error.contains("ReferenceError"), "{markup}: {error}");
        }
    }

    #[test]
    fn svelte_markup_names_that_only_resemble_macros_keep_working() {
        let script = "<script>\nimport { t, plural } from '@palamedes/core/macro';\nimport { fn } from './handlers';\nconst { obj, tooltip, t2, tä, plurals } = $props();\nconst label = t`Label`;\n</script>\n";
        let markup = "<p>{obj.t} {obj?.plural} {obj . t} {tooltip} {t2} {tä} {plurals} {fn({ t: 1, plural: 2 })} {fn({ a: 1, t: 2 })} {'t'} {label}</p>";
        let source = format!("{script}{markup}");
        assert_eq!(
            extract_messages(&source, "View.svelte")
                .unwrap_or_else(|error| panic!("{error}"))
                .len(),
            1
        );
        assert_eq!(
            transform_macros(&source, "View.svelte", None)
                .unwrap_or_else(|error| panic!("{error}"))
                .compiled_ids
                .len(),
            1
        );
    }

    #[test]
    fn svelte_markup_without_macro_calls_keeps_working() {
        let source = r#"<script lang="ts">
import { t, plural } from '@palamedes/core/macro';
import { format } from './format';
const { count, store }: { count: number; store: { t(value: string): string } } = $props();
const title = $derived(t`Hello`);
const seats = $derived(plural(count, { one: '# seat', other: '# seats' }));
</script>
<h1 title="t`not code`">{title}</h1>
<p>{seats} {store.t('x')} {store?.plural(1)} {format(count)} {'t`text`'}</p>
<!-- {t`Comment`} -->
<style>p::before{content:'{t`style`}'}</style>"#;
        let messages = extract_messages(source, "View.svelte").unwrap();
        assert_eq!(messages.len(), 2);
        let result = transform_macros(source, "View.svelte", None).unwrap();
        assert_eq!(result.compiled_ids.len(), 2);
        assert!(!result.code.contains("@palamedes/core/macro"));

        // Only imported macro bindings count; a local `t` stays the author's.
        let local = "<script>import { t as text } from '@palamedes/core/macro'; const label = text`Label`; function t(value) { return value; }</script><p>{label} {t`Plain`}</p>";
        assert_eq!(extract_messages(local, "View.svelte").unwrap().len(), 1);
        assert_eq!(
            transform_macros(local, "View.svelte", None)
                .unwrap()
                .compiled_ids
                .len(),
            1
        );
    }

    #[test]
    fn svelte_markup_bindings_shadow_macro_imports() {
        let script = "<script>import { t } from '@palamedes/core/macro'; const label = t`Label`; let { items, promise } = $props();</script>";
        for markup in [
            "{#each items as t}{t(1)}{/each}",
            "{#each items as { t }, index (t.id)}{t(index)}{/each}",
            "{#each items as [first, t]}{t(first)}{/each}",
            "{#snippet row(t)}{t(1)}{/snippet}{@render row(String)}",
            "{#snippet t(value)}<b>{value}</b>{/snippet}{@render t(label)}",
            "<List {items} let:t>{t(1)}</List>",
            "<List {items} let:item={{ t }}>{t(1)}</List>",
            "{#await promise then t}{t(1)}{/await}",
            "{#await promise}wait{:then t}{t(1)}{:catch t}{t(2)}{/await}",
            "{#await promise catch t}{t(1)}{/await}",
            "{#each items as item}{@const t = (value) => value}{t(item)}{/each}",
            "{items.map((t) => t(1))}",
            "<button onclick={(t) => t(1)}>{label}</button>",
            "{items.map(function (t) { return t(1); })}",
        ] {
            let source = format!("{script}{markup}");
            assert_eq!(
                extract_messages(&source, "View.svelte")
                    .unwrap_or_else(|error| panic!("{markup}: {error}"))
                    .len(),
                1,
                "{markup}"
            );
            assert_eq!(
                transform_macros(&source, "View.svelte", None)
                    .unwrap_or_else(|error| panic!("{markup}: {error}"))
                    .compiled_ids
                    .len(),
                1,
                "{markup}"
            );
        }

        // An arrow parameter is local to its own expression, so a real macro
        // call in another expression is still reported.
        let (name, _) = markup_macro_error(&format!(
            "{script}{{items.map((t) => t(1))}}<p>{{t`Inline`}}</p>"
        ));
        assert_eq!(name, "t");
        // A shadowing name unrelated to the macro leaves the check intact.
        let (name, _) = markup_macro_error(&format!(
            "{script}{{#each items as item}}{{t(item)}}{{/each}}"
        ));
        assert_eq!(name, "t");
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
