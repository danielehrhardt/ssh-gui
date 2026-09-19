//! Every test runs against a throw-away directory; the real `~/.ssh` and ssh-agent are never touched.

use sshkm_core::{Error, GenerateOptions, KeyAlgorithm, KeyStore};
use std::fs;
use tempfile::TempDir;

fn store() -> (TempDir, KeyStore) {
    let dir = TempDir::new().unwrap();
    let store = KeyStore::new(dir.path().join(".ssh")).without_agent();
    (dir, store)
}

fn ed25519(name: &str) -> GenerateOptions {
    GenerateOptions { name: name.into(), comment: "me@test".into(), ..Default::default() }
}

#[test]
fn empty_when_ssh_dir_is_missing() {
    let (_tmp, store) = store();
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn generates_ed25519() {
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("id_test")).unwrap();
    assert_eq!(key.name, "id_test");
    assert_eq!(key.algorithm, "ed25519");
    assert_eq!(key.bits, Some(256));
    assert_eq!(key.comment, "me@test");
    assert_eq!(key.format, "openssh");
    assert!(key.enabled && key.has_private && !key.encrypted && !key.in_agent);
    assert!(key.fingerprint.as_deref().unwrap().starts_with("SHA256:"));
    assert!(key.public_key.as_deref().unwrap().starts_with("ssh-ed25519 "));
    assert!(key.randomart.as_deref().unwrap().contains("[ED25519 256]"));
    assert_eq!(store.list().unwrap(), vec![key]);
}

#[cfg(unix)]
#[test]
fn files_get_strict_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("perm")).unwrap();
    let mode = |p: &str| fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(key.path.as_deref().unwrap()), 0o600);
    assert_eq!(mode(key.public_path.as_deref().unwrap()), 0o644);
    assert_eq!(mode(store.ssh_dir().to_str().unwrap()), 0o700);
}

#[test]
fn generates_encrypted_ecdsa_and_rsa() {
    let (_tmp, store) = store();
    let ecdsa = store
        .generate(&GenerateOptions {
            name: "ec".into(),
            algorithm: KeyAlgorithm::Ecdsa,
            bits: Some(384),
            passphrase: Some("hunter2".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!((ecdsa.algorithm.as_str(), ecdsa.bits, ecdsa.encrypted), ("ecdsa", Some(384), true));

    let rsa = store
        .generate(&GenerateOptions {
            name: "rsa".into(),
            algorithm: KeyAlgorithm::Rsa,
            bits: Some(2048),
            ..Default::default()
        })
        .unwrap();
    assert_eq!((rsa.algorithm.as_str(), rsa.bits, rsa.encrypted), ("rsa", Some(2048), false));

    let bad = store.generate(&GenerateOptions {
        name: "weak".into(),
        algorithm: KeyAlgorithm::Rsa,
        bits: Some(1024),
        ..Default::default()
    });
    assert!(matches!(bad, Err(Error::Unsupported(_))));
}

#[test]
fn encrypted_key_still_reports_fingerprint_without_pub_file() {
    let (_tmp, store) = store();
    let key = store
        .generate(&GenerateOptions { passphrase: Some("s3cret".into()), ..ed25519("locked") })
        .unwrap();
    fs::remove_file(key.public_path.as_deref().unwrap()).unwrap();
    let again = store.get("locked").unwrap();
    assert!(again.encrypted);
    assert_eq!(again.fingerprint, key.fingerprint);
    assert_eq!(again.public_path, None);
}

#[test]
fn rejects_bad_and_duplicate_names() {
    let (_tmp, store) = store();
    for bad in [
        "", ".hidden", "-dash", "a/b", "a b", "config", "known_hosts", "key.pub", "disabled", "../x", "C:evil", "a:b",
        "NUL", "nul.key", "com1", "LPT9",
    ] {
        assert!(matches!(store.generate(&ed25519(bad)), Err(Error::InvalidName(..))), "{bad:?}");
    }
    store.generate(&ed25519("dup")).unwrap();
    assert!(matches!(store.generate(&ed25519("dup")), Err(Error::AlreadyExists(_))));
    // Lookups must never be able to address anything outside the ssh dir.
    for escape in ["../../etc/passwd", "..", ".", "a/b", "a\\b", "/etc/passwd", "x/", "nul\0"] {
        assert!(matches!(store.get(escape), Err(Error::InvalidName(..))), "{escape:?}");
        assert!(matches!(store.delete(escape, true), Err(Error::InvalidName(..))), "{escape:?}");
        assert!(matches!(store.rename(escape, "fine", false), Err(Error::InvalidName(..))), "{escape:?}");
        assert!(matches!(store.set_enabled(escape, false), Err(Error::InvalidName(..))), "{escape:?}");
        assert!(matches!(store.set_comment(escape, "c"), Err(Error::InvalidName(..))), "{escape:?}");
    }
    #[cfg(windows)]
    for escape in ["C:evil", "C:", "key:stream"] {
        assert!(matches!(store.delete(escape, true), Err(Error::InvalidName(..))), "{escape:?}");
    }
    assert!(matches!(store.get("missing"), Err(Error::NotFound(_))));
}

#[test]
fn disable_and_enable_round_trip() {
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("toggle")).unwrap();

    let off = store.set_enabled("toggle", false).unwrap();
    assert!(!off.enabled);
    assert_eq!(off.fingerprint, key.fingerprint);
    assert!(!store.ssh_dir().join("toggle").exists());
    assert!(!store.ssh_dir().join("toggle.pub").exists());
    assert!(store.ssh_dir().join("disabled/toggle").exists());
    assert!(store.ssh_dir().join("disabled/toggle.pub").exists());
    assert_eq!(store.list().unwrap().len(), 1);

    // A disabled key keeps its name reserved.
    assert!(matches!(store.generate(&ed25519("toggle")), Err(Error::AlreadyExists(_))));

    let on = store.set_enabled("toggle", true).unwrap();
    assert_eq!(on, key);
    // Idempotent.
    assert_eq!(store.set_enabled("toggle", true).unwrap(), key);
}

#[test]
fn rename_moves_both_files_and_can_update_config() {
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("old")).unwrap();
    store.generate(&ed25519("taken")).unwrap();
    let config = store.ssh_dir().join("config");
    fs::write(&config, "Host github.com\n  IdentityFile ~/.ssh/old\nHost x\n  IdentityFile ~/.ssh/taken\n").unwrap();
    // `~` resolves against the real home, so point the config at the temp dir explicitly too.
    let abs = format!("Host abs\n  IdentityFile {}\n", store.ssh_dir().join("old").display());
    fs::write(&config, format!("{}{abs}", fs::read_to_string(&config).unwrap())).unwrap();

    assert!(matches!(store.rename("old", "taken", true), Err(Error::AlreadyExists(_))));
    assert!(matches!(store.rename("old", "bad name", true), Err(Error::InvalidName(..))));
    assert_eq!(store.get("old").unwrap().used_by_hosts, ["abs"]);

    let outcome = store.rename("old", "new", true).unwrap();
    assert_eq!(outcome.key.name, "new");
    assert_eq!(outcome.key.fingerprint, key.fingerprint);
    assert_eq!(outcome.affected_hosts, ["abs"]);
    assert!(outcome.config_updated);
    assert_eq!(outcome.key.used_by_hosts, ["abs"]);
    assert!(store.ssh_dir().join("new").exists() && store.ssh_dir().join("new.pub").exists());
    assert!(!store.ssh_dir().join("old").exists() && !store.ssh_dir().join("old.pub").exists());
    let backup = outcome.config_backup.as_deref().expect("a backup is reported");
    assert!(backup.starts_with("config.sshkm-") && backup.ends_with(".bak"));
    assert!(fs::read_to_string(store.ssh_dir().join(backup)).unwrap().contains("IdentityFile ~/.ssh/old\n"));
    let text = fs::read_to_string(&config).unwrap();
    assert!(text.contains(&format!("IdentityFile {}\n", store.ssh_dir().join("new").display())));
    assert!(text.contains("IdentityFile ~/.ssh/taken\n"));
    assert!(matches!(store.get("old"), Err(Error::NotFound(_))));
}

#[test]
fn rename_works_on_disabled_keys_and_leaves_config_alone_when_asked() {
    let (_tmp, store) = store();
    store.generate(&ed25519("parked")).unwrap();
    let config = store.ssh_dir().join("config");
    let body = format!("Host h\n  IdentityFile {}\n", store.ssh_dir().join("parked").display());
    fs::write(&config, &body).unwrap();
    store.set_enabled("parked", false).unwrap();

    let outcome = store.rename("parked", "parked2", false).unwrap();
    assert!(!outcome.key.enabled);
    assert_eq!(outcome.affected_hosts, ["h"]);
    assert!(!outcome.config_updated && outcome.config_backup.is_none());
    assert_eq!(fs::read_to_string(&config).unwrap(), body);
    assert!(store.ssh_dir().join("disabled/parked2").exists());
}

#[test]
fn delete_permanently_removes_both_files() {
    let (_tmp, store) = store();
    store.generate(&ed25519("gone")).unwrap();
    store.generate(&ed25519("stays")).unwrap();
    store.delete("gone", true).unwrap();
    assert!(!store.ssh_dir().join("gone").exists() && !store.ssh_dir().join("gone.pub").exists());
    let names: Vec<_> = store.list().unwrap().into_iter().map(|k| k.name).collect();
    assert_eq!(names, ["stays"]);
    assert!(matches!(store.delete("gone", true), Err(Error::NotFound(_))));
}

#[test]
fn set_comment_rewrites_only_the_pub_file() {
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("c")).unwrap();
    let private_before = fs::read(key.path.as_deref().unwrap()).unwrap();
    let updated = store.set_comment("c", "  work laptop  ").unwrap();
    assert_eq!(updated.comment, "work laptop");
    assert_eq!(updated.fingerprint, key.fingerprint);
    assert!(updated.public_key.unwrap().ends_with(" work laptop"));
    assert_eq!(fs::read(key.path.as_deref().unwrap()).unwrap(), private_before);
    assert!(store.set_comment("c", "two\nlines").is_err());
}

#[test]
fn import_copies_key_and_derives_pub() {
    let (tmp, store) = store();
    let other = KeyStore::new(tmp.path().join("elsewhere")).without_agent();
    let source = other.generate(&ed25519("portable")).unwrap();
    fs::remove_file(source.public_path.as_deref().unwrap()).unwrap();

    let imported = store.import(source.path.as_deref().unwrap().as_ref(), None).unwrap();
    assert_eq!(imported.name, "portable");
    assert_eq!(imported.fingerprint, source.fingerprint);
    assert!(imported.public_path.is_some(), "pub file is derived from the private key");

    let renamed = store.import(source.path.as_deref().unwrap().as_ref(), Some("second")).unwrap();
    assert_eq!(renamed.name, "second");
    assert!(matches!(
        store.import(source.path.as_deref().unwrap().as_ref(), Some("second")),
        Err(Error::AlreadyExists(_))
    ));

    let junk = tmp.path().join("notes.txt");
    fs::write(&junk, "hello").unwrap();
    assert!(matches!(store.import(&junk, None), Err(Error::InvalidKey(_))));
    let ppk = tmp.path().join("k.ppk");
    fs::write(&ppk, "PuTTY-User-Key-File-3: ssh-ed25519\n").unwrap();
    assert!(matches!(store.import(&ppk, Some("k")), Err(Error::Unsupported(_))));
}

#[test]
fn lists_legacy_pem_public_only_and_ignores_other_files() {
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("real")).unwrap();
    let dir = store.ssh_dir();
    fs::write(dir.join("known_hosts"), "github.com ssh-ed25519 AAAA\n").unwrap();
    fs::write(dir.join("config"), "Host *\n").unwrap();
    fs::write(dir.join("notes.txt"), "not a key").unwrap();
    fs::write(dir.join("legacy"), "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nabc\n-----END RSA PRIVATE KEY-----\n").unwrap();
    fs::write(dir.join("lonely.pub"), format!("{}\n", key.public_key.as_deref().unwrap())).unwrap();
    fs::write(dir.join("broken.pub"), "garbage\n").unwrap();

    let keys = store.list().unwrap();
    let names: Vec<_> = keys.iter().map(|k| k.name.as_str()).collect();
    assert_eq!(names, ["legacy", "lonely", "real"]);

    let legacy = &keys[0];
    assert_eq!((legacy.format.as_str(), legacy.algorithm.as_str()), ("pem", "rsa"));
    assert!(legacy.encrypted && legacy.fingerprint.is_none());

    let lonely = &keys[1];
    assert!(!lonely.has_private);
    assert_eq!(lonely.format, "none");
    assert_eq!(lonely.fingerprint, key.fingerprint);
}

#[test]
fn key_info_serializes_as_camel_case_without_secrets() {
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("json")).unwrap();
    let json = serde_json::to_string(&key).unwrap();
    for field in ["\"publicKey\"", "\"usedByHosts\"", "\"inAgent\"", "\"hasPrivate\"", "\"publicPath\""] {
        assert!(json.contains(field), "{field} missing in {json}");
    }
    assert!(!json.contains("PRIVATE KEY"));
}

#[test]
fn second_rename_keeps_the_first_config_backup() {
    let (_tmp, store) = store();
    store.generate(&ed25519("a")).unwrap();
    let config = store.ssh_dir().join("config");
    fs::write(&config, format!("Host h\n  IdentityFile {}\n", store.ssh_dir().join("a").display())).unwrap();
    let first = store.rename("a", "b", true).unwrap().config_backup.unwrap();
    let second = store.rename("b", "c", true).unwrap().config_backup.unwrap();
    assert_ne!(first, second);
    assert!(store.ssh_dir().join(&first).exists() && store.ssh_dir().join(&second).exists());
}

#[cfg(unix)]
#[test]
fn rename_rolls_back_when_the_config_cannot_be_rewritten() {
    use std::os::unix::fs::PermissionsExt;
    let (_tmp, store) = store();
    let key = store.generate(&ed25519("keep")).unwrap();
    let config = store.ssh_dir().join("config");
    let body = format!("Host h\n  IdentityFile {}\n", store.ssh_dir().join("keep").display());
    fs::write(&config, &body).unwrap();
    // Parked keys move inside `disabled/`, which stays writable; the ssh dir itself becomes
    // read-only, so the files can be renamed but the config can be neither backed up nor replaced.
    store.set_enabled("keep", false).unwrap();
    fs::set_permissions(store.ssh_dir(), fs::Permissions::from_mode(0o500)).unwrap();
    let permissions_bite = fs::write(store.ssh_dir().join("probe"), "").is_err();
    let result = store.rename("keep", "moved", true);
    fs::set_permissions(store.ssh_dir(), fs::Permissions::from_mode(0o700)).unwrap();
    if !permissions_bite {
        return; // running as root: nothing can be made to fail this way
    }

    assert!(result.is_err());
    assert!(store.ssh_dir().join("disabled/keep").exists() && store.ssh_dir().join("disabled/keep.pub").exists());
    assert!(!store.ssh_dir().join("disabled/moved").exists() && !store.ssh_dir().join("disabled/moved.pub").exists());
    assert_eq!(store.get("keep").unwrap().fingerprint, key.fingerprint);
    assert_eq!(fs::read_to_string(&config).unwrap(), body);
}

#[test]
fn passphrase_never_shows_up_in_debug_or_json() {
    let options = GenerateOptions { passphrase: Some("hunter2".into()), ..ed25519("x") };
    assert!(!format!("{options:?}").contains("hunter2"));
    assert!(!serde_json::to_string(&options).unwrap().contains("hunter2"));
}
