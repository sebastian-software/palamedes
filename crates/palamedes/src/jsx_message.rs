use crate::jsx_entities::decode_jsx_entities;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum JsxMessagePart {
    Text(String),
    ValuePlaceholder(String),
    ComponentPlaceholder {
        value: String,
        is_empty: bool,
    },
    Message {
        value: String,
        ends_with_placeholder: bool,
    },
}

impl JsxMessagePart {
    fn as_str(&self) -> &str {
        match self {
            Self::Text(value) | Self::ValuePlaceholder(value) | Self::Message { value, .. } => {
                value
            }
            Self::ComponentPlaceholder { value, .. } => value,
        }
    }

    fn ends_with_placeholder(&self) -> bool {
        match self {
            Self::Text(_) => false,
            Self::ValuePlaceholder(_) | Self::ComponentPlaceholder { .. } => true,
            Self::Message {
                ends_with_placeholder,
                ..
            } => *ends_with_placeholder,
        }
    }

    fn is_empty_component_placeholder(&self) -> bool {
        matches!(self, Self::ComponentPlaceholder { is_empty: true, .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JoinedJsxMessage {
    pub(crate) message: String,
    pub(crate) ends_with_placeholder: bool,
}

pub(crate) fn clean_jsx_text(text: &str) -> String {
    // Mirror Babel's `cleanJSXElementLiteralChild`, which Lingui relies on:
    // whitespace touching a line break is dropped, lines are trimmed, and the
    // remaining lines are joined with a single space. This keeps message ids
    // stable across transformers and avoids stray spaces around expression
    // boundaries (e.g. `{value}` followed by `%` on the next line).
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let last_non_empty_line = lines
        .iter()
        .rposition(|line| line.contains(|ch: char| ch != ' ' && ch != '\t'))
        .unwrap_or(0);

    let mut result = String::with_capacity(text.len());

    for (index, line) in lines.iter().enumerate() {
        let is_first_line = index == 0;
        let is_last_line = index == lines.len() - 1;

        let mut trimmed = line.replace('\t', " ");
        if !is_first_line {
            trimmed = trimmed.trim_start_matches(' ').to_string();
        }
        if !is_last_line {
            trimmed = trimmed.trim_end_matches(' ').to_string();
        }

        if trimmed.is_empty() {
            continue;
        }

        result.push_str(&trimmed);
        if index != last_non_empty_line {
            result.push(' ');
        }
    }

    decode_jsx_entities(&result)
}

pub(crate) fn join_jsx_message_parts(parts: &[JsxMessagePart]) -> JoinedJsxMessage {
    let mut message = String::new();
    let mut ends_with_placeholder = false;

    for (index, part) in parts.iter().enumerate() {
        push_jsx_message_part(
            &mut message,
            &mut ends_with_placeholder,
            part,
            should_trim_before_empty_component_placeholder(part, &parts[index + 1..]),
        );
    }

    JoinedJsxMessage {
        message: trim_message_edges(&message),
        ends_with_placeholder,
    }
}

fn push_jsx_message_part(
    message: &mut String,
    ends_with_placeholder: &mut bool,
    part: &JsxMessagePart,
    trim_before_empty_component_placeholder: bool,
) {
    let part_value = part.as_str();

    if part_value.is_empty() {
        return;
    }

    let mut next = part_value;

    if trim_before_empty_component_placeholder {
        let trimmed_len = message.trim_end_matches(char::is_whitespace).len();
        message.truncate(trimmed_len);
    }

    if !message.is_empty() {
        if message.ends_with(char::is_whitespace) && next.starts_with(char::is_whitespace) {
            next = next.trim_start_matches(char::is_whitespace);
        }

        if *ends_with_placeholder && starts_with_whitespace_then_punctuation(next) {
            next = next.trim_start_matches(char::is_whitespace);
        }
    }

    message.push_str(next);

    if !next.trim_end_matches(char::is_whitespace).is_empty() {
        *ends_with_placeholder = part.ends_with_placeholder();
    }
}

fn should_trim_before_empty_component_placeholder(
    part: &JsxMessagePart,
    remaining: &[JsxMessagePart],
) -> bool {
    // Lingui emits terminal empty rich children compactly (`Text<0/>`), but
    // keeping spaces before followed-by-text placeholders avoids word joins.
    part.is_empty_component_placeholder()
        && remaining.iter().all(|part| part.as_str().trim().is_empty())
}

fn trim_message_edges(message: &str) -> String {
    let trimmed_end = message.trim_end_matches(char::is_whitespace);
    let trimmed = trimmed_end.trim_start_matches(char::is_whitespace);

    if starts_with_leading_separator(trimmed) && trimmed_end.starts_with(char::is_whitespace) {
        return format!(" {trimmed}");
    }

    trimmed.to_string()
}

fn starts_with_whitespace_then_punctuation(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };

    if !first.is_whitespace() {
        return false;
    }

    chars
        .find(|ch| !ch.is_whitespace())
        .is_some_and(is_message_punctuation)
}

fn is_message_punctuation(ch: char) -> bool {
    matches!(ch, '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '}')
}

fn starts_with_leading_separator(value: &str) -> bool {
    value
        .chars()
        .next()
        .is_some_and(|ch| matches!(ch, '·' | '—'))
}

#[cfg(test)]
mod tests {
    use super::{clean_jsx_text, join_jsx_message_parts, JsxMessagePart};

    #[test]
    fn trims_whitespace_before_punctuation_after_value_placeholders() {
        let parts = vec![
            JsxMessagePart::Text("Tailored to your ".to_string()),
            JsxMessagePart::ValuePlaceholder("{volume}".to_string()),
            JsxMessagePart::Text(" MWh in ".to_string()),
            JsxMessagePart::ValuePlaceholder("{countryName}".to_string()),
            JsxMessagePart::Text(" .".to_string()),
        ];

        assert_eq!(
            join_jsx_message_parts(&parts).message,
            "Tailored to your {volume} MWh in {countryName}."
        );
    }

    #[test]
    fn preserves_whitespace_before_punctuation_after_literal_brace_text() {
        let parts = vec![
            JsxMessagePart::Text("{name}".to_string()),
            JsxMessagePart::Text(" .".to_string()),
        ];

        assert_eq!(join_jsx_message_parts(&parts).message, "{name} .");
    }

    #[test]
    fn preserves_leading_separator_spacing() {
        assert_eq!(
            join_jsx_message_parts(&[
                JsxMessagePart::Text(" · $".to_string()),
                JsxMessagePart::ValuePlaceholder("{priceFormatted}".to_string()),
                JsxMessagePart::Text("/MWh".to_string())
            ])
            .message,
            " · ${priceFormatted}/MWh"
        );
        assert_eq!(
            join_jsx_message_parts(&[JsxMessagePart::Text(" — no manager".to_string())]).message,
            " — no manager"
        );
    }

    #[test]
    fn uses_self_closing_empty_component_placeholders() {
        assert_eq!(
            join_jsx_message_parts(&[
                JsxMessagePart::Text("Commercial Terms ".to_string()),
                JsxMessagePart::ComponentPlaceholder {
                    value: "<0/>".to_string(),
                    is_empty: true,
                },
            ])
            .message,
            "Commercial Terms<0/>"
        );
    }

    #[test]
    fn preserves_inline_space_around_empty_component_placeholders_with_trailing_text() {
        assert_eq!(
            join_jsx_message_parts(&[
                JsxMessagePart::Text("Foo ".to_string()),
                JsxMessagePart::ComponentPlaceholder {
                    value: "<0/>".to_string(),
                    is_empty: true,
                },
                JsxMessagePart::Text(" bar".to_string()),
            ])
            .message,
            "Foo <0/> bar"
        );
    }

    #[test]
    fn still_trims_indentation_before_normal_text() {
        assert_eq!(
            join_jsx_message_parts(&[JsxMessagePart::Text(" Hello".to_string())]).message,
            "Hello"
        );
    }

    #[test]
    fn decodes_jsx_entities_after_collapsing_whitespace() {
        assert_eq!(clean_jsx_text("Green-e&reg;\n applies"), "Green-e® applies");
    }

    #[test]
    fn drops_line_break_whitespace_before_trailing_text() {
        // `{value}` then a newline before `%` must not introduce a space.
        assert_eq!(clean_jsx_text("\n  %\n"), "%");
        assert_eq!(
            clean_jsx_text("\n  's sustainability program.\n"),
            "'s sustainability program."
        );
    }

    #[test]
    fn keeps_trailing_space_on_text_line() {
        assert_eq!(clean_jsx_text("\n  Match Score: "), "Match Score: ");
    }

    #[test]
    fn drops_trailing_indent_after_open_paren() {
        // `{location} (` newline `{period}` must collapse to `{location} ({period}`.
        assert_eq!(clean_jsx_text(" (\n  "), " (");
    }

    #[test]
    fn joins_multiline_text_with_single_space() {
        assert_eq!(clean_jsx_text("\n  Hello\n  world\n"), "Hello world");
    }
}
