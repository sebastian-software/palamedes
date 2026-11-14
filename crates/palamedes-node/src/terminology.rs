use napi::{Error, Result, Status};
use napi_derive::napi;

use crate::shared::checked_u32;

#[napi(string_enum = "lowercase")]
pub enum TerminologyKind {
    Protected,
    Advisory,
}

impl From<TerminologyKind> for palamedes::TerminologyKind {
    fn from(value: TerminologyKind) -> Self {
        match value {
            TerminologyKind::Protected => Self::Protected,
            TerminologyKind::Advisory => Self::Advisory,
        }
    }
}

impl From<palamedes::TerminologyKind> for TerminologyKind {
    fn from(value: palamedes::TerminologyKind) -> Self {
        match value {
            palamedes::TerminologyKind::Protected => Self::Protected,
            palamedes::TerminologyKind::Advisory => Self::Advisory,
        }
    }
}

#[napi(object)]
pub struct TerminologyEntry {
    pub id: String,
    pub source: String,
    pub kind: TerminologyKind,
    pub preferred_target: Option<String>,
    pub note: Option<String>,
}

#[napi(object)]
pub struct TerminologyRequest {
    pub message: String,
    pub entries: Vec<TerminologyEntry>,
}

#[napi(object)]
pub struct TerminologyMatch {
    pub entry_id: String,
    pub kind: TerminologyKind,
    pub literal_path: Vec<u32>,
    pub literal: String,
    pub start: u32,
    pub end: u32,
    pub preferred: bool,
}

#[napi(catch_unwind)]
/// Matches caller-supplied phrases only within decoded native ICU literals.
/// Ranges are UTF-8 bytes within `literal`, not raw ICU or JavaScript offsets.
///
/// # Errors
///
/// Rejects invalid entries, malformed ICU, or coordinates outside the Node shape.
pub fn match_terminology(request: TerminologyRequest) -> Result<Vec<TerminologyMatch>> {
    let request = palamedes::TerminologyRequest {
        message: request.message,
        entries: request
            .entries
            .into_iter()
            .map(|entry| palamedes::TerminologyEntry {
                id: entry.id,
                source: entry.source,
                kind: entry.kind.into(),
                preferred_target: entry.preferred_target,
                note: entry.note,
            })
            .collect(),
    };
    palamedes::match_terminology(&request)
        .map_err(|error| Error::new(Status::InvalidArg, error.to_string()))?
        .into_iter()
        .map(|matched| {
            Ok(TerminologyMatch {
                entry_id: matched.entry_id,
                kind: matched.kind.into(),
                literal_path: matched
                    .literal_path
                    .into_iter()
                    .map(|index| checked_u32(index, "literalPath index"))
                    .collect::<Result<_>>()?,
                literal: matched.literal,
                start: checked_u32(matched.start, "start")?,
                end: checked_u32(matched.end, "end")?,
                preferred: matched.preferred,
            })
        })
        .collect()
}
