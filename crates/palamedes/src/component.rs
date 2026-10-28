//! Script projections shared by component extraction and transformation.

use crate::PalamedesResult;
use oxc_span::SourceType;
use std::borrow::Cow;
use std::ops::Range;

pub(crate) struct ScriptBlock {
    pub range: Range<usize>,
    pub source_type: SourceType,
    pub instance: bool,
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

pub(crate) fn is_component(filename: &str) -> bool {
    crate::vue::is_vue(filename) || crate::svelte::is_svelte(filename)
}

pub(crate) fn script_blocks(source: &str, filename: &str) -> PalamedesResult<Vec<ScriptBlock>> {
    if crate::vue::is_vue(filename) {
        crate::vue::script_blocks(source, filename)
    } else {
        crate::svelte::script_blocks(source, filename)
    }
}

/// Reject macro calls in component markup, which no transform rewrites.
pub(crate) fn reject_markup_macro_uses(source: &str, filename: &str) -> PalamedesResult<()> {
    if crate::svelte::is_svelte(filename) {
        crate::svelte::reject_markup_macro_uses(source, filename)
    } else {
        Ok(())
    }
}
