const PLURAL_CATEGORIES: [&str; 6] = ["zero", "one", "two", "few", "many", "other"];
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

pub(crate) fn is_plural_format(format: &str) -> bool {
    matches!(format, "plural" | "selectordinal")
}

pub(crate) fn normalize_choice_option_key(format: &str, key: &str) -> Option<String> {
    if !is_plural_format(format) {
        return Some(key.to_string());
    }

    if PLURAL_CATEGORIES.contains(&key) {
        return Some(key.to_string());
    }

    let exact = key.strip_prefix('_').or_else(|| key.strip_prefix('='))?;
    is_non_negative_integer(exact).then(|| format!("={exact}"))
}

pub(crate) fn normalize_string_offset(value: &str) -> Option<String> {
    let value = value.trim();
    let parsed = value.parse::<u64>().ok()?;
    ((parsed as f64) <= MAX_SAFE_INTEGER).then(|| value.to_string())
}

pub(crate) fn normalize_numeric_offset(value: f64) -> Option<String> {
    (value.is_finite() && (0.0..=MAX_SAFE_INTEGER).contains(&value) && value.fract() == 0.0)
        .then(|| format!("{value:.0}"))
}

fn is_non_negative_integer(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::{normalize_choice_option_key, normalize_numeric_offset, normalize_string_offset};

    #[test]
    fn validates_plural_categories_and_exact_keys() {
        assert_eq!(
            normalize_choice_option_key("plural", "one").as_deref(),
            Some("one")
        );
        assert_eq!(
            normalize_choice_option_key("selectordinal", "_2").as_deref(),
            Some("=2")
        );
        assert_eq!(
            normalize_choice_option_key("plural", "=0").as_deref(),
            Some("=0")
        );
        assert_eq!(normalize_choice_option_key("plural", "invalid"), None);
        assert_eq!(
            normalize_choice_option_key("select", "invalid").as_deref(),
            Some("invalid")
        );
    }

    #[test]
    fn validates_static_offsets() {
        assert_eq!(normalize_string_offset(" 12 ").as_deref(), Some("12"));
        assert_eq!(normalize_string_offset("-1"), None);
        assert_eq!(normalize_string_offset("1.5"), None);
        assert_eq!(normalize_numeric_offset(1.0).as_deref(), Some("1"));
        assert_eq!(normalize_numeric_offset(-1.0), None);
        assert_eq!(normalize_numeric_offset(1.5), None);
    }
}
