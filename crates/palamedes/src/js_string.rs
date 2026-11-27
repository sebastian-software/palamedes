//! Safe JavaScript string-literal serialization for generated JS/TS modules.

/// Escapes characters in a JSON-serialized string so it is safe to embed
/// inside JavaScript modules and inline HTML `<script>` blocks.
pub(crate) fn escape_json_for_js(json: String) -> String {
    if !json.contains(['<', '>', '\u{2028}', '\u{2029}']) {
        return json;
    }

    let mut escaped = String::with_capacity(json.len() + 8);
    for ch in json.chars() {
        match ch {
            '<' => escaped.push_str("\\u003c"),
            '>' => escaped.push_str("\\u003e"),
            '\u{2028}' => escaped.push_str("\\u2028"),
            '\u{2029}' => escaped.push_str("\\u2029"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// Serializes a string as a JavaScript string literal safe for inline
/// `<script>` tags and pre-ES2019 line terminators.
pub(crate) fn render_js_string_literal(value: &str) -> String {
    let json = serde_json::to_string(value).expect("serializing a Rust string as JSON cannot fail");
    escape_json_for_js(json)
}
