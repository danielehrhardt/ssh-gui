<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" alt="">
</p>
<h1 align="center">SSH Key Manager</h1>
<p align="center">
  See, create, rename, enable/disable and delete the SSH keys in your <code>~/.ssh</code> —<br>
  from a fast desktop app, a CLI, or your AI assistant (MCP).
</p>
<p align="center">
  <a href="https://github.com/danielehrhardt/ssh-gui/actions/workflows/ci.yml"><img src="https://github.com/danielehrhardt/ssh-gui/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/danielehrhardt/ssh-gui/releases/latest"><img src="https://img.shields.io/github/v/release/danielehrhardt/ssh-gui" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-informational" alt="Platforms">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/main-dark.png">
  <img src="docs/screenshots/main-light.png" alt="SSH Key Manager main window">
</picture>

## Features

- **Everything in `~/.ssh` at a glance** – algorithm, size, fingerprint, comment, randomart, passphrase protection, whether the key is loaded in `ssh-agent`, and which `Host` entries of your ssh config use it.
- **Enable / disable with one click** – a disabled key is parked in `~/.ssh/disabled/` (and unloaded from the agent), so ssh stops offering it without you having to delete anything.
- **Generate** Ed25519, RSA (2048–4096) and ECDSA (P‑256/P‑384) keys, with optional passphrase. Pure Rust – no `ssh-keygen` needed, works the same on every OS.
- **Import, rename, delete** – renames can update the matching `IdentityFile` lines in `~/.ssh/config` (the previous config is kept as a `config.sshkm-*.bak` backup, and the rename is rolled back if the config cannot be updated); deletes go to the **system trash** by default.
- **Copy the public key** in one click or with <kbd>⌘/Ctrl</kbd>+<kbd>C</kbd>.
- **ssh-agent integration** – load/unload keys, including passphrase-protected ones. Works with whatever agent `ssh-add` talks to (OpenSSH, macOS, 1Password, Windows OpenSSH service, …).
- **CLI + MCP server** – the bundled `sshkm` binary does everything the app does, and `sshkm mcp` lets AI assistants such as Claude manage keys for you.
- Light & dark theme, fully keyboard accessible, no telemetry, no network access.

| Generate | AI & CLI |
| --- | --- |
| ![Generate dialog](docs/screenshots/generate.png) | ![AI and CLI integration](docs/screenshots/ai-cli.png) |

## Install

Download the latest build for your platform from the **[Releases](https://github.com/danielehrhardt/ssh-gui/releases/latest)** page:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon / Intel) | `.dmg` (`aarch64` / `x64`) |
| Windows | `.msi` or `-setup.exe` |
| Linux | `.AppImage`, `.deb` or `.rpm` |
| CLI only | `sshkm-<target>` |

> **macOS:** the builds are not notarized. On first launch right-click the app → **Open**, or run
> `xattr -cr "/Applications/SSH Key Manager.app"`.

The CLI can also be installed with Cargo:

```sh
cargo install --git https://github.com/danielehrhardt/ssh-gui sshkm
```

## CLI

```console
$ sshkm list
NAME        TYPE      FINGERPRINT                                         FLAGS             COMMENT
id_ed25519  ed25519   SHA256:Zp4n0V1sQx8mB2kYt7cHf3LwR9dJ6uEaG5iKoN1yT0s  agent             me@laptop
id_rsa      rsa 4096  SHA256:hW3/rT8bYq1LmC5vXz0Nf6Kd2Js9Ga4Pe7UoI+Mt1xA  passphrase        me@old-laptop
staging     ed25519   SHA256:1k3v0oYyJ3h0R1m0mJ3cQ2hYb8xw0r5iKq7D2nE6f9A  disabled          deploy@ci

$ sshkm generate work -C "me@work"        # Ed25519 by default, asks for a passphrase
$ sshkm pubkey work | pbcopy              # public key → clipboard
$ sshkm disable staging                   # park it in ~/.ssh/disabled
$ sshkm enable staging
$ sshkm rename work work-2026             # also rewrites IdentityFile in ~/.ssh/config
$ sshkm agent add work
$ sshkm delete old_key                    # moves to the trash; --permanent to unlink
```

Every command accepts `--json` for scripting and `--ssh-dir <DIR>` (or `SSHKM_SSH_DIR`) to manage a
different directory. Run `sshkm help` for the full reference.

## Use it from your AI assistant (MCP)

`sshkm mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio.

**Claude Code**

```sh
claude mcp add sshkm -- sshkm mcp
```

**Claude Desktop, Cursor, VS Code, … (JSON config)**

```json
{
  "mcpServers": {
    "sshkm": { "command": "sshkm", "args": ["mcp"] }
  }
}
```

If `sshkm` is not on your `PATH`, use the absolute path – the desktop app shows it under **AI & CLI**
(the CLI ships inside the app bundle).

| Tool | What it does |
| --- | --- |
| `list_keys`, `get_key`, `get_public_key` | Inspect keys (read-only) |
| `generate_key`, `import_key` | Create / import a key pair |
| `rename_key`, `set_comment` | Rename (incl. ssh config), edit the comment |
| `enable_key`, `disable_key` | Toggle whether ssh can use the key |
| `delete_key` | Move to trash (or `permanent: true`) |
| `agent_status`, `agent_add`, `agent_remove` | Work with `ssh-agent` |

**Safety:** private key material is never returned by any tool, tools carry MCP read-only /
destructive annotations so clients can ask for confirmation, new files are created with `0600`
permissions and nothing is ever overwritten.

## How it works

```
crates/sshkm-core   Rust library – all key logic, shared by everything below
crates/sshkm-cli    `sshkm` CLI + MCP server
src-tauri           Tauri 2 desktop shell (bundles the CLI as a sidecar)
src                 React + TypeScript + Tailwind UI
```

- The file system is the single source of truth – there is no database and no config file. Whatever
  you (or another tool) change in `~/.ssh` shows up on the next refresh.
- **Disabled** means: the private key and its `.pub` live in `~/.ssh/disabled/`. Move them back by
  hand and they are enabled again.
- Keys are parsed and generated with the pure-Rust [`ssh-key`](https://crates.io/crates/ssh-key)
  crate. Legacy PEM keys (`-----BEGIN RSA PRIVATE KEY-----`) are listed and can be managed; their
  fingerprint is shown when a `.pub` file is next to them.
- Agent operations shell out to your system's `ssh-add`.

## Development

Prerequisites: [Rust](https://rustup.rs), Node.js 20+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri dev        # desktop app with hot reload
npm run dev              # UI only, in the browser, against an in-memory mock backend
cargo test --workspace   # core + CLI + MCP tests (never touch your real ~/.ssh)
npm run tauri build      # installers in target/release/bundle
```

Releases are built by GitHub Actions for all platforms when a `v*` tag is pushed.

## License

[MIT](LICENSE)
