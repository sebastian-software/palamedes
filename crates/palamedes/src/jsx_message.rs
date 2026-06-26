use crate::jsx_entities::decode_jsx_entities;

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

pub(crate) fn join_jsx_message_parts(parts: &[String]) -> String {
    let mut message = String::new();

    for part in parts {
        push_jsx_message_part(&mut message, part);
    }

    trim_message_edges(&message)
}

fn push_jsx_message_part(message: &mut String, part: &str) {
    if part.is_empty() {
        return;
    }

    let mut next = part;

    if !message.is_empty() {
        if message.ends_with(char::is_whitespace) && next.starts_with(char::is_whitespace) {
            next = next.trim_start_matches(char::is_whitespace);
        }

        if ends_with_message_placeholder(message) && starts_with_whitespace_then_punctuation(next) {
            next = next.trim_start_matches(char::is_whitespace);
        }
    }

    message.push_str(next);
}

fn trim_message_edges(message: &str) -> String {
    let trimmed_end = message.trim_end_matches(char::is_whitespace);
    let trimmed = trimmed_end.trim_start_matches(char::is_whitespace);

    if starts_with_leading_separator(trimmed) && trimmed_end.starts_with(char::is_whitespace) {
        return format!(" {trimmed}");
    }

    trimmed.to_string()
}

fn ends_with_message_placeholder(value: &str) -> bool {
    ends_with_component_placeholder(value) || ends_with_value_placeholder(value)
}

fn ends_with_component_placeholder(value: &str) -> bool {
    let Some(before_closing_angle) = value.strip_suffix('>') else {
        return false;
    };
    let Some(tag_start) = before_closing_angle.rfind("</") else {
        return false;
    };

    before_closing_angle[tag_start + 2..]
        .chars()
        .all(|ch| ch.is_ascii_digit())
}

fn ends_with_value_placeholder(value: &str) -> bool {
    let Some(before_closing_brace) = value.strip_suffix('}') else {
        return false;
    };
    let Some(placeholder_start) = before_closing_brace.rfind('{') else {
        return false;
    };

    is_placeholder_name(&before_closing_brace[placeholder_start + 1..])
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

fn is_placeholder_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first == '$' || first.is_ascii_alphabetic()) {
        return false;
    }

    chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::{clean_jsx_text, join_jsx_message_parts};

    #[test]
    fn trims_whitespace_before_punctuation_after_value_placeholders() {
        let parts = vec![
            "Tailored to your ".to_string(),
            "{volume}".to_string(),
            " MWh in ".to_string(),
            "{countryName}".to_string(),
            " .".to_string(),
        ];

        assert_eq!(
            join_jsx_message_parts(&parts),
            "Tailored to your {volume} MWh in {countryName}."
        );
    }

    #[test]
    fn preserves_leading_separator_spacing() {
        assert_eq!(
            join_jsx_message_parts(&[" · $".to_string(), "{priceFormatted}/MWh".to_string()]),
            " · ${priceFormatted}/MWh"
        );
        assert_eq!(
            join_jsx_message_parts(&[" — no manager".to_string()]),
            " — no manager"
        );
    }

    #[test]
    fn still_trims_indentation_before_normal_text() {
        assert_eq!(join_jsx_message_parts(&[" Hello".to_string()]), "Hello");
    }

    #[test]
    fn decodes_jsx_entities_after_collapsing_whitespace() {
        assert_eq!(clean_jsx_text("Green-e&reg;\n applies"), "Green-e® applies");
    }
}
