// Mirrors crates/sshkm-core/src/model.rs — keep both in sync.

export type Algorithm =
  | "ed25519"
  | "rsa"
  | "ecdsa"
  | "dsa"
  | "sk-ed25519"
  | "sk-ecdsa"
  | "unknown";

export interface KeyInfo {
  /** Unique identifier: file name of the private key. */
  name: string;
  path: string | null;
  publicPath: string | null;
  algorithm: Algorithm;
  bits: number | null;
  /** `SHA256:…` */
  fingerprint: string | null;
  randomart: string | null;
  comment: string;
  /** Single-line OpenSSH public key. */
  publicKey: string | null;
  /** Protected by a passphrase. */
  encrypted: boolean;
  /** false → parked in ~/.ssh/disabled where ssh cannot see it. */
  enabled: boolean;
  /** Loaded in the running ssh-agent. */
  inAgent: boolean;
  hasPrivate: boolean;
  format: "openssh" | "pem" | "none";
  /** Unix seconds. */
  modified: number | null;
  /** Host patterns in ~/.ssh/config that use this key. */
  usedByHosts: string[];
}

export interface GenerateOptions {
  name: string;
  algorithm: "ed25519" | "rsa" | "ecdsa";
  bits?: number | null;
  comment?: string;
  passphrase?: string | null;
}

export interface AgentKey {
  fingerprint: string;
  comment: string;
  algorithm: string;
  bits: number | null;
}

export interface AgentStatus {
  available: boolean;
  message: string | null;
  keys: AgentKey[];
}

export interface RenameOutcome {
  key: KeyInfo;
  affectedHosts: string[];
  configUpdated: boolean;
  /** File name (inside the ssh dir) of the config backup written before the rewrite. */
  configBackup?: string | null;
}

export interface AppInfo {
  version: string;
  sshDir: string;
  /** Absolute path of the bundled/installed `sshkm` CLI, when it could be located. */
  cliPath: string | null;
  platform: "macos" | "windows" | "linux";
}

/** Shape of every rejected API call. */
export interface ApiError {
  code:
    | "not_found"
    | "already_exists"
    | "invalid_name"
    | "invalid_key"
    | "unsupported"
    | "agent"
    /** agentAdd on a protected key without a passphrase — prompt for one and retry. */
    | "passphrase_required"
    | "incorrect_passphrase"
    | "trash"
    | "io";
  message: string;
}
