#![no_main]

#[path = "../../crates/palamedes-cli/src/plugin_protocol.rs"]
mod plugin_protocol;

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Deserialization never dispatches the request or executes a plugin.
    let _ = serde_json::from_slice::<palamedes_plugin::Request>(data);
    let mut input = std::io::Cursor::new(data);
    loop {
        let (read, line) = plugin_protocol::read_protocol_line(&mut input, 1024 * 1024);
        if !matches!(read, Ok(count) if count > 0) || line.len() > 1024 * 1024 {
            break;
        }
        if let Ok(line) = std::str::from_utf8(&line) {
            if let Ok(value) = serde_json::from_str(line.trim_end_matches(['\r', '\n'])) {
                let _ = plugin_protocol::parse_event(value);
            }
        }
    }
});
