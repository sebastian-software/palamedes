#![no_main]

use libfuzzer_sys::fuzz_target;
use palamedes::{MdxFramework, MdxOptions, NativeTransformOptions, ServerFunctionTransformOptions};

const MAX_INPUT_BYTES: usize = 32 * 1024;

fn rich_transform_options() -> NativeTransformOptions {
    NativeTransformOptions {
        runtime_module: Some("@palamedes/runtime".to_owned()),
        runtime_import_name: Some("getI18n".to_owned()),
        strip_non_essential_props: Some(true),
        include_source_metadata: Some(true),
        source_map: Some(true),
        server_functions: Some(ServerFunctionTransformOptions {
            initializer_module: "./i18n/server".to_owned(),
            initializer_export: "initServerI18n".to_owned(),
        }),
    }
}

fn solid_mdx_options() -> MdxOptions {
    MdxOptions {
        framework: MdxFramework::Solid,
        translatable_attributes: vec![
            "alt".to_owned(),
            "title".to_owned(),
            "aria-label".to_owned(),
        ],
        front_matter_fields: vec!["title".to_owned(), "description".to_owned()],
        include_source_metadata: true,
        ..MdxOptions::default()
    }
}

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_INPUT_BYTES {
        return;
    }
    let Ok(source) = std::str::from_utf8(data) else {
        return;
    };

    let rich_options = rich_transform_options();
    for filename in ["fuzz.ts", "fuzz.tsx", "fuzz.vue", "fuzz.svelte"] {
        let _ = palamedes::analyze_source(source, filename);
        let _ = palamedes::extract_messages(source, filename);
        let _ = palamedes::transform_macros(source, filename, None);
        let _ = palamedes::transform_macros(source, filename, Some(rich_options.clone()));
    }

    let _ = palamedes::analyze_source(source, "fuzz.mdx");
    let _ = palamedes::extract_messages(source, "fuzz.mdx");

    let mdx_options = solid_mdx_options();
    let _ = palamedes::analyze_source_with_mdx_options(source, "fuzz.mdx", &mdx_options);
    let _ = palamedes::extract_messages_with_mdx_options(source, "fuzz.mdx", &mdx_options);
});
