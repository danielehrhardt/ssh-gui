//! Manage the SSH keys in a user's `~/.ssh`: list, generate, import, rename, delete,
//! enable/disable and load into ssh-agent. Shared by the desktop app, the `sshkm` CLI and its
//! MCP server. Nothing in the public API ever returns private key material.

pub mod agent;
mod error;
mod model;
mod sshconfig;
mod store;

pub use error::{Error, Result};
pub use model::{AgentKey, AgentStatus, GenerateOptions, KeyAlgorithm, KeyInfo, RenameOutcome};
pub use store::{validate_new_name, KeyStore, DISABLED_DIR};
