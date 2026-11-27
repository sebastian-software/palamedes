#![no_main]

// Compile the production private parser without turning it into a public SDK API.
#[allow(dead_code)]
#[path = "../../crates/palamedes-cli/src/config.rs"]
mod config;

use libfuzzer_sys::fuzz_target;

const MAX_INPUT_BYTES: usize = 32 * 1024;

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_INPUT_BYTES {
        return;
    }
    let Some((selector, rest)) = data.split_first() else {
        return;
    };
    let Ok(source) = std::str::from_utf8(rest) else {
        return;
    };

    let (format, filename) = match selector % 3 {
        0 => (::config::FileFormat::Yaml, "fuzz.yaml"),
        1 => (::config::FileFormat::Json, "fuzz.json"),
        _ => (::config::FileFormat::Toml, "fuzz.toml"),
    };

    let parsed = ::config::Config::builder()
        .add_source(::config::File::from_str(source, format))
        .build()
        .and_then(::config::Config::try_deserialize::<serde_json::Value>);
    if let Ok(value) = parsed {
        let _ = config::parse_config_value(value, std::path::Path::new(filename));
    }
});
