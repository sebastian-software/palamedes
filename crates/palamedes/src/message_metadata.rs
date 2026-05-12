use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Authoring input for semantic message metadata.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageMetadataInput {
    /// Exact catalog identity and authored source payload.
    pub msgid: String,
    /// Optional gettext-style context used to disambiguate identical messages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msgctxt: Option<String>,
    /// Optional translator-facing note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional extraction origins.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub origin: Vec<MessageOriginMetadata>,
    /// Optional argument metadata keyed by argument name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<BTreeMap<String, MessageArgumentMetadataInput>>,
    /// Optional rich-text tag names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Optional selector metadata keyed by selecting argument name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selectors: Option<BTreeMap<String, MessageSelectorMetadata>>,
}

/// Extraction origin attached to semantic message metadata.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageOriginMetadata {
    /// Source file path, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Source line number, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Host component name, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    /// Host route or page identifier, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
}

/// Progressive authoring input for one argument.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum MessageArgumentMetadataInput {
    /// Shorthand kind form, for example `"string"`.
    Kind(MessageArgumentKind),
    /// Full object form.
    Details(MessageArgumentMetadata),
}

/// Normalized semantic metadata for one message argument.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageArgumentMetadata {
    /// Broad message-level data kind.
    #[serde(default)]
    pub kind: MessageArgumentKind,
    /// Optional semantic role such as `count`, `currency`, or `url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Allowed enum/select values when known from extraction.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub values: Vec<String>,
    /// Optional formatter metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<MessageArgumentFormatMetadata>,
}

/// Broad argument kind used by semantic message metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageArgumentKind {
    /// Text or string-like value.
    String,
    /// Number-like value.
    Number,
    /// Date value.
    Date,
    /// Time value.
    Time,
    /// Date-time value.
    Datetime,
    /// Boolean value.
    Boolean,
    /// Enumerated value.
    Enum,
    /// List value.
    List,
    /// Duration value.
    Duration,
    /// Relative-time value.
    RelativeTime,
    /// Person, region, or display name value.
    Name,
    /// Unknown or intentionally unspecified value.
    #[default]
    Unknown,
}

/// Formatter metadata attached to an argument.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageArgumentFormatMetadata {
    /// Raw formatter style, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// Classification of the formatter style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_kind: Option<MessageFormatStyleKind>,
}

/// Classification of a message formatter style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageFormatStyleKind {
    /// Formatter has no style segment.
    None,
    /// Formatter uses a known named style.
    Predefined,
    /// Formatter uses an ICU skeleton.
    Skeleton,
    /// Formatter uses an opaque pattern-style segment.
    Pattern,
}

/// Selector metadata attached to a selecting argument.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSelectorMetadata {
    /// Selector expression kind.
    pub kind: MessageSelectorKind,
    /// Known selector cases in source order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cases: Vec<String>,
    /// Optional plural offset. Omitted when zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
}

/// Selector kind used by semantic message metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageSelectorKind {
    /// General select expression.
    Select,
    /// Cardinal plural expression.
    Plural,
    /// Ordinal plural expression.
    #[serde(rename = "selectordinal")]
    SelectOrdinal,
}

impl From<MessageMetadataInput> for ferrocat::MessageMetadataInput {
    fn from(value: MessageMetadataInput) -> Self {
        Self {
            msgid: value.msgid,
            msgctxt: value.msgctxt,
            description: value.description,
            origin: value
                .origin
                .into_iter()
                .map(ferrocat::MessageOriginMetadata::from)
                .collect(),
            args: value.args.map(|args| {
                args.into_iter()
                    .map(|(name, argument)| (name, argument.into()))
                    .collect()
            }),
            tags: value.tags,
            selectors: value.selectors.map(|selectors| {
                selectors
                    .into_iter()
                    .map(|(name, selector)| (name, selector.into()))
                    .collect()
            }),
        }
    }
}

impl From<MessageOriginMetadata> for ferrocat::MessageOriginMetadata {
    fn from(value: MessageOriginMetadata) -> Self {
        Self {
            file: value.file,
            line: value.line,
            component: value.component,
            route: value.route,
        }
    }
}

impl From<MessageArgumentMetadataInput> for ferrocat::MessageArgumentMetadataInput {
    fn from(value: MessageArgumentMetadataInput) -> Self {
        match value {
            MessageArgumentMetadataInput::Kind(kind) => Self::Kind(kind.into()),
            MessageArgumentMetadataInput::Details(metadata) => Self::Details(metadata.into()),
        }
    }
}

impl From<MessageArgumentMetadata> for ferrocat::MessageArgumentMetadata {
    fn from(value: MessageArgumentMetadata) -> Self {
        Self {
            kind: value.kind.into(),
            role: value.role,
            values: value.values,
            format: value
                .format
                .map(ferrocat::MessageArgumentFormatMetadata::from),
        }
    }
}

impl From<MessageArgumentKind> for ferrocat::MessageArgumentKind {
    fn from(value: MessageArgumentKind) -> Self {
        match value {
            MessageArgumentKind::String => Self::String,
            MessageArgumentKind::Number => Self::Number,
            MessageArgumentKind::Date => Self::Date,
            MessageArgumentKind::Time => Self::Time,
            MessageArgumentKind::Datetime => Self::Datetime,
            MessageArgumentKind::Boolean => Self::Boolean,
            MessageArgumentKind::Enum => Self::Enum,
            MessageArgumentKind::List => Self::List,
            MessageArgumentKind::Duration => Self::Duration,
            MessageArgumentKind::RelativeTime => Self::RelativeTime,
            MessageArgumentKind::Name => Self::Name,
            MessageArgumentKind::Unknown => Self::Unknown,
        }
    }
}

impl From<MessageArgumentFormatMetadata> for ferrocat::MessageArgumentFormatMetadata {
    fn from(value: MessageArgumentFormatMetadata) -> Self {
        Self {
            style: value.style,
            style_kind: value.style_kind.map(ferrocat::MessageFormatStyleKind::from),
        }
    }
}

impl From<MessageFormatStyleKind> for ferrocat::MessageFormatStyleKind {
    fn from(value: MessageFormatStyleKind) -> Self {
        match value {
            MessageFormatStyleKind::None => Self::None,
            MessageFormatStyleKind::Predefined => Self::Predefined,
            MessageFormatStyleKind::Skeleton => Self::Skeleton,
            MessageFormatStyleKind::Pattern => Self::Pattern,
        }
    }
}

impl From<MessageSelectorMetadata> for ferrocat::MessageSelectorMetadata {
    fn from(value: MessageSelectorMetadata) -> Self {
        Self {
            kind: value.kind.into(),
            cases: value.cases,
            offset: value.offset,
        }
    }
}

impl From<MessageSelectorKind> for ferrocat::MessageSelectorKind {
    fn from(value: MessageSelectorKind) -> Self {
        match value {
            MessageSelectorKind::Select => Self::Select,
            MessageSelectorKind::Plural => Self::Plural,
            MessageSelectorKind::SelectOrdinal => Self::SelectOrdinal,
        }
    }
}
