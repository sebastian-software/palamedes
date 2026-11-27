#![no_main]

use std::collections::BTreeMap;

use ferrocat::ParseCatalogOptions;
use libfuzzer_sys::fuzz_target;
use palamedes::{
    CatalogCombineInput, CatalogCombineRequest, CatalogCombineSelection, CatalogConflictStrategy,
    CatalogThreeWayMergeRequest, PalamedesCatalogFormat,
};

const MAX_INPUT_BYTES: usize = 16 * 1024;
const MAX_DIRECT_MESSAGES: usize = 16;

fn split_three(input: &str) -> (&str, &str, &str) {
    let mut parts = input.splitn(3, "\n---\n");
    let first = parts.next().unwrap_or("");
    let second = parts.next().unwrap_or(first);
    let third = parts.next().unwrap_or(second);
    (first, second, third)
}

fn direct_messages(input: &str) -> BTreeMap<String, String> {
    let mut messages = BTreeMap::new();
    messages.insert("raw".to_owned(), input.to_owned());
    for (index, line) in input.lines().take(MAX_DIRECT_MESSAGES).enumerate() {
        let (key, value) = match line.split_once('=') {
            Some((key, value)) if !key.is_empty() => (key.to_owned(), value.to_owned()),
            _ => (format!("m{index}"), line.to_owned()),
        };
        messages.insert(key, value);
    }
    messages
}

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_INPUT_BYTES {
        return;
    }
    let Some((selector, rest)) = data.split_first() else {
        return;
    };
    let Ok(input) = std::str::from_utf8(rest) else {
        return;
    };

    let (first, second, third) = split_three(input);

    // Direct ICU compilation and JS module rendering over raw and line-split patterns.
    let messages = direct_messages(first);
    let _ = palamedes::compile_runtime_catalog_messages(&messages);
    let _ = palamedes::render_catalog_module(&messages, "de", "locales/de.po");

    // PO and FCL catalog parsing for compilation.
    let po_options = ParseCatalogOptions::new(first, "en")
        .with_locale("de")
        .with_mode(PalamedesCatalogFormat::Po.ferrocat_mode());
    let _ = palamedes::parse_catalog_for_compile(po_options);

    let fcl_options = ParseCatalogOptions::new(first, "en")
        .with_locale("de")
        .with_mode(PalamedesCatalogFormat::Fcl.ferrocat_mode());
    let _ = palamedes::parse_catalog_for_compile(fcl_options);

    // SDK PO parse + compile + runtime compilation + JS module rendering pipeline.
    if let Ok(source_catalog) = palamedes::sdk::parse_catalog(first, "en", "en") {
        if let Ok(compiled) = palamedes::sdk::compile_catalog(&[&source_catalog], "en", "en", &[]) {
            let _ = palamedes::compile_runtime_catalog_messages(&compiled.messages);
            let _ = palamedes::render_catalog_module(&compiled.messages, "en", "locales/en.po");
        }
        if let Ok(target_catalog) = palamedes::sdk::parse_catalog(second, "de", "en")
            && let Ok(compiled) = palamedes::sdk::compile_catalog(
                &[&source_catalog, &target_catalog],
                "de",
                "en",
                &[],
            )
        {
            let _ = palamedes::compile_runtime_catalog_messages(&compiled.messages);
            let _ = palamedes::render_catalog_module(&compiled.messages, "de", "locales/de.po");
        }
    }

    // Format conversion between PO and FCL.
    let (source_format, target_format) = if selector & 1 == 0 {
        (PalamedesCatalogFormat::Po, PalamedesCatalogFormat::Fcl)
    } else {
        (PalamedesCatalogFormat::Fcl, PalamedesCatalogFormat::Po)
    };
    let _ =
        palamedes::convert_catalog_content(first, source_format, target_format, "en", Some("de"));

    let conflict_strategy = match (selector >> 1) % 3 {
        0 => CatalogConflictStrategy::UseFirst,
        1 => CatalogConflictStrategy::UseLast,
        _ => CatalogConflictStrategy::Error,
    };
    let selection = if selector & 8 == 0 {
        CatalogCombineSelection::All
    } else {
        CatalogCombineSelection::Unique
    };

    // Multi-catalog combine (PO).
    let _ = palamedes::combine_catalogs(CatalogCombineRequest {
        inputs: vec![
            CatalogCombineInput {
                content: first.to_owned(),
                label: Some("first".to_owned()),
            },
            CatalogCombineInput {
                content: second.to_owned(),
                label: Some("second".to_owned()),
            },
        ],
        source_locale: "en".to_owned(),
        locale: Some("de".to_owned()),
        conflict_strategy,
        selection,
        include_obsolete: selector & 16 != 0,
    });

    // Three-way merge (PO or FCL).
    let _ = palamedes::merge_catalogs_three_way(CatalogThreeWayMergeRequest {
        ancestor: CatalogCombineInput {
            content: first.to_owned(),
            label: Some("ancestor".to_owned()),
        },
        ours: CatalogCombineInput {
            content: second.to_owned(),
            label: Some("ours".to_owned()),
        },
        theirs: CatalogCombineInput {
            content: third.to_owned(),
            label: Some("theirs".to_owned()),
        },
        format: source_format,
        source_locale: "en".to_owned(),
        locale: Some("de".to_owned()),
        conflict_strategy,
        po: None,
    });
});
