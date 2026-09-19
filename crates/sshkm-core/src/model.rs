use serde::{Deserialize, Serialize};

/// Everything the UI / CLI / MCP server knows about a key. Never contains private key material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    /// File name of the private key (or the `.pub` stem for public-only keys). Unique identifier.
    pub name: String,
    /// Absolute path of the private key, if present.
    pub path: Option<String>,
    /// Absolute path of the `.pub` file, if present.
    pub public_path: Option<String>,
    /// `ed25519`, `rsa`, `ecdsa`, `dsa`, `sk-ed25519`, `sk-ecdsa` or `unknown`.
    pub algorithm: String,
    pub bits: Option<u32>,
    /// `SHA256:…` fingerprint, when the public half could be determined.
    pub fingerprint: Option<String>,
    pub randomart: Option<String>,
    pub comment: String,
    /// Single-line OpenSSH public key (`ssh-ed25519 AAAA… comment`).
    pub public_key: Option<String>,
    /// Private key is protected by a passphrase.
    pub encrypted: bool,
    /// `false` when the key is parked in `~/.ssh/disabled/` where ssh cannot see it.
    pub enabled: bool,
    /// Currently loaded in the running ssh-agent.
    pub in_agent: bool,
    pub has_private: bool,
    /// `openssh`, `pem` or `none`.
    pub format: String,
    /// Unix timestamp (seconds) of the last modification.
    pub modified: Option<u64>,
    /// `Host` patterns in `~/.ssh/config` whose `IdentityFile` points at this key.
    pub used_by_hosts: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum KeyAlgorithm {
    #[default]
    Ed25519,
    Rsa,
    Ecdsa,
}

impl std::str::FromStr for KeyAlgorithm {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "ed25519" => Ok(Self::Ed25519),
            "rsa" => Ok(Self::Rsa),
            "ecdsa" => Ok(Self::Ecdsa),
            other => Err(format!("unknown algorithm '{other}' (expected ed25519, rsa or ecdsa)")),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOptions {
    pub name: String,
    #[serde(default)]
    pub algorithm: KeyAlgorithm,
    /// RSA: 2048/3072/4096 (default 4096). ECDSA: 256/384 (default 256). Ignored for Ed25519.
    #[serde(default)]
    pub bits: Option<u32>,
    #[serde(default)]
    pub comment: String,
    /// Accepted as input only: never serialized, never printed by `Debug`.
    #[serde(default, skip_serializing)]
    pub passphrase: Option<String>,
}

impl std::fmt::Debug for GenerateOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GenerateOptions")
            .field("name", &self.name)
            .field("algorithm", &self.algorithm)
            .field("bits", &self.bits)
            .field("comment", &self.comment)
            .field("passphrase", &self.passphrase.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    /// `ssh-add` could talk to an agent.
    pub available: bool,
    /// Why the agent is unavailable, when it is.
    pub message: Option<String>,
    pub keys: Vec<AgentKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentKey {
    pub fingerprint: String,
    pub comment: String,
    pub algorithm: String,
    pub bits: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    pub key: KeyInfo,
    /// `Host` entries in `~/.ssh/config` that referenced the old name.
    pub affected_hosts: Vec<String>,
    /// Whether those `IdentityFile` lines were rewritten to the new name.
    pub config_updated: bool,
    /// File name (inside the ssh dir) of the config backup written before the rewrite.
    pub config_backup: Option<String>,
}
