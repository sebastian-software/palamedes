//! Compiler entry points that `palamedes-build` uses to prepare Rust catalogs.
//!
//! This module is the only part of the `palamedes` crate covered by SemVer.
//! It exposes the shared message lowering that turns compiled ICU messages
//! into runtime programs, plus the PO projection that the JavaScript target
//! also uses. Applications normally depend on `palamedes-build` and
//! `palamedes-i18n` instead of calling these items directly.
//!
//! [`parse_catalog_for_compile`] takes and returns `ferrocat` types. A major
//! `ferrocat` upgrade is therefore a breaking change of this module and ships
//! in a major Palamedes release.
//!
//! The message enums are exhaustive, so a new node or choice kind is a
//! breaking change and also waits for a major release.
//!
//! ```rust
//! use std::collections::BTreeMap;
//!
//! use palamedes::sdk::{
//!     RuntimeCompiledMessage, RuntimeMessageChoiceKind, RuntimeMessageNode,
//!     compile_runtime_catalog_messages,
//! };
//!
//! let messages = BTreeMap::from([(
//!     "files".to_owned(),
//!     "{count, plural, one {# file} other {# files}}".to_owned(),
//! )]);
//! let programs = compile_runtime_catalog_messages(&messages);
//! let Some(RuntimeCompiledMessage::Nodes(nodes)) = programs.get("files") else {
//!     panic!("plural messages lower to runtime nodes");
//! };
//! assert!(matches!(
//!     &nodes[0],
//!     RuntimeMessageNode::Choice {
//!         kind: RuntimeMessageChoiceKind::Plural,
//!         ..
//!     }
//! ));
//! ```

pub use crate::catalog_artifact::parse_catalog_for_compile;
pub use crate::runtime_message::{
    RuntimeCompiledMessage, RuntimeCompiledMessages, RuntimeMessageChoiceKind,
    RuntimeMessageFormat, RuntimeMessageNode, compile_runtime_catalog_messages,
};
