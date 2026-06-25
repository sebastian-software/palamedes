pub(crate) fn decode_jsx_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_owned();
    }

    let mut decoded = String::with_capacity(input.len());
    let mut index = 0;

    while index < input.len() {
        let Some(ch) = input[index..].chars().next() else {
            break;
        };

        if ch != '&' {
            decoded.push(ch);
            index += ch.len_utf8();
            continue;
        }

        let entity_start = index + ch.len_utf8();
        let mut entity_end = None;
        let mut candidate_is_valid = true;
        for (offset, entity_ch) in input[entity_start..].char_indices() {
            if entity_ch == ';' {
                entity_end = Some(entity_start + offset);
                break;
            }
            if !is_entity_candidate_char(entity_ch) {
                candidate_is_valid = false;
                break;
            }
        }

        let Some(entity_end) = entity_end else {
            decoded.push(ch);
            index += ch.len_utf8();
            continue;
        };

        if !candidate_is_valid || entity_end == entity_start {
            decoded.push(ch);
            index += ch.len_utf8();
            continue;
        }

        let entity = &input[entity_start..entity_end];
        if let Some(decoded_entity) = decode_entity(entity) {
            decoded.push(decoded_entity);
        } else {
            decoded.push_str(&input[index..=entity_end]);
        }
        index = entity_end + 1;
    }

    decoded
}

fn is_entity_candidate_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '#'
}

fn decode_entity(entity: &str) -> Option<char> {
    if let Some(hex) = entity
        .strip_prefix("#x")
        .or_else(|| entity.strip_prefix("#X"))
    {
        return decode_numeric_entity(hex, 16);
    }

    if let Some(decimal) = entity.strip_prefix('#') {
        return decode_numeric_entity(decimal, 10);
    }

    decode_named_entity(entity)
}

fn decode_numeric_entity(value: &str, radix: u32) -> Option<char> {
    u32::from_str_radix(value, radix)
        .ok()
        .and_then(char::from_u32)
}

fn decode_named_entity(entity: &str) -> Option<char> {
    match entity {
        "AElig" => Some('Æ'),
        "Aacute" => Some('Á'),
        "Acirc" => Some('Â'),
        "Agrave" => Some('À'),
        "Aring" => Some('Å'),
        "Atilde" => Some('Ã'),
        "Auml" => Some('Ä'),
        "Ccedil" => Some('Ç'),
        "ETH" => Some('Ð'),
        "Eacute" => Some('É'),
        "Ecirc" => Some('Ê'),
        "Egrave" => Some('È'),
        "Euml" => Some('Ë'),
        "Iacute" => Some('Í'),
        "Icirc" => Some('Î'),
        "Igrave" => Some('Ì'),
        "Iuml" => Some('Ï'),
        "Ntilde" => Some('Ñ'),
        "Oacute" => Some('Ó'),
        "Ocirc" => Some('Ô'),
        "Ograve" => Some('Ò'),
        "Oslash" => Some('Ø'),
        "Otilde" => Some('Õ'),
        "Ouml" => Some('Ö'),
        "THORN" => Some('Þ'),
        "Uacute" => Some('Ú'),
        "Ucirc" => Some('Û'),
        "Ugrave" => Some('Ù'),
        "Uuml" => Some('Ü'),
        "Yacute" => Some('Ý'),
        "aacute" => Some('á'),
        "acirc" => Some('â'),
        "acute" => Some('´'),
        "aelig" => Some('æ'),
        "agrave" => Some('à'),
        "amp" => Some('&'),
        "apos" => Some('\''),
        "aring" => Some('å'),
        "atilde" => Some('ã'),
        "auml" => Some('ä'),
        "brvbar" => Some('¦'),
        "ccedil" => Some('ç'),
        "cedil" => Some('¸'),
        "cent" => Some('¢'),
        "copy" => Some('©'),
        "curren" => Some('¤'),
        "deg" => Some('°'),
        "divide" => Some('÷'),
        "euro" => Some('€'),
        "eacute" => Some('é'),
        "ecirc" => Some('ê'),
        "egrave" => Some('è'),
        "eth" => Some('ð'),
        "euml" => Some('ë'),
        "frac12" => Some('½'),
        "frac14" => Some('¼'),
        "frac34" => Some('¾'),
        "gt" => Some('>'),
        "iacute" => Some('í'),
        "icirc" => Some('î'),
        "iexcl" => Some('¡'),
        "igrave" => Some('ì'),
        "iquest" => Some('¿'),
        "iuml" => Some('ï'),
        "laquo" => Some('«'),
        "ldquo" => Some('“'),
        "lsaquo" => Some('‹'),
        "lsquo" => Some('‘'),
        "lt" => Some('<'),
        "macr" => Some('¯'),
        "mdash" => Some('—'),
        "micro" => Some('µ'),
        "middot" => Some('·'),
        "nbsp" => Some('\u{00a0}'),
        "ndash" => Some('–'),
        "not" => Some('¬'),
        "ntilde" => Some('ñ'),
        "oacute" => Some('ó'),
        "ocirc" => Some('ô'),
        "ograve" => Some('ò'),
        "ordf" => Some('ª'),
        "ordm" => Some('º'),
        "oslash" => Some('ø'),
        "otilde" => Some('õ'),
        "ouml" => Some('ö'),
        "para" => Some('¶'),
        "plusmn" => Some('±'),
        "pound" => Some('£'),
        "quot" => Some('"'),
        "raquo" => Some('»'),
        "reg" => Some('®'),
        "rdquo" => Some('”'),
        "rsaquo" => Some('›'),
        "rsquo" => Some('’'),
        "sect" => Some('§'),
        "shy" => Some('\u{00ad}'),
        "sup1" => Some('¹'),
        "sup2" => Some('²'),
        "sup3" => Some('³'),
        "szlig" => Some('ß'),
        "thorn" => Some('þ'),
        "times" => Some('×'),
        "trade" => Some('™'),
        "uacute" => Some('ú'),
        "ucirc" => Some('û'),
        "ugrave" => Some('ù'),
        "uml" => Some('¨'),
        "uuml" => Some('ü'),
        "yacute" => Some('ý'),
        "yen" => Some('¥'),
        "yuml" => Some('ÿ'),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::decode_jsx_entities;

    #[test]
    fn decodes_named_and_numeric_entities() {
        assert_eq!(
            decode_jsx_entities("Green-e&reg; &amp; Canada &#34;ok&#x22; &rsquo; &mdash;"),
            "Green-e® & Canada \"ok\" ’ —"
        );
    }

    #[test]
    fn leaves_unknown_or_unfinished_entities_unchanged() {
        assert_eq!(
            decode_jsx_entities("R&D &custom; &amp"),
            "R&D &custom; &amp"
        );
    }

    #[test]
    fn raw_ampersands_do_not_hide_later_entities() {
        assert_eq!(decode_jsx_entities("R&D &amp; review"), "R&D & review");
    }
}
