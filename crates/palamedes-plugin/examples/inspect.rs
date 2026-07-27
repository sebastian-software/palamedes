//! A minimal binary plugin exposing `pmds acme inspect`.
//!
//! Point a `package.json` at the built binary to try it in a project:
//!
//! ```json
//! { "name": "acme-plugin", "palamedes": { "pluginBinary": "./inspect" } }
//! ```

use palamedes_plugin::{CommandResult, Plugin};
use serde_json::json;

fn main() -> std::process::ExitCode {
    Plugin::new("acme")
        .command("inspect", "Inspect configured catalogs.", |context| {
            context.info(
                "ACME_INSPECTED",
                format!(
                    "Inspected {} catalog definitions.",
                    context.catalogs().len()
                ),
            );
            context.output("inspecting");
            CommandResult::default().with_text("done").with_data(json!({
                "args": context.args(),
                "locales": context
                    .catalogs()
                    .iter()
                    .flat_map(|catalog| &catalog.locales)
                    .map(|entry| entry.locale.as_str())
                    .collect::<Vec<_>>(),
                "native": context.native_executable(),
            }))
        })
        .run()
}
