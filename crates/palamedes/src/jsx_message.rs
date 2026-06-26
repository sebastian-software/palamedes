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

    message.trim().to_string()
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

        if ends_with_component_placeholder(message) && starts_with_whitespace_then_punctuation(next)
        {
            next = next.trim_start_matches(char::is_whitespace);
        }
    }

    message.push_str(next);
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
