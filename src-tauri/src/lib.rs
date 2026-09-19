use serde::Serialize;
use sshkm_core::{AgentStatus, Error, GenerateOptions, KeyInfo, KeyStore, RenameOutcome};
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, Error>;

// Every command opens the store afresh: it is only a pair of paths, and the file system stays the
// single source of truth, so changes made by the CLI or an AI assistant show up on the next refresh.
fn store() -> Result<KeyStore> {
    KeyStore::open_default()
}

#[tauri::command(async)]
fn list_keys() -> Result<Vec<KeyInfo>> {
    store()?.list()
}

#[tauri::command(async)]
fn generate_key(options: GenerateOptions) -> Result<KeyInfo> {
    store()?.generate(&options)
}

#[tauri::command(async)]
fn import_key(source_path: String, name: Option<String>) -> Result<KeyInfo> {
    store()?.import(Path::new(&source_path), name.as_deref())
}

#[tauri::command(async)]
fn delete_key(name: String, permanent: bool) -> Result<()> {
    store()?.delete(&name, permanent)
}

#[tauri::command(async)]
fn rename_key(name: String, new_name: String, update_config: bool) -> Result<RenameOutcome> {
    store()?.rename(&name, &new_name, update_config)
}

#[tauri::command(async)]
fn set_key_enabled(name: String, enabled: bool) -> Result<KeyInfo> {
    store()?.set_enabled(&name, enabled)
}

#[tauri::command(async)]
fn set_comment(name: String, comment: String) -> Result<KeyInfo> {
    store()?.set_comment(&name, &comment)
}

#[tauri::command(async)]
fn agent_status() -> Result<AgentStatus> {
    Ok(store()?.agent_status())
}

#[tauri::command(async)]
fn agent_add(name: String, passphrase: Option<String>) -> Result<()> {
    store()?.agent_add(&name, passphrase.as_deref())
}

#[tauri::command(async)]
fn agent_remove(name: String) -> Result<()> {
    store()?.agent_remove(&name)
}

#[tauri::command(async)]
fn reveal_key(name: String) -> Result<()> {
    let key = store()?.get(&name)?;
    let path = key.path.or(key.public_path).ok_or(Error::NotFound(name))?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| Error::Io(std::io::Error::other(e.to_string())))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: &'static str,
    ssh_dir: String,
    cli_path: Option<String>,
    platform: &'static str,
}

/// The `sshkm` CLI ships inside the app bundle, right next to the main executable.
fn bundled_cli() -> Option<PathBuf> {
    let name = if cfg!(windows) { "sshkm.exe" } else { "sshkm" };
    let candidate = std::env::current_exe().ok()?.parent()?.join(name);
    candidate.is_file().then_some(candidate)
}

#[tauri::command(async)]
fn app_info() -> Result<AppInfo> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        ssh_dir: store()?.ssh_dir().to_string_lossy().into_owned(),
        cli_path: bundled_cli().map(|p| p.to_string_lossy().into_owned()),
        platform: if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(windows) {
            "windows"
        } else {
            "linux"
        },
    })
}

pub fn run() {
    // ssh-add calls us back as its askpass helper when loading passphrase-protected keys.
    sshkm_core::agent::run_askpass_if_requested();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_keys,
            generate_key,
            import_key,
            delete_key,
            rename_key,
            set_key_enabled,
            set_comment,
            agent_status,
            agent_add,
            agent_remove,
            reveal_key,
            app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SSH Key Manager");
}
