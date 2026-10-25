//! Pure plugin stdout decoding shared by the host and native fuzz targets.

use palamedes_plugin::Event as PluginEvent;
use serde_json::Value;
use std::io::{self, BufRead, Read};

/// Read at most one byte beyond the line limit so callers can reject it.
pub(crate) fn read_protocol_line(
    input: &mut impl BufRead,
    max_line_bytes: usize,
) -> (io::Result<usize>, Vec<u8>) {
    let mut line = Vec::new();
    let read =
        Read::take(input, max_line_bytes.saturating_add(1) as u64).read_until(b'\n', &mut line);
    (read, line)
}

pub(crate) fn parse_event(value: Value) -> Result<PluginEvent, String> {
    let kind = value
        .get("event")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "event lines must be objects with an \"event\" kind".to_owned())?;
    match kind.as_str() {
        "manifest" | "diagnostic" | "output" | "result" => {
            serde_json::from_value(value).map_err(|error| format!("invalid {kind} event: {error}"))
        }
        other => Err(format!("unknown event \"{other}\"")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_lines_at_the_production_limit_without_consuming_the_rest() {
        let limit = 1024 * 1024;
        let mut input = std::io::Cursor::new(vec![b'x'; limit + 20]);
        let (read, line) = read_protocol_line(&mut input, limit);
        assert_eq!(read.unwrap(), limit + 1);
        assert_eq!(line.len(), limit + 1);
        assert_eq!(input.position(), (limit + 1) as u64);
        let mut exact = std::io::Cursor::new(vec![b'x'; limit]);
        assert_eq!(read_protocol_line(&mut exact, limit).0.unwrap(), limit);
    }

    #[test]
    fn preserves_typed_event_and_unknown_kind_errors() {
        let output = parse_event(serde_json::json!({"event":"output", "text":"世界"})).unwrap();
        assert!(matches!(output, PluginEvent::Output { text } if text == "世界"));
        assert_eq!(
            parse_event(serde_json::json!({"event":"future"})).unwrap_err(),
            "unknown event \"future\""
        );
        assert!(
            parse_event(serde_json::json!({"event":"diagnostic", "severity": "future"}))
                .unwrap_err()
                .starts_with("invalid diagnostic event:")
        );
        assert_eq!(
            parse_event(Value::Null).unwrap_err(),
            "event lines must be objects with an \"event\" kind"
        );
    }
}
