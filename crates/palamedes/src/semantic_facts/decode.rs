#![allow(missing_docs, reason = "decode errors are protocol vocabulary")]

use serde::de::DeserializeOwned;
use thiserror::Error;

use super::model::{
    DeclarationRecord, FactRecord, FileRecord, HeaderRecord, SemanticSnapshot, SignatureRecord,
    SymbolRecord, TypeRecord,
};
use super::validate::SemanticFactsValidationError;

#[derive(Debug, Error)]
pub enum SemanticFactsDecodeError {
    #[error("semantic-facts JSON could not be decoded: {0}")]
    Json(#[from] serde_json::Error),
    #[error("semantic-facts JSON Lines record {line} could not be decoded: {source}")]
    JsonLine {
        line: usize,
        #[source]
        source: serde_json::Error,
    },
    #[error("semantic-facts JSON Lines input has no header record")]
    MissingHeader,
    #[error("semantic-facts JSON Lines input contains more than one header")]
    DuplicateHeader,
    #[error("semantic-facts JSON Lines record {line} has unknown record variant {record:?}")]
    UnknownRecord { line: usize, record: String },
    #[error(transparent)]
    Validation(#[from] SemanticFactsValidationError),
}

impl SemanticSnapshot {
    /// Decodes and validates one async-API semantic snapshot envelope.
    pub fn decode_json(source: &str) -> Result<Self, SemanticFactsDecodeError> {
        let snapshot: Self = serde_json::from_str(source)?;
        snapshot.validate()?;
        Ok(snapshot)
    }

    /// Decodes and validates the canonical JSON Lines transport representation.
    pub fn decode_json_lines(source: &str) -> Result<Self, SemanticFactsDecodeError> {
        let mut header = None;
        let mut files = Vec::new();
        let mut types = Vec::new();
        let mut declarations = Vec::new();
        let mut symbols = Vec::new();
        let mut signatures = Vec::new();
        let mut facts = Vec::new();

        for (index, line) in source.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let line_number = index + 1;
            let value: serde_json::Value = serde_json::from_str(line).map_err(|source| {
                SemanticFactsDecodeError::JsonLine {
                    line: line_number,
                    source,
                }
            })?;
            let record = value
                .get("record")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            match record {
                "header" => {
                    if header.is_some() {
                        return Err(SemanticFactsDecodeError::DuplicateHeader);
                    }
                    header = Some(from_line(value, line_number)?);
                }
                "file" => files.push(from_line::<FileRecord>(value, line_number)?),
                "type" => types.push(from_line::<TypeRecord>(value, line_number)?),
                "declaration" => {
                    declarations.push(from_line::<DeclarationRecord>(value, line_number)?);
                }
                "symbol" => symbols.push(from_line::<SymbolRecord>(value, line_number)?),
                "signature" => {
                    signatures.push(from_line::<SignatureRecord>(value, line_number)?);
                }
                "fact" => facts.push(from_line::<FactRecord>(value, line_number)?),
                _ => {
                    return Err(SemanticFactsDecodeError::UnknownRecord {
                        line: line_number,
                        record: record.to_owned(),
                    });
                }
            }
        }

        let snapshot = Self {
            header: header.ok_or(SemanticFactsDecodeError::MissingHeader)?,
            files,
            types,
            declarations,
            symbols,
            signatures,
            facts,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }
}

fn from_line<T: DeserializeOwned>(
    value: serde_json::Value,
    line: usize,
) -> Result<T, SemanticFactsDecodeError> {
    serde_json::from_value(value)
        .map_err(|source| SemanticFactsDecodeError::JsonLine { line, source })
}

#[allow(
    dead_code,
    reason = "keeps rustdoc's linked header type visible in this module"
)]
fn _header_type(_: HeaderRecord) {}
