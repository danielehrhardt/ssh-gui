// Builds the `sshkm` CLI and places it where Tauri expects its sidecar:
// src-tauri/binaries/sshkm-<target-triple>[.exe]. The desktop app ships it inside the bundle.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = /^host: (.+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.SSHKM_TARGET || host;
const profile = process.argv.includes("--debug") ? "debug" : "release";

const args = ["build", "-p", "sshkm", "--target", triple];
if (profile === "release") args.push("--release");
execFileSync("cargo", args, { cwd: root, stdio: "inherit" });

const ext = triple.includes("windows") ? ".exe" : "";
const out = join(root, "src-tauri", "binaries");
mkdirSync(out, { recursive: true });
copyFileSync(join(root, "target", triple, profile, `sshkm${ext}`), join(out, `sshkm-${triple}${ext}`));
console.log(`sidecar ready: src-tauri/binaries/sshkm-${triple}${ext}`);
