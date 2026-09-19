//! Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0).
//!
//! Lets AI assistants manage SSH keys through the same core the GUI uses. Private key material is
//! never returned, and deletes go to the OS trash unless the caller explicitly asks otherwise.

use serde_json::{json, Map, Value};
use sshkm_core::{Error, GenerateOptions, KeyStore};
use std::io::{BufRead, Read, Write};
use std::path::Path;

const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "Manages the SSH keys in the user's ~/.ssh directory. Keys are identified by \
their file name. Disabling a key parks it in ~/.ssh/disabled so ssh stops offering it; enabling moves it back. \
Private key material is never exposed. delete_key moves files to the OS trash unless permanent=true — \
always confirm with the user before deleting or renaming keys.";

/// No legitimate request comes anywhere near this; it only stops a runaway client from exhausting
/// memory with a line that never ends.
const MAX_LINE: u64 = 4 * 1024 * 1024;

pub fn serve(store: &KeyStore) -> std::io::Result<()> {
    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        if (&mut stdin).take(MAX_LINE).read_until(b'\n', &mut buf)? == 0 {
            return Ok(());
        }
        let reply = if buf.last() != Some(&b'\n') && buf.len() as u64 == MAX_LINE {
            // Drop the rest of the oversized line so the stream stays in sync.
            loop {
                let chunk = stdin.fill_buf()?;
                if chunk.is_empty() {
                    break;
                }
                let newline = chunk.iter().position(|b| *b == b'\n');
                let used = newline.map_or(chunk.len(), |i| i + 1);
                stdin.consume(used);
                if newline.is_some() {
                    break;
                }
            }
            Some(rpc_error(Value::Null, -32600, "request too large"))
        } else {
            // Invalid UTF-8 must produce a parse error, not end the session.
            let line = String::from_utf8_lossy(&buf);
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(Value::Array(batch)) if batch.is_empty() => Some(rpc_error(Value::Null, -32600, "empty batch")),
                Ok(Value::Array(batch)) => {
                    let replies: Vec<Value> = batch.iter().filter_map(|m| handle(store, m)).collect();
                    (!replies.is_empty()).then_some(Value::Array(replies))
                }
                Ok(message) => handle(store, &message),
                Err(e) => Some(rpc_error(Value::Null, -32700, &format!("parse error: {e}"))),
            }
        };
        if let Some(reply) = reply {
            writeln!(stdout, "{reply}")?;
            stdout.flush()?;
        }
    }
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Returns `None` for notifications, which must not be answered.
fn handle(store: &KeyStore, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return Some(rpc_error(id, -32600, "invalid request"));
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = PROTOCOL_VERSIONS.iter().find(|v| **v == requested).unwrap_or(&PROTOCOL_VERSIONS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "sshkm", "title": "SSH Key Manager", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(rpc_error(id, -32602, "missing tool name"));
            };
            let empty = Map::new();
            let args = params.get("arguments").and_then(Value::as_object).unwrap_or(&empty);
            match call_tool(store, name, args) {
                Ok(value) => tool_result(value, false),
                Err(ToolError::UnknownTool) => {
                    return Some(rpc_error(id, -32602, &format!("unknown tool '{name}'")))
                }
                Err(ToolError::BadArgs(msg)) => tool_result(json!({ "code": "invalid_arguments", "message": msg }), true),
                Err(ToolError::Core(e)) => tool_result(serde_json::to_value(&e).unwrap_or(Value::Null), true),
            }
        }
        _ => return Some(rpc_error(id, -32601, &format!("method '{method}' not found"))),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn tool_result(value: Value, is_error: bool) -> Value {
    let text = serde_json::to_string_pretty(&value).unwrap_or_default();
    let mut result = json!({ "content": [{ "type": "text", "text": text }], "isError": is_error });
    if value.is_object() {
        result["structuredContent"] = value;
    }
    result
}

enum ToolError {
    UnknownTool,
    BadArgs(String),
    Core(Error),
}

impl From<Error> for ToolError {
    fn from(e: Error) -> Self {
        ToolError::Core(e)
    }
}

fn required<'a>(args: &'a Map<String, Value>, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::BadArgs(format!("'{key}' is required and must be a string")))
}

fn optional<'a>(args: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn flag(args: &Map<String, Value>, key: &str, default: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<Value, ToolError> {
    serde_json::to_value(value).map_err(|e| ToolError::BadArgs(e.to_string()))
}

fn call_tool(store: &KeyStore, tool: &str, args: &Map<String, Value>) -> Result<Value, ToolError> {
    match tool {
        "list_keys" => Ok(json!({ "sshDir": store.ssh_dir(), "keys": store.list()? })),
        "get_key" => to_json(&store.get(required(args, "name")?)?),
        "get_public_key" => {
            let key = store.get(required(args, "name")?)?;
            match key.public_key {
                Some(public_key) => Ok(json!({ "name": key.name, "publicKey": public_key })),
                None => Err(Error::Unsupported(format!("no public key is available for '{}'", key.name)).into()),
            }
        }
        "generate_key" => {
            let options = GenerateOptions {
                name: required(args, "name")?.to_string(),
                algorithm: optional(args, "algorithm").unwrap_or("ed25519").parse().map_err(ToolError::BadArgs)?,
                bits: args.get("bits").and_then(Value::as_u64).map(|b| b as u32),
                comment: optional(args, "comment").unwrap_or_default().to_string(),
                passphrase: optional(args, "passphrase").map(str::to_string),
            };
            to_json(&store.generate(&options)?)
        }
        "import_key" => to_json(&store.import(Path::new(required(args, "source_path")?), optional(args, "name"))?),
        "rename_key" => {
            let outcome =
                store.rename(required(args, "name")?, required(args, "new_name")?, flag(args, "update_config", true))?;
            to_json(&outcome)
        }
        "delete_key" => {
            let (name, permanent) = (required(args, "name")?, flag(args, "permanent", false));
            store.delete(name, permanent)?;
            Ok(json!({ "deleted": name, "movedToTrash": !permanent }))
        }
        "enable_key" => to_json(&store.set_enabled(required(args, "name")?, true)?),
        "disable_key" => to_json(&store.set_enabled(required(args, "name")?, false)?),
        "set_comment" => to_json(&store.set_comment(required(args, "name")?, required(args, "comment")?)?),
        "agent_status" => to_json(&store.agent_status()),
        "agent_add" => {
            let name = required(args, "name")?;
            store.agent_add(name, optional(args, "passphrase"))?;
            Ok(json!({ "name": name, "inAgent": true }))
        }
        "agent_remove" => {
            let name = required(args, "name")?;
            store.agent_remove(name)?;
            Ok(json!({ "name": name, "inAgent": false }))
        }
        _ => Err(ToolError::UnknownTool),
    }
}

fn tool(name: &str, title: &str, description: &str, properties: Value, required: &[&str], hints: Value) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        },
        "annotations": hints,
    })
}

fn tools() -> Vec<Value> {
    let name = json!({ "type": "string", "description": "Key name = file name of the private key, e.g. id_ed25519" });
    let read_only = json!({ "readOnlyHint": true, "openWorldHint": false });
    let mutating = json!({ "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false });
    let idempotent =
        json!({ "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false });
    let destructive = json!({ "readOnlyHint": false, "destructiveHint": true, "openWorldHint": false });
    vec![
        tool(
            "list_keys",
            "List SSH keys",
            "List every SSH key in the user's ssh directory (enabled and disabled) with algorithm, fingerprint, \
             comment, public key, passphrase protection, agent status and the ssh config hosts that use it.",
            json!({}),
            &[],
            read_only.clone(),
        ),
        tool("get_key", "Get SSH key", "Details of a single key.", json!({ "name": name }), &["name"], read_only.clone()),
        tool(
            "get_public_key",
            "Get public key",
            "The single-line OpenSSH public key, ready to paste into GitHub, GitLab or authorized_keys.",
            json!({ "name": name }),
            &["name"],
            read_only.clone(),
        ),
        tool(
            "generate_key",
            "Generate SSH key",
            "Create a new key pair in the ssh directory. Defaults to Ed25519, which is the right choice unless a \
             legacy system requires RSA.",
            json!({
                "name": { "type": "string", "description": "File name for the new key. Letters, digits and . _ @ + - only." },
                "algorithm": { "type": "string", "enum": ["ed25519", "rsa", "ecdsa"], "default": "ed25519" },
                "bits": { "type": "integer", "description": "RSA: 2048, 3072 or 4096 (default). ECDSA: 256 (default) or 384." },
                "comment": { "type": "string", "description": "Usually user@host or an e-mail address." },
                "passphrase": { "type": "string", "description": "Optional passphrase that encrypts the private key." },
            }),
            &["name"],
            mutating.clone(),
        ),
        tool(
            "import_key",
            "Import SSH key",
            "Copy an existing private key file (and its .pub sibling) into the ssh directory with safe permissions. \
             Installs a credential that ssh may start using: only call this with a path the user gave you, and \
             confirm the path and target name with them first. Never overwrites an existing key.",
            json!({
                "source_path": { "type": "string", "description": "Absolute path of the private key file to import." },
                "name": { "type": "string", "description": "Target name; defaults to the source file name." },
            }),
            &["source_path"],
            destructive.clone(),
        ),
        tool(
            "rename_key",
            "Rename SSH key",
            "Rename a key (private and .pub file). IdentityFile entries in ~/.ssh/config that point at it are \
             updated too unless update_config is false; the previous config is kept as a config.sshkm-*.bak backup. \
             Confirm with the user first.",
            json!({
                "name": name,
                "new_name": { "type": "string" },
                "update_config": { "type": "boolean", "default": true },
            }),
            &["name", "new_name"],
            destructive.clone(),
        ),
        tool(
            "delete_key",
            "Delete SSH key",
            "Delete a key pair. By default the files are moved to the OS trash and can be restored; \
             permanent=true unlinks them for good. Ask the user before calling this.",
            json!({ "name": name, "permanent": { "type": "boolean", "default": false } }),
            &["name"],
            destructive.clone(),
        ),
        tool(
            "enable_key",
            "Enable SSH key",
            "Move a disabled key back into the ssh directory so ssh can use it again.",
            json!({ "name": name }),
            &["name"],
            idempotent.clone(),
        ),
        tool(
            "disable_key",
            "Disable SSH key",
            "Park a key in ~/.ssh/disabled (and unload it from ssh-agent) so ssh stops offering it, without deleting it.",
            json!({ "name": name }),
            &["name"],
            idempotent.clone(),
        ),
        tool(
            "set_comment",
            "Set key comment",
            "Change the comment stored in the key's .pub file.",
            json!({ "name": name, "comment": { "type": "string" } }),
            &["name", "comment"],
            idempotent.clone(),
        ),
        tool("agent_status", "ssh-agent status", "Whether ssh-agent is reachable and which keys it holds.", json!({}), &[], read_only),
        tool(
            "agent_add",
            "Load key into ssh-agent",
            "Load a key into the running ssh-agent. Passphrase-protected keys need the passphrase.",
            json!({ "name": name, "passphrase": { "type": "string" } }),
            &["name"],
            idempotent.clone(),
        ),
        tool("agent_remove", "Unload key from ssh-agent", "Remove a key from the running ssh-agent.", json!({ "name": name }), &["name"], idempotent),
    ]
}
