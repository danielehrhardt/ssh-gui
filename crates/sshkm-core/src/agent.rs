//! Thin wrapper around the system `ssh-add`, so whatever agent the user already runs
//! (OpenSSH, macOS keychain agent, 1Password, gpg-agent, Windows OpenSSH service…) keeps working.

use crate::error::{Error, Result};
use crate::model::{AgentKey, AgentStatus};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Names the single-use file that holds the passphrase for one `ssh-add` run.
const ASKPASS_ONCE: &str = "SSHKM_ASKPASS_ONCE";
const ADD_TIMEOUT: Duration = Duration::from_secs(20);

/// Must be the first call in `main()` of every binary that links this crate.
///
/// When we add a passphrase-protected key we point `SSH_ASKPASS` back at our own executable;
/// `ssh-add` then runs us to obtain the passphrase. The passphrase travels in a 0600 temp file that
/// the first call consumes, so it never sits in a process environment, and a second call — ssh-add
/// asking again after a wrong answer, in whatever language — finds nothing and makes ssh-add give
/// up instead of looping or blocking on a prompt nobody can see.
pub fn run_askpass_if_requested() {
    let Some(once) = std::env::var_os(ASKPASS_ONCE) else { return };
    let secret = std::fs::read_to_string(&once);
    let _ = std::fs::remove_file(&once);
    match secret {
        Ok(secret) => {
            println!("{secret}");
            std::process::exit(0);
        }
        Err(_) => {
            eprintln!("sshkm: running as ssh-askpass helper ({ASKPASS_ONCE} is set) and no passphrase is available");
            std::process::exit(1);
        }
    }
}

fn ssh_add() -> Command {
    let mut cmd = Command::new("ssh-add");
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn spawn_error(e: std::io::Error) -> Error {
    if e.kind() == std::io::ErrorKind::NotFound {
        Error::Agent("ssh-add was not found on PATH (is OpenSSH installed?)".into())
    } else {
        Error::Agent(e.to_string())
    }
}

fn first_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).lines().next().unwrap_or("").trim().to_string()
}

pub fn status() -> AgentStatus {
    let output = match ssh_add().args(["-l", "-E", "sha256"]).output() {
        Ok(o) => o,
        Err(e) => {
            return AgentStatus { available: false, message: Some(spawn_error(e).to_string()), keys: vec![] }
        }
    };
    match output.status.code() {
        Some(0) => AgentStatus {
            available: true,
            message: None,
            keys: parse_list(&String::from_utf8_lossy(&output.stdout)),
        },
        // Exit code 1: agent reachable but holds no identities.
        Some(1) => AgentStatus { available: true, message: None, keys: vec![] },
        _ => {
            let msg = first_line(&output.stderr);
            AgentStatus {
                available: false,
                message: Some(if msg.is_empty() { "ssh-agent is not running".into() } else { msg }),
                keys: vec![],
            }
        }
    }
}

/// Parses `ssh-add -l` lines: `256 SHA256:… some comment (ED25519)`.
pub fn parse_list(stdout: &str) -> Vec<AgentKey> {
    stdout
        .lines()
        .filter_map(|line| {
            let (bits, rest) = line.trim().split_once(' ')?;
            let (fingerprint, rest) = rest.split_once(' ').unwrap_or((rest, ""));
            if !fingerprint.contains(':') {
                return None;
            }
            let (comment, algorithm) = match rest.rfind(" (") {
                Some(i) if rest.ends_with(')') => (&rest[..i], &rest[i + 2..rest.len() - 1]),
                _ => (rest, ""),
            };
            Some(AgentKey {
                fingerprint: fingerprint.to_string(),
                comment: comment.to_string(),
                algorithm: algorithm.to_ascii_lowercase(),
                bits: bits.parse().ok(),
            })
        })
        .collect()
}

/// Loads a key into the agent without ever prompting: the passphrase comes from `passphrase` or
/// the call fails.
pub fn add(key_path: &Path, passphrase: Option<&str>) -> Result<()> {
    let exe = std::env::current_exe()?;
    // Without a passphrase the path names a file that does not exist, so the helper refuses.
    let once = tempfile::Builder::new().prefix("sshkm-askpass-").tempfile()?.into_temp_path();
    match passphrase {
        Some(p) => std::fs::write(&once, p)?,
        None => std::fs::remove_file(&once)?,
    }
    let mut cmd = ssh_add();
    cmd.arg(key_path)
        .env("SSH_ASKPASS", exe)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env(ASKPASS_ONCE, once.as_os_str());
    if std::env::var_os("DISPLAY").is_none() {
        // OpenSSH < 8.4 only consults SSH_ASKPASS when DISPLAY is set.
        cmd.env("DISPLAY", ":0");
    }
    let output = output_with_timeout(cmd, ADD_TIMEOUT);
    drop(once);
    let output = output?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let msg = stderr
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("Enter passphrase"))
        .unwrap_or("ssh-add failed");
    // After a refused retry ssh-add often exits without a useful message. We handed it a
    // passphrase and it still failed without naming another cause, so the passphrase was wrong.
    let unexplained = msg == "ssh-add failed";
    Err(match passphrase {
        None if looks_like_passphrase_failure(&stderr) => Error::PassphraseRequired,
        Some(_) if unexplained || looks_like_passphrase_failure(&stderr) => Error::IncorrectPassphrase,
        _ => Error::Agent(msg.to_string()),
    })
}

/// Runs `cmd` to completion, killing it when it takes longer than `timeout`. Nothing here should
/// ever wait on a human, so a slow `ssh-add` is a stuck one.
fn output_with_timeout(mut cmd: Command, timeout: Duration) -> Result<std::process::Output> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(spawn_error)?;
    let deadline = Instant::now() + timeout;
    loop {
        let failure = match child.try_wait() {
            Ok(Some(_)) => return Ok(child.wait_with_output()?),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            Ok(None) => Error::Agent("ssh-add did not answer in time".into()),
            Err(e) => e.into(),
        };
        let _ = child.kill();
        let _ = child.wait();
        return Err(failure);
    }
}

fn looks_like_passphrase_failure(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    s.contains("passphrase") || s.contains("askpass") || s.contains("incorrect")
}

/// Loads a key, letting `ssh-add` prompt for the passphrase on the controlling terminal.
pub fn add_interactive(key_path: &Path) -> Result<()> {
    let status = Command::new("ssh-add")
        .arg(key_path)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(spawn_error)?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Agent("ssh-add failed".into()))
    }
}

/// Removes a key from the agent. `public_key_path` is what `ssh-add -d` actually reads.
pub fn remove(public_key_path: &Path) -> Result<()> {
    let output = ssh_add().arg("-d").arg(public_key_path).output().map_err(spawn_error)?;
    if output.status.success() {
        Ok(())
    } else {
        let msg = first_line(&output.stderr);
        Err(Error::Agent(if msg.is_empty() { "ssh-add -d failed".into() } else { msg }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_add_listing() {
        let keys = parse_list(
            "256 SHA256:AbC+/123 daniel@mac book (ED25519)\n4096 SHA256:xyz /Users/d/.ssh/id_rsa (RSA)\nThe agent has no identities.\n",
        );
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].fingerprint, "SHA256:AbC+/123");
        assert_eq!(keys[0].comment, "daniel@mac book");
        assert_eq!(keys[0].algorithm, "ed25519");
        assert_eq!(keys[0].bits, Some(256));
        assert_eq!(keys[1].algorithm, "rsa");
    }
}
