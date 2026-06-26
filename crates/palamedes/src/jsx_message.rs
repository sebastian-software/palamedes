use crate::jsx_entities::decode_jsx_entities;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum JsxMessagePart {
    Text(String),
    ValuePlaceholder(String),
    ComponentPlaceholder(String),
    Message {
        value: String,
        ends_with_placeholder: bool,
    },
}

impl JsxMessagePart {
    fn as_str(&self) -> &str {
        match self {
            Self::Text(value)
            | Self::ValuePlaceholder(value)
            | Self::ComponentPlaceholder(value)
            | Self::Message { value, .. } => value,
        }
    }

    fn ends_with_placeholder(&self) -> bool {
        match self {
            Self::Text(_) => false,
            Self::ValuePlaceholder(_) | Self::ComponentPlaceholder(_) => true,
            Self::Message {
                ends_with_placeholder,
                ..
            } => *ends_with_placeholder,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JoinedJsxMessage {
    pub(crate) message: String,
    pub(crate) ends_with_placeholder: bool,
}

pub(crate) fn clean_jsx_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut last_was_whitespace = false;

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !last_was_whitespace {
                result.push(' ');
                last_was_whitespace = true;
            }
        } else {
            result.push(ch);
            last_was_whitespace = false;
        }
    }

    decode_jsx_entities(&result)
}

pub(crate) fn join_jsx_message_parts(parts: &[JsxMessagePart]) -> JoinedJsxMessage {
    let mut message = String::new();
    let mut ends_with_placeholder = false;

    for part in parts {
        push_jsx_message_part(&mut message, &mut ends_with_placeholder, part);
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
) {
    let part_value = part.as_str();

    if part_value.is_empty() {
        return;
    }

    let mut next = part_value;

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
}
