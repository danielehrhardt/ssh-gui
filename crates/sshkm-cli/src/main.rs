mod mcp;

use clap::{Parser, Subcommand};
use serde::Serialize;
use sshkm_core::{Error, GenerateOptions, KeyAlgorithm, KeyInfo, KeyStore};
use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

/// Manage your local SSH keys. `sshkm mcp` exposes the same operations to AI assistants.
#[derive(Parser)]
#[command(name = "sshkm", version, propagate_version = true)]
struct Cli {
    /// SSH directory to manage [default: ~/.ssh, env: SSHKM_SSH_DIR]
    #[arg(long, global = true, value_name = "DIR")]
    ssh_dir: Option<PathBuf>,
    /// Machine-readable JSON output
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List all keys
    #[command(visible_alias = "ls")]
    List,
    /// Show the details of one key
    Show { name: String },
    /// Print the public key, ready to paste into GitHub or authorized_keys
    Pubkey { name: String },
    /// Generate a new key pair
    #[command(visible_alias = "new")]
    Generate {
        name: String,
        /// ed25519, rsa or ecdsa
        #[arg(short = 't', long = "type", default_value = "ed25519")]
        algorithm: KeyAlgorithm,
        /// RSA: 2048/3072/4096, ECDSA: 256/384
        #[arg(short, long)]
        bits: Option<u32>,
        #[arg(short = 'C', long, default_value = "")]
        comment: String,
        /// Passphrase (visible in the process list — prefer --passphrase-stdin)
        #[arg(short = 'N', long, conflicts_with = "passphrase_stdin")]
        passphrase: Option<String>,
        /// Read the passphrase from the first line of stdin
        #[arg(long)]
        passphrase_stdin: bool,
    },
    /// Copy an existing private key into the ssh directory
    Import {
        path: PathBuf,
        /// Target name [default: the file name]
        #[arg(long)]
        name: Option<String>,
    },
    /// Rename a key and update IdentityFile entries in ~/.ssh/config
    #[command(visible_alias = "mv")]
    Rename {
        name: String,
        new_name: String,
        /// Leave ~/.ssh/config untouched
        #[arg(long)]
        no_update_config: bool,
    },
    /// Move a key to the trash
    #[command(visible_alias = "rm")]
    Delete {
        name: String,
        /// Unlink the files instead of moving them to the trash
        #[arg(long)]
        permanent: bool,
        /// Do not ask for confirmation
        #[arg(short, long)]
        yes: bool,
    },
    /// Make a disabled key available to ssh again
    Enable { name: String },
    /// Park a key in ~/.ssh/disabled so ssh stops using it
    Disable { name: String },
    /// Change the comment in the .pub file
    Comment { name: String, comment: String },
    /// Work with the running ssh-agent
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },
    /// Run a Model Context Protocol server on stdio
    Mcp,
}

#[derive(Subcommand)]
enum AgentCommand {
    /// Keys currently held by the agent
    #[command(visible_alias = "ls")]
    List,
    /// Load a key (asks for the passphrase on the terminal when needed)
    Add {
        name: String,
        /// Read the passphrase from the first line of stdin instead of prompting
        #[arg(long)]
        passphrase_stdin: bool,
    },
    /// Unload a key
    #[command(visible_alias = "rm")]
    Remove { name: String },
}

fn main() -> ExitCode {
    sshkm_core::agent::run_askpass_if_requested();
    let cli = Cli::parse();
    let json = cli.json;
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            if json {
                eprintln!("{}", serde_json::to_string(&e).unwrap_or_default());
            } else {
                eprintln!("error: {e}");
            }
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), Error> {
    let store = KeyStore::open(cli.ssh_dir)?;
    let json = cli.json;
    match cli.command {
        Command::List => {
            let keys = store.list()?;
            if json {
                print_json(&keys);
            } else {
                print_table(&keys);
            }
        }
        Command::Show { name } => print_key(&store.get(&name)?, json),
        Command::Pubkey { name } => match store.get(&name)?.public_key {
            Some(public_key) => println!("{public_key}"),
            None => return Err(Error::Unsupported(format!("no public key is available for '{name}'"))),
        },
        Command::Generate { name, algorithm, bits, comment, passphrase, passphrase_stdin } => {
            let passphrase = if passphrase_stdin {
                Some(read_stdin_line()?)
            } else if passphrase.is_none() && !json && std::io::stdin().is_terminal() {
                Some(prompt_new_passphrase()?)
            } else {
                passphrase
            };
            let key = store.generate(&GenerateOptions { name, algorithm, bits, comment, passphrase })?;
            done(json, &key, &format!("Generated {} ({})", key.name, describe_type(&key)));
            if !json {
                if let Some(public_key) = &key.public_key {
                    println!("\n{public_key}");
                }
            }
        }
        Command::Import { path, name } => {
            let key = store.import(&path, name.as_deref())?;
            done(json, &key, &format!("Imported {}", key.name));
        }
        Command::Rename { name, new_name, no_update_config } => {
            let outcome = store.rename(&name, &new_name, !no_update_config)?;
            if json {
                print_json(&outcome);
            } else {
                println!("Renamed {name} → {new_name}");
                if outcome.config_updated {
                    let backup = outcome.config_backup.as_deref().unwrap_or("-");
                    println!("Updated IdentityFile for: {} (backup: {backup})", outcome.affected_hosts.join(", "));
                } else if !outcome.affected_hosts.is_empty() {
                    println!("warning: ~/.ssh/config still points at the old name for: {}", outcome.affected_hosts.join(", "));
                }
            }
        }
        Command::Delete { name, permanent, yes } => {
            let key = store.get(&name)?;
            if !yes {
                if !std::io::stdin().is_terminal() {
                    return Err(Error::Unsupported("refusing to delete without confirmation — pass --yes".into()));
                }
                let hosts = if key.used_by_hosts.is_empty() {
                    String::new()
                } else {
                    format!(" (used by {})", key.used_by_hosts.join(", "))
                };
                let how = if permanent { "Permanently delete" } else { "Move to trash" };
                if !confirm(&format!("{how} '{name}'{hosts}? [y/N] "))? {
                    println!("Cancelled.");
                    return Ok(());
                }
            }
            store.delete(&name, permanent)?;
            if json {
                print_json(&serde_json::json!({ "deleted": name, "movedToTrash": !permanent }));
            } else if permanent {
                println!("Deleted {name}");
            } else {
                println!("Moved {name} to the trash");
            }
        }
        Command::Enable { name } => {
            let key = store.set_enabled(&name, true)?;
            done(json, &key, &format!("Enabled {name}"));
        }
        Command::Disable { name } => {
            let key = store.set_enabled(&name, false)?;
            done(json, &key, &format!("Disabled {name} (parked in {}/disabled)", store.ssh_dir().display()));
        }
        Command::Comment { name, comment } => {
            let key = store.set_comment(&name, &comment)?;
            done(json, &key, &format!("Comment of {name} set to \"{}\"", key.comment));
        }
        Command::Agent { command } => match command {
            AgentCommand::List => {
                let status = store.agent_status();
                if json {
                    print_json(&status);
                } else if !status.available {
                    return Err(Error::Agent(status.message.unwrap_or_else(|| "not available".into())));
                } else if status.keys.is_empty() {
                    println!("The agent holds no keys.");
                } else {
                    for k in status.keys {
                        println!("{:<9} {}  {}", k.algorithm, k.fingerprint, k.comment);
                    }
                }
            }
            AgentCommand::Add { name, passphrase_stdin } => {
                if passphrase_stdin {
                    store.agent_add(&name, Some(&read_stdin_line()?))?;
                } else if store.get(&name)?.encrypted && std::io::stdin().is_terminal() {
                    store.agent_add_interactive(&name)?;
                } else {
                    store.agent_add(&name, None)?;
                }
                done(json, &store.get(&name)?, &format!("Loaded {name} into ssh-agent"));
            }
            AgentCommand::Remove { name } => {
                store.agent_remove(&name)?;
                done(json, &store.get(&name)?, &format!("Removed {name} from ssh-agent"));
            }
        },
        Command::Mcp => mcp::serve(&store)?,
    }
    Ok(())
}

fn print_json<T: Serialize>(value: &T) {
    println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
}

fn done(json: bool, key: &KeyInfo, message: &str) {
    if json {
        print_json(key);
    } else {
        println!("{message}");
    }
}

fn read_stdin_line() -> Result<String, Error> {
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line)?;
    Ok(line.trim_end_matches(['\n', '\r']).to_string())
}

fn prompt_new_passphrase() -> Result<String, Error> {
    loop {
        let first = rpassword::prompt_password("Passphrase (empty for none): ")?;
        if first.is_empty() || first == rpassword::prompt_password("Repeat passphrase: ")? {
            return Ok(first);
        }
        eprintln!("Passphrases do not match, try again.");
    }
}

fn confirm(question: &str) -> Result<bool, Error> {
    print!("{question}");
    std::io::stdout().flush()?;
    let answer = read_stdin_line()?;
    Ok(matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes"))
}

fn describe_type(key: &KeyInfo) -> String {
    match key.bits {
        Some(bits) if key.algorithm != "ed25519" => format!("{} {bits}", key.algorithm),
        _ => key.algorithm.clone(),
    }
}

fn flags(key: &KeyInfo) -> String {
    let mut flags = Vec::new();
    if !key.enabled {
        flags.push("disabled");
    }
    if key.in_agent {
        flags.push("agent");
    }
    if key.encrypted {
        flags.push("passphrase");
    }
    if !key.has_private {
        flags.push("public-only");
    }
    flags.join(",")
}

fn print_table(keys: &[KeyInfo]) {
    if keys.is_empty() {
        println!("No SSH keys found. Create one with: sshkm generate <name>");
        return;
    }
    let rows: Vec<[String; 5]> = keys
        .iter()
        .map(|k| {
            [
                k.name.clone(),
                describe_type(k),
                k.fingerprint.clone().unwrap_or_else(|| "-".into()),
                flags(k),
                k.comment.clone(),
            ]
        })
        .collect();
    let header = ["NAME", "TYPE", "FINGERPRINT", "FLAGS", "COMMENT"];
    let widths: Vec<usize> = (0..5)
        .map(|i| rows.iter().map(|r| r[i].chars().count()).chain([header[i].len()]).max().unwrap_or(0))
        .collect();
    let line = |cells: &[&str]| {
        let text: Vec<String> = cells.iter().zip(&widths).map(|(c, w)| format!("{c:<w$}")).collect();
        println!("{}", text.join("  ").trim_end());
    };
    line(&header);
    for row in &rows {
        line(&row.iter().map(String::as_str).collect::<Vec<_>>());
    }
}

fn print_key(key: &KeyInfo, json: bool) {
    if json {
        return print_json(key);
    }
    let field = |label: &str, value: &str| println!("{label:<13}{value}");
    field("Name", &key.name);
    field("Type", &describe_type(key));
    field("Status", if key.enabled { "enabled" } else { "disabled" });
    field("Fingerprint", key.fingerprint.as_deref().unwrap_or("-"));
    field("Comment", &key.comment);
    field("Passphrase", if key.encrypted { "yes" } else { "no" });
    field("In agent", if key.in_agent { "yes" } else { "no" });
    field("Private key", key.path.as_deref().unwrap_or("-"));
    field("Public key", key.public_path.as_deref().unwrap_or("-"));
    if !key.used_by_hosts.is_empty() {
        field("Used by", &key.used_by_hosts.join(", "));
    }
    if let Some(art) = &key.randomart {
        println!("\n{art}");
    }
}
