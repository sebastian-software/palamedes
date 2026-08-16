#![allow(
    missing_docs,
    reason = "wire DTO fields mirror the linked semantic-facts schema"
)]

use serde::{Deserialize, Serialize};

/// Schema version implemented by the Phase 0 semantic-facts contract.
pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;
/// Source coordinate encoding required by the Phase 0 contract.
pub const SUPPORTED_OFFSET_ENCODING: &str = "utf8-bytes";

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }
    };
}

string_id!(TypeId);
string_id!(SymbolId);
string_id!(DeclarationId);
string_id!(SignatureId);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityState {
    Complete,
    Truncated,
    Unsupported,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TypeKind {
    Any,
    Array,
    Bigint,
    Boolean,
    Callable,
    Conditional,
    Error,
    Index,
    IndexedAccess,
    Intersection,
    Literal,
    Mapped,
    Never,
    NonPrimitive,
    Null,
    Number,
    Object,
    Opaque,
    Reference,
    String,
    StringMapping,
    Substitution,
    Symbol,
    TemplateLiteral,
    This,
    Truncated,
    Tuple,
    TypeParameter,
    Undefined,
    Union,
    UniqueSymbol,
    Unknown,
    Unsupported,
    Void,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureKind {
    Call,
    Construct,
    Index,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TypeViewState {
    Available,
    SameAsActual,
    Inapplicable,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileOrigin {
    Project,
    TypescriptLib,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TupleElementKind {
    Required,
    Optional,
    Rest,
    Variadic,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModifierOperation {
    Add,
    Remove,
    Preserve,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BudgetLimits {
    pub max_type_nodes: usize,
    pub max_type_depth: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetReport {
    pub limits: BudgetLimits,
    pub type_nodes_used: usize,
    pub max_type_depth_observed: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphIssue {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderRecord {
    pub record: String,
    pub schema_version: u32,
    pub typescript_version: String,
    pub typescript_revision: String,
    pub offset_encoding: String,
    pub capabilities: Vec<String>,
    pub budgets: BudgetReport,
    pub project: String,
    pub compiler_options: serde_json::Value,
    pub diagnostic_count: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub record: String,
    pub id: String,
    pub origin: FileOrigin,
    #[serde(default)]
    pub selected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic_count: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteralValue {
    pub kind: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrayTypeDetails {
    pub readonly: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TupleElementDetails {
    pub kind: TupleElementKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TupleTypeDetails {
    pub readonly: bool,
    pub elements: Vec<TupleElementDetails>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalTypeDetails {
    pub check_type: TypeId,
    pub extends_type: TypeId,
    pub true_type: TypeId,
    pub false_type: TypeId,
    #[serde(default)]
    pub infer_type_parameters: Vec<TypeId>,
    #[serde(default)]
    pub distributive: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappedTypeDetails {
    pub type_parameter: TypeId,
    pub constraint_type: TypeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_type: Option<TypeId>,
    pub template_type: TypeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modifiers_type: Option<TypeId>,
    pub readonly_modifier: ModifierOperation,
    pub optional_modifier: ModifierOperation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedAccessTypeDetails {
    pub object_type: TypeId,
    pub index_type: TypeId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateLiteralTypeDetails {
    pub texts: Vec<String>,
    pub types: Vec<TypeId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubstitutionTypeDetails {
    pub base_type: TypeId,
    pub constraint: TypeId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeRecord {
    pub record: String,
    pub id: TypeId,
    pub type_kind: TypeKind,
    pub display: String,
    pub flags: Vec<String>,
    #[serde(default)]
    pub members: Vec<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<SymbolId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<TypeId>,
    #[serde(default)]
    pub type_arguments: Vec<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraint: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<TypeId>,
    #[serde(default)]
    pub properties: Vec<SymbolId>,
    #[serde(default)]
    pub call_signatures: Vec<SignatureId>,
    #[serde(default)]
    pub construct_signatures: Vec<SignatureId>,
    #[serde(default)]
    pub index_signatures: Vec<SignatureId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub literal: Option<LiteralValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub array: Option<ArrayTypeDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tuple: Option<TupleTypeDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditional: Option<ConditionalTypeDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mapped: Option<MappedTypeDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed_access: Option<IndexedAccessTypeDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_literal: Option<TemplateLiteralTypeDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub substitution: Option<SubstitutionTypeDetails>,
    pub state: EntityState,
    #[serde(default)]
    pub issues: Vec<GraphIssue>,
    pub complete: bool,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclarationRecord {
    pub record: String,
    pub id: DeclarationId,
    pub file: String,
    pub span: Span,
    pub syntax_kind: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolRecord {
    pub record: String,
    pub id: SymbolId,
    pub name: String,
    pub roles: Vec<String>,
    #[serde(default)]
    pub declarations: Vec<DeclarationId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aliased_symbol: Option<SymbolId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared_type: Option<TypeId>,
    #[serde(default)]
    pub members: Vec<SymbolId>,
    pub state: EntityState,
    #[serde(default)]
    pub issues: Vec<GraphIssue>,
    pub complete: bool,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureRecord {
    pub record: String,
    pub id: SignatureId,
    pub signature_kind: SignatureKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declaration: Option<DeclarationId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<SignatureId>,
    #[serde(default)]
    pub type_arguments: Vec<TypeId>,
    #[serde(default)]
    pub type_parameters: Vec<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub this_type: Option<TypeId>,
    #[serde(default)]
    pub parameters: Vec<SymbolId>,
    #[serde(default)]
    pub min_argument_count: usize,
    #[serde(default)]
    pub has_rest_parameter: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index_key_type: Option<TypeId>,
    #[serde(default)]
    pub readonly: bool,
    pub return_type: TypeId,
    pub state: EntityState,
    #[serde(default)]
    pub issues: Vec<GraphIssue>,
    pub complete: bool,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeViewStates {
    pub actual: TypeViewState,
    pub contextual: TypeViewState,
    pub widened: TypeViewState,
    pub apparent: TypeViewState,
    pub declared: TypeViewState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactRecord {
    pub record: String,
    pub file: String,
    pub span: Span,
    pub syntax_kind: String,
    pub actual_type: TypeId,
    pub type_at_location: TypeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotation_type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inferred_type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contextual_type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widened_type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apparent_type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared_type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narrowed_type: Option<TypeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraint_type: Option<TypeId>,
    pub type_view_states: TypeViewStates,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<SymbolId>,
    #[serde(default)]
    pub declarations: Vec<DeclarationId>,
    pub complete: bool,
    pub recovered: bool,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSnapshot {
    pub header: HeaderRecord,
    #[serde(default)]
    pub files: Vec<FileRecord>,
    #[serde(default)]
    pub types: Vec<TypeRecord>,
    #[serde(default)]
    pub declarations: Vec<DeclarationRecord>,
    #[serde(default)]
    pub symbols: Vec<SymbolRecord>,
    #[serde(default)]
    pub signatures: Vec<SignatureRecord>,
    #[serde(default)]
    pub facts: Vec<FactRecord>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SemanticSnapshotRequest {
    pub schema_version: u32,
    pub required_capabilities: Vec<String>,
    pub budgets: BudgetLimits,
    pub files: Vec<String>,
    pub selections: Vec<SemanticSelection>,
}

impl SemanticSnapshotRequest {
    #[must_use]
    pub fn file_wide(files: Vec<String>) -> Self {
        Self {
            schema_version: SUPPORTED_SCHEMA_VERSION,
            required_capabilities: vec![
                "graph.references".to_owned(),
                "graph.signatures".to_owned(),
                "occurrence.file-wide".to_owned(),
                "types.advanced".to_owned(),
                "types.core-composite".to_owned(),
            ],
            budgets: BudgetLimits::default(),
            files,
            selections: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSelection {
    pub file: String,
    pub start: usize,
    pub end: usize,
}
