//! Script projections shared by component extraction and transformation.

use crate::PalamedesResult;
use oxc_span::SourceType;
use std::borrow::Cow;
use std::collections::HashMap;
use std::ops::Range;

pub(crate) struct ScriptBlock {
    pub range: Range<usize>,
    pub source_type: SourceType,
    pub instance: bool,
}

/// Keep the host scan alive while its scripts are analyzed, so markup
/// validation can reuse both the scan and the collected macro imports.
pub(crate) enum ComponentScan<'a> {
    Vue(crate::vue::Scan),
    Svelte(crate::svelte::Scan<'a>),
}

impl ComponentScan<'_> {
    pub(crate) fn scripts(&self) -> &[ScriptBlock] {
        match self {
            Self::Vue(scan) => &scan.scripts,
            Self::Svelte(scan) => &scan.scripts,
        }
    }

    pub(crate) fn exposes_script(&self, script: &ScriptBlock) -> bool {
        matches!(self, Self::Svelte(_)) || script.instance
    }

    pub(crate) fn reject_markup_macro_uses(
        self,
        source: &str,
        filename: &str,
        macros: &HashMap<String, String>,
    ) -> PalamedesResult<()> {
        if macros.is_empty() || !source.contains("/macro") {
            return Ok(());
        }
        match self {
            Self::Vue(scan) => crate::vue::reject_markup_macro_uses(source, filename, scan, macros),
            Self::Svelte(scan) => {
                crate::svelte::reject_markup_macro_uses(source, filename, scan, macros)
            }
        }
    }
}

pub(crate) fn scan<'a>(source: &'a str, filename: &str) -> PalamedesResult<ComponentScan<'a>> {
    if crate::vue::is_vue(filename) {
        crate::vue::scan(source, filename).map(ComponentScan::Vue)
    } else {
        crate::svelte::scan(source, filename).map(ComponentScan::Svelte)
    }
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
