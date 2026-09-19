import { invoke } from "@tauri-apps/api/core";
import { mockApi } from "./mock";
import type {
  AgentStatus,
  ApiError,
  AppInfo,
  GenerateOptions,
  KeyInfo,
  RenameOutcome,
} from "./types";

/** true inside the Tauri webview, false in a plain browser (`npm run dev`), where a mock backend is used. */
export const isTauri = "__TAURI_INTERNALS__" in window;

export interface Api {
  listKeys(): Promise<KeyInfo[]>;
  generateKey(options: GenerateOptions): Promise<KeyInfo>;
  /** Copies an existing private key file into the ssh directory. */
  importKey(sourcePath: string, name?: string): Promise<KeyInfo>;
  /** Moves the key to the OS trash, or removes it for good when `permanent`. */
  deleteKey(name: string, permanent: boolean): Promise<void>;
  renameKey(name: string, newName: string, updateConfig: boolean): Promise<RenameOutcome>;
  setKeyEnabled(name: string, enabled: boolean): Promise<KeyInfo>;
  setComment(name: string, comment: string): Promise<KeyInfo>;
  agentStatus(): Promise<AgentStatus>;
  agentAdd(name: string, passphrase?: string): Promise<void>;
  agentRemove(name: string): Promise<void>;
  /** Shows the key in Finder / Explorer / the file manager. */
  revealKey(name: string): Promise<void>;
  /** Native file picker; resolves to null when cancelled. */
  pickKeyFile(): Promise<string | null>;
  copyText(text: string): Promise<void>;
  appInfo(): Promise<AppInfo>;
}

const tauriApi: Api = {
  listKeys: () => invoke("list_keys"),
  generateKey: (options) => invoke("generate_key", { options }),
  importKey: (sourcePath, name) => invoke("import_key", { sourcePath, name: name ?? null }),
  deleteKey: (name, permanent) => invoke("delete_key", { name, permanent }),
  renameKey: (name, newName, updateConfig) =>
    invoke("rename_key", { name, newName, updateConfig }),
  setKeyEnabled: (name, enabled) => invoke("set_key_enabled", { name, enabled }),
  setComment: (name, comment) => invoke("set_comment", { name, comment }),
  agentStatus: () => invoke("agent_status"),
  agentAdd: (name, passphrase) => invoke("agent_add", { name, passphrase: passphrase ?? null }),
  agentRemove: (name) => invoke("agent_remove", { name }),
  revealKey: (name) => invoke("reveal_key", { name }),
  pickKeyFile: async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, directory: false, title: "Import SSH key" });
    return typeof picked === "string" ? picked : null;
  },
  copyText: async (text) => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  },
  appInfo: () => invoke("app_info"),
};

export const api: Api = isTauri ? tauriApi : mockApi;

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as ApiError).message);
  return String(e);
}

export function errorCode(e: unknown): ApiError["code"] | null {
  if (e && typeof e === "object" && "code" in e) return (e as ApiError).code;
  return null;
}
