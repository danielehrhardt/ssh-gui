//! Drives the real binary against a throw-away ssh dir. `SSHKM_NO_AGENT` keeps ssh-agent out of it.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use tempfile::TempDir;

fn sshkm(dir: &Path) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_sshkm"));
    cmd.env("SSHKM_SSH_DIR", dir).env("SSHKM_NO_AGENT", "1").stdin(Stdio::null());
    cmd
}

fn run(dir: &Path, args: &[&str]) -> Output {
    sshkm(dir).args(args).output().unwrap()
}

fn ok(dir: &Path, args: &[&str]) -> String {
    let out = run(dir, args);
    assert!(out.status.success(), "{args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn full_cli_lifecycle() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("ssh");

    assert!(ok(&dir, &["list"]).contains("No SSH keys found"));
    assert!(ok(&dir, &["generate", "work", "-C", "me@work"]).contains("Generated work (ed25519)"));
    let generated: Value =
        serde_json::from_str(&ok(&dir, &["--json", "generate", "legacy", "-t", "rsa", "-b", "2048", "-N", "pw"])).unwrap();
    assert_eq!(generated["algorithm"], "rsa");
    assert_eq!(generated["encrypted"], true);

    let table = ok(&dir, &["ls"]);
    assert!(table.lines().next().unwrap().starts_with("NAME"));
    assert!(table.contains("work") && table.contains("rsa 2048") && table.contains("passphrase"));
    assert!(ok(&dir, &["pubkey", "work"]).starts_with("ssh-ed25519 "));
    assert!(ok(&dir, &["show", "work"]).contains("SHA256:"));

    ok(&dir, &["disable", "work"]);
    assert!(dir.join("disabled/work").exists());
    assert!(ok(&dir, &["list"]).contains("disabled"));
    ok(&dir, &["enable", "work"]);
    assert!(dir.join("work").exists());

    assert!(ok(&dir, &["rename", "work", "work2"]).contains("Renamed work → work2"));
    assert!(ok(&dir, &["comment", "work2", "new comment"]).contains("new comment"));

    // Non-interactive deletes must be explicit.
    let refused = run(&dir, &["delete", "work2", "--permanent"]);
    assert!(!refused.status.success());
    assert!(dir.join("work2").exists());
    ok(&dir, &["delete", "work2", "--permanent", "--yes"]);
    assert!(!dir.join("work2").exists());

    let missing = run(&dir, &["--json", "show", "nope"]);
    assert!(!missing.status.success());
    let err: Value = serde_json::from_slice(&missing.stderr).unwrap();
    assert_eq!(err["code"], "not_found");
}

#[test]
fn passphrase_from_stdin() {
    let tmp = TempDir::new().unwrap();
    let mut child = sshkm(tmp.path())
        .args(["--json", "generate", "locked", "--passphrase-stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"correct horse\n").unwrap();
    let out = child.wait_with_output().unwrap();
    let key: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(key["encrypted"], true);
}

struct Mcp {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    next_id: u64,
}

impl Mcp {
    fn start(dir: &Path) -> Self {
        let mut child =
            sshkm(dir).arg("mcp").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdin, stdout, next_id: 0 }
    }

    fn send(&mut self, message: Value) {
        writeln!(self.stdin, "{message}").unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        self.send(json!({ "jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params }));
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(reply["id"], self.next_id);
        reply
    }

    fn call(&mut self, tool: &str, arguments: Value) -> Value {
        self.request("tools/call", json!({ "name": tool, "arguments": arguments }))["result"].clone()
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[test]
fn mcp_session() {
    let tmp = TempDir::new().unwrap();
    let mut mcp = Mcp::start(tmp.path());

    let init = mcp.request(
        "initialize",
        json!({ "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "test", "version": "0" } }),
    );
    assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(init["result"]["serverInfo"]["name"], "sshkm");
    // Notifications get no reply; the next response must belong to the next request.
    mcp.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    assert_eq!(mcp.request("ping", json!({}))["result"], json!({}));

    let tools = mcp.request("tools/list", json!({}));
    let names: Vec<&str> = tools["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    for expected in ["list_keys", "generate_key", "rename_key", "delete_key", "enable_key", "disable_key", "get_public_key"] {
        assert!(names.contains(&expected), "{expected} missing");
    }
    for tool in tools["result"]["tools"].as_array().unwrap() {
        assert_eq!(tool["inputSchema"]["type"], "object", "{tool}");
    }

    let made = mcp.call("generate_key", json!({ "name": "ai_key", "comment": "made by mcp" }));
    assert_eq!(made["isError"], false);
    assert_eq!(made["structuredContent"]["algorithm"], "ed25519");

    let listed = mcp.call("list_keys", json!({}));
    assert_eq!(listed["structuredContent"]["keys"][0]["name"], "ai_key");
    assert!(!listed.to_string().contains("PRIVATE KEY"));

    assert_eq!(mcp.call("disable_key", json!({ "name": "ai_key" }))["structuredContent"]["enabled"], false);
    assert_eq!(mcp.call("enable_key", json!({ "name": "ai_key" }))["structuredContent"]["enabled"], true);
    let renamed = mcp.call("rename_key", json!({ "name": "ai_key", "new_name": "ai_key2" }));
    assert_eq!(renamed["structuredContent"]["key"]["name"], "ai_key2");
    let public = mcp.call("get_public_key", json!({ "name": "ai_key2" }));
    assert!(public["structuredContent"]["publicKey"].as_str().unwrap().ends_with("made by mcp"));

    let dup = mcp.call("generate_key", json!({ "name": "ai_key2" }));
    assert_eq!(dup["isError"], true);
    assert_eq!(dup["structuredContent"]["code"], "already_exists");
    let bad = mcp.call("rename_key", json!({ "name": "ai_key2" }));
    assert_eq!(bad["structuredContent"]["code"], "invalid_arguments");

    let gone = mcp.call("delete_key", json!({ "name": "ai_key2", "permanent": true }));
    assert_eq!(gone["structuredContent"]["movedToTrash"], false);
    assert_eq!(mcp.call("list_keys", json!({}))["structuredContent"]["keys"], json!([]));

    assert_eq!(mcp.request("tools/call", json!({ "name": "nope" }))["error"]["code"], -32602);
    assert_eq!(mcp.request("resources/list", json!({}))["error"]["code"], -32601);
}

#[test]
fn mcp_survives_hostile_input() {
    let tmp = TempDir::new().unwrap();
    let mut mcp = Mcp::start(tmp.path());
    let read = |mcp: &mut Mcp| {
        let mut line = String::new();
        mcp.stdout.read_line(&mut line).unwrap();
        serde_json::from_str::<Value>(&line).unwrap()
    };

    mcp.stdin.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\" \xff\xfe}\n").unwrap();
    assert_eq!(read(&mut mcp)["error"]["code"], -32700, "invalid UTF-8 is a parse error, not a crash");

    mcp.stdin.write_all(b"[]\n").unwrap();
    assert_eq!(read(&mut mcp)["error"]["code"], -32600);

    // 5 MiB without a newline, then a newline: rejected as a whole, and the stream stays in sync.
    let blob = vec![b'x'; 5 * 1024 * 1024];
    mcp.stdin.write_all(&blob).unwrap();
    mcp.stdin.write_all(b"\n").unwrap();
    assert_eq!(read(&mut mcp)["error"]["message"], "request too large");

    assert_eq!(mcp.request("ping", json!({}))["result"], json!({}), "server is still alive and in sync");
}
