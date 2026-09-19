import type { Algorithm, KeyInfo } from "./types";

export interface AlgoMeta {
  /** Short display label, e.g. "Ed25519". */
  label: string;
  /** 2–3 character glyph for the list badge. */
  glyph: string;
  /** CSS variable holding this algorithm's identity colour. */
  color: string;
  /** True for algorithms nobody should be generating any more. */
  legacy: boolean;
}

const ALGOS: Record<Algorithm, AlgoMeta> = {
  ed25519: { label: "Ed25519", glyph: "ED", color: "var(--algo-ed25519)", legacy: false },
  rsa: { label: "RSA", glyph: "RSA", color: "var(--algo-rsa)", legacy: false },
  ecdsa: { label: "ECDSA", glyph: "EC", color: "var(--algo-ecdsa)", legacy: false },
  dsa: { label: "DSA", glyph: "DSA", color: "var(--algo-dsa)", legacy: true },
  "sk-ed25519": { label: "Ed25519-SK", glyph: "SK", color: "var(--algo-sk)", legacy: false },
  "sk-ecdsa": { label: "ECDSA-SK", glyph: "SK", color: "var(--algo-sk)", legacy: false },
  unknown: { label: "Unknown", glyph: "?", color: "var(--algo-unknown)", legacy: false },
};

export function algoMeta(algorithm: Algorithm): AlgoMeta {
  return ALGOS[algorithm] ?? ALGOS.unknown;
}

/** "Ed25519" / "RSA 4096" — bits only where they carry information. */
export function algoLabel(key: Pick<KeyInfo, "algorithm" | "bits">): string {
  const meta = algoMeta(key.algorithm);
  const showBits =
    key.bits !== null && (key.algorithm === "rsa" || key.algorithm === "ecdsa" || key.algorithm === "dsa");
  return showBits ? `${meta.label} ${key.bits}` : meta.label;
}

/** `SHA256:abcd…wxyz` — enough on each end to recognise, short enough to scan. */
export function shortFingerprint(fingerprint: string | null, keep = 7): string {
  if (!fingerprint) return "—";
  const [scheme, ...rest] = fingerprint.split(":");
  const body = rest.join(":");
  if (body.length <= keep * 2 + 1) return fingerprint;
  return `${scheme}:${body.slice(0, keep)}…${body.slice(-keep)}`;
}

const UNITS: [limit: number, seconds: number, name: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, "second"],
  [3600, 60, "minute"],
  [86400, 3600, "hour"],
  [86400 * 7, 86400, "day"],
  [86400 * 30, 86400 * 7, "week"],
  [86400 * 365, 86400 * 30, "month"],
  [Infinity, 86400 * 365, "year"],
];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 days ago" from a Unix-seconds timestamp. */
export function relativeTime(unixSeconds: number | null): string {
  if (unixSeconds === null) return "Unknown";
  const diff = unixSeconds - Date.now() / 1000;
  const abs = Math.abs(diff);
  for (const [limit, div, unit] of UNITS) {
    if (abs < limit) return rtf.format(Math.round(diff / div), unit);
  }
  return "Unknown";
}

const absFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function absoluteTime(unixSeconds: number | null): string {
  if (unixSeconds === null) return "Unknown";
  return absFmt.format(new Date(unixSeconds * 1000));
}

/** Free-text match over name, comment, fingerprint and hosts. */
export function matchesQuery(key: KeyInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    key.name.toLowerCase().includes(q) ||
    key.comment.toLowerCase().includes(q) ||
    (key.fingerprint ?? "").toLowerCase().includes(q) ||
    algoLabel(key).toLowerCase().includes(q) ||
    key.usedByHosts.some((h) => h.toLowerCase().includes(q))
  );
}

export type SortKey = "name" | "modified" | "algorithm";

export function sortKeys(keys: readonly KeyInfo[], sort: SortKey): KeyInfo[] {
  const out = [...keys];
  const byName = (a: KeyInfo, b: KeyInfo) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  switch (sort) {
    case "name":
      return out.sort(byName);
    case "modified":
      return out.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || byName(a, b));
    case "algorithm":
      return out.sort(
        (a, b) =>
          algoMeta(a.algorithm).label.localeCompare(algoMeta(b.algorithm).label) ||
          (b.bits ?? 0) - (a.bits ?? 0) ||
          byName(a, b),
      );
  }
}

/** "3 keys" / "1 key" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
