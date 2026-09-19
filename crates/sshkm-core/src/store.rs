use crate::agent;
use crate::error::{Error, Result};
use crate::model::{AgentStatus, GenerateOptions, KeyAlgorithm, KeyInfo, RenameOutcome};
use crate::sshconfig;
use ssh_key::private::{KeypairData, RsaKeypair};
use ssh_key::rand_core::OsRng;
use ssh_key::{Algorithm, EcdsaCurve, HashAlg, LineEnding, PrivateKey, PublicKey};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Directory inside the ssh dir where disabled keys are parked. ssh never looks in there and
/// `IdentityFile` entries stop resolving, so a disabled key is really out of circulation.
pub const DISABLED_DIR: &str = "disabled";

/// Private keys are tiny; anything bigger is not a key and is never read.
const MAX_KEY_FILE: u64 = 256 * 1024;

const RESERVED_NAMES: &[&str] =
    &["config", "known_hosts", "known_hosts.old", "authorized_keys", "environment", "rc", DISABLED_DIR];

pub struct KeyStore {
    ssh_dir: PathBuf,
    home: PathBuf,
    use_agent: bool,
}

struct Located {
    dir: PathBuf,
    enabled: bool,
    private: Option<PathBuf>,
    public: Option<PathBuf>,
}

impl Located {
    fn files(&self) -> Vec<PathBuf> {
        self.private.iter().chain(self.public.iter()).cloned().collect()
    }
}

impl KeyStore {
    /// `~/.ssh`, unless `$SSHKM_SSH_DIR` says otherwise.
    pub fn open_default() -> Result<Self> {
        Self::open(None)
    }

    /// Precedence: `ssh_dir`, then `$SSHKM_SSH_DIR`, then `~/.ssh`. `$SSHKM_NO_AGENT` turns agent
    /// integration off.
    pub fn open(ssh_dir: Option<PathBuf>) -> Result<Self> {
        let home = dirs::home_dir()
            .ok_or_else(|| Error::Io(std::io::Error::other("cannot determine the home directory")))?;
        let ssh_dir = ssh_dir
            .or_else(|| std::env::var_os("SSHKM_SSH_DIR").filter(|d| !d.is_empty()).map(PathBuf::from))
            .unwrap_or_else(|| home.join(".ssh"));
        // A relative (or empty) base would let a key named `-oFoo` reach ssh-add as an option.
        let ssh_dir = std::path::absolute(&ssh_dir)?;
        let use_agent = std::env::var_os("SSHKM_NO_AGENT").is_none();
        Ok(Self { ssh_dir, home, use_agent })
    }

    pub fn new(ssh_dir: impl Into<PathBuf>) -> Self {
        let ssh_dir = ssh_dir.into();
        let ssh_dir = std::path::absolute(&ssh_dir).unwrap_or(ssh_dir);
        let home = dirs::home_dir().unwrap_or_else(|| ssh_dir.clone());
        Self { ssh_dir, home, use_agent: true }
    }

    /// Never talk to ssh-agent (hermetic tests, sandboxed environments).
    pub fn without_agent(mut self) -> Self {
        self.use_agent = false;
        self
    }

    pub fn ssh_dir(&self) -> &Path {
        &self.ssh_dir
    }

    fn disabled_dir(&self) -> PathBuf {
        self.ssh_dir.join(DISABLED_DIR)
    }

    pub fn agent_status(&self) -> AgentStatus {
        if self.use_agent {
            agent::status()
        } else {
            AgentStatus { available: false, message: Some("agent integration is turned off".into()), keys: vec![] }
        }
    }

    // ---------------------------------------------------------------- reading

    pub fn list(&self) -> Result<Vec<KeyInfo>> {
        let agent = self.agent_status();
        let config = fs::read_to_string(self.ssh_dir.join("config")).unwrap_or_default();
        let mut keys: Vec<KeyInfo> = Vec::new();
        for (dir, enabled) in [(self.ssh_dir.clone(), true), (self.disabled_dir(), false)] {
            for name in scan_names(&dir)? {
                if keys.iter().any(|k| k.name == name) {
                    continue;
                }
                let located = locate_in(&dir, &name, enabled);
                keys.push(self.describe(&name, &located, &agent, &config));
            }
        }
        keys.sort_by_key(|k| k.name.to_lowercase());
        Ok(keys)
    }

    pub fn get(&self, name: &str) -> Result<KeyInfo> {
        let located = self.locate(name)?;
        let config = fs::read_to_string(self.ssh_dir.join("config")).unwrap_or_default();
        Ok(self.describe(name, &located, &self.agent_status(), &config))
    }

    fn locate(&self, name: &str) -> Result<Located> {
        if !is_plain_file_name(name) {
            return Err(Error::InvalidName(name.into(), "must be a plain file name"));
        }
        for (dir, enabled) in [(self.ssh_dir.clone(), true), (self.disabled_dir(), false)] {
            let located = locate_in(&dir, name, enabled);
            if located.private.is_some() || located.public.is_some() {
                return Ok(located);
            }
        }
        Err(Error::NotFound(name.into()))
    }

    fn describe(&self, name: &str, at: &Located, agent: &AgentStatus, config: &str) -> KeyInfo {
        let private_text = at.private.as_ref().and_then(|p| read_small(p).ok());
        let format = match &private_text {
            Some(t) if t.contains("BEGIN OPENSSH PRIVATE KEY") => "openssh",
            Some(_) => "pem",
            None => "none",
        };
        let parsed_private =
            private_text.as_deref().filter(|_| format == "openssh").and_then(|t| PrivateKey::from_openssh(t).ok());
        let encrypted = match (&parsed_private, &private_text) {
            (Some(k), _) => k.is_encrypted(),
            (None, Some(t)) => t.contains("ENCRYPTED"),
            _ => false,
        };

        let public: Option<PublicKey> = at
            .public
            .as_ref()
            .and_then(|p| read_small(p).ok())
            .and_then(|t| PublicKey::from_openssh(t.trim()).ok())
            .or_else(|| parsed_private.as_ref().map(|k| k.public_key().clone()));

        let (algorithm, bits) = match &public {
            Some(p) => algorithm_of(p),
            None => (pem_algorithm(private_text.as_deref().unwrap_or("")).to_string(), None),
        };
        let fingerprint = public.as_ref().map(|p| p.fingerprint(HashAlg::Sha256));
        let randomart = fingerprint.as_ref().map(|f| {
            let header = match bits {
                Some(b) => format!("[{} {b}]", algorithm.to_ascii_uppercase()),
                None => format!("[{}]", algorithm.to_ascii_uppercase()),
            };
            f.to_randomart(&header)
        });
        let fingerprint = fingerprint.map(|f| f.to_string());
        let in_agent = fingerprint.as_ref().is_some_and(|f| agent.keys.iter().any(|k| &k.fingerprint == f));
        let comment = public
            .as_ref()
            .map(|p| p.comment().to_string())
            .filter(|c| !c.is_empty())
            .or_else(|| parsed_private.as_ref().map(|k| k.comment().to_string()))
            .unwrap_or_default();
        let modified = at
            .private
            .as_ref()
            .or(at.public.as_ref())
            .and_then(|p| fs::metadata(p).ok())
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        KeyInfo {
            name: name.to_string(),
            path: at.private.as_ref().map(|p| p.to_string_lossy().into_owned()),
            public_path: at.public.as_ref().map(|p| p.to_string_lossy().into_owned()),
            algorithm,
            bits,
            fingerprint,
            randomart,
            comment,
            public_key: public.as_ref().and_then(|p| p.to_openssh().ok()),
            encrypted,
            enabled: at.enabled,
            in_agent,
            has_private: at.private.is_some(),
            format: format.to_string(),
            modified,
            used_by_hosts: sshconfig::hosts_using(config, &self.home, &self.ssh_dir, &self.ssh_dir.join(name)),
        }
    }

    // ---------------------------------------------------------------- creating

    pub fn generate(&self, opts: &GenerateOptions) -> Result<KeyInfo> {
        self.ensure_name_free(&opts.name)?;
        let comment = clean_comment(&opts.comment)?;
        let mut rng = OsRng;
        let mut key = match (opts.algorithm, opts.bits) {
            (KeyAlgorithm::Ed25519, _) => PrivateKey::random(&mut rng, Algorithm::Ed25519)?,
            (KeyAlgorithm::Rsa, bits) => {
                let bits = bits.unwrap_or(4096);
                if ![2048, 3072, 4096].contains(&bits) {
                    return Err(Error::Unsupported(format!("RSA with {bits} bits (use 2048, 3072 or 4096)")));
                }
                PrivateKey::new(KeypairData::from(RsaKeypair::random(&mut rng, bits as usize)?), "")?
            }
            (KeyAlgorithm::Ecdsa, None | Some(256)) => {
                PrivateKey::random(&mut rng, Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 })?
            }
            (KeyAlgorithm::Ecdsa, Some(384)) => {
                PrivateKey::random(&mut rng, Algorithm::Ecdsa { curve: EcdsaCurve::NistP384 })?
            }
            (KeyAlgorithm::Ecdsa, Some(bits)) => {
                return Err(Error::Unsupported(format!("ECDSA with {bits} bits (use 256 or 384)")))
            }
        };
        key.set_comment(comment);
        let public = key.public_key().to_openssh()?;
        if let Some(passphrase) = opts.passphrase.as_deref().filter(|p| !p.is_empty()) {
            key = key.encrypt(&mut rng, passphrase)?;
        }
        let private = key.to_openssh(LineEnding::LF)?;
        self.install(&opts.name, private.as_bytes(), Some(&public))?;
        self.get(&opts.name)
    }

    /// Copies an existing private key (and its `.pub` sibling, when there is one) into the ssh dir.
    pub fn import(&self, source: &Path, name: Option<&str>) -> Result<KeyInfo> {
        let name = match name.filter(|n| !n.is_empty()) {
            Some(n) => n.to_string(),
            None => source
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .ok_or_else(|| Error::InvalidKey("source has no file name".into()))?,
        };
        self.ensure_name_free(&name)?;
        let mut text = read_small(source)?;
        if text.starts_with("PuTTY-User-Key-File") {
            return Err(Error::Unsupported(
                "PuTTY .ppk keys — convert first with: puttygen key.ppk -O private-openssh -o key".into(),
            ));
        }
        if !looks_like_private_key(&text) {
            return Err(Error::InvalidKey("the file does not contain a private key".into()));
        }
        if !text.ends_with('\n') {
            text.push('\n');
        }
        let sibling = PathBuf::from(format!("{}.pub", source.display()));
        let public = read_small(&sibling)
            .ok()
            .filter(|t| PublicKey::from_openssh(t.trim()).is_ok())
            .map(|t| t.trim().to_string())
            .or_else(|| PrivateKey::from_openssh(&text).ok().and_then(|k| k.public_key().to_openssh().ok()));
        self.install(&name, text.as_bytes(), public.as_deref())?;
        self.get(&name)
    }

    fn install(&self, name: &str, private: &[u8], public: Option<&str>) -> Result<()> {
        create_private_dir(&self.ssh_dir)?;
        let private_path = self.ssh_dir.join(name);
        write_new(&private_path, private, 0o600)?;
        if let Some(public) = public {
            let public_path = self.ssh_dir.join(format!("{name}.pub"));
            if let Err(e) = write_new(&public_path, format!("{public}\n").as_bytes(), 0o644) {
                let _ = fs::remove_file(&private_path);
                return Err(e);
            }
        }
        Ok(())
    }

    fn ensure_name_free(&self, name: &str) -> Result<()> {
        validate_new_name(name)?;
        for dir in [self.ssh_dir.clone(), self.disabled_dir()] {
            for candidate in [dir.join(name), dir.join(format!("{name}.pub"))] {
                if candidate.symlink_metadata().is_ok() {
                    return Err(Error::AlreadyExists(name.into()));
                }
            }
        }
        Ok(())
    }

    // ---------------------------------------------------------------- changing

    /// Moves the key files to the OS trash, or unlinks them when `permanent`.
    pub fn delete(&self, name: &str, permanent: bool) -> Result<()> {
        let located = self.locate(name)?;
        self.unload_quietly(name, &located);
        let files = located.files();
        if permanent {
            for f in &files {
                fs::remove_file(f)?;
            }
        } else {
            trash::delete_all(&files).map_err(|e| Error::Trash(e.to_string()))?;
        }
        Ok(())
    }

    pub fn rename(&self, name: &str, new_name: &str, update_config: bool) -> Result<RenameOutcome> {
        let located = self.locate(name)?;
        self.ensure_name_free(new_name)?;
        let old_identity = self.ssh_dir.join(name);
        let config_path = self.ssh_dir.join("config");
        let config = fs::read_to_string(&config_path).unwrap_or_default();
        let affected_hosts = sshconfig::hosts_using(&config, &self.home, &self.ssh_dir, &old_identity);

        let mut moves = Vec::new();
        if let Some(p) = &located.private {
            moves.push((p.clone(), located.dir.join(new_name)));
        }
        if let Some(p) = &located.public {
            moves.push((p.clone(), located.dir.join(format!("{new_name}.pub"))));
        }
        move_all(&moves)?;

        let mut config_backup = None;
        if update_config && !affected_hosts.is_empty() {
            let rewritten =
                sshconfig::rename_identity(&config, &self.home, &self.ssh_dir, &old_identity, name, new_name);
            if let Some(new_config) = rewritten {
                match self.replace_config(&config_path, &new_config) {
                    Ok(backup) => config_backup = Some(backup),
                    Err(e) => {
                        // Half a rename is worse than none: ssh would silently stop finding the key.
                        let undo: Vec<_> = moves.into_iter().map(|(from, to)| (to, from)).collect();
                        let _ = move_all(&undo);
                        return Err(e);
                    }
                }
            }
        }
        Ok(RenameOutcome {
            key: self.get(new_name)?,
            affected_hosts,
            config_updated: config_backup.is_some(),
            config_backup,
        })
    }

    /// Backs the config up under a fresh name (earlier backups are never clobbered), then replaces
    /// it atomically. Returns the backup's file name.
    fn replace_config(&self, config_path: &Path, new_config: &str) -> Result<String> {
        let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut backup = format!("config.sshkm-{stamp}.bak");
        let mut n = 1;
        while self.ssh_dir.join(&backup).symlink_metadata().is_ok() {
            n += 1;
            backup = format!("config.sshkm-{stamp}-{n}.bak");
        }
        write_new(&self.ssh_dir.join(&backup), &fs::read(config_path)?, 0o600)?;
        write_atomic(config_path, new_config.as_bytes(), 0o600)?;
        Ok(backup)
    }

    pub fn set_enabled(&self, name: &str, enabled: bool) -> Result<KeyInfo> {
        let located = self.locate(name)?;
        if located.enabled == enabled {
            return self.get(name);
        }
        let target = if enabled { self.ssh_dir.clone() } else { self.disabled_dir() };
        if !enabled {
            self.unload_quietly(name, &located);
            create_private_dir(&self.ssh_dir)?;
            create_private_dir(&target)?;
        }
        let moves: Vec<_> = located
            .files()
            .into_iter()
            .map(|from| {
                let to = target.join(from.file_name().expect("key files have names"));
                (from, to)
            })
            .collect();
        move_all(&moves)?;
        self.get(name)
    }

    /// Updates the comment in the `.pub` file (creating it from the private key when missing).
    /// The private key file is never rewritten.
    pub fn set_comment(&self, name: &str, comment: &str) -> Result<KeyInfo> {
        let comment = clean_comment(comment)?;
        let located = self.locate(name)?;
        let mut public = match &located.public {
            Some(p) => PublicKey::from_openssh(read_small(p)?.trim())?,
            None => {
                let private = located.private.as_ref().ok_or_else(|| Error::NotFound(name.into()))?;
                PrivateKey::from_openssh(read_small(private)?)
                    .map_err(|_| {
                        Error::Unsupported("this key has no .pub file and its format cannot be read".into())
                    })?
                    .public_key()
                    .clone()
            }
        };
        public.set_comment(comment);
        let path = located.public.clone().unwrap_or_else(|| located.dir.join(format!("{name}.pub")));
        write_atomic(&path, format!("{}\n", public.to_openssh()?).as_bytes(), 0o644)?;
        self.get(name)
    }

    // ---------------------------------------------------------------- agent

    fn private_path_for_agent(&self, name: &str) -> Result<PathBuf> {
        let located = self.locate(name)?;
        if !located.enabled {
            return Err(Error::Agent(format!("'{name}' is disabled — enable it first")));
        }
        located.private.ok_or_else(|| Error::Agent(format!("'{name}' has no private key")))
    }

    /// Never prompts; fails with "passphrase required" when one is needed and missing.
    pub fn agent_add(&self, name: &str, passphrase: Option<&str>) -> Result<()> {
        let path = self.private_path_for_agent(name)?;
        let passphrase = passphrase.filter(|p| !p.is_empty());
        if passphrase.is_none() && self.get(name)?.encrypted {
            return Err(Error::PassphraseRequired);
        }
        agent::add(&path, passphrase)
    }

    /// Lets `ssh-add` ask for the passphrase on the terminal.
    pub fn agent_add_interactive(&self, name: &str) -> Result<()> {
        agent::add_interactive(&self.private_path_for_agent(name)?)
    }

    pub fn agent_remove(&self, name: &str) -> Result<()> {
        let located = self.locate(name)?;
        let target = located
            .public
            .or(located.private)
            .ok_or_else(|| Error::NotFound(name.into()))?;
        agent::remove(&target)
    }

    /// A key that is deleted or disabled should not linger in the agent. Best effort.
    fn unload_quietly(&self, name: &str, located: &Located) {
        if !self.use_agent {
            return;
        }
        let in_agent = self.get(name).map(|k| k.in_agent).unwrap_or(false);
        if let (true, Some(target)) = (in_agent, located.public.as_ref().or(located.private.as_ref())) {
            let _ = agent::remove(target);
        }
    }
}

// -------------------------------------------------------------------- helpers

/// `name` must address exactly one entry directly inside a directory. Joining anything else onto
/// the ssh dir could leave it: separators, `..`, and on Windows drive prefixes (`C:x` *replaces* the
/// base path when joined) or alternate data streams (`key:stream`).
fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\', '\0'])
        && !(cfg!(windows) && name.contains(':'))
        && Path::new(name).file_name() == Some(std::ffi::OsStr::new(name))
}

/// Windows resolves these to devices no matter the directory or extension (`NUL`, `nul.pub`, …).
fn is_windows_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.ends_with(|c: char| c.is_ascii_digit()))
}

/// Rules for names *we* create. Existing files with unusual names can still be managed.
pub fn validate_new_name(name: &str) -> Result<()> {
    let fail = |why| Err(Error::InvalidName(name.to_string(), why));
    if name.is_empty() {
        return fail("must not be empty");
    }
    if name.len() > 100 {
        return fail("must be at most 100 characters");
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || "._@+-".contains(c)) {
        return fail("only letters, digits and . _ @ + - are allowed");
    }
    if name.starts_with('.') || name.starts_with('-') {
        return fail("must not start with '.' or '-'");
    }
    if name.to_ascii_lowercase().ends_with(".pub") {
        return fail("must not end in .pub");
    }
    if RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(name)) {
        return fail("is reserved by ssh");
    }
    if is_windows_device_name(name) {
        return fail("is a reserved device name on Windows");
    }
    Ok(())
}

fn clean_comment(comment: &str) -> Result<String> {
    let comment = comment.trim();
    if comment.contains(['\n', '\r']) {
        return Err(Error::InvalidKey("comments must be a single line".into()));
    }
    Ok(comment.to_string())
}

fn looks_like_private_key(text: &str) -> bool {
    text.lines()
        .next()
        .is_some_and(|l| l.starts_with("-----BEGIN ") && l.trim_end().ends_with("PRIVATE KEY-----"))
}

fn pem_algorithm(text: &str) -> &'static str {
    let first = text.lines().next().unwrap_or("");
    if first.contains("RSA") {
        "rsa"
    } else if first.contains("EC ") {
        "ecdsa"
    } else if first.contains("DSA") {
        "dsa"
    } else {
        "unknown"
    }
}

fn algorithm_of(public: &PublicKey) -> (String, Option<u32>) {
    match public.algorithm() {
        Algorithm::Ed25519 => ("ed25519".into(), Some(256)),
        Algorithm::Rsa { .. } => {
            let bits = public
                .key_data()
                .rsa()
                .and_then(|k| k.n.as_positive_bytes())
                .map(|n| (n.len() * 8) as u32 - n.first().map_or(0, |b| b.leading_zeros()));
            ("rsa".into(), bits)
        }
        Algorithm::Ecdsa { curve } => (
            "ecdsa".into(),
            Some(match curve {
                EcdsaCurve::NistP256 => 256,
                EcdsaCurve::NistP384 => 384,
                EcdsaCurve::NistP521 => 521,
            }),
        ),
        Algorithm::Dsa => ("dsa".into(), Some(1024)),
        Algorithm::SkEd25519 => ("sk-ed25519".into(), Some(256)),
        Algorithm::SkEcdsaSha2NistP256 => ("sk-ecdsa".into(), Some(256)),
        _ => ("unknown".into(), None),
    }
}

fn read_small(path: &Path) -> Result<String> {
    let meta = fs::metadata(path)?;
    if !meta.is_file() || meta.len() > MAX_KEY_FILE {
        return Err(Error::InvalidKey(format!("{} is not a key file", path.display())));
    }
    String::from_utf8(fs::read(path)?).map_err(|_| Error::InvalidKey(format!("{} is not text", path.display())))
}

/// Names of all keys in `dir`: private key files, plus `.pub` files that have no private half.
fn scan_names(dir: &Path) -> Result<Vec<String>> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut files: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| fs::metadata(e.path()).map(|m| m.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !RESERVED_NAMES.contains(&n.as_str()) && !n.starts_with('.'))
        .collect();
    files.sort();

    let mut names = Vec::new();
    for file in files.iter().filter(|f| !f.ends_with(".pub")) {
        if read_small(&dir.join(file)).is_ok_and(|t| looks_like_private_key(&t)) {
            names.push(file.clone());
        }
    }
    for file in files.iter().filter(|f| f.ends_with(".pub")) {
        let stem = file.trim_end_matches(".pub");
        if !stem.is_empty()
            && !names.iter().any(|n| n == stem)
            && read_small(&dir.join(file)).is_ok_and(|t| PublicKey::from_openssh(t.trim()).is_ok())
        {
            names.push(stem.to_string());
        }
    }
    Ok(names)
}

fn locate_in(dir: &Path, name: &str, enabled: bool) -> Located {
    let private = dir.join(name);
    let public = dir.join(format!("{name}.pub"));
    Located {
        dir: dir.to_path_buf(),
        enabled,
        private: read_small(&private).is_ok_and(|t| looks_like_private_key(&t)).then_some(private),
        public: public.is_file().then_some(public),
    }
}

/// Renames every pair, undoing the ones already done when a later one fails. Never overwrites.
fn move_all(moves: &[(PathBuf, PathBuf)]) -> Result<()> {
    for (_, to) in moves {
        if to.symlink_metadata().is_ok() {
            return Err(Error::AlreadyExists(to.file_name().unwrap_or_default().to_string_lossy().into_owned()));
        }
    }
    for (i, (from, to)) in moves.iter().enumerate() {
        if let Err(e) = fs::rename(from, to) {
            for (from, to) in moves[..i].iter().rev() {
                let _ = fs::rename(to, from);
            }
            return Err(e.into());
        }
    }
    Ok(())
}

/// Creates `dir` (and parents) as 0700 from the start — there is no moment with looser permissions.
fn create_private_dir(dir: &Path) -> Result<()> {
    if dir.is_dir() {
        return Ok(());
    }
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    set_mode(dir, 0o700)
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    Ok(fs::set_permissions(path, fs::Permissions::from_mode(mode))?)
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> Result<()> {
    Ok(())
}

/// Creates `path` with `mode`, failing when it already exists.
fn write_new(path: &Path, bytes: &[u8], mode: u32) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(mode);
    }
    let mut file = options.open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            Error::AlreadyExists(path.file_name().unwrap_or_default().to_string_lossy().into_owned())
        } else {
            e.into()
        }
    })?;
    file.write_all(bytes)?;
    file.sync_all()?;
    set_mode(path, mode)
}

/// Replaces `path` via a temp file in the same directory, so readers never see a partial file.
fn write_atomic(path: &Path, bytes: &[u8], mode: u32) -> Result<()> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let tmp = path.with_file_name(format!(".{file_name}.sshkm-{}", std::process::id()));
    let _ = fs::remove_file(&tmp);
    write_new(&tmp, bytes, mode)?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.into()
    })
}
