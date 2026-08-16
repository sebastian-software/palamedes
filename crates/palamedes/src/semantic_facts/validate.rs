#![allow(missing_docs, reason = "validation errors are protocol vocabulary")]

use std::collections::HashSet;

use thiserror::Error;

use super::model::{
    DeclarationId, EntityState, FactRecord, SemanticSnapshot, SignatureId, SignatureKind, SymbolId,
    TypeId, SUPPORTED_OFFSET_ENCODING, SUPPORTED_SCHEMA_VERSION,
};

#[derive(Debug, Error)]
pub enum SemanticFactsValidationError {
    #[error("{table} record must be {expected:?}, got {actual:?}")]
    InvalidRecord {
        table: &'static str,
        expected: &'static str,
        actual: String,
    },
    #[error("unsupported semantic-facts schema version {actual}; expected {expected}")]
    UnsupportedSchemaVersion { actual: u32, expected: u32 },
    #[error("unsupported semantic-facts offset encoding {0:?}")]
    UnsupportedOffsetEncoding(String),
    #[error("header capabilities must be sorted and unique")]
    NonCanonicalCapabilities,
    #[error("duplicate {table} id {id:?}")]
    DuplicateId { table: &'static str, id: String },
    #[error("{table} id {id:?} must start with {prefix:?}")]
    InvalidIdPrefix {
        table: &'static str,
        id: String,
        prefix: &'static str,
    },
    #[error("{owner} references missing {table} id {id:?}")]
    MissingReference {
        owner: String,
        table: &'static str,
        id: String,
    },
    #[error("{owner} has incoherent state {state:?}, complete={complete}, truncated={truncated}, issues={issues}")]
    InvalidEntityState {
        owner: String,
        state: EntityState,
        complete: bool,
        truncated: bool,
        issues: usize,
    },
    #[error("{owner} has an invalid half-open span {start}..{end}")]
    InvalidSpan {
        owner: String,
        start: usize,
        end: usize,
    },
    #[error("header typeNodesUsed {reported} does not match {actual} charged type nodes")]
    TypeNodeBudgetMismatch { reported: usize, actual: usize },
    #[error("header type graph truncation does not match budget sentinel nodes")]
    BudgetTruncationMismatch,
    #[error("signature {id:?} violates the {kind:?} signature shape")]
    InvalidSignatureShape { id: String, kind: SignatureKind },
}

impl SemanticSnapshot {
    /// Checks schema compatibility, record identity, and every graph reference.
    ///
    /// Unknown object fields, capability names, and issue codes remain compatible.
    /// Unknown enum variants fail earlier while decoding.
    pub fn validate(&self) -> Result<(), SemanticFactsValidationError> {
        validate_record("header", "header", &self.header.record)?;
        if self.header.schema_version != SUPPORTED_SCHEMA_VERSION {
            return Err(SemanticFactsValidationError::UnsupportedSchemaVersion {
                actual: self.header.schema_version,
                expected: SUPPORTED_SCHEMA_VERSION,
            });
        }
        if self.header.offset_encoding != SUPPORTED_OFFSET_ENCODING {
            return Err(SemanticFactsValidationError::UnsupportedOffsetEncoding(
                self.header.offset_encoding.clone(),
            ));
        }
        if !is_sorted_unique(&self.header.capabilities) {
            return Err(SemanticFactsValidationError::NonCanonicalCapabilities);
        }

        let mut files = HashSet::with_capacity(self.files.len());
        for file in &self.files {
            validate_record("file", "file", &file.record)?;
            add_id(&mut files, "file", &file.id)?;
        }

        let mut types = HashSet::with_capacity(self.types.len());
        for record in &self.types {
            validate_record("type", "type", &record.record)?;
            add_namespaced_id(&mut types, "type", record.id.as_str(), "type:")?;
            validate_entity_state(
                format!("type {}", record.id.as_str()),
                record.state,
                record.complete,
                record.truncated,
                record.issues.len(),
            )?;
        }

        let mut declarations = HashSet::with_capacity(self.declarations.len());
        for record in &self.declarations {
            validate_record("declaration", "declaration", &record.record)?;
            add_namespaced_id(
                &mut declarations,
                "declaration",
                record.id.as_str(),
                "declaration:",
            )?;
            require_id(
                &files,
                format!("declaration {}", record.id.as_str()),
                "file",
                &record.file,
            )?;
            validate_span(
                format!("declaration {}", record.id.as_str()),
                record.span.start,
                record.span.end,
            )?;
        }

        let mut symbols = HashSet::with_capacity(self.symbols.len());
        for record in &self.symbols {
            validate_record("symbol", "symbol", &record.record)?;
            add_namespaced_id(&mut symbols, "symbol", record.id.as_str(), "symbol:")?;
            validate_entity_state(
                format!("symbol {}", record.id.as_str()),
                record.state,
                record.complete,
                record.truncated,
                record.issues.len(),
            )?;
        }

        let mut signatures = HashSet::with_capacity(self.signatures.len());
        for record in &self.signatures {
            validate_record("signature", "signature", &record.record)?;
            add_namespaced_id(
                &mut signatures,
                "signature",
                record.id.as_str(),
                "signature:",
            )?;
            validate_entity_state(
                format!("signature {}", record.id.as_str()),
                record.state,
                record.complete,
                record.truncated,
                record.issues.len(),
            )?;
            validate_signature_shape(record)?;
        }

        let budget_sentinels =
            self.types
                .iter()
                .filter(|record| {
                    record.issues.iter().any(|issue| {
                        matches!(issue.code.as_str(), "max-type-depth" | "max-type-nodes")
                    })
                })
                .count();
        let charged_types = self.types.len().saturating_sub(budget_sentinels);
        if self.header.budgets.type_nodes_used != charged_types {
            return Err(SemanticFactsValidationError::TypeNodeBudgetMismatch {
                reported: self.header.budgets.type_nodes_used,
                actual: charged_types,
            });
        }
        if self.header.budgets.truncated != (budget_sentinels != 0) {
            return Err(SemanticFactsValidationError::BudgetTruncationMismatch);
        }

        for record in &self.types {
            let owner = format!("type {}", record.id.as_str());
            for id in type_edges(record) {
                require_type(&types, &owner, id)?;
            }
            if let Some(id) = &record.symbol {
                require_symbol(&symbols, &owner, id)?;
            }
            for id in &record.properties {
                require_symbol(&symbols, &owner, id)?;
            }
            for id in record
                .call_signatures
                .iter()
                .chain(&record.construct_signatures)
                .chain(&record.index_signatures)
            {
                require_signature(&signatures, &owner, id)?;
            }
        }

        for record in &self.symbols {
            let owner = format!("symbol {}", record.id.as_str());
            for id in &record.declarations {
                require_declaration(&declarations, &owner, id)?;
            }
            if let Some(id) = &record.aliased_symbol {
                require_symbol(&symbols, &owner, id)?;
            }
            for id in &record.members {
                require_symbol(&symbols, &owner, id)?;
            }
            for id in [&record.r#type, &record.declared_type]
                .into_iter()
                .flatten()
            {
                require_type(&types, &owner, id)?;
            }
        }

        for record in &self.signatures {
            let owner = format!("signature {}", record.id.as_str());
            if let Some(id) = &record.declaration {
                require_declaration(&declarations, &owner, id)?;
            }
            if let Some(id) = &record.target {
                require_signature(&signatures, &owner, id)?;
            }
            for id in record
                .type_arguments
                .iter()
                .chain(&record.type_parameters)
                .chain(record.this_type.iter())
                .chain(record.index_key_type.iter())
                .chain(std::iter::once(&record.return_type))
            {
                require_type(&types, &owner, id)?;
            }
            for id in &record.parameters {
                require_symbol(&symbols, &owner, id)?;
            }
        }

        for (index, fact) in self.facts.iter().enumerate() {
            validate_fact(index, fact, &files, &types, &symbols, &declarations)?;
        }
        Ok(())
    }
}

fn type_edges(record: &super::model::TypeRecord) -> Vec<&TypeId> {
    let mut edges = Vec::new();
    edges.extend(&record.members);
    edges.extend(record.target.iter());
    edges.extend(&record.type_arguments);
    edges.extend(record.constraint.iter());
    edges.extend(record.default.iter());
    if let Some(details) = &record.conditional {
        edges.extend([
            &details.check_type,
            &details.extends_type,
            &details.true_type,
            &details.false_type,
        ]);
        edges.extend(&details.infer_type_parameters);
    }
    if let Some(details) = &record.mapped {
        edges.extend([&details.type_parameter, &details.constraint_type]);
        edges.extend(details.name_type.iter());
        edges.push(&details.template_type);
        edges.extend(details.modifiers_type.iter());
    }
    if let Some(details) = &record.indexed_access {
        edges.extend([&details.object_type, &details.index_type]);
    }
    if let Some(details) = &record.template_literal {
        edges.extend(&details.types);
    }
    if let Some(details) = &record.substitution {
        edges.extend([&details.base_type, &details.constraint]);
    }
    edges
}

fn validate_fact(
    index: usize,
    fact: &FactRecord,
    files: &HashSet<String>,
    types: &HashSet<String>,
    symbols: &HashSet<String>,
    declarations: &HashSet<String>,
) -> Result<(), SemanticFactsValidationError> {
    validate_record("fact", "fact", &fact.record)?;
    let owner = format!("fact[{index}]");
    require_id(files, owner.clone(), "file", &fact.file)?;
    validate_span(owner.clone(), fact.span.start, fact.span.end)?;
    for id in [
        Some(&fact.actual_type),
        Some(&fact.type_at_location),
        fact.annotation_type.as_ref(),
        fact.inferred_type.as_ref(),
        fact.contextual_type.as_ref(),
        fact.widened_type.as_ref(),
        fact.apparent_type.as_ref(),
        fact.declared_type.as_ref(),
        fact.narrowed_type.as_ref(),
        fact.constraint_type.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        require_type(types, &owner, id)?;
    }
    if let Some(id) = &fact.symbol {
        require_symbol(symbols, &owner, id)?;
    }
    for id in &fact.declarations {
        require_declaration(declarations, &owner, id)?;
    }
    Ok(())
}

fn validate_signature_shape(
    record: &super::model::SignatureRecord,
) -> Result<(), SemanticFactsValidationError> {
    let valid = match record.signature_kind {
        SignatureKind::Index => {
            record.index_key_type.is_some()
                && record.min_argument_count == 1
                && record.target.is_none()
                && record.type_arguments.is_empty()
                && record.type_parameters.is_empty()
                && record.this_type.is_none()
                && record.parameters.is_empty()
                && !record.has_rest_parameter
        }
        SignatureKind::Call | SignatureKind::Construct => {
            record.index_key_type.is_none()
                && !record.readonly
                && record.min_argument_count <= record.parameters.len()
                && (!record.has_rest_parameter || !record.parameters.is_empty())
                && (record.type_arguments.is_empty() || record.target.is_some())
        }
    };
    if valid {
        Ok(())
    } else {
        Err(SemanticFactsValidationError::InvalidSignatureShape {
            id: record.id.as_str().to_owned(),
            kind: record.signature_kind,
        })
    }
}

fn validate_entity_state(
    owner: String,
    state: EntityState,
    complete: bool,
    truncated: bool,
    issues: usize,
) -> Result<(), SemanticFactsValidationError> {
    let valid = match state {
        EntityState::Complete => complete && !truncated && issues == 0,
        EntityState::Truncated => !complete && truncated && issues != 0,
        EntityState::Unsupported | EntityState::Error => !complete && !truncated && issues != 0,
    };
    if valid {
        Ok(())
    } else {
        Err(SemanticFactsValidationError::InvalidEntityState {
            owner,
            state,
            complete,
            truncated,
            issues,
        })
    }
}

fn validate_span(
    owner: String,
    start: usize,
    end: usize,
) -> Result<(), SemanticFactsValidationError> {
    if start <= end {
        Ok(())
    } else {
        Err(SemanticFactsValidationError::InvalidSpan { owner, start, end })
    }
}

fn validate_record(
    table: &'static str,
    expected: &'static str,
    actual: &str,
) -> Result<(), SemanticFactsValidationError> {
    if actual == expected {
        Ok(())
    } else {
        Err(SemanticFactsValidationError::InvalidRecord {
            table,
            expected,
            actual: actual.to_owned(),
        })
    }
}

fn add_id(
    ids: &mut HashSet<String>,
    table: &'static str,
    id: &str,
) -> Result<(), SemanticFactsValidationError> {
    if ids.insert(id.to_owned()) {
        Ok(())
    } else {
        Err(SemanticFactsValidationError::DuplicateId {
            table,
            id: id.to_owned(),
        })
    }
}

fn add_namespaced_id(
    ids: &mut HashSet<String>,
    table: &'static str,
    id: &str,
    prefix: &'static str,
) -> Result<(), SemanticFactsValidationError> {
    if !id.starts_with(prefix) {
        return Err(SemanticFactsValidationError::InvalidIdPrefix {
            table,
            id: id.to_owned(),
            prefix,
        });
    }
    add_id(ids, table, id)
}

fn require_id(
    ids: &HashSet<String>,
    owner: String,
    table: &'static str,
    id: &str,
) -> Result<(), SemanticFactsValidationError> {
    if ids.contains(id) {
        Ok(())
    } else {
        Err(SemanticFactsValidationError::MissingReference {
            owner,
            table,
            id: id.to_owned(),
        })
    }
}

fn require_type(
    ids: &HashSet<String>,
    owner: &str,
    id: &TypeId,
) -> Result<(), SemanticFactsValidationError> {
    require_id(ids, owner.to_owned(), "type", id.as_str())
}

fn require_symbol(
    ids: &HashSet<String>,
    owner: &str,
    id: &SymbolId,
) -> Result<(), SemanticFactsValidationError> {
    require_id(ids, owner.to_owned(), "symbol", id.as_str())
}

fn require_declaration(
    ids: &HashSet<String>,
    owner: &str,
    id: &DeclarationId,
) -> Result<(), SemanticFactsValidationError> {
    require_id(ids, owner.to_owned(), "declaration", id.as_str())
}

fn require_signature(
    ids: &HashSet<String>,
    owner: &str,
    id: &SignatureId,
) -> Result<(), SemanticFactsValidationError> {
    require_id(ids, owner.to_owned(), "signature", id.as_str())
}

fn is_sorted_unique(values: &[String]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}
