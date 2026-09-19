/**
 * In-memory stand-in for the Tauri backend, used when the UI runs in a plain
 * browser (`npm run dev`). It mirrors the real backend's validation and error
 * codes so every flow — including the passphrase retry — can be exercised
 * without a working ssh-agent.
 */
import type { Api } from "./api";
import { validateName } from "./keyname";
import type {
  AgentKey,
  AgentStatus,
  AppInfo,
  ApiError,
  GenerateOptions,
  KeyInfo,
  RenameOutcome,
} from "./types";

const SSH_DIR = "/Users/demo/.ssh";
const DAY = 86400;

const now = Math.floor(Date.now() / 1000);

function fail(code: ApiError["code"], message: string): never {
  throw { code, message } satisfies ApiError;
}

function wait(min = 150, max = 400): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── Synthetic key material ────────────────────────────────────────────── */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Deterministic base64-looking blob, so a given key always renders the same. */
function blob(seed: number, length: number): string {
  let state = (seed * 2654435761) % 4294967296 || 1;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    out += B64[(state >>> 8) % 64];
  }
  return out;
}

const ALGO_PREFIX: Record<string, string> = {
  ed25519: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI",
  rsa: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQ",
  ecdsa: "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBB",
  "sk-ed25519": "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAI",
  "sk-ecdsa": "sk-ecdsa-sha2-nistp256@openssh.com AAAAInNrLWVjZHNhLXNoYTItbmlzdHAyNTZAb3BlbnNzaC5jb20AAAAIbmlzdHAyNTYAAABBB",
};

const BODY_LENGTH: Record<string, number> = {
  ed25519: 42,
  "sk-ed25519": 42,
  "sk-ecdsa": 88,
  ecdsa: 30,
};

function makePublicKey(algorithm: string, bits: number | null, comment: string, seed: number): string {
  const prefix = ALGO_PREFIX[algorithm] ?? ALGO_PREFIX.ed25519;
  let length = BODY_LENGTH[algorithm] ?? 0;
  if (!length) {
    // RSA/DSA bodies scale with the modulus size.
    length = Math.round(((bits ?? 3072) / 8) * 1.34) - 30;
  }
  const body = `${blob(seed, length)}=`;
  return comment ? `${prefix}${body} ${comment}` : `${prefix}${body}`;
}

const ART_CHARS = " .o+=*BOX@%&#/^";

/** An 11-line OpenSSH-shaped randomart box (9 rows of 17 cells + 2 borders). */
function makeRandomart(algorithm: string, bits: number | null, seed: number): string {
  const label = `[${algorithm.toUpperCase().replace("SK-", "SK ")} ${bits ?? 256}]`;
  const header = center(label, 17, "-");
  const footer = center("[SHA256]", 17, "-");
  const rows: string[] = [];
  let state = (seed * 40503) % 4294967296 || 7;
  // Walk a drunkard's path and count visits, exactly like OpenSSH's gallery.
  const grid = new Array(9 * 17).fill(0);
  let x = 8;
  let y = 4;
  for (let step = 0; step < 132; step += 1) {
    state = (state * 1103515245 + 12345) % 4294967296;
    const dir = (state >>> 10) & 3;
    x = Math.min(16, Math.max(0, x + (dir & 1 ? 1 : -1)));
    y = Math.min(8, Math.max(0, y + (dir & 2 ? 1 : -1)));
    grid[y * 17 + x] += 1;
  }
  grid[4 * 17 + 8] = -1; // start marker
  const endIndex = y * 17 + x;
  for (let row = 0; row < 9; row += 1) {
    let line = "";
    for (let col = 0; col < 17; col += 1) {
      const idx = row * 17 + col;
      if (grid[idx] === -1) line += "S";
      else if (idx === endIndex) line += "E";
      else line += ART_CHARS[Math.min(grid[idx], ART_CHARS.length - 1)];
    }
    rows.push(`|${line}|`);
  }
  return [`+${header}+`, ...rows, `+${footer}+`].join("\n");
}

function center(text: string, width: number, pad: string): string {
  const total = Math.max(0, width - text.length);
  const left = Math.floor(total / 2);
  return pad.repeat(left) + text + pad.repeat(total - left);
}

/* ── Seed data ─────────────────────────────────────────────────────────── */

interface SeedSpec {
  name: string;
  algorithm: KeyInfo["algorithm"];
  bits: number | null;
  fingerprint: string | null;
  comment: string;
  encrypted: boolean;
  enabled: boolean;
  inAgent: boolean;
  hasPrivate?: boolean;
  format?: KeyInfo["format"];
  modifiedDaysAgo: number | null;
  usedByHosts: string[];
  noRandomart?: boolean;
}

const SEEDS: SeedSpec[] = [
  {
    name: "id_ed25519",
    algorithm: "ed25519",
    bits: 256,
    fingerprint: "SHA256:8Tq4pVnPEKb1LxWc7Jm2yZfRdHs9AoUvXgQ3NtC6ViE",
    comment: "daniel@macbook",
    encrypted: true,
    enabled: true,
    inAgent: true,
    modifiedDaysAgo: 12,
    usedByHosts: ["github.com", "gitlab.com"],
  },
  {
    name: "work_rsa",
    algorithm: "rsa",
    bits: 4096,
    fingerprint: "SHA256:Qz7Kd2MhBvYnR4pXtLcE8WsAoJfU1iGyPmN6ZbTqRxS",
    comment: "daniel@work-laptop",
    encrypted: true,
    enabled: true,
    inAgent: false,
    modifiedDaysAgo: 411,
    usedByHosts: ["bastion.corp.internal"],
  },
  {
    name: "deploy_ecdsa",
    algorithm: "ecdsa",
    bits: 256,
    fingerprint: "SHA256:Lp3XvNqT8bYcZmHd5RfWoAe2KsJ9UtGiB7nQxVyCrM4",
    comment: "deploy@ci",
    encrypted: false,
    enabled: true,
    inAgent: true,
    modifiedDaysAgo: 152,
    usedByHosts: ["deploy.example.net", "ci-runner-01", "ci-runner-02"],
  },
  {
    name: "homelab_ed25519",
    algorithm: "ed25519",
    bits: 256,
    fingerprint: "SHA256:Wn6RtYuI9oPaSdFgHjKlZxCvBnM3qE5rT7yU1iO8pA2",
    comment: "daniel@homelab",
    encrypted: false,
    enabled: true,
    inAgent: false,
    modifiedDaysAgo: 24,
    usedByHosts: ["nas.home", "proxmox.home", "pi-hole.home", "router.home"],
  },
  {
    name: "yubikey_sk",
    algorithm: "sk-ed25519",
    bits: 256,
    fingerprint: "SHA256:Ck9DsErFtGyHuJiKoLpZaQwSxEdCrFvTgBnHyMjU3iO",
    comment: "daniel@yubikey-5c",
    encrypted: false,
    enabled: true,
    inAgent: false,
    modifiedDaysAgo: 240,
    usedByHosts: ["github.com"],
  },
  {
    name: "old_hetzner",
    algorithm: "ed25519",
    bits: 256,
    fingerprint: "SHA256:Zm4NbVcXsAqWeRtYuIoP1aS2dF3gH4jK5lQ6wE7rT8y",
    comment: "daniel@old-thinkpad",
    encrypted: false,
    enabled: false,
    inAgent: false,
    modifiedDaysAgo: 1043,
    usedByHosts: [],
  },
  {
    name: "legacy_pem",
    algorithm: "rsa",
    bits: 2048,
    fingerprint: null,
    comment: "root@legacy-mailserver",
    encrypted: true,
    enabled: true,
    inAgent: false,
    format: "pem",
    modifiedDaysAgo: 905,
    usedByHosts: ["mail.legacy.example.org"],
    noRandomart: true,
  },
  {
    name: "sarah_colleague",
    algorithm: "ed25519",
    bits: 256,
    fingerprint: "SHA256:Ry5TgYhUjIkOlPaQsWdEfRgThYjUiKoLpMnBvCxZ1a2",
    comment: "sarah@thinkpad",
    encrypted: false,
    enabled: true,
    inAgent: false,
    hasPrivate: false,
    format: "none",
    modifiedDaysAgo: 68,
    usedByHosts: [],
  },
];

function seedToKey(spec: SeedSpec, index: number): KeyInfo {
  const hasPrivate = spec.hasPrivate ?? true;
  const format = spec.format ?? "openssh";
  const dir = spec.enabled ? SSH_DIR : `${SSH_DIR}/disabled`;
  const stem = spec.name.replace(/\.pub$/, "");
  return {
    name: spec.name,
    path: hasPrivate ? `${dir}/${stem}` : null,
    publicPath: `${dir}/${stem}.pub`,
    algorithm: spec.algorithm,
    bits: spec.bits,
    fingerprint: spec.fingerprint,
    randomart:
      spec.noRandomart || !spec.fingerprint
        ? null
        : makeRandomart(spec.algorithm, spec.bits, index + 3),
    comment: spec.comment,
    publicKey: makePublicKey(spec.algorithm, spec.bits, spec.comment, index + 11),
    encrypted: spec.encrypted,
    enabled: spec.enabled,
    inAgent: spec.inAgent,
    hasPrivate,
    format,
    modified: spec.modifiedDaysAgo === null ? null : now - spec.modifiedDaysAgo * DAY,
    usedByHosts: spec.usedByHosts,
  };
}

/* ── Mutable store ─────────────────────────────────────────────────────── */

let store: KeyInfo[] = SEEDS.map(seedToKey);
let nextSeed = 100;

function find(name: string): KeyInfo {
  const key = store.find((k) => k.name === name);
  if (!key) fail("not_found", `No key named “${name}”.`);
  return key;
}

function replace(name: string, patch: Partial<KeyInfo>): KeyInfo {
  const key = find(name);
  const updated = { ...key, ...patch };
  store = store.map((k) => (k.name === name ? updated : k));
  return updated;
}

function clone(key: KeyInfo): KeyInfo {
  return { ...key, usedByHosts: [...key.usedByHosts] };
}

function pathsFor(
  hasPrivate: boolean,
  enabled: boolean,
  name: string,
): Pick<KeyInfo, "path" | "publicPath"> {
  const dir = enabled ? SSH_DIR : `${SSH_DIR}/disabled`;
  const stem = name.replace(/\.pub$/, "");
  return {
    path: hasPrivate ? `${dir}/${stem}` : null,
    publicPath: `${dir}/${stem}.pub`,
  };
}

function checkName(name: string, self?: string): string {
  const trimmed = name.trim();
  const problem = validateName(
    trimmed,
    store.map((k) => k.name),
    self,
  );
  if (problem) {
    const duplicate = problem.includes("already exists");
    fail(duplicate ? "already_exists" : "invalid_name", problem);
  }
  return trimmed;
}

export const mockApi: Api = {
  async listKeys() {
    await wait(180, 340);
    return store.map(clone);
  },

  async generateKey(options: GenerateOptions) {
    const name = checkName(options.name);
    // RSA 4096 really does take a few seconds; make the busy state honest.
    const slow = options.algorithm === "rsa" && (options.bits ?? 4096) >= 4096;
    await wait(slow ? 2600 : 500, slow ? 3800 : 900);
    const bits =
      options.algorithm === "ed25519" ? 256 : (options.bits ?? (options.algorithm === "rsa" ? 4096 : 256));
    const comment = options.comment?.trim() || "";
    const seed = (nextSeed += 7);
    const key: KeyInfo = {
      name,
      ...pathsFor(true, true, name),
      algorithm: options.algorithm,
      bits,
      fingerprint: `SHA256:${blob(seed, 43)}`,
      randomart: makeRandomart(options.algorithm, bits, seed),
      comment,
      publicKey: makePublicKey(options.algorithm, bits, comment, seed),
      encrypted: Boolean(options.passphrase && options.passphrase.length > 0),
      enabled: true,
      inAgent: false,
      hasPrivate: true,
      format: "openssh",
      modified: Math.floor(Date.now() / 1000),
      usedByHosts: [],
    };
    store = [...store, key];
    return clone(key);
  },

  async importKey(sourcePath: string, name?: string) {
    const base = sourcePath.split(/[\\/]/).pop() ?? "imported_key";
    const target = checkName(name ?? base);
    await wait(400, 700);
    if (/\.(txt|md|json)$/i.test(sourcePath)) {
      fail("invalid_key", "That file is not an OpenSSH private key.");
    }
    const seed = (nextSeed += 7);
    const key: KeyInfo = {
      name: target,
      ...pathsFor(true, true, target),
      algorithm: "ed25519",
      bits: 256,
      fingerprint: `SHA256:${blob(seed, 43)}`,
      randomart: makeRandomart("ed25519", 256, seed),
      comment: "imported",
      publicKey: makePublicKey("ed25519", 256, "imported", seed),
      encrypted: false,
      enabled: true,
      inAgent: false,
      hasPrivate: true,
      format: "openssh",
      modified: Math.floor(Date.now() / 1000),
      usedByHosts: [],
    };
    store = [...store, key];
    return clone(key);
  },

  async deleteKey(name: string, permanent: boolean) {
    find(name);
    await wait(200, 450);
    console.info("[mock] delete", name, permanent ? "permanently" : "to trash");
    store = store.filter((k) => k.name !== name);
  },

  async renameKey(name: string, newName: string, updateConfig: boolean) {
    const key = find(name);
    const target = checkName(newName, name);
    await wait(250, 500);
    const affectedHosts = [...key.usedByHosts];
    store = store.filter((k) => k.name !== name);
    const renamed: KeyInfo = {
      ...key,
      name: target,
      ...pathsFor(key.hasPrivate, key.enabled, target),
      modified: Math.floor(Date.now() / 1000),
      usedByHosts: updateConfig ? affectedHosts : [],
    };
    store = [...store, renamed];
    const rewroteConfig = updateConfig && affectedHosts.length > 0;
    return {
      key: clone(renamed),
      affectedHosts,
      configUpdated: rewroteConfig,
      configBackup: rewroteConfig ? "config.sshkm-backup" : null,
    } satisfies RenameOutcome;
  },

  async setKeyEnabled(name: string, enabled: boolean) {
    const key = find(name);
    await wait(180, 380);
    const updated = replace(name, {
      enabled,
      ...pathsFor(key.hasPrivate, enabled, key.name),
      // A parked key can't stay in the agent.
      inAgent: enabled ? key.inAgent : false,
    });
    return clone(updated);
  },

  async setComment(name: string, comment: string) {
    const key = find(name);
    await wait(200, 420);
    const next = comment.trim();
    const updated = replace(name, {
      comment: next,
      publicKey: key.publicKey
        ? `${key.publicKey.split(" ").slice(0, 2).join(" ")}${next ? ` ${next}` : ""}`
        : null,
      modified: Math.floor(Date.now() / 1000),
    });
    return clone(updated);
  },

  async agentStatus() {
    await wait(120, 260);
    const keys: AgentKey[] = store
      .filter((k) => k.inAgent && k.fingerprint)
      .map((k) => ({
        fingerprint: k.fingerprint as string,
        comment: k.comment,
        algorithm: k.algorithm,
        bits: k.bits,
      }));
    return { available: true, message: null, keys } satisfies AgentStatus;
  },

  async agentAdd(name: string, passphrase?: string) {
    const key = find(name);
    await wait(200, 450);
    if (!key.hasPrivate) {
      fail("invalid_key", "This key is public-only — there is nothing to load.");
    }
    if (key.encrypted && !passphrase) {
      fail("passphrase_required", "this key is protected — a passphrase is required");
    }
    if (passphrase === "wrong") {
      fail("incorrect_passphrase", "incorrect passphrase");
    }
    replace(name, { inAgent: true });
  },

  async agentRemove(name: string) {
    find(name);
    await wait(180, 350);
    replace(name, { inAgent: false });
  },

  async revealKey(name: string) {
    const key = find(name);
    await wait(120, 220);
    // Nothing to reveal in a browser; log so the action is observable.
    console.info("[mock] reveal", key.path ?? key.publicPath);
  },

  async pickKeyFile() {
    await wait(300, 600);
    return "/Users/demo/Downloads/imported_key";
  },

  async copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard is unavailable without a secure context or user gesture;
      // the UI still reports success because the real backend would have one.
    }
  },

  async appInfo() {
    await wait(100, 200);
    return {
      version: "0.1.0",
      sshDir: SSH_DIR,
      cliPath: "/Applications/SSH Key Manager.app/Contents/MacOS/sshkm",
      platform: "macos",
    } satisfies AppInfo;
  },
};
