/**
 * Key-name rules, shared by the generate/import/rename dialogs and the mock
 * backend so both reject exactly the same inputs.
 */

export const NAME_CHARSET = /^[A-Za-z0-9._@+-]+$/;

// Keep in sync with RESERVED_NAMES / is_windows_device_name in crates/sshkm-core/src/store.rs.
const RESERVED = [
  "config",
  "known_hosts",
  "known_hosts.old",
  "authorized_keys",
  "environment",
  "rc",
  "disabled",
];

/** Windows maps these to devices in every directory, with any extension. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Returns a human-readable problem, or null when the name is acceptable. */
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return "Enter a name.";
  if (name.length > 100) return "Too long — 100 characters at most.";
  if (!NAME_CHARSET.test(name)) {
    return "Use letters, digits, and . _ @ + - only.";
  }
  if (name.startsWith(".")) return "Can’t start with a dot.";
  if (name.startsWith("-")) return "Can’t start with a hyphen.";
  if (name.toLowerCase().endsWith(".pub")) return "Drop the .pub — that file is created for you.";
  if (RESERVED.includes(name.toLowerCase())) {
    return `“${name}” is reserved by OpenSSH.`;
  }
  if (WINDOWS_DEVICE.test(name)) return `“${name}” is a reserved device name on Windows.`;
  return null;
}

/**
 * Full validation including collisions. `existing` is the current key-name
 * list; `self` is excluded from the collision check (rename keeping its name).
 */
export function validateName(
  raw: string,
  existing: readonly string[],
  self?: string,
): string | null {
  const problem = nameProblem(raw);
  if (problem) return problem;
  const name = raw.trim();
  if (name !== self && existing.some((n) => n.toLowerCase() === name.toLowerCase())) {
    return `A key named “${name}” already exists.`;
  }
  return null;
}

/** Turns an arbitrary file path into a plausible default key name. */
export function suggestNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const stripped = base.replace(/\.pub$/i, "").replace(/\.(pem|key|ppk)$/i, "");
  const cleaned = stripped.replace(/[^A-Za-z0-9._@+-]/g, "_").replace(/^[.-]+/, "");
  return cleaned.length > 0 ? cleaned : "imported_key";
}
