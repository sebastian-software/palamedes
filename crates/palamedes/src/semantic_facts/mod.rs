//! Versioned TypeScript semantic-facts wire model and client boundary.
//!
//! The model intentionally contains protocol enums and response-local IDs, not
//! TypeScript compiler flags or implementation object identities.

mod client;
mod decode;
mod model;
mod process;
mod validate;

pub use client::{
    CancellationToken, SemanticSnapshotClient, SemanticSnapshotClientError,
    SemanticSnapshotMetadata, SemanticSnapshotRun, SemanticSnapshotTransport,
    SemanticTransportError,
};
pub use decode::SemanticFactsDecodeError;
pub use model::*;
pub use process::ProcessSemanticSnapshotTransport;
pub use validate::SemanticFactsValidationError;
