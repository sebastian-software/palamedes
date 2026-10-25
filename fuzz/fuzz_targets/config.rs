#![no_main]

// Compile the production private parser without turning it into a public SDK API.
#[allow(dead_code)]
#[path = "../../crates/palamedes-cli/src/config.rs"]
mod config;

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(source) = std::str::from_utf8(data) else {
        return;
    };
    let parsed = ::config::Config::builder()
        .add_source(::config::File::from_str(source, ::config::FileFormat::Yaml))
        .build()
        .and_then(::config::Config::try_deserialize::<serde_json::Value>);
    if let Ok(value) = parsed {
        let _ = config::parse_config_value(value, std::path::Path::new("fuzz.yaml"));
    }
});
