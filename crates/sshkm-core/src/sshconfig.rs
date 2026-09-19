//! Minimal, line-preserving reader/rewriter for `~/.ssh/config`.
//!
//! Only understands what is needed to answer "which Host entries use this key?" and to
//! repoint `IdentityFile` lines after a rename. Everything else is passed through untouched.

use std::path::{Path, PathBuf};

/// Splits a config line into `(keyword, argument)`; handles `Key value`, `Key=value` and quotes.
fn split_line(line: &str) -> Option<(&str, &str)> {
    let t = line.trim();
    if t.is_empty() || t.starts_with('#') {
        return None;
    }
    let idx = t.find(|c: char| c.is_whitespace() || c == '=')?;
    let (key, rest) = t.split_at(idx);
    let rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=');
    Some((key, rest.trim()))
}

fn unquote(s: &str) -> &str {
    s.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(s)
}

/// Expands `~`, `%d` and relative paths the way ssh does for `IdentityFile`.
fn resolve(arg: &str, home: &Path, ssh_dir: &Path) -> PathBuf {
    let arg = unquote(arg);
    let expanded = arg.replace("%d", &home.to_string_lossy());
    if expanded == "~" {
        home.to_path_buf()
    } else if let Some(rest) = expanded.strip_prefix("~/").or_else(|| expanded.strip_prefix("~\\")) {
        home.join(rest)
    } else {
        let p = PathBuf::from(&expanded);
        if p.is_absolute() {
            p
        } else {
            ssh_dir.join(p)
        }
    }
}

/// One `IdentityFile` occurrence.
pub struct IdentityRef {
    pub hosts: Vec<String>,
    pub path: PathBuf,
}

pub fn identity_refs(config: &str, home: &Path, ssh_dir: &Path) -> Vec<IdentityRef> {
    let mut hosts: Vec<String> = vec!["*".into()];
    let mut out = Vec::new();
    for line in config.lines() {
        let Some((key, arg)) = split_line(line) else { continue };
        if key.eq_ignore_ascii_case("host") {
            hosts = arg.split_whitespace().map(|h| unquote(h).to_string()).collect();
        } else if key.eq_ignore_ascii_case("match") {
            hosts = vec![format!("Match {arg}")];
        } else if key.eq_ignore_ascii_case("identityfile") {
            out.push(IdentityRef { hosts: hosts.clone(), path: resolve(arg, home, ssh_dir) });
        }
    }
    out
}

/// Hosts whose `IdentityFile` resolves to `key_path`.
pub fn hosts_using(config: &str, home: &Path, ssh_dir: &Path, key_path: &Path) -> Vec<String> {
    let mut hosts = Vec::new();
    for r in identity_refs(config, home, ssh_dir) {
        if r.path == key_path {
            for h in r.hosts {
                if !hosts.contains(&h) {
                    hosts.push(h);
                }
            }
        }
    }
    hosts
}

/// Rewrites every `IdentityFile` pointing at `old_path` so that it ends in `new_name`, keeping
/// the user's notation (`~/.ssh/…`, quotes, indentation). Returns `None` when nothing changed.
pub fn rename_identity(
    config: &str,
    home: &Path,
    ssh_dir: &Path,
    old_path: &Path,
    old_name: &str,
    new_name: &str,
) -> Option<String> {
    let mut changed = false;
    let mut out = String::with_capacity(config.len());
    for line in config.split_inclusive('\n') {
        let body = line.trim_end_matches(['\n', '\r']);
        let rewritten = split_line(body).and_then(|(key, arg)| {
            if !key.eq_ignore_ascii_case("identityfile") || resolve(arg, home, ssh_dir) != old_path {
                return None;
            }
            let inner = unquote(arg);
            let replaced = match inner.strip_suffix(old_name) {
                // Keep the user's notation (`~/.ssh/…`, `%d/…`, relative).
                Some(stem) => format!("{stem}{new_name}"),
                // Same file, unusual spelling (`~/.ssh/key/`): the line was counted as a reference,
                // so it must not be skipped — spell the new path out in full.
                None => ssh_dir.join(new_name).to_string_lossy().into_owned(),
            };
            let quote = arg.starts_with('"') || replaced.contains(char::is_whitespace);
            let new_arg = if quote { format!("\"{replaced}\"") } else { replaced };
            let arg_start = body.rfind(arg)?;
            Some(format!("{}{}{}", &body[..arg_start], new_arg, &line[body.len()..]))
        });
        match rewritten {
            Some(l) => {
                changed = true;
                out.push_str(&l);
            }
            None => out.push_str(line),
        }
    }
    changed.then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CFG: &str = "# comment\nHost github.com gh\n  User git\n  IdentityFile ~/.ssh/id_work\n\nHost \"quoted\"\n\tIdentityFile=\"%d/.ssh/id_work\"\nHost other\n  IdentityFile ~/.ssh/id_other\nHost rel\n  IdentityFile id_work\n";

    fn paths() -> (PathBuf, PathBuf) {
        let home = PathBuf::from("/home/u");
        (home.clone(), home.join(".ssh"))
    }

    #[test]
    fn finds_hosts() {
        let (home, ssh) = paths();
        let hosts = hosts_using(CFG, &home, &ssh, &ssh.join("id_work"));
        assert_eq!(hosts, ["github.com", "gh", "quoted", "rel"]);
        assert_eq!(hosts_using(CFG, &home, &ssh, &ssh.join("id_other")), ["other"]);
        assert!(hosts_using(CFG, &home, &ssh, &ssh.join("nope")).is_empty());
    }

    #[test]
    fn rewrites_only_matching_lines() {
        let (home, ssh) = paths();
        let new = rename_identity(CFG, &home, &ssh, &ssh.join("id_work"), "id_work", "work_2026").unwrap();
        assert!(new.contains("  IdentityFile ~/.ssh/work_2026\n"));
        assert!(new.contains("\tIdentityFile=\"%d/.ssh/work_2026\"\n"));
        assert!(new.contains("  IdentityFile work_2026\n"));
        assert!(new.contains("  IdentityFile ~/.ssh/id_other\n"));
        assert!(new.starts_with("# comment\nHost github.com gh\n  User git\n"));
        assert_eq!(new.lines().count(), CFG.lines().count());
        assert!(rename_identity(CFG, &home, &ssh, &ssh.join("nope"), "nope", "x").is_none());
    }

    #[test]
    fn rewrites_references_with_unusual_spelling() {
        let (home, ssh) = paths();
        let cfg = "Host a\n  IdentityFile ~/.ssh/k/\n";
        assert_eq!(hosts_using(cfg, &home, &ssh, &ssh.join("k")), ["a"]);
        let new = rename_identity(cfg, &home, &ssh, &ssh.join("k"), "k", "k2").unwrap();
        assert_eq!(hosts_using(&new, &home, &ssh, &ssh.join("k2")), ["a"]);
        assert!(hosts_using(&new, &home, &ssh, &ssh.join("k")).is_empty());
    }

    #[test]
    fn keeps_crlf() {
        let (home, ssh) = paths();
        let cfg = "Host a\r\n  IdentityFile ~/.ssh/k\r\n";
        let new = rename_identity(cfg, &home, &ssh, &ssh.join("k"), "k", "k2").unwrap();
        assert_eq!(new, "Host a\r\n  IdentityFile ~/.ssh/k2\r\n");
    }
}
