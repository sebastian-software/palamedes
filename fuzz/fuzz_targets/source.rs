#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(source) = std::str::from_utf8(data) else {
        return;
    };
    // Each mutation reaches all three native parser modes, including diagnostics.
    for filename in ["fuzz.ts", "fuzz.tsx", "fuzz.mdx"] {
        let _ = palamedes::analyze_source(source, filename);
        let _ = palamedes::extract_messages(source, filename);
    }
});
